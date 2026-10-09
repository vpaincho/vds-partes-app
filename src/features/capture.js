import { createRecordModule, field } from './shared.js';
export default createRecordModule({
  id:'capture',title:'Captura rápida',description:'Eventos durante la jornada y borradores para el parte',icon:'clock',roles:['admin','planner','operador'],createLabel:'Registrar evento de campo',
  fields:(ctx,r)=>field(ctx,'title','Evento',r.title,{required:true})+
    field(ctx,'date','Fecha',r.date||ctx.today(),{type:'date',required:true})+
    field(ctx,'time','Hora',r.time||new Date().toTimeString().slice(0,5),{type:'time',required:true})+
    field(ctx,'kind','Tipo',r.kind||'Actividad',{options:['Actividad','Traslado','Espera','Parada','Novedad'].map(x=>[x,x])})+
    field(ctx,'description','Nota / transcripción para revisar',r.description,{type:'textarea',required:true})+
    `<div class="feature-toolbar"><button class="btn" type="button" data-a="capture-voice">Dictar nota</button><span id="voice-status" class="sm" role="status"></span></div>`+
    field(ctx,'status','Estado del borrador',r.status||'Pendiente de revisión',{options:['Pendiente de revisión','Revisado','Incorporado al parte'].map(x=>[x,x])}),
  details:(ctx,r)=>`<p>${ctx.esc(r.description)}</p><div class="feature-meta">${ctx.esc(r.kind)} · ${ctx.esc(r.date)} ${ctx.esc(r.time)}</div>`,
  extraActions:(ctx,r)=>`<button class="btn sm2" data-a="capture-to-part" data-id="${r.id}">Incorporar como nota al parte</button>`
});
