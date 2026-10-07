/**
 * The period the three planning views share.
 *
 * Gantt, resource calendar and month are one projection over one period (07). Keeping the period in
 * one place is what makes switching views a change of grouping rather than a change of question —
 * and it is why moving between them never silently reloads a different range.
 *
 * Operational dates, not UTC days. The boundary between one operational day and the next is
 * configuration, not midnight UTC (C-013, RGT-10); until the shift policy is configured per contract
 * these views group by the `operational_date` the server already resolved, and the local-day maths
 * here is only used to pick the *range to ask for*.
 */
export type ViewMode = 'gantt' | 'resource' | 'month';

export interface Period {
  /** Inclusive start, local midnight. */
  readonly from: Date;
  /** Exclusive end, local midnight. */
  readonly to: Date;
  readonly label: string;
  readonly days: number;
}

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** A week-ish window for the Gantt, starting on Monday so the operational week reads naturally. */
export function weekPeriod(anchor: Date): Period {
  const base = startOfDay(anchor);
  const monday = addDays(base, -((base.getDay() + 6) % 7));
  const to = addDays(monday, 7);
  return {
    from: monday,
    to,
    days: 7,
    label: `${monday.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} – ${addDays(
      monday,
      6,
    ).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}`,
  };
}

export function monthPeriod(anchor: Date): Period {
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return {
    from,
    to,
    days,
    label: from.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
  };
}

export const periodFor = (mode: ViewMode, anchor: Date): Period =>
  mode === 'month' ? monthPeriod(anchor) : weekPeriod(anchor);

/** Move the anchor by one whole period in either direction. */
export const shiftAnchor = (mode: ViewMode, anchor: Date, direction: -1 | 1): Date =>
  mode === 'month'
    ? new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)
    : addDays(anchor, direction * 7);

/** The instants to ask the server for. Half-open, so a bar ending at midnight belongs to one day. */
export const periodQuery = (period: Period): { from: string; to: string } => ({
  from: period.from.toISOString(),
  to: period.to.toISOString(),
});

export const dayKeys = (period: Period): readonly string[] =>
  Array.from({ length: period.days }, (_, i) => localDateKey(addDays(period.from, i)));

/** `YYYY-MM-DD` in local time, to match the server's `operational_date` text. */
export function localDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Where a bar sits inside the period, as percentages.
 *
 * Clipped to the period, with a flag saying it was clipped: a bar that continues past the edge must
 * look like it continues, not like it ends there. The prototype truncated silently and a job that
 * ran into the next week looked finished.
 */
export function barGeometry(
  period: Period,
  windowStart: string,
  windowEnd: string,
): { left: number; width: number; clippedStart: boolean; clippedEnd: boolean } {
  const span = period.to.getTime() - period.from.getTime();
  const start = new Date(windowStart).getTime();
  const end = new Date(windowEnd).getTime();
  const clampedStart = Math.max(start, period.from.getTime());
  const clampedEnd = Math.min(end, period.to.getTime());
  const left = ((clampedStart - period.from.getTime()) / span) * 100;
  const width = Math.max(((clampedEnd - clampedStart) / span) * 100, 0.6);
  return {
    left,
    width: Math.min(width, 100 - left),
    clippedStart: start < period.from.getTime(),
    clippedEnd: end > period.to.getTime(),
  };
}

/** `es-AR` instant, short. Used wherever a figure needs to be comparable at a glance. */
export const fmtInstant = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export const fmtDate = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleDateString('es-AR', { dateStyle: 'short' }) : '—';
