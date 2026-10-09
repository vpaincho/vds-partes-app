import { createRecordModule, field } from './shared.js';
export default createRecordModule({
  id:'handover', title:'Relevo y pendientes', description:'Continuidad entre jornadas y entrega a la próxima cuadrilla', icon:'day',
  roles:['admin','planner','operador'], createLabel:'Entrega de jornada',
  prepare:(ctx,r)=>{if(r.id||!r.workId)return r;const parts=ctx.state().partes.filter(p=>p.pl===r.workId&&p.fecha===ctx.today()&&p.ejec);const activities=parts.flatMap(p=>p.ejec.reg.filter(x=>x.c==='op').map(x=>x.d+(x.q?' · '+x.q+' '+x.u:'')));const issues=(ctx.state().extensions?.records.issues||[]).filter(x=>x.workId===r.workId&&x.status!=='Resuelta');return {...r,completed:r.completed??activities.join('\n'),pending:r.pending??issues.map(x=>x.title+' · '+x.owner).join('\n')};},
  fields:(ctx,r)=>field(ctx,'title','Resumen de la entrega',r.title,{required:true})+
    field(ctx,'date','Jornada',r.date||ctx.today(),{type:'date',required:true})+
    field(ctx,'completed','Qué quedó terminado',r.completed,{type:'textarea'})+
    field(ctx,'pending','Qué queda pendiente',r.pending,{type:'textarea',required:true})+
    field(ctx,'conditions','Condiciones, accesos y precauciones',r.conditions,{type:'textarea'})+
    field(ctx,'next','Antes de retomar',r.next,{type:'textarea'})+
    field(ctx,'status','Estado',r.status||'Pendiente',{options:[['Pendiente','Pendiente'],['En seguimiento','En seguimiento'],['Resuelto','Resuelto']]}),
  details:(ctx,r)=>`<p><b>Terminado:</b> ${ctx.esc(r.completed||'Sin informar')}</p><p><b>Pendiente:</b> ${ctx.esc(r.pending)}</p>${r.conditions?`<p><b>Condiciones:</b> ${ctx.esc(r.conditions)}</p>`:''}${r.next?`<p><b>Antes de retomar:</b> ${ctx.esc(r.next)}</p>`:''}<div class="feature-meta">${r.readBy?`Leído por ${ctx.esc(r.readBy)} · ${ctx.esc(new Date(r.readAt).toLocaleString('es-AR'))}`:'Sin confirmación de lectura'}</div>`,
  extraActions:(ctx,r)=>`<button class="btn sm2" data-a="handover-read" data-id="${r.id}">Confirmar lectura</button>`
});
