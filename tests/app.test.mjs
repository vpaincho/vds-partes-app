import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeAccounts, currentAccount, scopedState, routeAllowed, actionAllowed, createLocalIdentityProvider } from '../src/core/access.js';
import { createAdminConsole } from '../src/admin/console.js';
import { createTelemetry } from '../src/intelligence/telemetry.js';
import { createControlHost } from '../src/intelligence/control-host.js';
import { createQuickPart } from '../src/features/quick-part.js';
import { evaluateWork } from '../src/intelligence/documents.js';
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
  Object.assign(w,{initializeAccounts,currentAccount,scopedState,routeAllowed,actionAllowed,createLocalIdentityProvider,createAdminConsole,createTelemetry,createControlHost,createQuickPart,evaluateWork});
  w.createLocalRepository=createLocalRepository;w.createFeatureHost=createFeatureHost;w.jsPDF=jsPDF;
  w.eval(source+'\nwindow.qa={state:()=>S,action:A,render,checks,buildPdf,ui:()=>UI};');
  const doc=w.document;
  const fill=(selector,value)=>{const input=doc.querySelector(selector);assert.ok(input,selector);input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
  const click=(selector)=>{const el=doc.querySelector(selector);assert.ok(el,selector);el.click();};
  const login=async(id,password='vds2026')=>{fill('#lu',id);fill('#lp',password);doc.querySelector('#loginf').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));for(let i=0;i<200&&doc.querySelector('#loginf button[type="submit"]')?.disabled;i++)await new Promise(resolve=>setTimeout(resolve,5));};
  const submit=async()=>{doc.querySelector('form[data-module]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,0));};
  return{dom,w,doc,fill,click,login,submit,dispose:()=>w.close()};
}

test('login controls preserve entered credentials and restore keyboard focus',()=>{
  const app=boot();app.fill('#lu','lmendez');app.fill('#lp','vds2026');
  app.click('[data-login-control="password"]');assert.equal(app.doc.querySelector('#lp').type,'text');assert.equal(app.doc.activeElement.id,'lp');
  app.click('[data-login-control="theme"]');assert.equal(app.doc.querySelector('.login-scene').dataset.appearance,'light');
  assert.equal(app.doc.querySelector('#lu').value,'lmendez');assert.equal(app.doc.querySelector('#lp').value,'vds2026');
  assert.equal(app.doc.querySelector('[data-login-control="theme"]').getAttribute('aria-pressed'),'true');
  assert.doesNotMatch(app.doc.body.innerHTML,/undefined/);app.click('[data-login-control="password"]');assert.equal(app.doc.querySelector('#lp').type,'password');app.dispose();
});

test('login reads autofilled values, shows busy state, and leaves role screens outside login theme',async()=>{
  const app=boot();app.doc.querySelector('#lu').value='darce';app.doc.querySelector('#lp').value='vds2026';
  app.doc.querySelector('#loginf').dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));
  const button=app.doc.querySelector('#loginf button[type="submit"]');assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');
  for(let i=0;i<200&&app.doc.querySelector('#loginf button[type="submit"]')?.disabled;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(app.w.qa.state().route,'o-day');assert.equal(app.doc.querySelector('.login-scene'),null);app.dispose();
});

test('invalid login keeps accessible feedback and permits correction',async()=>{
  const app=boot();await app.login('lmendez','incorrecta');assert.equal(app.w.qa.state().user,null);
  assert.ok(app.doc.querySelector('#login-error[role="alert"]'));assert.equal(app.doc.querySelector('#lp').getAttribute('aria-describedby'),'login-error');
  assert.equal(app.doc.querySelector('#loginf button[type="submit"]').disabled,false);await app.login('lmendez');assert.equal(app.w.qa.state().route,'p-plan');app.dispose();
});

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
  open('live');app.fill('[name="source"]','Manual');app.fill('[name="title"]','Cerco');app.fill('[name="target"]','100');app.fill('[name="completed"]','80');await app.submit();assert.match(app.doc.body.textContent,/80%/);
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

test('control centers are distinct by role, stay empty without genuine measurements, and support product improvement tracking',async()=>{
  const app=boot();await app.login('sherrera');assert.ok(app.doc.querySelector('nav [data-r="x-product"]'));assert.equal(app.doc.querySelector('nav [data-r="x-operations"]'),null);app.w.qa.action.nav({r:'x-product'});assert.match(app.doc.body.textContent,/Sin medición/);assert.match(app.doc.body.textContent,/Producto · datos de uso local/);assert.equal(app.w.qa.state().telemetry.sessions.length,0);
  for(const [name,value]of Object.entries({title:'Reducir escritura',evidence:'Piloto de 10 jornadas',hypothesis:'Precarga de horarios confirmados',owner:'Producto'}))app.fill(`#product-opportunity [name="${name}"]`,value);await adminSubmit(app,'#product-opportunity');const opportunity=app.w.qa.state().productOpportunities[0];assert.ok(opportunity.id);assert.equal(opportunity.status,'Por evaluar');const form=app.doc.querySelector('[data-product-update]');form.querySelector('[name="status"]').value='Priorizada';form.dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(opportunity.status,'Priorizada');assert.equal(opportunity.history.length,1);
  app.w.qa.action.logout();await app.login('lmendez');assert.equal(app.doc.querySelector('nav [data-r="x-product"]'),null);assert.ok(app.doc.querySelector('nav [data-r="x-operations"]'));app.w.qa.action.nav({r:'x-operations'});assert.match(app.doc.body.textContent,/Sin cantidades registradas/);assert.match(app.doc.body.textContent,/Solo registros cargados/);app.fill('[data-bind="s:opsExamples"]','yes');app.doc.querySelector('[data-bind="s:opsExamples"]').dispatchEvent(new app.w.Event('change',{bubbles:true}));assert.match(app.doc.body.textContent,/Incluye datos de ejemplo/);app.w.qa.action.nav({r:'x-product'});assert.equal(app.w.qa.state().route,'x-operations');app.dispose();
});

