/**
 * The command pipeline. Every command goes through exactly this path.
 *
 * 03_TARGET_ARCHITECTURE fixes the order:
 *   authenticate → authorise → deduplicate → load context/versions → evaluate invariants/gates/state
 *   → apply transition → write state + event + trace + outbox in ONE transaction → respond with
 *   what was persisted.
 *
 * Four behaviours here are load-bearing and should not be "simplified":
 *
 *  1. **Dedup before anything else that writes.** A retry after a lost ACK returns the original
 *     receipt (RGT-06). The same command id with a different payload is a typed conflict with zero
 *     additional effect (RGT-07). Both are decided from the receipt row, inside the transaction.
 *
 *  2. **The handler never evaluates its own gates.** It supplies stage evaluators; the engine runs
 *     S0–S11 and composes one envelope. That is what keeps a commercial rule from unblocking a
 *     Habilita gate (AP-01) regardless of which handler is running.
 *
 *  3. **A BLOCK still writes a trace and a receipt.** 06_RULES_AND_INVARIANTS: "BLOCK también
 *     tiene trace/receipt sin efectos operativos." Otherwise a refusal is unexplainable later, and
 *     a retried blocked command would re-run the whole evaluation.
 *
 *  4. **expected_version is checked against the row, not trusted.** No last-write-wins, ever
 *     (RGT-08).
 */
import {
  DomainError,
  authorises,
  commandConflict,
  gateBlocked,
  instantNow,
  newCorrelationId,
  uuidv4,
  uuidv7,
  versionMismatch,
  type CorrelationId,
  type DecisionEnvelope,
  type Instant,
  type SubjectRef,
  type Uuid,
} from '@vds/kernel';
import { assertAuthorises, evaluate, type NormalizedContext, type StageEvaluator } from '@vds/rules';
import { command as commandDefinition, parse, type CommandEnvelope } from '@vds/contracts';
import { createHash } from 'node:crypto';
import type { Db } from './db.ts';
import { withTransaction } from './db.ts';
import { assertAuthorised, type AuthenticatedActor, type ObjectScope } from './authz.ts';

/** What a handler is given. */
export interface CommandContext<P = Record<string, unknown>> {
  readonly db: Db;
  readonly actor: AuthenticatedActor;
  readonly payload: P;
  readonly envelope: CommandEnvelope;
  /**
   * The subject id from the route path, for commands acting on an existing aggregate.
   *
   * Deliberately NOT part of the payload schema: a payload describes what the caller is asking for,
   * and every payload sets additionalProperties:false. Routing is not a domain concern, so merging
   * a path parameter into the validated payload would force every schema to declare it.
   */
  readonly subjectId: string | null;
  readonly correlationId: CorrelationId;
  readonly occurredAt: Instant;
  readonly recordedAt: Instant;
  /** The decision the engine produced. Already asserted to authorise the command. */
  readonly decision: DecisionEnvelope;
  /** Values derived by the routing (S6) and UX (S9) stages, e.g. a routed tipo_parte_id. */
  readonly derived: Readonly<Record<string, unknown>>;
}

export interface EffectRecord {
  readonly kind: string;
  readonly subjectKind: string;
  readonly subjectId: Uuid | null;
  readonly detail?: Record<string, unknown>;
  /** When set, an event is queued on the transactional outbox in the same transaction. */
  readonly outboxEvent?: { readonly type: string; readonly payload: Record<string, unknown> };
}

export interface HandlerResult {
  readonly subject: SubjectRef;
  readonly version?: number;
  readonly effects: readonly EffectRecord[];
}

export interface CommandHandler<P = Record<string, unknown>> {
  readonly name: string;
  /**
   * Which object this command acts on, so authorization can check scope BEFORE any evaluation.
   * Resolved from the payload and a read-only query.
   */
  resolveScope(input: {
    db: Db;
    payload: P;
    envelope: CommandEnvelope;
    subjectId: string | null;
  }): Promise<{
    subject: SubjectRef;
    scope: ObjectScope;
    /** Current aggregate version, for the expected_version check. */
    currentVersion?: number;
    /** Current state, for the state machine stage. */
    currentState?: string;
  }>;
  /** Stage evaluators this command contributes. The engine owns the order. */
  evaluators(input: {
    db: Db;
    actor: AuthenticatedActor;
    payload: P;
    envelope: CommandEnvelope;
    subjectId: string | null;
    subject: SubjectRef;
    currentState?: string;
  }): Promise<readonly StageEvaluator[]>;
  /** Perform the effects. Runs only when the decision authorises it. */
  apply(context: CommandContext<P>): Promise<HandlerResult>;
}

