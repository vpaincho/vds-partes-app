/**
 * The three patterns must not be able to change each other's grain.
 *
 * This file exists because of a specific risk the plan names: three strategies are the right shape,
 * but only if they stay independent. The failure mode is quiet — someone relaxes TP-02's leg rule to
 * fix a transport bug and TP-03 starts opening a Parte per shift, or a shared default drifts and
 * suddenly a crew's eight hours are sixteen again.
 *
 * So the assertions here are mostly **cross-pattern**: the same context change is fed to all three
 * and each is required to answer in its own terms, with the rule id that authorises the answer.
 */
import { describe, expect, it } from 'vitest';
import {
  behaviorFor,
  routeContext,
  tp01,
  tp02,
  tp03,
  TYPE_PART_IDS,
  type ContextChange,
  type ContextChangeKind,
  type NormalizedContext,
  type PartState,
  type TypePartConfig,
  type TypePartId,
} from '../src/index.ts';

const ALL = [tp01, tp02, tp03];

const partState = (id: TypePartId, config: TypePartConfig = {}): PartState => ({
  partTypeId: id,
  state: 'EN_EJECUCION',
  openUnitCount: 1,
  closedUnitCount: 0,
  config,
});

const context = (over: Partial<NormalizedContext> = {}): NormalizedContext => ({
  plannedLocationCount: 1,
  hasOriginAndDestination: false,
  hasCrew: false,
  isEmergent: false,
  config: {},
  ...over,
});

describe('the shared identity table is the same in all three patterns', () => {
  // C-007, C-019 and B-03 state these once for the whole product. If a pattern answered differently
  // it would mean the product has three different definitions of what cuts a Parte.
  const sharedCases: readonly { kind: ContextChangeKind; outcome: string; ruleId: string }[] = [
    { kind: 'RESOURCE_CHANGED', outcome: 'KEEP_PART', ruleId: 'RUL-006' },
    { kind: 'PERSON_CHANGED', outcome: 'KEEP_PART', ruleId: 'RUL-025' },
    { kind: 'WORK_PERMIT_CHANGED', outcome: 'KEEP_PART', ruleId: 'RUL-042' },
    { kind: 'INDEPENDENT_SUBWORK_DETECTED', outcome: 'NEW_EXECUTION_UNIT', ruleId: 'RUL-007' },
  ];

  for (const testCase of sharedCases) {
    it(`${testCase.kind} → ${testCase.outcome} in every pattern`, () => {
      for (const behavior of ALL) {
        const decision = behavior.evaluateIdentity({ kind: testCase.kind }, partState(behavior.id));
        expect(decision.outcome, `${behavior.id} disagreed about ${testCase.kind}`).toBe(
          testCase.outcome,
        );
        expect(decision.ruleId).toBe(testCase.ruleId);
      }
    });
  }

  it('never cuts a Parte for an additional resource, a different PTW or a new person', () => {
    // The three things the baseline is explicit about: none of them is an identity driver.
    for (const behavior of ALL) {
      for (const kind of ['RESOURCE_CHANGED', 'PERSON_CHANGED', 'WORK_PERMIT_CHANGED'] as const) {
        expect(behavior.evaluateIdentity({ kind }, partState(behavior.id)).outcome).not.toBe('NEW_PART');
      }
    }
  });

  it('declares when an answer came from a default rather than from configuration', () => {
    // B-01…B-09: a conservative default is legitimate, pretending it was a decision is not. A later
    // configuration change must not look like the system changed its mind.
    const unconfigured = tp01.evaluateIdentity({ kind: 'SHIFT_CHANGED' }, partState('TP-01'));
    expect(unconfigured.fromDefault).toBe(true);

    const configured = tp01.evaluateIdentity(
      { kind: 'SHIFT_CHANGED' },
      partState('TP-01', { shiftCutsPart: false }),
    );
    expect(configured.outcome).toBe(unconfigured.outcome);
    expect(configured.fromDefault).toBe(false);
  });

  it('refuses to decide a client cut nobody configured', () => {
    // RGT-12: missing contractual configuration is not filled in. A cut invented here would be
    // carried into the allocation and then into the certification.
    for (const behavior of ALL) {
      const decision = behavior.evaluateIdentity({ kind: 'CLIENT_CHANGED' }, partState(behavior.id));
      expect(decision.outcome).toBe('KEEP_PART');
      expect(decision.pendingConfiguration).toMatch(/ReglaCorte/);
    }
  });
});

