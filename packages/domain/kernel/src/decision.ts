/**
 * The DecisionEnvelope — the single output shape of every rule evaluation.
 *
 * Sheet 63 defines this as a *functional* contract, not an API detail: "No usar booleano
 * único si existen warnings o confirmaciones". The prototype's `checks()` returned a flat
 * list of `['err'|'warn', text, step]` tuples, which is why its UI could only say
 * "9 pendientes" — blockers, warnings and missing data were indistinguishable, and nothing
 * recorded *which rule* decided or *what to do next*.
 *
 * Four separations are load-bearing:
 *
 *  - **blocks vs warnings vs confirmations.** A block cannot be overridden (RUL-039); a
 *    warning can, but only through an explicit OverrideGate (RUL-040), and showing a warning
 *    then continuing is the forbidden antipattern AP-04. A confirmation is neither: it is
 *    missing human input.
 *  - **preview vs executed.** An `evaluate-*` call returns `preview: true` and authorises
 *    nothing. RGT-17: a document revoked between preview and command must still block.
 *  - **rules applied vs discarded.** When two rules conflict, the trace has to show the one
 *    that lost and why (sheet 58 step 8), otherwise a past decision cannot be explained.
 *  - **effects declared vs effects performed.** The envelope *declares* intended effects; the
 *    command service performs them in one transaction. Emission is never application (C-017).
 */
import type { Instant } from './time.ts';
import type { CorrelationId, Uuid } from './ids.ts';

/** Rule precedence, sheet 58. Lower number wins; P8 cannot decide anything. */
export type Precedence = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8';

export const PRECEDENCE_ORDER: readonly Precedence[] = [
  'P0',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'P7',
  'P8',
];

export const PRECEDENCE_MEANING: Record<Precedence, string> = {
  P0: 'INVARIANTES / HISTORIA / LINEAGE — identidad histórica, append-only, supersession',
  P1: 'HABILITA / HARD GATES — seguridad, habilitación documental, PTW, emergencias',
  P2: 'MÁQUINAS DE ESTADO — transiciones válidas y estados terminales',
  P3: 'CONTROL PLANE — instrucciones explícitas post-despacho',
  P4: 'IDENTIDAD / ROUTING — qué objeto existe y cuándo se corta o continúa',
  P5: 'OPERACIÓN / TEMPORAL / READINESS — cómo se registra la realidad',
  P6: 'CONTRATO / CERTIFICACIÓN / FACTURACIÓN — interpretación comercial de la realidad',
  P7: 'UX / AUTOMATIZACIÓN — qué se autoderiva, precarga o confirma',
  P8: 'ADVISORY / ANALYTICS — recomendaciones que no cambian verdad ni estado',
};

export const comparePrecedence = (a: Precedence, b: Precedence): number =>
  PRECEDENCE_ORDER.indexOf(a) - PRECEDENCE_ORDER.indexOf(b);

export type DecisionKind = 'ALLOW' | 'BLOCK' | 'WARN' | 'REQUIRE_CONFIRMATION' | 'NO_OP';

/** A typed reference to the thing being decided about. Never a bare string. */
export interface SubjectRef {
  readonly kind: string;
  readonly id: Uuid | null;
  /** Human code when one exists (PD-0394). A label, never the identity. */
  readonly code?: string;
}

export interface Blocker {
  readonly ruleId: string;
  readonly precedence: Precedence;
  /** Why, in words an operator can act on — not just an id. */
  readonly reason: string;
  /** What to do instead. Mandatory for a forbidden transition (sheet 56). */
  readonly instead?: string;
  /** Sheet and row, so the block is traceable to its source. */
  readonly sourceRef?: string;
  /** The datum at fault, so the UI can link straight to it. */
  readonly subject?: SubjectRef;
  /** True when this rule declares an override path; false means it can never be overridden. */
  readonly overrideable: boolean;
}

export interface Warning {
  readonly ruleId: string;
  readonly precedence: Precedence;
  readonly reason: string;
  readonly sourceRef?: string;
  readonly subject?: SubjectRef;
  /**
   * A warning is not permission. If it needs an OverrideGate before the command may proceed,
   * this names the gate; the command then requires an authorised override (RUL-041).
   */
  readonly requiresOverrideGate?: string;
}

/** Human input the system cannot derive. The CF-01..13 "Humano solo hace" column. */
export interface ConfirmationRequired {
  readonly field: string;
  readonly reason: string;
  /** Candidate the system derived, for a one-tap confirm. Never applied unconfirmed (AP-03). */
  readonly candidate?: unknown;
  readonly ruleId?: string;
}

/** A missing-but-not-blocking item. Counted separately so "9 pendientes" cannot happen. */
export interface MissingItem {
  readonly what: string;
  readonly reason: string;
  readonly subject?: SubjectRef;
  readonly ruleId?: string;
}

/** An effect the envelope declares. Performed by the command service, transactionally. */
export interface DeclaredEffect {
  readonly kind: string;
  readonly subject?: SubjectRef;
  readonly description: string;
  readonly ruleId?: string;
}

export interface AppliedRule {
  readonly ruleId: string;
  readonly precedence: Precedence;
  readonly outcome: 'WON' | 'DISCARDED_BY_PRECEDENCE' | 'DISCARDED_BY_SPECIFICITY' | 'NOT_APPLICABLE';
  /** Why it lost, when it lost. Sheet 58 step 8 requires this to be persisted. */
  readonly note?: string;
  readonly rulesetVersion?: string;
}

