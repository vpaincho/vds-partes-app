/**
 * The outbox: enqueue now, a quota failure is visible and blocks (RGT-09), and the queue survives
 * reload because it lives in IndexedDB rather than memory.
 */
import type { OutboxCommand, VdsOfflineDb } from './db.ts';

export class OutboxQuotaExceededError extends Error {
  constructor(cause: unknown) {
    super('No se pudo guardar en el dispositivo: almacenamiento lleno o no disponible.');
    this.cause = cause;
  }
}

/**
 * Commit a command to the local outbox.
 *
 * Keyed by the envelope's own `commandId`, so calling this twice for the same user intent (a
 * double-tap, a retried submit) overwrites the same row instead of creating a second one — the
 * client side of RGT-06. The row starts `GUARDADO_LOCAL`: true the instant this call returns,
 * since nothing has reached the network yet.
 */
export async function enqueueCommand(
  db: VdsOfflineDb,
  input: { commandName: string; subjectId: string | null; envelope: Record<string, unknown> },
): Promise<void> {
  const commandId = input.envelope['commandId'];
  if (typeof commandId !== 'string' || commandId.length === 0) {
    throw new Error('El envelope necesita un commandId estable antes de encolar (RGT-06).');
  }
  try {
    await db.commands.put({
      commandId,
      commandName: input.commandName,
      subjectId: input.subjectId,
      envelope: input.envelope,
      createdAt: new Date().toISOString(),
      state: 'GUARDADO_LOCAL',
      attempts: 0,
    });
  } catch (cause) {
    // A write that cannot commit must be visible, not silently dropped (RGT-09) — the caller
    // decides how to surface it; this never pretends the command was queued.
    throw new OutboxQuotaExceededError(cause);
  }
}

/** Everything not yet confirmed `RECIBIDO`, oldest first — order matters (see sync.ts). */
export async function outstandingCommands(db: VdsOfflineDb): Promise<readonly OutboxCommand[]> {
  return db.commands
    .where('state')
    .anyOf(['GUARDADO_LOCAL', 'PENDIENTE', 'REQUIERE_INTERVENCION'])
    .sortBy('createdAt');
}

export async function allCommands(db: VdsOfflineDb): Promise<readonly OutboxCommand[]> {
  return db.commands.orderBy('createdAt').toArray();
}

/**
 * A human decided to retry a REQUIERE_INTERVENCION row rather than abandon it.
 *
 * `lastError` is left as-is rather than cleared: the next drain overwrites it with that attempt's
 * own outcome, and until then the previous reason is still true information, not stale noise.
 */
export async function requeue(db: VdsOfflineDb, commandId: string): Promise<void> {
  await db.commands.update(commandId, { state: 'PENDIENTE' });
}

export async function discard(db: VdsOfflineDb, commandId: string): Promise<void> {
  await db.commands.delete(commandId);
}
