export function field(ctx, name, label, value = '', { type = 'text', required = false, options, placeholder = '', min, step } = {}) {
  const e = ctx.esc, id = 'module-' + name;
  const attrs = `name="${e(name)}" id="${id}" class="inp" ${required ? 'required' : ''}`;
  let input;
  if (options) input = `<select ${attrs}>${options.map(([v,l]) => `<option value="${e(v)}" ${String(v) === String(value) ? 'selected' : ''}>${e(l)}</option>`).join('')}</select>`;
  else if (type === 'textarea') input = `<textarea ${attrs} placeholder="${e(placeholder)}">${e(value)}</textarea>`;
  else input = `<input ${attrs} type="${type}" value="${e(value)}" placeholder="${e(placeholder)}" ${min !== undefined ? `min="${min}"` : ''} ${step ? `step="${step}"` : ''}>`;
  return `<div class="fld"><label for="${id}">${e(label)}</label>${input}</div>`;
}
export function createRecordModule(config) {
  return {
    ...config,
    render(ctx, host) {
      const draft = host.draft(config.id), records = host.records(config.id), e = ctx.esc;
      const editable = host.canEdit(config);
      const form = editable ? `<div class="pnl"><h3>${draft.id ? 'Editar registro' : e(config.createLabel || 'Nuevo registro')}</h3>
        <form class="feature-form" data-module="${config.id}">
          ${host.workField(draft.workId)}
          ${config.fields(ctx, draft, host)}
          ${host.formError(config.id)}
          <div class="feature-toolbar"><button class="btn pri" type="submit">${draft.id ? 'Guardar cambios' : 'Guardar'}</button>${draft.id ? `<button class="btn" type="button" data-a="module-cancel" data-module="${config.id}">Cancelar</button>` : ''}</div>
        </form></div>` : `<div class="feature-readonly">${e(config.readonlyMessage || 'Consultá aquí los registros vinculados a tus trabajos.')}</div>`;
      return host.filter(config.id) + `<div class="feature-layout">${form}<div class="feature-list">${records.map(record => host.card(config, record)).join('') || '<div class="pnl empty">Todavía no hay registros para este trabajo.</div>'}</div></div>`;
    },
    parse: config.parse || ((form) => Object.fromEntries(form.entries()))
  };
}
