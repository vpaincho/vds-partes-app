/**
 * The port bundle, held once per process.
 *
 * 14_DATA_INTEGRATION_ADAPTERS: a fixture must be replaceable by a real provider without touching
 * product logic, which only holds if exactly one place constructs the bundle. Everything here is
 * `TEST_FIXTURE` today (no real provider exists yet) — `VDS_PROVIDERS=real` is reserved for W7 and
 * intentionally does nothing else yet, so setting it is a decision someone makes deliberately
 * rather than a silent fallback.
 *
 * `files` specifically needs to be a singleton: the fixture keeps in-progress uploads in memory
 * (`packages/adapters/src/fixtures.ts`), so a fresh instance per request would forget every upload
 * between `init` and the next `chunk`.
 */
import { makeFixtureProviders } from '@vds/adapters';
import type { Providers } from '@vds/adapters';

let providers: Providers | null = null;

export function getProviders(): Providers {
  providers ??= makeFixtureProviders();
  return providers;
}

/** Test-only: force a fresh set of fixtures (new in-memory upload state) between test files. */
export function resetProviders(): void {
  providers = null;
}
