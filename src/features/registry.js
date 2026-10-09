import product from './product-control.js';
import operations from './operations-control.js';
import documents from './document-control.js';
import quick from './quick-part.js';
import handover from './handover.js';
import issues from './issues.js';
import changes from './changes.js';
import materials, { materialLine } from './materials.js';
import capture from './capture.js';
import evidence from './evidence.js';
import live from './live.js';
import logbook from './logbook.js';
import { initializeExtensions, upsertRecord, visibleWorks } from './model.js';
import { field } from './shared.js';

// A module contributes its own view, fields, parsing and permissions.
// Removing an import/entry removes it from the app; switching it off preserves records.
export const featureModules = [handover, issues, changes, materials, logbook, capture, evidence, live, product, operations, documents, quick];

export function createFeatureHost(ctx) {
  const drafts={},errors={};let recognition=null;
  const store=()=>initializeExtensions(ctx.state(),featureModules.map(m=>m.id));
  const allowed=m=>m?.roles.includes(ctx.state().user);
  const enabled=m=>store().enabled[m.id]&&allowed(m);
  const get=id=>featureModules.find(m=>m.id===id||'x-'+m.id===id);
  const works=()=>visibleWorks(ctx.state(),ctx.operatorResource?.()||'C-03');
  const canEdit=m=>enabled(m)&&(m.editRoles||m.roles).includes(ctx.state().user);
  const visibleRecord=r=>works().some(t=>t.id===r.workId);
  const records=(id,filter=true)=>store().records[id].filter(r=>visibleRecord(r)&&(!filter||!ctx.state().extWork||ctx.state().extWork==='all'||r.workId===ctx.state().extWork));
  const workLabel=id=>{const t=ctx.work(id);return t?`${t.id} · ${t.yac} · ${t.pozo}`:'Trabajo no disponible'};
  const draft=id=>{const d=drafts[id]||{workId:ctx.state().extWork==='all'?'':ctx.state().extWork};return get(id)?.prepare?.(ctx,d)||d};
  const workField=value=>field(ctx,'workId','Trabajo',value||works()[0]?.id,{required:true,options:works().map(t=>[t.id,workLabel(t.id)])});
  const filter=id=>`<div class="feature-filter"><div class="fld"><label for="module-work-filter">Trabajo</label><select class="inp" id="module-work-filter" data-bind="s:extWork" data-rr>${[['all','Todos mis trabajos'],...works().map(t=>[t.id,workLabel(t.id)])].map(([v,l])=>`<option value="${ctx.esc(v)}" ${(ctx.state().extWork||'all')===v?'selected':''}>${ctx.esc(l)}</option>`).join('')}</select></div><button class="btn" data-a="module-export" data-module="${id}">Exportar registros</button></div>`;
  const formError=id=>errors[id]?`<p class="field-error" role="alert">${ctx.esc(errors[id])}</p>`:'';
  const findRecord=(module,id)=>{const m=get(module);if(!enabled(m))throw new Error('Módulo no disponible para tu perfil.');const r=records(m.id,false).find(r=>r.id===id);if(!r)throw new Error('Registro no disponible.');return r};
  const contextLinks=workId=>`<div class="module-links">${featureModules.filter(m=>enabled(m)&&m.contextual!==false).map(m=>`<button class="btn sm2" data-a="module-open" data-module="${m.id}" data-work="${ctx.esc(workId||'all')}">${ctx.ic(m.icon)}${ctx.esc(m.title)}</button>`).join('')}</div>`;
  const card=(m,r)=>`<article class="feature-card"><div class="feature-meta"><span>${ctx.esc(workLabel(r.workId))}</span>${r.status?`<span class="feature-status">${ctx.esc(r.status)}</span>`:''}</div><h3>${ctx.esc(r.title)}</h3>${m.details(ctx,r)}<div class="feature-meta">${ctx.esc(r.createdBy)} · actualizado ${ctx.esc(new Date(r.updatedAt).toLocaleString('es-AR'))}${r.history.length?` · ${r.history.length} revisión(es)`:''}</div><div class="feature-actions">${canEdit(m)?`<button class="btn sm2" data-a="module-edit" data-module="${m.id}" data-id="${r.id}">Editar</button>`:''}${m.extraActions?.(ctx,r)||''}</div></article>`;
  const actions={
    'module-home':()=>ctx.go(ctx.home()),
    'module-open':d=>{const m=get(d.module);if(!enabled(m))return;ctx.state().extWork=d.work||'all';delete drafts[m.id];delete errors[m.id];ctx.go('x-'+m.id)},
    'module-cancel':d=>{delete drafts[d.module];delete errors[d.module];ctx.render()},
    'module-edit':d=>{try{const m=get(d.module);if(!canEdit(m))return;drafts[m.id]=structuredClone(findRecord(m.id,d.id));errors[m.id]='';ctx.render()}catch(error){ctx.toast(error.message);ctx.render()}},
    'module-toggle':d=>{if(ctx.state().user!=='admin')return;const m=get(d.module);if(!m)return;store().enabled[m.id]=!store().enabled[m.id];ctx.render()},
    'module-export':d=>{const m=get(d.module);if(!enabled(m))return;ctx.download(`VDS_${m.id}_${ctx.today()}.json`,JSON.stringify({module:m.id,records:records(m.id,false)},null,2))},
    'module-backup':()=>{if(ctx.state().user==='admin')ctx.download(`VDS_respaldo_${ctx.today()}.json`,ctx.exportState())},
    'handover-read':d=>{const r=findRecord('handover',d.id);upsertRecord(store().records.handover,{readBy:ctx.person(),readAt:new Date().toISOString()},{id:r.id,actor:ctx.person()});ctx.toast('Entrega leída');ctx.render()},
    'material-add':()=>{if(!canEdit(materials))return;const el=document.getElementById('material-lines');el?.insertAdjacentHTML('beforeend',materialLine(ctx,{},el.children.length))},
    'material-remove':()=>{},
    'capture-voice':()=>{
      const status=document.getElementById('voice-status');const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
      if(!Speech){status.textContent='Dictado no disponible en este navegador. Podés escribir la nota.';return}
      if(recognition){recognition.stop();return}
      recognition=new Speech();recognition.lang='es-AR';recognition.interimResults=false;status.textContent='Escuchando… tocá de nuevo para detener.';
      recognition.onresult=event=>{const input=document.getElementById('module-description');input.value=(input.value+' '+event.results[0][0].transcript).trim();status.textContent='Revisá la transcripción antes de guardar.'};
      recognition.onerror=()=>{status.textContent='No se pudo dictar. Revisá el permiso de micrófono o escribí la nota.'};
      recognition.onend=()=>{recognition=null;if(status.textContent.startsWith('Escuchando'))status.textContent='Dictado finalizado.'};recognition.start();
    },
    'capture-to-activity':d=>{
      try{const r=findRecord('capture',d.id);const p=ctx.state().partes.find(p=>p.pl===r.workId&&p.fecha===r.date&&['curso','obs'].includes(p.estado)&&p.ejec);if(!p)throw new Error('Abrí un parte editable para ese trabajo y fecha.');if(r.incorporatedPart)throw new Error('Este evento ya fue incorporado.');
      const category={Actividad:'op',Traslado:'tr',Espera:'es',Parada:'vi'}[r.kind];if(!category||!r.activity||!r.from||!r.to||r.from>=r.to)throw new Error('Revisá tipo, actividad y horario del evento.');
      if(category==='op'&&(!(Number(r.quantity)>0)||!r.unit))throw new Error('La actividad operativa requiere cantidad y unidad.');
      if(p.ejec.reg.some(x=>r.from<x.a&&r.to>x.de))throw new Error('El evento se superpone a un tramo existente. Revisá antes de incorporar.');
      p.ejec.reg.push({id:crypto.randomUUID(),c:category,d:r.activity,de:r.from,a:r.to,q:r.quantity||'',u:r.unit||'',det:r.description});
      upsertRecord(store().records.capture,{status:'Incorporado al parte',incorporatedPart:p.id,incorporation:'activity'},{id:r.id,actor:ctx.person()});ctx.toast('Evento incorporado como actividad');ctx.render();
      }catch(error){ctx.toast(error.message);ctx.render()}
    },
    'capture-to-part':d=>{
      const r=findRecord('capture',d.id);const p=ctx.state().partes.find(p=>p.pl===r.workId&&p.fecha===r.date&&['curso','obs'].includes(p.estado)&&p.ejec);
      if(!p){ctx.toast('Abrí primero un parte editable para ese trabajo y fecha.');ctx.render();return}
      if(r.incorporatedPart){ctx.toast('Esta nota ya fue incorporada a '+r.incorporatedPart);ctx.render();return}
      p.ejec.obs=(p.ejec.obs+'\n'+r.time+' · '+r.kind+': '+r.description).trim();
      upsertRecord(store().records.capture,{status:'Incorporado al parte',incorporatedPart:p.id},{id:r.id,actor:ctx.person()});ctx.toast('Nota incorporada a '+p.id);ctx.render();
    }
  };
  const host={modules:featureModules,works,canEdit,draft,records,workLabel,workField,filter,formError,card};
  const imageData=async file=>{if(file.size>15*1024*1024)throw new Error('La foto supera 15 MB. Elegí una imagen más pequeña.');if(!file.type.startsWith('image/'))throw new Error('Elegí una imagen válida.');const bitmap=await createImageBitmap(file);const scale=Math.min(1,1400/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=bitmap.width*scale;canvas.height=bitmap.height*scale;canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return canvas.toDataURL('image/jpeg',0.8)};
  async function persistForm(form){
    const m=get(form.dataset.module);if(!canEdit(m))return;
    const current=draft(m.id);const fd=new FormData(form);
    try{
      if(!works().some(t=>t.id===fd.get('workId')))throw new Error('Elegí un trabajo de tu ámbito.');
      let record;
      if(m.id==='evidence'){record=Object.fromEntries(fd);const file=fd.get('photo');record.photo=file?.size?await imageData(file):current.photo;if(record.recordRef){const [partId,activityId]=record.recordRef.split('|');const p=ctx.state().partes.find(p=>p.id===partId&&p.pl===record.workId);if(!p?.ejec.reg.some(x=>x.id===activityId))throw new Error('La actividad seleccionada no pertenece a ese trabajo.');record.partId=partId;record.activityId=activityId}if(!record.photo)throw new Error('Agregá una fotografía.');}
      else record=m.parse(fd);
      if(m.id==='changes'&&ctx.state().user==='operador')record.status=current.status||'Informado';
      if(m.id==='handover'&&current.id){record.readBy=null;record.readAt=null;}
      if(current.id) findRecord(m.id,current.id);
      upsertRecord(store().records[m.id],record,{id:current.id,actor:ctx.person()});
      delete drafts[m.id];delete errors[m.id];ctx.toast('Registro guardado');ctx.render();
    }catch(error){drafts[m.id]={...current,...Object.fromEntries(fd)};if(m.id==='materials')drafts[m.id].items=fd.getAll('material').map((description,i)=>({description,requested:fd.getAll('requested')[i],unit:fd.getAll('unit')[i],withdrawn:fd.getAll('withdrawn')[i],used:fd.getAll('used')[i]}));errors[m.id]=error.message;ctx.render()}
  }
  return {
    actions,
    find:route=>{const m=get(route);return m&&enabled(m)?m:null},
    navigation:role=>featureModules.filter(m=>store().enabled[m.id]&&m.roles.includes(role)).map(m=>['x-'+m.id,m.title,m.icon]),
    view:route=>{const m=get(route);return enabled(m)?m.render(ctx,host):'<div class="pnl">Módulo desactivado o fuera de tu ámbito.</div>'},
    contextLinks,
    journeyLinks:()=>`<section class="journey-extras"><h3>Herramientas de campo</h3>${contextLinks('all')}</section>`,
    settings:()=>ctx.state().user==='admin'?`<div class="pnl" style="margin-bottom:18px"><h3>Módulos de la aplicación</h3><p class="sm">Activá o desactivá funcionalidades. Los registros se conservan al desactivar un módulo.</p><div class="module-settings">${featureModules.map(m=>`<div class="module-setting"><div><b>${ctx.esc(m.title)}</b><div class="sm">${ctx.esc(m.description)}</div></div><button class="btn sm2" data-a="module-toggle" data-module="${m.id}" aria-pressed="${store().enabled[m.id]}">${store().enabled[m.id]?'Desactivar':'Activar'}</button></div>`).join('')}</div><button class="btn" style="margin-top:16px" data-a="module-backup">Exportar respaldo completo</button></div>`:'',
    handleSubmit:event=>{if(!event.target.dataset.module)return false;void persistForm(event.target);return true},
    afterRender:()=>{document.querySelectorAll('[data-a="material-remove"]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();if(canEdit(materials))button.closest('.material-line').remove()}))}
  };
}
