/**
 * The outbox and drain loop, against a real (fake) IndexedDB — not a mocked Dexie, because the
 * point of this package is that the queue survives reload: fake-indexeddb is a faithful enough
 * IndexedDB implementation that Dexie's own transaction/versioning code runs unmodified.
 */
import 'fake-indexeddb/auto';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { VdsOfflineDb } from '../src/db.ts';
import { allCommands, discard, enqueueCommand, outstandingCommands, requeue } from '../src/outbox.ts';
import { drainOutbox, type SyncTransport } from '../src/sync.ts';

let db: VdsOfflineDb | null = null;

afterEach(async () => {
  if (db) {
    db.close();
    await db.delete();
    db = null;
  }
});

function freshDb(): VdsOfflineDb {
  db = new VdsOfflineDb(`test-${randomUUID()}`);
  return db;
}

function envelope(commandId: string): Record<string, unknown> {
  return { commandId, occurredAt: new Date().toISOString(), payload: {} };
}

describe('enqueueCommand', () => {
  it('commits a command as GUARDADO_LOCAL — nothing has left the device yet', async () => {
    const database = freshDb();
    const commandId = randomUUID();
    await enqueueCommand(database, { commandName: 'execution.units.start', subjectId: 'ue-1', envelope: envelope(commandId) });

    const rows = await allCommands(database);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('GUARDADO_LOCAL');
    expect(rows[0]!.commandId).toBe(commandId);
  });

  it('is keyed by commandId: re-enqueuing the same intent overwrites, never duplicates (RGT-06)', async () => {
    const database = freshDb();
    const commandId = randomUUID();
    await enqueueCommand(database, { commandName: 'execution.units.start', subjectId: 'ue-1', envelope: envelope(commandId) });
    await enqueueCommand(database, { commandName: 'execution.units.start', subjectId: 'ue-1', envelope: envelope(commandId) });

    const rows = await allCommands(database);
    expect(rows).toHaveLength(1);
  });

  it('refuses an envelope with no commandId', async () => {
    const database = freshDb();
    await expect(
      enqueueCommand(database, { commandName: 'execution.units.start', subjectId: null, envelope: { payload: {} } }),
    ).rejects.toThrow(/commandId/);
  });

  it('survives a fresh connection to the same database — the point of using IndexedDB at all', async () => {
    const name = `test-${randomUUID()}`;
    const first = new VdsOfflineDb(name);
    const commandId = randomUUID();
    await enqueueCommand(first, { commandName: 'execution.units.start', subjectId: 'ue-1', envelope: envelope(commandId) });
    first.close();

    const second = new VdsOfflineDb(name);
    const rows = await allCommands(second);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.commandId).toBe(commandId);
    second.close();
    await second.delete();
  });
});

function fakeTransport(
  handler: (
    items: readonly { commandName: string; subjectId: string | null; envelope: Record<string, unknown> }[],
  ) => Awaited<ReturnType<SyncTransport['postBatch']>>,
): SyncTransport {
  return { postBatch: async (items) => handler(items) };
}

