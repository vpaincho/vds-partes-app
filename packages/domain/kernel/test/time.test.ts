/**
 * Operational time.
 *
 * Several of these are regression tests against the prototype by construction: they feed the
 * exact inputs that `dur()`, `sums()` and the `fecha`-keyed daily cut got wrong, and assert
 * the new behaviour. RGT-10 (shift crossing midnight) lives here.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPERATIONAL_ZONE,
  InvalidIntervalError,
  addDays,
  assertValidInterval,
  calendarDayPolicy,
  compareInstants,
  daysBetween,
  durationMinutes,
  findOverlaps,
  isLateReported,
  isWithin,
  overlapMinutes,
  overlaps,
  partsInZone,
  resolveOperationalMoment,
  toInstant,
  toOperationalDate,
  toTimeOfDay,
  unionMinutes,
  type Instant,
  type Interval,
  type ShiftPolicy,
  type TimeOfDay,
  type Zone,
} from '../src/time.ts';

const at = (iso: string): Instant => toInstant(iso);
const interval = (startedAt: string, endedAt: string | null = null): Interval => ({
  startedAt: at(startedAt),
  endedAt: endedAt === null ? null : at(endedAt),
});

describe('instants are UTC and validated', () => {
  it('accepts ISO 8601 with Z', () => {
    expect(toInstant('2026-10-05T10:20:00Z')).toBe('2026-10-05T10:20:00Z');
    expect(toInstant('2026-10-05T10:20:00.123Z')).toBe('2026-10-05T10:20:00.123Z');
  });

  it('rejects a local timestamp with no zone — the ambiguity the prototype relied on', () => {
    expect(() => toInstant('2026-10-05T10:20:00')).toThrow(/must be an ISO 8601 UTC instant/);
    expect(() => toInstant('2026-10-05 10:20')).toThrow();
    expect(() => toInstant('10:20')).toThrow();
  });

  it('rejects an offset other than Z, so storage has one representation', () => {
    expect(() => toInstant('2026-10-05T10:20:00-03:00')).toThrow();
  });

  it('orders instants', () => {
    expect(compareInstants(at('2026-10-05T10:00:00Z'), at('2026-10-05T11:00:00Z'))).toBeLessThan(0);
  });
});

describe('operational date is configured, never derived from midnight (RGT-10)', () => {
  const zone = DEFAULT_OPERATIONAL_ZONE;

  // A night shift that starts at 22:00 local and runs 8 hours. The operational day is
  // configured to begin at 06:00, so everything from 22:00 to 06:00 belongs to ONE date.
  const nightPolicy: ShiftPolicy = {
    zone,
    dayStartsAt: '06:00' as TimeOfDay,
    shifts: [
      { id: 'NOCHE', label: 'Noche', startsAt: '22:00' as TimeOfDay, durationMinutes: 480 },
      { id: 'DIA', label: 'Día', startsAt: '06:00' as TimeOfDay, durationMinutes: 720 },
    ],
    source: 'test fixture',
  };

  it('keeps 22:00 and 02:00 on the same operational date across local midnight', () => {
    // Argentina is UTC-3, so 22:00 local on the 5th is 01:00Z on the 6th.
    const before = resolveOperationalMoment(at('2026-10-06T01:00:00Z'), nightPolicy);
    const after = resolveOperationalMoment(at('2026-10-06T05:00:00Z'), nightPolicy);

    expect(before.localTime).toBe('22:00');
    expect(after.localTime).toBe('02:00');
    // Different local calendar dates...
    expect(before.localDate).toBe('2026-10-05');
    expect(after.localDate).toBe('2026-10-06');
    // ...one operational date.
    expect(before.operationalDate).toBe('2026-10-05');
    expect(after.operationalDate).toBe('2026-10-05');
    expect(before.shiftId).toBe('NOCHE');
    expect(after.shiftId).toBe('NOCHE');
  });

  it('explains which boundary decided the date, for DecisionTrace', () => {
    const moment = resolveOperationalMoment(at('2026-10-06T05:00:00Z'), nightPolicy);
    expect(moment.basis).toMatch(/before the configured day start 06:00/);
    expect(moment.basis).toContain(zone);
  });

  it('rolls to the next operational date once the boundary passes', () => {
    // 06:00 local on the 6th = 09:00Z.
    const moment = resolveOperationalMoment(at('2026-10-06T09:00:00Z'), nightPolicy);
    expect(moment.localTime).toBe('06:00');
    expect(moment.operationalDate).toBe('2026-10-06');
    expect(moment.shiftId).toBe('DIA');
  });

  it('reproduces a plain calendar day when no boundary is configured', () => {
    const policy = calendarDayPolicy(zone);
    const moment = resolveOperationalMoment(at('2026-10-06T05:00:00Z'), policy);
    expect(moment.operationalDate).toBe('2026-10-06');
    expect(moment.shiftId).toBeNull();
  });

  it('does not use the UTC date — the bug a naive truncation would reintroduce', () => {
    // 21:00 local on the 5th is 00:00Z on the 6th. A UTC-midnight cut would file this work
    // under the 6th; the operational day (and the local day) is the 5th.
    const moment = resolveOperationalMoment(at('2026-10-06T00:00:00Z'), calendarDayPolicy(zone));
    expect(moment.localTime).toBe('21:00');
    expect(moment.operationalDate).toBe('2026-10-05');
  });

  it('projects instants into an arbitrary configured zone, not a hardcoded one', () => {
    const parts = partsInZone(at('2026-10-06T01:00:00Z'), 'UTC' as Zone);
    expect(parts.date).toBe('2026-10-06');
    expect(parts.time).toBe('01:00');
  });
});

describe('intervals reject inverted input instead of adding a day (fixes dur())', () => {
  it('throws when the end precedes the start, and says why', () => {
    // index.html:688 turned this into 12 hours by adding 1440 minutes.
    const inverted = interval('2026-10-05T18:00:00Z', '2026-10-05T06:00:00Z');
    expect(() => durationMinutes(inverted)).toThrow(InvalidIntervalError);
    expect(() => durationMinutes(inverted)).toThrow(/invalid data, not an implicit next-day/);
  });

  it('throws on a zero-length interval', () => {
    expect(() => assertValidInterval(interval('2026-10-05T06:00:00Z', '2026-10-05T06:00:00Z'))).toThrow(
      /zero duration/,
    );
  });

  it('needs no special case for a real shift across midnight', () => {
    // 22:00 to 06:00 next day, expressed by the instants themselves.
    expect(durationMinutes(interval('2026-10-06T01:00:00Z', '2026-10-06T09:00:00Z'))).toBe(480);
  });

  it('reports an open interval as having no duration yet', () => {
    expect(durationMinutes(interval('2026-10-05T06:00:00Z'))).toBeNull();
  });
});

describe('overlap is detected, not silently summed (fixes sums())', () => {
  it('detects overlap on half-open intervals and treats touching as disjoint', () => {
    expect(
      overlaps(
        interval('2026-10-05T06:00:00Z', '2026-10-05T08:00:00Z'),
        interval('2026-10-05T07:00:00Z', '2026-10-05T09:00:00Z'),
      ),
    ).toBe(true);
    // [06,08) and [08,10) share only the boundary instant: not an overlap.
    expect(
      overlaps(
        interval('2026-10-05T06:00:00Z', '2026-10-05T08:00:00Z'),
        interval('2026-10-05T08:00:00Z', '2026-10-05T10:00:00Z'),
      ),
    ).toBe(false);
  });

  it('treats an open interval as extending indefinitely', () => {
    expect(
      overlaps(
        interval('2026-10-05T06:00:00Z'),
        interval('2026-10-05T23:00:00Z', '2026-10-06T01:00:00Z'),
      ),
    ).toBe(true);
  });

  it('quantifies the overlap', () => {
    expect(
      overlapMinutes(
        interval('2026-10-05T06:00:00Z', '2026-10-05T08:00:00Z'),
        interval('2026-10-05T07:00:00Z', '2026-10-05T09:00:00Z'),
      ),
    ).toBe(60);
  });

  it('counts overlapping time once when totalling presence', () => {
    // Two overlapping time rows: the prototype summed 120 + 120 = 240 minutes.
    const rows = [
      interval('2026-10-05T06:00:00Z', '2026-10-05T08:00:00Z'),
      interval('2026-10-05T07:00:00Z', '2026-10-05T09:00:00Z'),
    ];
    expect(unionMinutes(rows)).toBe(180);
    expect(rows.reduce((n, i) => n + (durationMinutes(i) ?? 0), 0)).toBe(240); // the old answer
  });

  it('unions disjoint intervals without inventing the gap', () => {
    expect(
      unionMinutes([
        interval('2026-10-05T06:00:00Z', '2026-10-05T08:00:00Z'),
        interval('2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z'),
      ]),
    ).toBe(180);
  });

  it('refuses to total a set that is still open', () => {
    expect(unionMinutes([interval('2026-10-05T06:00:00Z')])).toBeNull();
  });

  it('lists overlapping pairs for the rule engine to judge, not for the clock to decide', () => {
    // RUL-027 / C-012: not every overlap is a conflict. Shared support resources may overlap
    // legitimately, so this reports pairs and the rule decides BLOCK or WARN.
    const assignments = [
      { id: 'a', ...interval('2026-10-05T06:00:00Z', '2026-10-05T12:00:00Z') },
      { id: 'b', ...interval('2026-10-05T11:00:00Z', '2026-10-05T14:00:00Z') },
      { id: 'c', ...interval('2026-10-05T15:00:00Z', '2026-10-05T16:00:00Z') },
    ];
    const findings = findOverlaps(assignments, (a) => a);
    expect(findings).toHaveLength(1);
    expect([findings[0]!.a.id, findings[0]!.b.id]).toEqual(['a', 'b']);
    expect(findings[0]!.minutes).toBe(60);
  });
});

describe('fact timestamps keep when it happened apart from when it was recorded', () => {
  it('flags a late report without altering the occurrence (PD-0394 shape)', () => {
    // Work at 07:20, captured at 11:25. Both are kept; the gap is visible.
    const stamps = {
      occurredAt: at('2026-10-05T10:20:00Z'),
      recordedAt: at('2026-10-05T14:25:00Z'),
      receivedAt: at('2026-10-05T14:26:00Z'),
      timeSource: 'USER_DECLARED' as const,
    };
    expect(isLateReported(stamps)).toBe(true);
    // The occurrence is untouched: a later record never rewrites when it happened.
    expect(stamps.occurredAt).toBe('2026-10-05T10:20:00Z');
  });

  it('does not flag a prompt report', () => {
    expect(
      isLateReported({
        occurredAt: at('2026-10-05T10:20:00Z'),
        recordedAt: at('2026-10-05T10:21:00Z'),
        receivedAt: null,
        timeSource: 'DEVICE_CLOCK',
      }),
    ).toBe(false);
  });
});

describe('validity windows', () => {
  it('covers the start instant and excludes the end', () => {
    const window = { validFrom: at('2026-10-05T10:00:00Z'), validUntil: at('2026-10-05T12:00:00Z') };
    expect(isWithin(at('2026-10-05T10:00:00Z'), window)).toBe(true);
    expect(isWithin(at('2026-10-05T11:59:59Z'), window)).toBe(true);
    expect(isWithin(at('2026-10-05T12:00:00Z'), window)).toBe(false);
    expect(isWithin(at('2026-10-05T09:59:59Z'), window)).toBe(false);
  });

  it('answers the PD-0394 question: a window opened at 11:25 does not cover 07:20', () => {
    const ptw = { validFrom: at('2026-10-05T14:25:00Z'), validUntil: null };
    expect(isWithin(at('2026-10-05T10:20:00Z'), ptw)).toBe(false);
    expect(isWithin(at('2026-10-05T14:30:00Z'), ptw)).toBe(true);
  });

  it('treats a null end as still in force', () => {
    expect(isWithin(at('2030-01-01T00:00:00Z'), { validFrom: at('2026-10-05T10:00:00Z'), validUntil: null })).toBe(
      true,
    );
  });
});

describe('date arithmetic', () => {
  it('adds and subtracts days across month and year ends', () => {
    expect(addDays(toOperationalDate('2026-10-31'), 1)).toBe('2026-11-01');
    expect(addDays(toOperationalDate('2026-01-01'), -1)).toBe('2025-12-31');
  });

  it('counts days between dates', () => {
    expect(daysBetween(toOperationalDate('2026-10-05'), toOperationalDate('2026-10-09'))).toBe(4);
  });

  it('rejects an impossible date', () => {
    expect(() => toOperationalDate('2026-02-30')).toThrow();
    expect(() => toOperationalDate('2026-13-01')).toThrow();
  });

  it('rejects a 24-hour clock value out of range', () => {
    expect(() => toTimeOfDay('24:00')).toThrow();
    expect(() => toTimeOfDay('7:30')).toThrow(); // must be zero-padded
  });
});
