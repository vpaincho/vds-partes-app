/**
 * TypePartBehavior — one model, one set of commands, three strategies.
 *
 * The three TipoParte differ in **what counts as one Parte, what counts as one UE, and what has to
 * be captured when**. They do not differ in their persistence, their commands, their gates or their
 * transactions. That distinction is the whole design: the prototype had a single `trabajo` shape and
 * therefore no way to express that a transport movement and a crew shift are different grains, while
 * three separate stores would have let the shared rules drift apart three ways.
 *
 * So each strategy answers six questions and nothing else:
 *
 *  1. `validateRouteContext` — is this pattern applicable to this context at all? (RUL-001/002)
 *  2. `evaluateIdentity` — does this change of context keep the Parte, open a new UE, hand over, or
 *     start a new Parte? (RUL-003…008)
 *  3. `requiredComponents` — which capture components apply, so the UI never asks for a field this
 *     pattern does not have.
 *  4. `captureContract` — what the system already knows at a given moment and what is left for the
 *     human (CF-01…CF-08).
 *  5. `completionRequirements` — what closing means here (RUL-033/034).
 *  6. `summaryProjection` — what the Parte looks like when read back.
 *
 * Every method is pure: context in, decision out. No clock, no database, no configuration lookup —
 * configuration arrives through `ctx.config`, because a limit that lives in code is a limit nobody
 * can change without a deploy (C-005: todo límite real es configuración versionada).
 */

export type TypePartId = 'TP-01' | 'TP-02' | 'TP-03';

/* ------------------------------------------------------------------------- routing */

/**
 * Enough of the context to decide routing and identity.
 *
 * `partTypeHint` is what the plan expected, not what a user picked: C-006 forbids a free TipoParte
 * selector as the normal path, so the hint comes from the approved assignment.
 */
export interface NormalizedContext {
  readonly partTypeHint?: TypePartId;
  /** Present when the work was planned. Absent means emergent (RUL-036/037). */
  readonly plannedAssignmentId?: string;
  readonly serviceCode?: string;
  /** Resource kind of the principal resource, when there is one, e.g. `CAMION`. */
  readonly principalResourceType?: string;
  /** How many distinct technical locations the planned scope spans. */
  readonly plannedLocationCount: number;
  /** True when the planned scope names an origin and a destination. */
  readonly hasOriginAndDestination: boolean;
  /** True when the planned scope is a crew roster rather than a single objective. */
  readonly hasCrew: boolean;
  readonly isEmergent: boolean;
  readonly config: TypePartConfig;
}

/**
 * The configuration each pattern consults. Absent values are absent, never defaulted to a number
 * someone might mistake for a decision — `PENDING_CONFIGURATION` is a real answer (RGT-12).
 */
export interface TypePartConfig {
  /**
   * Whether a shift change forces a new Parte for this pattern. Undefined means not configured, and
   * the default is **no cut** (B-01, RUL-005) — but the decision says it was a default.
   */
  readonly shiftCutsPart?: boolean;
  /** Whether a change of technical location forces a cut. Default no (RUL-008, C-019). */
  readonly locationCutsPart?: boolean;
  /** Whether a change of client forces a cut. This one has no safe default. */
  readonly clientCutsPart?: boolean;
  /** For TP-02: whether a new leg after unloading continues the same Parte. */
  readonly transportContinuity?: 'SAME_PART' | 'NEW_PART';
  /** For TP-03: the operational-day boundary, as a local time `HH:MM`. */
  readonly shiftBoundary?: string;
}

export type RouteDecision =
  | { readonly kind: 'APPLICABLE'; readonly reason: string; readonly ruleId: string }
  | {
      readonly kind: 'NOT_APPLICABLE';
      readonly reason: string;
      readonly ruleId: string;
    }
  | {
      /** The pattern could apply, but a discriminating datum is missing (RUL-002). */
      readonly kind: 'AMBIGUOUS';
      readonly reason: string;
      readonly missing: readonly string[];
      readonly ruleId: string;
    };

/* ------------------------------------------------------------------------ identity */

/**
 * The context changes that can move identity.
 *
 * Deliberately a closed list taken from sheet 60: a change not on this list is not an identity
 * question, and inventing one would be a silent domain reinterpretation.
 */
export type ContextChangeKind =
  | 'SHIFT_CHANGED'
  | 'LOCATION_CHANGED'
  | 'RESOURCE_CHANGED'
  | 'PERSON_CHANGED'
  | 'WORK_PERMIT_CHANGED'
  | 'CLIENT_CHANGED'
  | 'WORK_PACKAGE_CHANGED'
  | 'TRANSPORT_LEG_COMPLETED'
  | 'INDEPENDENT_SUBWORK_DETECTED';

