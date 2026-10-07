import { defineConfig } from 'vitest/config';

/**
 * Integration suite: database invariants and the API command pipeline.
 *
 * Requires PostgreSQL: `npm run db:up && npm run db:migrate && npm run db:seed`.
 *
 * Kept separate from the default suite rather than mocked, because the whole point of putting
 * invariants in the schema and authorization in the pipeline is that the real stack refuses the
 * write (04, 13). A fake client would only prove the test agrees with itself.
 *
 * Single-threaded: both suites share one database. The DB suite isolates itself in rolled-back
 * transactions; the API suite cannot, because the pipeline opens its own transaction and deferred
 * constraints must fire at a real commit.
 */
export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts', 'tests/api/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    reporters: ['default'],
  },
});
