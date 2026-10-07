/**
 * The deterministic conflict resolver, from sheet 58.
 *
 * When two rules apply and disagree, the outcome must be reproducible and explainable —
 * never "whichever loaded first". Sheet 58 specifies eight steps in order, and this file is a
 * literal implementation of them:
 *
 *   1 PRECEDENCIA          lowest P wins. A P6 rule never enables what a P1 rule blocked.
 *   2 VIGENCIA TEMPORAL    use the version effective at the timestamp of the fact, not today's.
 *   3 ESPECIFICIDAD        Item / ContratoServicio / cliente  >  servicio / TipoParte  >  global.
 *   4 MATCH DE CONTEXTO    exact state/trigger/context  >  broad default.
 *   5 CONFIG EXPLÍCITA     configured and validated  >  contract-agnostic default.
 *   6 DENY VS ALLOW        equally specific and incompatible, no priority → FAIL CLOSED + escalate.
 *   7 OVERRIDE             an override satisfies an exception the same rule declared; it never
 *                          defeats a higher-precedence rule.
 *   8 TRACE                persist candidates, those discarded by precedence, the winner,
 *                          the outcome and the actor.
 *
 * It also refuses the six antipatterns of sheet 58 by construction; see `antipatterns.ts`.
 */
import {
  comparePrecedence,
  type AppliedRule,
  type Precedence,
} from '@vds/kernel';
import type { Instant } from '@vds/kernel';

/** How specific a rule's scope is. Lower index = more specific (sheet 58 step 3). */
export type ScopeLevel =
  | 'ITEM'
  | 'CONTRACT_SERVICE'
  | 'CLIENT'
  | 'SERVICE'
  | 'PART_TYPE'
  | 'GLOBAL';

export const SCOPE_SPECIFICITY: readonly ScopeLevel[] = [
  'ITEM',
  'CONTRACT_SERVICE',
  'CLIENT',
  'SERVICE',
  'PART_TYPE',
  'GLOBAL',
];

export const compareSpecificity = (a: ScopeLevel, b: ScopeLevel): number =>
  SCOPE_SPECIFICITY.indexOf(a) - SCOPE_SPECIFICITY.indexOf(b);

/** What a rule decides when it fires. */
export type RuleEffect = 'ALLOW' | 'BLOCK' | 'WARN' | 'REQUIRE_CONFIRMATION' | 'DERIVE' | 'NO_OP';

/**
 * A candidate rule: one `rule_versions` row resolved for this evaluation.
 *
 * `validFrom`/`validUntil` are the version's effective window — step 2 selects by the
 * timestamp of the **fact**, which is what makes AP-02 ("current rules rewrite history")
 * impossible: explaining yesterday's decision uses yesterday's ruleset.
 */
export interface CandidateRule {
  readonly ruleId: string;
  readonly precedence: Precedence;
  readonly scope: ScopeLevel;
  readonly effect: RuleEffect;
  /** True when the rule matched the exact state/trigger rather than acting as a default. */
  readonly exactContextMatch: boolean;
  /** True when this came from validated configuration, not a contract-agnostic fallback. */
  readonly explicitlyConfigured: boolean;
  /** Non-null only when the rule itself declares an overrideable exception (RUL-041). */
  readonly overrideableVia: string | null;
  readonly validFrom: Instant;
  readonly validUntil: Instant | null;
  readonly rulesetVersion: string;
  readonly reason: string;
  readonly sourceRef?: string;
  /** What to do instead, when the effect is BLOCK. */
  readonly instead?: string;
}

export interface ResolutionInput {
  readonly candidates: readonly CandidateRule[];
  /** Timestamp of the fact being decided about — NOT "now" (step 2). */
  readonly effectiveAt: Instant;
}

