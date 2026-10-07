/**
 * The directive inbox.
 *
 * ADD. There is no prototype equivalent, and its absence is the defect: a planner edited the job and
 * the crew found out by looking at it again. C-017 makes the four facts separate — emitted, received,
 * acknowledged, applied — and this surface is where a crew sees what was decided for them and
 * records what they actually did about it.
 *
 * Two things it refuses to blur:
 *
 *  - **ACK is not application.** Acknowledging records that the order arrived. Applying records that
 *    the effect happened, and needs the effect referenced (RUL-056, RUL-057, TPR-016). They are two
 *    buttons, never one.
 *  - **An expired directive is not applied late.** Past `valid_until` the server refuses, and the row
 *    says so instead of letting someone try and wonder why it failed (RUL-058).
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ApiError, fetchDirectives, type DirectiveRow } from '../../api/client.ts';
import { CommandOutcome, useCommand } from '../../components/CommandAction.tsx';
import { StateBadge } from '../../components/StateBadge.tsx';
import { fmtInstant } from '../planning/period.ts';

const STATE_TONE: Record<string, 'ok' | 'warn' | 'critical' | 'pending' | 'neutral'> = {
  EMITIDA: 'pending',
  RECIBIDA: 'pending',
  RECONOCIDA: 'warn',
  APLICADA: 'ok',
  RECHAZADA: 'critical',
  CANCELADA: 'neutral',
  EXPIRADA: 'critical',
};

const STATE_MEANING: Record<string, string> = {
  EMITIDA: 'Decidida y publicada. Todavía no hay registro de que llegara al dispositivo.',
  RECIBIDA: 'Llegó al dispositivo. Nadie la reconoció todavía.',
  RECONOCIDA: 'Reconocida por la cuadrilla. NO está aplicada: el ACK dice que llegó, no que se hizo.',
  APLICADA: 'El efecto ocurrió y está referenciado. Una orden aplicada se compensa con otra, no se deshace.',
  RECHAZADA: 'Rechazada con causa. El lifecycle cerró sin aplicación.',
  CANCELADA: 'Cancelada por quien la emitió, antes de aplicarse.',
  EXPIRADA: 'Perdió vigencia sin aplicarse. No se aplica tarde: hay que emitir una nueva (RUL-058).',
};

const EFFECT_FOR: Record<string, string> = {
  SUSPENDER: 'UE_SUSPENDED',
  REPROGRAMAR: 'RESCHEDULED',
  REPRIORIZAR: 'REPRIORITISED',
  CAMBIO_ALCANCE: 'SCOPE_CHANGED',
  CANCELAR: 'CANCELLED',
};

export interface DirectivesProps {
  readonly capabilities: readonly string[];
  readonly onShowTrace: (subjectKind: string, subjectId: string) => void;
}

export function Directives({ capabilities, onShowTrace }: DirectivesProps): JSX.Element {
  const [rows, setRows] = useState<readonly DirectiveRow[]>([]);
  const [meta, setMeta] = useState<{ source?: string; asOf?: string; note?: string } | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchDirectives(onlyOpen ? { open: true } : {});
      setRows(result.data);
      setMeta(result.meta as { source?: string; asOf?: string; note?: string });
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudieron cargar las directivas.');
    }
  }, [onlyOpen]);

  useEffect(() => {
    void load();
  }, [load]);

  const canApply = capabilities.includes('control.apply');

  return (
    <div className="vds-directives-inbox" data-density="operations">
      <header className="vds-permits__bar">
        <label className="vds-permits__toggle">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(event) => setOnlyOpen(event.target.checked)}
          />
          Sólo las que esperan algo (emitidas, recibidas, reconocidas)
        </label>
      </header>

      {meta?.note && <p className="vds-notice">{meta.note}</p>}
      {error && <p className="vds-error">{error}</p>}

      {rows.length === 0 ? (
        <p className="vds-empty">
          {onlyOpen ? 'Nada pendiente de reconocer o aplicar.' : 'Sin directivas registradas.'}
        </p>
      ) : (
        <ul className="vds-directives">
          {rows.map((directive) => (
            <DirectiveCard
              key={directive.id}
              directive={directive}
              canApply={canApply}
              onChanged={load}
              onShowTrace={onShowTrace}
            />
          ))}
        </ul>
      )}

      <p className="vds-asof vds-numeric">
        {meta?.source ?? '—'} · leído {fmtInstant(meta?.asOf)}
      </p>
    </div>
  );
}

function DirectiveCard({
  directive,
  canApply,
  onChanged,
  onShowTrace,
}: {
  readonly directive: DirectiveRow;
  readonly canApply: boolean;
  readonly onChanged: () => void;
  readonly onShowTrace: (kind: string, id: string) => void;
}): JSX.Element {
  const action = useCommand(onChanged);
  const [note, setNote] = useState('');
  const expired =
    directive.valid_until !== null && new Date(directive.valid_until).getTime() <= Date.now();
  const terminal =
    directive.applied_at !== null || directive.rejected_at !== null || directive.state === 'EXPIRADA';

  return (
    <li data-state={directive.state}>
      <div className="vds-directives__head">
        <strong>{directive.directive_type}</strong>
        <StateBadge
          dimension="plan"
          label="Directiva"
          state={directive.state}
          tone={STATE_TONE[directive.state] ?? 'neutral'}
          title={STATE_MEANING[directive.state] ?? directive.state}
        />
        <span className="vds-numeric">{directive.code ?? directive.id.slice(0, 8)}</span>
        {directive.issued_by_name && <span className="vds-chip">{directive.issued_by_name}</span>}
      </div>

      <p>{directive.reason}</p>

      {directive.targets && directive.targets.length > 0 && (
        <p className="vds-numeric vds-directives__targets">
          sobre:{' '}
          {directive.targets
            .map((t) => `${t.targetKind}${t.assignmentCode ? ` ${t.assignmentCode}` : ''}`)
            .join(' · ')}
        </p>
      )}

      {/* Four instants. An empty one means it has not happened, not that it probably did. */}
      <dl className="vds-directives__steps">
        <dt>Emitida</dt>
        <dd className="vds-numeric">{fmtInstant(directive.issued_at)}</dd>
        <dt>Recibida</dt>
        <dd className="vds-numeric">{fmtInstant(directive.received_at)}</dd>
        <dt>Reconocida</dt>
        <dd className="vds-numeric">{fmtInstant(directive.acknowledged_at)}</dd>
        <dt>Aplicada</dt>
        <dd className="vds-numeric">{fmtInstant(directive.applied_at)}</dd>
      </dl>

      <p className="vds-permits__meaning">{STATE_MEANING[directive.state] ?? ''}</p>

      {directive.valid_until && (
        <p className={expired ? 'vds-notice' : 'vds-note'}>
          {expired
            ? `Perdió vigencia el ${fmtInstant(directive.valid_until)}. Ya no se aplica: hay que emitir una nueva.`
            : `Vigente hasta ${fmtInstant(directive.valid_until)}.`}
        </p>
      )}

      {directive.applied_effect_ref && (
        <p className="vds-numeric vds-directives__effect">
          efecto registrado: {String((directive.applied_effect_ref as { kind?: string }).kind ?? '—')}
        </p>
      )}

      {directive.rejection_reason && (
        <p className="vds-notice">
          <strong>Rechazada:</strong> {directive.rejection_reason}
        </p>
      )}

      {canApply && !terminal && !expired && (
        <div className="vds-directives__actions">
          {directive.acknowledged_at === null && (
            <button
              type="button"
              className="vds-button vds-button--secondary"
              onClick={() => void action.run(`/control/directives/${directive.id}/ack`)}
            >
              Reconocer recepción
            </button>
          )}
          <button
            type="button"
            className="vds-button vds-button--primary"
            onClick={() =>
              void action.run(`/control/directives/${directive.id}/apply`, {
                payload: {
                  effectRef: {
                    kind: EFFECT_FOR[directive.directive_type] ?? 'ACKNOWLEDGED_EFFECT',
                    ...(note.trim() ? { note: note.trim() } : {}),
                  },
                },
              })
            }
          >
            Registrar que se aplicó
          </button>
          <label htmlFor={`note-${directive.id}`} className="vds-visually-hidden">
            Nota del efecto
          </label>
          <input
            id={`note-${directive.id}`}
            className="vds-input"
            placeholder="qué se hizo (opcional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button
            type="button"
            className="vds-button vds-button--ghost"
            onClick={() =>
              void action.run(`/control/directives/${directive.id}/reject`, {
                payload: {
                  reason: note.trim().length >= 5 ? note.trim() : 'Rechazada en campo sin detalle.',
                },
              })
            }
          >
            Rechazar con causa
          </button>
        </div>
      )}

      <button
        type="button"
        className="vds-button vds-button--ghost"
        onClick={() => onShowTrace('DirectivaOperativa', directive.id)}
      >
        Trazabilidad
      </button>

      <CommandOutcome state={action.state} />
    </li>
  );
}