describe('each pattern keeps its own grain', () => {
  it('a shift change is a handover for TP-01 and a configured question for TP-03', () => {
    // The container differs: TP-01's container is the objective, TP-03's IS the shift. So the same
    // event is routine for one and a genuine boundary question for the other.
    const forIntervention = tp01.evaluateIdentity({ kind: 'SHIFT_CHANGED' }, partState('TP-01'));
    expect(forIntervention.outcome).toBe('HANDOVER');
    expect(forIntervention.pendingConfiguration).toBeUndefined();

    const forCrew = tp03.evaluateIdentity({ kind: 'SHIFT_CHANGED' }, partState('TP-03'));
    expect(forCrew.outcome).toBe('HANDOVER');
    // TP-03 says out loud that the boundary is configuration, because the shift is its container.
    expect(forCrew.pendingConfiguration).toMatch(/ReglaCorte por turno/);
  });

  it('a new work package opens a Parte for TP-01 and a UE for TP-03', () => {
    const intervention = tp01.evaluateIdentity(
      { kind: 'WORK_PACKAGE_CHANGED', independentObjective: true },
      partState('TP-01'),
    );
    expect(intervention.outcome).toBe('NEW_PART');
    expect(intervention.ruleId).toBe('RUL-004');

    // A crew taking another job during the shift is the normal case, not a new Parte.
    const crew = tp03.evaluateIdentity(
      { kind: 'WORK_PACKAGE_CHANGED', independentObjective: true },
      partState('TP-03'),
    );
    expect(crew.outcome).toBe('NEW_EXECUTION_UNIT');
    expect(crew.ruleId).toBe('RUL-007');
  });

  it('a completed leg with another to follow is a new UE for TP-02 only', () => {
    const transport = tp02.evaluateIdentity(
      { kind: 'TRANSPORT_LEG_COMPLETED', hasNextLeg: true },
      partState('TP-02'),
    );
    expect(transport.outcome).toBe('NEW_EXECUTION_UNIT');

    // For the other two a leg is a transition inside the same work: the time is attributed, not a
    // new unit of work (C-013).
    for (const behavior of [tp01, tp03]) {
      const decision = behavior.evaluateIdentity(
        { kind: 'TRANSPORT_LEG_COMPLETED', hasNextLeg: true },
        partState(behavior.id),
      );
      expect(decision.outcome, `${behavior.id}`).toBe('KEEP_PART');
      expect(decision.effects).toContain('TransicionOperativa');
    }
  });

  it('six runs in one shift are six UE of one assignment, not six Partes', () => {
    // The concrete shape of "un viaje no es un Parte". Five completed legs with another to follow
    // produce five new UE and never a new Parte.
    const outcomes: string[] = [];
    for (let leg = 0; leg < 5; leg += 1) {
      outcomes.push(
        tp02.evaluateIdentity(
          { kind: 'TRANSPORT_LEG_COMPLETED', hasNextLeg: true },
          partState('TP-02', { transportContinuity: 'SAME_PART' }),
        ).outcome,
      );
    }
    expect(outcomes).toEqual(Array(5).fill('NEW_EXECUTION_UNIT'));

    // And the last one, with nothing following, creates nothing at all.
    const last = tp02.evaluateIdentity(
      { kind: 'TRANSPORT_LEG_COMPLETED', hasNextLeg: false },
      partState('TP-02', { transportContinuity: 'SAME_PART' }),
    );
    expect(last.outcome).toBe('KEEP_PART');
  });

  it('transport continuity configured as NEW_PART changes TP-02 and nothing else', () => {
    // This is the independence assertion that matters most: a configuration meant for one pattern
    // must not leak into the others' grain.
    const config: TypePartConfig = { transportContinuity: 'NEW_PART' };
    const change: ContextChange = { kind: 'TRANSPORT_LEG_COMPLETED', hasNextLeg: true };

    expect(tp02.evaluateIdentity(change, partState('TP-02', config)).outcome).toBe('NEW_PART');
    expect(tp01.evaluateIdentity(change, partState('TP-01', config)).outcome).toBe('KEEP_PART');
    expect(tp03.evaluateIdentity(change, partState('TP-03', config)).outcome).toBe('KEEP_PART');
  });

  it('a shift cut configured for TP-03 does not cut TP-02 by itself', () => {
    const config: TypePartConfig = { shiftCutsPart: true };
    expect(tp03.evaluateIdentity({ kind: 'SHIFT_CHANGED' }, partState('TP-03', config)).outcome).toBe(
      'NEW_PART',
    );
    // TP-02 reads the same flag — it is the same rule RUL-005 — but its answer is its own, and with
    // the flag unset it stays a handover rather than inheriting TP-03's boundary.
    expect(tp02.evaluateIdentity({ kind: 'SHIFT_CHANGED' }, partState('TP-02')).outcome).toBe(
      'HANDOVER',
    );
  });

  it('location never cuts by itself in any pattern unless configured', () => {
    // RUL-008 / C-019. TP-02 is the pattern where location is closest to being a driver, and even
    // there the driver is the leg.
    for (const behavior of ALL) {
      expect(
        behavior.evaluateIdentity({ kind: 'LOCATION_CHANGED' }, partState(behavior.id)).outcome,
      ).toBe('KEEP_PART');
    }
    expect(
      tp01.evaluateIdentity({ kind: 'LOCATION_CHANGED' }, partState('TP-01', { locationCutsPart: true }))
        .outcome,
    ).toBe('NEW_PART');
  });
});

