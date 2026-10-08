/**
 * Dashboards: operational, review, commercial.
 *
 * ADD. RGT-14: every section carries its own source and asOf (never one global "last updated" for
 * the whole page), and nothing here can make a historical fact disappear — these are `GROUP BY
 * state` projections over rows that are never deleted, read fresh on every visit.
 *
 * State is shown with the same StateBadge tones used everywhere else in this app (status colour is
 * reserved for state and never doubles as a generic accent), and `state`/`supersession_state` stay
 * in separate sections on purpose (C-034) — fusing them into one number is exactly what hid the
 * "accepted but needs recalculation" case RUL-065 exists to catch.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import {
  ApiError,
  fetchCommercialDashboard,
  fetchOperationalDashboard,
  fetchReviewDashboard,
  type CommercialDashboard,
  type CountByState,
  type OperationalDashboard,
  type ReviewDashboard,
} from '../../api/client.ts';
import { StateBadge, type Dimension } from '../../components/StateBadge.tsx';
import { fmtInstant } from '../planning/period.ts';

export interface DashboardProps {
  readonly capabilities: readonly string[];
}

export function Dashboard({ capabilities }: DashboardProps): JSX.Element {
  const canSeeOperational = capabilities.includes('execution.read');
  const canSeeReview = capabilities.includes('review.read');
  const canSeeCommercial =
    capabilities.includes('commercial.read') || capabilities.includes('commercial.client.read');
  const clientView =
    capabilities.includes('commercial.client.read') && !capabilities.includes('commercial.read');

  return (
    <div className="vds-dashboard" data-density="analysis">
      {canSeeOperational && <OperationalSection />}
      {canSeeReview && <ReviewSection />}
      {canSeeCommercial && <CommercialSection clientView={clientView} />}
      {!canSeeOperational && !canSeeReview && !canSeeCommercial && (
        <p className="vds-empty">Sin capability de lectura para ningún tablero.</p>
      )}
    </div>
  );
}

function SectionFrame({
  title,
  source,
  asOf,
  note,
  error,
  children,
}: {
  readonly title: string;
  readonly source?: string | undefined;
  readonly asOf?: string | undefined;
  readonly note?: string | undefined;
  readonly error: string | null;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="vds-dashboard__section">
      <h2>{title}</h2>
      {error ? (
        <p className="vds-error">{error}</p>
      ) : (
        <>
          {children}
          {note && <p className="vds-note">{note}</p>}
          <p className="vds-asof vds-numeric">
            {source ?? '—'} · leído {asOf ? fmtInstant(asOf) : '—'}
          </p>
        </>
      )}
    </section>
  );
}

/** A labelled count, badge-toned by state — the "stat tile" shape for a single dimension's breakdown. */
function CountList({ dimension, rows }: { readonly dimension: Dimension; readonly rows: readonly CountByState[] }): JSX.Element {
  if (rows.length === 0) return <p className="vds-empty">Sin datos.</p>;
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <ul className="vds-dashboard__counts">
      {rows.map((row) => (
        <li key={row.state} data-tone={toneFor(row.state)}>
          <StateBadge dimension={dimension} label="Estado" state={row.state} tone={toneFor(row.state)} />
          <span className="vds-numeric vds-dashboard__count">{row.count}</span>
          <span
            className="vds-dashboard__bar"
            data-tone={toneFor(row.state)}
            style={{ width: `${total > 0 ? Math.round((row.count / total) * 100) : 0}%` }}
          />
        </li>
      ))}
    </ul>
  );
}

const CRITICAL_STATES = new Set(['VENCIDO', 'ERROR_ERP', 'RECHAZADA', 'RECHAZADO', 'REQUIERE_RECALCULO']);
const WARN_STATES = new Set([
  'SUSPENDIDO',
  'SUSPENDIDA',
  'OBSERVADA',
  'OBSERVADO',
  'EN_REVISION',
  'ENVIADO_ERP',
  'EMITIDA',
  'RECIBIDA',
  'RECONOCIDA',
]);
const OK_STATES = new Set(['ACEPTADA', 'ACEPTADO', 'ACEPTADO_ERP', 'VIGENTE', 'CERRADO_OPERATIVAMENTE', 'CERRADA']);