export interface DecisionEnvelope {
  readonly decisionId: Uuid;
  readonly decision: DecisionKind;
  readonly subject: SubjectRef;
  /** The semantic event, e.g. START_WORK — never a UI click. */
  readonly trigger: string;
  readonly currentState?: string;
  /** Empty when the decision produces no transition. */
  readonly targetState?: string;
  readonly blocks: readonly Blocker[];
  readonly warnings: readonly Warning[];
  readonly confirmationsRequired: readonly ConfirmationRequired[];
  readonly missing: readonly MissingItem[];
  readonly effects: readonly DeclaredEffect[];
  readonly rulesApplied: readonly AppliedRule[];
  readonly rulesetVersion: string;
  readonly evaluatedAt: Instant;
  /** Hash of the normalised context, so a re-evaluation can be told from a replay. */
  readonly contextHash: string;
  readonly expectedVersion?: number;
  readonly correlationId?: CorrelationId;
  /**
   * True for an `evaluate-*` call. A preview authorises nothing: the command re-evaluates
   * with the context at execution time (RGT-17).
   */
  readonly preview: boolean;
  /** An authorised override that satisfied a declared exception, if any. */
  readonly override?: OverrideRecord;
}

export interface OverrideRecord {
  readonly gateId: string;
  readonly ruleId: string;
  readonly authorisedBy: Uuid;
  readonly reason: string;
  readonly evidenceId?: Uuid;
  readonly at: Instant;
}

/* ------------------------------------------------------------------------ building */

export interface DecisionInput {
  readonly decisionId: Uuid;
  readonly subject: SubjectRef;
  readonly trigger: string;
  readonly rulesetVersion: string;
  readonly evaluatedAt: Instant;
  readonly contextHash: string;
  readonly preview: boolean;
  readonly currentState?: string;
  readonly targetState?: string;
  readonly expectedVersion?: number;
  readonly correlationId?: CorrelationId;
  readonly blocks?: readonly Blocker[];
  readonly warnings?: readonly Warning[];
  readonly confirmationsRequired?: readonly ConfirmationRequired[];
  readonly missing?: readonly MissingItem[];
  readonly effects?: readonly DeclaredEffect[];
  readonly rulesApplied?: readonly AppliedRule[];
  readonly override?: OverrideRecord;
}

/**
 * Derive the single `decision` from the parts, so the kind can never contradict the contents.
 *
 * Order matters and encodes precedence:
 *   any block                              → BLOCK
 *   a warning still awaiting its override   → BLOCK (AP-04: a warning is not permission)
 *   confirmations outstanding               → REQUIRE_CONFIRMATION
 *   nothing to do                           → NO_OP
 *   warnings only, already overridden        → WARN
 *   otherwise                               → ALLOW
 */
export function decide(input: DecisionInput): DecisionEnvelope {
  const blocks = input.blocks ?? [];
  const warnings = input.warnings ?? [];
  const confirmations = input.confirmationsRequired ?? [];
  const effects = input.effects ?? [];

  const unsatisfiedGate = warnings.find(
    (w) => w.requiresOverrideGate !== undefined && input.override?.gateId !== w.requiresOverrideGate,
  );

  let decision: DecisionKind;
  if (blocks.length > 0) {
    decision = 'BLOCK';
  } else if (unsatisfiedGate) {
    decision = 'BLOCK';
  } else if (confirmations.length > 0) {
    decision = 'REQUIRE_CONFIRMATION';
  } else if (effects.length === 0 && input.targetState === undefined) {
    decision = 'NO_OP';
  } else if (warnings.length > 0) {
    decision = 'WARN';
  } else {
    decision = 'ALLOW';
  }

  return {
    decisionId: input.decisionId,
    decision,
    subject: input.subject,
    trigger: input.trigger,
    ...(input.currentState === undefined ? {} : { currentState: input.currentState }),
    ...(input.targetState === undefined ? {} : { targetState: input.targetState }),
    blocks,
    warnings,
    confirmationsRequired: confirmations,
    missing: input.missing ?? [],
    effects,
    rulesApplied: input.rulesApplied ?? [],
    rulesetVersion: input.rulesetVersion,
    evaluatedAt: input.evaluatedAt,
    contextHash: input.contextHash,
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    preview: input.preview,
    ...(input.override === undefined ? {} : { override: input.override }),
  };
}

/** Does this envelope authorise performing the command? */
export function authorises(envelope: DecisionEnvelope): boolean {
  if (envelope.preview) return false; // a preview never authorises (RGT-17)
  return envelope.decision === 'ALLOW' || envelope.decision === 'WARN';
}

/**
 * Counts for the UI. Deliberately three numbers, never one: the audit found the prototype's
 * cierre step reported "9 pendientes" by mixing blockers with non-blocking notices, so the
 * crew could not tell what actually prevented sending.
 */
export function counts(envelope: DecisionEnvelope): {
  blocks: number;
  warnings: number;
  missing: number;
  confirmations: number;
} {
  return {
    blocks: envelope.blocks.length,
    warnings: envelope.warnings.length,
    missing: envelope.missing.length,
    confirmations: envelope.confirmationsRequired.length,
  };
}

/** The highest-authority blocker, for a one-line summary. */
export function primaryBlocker(envelope: DecisionEnvelope): Blocker | null {
  if (envelope.blocks.length === 0) return null;
  return [...envelope.blocks].sort((a, b) => comparePrecedence(a.precedence, b.precedence))[0] as Blocker;
}

/** Can an override even be offered? False when every blocker is a hard block. */
export function isOverrideable(envelope: DecisionEnvelope): boolean {
  return envelope.blocks.length > 0 && envelope.blocks.every((b) => b.overrideable);
}
