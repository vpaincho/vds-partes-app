/**
 * Database access for the worker.
 *
 * Deliberately not shared code with apps/api/src/platform/db.ts: 03_TARGET_ARCHITECTURE's shared
 * layer is packages/domain, not another app's platform wiring, and this file is a fraction of that
 * one's size — the worker runs scheduled sweeps, not the command pipeline, so it needs a pool and
 * a transaction helper and nothing about receipts, traces or HTTP error mapping.
 */
import pg from 'pg';

let pool: pg.Pool | null = null;

export function initDb(connectionString: string): pg.Pool {
  pool ??= new pg.Pool({ connectionString, max: 4, statement_timeout: 30_000 });
  return pool;
}

export function getDb(): pg.Pool {
  if (!pool) throw new Error('Database not initialised. Call initDb() during bootstrap.');
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

/** The query surface a job needs — small enough that a test's own transaction wrapper satisfies it too. */
export interface JobDb {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

function wrap(client: pg.PoolClient): JobDb {
  return { query: (sql, params) => client.query(sql, params as unknown[]) };
}

/** Run `fn` in a single transaction. Commits on return, rolls back on throw. */
export async function withTransaction<T>(fn: (db: JobDb) => Promise<T>): Promise<T> {
  const client = await getDb().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(wrap(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Connection already broken; the original error is what matters.
    }
    throw error;
  } finally {
    client.release();
  }
}
