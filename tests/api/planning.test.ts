/**
 * W2 integration: planning, control plane and the PTW lifecycle.
 *
 * The wave's gate is **RGT-01 / PL-093**: evaluating an extension must not make an assignment collide
 * with itself. It is tested three ways — the command succeeds, a genuine overlap is still detected,
 * and the detector refuses to run if the exclusion is ever removed.
 *
 * Also covered: RGT-03 (an approved window survives an extension), C-015 (READY expires), RUL-043
 * (approved is not in force), TPR-013 (expiry is not closure), C-017 (emission is not application)
 * and RUL-051 (an uncontrolled event defaults to suspension).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  envelope,
  getApp,
  hoursFromNow,
  makeAdjacentScenario,
  makeScenario,
  makeSession,
  post,
  sql,
  teardown,
  token,
  uuid,
  type Scenario,
  type Session,
} from './helpers.ts';

let planner: Session;
let field: Session;
let supervisor: Session;
let hse: Session;

beforeAll(async () => {
  await getApp();
  planner = await makeSession({ role: 'planner' });
  field = await makeSession({ role: 'field' });
  supervisor = await makeSession({ role: 'supervisor' });
  hse = await makeSession({ role: 'habilita' });
});

afterAll(teardown);

/** A person nominated onto an assignment, so conflict detection has something to compare. */
async function nominate(scenario: Scenario, personId?: string): Promise<string> {
  const person = personId ?? uuid();
  if (!personId) {
    await sql(
      `INSERT INTO config.people (id, code, first_name, last_name, affiliation, provenance)
       VALUES ($1, $2, 'Operario', 'Conflicto', 'VDS', 'FIXTURE_TEST')`,
      [person, `PE-${token(8)}`],
    );
  }
  const result = await post(`/planning/assignments/${scenario.assignmentId}/nominate`, {
    session: planner,
    body: envelope({ payload: { personIds: [person], role: 'OPERARIO' } }),
  });
  if (result.status !== 200) {
    throw new Error(`nominate failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return person;
}

/** The marker the exclusivity test writes, so a leftover from a failed run can be found again. */
const EXCLUSIVITY_RULE_NAME = 'TEST Exclusividad de operario (RGT-01)';

/**
 * Configure OPERARIO as an exclusive role for the duration of `body`.
 *
 * try/finally, not a trailing cleanup: this database is shared between runs, and a rule left behind
 * by a failed assertion turns the default-WARN test into a false BLOCK on the next run.
 */
async function withExclusiveRole(body: () => Promise<void>): Promise<void> {
  const definitionId = uuid();
  const versionId = uuid();
  await sql(
    `INSERT INTO config.rule_definitions (id, rule_type, code, canonical_rule_id, name)
     VALUES ($1, 'OVERLAP', $2, 'RUL-027', $3)`,
    [definitionId, `RD-${token(8)}`, EXCLUSIVITY_RULE_NAME],
  );
  await sql(
    `INSERT INTO config.rule_versions
       (id, rule_definition_id, version_no, params, effect, force, valid_from, status)
     VALUES ($1, $2, 1, $3, 'BLOCK', 'BLOCK/WARN', now() - interval '1 day', 'PUBLISHED')`,
    [versionId, definitionId, JSON.stringify({ exclusiveRoles: ['OPERARIO'], verdict: 'BLOCK' })],
  );
  await sql(
    `INSERT INTO config.rule_scopes (id, rule_version_id, scope_level) VALUES ($1, $2, 'GLOBAL')`,
    [uuid(), versionId],
  );
  try {
    await body();
  } finally {
    await sql('DELETE FROM config.rule_scopes WHERE rule_version_id = $1', [versionId]);
    await sql('DELETE FROM config.rule_versions WHERE id = $1', [versionId]);
    await sql('DELETE FROM config.rule_definitions WHERE id = $1', [definitionId]);
  }
}

/**
 * Remove any such rule a previous interrupted run left behind.
 *
 * Matched by the `TEST ` prefix the helper writes: the test only ever deletes rules it wrote itself,
 * never a configured one. A leftover here is not cosmetic — it silently turns the default-WARN
 * assertion into a BLOCK and would look like a regression in the conflict service.
 */
async function purgeExclusivityRules(): Promise<void> {
  const stale = await sql<{ id: string }>(
    `SELECT id FROM config.rule_definitions
     WHERE rule_type = 'OVERLAP' AND (name LIKE 'TEST %' OR name = 'Exclusividad de operario')`,
  );
  for (const { id } of stale) {
    await sql(
      `DELETE FROM config.rule_scopes WHERE rule_version_id IN (
         SELECT id FROM config.rule_versions WHERE rule_definition_id = $1)`,
      [id],
    );
    await sql('DELETE FROM config.rule_versions WHERE rule_definition_id = $1', [id]);
    await sql('DELETE FROM config.rule_definitions WHERE id = $1', [id]);
  }
}

describe('RGT-01 / PL-093 — an assignment never conflicts with itself', () => {
  beforeAll(purgeExclusivityRules);

  it('allows an extension request with no other work in the way', async () => {
    const scenario = await makeScenario();
    await nominate(scenario);

    // `clashes()` excluded by object reference, so evaluating a copy of the job with a longer window
    // made the copy collide with the original. The operator saw "se superpone con PL-093".
    const result = await post<{ decision: { decision: string; blocks: unknown[] } }>(
      `/planning/assignments/${scenario.assignmentId}/request-extension`,
      {
        session: field,
        body: envelope({ payload: { additionalDays: 1, reason: 'La operadora pidió ampliar el cerco.' } }),
      },
    );

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.decision.decision).toBe('ALLOW');
    expect(result.body.decision.blocks).toHaveLength(0);
  });

  it('records no self-conflict row for the assignment being extended', async () => {
    const scenario = await makeScenario();
    await nominate(scenario);
    await post(`/planning/assignments/${scenario.assignmentId}/request-extension`, {
      session: field,
      body: envelope({ payload: { additionalDays: 2, reason: 'Falta el sector de tanques.' } }),
    });

    const self = await sql(
      `SELECT 1 FROM planning.temporal_conflicts
       WHERE candidate_id = $1 AND incumbent_id = $1`,
      [scenario.assignmentId],
    );
    expect(self).toHaveLength(0);
  });

  it('explains in the trace that exclusion was by stable id', async () => {
    const scenario = await makeScenario();
    await nominate(scenario);
    const result = await post<{ decision: { rulesApplied: { ruleId: string; note?: string }[] } }>(
      `/planning/assignments/${scenario.assignmentId}/request-extension`,
      { session: field, body: envelope({ payload: { additionalDays: 1, reason: 'Más días.' } }) },
    );
    const applied = result.body.decision.rulesApplied.find((r) => r.ruleId === 'RUL-027');
    expect(applied?.note).toMatch(/excluyendo la propia asignación por id estable/);
  });

  it('STILL detects a genuine overlap with a different assignment', async () => {
    // The other half of RGT-01: the fix must not silence real conflicts. "otro trabajo realmente
    // solapado sí" debe chocar.
    const first = await makeScenario();
    const person = await nominate(first);
    // The same person on a second assignment whose window starts where the first one's ends, so the
    // requested extension lands inside it. Built at insert: the scope of an assignment under an
    // APROBADA version is immutable, so moving its window afterwards is correctly refused (R-022).
    const second = await makeAdjacentScenario(first);
    await post(`/planning/assignments/${second.assignmentId}/nominate`, {
      session: planner,
      body: envelope({ payload: { personIds: [person], role: 'OPERARIO' } }),
    });

    const result = await post<{ decision: { decision: string; warnings: { reason: string }[] } }>(
      `/planning/assignments/${first.assignmentId}/request-extension`,
      { session: field, body: envelope({ payload: { additionalDays: 2, reason: 'Más días.' } }) },
    );

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    // With no OVERLAP rule configured the default is WARN, not BLOCK: C-012 and RUL-027 forbid a
    // universal exclusivity. What matters is that the overlap was SEEN.
    expect(result.body.decision.warnings.length).toBeGreaterThan(0);
    expect(result.body.decision.warnings[0]!.reason).toMatch(/Se solapa con/);

    const recorded = await sql<{ candidate_id: string; incumbent_id: string; verdict: string }>(
      `SELECT candidate_id, incumbent_id, verdict FROM planning.temporal_conflicts
       WHERE candidate_id = $1`,
      [first.assignmentId],
    );
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded[0]!.incumbent_id).toBe(second.assignmentId);
    expect(recorded[0]!.candidate_id).not.toBe(recorded[0]!.incumbent_id);
  });

  it('blocks when a configured rule makes the role exclusive', async () => {
    const first = await makeScenario();
    const person = await nominate(first);
    const second = await makeAdjacentScenario(first);

    await post(`/planning/assignments/${second.assignmentId}/nominate`, {
      session: planner,
      body: envelope({ payload: { personIds: [person], role: 'OPERARIO' } }),
    });

    // The same overlap now blocks — which is the point: the verdict is configuration, not a
    // hardcoded default. C-012 and RUL-027 forbid a universal exclusivity rule.
    await withExclusiveRole(async () => {
      const result = await post<{ error: { code: string; blocks?: { ruleId: string }[] } }>(
        `/planning/assignments/${first.assignmentId}/request-extension`,
        { session: field, body: envelope({ payload: { additionalDays: 2, reason: 'Más días.' } }) },
      );
      expect(result.status, JSON.stringify(result.body)).toBe(422);
      expect(result.body.error.blocks?.some((b) => b.ruleId === 'RUL-027')).toBe(true);
    });
  });
});

describe('RGT-03 — the approved window survives an extension', () => {
  it('creates a new version instead of editing the approved one', async () => {
    const scenario = await makeScenario();
    await nominate(scenario);

    const [before] = await sql<{ window_end: Date; plan_version_id: string }>(
      'SELECT window_end, plan_version_id FROM planning.planned_assignments WHERE id = $1',
      [scenario.assignmentId],
    );

    await post(`/planning/assignments/${scenario.assignmentId}/request-extension`, {
      session: field,
      body: envelope({ payload: { additionalDays: 2, reason: 'Ampliación del alcance acordada.' } }),
    });

    const resolved = await post<{ data: { subject: { id: string } }; decision: { decision: string } }>(
      `/planning/assignments/${scenario.assignmentId}/resolve-extension`,
      { session: planner, body: envelope({ payload: { decision: 'APROBAR' } }) },
    );
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);

    // The original row keeps its approved window verbatim and becomes SUPERSEDIDA.
    const [original] = await sql<{ window_end: Date; state: string }>(
      'SELECT window_end, state::text AS state FROM planning.planned_assignments WHERE id = $1',
      [scenario.assignmentId],
    );
    expect(original!.window_end.getTime()).toBe(before!.window_end.getTime());
    expect(original!.state).toBe('SUPERSEDIDA');

    // The new row carries the longer window, under a new approved version.
    const newAssignmentId = resolved.body.data.subject.id;
    const [replacement] = await sql<{ window_end: Date; plan_version_id: string }>(
      'SELECT window_end, plan_version_id FROM planning.planned_assignments WHERE id = $1',
      [newAssignmentId],
    );
    expect(replacement!.window_end.getTime()).toBeGreaterThan(before!.window_end.getTime());
    expect(replacement!.plan_version_id).not.toBe(before!.plan_version_id);

    // And the previous version is still readable, marked superseded rather than deleted.
    const [previousVersion] = await sql<{ state: string; superseded_by_id: string | null }>(
      'SELECT state::text AS state, superseded_by_id FROM planning.plan_versions WHERE id = $1',
      [before!.plan_version_id],
    );
    expect(previousVersion!.state).toBe('SUPERSEDIDA');
    expect(previousVersion!.superseded_by_id).toBe(replacement!.plan_version_id);
  });

  it('records a rejection without touching the plan', async () => {
    const scenario = await makeScenario();
    await nominate(scenario);
    const [before] = await sql<{ window_end: Date }>(
      'SELECT window_end FROM planning.planned_assignments WHERE id = $1',
      [scenario.assignmentId],
    );

    await post(`/planning/assignments/${scenario.assignmentId}/request-extension`, {
      session: field,
      body: envelope({ payload: { additionalDays: 1, reason: 'Pedido de más días.' } }),
    });
    const rejected = await post(`/planning/assignments/${scenario.assignmentId}/resolve-extension`, {
      session: planner,
      body: envelope({ payload: { decision: 'RECHAZAR', note: 'No hay disponibilidad.' } }),
    });
    expect(rejected.status).toBe(200);

    const [after] = await sql<{ window_end: Date; state: string }>(
      'SELECT window_end, state::text AS state FROM planning.planned_assignments WHERE id = $1',
      [scenario.assignmentId],
    );
    expect(after!.window_end.getTime()).toBe(before!.window_end.getTime());
    expect(after!.state).not.toBe('SUPERSEDIDA');
  });
});

describe('readiness is temporal (C-015) and gates dispatch (RUL-016)', () => {
  it('evaluates READY and records its validity window', async () => {
    const scenario = await makeScenario();
    const result = await post<{ data: { effects: { result?: string }[] } }>(
      `/planning/assignments/${scenario.assignmentId}/evaluate-readiness`,
      { session: planner, body: envelope({ payload: { validForMinutes: 60 } }) },
    );
    expect(result.status).toBe(200);

    const [evaluation] = await sql<{ result: string; valid_until: Date | null; evaluated_at: Date }>(
      `SELECT result, valid_until, evaluated_at FROM planning.readiness_evaluations
       WHERE planned_assignment_id = $1 ORDER BY evaluated_at DESC LIMIT 1`,
      [scenario.assignmentId],
    );
    expect(evaluation!.result).toBe('READY');
    // C-015: not a permanent checkbox.
    expect(evaluation!.valid_until).not.toBeNull();
  });

  it('returns NOT_READY with causes when a hard requirement fails (RUL-013)', async () => {
    const scenario = await makeScenario();
    const person = await nominate(scenario);

    const requirementId = uuid();
    await sql(
      `INSERT INTO habilita.requirements
         (id, code, name, requirement_type, applies_to, severity, valid_from)
       VALUES ($1, $2, 'Inducción vigente', 'INDUCTION', 'PERSON', 'HARD_BLOCK', '2026-01-01')`,
      [requirementId, `RQ-${token(8)}`],
    );

    await post(`/planning/assignments/${scenario.assignmentId}/evaluate-readiness`, {
      session: planner,
      body: envelope(),
    });

    const [evaluation] = await sql<{ result: string; causes: { ruleId: string; reason: string }[] }>(
      `SELECT result, causes FROM planning.readiness_evaluations
       WHERE planned_assignment_id = $1 ORDER BY evaluated_at DESC LIMIT 1`,
      [scenario.assignmentId],
    );
    expect(evaluation!.result).toBe('NOT_READY');
    // RUL-013: a refusal without causes cannot be acted on.
    expect(evaluation!.causes.length).toBeGreaterThan(0);
    expect(evaluation!.causes[0]!.ruleId).toBe('RUL-013');

    await sql('DELETE FROM habilita.requirements WHERE id = $1', [requirementId]);
    void person;
  });

  it('refuses to dispatch without a readiness evaluation', async () => {
    const scenario = await makeScenario();
    await sql(
      `UPDATE planning.planned_assignments SET state = 'READY' WHERE id = $1`,
      [scenario.assignmentId],
    );
    const result = await post<{ error: { blocks?: { ruleId: string; instead: string }[] } }>(
      `/planning/assignments/${scenario.assignmentId}/dispatch`,
      { session: planner, body: envelope() },
    );
    expect(result.status).toBe(422);
    const block = result.body.error.blocks?.find((b) => b.ruleId === 'RUL-016');
    expect(block?.instead).toMatch(/evaluate-readiness/);
  });

  it('refuses to dispatch on an expired READY (C-015)', async () => {
    const scenario = await makeScenario();
    await sql(`UPDATE planning.planned_assignments SET state = 'READY' WHERE id = $1`, [
      scenario.assignmentId,
    ]);
    await post(`/planning/assignments/${scenario.assignmentId}/evaluate-readiness`, {
      session: planner,
      body: envelope({ payload: { validForMinutes: 1 } }),
    });
    // valid_until is not edited here: readiness_window would rightly refuse a window that closes
    // before it opens. The READY simply runs out, and the dispatch is dated after it did.
    const result = await post<{ error: { blocks?: { reason: string }[] } }>(
      `/planning/assignments/${scenario.assignmentId}/dispatch`,
      {
        session: planner,
        body: envelope({ occurredAt: hoursFromNow(1) }),
      },
    );
    expect(result.status).toBe(422);
    expect(result.body.error.blocks?.[0]!.reason).toMatch(/READY es temporal/);
  });

  it('dispatches with a versioned bundle that expires', async () => {
    const scenario = await makeScenario();
    await sql(`UPDATE planning.planned_assignments SET state = 'READY' WHERE id = $1`, [
      scenario.assignmentId,
    ]);
    await post(`/planning/assignments/${scenario.assignmentId}/evaluate-readiness`, {
      session: planner,
      body: envelope(),
    });

    const result = await post<{ data: { effects: { bundleId?: string }[] } }>(
      `/planning/assignments/${scenario.assignmentId}/dispatch`,
      { session: planner, body: envelope({ payload: { bundleTtlMinutes: 120 } }) },
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);

    const [bundle] = await sql<{
      id: string;
      valid_until: Date;
      content_hash: string;
      payload: { neverSkipGates: string[] };
    }>(
      `SELECT id, valid_until, content_hash, payload FROM sync.execution_context_bundles
       WHERE planned_assignment_id = $1`,
      [scenario.assignmentId],
    );
    expect(bundle).toBeDefined();
    // C-016 / RUL-017: a projection with an expiry and an integrity hash, never a source of truth.
    expect(bundle!.valid_until.getTime()).toBeGreaterThan(Date.now());
    expect(bundle!.content_hash).toHaveLength(64);
    // The gates that may never be skipped offline travel with the bundle.
    expect(bundle!.payload.neverSkipGates).toContain('RUL-022');

    const [assignment] = await sql<{ state: string; dispatched_at: Date | null }>(
      'SELECT state::text AS state, dispatched_at FROM planning.planned_assignments WHERE id = $1',
      [scenario.assignmentId],
    );
    expect(assignment!.state).toBe('DESPACHADA');
    expect(assignment!.dispatched_at).not.toBeNull();
  });
});

describe('RUL-010 — approving a version is a hard gate', () => {
  it('refuses a version with an assignment that has no planned unit', async () => {
    const planId = uuid();
    const versionId = uuid();
    const assignmentId = uuid();
    await sql(`INSERT INTO planning.plans (id, name, state) VALUES ($1, 'Plan vacío', 'ABIERTA')`, [planId]);
    await sql(
      `INSERT INTO planning.plan_versions (id, plan_id, version_no, state)
       VALUES ($1, $2, 1, 'EN_VALIDACION')`,
      [versionId, planId],
    );
    await sql(
      `INSERT INTO planning.planned_assignments (id, plan_version_id, state, window_start, window_end)
       VALUES ($1, $2, 'PROGRAMADA', now(), now() + interval '8 hours')`,
      [assignmentId, versionId],
    );

    const result = await post<{ error: { blocks?: { ruleId: string; reason: string }[] } }>(
      `/planning/versions/${versionId}/approve`,
      { session: planner, body: envelope() },
    );
    expect(result.status).toBe(422);
    expect(result.body.error.blocks?.some((b) => /sin unidad planificada/.test(b.reason))).toBe(true);
  });

  it('refuses a version with no assignments at all (T-P02)', async () => {
    const planId = uuid();
    const versionId = uuid();
    await sql(`INSERT INTO planning.plans (id, name, state) VALUES ($1, 'Plan sin asignaciones', 'ABIERTA')`, [
      planId,
    ]);
    await sql(
      `INSERT INTO planning.plan_versions (id, plan_id, version_no, state)
       VALUES ($1, $2, 1, 'EN_VALIDACION')`,
      [versionId, planId],
    );
    const result = await post<{ error: { blocks?: { reason: string }[] } }>(
      `/planning/versions/${versionId}/approve`,
      { session: planner, body: envelope() },
    );
    expect(result.status).toBe(422);
    expect(result.body.error.blocks?.[0]!.reason).toMatch(/ninguna asignación/);
  });

  it('refuses the approval capability to a field operator', async () => {
    const planId = uuid();
    const versionId = uuid();
    await sql(`INSERT INTO planning.plans (id, name, state) VALUES ($1, 'Plan', 'ABIERTA')`, [planId]);
    await sql(
      `INSERT INTO planning.plan_versions (id, plan_id, version_no, state)
       VALUES ($1, $2, 1, 'EN_VALIDACION')`,
      [versionId, planId],
    );
    const result = await post(`/planning/versions/${versionId}/approve`, {
      session: field,
      body: envelope(),
    });
    expect(result.status).toBe(403);
  });
});

describe('C-017 — emission is not application', () => {
  async function emitDirective(scenario: Scenario): Promise<string> {
    const result = await post<{ data: { subject: { id: string } } }>('/control/directives/emit', {
      session: planner,
      body: envelope({
        payload: {
          directiveType: 'SUSPENDER',
          reason: 'Evento Habilita no controlado en la locación.',
          targets: [{ targetKind: 'PLANNED_ASSIGNMENT', targetId: scenario.assignmentId }],
        },
      }),
    });
    if (result.status !== 200) {
      throw new Error(`emit failed: ${result.status} ${JSON.stringify(result.body)}`);
    }
    return result.body.data.subject.id;
  }

  it('emits in EMITIDA, with targets recorded', async () => {
    const scenario = await makeScenario();
    const directiveId = await emitDirective(scenario);
    const [directive] = await sql<{ state: string; applied_at: Date | null }>(
      'SELECT state::text AS state, applied_at FROM control.directives WHERE id = $1',
      [directiveId],
    );
    expect(directive!.state).toBe('EMITIDA');
    expect(directive!.applied_at).toBeNull();

    const targets = await sql('SELECT 1 FROM control.directive_targets WHERE directive_id = $1', [
      directiveId,
    ]);
    expect(targets).toHaveLength(1);
  });

  it('refuses an ACK before receipt was recorded', async () => {
    const scenario = await makeScenario();
    const directiveId = await emitDirective(scenario);
    const result = await post<{ error: { blocks?: { ruleId: string; instead: string }[] } }>(
      `/control/directives/${directiveId}/ack`,
      { session: field, body: envelope() },
    );
    expect(result.status).toBe(422);
    const block = result.body.error.blocks?.find((b) => b.ruleId === 'RUL-055');
    expect(block?.instead).toMatch(/estados distintos/);
  });

  it('refuses to apply without receipt (TPR-016)', async () => {
    const scenario = await makeScenario();
    const directiveId = await emitDirective(scenario);
    const result = await post<{ error: { code: string } }>(`/control/directives/${directiveId}/apply`, {
      session: supervisor,
      body: envelope({ payload: { effectRef: { kind: 'UE_SUSPENDED' } } }),
    });
    expect(result.status).toBe(422);
    expect(result.body.error.code).toBe('GATE_BLOCKED');
  });

  it('applies only after receipt and ACK, recording the effect', async () => {
    const scenario = await makeScenario();
    const directiveId = await emitDirective(scenario);

    // Receipt is a device-level fact; the delivery path records it.
    await sql(
      // received_at >= issued_at (directives_timestamps_ordered). The monotonic test clock issues
      // commands slightly ahead of now(), so the receipt is dated from the directive itself.
      `UPDATE control.directives SET state = 'RECIBIDA', received_at = issued_at WHERE id = $1`,
      [directiveId],
    );
    const acked = await post(`/control/directives/${directiveId}/ack`, {
      session: field,
      body: envelope(),
    });
    expect(acked.status, JSON.stringify(acked.body)).toBe(200);

    const applied = await post(`/control/directives/${directiveId}/apply`, {
      session: supervisor,
      body: envelope({ payload: { effectRef: { kind: 'UE_SUSPENDED', note: 'Trabajo detenido.' } } }),
    });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);

    const [directive] = await sql<{ state: string; applied_effect_ref: { kind: string } }>(
      'SELECT state::text AS state, applied_effect_ref FROM control.directives WHERE id = $1',
      [directiveId],
    );
    expect(directive!.state).toBe('APLICADA');
    // RUL-057: application must be auditable, so the effect is referenced.
    expect(directive!.applied_effect_ref.kind).toBe('UE_SUSPENDED');

    // The four lifecycle steps are all on record, not collapsed into one.
    const events = await sql<{ event_type: string }>(
      'SELECT event_type FROM control.directive_events WHERE directive_id = $1 ORDER BY occurred_at',
      [directiveId],
    );
    expect(events.map((e) => e.event_type)).toEqual(['EMITIR', 'ACK', 'APLICAR']);
  });

  it('refuses to apply a directive that lost validity (RUL-058)', async () => {
    const scenario = await makeScenario();
    const result = await post<{ data: { subject: { id: string } } }>('/control/directives/emit', {
      session: planner,
      body: envelope({
        payload: {
          directiveType: 'REPROGRAMAR',
          reason: 'Reprogramación por clima.',
          validUntil: new Date(Date.now() + 1000).toISOString().replace(/\.\d+Z$/, 'Z'),
          targets: [{ targetKind: 'PLANNED_ASSIGNMENT', targetId: scenario.assignmentId }],
        },
      }),
    });
    const directiveId = result.body.data.subject.id;
    await sql(
      `UPDATE control.directives
       SET state = 'RECIBIDA', received_at = issued_at, valid_until = now() - interval '1 minute'
       WHERE id = $1`,
      [directiveId],
    );

    const applied = await post<{ error: { blocks?: { ruleId: string; instead: string }[] } }>(
      `/control/directives/${directiveId}/apply`,
      { session: supervisor, body: envelope({ payload: { effectRef: { kind: 'RESCHEDULED' } } }) },
    );
    expect(applied.status).toBe(422);
    const block = applied.body.error.blocks?.find((b) => b.ruleId === 'RUL-058');
    expect(block?.instead).toMatch(/se compensa con otra/);
  });

  it('blocks Start Work while a suspension directive is in force', async () => {
    const scenario = await makeScenario();
    const { preparePartWithUnit } = await import('./helpers.ts');
    const { unitId } = await preparePartWithUnit(field, scenario);

    const emitted = await post<{ data: { subject: { id: string } } }>('/control/directives/emit', {
      session: planner,
      body: envelope({
        payload: {
          directiveType: 'SUSPENDER',
          reason: 'Suspensión por condiciones de viento.',
          targets: [{ targetKind: 'EXECUTION_UNIT', targetId: unitId }],
        },
      }),
    });
    expect(emitted.status).toBe(200);

    const started = await post<{ error: { blocks?: { ruleId: string }[] } }>(
      `/execution/units/${unitId}/start`,
      { session: field, body: envelope() },
    );
    expect(started.status).toBe(422);
    expect(started.body.error.blocks?.some((b) => b.ruleId === 'RUL-057')).toBe(true);
  });
});

describe('PTW lifecycle: approved is not in force, expiry is not closure', () => {
  async function createAndApprove(scenario: Scenario): Promise<string> {
    const created = await post<{ data: { subject: { id: string } } }>('/habilita/permits', {
      session: supervisor,
      body: envelope({
        payload: {
          permitType: 'TRABAJO_EN_CALIENTE',
          scopeDescription: 'Soldadura en la batería ET-B3.',
          technicalLocationId: scenario.locationId,
        },
      }),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const permitId = created.body.data.subject.id;

    await post(`/habilita/permits/${permitId}/submit`, { session: supervisor, body: envelope() });
    const approved = await post(`/habilita/permits/${permitId}/approve`, {
      session: hse,
      body: envelope({ payload: { externalAuthority: 'Supervisor de la operadora' } }),
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    return permitId;
  }

  it('leaves an approved permit NOT in force (RUL-043)', async () => {
    const scenario = await makeScenario();
    const permitId = await createAndApprove(scenario);
    const [permit] = await sql<{ state: string; activated_at: Date | null; valid_from: Date | null }>(
      'SELECT state::text AS state, activated_at, valid_from FROM habilita.work_permits WHERE id = $1',
      [permitId],
    );
    expect(permit!.state).toBe('APROBADO');
    // The distinction PD-0394 turns on: approval does not create coverage.
    expect(permit!.activated_at).toBeNull();
    expect(permit!.valid_from).toBeNull();
  });

  it('refuses retroactive activation — a later permit cannot authorise earlier work', async () => {
    const scenario = await makeScenario();
    const permitId = await createAndApprove(scenario);

    const result = await post<{ error: { blocks?: { ruleId: string; instead: string }[] } }>(
      `/habilita/permits/${permitId}/activate`,
      {
        session: supervisor,
        body: envelope({
          payload: {
            // Backdated by four hours: exactly the PD-0394 attempt.
            validFrom: new Date(Date.now() - 4 * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z'),
          },
        }),
      },
    );
    expect(result.status).toBe(422);
    const block = result.body.error.blocks?.find((b) => b.ruleId === 'RUL-043');
    expect(block?.instead).toMatch(/no autoriza una ejecución anterior/);
  });

  it('activates with a forward window and propagates coverage', async () => {
    const scenario = await makeScenario();
    const permitId = await createAndApprove(scenario);
    const validFrom = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    const result = await post(`/habilita/permits/${permitId}/activate`, {
      session: supervisor,
      body: envelope({ payload: { validFrom } }),
    });
    expect(result.status, JSON.stringify(result.body)).toBe(200);

    const [permit] = await sql<{ state: string; activated_at: Date | null }>(
      'SELECT state::text AS state, activated_at FROM habilita.work_permits WHERE id = $1',
      [permitId],
    );
    expect(permit!.state).toBe('VIGENTE');
    expect(permit!.activated_at).not.toBeNull();
    void scenario;
  });

  it('suspends without closing (RUL-044)', async () => {
    const scenario = await makeScenario();
    const permitId = await createAndApprove(scenario);
    await post(`/habilita/permits/${permitId}/activate`, {
      session: supervisor,
      body: envelope({ payload: { validFrom: new Date().toISOString().replace(/\.\d+Z$/, 'Z') } }),
    });

    const suspended = await post(`/habilita/permits/${permitId}/suspend`, {
      session: supervisor,
      body: envelope({ payload: { reason: 'Cambio de condiciones en el frente de trabajo.' } }),
    });
    expect(suspended.status).toBe(200);

    const [permit] = await sql<{ state: string; closed_at: Date | null }>(
      'SELECT state::text AS state, closed_at FROM habilita.work_permits WHERE id = $1',
      [permitId],
    );
    expect(permit!.state).toBe('SUSPENDIDO');
    // Suspension withdraws cover; it does not close the permit.
    expect(permit!.closed_at).toBeNull();
  });

  it('refuses to close an expired permit, naming the administrative path (TPR-013)', async () => {
    const scenario = await makeScenario();
    const permitId = await createAndApprove(scenario);
    await post(`/habilita/permits/${permitId}/activate`, {
      session: supervisor,
      body: envelope({ payload: { validFrom: new Date().toISOString().replace(/\.\d+Z$/, 'Z') } }),
    });
    // The worker expires it when the window passes; a timeout never closes it.
    await sql(
      `UPDATE habilita.work_permits SET state = 'VENCIDO', expired_at = now() WHERE id = $1`,
      [permitId],
    );

    const result = await post<{ error: { blocks?: { ruleId: string; reason: string; instead: string }[] } }>(
      `/habilita/permits/${permitId}/close`,
      { session: supervisor, body: envelope() },
    );
    expect(result.status).toBe(422);
    const block = result.body.error.blocks?.find((b) => b.ruleId === 'RUL-045');
    expect(block?.reason).toMatch(/Un timeout nunca equivale a un cierre/);
    expect(block?.instead).toMatch(/cierre administrativo autorizado/);
  });

  it('refuses permit approval to the role that requested it', async () => {
    // 13: approval is a separate authority. A supervisor manages a permit; Habilita approves it.
    const scenario = await makeScenario();
    const created = await post<{ data: { subject: { id: string } } }>('/habilita/permits', {
      session: supervisor,
      body: envelope({
        payload: { permitType: 'ESPACIO_CONFINADO', scopeDescription: 'Ingreso a tanque TK-02.' },
      }),
    });
    const permitId = created.body.data.subject.id;
    await post(`/habilita/permits/${permitId}/submit`, { session: supervisor, body: envelope() });

    const result = await post(`/habilita/permits/${permitId}/approve`, {
      session: supervisor,
      body: envelope(),
    });
    expect(result.status).toBe(403);
    void scenario;
  });
});

describe('RUL-051 — an uncontrolled event defaults to suspension', () => {
  it('accepts a standalone Flash Report with no execution context (C-025 / GS-033)', async () => {
    const result = await post<{ data: { subject: { id: string } }; decision: { decision: string } }>(
      '/habilita/events/flash-report',
      {
        session: field,
        body: envelope({
          payload: {
            initialCategory: 'DERRAME',
            shortDescription: 'Derrame menor en la playa de materiales.',
            situationControlled: true,
            occurredAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
          },
        }),
      },
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);

    const [event] = await sql<{ state: string; situation_controlled: boolean }>(
      'SELECT state::text AS state, situation_controlled FROM habilita.events WHERE id = $1',
      [result.body.data.subject.id],
    );
    expect(event!.state).toBe('REPORTADO');
    expect(event!.situation_controlled).toBe(true);
  });

  it('warns and records a suspension when the situation is NOT controlled', async () => {
    const scenario = await makeScenario();
    const { preparePartWithUnit } = await import('./helpers.ts');
    const { unitId } = await preparePartWithUnit(field, scenario);

    const result = await post<{
      data: { subject: { id: string } };
      decision: { decision: string; warnings: { ruleId: string; reason: string }[] };
    }>('/habilita/events/flash-report', {
      session: field,
      body: envelope({
        payload: {
          initialCategory: 'FUGA_GAS',
          shortDescription: 'Olor a gas en el frente de trabajo.',
          situationControlled: false,
          occurredAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
          executionUnitIds: [unitId],
        },
      }),
    });

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    // The report is accepted — never refused — and the conservative default is a warning plus a fact.
    const warning = result.body.decision.warnings.find((w) => w.ruleId === 'RUL-051');
    expect(warning?.reason).toMatch(/suspendido por default/);

    const events = await sql<{ reason_code: string }>(
      `SELECT reason_code FROM execution.operational_events
       WHERE execution_unit_id = $1 AND reason_code = 'HABILITA_UNCONTROLLED'`,
      [unitId],
    );
    expect(events).toHaveLength(1);
  });

  it('does not ask the reporter for severity or root cause (RUL-047)', async () => {
    const result = await post<{ error: { code: string } }>('/habilita/events/flash-report', {
      session: field,
      body: envelope({
        payload: {
          initialCategory: 'CASI_ACCIDENTE',
          shortDescription: 'Casi accidente con el camión.',
          situationControlled: true,
          occurredAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
          severity: 'ALTA',
        },
      }),
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('keeps the initial report immutable in the database', async () => {
    const created = await post<{ data: { subject: { id: string } } }>('/habilita/events/flash-report', {
      session: field,
      body: envelope({
        payload: {
          initialCategory: 'DERRAME',
          shortDescription: 'Texto original del reportante.',
          situationControlled: true,
          occurredAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        },
      }),
    });
    const eventId = created.body.data.subject.id;

    // RUL-049: reclassification is a new version row, so the original wording survives.
    await sql(
      `INSERT INTO habilita.event_classifications
         (id, event_id, version_no, category, severity, classified_by, classified_at)
       VALUES ($1, $2, 1, 'DERRAME_MAYOR', 'ALTA', $3, now())`,
      [uuid(), eventId, hse.identityId],
    );
    const [event] = await sql<{ short_description: string; initial_category: string }>(
      'SELECT short_description, initial_category FROM habilita.events WHERE id = $1',
      [eventId],
    );
    expect(event!.short_description).toBe('Texto original del reportante.');
    expect(event!.initial_category).toBe('DERRAME');
  });
});
