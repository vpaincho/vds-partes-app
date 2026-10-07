/**
 * Harness for database integration tests.
 *
 * These run against a real PostgreSQL, because the point of putting invariants in the schema is
 * that the database refuses the write. A mocked client would only test that the test agrees with
 * itself, and 04 is explicit that these belong at the DB level.
 *
 * Each test runs inside a transaction that is rolled back, so the suite is order-independent and
 * leaves no residue. Deferred constraint triggers need care: they fire at COMMIT, which never
 * happens here, so `withImmediateConstraints` forces them to be checked at a chosen point.
 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const DEFAULT_URL = 'postgres://vds:vds_dev_only@127.0.0.1:5434/vds_partes';

export const connectionString = process.env.DATABASE_URL ?? DEFAULT_URL;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString, max: 4 });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}

export interface Tx {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
  /**
   * Force every deferred constraint to be checked now. Needed for the C-009 and TPR-009/024
   * triggers, which are DEFERRABLE INITIALLY DEFERRED and would otherwise only fire at a commit
   * this harness never performs.
   */
  checkDeferred(): Promise<void>;
  /** Run a fragment that is expected to fail, without poisoning the outer transaction. */
  attempt(fn: (tx: Tx) => Promise<unknown>): Promise<{ ok: true } | { ok: false; error: Error }>;
}

