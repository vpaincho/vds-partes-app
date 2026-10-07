/**
 * The Master Rule Engine: the S0–S11 pipeline of sheet 63.
 *
 * Sheet 63 is explicit that it defines "qué debe saber el motor, en qué orden decide y qué
 * debe devolver" — a functional contract, not an API. This file implements the order and the
 * composition; the *content* of each stage is supplied by the owning domain module as a
 * `StageEvaluator`, so `execution` does not need to know how `habilita` decides a gate.
 *
 *   S0  NORMALIZAR CONTEXTO     resolve references and the effective decision timestamp
 *   S1  RESOLVER RULESET        pick the rule versions effective at the moment of the fact
 *   S2  PROTEGER INVARIANTES    P0 — history, lineage, no-delete, no-reopen
 *   S3  EVALUAR HABILITA        P1 — hard gates, warnings, authorised overrides
 *   S4  VALIDAR TRANSICIÓN      P2 — the state machine
 *   S5  APLICAR CONTROL PLANE   P3 — directives still in force
 *   S6  RESOLVER IDENTIDAD      P4 — TipoParte, continuity, split, new UE vs new Parte
 *   S7  APLICAR OPERACIÓN       P5 — facts, temporality, readiness
 *   S8  APLICAR CONTRATO        P6 — commercial interpretation; fail closed if unresolved
 *   S9  APLICAR UX              P7 — what to autofill, preload or confirm
 *   S10 COMPONER DECISIÓN       one envelope, deterministic conflict resolution
 *   S11 PERSISTIR TRACE         trace + side effects, exactly once
 *
 * Two behaviours are not negotiable:
 *
 *  - **S2 short-circuits side effects.** "Si falla P0, no continuar con side effects
 *    incompatibles". Later stages still *evaluate*, so the operator sees every reason at once
 *    rather than fixing one blocker to discover the next, but nothing is performed.
 *  - **S11 is the caller's transaction.** This engine never writes. It returns the envelope
 *    and the declared effects; the command service persists receipt + effects + trace +
 *    outbox atomically. Keeping the engine pure is what lets the same rules run in the API,
 *    the worker and the browser.
 */
import {
  decide,
  type AppliedRule,
  type Blocker,
  type ConfirmationRequired,
  type DeclaredEffect,
  type DecisionEnvelope,
  type Instant,
  type MissingItem,
  type OverrideRecord,
  type Precedence,
  type SubjectRef,
  type Uuid,
  type Warning,
} from '@vds/kernel';

export type Stage =
  | 'S0_NORMALIZE'
  | 'S1_RULESET'
  | 'S2_INVARIANTS'
  | 'S3_HABILITA'
  | 'S4_TRANSITION'
  | 'S5_CONTROL_PLANE'
  | 'S6_IDENTITY'
  | 'S7_OPERATION'
  | 'S8_CONTRACT'
  | 'S9_UX'
  | 'S10_COMPOSE'
  | 'S11_PERSIST';

/** Stages that evaluate rules, in the order sheet 63 fixes, with their precedence level. */
export const EVALUATION_STAGES: readonly { stage: Stage; precedence: Precedence }[] = [
  { stage: 'S2_INVARIANTS', precedence: 'P0' },
  { stage: 'S3_HABILITA', precedence: 'P1' },
  { stage: 'S4_TRANSITION', precedence: 'P2' },
  { stage: 'S5_CONTROL_PLANE', precedence: 'P3' },
  { stage: 'S6_IDENTITY', precedence: 'P4' },
  { stage: 'S7_OPERATION', precedence: 'P5' },
  { stage: 'S8_CONTRACT', precedence: 'P6' },
  { stage: 'S9_UX', precedence: 'P7' },
];

/**
 * The normalised context (S0 output). Everything a stage may read.
 *
 * `effectiveAt` is the timestamp of the **fact**, not of the request: S1 selects rule versions
 * with it, which is what makes "explain yesterday's decision with yesterday's rules" work and
 * AP-02 impossible.
 */
