/**
 * The drain loop: post the outbox in batches to `/sync/commands`, apply each per-item result.
 *
 * Every command in a batch runs through the exact same pipeline a live request would (apps/api/src/
 * sync/routes.ts), so this loop's only job is bookkeeping: what is this device's local view of each
 * command's delivery state, now that the server has answered. It never decides a domain outcome —
 * that already happened server-side, with its own authorisation and rules.
 *
 * No last-write-wins: a command that comes back retryable stays queued and is tried again next
 * drain; one that comes back with a non-retryable error moves to `REQUIERE_INTERVENCION` rather
 * than being discarded, because a captured fact does not stop being true just because it could not
 * be sent (12_OFFLINE_SYNC, generalising PD-0394).
 */
import type { VdsOfflineDb } from './db.ts';
import { outstandingCommands } from './outbox.ts';

export interface SyncTransport {
  /** POST /sync/commands. Throws only on a transport failure (no response at all), never on a per-item refusal. */
  postBatch(
    items: readonly { commandName: string; subjectId: string | null; envelope: Record<string, unknown> }[],
  ): Promise<{
    data: {
      results: readonly {
        commandId?: string;
        commandName: string;
        status: 'applied' | 'error';
        result?: { receipt: { receiptId: string; outcome: string; receiptAt: string } };
        error?: { code: string; message: string; retryable: boolean };
      }[];
    };
  }>;
}

export interface DrainResult {
  readonly received: number;
  readonly requeued: number;
  readonly requiresIntervention: number;
}

/**
 * Drain up to `batchSize` outstanding commands through `transport`, oldest first.
 *
 * Oldest-first matters beyond fairness: a later command in the same device's queue can depend on
 * an earlier one's new version (a replace, a close), and `execute()` on the server re-loads current
 * state per command rather than replaying an in-memory batch — so sending them out of order risks
 * the later one failing a gate the earlier one would have cleared.
 */
export async function drainOutbox(
  db: VdsOfflineDb,
  transport: SyncTransport,
  options: { batchSize?: number } = {},
): Promise<DrainResult> {
  const pending = await outstandingCommands(db);
  if (pending.length === 0) return { received: 0, requeued: 0, requiresIntervention: 0 };

  const batch = pending.slice(0, options.batchSize ?? 25);
  await db.commands.bulkUpdate(batch.map((c) => ({ key: c.commandId, changes: { state: 'ENVIANDO' } })));

  let response: Awaited<ReturnType<SyncTransport['postBatch']>>;
  try {
    response = await transport.postBatch(
      batch.map((c) => ({ commandName: c.commandName, subjectId: c.subjectId, envelope: c.envelope })),
    );
  } catch {
    // No answer at all: back to PENDIENTE, not ENVIADO — a timeout is not evidence of receipt.
    await db.commands.bulkUpdate(batch.map((c) => ({ key: c.commandId, changes: { state: 'PENDIENTE' } })));
    return { received: 0, requeued: batch.length, requiresIntervention: 0 };
  }

  let received = 0;
  let requeued = 0;
  let requiresIntervention = 0;
  const now = new Date().toISOString();

  for (const item of batch) {
    const result = response.data.results.find((r) => r.commandId === item.commandId);
    if (!result) {
      // The server dropped this item from its response — treat as not yet confirmed, retry later.
      await db.commands.update(item.commandId, { state: 'PENDIENTE', attempts: item.attempts + 1 });
      requeued++;
      continue;
    }

    if (result.status === 'applied' && result.result) {
      // RECIBIDO only because a receipt exists — never on the strength of a 200 alone.
      await db.commands.update(item.commandId, {
        state: 'RECIBIDO',
        receipt: result.result.receipt,
        receivedAt: now,
      });
      received++;
      continue;
    }

    const retryable = result.error?.retryable ?? false;
    await db.commands.update(item.commandId, {
      state: retryable ? 'PENDIENTE' : 'REQUIERE_INTERVENCION',
      attempts: item.attempts + 1,
      lastError: result.error?.message ?? 'El servidor rechazó el comando sin detalle.',
    });
    if (retryable) requeued++;
    else requiresIntervention++;
  }

  return { received, requeued, requiresIntervention };
}
