import { credentialFor, validateAccount } from '../core/access.js';
const SOURCES=[['identity','Usuarios y permisos','Directorio / autenticación'],['core','Personas, recursos y clientes','Core VDS'],['planning','Trabajos y contratos','Planificación'],['execution','Partes y actividades','Ejecución'],['certification','Aprobación y certificación','Certificación'],['materials','Pedidos y reservas','Operadora']];
export function createAdminConsole(ctx){
  let draft={},error='',busy=false;
  const e=ctx.esc, input=(name,label,value='',type='text')=>`<div class="fld"><label for="admin-${name}">${e(label)}</label><input class="inp" id="admin-${name}" name="${name}" type="${type}" value="${e(value)}" ${type==='password'?'autocomplete="new-password"':''}></div>`;
  const select=(name,label,choices,value)=>`<div class="fld"><label for="admin-${name}">${e(label)}</label><select class="inp" id="admin-${name}" name="${name}">${choices.map(([k,l])=>`<option value="${e(k)}" ${value===k?'selected':''}>${e(l)}</option>`).join('')}</select></div>`;
  const audit=(action,subject)=>ctx.state().accessAudit.unshift({at:new Date().toISOString(),actor:ctx.person(),action,subject});
  const check=()=>ctx.state().user==='admin';
  function users(){const s=ctx.state();return `<div class="feature-layout"><div class="pnl"><h3>${draft.id?'Editar usuario':'Crear usuario'}</h3><form id="admin-user-form" class="feature-form">
    ${input('username','Usuario',draft.username)}${input('name','Nombre',draft.name)}${input('job','Cargo',draft.job)}
    ${select('role','Rol',Object.entries(ctx.roles),draft.role||'operador')}
    ${select('resource','Recurso asignado · requerido para operario',[['','Sin asignación'],...ctx.resources.map(r=>[r.id,r.n])],draft.resource||'')}
    ${select('operator','Operadora · requerida para cliente',[['','Sin asignación'],...Object.entries(ctx.operators)],draft.operator||'')}
    ${select('active','Estado',[['true','Activo'],['false','Inactivo']],String(draft.active??true))}
    ${input('password',draft.id?'Nueva contraseña · vacía conserva la actual':'Contraseña inicial · mínimo 8 caracteres','','password')}
    <p class="sm">Planner: planificación y aprobación de VDS. Operario: jornada del recurso asignado. Cliente: dashboard y certificación de su operadora. Admin: acceso completo.</p>
    ${error?`<p class="field-error" role="alert">${e(error)}</p>`:''}<div class="feature-toolbar"><button class="btn pri" type="submit" ${busy?'disabled':''}>${busy?'Guardando…':'Guardar usuario'}</button><button class="btn" data-a="admin-user-new" type="button">Cancelar / nuevo</button></div></form></div>
    <div class="pnl"><h3>Usuarios del sistema</h3><div class="scrollx"><table class="tbl"><thead><tr><th>Nombre / usuario</th><th>Rol</th><th>Asignación</th><th>Estado</th><th></th></tr></thead><tbody>${s.accounts.map(a=>`<tr><td>${e(a.name)}<small class="feature-meta">${e(a.username)}</small></td><td>${e(ctx.roles[a.role])}</td><td>${e(a.role==='operador'?a.resource:a.role==='cliente'?ctx.operators[a.operator]:'VDS · todos los contratos')}</td><td>${a.active?'Activo':'Inactivo'}</td><td><button class="btn sm2" data-a="admin-user-edit" data-id="${e(a.id)}">Editar</button></td></tr>`).join('')}</tbody></table></div><p class="sm">Los usuarios se desactivan para conservar la trazabilidad de los registros. Este directorio es local; no se comparte todavía entre dispositivos.</p>
    <h3>Últimos cambios</h3>${s.accessAudit.slice(0,12).map(x=>`<p class="sm">${e(new Date(x.at).toLocaleString('es-AR'))} · ${e(x.actor)} · ${e(x.action)} · ${e(x.subject)}</p>`).join('')||'<p class="sm">Todavía no hay cambios de administración.</p>'}</div></div>`}
  function system(){const s=ctx.state();s.sourceMap??={};return `<div class="pnl"><h3>Fuentes de datos por subsistema</h3><p>Este entorno usa almacenamiento local. Registrá aquí la procedencia prevista para conectar cada subsistema cuando esté disponible la base de datos. Estos campos documentan la conexión; no la ejecutan.</p><form id="admin-source-form" class="feature-form"><div class="scrollx"><table class="tbl"><thead><tr><th>Subsistema</th><th>Datos</th><th>Referencia de origen / esquema</th><th>Conexión</th></tr></thead><tbody>${SOURCES.map(([key,label,origin])=>`<tr><td class="mono">${key}</td><td>${e(label)}</td><td><input class="inp" name="${key}" value="${e(s.sourceMap[key]||origin)}" aria-label="Origen ${e(label)}" maxlength="200"></td><td>Pendiente · datos locales</td></tr>`).join('')}</tbody></table></div><button class="btn pri" type="submit">Guardar referencias</button></form></div><div class="pnl" style="margin-top:16px"><h3>Administración del sistema</h3><p>Los catálogos de contratos, centros de costo, imputaciones y tareas se gestionan en Configuración; las habilitaciones, desde su pantalla original.</p><div class="feature-toolbar"><button class="btn" data-a="nav" data-r="a-conf">Configuración y catálogos</button><button class="btn" data-a="nav" data-r="p-hab">Habilitaciones</button><button class="btn" data-a="module-backup">Exportar respaldo local</button></div><p class="sm">La app no permite editar código de servidor ni guarda credenciales de conexión. Autenticación, permisos, validaciones y auditoría deberán aplicarse también en el backend.</p></div>`}
  const actions={
    'admin-user-new':()=>{if(!check())return;draft={};error='';ctx.render()},
    'admin-user-edit':d=>{if(!check())return;const a=ctx.state().accounts.find(x=>x.id===d.id);if(!a)return;draft={...a};delete draft.credential;error='';ctx.render()}
  };
  function contractForm(key,c){const field=(name,label,value)=>`<label class="fld">${e(label)}<input class="inp" name="${name}" value="${e(value||'')}" required></label>`;return `<details class="admin-contract"><summary>Editar datos del contrato</summary><form id="admin-contract-${e(key)}" data-contract="${e(key)}" class="feature-form">${field('n','Descripción',c.n)}${field('cc','Centro de costo',c.cc)}${field('ccn','Descripción del centro de costo',c.ccn)}${select('op','Operadora',Object.entries(ctx.operators),c.op)}${field('yacs','Yacimientos · separados por coma',c.yacs.join(', '))}${field('recs','Recursos · IDs separados por coma',c.recs.join(', '))}<p class="sm">El ID del contrato se conserva. Los partes existentes mantienen la información registrada al crearse.</p><button class="btn pri" type="submit">Guardar contrato</button></form></details>`}
  async function submit(form){if(!check())return;
    if(form.dataset.contract){const s=ctx.state(),key=form.dataset.contract,fd=Object.fromEntries(new FormData(form));const c=s.contratos[key];if(!c)return;
      const yacs=fd.yacs.split(',').map(x=>x.trim()).filter(Boolean),recs=fd.recs.split(',').map(x=>x.trim()).filter(Boolean);
      if(!fd.n.trim()||!fd.cc.trim()||!fd.ccn.trim()||!yacs.length||!recs.length||!ctx.operators[fd.op]||recs.some(id=>!ctx.resources.some(r=>r.id===id))){ctx.toast('Completá los datos y usá IDs de recursos válidos.');ctx.render();return}
      if(fd.op!==c.op&&(s.trabajos.some(t=>t.ct===key)||s.partes.some(p=>p.ct===key))){ctx.toast('La operadora de un contrato con trabajos registrados debe conservarse.');ctx.render();return}
      Object.assign(c,{n:fd.n.trim(),cc:fd.cc.trim(),ccn:fd.ccn.trim(),op:fd.op,yacs,recs});audit('Contrato actualizado',key);ctx.toast('Contrato guardado');ctx.render();return;
    }
    if(form.id==='admin-source-form'){ctx.state().sourceMap=Object.fromEntries(new FormData(form));audit('Fuentes de datos actualizadas','Sistema');ctx.toast('Referencias guardadas · conexión pendiente');ctx.render();return}
    if(form.id!=='admin-user-form'||busy)return;
    const editingId=draft.id,actorId=ctx.state().accountId;
    const values=Object.fromEntries(new FormData(form));const password=values.password;delete values.password;values.username=values.username.trim().toLowerCase();values.name=values.name.trim();values.active=values.active==='true';
    draft={...draft,...values};
    try{validateAccount(ctx.state(),values,editingId,actorId,{resources:ctx.resources.map(x=>x.id),operators:Object.keys(ctx.operators)});if(!editingId&&!password)throw new Error('Indicá una contraseña inicial.');
      busy=true;error='';draft={...draft,...values};ctx.render();const credential=password?await credentialFor(password):null;
      if(!check()||ctx.state().accountId!==actorId)return;const s=ctx.state();const previous=editingId?s.accounts.find(x=>x.id===editingId):null;
      validateAccount(s,values,editingId,s.accountId,{resources:ctx.resources.map(x=>x.id),operators:Object.keys(ctx.operators)});
      if(values.role!=='operador')values.resource='';if(values.role!=='cliente')values.operator='';
      const account=previous||{id:crypto.randomUUID(),createdAt:new Date().toISOString()};Object.assign(account,values,{updatedAt:new Date().toISOString()});if(credential)account.credential=credential;if(!previous)s.accounts.push(account);
      audit(previous?'Usuario actualizado':'Usuario creado',account.username);ctx.refreshIdentity();draft={};ctx.toast('Usuario guardado');
    }catch(err){error=err.message}finally{busy=false;ctx.render()}
  }
  return {actions,submit,contractForm,view:route=>check()?(route==='a-users'?users():system()):'',handles:route=>['a-users','a-system'].includes(route)};
}
