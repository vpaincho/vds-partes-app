/**
 * GatePanel — blocks, warnings, missing items and confirmations, counted separately.
 *
 * This component exists because of one specific finding. The prototype's cierre step reported
 * "9 pendientes" by mixing hard blockers with non-blocking notices, so a crew could not tell what
 * actually prevented sending. 15_UX_PRESERVATION asks for the opposite: "Controles: bloques/avisos/
 * faltantes contados por separado; error enlaza a dato y explica efecto."
 *
 * Three rules it enforces visually:
 *
 *  1. Four separate counts, never a total. A block and a missing photo are not the same problem.
 *  2. Every block shows what to do instead. Sheet 56 requires the correct path, and a refusal an
 *     operator cannot act on is a dead end.
 *  3. An override is only offered when the rule itself declared one overrideable. A hard block shows
 *     no override affordance at all, because C-018 says it can never become one — offering a button
 *     that must fail is worse than offering none.
 *
 * It is also a panel, not a toast: it appears before the action, with cause and remedy, because the
 * gate runs before Start Work and not after (S0 §6).
 */
import type { JSX } from 'react';
import type { DecisionEnvelope } from '@vds/kernel';

export interface GatePanelProps {
  readonly decision: DecisionEnvelope | null;
  /** Shown while evaluating, so the panel does not flash empty. */
  readonly loading?: boolean;
  readonly onOverride?: (input: { gateId: string; ruleId: string; reason: string }) => void;
  readonly onConfirm?: (field: string, value: unknown) => void;
}

