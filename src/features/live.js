import { createRecordModule, field } from './shared.js';
export default createRecordModule({
  id:'live',title:'Seguimiento de jornada',description:'Último avance informado por trabajo · actualizado desde este dispositivo',icon:'chart',roles:['admin','planner','operador'],createLabel:'Actualizar avance',
  fields:(ctx,r)=>field(ctx,'source','Origen del avance',r.source||'Parte diario',{options:[['Parte diario','Cantidades del parte · sin duplicar carga'],['Manual','Avance preliminar manual']]})+field(ctx,'date','Jornada',r.date||ctx.today(),{type:'date',required:true})+
field(ctx,'title','Actividad seguida',r.title,{required:true})+
    field(ctx,'target','Objetivo previsto',r.target,{type:'number',min:0,step:'any',required:true})+
    field(ctx,'completed','Cantidad preliminar · solo si elegís origen manual',r.completed,{type:'number',min:0,step:'any'})+
    field(ctx,'unit','Unidad',r.unit||'m',{required:true})+
    field(ctx,'status','Situación actual',r.status||'En ejecución',{options:['En ejecución','En espera','Detenido','Finalizado'].map(x=>[x,x])})+
    field(ctx,'blocker','Impedimento / apoyo necesario',r.blocker,{type:'textarea'})+
    field(ctx,'next','Próxima acción',r.next,{type:'textarea'}),
  parse(form){const r=Object.fromEntries(form);if(!['Parte diario','Manual'].includes(r.source)||!Number.isFinite(Number(r.target))||Number(r.target)<0||(r.source==='Manual'&&(r.completed===''||!Number.isFinite(Number(r.completed))||Number(r.completed)<0)))throw new Error('Indicá cantidades válidas.');return r},
  details:(ctx,r)=>{const derived=(ctx.state().partes||[]).filter(p=>p.pl===r.workId&&p.fecha===(r.date||ctx.today())&&p.ejec).flatMap(p=>p.ejec.reg).filter(x=>x.c==='op'&&x.d===r.title&&x.u===r.unit);const done=r.source==='Parte diario'?derived.reduce((sum,x)=>sum+(Number(x.q)||0),0):Number(r.completed);const percent=Number(r.target)>0?Math.round(done/Number(r.target)*100):null;return `<div class="stats"><div class="stat"><b>${ctx.esc(done)} / ${ctx.esc(r.target)}</b><span>${ctx.esc(r.unit)}</span></div><div class="stat"><b>${percent===null?'—':percent+'%'}</b><span>Avance informado</span></div></div><p class="sm">${ctx.esc(r.source||'Manual')} · ${ctx.esc(r.date||'Fecha no registrada')} ${r.source==='Parte diario'&&!derived.length?'· sin actividad coincidente todavía':''}</p>${r.blocker?`<p><b>Impedimento:</b> ${ctx.esc(r.blocker)}</p>`:''}${r.next?`<p><b>Próxima acción:</b> ${ctx.esc(r.next)}</p>`:''}`}
});
