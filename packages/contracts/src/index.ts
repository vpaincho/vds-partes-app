/**
 * @vds/contracts — one schema per wire shape, used for runtime validation AND as the type source.
 *
 * 18_TECHNICAL_ADR: "Una fuente schema; evitar divergencia tipos/runtime". A hand-written
 * interface alongside a separately hand-written validator drifts, and the drift surfaces as a 500
 * on a payload the types claimed was impossible.
 */
export * from './envelope.ts';
export * from './commands.ts';
export * from './validate.ts';