const handlers = new Map<string, CommandHandler<never>>();

export function registerHandler<P>(handler: CommandHandler<P>): void {
  // Registering a handler for an unknown command is a programming error: the catalogue is the
  // authorization table, so a command with no definition is callable by nobody.
  commandDefinition(handler.name);
  if (handlers.has(handler.name)) {
    throw new Error(`Handler for "${handler.name}" is already registered.`);
  }
  handlers.set(handler.name, handler as unknown as CommandHandler<never>);
}

export const registeredCommands = (): readonly string[] => [...handlers.keys()];

/** Canonical JSON, so a payload hash is stable regardless of key order. */
function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`;
}

export const payloadHash = (payload: unknown): string =>
  createHash('sha256').update(canonicalise(payload)).digest('hex');

export interface ExecuteInput {
  readonly commandName: string;
  readonly actor: AuthenticatedActor;
  readonly rawEnvelope: unknown;
  /** Subject id from the route path, when the command addresses an existing aggregate. */
  readonly subjectId?: string | null;
  /** True for POST .../evaluate-<command>: evaluate and return, write nothing but a trace. */
  readonly preview: boolean;
  readonly rulesetVersion: string;
  readonly requestId: Uuid;
}

export interface ExecuteOutput {
  readonly receipt: {
    commandId: Uuid;
    receiptId: Uuid;
    decisionId?: Uuid;
    outcome: 'APPLIED' | 'REPLAYED' | 'NO_OP';
    receiptAt: Instant;
  };
  readonly decision: DecisionEnvelope;
  readonly data: { subject: SubjectRef; version?: number; effects: Record<string, unknown>[] };
}

/**
 * Execute one command end to end.
 *
 * Everything from the dedup check to the commit happens in a single transaction, so a crash between
 * "effects applied" and "receipt written" is impossible — that gap is what would turn a retry into a
 * duplicate Parte.
 */
/** What the transaction yields: either an applied/replayed command, or a committed refusal. */
type TransactionOutcome =
  | ({ blocked?: undefined } & ExecuteOutput)
  | { blocked: DecisionEnvelope; decisionId: Uuid };

export async function execute(input: ExecuteInput): Promise<ExecuteOutput> {
  const definition = commandDefinition(input.commandName);
  const handler = handlers.get(input.commandName);
  if (!handler) {
    throw new DomainError({
      code: 'NOT_FOUND',
      message: `El comando ${input.commandName} no tiene implementación registrada.`,
      details: [{ message: 'Registered: ' + registeredCommands().join(', ') }],
    });
  }

  // Envelope first: a malformed envelope must not reach authorization or the database.
  const envelope = parse<CommandEnvelope>(
    (await import('@vds/contracts')).CommandEnvelopeSchema,
    input.rawEnvelope,
  );
  const payload = parse<Record<string, unknown>>(definition.payload, envelope.payload ?? {});

  const occurredAt = envelope.occurredAt as Instant;
  const recordedAt = (envelope.recordedAt ?? envelope.occurredAt) as Instant;
  const correlationId = (envelope.correlationId as CorrelationId | undefined) ?? newCorrelationId();
  const hash = payloadHash({ command: input.commandName, payload });

  const outcome: TransactionOutcome = await withTransaction<TransactionOutcome>(async (db) => {
    // --- resolve the subject and authorise BEFORE evaluating anything
    const subjectId = input.subjectId ?? null;
    const resolved = await handler.resolveScope({
      db,
      payload: payload as never,
      envelope,
      subjectId,
    });
    const grant = assertAuthorised(input.actor, definition.capability, resolved.scope);

    // --- dedup, scoped to the authorising grant
    if (!input.preview) {
      const existing = await db.one<{
        id: Uuid;
        payload_hash: string;
        outcome: 'APPLIED' | 'NO_OP' | 'BLOCKED';
        decision_trace_id: Uuid | null;
        effects: Record<string, unknown>[];
        received_at: Date;
      }>(
        `SELECT id, payload_hash, outcome, decision_trace_id, effects, received_at
         FROM platform.command_receipts
         WHERE scope_id = $1 AND command_id = $2`,
        [grant.scopeId, envelope.commandId],
      );

      if (existing) {
        if (existing.payload_hash !== hash) {
          // RGT-07: same id, different content. Nothing further happens.
          throw commandConflict({
            commandId: envelope.commandId,
            storedPayloadHash: existing.payload_hash,
            incomingPayloadHash: hash,
          });
        }
        // RGT-06: return the original outcome. Same receipt, same ids, one effect.
        const trace = existing.decision_trace_id
          ? await loadTrace(db, existing.decision_trace_id)
          : null;
        if (existing.outcome === 'BLOCKED' && trace) {
          throw gateBlocked({
            message: 'El comando ya fue evaluado y resultó bloqueado.',
            details: trace.blocks.map((b) => ({
              message: b.reason,
              ruleId: b.ruleId,
              ...(b.instead === undefined ? {} : { instead: b.instead }),
              ...(b.sourceRef === undefined ? {} : { sourceRef: b.sourceRef }),
            })),
            ...(existing.decision_trace_id === null
              ? {}
              : { decisionId: existing.decision_trace_id }),
          });
        }
        return {
          receipt: {
            commandId: envelope.commandId as Uuid,
            receiptId: existing.id,
            ...(existing.decision_trace_id ? { decisionId: existing.decision_trace_id } : {}),
            outcome: 'REPLAYED' as const,
            receiptAt: existing.received_at.toISOString() as Instant,
          },
          decision:
            trace ??
            // A receipt with no trace can only come from a NO_OP; synthesise a minimal envelope
            // rather than invent blocks or effects.
            ({
              decisionId: uuidv4(),
              decision: 'NO_OP',
              subject: resolved.subject,
              trigger: definition.trigger,
              blocks: [],
              warnings: [],
              confirmationsRequired: [],
              missing: [],
              effects: [],
              rulesApplied: [],
              rulesetVersion: input.rulesetVersion,
              evaluatedAt: existing.received_at.toISOString() as Instant,
              contextHash: hash,
              preview: false,
            } satisfies DecisionEnvelope),
          data: { subject: resolved.subject, effects: existing.effects },
        };
      }
    }

    // --- optimistic concurrency: compare against the row, never trust the client
    if (
      envelope.expectedVersion !== undefined &&
      resolved.currentVersion !== undefined &&
      envelope.expectedVersion !== resolved.currentVersion
    ) {
      throw versionMismatch({
        subject: `${resolved.subject.kind} ${resolved.subject.code ?? resolved.subject.id ?? ''}`.trim(),
        expected: envelope.expectedVersion,
        actual: resolved.currentVersion,
      });
    }

    // --- evaluate: S0-S11, engine-owned order
    const context: NormalizedContext = {
      subject: resolved.subject,
      trigger: definition.trigger,
      ...(resolved.currentState === undefined ? {} : { currentState: resolved.currentState }),
      actorId: input.actor.identityId,
      capabilities: input.actor.capabilities,
      scope: {
        ...(resolved.scope.companyId ? { companyId: resolved.scope.companyId } : {}),
        ...(resolved.scope.baseId ? { baseId: resolved.scope.baseId } : {}),
        ...(resolved.scope.contractId ? { contractId: resolved.scope.contractId } : {}),
      },
      effectiveAt: occurredAt,
      recordedAt,
      ...(envelope.expectedVersion === undefined ? {} : { expectedVersion: envelope.expectedVersion }),
      connectivity: envelope.deviceId ? 'OFFLINE' : 'ONLINE',
      confirmations: envelope.confirmations ?? {},
      ...(envelope.override
        ? {
            override: {
              gateId: envelope.override.gateId,
              ruleId: envelope.override.ruleId,
              // The authorising actor is the session, never the payload.
              authorisedBy: input.actor.identityId,
              reason: envelope.override.reason,
              ...(envelope.override.evidenceId
                ? { evidenceId: envelope.override.evidenceId as Uuid }
                : {}),
              at: recordedAt,
            },
          }
        : {}),
      payload,
      ...(envelope.bundleRef === undefined ? {} : { bundleRef: envelope.bundleRef }),
      ...(envelope.rulesetRef === undefined ? {} : { deviceRulesetRef: envelope.rulesetRef }),
    };

    const evaluators = await handler.evaluators({
      db,
      actor: input.actor,
      payload: payload as never,
      envelope,
      subjectId,
      subject: resolved.subject,
      ...(resolved.currentState === undefined ? {} : { currentState: resolved.currentState }),
    });

    const decisionId = uuidv7();
    const result = await evaluate({
      context,
      evaluators,
      rulesetVersion: input.rulesetVersion,
      decisionId,
      contextHash: hash,
      preview: input.preview,
    });

    // --- persist the trace, whether or not the decision allows the command
    await persistTrace(db, {
      envelope: result.envelope,
      actorId: input.actor.identityId,
      deviceId: input.actor.deviceId,
      correlationId,
    });

    // A preview stops here: it has a trace (so "what would happen" is auditable) and no receipt,
    // because no command was accepted.
    if (input.preview) {
      return {
        receipt: {
          commandId: envelope.commandId as Uuid,
          receiptId: decisionId,
          decisionId,
          outcome: 'NO_OP' as const,
          receiptAt: instantNow(),
        },
        decision: result.envelope,
        data: { subject: resolved.subject, effects: [] },
      };
    }

    if (!authorises(result.envelope)) {
      // Record the refusal so a retry returns it without re-evaluating.
      await writeReceipt(db, {
        scopeId: grant.scopeId,
        envelope,
        definition,
        actor: input.actor,
        subject: resolved.subject,
        outcome: 'BLOCKED',
        decisionTraceId: decisionId,
        payloadHash: hash,
        occurredAt,
        recordedAt,
        effects: [],
      });

      // Return rather than throw. Throwing here would roll the transaction back and take the trace
      // and the receipt with it — but 06 requires that "BLOCK también tiene trace/receipt sin
      // efectos operativos", and RGT-06 requires a retried block to replay as a block. The refusal
      // is raised by the caller, after this transaction has committed.
      return { blocked: result.envelope, decisionId };
    }

    // Belt and braces: the handler must not be reachable with an envelope that does not authorise.
    assertAuthorises(result.envelope);

    // --- apply
    const applied = await handler.apply({
      db,
      actor: input.actor,
      payload: payload as never,
      envelope,
      subjectId,
      correlationId,
      occurredAt,
      recordedAt,
      decision: result.envelope,
      derived: result.derived,
    });

    // --- outbox, same transaction
    for (const effect of applied.effects) {
      if (!effect.outboxEvent) continue;
      await db.query(
        `INSERT INTO platform.domain_outbox
           (id, event_type, subject_kind, subject_id, payload, correlation_id, causation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          uuidv7(),
          effect.outboxEvent.type,
          effect.subjectKind,
          effect.subjectId,
          JSON.stringify(effect.outboxEvent.payload),
          correlationId,
          decisionId,
        ],
      );
    }

    const receiptId = await writeReceipt(db, {
      scopeId: grant.scopeId,
      envelope,
      definition,
      actor: input.actor,
      subject: applied.subject,
      outcome: 'APPLIED',
      decisionTraceId: decisionId,
      payloadHash: hash,
      occurredAt,
      recordedAt,
      effects: applied.effects,
    });

    return {
      receipt: {
        commandId: envelope.commandId as Uuid,
        receiptId,
        decisionId,
        outcome: 'APPLIED' as const,
        receiptAt: instantNow(),
      },
      decision: result.envelope,
      data: {
        subject: applied.subject,
        ...(applied.version === undefined ? {} : { version: applied.version }),
        effects: applied.effects.map((e) => ({
          kind: e.kind,
          subjectKind: e.subjectKind,
          subjectId: e.subjectId,
          ...(e.detail ?? {}),
        })),
      },
    };
  });

  // The transaction has committed. A refusal now carries a durable trace and receipt, so it can be
  // explained later and replays as a refusal rather than being re-evaluated.
  if (outcome.blocked) {
    throw blockedError(outcome.blocked, outcome.decisionId);
  }
  return outcome;
}

