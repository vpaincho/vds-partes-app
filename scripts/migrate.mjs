#!/usr/bin/env node
/**
 * Migration runner.
 *
 * Forward-only, reviewable SQL, applied **one migration per transaction** so a failure leaves
 * nothing half-created. The first hand-run of 0001 failed on a missing extension and left
 * orphaned schemas and types behind — which is exactly the state a runner exists to prevent.
 *
 *   node scripts/migrate.mjs             # apply pending migrations
 *   node scripts/migrate.mjs --status     # list applied/pending, verify checksums
 *   node scripts/migrate.mjs --reset      # drop and recreate every schema (DEV ONLY)
 *   node scripts/migrate.mjs --dry-run    # parse and order, apply nothing
 *
 * 19_IMPLEMENTATION_WAVES: "no migraciones destructivas sin revisión". --reset refuses to run
 * against anything that does not look like a local development database.
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(repoRoot, 'db', 'migrations');

const DEFAULT_URL = 'postgres://vds:vds_dev_only@127.0.0.1:5434/vds_partes';
const connectionString = process.env.DATABASE_URL ?? DEFAULT_URL;

/** Schemas this project owns. --reset drops exactly these, never anything else. */
const OWNED_SCHEMAS = [
  'platform',
  'config',
  'planning',
  'execution',
  'habilita',
  'control',
  'evidence',
  'review',
  'commercial',
  'billing',
  'sync',
];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

async function loadMigrations() {
  const entries = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations = [];
  for (const file of entries) {
    const match = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!match) {
      throw new Error(
        `Migration filename "${file}" does not match NNNN_lower_snake.sql. Ordering is by ` +
          'filename, so a non-conforming name would apply in an unpredictable position.',
      );
    }
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    migrations.push({
      version: Number(match[1]),
      name: match[2],
      file,
      sql,
      checksum: sha256(sql),
    });
  }
  const versions = migrations.map((m) => m.version);
  const duplicate = versions.find((v, i) => versions.indexOf(v) !== i);
  if (duplicate !== undefined) {
    throw new Error(`Two migrations share version ${String(duplicate).padStart(4, '0')}.`);
  }
  return migrations;
}

async function ensureLedger(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS platform;
    CREATE TABLE IF NOT EXISTS platform.schema_migrations (
      version     integer PRIMARY KEY,
      name        text NOT NULL,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL
    );
    COMMENT ON TABLE platform.schema_migrations IS
      'Applied migrations with the checksum of the SQL that was applied. Editing an already
       applied migration is caught here rather than diverging silently between environments.';
  `);
}

async function appliedMap(client) {
  const { rows } = await client.query(
    'SELECT version, name, checksum, applied_at FROM platform.schema_migrations ORDER BY version',
  );
  return new Map(rows.map((r) => [r.version, r]));
}

async function reset(client) {
  const { rows } = await client.query('SELECT current_database() AS db, inet_server_addr() AS addr');
  const db = rows[0].db;
  const looksLocal =
    /^(127\.|::1|172\.|192\.168\.|10\.)/.test(String(rows[0].addr ?? '')) ||
    rows[0].addr === null;
  const looksDev = /_dev$|^vds_partes$|_test$/.test(db);

  if (!looksLocal || !looksDev) {
    throw new Error(
      `--reset refused: database "${db}" at ${rows[0].addr ?? 'unknown host'} does not look ` +
        'like a local development database. Destructive migrations do not run without review.',
    );
  }

  console.log(`--reset: dropping ${OWNED_SCHEMAS.length} owned schemas in "${db}"`);
  for (const schema of OWNED_SCHEMAS) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  console.log('  schemas dropped; the ledger goes with platform, so everything re-applies');
}

async function main() {
  const argv = process.argv.slice(2);
  const wantStatus = argv.includes('--status');
  const wantReset = argv.includes('--reset');
  const dryRun = argv.includes('--dry-run');

  const migrations = await loadMigrations();
  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    if (wantReset) await reset(client);
    await ensureLedger(client);
    const applied = await appliedMap(client);

    if (wantStatus) {
      console.log(`${connectionString.replace(/:[^:@/]*@/, ':***@')}\n`);
      let drift = 0;
      for (const m of migrations) {
        const row = applied.get(m.version);
        if (!row) {
          console.log(`  pending  ${m.file}`);
        } else if (row.checksum !== m.checksum) {
          drift += 1;
          console.log(`  CHANGED  ${m.file}  — applied checksum differs from the file on disk`);
        } else {
          console.log(`  applied  ${m.file}  ${row.applied_at.toISOString()}`);
        }
      }
      const pending = migrations.filter((m) => !applied.has(m.version)).length;
      console.log(`\n${applied.size} applied, ${pending} pending, ${drift} changed`);
      if (drift > 0) process.exitCode = 1;
      return;
    }

    // An edited, already-applied migration means environments have diverged. Forward-only
    // means adding a new migration, not editing history.
    for (const m of migrations) {
      const row = applied.get(m.version);
      if (row && row.checksum !== m.checksum) {
        throw new Error(
          `${m.file} was already applied with a different checksum. Migrations are ` +
            'forward-only: add a new migration instead of editing an applied one. ' +
            '(In development, node scripts/migrate.mjs --reset re-applies from scratch.)',
        );
      }
    }

    const pending = migrations.filter((m) => !applied.has(m.version));
    if (pending.length === 0) {
      console.log(`Nothing to apply — ${applied.size} migration(s) already applied.`);
      return;
    }

    for (const m of pending) {
      if (dryRun) {
        console.log(`  would apply ${m.file} (${m.sql.length} bytes)`);
        continue;
      }
      const started = Date.now();
      // One transaction per migration: a failure rolls the whole file back, so the database is
      // never left with half a module's tables.
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        const duration = Date.now() - started;
        await client.query(
          `INSERT INTO platform.schema_migrations (version, name, checksum, duration_ms)
           VALUES ($1, $2, $3, $4)`,
          [m.version, m.name, m.checksum, duration],
        );
        await client.query('COMMIT');
        console.log(`  applied ${m.file}  ${duration}ms`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`\nFAILED ${m.file} — rolled back, nothing from this file was applied.`);
        console.error(`  ${error.message}`);
        if (error.position) {
          const upto = m.sql.slice(0, Number(error.position));
          const line = upto.split('\n').length;
          console.error(`  at line ${line}: ${m.sql.split('\n')[line - 1]?.trim()}`);
        }
        process.exitCode = 1;
        return;
      }
    }

    if (!dryRun) {
      const { rows } = await client.query(`
        SELECT table_schema, count(*)::int AS tables
        FROM information_schema.tables
        WHERE table_schema = ANY($1) AND table_type = 'BASE TABLE'
        GROUP BY table_schema ORDER BY table_schema
      `, [OWNED_SCHEMAS]);
      const total = rows.reduce((n, r) => n + r.tables, 0);
      console.log(`\n${total} tables across ${rows.length} schemas:`);
      for (const r of rows) console.log(`  ${r.table_schema.padEnd(12)} ${r.tables}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
