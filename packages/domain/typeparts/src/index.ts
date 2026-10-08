/**
 * @vds/typeparts — the three TipoParte as strategies over one model.
 *
 * `behaviorFor` is the only way to reach a strategy, and it throws on an unknown id rather than
 * falling back to one. A fallback here would mean a Parte whose grain was decided by a default: the
 * TipoParte is derived by the ruleset (RUL-001) and a pattern nobody configured is a configuration
 * error, not a reason to pick TP-01.
 */
export * from './contract.ts';
export { tp01 } from './tp01.ts';
export { tp02 } from './tp02.ts';
export { tp03 } from './tp03.ts';

import type { NormalizedContext, RouteDecision, TypePartBehavior, TypePartId } from './contract.ts';
import { tp01 } from './tp01.ts';
import { tp02 } from './tp02.ts';
import { tp03 } from './tp03.ts';

const BEHAVIORS: Record<TypePartId, TypePartBehavior> = {
  'TP-01': tp01,
  'TP-02': tp02,
  'TP-03': tp03,
};

export const TYPE_PART_IDS: readonly TypePartId[] = ['TP-01', 'TP-02', 'TP-03'];

export function behaviorFor(id: string): TypePartBehavior {
  const found = BEHAVIORS[id as TypePartId];
  if (!found) {
    throw new Error(
      `No hay TypePartBehavior para "${id}". Los patrones son TP-01, TP-02 y TP-03; un cuarto ` +
        'TipoParte tiene que pasar por Change Control antes de existir (GS-056), y elegir uno por ' +
        'defecto decidiría el grano del Parte sin que nadie lo haya configurado.',
    );
  }
  return found;
}

export const isTypePartId = (value: string): value is TypePartId =>
  TYPE_PART_IDS.includes(value as TypePartId);

/**
 * Route a context across all three patterns.
 *
 * Returns the applicable ones rather than "the" one, because RUL-002 exists: more than one pattern
 * being compatible is a real outcome that asks for a minimum confirmation or an escalation, and
 * silently taking the first match is the antipattern AP-03 (applying a derived candidate without
 * confirming it).
 */
export interface RoutingResult {
  readonly applicable: readonly { readonly id: TypePartId; readonly decision: RouteDecision }[];
  readonly ambiguous: readonly { readonly id: TypePartId; readonly decision: RouteDecision }[];
  readonly rejected: readonly { readonly id: TypePartId; readonly decision: RouteDecision }[];
  /** Set only when exactly one pattern is applicable and none is ambiguous. */
  readonly resolved: TypePartId | null;
  /** Everything the ambiguous candidates said was missing, deduplicated. */
  readonly missing: readonly string[];
}

export function routeContext(ctx: NormalizedContext): RoutingResult {
  const evaluated = TYPE_PART_IDS.map((id) => ({ id, decision: BEHAVIORS[id].validateRouteContext(ctx) }));
  const applicable = evaluated.filter((e) => e.decision.kind === 'APPLICABLE');
  const ambiguous = evaluated.filter((e) => e.decision.kind === 'AMBIGUOUS');
  const rejected = evaluated.filter((e) => e.decision.kind === 'NOT_APPLICABLE');
  const missing = [
    ...new Set(
      ambiguous.flatMap((e) => (e.decision.kind === 'AMBIGUOUS' ? e.decision.missing : [])),
    ),
  ];

  // A hint from an approved assignment IS the derivation (RUL-001), not one candidate among
  // several. Another pattern being compatible in the abstract does not make the planned one
  // ambiguous — the plan already decided, and treating it as a tie would send the crew a
  // confirmation for a question their planner answered. RUL-002 is for the case where nothing
  // determines the pattern, which is the branch below.
  const declared = ctx.partTypeHint
    ? applicable.find((e) => e.id === ctx.partTypeHint)
    : undefined;

  return {
    applicable,
    ambiguous,
    rejected,
    resolved: declared
      ? declared.id
      : applicable.length === 1 && ambiguous.length === 0
        ? applicable[0]!.id
        : null,
    missing,
  };
}
