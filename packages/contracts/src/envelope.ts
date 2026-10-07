/**
 * Wire contracts: one TypeBox schema per shape, used for runtime validation at the API boundary
 * AND as the source of the TypeScript type.
 *
 * 18_TECHNICAL_ADR names the failure to avoid: "evitar divergencia tipos/runtime". A hand-written
 * interface plus a separately hand-written validator drift, and the drift shows up as a 500 on a
 * payload the types said was impossible.
 *
 * The command envelope is the important one. Every field exists because the baseline requires it:
 *
 *   command_id       stable across retries; dedup key with scope (RGT-06)
 *   expected_version optimistic concurrency; never resolved by last-write-wins (RGT-08)
 *   occurred_at      when the fact happened, which is NOT when the server received it
 *   recorded_at      when the device captured it, so a late report stays honest (PD-0394)
 *   device_id        a shared tablet isolates scope and queue
 *   bundle_ref       which cached context the device acted on, for reconciliation (GS-024)
 *   confirmations    human input the system could not derive (CF-01..13)
 *   override         an authorised exception a rule declared (RUL-041)
 *
 * Notably absent: `actor_id`. The actor is derived from the verified session on the server and is
 * never read from the payload — 13_AUTH_PERMISSIONS requires a forged actor to be rejected.
 */
import { Type, type Static } from '@sinclair/typebox';

/* -------------------------------------------------------------------- primitives */

export const UuidSchema = Type.String({
  format: 'uuid',
  description: 'UUIDv7 for domain objects, generatable offline so a device writes final identities.',
});

export const InstantSchema = Type.String({
  // Z only: one representation in storage, and no ambiguity about which zone a wall clock meant.
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?Z$',
  description: 'ISO 8601 instant in UTC, ending in Z.',
});

export const OperationalDateSchema = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description:
    'Operational date, decided by the configured shift boundary of the context — not the UTC or ' +
    'local calendar date of a timestamp (RGT-10).',
});

export const QuantitySchema = Type.Object(
  {
    value: Type.String({
      // A decimal string, not a float: a quantity that feeds a commercial derivation must not be
      // subject to binary rounding.
      pattern: '^-?\\d+(\\.\\d{1,6})?$',
      description: 'Decimal string with up to 6 fractional digits.',
    }),
    unitOfMeasureId: UuidSchema,
  },
  { description: 'C-014: a magnitude always travels with its unit. A bare number is not a quantity.' },
);

export type Quantity = Static<typeof QuantitySchema>;

/* ------------------------------------------------------------- command envelope */

export const OverrideSchema = Type.Object(
  {
    gateId: Type.String({ minLength: 1 }),
    ruleId: Type.String({ pattern: '^(RUL|C)-\\d{3}$' }),
    reason: Type.String({
      minLength: 10,
      description: 'An override with no stated reason is indistinguishable from a bypass.',
    }),
    evidenceId: Type.Optional(UuidSchema),
  },
  {
    description:
      'RUL-041: satisfies an exception the rule itself declared. The authorising actor comes from ' +
      'the session, never from here, and a hard block has no gate at all (C-018).',
  },
);

