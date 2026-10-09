// Local evaluation provider. Production must enforce these policies on the server.
export const ROLE_ROUTES = {
  admin:['p-plan','p-list','p-hab','v-inbox','c-inbox','c-dash','a-conf','a-users','a-system','o-day','o-edit'],
  planner:['p-plan','p-list','p-hab','v-inbox'],
  operador:['o-day','o-edit'],
  cliente:['c-inbox','c-dash']
};
const initialCredential={salt:'vds-evaluation-initial',iterations:100000,digest:'73fe63f6c920df02ec942780a0f0a17f41bde5925ce1da92412cc93953ea6c61'};
export function initializeAccounts(state, baseline){
  state.accounts ??= Object.entries(baseline).map(([role,u])=>({id:u.id,username:u.id,name:u.n,job:u.cargo,role,resource:u.rec||'',operator:u.op||'',active:true,credential:{...initialCredential},createdAt:new Date().toISOString()}));
  state.accessAudit ??= [];
  // Migrate a saved role from the original app without changing business records.
  state.accountId ??= state.user ? baseline[state.user]?.id : null;
}
export function currentAccount(state){return state.accounts?.find(a=>a.id===state.accountId&&a.active)||null}
export function canReadWork(account,work,contracts){
  if(!account)return false;
  if(account.role==='admin'||account.role==='planner')return true;
  if(account.role==='operador')return work.rec===account.resource;
  return (work.op||contracts[work.ct]?.op)===account.operator;
}
export function scopedState(state){
  return new Proxy(state,{get(target,key){
    const account=currentAccount(target);
    if(['trabajos','partes'].includes(key)&&target.user&& !['admin','planner'].includes(account?.role)){const visible=target[key].filter(x=>canReadWork(account,x,target.contratos));return new Proxy(visible,{get(list,method){if(method==='push')return (...items)=>target[key].push(...items);return list[method]}})}
    if(key==='contratos'&&target.user&&account?.role==='cliente')return Object.fromEntries(Object.entries(target.contratos).filter(([,c])=>c.op===account.operator));
    return target[key];
  }});
}
export function routeAllowed(role,route){return ROLE_ROUTES[role]?.includes(route)||false}
const adminActions=new Set(['a-del','a-reopen','a-hab','h-sin','a-est','a-edit','a-save','c-addtask','c-deltask','c-addimp','c-delimp']);
const plannerActions=new Set(['p-new','p-cell','t-edit','t-dias','t-prio','x-ok','x-no','m-ptw','m-prio','m-dias','m-tarea','m-padd','m-pdel','m-eadd','m-edel']);
export function actionAllowed(role,name){
  if(!role)return name==='logout';
  if(name.startsWith('admin-')||adminActions.has(name))return role==='admin';
  if(plannerActions.has(name))return role==='admin'||role==='planner';
  if(name.startsWith('v-'))return role==='admin'||role==='planner';
  if(['c-ok','c-obs','c-sel','c-filter','c-sigclear'].includes(name))return role==='admin'||role==='cliente';
  if(name.startsWith('o-'))return role==='admin'||role==='operador';
  return true;
}
async function digest(password,salt,iterations){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations,hash:'SHA-256'},key,256);
  return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function credentialFor(password){
  if(password.length<8)throw new Error('La contraseña necesita al menos 8 caracteres.');
  const salt=crypto.randomUUID(),iterations=100000;
  return {salt,iterations,digest:await digest(password,salt,iterations)};
}
export function createLocalIdentityProvider(getState){return {
  async signIn(username,password){
    const account=getState().accounts.find(a=>a.active&&a.username===username.trim().toLowerCase());
    if(!account||await digest(password,account.credential.salt,account.credential.iterations)!==account.credential.digest||!account.active)throw new Error('Usuario o contraseña incorrectos.');
    return account;
  },
  session(){return currentAccount(getState())}
}}
export function validateAccount(state,values,id,actorId,{resources,operators}){
  if(!ROLE_ROUTES[values.role])throw new Error('Seleccioná un rol válido.');
  if(!/^[a-z0-9._-]{3,40}$/.test(values.username))throw new Error('Usuario: 3 a 40 letras minúsculas, números, puntos o guiones.');
  if(!values.name.trim())throw new Error('Indicá el nombre.');
  if(state.accounts.some(a=>a.username===values.username&&a.id!==id))throw new Error('Ese usuario ya existe.');
  if(values.role==='operador'&&!resources.includes(values.resource))throw new Error('Asigná un recurso al operario.');
  if(values.role==='cliente'&&!operators.includes(values.operator))throw new Error('Asigná una operadora al cliente.');
  if(id===actorId&&(!values.active||values.role!=='admin'))throw new Error('No podés desactivar ni quitar el rol administrador de tu propia sesión.');
  if(id&&state.accounts.find(a=>a.id===id)?.role==='admin'&&(!values.active||values.role!=='admin')&&!state.accounts.some(a=>a.id!==id&&a.active&&a.role==='admin'))throw new Error('Debe quedar al menos un administrador activo.');
}
