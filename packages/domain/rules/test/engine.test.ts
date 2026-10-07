/**
 * The S0–S11 pipeline, sheet 63.
 *
 * The scenarios here are the ones the baseline calls out by name: a hard gate before Start
 * Work (RUL-022), a warning that is not permission (AP-04), a preview that authorises nothing
 * (RGT-17), and a P0 invariant failure suppressing side effects.
 */
import { describe, expect, it } from 'vitest';
import {
  authorises,
  counts,
  isOverrideable,
  primaryBlocker,
  toInstant,
  uuidv4,
  type Blocker,
  type Instant,
  type Uuid,
} from '@vds/kernel';
import {
  EVALUATION_STAGES,
  assertAuthorises,
  evaluate,
  type NormalizedContext,
  type StageEvaluator,
} from '../src/index.ts';

const ACTOR = uuidv4();
const SUBJECT_ID = uuidv4();
const AT: Instant = toInstant('2026-10-05T10:20:00Z');

function context(overrides: Partial<NormalizedContext> = {}): NormalizedContext {
  return {
    subject: { kind: 'UnidadEjecucion', id: SUBJECT_ID },
    trigger: 'START_WORK',
    currentState: 'PENDIENTE',
    actorId: ACTOR,
    capabilities: ['field.start'],
    scope: {},
    effectiveAt: AT,
    recordedAt: AT,
    connectivity: 'ONLINE',
    confirmations: {},
    payload: {},
    ...overrides,
  };
}

function stage(
  input: Pick<StageEvaluator, 'stage' | 'precedence' | 'owner'> & {
    outcome: Awaited<ReturnType<StageEvaluator['evaluate']>>;
  },
): StageEvaluator {
  return {
    stage: input.stage,
    precedence: input.precedence,
    owner: input.owner,
    evaluate: () => input.outcome,
  };
}

const hardBlock: Blocker = {
  ruleId: 'RUL-022',
  precedence: 'P1',
  reason: 'Existe hard block Habilita: el PTW requerido no está VIGENTE al instante real.',
  overrideable: false,
  sourceRef: '57_Matriz_Maestra_Reglas:26',
};

const run = (evaluators: readonly StageEvaluator[], ctx = context(), preview = false) =>
  evaluate({
    context: ctx,
    evaluators,
    rulesetVersion: 'test-ruleset-1',
    decisionId: uuidv4(),
    contextHash: 'hash-1',
    preview,
  });

describe('stage order follows sheet 63', () => {
  it('evaluates S2..S9 in order, each bound to its precedence level', () => {
    expect(EVALUATION_STAGES.map((s) => `${s.stage}:${s.precedence}`)).toEqual([
      'S2_INVARIANTS:P0',
      'S3_HABILITA:P1',
      'S4_TRANSITION:P2',
      'S5_CONTROL_PLANE:P3',
      'S6_IDENTITY:P4',
      'S7_OPERATION:P5',
      'S8_CONTRACT:P6',
      'S9_UX:P7',
    ]);
  });

  it('runs evaluators in stage order regardless of registration order', async () => {
    const seen: string[] = [];
    const record = (name: string, s: StageEvaluator['stage'], p: StageEvaluator['precedence']) => ({
      stage: s,
      precedence: p,
      owner: name,
      evaluate: () => {
        seen.push(name);
        return {};
      },
    });
    await run([
      record('ux', 'S9_UX', 'P7'),
      record('invariants', 'S2_INVARIANTS', 'P0'),
      record('contract', 'S8_CONTRACT', 'P6'),
      record('habilita', 'S3_HABILITA', 'P1'),
    ]);
    expect(seen).toEqual(['invariants', 'habilita', 'contract', 'ux']);
  });

  it('refuses an evaluator registered at the wrong precedence for its stage', async () => {
    // A mismatch here would silently reorder authority, so it is a programming error.
    await expect(
      run([stage({ stage: 'S3_HABILITA', precedence: 'P6', owner: 'bad', outcome: {} })]),
    ).rejects.toThrow(/binds each\s+stage to one precedence level/);
  });

  it('evaluates later stages even after a block, so every reason surfaces at once', async () => {
    // The audit found the prototype revealed blockers one at a time at cierre, which turns
    // fixing a Parte into guesswork.
    const result = await run([
      stage({ stage: 'S3_HABILITA', precedence: 'P1', owner: 'habilita', outcome: { blocks: [hardBlock] } }),
      stage({
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution',
        outcome: { missing: [{ what: 'medición', reason: 'la métrica del servicio es obligatoria' }] },
      }),
    ]);
    expect(result.envelope.decision).toBe('BLOCK');
    expect(result.envelope.missing).toHaveLength(1);
    expect(result.stages.map((s) => s.owner)).toEqual(['habilita', 'execution']);
  });
});

