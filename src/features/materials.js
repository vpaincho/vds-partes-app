import { createRecordModule, field } from './shared.js';
import { validateMaterialItems } from './model.js';
export function materialLine(ctx,item={},index=0){const e=ctx.esc;return `<div class="material-line">
  <label class="fld wide">Material<input class="inp" name="material" aria-label="Material ${index+1}" value="${e(item.description)}" required></label>
  <label class="fld">Cantidad solicitada<input class="inp" name="requested" aria-label="Cantidad solicitada ${index+1}" type="number" min="0.001" step="any" value="${e(item.requested)}" required></label>
  <label class="fld">Unidad<input class="inp" name="unit" aria-label="Unidad ${index+1}" value="${e(item.unit||'unidad')}" required></label>
  <label class="fld">Cantidad retirada<input class="inp" name="withdrawn" aria-label="Cantidad retirada ${index+1}" type="number" min="0" step="any" value="${e(item.withdrawn)}"></label>
  <label class="fld">Cantidad utilizada<input class="inp" name="used" aria-label="Cantidad utilizada ${index+1}" type="number" min="0" step="any" value="${e(item.used)}"></label>
  <button class="btn sm2 wide" type="button" data-a="material-remove">Quitar material</button></div>`}
export default createRecordModule({
  id:'materials',title:'Reservas de materiales',description:'Pedidos y reservas gestionados con la operadora',icon:'wallet',roles:['admin','planner','operador'],editRoles:['admin','planner'],createLabel:'Pedido / reserva de la operadora',
  readonlyMessage:'Consultá el número de reserva, los materiales y las instrucciones de retiro de tus trabajos.',
  fields:(ctx,r)=>field(ctx,'title','Descripción del pedido',r.title,{required:true})+
    field(ctx,'reservation','Número de reserva de la operadora',r.reservation,{placeholder:'Pendiente hasta recibir el código'})+
    field(ctx,'reference','Referencia del pedido en papel',r.reference)+
    field(ctx,'status','Estado',r.status||'Pedido preparado',{options:['Pedido preparado','Solicitado a operadora','Reserva recibida','Retiro parcial','Retirado','Cerrado','Cancelado'].map(x=>[x,x])})+
    field(ctx,'pickup','Almacén / punto de retiro',r.pickup)+
    field(ctx,'date','Fecha prevista de retiro',r.date,{type:'date'})+
    field(ctx,'instructions','Instrucciones para el operador',r.instructions,{type:'textarea'})+
    `<div class="lab">Materiales solicitados</div><div class="material-lines" id="material-lines">${(r.items||[{}]).map((x,i)=>materialLine(ctx,x,i)).join('')}</div><button class="btn" type="button" data-a="material-add">Agregar material</button>`,
  parse(form){
    const r=Object.fromEntries(form);const descriptions=form.getAll('material');
    r.items=validateMaterialItems(descriptions.map((description,i)=>({description,requested:form.getAll('requested')[i],unit:form.getAll('unit')[i],withdrawn:form.getAll('withdrawn')[i],used:form.getAll('used')[i]})));
    if(['Reserva recibida','Retiro parcial','Retirado','Cerrado'].includes(r.status)&&!r.reservation.trim())throw new Error('Indicá el número de reserva recibido de la operadora.');
    for(const key of ['material','requested','unit','withdrawn','used'])delete r[key];return r;
  },
  details:(ctx,r)=>`<div class="infobox"><div><b>Reserva ${ctx.esc(r.reservation||'pendiente de la operadora')}</b>${r.pickup?`<div>${ctx.esc(r.pickup)}</div>`:''}</div></div>
    <div class="scrollx"><table class="tbl"><thead><tr><th>Material</th><th>Solicitado</th><th>Retirado</th><th>Utilizado</th></tr></thead><tbody>${r.items.map(i=>`<tr><td>${ctx.esc(i.description)}</td><td>${ctx.esc(i.requested)} ${ctx.esc(i.unit)}</td><td>${ctx.esc(i.withdrawn||'—')}</td><td>${ctx.esc(i.used||'—')}</td></tr>`).join('')}</tbody></table></div>${r.instructions?`<p><b>Instrucciones:</b> ${ctx.esc(r.instructions)}</p>`:''}${r.reference?`<div class="feature-meta">Pedido en papel: ${ctx.esc(r.reference)}</div>`:''}`
});