export const CommandEnvelopeSchema = Type.Object(
  {
    commandId: UuidSchema,
    expectedVersion: Type.Optional(Type.Integer({ minimum: 0 })),
    occurredAt: InstantSchema,
    recordedAt: Type.Optional(InstantSchema),
    deviceId: Type.Optional(UuidSchema),
    bundleRef: Type.Optional(Type.String()),
    rulesetRef: Type.Optional(Type.String()),
    correlationId: Type.Optional(UuidSchema),
    confirmations: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    override: Type.Optional(OverrideSchema),
    payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  {
    additionalProperties: false,
    description:
      'The common envelope for every command. additionalProperties is false on purpose: a client ' +
      'that sends actor_id expecting it to be honoured gets a validation error rather than silent ' +
      'disregard.',
  },
);

export type CommandEnvelope = Static<typeof CommandEnvelopeSchema>;

/* ----------------------------------------------------------------- decision shape */

export const PrecedenceSchema = Type.Union([
  Type.Literal('P0'),
  Type.Literal('P1'),
  Type.Literal('P2'),
  Type.Literal('P3'),
  Type.Literal('P4'),
  Type.Literal('P5'),
  Type.Literal('P6'),
  Type.Literal('P7'),
  Type.Literal('P8'),
]);

export const SubjectRefSchema = Type.Object({
  kind: Type.String(),
  id: Type.Union([UuidSchema, Type.Null()]),
  code: Type.Optional(Type.String()),
});

export const BlockerSchema = Type.Object({
  ruleId: Type.String(),
  precedence: PrecedenceSchema,
  reason: Type.String(),
  instead: Type.Optional(Type.String({ description: 'Sheet 56: the correct path. The actionable part.' })),
  sourceRef: Type.Optional(Type.String()),
  subject: Type.Optional(SubjectRefSchema),
  overrideable: Type.Boolean(),
});

export const WarningSchema = Type.Object({
  ruleId: Type.String(),
  precedence: PrecedenceSchema,
  reason: Type.String(),
  sourceRef: Type.Optional(Type.String()),
  subject: Type.Optional(SubjectRefSchema),
  requiresOverrideGate: Type.Optional(Type.String()),
});

export const ConfirmationRequiredSchema = Type.Object({
  field: Type.String(),
  reason: Type.String(),
  candidate: Type.Optional(Type.Unknown()),
  ruleId: Type.Optional(Type.String()),
});

export const MissingItemSchema = Type.Object({
  what: Type.String(),
  reason: Type.String(),
  subject: Type.Optional(SubjectRefSchema),
  ruleId: Type.Optional(Type.String()),
});

export const DeclaredEffectSchema = Type.Object({
  kind: Type.String(),
  subject: Type.Optional(SubjectRefSchema),
  description: Type.String(),
  ruleId: Type.Optional(Type.String()),
});

export const AppliedRuleSchema = Type.Object({
  ruleId: Type.String(),
  precedence: PrecedenceSchema,
  outcome: Type.Union([
    Type.Literal('WON'),
    Type.Literal('DISCARDED_BY_PRECEDENCE'),
    Type.Literal('DISCARDED_BY_SPECIFICITY'),
    Type.Literal('NOT_APPLICABLE'),
  ]),
  note: Type.Optional(Type.String()),
  rulesetVersion: Type.Optional(Type.String()),
});

export const DecisionEnvelopeSchema = Type.Object(
  {
    decisionId: UuidSchema,
    decision: Type.Union([
      Type.Literal('ALLOW'),
      Type.Literal('BLOCK'),
      Type.Literal('WARN'),
      Type.Literal('REQUIRE_CONFIRMATION'),
      Type.Literal('NO_OP'),
    ]),
    subject: SubjectRefSchema,
    trigger: Type.String(),
    currentState: Type.Optional(Type.String()),
    targetState: Type.Optional(Type.String()),
    // Four separate lists, never one count: the prototype's "9 pendientes" mixed them.
    blocks: Type.Array(BlockerSchema),
    warnings: Type.Array(WarningSchema),
    confirmationsRequired: Type.Array(ConfirmationRequiredSchema),
    missing: Type.Array(MissingItemSchema),
    effects: Type.Array(DeclaredEffectSchema),
    rulesApplied: Type.Array(AppliedRuleSchema),
    rulesetVersion: Type.String(),
    evaluatedAt: InstantSchema,
    contextHash: Type.String(),
    expectedVersion: Type.Optional(Type.Integer()),
    correlationId: Type.Optional(UuidSchema),
    preview: Type.Boolean({ description: 'RGT-17: a preview authorises nothing.' }),
    override: Type.Optional(
      Type.Object({
        gateId: Type.String(),
        ruleId: Type.String(),
        authorisedBy: UuidSchema,
        reason: Type.String(),
        evidenceId: Type.Optional(UuidSchema),
        at: InstantSchema,
      }),
    ),
  },
  { additionalProperties: false },
);

/* ------------------------------------------------------------------- responses */

export const ReceiptSchema = Type.Object({
  commandId: UuidSchema,
  receiptId: UuidSchema,
  decisionId: Type.Optional(UuidSchema),
  outcome: Type.Union([
    Type.Literal('APPLIED'),
    // REPLAYED is what a retry after a lost ACK gets: the original result, not a new effect.
    Type.Literal('REPLAYED'),
    Type.Literal('NO_OP'),
  ]),
  receiptAt: InstantSchema,
});

export const MetaSchema = Type.Object({
  requestId: UuidSchema,
  serverTime: InstantSchema,
  cursor: Type.Optional(Type.String()),
  rulesetVersion: Type.Optional(Type.String()),
});

export const CommandResponseSchema = Type.Object(
  {
    receipt: ReceiptSchema,
    decision: DecisionEnvelopeSchema,
    data: Type.Object({
      subject: SubjectRefSchema,
      version: Type.Optional(Type.Integer()),
      effects: Type.Array(Type.Record(Type.String(), Type.Unknown())),
    }),
    meta: MetaSchema,
  },
  { additionalProperties: false },
);

export const ErrorCodeSchema = Type.Union([
  Type.Literal('VALIDATION_FAILED'),
  Type.Literal('UNAUTHENTICATED'),
  Type.Literal('FORBIDDEN_SCOPE'),
  Type.Literal('NOT_FOUND'),
  Type.Literal('VERSION_MISMATCH'),
  Type.Literal('COMMAND_CONFLICT'),
  Type.Literal('GATE_BLOCKED'),
  Type.Literal('CONFIRMATION_REQUIRED'),
  Type.Literal('PENDING_CONFIGURATION'),
  Type.Literal('PROVIDER_UNAVAILABLE'),
  Type.Literal('PROVIDER_STALE'),
  Type.Literal('PAYLOAD_TOO_LARGE'),
  Type.Literal('RATE_LIMITED'),
  Type.Literal('INVARIANT_VIOLATED'),
]);

export const ErrorResponseSchema = Type.Object(
  {
    error: Type.Object({
      code: ErrorCodeSchema,
      message: Type.String(),
      details: Type.Array(
        Type.Object({
          path: Type.Optional(Type.String()),
          message: Type.String(),
          ruleId: Type.Optional(Type.String()),
          sourceRef: Type.Optional(Type.String()),
          instead: Type.Optional(Type.String()),
        }),
      ),
      ruleIds: Type.Array(Type.String()),
      decisionId: Type.Optional(UuidSchema),
      retryable: Type.Boolean(),
      // Present on GATE_BLOCKED so a client can render the three counts separately without a
      // second round trip.
      blocks: Type.Optional(Type.Array(BlockerSchema)),
      warnings: Type.Optional(Type.Array(WarningSchema)),
      confirmationsRequired: Type.Optional(Type.Array(ConfirmationRequiredSchema)),
    }),
    meta: MetaSchema,
  },
  { additionalProperties: false },
);

export type CommandResponse = Static<typeof CommandResponseSchema>;
export type ErrorResponse = Static<typeof ErrorResponseSchema>;

/** Wrap a read model in the standard envelope. */
export const readResponse = <T extends ReturnType<typeof Type.Any>>(data: T) =>
  Type.Object({ data, meta: MetaSchema }, { additionalProperties: false });