describe('a hard gate before Start Work (RUL-022)', () => {
  it('blocks, names the rule, and cites the sheet row', async () => {
    const result = await run([
      stage({ stage: 'S3_HABILITA', precedence: 'P1', owner: 'habilita', outcome: { blocks: [hardBlock] } }),
    ]);
    expect(result.envelope.decision).toBe('BLOCK');
    expect(authorises(result.envelope)).toBe(false);
    expect(primaryBlocker(result.envelope)?.ruleId).toBe('RUL-022');
    expect(primaryBlocker(result.envelope)?.sourceRef).toContain('57_Matriz_Maestra_Reglas');
  });

  it('declares no target state and no effects when blocked', async () => {
    const result = await run([
      stage({ stage: 'S3_HABILITA', precedence: 'P1', owner: 'habilita', outcome: { blocks: [hardBlock] } }),
      stage({
        stage: 'S4_TRANSITION',
        precedence: 'P2',
        owner: 'execution',
        outcome: {
          targetState: 'EN_EJECUCION',
          effects: [{ kind: 'OPEN_TIME_EVENT', description: 'abrir intervalo' }],
        },
      }),
    ]);
    // Nothing transitions and nothing is declared, so no caller can perform effects by
    // reading the wrong field.
    expect(result.envelope.targetState).toBeUndefined();
    expect(result.envelope.effects).toHaveLength(0);
    expect(() => assertAuthorises(result.envelope)).toThrow(/is BLOCK/);
  });

  it('cannot be overridden: a hard block is not an override path (C-018)', async () => {
    const result = await run([
      stage({ stage: 'S3_HABILITA', precedence: 'P1', owner: 'habilita', outcome: { blocks: [hardBlock] } }),
    ]);
    expect(isOverrideable(result.envelope)).toBe(false);
  });

  it('allows the transition once the gate is satisfied', async () => {
    const result = await run([
      stage({ stage: 'S3_HABILITA', precedence: 'P1', owner: 'habilita', outcome: {} }),
      stage({
        stage: 'S4_TRANSITION',
        precedence: 'P2',
        owner: 'execution',
        outcome: {
          targetState: 'EN_EJECUCION',
          effects: [{ kind: 'OPEN_TIME_EVENT', description: 'abrir intervalo' }],
        },
      }),
    ]);
    expect(result.envelope.decision).toBe('ALLOW');
    expect(result.envelope.targetState).toBe('EN_EJECUCION');
    expect(() => assertAuthorises(result.envelope)).not.toThrow();
  });
});

describe('a warning is not permission (AP-04 / RUL-040)', () => {
  const warningNeedingGate = {
    ruleId: 'RUL-040',
    precedence: 'P1' as const,
    reason: 'El documento de Cristian Paz vence en 2 días.',
    requiresOverrideGate: 'GATE-DOC-SOON',
  };

  it('blocks while the required override gate is unsatisfied', async () => {
    const result = await run([
      stage({
        stage: 'S3_HABILITA',
        precedence: 'P1',
        owner: 'habilita',
        outcome: { warnings: [warningNeedingGate], targetState: 'EN_EJECUCION' },
      }),
    ]);
    // Showing a warning and continuing is exactly AP-04.
    expect(result.envelope.decision).toBe('BLOCK');
    expect(authorises(result.envelope)).toBe(false);
  });

  it('allows with WARN once an authorised override satisfies that gate', async () => {
    const result = await run(
      [
        stage({
          stage: 'S3_HABILITA',
          precedence: 'P1',
          owner: 'habilita',
          outcome: {
            warnings: [warningNeedingGate],
            targetState: 'EN_EJECUCION',
            effects: [{ kind: 'OPEN_TIME_EVENT', description: 'abrir intervalo' }],
          },
        }),
      ],
      context({
        override: {
          gateId: 'GATE-DOC-SOON',
          ruleId: 'RUL-040',
          authorisedBy: uuidv4(),
          reason: 'Supervisor autoriza: documento en trámite, copia verificada.',
          at: AT,
        },
      }),
    );
    expect(result.envelope.decision).toBe('WARN');
    expect(authorises(result.envelope)).toBe(true);
    // The override is part of the record, not an invisible bypass.
    expect(result.envelope.override?.gateId).toBe('GATE-DOC-SOON');
    expect(result.envelope.warnings).toHaveLength(1);
  });

  it('a plain warning with no gate does not block', async () => {
    const result = await run([
      stage({
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution',
        outcome: {
          warnings: [{ ruleId: 'RUL-027', precedence: 'P5', reason: 'Solapamiento con apoyo compartido.' }],
          targetState: 'EN_EJECUCION',
        },
      }),
    ]);
    expect(result.envelope.decision).toBe('WARN');
  });
});

describe('confirmations are neither blocks nor warnings', () => {
  it('asks for confirmation and refuses to authorise until supplied', async () => {
    const result = await run([
      stage({
        stage: 'S9_UX',
        precedence: 'P7',
        owner: 'field',
        outcome: {
          confirmationsRequired: [
            { field: 'ubicacion', reason: 'La ubicación derivada es ambigua.', candidate: 'ET-B3' },
          ],
          targetState: 'EN_EJECUCION',
        },
      }),
    ]);
    expect(result.envelope.decision).toBe('REQUIRE_CONFIRMATION');
    expect(() => assertAuthorises(result.envelope)).toThrow(/needs confirmation of: ubicacion/);
    // A derived candidate is offered, never applied unconfirmed (AP-03).
    expect(result.envelope.confirmationsRequired[0]!.candidate).toBe('ET-B3');
  });
});