export interface NormalizedContext {
  readonly subject: SubjectRef;
  readonly trigger: string;
  readonly currentState?: string;
  readonly actorId: Uuid;
  /** Capabilities already verified by the server. The engine does not authenticate. */
  readonly capabilities: readonly string[];
  readonly scope: {
    readonly companyId?: Uuid;
    readonly baseId?: Uuid;
    readonly contractId?: Uuid;
  };
  readonly effectiveAt: Instant;
  readonly recordedAt: Instant;
  readonly expectedVersion?: number;
  /** Whether the device was online when the command was captured. */
  readonly connectivity: 'ONLINE' | 'OFFLINE';
  /** Confirmations the human already supplied, by field name. */
  readonly confirmations: Readonly<Record<string, unknown>>;
  /** An authorised override presented with the command, if any. */
  readonly override?: OverrideRecord;
  /** Arbitrary per-command payload, validated at the boundary before it reaches here. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Refs to the bundle and ruleset the device used, for reconciliation. */
  readonly bundleRef?: string;
  readonly deviceRulesetRef?: string;
}

/** What a stage contributes. A stage never decides the overall outcome by itself. */
export interface StageOutcome {
  readonly blocks?: readonly Blocker[];
  readonly warnings?: readonly Warning[];
  readonly confirmationsRequired?: readonly ConfirmationRequired[];
  readonly missing?: readonly MissingItem[];
  readonly effects?: readonly DeclaredEffect[];
  readonly rulesApplied?: readonly AppliedRule[];
  /** Set by S4 when the transition is permitted. */
  readonly targetState?: string;
  /** Values derived for the caller, e.g. a routed tipo_parte_id (S6) or defaults (S9). */
  readonly derived?: Readonly<Record<string, unknown>>;
}

export interface StageEvaluator {
  readonly stage: Stage;
  readonly precedence: Precedence;
  /** For diagnostics: which module registered this evaluator. */
  readonly owner: string;
  evaluate(context: NormalizedContext): StageOutcome | Promise<StageOutcome>;
}

export interface EngineInput {
  readonly context: NormalizedContext;
  readonly evaluators: readonly StageEvaluator[];
  readonly rulesetVersion: string;
  readonly decisionId: Uuid;
  readonly contextHash: string;
  /** True for an `evaluate-*` call. A preview authorises nothing (RGT-17). */
  readonly preview: boolean;
}

export interface EngineResult {
  readonly envelope: DecisionEnvelope;
  /** Values derived by S6/S9, merged in stage order. */
  readonly derived: Readonly<Record<string, unknown>>;
  /** Per-stage record, for diagnosing why a decision came out as it did. */
  readonly stages: readonly {
    readonly stage: Stage;
    readonly precedence: Precedence;
    readonly owner: string;
    readonly blocked: boolean;
    readonly ruleIds: readonly string[];
  }[];
  /**
   * True when a P0 invariant failed. Side effects must not be performed, even if a later
   * stage declared some: sheet 63 S2 — "no continuar con side effects incompatibles".
   */
  readonly invariantsFailed: boolean;
}

/**
 * Run the pipeline and compose one envelope.
 *
 * Evaluators are run in the fixed stage order regardless of earlier blocks, so the operator
 * is shown every reason at once — the audit found the prototype surfaced blockers one at a
 * time at the end, which turns fixing a Parte into a guessing game. What a block prevents is
 * *performing* effects, not *evaluating* the rest.
 */
