/**
 * Database access and the transaction boundary.
 *
 * 03_TARGET_ARCHITECTURE fixes what one command transaction must contain: receipt + effects +
 * trace + outbox, committed together, and "No devolver éxito antes del commit". So `withTransaction`
 * is the only way the pipeline touches the database, and nothing outside it may hold a client.
 *
 * Deferred constraint triggers (C-009, TPR-009, TPR-024) are checked at COMMIT. That is deliberate:
 * it lets a Start Work transaction write the state change and the first UE in either order. It also
 * means a constraint failure can surface at commit time rather than at the offending statement, so
 * the error mapper below has to recognise them.
 */
import pg from 'pg';
import { DomainError, invariantViolated, type ErrorDetail } from '@vds/kernel';

let pool: pg.Pool | null = null;

export interface DbConfig {
  readonly connectionString: string;
  readonly maxConnections?: number;
}

export function initDb(config: DbConfig): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 10,
    // Keep statements from pinning a connection forever; a hung query must not take the API down.
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 20_000,
  });
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

/** A transaction-scoped query interface. Commands receive this and nothing wider. */
export interface Db {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
  /** First row or null, for the common lookup case. */
  one<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<R | null>;
}

function wrap(client: pg.PoolClient): Db {
  return {
    query: (sql, params) => client.query(sql, params as unknown[]),
    one: async (sql, params) => {
      const result = await client.query(sql, params as unknown[]);
      return (result.rows[0] as never) ?? null;
    },
  };
}

/**
 * Run `fn` in a single transaction. Commits on return, rolls back on throw.
 *
 * PostgreSQL errors are translated into DomainError on the way out, so a constraint the schema
 * enforces produces the same typed, explained response as a rule the engine evaluated. Without
 * this, a trigger that correctly refuses a write would surface as an opaque 500.
 */
export async function withTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
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
      // A rollback failure means the connection is already broken; the original error is what
      // matters and is rethrown below.
    }
    throw translatePgError(error);
  } finally {
    client.release();
  }
}

/** Read-only access, outside any command transaction. */
export async function withConnection<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await getDb().connect();
  try {
    return await fn(wrap(client));
  } finally {
    client.release();
  }
}

interface PgError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
  hint?: string;
  table?: string;
  schema?: string;
}

const isPgError = (error: unknown): error is PgError =>
  error instanceof Error && typeof (error as PgError).code === 'string';

/**
 * Map a PostgreSQL error to a DomainError.
 *
 * `restrict_violation` (23001) is what every guard trigger in 0009_integrity.sql raises, and those
 * triggers carry a HINT naming the correct path. Surfacing that hint is the whole point: sheet 56
 * requires a refused transition to say what to do instead.
 */
export function translatePgError(error: unknown): unknown {
  if (error instanceof DomainError) return error;
  if (!isPgError(error)) return error;

  const details: ErrorDetail[] = [
    {
      message: error.message,
      ...(error.constraint === undefined ? {} : { path: error.constraint }),
      ...(error.hint === undefined ? {} : { instead: error.hint }),
    },
  ];

  switch (error.code) {
    // Raised by every append-only / immutability / cross-row guard trigger.
    case '23001':
      return new DomainError({
        code: 'GATE_BLOCKED',
        message: error.message,
        details,
        cause: error,
      });

    case '23505': // unique_violation
      if (error.constraint === 'command_receipts_scope_command_unique') {
        // The pipeline normally catches a replay before inserting. Reaching here means two
        // concurrent requests raced on the same command id; the loser must not create a second
        // effect, so it is reported as a conflict rather than a server fault.
        return new DomainError({
          code: 'COMMAND_CONFLICT',
          message:
            'Otro intento del mismo comando se registró primero. No se aplicó ningún efecto ' +
            'adicional; reintentá para obtener el receipt original.',
          details,
          retryable: true,
          cause: error,
        });
      }
      return new DomainError({
        code: 'VALIDATION_FAILED',
        message: `Violación de unicidad: ${error.constraint ?? 'restricción'}`,
        details,
        cause: error,
      });

    case '23503': // foreign_key_violation
      return new DomainError({
        code: 'VALIDATION_FAILED',
        message: `Referencia inexistente: ${error.constraint ?? 'clave foránea'}`,
        details,
        cause: error,
      });

    case '23514': // check_violation
      return new DomainError({
        code: 'GATE_BLOCKED',
        message: `Restricción de integridad: ${error.constraint ?? 'check'}`,
        details,
        cause: error,
      });

    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return new DomainError({
        code: 'VERSION_MISMATCH',
        message: 'Conflicto de concurrencia: reintentá leyendo el estado actual.',
        details,
        retryable: true,
        cause: error,
      });

    case '57014': // query_canceled (statement_timeout)
      return new DomainError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'La consulta excedió el tiempo límite.',
        details,
        retryable: true,
        cause: error,
      });

    default:
      return invariantViolated({
        invariantId: `PG-${error.code ?? 'UNKNOWN'}`,
        message: error.message,
        cause: error,
      });
  }
}
