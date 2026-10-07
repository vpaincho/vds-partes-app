/**
 * @vds/rules — the deterministic rule engine.
 *
 * Rules are data (catalog), their ordering is data (precedence), and the pipeline is pure
 * (engine). Nothing here writes: the command service owns the transaction that persists the
 * trace and the effects, which is what lets the same evaluation run on the server, in the
 * worker and on the device.
 */
export * from './catalog.ts';
export * from './precedence.ts';
export * from './engine.ts';
