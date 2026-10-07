/**
 * @vds/kernel — primitives every domain module shares.
 *
 * No React, no Fastify, no SQL driver, no browser storage (enforced by npm run arch:check),
 * so the same rules run unchanged in the API, the worker and the browser.
 */
export * from './ids.ts';
export * from './time.ts';
export * from './result.ts';
export * from './errors.ts';
export * from './decision.ts';
export * from './state-machine.ts';