export type Resolution =
  | {
      readonly outcome: 'RESOLVED';
      readonly winner: CandidateRule;
      readonly applied: readonly AppliedRule[];
      /** Rules at the winner's level that also fired and are compatible with it. */
      readonly concurring: readonly CandidateRule[];
    }
  | {
      readonly outcome: 'FAIL_CLOSED';
      /** The incompatible, equally-specific rules. */
      readonly tied: readonly CandidateRule[];
      readonly applied: readonly AppliedRule[];
      readonly reason: string;
      /** Step 6 requires escalation, not a silent pick. */
      readonly requiresEscalation: true;
    }
  | {
      readonly outcome: 'NO_RULE';
      readonly applied: readonly AppliedRule[];
    };

const BLOCKING: readonly RuleEffect[] = ['BLOCK'];
const PERMITTING: readonly RuleEffect[] = ['ALLOW', 'DERIVE', 'NO_OP'];

/** Are two effects in genuine conflict, as opposed to merely different? */
export function areIncompatible(a: RuleEffect, b: RuleEffect): boolean {
  if (a === b) return false;
  const aBlocks = BLOCKING.includes(a);
  const bBlocks = BLOCKING.includes(b);
  const aPermits = PERMITTING.includes(a);
  const bPermits = PERMITTING.includes(b);
  // A block against a permit is the only true contradiction. WARN and
  // REQUIRE_CONFIRMATION compose with anything: they add obligations, they do not contradict.
  return (aBlocks && bPermits) || (bBlocks && aPermits);
}

/** Step 2: only versions effective at the timestamp of the fact. */
export function effectiveAt(
  candidates: readonly CandidateRule[],
  at: Instant,
): readonly CandidateRule[] {
  const moment = Date.parse(at);
  return candidates.filter((rule) => {
    if (moment < Date.parse(rule.validFrom)) return false;
    if (rule.validUntil !== null && moment >= Date.parse(rule.validUntil)) return false;
    return true;
  });
}

/**
 * Resolve the candidates into one decision, recording every discard with its reason.
 *
 * Returns FAIL_CLOSED rather than guessing when equally-specific rules contradict: sheet 58
 * step 6 is explicit — "BLOQUEAR Y ESCALAR", and "No resolver por orden de carga".
 */
