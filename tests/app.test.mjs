import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeAccounts, currentAccount, scopedState, routeAllowed, actionAllowed, createLocalIdentityProvider } from '../src/core/access.js';
import { createAdminConsole } from '../src/admin/console.js';
import { JSDOM } from 'jsdom';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { createLocalRepository } from '../src/core/storage.js';
import { createFeatureHost } from '../src/features/registry.js';
import { initializeExtensions, upsertRecord, validateMaterialItems } from '../src/features/model.js';

const source=(await readFile(new URL('../src/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('import.meta.env.PROD','false');

function boot(saved){
  const dom=new JSDOM('<!doctype html><html><body><div class="screen" id="screen"></div></body></html>',{url:'https://vds.test',runScripts:'outside-only'});
  const w=dom.window;
  w.HTMLCanvasElement.prototype.getContext=()=>({beginPath(){},moveTo(){},bezierCurveTo(){},stroke(){},arc(){},fill(){},lineTo(){},drawImage(){}});
  w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,aW1hZ2U=';
  w.HTMLCanvasElement.prototype.setPointerCapture=()=>{};
  globalThis.window=w;globalThis.document=w.document;globalThis.FormData=w.FormData;
  w.structuredClone=structuredClone;
  if(saved)w.localStorage.setItem('vds-partes-web-1',saved);
  Object.assign(w,{initializeAccounts,currentAccount,scopedState,routeAllowed,actionAllowed,createLocalIdentityProvider,createAdminConsole});
  w.createLocalRepository=createLocalRepository;w.createFeatureHost=createFeatureHost;w.jsPDF=jsPDF;
  w.eval(source+'\nwindow.qa={state:()=>S,action:A,render,checks,buildPdf,ui:()=>UI};');
  const doc=w.document;
  const fill=(selector,value)=>{const input=doc.querySelector(selector);assert.ok(input,selector);input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
  const click=(selector)=>{const el=doc.querySelector(selector);assert.ok(el,selector);el.click();};
  const login=async(id,password='vds2026')=>{fill('#lu',id);fill('#lp',password);doc.querySelector('#loginf').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));for(let i=0;i<200&&doc.querySelector('#loginf button')?.disabled;i++)await new Promise(resolve=>setTimeout(resolve,5));};
  const submit=async()=>{doc.querySelector('form[data-module]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,0));};
  return{dom,w,doc,fill,click,login,submit,dispose:()=>w.close()};
}

test('replica baseline: login, planner views, operator five steps and PDF',async()=>{
  const app=boot();await app.login('lmendez');assert.match(app.doc.body.textContent,/Planificación/);
  for(const view of ['rec','mes','gantt']){app.w.qa.action['p-view']({v:view});assert.ok(app.doc.querySelector('.view'));}
  assert.equal(app.doc.querySelector('.chrome'),null);assert.equal(app.doc.querySelector('.device'),null);
  app.w.qa.action.logout();await app.login('darce');
  const state=app.w.qa.state();const p=state.partes.find(p=>p.rec==='C-03'&&p.estado==='curso');assert.ok(p);
  app.w.qa.action['o-open']({id:p.id});
  for(let i=0;i<5;i++){app.w.qa.action['o-step']({i:String(i)});assert.ok(app.doc.querySelector('.edbody'));}
  const certified=state.partes.find(p=>p.estado==='cert');const pdf=app.w.qa.buildPdf(certified);assert.ok(pdf.size>1000);app.dispose();
});

test('planner creates and revises a reservation; operator sees code and materials read-only; reload retains it',async()=>{
  const app=boot();await app.login('lmendez');app.w.qa.action['module-open']({module:'materials',work:'PL-092'});
  app.fill('[name="title"]','Cerco batería');app.fill('[name="reservation"]','RES-44821');app.fill('[name="material"]','Postes');app.fill('[name="requested"]','10');app.fill('[name="unit"]','unidad');app.fill('[name="pickup"]','Almacén El Trébol');app.fill('[name="status"]','Reserva recibida');await app.submit();
  const r=app.w.qa.state().extensions.records.materials[0];assert.equal(r.reservation,'RES-44821');assert.equal(r.workId,'PL-092');assert.equal(r.items[0].requested,'10');
  app.w.qa.action['module-edit']({module:'materials',id:r.id});app.fill('[name="requested"]','12');await app.submit();assert.equal(r.history.length,1);assert.equal(r.history[0].previous.items[0].requested,'10');
  app.w.qa.action.logout();await app.login('darce');app.w.qa.action['module-open']({module:'materials',work:'PL-092'});assert.match(app.doc.body.textContent,/RES-44821/);assert.match(app.doc.body.textContent,/Postes/);assert.equal(app.doc.querySelector('form[data-module]'),null);
  const saved=app.w.localStorage.getItem('vds-partes-web-1');app.dispose();const restored=boot(saved);assert.match(restored.doc.body.textContent,/RES-44821/);assert.equal(restored.w.qa.state().extensions.records.materials.length,1);restored.dispose();
});

test('reservation requires code after receipt and materials reject invalid quantities',async()=>{
  const app=boot();await app.login('lmendez');app.w.qa.action['module-open']({module:'materials',work:'PL-092'});app.fill('[name="title"]','Pedido');app.fill('[name="material"]','Poste');app.fill('[name="requested"]','2');app.fill('[name="status"]','Reserva recibida');await app.submit();assert.equal(app.w.qa.state().extensions.records.materials.length,0);assert.match(app.doc.body.textContent,/número de reserva/);app.dispose();
  assert.throws(()=>validateMaterialItems([{description:'Postes',unit:'u',requested:-1,withdrawn:'',used:''}]));
});

test('handover, issue resolution, additional request, capture, live progress and logbook',async()=>{
  const app=boot();await app.login('darce');
  const open=id=>app.w.qa.action['module-open']({module:id,work:'PL-092'});
  open('handover');app.fill('[name="title"]','Entrega día');app.fill('[name="pending"]','Faltan 20 metros');await app.submit();const h=app.w.qa.state().extensions.records.handover[0];app.w.qa.action['handover-read']({id:h.id});assert.equal(h.readBy,'Diego Arce');
  open('issues');app.fill('[name="title"]','Pérdida de aceite');app.fill('[name="description"]','Revisar interno');app.fill('[name="owner"]','Mantenimiento');app.fill('[name="status"]','Resuelta');await app.submit();assert.equal(app.w.qa.state().extensions.records.issues.length,0);app.fill('[name="resolution"]','Manguera reemplazada');await app.submit();assert.equal(app.w.qa.state().extensions.records.issues[0].status,'Resuelta');
  open('changes');app.fill('[name="title"]','Ampliar cerco');app.fill('[name="requestedBy"]','Supervisor operadora');app.fill('[name="description"]','40 metros más');await app.submit();assert.equal(app.w.qa.state().extensions.records.changes[0].status,'Informado');
  open('capture');app.fill('[name="title"]','Espera permiso');app.fill('[name="description"]','Esperamos al supervisor');await app.submit();const r=app.w.qa.state().extensions.records.capture[0];app.w.qa.action['capture-to-part']({id:r.id});assert.ok(r.incorporatedPart);const p=app.w.qa.state().partes.find(p=>p.id===r.incorporatedPart);assert.match(p.ejec.obs,/Esperamos al supervisor/);const before=p.ejec.obs;app.w.qa.action['capture-to-part']({id:r.id});assert.equal(p.ejec.obs,before);
  open('live');app.fill('[name="title"]','Cerco');app.fill('[name="target"]','100');app.fill('[name="completed"]','80');await app.submit();assert.match(app.doc.body.textContent,/80%/);
  open('logbook');assert.match(app.doc.body.textContent,/Entrega día/);assert.match(app.doc.body.textContent,/Ampliar cerco/);app.dispose();
});

test('module disabling retains records and removes navigation; operator cannot enable or access other works',async()=>{
  const app=boot();await app.login('sherrera');const s=app.w.qa.state();initializeExtensions(s,['issues']);upsertRecord(s.extensions.records.issues,{workId:'PL-092',title:'Novedad',description:'Texto',status:'Abierta',owner:'Área',kind:'Equipo',priority:'Media'},{actor:'Admin'});
  app.w.qa.action['module-toggle']({module:'issues'});assert.equal(s.extensions.records.issues.length,1);assert.equal(app.doc.querySelector('[data-r="x-issues"]'),null);app.w.qa.action['module-toggle']({module:'issues'});assert.ok(app.doc.querySelector('[data-r="x-issues"]'));
  app.w.qa.action.logout();await app.login('darce');app.w.qa.action['module-toggle']({module:'issues'});assert.equal(s.extensions.enabled.issues,true);app.w.qa.action['module-open']({module:'issues',work:'PL-093'});assert.doesNotMatch(app.doc.querySelector('.feature-list').textContent,/Novedad/);app.dispose();
});

test('evidence photo is stored with activity and stage',async()=>{
  const app=boot();await app.login('darce');globalThis.createImageBitmap=async()=>({width:600,height:400,close(){}});app.w.qa.action['module-open']({module:'evidence',work:'PL-092'});
  app.fill('[name="title"]','Cerco terminado');app.fill('[name="activity"]','Armado de cerco');app.fill('[name="stage"]','Después');
  const input=app.doc.querySelector('[name="photo"]');const file=new app.w.File(['image'],'cerco.png',{type:'image/png'});Object.defineProperty(input,'files',{value:[file]});
  const NativeFormData=globalThis.FormData;globalThis.FormData=class extends NativeFormData {constructor(form){super(form);this.set('photo',file)}};
  await app.submit();const r=app.w.qa.state().extensions.records.evidence[0];assert.equal(r.stage,'Después');assert.match(r.photo,/^data:image/);assert.ok(app.doc.querySelector('.feature-photo'));app.dispose();
});

async function adminSubmit(app,id){const form=app.doc.querySelector(id);assert.ok(form,id);form.dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));for(let i=0;i<200;i++){await new Promise(resolve=>setTimeout(resolve,5));if(!app.doc.querySelector('#admin-user-form button[type="submit"]')?.disabled)break;}}

test('all four roles keep their baseline menus and reject administrative routes and mutations',async()=>{
  const app=boot();
  for(const [username,role,home,allowed,denied] of [
    ['sherrera','admin','p-plan','a-users',null],['lmendez','planner','p-plan','v-inbox','a-users'],['darce','operador','o-day','o-day','p-plan'],['grivas','cliente','c-dash','c-inbox','v-inbox']
  ]){
    await app.login(username);const s=app.w.qa.state();assert.equal(s.user,role);assert.equal(s.route,home);assert.ok(app.doc.querySelector(`[data-r="${allowed}"]`));
    if(denied){assert.equal(app.doc.querySelector(`nav [data-r="${denied}"]`),null);app.w.qa.action.nav({r:denied});assert.equal(s.route,home);const previous=s.contratos['CT-AUP-017'].tareas.length;app.w.qa.action['c-deltask']({ct:'CT-AUP-017',i:'0'});assert.equal(s.contratos['CT-AUP-017'].tareas.length,previous);}
    if(role==='operador'){assert.ok(s.trabajos.every(t=>t.rec==='C-03'));assert.ok(s.partes.every(p=>p.rec==='C-03'));app.w.qa.action['o-start']({pl:'PL-093'});assert.equal(s.route,'o-day');}
    if(role==='cliente'){assert.ok(s.partes.every(p=>p.op==='AUP'));assert.ok(Object.values(s.contratos).every(c=>c.op==='AUP'));app.w.qa.action.sum({id:'not-in-scope'});assert.equal(app.doc.querySelector('.modal'),null);}
    app.w.qa.action.logout();
  }
  app.dispose();
});

test('admin creates individual operator, changes resource and password, deactivates account, preserves business data',async()=>{
  const app=boot();await app.login('sherrera');const total=app.w.qa.state().partes.length;app.w.qa.action.nav({r:'a-users'});
  for(const [name,value] of Object.entries({username:'hruiz',name:'Hugo Ruiz',job:'Jefe de cuadrilla',role:'operador',resource:'C-01',password:'campo2026'}))app.fill(`[name="${name}"]`,value);
  await adminSubmit(app,'#admin-user-form');const account=app.w.qa.state().accounts.find(a=>a.username==='hruiz');assert.ok(account);assert.ok(account.credential.digest);assert.equal(JSON.stringify(account).includes('campo2026'),false);
  app.w.qa.action.logout();await app.login('hruiz','campo2026');let s=app.w.qa.state();assert.equal(s.user,'operador');assert.ok(s.trabajos.every(t=>t.rec==='C-01'));assert.ok(s.partes.every(p=>p.rec==='C-01'));assert.match(app.doc.body.textContent,/Buen día, Hugo/);assert.match(app.doc.body.textContent,/Cuadrilla 01/);
  app.w.qa.action.logout();await app.login('sherrera');assert.equal(app.w.qa.state().partes.length,total);app.w.qa.action.nav({r:'a-users'});app.w.qa.action['admin-user-edit']({id:account.id});app.fill('[name="resource"]','C-05');app.fill('[name="password"]','nuevo2026');await adminSubmit(app,'#admin-user-form');
  app.w.qa.action.logout();await app.login('hruiz','campo2026');assert.equal(app.w.qa.state().user,null);await app.login('hruiz','nuevo2026');assert.ok(app.w.qa.state().trabajos.every(t=>t.rec==='C-05'));
  const work=app.w.qa.state().trabajos.find(t=>t.id==='PL-095');assert.ok(work);app.w.qa.action['o-start']({pl:work.id});assert.equal(app.w.qa.state().partes.filter(p=>p.pl===work.id).length,1);
  app.w.qa.action.logout();await app.login('sherrera');assert.equal(app.w.qa.state().partes.length,total+1);assert.equal(new Set(app.w.qa.state().partes.map(p=>p.id)).size,total+1);app.w.qa.action.nav({r:'a-users'});app.w.qa.action['admin-user-edit']({id:account.id});app.fill('[name="active"]','false');await adminSubmit(app,'#admin-user-form');app.w.qa.action.logout();await app.login('hruiz','nuevo2026');assert.equal(app.w.qa.state().user,null);app.dispose();
});

test('admin cannot remove own admin access and client assignment changes visible operator',async()=>{
  const app=boot();await app.login('sherrera');app.w.qa.action.nav({r:'a-users'});app.w.qa.action['admin-user-edit']({id:'sherrera'});app.fill('[name="active"]','false');await adminSubmit(app,'#admin-user-form');assert.match(app.doc.body.textContent,/propia sesión/);assert.equal(app.w.qa.state().accounts.find(a=>a.id==='sherrera').active,true);
  app.w.qa.action['admin-user-new']();for(const [name,value] of Object.entries({username:'cdiaz',name:'Carolina Díaz',role:'cliente',operator:'GEN',password:'cliente2026'}))app.fill(`[name="${name}"]`,value);await adminSubmit(app,'#admin-user-form');app.w.qa.action.logout();await app.login('cdiaz','cliente2026');assert.equal(app.w.qa.state().route,'c-dash');assert.ok(app.w.qa.state().partes.every(p=>p.op==='GEN'));assert.match(app.doc.body.textContent,/Golfo Energía/);assert.doesNotMatch(app.doc.querySelector('.view').textContent,/Austral Petróleo/);app.dispose();
});

test('admin edits backend catalog and source references without changing historical part snapshots',async()=>{
  const app=boot();await app.login('sherrera');const s=app.w.qa.state(),snapshot=s.partes.find(p=>p.ct==='CT-AUP-017').cc;app.w.qa.action.nav({r:'a-conf'});const form=app.doc.querySelector('[data-contract="CT-AUP-017"]');form.querySelector('[name="cc"]').value='9999';form.dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(s.contratos['CT-AUP-017'].cc,'9999');assert.equal(s.partes.find(p=>p.ct==='CT-AUP-017').cc,snapshot);
  app.w.qa.action.nav({r:'a-system'});app.fill('[name="core"]','core VDS · pendiente schema definitivo');await adminSubmit(app,'#admin-source-form');assert.equal(s.sourceMap.core,'core VDS · pendiente schema definitivo');const saved=app.w.localStorage.getItem('vds-partes-web-1');app.dispose();const restored=boot(saved);assert.equal(restored.w.qa.state().contratos['CT-AUP-017'].cc,'9999');assert.equal(restored.w.qa.state().sourceMap.core,s.sourceMap.core);restored.dispose();
});

test('planner approves and assigned client certifies with individual identity; operator cannot reopen sent parts',async()=>{
  const app=boot();await app.login('lmendez');const p=app.w.qa.state().partes.find(p=>p.estado==='env'&&!app.w.qa.checks(p).some(x=>x[0]==='err'));assert.ok(p);
  app.w.qa.action.nav({r:'v-inbox'});app.w.qa.action['v-sel']({id:p.id});app.w.qa.action['v-ok']();assert.equal(p.estado,'apr');assert.equal(p.dec.who,'Laura Méndez');
  app.w.qa.action.logout();await app.login('sherrera');app.w.qa.action.nav({r:'a-users'});
  for(const [name,value] of Object.entries({username:'certificador',name:'Supervisor Nuevo',role:'cliente',operator:p.op,password:'firma2026'}))app.fill(`[name="${name}"]`,value);await adminSubmit(app,'#admin-user-form');
  app.w.qa.action.logout();await app.login('certificador','firma2026');app.w.qa.action.nav({r:'c-inbox'});app.w.qa.action['c-sel']({id:p.id});app.w.qa.ui().csig='seed';app.w.qa.action['c-ok']();assert.equal(p.estado,'cert');assert.match(p.cert.who,/Supervisor Nuevo/);
  app.w.qa.action.logout();await app.login('darce');const sent=app.w.qa.state().partes.find(p=>p.estado==='cert');assert.ok(sent);app.w.qa.action['o-open']({id:sent.id});assert.equal(app.w.qa.state().route,'o-day');app.dispose();
});