export function GatePanel({ decision, loading, onOverride, onConfirm }: GatePanelProps): JSX.Element | null {
  if (loading) {
    return (
      <section className="vds-gate vds-gate--loading" aria-busy="true">
        <p>Evaluando gates…</p>
      </section>
    );
  }
  if (!decision) return null;

  const counts = {
    blocks: decision.blocks.length,
    warnings: decision.warnings.length,
    missing: decision.missing.length,
    confirmations: decision.confirmationsRequired.length,
  };
  const total = counts.blocks + counts.warnings + counts.missing + counts.confirmations;

  if (total === 0) {
    return (
      <section className="vds-gate vds-gate--clear" data-decision={decision.decision}>
        <p className="vds-gate__headline">
          <span aria-hidden="true">✓ </span>
          Sin bloqueos, avisos ni faltantes.
        </p>
        {decision.preview && (
          // Saying this out loud matters: RGT-17 exists because a green preview is not permission.
          <p className="vds-gate__note">
            Esta es una evaluación previa. El comando se vuelve a evaluar al ejecutarse, con el
            contexto de ese momento.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="vds-gate" data-decision={decision.decision} aria-label="Controles previos">
      {/* Four counts, never a single total. */}
      <ul className="vds-gate__counts">
        <li data-tone="critical" data-zero={counts.blocks === 0}>
          <strong className="vds-numeric">{counts.blocks}</strong> bloqueo{counts.blocks === 1 ? '' : 's'}
        </li>
        <li data-tone="warn" data-zero={counts.warnings === 0}>
          <strong className="vds-numeric">{counts.warnings}</strong> aviso{counts.warnings === 1 ? '' : 's'}
        </li>
        <li data-tone="pending" data-zero={counts.missing === 0}>
          <strong className="vds-numeric">{counts.missing}</strong> faltante
          {counts.missing === 1 ? '' : 's'}
        </li>
        <li data-tone="neutral" data-zero={counts.confirmations === 0}>
          <strong className="vds-numeric">{counts.confirmations}</strong> a confirmar
        </li>
      </ul>

      {counts.blocks > 0 && (
        <div className="vds-gate__group" data-tone="critical">
          <h3>
            <span aria-hidden="true">■ </span>Bloqueos
          </h3>
          <ul>
            {decision.blocks.map((block) => (
              <li key={`${block.ruleId}-${block.reason}`} className="vds-gate__item">
                <p className="vds-gate__reason">{block.reason}</p>
                {block.instead && (
                  <p className="vds-gate__instead">
                    <strong>Qué hacer:</strong> {block.instead}
                  </p>
                )}
                <p className="vds-gate__provenance vds-numeric">
                  {block.ruleId}
                  {block.sourceRef ? ` · ${block.sourceRef}` : ''}
                  {block.precedence ? ` · ${block.precedence}` : ''}
                </p>
                {/* No override affordance for a hard block: C-018 means it could never succeed. */}
                {block.overrideable && onOverride && (
                  <OverrideForm ruleId={block.ruleId} onOverride={onOverride} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {counts.warnings > 0 && (
        <div className="vds-gate__group" data-tone="warn">
          <h3>
            <span aria-hidden="true">▲ </span>Avisos
          </h3>
          <ul>
            {decision.warnings.map((warning) => (
              <li key={`${warning.ruleId}-${warning.reason}`} className="vds-gate__item">
                <p className="vds-gate__reason">{warning.reason}</p>
                {warning.requiresOverrideGate ? (
                  <>
                    <p className="vds-gate__instead">
                      {/* AP-04: showing a warning and continuing is forbidden. */}
                      <strong>Requiere autorización:</strong> este aviso no habilita por sí solo. Un
                      rol con autoridad debe registrar un override con motivo.
                    </p>
                    {onOverride && (
                      <OverrideForm
                        ruleId={warning.ruleId}
                        gateId={warning.requiresOverrideGate}
                        onOverride={onOverride}
                      />
                    )}
                  </>
                ) : (
                  <p className="vds-gate__note">No impide continuar. Queda registrado.</p>
                )}
                <p className="vds-gate__provenance vds-numeric">
                  {warning.ruleId}
                  {warning.sourceRef ? ` · ${warning.sourceRef}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {counts.confirmations > 0 && (
        <div className="vds-gate__group" data-tone="neutral">
          <h3>A confirmar</h3>
          <ul>
            {decision.confirmationsRequired.map((confirmation) => (
              <li key={confirmation.field} className="vds-gate__item">
                <p className="vds-gate__reason">{confirmation.reason}</p>
                {confirmation.candidate !== undefined && (
                  <p className="vds-gate__note">
                    {/* AP-03: a derived candidate is offered, never applied unconfirmed. */}
                    Sugerido: <span className="vds-numeric">{String(confirmation.candidate)}</span>
                  </p>
                )}
                {onConfirm && (
                  <button
                    type="button"
                    className="vds-button vds-button--secondary"
                    onClick={() => onConfirm(confirmation.field, confirmation.candidate)}
                  >
                    Confirmar {confirmation.field}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {counts.missing > 0 && (
        <div className="vds-gate__group" data-tone="pending">
          <h3>Faltantes</h3>
          <ul>
            {decision.missing.map((item) => (
              <li key={item.what} className="vds-gate__item">
                <p className="vds-gate__reason">{item.what}</p>
                <p className="vds-gate__note">{item.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function OverrideForm({
  ruleId,
  gateId,
  onOverride,
}: {
  readonly ruleId: string;
  readonly gateId?: string;
  readonly onOverride: (input: { gateId: string; ruleId: string; reason: string }) => void;
}): JSX.Element {
  return (
    <form
      className="vds-gate__override"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const reason = (form.elements.namedItem('reason') as HTMLTextAreaElement).value.trim();
        // The server enforces this too; asking here avoids a round trip for an obvious omission.
        if (reason.length < 10) return;
        onOverride({ gateId: gateId ?? `GATE-${ruleId}`, ruleId, reason });
      }}
    >
      <label htmlFor={`override-${ruleId}`}>
        Motivo del override <span className="vds-gate__note">(obligatorio, mínimo 10 caracteres)</span>
      </label>
      <textarea id={`override-${ruleId}`} name="reason" rows={2} required minLength={10} />
      <button type="submit" className="vds-button vds-button--secondary">
        Registrar override
      </button>
    </form>
  );
}
