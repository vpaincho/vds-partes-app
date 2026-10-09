import { createRecordModule, field } from './shared.js';
export default createRecordModule({
  id:'issues',title:'Novedades y acciones',description:'Problemas de campo, responsables y resolución',icon:'flag',roles:['admin','planner','operador'],
  createLabel:'Registrar novedad',
  fields:(ctx,r)=>field(ctx,'title','Qué ocurrió',r.title,{required:true})+
    field(ctx,'kind','Tipo',r.kind||'Operación',{options:['Operación','Equipo','Materiales','Acceso','Seguridad','Calidad'].map(x=>[x,x])})+
    field(ctx,'asset','Equipo / interno involucrado',r.asset,{options:[['','No aplica'],...Object.entries(ctx.equipment).map(([k,v])=>[k,k+' · '+v])]})+
    field(ctx,'description','Descripción y acción necesaria',r.description,{type:'textarea',required:true})+
    field(ctx,'owner','Responsable / área',r.owner,{required:true,placeholder:'Ej. Mantenimiento · Juan'})+
    field(ctx,'priority','Prioridad',r.priority||'Media',{options:['Baja','Media','Alta','Urgente'].map(x=>[x,x])})+
    field(ctx,'due','Fecha objetivo',r.due,{type:'date'})+
    field(ctx,'status','Estado',r.status||'Abierta',{options:['Abierta','En tratamiento','Resuelta'].map(x=>[x,x])})+
    field(ctx,'resolution','Respuesta / resolución',r.resolution,{type:'textarea'}),
  parse(form){const r=Object.fromEntries(form);if(r.status==='Resuelta'&&!r.resolution.trim())throw new Error('Indicá cómo se resolvió la novedad.');return r},
  details:(ctx,r)=>`<p>${ctx.esc(r.description)}</p><div class="feature-meta"><span>${ctx.esc(r.kind)}</span><span>${ctx.esc(r.priority)}</span><span>Responsable: ${ctx.esc(r.owner)}</span>${r.asset?`<span>Interno ${ctx.esc(r.asset)}</span>`:''}${r.due?`<span>Objetivo: ${ctx.esc(r.due)}</span>`:''}</div>${r.resolution?`<p><b>Resolución:</b> ${ctx.esc(r.resolution)}</p>`:''}`
});
