/**
 * Review VDS.
 *
 * ADD. 11/05: this reviews a VERSION, never the Parte's own state — accepting here does not
 * certify commercially and does not touch execution.* (RGT-04/CC-06). An observation routes by
 * kind: only OPERATIONAL_ERROR can open a request to execution.amendments (W3), which this surface
 * links to but never applies itself.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ApiError, fetchReviewDecision, fetchReviewDecisions, type ReviewDecisionDetail, type ReviewDecisionRow } from '../../api/client.ts';
import { CommandOutcome, useCommand } from '../../components/CommandAction.tsx';
import { StateBadge } from '../../components/StateBadge.tsx';
import { fmtInstant } from '../planning/period.ts';

const STATE_TONE: Record<string, 'ok' | 'warn' | 'critical' | 'pending' | 'neutral'> = {
  PENDIENTE_REVISION: 'pending',
  EN_REVISION: 'pending',
  ACEPTADA: 'ok',
  OBSERVADA: 'warn',
};

const FILTERS = ['TODOS', 'PENDIENTE_REVISION', 'EN_REVISION', 'ACEPTADA', 'OBSERVADA'] as const;

export interface ReviewProps {
  readonly capabilities: readonly string[];
}

export function Review({ capabilities }: ReviewProps): JSX.Element {
  const [rows, setRows] = useState<readonly ReviewDecisionRow[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('TODOS');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const canDecide = capabilities.includes('review.decide');

  const load = useCallback(async () => {
    try {
      const result = await fetchReviewDecisions(filter === 'TODOS' ? {} : { state: filter });
      setRows(result.data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo cargar la bandeja de revisión.');
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="vds-permits" data-density="operations">
      <header className="vds-permits__bar">
        <div role="group" aria-label="Filtrar por estado" className="vds-permits__filters">
          {FILTERS.map((state) => (
            <button
              key={state}
              type="button"
              className="vds-permits__filter"
              aria-current={state === filter ? 'true' : undefined}
              onClick={() => setFilter(state)}
            >
              {state === 'TODOS' ? 'Todos' : state}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="vds-error">{error}</p>}

      {rows.length === 0 ? (
        <p className="vds-empty">Sin decisiones de revisión para ese filtro.</p>
      ) : (
        <ul className="vds-permits__list">
          {rows.map((row) => {
            const isExpanded = expanded === row.id;
            return (
              <li key={row.id} data-state={row.state} data-tone={STATE_TONE[row.state] ?? 'neutral'}>
                <div className="vds-permits__head">
                  <span className="vds-numeric vds-permits__code">{row.id.slice(0, 8)}</span>
                  <StateBadge dimension="review" label="Revisión" state={row.state} tone={STATE_TONE[row.state] ?? 'neutral'} />
                  <span className="vds-permits__type">
                    {row.execution_unit_version_id ? 'sobre versión de UE' : 'sobre Parte'}
                  </span>
                  {Number(row.observation_count) > 0 && (
                    <span className="vds-chip vds-chip--warn">{row.observation_count} observación(es)</span>
                  )}
                  <button
                    type="button"
                    className="vds-button vds-button--ghost"
                    aria-expanded={isExpanded}
                    onClick={() => setExpanded(isExpanded ? null : row.id)}
                  >
                    {isExpanded ? 'Ocultar' : 'Detalle'}
                  </button>
                </div>

                {isExpanded && (
                  <ReviewDetailView decisionId={row.id} canDecide={canDecide} onChanged={load} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ReviewDetailView({
  decisionId,
  canDecide,
  onChanged,
}: {
  readonly decisionId: string;
  readonly canDecide: boolean;
  readonly onChanged: () => void;
}): JSX.Element {
  const [detail, setDetail] = useState<ReviewDecisionDetail | null>(null);
  const acceptAction = useCommand(() => {
    onChanged();
    void load();
  });
  const observeAction = useCommand(() => {
    onChanged();
    void load();
  });
  const [observationKind, setObservationKind] = useState<'CLARIFICATION' | 'COMPLETENESS' | 'OPERATIONAL_ERROR' | 'COMMERCIAL_DISPUTE'>(
    'CLARIFICATION',
  );
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    const result = await fetchReviewDecision(decisionId);
    setDetail(result.data);
  }, [decisionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!detail) return <p className="vds-empty">Cargando detalle…</p>;
  const { decision, observations, amendmentRequests } = detail;
  const canAct = decision.state === 'PENDIENTE_REVISION' || decision.state === 'EN_REVISION';

  return (
    <div className="vds-permits__detail">
      <dl className="vds-drawer__facts">
        <dt>Creada</dt>
        <dd className="vds-numeric">{fmtInstant(decision.created_at)}</dd>
        <dt>Decidida</dt>
        <dd className="vds-numeric">{fmtInstant(decision.decided_at)}</dd>
        <dt>Revisor</dt>
        <dd>{decision.reviewer_name ?? '—'}</dd>
      </dl>

      {canDecide && canAct && (
        <div className="vds-unit__active">
          <div className="vds-inline-form">
            <button
              type="button"
              className="vds-button vds-button--primary"
              onClick={() => void acceptAction.run(`/review/decisions/${decisionId}/accept`)}
            >
              Aceptar
            </button>
            <CommandOutcome state={acceptAction.state} />
          </div>
          <form
            className="vds-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void observeAction.run(`/review/decisions/${decisionId}/observe`, {
                payload: { observationKind, description: description.trim() },
              });
            }}
          >
            <label htmlFor={`obs-kind-${decisionId}`}>Observar — tipo</label>
            <select
              id={`obs-kind-${decisionId}`}
              className="vds-input"
              value={observationKind}
              onChange={(event) => setObservationKind(event.target.value as typeof observationKind)}
            >
              <option value="CLARIFICATION">Aclaración</option>
              <option value="COMPLETENESS">Completitud</option>
              <option value="OPERATIONAL_ERROR">Error operacional</option>
              <option value="COMMERCIAL_DISPUTE">Disputa comercial</option>
            </select>
            <input
              className="vds-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="descripción de la observación"
            />
            <p className="vds-note">
              Solo ERROR_OPERACIONAL habilita pedir una enmienda. DISPUTA_COMERCIAL se resuelve en
              Certificación, no aquí.
            </p>
            <button type="submit" className="vds-button vds-button--secondary" disabled={description.trim().length < 5}>
              Observar
            </button>
            <CommandOutcome state={observeAction.state} />
          </form>
        </div>
      )}

      {observations.length > 0 && (
        <>
          <h4>Observaciones</h4>
          <ul className="vds-list--compact">
            {observations.map((o) => (
              <li key={o.id}>
                <span>
                  {o.observation_kind}: {o.description}
                </span>
                <span className="vds-numeric">{o.raised_by_name ?? '—'}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {amendmentRequests.length > 0 && (
        <>
          <h4>Solicitudes de enmienda</h4>
          <ul className="vds-list--compact">
            {amendmentRequests.map((r) => (
              <li key={r.id}>
                <span>{r.requested_change}</span>
                <span className="vds-numeric">{r.status}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