describe('routing asks instead of guessing', () => {
  it('resolves to the planned pattern when the assignment declares one', () => {
    for (const id of TYPE_PART_IDS) {
      const result = routeContext(context({ partTypeHint: id, serviceCode: 'SV-1', hasCrew: true }));
      expect(result.resolved, `hint ${id}`).toBe(id);
    }
  });

  it('routes a trip to TP-02 and rejects the other two', () => {
    const result = routeContext(
      context({ hasOriginAndDestination: true, principalResourceType: 'CAMION' }),
    );
    expect(result.resolved).toBe('TP-02');
    expect(result.rejected.map((r) => r.id).sort()).toEqual(['TP-01', 'TP-03']);
  });

  it('does not resolve a transport vehicle without a declared trip', () => {
    // The same truck also does interventions, so the vehicle is a hint and not a proof. RUL-002:
    // record the candidates and ask.
    const result = routeContext(context({ principalResourceType: 'CAMION', serviceCode: 'SV-9' }));
    expect(result.resolved).toBeNull();
    expect(result.ambiguous.map((a) => a.id)).toContain('TP-02');
    expect(result.missing).toEqual(expect.arrayContaining(['origen', 'destino']));
  });

  it('reports the missing shift boundary instead of cutting by midnight (RGT-10)', () => {
    const result = routeContext(context({ hasCrew: true }));
    const crew = result.ambiguous.find((a) => a.id === 'TP-03');
    expect(crew, 'TP-03 should be ambiguous without a configured boundary').toBeDefined();
    expect(result.missing).toContain('shiftBoundary');
    if (crew?.decision.kind === 'AMBIGUOUS') {
      expect(crew.decision.reason).toMatch(/No se corta por medianoche/);
    }
  });

  it('resolves TP-03 once the boundary is configured', () => {
    const result = routeContext(context({ hasCrew: true, config: { shiftBoundary: '06:00' } }));
    expect(result.resolved).toBe('TP-03');
  });

  it('leaves emergent work without a service ambiguous rather than inventing one', () => {
    // AP-06: no inventing CC or Item to make routing look resolved. RUL-036 lets the work start with
    // context pending; it does not let the context be fabricated.
    const result = routeContext(context({ isEmergent: true }));
    expect(result.resolved).toBeNull();
    expect(result.missing).toContain('serviceCode');
  });

  it('never resolves by taking the first applicable candidate', () => {
    // AP-03 in its routing form. Two applicable patterns is a real outcome and must stay unresolved.
    const result = routeContext(
      context({ serviceCode: 'SV-1', hasCrew: true, config: { shiftBoundary: '06:00' } }),
    );
    expect(result.applicable.length).toBeGreaterThan(1);
    expect(result.resolved).toBeNull();
  });
});

