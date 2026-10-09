import { createRecordModule, field } from './shared.js';
export default createRecordModule({
  id:'evidence',title:'Evidencia por actividad',description:'Fotografías antes, durante y después del trabajo',icon:'cam',roles:['admin','planner','operador'],createLabel:'Agregar evidencia',
  fields:(ctx,r,host)=>field(ctx,'title','Descripción de la evidencia',r.title,{required:true})+
    field(ctx,'activity','Actividad / tarea',r.activity,{required:true,placeholder:'Ej. Armado de cerco · lado este'})+
    field(ctx,'recordRef','Vincular a actividad registrada · opcional',r.recordRef||'',{options:[['','Sin vínculo específico'],...ctx.state().partes.filter(p=>p.pl===(r.workId||host.works()[0]?.id)&&p.ejec).flatMap(p=>p.ejec.reg.map(x=>{x.id??=crypto.randomUUID();return [p.id+'|'+x.id,p.id+' · '+x.de+' · '+(x.d||x.c)]}))]})+
    field(ctx,'stage','Momento',r.stage||'Durante',{options:['Antes','Durante','Después'].map(x=>[x,x])})+
    field(ctx,'date','Fecha',r.date||ctx.today(),{type:'date',required:true})+
    field(ctx,'location','Referencia de ubicación',r.location)+
    field(ctx,'description','Comentario',r.description,{type:'textarea'})+
    `<div class="fld"><label for="evidence-photo">Fotografía</label><input class="inp" id="evidence-photo" type="file" name="photo" accept="image/*" ${r.photo?'':'required'}></div>${r.photo?`<img class="feature-photo" src="${ctx.esc(r.photo)}" alt="${ctx.esc(r.title)}">`:''}`,
  details:(ctx,r)=>`${r.photo?`<img class="feature-photo" src="${ctx.esc(r.photo)}" alt="${ctx.esc(r.title)}">`:''}<p><b>${ctx.esc(r.stage)}:</b> ${ctx.esc(r.activity)}</p>${r.description?`<p>${ctx.esc(r.description)}</p>`:''}<div class="feature-meta">${ctx.esc(r.location||'Ubicación no informada')} · ${ctx.esc(r.date)}</div>`
});