/** Turn a refused decision into the typed error the API returns. */
function blockedError(envelope: DecisionEnvelope, decisionId: Uuid): DomainError {
  return gateBlocked({
    message:
      envelope.decision === 'REQUIRE_CONFIRMATION'
        ? 'Falta confirmación humana antes de aplicar el comando.'
        : 'El comando fue bloqueado por una o más reglas.',
    details: [
      ...envelope.blocks.map((b) => ({
        message: b.reason,
        ruleId: b.ruleId,
        ...(b.instead === undefined ? {} : { instead: b.instead }),
        ...(b.sourceRef === undefined ? {} : { sourceRef: b.sourceRef }),
      })),
      ...envelope.confirmationsRequired.map((c) => ({
        path: c.field,
        message: c.reason,
        ...(c.ruleId === undefined ? {} : { ruleId: c.ruleId }),
      })),
    ],
    decisionId,
  });
}

async function persistTrace(
  db: Db,
  input: {
    envelope: DecisionEnvelope;
    actorId: Uuid;
    deviceId: Uuid | null;
    correlationId: CorrelationId;
  },
): Promise<void> {
  const e = input.envelope;
  await db.query(
    `INSERT INTO platform.decision_traces
       (id, decision, subject_kind, subject_id, trigger, current_state, target_state, actor_id,
        device_id, normalized_inputs, context_hash, blocks, warnings, confirmations, missing,
        effects, override_ref, preview, correlation_id, decision_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [
      e.decisionId,
      e.decision,
      e.subject.kind,
      e.subject.id,
      e.trigger,
      e.currentState ?? null,
      e.targetState ?? null,
      input.actorId,
      input.deviceId,
      JSON.stringify({ subject: e.subject, expectedVersion: e.expectedVersion ?? null }),
      e.contextHash,
      JSON.stringify(e.blocks),
      JSON.stringify(e.warnings),
      JSON.stringify(e.confirmationsRequired),
      JSON.stringify(e.missing),
      JSON.stringify(e.effects),
      e.override ? JSON.stringify(e.override) : null,
      e.preview,
      input.correlationId,
      e.evaluatedAt,
    ],
  );

  // Which rules won and which lost, so a past decision can be explained (sheet 58 step 8).
  for (const rule of e.rulesApplied) {
    await db.query(
      `INSERT INTO platform.decision_trace_rules
         (id, decision_trace_id, rule_id, precedence, outcome, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv7(), e.decisionId, rule.ruleId, rule.precedence, rule.outcome, rule.note ?? null],
    );
  }
}

