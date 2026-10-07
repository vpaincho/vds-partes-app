/**
 * Planning.
 *
 * The surface Juan's prototype got right structurally: one period, three ways of looking at it, and a
 * drawer for the detail. `vGantt`, `vWeek` and `vMonth` all read the same `S.trabajos`, and this
 * keeps that — the view switch changes the grouping, never the question.
 *
 * What this adds is the honesty the prototype's single `estado` could not carry: the version a bar
 * belongs to, whether its readiness is still valid, whether a directive is outstanding, and whether
 * the window on screen is intention or reality. Those are the facts a planner needs before deciding,
 * and they are what the state machine of 49–56 actually tracks.
 */
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import {
  ApiError,
  fetchOccupancy,
  fetchTimeline,
  type OccupancyRow,
  type TimelineRow,
} from '../../api/client.ts';
import { AssignmentDrawer } from './AssignmentDrawer.tsx';
import { GanttView } from './GanttView.tsx';
import { MonthView } from './MonthView.tsx';
import { ResourceView } from './ResourceView.tsx';
import { fmtInstant, periodFor, periodQuery, shiftAnchor, type ViewMode } from './period.ts';
import { readinessView } from './state.ts';

const VIEWS: readonly { id: ViewMode; label: string; hint: string }[] = [
  { id: 'gantt', label: 'Gantt', hint: 'Barras por recurso sobre la semana' },
  { id: 'resource', label: 'Recurso', hint: 'Una fila por recurso, una celda por día, con ocupación' },
  { id: 'month', label: 'Mes', hint: 'Forma del mes: carga por día y excepciones' },
];

export interface PlanningProps {
  readonly capabilities: readonly string[];
  readonly onShowTrace: (subjectKind: string, subjectId: string) => void;
}

export function Planning({ capabilities, onShowTrace }: PlanningProps): JSX.Element {
  const [mode, setMode] = useState<ViewMode>('gantt');
  const [anchor, setAnchor] = useState(() => new Date());
  const [rows, setRows] = useState<readonly TimelineRow[]>([]);
  const [occupancy, setOccupancy] = useState<readonly OccupancyRow[]>([]);
  const [metrics, setMetrics] = useState<Record<string, string> | null>(null);
  const [meta, setMeta] = useState<{ source?: string; asOf?: string; scoped?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const period = useMemo(() => periodFor(mode, anchor), [mode, anchor]);

  const load = useCallback(async () => {
    setLoading(true);
    const query = periodQuery(period);
    try {
      const timeline = await fetchTimeline(query.from, query.to);
      setRows(timeline.data);
      setMeta(timeline.meta as { source?: string; asOf?: string; scoped?: boolean });
      setError(null);
      // Occupancy is only asked for where it is shown, and it is a separate read because it is a
      // separate question with its own declared metrics.
      if (mode === 'resource') {
        const result = await fetchOccupancy(query.from, query.to);
        setOccupancy(result.data);
        setMetrics(((result.meta as { metrics?: Record<string, string> }).metrics ?? null));
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'No se pudo cargar la planificación. Lo que se ve podría estar desactualizado.',
      );
    } finally {
      setLoading(false);
    }
  }, [period, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  // Counted separately, never summed: the point of the strip is to say WHICH problem there is.
  const summary = useMemo(() => {
    let notReady = 0;
    let expired = 0;
    let unevaluated = 0;
    let openDirectives = 0;
    let pendingExtensions = 0;
    let needsPermit = 0;
    for (const row of rows) {
      const readiness = readinessView(row);
      if (readiness.kind === 'NOT_READY') notReady += 1;
      if (readiness.kind === 'EXPIRED') expired += 1;
      if (readiness.kind === 'NONE') unevaluated += 1;
      openDirectives += Number(row.directives_open);
      pendingExtensions += Number(row.extension_pending);
      if (row.requires_work_permit) needsPermit += 1;
    }
    return { notReady, expired, unevaluated, openDirectives, pendingExtensions, needsPermit };
  }, [rows]);

  return (
    <div className="vds-planning" data-drawer={selected ? 'open' : 'closed'}>
      <div className="vds-planning__main">
        <header className="vds-planning__bar">
          <div className="vds-planning__period">
            <button
              type="button"
              className="vds-button vds-button--ghost"
              onClick={() => setAnchor((current) => shiftAnchor(mode, current, -1))}
              aria-label="Período anterior"
            >
              ‹
            </button>
            <strong className="vds-numeric">{period.label}</strong>
            <button
              type="button"
              className="vds-button vds-button--ghost"
              onClick={() => setAnchor((current) => shiftAnchor(mode, current, 1))}
              aria-label="Período siguiente"
            >
              ›
            </button>
            <button
              type="button"
              className="vds-button vds-button--ghost"
              onClick={() => setAnchor(new Date())}
            >
              Hoy
            </button>
          </div>

          <div className="vds-planning__views" role="group" aria-label="Vista">
            {VIEWS.map((view) => (
              <button
                key={view.id}
                type="button"
                className="vds-planning__view"
                aria-current={view.id === mode ? 'true' : undefined}
                title={view.hint}
                onClick={() => setMode(view.id)}
              >
                {view.label}
              </button>
            ))}
          </div>
        </header>

        {/* Six counts, each with its own remedy. A single "6 pendientes" was the prototype's defect. */}
        <ul className="vds-planning__counts" aria-label="Situación del período">
          <li data-tone="critical" data-zero={summary.notReady === 0}>
            <strong className="vds-numeric">{summary.notReady}</strong> NO_READY
          </li>
          <li data-tone="warn" data-zero={summary.expired === 0}>
            <strong className="vds-numeric">{summary.expired}</strong> READY vencido
          </li>
          <li data-tone="pending" data-zero={summary.unevaluated === 0}>
            <strong className="vds-numeric">{summary.unevaluated}</strong> sin evaluar
          </li>
          <li data-tone="pending" data-zero={summary.openDirectives === 0}>
            <strong className="vds-numeric">{summary.openDirectives}</strong> directivas sin aplicar
          </li>
          <li data-tone="pending" data-zero={summary.pendingExtensions === 0}>
            <strong className="vds-numeric">{summary.pendingExtensions}</strong> extensiones a resolver
          </li>
          <li data-tone="neutral" data-zero={summary.needsPermit === 0}>
            <strong className="vds-numeric">{summary.needsPermit}</strong> requieren PTW
          </li>
        </ul>

        {error && <p className="vds-error">{error}</p>}

        {loading && rows.length === 0 ? (
          <p className="vds-empty" aria-busy="true">
            Cargando el período…
          </p>
        ) : mode === 'gantt' ? (
          <GanttView period={period} rows={rows} selectedId={selected} onSelect={setSelected} />
        ) : mode === 'resource' ? (
          <ResourceView
            period={period}
            rows={rows}
            occupancy={occupancy}
            occupancyMetrics={metrics}
            selectedId={selected}
            onSelect={setSelected}
          />
        ) : (
          <MonthView period={period} rows={rows} selectedId={selected} onSelect={setSelected} />
        )}

        <p className="vds-asof vds-numeric">
          {meta?.source ?? '—'} · leído {fmtInstant(meta?.asOf)}
          {meta?.scoped === false && ' · alcance sin restricción de contrato para esta identidad'}
        </p>
      </div>

      {selected && (
        <AssignmentDrawer
          assignmentId={selected}
          capabilities={capabilities}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
          onShowTrace={onShowTrace}
        />
      )}
    </div>
  );
}
