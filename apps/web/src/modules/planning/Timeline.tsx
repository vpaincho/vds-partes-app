/**
 * Planning timeline.
 *
 * KEEP from the prototype: the Gantt / resource / month views over one period, with occupancy and
 * access to the detail. 07 is explicit that all three read the SAME projection and only change the
 * period, which is why this reads /planning/timeline rather than each view querying its own shape.
 *
 * Evolutions this surface carries:
 *  - readiness shows its validity, because READY is temporal and can be invalidated (C-015);
 *  - the approved window is labelled as intention, so plan-vs-real stays legible (C-001);
 *  - a dispatched bar says so, and DESPACHADA is never rendered as "in progress" (SM-02).
 *
 * Drag editing is preserved in the plan but not reimplemented here: 15 requires a keyboard and form
 * alternative alongside it, and a drag that silently rewrote an approved window is the RGT-03 defect.
 * Editing arrives with the planning commands.
 */
import { useEffect, useState, type JSX } from 'react';
import { ApiError, fetchTimeline, type TimelineRow } from '../../api/client.ts';
import { StateBadge, StateBadgeRow } from '../../components/StateBadge.tsx';

export function Timeline(): JSX.Element {
  const [rows, setRows] = useState<readonly TimelineRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await fetchTimeline();
        setRows(result.data);
        setSource(result.meta.source ?? null);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'No se pudo cargar la planificación.');
      }
    })();
  }, []);

  if (error) return <p className="vds-error">{error}</p>;
  if (rows.length === 0) return <p className="vds-empty">No hay asignaciones en el período.</p>;

  return (
    <div className="vds-timeline">
      <p className="vds-asof vds-numeric">Fuente: {source ?? '—'}</p>
      <table className="vds-table" data-density="operations">
        <thead>
          <tr>
            <th scope="col">Asignación</th>
            <th scope="col">TipoParte previsto</th>
            <th scope="col">Ventana aprobada</th>
            <th scope="col">Estado</th>
            <th scope="col">Readiness</th>
            <th scope="col">PTW</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <span className="vds-numeric">{row.code ?? row.id.slice(0, 8)}</span>
                {row.crew_name && <div className="vds-table__sub">{row.crew_name}</div>}
              </td>
              <td className="vds-numeric">{row.expected_part_type ?? '—'}</td>
              <td className="vds-numeric">
                {/* Labelled as intention: the approved window does not change because reality diverged. */}
                {new Date(row.window_start).toLocaleString('es-AR')} →{' '}
                {new Date(row.window_end).toLocaleString('es-AR')}
              </td>
              <td>
                <StateBadgeRow>
                  <StateBadge
                    dimension="plan"
                    label="Plan"
                    state={row.state}
                    tone={
                      row.state === 'DESPACHADA' ? 'ok' : row.state === 'NO_REALIZADA' ? 'warn' : 'pending'
                    }
                    {...(row.state === 'DESPACHADA'
                      ? {
                          title:
                            'El contexto fue entregado a campo. DESPACHADA no es EN_EJECUCION: la ' +
                            'realidad vive en el Parte.',
                        }
                      : {})}
                  />
                </StateBadgeRow>
              </td>
              <td>
                {row.readiness === 'READY' ? (
                  <StateBadge
                    dimension="plan"
                    label="Readiness"
                    state="READY"
                    tone="ok"
                    title={
                      row.readiness_until
                        ? `Vigente hasta ${new Date(row.readiness_until).toLocaleString('es-AR')}. READY es temporal.`
                        : 'READY sin vencimiento declarado.'
                    }
                  />
                ) : (
                  <StateBadge
                    dimension="plan"
                    label="Readiness"
                    state={row.readiness ?? 'sin evaluar'}
                    tone="pending"
                  />
                )}
              </td>
              <td>{row.requires_work_permit ? 'Requiere' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="vds-note">
        La edición por arrastre llega con los comandos de planificación: una modificación produce una
        versión nueva o una directiva, nunca una reescritura de la ventana aprobada.
      </p>
    </div>
  );
}
