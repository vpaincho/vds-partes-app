import { describe, expect, it } from 'vitest';
import {
  formatHumanCode,
  isUuid,
  newCommandId,
  parseHumanCode,
  toUuid,
  uuidv4,
  uuidv7,
  uuidv7Time,
  version,
} from '../src/ids.ts';

describe('UUIDv7 — generatable offline, ordered by creation', () => {
  it('produces a well-formed v7 uuid', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(version(id)).toBe(7);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('embeds the creation millisecond, so an id sorts by time', () => {
    const now = Date.UTC(2026, 9, 5, 10, 20, 0);
    const id = uuidv7(now);
    expect(uuidv7Time(id)?.getTime()).toBe(now);
  });

  it('sorts lexicographically in creation order — index locality for append-only tables', () => {
    const base = Date.UTC(2026, 9, 5, 10, 0, 0);
    const ids = [0, 1, 2, 3, 4].map((n) => uuidv7(base + n * 1000));
    expect([...ids].sort()).toEqual(ids);
  });

  it('does not collide across many ids minted in the same millisecond', () => {
    const now = Date.now();
    const ids = new Set(Array.from({ length: 5000 }, () => uuidv7(now)));
    // 74 random bits per id in the same millisecond: a collision here means the random fill
    // is broken, which would be far worse than a duplicate.
    expect(ids.size).toBe(5000);
  });

  it('two devices offline mint different ids — the collision nextPD() could not avoid', () => {
    // index.html:841 derived the next code from max(existing)+1 over local state, so two
    // disconnected tablets produce the same identifier for different work.
    const now = Date.now();
    const deviceA = Array.from({ length: 50 }, () => uuidv7(now));
    const deviceB = Array.from({ length: 50 }, () => uuidv7(now));
    expect(new Set([...deviceA, ...deviceB]).size).toBe(100);
  });

  it('rejects a non-uuid at the boundary, with the field named', () => {
    expect(() => toUuid('PD-0394', 'parte_id')).toThrow(/parte_id is not a UUID/);
    expect(() => toUuid(undefined, 'command_id')).toThrow(/command_id/);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(42)).toBe(false);
  });

  it('accepts v4 too — correlation ids have no useful creation ordering', () => {
    const id = uuidv4();
    expect(isUuid(id)).toBe(true);
    expect(version(id)).toBe(4);
  });

  it('mints command ids that are v7, so a device queue replays in order', () => {
    expect(version(newCommandId())).toBe(7);
  });
});

describe('human codes are labels allocated by the server, not identity', () => {
  it('parses the prototype’s code shapes', () => {
    expect(parseHumanCode('PD-0394')).toEqual({ prefix: 'PD', value: 'PD-0394' });
    expect(parseHumanCode('PL-093')).toEqual({ prefix: 'PL', value: 'PL-093' });
  });

  it('rejects anything that is not a code', () => {
    expect(parseHumanCode('0394')).toBeNull();
    expect(parseHumanCode('pd-0394')).toBeNull();
    expect(parseHumanCode('')).toBeNull();
  });

  it('formats from a server-allocated sequence', () => {
    expect(formatHumanCode('PD', 394).value).toBe('PD-0394');
    expect(formatHumanCode('PL', 93, 3).value).toBe('PL-093');
  });

  it('is not a uuid, and so can never be used as a key', () => {
    expect(isUuid('PD-0394')).toBe(false);
  });
});
