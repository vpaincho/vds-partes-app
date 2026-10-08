/**
 * Billing boundary.
 *
 * ADD. C-035/MR-11: the internal model ends at the lot. No fiscal calculation happens here, and no
 * invoice state is invented — `external_document_refs` is a reference to a document the ERP owns,
 * never a copy of it. ACCEPTED/ERROR/UNKNOWN are shown as three distinct outcomes; this surface
 * never collapses UNKNOWN into either success or failure (14_DATA_INTEGRATION_ADAPTERS).
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ApiError, fetchBillingLot, fetchBillingLots, type BillingLotDetail, type BillingLotRow } from '../../api/client.ts';
import { CommandOutcome, useCommand } from '../../components/CommandAction.tsx';
import { StateBadge } from '../../components/StateBadge.tsx';
import { fmtInstant } from '../planning/period.ts';

const STATE_TONE: Record<string, 'ok' | 'warn' | 'critical' | 'pending' | 'neutral'> = {
  BORRADOR: 'pending',
  VALIDADO: 'pending',
  ENVIADO_ERP: 'warn',
  ACEPTADO_ERP: 'ok',
  ERROR_ERP: 'critical',
  CANCELADO: 'neutral',
};

const FILTERS = ['TODOS', 'BORRADOR', 'VALIDADO', 'ENVIADO_ERP', 'ACEPTADO_ERP', 'ERROR_ERP'] as const;

export interface BillingProps {
  readonly capabilities: readonly string[];
}

export function Billing({ capabilities }: BillingProps): JSX.Element {
  const [rows, setRows] = useState<readonly BillingLotRow[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('TODOS');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showBuildForm, setShowBuildForm] = useState(false);
  const canBuild = capabilities.includes('billing.build');
  const canSend = capabilities.includes('billing.send');

  const load = useCallback(async () => {
    try {
      const result = await fetchBillingLots(filter === 'TODOS' ? {} : { state: filter });
      setRows(result.data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudieron cargar los lotes.');
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
        {canBuild && (
          <button type="button" className="vds-button vds-button--primary" onClick={() => setShowBuildForm((v) => !v)}>
            {showBuildForm ? 'Cerrar' : 'Construir lote'}
          </button>
        )}
      </header>

      {showBuildForm && <BuildLotFlow onDone={() => { setShowBuildForm(false); void load(); }} />}

      {error && <p className="vds-error">{error}</p>}

      {rows.length === 0 ? (
        <p className="vds-empty">Sin lotes para ese filtro.</p>
      ) : (
        <ul className="vds-permits__list">
          {rows.map((row) => {
            const isExpanded = expanded === row.id;
            return (
              <li key={row.id} data-state={row.state} data-tone={STATE_TONE[row.state] ?? 'neutral'}>
                <div className="vds-permits__head">
                  <span className="vds-numeric vds-permits__code">{row.code ?? row.id.slice(0, 8)}</span>
                  <StateBadge dimension="commercial" label="Lote" state={row.state} tone={STATE_TONE[row.state] ?? 'neutral'} />
                  <span className="vds-permits__type">{row.client_name}</span>
                  <span className="vds-chip">{row.line_count} línea(s)</span>
                  <button
                    type="button"
                    className="vds-button vds-button--ghost"
                    aria-expanded={isExpanded}
                    onClick={() => setExpanded(isExpanded ? null : row.id)}
                  >
                    {isExpanded ? 'Ocultar' : 'Detalle'}
                  </button>
                </div>

                {isExpanded && <BillingLotDetailView lotId={row.id} canSend={canSend} onChanged={load} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Build lines from accepted UCs, then a lot from those lines — two commands in sequence, by id.
 * No picker: the ids come from the Commercial surface's detail view, same as Habilita's actions
 * form takes a responsible identity id directly rather than inventing a search widget this pass
 * does not have.
 */
