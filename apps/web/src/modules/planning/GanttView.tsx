/**
 * Gantt.
 *
 * KEEP from the prototype: bars over a period, grouped by resource, with occupancy visible and the
 * detail one click away. That layout is how planners read the week and 15 lists it as preserved.
 *
 * Three deliberate differences:
 *
 *  1. **No drag.** Not an omission — `moveT` in the prototype wrote the new window straight onto the
 *     approved job, which is the RGT-03 defect. A change of window here is a command: it produces a
 *     new version or a directive. The bar is therefore a button that opens the drawer, which is also
 *     what makes the surface keyboard-operable (15 requires an alternative to pointer-only).
 *  2. **A clipped bar looks clipped.** A job running past the edge of the period keeps an arrow, so
 *     it does not read as finishing on Sunday.
 *  3. **Readiness and open directives sit on the bar.** They are what tells the planner whether the
 *     plan and the field still agree.
 */
import type { JSX } from 'react';
import type { TimelineRow } from '../../api/client.ts';
import { barGeometry, dayKeys, fmtInstant, type Period } from './period.ts';
import { assignmentTone, readinessView, READINESS_LABEL, subjectsOf } from './state.ts';

export interface GanttViewProps {
  readonly period: Period;
  readonly rows: readonly TimelineRow[];
  readonly selectedId: string | null;
  readonly onSelect: (assignmentId: string) => void;
}

interface Lane {
  readonly key: string;
  readonly kind: string;
  readonly label: string;
  readonly rows: TimelineRow[];
}

function toLanes(rows: readonly TimelineRow[]): readonly Lane[] {
  const lanes = new Map<string, Lane>();
  for (const row of rows) {
    for (const subject of subjectsOf(row)) {
      const key = `${subject.kind}:${subject.id}`;
      const lane = lanes.get(key) ?? { key, kind: subject.kind, label: subject.label, rows: [] };
      lane.rows.push(row);
      lanes.set(key, lane);
    }
  }
  return [...lanes.values()].sort((a, b) =>
    a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind.localeCompare(b.kind),
  );
}

export function GanttView({ period, rows, selectedId, onSelect }: GanttViewProps): JSX.Element {
  const lanes = toLanes(rows);
  const days = dayKeys(period);

  if (lanes.length === 0) {
    return (
      <p className="vds-empty">
        No hay asignaciones con ventana aprobada en este período. Una versión en BORRADOR no aparece
        acá: sólo lo aprobado es intención vigente.
      </p>
    );
  }

  return (
    <div className="vds-gantt" data-density="operations">
      <div className="vds-gantt__head" aria-hidden="true">
        <div className="vds-gantt__lane-label">Recurso / cuadrilla</div>
        <div className="vds-gantt__scale">
          {days.map((key) => {
            const date = new Date(`${key}T00:00:00`);
            return (
              <div
                key={key}
                className="vds-gantt__day"
                data-weekend={date.getDay() === 0 || date.getDay() === 6}
              >
                <span className="vds-gantt__dow">
                  {date.toLocaleDateString('es-AR', { weekday: 'short' })}
                </span>
                <span className="vds-numeric">{date.getDate()}</span>
              </div>
            );
          })}
        </div>
      </div>

      <ul className="vds-gantt__lanes">
        {lanes.map((lane) => (
          <li key={lane.key} className="vds-gantt__lane">
            <div className="vds-gantt__lane-label">
              <span className="vds-numeric">{lane.label}</span>
              <small>{lane.kind.toLowerCase()}</small>
            </div>
            <div className="vds-gantt__track">
              {days.map((key) => (
                <span key={key} className="vds-gantt__gridline" aria-hidden="true" />
              ))}
              {lane.rows.map((row) => {
                const geometry = barGeometry(period, row.window_start, row.window_end);
                const readiness = readinessView(row);
                const openDirectives = Number(row.directives_open);
                return (
                  <button
                    key={`${lane.key}-${row.id}`}
                    type="button"
                    className="vds-gantt__bar"
                    style={{ left: `${geometry.left}%`, width: `${geometry.width}%` }}
                    data-state={row.state}
                    data-tone={assignmentTone(row.state)}
                    data-readiness={readiness.kind}
                    data-selected={row.id === selectedId || undefined}
                    data-clipped-start={geometry.clippedStart || undefined}
                    data-clipped-end={geometry.clippedEnd || undefined}
                    aria-pressed={row.id === selectedId}
                    onClick={() => onSelect(row.id)}
                    title={
                      `${row.code ?? row.id.slice(0, 8)} · ${row.state}\n` +
                      `Ventana aprobada: ${fmtInstant(row.window_start)} → ${fmtInstant(row.window_end)}\n` +
                      `Readiness: ${READINESS_LABEL[readiness.kind]}` +
                      (openDirectives > 0 ? `\n${openDirectives} directiva(s) sin aplicar` : '')
                    }
                  >
                    {geometry.clippedStart && <span className="vds-gantt__clip" aria-hidden="true">‹</span>}
                    <span className="vds-gantt__bar-label">
                      {row.code ?? row.id.slice(0, 8)}
                      {row.expected_part_type && (
                        <small className="vds-gantt__tp">{row.expected_part_type}</small>
                      )}
                    </span>
                    <span className="vds-gantt__flags" aria-hidden="true">
                      {readiness.kind === 'READY' && '✓'}
                      {readiness.kind === 'EXPIRED' && '▲'}
                      {readiness.kind === 'NOT_READY' && '■'}
                      {row.requires_work_permit && '⬢'}
                      {openDirectives > 0 && '⇄'}
                      {Number(row.extension_pending) > 0 && '+'}
                    </span>
                    {/* The visible glyphs are shorthand; the accessible name spells them out. */}
                    <span className="vds-visually-hidden">
                      {` ${READINESS_LABEL[readiness.kind]}.`}
                      {row.requires_work_permit ? ' Requiere permiso de trabajo.' : ''}
                      {openDirectives > 0 ? ` ${openDirectives} directivas sin aplicar.` : ''}
                      {Number(row.extension_pending) > 0 ? ' Pedido de extensión pendiente.' : ''}
                      {geometry.clippedEnd ? ' Continúa después del período.' : ''}
                    </span>
                    {geometry.clippedEnd && <span className="vds-gantt__clip" aria-hidden="true">›</span>}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>

      <p className="vds-note">
        Las barras abren el detalle; no se arrastran. Mover una ventana aprobada es un comando —
        produce una versión nueva o una directiva, nunca una reescritura del plan contra el que se
        compara la ejecución (RGT-03).
      </p>
    </div>
  );
}
