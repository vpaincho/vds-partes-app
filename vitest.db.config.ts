import { defineConfig } from 'vitest/config';

/**
 * Database integration suite. Requires PostgreSQL: `npm run db:up && npm run db:migrate`.
 *
 * These are kept separate rather than mocked because the whole point of putting invariants in the
 * schema is that the database refuses the write (04). A fake client would only prove the test
 * agrees with itself.
 *
 * Single-threaded: the suite shares one database, and each test already isolates itself in a
 * rolled-back transaction. Running files in parallel would add contention for no benefit.
 */
export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20_000,
    reporters: ['default'],
  },
});