async function loadTrace(db: Db, traceId: Uuid): Promise<DecisionEnvelope | null> {
  const row = await db.one<{
    id: Uuid;
    decision: DecisionEnvelope['decision'];
    subject_kind: string;
    subject_id: Uuid | null;
    trigger: string;
    current_state: string | null;
    target_state: string | null;
    blocks: DecisionEnvelope['blocks'];
    warnings: DecisionEnvelope['warnings'];
    confirmations: DecisionEnvelope['confirmationsRequired'];
    missing: DecisionEnvelope['missing'];
    effects: DecisionEnvelope['effects'];
    context_hash: string;
    preview: boolean;
    decision_at: Date;
  }>('SELECT * FROM platform.decision_traces WHERE id = $1', [traceId]);
  if (!row) return null;

  const { rows: ruleRows } = await db.query<{
    rule_id: string;
    precedence: string;
    outcome: string;
    note: string | null;
  }>(
    'SELECT rule_id, precedence, outcome, note FROM platform.decision_trace_rules WHERE decision_trace_id = $1',
    [traceId],
  );

  return {
    decisionId: row.id,
    decision: row.decision,
    subject: { kind: row.subject_kind, id: row.subject_id },
    trigger: row.trigger,
    ...(row.current_state === null ? {} : { currentState: row.current_state }),
    ...(row.target_state === null ? {} : { targetState: row.target_state }),
    blocks: row.blocks,
    warnings: row.warnings,
    confirmationsRequired: row.confirmations,
    missing: row.missing,
    effects: row.effects,
    rulesApplied: ruleRows.map((r) => ({
      ruleId: r.rule_id,
      precedence: r.precedence as DecisionEnvelope['rulesApplied'][number]['precedence'],
      outcome: r.outcome as DecisionEnvelope['rulesApplied'][number]['outcome'],
      ...(r.note === null ? {} : { note: r.note }),
    })),
    rulesetVersion: '',
    evaluatedAt: row.decision_at.toISOString() as Instant,
    contextHash: row.context_hash,
    preview: row.preview,
  };
}

