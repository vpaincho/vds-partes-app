/**
 * Conflict resolution, sheet 58.
 *
 * Each describe block maps to one numbered step of the sheet's algorithm, plus a block per
 * antipattern AP-01..AP-06. These are the assertions that keep "a commercial rule cannot
 * unblock a safety gate" true in code rather than in prose.
 */
import { describe, expect, it } from 'vitest';
import { toInstant, type Instant } from '@vds/kernel';
import {
  antipatterns,
  areIncompatible,
  canOverride,
  compareSpecificity,
  effectiveAt,
  explainOverrideRefusal,
  precedenceLevels,
  resolutionSteps,
  resolve,
  rule,
  rules,
  type CandidateRule,
  type ScopeLevel,
} from '../src/index.ts';

const AT = toInstant('2026-10-05T10:20:00Z');

function candidate(overrides: Partial<CandidateRule> & Pick<CandidateRule, 'ruleId'>): CandidateRule {
  return {
    precedence: 'P5',
    scope: 'GLOBAL',
    effect: 'ALLOW',
    exactContextMatch: false,
    explicitlyConfigured: false,
    overrideableVia: null,
    validFrom: toInstant('2020-01-01T00:00:00Z'),
    validUntil: null,
    rulesetVersion: 'test-1',
    reason: `reason for ${overrides.ruleId}`,
    ...overrides,
  };
}