export interface ContextChange {
  readonly kind: ContextChangeKind;
  /** Free-text detail for the trace. Never used to decide. */
  readonly detail?: string;
  /** True when the new work package is operationally independent of the current one (RUL-004). */
  readonly independentObjective?: boolean;
  /** For TP-02: whether another leg follows this one. */
  readonly hasNextLeg?: boolean;
}

export interface PartState {
  readonly partTypeId: TypePartId;
  readonly state: 'PREPARADO' | 'EN_EJECUCION' | 'SUSPENDIDO' | 'CERRADO_OPERATIVAMENTE' | 'ANULADO';
  readonly openUnitCount: number;
  readonly closedUnitCount: number;
  readonly config: TypePartConfig;
}

export type IdentityOutcome = 'KEEP_PART' | 'NEW_EXECUTION_UNIT' | 'NEW_PART' | 'HANDOVER';

export interface IdentityDecision {
  readonly outcome: IdentityOutcome;
  readonly ruleId: string;
  readonly reason: string;
  /** Side effects the rule declares, e.g. `EventoOperativo`, `EventoHandover`. */
  readonly effects: readonly string[];
  /**
   * True when the outcome came from a default rather than from configuration. The trace must be able
   * to say "nothing was configured, so the conservative default applied" — otherwise a later change
   * of configuration looks like the system changed its mind (B-01…B-09).
   */
  readonly fromDefault: boolean;
  /** Set when the answer depends on configuration that does not exist yet. */
  readonly pendingConfiguration?: string;
}

/* ------------------------------------------------------------------------ capture */

export type CaptureMoment =
  | 'PART_PREPARE'
  | 'UNIT_START'
  | 'DURING'
  | 'UNIT_CLOSE'
  | 'PART_CLOSE';

/**
 * What the system knows and what is left for the person, per CF-01…CF-08.
 *
 * `budgetSeconds` is the documented UX budget from sheet 66. It is a **design target**, not a
 * measurement: CC-08 is explicit that those PASS marks are documentary estimates, and nothing here
 * claims a measured latency.
 */
export interface CaptureContract {
  readonly contractId: string;
  readonly moment: CaptureMoment;
  /** Derived by the system; the UI shows it and does not ask. */
  readonly systemKnows: readonly string[];
  /** The only things a person is asked for on the happy path. */
  readonly humanProvides: readonly string[];
  /** What opens an exception path instead of the happy path. */
  readonly exceptionsOpen: readonly string[];
  readonly budgetSeconds: number | null;
}

/* ---------------------------------------------------------------------- components */

export interface ComponentRequirement {
  readonly code: string;
  readonly label: string;
  readonly required: boolean;
  /** Why it applies here, for the UI and the trace. */
  readonly reason: string;
}

export interface ComponentContext {
  /** Component codes the configuration attached to this TipoParte, with their required flag. */
  readonly configured: readonly { readonly code: string; readonly required: boolean }[];
  readonly hasMeasurableService: boolean;
  readonly config: TypePartConfig;
}

/* --------------------------------------------------------------------- completion */

export interface CompletionScope {
  readonly openUnits: number;
  readonly openIntervals: number;
  readonly unitsWithoutResult: number;
  readonly missingMeasurements: readonly string[];
  readonly pendingEvidence: number;
  /** TP-02 only: legs started and not resolved. */
  readonly unresolvedLegs?: number;
  /** TP-03 only: whether the shift's accumulated summary has been confirmed. */
  readonly shiftSummaryConfirmed?: boolean;
}

export interface CompletionRule {
  readonly ruleId: string;
  readonly satisfied: boolean;
  readonly requirement: string;
  /** What to do about it. Mandatory when not satisfied: a refusal needs a path (sheet 56). */
  readonly instead?: string;
}

/* ----------------------------------------------------------------------- summary */

export interface SummarySection {
  readonly title: string;
  readonly kind: 'UNITS' | 'INTERVALS' | 'PEOPLE' | 'RESOURCES' | 'MEASUREMENTS' | 'MOVEMENTS' | 'EVENTS';
  /** Why this section matters for this pattern. Shown as the section's subtitle. */
  readonly note: string;
}

export interface SummaryModel {
  readonly unitLabel: string;
  readonly unitLabelPlural: string;
  /** How this pattern describes its container, e.g. "work package", "turno". */
  readonly containerLabel: string;
  readonly sections: readonly SummarySection[];
}

/* ---------------------------------------------------------------------- the port */

export interface TypePartBehavior {
  readonly id: TypePartId;
  readonly name: string;
  /** One sentence a person could read in the UI. */
  readonly describe: string;

  validateRouteContext(ctx: NormalizedContext): RouteDecision;
  evaluateIdentity(change: ContextChange, part: PartState): IdentityDecision;
  requiredComponents(ctx: ComponentContext): readonly ComponentRequirement[];
  captureContract(moment: CaptureMoment): CaptureContract | null;
  completionRequirements(scope: CompletionScope): readonly CompletionRule[];
  summaryProjection(): SummaryModel;
}