describe('capture contracts come from sheet 68 and differ by pattern', () => {
  it('each pattern names its own contract ids', () => {
    expect(tp01.captureContract('UNIT_START')?.contractId).toBe('CF-01');
    expect(tp02.captureContract('UNIT_START')?.contractId).toBe('CF-05');
    expect(tp03.captureContract('PART_CLOSE')?.contractId).toBe('CF-08');
  });

  it('asks the human for different things at the same moment', () => {
    const intervention = tp01.captureContract('UNIT_START')!.humanProvides.join(' ');
    const transport = tp02.captureContract('UNIT_START')!.humanProvides.join(' ');
    expect(intervention).toMatch(/ubicación/i);
    expect(transport).toMatch(/origen, destino y carga/i);
    expect(intervention).not.toBe(transport);
  });

  it('asks a crew only for exceptions during the shift (CF-07)', () => {
    const during = tp03.captureContract('DURING')!;
    expect(during.humanProvides).toHaveLength(1);
    expect(during.humanProvides[0]).toMatch(/excepciones/i);
    // The roster is derived, never re-entered: CAP-061 says not to rebuild the list by hand.
    expect(during.systemKnows.join(' ')).toMatch(/Roster real/);
  });

  it('returns null for a moment a pattern does not define, instead of an empty contract', () => {
    expect(tp01.captureContract('PART_PREPARE')).toBeNull();
  });
});

describe('completion means different things per pattern', () => {
  const clean = {
    openUnits: 0,
    openIntervals: 0,
    unitsWithoutResult: 0,
    missingMeasurements: [],
    pendingEvidence: 0,
  };

  it('shares the four base requirements', () => {
    for (const behavior of ALL) {
      const rules = behavior.completionRequirements(clean);
      const ids = rules.map((r) => r.ruleId);
      expect(ids).toContain('RUL-034');
      expect(ids).toContain('RUL-033');
      expect(ids).toContain('RUL-032');
    }
  });

  it('adds an unresolved-leg requirement for TP-02 only', () => {
    const transport = tp02.completionRequirements({ ...clean, unresolvedLegs: 2 });
    const leg = transport.find((r) => r.requirement.includes('movimientos iniciados'));
    expect(leg?.satisfied).toBe(false);
    expect(leg?.instead).toMatch(/carga sin destino declarado/);

    expect(
      tp01.completionRequirements({ ...clean, unresolvedLegs: 2 }).some((r) => !r.satisfied),
    ).toBe(false);
  });

  it('adds the confirmed shift summary for TP-03 only (CF-08)', () => {
    const crew = tp03.completionRequirements({ ...clean, shiftSummaryConfirmed: false });
    const summary = crew.find((r) => r.requirement.includes('resumen acumulado'));
    expect(summary?.satisfied).toBe(false);

    expect(tp01.completionRequirements(clean).every((r) => r.satisfied)).toBe(true);
  });

  it('never leaves an unsatisfied requirement without a path', () => {
    // Sheet 56: a refusal an operator cannot act on is a dead end.
    const dirty = {
      openUnits: 1,
      openIntervals: 2,
      unitsWithoutResult: 1,
      missingMeasurements: ['VOLUMEN'],
      pendingEvidence: 1,
      unresolvedLegs: 1,
      shiftSummaryConfirmed: false,
    };
    for (const behavior of ALL) {
      for (const rule of behavior.completionRequirements(dirty)) {
        if (!rule.satisfied) {
          expect(rule.instead, `${behavior.id} ${rule.ruleId}`).toBeTruthy();
        }
      }
    }
  });

  it('does not demand measurements a pattern has no reason to ask for', () => {
    // "No exigir campos que no aplican al tipo". With no measurable service configured, nothing
    // measurement-shaped is required.
    for (const behavior of ALL) {
      const components = behavior.requiredComponents({
        configured: [],
        hasMeasurableService: false,
        config: {},
      });
      expect(components.filter((c) => c.required).map((c) => c.code)).not.toContain('MEDICION_SERVICIO');
    }
  });
});