describe('the catalogue mirrors sheet 58', () => {
  it('has the nine precedence levels P0..P8', () => {
    expect(precedenceLevels.map((l) => l.precedence)).toEqual([
      'P0',
      'P1',
      'P2',
      'P3',
      'P4',
      'P5',
      'P6',
      'P7',
      'P8',
    ]);
  });

  it('has the eight resolution steps in order', () => {
    expect(resolutionSteps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(resolutionSteps[0]!.name).toBe('PRECEDENCIA');
    expect(resolutionSteps[5]!.name).toContain('DENY VS ALLOW');
    expect(resolutionSteps[7]!.name).toBe('TRACE');
  });

  it('records that P0 cannot be overridden by a lower rule', () => {
    expect(precedenceLevels[0]!.overrideable).toMatch(/NO mediante regla inferior/i);
  });

  it('places P8 outside the core: advisory rules decide nothing', () => {
    expect(precedenceLevels[8]!.status).toMatch(/FUERA DEL CORE/i);
    // And no shipped rule sits at P8.
    expect(rules.filter((r) => r.precedence === 'P8')).toHaveLength(0);
  });
});

describe('step 1 — precedence: the lowest P wins', () => {
  it('lets a P1 block beat a P6 allow (AP-01)', () => {
    const result = resolve({
      effectiveAt: AT,
      candidates: [
        candidate({ ruleId: 'RUL-022', precedence: 'P1', effect: 'BLOCK' }),
        candidate({ ruleId: 'RUL-059', precedence: 'P6', effect: 'ALLOW' }),
      ],
    });
    expect(result.outcome).toBe('RESOLVED');
    if (result.outcome !== 'RESOLVED') return;
    expect(result.winner.ruleId).toBe('RUL-022');
    const discarded = result.applied.find((a) => a.ruleId === 'RUL-059');
    expect(discarded?.outcome).toBe('DISCARDED_BY_PRECEDENCE');
    expect(discarded?.note).toContain('P6 yields to P1');
  });

  it('records the loser in the trace, as step 8 requires', () => {
    const result = resolve({
      effectiveAt: AT,
      candidates: [
        candidate({ ruleId: 'A', precedence: 'P2', effect: 'BLOCK' }),
        candidate({ ruleId: 'B', precedence: 'P7', effect: 'ALLOW' }),
      ],
    });
    // A decision that cannot name the rule it discarded cannot be explained later.
    expect(result.applied.map((a) => a.ruleId).sort()).toEqual(['A', 'B']);
    for (const entry of result.applied) expect(entry.note).toBeTruthy();
  });
});

describe('step 2 — temporal validity: the version effective at the fact (AP-02)', () => {
  const expired = candidate({
    ruleId: 'OLD',
    effect: 'ALLOW',
    validFrom: toInstant('2020-01-01T00:00:00Z'),
    validUntil: toInstant('2026-01-01T00:00:00Z'),
  });
  const current = candidate({
    ruleId: 'NEW',
    effect: 'BLOCK',
    validFrom: toInstant('2026-01-01T00:00:00Z'),
  });

  it('excludes a version that was not in force at the moment of the fact', () => {
    // Deciding about something that happened in 2025 must use the 2025 ruleset.
    const inThePast = toInstant('2025-06-01T00:00:00Z') as Instant;
    expect(effectiveAt([expired, current], inThePast).map((r) => r.ruleId)).toEqual(['OLD']);
    expect(effectiveAt([expired, current], AT).map((r) => r.ruleId)).toEqual(['NEW']);
  });

  it('explains in the trace that a rule was not applicable at that time', () => {
    const result = resolve({ effectiveAt: toInstant('2025-06-01T00:00:00Z'), candidates: [expired, current] });
    const note = result.applied.find((a) => a.ruleId === 'NEW');
    expect(note?.outcome).toBe('NOT_APPLICABLE');
    expect(note?.note).toMatch(/ruleset of its own time/);
  });

  it('returns NO_RULE rather than falling back to a current rule', () => {
    const result = resolve({ effectiveAt: toInstant('2019-01-01T00:00:00Z'), candidates: [expired, current] });
    expect(result.outcome).toBe('NO_RULE');
  });
});

describe('step 3 — scope specificity', () => {
  it('orders ITEM > CONTRACT_SERVICE > CLIENT > SERVICE > PART_TYPE > GLOBAL', () => {
    const order: ScopeLevel[] = ['ITEM', 'CONTRACT_SERVICE', 'CLIENT', 'SERVICE', 'PART_TYPE', 'GLOBAL'];
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(compareSpecificity(order[i]!, order[i + 1]!)).toBeLessThan(0);
    }
  });

  it('prefers a client-specific cut rule over the global default (GS-015)', () => {
    // "Cliente exige corte por ubicación": the specific rule wins at the same precedence.
    const result = resolve({
      effectiveAt: AT,
      candidates: [
        candidate({ ruleId: 'RUL-008', precedence: 'P4', effect: 'ALLOW', scope: 'GLOBAL' }),
        candidate({ ruleId: 'CUT-CLIENT', precedence: 'P4', effect: 'BLOCK', scope: 'CLIENT' }),
      ],
    });
    expect(result.outcome).toBe('RESOLVED');
    if (result.outcome !== 'RESOLVED') return;
    expect(result.winner.ruleId).toBe('CUT-CLIENT');
    expect(result.applied.find((a) => a.ruleId === 'RUL-008')?.note).toContain('less specific');
  });
});

describe('steps 4 and 5 — exact context, then explicit configuration', () => {
  it('prefers an exact state/trigger match over a broad default', () => {
    const result = resolve({
      effectiveAt: AT,
      candidates: [
        candidate({ ruleId: 'BROAD', effect: 'ALLOW', exactContextMatch: false }),
        candidate({ ruleId: 'EXACT', effect: 'BLOCK', exactContextMatch: true }),
      ],
    });
    expect(result.outcome).toBe('RESOLVED');
    if (result.outcome !== 'RESOLVED') return;
    expect(result.winner.ruleId).toBe('EXACT');
  });

  it('prefers validated configuration over a contract-agnostic default', () => {
    const result = resolve({
      effectiveAt: AT,
      candidates: [
        candidate({ ruleId: 'DEFAULT', effect: 'ALLOW', explicitlyConfigured: false }),
        candidate({ ruleId: 'CONFIGURED', effect: 'BLOCK', explicitlyConfigured: true }),
      ],
    });
    expect(result.outcome).toBe('RESOLVED');
    if (result.outcome !== 'RESOLVED') return;
    expect(result.winner.ruleId).toBe('CONFIGURED');
    expect(result.applied.find((a) => a.ruleId === 'DEFAULT')?.note).toContain(
      'contract-agnostic default loses',
    );
  });
});