export async function evaluate(input: EngineInput): Promise<EngineResult> {
  const { context } = input;

  const blocks: Blocker[] = [];
  const warnings: Warning[] = [];
  const confirmations: ConfirmationRequired[] = [];
  const missing: MissingItem[] = [];
  const effects: DeclaredEffect[] = [];
  const rulesApplied: AppliedRule[] = [];
  const stages: EngineResult['stages'][number][] = [];
  let derived: Record<string, unknown> = {};
  let targetState: string | undefined;
  let invariantsFailed = false;

  for (const { stage, precedence } of EVALUATION_STAGES) {
    const forStage = input.evaluators.filter((e) => e.stage === stage);
    for (const evaluator of forStage) {
      if (evaluator.precedence !== precedence) {
        throw new Error(
          `${evaluator.owner} registered an evaluator for ${stage} with precedence ` +
            `${evaluator.precedence}, but ${stage} is ${precedence}. Sheet 63 binds each ` +
            'stage to one precedence level; a mismatch would silently reorder authority.',
        );
      }

      const outcome = await evaluator.evaluate(context);

      blocks.push(...(outcome.blocks ?? []));
      warnings.push(...(outcome.warnings ?? []));
      confirmations.push(...(outcome.confirmationsRequired ?? []));
      missing.push(...(outcome.missing ?? []));
      effects.push(...(outcome.effects ?? []));
      rulesApplied.push(...(outcome.rulesApplied ?? []));
      if (outcome.derived) derived = { ...derived, ...outcome.derived };
      if (outcome.targetState !== undefined) targetState = outcome.targetState;

      const stageBlocked = (outcome.blocks ?? []).length > 0;
      if (stage === 'S2_INVARIANTS' && stageBlocked) invariantsFailed = true;

      stages.push({
        stage,
        precedence,
        owner: evaluator.owner,
        blocked: stageBlocked,
        ruleIds: (outcome.rulesApplied ?? []).map((r) => r.ruleId),
      });
    }
  }

  // S10: compose. `decide` derives the kind from the parts, so the envelope cannot claim ALLOW
  // while carrying a blocker, or claim WARN while a required override is still missing.
  const envelope = decide({
    decisionId: input.decisionId,
    subject: context.subject,
    trigger: context.trigger,
    rulesetVersion: input.rulesetVersion,
    evaluatedAt: context.effectiveAt,
    contextHash: input.contextHash,
    preview: input.preview,
    ...(context.currentState === undefined ? {} : { currentState: context.currentState }),
    // A blocked decision declares no target state: nothing transitions.
    ...(targetState === undefined || blocks.length > 0 ? {} : { targetState }),
    ...(context.expectedVersion === undefined ? {} : { expectedVersion: context.expectedVersion }),
    blocks,
    warnings,
    confirmationsRequired: confirmations,
    missing,
    // Effects are declared only when nothing blocks. Keeping them out of a blocked envelope
    // removes any chance a caller performs them by reading the wrong field.
    effects: blocks.length > 0 ? [] : effects,
    rulesApplied,
    ...(context.override === undefined ? {} : { override: context.override }),
  });

  return { envelope, derived, stages, invariantsFailed };
}

/**
 * Guard for the command service. Throws unless the envelope actually authorises the command.
 *
 * The point is that no code path can reach persistence by inspecting `decision` loosely — a
 * preview, a block, or an outstanding confirmation all stop here.
 */
export function assertAuthorises(envelope: DecisionEnvelope): void {
  if (envelope.preview) {
    throw new Error(
      `Decision ${envelope.decisionId} is a preview and authorises nothing. Re-evaluate at ` +
        'execution time: context can change between preview and command (RGT-17).',
    );
  }
  if (envelope.decision === 'BLOCK') {
    const first = envelope.blocks[0];
    throw new Error(
      `Decision ${envelope.decisionId} is BLOCK (${envelope.blocks.length} blocker(s))` +
        (first ? `: ${first.ruleId} — ${first.reason}` : ''),
    );
  }
  if (envelope.decision === 'REQUIRE_CONFIRMATION') {
    throw new Error(
      `Decision ${envelope.decisionId} needs confirmation of: ` +
        envelope.confirmationsRequired.map((c) => c.field).join(', '),
    );
  }
  if (envelope.decision === 'NO_OP') {
    throw new Error(`Decision ${envelope.decisionId} is NO_OP: there is nothing to perform.`);
  }
}
