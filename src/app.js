import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { createLocalRepository } from './core/storage.js';
import { createFeatureHost } from './features/registry.js';
import { initializeAccounts, currentAccount, scopedState, routeAllowed, actionAllowed, createLocalIdentityProvider } from './core/access.js';
import { createAdminConsole } from './admin/console.js';
import './styles/baseline.css';
import './styles/app.css';
window.jspdf = { jsPDF };

const KEY='vds-partes-web-1';
const repository=createLocalRepository(localStorage, KEY);
let storageError='';
let features;
const TODAY=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Argentina/Buenos_Aires'}).format(new Date());
let rawState=null, identity, adminConsole;
const DW=1366,DH=1024;
const SH0='06:00',SHW=840;

const USERS={
  admin:{id:'sherrera',n:'Sofía Herrera',ini:'SH',cargo:'Administración del sistema'},
  planner:{id:'lmendez',n:'Laura Méndez',ini:'LM',cargo:'Planificación y aprobación de partes'},
  operador:{id:'darce',n:'Diego Arce',ini:'DA',cargo:'Jefe · Cuadrilla 03',rec:'C-03'},
  cliente:{id:'grivas',n:'Gustavo Rivas',ini:'GR',cargo:'Supervisor de contrato · Austral Petróleo',op:'AUP'}
};
const BASE_USERS=structuredClone(USERS);
const ROLE_N={admin:'Administrador',planner:'Planner',operador:'Operador',cliente:'Cliente'};
const ROLE_D={admin:'Puede ver y cambiar todo: trabajos, partes, habilitaciones y catálogos',planner:'Planifica los trabajos y revisa y aprueba los partes',operador:'Completa el parte diario y cierra el trabajo',cliente:'Dashboard y certificación con firma'};
const HOME={admin:'p-plan',planner:'p-plan',operador:'o-day',cliente:'c-dash'};
const OPS={AUP:'Austral Petróleo',GEN:'Golfo Energía',CDO:'Cañadón Oil'};
const OPSUP={AUP:'Gustavo Rivas',GEN:'Carolina Díaz',CDO:'Fabián Torres'};
const SUPS=['Pablo Ortiz','Natalia Vera'];
const RTS=['Martín Sosa','Andrea Lucero'];
const APROB='Laura Méndez';
const CONTRATOS0={
  'CT-AUP-017':{op:'AUP',n:'Servicios de cuadrilla en locaciones',cc:'4110',ccn:'Mantenimiento de locaciones · Zona Norte',yacs:['El Trébol','Escalante'],recs:['C-01','C-03'],
    imps:[['AUP-4110-OPEX-01','Mantenimiento de locaciones El Trébol'],['AUP-4110-OPEX-02','Mantenimiento de locaciones Escalante'],['AUP-4110-CAPEX-07','Obras de superficie · proyecto batería ET-B3']],
    tareas:[['Limpieza de locación','m²'],['Montaje de línea de conducción','m'],['Zanjeo manual','m'],['Desmalezado','m²'],['Armado de cerco perimetral','m'],['Movimiento de suelo','m³']]},
  'CT-AUP-021':{op:'AUP',n:'Transporte y logística de materiales',cc:'4205',ccn:'Logística El Trébol',yacs:['El Trébol','Escalante'],recs:['CM-22'],
    imps:[['AUP-4205-OPEX-01','Logística de materiales y fluidos']],
    tareas:[['Traslado de cañería','t'],['Traslado de equipo','viaje'],['Transporte de agua','m³']]},
  'CT-GEN-008':{op:'GEN',n:'Izaje y montaje',cc:'7302',ccn:'Montajes Diadema',yacs:['Diadema'],recs:['HG-14'],
    imps:[['GEN-7302-PM-11','Pulling y montajes programados'],['GEN-7302-PM-12','Montajes de emergencia']],
    tareas:[['Izaje de bombeador','maniobra'],['Carga y descarga de materiales','maniobra'],['Montaje de tanque','maniobra']]},
  'CT-GEN-011':{op:'GEN',n:'Obras civiles menores',cc:'7310',ccn:'Obras civiles Diadema / Manantiales Behr',yacs:['Diadema','Manantiales Behr'],recs:['C-03','C-05'],
    imps:[['GEN-7310-OC-03','Obras civiles Diadema'],['GEN-7310-OC-04','Obras civiles Manantiales Behr']],
    tareas:[['Zanjeo manual','m'],['Desmalezado','m²'],['Movimiento de suelo','m³'],['Limpieza de locación','m²']]},
  'CT-CDO-003':{op:'CDO',n:'Servicios integrales de yacimiento',cc:'5120',ccn:'Operaciones Cañadón Perdido',yacs:['Cañadón Perdido'],recs:['C-05','HG-14','CM-22'],
    imps:[['CDO-5120-OPS-01','Operación de yacimiento'],['CDO-5120-HSE-02','Remediación ambiental']],
    tareas:[['Zanjeo manual','m'],['Transporte de agua','m³'],['Retiro de residuos','m³'],['Izaje de bombeador','maniobra']]}
};
const RECURSOS=[
  {id:'C-01',n:'Cuadrilla 01',k:'Cuadrilla'},
  {id:'C-03',n:'Cuadrilla 03',k:'Cuadrilla'},
  {id:'C-05',n:'Cuadrilla 05',k:'Cuadrilla'},
  {id:'HG-14',n:'Hidrogrúa HG-14',k:'Hidrogrúa'},
  {id:'CM-22',n:'Camión CM-22',k:'Camión batea'}
];
const CREW={'C-01':['Hugo Ruiz','Matías Lell','Nicolás Tapia','Franco Cid'],'C-03':['Diego Arce','Cristian Paz','Lucas Villegas','Ramón Ojeda'],'C-05':['Sergio Molina','Iván Quiroga','Ezequiel Bustos'],'HG-14':['Raúl Funes','Omar Liempe'],'CM-22':['Pablo Gómez']};
const POOL=['Jorge Almonacid','Brian Cárcamo','Walter Nahuelquir'];
const ALLP=[...Object.values(CREW).flat(),...POOL];
const EQ={'PU-31':'Pick-up Hilux','PU-44':'Pick-up Amarok','PU-52':'Pick-up Ranger','MB-08':'Minibús 19 asientos','RT-03':'Retroexcavadora','GE-11':'Grupo electrógeno','HG-14':'Hidrogrúa 28 t','CM-22':'Camión batea','CA-05':'Camión cisterna 30 m³'};
const VEH={'C-01':['PU-44'],'C-03':['PU-31','MB-08'],'C-05':['PU-52'],'HG-14':['HG-14'],'CM-22':['CM-22']};
const KM0={'PU-31':84000,'PU-44':45400,'PU-52':30210,'MB-08':120200,'HG-14':51150,'CM-22':210400,'CA-05':98300,'RT-03':6400,'GE-11':2100};
const UNITS=['m³','m²','m','t','km','viaje','maniobra','h','unidad'];
const TCAT={op:'Operativo',tr:'Traslado',es:'Espera operadora',vi:'Parada por viento',sb:'Standby',rf:'Refrigerio'};
const TORD=['op','tr','es','vi','sb','rf'];
const ESP=['Permiso de trabajo','Responsable Operadora','Espera de un Tercero','Almacén'];
const EST={plan:'Planificado',curso:'En curso',env:'Para aprobar',obs:'Observado',apr:'Para certificar',cert:'Certificado'};
const PRIO={urg:'Urgente',alta:'Alta',media:'Media',baja:'Baja'};
const PRIO_C={urg:'var(--st-err)',alta:'var(--pr-alta)',media:'var(--st-plan)',baja:'var(--faint)'};
const DIRS=['N','NE','E','SE','S','SO','O','NO'];
const CONDS=['Despejado','Nublado parcial','Nublado','Ventoso','Lluvia','Nieve'];
const STEPS=['Inicio','Personal','Equipos','Tareas y tiempos','Cierre'];
const STEP_OF={Inicio:0,Personal:1,Equipos:2,Tareas:3,Cierre:4};