test('document matrix is manageable by admin, approved evidence is required, planner reads and operator sees only own work',async()=>{
  const app=boot();await app.login('sherrera');app.w.qa.action['module-open']({module:'documents',work:'PL-092'});assert.match(app.doc.body.textContent,/Matriz documental pendiente/);
  for(const [name,value]of Object.entries({title:'Curso específico',kind:'Personal',subject:'Diego Arce',operator:'AUP',owner:'Control documental',noticeDays:'15'}))app.fill(`#document-requirement [name="${name}"]`,value);await adminSubmit(app,'#document-requirement');const r=app.w.qa.state().documentControl.requirements[0];assert.ok(r);
  const p=app.w.qa.state().partes.find(p=>p.pl==='PL-092');const date=p.fecha;app.fill('#document-evidence [name="subject"]','Diego Arce');app.fill('#document-evidence [name="reference"]','Documento revisado en origen');app.fill('#document-evidence [name="validFrom"]',date);app.fill('#document-evidence [name="validTo"]',new Date(Date.parse(date)+60*86400000).toISOString().slice(0,10));await adminSubmit(app,'#document-evidence');assert.match(app.doc.body.textContent,/Pendiente de validación/);
  app.fill('#document-evidence [name="subject"]','Diego Arce');app.fill('#document-evidence [name="reference"]','Nueva versión revisada');app.fill('#document-evidence [name="validFrom"]',date);app.fill('#document-evidence [name="validTo"]',new Date(Date.parse(date)+60*86400000).toISOString().slice(0,10));app.fill('#document-evidence [name="status"]','Aprobado');await adminSubmit(app,'#document-evidence');assert.match(app.doc.body.textContent,/En regla/);
  app.w.qa.action.logout();await app.login('lmendez');app.w.qa.action['module-open']({module:'documents',work:'PL-092'});assert.equal(app.doc.querySelector('#document-requirement'),null);assert.match(app.doc.body.textContent,/En regla/);
  app.w.qa.action.logout();await app.login('darce');app.w.qa.action['module-open']({module:'documents',work:'PL-092'});assert.equal(app.doc.querySelector('#document-evidence'),null);assert.match(app.doc.body.textContent,/Diego Arce/);assert.doesNotMatch(app.doc.body.textContent,/PL-093/);app.dispose();
});

test('quick part never confirms automatically, retains unsaved draft through signature rendering, and preserves original exceptions',async()=>{
  const app=boot();await app.login('darce');const p=app.w.qa.state().partes.find(p=>p.estado==='curso');app.w.qa.action['o-open']({id:p.id});assert.ok(app.doc.querySelector('#quick-part'));assert.equal(app.doc.querySelector('[name="confirmed"]').checked,false);const qty=p.ejec.reg.find(r=>r.c==='op').q;
  app.doc.querySelector('#quick-part').dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));assert.match(app.doc.body.textContent,/Confirmá personal/);assert.equal(p.ejec.reg.find(r=>r.c==='op').q,qty);
  app.fill('[name="notes"]','Pendiente para próxima jornada');app.w.qa.render();assert.equal(app.doc.querySelector('[name="notes"]').value,'Pendiente para próxima jornada');app.doc.querySelector('[name="confirmed"]').checked=true;app.doc.querySelector('[name="confirmed"]').dispatchEvent(new app.w.Event('change',{bubbles:true}));app.doc.querySelector('#quick-part').dispatchEvent(new app.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(p.ejec.obs,'Pendiente para próxima jornada');assert.equal(p.ejec.reg.find(r=>r.c==='op').q,qty);
  app.w.qa.action['quick-detail']({step:'3'});assert.ok(app.doc.querySelector('.steps'));assert.equal(app.doc.querySelector('#quick-part'),null);app.w.qa.action['quick-open']();assert.ok(app.doc.querySelector('#quick-part'));assert.ok(app.w.qa.state().telemetry.sessions.some(x=>x.partId===p.id));app.dispose();
});

