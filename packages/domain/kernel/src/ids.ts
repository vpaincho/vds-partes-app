/**
 * Identity.
 *
 * Two requirements from the baseline shape this:
 *
 *  1. **IDs must be generatable offline** (04: "IDs locales generables sin conexión"). A
 *     crew with no signal creates a Parte, UEs, intervals and evidence, and those rows must
 *     carry their final identity from the moment they are written to IndexedDB — not get
 *     renumbered on sync, which would break every local reference.
 *
 *  2. **Names are never keys** (04: "sin nombres como claves"; 09 audit: do not link people
 *     by name). The prototype keyed habilitations by `sujeto|operadora` string and crews by
 *     name; that cannot survive contact with real master data.
 *
 * UUIDv7 rather than v4: the first 48 bits are a millisecond timestamp, so ids sort by
 * creation time. That matters for an append-only schema — index locality on insert, and a
 * natural tiebreak when two events share a timestamp.
 *
 * Human-facing codes (PD-0394, PL-093) are a **separate concern handled by the server**.
 * The prototype derived them from `max+1` over local state, so two devices offline produce
 * the same code. See `HumanCode` below.
 */
import { randomUUID, randomFillSync } from 'node:crypto';

/** A UUID string. Branded so a bare string cannot be passed where an id is expected. */
export type Uuid = string & { readonly __brand: 'Uuid' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_ANY_VERSION_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Generate a UUIDv7: 48-bit big-endian millisecond timestamp, 4-bit version, 12 bits of
 * randomness, 2-bit variant, 62 bits of randomness (RFC 9562 §5.7).
 *
 * `now` is injectable so tests can assert monotonicity without waiting on the clock.
 */
export function uuidv7(now: number = Date.now()): Uuid {
  const bytes = new Uint8Array(16);
  randomFillSync(bytes);

  // 48-bit timestamp, most significant byte first.
  const ms = Math.floor(now);
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;

  // version 7 in the high nibble of byte 6
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  // RFC 4122 variant in the two high bits of byte 8
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as Uuid;
}

/** Extract the embedded creation time of a v7 id. Returns null for other versions. */
export function uuidv7Time(id: Uuid): Date | null {
  if (version(id) !== 7) return null;
  const hex = id.replaceAll('-', '').slice(0, 12);
  return new Date(Number.parseInt(hex, 16));
}

export function version(id: string): number | null {
  if (!UUID_ANY_VERSION_RE.test(id)) return null;
  return Number.parseInt(id[14] as string, 16);
}

export function isUuid(value: unknown): value is Uuid {
  return typeof value === 'string' && (UUID_RE.test(value) || UUID_ANY_VERSION_RE.test(value));
}

/** Parse an untrusted value into a Uuid, or throw. Used at the API boundary. */
export function toUuid(value: unknown, what = 'id'): Uuid {
  if (!isUuid(value)) throw new TypeError(`${what} is not a UUID: ${String(value)}`);
  return value;
}

/** A v4 UUID, for ids with no useful creation ordering (correlation, request). */
export function uuidv4(): Uuid {
  return randomUUID() as Uuid;
}

/**
 * A command id, minted on the device that originates the command and stable across every
 * retry of that command. Deduplication is `(scope_id, command_id)`, so the *same* id with a
 * *different* payload is a typed conflict, never a second effect (RGT-07).
 */
export type CommandId = Uuid & { readonly __command: true };
export const newCommandId = (now?: number): CommandId => uuidv7(now) as CommandId;

/** Correlates facts that belong to one causal story. Never a substitute for a command id. */
export type CorrelationId = Uuid & { readonly __correlation: true };
export const newCorrelationId = (): CorrelationId => uuidv4() as CorrelationId;

/** Identifies a physical device, so a shared tablet can isolate scope and queue. */
export type DeviceId = Uuid & { readonly __device: true };

/**
 * A human-facing code such as `PD-0394` or `PL-093`.
 *
 * Deliberately NOT derivable on the device. `index.html:841` computed the next part code as
 * `max(existing) + 1`, which makes two offline tablets mint the same code for different
 * work. Codes are allocated by the server from a sequence scoped to the issuing context, and
 * a row is perfectly valid with a UUID and no code yet — the code is a label, not identity.
 */
export interface HumanCode {
  readonly prefix: string;
  readonly value: string;
}

const CODE_RE = /^([A-Z]{2,4})-(\d{3,6})$/;

export function parseHumanCode(value: string): HumanCode | null {
  const match = CODE_RE.exec(value);
  if (!match) return null;
  return { prefix: match[1] as string, value };
}

export function formatHumanCode(prefix: string, sequence: number, width = 4): HumanCode {
  const value = `${prefix}-${String(sequence).padStart(width, '0')}`;
  return { prefix, value };
}
