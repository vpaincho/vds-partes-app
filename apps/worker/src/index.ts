/**
 * Worker entrypoint: scheduled sweeps, not the command pipeline.
 *
 * Jobs registered so far: `expiries`, `commercial-recalc` (RUL-065, consuming the
 * `execution.amendment.approved` outbox event specifically). `19_IMPLEMENTATION_WAVES` also names a
 * general-purpose `outbox` job, `readiness`, `reconcile`, `erp` and `notifications` for this process
 * — each needs a scoping or consumer decision (see apps/api/src/sync/routes.ts's module doc for why
 * the general `outbox` fan-out specifically is not here yet) and is not stubbed out here rather than
 * guessed at.
 */
import { initDb, withTransaction, closeDb } from './db.ts';
import { runExpiriesJob } from './jobs/expiries.ts';
import { runCommercialRecalcJob } from './jobs/commercial-recalc.ts';

const POLL_INTERVAL_MS = Number(process.env['WORKER_POLL_INTERVAL_MS'] ?? 30_000);

async function tick(): Promise<void> {
  const expiries = await withTransaction((db) => runExpiriesJob(db));
  if (expiries.permitsExpired.length > 0 || expiries.directivesExpired.length > 0) {
    console.log(
      `[worker] expiries: ${expiries.permitsExpired.length} permit(s) -> VENCIDO, ` +
        `${expiries.directivesExpired.length} directive(s) -> EXPIRADA`,
    );
  }

  const recalc = await withTransaction((db) => runCommercialRecalcJob(db));
  if (recalc.unitsFlagged.length > 0) {
    console.log(
      `[worker] commercial-recalc: ${recalc.outboxEventsProcessed} amendment(s) processed, ` +
        `${recalc.unitsFlagged.length} commercial unit(s) -> REQUIERE_RECALCULO`,
    );
  }
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  initDb(process.env['DATABASE_URL'] ?? 'postgres://vds:vds_dev_only@127.0.0.1:5434/vds_partes');
  console.log(`VDS Partes worker started, polling every ${POLL_INTERVAL_MS}ms`);

  let stopping = false;
  const loop = async (): Promise<void> => {
    while (!stopping) {
      try {
        await tick();
      } catch (error) {
        console.error('[worker] tick failed', error);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  };

  const shutdown = async (): Promise<void> => {
    stopping = true;
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  void loop();
}