test('handover reuses recorded activity, live advance derives quantities, and structured capture adds a reviewed event once',async()=>{
  const app=boot();await app.login('darce');const p=app.w.qa.state().partes.find(p=>p.pl==='PL-092'&&p.estado==='curso');app.w.qa.action['module-open']({module:'handover',work:p.pl});assert.match(app.doc.querySelector('[name="completed"]').value,/Limpieza de locación/);
  app.w.qa.action['module-open']({module:'live',work:p.pl});app.fill('[name="title"]','Limpieza de locación');app.fill('[name="target"]','900');app.fill('[name="unit"]','m²');await app.submit();assert.match(app.doc.body.textContent,/50%/);
  app.w.qa.action['module-open']({module:'capture',work:p.pl});for(const [name,value]of Object.entries({title:'Trabajo de tarde',description:'Limpieza sector norte',activity:'Limpieza de locación',from:'13:00',to:'14:00',quantity:'100',unit:'m²'}))app.fill(`[name="${name}"]`,value);await app.submit();const r=app.w.qa.state().extensions.records.capture[0];app.w.qa.action['capture-to-activity']({id:r.id});assert.equal(r.incorporatedPart,p.id);const count=p.ejec.reg.length;app.w.qa.action['capture-to-activity']({id:r.id});assert.equal(p.ejec.reg.length,count);app.w.qa.action['module-open']({module:'live',work:p.pl});assert.match(app.doc.body.textContent,/61%/);app.dispose();
});

test('company identity is configurable and planner can reuse planning without changing the source',async()=>{
  const app=boot();await app.login('sherrera');app.w.qa.action.nav({r:'a-system'});app.fill('#admin-brand-form [name="companyName"]','Empresa Prueba');app.fill('#admin-brand-form [name="productName"]','Trama');await adminSubmit(app,'#admin-brand-form');assert.match(app.doc.querySelector('.brand').textContent,/Empresa Prueba/);assert.match(app.doc.querySelector('.brand').textContent,/Friquarks/);
  app.w.qa.action.logout();await app.login('lmendez');const t=app.w.qa.state().trabajos.find(t=>t.id==='PL-092'),before=t.inicio;app.w.qa.action['t-open']({id:t.id});app.w.qa.action['t-copy']();assert.ok(app.doc.querySelector('#trabf'));assert.equal(app.w.qa.ui().modal.edit,null);assert.equal(t.inicio,before);assert.equal(app.w.qa.ui().modal.f.ct,t.ct);app.dispose();
});

test('quick part can save and send an explicitly confirmed daily report while preserving safety checks and telemetry',async()=>{
  const app=boot();await app.login('darce');const p=app.w.qa.state().partes.find(p=>p.pl==='PL-092'&&p.estado==='curso');app.w.qa.action['o-open']({id:p.id});
  for(const name of ['confirmed','common','talk','ppe']){const input=app.doc.querySelector(`[name="${name}"]`);input.checked=true;input.dispatchEvent(new app.w.Event('change',{bubbles:true}));}
  for(const [name,value]of Object.entries({base:'06:30',zone:'07:35',out:'18:30',arrival:'07:35',temperature:'11',gust:'45',permit:'PT-REAL-REVISADO',signer:'Supervisor',permitTime:'07:30',km0:'200000',km1:'200000',quantity1:'20',from1:'11:00',to1:'12:00',quantity2:'10',from2:'12:00',to2:'13:00',notes:'Trabajo continúa mañana'}))app.fill(`[name="${name}"]`,value);
  p.ejec.firma='seed';const send=()=>{const form=app.doc.querySelector('#quick-part');form.dispatchEvent(new app.w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector('[value="send"]')}));};send();assert.equal(p.estado,'curso');assert.ok(app.w.qa.checks(p).some(x=>x[0]==='err'&&x[1].includes('MB-08')));assert.equal(app.w.qa.state().telemetry.sessions.filter(s=>s.completedAt).length,0);
  app.w.qa.state().hab['MB-08|AUP'].vence='2099-12-31';const confirmation=app.doc.querySelector('[name="confirmed"]');confirmation.checked=true;confirmation.dispatchEvent(new app.w.Event('change',{bubbles:true}));send();assert.equal(p.estado,'env',JSON.stringify({checks:app.w.qa.checks(p),error:app.doc.querySelector('.quick-error')?.textContent}));assert.ok(p.submittedAt);assert.ok(p.documentSnapshot);assert.equal(p.ejec.check.epp,true);assert.equal(app.w.qa.state().telemetry.sessions.filter(s=>s.completedAt).length,1);assert.match(app.doc.body.textContent,/Parte listo para aprobación local/);app.dispose();
});

test('admin can explicitly grant document management to planner without granting admin access',async()=>{
  const app=boot();await app.login('sherrera');app.w.qa.action.nav({r:'a-users'});app.w.qa.action['admin-user-edit']({id:'lmendez'});app.fill('[name="documentPermission"]','yes');await adminSubmit(app,'#admin-user-form');app.w.qa.action.logout();await app.login('lmendez');app.w.qa.action['module-open']({module:'documents',work:'PL-092'});assert.ok(app.doc.querySelector('#document-requirement'));assert.equal(app.doc.querySelector('nav [data-r="a-users"]'),null);app.dispose();
});
