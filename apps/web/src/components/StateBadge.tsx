/**
 * StateBadge — one badge per dimension, never one fused status.
 *
 * S0 §8 removes the prototype's single `plan|curso|env|obs|apr|cert`, which spanned four domains at
 * once. A Parte genuinely has an operational state, a review state, a commercial state, a delivery
 * state and possibly Habilita and PTW states, all true simultaneously. The UI may summarise, but it
 * must always offer the dimensions underneath — so this component renders a dimension, and
 * `StateBadgeRow` renders several side by side.
 *
 * Severity is carried by icon shape as well as colour: DS-01 requires that an operator can tell a
 * block from a warning in sunlight and with colour-blindness, so colour is never the only channel.
 */
import type { JSX } from 'react';

export type Dimension = 'plan' | 'exec' | 'review' | 'commercial' | 'habilita' | 'delivery';

export type Tone = 'neutral' | 'ok' | 'warn' | 'critical' | 'pending';

export interface StateBadgeProps {
  readonly dimension: Dimension;
  readonly label: string;
  readonly state: string;
  readonly tone?: Tone;
  /** Shown on hover/focus: what this dimension means and where it comes from. */
  readonly title?: string;
}

const TONE_GLYPH: Record<Tone, string> = {
  // Distinct shapes, so the badge still reads without colour.
  neutral: '',
  ok: '✓',
  warn: '▲',
  critical: '■',
  pending: '◻',
};

export function StateBadge({ dimension, label, state, tone = 'neutral', title }: StateBadgeProps): JSX.Element {
  return (
    <span
      className="vds-badge"
      data-dimension={dimension}
      data-tone={tone}
      title={title ?? `${label}: ${state}`}
    >
      <span className="vds-badge__label">{label}</span>
      <span className="vds-badge__state">
        {TONE_GLYPH[tone] && <span aria-hidden="true">{TONE_GLYPH[tone]} </span>}
        {state}
      </span>
    </span>
  );
}

export function StateBadgeRow({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <div className="vds-badge-row" role="group" aria-label="Dimensiones de estado">
      {children}
    </div>
  );
}

/** Tone for an operational Parte/UE state. Terminal is not an error. */
export function operationalTone(state: string): Tone {
  switch (state) {
    case 'EN_EJECUCION':
      return 'ok';
    case 'SUSPENDIDO':
    case 'SUSPENDIDA':
      return 'warn';
    case 'CERRADO_OPERATIVAMENTE':
    case 'CERRADA':
      return 'neutral';
    case 'ANULADO':
    case 'ANULADA':
      return 'critical';
    case 'NO_REALIZADA':
      return 'warn';
    default:
      return 'pending';
  }
}

/**
 * Tone for a delivery state.
 *
 * ENVIADO is deliberately `pending`, not `ok`: transmitted is not committed, and only RECIBIDO has a
 * durable receipt behind it (12). The prototype said "Sincronizado con la base" at this point.
 */
export function deliveryTone(state: string): Tone {
  switch (state) {
    case 'RECIBIDO':
      return 'ok';
    case 'REQUIERE_INTERVENCION':
      return 'critical';
    case 'ENVIANDO':
    case 'ENVIADO':
    case 'PENDIENTE':
    case 'GUARDADO_LOCAL':
      return 'pending';
    default:
      return 'neutral';
  }
}