async function writeReceipt(
  db: Db,
  input: {
    scopeId: Uuid;
    envelope: CommandEnvelope;
    definition: { name: string };
    actor: AuthenticatedActor;
    subject: SubjectRef;
    outcome: 'APPLIED' | 'NO_OP' | 'BLOCKED';
    decisionTraceId: Uuid;
    payloadHash: string;
    occurredAt: Instant;
    recordedAt: Instant;
    effects: readonly EffectRecord[];
  },
): Promise<Uuid> {
  const receiptId = uuidv7();
  await db.query(
    `INSERT INTO platform.command_receipts
       (id, scope_id, command_id, command_type, subject_kind, subject_id, actor_id, device_id,
        outcome, decision_trace_id, payload_hash, effects, occurred_at, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      receiptId,
      input.scopeId,
      input.envelope.commandId,
      input.definition.name,
      input.subject.kind,
      input.subject.id,
      input.actor.identityId,
      input.actor.deviceId,
      input.outcome,
      input.decisionTraceId,
      input.payloadHash,
      JSON.stringify(
        input.effects.map((e) => ({
          kind: e.kind,
          subjectKind: e.subjectKind,
          subjectId: e.subjectId,
          ...(e.detail ?? {}),
        })),
      ),
      input.occurredAt,
      input.recordedAt,
    ],
  );
  return receiptId;
}
