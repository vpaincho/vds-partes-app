/**
 * Commercial / Certification: the UnidadComercial queue.
 *
 * ADD. `state` and `supersession_state` are shown as two separate badges on purpose (C-034/SM-09):
 * an ACEPTADA unit that later needs recalculation does not lose its historical acceptance, and the
 * two facts must never be fused into one chip.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import {
  ApiError,
  fetchCommercialUnit,
  fetchCommercialUnits,
  type CommercialUnitDetail,
  type CommercialUnitRow,
} from '../../api/client.ts';
import { CommandOutcome, useCommand } from '../../components/CommandAction.tsx';
import { StateBadge } from '../../components/StateBadge.tsx';
import { fmtInstant } from '../planning/period.ts';

const STATE_TONE: Record<string, 'ok' | 'warn' | 'critical' | 'pending' | 'neutral'> = {
  INCOMPLETA: 'pending',
  ELEGIBLE: 'pending',
  EN_REVISION: 'warn',
  OBSERVADA: 'warn',
  ACEPTADA: 'ok',
  RECHAZADA: 'critical',
};

const SUPERSESSION_TONE: Record<string, 'ok' | 'warn' | 'critical' | 'pending' | 'neutral'> = {
  VIGENTE: 'ok',
  REQUIERE_RECALCULO: 'critical',
  EN_REVISION: 'warn',
  SUSTITUIDA: 'neutral',
  INVALIDADA: 'neutral',
};

const FILTERS = ['TODOS', 'INCOMPLETA', 'ELEGIBLE', 'EN_REVISION', 'OBSERVADA', 'ACEPTADA', 'RECHAZADA'] as const;

export interface CommercialProps {
  readonly capabilities: readonly string[];
}

export function Commercial({ capabilities }: CommercialProps): JSX.Element {
  const [rows, setRows] = useState<readonly CommercialUnitRow[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('TODOS');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const canDecide = capabilities.includes('commercial.decide');
  const canDerive = capabilities.includes('commercial.derive');

  const load = useCallback(async () => {
    try {
      const result = await fetchCommercialUnits(filter === 'TODOS' ? {} : { state: filter });
      setRows(result.data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudieron cargar las unidades comerciales.');
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
        <p className="vds-empty">Sin unidades comerciales para ese filtro.</p>
      ) : (
        <ul className="vds-permits__list">
          {rows.map((row) => {
            const isExpanded = expanded === row.id;
            return (
              <li key={row.id} data-state={row.state} data-tone={STATE_TONE[row.state] ?? 'neutral'}>
                <div className="vds-permits__head">
                  <span className="vds-numeric vds-permits__code">{row.code ?? row.id.slice(0, 8)}</span>
                  <StateBadge dimension="commercial" label="UC" state={row.state} tone={STATE_TONE[row.state] ?? 'neutral'} />
                  <StateBadge
                    dimension="commercial"
                    label="Vigencia"
                    state={row.supersession_state}
                    tone={SUPERSESSION_TONE[row.supersession_state] ?? 'neutral'}
                    title="Dimensión paralela al estado: una UC aceptada puede requerir recálculo sin perder su aceptación (C-034)."
                  />
                  <span className="vds-numeric">
                    {row.quantity ?? '—'} {row.unit_code} · {row.contract_item_code}
                  </span>
                  <span className="vds-chip">{row.source_count} fuente(s)</span>
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
                  <CommercialUnitDetailView unitId={row.id} canDecide={canDecide} canDerive={canDerive} onChanged={load} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CommercialUnitDetailView({
  unitId,
  canDecide,
  canDerive,
  onChanged,
}: {
  readonly unitId: string;
  readonly canDecide: boolean;
  readonly canDerive: boolean;
  readonly onChanged: () => void;
}): JSX.Element {
  const [detail, setDetail] = useState<CommercialUnitDetail | null>(null);
  const completeAction = useCommand(() => {
    onChanged();
    void load();
  });
  const enterReviewAction = useCommand(() => {
    onChanged();
    void load();
  });
  const acceptAction = useCommand(() => {
    onChanged();
    void load();
  });
  const rejectAction = useCommand(() => {
    onChanged();
    void load();
  });
  const [quantity, setQuantity] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    const result = await fetchCommercialUnit(unitId);
    setDetail(result.data);
  }, [unitId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!detail) return <p className="vds-empty">Cargando detalle…</p>;
  const { unit, sources, observations } = detail;
  const base = `/commercial/units/${unitId}`;

  return (
    <div className="vds-permits__detail">
      <h4>Lineage (N:M, C-029/C-030)</h4>
      <ul className="vds-list--compact">
        {sources.map((s) => (
          <li key={s.id}>
            <span>
              {s.unit_description} — version v{s.version_no} ({fmtInstant(s.effective_at)})
            </span>
            <span className="vds-numeric">{s.contribution_quantity ?? '—'}</span>
          </li>
        ))}
      </ul>

      {canDerive && unit.state === 'INCOMPLETA' && (
        <form
          className="vds-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void completeAction.run(`${base}/complete-requirements`, { payload: { quantity: quantity.trim() } });
          }}
        >
          <label htmlFor={`qty-${unitId}`}>Completar requisitos — cantidad</label>
          <input id={`qty-${unitId}`} className="vds-input vds-numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <button type="submit" className="vds-button vds-button--primary" disabled={quantity.trim().length === 0}>
            Completar
          </button>
          <CommandOutcome state={completeAction.state} />
        </form>
      )}

      {canDecide && unit.state === 'ELEGIBLE' && (
        <div className="vds-inline-form">
          <button type="button" className="vds-button vds-button--primary" onClick={() => void enterReviewAction.run(`${base}/enter-review`)}>
            Ingresar a revisión
          </button>
          <CommandOutcome state={enterReviewAction.state} />
        </div>
      )}

      {canDecide && unit.state === 'EN_REVISION' && (
        <div className="vds-unit__active">
          <div className="vds-inline-form">
            <button type="button" className="vds-button vds-button--primary" onClick={() => void acceptAction.run(`${base}/accept`)}>
              Aceptar
            </button>
            <CommandOutcome state={acceptAction.state} />
          </div>
          <form
            className="vds-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void rejectAction.run(`${base}/reject`, { payload: { reason: rejectReason.trim() } });
            }}
          >
            <label htmlFor={`reject-${unitId}`}>Rechazar — motivo</label>
            <input id={`reject-${unitId}`} className="vds-input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <button type="submit" className="vds-button vds-button--secondary" disabled={rejectReason.trim().length < 10}>
              Rechazar
            </button>
            <CommandOutcome state={rejectAction.state} />
          </form>
        </div>
      )}

      {observations.length > 0 && (
        <>
          <h4>Observaciones</h4>
          <ul className="vds-list--compact">
            {observations.map((o) => (
              <li key={o.id}>
                <span>{o.description}</span>
                <span className="vds-numeric">{o.reason_code ?? '—'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
