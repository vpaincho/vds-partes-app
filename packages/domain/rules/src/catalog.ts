/**
 * The rule catalogue: all 74 rules of sheet 57, plus the precedence model of sheet 58.
 *
 * Rules live as **data** rather than as scattered `if` statements. S0 §18 is explicit: "Las
 * reglas del producto deben dejar de vivir dispersas solamente en UI/ifs". The prototype's
 * entire rulebook was `checks(p)` — one 36-line function mixing safety, completeness,
 * contract and UX concerns, which is antipattern AP-05 and the reason no decision could be
 * explained after the fact.
 *
 * What stays in code is each rule's *evaluation*; what lives here is its identity,
 * precedence, scope, force, trigger and authority — the parts a trace must cite.
 */
import type { Precedence } from '@vds/kernel';
import catalogue from './generated/rules.json' with { type: 'json' };

export interface RuleDefinition {
  readonly ruleId: string;
  readonly domain: string;
  readonly precedence: Precedence;
  readonly ruleClass: string;
  readonly subject: string;
  readonly trigger: string;
  readonly stateContext: string;
  readonly condition: string;
  readonly decision: string;
  readonly targetState: string;
  readonly sideEffects: string;
  /** Verbatim force text from the sheet, e.g. "HARD_BLOCK", "BLOCK/WARN". */
  readonly force: string;
  /** True when any branch of `force` can block. Such a rule is never advisory. */
  readonly blocking: boolean;
  /** True when `force` names both BLOCK and WARN: configuration decides which applies. */
  readonly configDependent: boolean;
  /** True only for a plain WARN. A hard block never becomes an override (C-018). */
  readonly overrideable: boolean;
  readonly riskDependent: boolean;
  readonly commercialOnly: boolean;
  readonly operationalOnly: boolean;
  readonly configScope: string;
  readonly authority: string;
  readonly rationale: string;
  readonly owners: readonly string[];
  readonly goldenLinks: readonly string[];
  readonly requiredTestLayers: string;
  readonly sourceSheet: string;
  readonly sourceRow: number;
}

export interface PrecedenceLevel {
  readonly precedence: Precedence;
  readonly family: string;
  readonly protects: string;
  readonly examples: string;
  readonly overrideable: string;
  readonly ownedBy: string;
  readonly status: string;
  readonly sourceRow: number;
}

export interface ResolutionStep {
  readonly step: number;
  readonly name: string;
  readonly rule: string;
  readonly obligation: string;
  readonly sourceRow: number;
}

export interface Antipattern {
  readonly id: string;
  readonly name: string;
  readonly example: string;
  readonly verdict: string;
  readonly correction: string;
  readonly sourceRow: number;
}

export const rules: readonly RuleDefinition[] = catalogue.rules as readonly RuleDefinition[];
export const precedenceLevels: readonly PrecedenceLevel[] =
  catalogue.precedence.levels as readonly PrecedenceLevel[];
export const resolutionSteps: readonly ResolutionStep[] =
  catalogue.precedence.algorithm as readonly ResolutionStep[];
export const antipatterns: readonly Antipattern[] =
  catalogue.precedence.antipatterns as readonly Antipattern[];

const byId = new Map(rules.map((r) => [r.ruleId, r]));

export function rule(ruleId: string): RuleDefinition {
  const found = byId.get(ruleId);
  if (!found) throw new Error(`Unknown rule "${ruleId}". The catalogue holds RUL-001..RUL-074.`);
  return found;
}

export const hasRule = (ruleId: string): boolean => byId.has(ruleId);

export const rulesByPrecedence = (precedence: Precedence): readonly RuleDefinition[] =>
  rules.filter((r) => r.precedence === precedence);

/** Rules whose trigger matches, e.g. START_WORK. The engine narrows candidates with this. */
export const rulesByTrigger = (trigger: string): readonly RuleDefinition[] =>
  rules.filter((r) => r.trigger === trigger);

export const rulesBySubject = (subject: string): readonly RuleDefinition[] =>
  rules.filter((r) => r.subject.toLowerCase().includes(subject.toLowerCase()));

export const rulesOwnedBy = (module: string): readonly RuleDefinition[] =>
  rules.filter((r) => r.owners.some((o) => o.includes(module)));

/** Rules with no Golden Scenario linked. These still need direct positive/negative tests. */
export const rulesWithoutGoldenLinks = (): readonly RuleDefinition[] =>
  rules.filter((r) => r.goldenLinks.length === 0);

/** Human-readable provenance, for a trace entry or an error message. */
export function cite(ruleId: string): string {
  const r = rule(ruleId);
  return `${r.ruleId} (${r.precedence}, ${r.sourceSheet}:${r.sourceRow}) — ${r.decision}`;
}

/** Every distinct trigger in the catalogue, so a command can be matched to its rules. */
export const triggers: readonly string[] = [...new Set(rules.map((r) => r.trigger))].sort();
