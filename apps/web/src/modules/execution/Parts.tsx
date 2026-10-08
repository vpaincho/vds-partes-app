/**
 * Parts register for Planner/Admin.
 *
 * Product Baseline recovery: Juan separated "Partes" (all parts in the base, by state) from
 * "Mi jornada" (field work for the operator). The new architecture keeps that distinction while
 * reading the real execution model instead of duplicating state in the browser.
 */
import { Fragment, useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import {
  ApiError,
  fetchMyDay,
  fetchPart,
  type MyDayRow,
  type PartDetail,
} from '../../api/client.ts';
import {
  StateBadge,
  StateBadgeRow,
  operationalTone,
  deliveryTone,
} from '../../components/StateBadge.tsx';

const ALL = 'TODOS';

export function Parts(): JSX.Element {
  const [rows, setRows] = useState<readonly MyDayRow[]>([]);
  const [filter, setFilter] = useState(ALL);
  const [selected, setSelected] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchMyDay();
      setRows(result.data);
      setAsOf(result.meta.asOf ?? result.meta.serverTime);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudieron cargar los Partes.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const states = useMemo(
    () => [ALL, ...new Set(rows.map((row) => row.operational.state))],
    [rows],
  );

  const visible = filter === ALL ? rows : rows.filter((row) => row.operational.state === filter);

  return (
    <section className="vds-parts-register" data-density="operations">
      <div className="vds-parts-register__toolbar">
        <div className="vds-parts-register__filters" role="group" aria-label="Filtrar Partes por estado">
          {states.map((state) => (
            <button
              key={state}
              type="button"
              className="vds-planning__view"
              aria-current={filter === state ? 'true' : undefined}
              onClick={() => setFilter(state)}
            >
              {state === ALL ? 'Todos' : state}
            </button>
          ))}
        </div>
        <p className="vds-asof vds-numeric">
          {visible.length} parte(s) · datos al {asOf ? new Date(asOf).toLocaleString('es-AR') : '—'}
        </p>
      </div>

      {error && <p className="vds-error">{error}</p>}
      {!error && visible.length === 0 && <p className="vds-empty">No hay Partes para este filtro.</p>}

      <div className="vds-parts-register__table-wrap">
        <table className="vds-table vds-parts-register__table">
          <thead>
            <tr>
              <th>Parte</th>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Cuadrilla</th>
              <th>Operación</th>
              <th>Entrega</th>
              <th>UE</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const expanded = selected === row.partId;
              return (
                <Fragment key={row.partId}>
                  <tr>
                    <td className="vds-numeric">{row.code ?? row.partId.slice(0, 8)}</td>
                    <td className="vds-numeric">{row.operationalDate}</td>
                    <td>{row.partType}</td>
                    <td>{row.crewName ?? '—'}</td>
                    <td>
                      <StateBadge
                        dimension="exec"
                        label="Operación"
                        state={row.operational.state}
                        tone={operationalTone(row.operational.state)}
                      />
                    </td>
                    <td>
                      <StateBadge
                        dimension="delivery"
                        label="Entrega"
                        state={row.delivery.outstanding > 0 ? `${row.delivery.outstanding} pendiente(s)` : 'Sin pendientes'}
                        tone={row.delivery.outstanding > 0 ? 'pending' : deliveryTone('RECIBIDO')}
                      />
                    </td>
                    <td className="vds-numeric">
                      {row.operational.totalUnits - row.operational.openUnits}/{row.operational.totalUnits}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="vds-button vds-button--ghost"
                        aria-expanded={expanded}
                        onClick={() => setSelected(expanded ? null : row.partId)}
                      >
                        {expanded ? 'Cerrar' : 'Ver detalle'}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="vds-parts-register__detail-row">
                      <td colSpan={8}>
                        <PartReadOnlyDetail partId={row.partId} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PartReadOnlyDetail({ partId }: { readonly partId: string }): JSX.Element {
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPart(partId)
      .then((result) => {
        if (!cancelled) setDetail(result.data);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : 'No se pudo cargar el detalle.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [partId]);

  if (error) return <p className="vds-error">{error}</p>;
  if (!detail) return <p className="vds-empty">Cargando detalle…</p>;

  return (
    <div className="vds-parts-register__detail">
      <div>
        <h3>Unidades de ejecución</h3>
        <ul className="vds-list--compact">
          {detail.units.map((unit) => (
            <li key={unit['id'] as string}>
              <span>{(unit['description'] as string) || (unit['code'] as string) || 'UE'}</span>
              <StateBadgeRow>
                <StateBadge
                  dimension="exec"
                  label="UE"
                  state={unit['state'] as string}
                  tone={operationalTone(unit['state'] as string)}
                />
              </StateBadgeRow>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3>Personal</h3>
        <ul className="vds-list--compact">
          {detail.people.length === 0 && <li>Sin personal registrado.</li>}
          {detail.people.map((person) => (
            <li key={person['id'] as string}>
              <span>
                {person['first_name'] as string} {person['last_name'] as string}
              </span>
              <span>{person['role'] as string}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3>Tiempos y mediciones</h3>
        <p className="vds-note">
          {detail.intervals.length} intervalo(s) · {detail.measurements.length} medición(es)
        </p>
      </div>
    </div>
  );
}
