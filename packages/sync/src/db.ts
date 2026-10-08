/**
 * The device's durable local store: Dexie over IndexedDB.
 *
 * 12_OFFLINE_SYNC / S0 §19: delivery state is its own dimension with five explicit values, never
 * folded into a boolean. `DeliveryState` reuses that exact vocabulary rather than inventing
 * SENT/FAILED — `GUARDADO_LOCAL` is the only thing true the instant a command is enqueued
 * ("nothing has left the device"), and `RECIBIDO` is claimable only once a server receipt exists.
 * "Guardado en el dispositivo" ≠ "Enviado" ≠ "Recibido" is the whole point.
 */
import { Dexie, type EntityTable } from 'dexie';

export type DeliveryState =
  | 'GUARDADO_LOCAL'
  | 'PENDIENTE'
  | 'ENVIANDO'
  | 'ENVIADO'
  | 'RECIBIDO'
  | 'REQUIERE_INTERVENCION';

export interface OutboxCommand {
  /** The envelope's own commandId. Re-enqueuing the same intent overwrites, never duplicates (RGT-06). */
  readonly commandId: string;
  readonly commandName: string;
  readonly subjectId: string | null;
  /** The full command envelope — commandId, occurredAt, expectedVersion?, payload, etc. */
  readonly envelope: Record<string, unknown>;
  readonly createdAt: string;
  /**
   * Strictly increasing within this device session. `createdAt` is millisecond-resolution and two
   * commands enqueued in the same tick (a double-tap, a tight batch-create loop) can tie on it;
   * IndexedDB then falls back to ordering by the primary key (`commandId`, a random uuid), which
   * has no relation to insertion order. `seq` is the actual oldest-first ordering key.
   */
  readonly seq: number;
  state: DeliveryState;
  attempts: number;
  lastError?: string;
  /** Set only once RECIBIDO — a durable server receipt, not a transport acknowledgement. */
  receipt?: Record<string, unknown>;
  receivedAt?: string;
}

export interface StoredBundle {
  /** The planned assignment this bundle was built for. */
  readonly assignmentId: string;
  readonly payload: Record<string, unknown>;
  readonly contentHash: string;
  readonly builtAt: string;
  readonly validUntil: string;
  readonly fetchedAt: string;
}

export class VdsOfflineDb extends Dexie {
  commands!: EntityTable<OutboxCommand, 'commandId'>;
  bundles!: EntityTable<StoredBundle, 'assignmentId'>;

  constructor(name = 'vds-partes-offline') {
    super(name);
    this.version(1).stores({
      commands: 'commandId, state, createdAt, seq',
      bundles: 'assignmentId, validUntil',
    });
  }
}