describe('step 6 — equally specific and incompatible: fail closed and escalate', () => {
  it('refuses to pick a winner, and never by load order (GS-054)', () => {
    const result = resolve({
      effectiveAt: AT,
      candidates: [
        candidate({ ruleId: 'ALLOW-IT', effect: 'ALLOW', scope: 'CLIENT', exactContextMatch: true }),
        candidate({ ruleId: 'BLOCK-IT', effect: 'BLOCK', scope: 'CLIENT', exactContextMatch: true }),
      ],
    });
    expect(result.outcome).toBe('FAIL_CLOSED');
    if (result.outcome !== 'FAIL_CLOSED') return;
    expect(result.requiresEscalation).toBe(true);
    expect(result.tied.map((r) => r.ruleId).sort()).toEqual(['ALLOW-IT', 'BLOCK-IT']);
    expect(result.reason).toMatch(/no se resuelve por orden de carga/);
  });

  it('is order-independent: swapping the inputs gives the same verdict', () => {
    const a = candidate({ ruleId: 'A', effect: 'ALLOW', scope: 'ITEM', exactContextMatch: true });
    const b = candidate({ ruleId: 'B', effect: 'BLOCK', scope: 'ITEM', exactContextMatch: true });
    expect(resolve({ effectiveAt: AT, candidates: [a, b] }).outcome).toBe('FAIL_CLOSED');
    expect(resolve({ effectiveAt: AT, candidates: [b, a] }).outcome).toBe('FAIL_CLOSED');
  });

  it('does not treat WARN as contradicting ALLOW — obligations compose', () => {
    // A warning adds an obligation; it is not a contradiction. Only BLOCK vs a permit is.
    expect(areIncompatible('WARN', 'ALLOW')).toBe(false);
    expect(areIncompatible('REQUIRE_CONFIRMATION', 'DERIVE')).toBe(false);
    expect(areIncompatible('BLOCK', 'ALLOW')).toBe(true);
    expect(areIncompatible('BLOCK', 'DERIVE')).toBe(true);
    expect(areIncompatible('BLOCK', 'WARN')).toBe(false);

    const result = resolve({
      effectiveAt: AT,
      candidates: [
        candidate({ ruleId: 'W', effect: 'WARN', scope: 'ITEM', exactContextMatch: true }),
        candidate({ ruleId: 'A', effect: 'ALLOW', scope: 'ITEM', exactContextMatch: true }),
      ],
    });
    expect(result.outcome).toBe('RESOLVED');
  });
});

describe('step 7 — an override satisfies a declared exception, never defeats a rule', () => {
  it('accepts the gate the rule itself declares', () => {
    const overrideable = candidate({ ruleId: 'RUL-040', effect: 'WARN', overrideableVia: 'GATE-DOC-SOON' });
    expect(canOverride(overrideable, 'GATE-DOC-SOON')).toBe(true);
  });

  it('refuses a different gate', () => {
    const overrideable = candidate({ ruleId: 'RUL-040', effect: 'WARN', overrideableVia: 'GATE-DOC-SOON' });
    expect(canOverride(overrideable, 'GATE-SOMETHING-ELSE')).toBe(false);
    expect(explainOverrideRefusal(overrideable, 'GATE-SOMETHING-ELSE')).toContain('GATE-DOC-SOON');
  });

  it('refuses any override of a hard block (C-018)', () => {
    const hard = candidate({ ruleId: 'RUL-039', precedence: 'P1', effect: 'BLOCK', overrideableVia: null });
    expect(canOverride(hard, 'ANY-GATE')).toBe(false);
    expect(explainOverrideRefusal(hard, 'ANY-GATE')).toMatch(/hard block/);
    expect(explainOverrideRefusal(hard, 'ANY-GATE')).toMatch(/C-018/);
  });

  it('matches the catalogue: only RUL-040 is overrideable', () => {
    // Derived from the sheet's force column, not asserted by hand.
    expect(rules.filter((r) => r.overrideable).map((r) => r.ruleId)).toEqual(['RUL-040']);
    expect(rule('RUL-039').overrideable).toBe(false);
    expect(rule('RUL-039').blocking).toBe(true);
  });
});

