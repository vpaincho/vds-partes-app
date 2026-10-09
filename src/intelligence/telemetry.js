export function createTelemetry(getState,{now=()=>Date.now(),visible=()=>true}={}){
  const store=()=>{const s=getState();s.telemetry??={version:1,startedAt:new Date(now()).toISOString(),events:[],sessions:[]};return s.telemetry};
  let active=null,last=null;
  const enabled=()=>getState().extensions?.enabled?.product!==false;
  function event(type,details={}){if(!enabled())return;const t=store();t.events.push({type,at:new Date(now()).toISOString(),role:getState().user||'anonymous',...details});t.events=t.events.slice(-5000)}
  function tick(){if(!active)return;const time=now();const delta=last===null?0:Math.max(0,time-last);if(visible()&&delta<=30000){active.activeMs+=delta;active.steps[active.step]=(active.steps[active.step]||0)+delta}last=time}
  function pause(){tick();active=null;last=null}
  function route(route,partId,step=0){
    if(!enabled()){pause();return}
    if(getState().user!=='operador'||route!=='o-edit'||!partId){pause();return}
    if(active?.partId!==partId){pause();const t=store();active=t.sessions.find(s=>s.partId===partId&&!s.completedAt)||null;if(!active){active={id:crypto.randomUUID(),partId,startedAt:new Date(now()).toISOString(),activeMs:0,steps:{},step,edits:0,validationBlocks:0};t.sessions.push(active);t.sessions=t.sessions.slice(-1000)}last=now()}
    tick();active.step=step;
  }
  function interaction(field){tick();if(active&&field){if(/^base|^zone|^out|^common|personal/.test(field))active.step=1;else if(/^km|equipos/.test(field))active.step=2;else if(/^quantity|^from|^to|reg\./.test(field))active.step=3;else if(/^finish|^extra|^notes|obs|firma/.test(field))active.step=4;else active.step=0;active.edits++;event('field_edit',{section:String(active.step),field:field.replace(/\.\d+/g,'.*').slice(0,80)})}}
  function finish(partId){tick();const session=store().sessions.find(s=>s.partId===partId&&!s.completedAt);if(session){session.completedAt=new Date(now()).toISOString();event('part_completed',{partId,activeMs:session.activeMs})}pause()}
  function blocked(count){tick();if(active)active.validationBlocks++;event('validation_block',{count,section:active?String(active.step):''})}
  return {event,route,interaction,finish,blocked,pause,store};
}
export function quantile(values,q){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y);if(q===.5){const i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2}return a[Math.max(0,Math.ceil(a.length*q)-1)]}
export function productMetrics(state,{from='',to='9999-12-31'}={}){
  const t=state.telemetry||{events:[],sessions:[]};const inPeriod=x=>x.slice(0,10)>=from&&x.slice(0,10)<=to;
  const sessions=t.sessions.filter(s=>inPeriod(s.startedAt));const done=sessions.filter(s=>s.completedAt);const times=done.map(s=>s.activeMs/1000);const events=t.events.filter(e=>inPeriod(e.at));const steps={};for(const s of sessions)for(const [k,v]of Object.entries(s.steps))steps[k]=(steps[k]||0)+v;
  return {sessions:sessions.length,completed:done.length,inProgress:sessions.length-done.length,median:quantile(times,.5),p90:quantile(times,.9),within120:times.length?Math.round(times.filter(t=>t<=120).length/times.length*100):null,errors:events.filter(e=>e.type==='storage_error'||e.type==='runtime_error').length,blocks:events.filter(e=>e.type==='validation_block').length,steps,events,coverage:t.startedAt||null};
}
export function productInsights(state){const m=productMetrics(state),items=[];
  if(m.errors)items.push({id:'reliability',title:'Revisar confiabilidad del guardado y la ejecución',evidence:m.errors+' fallos observados en este navegador',hypothesis:'Identificar el flujo y corregir la causa antes de ampliar funcionalidades.',priority:'Urgente · confiabilidad'});
  if(m.completed>=5&&m.p90>120)items.push({id:'speed',title:'Reducir fricción en el recorrido del parte',evidence:'P90 observado '+Math.round(m.p90)+' s en '+m.completed+' partes medidos',hypothesis:'Revisar precargas y pasos con más tiempo observado. Comparar después con casos equivalentes.',priority:'Evaluar · experiencia'});
  if(m.blocks)items.push({id:'validations',title:'Analizar validaciones que frenan el envío',evidence:m.blocks+' intentos con controles pendientes',hypothesis:'Distinguir requisitos legítimos de información difícil de encontrar; mejorar guía y precarga sin retirar controles necesarios.',priority:'Evaluar · claridad'});
  return items;
}
