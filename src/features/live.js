import { createRecordModule, field } from './shared.js';
export default createRecordModule({
  id:'live',title:'Seguimiento de jornada',description:'Último avance informado por trabajo · actualizado desde este dispositivo',icon:'chart',roles:['admin','planner','operador'],createLabel:'Actualizar avance',
  fields:(ctx,r)=>field(ctx,'title','Actividad seguida',r.title,{required:true})+
    field(ctx,'target','Objetivo previsto',r.target,{type:'number',min:0,step:'any',required:true})+
    field(ctx,'completed','Cantidad realizada',r.completed,{type:'number',min:0,step:'any',required:true})+
    field(ctx,'unit','Unidad',r.unit||'m',{required:true})+
    field(ctx,'status','Situación actual',r.status||'En ejecución',{options:['En ejecución','En espera','Detenido','Finalizado'].map(x=>[x,x])})+
    field(ctx,'blocker','Impedimento / apoyo necesario',r.blocker,{type:'textarea'})+
    field(ctx,'next','Próxima acción',r.next,{type:'textarea'}),
  parse(form){const r=Object.fromEntries(form);if(!Number.isFinite(Number(r.target))||!Number.isFinite(Number(r.completed))||Number(r.target)<0||Number(r.completed)<0)throw new Error('Indicá cantidades válidas.');return r},
  details:(ctx,r)=>{const percent=Number(r.target)>0?Math.round(Number(r.completed)/Number(r.target)*100):null;return `<div class="stats"><div class="stat"><b>${ctx.esc(r.completed)} / ${ctx.esc(r.target)}</b><span>${ctx.esc(r.unit)}</span></div><div class="stat"><b>${percent===null?'—':percent+'%'}</b><span>Avance informado</span></div></div>${r.blocker?`<p><b>Impedimento:</b> ${ctx.esc(r.blocker)}</p>`:''}${r.next?`<p><b>Próxima acción:</b> ${ctx.esc(r.next)}</p>`:''}`}
});
