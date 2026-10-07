/**
 * Resource calendar.
 *
 * KEEP from the prototype `vWeek`: one row per resource, one cell per day, occupancy at the end.
 *
 * The change is the occupancy column. The prototype showed one number; 15 records that it mixed two
 * different measures. Here both arrive from the server, each named, and neither is turned into a
 * percentage — a percentage needs a declared capacity, and capacity per resource is configuration
 * that does not exist yet (`PENDING_CONFIGURATION`). Inventing a denominator would be the kind of
 * silent metric this surface exists to stop.
 */
import type { JSX } from 'react';
import type { OccupancyRow, TimelineRow } from '../../api/client.ts';
import { dayKeys, type Period } from './period.ts';
import { assignmentTone, readinessView, subjectsOf } from './state.ts';

export interface ResourceViewProps {
  readonly period: Period;
  readonly rows: readonly TimelineRow[];
  readonly occupancy: readonly OccupancyRow[];
  readonly occupancyMetrics: Record<string, string> | null;
  readonly selectedId: string | null;
  readonly onSelect: (assignmentId: string) => void;
}

interface SubjectRow {
  readonly key: string;
  readonly kind: string;
  readonly id: string;
  readonly label: string;
  /** operational_date → assignments on that date. */
  readonly byDay: Map<string, TimelineRow[]>;
}

export function ResourceView({
  period,
  rows,
  occupancy,
  occupancyMetrics,
  selectedId,
  onSelect,
}: ResourceViewProps): JSX.Element {
  const days = dayKeys(period);
  const subjects = new Map<string, SubjectRow>();

  for (const row of rows) {
    for (const subject of subjectsOf(row)) {
      const key = `${subject.kind}:${subject.id}`;
      const existing =
        subjects.get(key) ??
        ({ key, kind: subject.kind, id: subject.id, label: subject.label, byDay: new Map() } as SubjectRow);
      const list = existing.byDay.get(row.operational_date) ?? [];
      list.push(row);
      existing.byDay.set(row.operational_date, list);
      subjects.set(key, existing);
    }
  }

  const metricFor = (subjectId: string, kind: string): OccupancyRow | undefined =>
    occupancy.find((o) => o.subject_id === subjectId && o.subject_kind === kind);

  if (subjects.size === 0) {
    return <p className="vds-empty">Sin recursos comprometidos en este período.</p>;
  }

  return (
    <div className="vds-resource" data-density="operations">
      <table className="vds-table vds-resource__table">
        <caption className="vds-visually-hidden">
          Ocupación por recurso y cuadrilla en el período {period.label}
        </caption>
        <thead>
          <tr>
            <th scope="col">Recurso / cuadrilla</th>
            {days.map((key) => {
              const date = new Date(`${key}T00:00:00`);
              return (
                <th
                  key={key}
                  scope="col"
                  className="vds-resource__dayhead"
                  data-weekend={date.getDay() === 0 || date.getDay() === 6}
                >
                  <span className="vds-resource__dow">
                    {date.toLocaleDateString('es-AR', { weekday: 'narrow' })}
                  </span>
                  <span className="vds-numeric">{date.getDate()}</span>
                </th>
              );
            })}
            {/* Two columns, two questions. Never collapsed into one. */}
            <th scope="col" title={occupancyMetrics?.['occupied_days'] ?? undefined}>
              Días comprometidos
            </th>
            <th scope="col" title={occupancyMetrics?.['planned_hours'] ?? undefined}>
              Horas de ventana
            </th>
          </tr>
        </thead>
        <tbody>
          {[...subjects.values()]
            .sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind.localeCompare(b.kind)))
            .map((subject) => {
              const metric = metricFor(subject.id, subject.kind);
              return (
                <tr key={subject.key}>
                  <th scope="row" className="vds-resource__subject">
                    <span className="vds-numeric">{subject.label}</span>
                    <small>{subject.kind.toLowerCase()}</small>
                  </th>
                  {days.map((key) => {
                    const dayRows = subject.byDay.get(key) ?? [];
                    return (
                      <td key={key} className="vds-resource__cell" data-count={dayRows.length}>
                        {dayRows.map((row) => {
                          const readiness = readinessView(row);
                          return (
                            <button
                              key={row.id}
                              type="button"
                              className="vds-resource__chip"
                              data-tone={assignmentTone(row.state)}
                              data-readiness={readiness.kind}
                              data-selected={row.id === selectedId || undefined}
                              aria-pressed={row.id === selectedId}
                              onClick={() => onSelect(row.id)}
                              title={`${row.code ?? row.id.slice(0, 8)} · ${row.state}`}
                            >
                              {row.expected_part_type ?? '··'}
                              <span className="vds-visually-hidden">
                                {` ${row.code ?? row.id.slice(0, 8)}, ${row.state}`}
                              </span>
                            </button>
                          );
                        })}
                        {/* More than one assignment on one resource on one day is worth seeing, but
                            it is not automatically a conflict: C-012 forbids universal exclusivity.
                            The conflict verdict belongs to the rule, and lives in the drawer. */}
                        {dayRows.length > 1 && (
                          <span className="vds-resource__multi" title="Más de una asignación ese día">
                            ×{dayRows.length}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="vds-numeric vds-resource__metric">{metric?.occupied_days ?? '0'}</td>
                  <td className="vds-numeric vds-resource__metric">{metric?.planned_hours ?? '0'}</td>
                </tr>
              );
            })}
        </tbody>
      </table>

      <dl className="vds-metricdef">
        <dt>Días comprometidos</dt>
        <dd>{occupancyMetrics?.['occupied_days'] ?? 'Métrica declarada por el servidor.'}</dd>
        <dt>Horas de ventana</dt>
        <dd>{occupancyMetrics?.['planned_hours'] ?? 'Métrica declarada por el servidor.'}</dd>
      </dl>
      <p className="vds-note">
        No se muestra un porcentaje de ocupación: haría falta una capacidad declarada por recurso, y
        esa configuración todavía no existe. Un denominador inventado sería una cifra sin fuente.
      </p>
    </div>
  );
}
