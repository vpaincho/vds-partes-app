import { defineConfig } from 'vitest/config';

/**
 * Default suite: domain, rules and UI. No external dependency, so it runs anywhere and fast.
 * Database tests live in vitest.db.config.ts because they need a real PostgreSQL — see
 * `npm run test:db`. `npm run verify` runs both.
 */
export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    // `tests/api/**` is excluded for the same reason as `tests/db/**`: it needs a real PostgreSQL
    // and a real command pipeline, so it belongs to the integration suite. It was also being run
    // here in parallel against the same database, which made the two suites contend and time out.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/db/**', 'tests/api/**'],
    environment: 'node',
    reporters: ['default'],
  },
});