describe('components reflect the pattern, and configuration wins', () => {
  it('requires origin and destination for TP-02 and nothing equivalent elsewhere', () => {
    const transport = tp02
      .requiredComponents({ configured: [], hasMeasurableService: false, config: {} })
      .filter((c) => c.required)
      .map((c) => c.code);
    expect(transport).toContain('ROL_ORIGEN');
    expect(transport).toContain('ROL_DESTINO');

    for (const behavior of [tp01, tp03]) {
      const codes = behavior
        .requiredComponents({ configured: [], hasMeasurableService: false, config: {} })
        .map((c) => c.code);
      expect(codes).not.toContain('ROL_ORIGEN');
    }
  });

  it('treats a cargo branch as a component of TP-02, not a fourth pattern', () => {
    const cargo = tp02
      .requiredComponents({ configured: [], hasMeasurableService: true, config: {} })
      .find((c) => c.code === 'CARGA');
    expect(cargo?.reason).toMatch(/no un TipoParte aparte/);
  });

  it('derives the crew roster rather than asking for it (CAP-061)', () => {
    const roster = tp03
      .requiredComponents({ configured: [], hasMeasurableService: false, config: {} })
      .find((c) => c.code === 'ROSTER_REAL');
    expect(roster?.required).toBe(true);
    expect(roster?.reason).toMatch(/autoderiva/);
  });

  it('carries configured components through with their required flag', () => {
    const components = tp01.requiredComponents({
      configured: [
        { code: 'FOTO_ANTES', required: true },
        { code: 'OBSERVACION', required: false },
      ],
      hasMeasurableService: false,
      config: {},
    });
    expect(components.find((c) => c.code === 'FOTO_ANTES')?.required).toBe(true);
    expect(components.find((c) => c.code === 'OBSERVACION')?.required).toBe(false);
  });
});

describe('summaries name the grain in the pattern\'s own words', () => {
  it('uses a different unit label per pattern', () => {
    expect(tp01.summaryProjection().unitLabel).toBe('resultado');
    expect(tp02.summaryProjection().unitLabel).toBe('movimiento');
    expect(tp03.summaryProjection().unitLabel).toBe('trabajo');
  });

  it('gives TP-02 a movements section and TP-03 an hours section that counts overlap once', () => {
    expect(tp02.summaryProjection().sections.map((s) => s.kind)).toContain('MOVEMENTS');
    const hours = tp03.summaryProjection().sections.find((s) => s.kind === 'INTERVALS');
    expect(hours?.note).toMatch(/ocho, no dieciséis/);
  });

  it('states in TP-03 that an hourly row is not a UE', () => {
    // The sentence is load-bearing: it is the defect this pattern exists to prevent.
    const units = tp03.summaryProjection().sections.find((s) => s.kind === 'UNITS');
    expect(units?.note).toMatch(/fila horaria no es una UE/);
  });
});

describe('behaviorFor', () => {
  it('returns each pattern by id', () => {
    for (const id of TYPE_PART_IDS) {
      expect(behaviorFor(id).id).toBe(id);
    }
  });

  it('throws on an unknown pattern instead of falling back to one', () => {
    // A fallback would decide the grain of a Parte without anyone configuring it, and a fourth
    // TipoParte has to pass Change Control before it exists (GS-056).
    expect(() => behaviorFor('TP-04')).toThrow(/Change Control/);
  });
});
