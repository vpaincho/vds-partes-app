import { createRecordModule, field } from './shared.js';
export default createRecordModule({
  id:'changes',title:'Pedidos adicionales',description:'Solicitudes de la operadora y cambios de alcance',icon:'plus',roles:['admin','planner','operador'],createLabel:'Registrar solicitud',
  fields:(ctx,r)=>field(ctx,'title','Pedido adicional',r.title,{required:true})+
    field(ctx,'requestedBy','Solicitante de la operadora',r.requestedBy,{required:true})+
    field(ctx,'date','Fecha de solicitud',r.date||ctx.today(),{type:'date',required:true})+
    field(ctx,'description','Alcance solicitado',r.description,{type:'textarea',required:true})+
    field(ctx,'impact','Tiempo, personas, equipos o materiales adicionales',r.impact,{type:'textarea'})+
    field(ctx,'reference','Referencia / documento del pedido',r.reference)+
    (ctx.state().user==='operador'?`<input type="hidden" name="status" value="${ctx.esc(r.status||'Informado')}">`:
      field(ctx,'status','Decisión VDS',r.status||'Informado',{options:['Informado','En evaluación','Autorizado','Rechazado','Ejecutado'].map(x=>[x,x])})),
  details:(ctx,r)=>`<p>${ctx.esc(r.description)}</p><p><b>Solicitó:</b> ${ctx.esc(r.requestedBy)} · ${ctx.esc(r.date)}</p>${r.impact?`<p><b>Impacto informado:</b> ${ctx.esc(r.impact)}</p>`:''}${r.reference?`<p>Referencia: ${ctx.esc(r.reference)}</p>`:''}`
});
