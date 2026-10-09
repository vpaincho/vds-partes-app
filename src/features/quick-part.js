import { evaluateWork } from '../intelligence/documents.js';
export function createQuickPart(ctx){
  const enabled=()=>ctx.state().extensions?.enabled?.quick!==false;
  const editable=()=>ctx.state().user==='operador'&&ctx.part()&&['curso','obs'].includes(ctx.part().estado);
  const drafts=()=>ctx.state().quickDrafts??={};
  function rows(p){const ops=p.ejec.reg.map((r,index)=>({...r,index})).filter(r=>r.c==='op');const missing=p.prev.filter(d=>!ops.some(r=>r.d===d));return [...ops,...missing.map(d=>({d,u:ctx.unit(p.ct,d),q:'',de:'',a:'',index:null}))]}
  function capture(form){if(form?.id!=='quick-part'||!editable())return;drafts()[ctx.part().id]={...Object.fromEntries(new FormData(form)),_baseVersion:drafts()[ctx.part().id]?._baseVersion??ctx.part().updatedAt??''};}
  function render(p){const s=ctx.state(),e=ctx.esc,work=ctx.work(p.pl),execution=p.ejec,d=drafts()[p.id]||{};const previous=s.partes.filter(x=>x!==p&&x.rec===p.rec&&x.fecha<p.fecha&&x.ejec).sort((a,b)=>b.fecha.localeCompare(a.fecha))[0]?.ejec.personal.find(x=>x.pres);
    const val=(name,fallback='')=>d[name]??fallback;
    const field=(name,label,type='text',fallback='')=>`<label class="fld">${e(label)}<input name="${name}" class="inp" type="${type}" value="${e(val(name,fallback))}" ${type==='number'?(name==='temperature'?'step="any"':'min="0" step="any"'):''}></label>`;
    const check=(name,label,fallback=false)=>`<label class="quick-check"><input type="checkbox" name="${name}" ${(Object.keys(d).length>0?!!d[name]:fallback)?'checked':''}>${e(label)}</label>`;
    const checks=ctx.checks(p);const reservations=s.extensions?.enabled?.materials!==false?(s.extensions?.records.materials||[]).filter(r=>r.workId===p.pl):[];
    const doc= s.extensions?.enabled?.documents!==false?evaluateWork(s,work,p.fecha,{now:ctx.today()}):null;
    return `<div class="edbody quick-body" data-keep="e"><div class="control-intro"><span class="feature-status">Parte rápido · confirmar lo ocurrido</span><h2>${e(p.yac)} · ${e(p.pozo)}</h2><p>${e(p.ct)} · ${e(p.imp)} · ${e(p.pl)}. El objetivo es reducir la carga habitual; el tiempo real se medirá durante el uso.</p>${Object.keys(d).length?'<button class="btn sm2" data-a="quick-reset">Descartar borrador rápido</button>':''}<button class="btn sm2" data-a="quick-detail">Abrir los cinco pasos originales / excepciones</button></div>
    ${reservations.length?`<div class="pnl"><h3>Reserva y materiales</h3>${reservations.map(r=>`<p><b>${e(r.reservation||'Código pendiente')}</b> · ${e(r.pickup||'Retiro por confirmar')} · ${r.items.map(x=>e(x.description)+' ('+e(x.requested)+' '+e(x.unit)+')').join(', ')}</p>`).join('')}<button class="btn sm2" data-a="module-open" data-module="materials" data-work="${e(p.pl)}">Ver instrucciones</button></div>`:''}
    ${doc?`<p class="note">Documentación: ${!doc.known?'matriz pendiente':doc.blocked.length?doc.blocked.length+' requisitos críticos pendientes':'sin pendientes críticos en requisitos configurados'}. Las habilitaciones originales siguen verificándose.</p>`:''}
    <form id="quick-part" class="feature-form"><div class="grid2"><div class="pnl"><h3>Cuadrilla y horarios</h3><p>${execution.personal.map(x=>e(x.n)+' · '+(x.pres?'presente':'ausente')).join('<br>')}</p><p class="sm">${execution.equipos.map(x=>e(x.c)).join(', ')}. Para ausencias, reemplazos u horarios individuales, abrí el detalle.</p>
      ${check('confirmed','Confirmo personal, equipos y datos del parte')}
      <div class="quick-fields">${field('base','Ingreso a base','time',execution.personal[0]?.base||previous?.base)}${field('zone','Llegada a zona','time',execution.personal[0]?.zona||previous?.zona)}${field('out','Salida','time',execution.personal[0]?.out||previous?.out)}</div>
      ${check('common','Aplicar estos horarios a todo el personal presente')}
      <p class="sm">Los horarios anteriores se sugieren solamente; aplicarlos requiere confirmación. Si hay diferencias, usá el detalle.</p>
      ${field('arrival','Llegada a instalación','time',execution.llegada)}
      ${execution.equipos.map((q,i)=>field('km'+i,q.c+' · km / horómetro','number',q.km)).join('')}
    </div><div class="pnl"><h3>Condiciones y confirmaciones</h3><div class="quick-fields">${field('temperature','Temperatura °C','number',execution.clima?.t)}${field('gust','Ráfagas km/h','number',execution.clima?.r)}</div><p class="sm">Dato observado en campo. Fuente automática aún sin conexión; límites según procedimiento de la empresa.</p>
      ${check('talk','Charla de seguridad realizada',execution.check.charla)}${check('ppe','EPP verificado',execution.check.epp)}
      ${p.ptw?`<h3>Permiso de la operadora</h3>${field('permit','Número', 'text',execution.permiso?.num)}${field('signer','Firmó','text',execution.permiso?.firmo)}${field('permitTime','Hora de firma','time',execution.permiso?.hora)}`:''}
    </div></div>
    <div class="pnl"><h3>Actividades realizadas</h3><p class="sm">Las tareas previstas no se marcan como ejecutadas. Informá cantidad y tramo horario únicamente si se realizaron. Las esperas y traslados existentes se conservan.</p>
    ${rows(p).map((r,i)=>`<div class="quick-activity"><b>${e(r.d)} · ${e(r.u)}</b>${field('quantity'+i,'Cantidad','number',r.q)}${field('from'+i,'Desde','time',r.de)}${field('to'+i,'Hasta','time',r.a)}</div>`).join('')}
    <button class="btn sm2" type="button" data-a="quick-detail" data-step="3">Agregar espera, traslado, adicional o evidencia</button></div>
    <div class="grid2"><div class="pnl"><h3>Cierre de jornada</h3><label class="fld">Estado del trabajo<select class="inp" name="finish">${[['sigue','Continúa'],['fin','Finalizado'],['ext','Necesita más días']].map(([v,l])=>`<option value="${v}" ${val('finish',p.fin||'sigue')===v?'selected':''}>${l}</option>`).join('')}</select></label>${field('extraDays','Días adicionales · si corresponde','number',p.ext?.dias||1)}${field('extraReason','Motivo de extensión','text',p.ext?.motivo)}<label class="fld">Observaciones / pendientes<textarea class="inp" name="notes">${e(val('notes',execution.obs))}</textarea></label></div>
    <div class="pnl"><h3>Firma y revisión</h3><div class="sigwrap"><canvas class="sig" data-sig="op" width="600" height="192" aria-label="Firma del jefe de cuadrilla"></canvas></div><button class="btn sm2" type="button" data-a="o-sigclear">Borrar firma</button><p class="sm">Los controles se recalculan al guardar. Ninguna comprobación de seguridad se confirma automáticamente.</p>${checks.filter(x=>x[0]==='err').map(x=>`<p class="field-error">${e(x[1])}</p>`).join('')}</div></div>
    <div class="feature-toolbar"><button class="btn" type="submit" name="intent" value="save">Guardar y revisar</button><button class="btn pri lg" type="submit" name="intent" value="send">Guardar y enviar</button></div></form></div>`;
  }
  function handleSubmit(event){if(event.target.id!=='quick-part')return false;if(!enabled()||!editable())return true;
    const form=event.target;capture(form);const d=drafts()[ctx.part().id],p=ctx.part();
    try{
      if(d._baseVersion!==(p.updatedAt||''))throw new Error('El parte cambió en el detalle. Descartá el borrador rápido para recuperar los datos actuales, o revisá antes de continuar.');
      if(!d.confirmed)throw new Error('Confirmá personal, equipos y datos antes de guardar.');
      const proposal=structuredClone(p.ejec);const mapped=rows(p);
      if(d.common){if(!d.base||!d.zone||!d.out||d.base>d.zone||d.zone>d.out)throw new Error('Revisá los horarios comunes.');for(const x of proposal.personal)if(x.pres)Object.assign(x,{base:d.base,zona:d.zone,out:d.out})}
      proposal.llegada=d.arrival;proposal.check={charla:!!d.talk,epp:!!d.ppe};
      if(d.temperature!==''||d.gust!==''){if(d.temperature!==''&&!Number.isFinite(Number(d.temperature))||d.gust!==''&&(!Number.isFinite(Number(d.gust))||Number(d.gust)<0))throw new Error('Condiciones climáticas inválidas.');proposal.clima={...(proposal.clima||{v:'',dir:'',cond:''}),t:d.temperature,r:d.gust,src:'manual',at:new Date().toISOString()}}
      if(p.ptw)proposal.permiso={num:d.permit,firmo:d.signer,hora:d.permitTime};
      proposal.equipos.forEach((q,i)=>{if(d['km'+i]!==''&&(!Number.isFinite(Number(d['km'+i]))||Number(d['km'+i])<0))throw new Error('Lectura de equipo inválida.');q.km=d['km'+i]});
      mapped.forEach((r,i)=>{const quantity=d['quantity'+i];if(quantity===''){if(r.index!==null&&r.q!=='')throw new Error('Para eliminar una actividad ya registrada, usá el detalle.');return}if(!(Number(quantity)>0)||!d['from'+i]||!d['to'+i]||d['from'+i]>=d['to'+i])throw new Error('Indicá cantidad y horario válido para '+r.d);const record={c:'op',d:r.d,u:r.u,q:quantity,de:d['from'+i],a:d['to'+i],det:r.det||''};if(r.index===null)proposal.reg.push(record);else proposal.reg[r.index]=record});
      const sorted=[...proposal.reg].sort((a,b)=>a.de.localeCompare(b.de));if(sorted.some((r,i)=>i&&r.de<sorted[i-1].a))throw new Error('Hay actividades superpuestas. Revisá sus horarios.');
      if(!['sigue','fin','ext'].includes(d.finish))throw new Error('Estado de cierre inválido.');if(d.finish==='ext'&&(!(Number(d.extraDays)>0)||!d.extraReason.trim()))throw new Error('Indicá días y motivo de extensión.');
      proposal.obs=d.notes;p.ejec=proposal;p.fin=d.finish;if(d.finish==='ext')p.ext={dias:Number(d.extraDays),motivo:d.extraReason};p.updatedAt=new Date().toISOString();delete drafts()[p.id];ctx.toast('Datos guardados');
      if(event.submitter?.value==='send'){ctx.send()}else ctx.render();
    }catch(error){ctx.blocked();let box=form.querySelector('.quick-error');if(!box){box=document.createElement('p');box.className='field-error quick-error';box.setAttribute('role','alert');form.prepend(box)}box.textContent=error.message;ctx.save()}
    return true;
  }
  const actions={
    'quick-reset':()=>{if(!editable())return;delete drafts()[ctx.part().id];ctx.render()},
    'quick-detail':d=>{if(!editable())return;ctx.state().fastMode=false;ctx.state().step=Number(d.step||0);ctx.render()},
    'quick-open':()=>{if(!editable()||!enabled())return;ctx.state().fastMode=true;ctx.render()}
  };
  return {render,handleSubmit,capture,actions,enabled};
}
export default {id:'quick',title:'Parte rápido',description:'Confirmación y carga breve · conserva los cinco pasos originales',icon:'clock',roles:['admin','operador'],contextual:false,render:()=>'<div class="pnl">El parte rápido se abre desde Mi jornada al iniciar o continuar un parte.</div>'};