const P_IC={
  cal:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  gantt:'<path d="M4 5v14M4 7h8M7 12h10M10 17h9"/>',
  rows:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/>',
  list:'<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  day:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 11h6M9 15h4"/>',
  shield:'<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  badge:'<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17c.8-1.8 2.3-2.7 4-2.7s3.2.9 4 2.7"/>',
  stamp:'<path d="M9 4h6l-1 7h-4z"/><path d="M5 15h14v3H5zM7 21h10"/>',
  chart:'<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>',
  cog:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  out:'<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  wifi:'<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M9 16a4.5 4.5 0 0 1 6 0M12 19.5h.01"/>',
  nowifi:'<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M9 16a4.5 4.5 0 0 1 6 0M12 19.5h.01M3 3l18 18"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  alert:'<path d="M12 3.5l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  err:'<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7"/>',
  okc:'<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  cam:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  wind:'<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  trash:'<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  right:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  left:'<path d="M19 12H5M11 6l-6 6 6 6"/>',
  chl:'<path d="M15 6l-6 6 6 6"/>',
  chr:'<path d="M9 6l6 6-6 6"/>',
  dbl:'<path d="M17 6l-6 6 6 6M11 6l-6 6 6 6"/>',
  dbr:'<path d="M7 6l6 6-6 6M13 6l6 6-6 6"/>',
  pin:'<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.2 3.2 0 0 1 0 6.3M21 20c0-2.6-1.6-4.8-4-5.6"/>',
  truck:'<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  send:'<path d="M4 12l16-8-6 16-3-6.5z"/><path d="M11 13.5L20 4"/>',
  cloud:'<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/><path d="M9.5 13.5l2 2 3.5-4"/>',
  back:'<path d="M9 14l-5-5 5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  pdf:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6M9 9h2"/>',
  doc:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  flag:'<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  sign:'<path d="M3 17c3-1 4-6 6-6s1 5 3 5 2-3 4-3 2 2 5 2"/><path d="M3 21h18"/>',
  filter:'<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
  wallet:'<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/>'
};
const ic=n=>`<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${P_IC[n]}</svg>`;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mins=h=>{if(!h)return null;const[a,b]=h.split(':').map(Number);return a*60+b};
const dur=(a,b)=>{const x=mins(a),y=mins(b);if(x==null||y==null)return 0;let d=y-x;if(d<0)d+=1440;return d};
const addM=(h,m)=>{const t=((mins(h)+m)%1440+1440)%1440;return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0')};
const fmtH=m=>{const h=Math.floor(m/60),mm=Math.round(m%60);return h+' h'+(mm?' '+String(mm).padStart(2,'0'):'')};
const hDec=m=>(m/60).toLocaleString('es-AR',{maximumFractionDigits:1});
const num=n=>Number(n).toLocaleString('es-AR');
const DIAS=['dom','lun','mar','mié','jue','vie','sáb'];
const DIASL=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const MES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const MESL=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const d8=s=>{const[y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const addDays=(s,n)=>{const d=d8(s);d.setDate(d.getDate()+n);return iso(d)};
const diffD=(a,b)=>Math.round((d8(b)-d8(a))/864e5);
const fDay=s=>{const d=d8(s);return DIAS[d.getDay()]+' '+d.getDate()+' '+MES[d.getMonth()]};
const fDayL=s=>{const d=d8(s);return DIASL[d.getDay()]+' '+d.getDate()+' de '+MESL[d.getMonth()]+' de '+d.getFullYear()};
const fS=s=>{const[y,m,d]=s.split('-');return d+'/'+m+'/'+y.slice(2)};
const hm=()=>{const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
const nowT=()=>'hoy '+hm();
const stamp=(f,h)=>f===TODAY?'hoy '+h:d8(f).getDate()+' '+MES[d8(f).getMonth()]+' '+h;
const mondayOf=s=>{const d=d8(s);const w=(d.getDay()+6)%7;return addDays(s,-w)};
const recOf=id=>RECURSOS.find(r=>r.id===id)||{n:id,k:''};
const jefeOf=id=>(CREW[id]||['—'])[0];
const roleOf=(rec,i)=>{const k=recOf(rec).k;if(i===0)return k==='Cuadrilla'?'Jefe de cuadrilla':k==='Hidrogrúa'?'Operador de grúa':'Chofer';return k==='Hidrogrúa'?'Rigger':'Operario'};
const ROLEP={};Object.entries(CREW).forEach(([r,a])=>a.forEach((n,i)=>ROLEP[n]=roleOf(r,i)));POOL.forEach(n=>ROLEP[n]='Operario');
const homeOf=n=>{const r=Object.keys(CREW).find(k=>CREW[k].includes(n));return r?recOf(r).n:'Base · disponible'};
const eqHome=c=>{const r=Object.keys(VEH).find(k=>VEH[k].includes(c));return r?recOf(r).n:'Base · disponible'};
const pill=e=>`<span class="pill s-${e}">${EST[e]}</span>`;
const prioB=p=>`<span class="prio p-${p}">${PRIO[p]}</span>`;
const ptTag=on=>on?`<span class="tag pt" title="Requiere permiso de trabajo firmado por la operadora">${ic('sign')}Permiso operadora</span>`:'';
const isAdm=()=>S.user==='admin';
const canPlan=()=>S.user==='planner'||S.user==='admin';
const meN=()=>USERS[S.user]?USERS[S.user].n:'';
const jefeP=p=>(p.pers&&p.pers[0])||jefeOf(p.rec);

/* ---------- seed (datos de ejemplo) ---------- */
function seedHab(){const H={};const DV={AUP:'2027-03-31',GEN:'2027-01-15',CDO:'2026-12-20'};
  ALLP.forEach(n=>Object.keys(OPS).forEach(op=>H[n+'|'+op]={vence:DV[op]}));
  Object.keys(EQ).forEach(c=>Object.keys(OPS).forEach(op=>H[c+'|'+op]={vence:op==='CDO'?'2026-11-30':'2027-02-28'}));
  [['Cristian Paz','GEN','2026-09-28'],['Ramón Ojeda','CDO',null],['Brian Cárcamo','AUP',null],['Ezequiel Bustos','AUP','2026-10-08'],['Walter Nahuelquir','GEN','2026-10-09'],['MB-08','AUP','2026-10-03'],['CA-05','AUP',null],['CA-05','GEN',null],['RT-03','AUP',null]]
    .forEach(([s,op,v])=>{if(v)H[s+'|'+op].vence=v;else delete H[s+'|'+op]});
  return H}
function seedTrabajos(){
  const T=[];
  const add=o=>{const t=Object.assign({prio:'media',ptw:false,ind:'',sup:'Pablo Ortiz',rt:'Martín Sosa',cierre:null,ext:null,hist:[{t:'25 sep 16:10',who:'Laura Méndez',a:'Planificado',c:''}]},o);
    t.imp=t.imp||CONTRATOS0[t.ct].imps[0][0];t.pers=t.pers||CREW[t.rec].slice();t.eqs=t.eqs||VEH[t.rec].slice();T.push(t)};
  add({id:'PL-090',ct:'CT-AUP-017',imp:'AUP-4110-OPEX-01',rec:'C-03',yac:'El Trébol',pozo:'ET-1098',inicio:'2026-09-29',dias:4,ptw:true,prev:['Montaje de línea de conducción']});
  add({id:'PL-106',ct:'CT-AUP-021',rec:'CM-22',yac:'El Trébol',pozo:'Playa de materiales',inicio:'2026-09-29',dias:3,prev:['Traslado de cañería','Transporte de agua']});
  add({id:'PL-093',ct:'CT-AUP-017',imp:'AUP-4110-OPEX-02',rec:'C-01',yac:'Escalante',pozo:'Locación ES-212',inicio:'2026-10-01',dias:6,prio:'alta',ptw:true,prev:['Desmalezado','Armado de cerco perimetral'],ind:'Cercar la locación completa antes del montaje del equipo de workover.'});
  add({id:'PL-094',ct:'CT-CDO-003',rec:'C-05',yac:'Cañadón Perdido',pozo:'CP-77',inicio:'2026-10-02',dias:3,prev:['Zanjeo manual'],sup:'Natalia Vera'});
  add({id:'PL-096',ct:'CT-GEN-008',rec:'HG-14',yac:'Diadema',pozo:'DI-311',inicio:'2026-10-02',dias:1,ptw:true,prev:['Izaje de bombeador']});
  add({id:'PL-091',ct:'CT-GEN-011',rec:'C-03',yac:'Diadema',pozo:'DI-408',inicio:'2026-10-03',dias:1,ptw:true,prev:['Zanjeo manual','Desmalezado']});
  add({id:'PL-092',ct:'CT-AUP-017',imp:'AUP-4110-CAPEX-07',rec:'C-03',yac:'El Trébol',pozo:'Batería ET-B3',inicio:'2026-10-05',dias:5,prio:'alta',ptw:true,prev:['Limpieza de locación','Montaje de línea de conducción','Movimiento de suelo'],ind:'Ingresar por picada 14. El supervisor de AUP firma el permiso en la batería a las 07:30.'});
  add({id:'PL-097',ct:'CT-GEN-008',imp:'GEN-7302-PM-12',rec:'HG-14',yac:'Diadema',pozo:'DI-415',inicio:'2026-10-05',dias:2,ptw:true,prev:['Izaje de bombeador']});
  add({id:'PL-095',ct:'CT-CDO-003',imp:'CDO-5120-HSE-02',rec:'C-05',yac:'Cañadón Perdido',pozo:'Batería CP-B3',inicio:'2026-10-05',dias:2,prio:'urg',ptw:true,prev:['Retiro de residuos'],ind:'Derrame menor en batería 3: retirar suelo afectado a repositorio.',sup:'Natalia Vera',eqs:['PU-52','CA-05']});
  add({id:'PL-098',ct:'CT-AUP-021',rec:'CM-22',yac:'El Trébol',pozo:'Playa de materiales',inicio:'2026-10-06',dias:3,prev:['Traslado de cañería','Transporte de agua']});
  add({id:'PL-099',ct:'CT-CDO-003',rec:'HG-14',yac:'Cañadón Perdido',pozo:'CP-77',inicio:'2026-10-08',dias:2,ptw:true,prev:['Izaje de bombeador']});
  add({id:'PL-100',ct:'CT-GEN-011',imp:'GEN-7310-OC-04',rec:'C-05',yac:'Manantiales Behr',pozo:'Planta MB-PIAS',inicio:'2026-10-08',dias:4,prio:'baja',prev:['Limpieza de locación','Movimiento de suelo']});
  add({id:'PL-101',ct:'CT-AUP-017',imp:'AUP-4110-OPEX-02',rec:'C-01',yac:'Escalante',pozo:'ES-215',inicio:'2026-10-08',dias:4,prev:['Desmalezado']});
  add({id:'PL-102',ct:'CT-GEN-011',imp:'GEN-7310-OC-03',rec:'C-03',yac:'Diadema',pozo:'DI-408',inicio:'2026-10-12',dias:3,ptw:true,prev:['Zanjeo manual'],ind:'Terminar zanjeo del tramo 2 (aprox. 60 m).'});
  add({id:'PL-103',ct:'CT-AUP-021',rec:'CM-22',yac:'Escalante',pozo:'ES-215',inicio:'2026-10-13',dias:2,prev:['Traslado de equipo']});
  add({id:'PL-105',ct:'CT-CDO-003',rec:'C-05',yac:'Cañadón Perdido',pozo:'CP-90',inicio:'2026-10-14',dias:5,prev:['Zanjeo manual','Transporte de agua']});
  add({id:'PL-104',ct:'CT-AUP-017',rec:'C-03',yac:'El Trébol',pozo:'ET-1130',inicio:'2026-10-19',dias:4,prio:'baja',prev:['Limpieza de locación','Desmalezado']});
  return T;
}
const unit0=(ct,d)=>((CONTRATOS0[ct].tareas.find(x=>x[0]===d))||[0,''])[1];
function snap(t,fecha){const c=CONTRATOS0[t.ct]||{};const cc=(S&&S.contratos&&S.contratos[t.ct])||c;return {pl:t.id,dia:diffD(t.inicio,fecha),fecha,ct:t.ct,imp:t.imp,op:cc.op,cc:cc.cc,yac:t.yac,pozo:t.pozo,rec:t.rec,prio:t.prio,ptw:t.ptw,prev:t.prev.slice(),ind:t.ind,sup:t.sup,rt:t.rt,pers:t.pers.slice(),eqs:t.eqs.slice()}}
function genEjec(t,fecha){
  const i=diffD(t.inicio,fecha),g=diffD('2026-09-28',fecha),op=CONTRATOS0[t.ct].op;
  const Q={'m²':[350,60],'m':[45,9],'m³':[18,5],'t':[14,2],'viaje':[3,1],'maniobra':[2,0],'h':[8,0],'km':[60,10],'unidad':[4,1]};
  const qOf=d=>{const u=unit0(t.ct,d),q=Q[u]||[5,1];return [q[0]+(i%3)*q[1],u]};
  const reg=[{c:'tr',de:'06:45',a:'07:40',d:'Base → '+t.pozo,q:'',u:'',det:''}];
  const n=t.prev.length,h=Math.ceil(n/2),am=t.prev.slice(0,h),pm=n>1?t.prev.slice(h):t.prev;
  const fill=(list,from,to)=>{const blk=Math.floor(dur(from,to)/list.length);list.forEach((d,k)=>{const[q,u]=qOf(d);reg.push({c:'op',de:addM(from,k*blk),a:k===list.length-1?to:addM(from,(k+1)*blk),d,q:String(n===1?Math.max(1,Math.round(q/2)):q),u,det:''})})};
  fill(am,'07:40','12:30');reg.push({c:'rf',de:'12:30',a:'13:00',d:'',q:'',u:'',det:''});fill(pm,'13:00','17:40');
  reg.push({c:'tr',de:'17:40',a:'18:30',d:'Regreso a base',q:'',u:'',det:''});
  return {check:{charla:true,epp:true},llegada:'07:40',
    permiso:t.ptw?{num:'PT-'+op+'-'+(4400+g*3),firmo:OPSUP[op],hora:'07:30'}:null,
    clima:{t:String(8+(g*3)%9),v:String(22+(g*7)%20),r:String(38+(g*11)%20),dir:['O','SO','NO','O'][g%4],cond:['Despejado','Nublado parcial','Ventoso','Despejado'][g%4],src:'app',at:'07:3'+(g%10)},
    personal:t.pers.map(nm=>({n:nm,rol:ROLEP[nm]||'Operario',base:'06:30',zona:'07:40',out:'18:30',pres:true})),
    equipos:t.eqs.map((c,k)=>({c,km:String(KM0[c]+g*70+62+k*8),obs:''})),
    reg,obs:'',fotos:[],firma:'seed'};
}
function mkParte(t,fecha,estado,patch){
  const p=Object.assign(snap(t,fecha),{estado,ejec:estado==='plan'?null:genEjec(t,fecha),dec:null,cert:null,fin:null,ext:null,cierreObs:'',hist:[{t:'25 sep 16:10',who:'Laura Méndez',a:'Planificado',c:''}]});
  p.fin=p.dia>=t.dias-1?'fin':'sigue';
  const nx=addDays(fecha,1),op=CONTRATOS0[t.ct].op,g=diffD('2026-09-28',fecha);
  if(estado!=='plan')p.hist.push({t:stamp(fecha,'06:3'+(g%9)),who:jefeP(p),a:'Parte iniciado',c:''});
  if(['env','obs','apr','cert'].includes(estado))p.hist.push({t:stamp(fecha,'19:1'+(g%9)),who:jefeP(p),a:'Enviado para aprobación',c:''});
  if(['apr','cert'].includes(estado)){p.dec={d:'ok',who:APROB,t:stamp(nx,'09:20'),com:''};p.hist.push({t:p.dec.t,who:APROB,a:'Aprobado',c:''})}
  if(estado==='cert'){p.cert={d:'ok',who:OPSUP[op]+' · '+OPS[op],t:stamp(addDays(nx,1),'15:40'),com:'',firma:'seed'};p.hist.push({t:p.cert.t,who:OPSUP[op]+' · '+OPS[op],a:'Certificado y firmado',c:''})}
  if(patch)patch(p);
  if(p.fin==='fin'&&['env','obs','apr','cert'].includes(p.estado)&&!t.cierre){t.cierre={fecha,parte:null,who:jefeP(p),t:stamp(fecha,'19:15'),obs:p.cierreObs,anticipado:false};t.hist.push({t:t.cierre.t,who:jefeP(p),a:'Trabajo cerrado por el jefe de cuadrilla',c:p.cierreObs})}
  return p;
}
function seed(){
  const T=seedTrabajos(),P=[];
  const O={
    'PL-090|2026-10-02':['apr',p=>{p.cierreObs='Línea de 4 pulgadas montada y probada. Locación entregada limpia.'}],
    'PL-093|2026-10-03':'apr','PL-094|2026-10-03':'apr',
    'PL-093|2026-10-04':['env',p=>{const e=p.ejec;e.personal.forEach((x,k)=>{x.base='06:15';x.zona='07:20';x.out=k?'18:30':'19:10'});
      e.reg=[{c:'tr',de:'06:30',a:'07:20',d:'Base → Escalante',q:'',u:'',det:''},{c:'op',de:'07:20',a:'10:00',d:'Desmalezado',q:'1200',u:'m²',det:'Sector sur y accesos'},{c:'es',de:'10:00',a:'11:30',d:'Permiso de trabajo',q:'',u:'',det:'Supervisor AUP llegó 11:25'},{c:'op',de:'11:30',a:'13:00',d:'Armado de cerco perimetral',q:'30',u:'m',det:'Lado norte'},{c:'rf',de:'13:00',a:'13:30',d:'',q:'',u:'',det:''},{c:'op',de:'13:30',a:'18:20',d:'Armado de cerco perimetral',q:'55',u:'m',det:'Lado este'},{c:'tr',de:'18:20',a:'19:10',d:'Regreso a base',q:'',u:'',det:''}];
      e.permiso.hora='11:25';
      e.obs='Demora de 1 h 30 en el ingreso: el supervisor de AUP llegó a firmar el permiso a las 11:25.';
      e.fotos=[{cap:'Cerco lado norte'},{cap:'Locación desmalezada'}];e.clima={t:'13',v:'30',r:'48',dir:'O',cond:'Nublado parcial',src:'app',at:'07:24'};
      p.fin='ext';p.ext={dias:1,motivo:'La operadora pidió ampliar el cerco al sector de tanques (40 m más).'}}],
    'PL-094|2026-10-04':['env',p=>{const e=p.ejec;e.personal.forEach(x=>x.out='18:00');
      e.reg=[{c:'tr',de:'06:45',a:'07:45',d:'Base → CP-77',q:'',u:'',det:''},{c:'op',de:'07:45',a:'12:00',d:'Zanjeo manual',q:'38',u:'m',det:'Tramo batería 2 a satélite 5'},{c:'vi',de:'12:00',a:'13:30',d:'',q:'72',u:'km/h',det:'Personal resguardado en el vehículo'},{c:'op',de:'13:30',a:'17:15',d:'Zanjeo manual',q:'26',u:'m',det:'Tramo satélite 5'},{c:'tr',de:'17:15',a:'18:00',d:'Regreso a base',q:'',u:'',det:''}];
      e.obs='Ráfagas de 72 km/h entre 12:00 y 13:30. Se suspendió el trabajo y se resguardó al personal en el vehículo.';e.fotos=[{cap:'Zanja tramo 1'}];
      e.clima={t:'11',v:'44',r:'72',dir:'SO',cond:'Ventoso',src:'app',at:'07:41'};p.cierreObs='Zanja terminada (64 m en total del día). Falta tapado, queda para otra orden.'}],
    'PL-091|2026-10-03':['obs',p=>{const e=p.ejec;e.personal[1].out='';
      e.reg=[{c:'tr',de:'06:45',a:'07:50',d:'Base → DI-408',q:'',u:'',det:''},{c:'op',de:'07:50',a:'12:30',d:'Zanjeo manual',q:'',u:'m',det:''},{c:'es',de:'12:30',a:'13:15',d:'Responsable Operadora',q:'',u:'',det:'Habilitación del tramo 2'},{c:'rf',de:'13:15',a:'13:45',d:'',q:'',u:'',det:''},{c:'op',de:'13:45',a:'16:00',d:'Desmalezado',q:'800',u:'m²',det:''},{c:'op',de:'16:00',a:'18:20',d:'Movimiento de suelo',q:'24',u:'m³',det:'Relleno de zanja tramo 1'},{c:'tr',de:'18:20',a:'19:00',d:'Regreso a base',q:'',u:'',det:''}];
      e.obs='Se esperó al supervisor de la operadora para habilitar el tramo 2 del zanjeo.';
      const c='Cristian Paz tiene la habilitación de Golfo Energía vencida desde el 28/09: no puede figurar como presente. Falta además la cantidad de zanjeo.';
      p.dec={d:'obs',who:APROB,t:'hoy 08:15',com:c};p.hist.push({t:'hoy 08:15',who:APROB,a:'Devuelto con observaciones',c})}],
    'PL-092|2026-10-05':['curso',p=>{const e=p.ejec;e.check.epp=false;e.llegada='07:35';e.clima=null;e.firma=null;e.permiso={num:'',firmo:'',hora:''};
      e.personal.forEach(x=>{x.out=''});e.equipos.forEach(q=>q.km='');
      e.reg=[{c:'tr',de:'06:45',a:'07:35',d:'Base → Batería ET-B3',q:'',u:'',det:''},{c:'op',de:'07:35',a:'10:10',d:'Limpieza de locación',q:'450',u:'m²',det:''},{c:'vi',de:'10:10',a:'11:00',d:'',q:'65',u:'km/h',det:''}]}],
    'PL-093|2026-10-05':['curso',p=>{const e=p.ejec;e.firma=null;e.clima=null;e.personal.forEach(x=>{x.base='06:15';x.zona='07:15';x.out=''});e.equipos.forEach(q=>q.km='');e.reg=[{c:'tr',de:'06:30',a:'07:15',d:'Base → Escalante',q:'',u:'',det:''}];p.fin='sigue'}],
    'PL-097|2026-10-05':['curso',p=>{const e=p.ejec;e.firma=null;e.clima=null;e.personal.forEach(x=>x.out='');e.equipos.forEach(q=>q.km='');e.reg=[{c:'tr',de:'06:45',a:'08:00',d:'Base → DI-415',q:'',u:'',det:''}]}]
  };
  T.forEach(t=>{for(let i=0;i<t.dias;i++){const f=addDays(t.inicio,i);const o=O[t.id+'|'+f];
    if(f<'2026-10-05'||o){const est=Array.isArray(o)?o[0]:(o||'cert');P.push(mkParte(t,f,est,Array.isArray(o)?o[1]:null))}}});
  P.sort((a,b)=>a.fecha.localeCompare(b.fecha)||a.rec.localeCompare(b.rec));
  P.forEach((p,i)=>p.id='PD-'+String(380+i).padStart(4,'0'));
  T.forEach(t=>{if(t.cierre){const last=P.filter(p=>p.pl===t.id).pop();if(last)t.cierre.parte=last.id}});
  const t93=T.find(t=>t.id==='PL-093'),p93=P.find(p=>p.pl==='PL-093'&&p.fecha==='2026-10-04');
  t93.ext={dias:1,motivo:p93.ext.motivo,who:'Hugo Ruiz',t:'4 oct 19:20',parte:p93.id};t93.hist.push({t:'4 oct 19:20',who:'Hugo Ruiz',a:'Pidió 1 día más',c:p93.ext.motivo});
  return {T,P};
}

/* ---------- state ---------- */
let S=null;
function fresh(){const s=seed();return {v:5,trabajos:s.T,partes:s.P,contratos:JSON.parse(JSON.stringify(CONTRATOS0)),hab:seedHab(),user:null,route:'login',back:null,sel:null,step:0,
  vf:'env',vsel:null,vop:'all',cf:'apr',csel:null,pf:'all',lop:'all',lct:'all',lrec:'all',lq:'',hf:'p',hq:'',hbad:false,pv:'gantt',fop:'all',fct:'all',gs:'2026-09-28',ws:mondayOf(TODAY),ms:TODAY.slice(0,7),dop:'AUP',dct:'all',dimp:'all',rmin:false,offline:false}}
function load(){const x=repository.load();return x&&x.v===5&&Array.isArray(x.partes)&&Array.isArray(x.trabajos)?x:null}
function save(){try{repository.save(rawState||S);storageError=''}catch(error){storageError='No se pudo guardar. Exportá una copia de los datos antes de cerrar la app.';let box=document.getElementById('storage-error');if(!box){box=document.createElement('div');box.id='storage-error';box.className='storage-error';box.setAttribute('role','alert');document.getElementById('screen').append(box)}box.hidden=false;box.textContent=storageError}}
try { S=load()||fresh(); } catch(error) { storageError='No se pudo leer el almacenamiento local. Exportá los datos y revisá el espacio disponible.'; S=fresh(); }
// Shift evaluation fixtures to the current date; existing saved records are never shifted.
if (!localStorage.getItem(KEY)) {
  const delta=diffD('2026-10-05',TODAY);
  S.trabajos.forEach(t=>{t.inicio=addDays(t.inicio,delta);if(t.cierre)t.cierre.fecha=addDays(t.cierre.fecha,delta)});
  S.partes.forEach(p=>p.fecha=addDays(p.fecha,delta));
  Object.values(S.hab).forEach(h=>h.vence=addDays(h.vence,delta));
  S.gs=addDays(mondayOf(TODAY),-7);
}

rawState=S;
initializeAccounts(rawState,BASE_USERS);
S=scopedState(rawState);
identity=createLocalIdentityProvider(()=>rawState);
function refreshIdentity(){
  const account=currentAccount(rawState);
  if(!account){S.user=null;S.accountId=null;S.route='login';return}
  S.user=account.role;
  USERS[account.role]={id:account.username,n:account.name,cargo:account.job,ini:account.name.split(/\s+/).slice(0,2).map(x=>x[0]).join(''),rec:account.resource,op:account.operator};
}
refreshIdentity();

const UI={modal:null,drawer:null,toast:null,login:{u:'',p:'',err:''},vcom:'',verr:'',csig:null,hot:false,sig:'',resetArm:false,delArm:null,admEst:'',newT:{},newI:{}};
let toastT=null;
const CT=id=>S.contratos[id];
const impN=(ct,code)=>{const x=(CT(ct).imps||[]).find(i=>i[0]===code);return x?x[1]:''};
const byId=id=>S.partes.find(p=>p.id===id);
const trab=id=>S.trabajos.find(t=>t.id===id);
const cur=()=>byId(S.sel);
const unitOf=(ct,d)=>((CT(ct).tareas.find(x=>x[0]===d))||[0,''])[1];
const inCat=(ct,d)=>CT(ct).tareas.some(x=>x[0]===d);
const parteOf=(pl,f)=>S.partes.find(p=>p.pl===pl&&p.fecha===f);
const tDays=t=>Array.from({length:t.dias},(_,i)=>addDays(t.inicio,i));
const tEnd=t=>addDays(t.inicio,t.dias-1);
const covers=(t,f)=>f>=t.inicio&&f<=tEnd(t);
const dayState=(t,f)=>{const p=parteOf(t.id,f);return p?p.estado:'plan'};
function tState(t){const s=tDays(t).map(f=>dayState(t,f));
  if(s.includes('obs'))return 'obs';if(s.includes('curso'))return 'curso';if(s.includes('env'))return 'env';
  if(s.every(x=>x==='cert'))return 'cert';if(!s.includes('plan')&&s.includes('apr'))return 'apr';
  if(s.some(x=>x!=='plan'))return 'curso';return 'plan'}
const minDias=t=>{let m=1;tDays(t).forEach((f,i)=>{if(parteOf(t.id,f))m=i+1});return m};
const started=t=>tDays(t).some(f=>parteOf(t.id,f));
const overl=(a,b)=>a.inicio<=tEnd(b)&&b.inicio<=tEnd(a);
const clashes=t=>S.trabajos.filter(o=>o!==t&&o.rec===t.rec&&overl(o,t));
const fT=()=>S.trabajos.filter(t=>(S.fop==='all'||CT(t.ct).op===S.fop)&&(S.fct==='all'||t.ct===S.fct));
const busy=(rec,f,L)=>(L||S.trabajos).some(t=>t.rec===rec&&covers(t,f));
const occRec=(rec,days,L)=>Math.round(days.filter(f=>busy(rec,f,L)).length/days.length*100);
const occDay=(f,L)=>Math.round(RECURSOS.filter(r=>busy(r.id,f,L)).length/RECURSOS.length*100);
const occAll=(days,L)=>Math.round(RECURSOS.reduce((s,r)=>s+days.filter(f=>busy(r.id,f,L)).length,0)/(RECURSOS.length*days.length)*100);
const occC=p=>p>=90?'var(--accent)':p>=50?'var(--st-ok)':p>0?'var(--st-curso)':'var(--faint)';
const nextPD=()=>'PD-'+String(Math.max(379,...rawState.partes.map(p=>Number(p.id.slice(3))))+1).padStart(4,'0');
function hab(s,op,f){const h=S.hab[s+'|'+op];if(!h)return{st:'sin'};if(h.vence<f)return{st:'venc',vence:h.vence};if(diffD(f,h.vence)<=7)return{st:'pronto',vence:h.vence};return{st:'ok',vence:h.vence}}
const habSpan=(s,op,a,b)=>{const x=hab(s,op,a);if(habBad(x))return x;return hab(s,op,b)};
const habTxt=(h,long)=>h.st==='ok'?(long?'Hasta '+fS(h.vence):'Habilitado'):h.st==='pronto'?'Vence '+fS(h.vence):h.st==='venc'?'Vencida '+fS(h.vence):'Sin habilitación';
const habChip=(h,edit,long)=>`<${edit?'button':'span'} class="hab h-${h.st}"${edit?` data-a="a-hab" data-s="${esc(edit[0])}" data-op="${edit[1]}" title="Editar habilitación"`:` title="${h.vence?'Vence '+fS(h.vence):'Sin habilitación cargada'}"`}>${ic(h.st==='ok'?'check':h.st==='pronto'?'clock':'x')}${habTxt(h,long)}</${edit?'button':'span'}>`;
const habBad=h=>h.st==='venc'||h.st==='sin';
const busyRes=(kind,name,days,exceptId)=>S.trabajos.filter(o=>o.id!==exceptId&&(kind==='p'?o.pers:o.eqs).includes(name)&&days.some(d=>covers(o,d))).map(o=>o.id);
const regQ=x=>x.c==='op'&&Number(x.q)>0?num(x.q)+' '+(x.u||''):x.c==='vi'&&Number(x.q)>0?num(x.q)+' km/h':'';

/* ---------- reglas del parte ---------- */
function lastKm(c,p){let k=null;S.partes.forEach(o=>{if(o===p||!o.ejec)return;if(p&&(o.fecha>p.fecha||(o.fecha===p.fecha&&o.id>p.id)))return;o.ejec.equipos.forEach(q=>{if(q.c===c&&q.km!==''){const v=Number(q.km);if(k===null||v>k)k=v}})});return k===null?(KM0[c]??null):k}
function prod(p){const r={};(p.ejec?p.ejec.reg:[]).filter(x=>x.c==='op'&&x.d).forEach(x=>{const k=x.d+'|'+x.u;r[k]=r[k]||{d:x.d,u:x.u,q:0};r[k].q+=Number(x.q)||0});return Object.values(r)}
function checks(p){
  const e=p.ejec,out=[];if(!e)return out;
  if(!e.clima||e.clima.t===''||e.clima.r==='')out.push(['err','Faltan las condiciones climáticas','Inicio']);
  if(!(e.check.charla&&e.check.epp))out.push(['err','Checklist de seguridad incompleto','Inicio']);
  if(!e.llegada)out.push(['err','Falta la hora de llegada a la instalación','Inicio']);
  if(p.ptw){const w=e.permiso||{};if(!w.num||!w.firmo||!w.hora)out.push(['err','Falta el permiso de trabajo firmado por la operadora','Inicio'])}
  const pres=e.personal.filter(x=>x.pres);
  if(!pres.length)out.push(['err','No hay personal presente','Personal']);
  pres.forEach(x=>{const h=hab(x.n,p.op,p.fecha);
    if(habBad(h))out.push(['err',`${x.n}: ${h.st==='venc'?'habilitación vencida el '+fS(h.vence):'sin habilitación'} para ${OPS[p.op]}`,'Personal']);
    const miss=[!x.base&&'ingreso a base',!x.zona&&'llegada a zona',!x.out&&'salida'].filter(Boolean);
    if(miss.length)out.push(['err',`${x.n}: falta ${miss.join(', ')}`,'Personal']);
    else if(dur(x.base,x.out)>720)out.push(['warn',`${x.n}: jornada de ${fmtH(dur(x.base,x.out))}, supera 12 h`,'Personal']);
  });
  e.equipos.forEach(q=>{const h=hab(q.c,p.op,p.fecha),pk=lastKm(q.c,p);
    if(habBad(h))out.push(['err',`${q.c} ${EQ[q.c]}: ${h.st==='venc'?'habilitación vencida el '+fS(h.vence):'sin habilitación'} para ${OPS[p.op]}`,'Equipos']);
    if(q.km==='')out.push(['warn',`${q.c}: sin km actual`,'Equipos']);
    else if(pk!==null&&Number(q.km)<pk)out.push(['warn',`${q.c}: el km actual es menor al último registrado (${num(pk)})`,'Equipos']);
  });
  if(!e.reg.length)out.push(['err','No hay tareas ni tiempos registrados','Tareas']);
  const ops=e.reg.filter(x=>x.c==='op');
  if(e.reg.length&&!ops.length)out.push(['warn','No se hizo ninguna tarea operativa en el día','Tareas']);
  ops.forEach(x=>{if(!x.d)out.push(['warn',`Tramo operativo ${x.de}–${x.a} sin tarea`,'Tareas']);else if(!(Number(x.q)>0))out.push(['warn',`${x.d}: sin cantidad`,'Tareas']);else if(!inCat(p.ct,x.d))out.push(['warn',`Tarea fuera del catálogo del contrato: ${x.d}`,'Tareas'])});
  e.reg.filter(x=>x.c==='es'&&!x.d).forEach(x=>out.push(['warn',`Espera ${x.de}–${x.a} sin motivo`,'Tareas']));
  e.reg.filter(x=>x.c==='vi'&&!(Number(x.q)>0)).forEach(x=>out.push(['warn',`Parada por viento ${x.de}–${x.a} sin velocidad registrada`,'Tareas']));
  const srt=e.reg.slice().sort((a,b)=>mins(a.de)-mins(b.de));
  for(let i=1;i<srt.length;i++){if(mins(srt[i].de)<mins(srt[i-1].a))out.push(['warn',`Tramos superpuestos: ${srt[i-1].de}–${srt[i-1].a} y ${srt[i].de}–${srt[i].a}`,'Tareas'])}
  p.prev.filter(d=>!ops.some(x=>x.d===d)).forEach(d=>out.push(['warn',`Tarea prevista sin informar hoy: ${d}`,'Tareas']));
  if(e.clima&&Number(e.clima.r)>=60&&!e.reg.some(t=>t.c==='vi'))out.push(['warn',`Ráfagas de ${e.clima.r} km/h sin parada por viento registrada`,'Tareas']);
  const esp=e.reg.filter(t=>t.c==='es').reduce((s,t)=>s+dur(t.de,t.a),0);
  if(esp>60)out.push([e.obs.trim()?'warn':'err',`Espera de operadora de ${fmtH(esp)}${e.obs.trim()?' (justificada en observaciones)':': justificar en observaciones'}`,e.obs.trim()?'Tareas':'Cierre']);
  if(!p.sup||!p.rt)out.push(['err','Falta supervisor responsable o responsable técnico','Cierre']);
  const t=trab(p.pl);
  if(p.fin==='sigue'&&t&&p.dia>=t.dias-1)out.push(['err','Es el último día planificado: cerrá el trabajo o pedí más días','Cierre']);
  if(p.fin==='ext'&&(!p.ext||!p.ext.motivo.trim()))out.push(['err','Indicá el motivo para pedir más días','Cierre']);
  if(!e.firma)out.push(['err','Falta la firma del jefe de cuadrilla','Cierre']);
  return out;
}
const errs=p=>checks(p).filter(c=>c[0]==='err');
function sums(p){
  const e=p.ejec||{personal:[],equipos:[],reg:[]};
  const pr=e.personal.filter(x=>x.pres);
  const hh=pr.filter(x=>x.base&&x.out).reduce((s,x)=>s+dur(x.base,x.out),0);
  const hz=pr.filter(x=>x.zona&&x.out).reduce((s,x)=>s+dur(x.zona,x.out),0);
  const km=e.equipos.reduce((s,q)=>{const pk=lastKm(q.c,p);return s+(q.km!==''&&pk!==null&&Number(q.km)>=pk?Number(q.km)-pk:0)},0);
  const jor=e.reg.reduce((s,t)=>s+dur(t.de,t.a),0);
  const byc={};e.reg.forEach(t=>byc[t.c]=(byc[t.c]||0)+dur(t.de,t.a));
  return {pers:pr.length,hh,hz,km,jor,byc};
}
function stepOk(p,i){
  const e=p.ejec;if(!e)return false;
  const c=checks(p).filter(x=>x[0]==='err');
  const sec=['Inicio','Personal','Equipos','Tareas','Cierre'][i];
  return !c.some(x=>x[2]===sec)&&(i!==3||e.reg.length>0);
}
function newEjec(p){
  return {check:{charla:false,epp:false},llegada:'',permiso:p.ptw?{num:'',firmo:'',hora:''}:null,clima:null,
    personal:(p.pers||CREW[p.rec]).map(n=>({n,rol:ROLEP[n]||'Operario',base:'',zona:'',out:'',pres:true})),
    equipos:(p.eqs||VEH[p.rec]).map(c=>({c,km:'',obs:''})),reg:[],obs:'',fotos:[],firma:null};
}

/* ---------- render ---------- */
function render(){
  refreshIdentity();
  if(S.user&&!allowedRoute(S.route))S.route=HOME[S.user];
  if(S.route==='o-edit'&&(!cur()||(S.user==='operador'&&!['curso','obs'].includes(cur().estado))))S.route=HOME[S.user];
  const scr=$('#screen');
  const sig=[S.route,S.step,S.sel,S.vsel,S.csel,S.vf,S.cf,S.pv,UI.modal?UI.modal.kind:'',UI.drawer].join('|');
  const keep={};
  if(sig===UI.sig)scr.querySelectorAll('[data-keep]').forEach(el=>keep[el.dataset.keep]=el.scrollTop);
  let h=S.user?shell():login();
  if(UI.modal)h+=modal();
  if(storageError)h+=`<div class="storage-error" id="storage-error" role="alert">${esc(storageError)}</div>`;
  if(UI.toast)h+=`<div class="toast" role="status">${ic('check')}<span>${esc(UI.toast)}</span></div>`;
  scr.innerHTML=h;
  scr.querySelectorAll('[data-keep]').forEach(el=>{if(keep[el.dataset.keep]!=null)el.scrollTop=keep[el.dataset.keep]});
  UI.sig=sig;
  initSigs();save();features?.afterRender();
}
function toast(m){UI.toast=m;clearTimeout(toastT);toastT=setTimeout(()=>{UI.toast=null;const t=$('#screen .toast');if(t)t.remove()},3600)}
function allowedRoute(route){return routeAllowed(S.user,route)||!!features?.find(route)}
function go(route){if(!allowedRoute(route)){toast('Tu perfil no tiene acceso a esta vista.');render();return}S.route=route;UI.drawer=null;render()}
function brand(){return `<div class="brand"><svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true" style="flex:none"><rect width="32" height="32" rx="7" fill="var(--accent)"/><path d="M8 8h4.2L16 19.2 19.8 8H24l-6 16h-4z" fill="#FFFFFF"/></svg><div><b>VIENTOS DEL SUR</b><small>Partes de campo</small></div></div>`}
const selF=(id,bind,opts,cur,attrs)=>`<select class="inp" id="${id}" data-bind="${bind}" data-rr${attrs||''}>${opts.map(([v,l])=>`<option value="${esc(v)}"${String(v)===String(cur)?' selected':''}>${esc(l)}</option>`).join('')}</select>`;

function login(){
  const L=UI.login;
  const winds=[120,200,280,360,440,520,600,680,760].map((y,i)=>`<path d="M${-40+i*14} ${y} C 160 ${y-40}, 320 ${y+36}, 500 ${y-6} S 760 ${y-30}, 820 ${y+4}" style="stroke:var(--rail-hi)" stroke-width="${i%3?1.4:2.4}" fill="none" stroke-linecap="round"/>`).join('');
  return `<div class="login">
  <div class="lbrand"><svg class="wind" viewBox="0 0 700 992" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${winds}</svg>
    ${brand()}
    <h2>Lo que pasa en la locación, <em>registrado una sola vez.</em></h2>
    <p>Planificación por contrato e imputación, parte diario estándar, aprobación y certificación firmada por el cliente en la misma herramienta. Los registros quedan guardados en este dispositivo.</p>
    <ol class="lsteps"><li><span>01</span><b>Planificación</b>Planner</li><li><span>02</span><b>Parte diario</b>Operador en campo</li><li><span>03</span><b>Aprobación</b>Planner</li><li><span>04</span><b>Certificación</b>Cliente, con firma</li></ol>
    <div class="lloc">Base Comodoro Rivadavia · Cuenca Golfo San Jorge</div>
  </div>
  <div class="lform">
    <h3>Ingresar</h3>
    <form id="loginf" novalidate>
      <div class="fld"><label for="lu">Usuario</label><input id="lu" class="inp${L.err?' bad':''}" data-bind="l:u" value="${esc(L.u)}" autocomplete="off" placeholder="ej. darce"></div>
      <div class="fld"><label for="lp">Contraseña</label><input id="lp" type="password" class="inp${L.err?' bad':''}" data-bind="l:p" value="${esc(L.p)}" placeholder="••••••"></div>
      ${L.err?`<div class="ferr">${esc(L.err)}</div>`:''}
      <button class="btn pri lg" type="submit">Ingresar</button>
    </form>
    <p class="sm">Entorno de evaluación local · acceso con los usuarios configurados.</p>
  </div></div>`;
}

function shell(){
  const u=USERS[S.user],r=S.user;
  const navs={
    admin:[['p-plan','Planificación','gantt'],['v-inbox','Aprobación de partes','shield'],['p-list','Partes','list'],['p-hab','Habilitaciones','badge'],['c-inbox','Certificación','stamp'],['c-dash','Dashboard cliente','chart'],['a-conf','Configuración','cog'],['a-users','Usuarios y accesos','badge'],['a-system','Administración del sistema','cog']],
    planner:[['p-plan','Planificación','gantt'],['v-inbox','Aprobación de partes','shield'],['p-list','Partes','list'],['p-hab','Habilitaciones','badge']],
    operador:[['o-day','Mi jornada','day']],
    cliente:[['c-dash','Dashboard','chart'],['c-inbox','Certificación','stamp']]}[r];
  navs.push(...(features?.navigation(r)||[]));
  const badge=k=>{let n=0;
    if(k==='v-inbox')n=S.partes.filter(p=>p.estado==='env'&&!p.cola).length;
    if(k==='o-day')n=S.partes.filter(p=>p.rec===USERS.operador.rec&&p.estado==='obs').length;
    if(k==='p-plan')n=S.trabajos.filter(t=>t.ext).length;
    if(k==='p-list')n=S.partes.filter(p=>p.estado==='obs').length;
    if(k==='c-inbox')n=S.partes.filter(p=>p.estado==='apr'&&(r==='admin'||p.op===USERS.cliente.op)).length;
    return n?`<span class="cnt" aria-label="${n} pendientes">${n}</span>`:''};
  const curR=S.route==='o-edit'?(S.back||'o-day'):S.route;
  return `<aside class="rail${S.rmin?' min':''}"><div class="rtop">${brand()}<button class="rtog" data-a="rail" aria-label="${S.rmin?'Expandir menú':'Contraer menú'}" title="${S.rmin?'Expandir menú':'Contraer menú'}">${ic(S.rmin?'dbr':'dbl')}</button></div><div class="rrole">${ROLE_N[r]}</div>
    <nav>${navs.map(([k,l,i])=>`<button class="nav" data-a="nav" data-r="${k}"${curR===k?' aria-current="page"':''} title="${l}">${ic(i)}<span>${l}</span>${badge(k)}</button>`).join('')}</nav>
    <div class="who"><span class="av" title="${esc(u.n)}">${esc(u.ini)}</span><div class="wn"><b>${esc(u.n)}</b><small>${esc(u.cargo)}</small></div><button class="ibtn rl" data-a="logout" aria-label="Cerrar sesión" title="Cerrar sesión">${ic('out')}</button></div>
  </aside><section class="main">${topbar()}${view()}${UI.drawer?drawer():''}</section>`;
}
function topbar(){
  const R=S.route;let t='',s='',right='';
  if(adminConsole?.handles(R))return `<header class="top"><div class="ttl"><h1>${R==='a-users'?'Usuarios y accesos':'Administración del sistema'}</h1><div class="sub">Administración · ${esc(meN())}</div></div></header>`;
  const feature=features?.find(R);
  if(feature)return `<header class="top"><div class="ttl"><h1>${esc(feature.title)}</h1><div class="sub">${esc(feature.description)}</div></div><span class="sp"></span><button class="btn" data-a="module-home">Volver</button></header>`;
  const date=`<span class="datechip">${ic('cal')} ${fDayL(TODAY)}</span>`;
  const sync=`<button class="sync${S.offline?' off':''}" data-a="sync" title="Estado del almacenamiento local">${ic(S.offline?'nowifi':'wifi')}${S.offline?'Sin señal · guardando':'Guardado local'}</button>`;
  const nb=`<button class="btn pri" data-a="p-new">${ic('plus')}Nueva planificación</button>`;
  if(R==='p-plan'){t='Planificación';s='Trabajos por contrato, recurso y día';right=date+nb}
  else if(R==='p-list'){t='Partes diarios';s='Todos los partes de la base';right=date+nb}
  else if(R==='p-hab'){t='Habilitaciones de ingreso';s=isAdm()?'Tocá una habilitación para editarla':'Personal y vehículos habilitados por operadora';right=date}
  else if(R==='o-day'){t='Mi jornada';s=recOf(USERS.operador.rec).n+' · '+fDayL(TODAY);right=sync}
  else if(R==='o-edit'){const p=cur(),tt=trab(p.pl);return `<header class="top"><button class="btn ghost" data-a="nav" data-r="${S.back||'o-day'}">${ic('left')}${S.back&&S.back!=='o-day'?'Volver':'Mi jornada'}</button><div class="ttl"><h1>Parte diario</h1><div class="sub"><span class="mono">${p.id}</span> · ${fDay(p.fecha)} · ${p.pl} día ${p.dia+1} de ${tt?tt.dias:'—'}</div></div><span class="sp"></span><div class="tr">${ptTag(p.ptw)}${prioB(p.prio)}${pill(p.estado)}${S.user==='operador'?sync:''}</div></header>`}
  else if(R==='v-inbox'){t='Aprobación de partes';s='El planner revisa y aprueba lo que cargan las cuadrillas';right=date}
  else if(R==='c-inbox'){t='Certificación de partes';s=isAdm()?'Todas las operadoras':OPS[USERS.cliente.op]+' · contratos con Vientos del Sur';right=date}
  else if(R==='c-dash'){t='Dashboard del servicio';s=(isAdm()?OPS[S.dop]:OPS[USERS.cliente.op])+' · datos de partes aprobados';right=date}
  else if(R==='a-conf'){t='Configuración';s='Contratos, centros de costo, imputaciones y catálogo de tareas';right=date}
  return `<header class="top"><div class="ttl"><h1>${t}</h1><div class="sub">${s}</div></div><span class="sp"></span><div class="tr">${right}</div></header>`;
}
function view(){
  if(adminConsole?.handles(S.route))return `<div class="view" data-keep="admin">${adminConsole.view(S.route)}</div>`;
  if(features?.find(S.route))return `<div class="view" data-keep="module">${features.view(S.route)}</div>`;
  switch(S.route){
    case 'p-plan':return `<div class="view" data-keep="v">${vPlan()}</div>`;
    case 'p-list':return `<div class="view" data-keep="v">${vList()}</div>`;
    case 'p-hab':return `<div class="view" data-keep="v">${vHab()}</div>`;
    case 'o-day':return `<div class="view" data-keep="v">${vDay()}</div>`;
    case 'o-edit':return `<div class="view flush">${vEdit()}</div>`;
    case 'v-inbox':return `<div class="view flush">${vInbox('v')}</div>`;
    case 'c-inbox':return `<div class="view flush">${vInbox('c')}</div>`;
    case 'c-dash':return `<div class="view" data-keep="v">${vDash()}</div>`;
    case 'a-conf':return `<div class="view" data-keep="v">${vConf()}</div>`;
  }
  return '';
}

/* ---------- planner ---------- */
function periodDays(){
  if(S.pv==='gantt')return Array.from({length:28},(_,i)=>addDays(S.gs,i));
  if(S.pv==='rec')return Array.from({length:7},(_,i)=>addDays(S.ws,i));
  const[y,m]=S.ms.split('-').map(Number);const n=new Date(y,m,0).getDate();return Array.from({length:n},(_,i)=>`${S.ms}-${String(i+1).padStart(2,'0')}`);
}
function periodLabel(){
  if(S.pv==='gantt'){const e=addDays(S.gs,27);return `${d8(S.gs).getDate()} ${MES[d8(S.gs).getMonth()]} – ${d8(e).getDate()} ${MES[d8(e).getMonth()]}`}
  if(S.pv==='rec'){const e=addDays(S.ws,6);return `Semana ${d8(S.ws).getDate()} – ${d8(e).getDate()} ${MES[d8(e).getMonth()]}`}
  const[y,m]=S.ms.split('-').map(Number);return MESL[m-1][0].toUpperCase()+MESL[m-1].slice(1)+' '+y;
}
const ctOpts=op=>[['all','Todos los contratos'],...Object.keys(S.contratos).filter(k=>op==='all'||CT(k).op===op).map(k=>[k,`${k} · ${CT(k).n}`])];
const opOpts=()=>[['all','Todos los clientes'],...Object.entries(OPS)];
function vPlan(){
  const L=fT(),days=periodDays(),oa=occAll(days,L);
  const ps=S.partes.filter(p=>(S.fop==='all'||p.op===S.fop)&&(S.fct==='all'||p.ct===S.fct));
  const k=[[oa+'%','Ocupación de recursos en el período',occC(oa)],[ps.filter(p=>p.estado==='curso').length,'Partes en curso','var(--st-curso)'],
    [ps.filter(p=>p.estado==='env').length,'Partes para aprobar','var(--st-env)'],[ps.filter(p=>p.estado==='apr').length,'Esperando certificación del cliente','var(--st-apr)'],[ps.filter(p=>p.estado==='obs').length,'Observados','var(--st-obs)']];
  const filt=S.fop!=='all'||S.fct!=='all';
  let h=`<div class="fbar"><div class="fld"><label for="f-op">Cliente</label>${selF('f-op','s:fop',opOpts(),S.fop)}</div><div class="fld wide"><label for="f-ct">Contrato</label>${selF('f-ct','s:fct',ctOpts(S.fop),S.fct)}</div>${filt?`<span class="factive">${ic('filter')}Filtro activo · ${L.length} trabajos<button class="ibtn xs" data-a="f-clear" aria-label="Quitar filtro">${ic('x')}</button></span>`:''}<span class="sp"></span>
    <div class="seg" role="group" aria-label="Vista">${[['gantt','Gantt','gantt'],['rec','Por recurso','rows'],['mes','Mes','cal']].map(([k2,l,i])=>`<button data-a="p-view" data-v="${k2}" aria-pressed="${S.pv===k2}">${ic(i)}${l}</button>`).join('')}</div></div>`;
  h+=`<div class="kpis">${k.map(([n,l,c])=>`<div class="kpi" style="--c:${c}"><b>${n}</b><span>${l}</span></div>`).join('')}</div>`;
  const rq=L.filter(t=>t.ext);
  if(rq.length)h+=`<div class="reqs"><h3>${ic('flag')}Pedidos de los jefes de cuadrilla</h3>${rq.map(t=>{const sim=Object.assign({},t,{dias:t.dias+t.ext.dias});const cl=clashes(sim);
    return `<div class="req"><span class="mono">${t.id}</span><div class="txt"><b>${esc(t.ext.who)}</b> pide <b>${t.ext.dias} día${t.ext.dias>1?'s':''} más</b> para ${recOf(t.rec).n} en ${esc(t.pozo)} · hasta ${fDay(addDays(tEnd(t),t.ext.dias))}${cl.length?` <span class="errc">· se superpone con ${cl.map(x=>x.id).join(', ')}</span>`:''}<q>${esc(t.ext.motivo)}</q></div><button class="btn sm2" data-a="x-no" data-id="${t.id}">Rechazar</button><button class="btn pri sm2" data-a="x-ok" data-id="${t.id}">Aprobar extensión</button></div>`}).join('')}</div>`;
  h+=`<div class="ptool"><div class="pnav"><button class="ibtn" data-a="p-nav" data-d="-1" aria-label="Período anterior">${ic('chl')}</button><b>${periodLabel()}</b><button class="ibtn" data-a="p-nav" data-d="1" aria-label="Período siguiente">${ic('chr')}</button></div><button class="btn sm2" data-a="p-nav" data-d="0">Hoy</button><span class="sp"></span><span class="sm">${S.pv==='gantt'?'Arrastrá una barra para moverla o su borde derecho para estirar o acortar':'Ocupación = días con trabajo / días del período'}</span></div>`;
  h+=S.pv==='gantt'?vGantt(L):S.pv==='rec'?vWeek(L):vMonth(L);
  h+=`<div class="legend">${['plan','curso','env','obs','apr','cert'].map(e=>pill(e)).join('')}<span class="sp"></span><span>Prioridad:</span>${Object.entries(PRIO).map(([k2,l])=>`<span style="display:inline-flex;gap:5px;align-items:center"><span class="gpr" style="--pc:${PRIO_C[k2]}"></span>${l}</span>`).join('')}</div>`;
  return h;
}
function lanes(ts){const L=[];ts.slice().sort((a,b)=>a.inicio.localeCompare(b.inicio)).forEach(t=>{let i=L.findIndex(end=>end<t.inicio);if(i<0){i=L.length;L.push('')}L[i]=t.ext?addDays(tEnd(t),t.ext.dias):tEnd(t);t._lane=i});return Math.max(1,L.length)}
function vGantt(L){
  const N=28,days=periodDays(),start=S.gs,end=days[N-1];
  const pct=f=>diffD(start,f)/N*100;
  let h=`<div class="gantt"><div class="grow"><div class="gmonth">Recurso · ocupación</div><div class="ghead">${days.map(f=>{const d=d8(f),w=d.getDay();return `<span class="${w===0||w===6?'we':''}${f===TODAY?' td':''}">${'DLMMJVS'[w]}<b>${d.getDate()}</b></span>`}).join('')}</div></div>`;
  const we=days.map((f,i)=>{const w=d8(f).getDay();return w===6?`<div class="gwe" style="left:${i/N*100}%;width:${200/N}%"></div>`:w===0&&i===0?`<div class="gwe" style="left:0;width:${100/N}%"></div>`:''}).join('');
  const now=TODAY>=start&&TODAY<=end?`<div class="gnow" style="left:calc(${pct(TODAY)}% + ${100/N/2}%)"></div>`:'';
  RECURSOS.forEach(r=>{
    const ts=L.filter(t=>t.rec===r.id&&t.inicio<=end&&tEnd(t)>=start);
    const nl=lanes(ts),o=occRec(r.id,days,L);
    const bars=ts.map(t=>{const st=tState(t),cl=clashes(t).length,lk=started(t);
      const ds=tDays(t).map(f=>`<i class="s-${dayState(t,f)}"></i>`).join('');
      const top=10+t._lane*46;
      const ext=t.ext?`<div class="gext" style="left:${pct(addDays(tEnd(t),1))}%;width:${t.ext.dias/N*100}%;top:${top}px">+${t.ext.dias} pedido</div>`:'';
      return `<div class="gbar s-${st}${cl?' clash':''}${lk?' lock':''}${t.cierre?' closed':''}" data-id="${t.id}" style="left:${pct(t.inicio)}%;width:${t.dias/N*100}%;top:${top}px" title="${t.id} · ${OPS[CT(t.ct).op]} · ${esc(t.yac)} ${esc(t.pozo)} · ${t.dias} días · ${t.pers.length} personas${t.ptw?' · permiso de operadora':''}${t.cierre?' · cerrado':''}${cl?' · se superpone con '+clashes(t).map(x=>x.id).join(', '):''}">
        <span class="gh l" data-h="l"></span>${t.cierre?`<span class="ck">${ic('okc')}</span>`:`<span class="gpr" style="--pc:${PRIO_C[t.prio]}"></span>`}<span class="gl"><span class="mono">${t.id}</span> ${CT(t.ct).op} · ${esc(t.pozo)} · ${t.dias} d${t.ptw?' · PT':''}</span><span class="gd">${ds}</span><span class="gh r" data-h="r"></span></div>${ext}`}).join('');
    h+=`<div class="grow"><div class="glab"><b>${r.n}</b><small>${jefeOf(r.id)} · ${r.k}</small><div class="occ" style="--c:${occC(o)}"><i><em style="width:${o}%"></em></i><b>${o}%</b></div></div><div class="gtrack" style="height:${20+nl*46}px">${we}${now}${bars}</div></div>`;
  });
  h+=`<div class="grow"><div class="glab"><b>Ocupación diaria</b><small>Recursos ocupados / ${RECURSOS.length}</small></div><div class="gocc">${days.map(f=>{const o=occDay(f,L);return `<span title="${fDay(f)}: ${o}%" style="--c:${occC(o)}"><i style="height:${Math.max(o,3)*0.26}px"></i>${o}</span>`}).join('')}</div></div></div>`;
  return h;
}
function vWeek(L){
  const days=periodDays();
  let h=`<div class="board" role="grid" aria-label="Calendario por recurso"><div class="bh">Recurso</div>`;
  days.forEach(f=>{const x=d8(f),o=occDay(f,L);h+=`<div class="bh${f===TODAY?' today':''}">${DIAS[x.getDay()]}${f===TODAY?' · hoy':''}<b>${x.getDate()}</b><span class="oc"><span class="gpr" style="--pc:${occC(o)}"></span>${o}% ocupado</span></div>`});
  RECURSOS.forEach((r,ri)=>{
    const last=ri===RECURSOS.length-1?' lastrow':'',o=occRec(r.id,days,L);
    h+=`<div class="rh${last}"><b>${r.n}</b><small>${jefeOf(r.id)}</small><div class="occ" style="--c:${occC(o)}"><i><em style="width:${o}%"></em></i><b>${o}%</b></div></div>`;
    days.forEach(f=>{
      const ts=L.filter(t=>t.rec===r.id&&covers(t,f));
      h+=`<div class="cell${f===TODAY?' today':''}${last}">${ts.map(t=>{const st=dayState(t,f),p=parteOf(t.id,f);
        return `<button class="job s-${st}" data-a="t-open" data-id="${t.id}" title="${t.id} · ${esc(t.pozo)} · ${t.pers.length} personas · ${t.eqs.join(', ')}"><span class="l1"><span class="mono">${t.id}</span><span class="gpr" style="--pc:${PRIO_C[t.prio]}" title="Prioridad ${PRIO[t.prio]}"></span></span><span class="l2">${CT(t.ct).op} · ${esc(t.pozo)}</span><span class="l2">Día ${diffD(t.inicio,f)+1}/${t.dias}${t.ptw?' · PT':''}${p?' · '+p.id.slice(3):''}</span></button>`}).join('')}
        ${f>=TODAY&&canPlan()?`<button class="add" data-a="p-cell" data-rec="${r.id}" data-d="${f}" aria-label="Planificar ${r.n} el ${fDay(f)}" title="Planificar ${r.n} · ${fDay(f)}">+</button>`:''}</div>`;
    });
  });
  return h+'</div>';
}
function vMonth(L){
  const[y,m]=S.ms.split('-').map(Number);
  const first=`${S.ms}-01`,last=iso(new Date(y,m,0));
  let d=mondayOf(first);const cells=[];
  while(d<=last||(d8(d).getDay()!==1)){cells.push(d);d=addDays(d,1);if(cells.length>42)break}
  let h=`<div class="mwrap"><div class="mhead">${['lun','mar','mié','jue','vie','sáb','dom'].map(x=>`<span>${x}</span>`).join('')}</div><div class="month">`;
  cells.forEach(f=>{const ts=L.filter(t=>covers(t,f)).sort((a,b)=>a.rec.localeCompare(b.rec));const o=occDay(f,L);const out=f.slice(0,7)!==S.ms;
    h+=`<div class="mday${out?' out':''}${f===TODAY?' today':''}"><div class="mt"><span class="dn">${d8(f).getDate()}</span>${ts.length?`<span class="opct" style="--c:${occC(o)}" title="Recursos ocupados">${o}%</span>`:''}</div>
      ${ts.slice(0,4).map(t=>`<button class="mchip s-${dayState(t,f)}" data-a="t-open" data-id="${t.id}" title="${t.id} · ${recOf(t.rec).n} · ${esc(t.pozo)}">${t.rec} · ${CT(t.ct).op} ${esc(t.pozo)}</button>`).join('')}
      ${ts.length>4?`<span class="more">+${ts.length-4} más</span>`:''}
      ${f>=TODAY&&!out&&canPlan()?`<button class="add" data-a="p-cell" data-d="${f}" aria-label="Planificar el ${fDay(f)}">+</button>`:''}</div>`});
  return h+'</div></div>';
}
function resList(kind,items,op,a,b,exceptId,days,delAct){
  return items.map(s=>{const h=habSpan(s,op,a,b),cl=days?busyRes(kind,s,days,exceptId):[];
    return `<div><span class="nm"><b>${kind==='p'?esc(s):`<span class="mono">${s}</span> ${esc(EQ[s])}`}</b><small>${kind==='p'?esc(ROLEP[s]||'Operario')+' · '+homeOf(s):eqHome(s)}${cl.length?` · <span class="warn">también en ${cl.join(', ')}</span>`:''}</small></span>${habChip(h)}${delAct?`<button type="button" class="ibtn xs del" data-a="${delAct}" data-n="${esc(s)}" aria-label="Quitar ${esc(s)}">${ic('x')}</button>`:''}</div>`}).join('')||'<div class="sm">Sin asignar</div>';
}
function baselineDrawer(){
  const t=trab(UI.drawer);if(!t)return '';
  const c=CT(t.ct),st=tState(t),mn=minDias(t),cl=clashes(t),lockD=!!t.cierre;
  const dl=tDays(t).map((f,i)=>{const p=parteOf(t.id,f);return p?`<button data-a="sum" data-id="${p.id}"><span class="dd">${fDay(f)}</span><span class="mono sm">${p.id}</span>${p.fin==='fin'?`<span class="tag">${ic('flag')}Cierre</span>`:''}<span class="sp"></span>${pill(p.estado)}${ic('doc')}</button>`:`<div><span class="dd">${fDay(f)}</span><span class="sm">Día ${i+1} · sin iniciar</span><span class="sp"></span>${pill('plan')}</div>`}).join('');
  const canDel=isAdm()&&!started(t);
  return `<aside class="drawer" aria-label="Detalle del trabajo"><div class="dh"><div style="flex:1;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="mono">${t.id}</span>${prioB(t.prio)}${pill(st)}${ptTag(t.ptw)}</div><h2>${esc(c.n)}</h2></div><button class="ibtn" data-a="close-drawer" aria-label="Cerrar">${ic('x')}</button></div>
  <div class="db" data-keep="d">
    ${canPlan()?`<div class="dacts"><button class="btn sm2" data-a="t-edit">${ic('edit')}Editar trabajo</button>${isAdm()&&t.cierre?`<button class="btn sm2" data-a="a-reopen">${ic('back')}Reabrir trabajo</button>`:''}${canDel?`<button class="btn sm2 danger${UI.delArm===t.id?' armed':''}" data-a="a-del">${ic('trash')}${UI.delArm===t.id?'Confirmar eliminación':'Eliminar'}</button>`:''}</div>`:''}
    ${t.cierre?`<div class="infobox">${ic('okc')}<div><b>Trabajo cerrado ${t.cierre.anticipado?'antes de lo planificado':''}</b>${esc(t.cierre.who)} · ${esc(t.cierre.t)} · parte ${esc(t.cierre.parte||'')}${t.cierre.obs?`<div class="sm">${esc(t.cierre.obs)}</div>`:''}</div></div>`:''}
    ${t.ext?`<div class="infobox w">${ic('flag')}<div><b>${esc(t.ext.who)} pide ${t.ext.dias} día${t.ext.dias>1?'s':''} más</b><div class="sm">${esc(t.ext.motivo)}</div>${canPlan()?`<div class="dacts" style="margin-top:8px"><button class="btn sm2" data-a="x-no" data-id="${t.id}">Rechazar</button><button class="btn pri sm2" data-a="x-ok" data-id="${t.id}">Aprobar</button></div>`:''}</div></div>`:''}
    <dl class="kv"><dt>Contrato</dt><dd class="mono">${t.ct}</dd><dt>Imputación</dt><dd><span class="mono">${esc(t.imp)}</span><div class="sm">${esc(impN(t.ct,t.imp))}</div></dd><dt>Centro de costo</dt><dd>${c.cc} · ${esc(c.ccn)}</dd><dt>Cliente</dt><dd>${OPS[c.op]}</dd><dt>Pozo / locación / instalación</dt><dd>${esc(t.yac)} · ${esc(t.pozo)}</dd><dt>Fila del Gantt</dt><dd>${recOf(t.rec).n}</dd><dt>Permiso de la operadora</dt><dd>${t.ptw?'Sí, lo firma el supervisor de '+OPS[c.op]:'No requiere'}</dd><dt>Supervisor</dt><dd>${esc(t.sup)}</dd><dt>Responsable técnico</dt><dd>${esc(t.rt)}</dd></dl>
    <div><div class="lab" style="margin-bottom:8px">Personas · ${t.pers.length}</div><div class="rlist">${resList('p',t.pers,c.op,t.inicio,tEnd(t),t.id,tDays(t))}</div></div>
    <div><div class="lab" style="margin-bottom:8px">Equipos · ${t.eqs.length}</div><div class="rlist">${resList('e',t.eqs,c.op,t.inicio,tEnd(t),t.id,tDays(t))}</div></div>
    <div><div class="lab" style="margin-bottom:8px">Duración</div><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">${canPlan()&&!lockD?`<div class="stepper"><button data-a="t-dias" data-d="-1"${t.dias<=mn?' disabled':''} aria-label="Un día menos">−</button><b>${t.dias} día${t.dias>1?'s':''}</b><button data-a="t-dias" data-d="1"${t.dias>=30?' disabled':''} aria-label="Un día más">+</button></div>`:`<b>${t.dias} día${t.dias>1?'s':''}</b>`}<span class="sm">${fDay(t.inicio)} → ${fDay(tEnd(t))}</span></div>
      ${mn>1&&!lockD&&canPlan()?`<p class="sm" style="margin:6px 0 0">No se puede acortar a menos de ${mn} días: ya hay partes cargados.</p>`:''}${cl.length?`<p class="note e" style="margin:6px 0 0">${ic('alert')}Se superpone con ${cl.map(x=>x.id).join(', ')} en el mismo recurso</p>`:''}</div>
    ${canPlan()?`<div><div class="lab" style="margin-bottom:8px">Prioridad</div><div class="seg">${Object.entries(PRIO).map(([k,l])=>`<button data-a="t-prio" data-p="${k}" aria-pressed="${t.prio===k}">${l}</button>`).join('')}</div></div>`:''}
    <div><div class="lab" style="margin-bottom:8px">Tareas previstas</div><div class="chips">${t.prev.map(x=>`<span class="tag">${esc(x)} · ${unitOf(t.ct,x)}</span>`).join('')}</div></div>
    ${t.ind?`<div><div class="lab" style="margin-bottom:6px">Indicaciones</div><div style="font-size:14px">${esc(t.ind)}</div></div>`:''}
    <div><div class="lab" style="margin-bottom:8px">Partes diarios</div><div class="dlist">${dl}</div></div>
    <div><div class="lab" style="margin-bottom:10px">Historial</div><ol class="tl">${t.hist.map(x=>`<li>${esc(x.a)}<small>${esc(x.who)} · ${esc(x.t)}</small>${x.c?`<q>${esc(x.c)}</q>`:''}</li>`).join('')}</ol></div>
  </div></aside>`;
}
function vList(){
  const f=S.pf;
  const base=S.partes.filter(p=>(S.lop==='all'||p.op===S.lop)&&(S.lct==='all'||p.ct===S.lct)&&(S.lrec==='all'||p.rec===S.lrec)&&(!S.lq||[p.id,p.pl,p.pozo,p.yac,p.imp].join(' ').toLowerCase().includes(S.lq.toLowerCase())));
  const opts=[['all','Todos'],...Object.entries(EST).filter(([k])=>k!=='plan')];
  const n=k=>k==='all'?base.length:base.filter(p=>p.estado===k).length;
  const rows=base.filter(p=>f==='all'||p.estado===f).sort((a,b)=>b.fecha.localeCompare(a.fecha)||b.id.localeCompare(a.id));
  return `<div class="fbar"><div class="fld"><label for="l-op">Cliente</label>${selF('l-op','s:lop',opOpts(),S.lop)}</div><div class="fld wide"><label for="l-ct">Contrato</label>${selF('l-ct','s:lct',ctOpts(S.lop),S.lct)}</div><div class="fld"><label for="l-rec">Recurso</label>${selF('l-rec','s:lrec',[['all','Todos los recursos'],...RECURSOS.map(r=>[r.id,r.n])],S.lrec)}</div><div class="fld wide"><label for="l-q">Buscar</label><input class="inp" type="search" id="l-q" data-bind="s:lq" data-rr value="${esc(S.lq)}" placeholder="Nº de parte, pozo, imputación…"></div></div>
  <div class="filters">${opts.map(([k,l])=>`<button class="chip sm3" data-a="p-filter" data-f="${k}" aria-pressed="${f===k}">${l} <span class="n">${n(k)}</span></button>`).join('')}</div>
  <div class="pnl" style="padding:4px 8px"><div class="scrollx"><table class="tbl"><thead><tr><th>Nº</th><th>Fecha</th><th>Trabajo</th><th>Recurso</th><th>Contrato · imputación</th><th>Pozo / locación</th><th class="num">Horas</th><th>Estado</th></tr></thead><tbody>
  ${rows.map(p=>{const s=sums(p);return `<tr class="click" data-a="sum" data-id="${p.id}"><td class="mono">${p.id}</td><td style="white-space:nowrap">${fDay(p.fecha)}</td><td class="mono" style="white-space:nowrap">${p.pl} <span class="sm">d${p.dia+1}</span>${p.fin==='fin'?` <span class="sm">· cierre</span>`:''}</td><td>${recOf(p.rec).n}</td><td><span class="mono">${p.ct}</span><div class="sm mono">${esc(p.imp||'')}</div></td><td>${esc(p.yac)} · ${esc(p.pozo)}</td><td class="num">${s.jor?fmtH(s.jor):'—'}</td><td>${pill(p.estado)}</td></tr>`}).join('')||`<tr><td colspan="8"><div class="empty">No hay partes con estos filtros.</div></td></tr>`}
  </tbody></table></div></div>`;
}
function vHab(){
  const isP=S.hf==='p';
  let subs=isP?ALLP.slice():Object.keys(EQ);
  if(S.hq)subs=subs.filter(s=>(s+' '+(EQ[s]||'')).toLowerCase().includes(S.hq.toLowerCase()));
  if(S.hbad)subs=subs.filter(s=>Object.keys(OPS).some(op=>{const h=hab(s,op,TODAY);return habBad(h)||h.st==='pronto'}));
  const all=isP?ALLP:Object.keys(EQ);
  const bad=all.reduce((n,s)=>n+Object.keys(OPS).filter(op=>habBad(hab(s,op,TODAY))).length,0);
  return `<div class="fbar"><div class="seg"><button data-a="h-filter" data-f="p" aria-pressed="${isP}">${ic('users')}Personal</button><button data-a="h-filter" data-f="v" aria-pressed="${!isP}">${ic('truck')}Vehículos y equipos</button></div><div class="fld wide"><label for="h-q">Buscar</label><input class="inp" type="search" id="h-q" data-bind="s:hq" data-rr value="${esc(S.hq)}" placeholder="${isP?'Nombre':'Patente o tipo'}"></div><button class="chip sm3" data-a="h-bad" aria-pressed="${S.hbad}">${ic('alert')}Solo vencidas o por vencer</button><span class="sp"></span><span class="note">${ic('alert')}${bad} vencidas o faltantes hoy</span></div>
  <div class="pnl" style="padding:4px 8px"><div class="scrollx"><table class="tbl habtbl"><thead><tr><th>${isP?'Persona':'Equipo'}</th><th>Asignado a</th>${Object.values(OPS).map(o=>`<th>${o}</th>`).join('')}</tr></thead><tbody>
  ${subs.map(s=>`<tr><td><b>${isP?esc(s):`<span class="mono">${s}</span> ${esc(EQ[s])}`}</b></td><td class="sm">${isP?homeOf(s):eqHome(s)}</td>${Object.keys(OPS).map(op=>`<td>${habChip(hab(s,op,TODAY),isAdm()?[s,op]:null,true)}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="5"><div class="empty">Nada coincide con el filtro.</div></td></tr>'}
  </tbody></table></div></div>
  <p class="sm" style="margin-top:12px">Esta tabla la mantiene Seguridad e Higiene${isAdm()?' (como administrador podés editarla)':''}. La app la consulta al planificar y al cargar personas o equipos en el parte: quien no está habilitado para el cliente del contrato no puede figurar como presente.</p>`;
}

/* ---------- modales ---------- */
function openTrab(rec,d,editId){
  if(editId){const t=trab(editId);UI.modal={kind:'trab',edit:editId,f:{ct:t.ct,imp:t.imp,yac:t.yac,pozo:t.pozo,inicio:t.inicio,dias:t.dias,prio:t.prio,ptw:t.ptw,rec:t.rec,sup:t.sup,rt:t.rt,prev:t.prev.slice(),ind:t.ind,pers:t.pers.slice(),eqs:t.eqs.slice()},err:{}};render();return}
  let ct=Object.keys(S.contratos).find(k=>(!rec||CT(k).recs.includes(rec))&&(S.fct==='all'||k===S.fct)&&(S.fop==='all'||CT(k).op===S.fop))||Object.keys(S.contratos)[0];
  const c=CT(ct);const r=rec&&c.recs.includes(rec)?rec:c.recs[0];
  UI.modal={kind:'trab',f:{ct,imp:c.imps[0][0],yac:c.yacs[0],pozo:'',inicio:d&&d>=TODAY?d:TODAY,dias:3,prio:'media',ptw:true,rec:r,sup:SUPS[0],rt:RTS[0],prev:[],ind:'',pers:CREW[r].slice(),eqs:VEH[r].slice()},err:{}};
  UI.drawer=null;render();
}
function modal(){
  const M=UI.modal;
  if(M.kind==='sent'){const p=byId(M.id),t=trab(p.pl);const extra=p.fin==='fin'?`<br><b>Trabajo ${p.pl} cerrado</b>${t&&t.cierre&&t.cierre.anticipado?' antes de lo planificado: la cuadrilla queda libre desde mañana.':'.'}`:p.fin==='ext'?`<br><b>Pedido de ${p.ext.dias} día${p.ext.dias>1?'s':''} más</b> enviado a planificación.`:'';
    return `<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="sent-h" style="width:560px"><div class="done"><div class="big">${ic(S.offline?'cloud':'check')}</div><h2 id="sent-h">Parte listo para aprobación local</h2><p>${S.offline?`<span class="mono">${p.id}</span> queda pendiente de envío al servidor cuando se conecte la base de datos.`:`<span class="mono">${p.id}</span> queda disponible para planificación en este dispositivo. Después pasa a certificación de ${OPS[p.op]}.`}${extra}</p><button class="btn pri lg" data-a="sent-ok">Volver a mi jornada</button></div></div></div>`}
  if(M.kind==='sum'){const p=byId(M.id);
    const adm=isAdm()?`<div class="admbar">${ic('cog')}<b>Administración</b><label for="adm-est" class="sm">Estado</label><select class="inp" id="adm-est" data-bind="u:admEst">${Object.entries(EST).map(([k,l])=>`<option value="${k}"${(UI.admEst||p.estado)===k?' selected':''}>${l}</option>`).join('')}</select><button class="btn sm2" data-a="a-est" data-id="${p.id}">Aplicar estado</button><span style="flex:1"></span>${p.ejec?`<button class="btn sm2" data-a="a-edit" data-id="${p.id}">${ic('edit')}Editar parte</button>`:''}</div>`:'';
    return `<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="sum-h"><div class="mh"><h2 id="sum-h">Resumen del parte ${p.id}</h2><button class="ibtn" data-a="modal-close" aria-label="Cerrar">${ic('x')}</button></div><div style="overflow:auto;padding:18px 22px" data-keep="s">${adm}${sumHtml(p)}</div><div class="mf"><span class="note">${ic('pdf')}Incluye datos, clima, permiso, personal, equipos, tareas y tiempos, firmas e historial</span><button class="btn" data-a="modal-close">Cerrar</button><button class="btn pri" data-a="pdf" data-id="${p.id}">${ic('pdf')}Descargar PDF</button></div></div></div>`}
  if(M.kind==='hab'){const f=M.f;return `<div class="scrim"><form class="modal" id="habf" role="dialog" aria-modal="true" aria-labelledby="hab-h" style="width:520px" novalidate><div class="mh"><h2 id="hab-h">Habilitación</h2><button type="button" class="ibtn" data-a="modal-close" aria-label="Cerrar">${ic('x')}</button></div>
    <div class="mb" style="grid-template-columns:1fr"><dl class="kv"><dt>Sujeto</dt><dd>${esc(f.s)}${EQ[f.s]?' · '+esc(EQ[f.s]):''}</dd><dt>Cliente</dt><dd>${OPS[f.op]}</dd></dl>
    <div class="fld"><span class="lab">Estado</span><div class="seg"><button type="button" data-a="h-sin" data-v="0" aria-pressed="${!f.sin}">Habilitado</button><button type="button" data-a="h-sin" data-v="1" aria-pressed="${f.sin}">Sin habilitación</button></div></div>
    ${f.sin?'':`<div class="fld"><label for="h-v">Vence el</label><input class="inp" type="date" id="h-v" data-bind="m:vence" value="${esc(f.vence)}"></div>`}</div>
    <div class="mf"><button type="button" class="btn" data-a="modal-close">Cancelar</button><button type="submit" class="btn pri">Guardar</button></div></form></div>`}
  const f=M.f,E=M.err,c=CT(f.ct),ed=M.edit?trab(M.edit):null,lockCt=ed&&started(ed);
  const days=Array.from({length:f.dias},(_,i)=>addDays(f.inicio,i)),endD=days[days.length-1];
  const conflict=S.trabajos.filter(t=>t.id!==M.edit&&t.rec===f.rec&&days.some(x=>covers(t,x)));
  const sel=(id,bind,opts,cur,dis)=>selF(id,'m:'+bind,opts,cur,dis?' disabled':'');
  const nbP=f.pers.filter(s=>habBad(habSpan(s,c.op,f.inicio,endD))).length,nbE=f.eqs.filter(s=>habBad(habSpan(s,c.op,f.inicio,endD))).length;
  const starts=Array.from({length:28},(_,i)=>addDays(TODAY,i));if(ed&&!starts.includes(f.inicio))starts.unshift(f.inicio);
  const addP=ALLP.filter(n=>!f.pers.includes(n)),addE=Object.keys(EQ).filter(x=>!f.eqs.includes(x));
  return `<div class="scrim"><form class="modal" id="trabf" role="dialog" aria-modal="true" aria-labelledby="new-h" novalidate>
  <div class="mh"><h2 id="new-h">${ed?'Editar '+ed.id:'Nueva planificación'}</h2><button type="button" class="ibtn" data-a="modal-close" aria-label="Cerrar">${ic('x')}</button></div>
  <div class="mb" data-keep="m">
    <div class="fld"><label for="m-ct">Contrato</label>${sel('m-ct','ct',Object.entries(S.contratos).map(([k,v])=>[k,`${k} · ${v.n}`]),f.ct,lockCt)}</div>
    <div class="fld"><label for="m-imp">Imputación de cuenta del cliente</label>${sel('m-imp','imp',c.imps.map(([k,n])=>[k,`${k} · ${n}`]),f.imp)}</div>
    <div class="ctbox"><div><span>Cliente</span>${OPS[c.op]}</div><div><span>Centro de costo</span>${c.cc} · ${esc(c.ccn)}</div><div><span>Imputaciones del contrato</span>${c.imps.length}</div></div>
    ${lockCt?'<p class="sm fld full" style="margin:0">El contrato y la fila del Gantt no se cambian porque ya hay partes cargados.</p>':''}
    <div class="fld"><label for="m-yac">Yacimiento</label>${sel('m-yac','yac',c.yacs.map(y=>[y,y]),f.yac)}</div>
    <div class="fld"><label for="m-pozo">Pozo / Locación / Instalación</label><input class="inp${E.pozo?' bad':''}" id="m-pozo" data-bind="m:pozo" value="${esc(f.pozo)}" placeholder="ej. ET-1131 · Batería 3 · Planta de inyección">${E.pozo?`<span class="ferr">${E.pozo}</span>`:''}</div>
    <div class="fld"><label for="m-inicio">Inicio</label>${sel('m-inicio','inicio',starts.map(d=>[d,fDay(d)+(d===TODAY?' (hoy)':'')]),f.inicio,lockCt)}</div>
    <div class="fld"><span class="lab">Duración estimada</span><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><div class="stepper"><button type="button" data-a="m-dias" data-d="-1"${f.dias<=(ed?minDias(ed):1)?' disabled':''} aria-label="Un día menos">−</button><b>${f.dias} día${f.dias>1?'s':''}</b><button type="button" data-a="m-dias" data-d="1" aria-label="Un día más">+</button></div><span class="sm">hasta ${fDay(endD)}</span></div></div>
    <div class="fld"><label for="m-rec">Cuadrilla o equipo base</label>${sel('m-rec','rec',c.recs.map(r=>[r,`${recOf(r).n} · ${jefeOf(r)}`]),f.rec,lockCt)}<span class="sm">Define la fila del Gantt y propone personas y equipos.</span></div>
    <div class="fld"><span class="lab">¿Requiere permiso de trabajo de la operadora?</span><div class="seg"><button type="button" data-a="m-ptw" data-v="1" aria-pressed="${f.ptw}">${ic('sign')}Sí, firma el supervisor</button><button type="button" data-a="m-ptw" data-v="0" aria-pressed="${!f.ptw}">No requiere</button></div></div>
    <div class="rsel">
      <div class="rbox"><div class="hh">${ic('users')}Personas · ${f.pers.length}<span class="sp"></span>${nbP?`<span class="hab h-venc">${nbP} sin habilitación</span>`:`<span class="hab h-ok">${ic('check')}Todos habilitados</span>`}</div><div class="rlist">${resList('p',f.pers,c.op,f.inicio,endD,M.edit,days,'m-pdel')}</div>${E.pers?`<div class="ferr" style="padding:6px 12px 0">${E.pers}</div>`:''}<div class="addz">${addP.map(n=>{const h=habSpan(n,c.op,f.inicio,endD);return `<button type="button" class="chip add sm3" data-a="m-padd" data-n="${esc(n)}" title="${habTxt(h)}">${ic('plus')}${esc(n)}${habBad(h)?` <span class="hab h-venc">${ic('x')}</span>`:''}</button>`}).join('')}</div></div>
      <div class="rbox"><div class="hh">${ic('truck')}Equipos · ${f.eqs.length}<span class="sp"></span>${nbE?`<span class="hab h-venc">${nbE} sin habilitación</span>`:`<span class="hab h-ok">${ic('check')}Todos habilitados</span>`}</div><div class="rlist">${resList('e',f.eqs,c.op,f.inicio,endD,M.edit,days,'m-edel')}</div><div class="addz">${addE.map(x=>{const h=habSpan(x,c.op,f.inicio,endD);return `<button type="button" class="chip add sm3" data-a="m-eadd" data-n="${x}" title="${esc(EQ[x])} · ${habTxt(h)}">${ic('plus')}${x}${habBad(h)?` <span class="hab h-venc">${ic('x')}</span>`:''}</button>`}).join('')}</div></div>
    </div>
    <div class="fld full"><span class="lab">Prioridad</span><div class="seg">${Object.entries(PRIO).map(([k,l])=>`<button type="button" data-a="m-prio" data-p="${k}" aria-pressed="${f.prio===k}"><span class="gpr" style="--pc:${PRIO_C[k]}"></span>${l}</button>`).join('')}</div></div>
    <div class="fld"><label for="m-sup">Supervisor responsable</label>${sel('m-sup','sup',SUPS.map(v=>[v,v]),f.sup)}</div>
    <div class="fld"><label for="m-rt">Responsable técnico</label>${sel('m-rt','rt',RTS.map(v=>[v,v]),f.rt)}</div>
    <div class="fld full"><span class="lab">Tareas previstas · catálogo del contrato</span><div class="chips">${c.tareas.map(([t,u])=>`<button type="button" class="chip" data-a="m-tarea" data-t="${esc(t)}" aria-pressed="${f.prev.includes(t)}">${f.prev.includes(t)?ic('check'):''}${esc(t)} <span class="n">${u}</span></button>`).join('')}</div>${E.prev?`<span class="ferr">${E.prev}</span>`:''}</div>
    <div class="fld full"><label for="m-ind">Indicaciones para la cuadrilla</label><textarea class="inp" id="m-ind" data-bind="m:ind" rows="2" placeholder="Accesos, contacto de la operadora, riesgos de la instalación…">${esc(f.ind)}</textarea></div>
  </div>
  <div class="mf">${conflict.length?`<span class="note w">${ic('alert')}${recOf(f.rec).n} ya está ocupado: ${conflict.map(x=>x.id).join(', ')}</span>`:`<span class="note">${ic('users')}${f.pers.length} personas · ${f.eqs.length} equipos</span>`}
    <button type="button" class="btn" data-a="modal-close">Cancelar</button><button type="submit" class="btn pri">${ed?'Guardar cambios':'Crear planificación'}</button></div>
  </form></div>`;
}
function sigSvg(f){return f==='seed'?`<svg viewBox="0 0 300 90" aria-label="Firma"><path d="M20 60 C 40 20, 60 20, 62 52 S 90 80, 104 40 C 112 18, 128 24, 122 58 C 118 78, 150 30, 170 44 S 210 70, 228 36 C 236 22, 250 30, 280 40" fill="none" style="stroke:var(--ink)" stroke-width="2.4" stroke-linecap="round"/></svg>`:f?`<img src="${f}" alt="Firma">`:'<span class="sm">Sin firma</span>'}
function finTxt(p){return p.fin==='fin'?'Trabajo terminado':p.fin==='ext'?`Pidió ${p.ext?p.ext.dias:1} día(s) más`:'Continúa al día siguiente'}
function sumHtml(p){
  const e=p.ejec,t=trab(p.pl),c=CT(p.ct),s=sums(p);
  if(!e)return '<div class="empty">Este día todavía no tiene parte cargado.</div>';
  const cl=e.clima,w=e.permiso;
  return `<div class="docp"><div class="dband"><div><b>VIENTOS DEL SUR</b><small>Parte diario de servicio</small></div><div class="r"><b style="font-family:var(--f-mono);letter-spacing:0">${p.id}</b><small>${fDayL(p.fecha)} · ${EST[p.estado]}</small></div></div>
  <div class="dsec"><h4>Datos del servicio</h4><div class="dkv"><div><span>Contrato</span>${p.ct}</div><div><span>Imputación</span>${esc(p.imp||'—')}</div><div><span>Centro de costo</span>${p.cc}</div><div><span>Cliente</span>${OPS[p.op]}</div><div><span>Pozo / locación</span>${esc(p.yac)} · ${esc(p.pozo)}</div><div><span>Recurso</span>${recOf(p.rec).n}</div><div><span>Trabajo</span>${p.pl} · día ${p.dia+1} de ${t?t.dias:'—'}</div><div><span>Prioridad</span>${PRIO[p.prio]}</div><div><span>Llegada a instalación</span>${e.llegada||'—'}</div><div><span>Supervisor responsable</span>${esc(p.sup)||'—'}</div><div><span>Responsable técnico</span>${esc(p.rt)||'—'}</div><div><span>Al cierre del día</span>${finTxt(p)}</div></div></div>
  <div class="dsec"><h4>Clima, permiso y seguridad</h4><div class="dkv"><div><span>Temperatura</span>${cl&&cl.t!==''?cl.t+' °C':'—'}</div><div><span>Viento / ráfagas</span>${cl?`${cl.v||'—'} / ${cl.r||'—'} km/h ${cl.dir}`:'—'}</div><div><span>Condición</span>${cl?cl.cond:'—'}</div><div><span>Checklist</span>${e.check.charla&&e.check.epp?'Completo':'Incompleto'}</div><div><span>Permiso operadora</span>${p.ptw?(w&&w.num?esc(w.num):'Falta'):'No requiere'}</div><div><span>Firmó</span>${p.ptw&&w&&w.firmo?esc(w.firmo)+' · '+esc(w.hora):'—'}</div></div></div>
  <div class="dsec"><h4>Personal · ${s.pers} presentes · ${fmtH(s.hh)} hombre</h4><div class="scrollx"><table class="tbl"><thead><tr><th>Persona</th><th>Rol</th><th class="num">Ingreso base</th><th class="num">Llegada zona</th><th class="num">Salida</th><th class="num">Horas</th><th>Habilitación</th></tr></thead><tbody>${e.personal.map(x=>`<tr><td>${esc(x.n)}</td><td>${esc(x.rol)}</td><td class="num">${x.pres?x.base||'—':'Ausente'}</td><td class="num">${x.pres?x.zona||'—':''}</td><td class="num">${x.pres?x.out||'—':''}</td><td class="num">${x.pres&&x.base&&x.out?fmtH(dur(x.base,x.out)):'—'}</td><td>${habTxt(hab(x.n,p.op,p.fecha))}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="dsec"><h4>Equipos · ${num(s.km)} km</h4><table class="tbl"><thead><tr><th>Equipo</th><th class="num">Km actual</th><th class="num">Recorrido</th><th>Observación</th><th>Habilitación</th></tr></thead><tbody>${e.equipos.map(q=>{const pk=lastKm(q.c,p);return `<tr><td>${q.c} ${esc(EQ[q.c])}</td><td class="num">${q.km===''?'—':num(q.km)}</td><td class="num">${q.km!==''&&pk!==null?num(q.km-pk)+' km':'—'}</td><td>${esc(q.obs)||'—'}</td><td>${habTxt(hab(q.c,p.op,p.fecha))}</td></tr>`}).join('')}</tbody></table></div>
  <div class="dsec"><h4>Producción del día</h4><table class="tbl"><thead><tr><th>Tarea</th><th class="num">Cantidad</th><th>Unidad</th></tr></thead><tbody>${prod(p).map(x=>`<tr><td>${esc(x.d)}${inCat(p.ct,x.d)?'':' <span class="sm">(fuera de catálogo)</span>'}</td><td class="num">${x.q?num(x.q):'—'}</td><td>${esc(x.u)}</td></tr>`).join('')||'<tr><td colspan="3">Sin tareas</td></tr>'}</tbody></table></div>
  <div class="dsec"><h4>Tareas y tiempos · ${fmtH(s.jor)}</h4><table class="tbl"><thead><tr><th class="num">Desde</th><th class="num">Hasta</th><th>Categoría</th><th>Tarea / detalle</th><th class="num">Cantidad</th></tr></thead><tbody>${e.reg.slice().sort((a,b)=>mins(a.de)-mins(b.de)).map(x=>`<tr><td class="num">${x.de}</td><td class="num">${x.a}</td><td style="white-space:nowrap"><span class="cdot c-${x.c}"></span>${TCAT[x.c]}</td><td>${esc(x.d)||'—'}${x.det?` <span class="sm">· ${esc(x.det)}</span>`:''}</td><td class="num">${regQ(x)}</td></tr>`).join('')}</tbody></table></div>
  <div class="dsec"><h4>Observaciones</h4><p style="margin:0 0 10px;font-size:13.5px">${e.obs?esc(e.obs):'Sin observaciones.'}</p>${p.fin==='fin'&&p.cierreObs?`<p style="margin:0 0 10px;font-size:13.5px"><b>Cierre del trabajo:</b> ${esc(p.cierreObs)}</p>`:''}${p.fin==='ext'&&p.ext?`<p style="margin:0 0 10px;font-size:13.5px"><b>Pedido de extensión:</b> ${esc(p.ext.motivo)}</p>`:''}</div>
  <div class="dsec"><h4>Firmas y aprobaciones</h4><div class="dsign"><div><div class="sv">${sigSvg(e.firma)}</div><b>${esc(jefeP(p))}</b><span class="sm">Jefe de cuadrilla</span></div><div><div class="sv">${p.dec&&p.dec.d==='ok'?ic('okc'):''}</div><b>${p.dec&&p.dec.d==='ok'?esc(p.dec.who):'Pendiente'}</b><span class="sm">Aprobación VDS${p.dec&&p.dec.d==='ok'?' · '+esc(p.dec.t):''}</span></div><div><div class="sv">${p.cert?sigSvg(p.cert.firma):''}</div><b>${p.cert?esc(p.cert.who):'Pendiente'}</b><span class="sm">Certificación ${OPS[p.op]}${p.cert?' · '+esc(p.cert.t):''}</span></div></div></div>
  </div>`;
}

/* ---------- operador ---------- */
function baselineDay(){
  const R=USERS.operador.rec;
  const obs=S.partes.filter(p=>p.rec===R&&p.estado==='obs');
  const hoy=S.trabajos.filter(t=>t.rec===R&&covers(t,TODAY)&&!t.cierre).map(t=>({t,p:parteOf(t.id,TODAY)})).filter(x=>!x.p||x.p.estado==='curso');
  const prox=S.trabajos.filter(t=>t.rec===R&&t.inicio>TODAY).sort((a,b)=>a.inicio.localeCompare(b.inicio));
  const env=S.partes.filter(p=>p.rec===R&&['env','apr','cert'].includes(p.estado)).sort((a,b)=>b.fecha.localeCompare(a.fecha)).slice(0,4);
  const meta=(x)=>`<div class="meta"><span>${ic('pin')}${esc(x.yac)} · ${esc(x.pozo)}</span><span>${OPS[CT(x.ct).op]} · <span class="mono">${x.ct}</span></span><span>${ic('users')}${(x.pers||[]).length} personas · ${(x.eqs||[]).join(', ')}</span></div>`;
  let h=`<div class="hello"><div><h2>Buen día, ${esc(meN().split(' ')[0])}</h2><p>${esc(recOf(R).n)} · base Comodoro Rivadavia</p></div></div>`;
  if(obs.length)h+=`<section class="sect"><h3 style="color:var(--st-obs)">${ic('alert')}Para corregir</h3><div class="cards">${obs.map(p=>`<div class="tcard obs"><div><div class="t1"><span class="mono">${p.id}</span>${pill(p.estado)}<span class="sm">${fDay(p.fecha)}</span></div><h4>${p.prev.map(esc).join(' · ')}</h4>${meta(p)}</div><div><button class="btn pri lg" data-a="o-open" data-id="${p.id}">Corregir parte</button></div>${p.dec?`<div class="vnote">${ic('back')}<div><b>Observado por ${esc(p.dec.who)} · ${esc(p.dec.t)}</b>${esc(p.dec.com)}</div></div>`:''}</div>`).join('')}</div></section>`;
  h+=`<section class="sect"><h3>Hoy · ${fDayL(TODAY)}</h3><div class="cards">${hoy.map(({t,p})=>{const i=diffD(t.inicio,TODAY);const last=i===t.dias-1;
    const act=p?`<button class="btn pri lg" data-a="o-open" data-id="${p.id}">Continuar ${ic('right')}</button>`:`<button class="btn pri lg" data-a="o-start" data-pl="${t.id}">Iniciar parte</button>`;
    return `<div class="tcard${p?' cur':''}"><div><div class="t1">${p?`<span class="mono">${p.id}</span>`:''}${pill(p?p.estado:'plan')}${prioB(t.prio)}${ptTag(t.ptw)}<span class="tag">${t.id} · día ${i+1} de ${t.dias}${last?' · último':''}</span></div><h4>${t.prev.map(esc).join(' · ')}</h4>${meta(t)}</div><div>${act}</div>${p?`<div class="prog" aria-label="Avance del parte">${STEPS.map((s,k)=>`<i class="${stepOk(p,k)?'on':''}" title="${s}"></i>`).join('')}</div>`:''}${t.ind?`<div class="vnote n">${ic('pin')}<div>${esc(t.ind)}</div></div>`:''}${t.ext?`<div class="vnote n">${ic('flag')}<div>Pediste ${t.ext.dias} día(s) más · esperando aprobación de planificación</div></div>`:''}</div>`}).join('')||'<div class="empty">No tenés trabajo pendiente para hoy.</div>'}</div></section>`;
  h+=`<section class="sect"><h3>Próximos trabajos</h3><div class="cards two">${prox.map(t=>`<div class="tcard mini"><div><div class="t1"><span class="mono">${t.id}</span>${prioB(t.prio)}${ptTag(t.ptw)}</div><div class="sm" style="margin-top:4px">${fDay(t.inicio)} → ${fDay(tEnd(t))} · ${t.dias} días</div><h4>${t.prev.map(esc).join(' · ')}</h4>${meta(t)}</div></div>`).join('')||'<div class="empty">Sin planificación cargada.</div>'}</div></section>`;
  h+=`<section class="sect"><h3>Enviados</h3><div class="cards two">${env.map(p=>`<div class="tcard mini"><div><div class="t1"><span class="mono">${p.id}</span>${pill(p.estado)}${p.fin==='fin'?`<span class="tag">${ic('flag')}Cierre</span>`:''}${p.cola?`<span class="flag warn">${ic('nowifi')}En cola</span>`:''}<span class="sm">${fDay(p.fecha)}</span></div><h4>${esc(p.yac)} · ${esc(p.pozo)}</h4></div><div><button class="btn sm2" data-a="sum" data-id="${p.id}">${ic('doc')}Resumen</button></div></div>`).join('')||'<div class="empty">Todavía no enviaste partes.</div>'}</div></section>`;
  return h;
}
const tin=(bind,v,dis,lab)=>`<input type="time" class="inp" id="f-${bind.replace(/[^a-z0-9]/gi,'-')}" data-bind="${bind}" data-rr value="${esc(v)}"${dis?' disabled':''} aria-label="${esc(lab||'Hora')}">`;
function vEdit(){
  const p=cur(),st=S.step,e=p.ejec;
  const body=[stInicio,stPersonal,stEquipos,stReg,stCierre][st](p,e);
  const ban=p.estado==='obs'&&p.dec?`<div class="banner">${ic('back')}<div><b>Devuelto por ${esc(p.dec.who)} · ${esc(p.dec.t)}</b>${esc(p.dec.com)}</div></div>`:'';
  const admEdit=isAdm()&&!['curso','obs'].includes(p.estado);
  const er=errs(p).length;
  const last=admEdit?`<button class="btn pri lg" data-a="a-save">${ic('check')}Guardar cambios</button>`:`<button class="btn pri lg" data-a="o-send"${er?' disabled':''}>${ic('send')}${p.estado==='obs'?'Reenviar corregido':p.fin==='fin'?'Enviar y cerrar trabajo':'Enviar para aprobación'}</button>`;
  return `<div class="edhead"><div class="meta"><span>Contrato <b class="mono">${p.ct}</b></span><span>Imputación <b class="mono">${esc(p.imp||'—')}</b></span><span>Cliente <b>${OPS[p.op]}</b></span><span>Pozo / locación <b>${esc(p.yac)} · ${esc(p.pozo)}</b></span><span>Supervisor <b>${esc(p.sup)}</b></span>${admEdit?'<span><b style="color:var(--accent)">Edición de administración</b></span>':''}</div></div>
  ${features?.contextLinks(p.pl)||''}<nav class="steps" aria-label="Secciones del parte">${STEPS.map((s,i)=>`<button class="stp${stepOk(p,i)&&i!==st?' ok':''}" data-a="o-step" data-i="${i}"${i===st?' aria-current="step"':''}><i>${stepOk(p,i)&&i!==st?ic('check'):i+1}</i>${s}</button>`).join('')}</nav>
  <div class="edbody" data-keep="e">${ban}${body}</div>
  <div class="edfoot"><span class="saved${S.offline?' off':''}">${ic(S.offline?'nowifi':'cloud')}${S.offline?'Guardado en la tablet · pendiente de conexión con la base de datos':'Guardado automático'}</span>
    ${st>0?`<button class="btn lg" data-a="o-step" data-i="${st-1}">${ic('left')}${STEPS[st-1]}</button>`:''}
    ${st<4?`<button class="btn pri lg" data-a="o-step" data-i="${st+1}">${STEPS[st+1]} ${ic('right')}</button>`:last}
  </div>`;
}
function stInicio(p,e){
  const tg=(k,t,s)=>`<button class="tog" data-a="o-check" data-k="${k}" aria-pressed="${e.check[k]}"><span class="bx">${ic('check')}</span><span>${t}<small>${s}</small></span></button>`;
  const cl=e.clima||{t:'',v:'',r:'',dir:'O',cond:'Despejado',src:''};
  const t=trab(p.pl),w=e.permiso||{num:'',firmo:'',hora:''};
  return `<div class="grid2">
  <div class="stack">
    <div class="pnl"><h3>Lo planificado<span class="sp"></span>${prioB(p.prio)}</h3><dl class="kv"><dt>Servicio</dt><dd>${esc(CT(p.ct).n)}</dd><dt>Imputación</dt><dd><span class="mono">${esc(p.imp||'—')}</span><div class="sm">${esc(impN(p.ct,p.imp))}</div></dd><dt>Trabajo</dt><dd><span class="mono">${p.pl}</span> · día ${p.dia+1} de ${t.dias} (${fDay(t.inicio)} → ${fDay(tEnd(t))})</dd><dt>Pozo / locación</dt><dd>${esc(p.yac)} · ${esc(p.pozo)}</dd><dt>Tareas</dt><dd>${p.prev.map(x=>esc(x)+' <span class="sm">'+unitOf(p.ct,x)+'</span>').join('<br>')}</dd>${p.ind?`<dt>Indicaciones</dt><dd>${esc(p.ind)}</dd>`:''}<dt>Responsable técnico</dt><dd>${esc(p.rt)}</dd></dl></div>
    <div class="pnl"><h3>Llegada a la instalación</h3><div class="fld"><label for="f-e-llegada">Hora de llegada a la instalación</label>${tin('e:llegada',e.llegada,false,'Hora de llegada a la instalación')}</div></div>
    <div class="pnl"><h3>${ic('sign')}Permiso de trabajo de la operadora</h3>${p.ptw?`
      <div class="permit"><div class="fld"><label for="pt-n">Nº de permiso</label><input class="inp" id="pt-n" data-bind="e:permiso.num" data-rr value="${esc(w.num)}" placeholder="PT-…"></div><div class="fld"><label for="pt-f">Firmó</label><input class="inp" id="pt-f" data-bind="e:permiso.firmo" data-rr value="${esc(w.firmo)}" placeholder="${esc(OPSUP[p.op])}"></div><div class="fld"><label for="f-e-permiso-hora">Hora de firma</label>${tin('e:permiso.hora',w.hora,false,'Hora de firma')}</div></div>
      <div class="csrc">${w.num&&w.firmo&&w.hora?`<span class="hab h-ok">${ic('check')}Permiso firmado</span>`:`<span class="hab h-venc">${ic('x')}Falta la firma</span><span>No empieces hasta que firme el supervisor de ${OPS[p.op]}.</span>`}<span class="sp"></span><button class="btn sm2" data-a="o-ptnow">Firmado ahora</button></div>`
      :`<p class="sm" style="margin:0">Este trabajo no requiere permiso de la operadora.</p>`}</div>
  </div>
  <div class="stack">
    <div class="pnl"><h3>${ic('sun')}Condiciones climáticas</h3>
      <div class="clima">
        <div class="fld"><label for="c-t" title="Temperatura">Temp. °C</label><input class="inp" type="number" id="c-t" data-bind="e:clima.t" data-rr value="${esc(cl.t)}"></div>
        <div class="fld"><label for="c-v" title="Viento km/h">Viento</label><input class="inp" type="number" id="c-v" data-bind="e:clima.v" data-rr value="${esc(cl.v)}"></div>
        <div class="fld"><label for="c-r" title="Ráfagas km/h">Ráfagas</label><input class="inp${Number(cl.r)>=60?' bad':''}" type="number" id="c-r" data-bind="e:clima.r" data-rr value="${esc(cl.r)}"></div>
        <div class="fld"><label for="c-d">Dirección</label><select class="inp" id="c-d" data-bind="e:clima.dir" data-rr>${DIRS.map(d=>`<option${cl.dir===d?' selected':''}>${d}</option>`).join('')}</select></div>
        <div class="fld"><label for="c-c">Condición</label><select class="inp" id="c-c" data-bind="e:clima.cond" data-rr>${CONDS.map(d=>`<option${cl.cond===d?' selected':''}>${d}</option>`).join('')}</select></div>
      </div>
      <div class="csrc"><span>Viento y ráfagas en km/h.</span>${e.clima&&e.clima.src==='app'?`<span>${ic('cloud')}</span><span>Tomado de la app de clima · ${esc(e.clima.at||'')}</span>`:e.clima?'<span>Cargado a mano</span>':''}<span class="sp"></span><button class="btn sm2" data-a="o-clima">${ic('wind')}Tomar de la app de clima</button></div>
      ${Number(cl.r)>=60?`<div class="windhint" style="margin-top:10px">${ic('wind')}<div>Ráfagas sobre 60 km/h: suspender izajes y trabajos en altura y registrar la parada por viento en Tareas y tiempos.</div></div>`:''}
    </div>
    <div class="pnl"><h3>Antes de empezar</h3><div class="togs">${tg('charla','Charla de seguridad de 5 minutos','Con todo el personal presente')}${tg('epp','EPP verificado','Casco, anteojos, guantes, calzado y ropa ignífuga')}</div></div>
  </div></div>`;
}
function stPersonal(p,e){
  const used=new Set(e.personal.map(x=>x.n));
  const rows=e.personal.map((x,i)=>{const d=x.base&&x.out?dur(x.base,x.out):0,z=x.zona&&x.out?dur(x.zona,x.out):0,h=hab(x.n,p.op,p.fecha);
    return `<tr class="${x.pres?'':'off'}"><td><button class="sw" role="switch" aria-checked="${x.pres}" aria-label="Presente: ${esc(x.n)}" data-a="o-pres" data-i="${i}"><span></span></button></td>
    <td><b>${esc(x.n)}</b><div class="sm">${esc(x.rol)}${x.add?' · reemplazo':''}</div><div style="margin-top:4px">${habChip(h)}</div></td><td style="width:128px">${tin(`e:personal.${i}.base`,x.base,!x.pres,'Ingreso a base de '+x.n)}</td><td style="width:128px">${tin(`e:personal.${i}.zona`,x.zona,!x.pres,'Llegada a zona de '+x.n)}</td><td style="width:128px">${tin(`e:personal.${i}.out`,x.out,!x.pres,'Salida de '+x.n)}</td>
    <td class="num ${d>720?'warn':''}">${!x.pres?'Ausente':d?fmtH(d):'—'}${x.pres&&z?`<div class="sm">${fmtH(z)} en zona</div>`:''}</td><td style="width:44px">${x.add?`<button class="ibtn del" data-a="o-delp" data-i="${i}" aria-label="Quitar ${esc(x.n)}">${ic('trash')}</button>`:''}</td></tr>`}).join('');
  const s=sums(p);
  return `<div class="pnl"><h3>Personal<span class="sp"></span><span class="sm">${s.pers} presentes · ${fmtH(s.hh)} hombre · ${fmtH(s.hz)} en zona</span></h3>
  <div class="scrollx"><table class="tbl"><thead><tr><th>Presente</th><th>Persona y habilitación ${OPS[p.op]}</th><th>Ingreso a base</th><th>Llegada a zona</th><th>Salida</th><th class="num">Horas</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="regadd"><button class="btn sm2" data-a="o-allz">${ic('clock')}Copiar horarios del primero a todos</button></div></div>
  <div class="pnl"><h3>Sumar reemplazo</h3><div class="chips">${ALLP.filter(n=>!used.has(n)).map(n=>{const h=hab(n,p.op,p.fecha);return `<button class="chip add" data-a="o-addp" data-n="${esc(n)}">${ic('plus')}${esc(n)} ${habChip(h)}</button>`}).join('')}</div>
  <p class="sm" style="margin:10px 0 0">Las horas se cuentan desde el ingreso a base. Si alguien no está habilitado para ${OPS[p.op]}, marcalo ausente y sumá un reemplazo.</p></div>`;
}
function stEquipos(p,e){
  const used=new Set(e.equipos.map(q=>q.c));
  const rows=e.equipos.map((q,i)=>{const pk=lastKm(q.c,p);const d=q.km!==''&&pk!==null?Number(q.km)-pk:null;
    return `<tr><td><b class="mono">${q.c}</b> ${esc(EQ[q.c])}<div style="margin-top:4px">${habChip(hab(q.c,p.op,p.fecha))}</div></td><td style="width:160px"><input class="inp${d!=null&&d<0?' soft':''}" type="number" inputmode="numeric" id="f-eq${i}" data-bind="e:equipos.${i}.km" data-rr value="${esc(q.km)}" placeholder="${pk!==null?num(pk):''}" aria-label="Km actual ${q.c}"><div class="sm" style="margin-top:3px">Último: ${pk!==null?num(pk):'—'}</div></td><td class="num ${d!=null&&d<0?'warn':''}">${d==null?'—':num(d)+' km'}</td><td><input class="inp" id="f-eqo${i}" data-bind="e:equipos.${i}.obs" value="${esc(q.obs)}" placeholder="Fallas, combustible, novedades…" aria-label="Observación ${q.c}"></td><td style="width:44px"><button class="ibtn del" data-a="o-dele" data-i="${i}" aria-label="Quitar ${q.c}">${ic('trash')}</button></td></tr>`}).join('');
  return `<div class="pnl"><h3>Equipos y vehículos<span class="sp"></span><span class="sm">${num(sums(p).km)} km desde el último registro</span></h3>
  <div class="scrollx"><table class="tbl"><thead><tr><th>Equipo y habilitación</th><th>Km / horómetro actual</th><th class="num">Recorrido</th><th>Observación</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5"><div class="empty">Agregá al menos un equipo.</div></td></tr>'}</tbody></table></div>
  <p class="sm" style="margin:10px 0 0">Cargá solo el km actual: el recorrido se calcula contra el último parte de ese equipo.</p></div>
  <div class="pnl"><h3>Agregar equipo</h3><div class="chips">${Object.keys(EQ).filter(c=>!used.has(c)).map(c=>`<button class="chip add" data-a="o-adde" data-c="${c}">${ic('plus')}${c} ${esc(EQ[c])} ${habChip(hab(c,p.op,p.fecha))}</button>`).join('')}</div></div>`;
}
function tbar(p){
  const e=p.ejec,W=SHW;
  const segs=e.reg.map(t=>{const o=dur(SH0,t.de),w=dur(t.de,t.a);if(o>=W||!w)return '';const ww=Math.min(w,W-o);
    return `<div class="tseg c-${t.c}" style="left:${o/W*100}%;width:${ww/W*100}%" title="${TCAT[t.c]} ${t.de}–${t.a}${t.d?' · '+esc(t.d):''}${regQ(t)?' · '+regQ(t):''}"></div>`}).join('');
  const ticks=[0,2,4,6,8,10,12,14].map(h=>`<span style="left:${h/14*100}%">${addM(SH0,h*60)}</span>`).join('');
  const s=sums(p);
  return `<div class="tbar" role="img" aria-label="Línea de tiempo del día">${segs}</div><div class="tticks">${ticks}</div>
  <div class="tlegend">${TORD.map(c=>`<span class="c-${c}"><i></i>${TCAT[c]} <b>${s.byc[c]?fmtH(s.byc[c]):'—'}</b></span>`).join('')}</div>`;
}
function stReg(p,e){
  const cat=CT(p.ct).tareas;
  const order=e.reg.map((r,i)=>[r,i]).sort((a,b)=>(mins(a[0].de)??9999)-(mins(b[0].de)??9999));
  const rows=order.map(([r,i])=>{const op=r.c==='op',vi=r.c==='vi',es=r.c==='es';
    const dCell=es?`<select class="inp${!r.d?' soft':''}" id="f-rd${i}" data-bind="e:reg.${i}.d" data-rr aria-label="Motivo de la espera"><option value="">Motivo de la espera…</option>${ESP.map(m=>`<option${r.d===m?' selected':''}>${m}</option>`).join('')}</select>`
      :`<input class="inp${op&&!r.d?' soft':''}" id="f-rd${i}" list="${op?'dl-cat':''}" data-bind="e:reg.${i}.d" data-rr value="${esc(r.d)}" placeholder="${op?'Elegí del catálogo o escribí la tarea':'Detalle (opcional)'}" aria-label="${op?'Tarea':'Detalle'}">${op&&r.d&&!inCat(p.ct,r.d)?'<div class="sm warn" style="margin-top:3px">Fuera del catálogo del contrato</div>':''}`;
    const qCell=op||vi?`<input class="inp${!(Number(r.q)>0)?' soft':''}" type="number" step="any" inputmode="decimal" id="f-rq${i}" data-bind="e:reg.${i}.q" data-rr value="${esc(r.q)}" aria-label="${vi?'Velocidad del viento':'Cantidad'}" placeholder="${vi?'Ráfaga':''}">`:'';
    const uCell=op?`<select class="inp" id="f-ru${i}" data-bind="e:reg.${i}.u" data-rr aria-label="Unidad"><option value=""></option>${UNITS.map(u=>`<option${r.u===u?' selected':''}>${u}</option>`).join('')}</select>`:vi?'<span class="unit">km/h</span>':'';
    return `<tr class="cat c-${r.c}"><td style="width:170px"><select class="inp" id="f-rc${i}" data-bind="e:reg.${i}.c" data-rr aria-label="Categoría">${TORD.map(k=>`<option value="${k}"${r.c===k?' selected':''}>${TCAT[k]}</option>`).join('')}</select></td>
    <td style="width:112px">${tin(`e:reg.${i}.de`,r.de,false,'Desde')}</td><td style="width:112px">${tin(`e:reg.${i}.a`,r.a,false,'Hasta')}</td>
    <td>${dCell}</td><td style="width:96px">${qCell}</td><td style="width:100px">${uCell}</td>
    <td class="num" style="width:70px">${fmtH(dur(r.de,r.a))}</td><td style="width:44px"><button class="ibtn del" data-a="o-delr" data-i="${i}" aria-label="Quitar tramo">${ic('trash')}</button></td></tr>`}).join('');
  const pr=prod(p),pend=p.prev.filter(d=>!e.reg.some(x=>x.c==='op'&&x.d===d));
  return `<datalist id="dl-cat">${cat.map(([d])=>`<option value="${esc(d)}"></option>`).join('')}</datalist>
  <div class="pnl"><h3>Tareas y tiempos del día<span class="sp"></span><span class="sm">Una fila por tramo, en orden</span></h3>
  <div class="scrollx"><table class="tbl regtbl"><thead><tr><th>Categoría</th><th>Desde</th><th>Hasta</th><th>Tarea / motivo / detalle</th><th>Cantidad</th><th>Unidad</th><th class="num">Dur.</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="8"><div class="empty">Agregá el primer tramo del día: normalmente el traslado desde base.</div></td></tr>'}</tbody></table></div>
  <div class="regadd">${TORD.map(k=>`<button class="chip add sm3" data-a="o-addr" data-c="${k}"><span class="cdot c-${k}"></span>${k==='op'?'Tarea operativa':TCAT[k]}</button>`).join('')}${pend.map(d=>`<button class="chip add sm3" data-a="o-addr" data-c="op" data-d="${esc(d)}">${ic('plus')}${esc(d)} <span class="n">prevista</span></button>`).join('')}</div></div>
  <div class="pnl"><h3>Resumen del día<span class="sp"></span><span class="sm">${fmtH(sums(p).jor)} registradas · de 06:00 a 20:00</span></h3>${tbar(p)}</div>
  <div class="pnl"><h3>Producción del día</h3>${pr.length?`<table class="tbl"><thead><tr><th>Tarea</th><th class="num">Cantidad</th></tr></thead><tbody>${pr.map(x=>`<tr><td>${esc(x.d)}</td><td class="num">${x.q?num(x.q)+' '+esc(x.u):'—'}</td></tr>`).join('')}</tbody></table>`:'<p class="sm" style="margin:0">Todavía no hay tareas operativas.</p>'}</div>
  <div class="windhint">${ic('wind')}<div><b>Parada por viento:</b> registrala con la velocidad de las ráfagas en km/h cuando superan 60 km/h y se suspenden izajes o trabajos en altura. La operadora la reconoce como tiempo no imputable a la cuadrilla.</div></div>`;
}
function trabTotals(t,extraP){
  const ps=S.partes.filter(p=>p.pl===t.id&&p.ejec);
  if(extraP&&!ps.includes(extraP))ps.push(extraP);
  const pr={};let hh=0;ps.forEach(p=>{hh+=sums(p).hh;prod(p).forEach(x=>{const k=x.d+'|'+x.u;pr[k]=pr[k]||{d:x.d,u:x.u,q:0};pr[k].q+=x.q})});
  return {dias:ps.length,hh,prod:Object.values(pr)};
}
function stCierre(p,e){
  const c=checks(p),s=sums(p),t=trab(p.pl),lastDay=p.dia>=t.dias-1;
  const list=c.length?c.map(([l,m,sec])=>`<div class="chk ${l}">${ic(l==='err'?'err':'alert')}<span>${esc(m)}</span>${sec!=='Cierre'?`<button class="go" data-a="o-step" data-i="${STEP_OF[sec]}">Ir a ${sec}</button>`:''}</div>`).join(''):`<div class="chk ok">${ic('okc')}<span>Todo completo. El parte está listo para enviar.</span></div>`;
  const ne=c.filter(x=>x[0]==='err').length,nw=c.length-ne;
  const fotos=e.fotos.map((f,i)=>`<div class="thumb${f.src?'':' ph'}">${f.src?`<img src="${f.src}" alt="${esc(f.cap)}">`:''}<span class="cap">${esc(f.cap)}</span><button class="x" data-a="o-delf" data-i="${i}" aria-label="Quitar foto">${ic('x')}</button></div>`).join('');
  const sel=(id,bind,opts,v)=>`<select class="inp" id="${id}" data-bind="${bind}" data-rr><option value=""${!v?' selected':''}>Elegir…</option>${opts.map(o=>`<option${o===v?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
  const tt=trabTotals(t,p);
  const fin=`<div class="pnl"><h3>${ic('flag')}Estado del trabajo al terminar el día<span class="sp"></span><span class="sm">${p.pl} · día ${p.dia+1} de ${t.dias}</span></h3>
    <div class="finseg"><button class="finopt" data-a="o-fin" data-v="sigue" aria-pressed="${p.fin==='sigue'}"${lastDay?' disabled':''}>Continúa mañana<small>${lastDay?'Es el último día planificado':'Quedan '+(t.dias-p.dia-1)+' día(s) planificados'}</small></button>
    <button class="finopt" data-a="o-fin" data-v="fin" aria-pressed="${p.fin==='fin'}">Trabajo terminado<small>${lastDay?'Cierre total del trabajo':'Cierra antes y libera el recurso'}</small></button>
    <button class="finopt" data-a="o-fin" data-v="ext" aria-pressed="${p.fin==='ext'}">Necesita más días<small>Lo aprueba planificación</small></button></div>
    ${p.fin==='fin'?`<div style="margin-top:14px"><div class="lab" style="margin-bottom:8px">Cierre total · acumulado de ${tt.dias} día(s) · ${fmtH(tt.hh)} hombre</div><table class="tbl"><thead><tr><th>Tarea</th><th class="num">Total del trabajo</th></tr></thead><tbody>${tt.prod.map(x=>`<tr><td>${esc(x.d)}</td><td class="num">${num(x.q)} ${esc(x.u)}</td></tr>`).join('')||'<tr><td colspan="2" class="sm">Sin producción cargada</td></tr>'}</tbody></table>
      ${!lastDay?`<div class="infobox w" style="margin-top:10px">${ic('alert')}<div>Se cierra ${t.dias-p.dia-1} día(s) antes de lo planificado. ${recOf(p.rec).n} queda libre desde el ${fDay(addDays(p.fecha,1))}.</div></div>`:''}
      <div class="fld" style="margin-top:10px"><label for="f-cobs">Observación final del trabajo</label><textarea class="inp" id="f-cobs" data-bind="p:cierreObs" rows="2" placeholder="Estado en que queda la locación, pendientes, conformidad del supervisor de la operadora…">${esc(p.cierreObs)}</textarea></div></div>`:''}
    ${p.fin==='ext'?`<div style="margin-top:14px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:end"><div class="fld"><span class="lab">Días extra</span><div class="stepper"><button data-a="o-extd" data-d="-1"${(p.ext.dias||1)<=1?' disabled':''} aria-label="Un día menos">−</button><b>${p.ext.dias} día${p.ext.dias>1?'s':''}</b><button data-a="o-extd" data-d="1" aria-label="Un día más">+</button></div></div><div class="fld"><label for="f-extm">Motivo</label><input class="inp${!p.ext.motivo.trim()?' bad':''}" id="f-extm" data-bind="p:ext.motivo" data-rr value="${esc(p.ext.motivo)}" placeholder="Qué falta y por qué"></div></div>`:''}
  </div>`;
  return `<div class="stats"><div class="stat"><b>${s.pers}</b><span>Personas</span></div><div class="stat"><b>${fmtH(s.hh)}</b><span>Horas hombre</span></div><div class="stat"><b>${fmtH(s.jor)}</b><span>Tiempo registrado</span></div><div class="stat"><b>${num(s.km)}</b><span>Km recorridos</span></div></div>
  ${fin}
  <div class="grid2">
    <div class="stack">
      <div class="pnl"><h3>Controles antes de enviar<span class="sp"></span>${ne?`<span class="flag err">${ne} pendiente${ne>1?'s':''}</span>`:`<span class="flag ok">${ic('check')}Se puede enviar</span>`}${nw?`<span class="flag warn">${nw} alerta${nw>1?'s':''}</span>`:''}</h3>${list}</div>
      <div class="pnl"><h3>Responsables</h3><div class="grid2" style="gap:12px"><div class="fld"><label for="p-sup">Supervisor responsable</label>${sel('p-sup','p:sup',SUPS,p.sup)}</div><div class="fld"><label for="p-rt">Responsable técnico</label>${sel('p-rt','p:rt',RTS,p.rt)}</div></div></div>
    </div>
    <div class="stack">
      <div class="pnl"><h3>Observaciones del día</h3><textarea class="inp" id="f-obs" data-bind="e:obs" rows="3" placeholder="Demoras, incidentes, pedidos de la operadora…">${esc(e.obs)}</textarea></div>
      <div class="pnl"><h3>Fotos<span class="sp"></span><span class="sm">${e.fotos.length}</span></h3><div class="thumbs">${fotos}<label class="upl">${ic('cam')}Agregar foto<input type="file" accept="image/*" multiple id="f-fotos"></label></div></div>
      <div class="pnl"><h3>Firma del jefe de cuadrilla<span class="sp"></span><span class="sm">${esc(jefeP(p))}</span></h3><div class="sigwrap"><canvas class="sig" data-sig="op" width="760" height="260" aria-label="Firmá con el dedo"></canvas>${e.firma?`<button class="ibtn del" data-a="o-sigclear" aria-label="Borrar firma">${ic('trash')}</button>`:'<span class="hint">Firmá con el dedo dentro del recuadro</span>'}</div></div>
    </div>
  </div>`;
}

/* ---------- aprobación y certificación ---------- */
function vInbox(role){
  const isV=role==='v';
  const fk=isV?'vf':'cf',sk=isV?'vsel':'csel',f=S[fk];
  const opF=(isV||isAdm())&&S.vop!=='all'?S.vop:null;
  const base=(isV?S.partes.filter(p=>!p.cola):S.partes.filter(p=>isAdm()||p.op===USERS.cliente.op)).filter(p=>!opF||p.op===opF);
  const tabs=isV?[['env','Para aprobar',p=>p.estado==='env'],['obs','Observados',p=>p.estado==='obs'],['apr','Aprobados',p=>p.estado==='apr'||p.estado==='cert']]
    :[['apr','Para certificar',p=>p.estado==='apr'],['cert','Certificados',p=>p.estado==='cert'],['obs','Observados',p=>p.estado==='obs']];
  const tf=tabs.find(x=>x[0]===f)||tabs[0];
  const list=base.filter(tf[2]).sort((a,b)=>f===tabs[0][0]?a.fecha.localeCompare(b.fecha):b.fecha.localeCompare(a.fecha));
  if(!list.find(p=>p.id===S[sk]))S[sk]=list[0]?list[0].id:null;
  const rows=list.map(p=>{const c=checks(p),ne=c.filter(x=>x[0]==='err').length,nw=c.filter(x=>x[0]==='warn').length;
    return `<button class="vrow" data-a="${role}-sel" data-id="${p.id}"${p.id===S[sk]?' aria-current="true"':''}><div class="r1"><b>${recOf(p.rec).n}</b><span class="mono sm">${p.id}</span></div><div class="r2">${fDay(p.fecha)} · ${isV||isAdm()?OPS[p.op]+' · ':''}${esc(p.yac)} ${esc(p.pozo)}</div><div class="r2"><span class="mono">${p.ct}</span> · <span class="mono">${esc(p.imp||'')}</span></div><div class="r3">${ne?`<span class="flag err">${ic('err')}${ne} bloqueante${ne>1?'s':''}</span>`:''}${nw?`<span class="flag warn">${ic('alert')}${nw} alerta${nw>1?'s':''}</span>`:''}${!ne&&!nw?`<span class="flag ok">${ic('check')}Sin alertas</span>`:''}${p.fin==='fin'?`<span class="flag inf">${ic('flag')}Cierre</span>`:''}${p.fin==='ext'?`<span class="flag inf">${ic('flag')}Pide días</span>`:''}</div></button>`}).join('');
  let sumBox='';
  if(!isV){const byCt={};base.forEach(p=>{byCt[p.ct]=byCt[p.ct]||{a:0,c:0};if(p.estado==='apr')byCt[p.ct].a++;if(p.estado==='cert')byCt[p.ct].c++});
    sumBox=`<div class="vsum">${Object.entries(byCt).map(([k,v])=>`<div><span class="mono">${k}</span><span>${v.a} por certificar · <b>${v.c}</b> certificados</span></div>`).join('')}</div>`}
  const opSel=isV||isAdm()?`<select class="inp" id="vop" data-bind="s:vop" data-rr aria-label="Filtrar por cliente">${opOpts().map(([k,l])=>`<option value="${k}"${S.vop===k?' selected':''}>${l}</option>`).join('')}</select>`:'';
  return `<div class="vin"><div class="vlist" data-keep="vl"><div class="seg">${tabs.map(([k,l,fn])=>`<button data-a="${role}-filter" data-f="${k}" aria-pressed="${tf[0]===k}">${l} ${base.filter(fn).length}</button>`).join('')}</div>${opSel}${sumBox}${rows||`<div class="empty" style="margin:12px">No hay partes en este estado.</div>`}</div>
  <div class="vdet">${S[sk]?detail(byId(S[sk]),role):`<div class="vscroll"><div class="empty">Elegí un parte de la lista.</div></div>`}</div></div>`;
}
function detail(p,role){
  const e=p.ejec,c=checks(p),s=sums(p),ne=c.filter(x=>x[0]==='err').length,t=trab(p.pl);
  const ops=e.reg.filter(x=>x.c==='op');
  const tasks=[...new Set([...p.prev,...ops.map(x=>x.d).filter(Boolean)])].map(d=>{const q=ops.filter(x=>x.d===d).reduce((a,x)=>a+(Number(x.q)||0),0),u=(ops.find(x=>x.d===d)||{}).u||unitOf(p.ct,d);const pv=p.prev.includes(d);
    return `<tr><td>${esc(d)}</td><td>${pv?'Prevista':inCat(p.ct,d)?'<span class="warn">Adicional</span>':'<span class="warn">Fuera de catálogo</span>'}</td><td class="num ${!q?'warn':''}">${q?num(q)+' '+esc(u):'No se hizo'}</td></tr>`}).join('');
  const pers=e.personal.map(x=>{const d=x.base&&x.out?dur(x.base,x.out):0,h=hab(x.n,p.op,p.fecha);return `<tr class="${x.pres?'':'off'}"><td>${esc(x.n)}<div class="sm">${esc(x.rol)}</div></td><td>${x.pres?habChip(h):''}</td><td class="num">${x.pres?esc(x.base||'—'):'—'}</td><td class="num">${x.pres?esc(x.zona||'—'):''}</td><td class="num ${x.pres&&!x.out?'errc':''}">${x.pres?esc(x.out||'Falta'):''}</td><td class="num ${d>720?'warn':''}">${x.pres?(d?fmtH(d):'—'):'Ausente'}</td></tr>`}).join('');
  const eq=e.equipos.map(q=>{const pk=lastKm(q.c,p);return `<tr><td><span class="mono">${q.c}</span> ${esc(EQ[q.c])}${q.obs?`<div class="sm">${esc(q.obs)}</div>`:''}</td><td>${habChip(hab(q.c,p.op,p.fecha))}</td><td class="num">${q.km!==''&&pk!==null?num(q.km-pk)+' km':'—'}</td></tr>`}).join('');
  const cl=e.clima,w=e.permiso;
  let dec='';
  if(role==='v'&&p.estado==='env')dec=`<div class="vdec"><div class="row"><div class="fld"><label for="v-com">Comentario para la cuadrilla</label><textarea class="inp${UI.verr?' bad':''}" id="v-com" data-bind="v:vcom" placeholder="Obligatorio para devolver. Opcional al aprobar.">${esc(UI.vcom)}</textarea></div></div><div class="acts">${UI.verr?`<span class="ferr note">${esc(UI.verr)}</span>`:ne?`<span class="note w">${ic('alert')}No se puede aprobar con controles bloqueantes</span>`:''}<button class="btn obsb lg" data-a="v-obs">${ic('back')}Devolver a cuadrilla</button><button class="btn okb lg" data-a="v-ok"${ne?' disabled':''}>${ic('check')}Aprobar y enviar a certificar</button></div></div>`;
  else if(role==='c'&&p.estado==='apr')dec=`<div class="vdec"><div class="row sig2"><div class="fld"><label for="v-com">Comentario</label><textarea class="inp${UI.verr&&!UI.verr.startsWith('Firm')?' bad':''}" id="v-com" data-bind="v:vcom" placeholder="Obligatorio para observar. Opcional al certificar." style="height:96px;min-height:96px">${esc(UI.vcom)}</textarea></div><div class="fld"><span class="lab">Firma de ${esc(S.user==='cliente'?USERS.cliente.n:meN())}</span><div class="sigwrap"><canvas class="sig sm4" data-sig="cli" width="600" height="192" aria-label="Firmá para certificar"></canvas>${UI.csig?`<button class="ibtn del" data-a="c-sigclear" aria-label="Borrar firma">${ic('trash')}</button>`:'<span class="hint">Firmá para certificar</span>'}</div></div></div><div class="acts">${UI.verr?`<span class="ferr note">${esc(UI.verr)}</span>`:''}<button class="btn obsb lg" data-a="c-obs">${ic('back')}Observar</button><button class="btn aprb lg" data-a="c-ok">${ic('stamp')}Certificar y firmar</button></div></div>`;
  else{const lines=[];
    if(p.dec)lines.push(`<div class="decided" style="--c:${p.dec.d==='ok'?'var(--st-ok)':'var(--st-obs)'}">${ic(p.dec.d==='ok'?'okc':'back')}<div><b>${p.dec.d==='ok'?'Aprobado':'Devuelto con observaciones'}</b> · ${esc(p.dec.who)} · ${esc(p.dec.t)}${p.dec.com?`<div class="sm">${esc(p.dec.com)}</div>`:''}</div></div>`);
    if(p.cert)lines.push(`<div class="decided" style="--c:var(--st-apr)">${ic('stamp')}<div><b>Certificado y firmado</b> · ${esc(p.cert.who)} · ${esc(p.cert.t)}${p.cert.com?`<div class="sm">${esc(p.cert.com)}</div>`:''}</div></div>`);
    if(lines.length)dec=`<div class="vdec">${lines.join('')}</div>`}
  const finBox=p.fin==='fin'?(()=>{const tt=trabTotals(t,p);return `<div class="infobox">${ic('flag')}<div><b>Este parte cierra el trabajo ${p.pl}${t&&t.cierre&&t.cierre.anticipado?' (antes de lo planificado)':''}</b>${tt.dias} día(s) · ${fmtH(tt.hh)} hombre · ${tt.prod.map(x=>num(x.q)+' '+esc(x.u)+' de '+esc(x.d).toLowerCase()).join(', ')}${p.cierreObs?`<div class="sm">${esc(p.cierreObs)}</div>`:''}</div></div>`})():p.fin==='ext'&&p.ext?`<div class="infobox w">${ic('flag')}<div><b>El jefe pidió ${p.ext.dias} día(s) más</b><div class="sm">${esc(p.ext.motivo)}</div></div></div>`:'';
  return `<div class="vscroll" data-keep="vd">
  <div class="vhead"><div style="flex:1;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="mono">${p.id}</span>${pill(p.estado)}${prioB(p.prio)}${ptTag(p.ptw)}<span class="tag">${p.pl} · día ${p.dia+1}${t?' de '+t.dias:''}</span></div><h2>${recOf(p.rec).n} · ${esc(p.yac)} ${esc(p.pozo)}</h2><div class="meta"><span>${fDay(p.fecha)} · llegada ${esc(e.llegada||'—')}</span><span><span class="mono">${p.ct}</span> · imputación <span class="mono">${esc(p.imp||'—')}</span> · ${OPS[p.op]}</span><span>Supervisor ${esc(p.sup)} · Resp. técnico ${esc(p.rt)}</span></div></div><button class="btn sm2" data-a="pdf" data-id="${p.id}">${ic('pdf')}PDF</button></div>
  ${finBox}
  <div class="stats"><div class="stat"><b>${s.pers}</b><span>Personas</span></div><div class="stat"><b>${fmtH(s.hh)}</b><span>Horas hombre</span></div><div class="stat"><b>${fmtH(s.jor)}</b><span>Tiempo registrado</span></div><div class="stat"><b>${num(s.km)}</b><span>Km recorridos</span></div></div>
  <div class="pnl"><h3>Controles automáticos<span class="sp"></span>${ne?`<span class="flag err">${ne} bloqueante${ne>1?'s':''}</span>`:`<span class="flag ok">${ic('check')}Sin bloqueos</span>`}</h3>${c.length?c.map(([l,m])=>`<div class="chk ${l}">${ic(l==='err'?'err':'alert')}<span>${esc(m)}</span></div>`).join(''):`<div class="chk ok">${ic('okc')}<span>El parte cumple todos los controles.</span></div>`}</div>
  <div class="grid2">
    <div class="pnl"><h3>${ic('sun')}Clima</h3>${cl?`<div class="grid3"><div class="stat"><b>${esc(cl.t)}°</b><span>Temperatura</span></div><div class="stat"><b class="${Number(cl.r)>=60?'errc':''}">${esc(cl.r)}</b><span>Ráfagas km/h ${esc(cl.dir)}</span></div><div class="stat"><b style="font-size:17px;padding-top:6px">${esc(cl.cond)}</b><span>${cl.src==='app'?'App de clima':'Manual'}</span></div></div>`:'<span class="errc">Sin datos de clima</span>'}</div>
    <div class="pnl"><h3>${ic('sign')}Permiso de la operadora</h3>${p.ptw?(w&&w.num&&w.firmo?`<dl class="kv"><dt>Nº</dt><dd class="mono">${esc(w.num)}</dd><dt>Firmó</dt><dd>${esc(w.firmo)} · ${esc(w.hora)}</dd></dl>`:'<span class="errc">Falta la firma de la operadora</span>'):'<span class="sm">No requiere</span>'}</div>
  </div>
  <div class="pnl"><h3>Tareas y tiempos</h3>${tbar(p)}<div class="scrollx" style="margin-top:12px"><table class="tbl"><thead><tr><th class="num">Desde</th><th class="num">Hasta</th><th>Categoría</th><th>Tarea / detalle</th><th class="num">Cantidad</th></tr></thead><tbody>${e.reg.slice().sort((a,b)=>mins(a.de)-mins(b.de)).map(x=>`<tr><td class="num">${x.de}</td><td class="num">${x.a}</td><td style="white-space:nowrap"><span class="cdot c-${x.c}"></span>${TCAT[x.c]}</td><td>${esc(x.d)||'—'}${x.det?` <span class="sm">· ${esc(x.det)}</span>`:''}</td><td class="num">${regQ(x)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="grid2">
    <div class="pnl"><h3>Plan vs. realizado</h3><table class="tbl"><thead><tr><th>Tarea</th><th>Origen</th><th class="num">Informado</th></tr></thead><tbody>${tasks}</tbody></table></div>
    <div class="pnl"><h3>Equipos</h3><table class="tbl"><thead><tr><th>Equipo</th><th>Habilitación</th><th class="num">Recorrido</th></tr></thead><tbody>${eq}</tbody></table></div>
  </div>
  <div class="pnl"><h3>Personal</h3><div class="scrollx"><table class="tbl"><thead><tr><th>Persona</th><th>Habilitación</th><th class="num">Ingreso base</th><th class="num">Llegada zona</th><th class="num">Salida</th><th class="num">Horas</th></tr></thead><tbody>${pers}</tbody></table></div></div>
  <div class="grid2">
    <div class="pnl"><h3>Observaciones del responsable</h3><div style="font-size:14px">${e.obs?esc(e.obs):'<span class="sm">Sin observaciones.</span>'}</div></div>
    <div class="pnl"><h3>Fotos y firma</h3>${e.fotos.length?`<div class="thumbs" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:10px">${e.fotos.map(f=>`<div class="thumb${f.src?'':' ph'}">${f.src?`<img src="${f.src}" alt="${esc(f.cap)}">`:''}<span class="cap">${esc(f.cap)}</span></div>`).join('')}</div>`:'<p class="sm" style="margin:0 0 10px">Sin fotos adjuntas.</p>'}<div class="sigimg">${sigSvg(e.firma)}</div></div>
  </div>
  <div class="pnl"><h3>Historial</h3><ol class="tl">${p.hist.map(x=>`<li>${esc(x.a)}<small>${esc(x.who)} · ${esc(x.t)}</small>${x.c?`<q>${esc(x.c)}</q>`:''}</li>`).join('')}</ol></div>
  </div>${dec}`;
}

/* ---------- dashboard cliente ---------- */
function vDash(){
  const op=isAdm()?S.dop:USERS.cliente.op;
  const cts=Object.keys(S.contratos).filter(k=>CT(k).op===op);
  const ctF=cts.includes(S.dct)?S.dct:'all';
  const imps=(ctF==='all'?cts:[ctF]).flatMap(k=>CT(k).imps.map(i=>[i[0],i[1]]));
  const impF=imps.some(i=>i[0]===S.dimp)?S.dimp:'all';
  const all=S.partes.filter(p=>p.op===op&&(ctF==='all'||p.ct===ctF)&&(impF==='all'||p.imp===impF));
  const ps=all.filter(p=>['apr','cert'].includes(p.estado)&&p.ejec);
  let hh=0,km=0;const byc={},pr={},byRec={},byDay={},byImp={},byEsp={};
  ps.forEach(p=>{const s=sums(p);hh+=s.hh;km+=s.km;Object.entries(s.byc).forEach(([k,v])=>byc[k]=(byc[k]||0)+v);
    prod(p).forEach(x=>{const k=x.d+'|'+x.u;pr[k]=pr[k]||{d:x.d,u:x.u,q:0,n:0};pr[k].q+=x.q;pr[k].n++});
    byRec[p.rec]=byRec[p.rec]||{d:0,hh:0,pers:new Set(),eq:new Set()};byRec[p.rec].d++;byRec[p.rec].hh+=s.hh;p.ejec.personal.filter(x=>x.pres).forEach(x=>byRec[p.rec].pers.add(x.n));p.ejec.equipos.forEach(q=>byRec[p.rec].eq.add(q.c));
    byImp[p.imp]=byImp[p.imp]||{n:0,hh:0,ct:p.ct};byImp[p.imp].n++;byImp[p.imp].hh+=s.hh;
    p.ejec.reg.filter(x=>x.c==='es').forEach(x=>{const k=x.d||'Sin motivo';byEsp[k]=(byEsp[k]||0)+dur(x.de,x.a)});
    byDay[p.fecha]=(byDay[p.fecha]||0)+s.hh});
  const tot=Object.values(byc).reduce((a,b)=>a+b,0)||1;
  const pend={env:all.filter(p=>p.estado==='env').length,apr:all.filter(p=>p.estado==='apr').length,cert:all.filter(p=>p.estado==='cert').length};
  const dates=Object.keys(byDay).sort();
  let days=[];if(dates.length){let d=dates[0];while(d<=dates[dates.length-1]){days.push(d);d=addDays(d,1)}}
  const mx=Math.max(1,...days.map(d=>byDay[d]||0));const top=Math.ceil(mx/60/10)*10*60||600;
  const peak=days.reduce((a,d)=>(byDay[d]||0)>(byDay[a]||0)?d:a,days[0]);
  const bars=days.map(d=>{const v=byDay[d]||0;return `<div class="b" tabindex="0" aria-label="${fDay(d)}: ${hDec(v)} horas hombre"><i style="height:${v/top*100}%;position:relative">${d===peak||d===days[days.length-1]?`<em>${hDec(v)}</em>`:''}</i><span class="tip">${fDay(d)} · ${hDec(v)} h hombre</span></div>`}).join('');
  const trabs=S.trabajos.filter(t=>CT(t.ct).op===op&&(ctF==='all'||t.ct===ctF)&&(impF==='all'||t.imp===impF)).sort((a,b)=>b.inicio.localeCompare(a.inicio));
  const espTot=Object.values(byEsp).reduce((a,b)=>a+b,0);
  return `<div class="fbar">${isAdm()?`<div class="fld"><label for="d-op">Cliente</label>${selF('d-op','s:dop',Object.entries(OPS),op)}</div>`:''}<div class="fld wide"><label for="d-ct">Contrato</label>${selF('d-ct','s:dct',[['all','Todos los contratos'],...cts.map(k=>[k,`${k} · ${CT(k).n}`])],ctF)}</div><div class="fld wide"><label for="d-imp">Imputación</label>${selF('d-imp','s:dimp',[['all','Todas las imputaciones'],...imps.map(([k,n])=>[k,`${k} · ${n}`])],impF)}</div><span class="sp"></span><span class="note">${ic('cal')}${dates.length?fDay(dates[0])+' → '+fDay(dates[dates.length-1]):'Sin datos'}</span></div>
  <div class="dtiles">
    <div class="dtile"><span>Horas hombre</span><b>${hDec(hh)}</b><small>${ps.length} partes aprobados</small></div>
    <div class="dtile"><span>Horas operativas</span><b>${hDec(byc.op||0)}</b><small>${Math.round((byc.op||0)/tot*100)}% del tiempo registrado</small></div>
    <div class="dtile hl"><span>Espera por la operadora</span><b>${hDec(byc.es||0)}</b><small>Ver motivos abajo</small></div>
    <div class="dtile"><span>Km recorridos</span><b>${num(km)}</b><small>Vehículos y equipos</small></div>
  </div>
  <div class="grid2" style="margin-top:16px;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
    <div class="pnl"><h3>Horas hombre por día</h3>${days.length?`<div class="bars"><div class="gl2" style="bottom:100%"><span>${hDec(top)}</span></div><div class="gl2" style="bottom:50%"><span>${hDec(top/2)}</span></div><div class="gl2" style="bottom:0;border:0"><span>0</span></div>${bars}</div><div class="xlab">${days.map(d=>`<span>${d8(d).getDate()}</span>`).join('')}</div>`:'<div class="empty">Sin partes aprobados todavía.</div>'}</div>
    <div class="pnl"><h3>Distribución del tiempo</h3><div class="s100" role="img" aria-label="Distribución del tiempo registrado">${TORD.filter(k=>byc[k]).map(k=>`<i class="c-${k}" style="width:${byc[k]/tot*100}%" title="${TCAT[k]}: ${hDec(byc[k])} h"></i>`).join('')}</div>
      <table class="tbl ltbl" style="margin-top:10px"><tbody>${TORD.map(k=>`<tr><td><span class="cdot c-${k}"></span>${TCAT[k]}</td><td class="num">${hDec(byc[k]||0)} h</td><td class="num">${Math.round((byc[k]||0)/tot*100)}%</td></tr>`).join('')}</tbody></table></div>
  </div>
  <div class="grid2" style="margin-top:16px">
    <div class="pnl"><h3>${ic('wallet')}Horas por imputación</h3><table class="tbl"><thead><tr><th>Imputación</th><th class="num">Partes</th><th class="num">H. hombre</th></tr></thead><tbody>${Object.entries(byImp).map(([k,v])=>`<tr><td><span class="mono">${esc(k)}</span><div class="sm">${esc(impN(v.ct,k))}</div></td><td class="num">${v.n}</td><td class="num">${hDec(v.hh)}</td></tr>`).join('')||'<tr><td colspan="3" class="sm">Sin datos</td></tr>'}</tbody></table></div>
    <div class="pnl"><h3>Espera por motivo</h3><table class="tbl"><thead><tr><th>Motivo</th><th class="num">Horas</th><th class="num">%</th></tr></thead><tbody>${Object.entries(byEsp).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="num">${hDec(v)}</td><td class="num">${Math.round(v/(espTot||1)*100)}%</td></tr>`).join('')||'<tr><td colspan="3" class="sm">Sin esperas registradas</td></tr>'}</tbody></table></div>
  </div>
  <div class="grid2" style="margin-top:16px">
    <div class="pnl"><h3>Producción acumulada</h3><table class="tbl"><thead><tr><th>Tarea</th><th class="num">Cantidad</th><th class="num">Partes</th></tr></thead><tbody>${Object.values(pr).sort((a,b)=>a.d.localeCompare(b.d)).map(x=>`<tr><td>${esc(x.d)}</td><td class="num">${num(x.q)} ${esc(x.u)}</td><td class="num">${x.n}</td></tr>`).join('')||'<tr><td colspan="3" class="sm">Sin datos</td></tr>'}</tbody></table></div>
    <div class="pnl"><h3>Recursos utilizados</h3><div class="scrollx"><table class="tbl"><thead><tr><th>Recurso</th><th class="num">Días</th><th class="num">Personas</th><th>Equipos</th><th class="num">H. hombre</th></tr></thead><tbody>${Object.entries(byRec).map(([r,v])=>`<tr><td>${recOf(r).n}</td><td class="num">${v.d}</td><td class="num">${v.pers.size}</td><td class="sm">${[...v.eq].join(', ')}</td><td class="num">${hDec(v.hh)}</td></tr>`).join('')||'<tr><td colspan="5" class="sm">Sin datos</td></tr>'}</tbody></table></div></div>
  </div>
  <div class="grid2" style="margin-top:16px;grid-template-columns:minmax(0,1fr) minmax(0,2fr)">
    <div class="pnl"><h3>Estado de los partes</h3><div class="grid3"><div class="stat"><b style="color:var(--st-env)">${pend.env}</b><span>En aprobación VDS</span></div><div class="stat"><b style="color:var(--st-apr)">${pend.apr}</b><span>Para certificar</span></div><div class="stat"><b style="color:var(--st-ok)">${pend.cert}</b><span>Certificados</span></div></div>${pend.apr?`<button class="btn pri" style="margin-top:12px;width:100%" data-a="nav" data-r="c-inbox">${ic('stamp')}Certificar ${pend.apr} parte${pend.apr>1?'s':''}</button>`:''}</div>
    <div class="pnl"><h3>Trabajos</h3><div class="scrollx"><table class="tbl"><thead><tr><th>Trabajo</th><th>Pozo / locación</th><th>Fechas</th><th class="num">Avance</th><th>Estado</th></tr></thead><tbody>${trabs.map(t=>{const done=tDays(t).filter(f=>parteOf(t.id,f)).length;return `<tr><td class="mono">${t.id}</td><td>${esc(t.yac)} · ${esc(t.pozo)}</td><td class="sm" style="white-space:nowrap">${fDay(t.inicio)} → ${fDay(tEnd(t))}</td><td class="num">${done}/${t.dias} días</td><td>${t.cierre?`<span class="hab h-ok">${ic('check')}Cerrado</span>`:pill(tState(t))}</td></tr>`}).join('')}</tbody></table></div></div>
  </div>
  <p class="sm" style="margin-top:12px">Los números salen de los partes aprobados por Vientos del Sur. Los partes en aprobación no se cuentan hasta que se aprueban.</p>`;
}

/* ---------- configuración (admin) ---------- */
function vConf(){
  return features.settings()+`<div class="stack">${Object.entries(S.contratos).map(([k,c])=>{UI.newT[k]=UI.newT[k]||{d:'',u:'m³'};UI.newI[k]=UI.newI[k]||{c:'',n:''};const n=UI.newT[k],ni=UI.newI[k];
    return `<div class="pnl"><h3><span class="mono">${k}</span> ${esc(c.n)}<span class="sp"></span><span class="sm">${OPS[c.op]} · CC ${c.cc}</span></h3>
    <dl class="kv" style="margin-bottom:12px"><dt>Centro de costo</dt><dd>${c.cc} · ${esc(c.ccn)}</dd><dt>Yacimientos</dt><dd>${c.yacs.join(', ')}</dd><dt>Recursos</dt><dd>${c.recs.map(r=>recOf(r).n).join(', ')}</dd></dl>
    ${adminConsole.contractForm(k,c)}
    <div class="lab" style="margin-bottom:8px">Imputaciones de cuenta del cliente</div><div class="rlist">${c.imps.map(([cd,nm],i)=>`<div><span class="nm"><b class="mono">${esc(cd)}</b><small>${esc(nm)}</small></span><span class="sm">${S.trabajos.filter(t=>t.imp===cd).length} trabajos</span><button class="ibtn xs del" data-a="c-delimp" data-ct="${k}" data-i="${i}" aria-label="Quitar ${esc(cd)}">${ic('x')}</button></div>`).join('')}</div>
    <div style="display:flex;gap:8px;margin:10px 0 16px;align-items:center;flex-wrap:wrap"><input class="inp" style="max-width:220px" id="ni-${k}" data-bind="i:${k}.c" value="${esc(ni.c)}" placeholder="Código, ej. AUP-4110-OPEX-03"><input class="inp" style="max-width:320px" id="nn-${k}" data-bind="i:${k}.n" value="${esc(ni.n)}" placeholder="Descripción"><button class="btn sm2" data-a="c-addimp" data-ct="${k}">${ic('plus')}Agregar imputación</button></div>
    <div class="lab" style="margin-bottom:8px">Catálogo de tareas</div><div class="chips">${c.tareas.map(([d,u],i)=>`<span class="chip">${esc(d)} <span class="n">${u}</span><button class="ibtn xs" data-a="c-deltask" data-ct="${k}" data-i="${i}" aria-label="Quitar ${esc(d)}">${ic('x')}</button></span>`).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap"><input class="inp" style="max-width:340px" id="nt-${k}" data-bind="n:${k}.d" value="${esc(n.d)}" placeholder="Nueva tarea, ej. Tendido de cable"><select class="inp" style="width:120px" id="nu-${k}" data-bind="n:${k}.u">${UNITS.map(u=>`<option${n.u===u?' selected':''}>${u}</option>`).join('')}</select><button class="btn sm2" data-a="c-addtask" data-ct="${k}">${ic('plus')}Agregar tarea</button></div></div>`}).join('')}
  <div class="pnl"><h3>Usuarios y accesos</h3><p>Gestioná usuarios, roles y asignaciones desde la pantalla de administración.</p><button class="btn" data-a="nav" data-r="a-users">Gestionar usuarios</button></div></div>`;
}

/* ---------- PDF ---------- */
const SEEDSIG=[[20,60],[40,20,60,20,62,52],[74,84,90,80,104,40],[112,18,128,24,122,58],[118,78,150,30,170,44],[190,58,210,70,228,36],[236,22,250,30,280,40]];
function pdfSig(doc,f,x,y,w,h){if(!f)return;if(f==='seed'){doc.setDrawColor(20,32,42);doc.setLineWidth(.5);const sx=w/300,sy=h/90;let px=x+SEEDSIG[0][0]*sx,py=y+SEEDSIG[0][1]*sy;SEEDSIG.slice(1).forEach(q=>{const nx=x+q[4]*sx,ny=y+q[5]*sy;doc.line(px,py,nx,ny);px=nx;py=ny});doc.setLineWidth(.2);return}try{doc.addImage(f,'PNG',x,y,w,h)}catch(er){}}
function buildPdf(p){
  const {jsPDF}=window.jspdf;const doc=new jsPDF({unit:'mm',format:'a4'});
  const W=210,M=14,e=p.ejec,t=trab(p.pl),c=CT(p.ct),s=sums(p);
  const cl=x=>String(x??'').replace(/[–—]/g,'-').replace(/→/g,'->');
  let y=0;
  doc.setFillColor(194,31,53);doc.rect(0,0,W,24,'F');
  doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(16);doc.text('VIENTOS DEL SUR',M,11);
  doc.setFont('helvetica','normal');doc.setFontSize(9.5);doc.text('Parte diario de servicio - resumen',M,18);
  doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text(p.id,W-M,11,{align:'right'});
  doc.setFont('helvetica','normal');doc.setFontSize(9.5);doc.text(cl(`${fDayL(p.fecha)} · ${EST[p.estado]}`),W-M,18,{align:'right'});
  y=32;
  const sec=tt=>{if(y>262){doc.addPage();y=18}doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(194,31,53);doc.text(cl(tt).toUpperCase(),M,y);doc.setDrawColor(220,225,231);doc.line(M,y+1.6,W-M,y+1.6);doc.setTextColor(20,32,42);y+=4};
  const base={margin:{left:M,right:M},styles:{font:'helvetica',fontSize:8.6,cellPadding:1.8,textColor:[20,32,42],lineColor:[220,225,231],lineWidth:.2},headStyles:{fillColor:[19,33,44],textColor:255,fontStyle:'bold'},alternateRowStyles:{fillColor:[247,249,251]},theme:'grid'};
  const tbl=(head,body,o)=>{doc.autoTable(Object.assign({},base,{startY:y,head:head?[head.map(cl)]:undefined,body:body.map(r=>r.map(cl))},o||{}));y=doc.lastAutoTable.finalY+7};
  const kv=rows=>tbl(null,rows,{theme:'plain',styles:Object.assign({},base.styles,{lineWidth:0}),columnStyles:{0:{fontStyle:'bold',textColor:[92,105,118],cellWidth:38},2:{fontStyle:'bold',textColor:[92,105,118],cellWidth:38}}});
  sec('Datos del servicio');
  kv([['Contrato',`${p.ct} · ${c.n}`,'Centro de costo',`${p.cc} · ${c.ccn}`],['Imputación',`${p.imp||'-'} · ${impN(p.ct,p.imp)}`,'Cliente',OPS[p.op]],['Pozo / locación',`${p.yac} · ${p.pozo}`,'Recurso',`${recOf(p.rec).n} · ${jefeP(p)}`],['Trabajo',`${p.pl} · día ${p.dia+1} de ${t?t.dias:'-'}`,'Prioridad',PRIO[p.prio]],['Supervisor responsable',p.sup||'-','Responsable técnico',p.rt||'-'],['Llegada a instalación',e.llegada||'-','Al cierre del día',finTxt(p)]]);
  sec('Clima, permiso y seguridad');
  const w=e.clima,pm=e.permiso;
  kv([['Temperatura',w&&w.t!==''?w.t+' °C':'-','Viento / ráfagas',w?`${w.v||'-'} / ${w.r||'-'} km/h ${w.dir}`:'-'],['Condición',w?w.cond:'-','Fuente',w?(w.src==='app'?'App de clima de la tablet '+(w.at||''):'Carga manual'):'-'],['Permiso operadora',p.ptw?(pm&&pm.num?pm.num:'Falta'):'No requiere','Firmó',p.ptw&&pm&&pm.firmo?`${pm.firmo} · ${pm.hora}`:'-'],['Charla de seguridad',e.check.charla?'Sí':'No','EPP verificado',e.check.epp?'Sí':'No']]);
  sec(`Personal · ${s.pers} presentes · ${fmtH(s.hh)} hombre`);
  tbl(['Persona','Rol','Ingreso base','Llegada zona','Salida','Horas','Habilitación'],e.personal.map(x=>[x.n,x.rol,x.pres?x.base||'-':'Ausente',x.pres?x.zona||'-':'',x.pres?x.out||'-':'',x.pres&&x.base&&x.out?fmtH(dur(x.base,x.out)):'-',habTxt(hab(x.n,p.op,p.fecha))]));
  sec(`Equipos · ${num(s.km)} km`);
  tbl(['Equipo','Km actual','Recorrido','Observación','Habilitación'],e.equipos.map(q=>{const pk=lastKm(q.c,p);return [`${q.c} ${EQ[q.c]}`,q.km===''?'-':num(q.km),q.km!==''&&pk!==null?num(q.km-pk)+' km':'-',q.obs||'-',habTxt(hab(q.c,p.op,p.fecha))]}));
  sec('Producción del día');
  const pr=prod(p);tbl(['Tarea','Cantidad','Unidad','Origen'],pr.length?pr.map(x=>[x.d,x.q?num(x.q):'-',x.u,p.prev.includes(x.d)?'Prevista':inCat(p.ct,x.d)?'Adicional':'Fuera de catálogo']):[['Sin tareas','','','']]);
  sec(`Tareas y tiempos · ${fmtH(s.jor)}`);
  tbl(['Desde','Hasta','Categoría','Tarea / motivo / detalle','Cantidad'],e.reg.slice().sort((a,b)=>mins(a.de)-mins(b.de)).map(x=>[x.de,x.a,TCAT[x.c],(x.d||'-')+(x.det?' · '+x.det:''),regQ(x)]));
  if(p.fin==='fin'&&t){const tt=trabTotals(t,p);sec(`Cierre del trabajo ${p.pl} · ${tt.dias} día(s) · ${fmtH(tt.hh)} hombre`);tbl(['Tarea','Total del trabajo'],tt.prod.map(x=>[x.d,num(x.q)+' '+x.u]));if(p.cierreObs){doc.setFontSize(9);const l2=doc.splitTextToSize(cl('Observación final: '+p.cierreObs),W-2*M);doc.text(l2,M,y);y+=l2.length*4.2+6}}
  if(p.fin==='ext'&&p.ext){sec('Pedido de extensión');doc.setFontSize(9);const l3=doc.splitTextToSize(cl(`${p.ext.dias} día(s) más. ${p.ext.motivo}`),W-2*M);doc.text(l3,M,y+2);y+=l3.length*4.2+8}
  sec('Observaciones');
  doc.setFont('helvetica','normal');doc.setFontSize(9);const lines=doc.splitTextToSize(cl(e.obs||'Sin observaciones.'),W-2*M);doc.text(lines,M,y+2);y+=lines.length*4.2+8;
  const ck=checks(p);
  if(ck.length){sec('Controles automáticos');tbl(['Nivel','Detalle'],ck.map(x=>[x[0]==='err'?'Bloqueante':'Alerta',x[1]]),{columnStyles:{0:{cellWidth:28}}})}
  if(y>230){doc.addPage();y=18}
  sec('Firmas y aprobaciones');
  const bw=(W-2*M-8)/3,by=y+2;
  [[jefeP(p),'Jefe de cuadrilla','',e.firma],[p.dec&&p.dec.d==='ok'?p.dec.who:'Pendiente','Aprobación VDS',p.dec&&p.dec.d==='ok'?p.dec.t:'',null],[p.cert?p.cert.who:'Pendiente','Certificación '+OPS[p.op],p.cert?p.cert.t:'',p.cert?p.cert.firma:null]].forEach((b,i)=>{
    const x=M+i*(bw+4);doc.setDrawColor(200,207,216);doc.roundedRect(x,by,bw,32,2,2);
    pdfSig(doc,b[3],x+4,by+2,bw*.8,14);
    doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(20,32,42);doc.text(cl(b[0]),x+3,by+23,{maxWidth:bw-6});
    doc.setFont('helvetica','normal');doc.setFontSize(7.6);doc.setTextColor(92,105,118);doc.text(cl(b[1]+(b[2]?' · '+b[2]:'')),x+3,by+28.5,{maxWidth:bw-6});});
  y=by+40;doc.setTextColor(20,32,42);
  sec('Historial');
  tbl(['Fecha','Persona','Acción','Comentario'],p.hist.map(x=>[x.t,x.who,x.a,x.c||'']),{columnStyles:{0:{cellWidth:26},1:{cellWidth:42},2:{cellWidth:44}}});
  const ph=e.fotos.filter(f=>f.src);
  if(ph.length){doc.addPage();y=18;sec('Registro fotográfico');y+=2;ph.forEach((f,i)=>{const col=i%2,row=Math.floor(i/2)%3;if(i&&i%6===0){doc.addPage();y=20}const x=M+col*93,yy=y+row*76;try{doc.addImage(f.src,'JPEG',x,yy,88,64)}catch(er){}doc.setFontSize(8);doc.setTextColor(92,105,118);doc.text(cl(f.cap),x,yy+69)})}
  const n=doc.getNumberOfPages();
  for(let i=1;i<=n;i++){doc.setPage(i);doc.setFontSize(7.5);doc.setTextColor(137,148,160);doc.text(cl(`VDS Partes de campo · ${p.id} · generado el ${fDay(TODAY)} 2026 ${hm()}`),M,290);doc.text(`Página ${i} de ${n}`,W-M,290,{align:'right'})}
  return doc.output('blob');
}
async function downloadPdf(id){
  const p=byId(id);if(!p||!p.ejec){toast('Este parte todavía no tiene datos para exportar');render();return}
  if(!window.jspdf||!window.jspdf.jsPDF){toast('No se pudo cargar el generador de PDF');render();return}
  let blob;try{blob=buildPdf(p)}catch(e){toast('No se pudo armar el PDF');render();return}
  const filename=`${p.id}_${p.fecha}_${p.pozo.replace(/[^A-Za-z0-9-]+/g,'-')}.pdf`;
  const inClaude=!!(window.claude&&window.claude.use);
  if(!inClaude){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);toast(`PDF de ${p.id} descargado`);render();return}
  let dl=null;try{dl=await window.claude.use('downloads')}catch(e){dl=null}
  if(!dl){toast('La descarga no está disponible en esta vista');render();return}
  try{await dl.save({filename,data:blob});toast(`PDF de ${p.id} descargado`)}
  catch(e){if(e&&e.code==='declined')return;toast('No se pudo descargar el PDF')}
  render();
}

/* ---------- firmas ---------- */
function initSigs(){
  document.querySelectorAll('#screen canvas.sig').forEach(cv=>{
    const kind=cv.dataset.sig;
    const get=()=>kind==='op'?cur().ejec.firma:UI.csig;
    const set=v=>{if(kind==='op')cur().ejec.firma=v;else{UI.csig=v;if(UI.verr&&UI.verr.startsWith('Firm'))UI.verr=''}};
    const ctx=cv.getContext('2d');
    const ink=getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()||'#14202A';
    ctx.lineWidth=kind==='op'?5:4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=ink;
    const f=get();
    if(f==='seed'){ctx.beginPath();const sx=cv.width/300,sy=cv.height/90;ctx.moveTo(SEEDSIG[0][0]*sx,SEEDSIG[0][1]*sy);SEEDSIG.slice(1).forEach(q=>ctx.bezierCurveTo(q[0]*sx,q[1]*sy,q[2]*sx,q[3]*sy,q[4]*sx,q[5]*sy));ctx.stroke()}
    else if(f){const im=new Image();im.onload=()=>ctx.drawImage(im,0,0,cv.width,cv.height);im.src=f}
    let down=false,last=null;
    const pt=ev=>{const r=cv.getBoundingClientRect();return [(ev.clientX-r.left)*cv.width/r.width,(ev.clientY-r.top)*cv.height/r.height]};
    cv.addEventListener('pointerdown',ev=>{down=true;last=pt(ev);cv.setPointerCapture(ev.pointerId);ctx.beginPath();ctx.arc(last[0],last[1],2.5,0,7);ctx.fillStyle=ink;ctx.fill()});
    cv.addEventListener('pointermove',ev=>{if(!down)return;const q=pt(ev);ctx.beginPath();ctx.moveTo(last[0],last[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();last=q});
    const up=()=>{if(!down)return;down=false;set(cv.toDataURL('image/png'));render()};
    cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
  });
}

/* ---------- acciones ---------- */
function setBind(path,val){
  const i=path.indexOf(':'),root=path.slice(0,i),keys=path.slice(i+1).split('.');
  if(['n','i'].includes(root)&&!isAdm())return;
  if(root==='m'&&!canPlan()&&!isAdm())return;
  if(['e','p'].includes(root)&&!(isAdm()||(S.user==='operador'&&cur()&&['curso','obs'].includes(cur().estado))))return;
  if(root==='s'&&['user','accountId','accounts','partes','trabajos','contratos','extensions'].includes(keys[0]))return;
  let o=root==='m'?UI.modal.f:root==='e'?cur().ejec:root==='p'?cur():root==='l'?UI.login:root==='v'||root==='u'?UI:root==='n'?UI.newT:root==='i'?UI.newI:root==='s'?S:null;
  if(!o)return;
  if(root==='e'&&keys[0]==='clima'){if(!o.clima)o.clima={t:'',v:'',r:'',dir:'O',cond:'Despejado',src:'manual'};o.clima.src='manual'}
  if(root==='e'&&keys[0]==='permiso'&&!o.permiso)o.permiso={num:'',firmo:'',hora:''};
  for(let k=0;k<keys.length-1;k++)o=o[keys[k]];
  o[keys[keys.length-1]]=val;
  if(root==='v')UI.verr='';
  if(root==='s'&&keys[0]==='fop'){if(S.fct!=='all'&&val!=='all'&&CT(S.fct).op!==val)S.fct='all'}
  if(root==='s'&&keys[0]==='lop'){if(S.lct!=='all'&&val!=='all'&&CT(S.lct).op!==val)S.lct='all'}
  if(root==='s'&&keys[0]==='dop'){S.dct='all';S.dimp='all'}
  if(root==='s'&&keys[0]==='dct'){S.dimp='all'}
  if(root==='m'&&keys[0]==='ct'){const c=CT(val);const f=UI.modal.f;f.rec=c.recs.includes(f.rec)?f.rec:c.recs[0];f.yac=c.yacs[0];f.prev=[];f.imp=c.imps[0][0];f.pers=CREW[f.rec].slice();f.eqs=VEH[f.rec].slice()}
  if(root==='m'&&keys[0]==='rec'){const f=UI.modal.f;f.pers=CREW[val].slice();f.eqs=VEH[val].slice()}
  if(root==='e'&&keys[0]==='reg'){const p=cur(),r=p.ejec.reg[keys[1]];
    if(keys[2]==='d'&&r.c==='op'){const u=unitOf(p.ct,val);if(u)r.u=u}
    if(keys[2]==='c'){if(val==='vi'){r.u='km/h';r.q='';if(r.d&&ESP.includes(r.d))r.d=''}else if(val==='op'){r.u=unitOf(p.ct,r.d)||'';r.q=''}else{r.q='';r.u=''}if(val==='es'&&!ESP.includes(r.d))r.d='';if(val!=='es'&&ESP.includes(r.d))r.d=''}}
}
function moveT(t,inicio,dias,why){
  const a={i:t.inicio,d:t.dias};t.inicio=inicio;t.dias=dias;
  const txt=a.d!==dias&&a.i===inicio?`Duración: ${a.d} → ${dias} días (hasta ${fDay(tEnd(t))})`:a.i!==inicio&&a.d===dias?`Reprogramado: ${fDay(a.i)} → ${fDay(inicio)}`:`Reprogramado: ${fDay(inicio)} → ${fDay(tEnd(t))} · ${dias} días`;
  t.hist.push({t:nowT(),who:meN(),a:txt,c:why||''});
  const cl=clashes(t);toast(`${t.id} · ${txt}${cl.length?' · se superpone con '+cl.map(x=>x.id).join(', '):''}`);
}
const whoCli=p=>S.user==='cliente'?USERS.cliente.n+' · '+OPS[p.op]:meN()+' (admin)';
const A={
  logout:()=>{S.accountId=null;S.user=null;S.route='login';UI.drawer=null;UI.modal=null;render()},
  nav:d=>{if(d.r!=='o-edit')S.back=null;go(d.r)},
  rail:()=>{S.rmin=!S.rmin;render()},
  sync:()=>{toast('Los datos se guardan en este dispositivo. La conexión multiusuario está pendiente.');render()},
  'p-view':d=>{S.pv=d.v;render()},
  'f-clear':()=>{S.fop='all';S.fct='all';render()},
  'p-nav':d=>{const k=Number(d.d);
    if(S.pv==='gantt')S.gs=k?addDays(S.gs,k*7):addDays(mondayOf(TODAY),-7);
    else if(S.pv==='rec')S.ws=k?addDays(S.ws,k*7):mondayOf(TODAY);
    else{if(!k)S.ms=TODAY.slice(0,7);else{const[y,m]=S.ms.split('-').map(Number);S.ms=iso(new Date(y,m-1+k,1)).slice(0,7)}}
    render()},
  'p-new':()=>openTrab(),
  'p-cell':d=>openTrab(d.rec,d.d),
  't-open':d=>{UI.drawer=d.id;UI.delArm=null;render()},
  't-edit':()=>openTrab(null,null,UI.drawer),
  'close-drawer':()=>{UI.drawer=null;render()},
  't-dias':d=>{const t=trab(UI.drawer);const nd=t.dias+Number(d.d);if(nd<minDias(t)||nd>30)return;moveT(t,t.inicio,nd);render()},
  't-prio':d=>{const t=trab(UI.drawer);if(t.prio===d.p)return;t.hist.push({t:nowT(),who:meN(),a:`Prioridad: ${PRIO[t.prio]} → ${PRIO[d.p]}`,c:''});t.prio=d.p;render()},
  'x-ok':d=>{const t=trab(d.id);const x=t.ext;t.ext=null;t.hist.push({t:nowT(),who:meN(),a:`Extensión aprobada: +${x.dias} día(s)`,c:x.motivo});moveT(t,t.inicio,t.dias+x.dias,'Pedido de '+x.who);render()},
  'x-no':d=>{const t=trab(d.id);const x=t.ext;t.ext=null;t.hist.push({t:nowT(),who:meN(),a:'Extensión rechazada',c:x.motivo});toast(`${t.id}: extensión rechazada. El trabajo termina el ${fDay(tEnd(t))}`);render()},
  'a-del':()=>{const t=trab(UI.drawer);if(UI.delArm!==t.id){UI.delArm=t.id;render();return}S.trabajos=S.trabajos.filter(x=>x!==t);UI.drawer=null;UI.delArm=null;toast(`${t.id} eliminado`);render()},
  'a-reopen':()=>{const t=trab(UI.drawer);t.cierre=null;t.hist.push({t:nowT(),who:meN(),a:'Trabajo reabierto por administración',c:''});toast(`${t.id} reabierto`);render()},
  'p-filter':d=>{S.pf=d.f;render()},
  'h-filter':d=>{S.hf=d.f;render()},
  'h-bad':()=>{S.hbad=!S.hbad;render()},
  sum:d=>{UI.modal={kind:'sum',id:d.id};UI.admEst='';render()},
  pdf:d=>downloadPdf(d.id),
  'modal-close':()=>{UI.modal=null;render()},
  'm-ptw':d=>{UI.modal.f.ptw=d.v==='1';render()},
  'm-prio':d=>{UI.modal.f.prio=d.p;render()},
  'm-dias':d=>{const f=UI.modal.f;const ed=UI.modal.edit?trab(UI.modal.edit):null;f.dias=Math.max(ed?minDias(ed):1,Math.min(30,f.dias+Number(d.d)));render()},
  'm-tarea':d=>{const f=UI.modal.f;f.prev=f.prev.includes(d.t)?f.prev.filter(x=>x!==d.t):[...f.prev,d.t];UI.modal.err.prev='';render()},
  'm-padd':d=>{UI.modal.f.pers.push(d.n);UI.modal.err.pers='';render()},
  'm-pdel':d=>{const f=UI.modal.f;f.pers=f.pers.filter(x=>x!==d.n);render()},
  'm-eadd':d=>{UI.modal.f.eqs.push(d.n);render()},
  'm-edel':d=>{const f=UI.modal.f;f.eqs=f.eqs.filter(x=>x!==d.n);render()},
  'a-hab':d=>{const h=S.hab[d.s+'|'+d.op];UI.modal={kind:'hab',f:{s:d.s,op:d.op,vence:h?h.vence:addDays(TODAY,365),sin:!h}};render()},
  'h-sin':d=>{UI.modal.f.sin=d.v==='1';render()},
  'a-est':d=>{const p=byId(d.id);const ne=UI.admEst||p.estado;if(ne===p.estado)return;p.hist.push({t:nowT(),who:meN(),a:`Estado cambiado por administración: ${EST[p.estado]} → ${EST[ne]}`,c:''});p.estado=ne;if(ne!=='plan'&&!p.ejec)p.ejec=newEjec(p);toast(`${p.id} ahora está ${EST[ne]}`);render()},
  'a-edit':d=>{UI.modal=null;S.back=S.route;S.sel=d.id;S.step=0;go('o-edit')},
  'a-save':()=>{const p=cur();p.hist.push({t:nowT(),who:meN(),a:'Editado por administración',c:''});toast(`${p.id} guardado`);go(S.back||'p-list')},
  'c-addtask':d=>{const n=UI.newT[d.ct];if(!n||!n.d.trim()){toast('Escribí el nombre de la tarea');render();return}const c=CT(d.ct);if(c.tareas.some(x=>x[0].toLowerCase()===n.d.trim().toLowerCase())){toast('Esa tarea ya está en el catálogo');render();return}c.tareas.push([n.d.trim(),n.u]);toast(`Tarea agregada a ${d.ct}`);UI.newT[d.ct]={d:'',u:n.u};render()},
  'c-deltask':d=>{const c=CT(d.ct);const x=c.tareas.splice(Number(d.i),1)[0];toast(`Quitada: ${x[0]}`);render()},
  'c-addimp':d=>{const n=UI.newI[d.ct];if(!n||!n.c.trim()||!n.n.trim()){toast('Completá el código y la descripción de la imputación');render();return}const c=CT(d.ct);if(c.imps.some(x=>x[0].toLowerCase()===n.c.trim().toLowerCase())){toast('Esa imputación ya existe');render();return}c.imps.push([n.c.trim(),n.n.trim()]);UI.newI[d.ct]={c:'',n:''};toast(`Imputación agregada a ${d.ct}`);render()},
  'c-delimp':d=>{const c=CT(d.ct);const x=c.imps[Number(d.i)];if(S.trabajos.some(t=>t.imp===x[0])){toast(`${x[0]} está en uso por trabajos: no se puede quitar`);render();return}if(c.imps.length<=1){toast('El contrato necesita al menos una imputación');render();return}c.imps.splice(Number(d.i),1);toast(`Quitada: ${x[0]}`);render()},
  'sent-ok':()=>{UI.modal=null;S.route='o-day';render()},
  'o-start':d=>{const t=trab(d.pl);const existing=parteOf(t.id,TODAY);if(existing){if(['curso','obs'].includes(existing.estado))A['o-open']({id:existing.id});else{toast('El parte de ese trabajo y fecha ya fue enviado.');render()}return}if(!covers(t,TODAY)||t.cierre){toast('El trabajo no está disponible para iniciar hoy.');render();return}const p=Object.assign(snap(t,TODAY),{id:nextPD(),estado:'curso',dec:null,cert:null,ext:null,cierreObs:'',hist:[{t:'25 sep 16:10',who:'Laura Méndez',a:'Planificado',c:''},{t:nowT(),who:meN(),a:'Parte iniciado',c:''}]});
    p.fin=p.dia>=t.dias-1?'fin':'sigue';p.ejec=newEjec(p);S.partes.push(p);S.sel=p.id;S.step=0;S.back='o-day';go('o-edit')},
  'o-open':d=>{S.sel=d.id;S.back='o-day';const p=byId(d.id);S.step=0;if(p.estado==='obs'){const c=errs(p)[0];if(c)S.step=STEP_OF[c[2]]}go('o-edit')},
  'o-step':d=>{S.step=Number(d.i);render()},
  'o-check':d=>{const e=cur().ejec;e.check[d.k]=!e.check[d.k];render()},
  'o-ptnow':()=>{const p=cur(),e=p.ejec;e.permiso=e.permiso||{num:'',firmo:'',hora:''};e.permiso.hora=hm();if(!e.permiso.firmo)e.permiso.firmo=OPSUP[p.op];render()},
  'o-clima':()=>{const e=cur().ejec;e.clima={t:'11',v:'42',r:'68',dir:'SO',cond:'Ventoso',src:'app',at:hm()};toast('Clima actualizado desde la app de la tablet');render()},
  'o-pres':d=>{const x=cur().ejec.personal[d.i];x.pres=!x.pres;render()},
  'o-allz':()=>{const ps=cur().ejec.personal,j=ps[0];ps.forEach(x=>{if(x!==j&&x.pres){x.base=j.base;x.zona=j.zona;x.out=j.out}});render()},
  'o-addp':d=>{cur().ejec.personal.push({n:d.n,rol:ROLEP[d.n]||'Operario',base:'',zona:'',out:'',pres:true,add:true});render()},
  'o-delp':d=>{cur().ejec.personal.splice(Number(d.i),1);render()},
  'o-adde':d=>{cur().ejec.equipos.push({c:d.c,km:'',obs:''});render()},
  'o-dele':d=>{cur().ejec.equipos.splice(Number(d.i),1);render()},
  'o-addr':d=>{const p=cur(),r=p.ejec.reg;const lastA=r.reduce((m,x)=>mins(x.a)>mins(m)?x.a:m,r.length?r[0].a:null);const de=lastA||(d.c==='tr'?'06:45':p.ejec.llegada||'07:30');
    const it={c:d.c,de,a:addM(de,d.c==='rf'?30:60),d:d.d||'',q:'',u:d.c==='vi'?'km/h':'',det:''};if(d.d)it.u=unitOf(p.ct,d.d);r.push(it);render();
    if((d.c==='op'&&!d.d)||d.c==='es'||d.c==='vi')setTimeout(()=>{const el=document.getElementById((d.c==='vi'?'f-rq':'f-rd')+(r.length-1));if(el)el.focus()},20)},
  'o-delr':d=>{cur().ejec.reg.splice(Number(d.i),1);render()},
  'o-delf':d=>{cur().ejec.fotos.splice(Number(d.i),1);render()},
  'o-sigclear':()=>{cur().ejec.firma=null;render()},
  'o-fin':d=>{const p=cur();p.fin=d.v;if(d.v==='ext'&&!p.ext)p.ext={dias:1,motivo:''};render()},
  'o-extd':d=>{const p=cur();p.ext.dias=Math.max(1,Math.min(10,p.ext.dias+Number(d.d)));render()},
  'o-send':()=>{const p=cur();if(errs(p).length)return;const re=p.estado==='obs';const t=trab(p.pl);p.estado='env';p.dec=null;delete p.cola;
    p.hist.push({t:nowT(),who:meN(),a:re?'Reenviado con correcciones':'Enviado para aprobación',c:''});
    if(p.fin==='fin'&&!t.cierre){const ant=p.dia<t.dias-1;t.cierre={fecha:p.fecha,parte:p.id,who:meN(),t:nowT(),obs:p.cierreObs,anticipado:ant};
      if(ant){const old=t.dias;t.dias=p.dia+1;t.hist.push({t:nowT(),who:meN(),a:`Trabajo cerrado antes de lo planificado: ${old} → ${t.dias} días`,c:p.cierreObs})}else t.hist.push({t:nowT(),who:meN(),a:'Trabajo cerrado por el jefe de cuadrilla',c:p.cierreObs})}
    if(p.fin==='ext'&&!t.ext){t.ext={dias:p.ext.dias,motivo:p.ext.motivo,who:meN(),t:nowT(),parte:p.id};t.hist.push({t:nowT(),who:meN(),a:`Pidió ${p.ext.dias} día(s) más`,c:p.ext.motivo})}
    UI.modal={kind:'sent',id:p.id};render()},
  'v-filter':d=>{S.vf=d.f;S.vsel=null;UI.vcom='';UI.verr='';render()},
  'v-sel':d=>{S.vsel=d.id;UI.vcom='';UI.verr='';render()},
  'v-ok':()=>{const p=byId(S.vsel);if(errs(p).length)return;const com=UI.vcom.trim();p.estado='apr';p.dec={d:'ok',who:meN(),t:nowT(),com};p.hist.push({t:nowT(),who:meN(),a:'Aprobado',c:com});UI.vcom='';toast(`${p.id} aprobado · pasa a certificación de ${OPS[p.op]}`);S.vsel=null;render()},
  'v-obs':()=>{const p=byId(S.vsel);const com=UI.vcom.trim();if(!com){UI.verr='Escribí qué tiene que corregir la cuadrilla para poder devolver el parte.';render();setTimeout(()=>{const t=$('#v-com');if(t)t.focus()},20);return}
    p.estado='obs';p.dec={d:'obs',who:meN(),t:nowT(),com};p.hist.push({t:nowT(),who:meN(),a:'Devuelto con observaciones',c:com});UI.vcom='';toast(`${p.id} devuelto a ${recOf(p.rec).n}`);S.vsel=null;render()},
  'c-filter':d=>{S.cf=d.f;S.csel=null;UI.vcom='';UI.verr='';UI.csig=null;render()},
  'c-sel':d=>{S.csel=d.id;UI.vcom='';UI.verr='';UI.csig=null;render()},
  'c-sigclear':()=>{UI.csig=null;render()},
  'c-ok':()=>{const p=byId(S.csel);if(!UI.csig){UI.verr='Firmá en el recuadro para certificar el parte.';render();return}const com=UI.vcom.trim();const who=whoCli(p);p.estado='cert';p.cert={d:'ok',who,t:nowT(),com,firma:UI.csig};p.hist.push({t:nowT(),who,a:'Certificado y firmado',c:com});UI.vcom='';UI.csig=null;toast(`${p.id} certificado y firmado`);S.csel=null;render()},
  'c-obs':()=>{const p=byId(S.csel);const com=UI.vcom.trim();if(!com){UI.verr='Escribí el motivo de la observación para que VDS pueda corregir el parte.';render();setTimeout(()=>{const t=$('#v-com');if(t)t.focus()},20);return}
    const who=whoCli(p);p.estado='obs';p.dec={d:'obs',who,t:nowT(),com};p.hist.push({t:nowT(),who,a:'Observado por el cliente',c:com});UI.vcom='';UI.csig=null;toast(`${p.id} observado · vuelve a VDS`);S.csel=null;render()}
};
function submitTrab(){
  const M=UI.modal,f=M.f;M.err={};
  if(!f.pozo.trim())M.err.pozo='Indicá el pozo, la locación o la instalación.';
  if(!f.prev.length)M.err.prev='Elegí al menos una tarea prevista.';
  if(!f.pers.length)M.err.pers='Asigná al menos una persona.';
  if(M.err.pozo||M.err.prev||M.err.pers){render();return}
  const vals={ct:f.ct,imp:f.imp,rec:f.rec,yac:f.yac,pozo:f.pozo.trim(),inicio:f.inicio,dias:f.dias,prio:f.prio,ptw:f.ptw,sup:f.sup,rt:f.rt,prev:f.prev.slice(),ind:f.ind.trim(),pers:f.pers.slice(),eqs:f.eqs.slice()};
  if(M.edit){const t=trab(M.edit);const ch=[];
    [['ct','contrato'],['imp','imputación'],['rec','recurso'],['yac','yacimiento'],['pozo','locación'],['inicio','inicio'],['dias','duración'],['prio','prioridad'],['ptw','permiso'],['sup','supervisor'],['rt','responsable técnico'],['ind','indicaciones']].forEach(([k,l])=>{if(String(t[k])!==String(vals[k]))ch.push(l)});
    if(t.prev.join('|')!==vals.prev.join('|'))ch.push('tareas');if(t.pers.join('|')!==vals.pers.join('|'))ch.push('personas');if(t.eqs.join('|')!==vals.eqs.join('|'))ch.push('equipos');
    Object.assign(t,vals);
    t.hist.push({t:nowT(),who:meN(),a:'Editado: '+(ch.join(', ')||'sin cambios'),c:''});UI.modal=null;UI.drawer=t.id;toast(`${t.id} actualizado`);render();return}
  const n=Math.max(...S.trabajos.map(t=>Number(t.id.slice(3))))+1;
  const id='PL-'+String(n).padStart(3,'0');
  const t=Object.assign({id,cierre:null,ext:null,hist:[{t:nowT(),who:meN(),a:'Planificado',c:''}]},vals);
  S.trabajos.push(t);UI.modal=null;
  const cl=clashes(t);toast(`${id} planificado · ${recOf(f.rec).n}, ${fDay(f.inicio)} → ${fDay(tEnd(t))}${cl.length?' · se superpone con '+cl.map(x=>x.id).join(', '):''}`);render();
}
function submitHab(){const f=UI.modal.f;const k=f.s+'|'+f.op;
  if(f.sin)delete S.hab[k];else{if(!f.vence){toast('Elegí la fecha de vencimiento');render();return}S.hab[k]={vence:f.vence}}
  UI.modal=null;toast(`Habilitación de ${f.s} para ${OPS[f.op]} actualizada`);render()}
function onFiles(inp){
  const e=cur().ejec;const files=[...inp.files].slice(0,8);let pending=files.length;
  files.forEach(file=>{const r=new FileReader();r.onload=()=>{const im=new Image();im.onload=()=>{const k=Math.min(1,900/Math.max(im.width,im.height));const c=document.createElement('canvas');c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);
    e.fotos.push({src:c.toDataURL('image/jpeg',.75),cap:file.name.replace(/\.[^.]+$/,'')});if(--pending===0)render()};im.onerror=()=>{if(--pending===0)render()};im.src=r.result};r.readAsDataURL(file)});
}


features=createFeatureHost({
  state:()=>S, esc, ic, today:()=>TODAY, work:trab, person:meN,
  save, render, toast, go, home:()=>HOME[S.user],
  contract:CT, operators:OPS, equipment:EQ,
  download:(name,content,type='application/json')=>{const blob=new Blob([content],{type});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000)},
  operatorResource:()=>USERS.operador.rec,
  exportState:()=>repository.export(rawState)
});
adminConsole=createAdminConsole({state:()=>rawState,esc,roles:ROLE_N,resources:RECURSOS,operators:OPS,render,toast,person:meN,refreshIdentity});
Object.assign(A, features.actions,adminConsole.actions);
for(const [name,handler] of Object.entries(A))A[name]=(data={})=>{
  if(!actionAllowed(S.user,name)){toast('Tu perfil no tiene permiso para esta acción.');render();return}
  if(data.id&&['sum','pdf','o-open','v-sel','c-sel','a-edit','a-est'].includes(name)&&!byId(data.id)){toast('Parte fuera de tu alcance.');render();return}
  if(data.pl&&name==='o-start'&&!trab(data.pl)){toast('Trabajo fuera de tu alcance.');render();return}
  if(data.id&&['t-open','t-edit'].includes(name)&&!trab(data.id)){toast('Trabajo fuera de tu alcance.');render();return}
  if(['v-ok','v-obs'].includes(name)&&byId(S.vsel)?.estado!=='env')return;
  if(['c-ok','c-obs'].includes(name)&&byId(S.csel)?.estado!=='apr')return;
  if(name==='o-open'&&S.user==='operador'&&!['curso','obs'].includes(byId(data.id)?.estado))return;
  if(name.startsWith('o-')&&!['o-start','o-open'].includes(name)&&!cur())return;
  if(name.startsWith('o-')&&!['o-start','o-open','o-step'].includes(name)&&S.user==='operador'&&cur()&&!['curso','obs'].includes(cur().estado))return;
  return handler(data);
};
function drawer(){return baselineDrawer().replace('<div class="db" data-keep="d">','<div class="db" data-keep="d">'+features.contextLinks(UI.drawer))}
function vDay(){return baselineDay()+features.journeyLinks()}

const scr=$('#screen');
let hsT=null,drag=null;
scr.addEventListener('click',ev=>{
  const t=ev.target.closest('[data-a]');
  if(t&&!t.disabled&&scr.contains(t)){ev.preventDefault();const f=A[t.dataset.a];if(f)f(t.dataset);return}
  if(!ev.target.closest('input,select,textarea,label,canvas,button,a,.gbar,.b')){scr.classList.add('hs');clearTimeout(hsT);hsT=setTimeout(()=>scr.classList.remove('hs'),650)}
});
scr.addEventListener('input',ev=>{const b=ev.target.dataset&&ev.target.dataset.bind;if(b&&!('rr' in ev.target.dataset&&ev.target.type==='search')){setBind(b,ev.target.value);save()}});
scr.addEventListener('change',ev=>{
  if(ev.target.type==='file'){onFiles(ev.target);return}
  const b=ev.target.dataset&&ev.target.dataset.bind;if(!b)return;
  setBind(b,ev.target.value);
  if('rr' in ev.target.dataset)render();else save();
});
scr.addEventListener('submit',async ev=>{ev.preventDefault();
  if(ev.target.id.startsWith('admin-')){await adminConsole.submit(ev.target);return}
  if(features.handleSubmit(ev))return;
  if(ev.target.id==='loginf'){
    const L=UI.login,username=L.u,password=L.p;const button=ev.target.querySelector('button[type="submit"]');button.disabled=true;
    try{const account=await identity.signIn(username,password);S.accountId=account.id;refreshIdentity();S.route=HOME[account.role];S.back=null;S.sel=null;S.vsel=null;S.csel=null;S.extWork='all';S.dct='all';S.dimp='all';UI.drawer=null;UI.modal=null;UI.login={u:'',p:'',err:''};}
    catch(error){UI.login.err=error.message}
    render();return;
  }
  if(ev.target.id==='trabf'&&canPlan())submitTrab();
  if(ev.target.id==='habf'&&isAdm())submitHab();
});
/* Gantt: arrastrar para mover, borde derecho para estirar o acortar */
scr.addEventListener('pointerdown',ev=>{
  const bar=ev.target.closest('.gbar');if(!bar)return;
  const t=trab(bar.dataset.id),track=bar.parentElement;
  const h=ev.target.dataset&&ev.target.dataset.h;
  drag={bar,t,mode:h==='r'?'r':h==='l'?'l':'m',x0:ev.clientX,px:track.getBoundingClientRect().width/28,o:{i:t.inicio,d:t.dias},n:{i:t.inicio,d:t.dias},moved:false,lock:started(t),closed:!!t.cierre,min:minDias(t),ok:canPlan()};
  bar.setPointerCapture(ev.pointerId);ev.preventDefault();
});
scr.addEventListener('pointermove',ev=>{
  if(!drag)return;const dx=ev.clientX-drag.x0;if(Math.abs(dx)>5)drag.moved=true;if(!drag.moved||!drag.ok||drag.closed)return;
  const dd=Math.round(dx/drag.px),o=drag.o;let i=o.i,d=o.d;
  if(drag.mode==='r')d=Math.max(drag.min,Math.min(30,o.d+dd));
  else if(drag.lock)return;
  else if(drag.mode==='l'){const k=Math.min(dd,o.d-1);i=addDays(o.i,k);d=o.d-k;if(i<TODAY){d-=diffD(i,TODAY);i=TODAY}}
  else{i=addDays(o.i,dd);if(i<TODAY)i=TODAY}
  drag.n={i,d};drag.bar.classList.add('drag');
  drag.bar.style.left=(diffD(S.gs,i)/28*100)+'%';drag.bar.style.width=(d/28*100)+'%';
  const gl=drag.bar.querySelector('.gl');if(gl)gl.innerHTML=`<span class="mono">${drag.t.id}</span> ${d} días · ${fDay(i)} → ${fDay(addDays(i,d-1))}`;
});
const endDrag=()=>{
  if(!drag)return;const g=drag;drag=null;
  if(!g.moved){UI.drawer=g.t.id;UI.delArm=null;render();return}
  if(!g.ok){render();return}
  if(g.closed){toast(`${g.t.id} ya está cerrado. ${isAdm()?'Reabrilo desde el detalle para cambiar fechas.':'Solo administración puede reabrirlo.'}`);render();return}
  if(g.lock&&g.mode!=='r'){toast(`${g.t.id} ya tiene partes cargados: solo se puede estirar o acortar desde el final`);render();return}
  if(g.n.i!==g.o.i||g.n.d!==g.o.d)moveT(g.t,g.n.i,g.n.d);
  render();
};
scr.addEventListener('pointerup',endDrag);scr.addEventListener('pointercancel',endDrag);


S.offline=!navigator.onLine;
for(const event of ['online','offline'])window.addEventListener(event,()=>{S.offline=!navigator.onLine;render()});
render();

if(import.meta.env.PROD && 'serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
