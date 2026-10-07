/**
 * Operational time.
 *
 * The prototype's time handling is the single richest source of defects, and every rule here
 * exists to prevent one of them:
 *
 *  - `dur()` (index.html:688) did `if (d < 0) d += 1440` — any end-before-start silently
 *    became "next day". A typo turned into a 23-hour shift, and a genuine night shift was
 *    indistinguishable from bad data. Here an inverted interval is **invalid input**, and
 *    crossing midnight is expressed by the instants themselves, which carry their date.
 *
 *  - The Parte was keyed by `fecha`, a local date, with a universal daily cut. C-013 and
 *    RGT-10 require the opposite: `operational_date` and `shift` are **explicit configured
 *    attributes**, never derived by truncating UTC or local midnight. A TP-03 night shift
 *    spanning 22:00–06:00 belongs to one operational date, decided by the configured shift
 *    boundary of that TipoParte and context.
 *
 *  - `sums()` (index.html:887) added interval durations even when they overlapped, so hours
 *    could be double-counted. Overlap is detected here and is a first-class fact
 *    (`ConflictoTemporal`, C-012 / RUL-027), not something silently summed.
 *
 * Instants are UTC. `occurred_at`, `recorded_at` and `received_at` are distinct, because a
 * fact reported late must keep both when it happened and when it was recorded (06: "Datos
 * reportados tarde guardan ocurrido_at/registrado_at").
 */

/** An instant in UTC, ISO 8601 with a Z offset. Branded to keep local strings out. */
export type Instant = string & { readonly __brand: 'Instant' };

/** A calendar date, `YYYY-MM-DD`. Not an instant: it has no time and no zone. */
export type OperationalDate = string & { readonly __brand: 'OperationalDate' };

/** A wall-clock time of day, `HH:MM`, in some stated zone. Never a timestamp by itself. */
export type TimeOfDay = string & { readonly __brand: 'TimeOfDay' };

/** IANA zone id. Operational, configured — never assumed. */
export type Zone = string & { readonly __brand: 'Zone' };

/** The zone VDS operates in. A default for configuration, not a hardcoded truth. */
export const DEFAULT_OPERATIONAL_ZONE = 'America/Argentina/Buenos_Aires' as Zone;

