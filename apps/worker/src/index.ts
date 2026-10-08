/**
 * Worker entrypoint: scheduled sweeps, not the command pipeline.
 *
 * Jobs registered so far: `expiries`. `19_IMPLEMENTATION_WAVES` also names `outbox`, `readiness`,
 * `reconcile`, `erp` and `notifications` for this process — each needs a scoping or consumer
 * decision (see apps/api/src/sync/routes.ts's module doc for why `outbox` specifically is not here
 * yet) and is not stubbed out here rather than guessed at.
 */
import { initDb, withTransaction, closeDb } from './db.ts';
import { runExpiriesJob } from './jobs/expiries.ts';

const POLL_INTERVAL_MS = Number(process.env['WORKER_POLL_INTERVAL_MS'] ?? 30_000);

async function tick(): Promise<void> {
  const result = await withTransaction((db) => runExpiriesJob(db));
  if (result.permitsExpired.length > 0 || result.directivesExpired.length > 0) {
    console.log(
      `[worker] expiries: ${result.permitsExpired.length} permit(s) -> VENCIDO, ` +
        `${result.directivesExpired.length} directive(s) -> EXPIRADA`,
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
