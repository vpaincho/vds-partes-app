/**
 * Runtime validation at the boundary.
 *
 * Ajv compiles each schema once. Errors are mapped into the DomainError detail shape, so a client
 * receives "which field, and why" rather than an Ajv internal string — the API's job is to explain
 * a refusal (sheet 63), and that applies to a malformed payload as much as to a gate.
 *
 * The `uuid` format is registered here rather than pulling in ajv-formats: it is the only format
 * the schemas use (instants and dates are explicit patterns, because an ISO date validator would
 * accept a local timestamp we must reject), and the dependency's CJS/ESM interop is not worth
 * carrying for one regex.
 */
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import type { TSchema } from '@sinclair/typebox';
import { validationFailed, type ErrorDetail } from '@vds/kernel';

const ajv = new Ajv({
  allErrors: true, // report every problem at once; fixing one field at a time is the prototype's flaw
  strict: false, // TypeBox emits annotations Ajv's strict mode rejects
  coerceTypes: false, // a string "5" is not the integer 5 at an API boundary
  removeAdditional: false, // additionalProperties:false must ERROR, never silently strip
});

// Accepts any RFC 4122 version: v7 for domain objects, v4 for correlation ids.
ajv.addFormat(
  'uuid',
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
);

const compiled = new WeakMap<TSchema, ValidateFunction>();

function compile(schema: TSchema): ValidateFunction {
  const cached = compiled.get(schema);
  if (cached) return cached;
  const validate = ajv.compile(schema);
  compiled.set(schema, validate);
  return validate;
}

function toDetail(error: ErrorObject): ErrorDetail {
  const path = error.instancePath.replace(/^\//, '').replaceAll('/', '.');

  if (error.keyword === 'additionalProperties') {
    const extra = (error.params as { additionalProperty?: string }).additionalProperty;
    const field = path === '' ? extra : `${path}.${extra}`;
    return {
      ...(field === undefined ? {} : { path: field }),
      message:
        `"${extra}" is not accepted here. If this is actorId: the actor is derived from the ` +
        'verified session and is never read from the payload (13_AUTH_PERMISSIONS).',
    };
  }

  return {
    ...(path === '' ? {} : { path }),
    message: error.message ?? 'is invalid',
  };
}

/** Validate and return the typed value, or throw a VALIDATION_FAILED DomainError. */
export function parse<T>(schema: TSchema, value: unknown): T {
  const validate = compile(schema);
  if (validate(value)) return value as T;
  throw validationFailed((validate.errors ?? []).map(toDetail));
}

/** Non-throwing variant, for callers that need to branch on validity. */
export function check(
  schema: TSchema,
  value: unknown,
): { valid: true } | { valid: false; details: ErrorDetail[] } {
  const validate = compile(schema);
  if (validate(value)) return { valid: true };
  return { valid: false, details: (validate.errors ?? []).map(toDetail) };
}