const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isInstant(value: unknown): value is Instant {
  return typeof value === 'string' && INSTANT_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function toInstant(value: unknown, what = 'instant'): Instant {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError(`${what} is an invalid Date`);
    return value.toISOString() as Instant;
  }
  if (!isInstant(value)) {
    throw new TypeError(
      `${what} must be an ISO 8601 UTC instant ending in Z, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

export const instantNow = (): Instant => new Date().toISOString() as Instant;
export const instantFrom = (date: Date): Instant => toInstant(date);
export const instantToDate = (instant: Instant): Date => new Date(instant);
export const compareInstants = (a: Instant, b: Instant): number =>
  Date.parse(a) - Date.parse(b) || a.localeCompare(b);

export function isOperationalDate(value: unknown): value is OperationalDate {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function toOperationalDate(value: unknown, what = 'operational date'): OperationalDate {
  if (!isOperationalDate(value)) {
    throw new TypeError(`${what} must be a valid YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function isTimeOfDay(value: unknown): value is TimeOfDay {
  return typeof value === 'string' && TIME_RE.test(value);
}

export function toTimeOfDay(value: unknown, what = 'time'): TimeOfDay {
  if (!isTimeOfDay(value)) {
    throw new TypeError(`${what} must be HH:MM in 24h form, got ${JSON.stringify(value)}`);
  }
  return value;
}

export const minutesOfDay = (time: TimeOfDay): number => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/* ------------------------------------------------------------------ zone handling */

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(zone: Zone): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    zoneFormatters.set(zone, formatter);
  }
  return formatter;
}

export interface ZonedParts {
  readonly date: OperationalDate;
  readonly time: TimeOfDay;
  readonly zone: Zone;
}

/** Project a UTC instant onto wall-clock parts in a zone. */
export function partsInZone(instant: Instant, zone: Zone = DEFAULT_OPERATIONAL_ZONE): ZonedParts {
  const parts = zoneFormatter(zone).formatToParts(instantToDate(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}` as OperationalDate;
  const time = `${get('hour')}:${get('minute')}` as TimeOfDay;
  return { date, time, zone };
}

export function addDays(date: OperationalDate, days: number): OperationalDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10) as OperationalDate;
}

export function daysBetween(from: OperationalDate, to: OperationalDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/* ------------------------------------------------- operational date and shift policy */

/**
 * How a context decides which operational day and shift a fact belongs to.
 *
 * This is **configuration**, resolved per TipoParte / contract-service / client. There is no
 * universal cut (C-007: "No existe ReglaCorte universal para ubicación/turno/recurso").
 * `dayStartsAt` of `00:00` reproduces a plain calendar day; `06:00` means work at 02:00
 * belongs to the previous operational day, which is what a night shift requires.
 */
export interface ShiftPolicy {
  readonly zone: Zone;
  /** Wall-clock time in `zone` at which a new operational day begins. */
  readonly dayStartsAt: TimeOfDay;
  /** Named shifts within the operational day. Optional: not every context has shifts. */
  readonly shifts?: readonly ShiftDefinition[];
  /** Where this policy came from, so a decision can be explained. */
  readonly source?: string;
}

export interface ShiftDefinition {
  readonly id: string;
  readonly label: string;
  /** Start wall-clock time in the policy zone. */
  readonly startsAt: TimeOfDay;
  /** Duration in minutes. May cross midnight; that is the normal case for a night shift. */
  readonly durationMinutes: number;
}

/** A calendar day in the policy zone, with no shift boundary offset. */
export const calendarDayPolicy = (zone: Zone = DEFAULT_OPERATIONAL_ZONE): ShiftPolicy => ({
  zone,
  dayStartsAt: '00:00' as TimeOfDay,
  source: 'calendar day (no configured shift boundary)',
});

export interface OperationalMoment {
  readonly operationalDate: OperationalDate;
  readonly shiftId: string | null;
  readonly localDate: OperationalDate;
  readonly localTime: TimeOfDay;
  readonly zone: Zone;
  /** Why this date was chosen, for DecisionTrace. */
  readonly basis: string;
}

/**
 * Resolve the operational date and shift of an instant under a policy.
 *
 * The operational date is NOT the UTC date and NOT necessarily the local calendar date: when
 * the local time falls before `dayStartsAt`, the fact belongs to the **previous** operational
 * day. That is the whole point of RGT-10 — a shift crossing midnight stays one operational
 * date, and no global automatic cut is applied.
 */
export function resolveOperationalMoment(
  instant: Instant,
  policy: ShiftPolicy,
): OperationalMoment {
  const { date: localDate, time: localTime } = partsInZone(instant, policy.zone);
  const boundary = minutesOfDay(policy.dayStartsAt);
  const local = minutesOfDay(localTime);

  const beforeBoundary = local < boundary;
  const operationalDate = beforeBoundary ? addDays(localDate, -1) : localDate;

  const shiftId = resolveShiftId(localTime, policy);

  return {
    operationalDate,
    shiftId,
    localDate,
    localTime,
    zone: policy.zone,
    basis: beforeBoundary
      ? `local ${localTime} is before the configured day start ${policy.dayStartsAt} in ` +
        `${policy.zone}, so the fact belongs to the previous operational day`
      : `local ${localTime} is at or after the configured day start ${policy.dayStartsAt} in ${policy.zone}`,
  };
}

function resolveShiftId(localTime: TimeOfDay, policy: ShiftPolicy): string | null {
  if (!policy.shifts || policy.shifts.length === 0) return null;
  const minute = minutesOfDay(localTime);
  for (const shift of policy.shifts) {
    const start = minutesOfDay(shift.startsAt);
    const end = start + shift.durationMinutes;
    // A shift may cross midnight; test both the direct window and its wrapped tail.
    if (minute >= start && minute < end) return shift.id;
    if (end > 1440 && minute < end - 1440) return shift.id;
  }
  return null;
}

/* ----------------------------------------------------------------------- intervals */

/** A half-open interval `[startedAt, endedAt)`. `endedAt: null` means still open. */
export interface Interval {
  readonly startedAt: Instant;
  readonly endedAt: Instant | null;
}

export class InvalidIntervalError extends Error {
  // Declared and assigned explicitly rather than as a constructor parameter property:
  // tsconfig sets erasableSyntaxOnly so these sources run under Node's type stripping.
  readonly interval: Interval;

  constructor(interval: Interval, message: string) {
    super(message);
    this.name = 'InvalidIntervalError';
    this.interval = interval;
  }
}

/**
 * Validate an interval. An end at or before the start is **rejected**, never reinterpreted.
 *
 * This is the direct fix for `dur()`: the prototype added 24h to any negative duration, so
 * `18:00 → 06:00` and a mistyped `18:00 → 06:00 same day` were indistinguishable. Because
 * instants carry their date, a real night shift needs no special case.
 */
export function assertValidInterval(interval: Interval, what = 'interval'): void {
  if (interval.endedAt === null) return;
  const start = Date.parse(interval.startedAt);
  const end = Date.parse(interval.endedAt);
  if (end === start) {
    throw new InvalidIntervalError(interval, `${what} has zero duration (${interval.startedAt})`);
  }
  if (end < start) {
    throw new InvalidIntervalError(
      interval,
      `${what} ends before it starts (${interval.startedAt} → ${interval.endedAt}). ` +
        'An inverted interval is invalid data, not an implicit next-day roll-over: ' +
        'a shift that crosses midnight is expressed by the instants themselves.',
    );
  }
}

/** Duration in minutes. Throws on an inverted interval; null while still open. */
export function durationMinutes(interval: Interval): number | null {
  assertValidInterval(interval);
  if (interval.endedAt === null) return null;
  return (Date.parse(interval.endedAt) - Date.parse(interval.startedAt)) / 60_000;
}

/** Do two half-open intervals overlap? An open interval extends to infinity. */
export function overlaps(a: Interval, b: Interval): boolean {
  assertValidInterval(a, 'first interval');
  assertValidInterval(b, 'second interval');
  const aStart = Date.parse(a.startedAt);
  const bStart = Date.parse(b.startedAt);
  const aEnd = a.endedAt === null ? Number.POSITIVE_INFINITY : Date.parse(a.endedAt);
  const bEnd = b.endedAt === null ? Number.POSITIVE_INFINITY : Date.parse(b.endedAt);
  return aStart < bEnd && bStart < aEnd;
}

export function overlapMinutes(a: Interval, b: Interval): number {
  if (!overlaps(a, b)) return 0;
  const start = Math.max(Date.parse(a.startedAt), Date.parse(b.startedAt));
  const aEnd = a.endedAt === null ? Number.POSITIVE_INFINITY : Date.parse(a.endedAt);
  const bEnd = b.endedAt === null ? Number.POSITIVE_INFINITY : Date.parse(b.endedAt);
  const end = Math.min(aEnd, bEnd);
  if (!Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return (end - start) / 60_000;
}

/**
 * Total covered minutes across intervals, counting overlapping time **once**.
 *
 * `sums()` in the prototype added each interval's duration independently, so two overlapping
 * time rows inflated the hours. Union semantics are what "how long was this person present"
 * actually means. Overlap is still reported separately — see `findOverlaps` — because an
 * incompatible overlap is a fact to resolve (C-012), not something to quietly absorb.
 */
export function unionMinutes(intervals: readonly Interval[]): number | null {
  const closed: Interval[] = [];
  for (const interval of intervals) {
    assertValidInterval(interval);
    if (interval.endedAt === null) return null; // an open interval has no final total
    closed.push(interval);
  }
  if (closed.length === 0) return 0;

  const sorted = [...closed].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  let total = 0;
  let cursorStart = Date.parse((sorted[0] as Interval).startedAt);
  let cursorEnd = Date.parse((sorted[0] as Interval).endedAt as Instant);

  for (const interval of sorted.slice(1)) {
    const start = Date.parse(interval.startedAt);
    const end = Date.parse(interval.endedAt as Instant);
    if (start <= cursorEnd) {
      cursorEnd = Math.max(cursorEnd, end);
    } else {
      total += cursorEnd - cursorStart;
      cursorStart = start;
      cursorEnd = end;
    }
  }
  total += cursorEnd - cursorStart;
  return total / 60_000;
}

export interface OverlapFinding<T> {
  readonly a: T;
  readonly b: T;
  readonly minutes: number;
}

/**
 * Every overlapping pair in a set. The caller decides whether an overlap is acceptable:
 * RUL-027 and C-012 are explicit that **not every overlap is a conflict** — shared support
 * resources can legitimately overlap — so this reports, and the rule engine judges.
 */
export function findOverlaps<T>(
  items: readonly T[],
  intervalOf: (item: T) => Interval,
): OverlapFinding<T>[] {
  const findings: OverlapFinding<T>[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i] as T;
      const b = items[j] as T;
      const ia = intervalOf(a);
      const ib = intervalOf(b);
      if (overlaps(ia, ib)) {
        findings.push({ a, b, minutes: overlapMinutes(ia, ib) });
      }
    }
  }
  return findings;
}

/* ------------------------------------------------------------------- fact timestamps */

/** Where a timestamp came from. A device clock does not prove ordering or authorisation. */
export type TimeSource = 'DEVICE_CLOCK' | 'SERVER_CLOCK' | 'USER_DECLARED' | 'EXTERNAL_SOURCE';

/**
 * The timestamps a fact carries.
 *
 * `occurredAt` is when the thing happened in the world; `recordedAt` when it was captured;
 * `receivedAt` when the server committed it. They are kept apart so that a fact reported late
 * stays honest — and so that "a signature arrived at 11:25" can never be read as "work at
 * 07:20 was authorised" (PD-0394 / RGT-02).
 */
export interface FactTimestamps {
  readonly occurredAt: Instant;
  readonly recordedAt: Instant;
  readonly receivedAt: Instant | null;
  readonly timeSource: TimeSource;
  /** Known device/server clock skew in ms, when measured. Not a correction — a record. */
  readonly clockSkewMs?: number;
}

/** Was this fact reported after it happened by more than `toleranceMinutes`? */
export function isLateReported(stamps: FactTimestamps, toleranceMinutes = 5): boolean {
  return (
    Date.parse(stamps.recordedAt) - Date.parse(stamps.occurredAt) > toleranceMinutes * 60_000
  );
}

/** Is a moment covered by a validity window? Used for PTW, readiness and bundles. */
export function isWithin(
  moment: Instant,
  window: { readonly validFrom: Instant; readonly validUntil: Instant | null },
): boolean {
  const at = Date.parse(moment);
  if (at < Date.parse(window.validFrom)) return false;
  if (window.validUntil === null) return true;
  return at < Date.parse(window.validUntil);
}