/** Reused across every dashboard section: status colour is reserved for state, never a generic accent. */
function toneFor(state: string): 'ok' | 'warn' | 'critical' | 'pending' | 'neutral' {
  if (CRITICAL_STATES.has(state)) return 'critical';
  if (WARN_STATES.has(state)) return 'warn';
  if (OK_STATES.has(state)) return 'ok';
  return 'pending';
}

function OperationalSection(): JSX.Element {
  const [data, setData] = useState<OperationalDashboard | null>(null);
  const [meta, setMeta] = useState<{ source?: string; asOf?: string; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchOperationalDashboard();
      setData(result.data);
      setMeta(result.meta as { source?: string; asOf?: string; note?: string });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo cargar el tablero operacional.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SectionFrame title="Operacional" source={meta?.source} asOf={meta?.asOf} note={meta?.note} error={error}>
      {data && (
        <div className="vds-dashboard__grid">
          <div>
            <h3>Partes</h3>
            <CountList dimension="exec" rows={data.partsByState} />
          </div>
          <div>
            <h3>Unidades de ejecución</h3>
            <CountList dimension="exec" rows={data.unitsByState} />
          </div>
          <div>
            <h3>Permisos de trabajo</h3>
            <CountList dimension="habilita" rows={data.permitsByState} />
          </div>
          <div className="vds-dashboard__tile">
            <h3>Intervalos abiertos</h3>
            <p className="vds-numeric vds-dashboard__hero">{data.openIntervals}</p>
          </div>
          <div className="vds-dashboard__tile">
            <h3>Directivas pendientes</h3>
            <p className="vds-numeric vds-dashboard__hero">{data.openDirectives}</p>
          </div>
        </div>
      )}
    </SectionFrame>
  );
}

function ReviewSection(): JSX.Element {
  const [data, setData] = useState<ReviewDashboard | null>(null);
  const [meta, setMeta] = useState<{ source?: string; asOf?: string; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchReviewDashboard();
      setData(result.data);
      setMeta(result.meta as { source?: string; asOf?: string; note?: string });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo cargar el tablero de revisión.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SectionFrame title="Revisión VDS" source={meta?.source} asOf={meta?.asOf} note={meta?.note} error={error}>
      {data && (
        <div className="vds-dashboard__grid">
          <div>
            <h3>Decisiones</h3>
            <CountList dimension="review" rows={data.decisionsByState} />
          </div>
          <div>
            <h3>Observaciones por tipo</h3>
            <CountList dimension="review" rows={data.observationsByKind} />
          </div>
          <div>
            <h3>Solicitudes de enmienda</h3>
            <CountList dimension="review" rows={data.amendmentRequestsByStatus} />
          </div>
        </div>
      )}
    </SectionFrame>
  );
}

function CommercialSection({ clientView }: { readonly clientView: boolean }): JSX.Element {
  const [data, setData] = useState<CommercialDashboard | null>(null);
  const [meta, setMeta] = useState<{ source?: string; asOf?: string; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchCommercialDashboard();
      setData(result.data);
      setMeta(result.meta as { source?: string; asOf?: string; note?: string });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo cargar el tablero comercial.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SectionFrame title={clientView ? 'Servicio / Certificación' : 'Comercial / Facturación'} source={meta?.source} asOf={meta?.asOf} note={meta?.note} error={error}>
      {data && (
        <div className="vds-dashboard__grid">
          <div>
            <h3>Unidades comerciales — estado</h3>
            <CountList dimension="commercial" rows={data.unitsByState} />
          </div>
          <div>
            <h3>Unidades comerciales — vigencia</h3>
            <CountList dimension="commercial" rows={data.unitsBySupersessionState} />
          </div>
          {!clientView && (
            <div>
              <h3>Lotes de facturación</h3>
              <CountList dimension="commercial" rows={data.lotsByState} />
            </div>
          )}
        </div>
      )}
    </SectionFrame>
  );
}