describe('blocks, warnings and missing items are counted separately', () => {
  it('never collapses them into one number', async () => {
    // The prototype's cierre said "9 pendientes" by mixing blockers with notices.
    const result = await run([
      stage({ stage: 'S3_HABILITA', precedence: 'P1', owner: 'habilita', outcome: { blocks: [hardBlock] } }),
      stage({
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution',
        outcome: {
          warnings: [{ ruleId: 'RUL-027', precedence: 'P5', reason: 'Solapamiento.' }],
          missing: [
            { what: 'medición de cañería', reason: 'obligatoria para el ítem' },
            { what: 'firma del jefe', reason: 'requerida al cierre' },
          ],
        },
      }),
    ]);
    expect(counts(result.envelope)).toEqual({ blocks: 1, warnings: 1, missing: 2, confirmations: 0 });
  });
});

describe('a P0 invariant failure suppresses side effects (sheet 63 S2)', () => {
  it('flags invariantsFailed and declares nothing', async () => {
    const result = await run([
      stage({
        stage: 'S2_INVARIANTS',
        precedence: 'P0',
        owner: 'kernel',
        outcome: {
          blocks: [
            {
              ruleId: 'RUL-035',
              precedence: 'P0',
              reason: 'La UE está CERRADA: no se edita directamente.',
              instead: 'Crear una EnmiendaOperativa con old/new, motivo, evidencia y aprobador.',
              overrideable: false,
            },
          ],
        },
      }),
      stage({
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution',
        outcome: { effects: [{ kind: 'UPDATE_MEASUREMENT', description: 'corregir cantidad' }] },
      }),
    ]);
    expect(result.invariantsFailed).toBe(true);
    expect(result.envelope.effects).toHaveLength(0);
    // The actionable half is preserved: what to do instead.
    expect(result.envelope.blocks[0]!.instead).toMatch(/EnmiendaOperativa/);
  });
});

describe('a preview authorises nothing (RGT-17)', () => {
  it('marks the envelope as preview and refuses to authorise even on ALLOW', async () => {
    const result = await run(
      [
        stage({
          stage: 'S4_TRANSITION',
          precedence: 'P2',
          owner: 'execution',
          outcome: {
            targetState: 'EN_EJECUCION',
            effects: [{ kind: 'OPEN_TIME_EVENT', description: 'abrir intervalo' }],
          },
        }),
      ],
      context(),
      true,
    );
    expect(result.envelope.decision).toBe('ALLOW');
    expect(result.envelope.preview).toBe(true);
    expect(authorises(result.envelope)).toBe(false);
    expect(() => assertAuthorises(result.envelope)).toThrow(/preview and authorises nothing/);
  });
});

describe('derived values and NO_OP', () => {
  it('merges values derived by routing and UX stages', async () => {
    const result = await run([
      stage({
        stage: 'S6_IDENTITY',
        precedence: 'P4',
        owner: 'config/routing',
        outcome: { derived: { tipoParteId: 'TP-01' }, rulesApplied: [{ ruleId: 'RUL-001', precedence: 'P4', outcome: 'WON' }] },
      }),
      stage({
        stage: 'S9_UX',
        precedence: 'P7',
        owner: 'field',
        outcome: { derived: { ubicacionCandidata: 'ET-B3' } },
      }),
    ]);
    expect(result.derived).toEqual({ tipoParteId: 'TP-01', ubicacionCandidata: 'ET-B3' });
    expect(result.envelope.rulesApplied[0]!.ruleId).toBe('RUL-001');
  });

  it('reports NO_OP when there is nothing to do', async () => {
    const result = await run([stage({ stage: 'S7_OPERATION', precedence: 'P5', owner: 'execution', outcome: {} })]);
    expect(result.envelope.decision).toBe('NO_OP');
    expect(() => assertAuthorises(result.envelope)).toThrow(/nothing to perform/);
  });
});

describe('the envelope always carries what a trace needs', () => {
  it('records ruleset version, evaluation time and context hash', async () => {
    const result = await run([stage({ stage: 'S7_OPERATION', precedence: 'P5', owner: 'execution', outcome: {} })]);
    expect(result.envelope.rulesetVersion).toBe('test-ruleset-1');
    expect(result.envelope.evaluatedAt).toBe(AT);
    expect(result.envelope.contextHash).toBe('hash-1');
    expect(result.envelope.trigger).toBe('START_WORK');
    expect(result.envelope.subject.kind).toBe('UnidadEjecucion');
  });

  it('uses the fact timestamp as the evaluation time, not wall-clock now', async () => {
    // A command captured offline yesterday is evaluated against yesterday's moment.
    const yesterday = toInstant('2026-10-04T08:00:00Z');
    const result = await run([], context({ effectiveAt: yesterday }));
    expect(result.envelope.evaluatedAt).toBe(yesterday);
  });
});
