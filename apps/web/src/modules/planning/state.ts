/**
 * Tones and wording for the planning dimension.
 *
 * Kept out of the views so the three of them cannot disagree about what DESPACHADA looks like. The
 * one judgement encoded here: **DESPACHADA is never rendered as "in progress"**. The context was
 * handed to the crew; whether work started is a fact about the Parte, and conflating the two is how
 * the prototype's single `estado` lost the distinction (SM-02, C-001).
 */
import type { Tone } from '../../components/StateBadge.tsx';
import type { TimelineRow } from '../../api/client.ts';

export const ASSIGNMENT_STATE_TONE: Record<string, Tone> = {
  PROGRAMADA: 'pending',
  READY: 'ok',
  DESPACHADA: 'neutral',
  CUMPLIDA: 'ok',
  NO_REALIZADA: 'warn',
  CANCELADA: 'critical',
  SUPERSEDIDA: 'neutral',
};

export const ASSIGNMENT_STATE_MEANING: Record<string, string> = {
  PROGRAMADA: 'Intención registrada en una versión aprobada. Todavía no evaluada ni entregada.',
  READY:
    'Los requisitos evaluados se cumplían al momento de evaluar. READY es temporal: un cambio de ' +
    'documento, recurso, alcance o ventana lo invalida (C-015, RUL-015).',
  DESPACHADA:
    'El contexto fue entregado a campo. No significa EN_EJECUCION: la realidad vive en el Parte y ' +
    'puede no haber empezado.',
  CUMPLIDA:
    'El alcance real satisface la intención (RUL-018). Cerrar el Parte no implica esto por sí solo.',
  NO_REALIZADA: 'No se ejecutó, con causa estructurada. El intento queda registrado (RUL-019).',
  CANCELADA: 'Cancelada antes de Start Work.',
  SUPERSEDIDA: 'Reemplazada por una versión posterior. Conserva su ventana original (RGT-03).',
};

export const assignmentTone = (state: string): Tone => ASSIGNMENT_STATE_TONE[state] ?? 'neutral';

export type ReadinessView =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'READY'; readonly until: string | null }
  | { readonly kind: 'EXPIRED'; readonly until: string }
  | { readonly kind: 'NOT_READY'; readonly causes: number };

/**
 * Readiness as the planner needs to see it: an expired READY is its own state.
 *
 * It is not READY and it is not NOT_READY — nothing was refused, the answer simply got old. Showing
 * it as READY is the C-015 defect; showing it as NOT_READY would invent a refusal that no rule made.
 */
export function readinessView(row: {
  readiness: string | null;
  readiness_until: string | null;
  readiness_cause_count: number;
}): ReadinessView {
  if (row.readiness === null) return { kind: 'NONE' };
  if (row.readiness === 'READY') {
    if (row.readiness_until && new Date(row.readiness_until).getTime() <= Date.now()) {
      return { kind: 'EXPIRED', until: row.readiness_until };
    }
    return { kind: 'READY', until: row.readiness_until };
  }
  return { kind: 'NOT_READY', causes: Number(row.readiness_cause_count) };
}

export const READINESS_TONE: Record<ReadinessView['kind'], Tone> = {
  NONE: 'pending',
  READY: 'ok',
  EXPIRED: 'warn',
  NOT_READY: 'critical',
};

export const READINESS_LABEL: Record<ReadinessView['kind'], string> = {
  NONE: 'sin evaluar',
  READY: 'READY',
  EXPIRED: 'READY vencido',
  NOT_READY: 'NO_READY',
};

/** How a row should be grouped in the resource calendar. A row can appear under both. */
export function subjectsOf(row: TimelineRow): readonly { kind: string; id: string; label: string }[] {
  const out: { kind: string; id: string; label: string }[] = [];
  if (row.resource_id) {
    out.push({
      kind: 'RECURSO',
      id: row.resource_id,
      label: row.resource_code ?? row.resource_name ?? row.resource_id.slice(0, 8),
    });
  }
  if (row.crew_id) {
    out.push({ kind: 'CUADRILLA', id: row.crew_id, label: row.crew_name ?? row.crew_id.slice(0, 8) });
  }
  // Neither is a real state, not a rendering gap: an assignment can be nominated later.
  if (out.length === 0) out.push({ kind: 'SIN_ASIGNAR', id: 'none', label: 'Sin recurso ni cuadrilla' });
  return out;
}