/** Run `fn` in a transaction and always roll back. */
export async function inRollbackTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  await client.query('BEGIN');

  const tx: Tx = {
    query: (sql, params) => client.query(sql, params as unknown[]),
    checkDeferred: async () => {
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    },
    attempt: async (inner) => {
      const savepoint = `sp_${randomUUID().replaceAll('-', '')}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        await inner(tx);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return { ok: true };
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        return { ok: false, error: error as Error };
      }
    },
  };

  try {
    return await fn(tx);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/**
 * Assert that a statement is refused, and that the refusal explains itself.
 *
 * The message check is not pedantry: sheet 56 requires every prohibited transition to state the
 * correct path instead, and a constraint that fires with an opaque message fails that contract as
 * surely as one that does not fire at all.
 */
export async function expectRefused(
  tx: Tx,
  fn: (tx: Tx) => Promise<unknown>,
  expected: { matches: RegExp; hint?: RegExp },
): Promise<Error> {
  const result = await tx.attempt(fn);
  if (result.ok) {
    throw new Error(
      `Expected the database to refuse this write, but it succeeded. ` +
        `An invariant that is documented but not enforced is the failure mode this suite exists ` +
        `to catch.`,
    );
  }
  const error = result.error as Error & { hint?: string; detail?: string };
  const haystack = [error.message, error.hint, error.detail].filter(Boolean).join(' | ');
  if (!expected.matches.test(haystack)) {
    throw new Error(
      `Refused, but for the wrong reason.\n  expected to match: ${expected.matches}\n  got: ${haystack}`,
    );
  }
  if (expected.hint && !expected.hint.test(haystack)) {
    throw new Error(
      `Refused with the right error but no actionable guidance.\n` +
        `  expected hint: ${expected.hint}\n  got: ${haystack}`,
    );
  }
  return error;
}

/* ------------------------------------------------------------------ fixture builders */

export const uuid = (): string => randomUUID();

/** A minimal identity, needed as an actor by almost everything. */
export async function makeIdentity(tx: Tx, label = 'test'): Promise<string> {
  const id = uuid();
  await tx.query(
    `INSERT INTO platform.identities (id, subject_ref, provider, display_name, provenance)
     VALUES ($1, $2, 'fixture-dev', $3, 'FIXTURE_TEST')`,
    [id, `${label}-${id}`, `Test ${label}`],
  );
  return id;
}

export async function makeClient(tx: Tx): Promise<string> {
  const id = uuid();
  await tx.query(
    `INSERT INTO config.clients (id, code, name, provenance)
     VALUES ($1, $2, 'Cliente de prueba', 'FIXTURE_TEST')`,
    [id, `CL-${id.slice(0, 8)}`],
  );
  return id;
}

export async function makeService(tx: Tx): Promise<string> {
  const id = uuid();
  await tx.query(
    `INSERT INTO config.services (id, code, name, provenance)
     VALUES ($1, $2, 'Servicio de prueba', 'FIXTURE_TEST')`,
    [id, `SV-${id.slice(0, 8)}`],
  );
  return id;
}

export async function makePartType(tx: Tx, code: 'TP-01' | 'TP-02' | 'TP-03' = 'TP-03'): Promise<string> {
  const existing = await tx.query<{ id: string }>(
    'SELECT id FROM config.part_types WHERE code = $1',
    [code],
  );
  if (existing.rows.length > 0) return existing.rows[0]!.id;
  const id = uuid();
  await tx.query(
    `INSERT INTO config.part_types (id, code, name, description)
     VALUES ($1, $2, $3, 'fixture')`,
    [id, code, code],
  );
  return id;
}

export async function makeUnitOfMeasure(tx: Tx, code = 'm3'): Promise<string> {
  const existing = await tx.query<{ id: string }>(
    'SELECT id FROM config.units_of_measure WHERE code = $1',
    [code],
  );
  if (existing.rows.length > 0) return existing.rows[0]!.id;
  const id = uuid();
  await tx.query('INSERT INTO config.units_of_measure (id, code, name) VALUES ($1, $2, $2)', [id, code]);
  return id;
}

export interface PartFixture {
  partId: string;
  partTypeId: string;
  serviceId: string;
}

/** A Parte in PREPARADO with no UE — legal, and the baseline for the C-009 tests. */
export async function makePart(
  tx: Tx,
  options: { state?: string; operationalDate?: string } = {},
): Promise<PartFixture> {
  const partTypeId = await makePartType(tx);
  const serviceId = await makeService(tx);
  const partId = uuid();
  await tx.query(
    // Explicit casts: the same parameter is used as an enum and inside a CASE, and without them
    // PostgreSQL cannot deduce one consistent type for it.
    `INSERT INTO execution.parts (id, part_type_id, state, operational_date, prepared_at, started_at)
     VALUES ($1::uuid, $2::uuid, $3::execution.part_state, $4::date, now(),
             CASE WHEN $3::text = 'PREPARADO' THEN NULL ELSE now() END)`,
    [partId, partTypeId, options.state ?? 'PREPARADO', options.operationalDate ?? '2026-10-05'],
  );
  return { partId, partTypeId, serviceId };
}

export async function makeExecutionUnit(
  tx: Tx,
  part: PartFixture,
  options: { state?: string; result?: string | null; resultReason?: string } = {},
): Promise<string> {
  const id = uuid();
  const state = options.state ?? 'PENDIENTE';
  await tx.query(
    `INSERT INTO execution.execution_units
       (id, part_id, state, service_id, description, started_at, ended_at, result, result_reason)
     VALUES ($1::uuid, $2::uuid, $3::execution.unit_state, $4::uuid, 'UE de prueba',
             CASE WHEN $3::text IN ('PENDIENTE', 'ANULADA') THEN NULL
                  ELSE now() - interval '2 hours' END,
             CASE WHEN $3::text = 'CERRADA' THEN now() ELSE NULL END,
             $5::text, $6::text)`,
    [
      id,
      part.partId,
      state,
      part.serviceId,
      options.result ?? (state === 'CERRADA' ? 'COMPLETADA' : null),
      // A NO_REALIZADA unit must state its cause at insert: the constraint refuses it otherwise,
      // which is the point (RUL-019 — never delete what was planned and not done).
      options.resultReason ?? (state === 'NO_REALIZADA' ? 'Clima: ráfagas de 72 km/h' : null),
    ],
  );
  return id;
}

export async function makeExecutionUnitVersion(tx: Tx, executionUnitId: string): Promise<string> {
  const id = uuid();
  await tx.query(
    `INSERT INTO execution.execution_unit_versions
       (id, execution_unit_id, version_no, reason, snapshot, content_hash, effective_at)
     VALUES ($1, $2, 1, 'CLOSE', '{}'::jsonb, 'hash', now())`,
    [id, executionUnitId],
  );
  return id;
}
