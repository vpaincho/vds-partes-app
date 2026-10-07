/**
 * @vds/adapters — typed ports and their fixture implementations.
 *
 * The domain depends on the ports; only the API and the worker wire in an implementation
 * (enforced by npm run arch:check, which forbids the browser and the domain from importing this).
 *
 * S0 §22 is the requirement these shapes serve: replacing a fixture with a real adapter must not
 * change product logic. That holds only because every port is honest about failure — UNAVAILABLE,
 * STALE, PENDING_MAPPING and UNKNOWN are first-class answers, and no port returns a bare boolean.
 */
export * from './ports.ts';
export * from './fixtures.ts';