function BuildLotFlow({ onDone }: { readonly onDone: () => void }): JSX.Element {
  const buildAction = useCommand();
  const lotAction = useCommand(onDone);
  const [unitIds, setUnitIds] = useState('');
  const [lineIds, setLineIds] = useState<readonly string[]>([]);
  const [clientId, setClientId] = useState('');

  return (
    <div className="vds-unit__active">
      <form
        className="vds-inline-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const ids = unitIds.split(',').map((s) => s.trim()).filter(Boolean);
          const result = await buildAction.run('/billing/lines', { payload: { commercialUnitIds: ids } });
          const built = (result?.data as { effects?: readonly { lineIds?: readonly string[] }[] } | undefined)?.effects?.[0]
            ?.lineIds;
          if (built) setLineIds(built);
        }}
      >
        <label htmlFor="build-units">UC aceptadas (ids separados por coma)</label>
        <input id="build-units" className="vds-input vds-numeric" value={unitIds} onChange={(e) => setUnitIds(e.target.value)} />
        <button type="submit" className="vds-button vds-button--secondary" disabled={unitIds.trim().length === 0}>
          Construir líneas
        </button>
        <CommandOutcome state={buildAction.state} />
      </form>

      {lineIds.length > 0 && (
        <form
          className="vds-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void lotAction.run('/billing/lots', {
              payload: { clientId: clientId.trim(), billableLineIds: lineIds },
            });
          }}
        >
          <p className="vds-note vds-numeric">{lineIds.length} línea(s) construida(s): {lineIds.join(', ')}</p>
          <label htmlFor="lot-client">Cliente (id)</label>
          <input id="lot-client" className="vds-input vds-numeric" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <button type="submit" className="vds-button vds-button--primary" disabled={clientId.trim().length === 0}>
            Crear lote
          </button>
          <CommandOutcome state={lotAction.state} />
        </form>
      )}
    </div>
  );
}

function BillingLotDetailView({
  lotId,
  canSend,
  onChanged,
}: {
  readonly lotId: string;
  readonly canSend: boolean;
  readonly onChanged: () => void;
}): JSX.Element {
  const [detail, setDetail] = useState<BillingLotDetail | null>(null);
  const validateAction = useCommand(() => {
    onChanged();
    void load();
  });
  const sendAction = useCommand(() => {
    onChanged();
    void load();
  });

  const load = useCallback(async () => {
    const result = await fetchBillingLot(lotId);
    setDetail(result.data);
  }, [lotId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!detail) return <p className="vds-empty">Cargando detalle…</p>;
  const { lot, lines, attempts, documentRefs } = detail;
  const base = `/billing/lots/${lotId}`;

  return (
    <div className="vds-permits__detail">
      <h4>Líneas</h4>
      <ul className="vds-list--compact">
        {lines.map((l) => (
          <li key={l.id}>
            <span>{l.contract_item_code}</span>
            <span className="vds-numeric">
              {l.quantity} {l.unit_code}
              {l.invalidated_at ? ' (invalidada)' : ''}
            </span>
          </li>
        ))}
      </ul>

      {canSend && lot.state === 'BORRADOR' && (
        <div className="vds-inline-form">
          <button type="button" className="vds-button vds-button--primary" onClick={() => void validateAction.run(`${base}/validate`)}>
            Validar
          </button>
          <CommandOutcome state={validateAction.state} />
        </div>
      )}

      {canSend && lot.state === 'VALIDADO' && (
        <div className="vds-inline-form">
          <p className="vds-note">
            El intento queda registrado antes de llamar al adapter ERP (RUL-072). ACCEPTED, ERROR y
            UNKNOWN son tres resultados reales, nunca uno asumido por otro.
          </p>
          <button type="button" className="vds-button vds-button--primary" onClick={() => void sendAction.run(`${base}/send`)}>
            Enviar al ERP
          </button>
          <CommandOutcome state={sendAction.state} />
        </div>
      )}

      {attempts.length > 0 && (
        <>
          <h4>Intentos ERP</h4>
          <ul className="vds-list--compact">
            {attempts.map((a) => (
              <li key={a.id}>
                <span>
                  intento #{a.attempt_no} · {fmtInstant(a.started_at)}
                </span>
                <span className="vds-numeric">
                  {a.status}
                  {a.external_ref ? ` · ${a.external_ref}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {documentRefs.length > 0 && (
        <>
          <h4>Referencias de documento (el ERP posee el documento, MR-11)</h4>
          <ul className="vds-list--compact">
            {documentRefs.map((d) => (
              <li key={`${d.external_system}-${d.external_id}`}>
                <span>{d.external_system}</span>
                <span className="vds-numeric">{d.external_id}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