describe('drainOutbox', () => {
  it('moves an applied command straight to RECIBIDO, with its receipt', async () => {
    const database = freshDb();
    const commandId = randomUUID();
    await enqueueCommand(database, { commandName: 'execution.units.start', subjectId: 'ue-1', envelope: envelope(commandId) });

    const transport = fakeTransport((items) => ({
      data: {
        results: items.map((item) => ({
          commandId: item.envelope['commandId'] as string,
          commandName: item.commandName,
          status: 'applied' as const,
          result: { receipt: { receiptId: randomUUID(), outcome: 'APPLIED', receiptAt: new Date().toISOString() } },
        })),
      },
    }));

    const result = await drainOutbox(database, transport);
    expect(result).toEqual({ received: 1, requeued: 0, requiresIntervention: 0 });

    const rows = await allCommands(database);
    expect(rows[0]!.state).toBe('RECIBIDO');
    expect(rows[0]!.receipt).toBeDefined();
    expect(await outstandingCommands(database)).toHaveLength(0);
  });

  it('keeps a retryable error PENDIENTE for the next drain, not RECIBIDO and not abandoned', async () => {
    const database = freshDb();
    const commandId = randomUUID();
    await enqueueCommand(database, { commandName: 'execution.units.start', subjectId: 'ue-1', envelope: envelope(commandId) });

    const transport = fakeTransport((items) => ({
      data: {
        results: items.map((item) => ({
          commandId: item.envelope['commandId'] as string,
          commandName: item.commandName,
          status: 'error' as const,
          error: { code: 'PROVIDER_UNAVAILABLE', message: 'timeout', retryable: true },
        })),
      },
    }));

    const result = await drainOutbox(database, transport);
    expect(result).toEqual({ received: 0, requeued: 1, requiresIntervention: 0 });

    const rows = await allCommands(database);
    expect(rows[0]!.state).toBe('PENDIENTE');
    expect(rows[0]!.attempts).toBe(1);
    expect(await outstandingCommands(database)).toHaveLength(1);
  });

  it('moves a non-retryable refusal to REQUIERE_INTERVENCION, preserving the declared command', async () => {
    const database = freshDb();
    const commandId = randomUUID();
    await enqueueCommand(database, { commandName: 'execution.units.start', subjectId: 'ue-1', envelope: envelope(commandId) });

    const transport = fakeTransport((items) => ({
      data: {
        results: items.map((item) => ({
          commandId: item.envelope['commandId'] as string,
          commandName: item.commandName,
          status: 'error' as const,
          error: { code: 'GATE_BLOCKED', message: 'PTW no vigente', retryable: false },
        })),
      },
    }));

    const result = await drainOutbox(database, transport);
    expect(result).toEqual({ received: 0, requeued: 0, requiresIntervention: 1 });

    const rows = await allCommands(database);
    expect(rows[0]!.state).toBe('REQUIERE_INTERVENCION');
    expect(rows[0]!.lastError).toMatch(/PTW/);

    // Nothing was discarded — the captured fact survives for a human to resolve (12_OFFLINE_SYNC).
    expect(await allCommands(database)).toHaveLength(1);
  });

  it('on a transport failure (no response at all), returns everything to PENDIENTE rather than claiming ENVIADO', async () => {
    const database = freshDb();
    const commandId = randomUUID();
    await enqueueCommand(database, { commandName: 'execution.units.start', subjectId: 'ue-1', envelope: envelope(commandId) });

    const transport: SyncTransport = { postBatch: async () => { throw new Error('network down'); } };

    const result = await drainOutbox(database, transport);
    expect(result).toEqual({ received: 0, requeued: 1, requiresIntervention: 0 });

    const rows = await allCommands(database);
    expect(rows[0]!.state).toBe('PENDIENTE');
  });

  it('does nothing when the outbox is empty', async () => {
    const database = freshDb();
    const transport = fakeTransport(() => ({ data: { results: [] } }));
    const result = await drainOutbox(database, transport);
    expect(result).toEqual({ received: 0, requeued: 0, requiresIntervention: 0 });
  });

  it('sends oldest-first, and a RECIBIDO command is excluded from the next drain', async () => {
    const database = freshDb();
    const first = randomUUID();
    const second = randomUUID();
    await enqueueCommand(database, { commandName: 'a', subjectId: null, envelope: envelope(first) });
    await enqueueCommand(database, { commandName: 'b', subjectId: null, envelope: envelope(second) });

    const seenOrder: string[] = [];
    const transport = fakeTransport((items) => {
      for (const item of items) seenOrder.push(item.envelope['commandId'] as string);
      return {
        data: {
          results: items.map((item) => ({
            commandId: item.envelope['commandId'] as string,
            commandName: item.commandName,
            status: 'applied' as const,
            result: { receipt: { receiptId: randomUUID(), outcome: 'APPLIED', receiptAt: new Date().toISOString() } },
          })),
        },
      };
    });

    await drainOutbox(database, transport);
    expect(seenOrder).toEqual([first, second]);
    expect(await outstandingCommands(database)).toHaveLength(0);

    // A second drain with nothing new outstanding must not resend what is already RECIBIDO.
    const secondDrainSeen: string[] = [];
    const secondTransport = fakeTransport((items) => {
      for (const item of items) secondDrainSeen.push(item.envelope['commandId'] as string);
      return { data: { results: [] } };
    });
    await drainOutbox(database, secondTransport);
    expect(secondDrainSeen).toHaveLength(0);
  });
});

describe('requeue / discard', () => {
  it('requeue moves a REQUIERE_INTERVENCION row back to PENDIENTE for the next drain', async () => {
    const database = freshDb();
    const commandId = randomUUID();
    await enqueueCommand(database, { commandName: 'a', subjectId: null, envelope: envelope(commandId) });
    await database.commands.update(commandId, { state: 'REQUIERE_INTERVENCION', lastError: 'x' });

    await requeue(database, commandId);
    const rows = await allCommands(database);
    expect(rows[0]!.state).toBe('PENDIENTE');
    expect(await outstandingCommands(database)).toHaveLength(1);
  });

  it('discard removes the row entirely', async () => {
    const database = freshDb();
    const commandId = randomUUID();
    await enqueueCommand(database, { commandName: 'a', subjectId: null, envelope: envelope(commandId) });
    await discard(database, commandId);
    expect(await allCommands(database)).toHaveLength(0);
  });
});
