/**
 * Typed domain errors.
 *
 * The API's job is to **explain** a refusal, not merely to refuse. Sheet 63 makes this a
 * functional requirement: a decision carries blockers with rule ids and causes, and sheet 56
 * requires every forbidden transition to state the correct path instead. A bare 400 with
 * "invalid" loses the only part an operator can act on.
 *
 * `code` is the stable contract (clients branch on it); `message` is human-readable Spanish
 * at the boundary; `ruleIds` and `sourceRefs` make a refusal traceable to a sheet row.
 */

export type ErrorCode =
  /** Schema/shape failure at the boundary. */
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  /** Authenticated, but the capability or the scope does not cover this subject. */
  | 'FORBIDDEN_SCOPE'
  | 'NOT_FOUND'
  /** `expected_version` did not match. Never resolved by last-write-wins. */
  | 'VERSION_MISMATCH'
  /** Same command_id, different payload (RGT-07). Zero additional effect. */
  | 'COMMAND_CONFLICT'
  /** A gate refused: hard block, forbidden transition, terminal state. */
  | 'GATE_BLOCKED'
  /** Allowed, but a human confirmation is required first. */
  | 'CONFIRMATION_REQUIRED'
  /** Contractual/commercial configuration is missing. Never filled with a default. */
  | 'PENDING_CONFIGURATION'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_STALE'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  /** A bug: an invariant the code believed could not break. */
  | 'INVARIANT_VIOLATED';

export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN_SCOPE: 403,
  NOT_FOUND: 404,
  VERSION_MISMATCH: 409,
  COMMAND_CONFLICT: 409,
  GATE_BLOCKED: 422,
  CONFIRMATION_REQUIRED: 422,
  PENDING_CONFIGURATION: 422,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_STALE: 503,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INVARIANT_VIOLATED: 500,
};

export interface ErrorDetail {
  /** Dotted path of the offending field, when there is one. */
  readonly path?: string;
  readonly message: string;
  /** Canonical rule or invariant: RUL-022, C-009, TPR-007. */
  readonly ruleId?: string;
  /** Where the rule lives: "56_Transiciones_Prohibidas:11". */
  readonly sourceRef?: string;
  /** What to do instead. Required for a prohibited transition. */
  readonly instead?: string;
}

export interface DomainErrorShape {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details: readonly ErrorDetail[];
  readonly ruleIds: readonly string[];
  readonly decisionId?: string;
  /** True when a retry with the same input could succeed (provider unavailable, rate limit). */
  readonly retryable: boolean;
}

export class DomainError extends Error implements DomainErrorShape {
  readonly code: ErrorCode;
  readonly details: readonly ErrorDetail[];
  readonly ruleIds: readonly string[];
  readonly decisionId?: string;
  readonly retryable: boolean;

  constructor(input: {
    code: ErrorCode;
    message: string;
    details?: readonly ErrorDetail[];
    decisionId?: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = 'DomainError';
    this.code = input.code;
    this.details = input.details ?? [];
    this.ruleIds = [...new Set(this.details.flatMap((d) => (d.ruleId ? [d.ruleId] : [])))];
    if (input.decisionId !== undefined) this.decisionId = input.decisionId;
    this.retryable =
      input.retryable ?? (input.code === 'PROVIDER_UNAVAILABLE' || input.code === 'RATE_LIMITED');
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }

  toJSON(): { error: DomainErrorShape } {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        ruleIds: this.ruleIds,
        ...(this.decisionId === undefined ? {} : { decisionId: this.decisionId }),
        retryable: this.retryable,
      },
    };
  }
}

/* ------------------------------------------------------------------- constructors */

export const validationFailed = (details: readonly ErrorDetail[]): DomainError =>
  new DomainError({
    code: 'VALIDATION_FAILED',
    message: `La solicitud no es válida: ${details.length} problema(s).`,
    details,
  });

export const forbiddenScope = (what: string, detail?: ErrorDetail): DomainError =>
  new DomainError({
    code: 'FORBIDDEN_SCOPE',
    message: `No autorizado para ${what}.`,
    details: detail ? [detail] : [],
  });

/**
 * Optimistic concurrency failure. Carries base/expected/actual so the client can present a
 * three-way comparison — the baseline forbids last-write-wins over operational truth, so the
 * resolution is a human decision with a cause, not an automatic overwrite (RGT-08).
 */
export const versionMismatch = (input: {
  subject: string;
  expected: number;
  actual: number;
}): DomainError =>
  new DomainError({
    code: 'VERSION_MISMATCH',
    message:
      `${input.subject} cambió desde que lo leíste (esperado v${input.expected}, ` +
      `actual v${input.actual}). Resolvé comparando base, local y servidor: no se aplica ` +
      'last-write-wins sobre la verdad operacional.',
    details: [
      {
        path: 'expected_version',
        message: `expected ${input.expected}, actual ${input.actual}`,
        ruleId: 'C-002',
      },
    ],
  });

/**
 * Same command id, different payload. The first result stands and nothing further happens.
 * RGT-07: "Conflicto tipado, cero efecto adicional".
 */
export const commandConflict = (input: {
  commandId: string;
  storedPayloadHash: string;
  incomingPayloadHash: string;
}): DomainError =>
  new DomainError({
    code: 'COMMAND_CONFLICT',
    message:
      `El comando ${input.commandId} ya fue recibido con otro contenido. ` +
      'No se aplicó ningún efecto adicional.',
    details: [
      {
        path: 'command_id',
        message: `stored payload ${input.storedPayloadHash}, incoming ${input.incomingPayloadHash}`,
        ruleId: 'RUL-074',
      },
    ],
  });

export const gateBlocked = (input: {
  message: string;
  details: readonly ErrorDetail[];
  decisionId?: string;
}): DomainError =>
  new DomainError({
    code: 'GATE_BLOCKED',
    message: input.message,
    details: input.details,
    ...(input.decisionId === undefined ? {} : { decisionId: input.decisionId }),
  });

/**
 * Missing contractual configuration. Explicitly NOT filled with a placeholder: AP-06 forbids
 * wildcard codes, and RGT-12 requires that reality stay closable while commercial derivation
 * is blocked.
 */
export const pendingConfiguration = (input: {
  what: string;
  details?: readonly ErrorDetail[];
}): DomainError =>
  new DomainError({
    code: 'PENDING_CONFIGURATION',
    message:
      `Falta configuración contractual: ${input.what}. ` +
      'La realidad operativa se registra igual; la derivación comercial queda bloqueada ' +
      'hasta que exista la regla. No se completan valores por defecto.',
    details: input.details ?? [{ message: input.what, ruleId: 'RUL-038' }],
  });

export const invariantViolated = (input: {
  invariantId: string;
  message: string;
  cause?: unknown;
}): DomainError =>
  new DomainError({
    code: 'INVARIANT_VIOLATED',
    message: `Invariante ${input.invariantId} violada: ${input.message}`,
    details: [{ message: input.message, ruleId: input.invariantId }],
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });

export const isDomainError = (error: unknown): error is DomainError =>
  error instanceof DomainError;
