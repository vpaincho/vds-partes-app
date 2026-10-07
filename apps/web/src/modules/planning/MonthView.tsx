/**
 * Month.
 *
 * KEEP from the prototype `vMonth`: a calendar grid with the load of each day and access to the
 * detail. It is the surface a planner uses to see the shape of the month, not the detail of a job.
 *
 * The counts are kept apart by dimension rather than totalled. A day with four dispatched
 * assignments and a day with four blocked ones are not the same day, and a single "4" says nothing
 * about which. That is the same reason the gate panel never shows one number (S0 §8).
 */
import type { JSX } from 'react';
import type { TimelineRow } from '../../api/client.ts';
import { addDays, localDateKey, type Period } from './period.ts';
import { assignmentTone, readinessView } from './state.ts';

export interface MonthViewProps {
  readonly period: Period;
  readonly rows: readonly TimelineRow[];
  readonly selectedId: string | null;
  readonly onSelect: (assignmentId: string) => void;
}

const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

export function MonthView({ period, rows, selectedId, onSelect }: MonthViewProps): JSX.Element {
  const byDay = new Map<string, TimelineRow[]>();
  for (const row of rows) {
    const list = byDay.get(row.operational_date) ?? [];
    list.push(row);
    byDay.set(row.operational_date, list);
  }

  // Lead the grid with blanks so the first of the month lands under its weekday.
  const leading = (period.from.getDay() + 6) % 7;
  const cells: (Date | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: period.days }, (_, i) => addDays(period.from, i)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const today = localDateKey(new Date());

  return (
    <div className="vds-month" data-density="analysis">
      <div className="vds-month__weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="vds-month__grid" role="grid" aria-label={`Planificación de ${period.label}`}>
        {cells.map((date, index) => {
          if (!date) return <div key={`pad-${index}`} className="vds-month__pad" role="presentation" />;
          const key = localDateKey(date);
          const dayRows = byDay.get(key) ?? [];
          const blocked = dayRows.filter((r) => readinessView(r).kind === 'NOT_READY').length;
          const expired = dayRows.filter((r) => readinessView(r).kind === 'EXPIRED').length;
          const dispatched = dayRows.filter((r) => r.state === 'DESPACHADA').length;
          const openDirectives = dayRows.reduce((sum, r) => sum + Number(r.directives_open), 0);

          return (
            <div
              key={key}
              className="vds-month__cell"
              role="gridcell"
              data-today={key === today || undefined}
              data-empty={dayRows.length === 0 || undefined}
            >
              <div className="vds-month__date">
                <span className="vds-numeric">{date.getDate()}</span>
                {dayRows.length > 0 && (
                  <span className="vds-month__counts">
                    {/* Separate counts, never a sum. */}
                    {dispatched > 0 && (
                      <span data-tone="neutral" title={`${dispatched} despachada(s)`}>
                        ⇥{dispatched}
                      </span>
                    )}
                    {expired > 0 && (
                      <span data-tone="warn" title={`${expired} con READY vencido`}>
                        ▲{expired}
                      </span>
                    )}
                    {blocked > 0 && (
                      <span data-tone="critical" title={`${blocked} NO_READY`}>
                        ■{blocked}
                      </span>
                    )}
                    {openDirectives > 0 && (
                      <span data-tone="pending" title={`${openDirectives} directiva(s) sin aplicar`}>
                        ⇄{openDirectives}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <ul className="vds-month__items">
                {dayRows.slice(0, 4).map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="vds-month__item"
                      data-tone={assignmentTone(row.state)}
                      data-readiness={readinessView(row).kind}
                      data-selected={row.id === selectedId || undefined}
                      aria-pressed={row.id === selectedId}
                      onClick={() => onSelect(row.id)}
                    >
                      <span className="vds-numeric">{row.code ?? row.id.slice(0, 8)}</span>
                      <small>{row.crew_name ?? row.resource_code ?? '—'}</small>
                    </button>
                  </li>
                ))}
              </ul>
              {dayRows.length > 4 && (
                <p className="vds-month__more">+{dayRows.length - 4} más — ver en Gantt o recurso</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="vds-note">
        Los contadores del día no se suman entre sí: una asignación despachada y una bloqueada son
        problemas distintos y una sola cifra no diría cuál.
      </p>
    </div>
  );
}
