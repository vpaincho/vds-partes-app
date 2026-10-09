import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetry, productMetrics } from '../src/intelligence/telemetry.js';
import { documentStore, evaluateWork } from '../src/intelligence/documents.js';
import { operationMetrics } from '../src/intelligence/operations.js';
const today='2026-10-09';
const base=()=>({user:'planner',contratos:{CT:{op:'AUP'}},trabajos:[{id:'T1',ct:'CT',rec:'C1',inicio:today,dias:3,pers:['Persona'],eqs:['E1'],prev:['Zanjeo'],yac:'Yacimiento',pozo:'Locación',dataOrigin:'recorded'}],partes:[],extensions:{enabled:{},records:{materials:[]}}});

test('telemetry excludes idle and hidden time, keeps real completed sessions, and handles disabled tracking',()=>{
  let time=0,visible=true;const state={user:'operador',extensions:{enabled:{}}};const t=createTelemetry(()=>state,{now:()=>time,visible:()=>visible});t.route('o-edit','PD1',0);time=10000;t.interaction('base');time=20000;t.interaction('km0');time=70000;t.interaction('notes');visible=false;time=80000;t.pause();visible=true;t.route('o-edit','PD1',4);time=90000;t.finish('PD1');const m=productMetrics(state);assert.equal(m.completed,1);assert.equal(m.median,30);assert.equal(m.within120,100);assert.equal(state.telemetry.events.some(x=>x.type==='field_edit'),true);assert.equal(JSON.stringify(state.telemetry).includes('password'),false);
  state.extensions.enabled.product=false;const before=state.telemetry.events.length;t.event('runtime_error');assert.equal(state.telemetry.events.length,before);
});

test('empty product metrics never invent a performance score',()=>{const m=productMetrics({});assert.equal(m.median,null);assert.equal(m.within120,null);assert.equal(m.completed,0)});

test('document evaluation is contextual and distinguishes pending, approved, expired, stale, and unknown matrix',()=>{
  const s=base(),work=s.trabajos[0],store=documentStore(s);assert.equal(evaluateWork(s,work,today).known,false);
  store.requirements.push({id:'R1',title:'Curso',kind:'Personal',operator:'AUP',activity:'Zanjeo',owner:'Documental',noticeDays:7,maxAgeDays:10,critical:true,active:true});let result=evaluateWork(s,work,today);assert.equal(result.blocked[0].status,'Sin evidencia');
  store.evidence.push({id:'E1',requirementId:'R1',subject:'Persona',status:'Pendiente de validación',validFrom:'2026-10-01',validTo:'2026-10-12',verifiedAt:today,recordedAt:today+'T10:00:00Z'});assert.equal(evaluateWork(s,work,today).blocked[0].status,'Pendiente de validación');
  store.evidence.push({...store.evidence[0],id:'E2',status:'Aprobado',recordedAt:today+'T11:00:00Z'});result=evaluateWork(s,work,today);assert.equal(result.blocked.length,0);assert.equal(result.results[0].status,'Próximo a vencer');assert.equal(evaluateWork(s,work,'2026-10-13',{now:today}).blocked[0].status,'Vencido');
  store.evidence[1].verifiedAt='2026-09-01';assert.equal(evaluateWork(s,work,today).blocked[0].status,'Verificación desactualizada');
  assert.equal(evaluateWork(s,{...work,ct:'OTHER'},today).known,false);assert.equal(evaluateWork(s,work,'2026-10-08',{now:'2026-10-08'}).blocked[0].status,'Sin evidencia');
});

test('operation metrics separate units, omit samples by default, reject overlaps, and cite causes without invented savings',()=>{
  const s=base();s.partes.push({id:'PD1',pl:'T1',ct:'CT',op:'AUP',fecha:today,estado:'env',dataOrigin:'recorded',ejec:{personal:[{pres:true,base:'06:00',out:'08:00'}],reg:[{c:'op',de:'06:00',a:'07:00',d:'Zanjeo',q:'10',u:'m'},{c:'es',de:'07:00',a:'07:30',d:'Permiso de trabajo'},{c:'tr',de:'07:30',a:'08:00'}]}});
  s.trabajos.push({...s.trabajos[0],id:'DEMO',dataOrigin:'example'});s.partes.push({...s.partes[0],id:'DEMO-PD',pl:'DEMO',dataOrigin:'example'});
  let m=operationMetrics(s,{from:today,to:'2026-10-11',today});assert.equal(m.categories.op,60);assert.equal(m.coverage,100);assert.equal(m.production[0].unit,'m');assert.equal(m.peopleHours,2);assert.equal(m.parts.length,1);assert.match(m.recommendations[0].action,/ventana de firma/);assert.equal(m.approval.median,null);
  m=operationMetrics(s,{from:today,to:'2026-10-11',today,includeExamples:true});assert.equal(m.categories.op,120);
  s.partes[0].ejec.reg[1].de='06:30';m=operationMetrics(s,{from:today,to:today,today});assert.equal(m.overlaps,1);assert.equal(m.totalMinutes,0);
});

test('planner readiness detects evidence expiring before the end of the work',()=>{
  const s=base(),store=documentStore(s);store.requirements.push({id:'R',kind:'Personal',title:'Habilitación',critical:true,noticeDays:30});store.evidence.push({requirementId:'R',subject:'Persona',validFrom:'2026-10-01',validTo:'2026-10-10',status:'Aprobado',recordedAt:today+'T00:00:00Z'});
  const m=operationMetrics(s,{from:today,to:'2026-10-11',today});assert.equal(m.readiness[0].docs.blocked[0].status,'Vencido');assert.ok(m.recommendations.some(r=>r.kind==='Documentación'));
});

test('night shifts keep elapsed duration across midnight and overlapping overnight segments are excluded',()=>{
  const s=base();s.partes.push({id:'NIGHT',pl:'T1',fecha:today,estado:'env',dataOrigin:'recorded',ejec:{personal:[{pres:true,base:'22:00',out:'06:00'}],reg:[{c:'op',de:'22:00',a:'23:00',d:'A',q:1,u:'u'},{c:'op',de:'23:00',a:'02:00',d:'A',q:1,u:'u'},{c:'op',de:'02:00',a:'06:00',d:'A',q:1,u:'u'}]}});let m=operationMetrics(s,{from:today,to:today,today});assert.equal(m.totalMinutes,480);assert.equal(m.peopleHours,8);s.partes[0].ejec.reg.push({c:'es',de:'01:00',a:'03:00',d:'Duplicado'});m=operationMetrics(s,{from:today,to:today,today});assert.equal(m.overlaps,1);
});