export function resolve(input: ResolutionInput): Resolution {
  const applied: AppliedRule[] = [];

  const expired = input.candidates.filter((c) => !effectiveAt([c], input.effectiveAt).length);
  for (const rule of expired) {
    applied.push({
      ruleId: rule.ruleId,
      precedence: rule.precedence,
      outcome: 'NOT_APPLICABLE',
      note:
        `not effective at ${input.effectiveAt} (valid ${rule.validFrom} → ` +
        `${rule.validUntil ?? '∞'}); a past decision is explained with the ruleset of its own time`,
      rulesetVersion: rule.rulesetVersion,
    });
  }

  const live = effectiveAt(input.candidates, input.effectiveAt);
  if (live.length === 0) {
    return { outcome: 'NO_RULE', applied };
  }

  // Step 1: precedence. Everything above the winning level is discarded, and said so.
  const bestPrecedence = live.reduce<Precedence>(
    (best, rule) => (comparePrecedence(rule.precedence, best) < 0 ? rule.precedence : best),
    live[0]!.precedence,
  );
  const atPrecedence = live.filter((r) => r.precedence === bestPrecedence);
  for (const rule of live) {
    if (rule.precedence === bestPrecedence) continue;
    applied.push({
      ruleId: rule.ruleId,
      precedence: rule.precedence,
      outcome: 'DISCARDED_BY_PRECEDENCE',
      note:
        `${rule.precedence} yields to ${bestPrecedence} — ` +
        `${rule.effect} could not override a ${bestPrecedence} decision`,
      rulesetVersion: rule.rulesetVersion,
    });
  }

  // Steps 3-5: specificity, then exact context match, then explicit configuration.
  const ranked = [...atPrecedence].sort((a, b) => {
    const bySpecificity = compareSpecificity(a.scope, b.scope);
    if (bySpecificity !== 0) return bySpecificity;
    if (a.exactContextMatch !== b.exactContextMatch) return a.exactContextMatch ? -1 : 1;
    if (a.explicitlyConfigured !== b.explicitlyConfigured) return a.explicitlyConfigured ? -1 : 1;
    return 0;
  });

  const winner = ranked[0] as CandidateRule;

  // Rules that rank identically to the winner. If any of those contradicts it, there is no
  // documented priority between them and the engine must fail closed.
  const equallyRanked = ranked.filter(
    (r) =>
      r !== winner &&
      compareSpecificity(r.scope, winner.scope) === 0 &&
      r.exactContextMatch === winner.exactContextMatch &&
      r.explicitlyConfigured === winner.explicitlyConfigured,
  );

  const contradicting = equallyRanked.filter((r) => areIncompatible(r.effect, winner.effect));
  if (contradicting.length > 0) {
    const tied = [winner, ...contradicting];
    for (const rule of tied) {
      applied.push({
        ruleId: rule.ruleId,
        precedence: rule.precedence,
        outcome: 'WON',
        note: 'tied: equally specific and incompatible, so neither was applied',
        rulesetVersion: rule.rulesetVersion,
      });
    }
    return {
      outcome: 'FAIL_CLOSED',
      tied,
      applied,
      reason:
        `${tied.length} reglas igualmente específicas producen decisiones incompatibles ` +
        `(${tied.map((r) => `${r.ruleId}:${r.effect}`).join(', ')}) y no hay prioridad ` +
        'explícita entre ellas. Se bloquea y se escala; no se resuelve por orden de carga.',
      requiresEscalation: true,
    };
  }

  // Everything else at this precedence lost on a documented criterion.
  for (const rule of ranked.slice(1)) {
    const reason =
      compareSpecificity(rule.scope, winner.scope) !== 0
        ? `${rule.scope} is less specific than ${winner.scope}`
        : rule.exactContextMatch !== winner.exactContextMatch
          ? 'broad/default match loses to an exact state/trigger match'
          : rule.explicitlyConfigured !== winner.explicitlyConfigured
            ? 'contract-agnostic default loses to validated configuration'
            : `compatible with the winner (${rule.effect})`;
    applied.push({
      ruleId: rule.ruleId,
      precedence: rule.precedence,
      outcome: contradicting.length === 0 && reason.startsWith('compatible')
        ? 'WON'
        : 'DISCARDED_BY_SPECIFICITY',
      note: reason,
      rulesetVersion: rule.rulesetVersion,
    });
  }

  applied.unshift({
    ruleId: winner.ruleId,
    precedence: winner.precedence,
    outcome: 'WON',
    note: `${winner.scope}, ${winner.exactContextMatch ? 'exact context' : 'default context'}, ${
      winner.explicitlyConfigured ? 'explicitly configured' : 'contract-agnostic'
    }`,
    rulesetVersion: winner.rulesetVersion,
  });

  return {
    outcome: 'RESOLVED',
    winner,
    applied,
    concurring: ranked.slice(1).filter((r) => !areIncompatible(r.effect, winner.effect)),
  };
}

/**
 * Step 7. An override satisfies an exception the rule itself declared; it does not defeat the
 * rule, and it can never reach a rule that declared no exception.
 *
 * This is the guard against AP-04 ("warning = permission") and against C-018, which forbids a
 * hard block from becoming an implicit override.
 */
export function canOverride(rule: CandidateRule, gateId: string): boolean {
  return rule.overrideableVia !== null && rule.overrideableVia === gateId;
}

export function explainOverrideRefusal(rule: CandidateRule, gateId: string): string {
  if (rule.overrideableVia === null) {
    return (
      `${rule.ruleId} no declara excepción overrideable: es un hard block. ` +
      'Un bloqueo duro no se convierte en override por conveniencia (C-018).'
    );
  }
  return `${rule.ruleId} admite el gate ${rule.overrideableVia}, no ${gateId}.`;
}
