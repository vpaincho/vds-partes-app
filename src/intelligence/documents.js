export function documentStore(state){return state.documentControl??={version:1,requirements:[],evidence:[],audit:[]}}
export function requirementsFor(state,{kind,subject,operator,location,activity}){return documentStore(state).requirements.filter(r=>r.active!==false&&r.kind===kind&&(!r.subject||r.subject===subject)&&(!r.operator||r.operator===operator)&&(!r.location||r.location===location)&&(!r.activity||r.activity===activity))}
export function evaluateRequirement(state,r,subject,date,{now=date}={}){
  const records=documentStore(state).evidence.filter(x=>x.requirementId===r.id&&x.subject===subject&&x.validFrom<=date&&x.recordedAt.slice(0,10)<=now).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt));
  const valid=records.find(x=>x.status==='Aprobado'&&x.validTo>=date);
  const latest=valid||records[0];if(!latest)return {status:'Sin evidencia',requirement:r,subject};
  if(latest.status!=='Aprobado')return {status:latest.status,requirement:r,subject,evidence:latest};
  if(latest.validTo<date)return {status:'Vencido',requirement:r,subject,evidence:latest};
  const age=(Date.parse(now)-Date.parse(latest.verifiedAt||latest.recordedAt.slice(0,10)))/86400000;
  if(r.maxAgeDays&&age>Number(r.maxAgeDays))return {status:'Verificación desactualizada',requirement:r,subject,evidence:latest};
  const remaining=(Date.parse(latest.validTo)-Date.parse(date))/86400000;
  return {status:remaining<=Number(r.noticeDays||30)?'Próximo a vencer':'En regla',requirement:r,subject,evidence:latest,remaining};
}
export function evaluateWork(state,work,date,{now=date}={}){
  const operator=state.contratos[work.ct]?.op,location=work.yac+' · '+work.pozo;const results=[];
  for(const [kind,subjects]of [['Personal',work.pers||[]],['Equipo',work.eqs||[]]])for(const subject of subjects){
    const matches=new Map();for(const activity of work.prev?.length?work.prev:[''])for(const r of requirementsFor(state,{kind,subject,operator,location,activity}))matches.set(r.id,r);
    for(const r of matches.values())results.push(evaluateRequirement(state,r,subject,date,{now}));
  }
  return {results,known:results.length>0,blocked:results.filter(x=>!['En regla','Próximo a vencer'].includes(x.status)&&x.requirement.critical),warnings:results.filter(x=>x.status==='Próximo a vencer'||!['En regla'].includes(x.status))};
}