describe('the six antipatterns of sheet 58 are represented and refused', () => {
  it('carries AP-01..AP-06 with their corrections', () => {
    expect(antipatterns.map((a) => a.id)).toEqual([
      'AP-01',
      'AP-02',
      'AP-03',
      'AP-04',
      'AP-05',
      'AP-06',
    ]);
    for (const ap of antipatterns) {
      expect(ap.verdict).toBe('PROHIBIDO');
      expect(ap.correction.length).toBeGreaterThan(0);
    }
  });

  it('AP-01 commercial overrides Habilita — refused by precedence', () => {
    expect(antipatterns[0]!.correction).toMatch(/P1 domina P6/);
    const result = resolve({
      effectiveAt: AT,
      candidates: [
        candidate({ ruleId: 'RUL-042', precedence: 'P1', effect: 'BLOCK', scope: 'CLIENT' }),
        // "El contrato paga, entonces dejá iniciar sin PTW" — even more specific, still loses.
        candidate({ ruleId: 'COMMERCIAL', precedence: 'P6', effect: 'ALLOW', scope: 'ITEM' }),
      ],
    });
    expect(result.outcome).toBe('RESOLVED');
    if (result.outcome !== 'RESOLVED') return;
    expect(result.winner.ruleId).toBe('RUL-042');
  });

  it('AP-02 current rules rewrite history — refused by temporal validity', () => {
    expect(antipatterns[1]!.correction).toMatch(/versión efectiva/);
  });

  it('AP-04 warning = permission — a WARN never becomes an ALLOW on its own', () => {
    expect(antipatterns[3]!.correction).toMatch(/OverrideGate/);
    const result = resolve({
      effectiveAt: AT,
      candidates: [candidate({ ruleId: 'RUL-040', effect: 'WARN', overrideableVia: 'GATE-X' })],
    });
    expect(result.outcome).toBe('RESOLVED');
    if (result.outcome !== 'RESOLVED') return;
    // The winner is still a WARN: resolution does not promote it.
    expect(result.winner.effect).toBe('WARN');
  });
});

describe('the catalogue itself', () => {
  it('holds all 74 rules with precedence and a decision', () => {
    expect(rules).toHaveLength(74);
    for (const r of rules) {
      expect(r.precedence).toMatch(/^P[0-7]$/);
      expect(r.decision.length).toBeGreaterThan(0);
      expect(r.sourceRow).toBeGreaterThan(0);
    }
  });

  it('keeps the P0 rules that protect history and lineage', () => {
    const p0 = rules.filter((r) => r.precedence === 'P0').map((r) => r.ruleId);
    expect(p0).toEqual(['RUL-065', 'RUL-073', 'RUL-074']);
  });

  it('marks RUL-002 and RUL-027 as configuration-dependent, not fixed', () => {
    // Their force column names both BLOCK and WARN: configuration decides which applies, so
    // code must not assume either branch.
    expect(rule('RUL-002').configDependent).toBe(true);
    expect(rule('RUL-027').configDependent).toBe(true);
    expect(rule('RUL-022').configDependent).toBe(false);
  });

  it('cites a rule with its sheet row, so a block is traceable', () => {
    expect(rule('RUL-022').sourceSheet).toBe('57_Matriz_Maestra_Reglas');
    const citation = rules.find((r) => r.ruleId === 'RUL-022')!;
    expect(citation.precedence).toBe('P1');
    expect(citation.force).toContain('HARD_BLOCK');
  });
});
