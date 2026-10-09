import { productInsights } from './telemetry.js';
import { documentStore, evaluateWork } from './documents.js';
import { canManageDocuments } from '../features/document-control.js';
export function createControlHost(ctx){
  const enabled=id=>ctx.state().extensions?.enabled?.[id]!==false;
  const audit=(action,subject)=>documentStore(ctx.state()).audit.push({at:new Date().toISOString(),actor:ctx.person(),action,subject});
  const actions={
    'product-propose':d=>{const s=ctx.state();if(s.user!=='admin'||!enabled('product'))return;const proposal=productInsights(s).find(r=>r.id===d.id);if(!proposal)return;s.productOpportunities??=[];if(s.productOpportunities.some(x=>x.signal===d.id&&!['Implementada','Descartada'].includes(x.status))){ctx.toast('La señal ya tiene una oportunidad abierta.');ctx.render();return}s.productOpportunities.unshift({...proposal,signal:d.id,id:crypto.randomUUID(),owner:'Por asignar',effort:'Por evaluar',status:'Por evaluar',createdAt:new Date().toISOString()});ctx.toast('Oportunidad registrada');ctx.render()},
    'ops-reset':()=>{if(ctx.state().user!=='planner')return;for(const key of ['opsFrom','opsTo','opsOperator','opsResource','opsLocation','opsExamples'])delete ctx.state()[key];ctx.render()},
    'document-toggle':d=>{if(!enabled('documents')||!canManageDocuments(ctx.state()))return;const r=documentStore(ctx.state()).requirements.find(x=>x.id===d.id);if(!r)return;r.active=r.active===false;audit(r.active?'Requisito reactivado':'Requisito desactivado',r.id);ctx.render()}
  };
  function handleSubmit(event){const form=event.target;
    if(!['product-opportunity','document-requirement','document-evidence'].includes(form.id)&&!form.dataset.productUpdate)return false;
    const s=ctx.state(),data=Object.fromEntries(new FormData(form));
    try{
      if(form.id==='product-opportunity'||form.dataset.productUpdate){if(s.user!=='admin'||!enabled('product'))return true;s.productOpportunities??=[];
        if(form.dataset.productUpdate){const r=s.productOpportunities.find(x=>x.id===form.dataset.productUpdate);if(!r)return true;if(!['Por evaluar','Priorizada','En desarrollo','Implementada','Descartada'].includes(data.status))throw new Error('Estado inválido.');r.history??=[];r.history.push({at:new Date().toISOString(),status:r.status,result:r.result||''});Object.assign(r,data,{updatedAt:new Date().toISOString()});}
        else{if(!data.title?.trim()||!data.evidence?.trim()||!data.hypothesis?.trim()||!data.owner?.trim())throw new Error('Completá problema, evidencia, hipótesis y responsable.');s.productOpportunities.unshift({...data,id:crypto.randomUUID(),status:'Por evaluar',createdAt:new Date().toISOString()})}
      }else{
        if(!enabled('documents')||!canManageDocuments(s))return true;const store=documentStore(s);
        if(form.id==='document-requirement'){
          if(!data.title.trim()||!data.owner.trim()||!['Personal','Equipo'].includes(data.kind)||!Number.isFinite(Number(data.noticeDays))||Number(data.noticeDays)<0||(data.maxAgeDays!==''&&(!(Number(data.maxAgeDays)>0)||!Number.isFinite(Number(data.maxAgeDays)))))throw new Error('Indicá requisito, responsable y plazos válidos.');
          if(data.operator&&!ctx.operators[data.operator])throw new Error('Operadora inválida.');
          const subjects=data.kind==='Personal'?ctx.people:Object.keys(ctx.equipment);if(data.subject&&!subjects.includes(data.subject))throw new Error('La persona o interno debe existir en el core actual.');
          store.requirements.push({...data,id:crypto.randomUUID(),critical:data.critical==='yes',active:true,createdAt:new Date().toISOString()});audit('Requisito creado',data.title);
        }else{
          const r=store.requirements.find(x=>x.id===data.requirementId&&x.active!==false);if(!r)throw new Error('Seleccioná un requisito activo.');const subjects=r.kind==='Personal'?ctx.people:Object.keys(ctx.equipment);
          if(!subjects.includes(data.subject)||(r.subject&&r.subject!==data.subject))throw new Error('Seleccioná la persona o interno al que aplica el requisito.');
          if(!data.reference.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(data.validFrom)||!/^\d{4}-\d{2}-\d{2}$/.test(data.validTo)||!Number.isFinite(Date.parse(data.validFrom))||!Number.isFinite(Date.parse(data.validTo))||data.validTo<data.validFrom||!Number.isFinite(Date.parse(data.verifiedAt))||data.verifiedAt>ctx.today())throw new Error('Completá referencia y fechas válidas. La verificación no puede estar en el futuro.');
          if(!['Pendiente de validación','Aprobado','Rechazado'].includes(data.status))throw new Error('Resultado de revisión inválido.');
          store.evidence.push({...data,id:crypto.randomUUID(),recordedAt:new Date().toISOString(),reviewedBy:ctx.person()});audit('Evidencia registrada',data.subject);
        }
      }
      ctx.toast('Registro guardado');ctx.render();
    }catch(error){let box=form.querySelector('.control-error');if(!box){box=document.createElement('p');box.className='field-error control-error';box.setAttribute('role','alert');form.prepend(box)}box.textContent=error.message;}
    return true;
  }
  const summary=work=>{if(!enabled('documents'))return '';const result=evaluateWork(ctx.state(),work,ctx.today(),{now:ctx.today()});return `<div class="infobox"><div><b>Documentación:</b> ${!result.known?'matriz pendiente':result.blocked.length?result.blocked.length+' requisitos críticos pendientes':'requisitos configurados conformes'} · ${result.warnings.length} avisos. <button class="btn sm2" data-a="module-open" data-module="documents" data-work="${ctx.esc(work.id)}">Ver evaluación</button></div></div>`};
  return {actions,handleSubmit,summary};
}
