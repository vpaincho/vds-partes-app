import { field } from './shared.js';
export default {
  id:'logbook',title:'Bitácora operativa',description:'Historia de locaciones, equipos y trabajos',icon:'list',roles:['admin','planner','operador'],
  render(ctx,host){
    const s=ctx.state(), e=ctx.esc, works=host.works();
    const selected=works.filter(t=>(!s.extWork||s.extWork==='all'||t.id===s.extWork)&&(!s.logLocation||s.logLocation==='all'||t.yac+' · '+t.pozo===s.logLocation));
    const ids=new Set(selected.map(t=>t.id));const events=[];
    for(const p of s.partes.filter(p=>ids.has(p.pl)&&(!s.logAsset||s.logAsset==='all'||p.ejec?.equipos.some(q=>q.c===s.logAsset))))events.push({date:p.fecha+'T12:00:00',title:p.id+' · Parte diario',workId:p.pl,description:p.ejec?.obs||'Sin observaciones',label:p.estado,part:p.id});
    for(const feature of host.modules.filter(m=>m.id!=='logbook'))for(const r of host.records(feature.id,false).filter(r=>ids.has(r.workId)&&(!s.logAsset||s.logAsset==='all'||r.asset===s.logAsset)))events.push({date:r.updatedAt,title:r.title,workId:r.workId,description:r.description||r.pending||r.instructions||r.blocker||'',label:feature.title,feature:feature.id});
    events.sort((a,b)=>b.date.localeCompare(a.date));
    const locations=[...new Set(works.map(t=>t.yac+' · '+t.pozo))].sort();
    return host.filter('logbook')+`<div class="feature-filter"><div class="fld"><label for="log-location">Locación</label><select class="inp" id="log-location" data-bind="s:logLocation" data-rr>${[['all','Todas las locaciones'],...locations.map(x=>[x,x])].map(([v,l])=>`<option value="${e(v)}" ${s.logLocation===v?'selected':''}>${e(l)}</option>`).join('')}</select></div><div class="fld"><label for="log-asset">Equipo / interno</label><select class="inp" id="log-asset" data-bind="s:logAsset" data-rr>${[['all','Todos los equipos'],...Object.entries(ctx.equipment)].map(([v,l])=>`<option value="${e(v)}" ${s.logAsset===v?'selected':''}>${e(l)}</option>`).join('')}</select></div></div><div class="pnl"><h3>${events.length} registros relacionados</h3>${events.map(r=>`<article class="timeline-event"><div class="feature-meta">${e(new Date(r.date).toLocaleString('es-AR'))} · ${e(r.label)} · ${e(host.workLabel(r.workId))}</div><h3>${e(r.title)}</h3><p>${e(r.description)}</p>${r.part?`<button class="btn sm2" data-a="sum" data-id="${e(r.part)}">Ver parte</button>`:`<button class="btn sm2" data-a="module-open" data-module="${r.feature}" data-work="${e(r.workId)}">Abrir ${e(r.label)}</button>`}</article>`).join('')||'<p class="sm">No hay registros para la selección.</p>'}</div>`;
  }
};
