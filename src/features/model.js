export const uid = () => globalThis.crypto.randomUUID();
export function initializeExtensions(state, moduleIds) {
  state.extensions ??= { version: 1, enabled: {}, records: {} };
  for (const id of moduleIds) {
    state.extensions.enabled[id] ??= true;
    state.extensions.records[id] ??= [];
  }
  return state.extensions;
}
export function upsertRecord(records, record, { id, actor, now = new Date().toISOString() } = {}) {
  const existing = id ? records.find(x => x.id === id) : null;
  if (id && !existing) throw new Error('El registro ya no existe.');
  if (existing) {
    const previous = JSON.parse(JSON.stringify(existing));
    delete previous.history;
    Object.assign(existing, record, { updatedAt: now });
    existing.history ??= [];
    existing.history.push({ at: now, actor, previous });
    return existing;
  }
  const created = { ...record, id: uid(), createdAt: now, updatedAt: now, createdBy: actor, history: [] };
  records.unshift(created);
  return created;
}
export function visibleWorks(state, operatorResource) {
  if (state.user === 'operador') return state.trabajos.filter(t => t.rec === operatorResource);
  if (state.user === 'cliente') return [];
  return state.trabajos;
}
export function validateMaterialItems(items) {
  if (!items.length) throw new Error('Agregá al menos un material.');
  for (const item of items) {
    if (!item.description.trim() || !item.unit.trim()) throw new Error('Cada material necesita descripción y unidad.');
    if (!(Number(item.requested) > 0)) throw new Error('La cantidad solicitada debe ser mayor a cero.');
    for (const key of ['withdrawn', 'used']) if (item[key] !== '' && (!Number.isFinite(Number(item[key])) || Number(item[key]) < 0)) throw new Error('Las cantidades retiradas y utilizadas deben ser números positivos o cero.');
  }
  return items;
}
