/**
 * API integration: the command pipeline end to end, against a real PostgreSQL.
 *
 * This is where the mandatory regressions are proven at the level that matters — a client calling
 * HTTP, not a unit test of a helper:
 *
 *   RGT-02  PD-0394  a permit activated at 11:25 does not authorise work at 07:20
 *   RGT-06           retry after a lost ACK returns the same receipt and creates one effect
 *   RGT-07           same command id with a different payload is a typed conflict, zero effect
 *   RGT-08           two closes at the same expected_version: one wins, the other resolves
 *   RGT-17           a preview that said ALLOW does not authorise a later command
 *   RGT-05  PD-0392  presence is preserved; non-compliance is recorded, not erased
 *   C-009            a started Parte has at least one UE
 *   TPR-010          a closed UE does not reopen
 *   13               the actor comes from the session; a forged actor is rejected
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attachPerson,
  envelope,
  token,
  get,
  getApp,
  makeScenario,
  makeSession,
  makeWorkPermit,
  post,
  preparePartWithUnit,
  sql,
  teardown,
  uuid,
  type Scenario,
  type Session,
} from './helpers.ts';

let field: Session;
let supervisor: Session;
let planner: Session;
let reviewer: Session;

beforeAll(async () => {
  await getApp();
  field = await makeSession({ role: 'field' });
  supervisor = await makeSession({ role: 'supervisor' });
  planner = await makeSession({ role: 'planner' });
  reviewer = await makeSession({ role: 'review' });
});

afterAll(teardown);

describe('authentication and authorization happen on every call', () => {
  it('refuses a request with no session', async () => {
    const result = await post('/execution/parts/prepare', { body: envelope() });
    expect(result.status).toBe(401);
    expect((result.body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses an expired session', async () => {
    const stale = await makeSession({ role: 'field' });
    // Both timestamps move: sessions_expiry refuses expires_at <= started_at, so a session cannot
    // exist already expired — only become expired.
    await sql(
      `UPDATE platform.sessions
       SET started_at = now() - interval '3 hours', expires_at = now() - interval '1 hour'
       WHERE id = $1`,
      [stale.sessionId],
    );
    const result = await post('/execution/parts/prepare', { session: stale, body: envelope() });
    expect(result.status).toBe(401);
  });

  it('refuses a revoked session immediately for an online caller', async () => {
    const revoked = await makeSession({ role: 'field' });
    await sql('UPDATE platform.sessions SET revoked_at = now() WHERE id = $1', [revoked.sessionId]);
    expect((await post('/execution/parts/prepare', { session: revoked, body: envelope() })).status).toBe(401);
  });

  it('refuses a forged actor in the payload rather than ignoring it', async () => {
    // 13: "payload actor falsificado rechazado". additionalProperties:false makes it explicit.
    const result = await post('/execution/parts/prepare', {
      session: field,
      body: { ...envelope(), actorId: uuid() },
    });
    expect(result.status).toBe(400);
    const body = result.body as { error: { code: string; details: { path?: string; message: string }[] } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.some((d) => d.path === 'actorId')).toBe(true);
    expect(body.error.details[0]!.message).toMatch(/derived from the\s+verified session/);
  });

  it('refuses a capability the role does not hold', async () => {
    // A reviewer decides on versions; it never prepares a Parte (13 DoD: operator does not approve
    // review, reviewer does not write execution).
    const scenario = await makeScenario();
    const result = await post('/execution/parts/prepare', {
      session: reviewer,
      body: envelope({ payload: { plannedAssignmentId: scenario.assignmentId } }),
    });
    expect(result.status).toBe(403);
    const body = result.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FORBIDDEN_SCOPE');
  });

  it('refuses a capability outside the granted contract scope without echoing the ids', async () => {
    // RGT-15 shape: a grant scoped to contract A must not cover an object under contract B, and the
    // refusal must not confirm which contract the object belongs to.
    const other = await makeScenario();
    const scoped = await makeSession({ role: 'field', contractId: uuid() });
    const result = await post('/execution/parts/prepare', {
      session: scoped,
      body: envelope({ payload: { plannedAssignmentId: other.assignmentId } }),
    });
    expect(result.status).toBe(403);
    const message = JSON.stringify(result.body);
    expect(message).not.toContain(other.contractId);
  });

  it('exposes the command catalogue with what this actor may do — visibility only', async () => {
    const result = await get<{ data: { name: string; allowedForActor: boolean; capability: string }[] }>(
      '/commands',
      { session: field },
    );
    expect(result.status).toBe(200);
    const start = result.body.data.find((c) => c.name === 'execution.units.start');
    expect(start?.allowedForActor).toBe(true);
    const amend = result.body.data.find((c) => c.name === 'execution.amendments.create');
    // The field role cannot amend closed reality; the catalogue says so, and the pipeline enforces it.
    expect(amend?.allowedForActor ?? false).toBe(false);
  });
});

describe('there is no arbitrary state PATCH', () => {
  it('returns 404 and explains that a state changes only through a named command', async () => {
    const result = await getApp().then((app) =>
      app.inject({
        method: 'PATCH',
        url: '/execution/parts/' + uuid(),
        headers: { authorization: `Bearer ${field.token}` },
        payload: { state: 'CERRADO_OPERATIVAMENTE' },
      }),
    );
    expect(result.statusCode).toBe(404);
    expect(result.json().error.details[0].message).toMatch(/no se cambia con PATCH/);
  });
});

describe('prepare and start: the happy path', () => {
  let scenario: Scenario;

  beforeAll(async () => {
    scenario = await makeScenario();
  });

  it('derives the TipoParte instead of accepting one (RUL-001 / C-006)', async () => {
    const result = await post<{
      data: { subject: { id: string }; effects: { partTypeId?: string }[] };
      decision: { rulesApplied: { ruleId: string; outcome: string }[] };
    }>('/execution/parts/prepare', {
      session: field,
      body: envelope({ payload: { plannedAssignmentId: scenario.assignmentId, crewId: scenario.crewId } }),
    });

    expect(result.status).toBe(200);
    // Routing ran and won.
    expect(result.body.decision.rulesApplied.some((r) => r.ruleId === 'RUL-001' && r.outcome === 'WON')).toBe(
      true,
    );
    const [part] = await sql<{ part_type_id: string; state: string; operational_date: string }>(
      'SELECT part_type_id, state::text AS state, operational_date::text AS operational_date FROM execution.parts WHERE id = $1',
      [result.body.data.subject.id],
    );
    expect(part!.part_type_id).toBe(scenario.partTypeId);
    expect(part!.state).toBe('PREPARADO');
  });

  it('records a plan-to-execution link rather than assuming 1:1 (C-023)', async () => {
    const { partId } = await preparePartWithUnit(field, scenario);
    const links = await sql<{ link_kind: string; planned_assignment_id: string | null }>(
      'SELECT link_kind, planned_assignment_id FROM planning.plan_execution_links WHERE part_id = $1',
      [partId],
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.link_kind).toBe('MATERIALISES');
    expect(links[0]!.planned_assignment_id).toBe(scenario.assignmentId);
  });

  it('starts the unit, opens an interval, and writes a trace', async () => {
    const { partId, unitId } = await preparePartWithUnit(field, scenario);
    const result = await post<{ decision: { decision: string; decisionId: string }; receipt: { outcome: string } }>(
      `/execution/units/${unitId}/start`,
      { session: field, body: envelope({ payload: { timeCategory: 'OPERATIVO' } }) },
    );

    expect(result.status).toBe(200);
    expect(result.body.decision.decision).toBe('ALLOW');
    expect(result.body.receipt.outcome).toBe('APPLIED');

    const [unit] = await sql<{ state: string; started_at: Date }>(
      'SELECT state::text AS state, started_at FROM execution.execution_units WHERE id = $1',
      [unitId],
    );
    expect(unit!.state).toBe('EN_EJECUCION');

    const [part] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM execution.parts WHERE id = $1',
      [partId],
    );
    expect(part!.state).toBe('EN_EJECUCION');

    const intervals = await sql<{ time_category: string; ended_at: Date | null }>(
      'SELECT time_category, ended_at FROM execution.time_events WHERE execution_unit_id = $1',
      [unitId],
    );
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.ended_at).toBeNull();

    // The trace exists and names the subject, so the decision is explainable later.
    const traces = await sql<{ decision: string; trigger: string }>(
      'SELECT decision, trigger FROM platform.decision_traces WHERE subject_id = $1',
      [unitId],
    );
    expect(traces.some((t) => t.trigger === 'START_WORK' && t.decision === 'ALLOW')).toBe(true);
  });

  it('queues the domain event on the outbox in the same transaction', async () => {
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope() });
    const events = await sql<{ event_type: string; status: string }>(
      'SELECT event_type, status::text AS status FROM platform.domain_outbox WHERE subject_id = $1',
      [unitId],
    );
    expect(events.some((e) => e.event_type === 'execution.unit.started' && e.status === 'PENDING')).toBe(true);
  });
});

describe('RGT-02 / PD-0394 — a later permit does not authorise earlier work', () => {
  it('blocks Start Work when no permit covers the instant of the work', async () => {
    const scenario = await makeScenario({ requiresWorkPermit: true });
    const { unitId } = await preparePartWithUnit(field, scenario);

    const result = await post<{
      error: { code: string; blocks?: { ruleId: string; reason: string; instead: string }[] };
    }>(`/execution/units/${unitId}/start`, { session: field, body: envelope() });

    expect(result.status).toBe(422);
    expect(result.body.error.code).toBe('GATE_BLOCKED');
    const block = result.body.error.blocks?.find((b) => b.ruleId === 'RUL-022');
    expect(block, 'the PTW hard block must be reported with its rule id').toBeDefined();
    expect(block!.instead).toMatch(/ACTIVAR el permiso antes de iniciar/);
  });

  it('still blocks work at 07:20 when the permit only becomes effective at 11:25', async () => {
    // The exact shape of PD-0394: operativo 07:20-10:00, permiso firmado 11:25, and the prototype
    // reported "Sin bloqueos" because checks() only looked for non-empty fields.
    const scenario = await makeScenario({ requiresWorkPermit: true });
    const { unitId } = await preparePartWithUnit(field, scenario);

    const workedAt = new Date('2026-10-05T10:20:00Z'); // 07:20 local (UTC-3)
    const permitFrom = new Date('2026-10-05T14:25:00Z'); // 11:25 local

    await makeWorkPermit({
      unitId,
      locationId: scenario.locationId,
      state: 'VIGENTE',
      validFrom: permitFrom,
      validUntil: null,
    });

    const blocked = await post<{ error: { code: string; blocks?: { ruleId: string; reason: string }[] } }>(
      `/execution/units/${unitId}/start`,
      { session: field, body: envelope({ occurredAt: '2026-10-05T10:20:00Z' }) },
    );

    expect(blocked.status).toBe(422);
    const block = blocked.body.error.blocks?.find((b) => b.ruleId === 'RUL-022');
    expect(block).toBeDefined();
    // The refusal states WHY, with the permit's own window, so it is arguable rather than opaque.
    expect(block!.reason).toMatch(/posterior al momento del trabajo/);

    // And the same permit does authorise work inside its window.
    const allowed = await post<{ decision: { decision: string } }>(`/execution/units/${unitId}/start`, {
      session: field,
      body: envelope({ occurredAt: '2026-10-05T14:30:00Z' }),
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.decision.decision).toBe('ALLOW');
    void workedAt;
  });

  it('blocks when the permit is APROBADO but never activated (RUL-043)', async () => {
    const scenario = await makeScenario({ requiresWorkPermit: true });
    const { unitId } = await preparePartWithUnit(field, scenario);
    await makeWorkPermit({
      unitId,
      locationId: scenario.locationId,
      state: 'APROBADO',
      validFrom: new Date(Date.now() - 7200_000),
    });

    const result = await post<{ error: { blocks?: { ruleId: string }[] } }>(
      `/execution/units/${unitId}/start`,
      { session: field, body: envelope() },
    );
    expect(result.status).toBe(422);
    expect(result.body.error.blocks?.some((b) => b.ruleId === 'RUL-022')).toBe(true);
  });

  it('records the blocked decision in the trace, with no operational effect', async () => {
    const scenario = await makeScenario({ requiresWorkPermit: true });
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope() });

    // 06: "BLOCK también tiene trace/receipt sin efectos operativos."
    const traces = await sql<{ decision: string; effects: unknown[] }>(
      "SELECT decision, effects FROM platform.decision_traces WHERE subject_id = $1 AND trigger = 'START_WORK'",
      [unitId],
    );
    expect(traces.some((t) => t.decision === 'BLOCK')).toBe(true);
    const blocked = traces.find((t) => t.decision === 'BLOCK')!;
    expect(blocked.effects).toEqual([]);

    const [unit] = await sql<{ state: string; started_at: Date | null }>(
      'SELECT state::text AS state, started_at FROM execution.execution_units WHERE id = $1',
      [unitId],
    );
    expect(unit!.state).toBe('PENDIENTE');
    expect(unit!.started_at).toBeNull();
    expect(
      await sql('SELECT 1 FROM execution.time_events WHERE execution_unit_id = $1', [unitId]),
    ).toHaveLength(0);
  });
});

describe('RGT-05 / PD-0392 — presence is preserved, non-compliance is recorded', () => {
  it('blocks the start but leaves the person on the roster', async () => {
    const scenario = await makeScenario();
    const { partId, unitId } = await preparePartWithUnit(field, scenario);

    // A requirement this person does not meet, with HARD_BLOCK severity.
    const requirementId = uuid();
    await sql(
      `INSERT INTO habilita.requirements
         (id, code, name, requirement_type, applies_to, severity, valid_from)
       VALUES ($1, $2, 'Inducción vigente', 'INDUCTION', 'PERSON', 'HARD_BLOCK', '2026-01-01')`,
      [requirementId, `RQ-${token(8)}`],
    );
    await sql(
      `INSERT INTO habilita.compliances
         (id, requirement_id, subject_kind, person_id, valid_from, valid_until, status)
       VALUES ($1, $2, 'PERSON', $3, '2026-01-01', '2026-09-28', 'EXPIRED')`,
      [uuid(), requirementId, scenario.personId],
    );
    const assignmentId = await attachPerson({ partId, personId: scenario.personId });

    const result = await post<{ error: { blocks?: { ruleId: string; reason: string; instead: string }[] } }>(
      `/execution/units/${unitId}/start`,
      { session: field, body: envelope() },
    );

    expect(result.status).toBe(422);
    const block = result.body.error.blocks?.find((b) => b.ruleId === 'RUL-039');
    expect(block).toBeDefined();
    // The remedy offered is to regularise or start without that person — never to delete them.
    expect(block!.instead).toMatch(/Regularizar|iniciar sin esa persona/);
    expect(block!.instead).not.toMatch(/quitar|borrar/i);

    // The presence record is untouched: the prototype offered to remove them from the list.
    const [presence] = await sql<{ id: string; ended_at: Date | null }>(
      'SELECT id, ended_at FROM execution.person_execution_assignments WHERE id = $1',
      [assignmentId],
    );
    expect(presence).toBeDefined();
    expect(presence!.ended_at).toBeNull();
  });
});

describe('RGT-06 / RGT-07 — idempotency', () => {
  it('returns the same receipt on retry and creates exactly one effect', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const commandId = uuid();
    const body = envelope({ commandId, payload: { timeCategory: 'OPERATIVO' } });

    const first = await post<{ receipt: { receiptId: string; outcome: string } }>(
      `/execution/units/${unitId}/start`,
      { session: field, body },
    );
    expect(first.status).toBe(200);
    expect(first.body.receipt.outcome).toBe('APPLIED');

    // The ACK was lost; the device retries the identical command.
    const retry = await post<{ receipt: { receiptId: string; outcome: string } }>(
      `/execution/units/${unitId}/start`,
      { session: field, body },
    );
    expect(retry.status).toBe(200);
    expect(retry.body.receipt.outcome).toBe('REPLAYED');
    expect(retry.body.receipt.receiptId).toBe(first.body.receipt.receiptId);

    // One effect, not two: one interval, one receipt, one outbox event.
    expect(
      await sql('SELECT 1 FROM execution.time_events WHERE execution_unit_id = $1', [unitId]),
    ).toHaveLength(1);
    expect(
      await sql('SELECT 1 FROM platform.command_receipts WHERE command_id = $1', [commandId]),
    ).toHaveLength(1);
    expect(
      await sql(
        "SELECT 1 FROM platform.domain_outbox WHERE subject_id = $1 AND event_type = 'execution.unit.started'",
        [unitId],
      ),
    ).toHaveLength(1);
  });

  it('rejects the same command id with a different payload, with zero additional effect', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const commandId = uuid();

    await post(`/execution/units/${unitId}/start`, {
      session: field,
      body: envelope({ commandId, payload: { timeCategory: 'OPERATIVO' } }),
    });

    const conflicting = await post<{ error: { code: string } }>(`/execution/units/${unitId}/start`, {
      session: field,
      body: envelope({ commandId, payload: { timeCategory: 'TRASLADO' } }),
    });

    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.code).toBe('COMMAND_CONFLICT');
    // Still one interval, and it kept the FIRST payload's category.
    const intervals = await sql<{ time_category: string }>(
      'SELECT time_category FROM execution.time_events WHERE execution_unit_id = $1',
      [unitId],
    );
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.time_category).toBe('OPERATIVO');
  });

  it('replays a blocked command as blocked, without re-running the effects', async () => {
    const scenario = await makeScenario({ requiresWorkPermit: true });
    const { unitId } = await preparePartWithUnit(field, scenario);
    const commandId = uuid();
    const body = envelope({ commandId });

    const first = await post(`/execution/units/${unitId}/start`, { session: field, body });
    expect(first.status).toBe(422);

    const retry = await post<{ error: { code: string } }>(`/execution/units/${unitId}/start`, {
      session: field,
      body,
    });
    expect(retry.status).toBe(422);
    expect(retry.body.error.code).toBe('GATE_BLOCKED');
    // One receipt recording the refusal, so the refusal itself is idempotent.
    expect(
      await sql("SELECT 1 FROM platform.command_receipts WHERE command_id = $1 AND outcome = 'BLOCKED'", [
        commandId,
      ]),
    ).toHaveLength(1);
  });
});

describe('RGT-08 — concurrent closes do not last-write-wins', () => {
  it('accepts one close and reports VERSION_MISMATCH to the other', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope() });

    const [{ version }] = await sql<{ version: number }>(
      'SELECT version FROM execution.execution_units WHERE id = $1',
      [unitId],
    );

    const first = await post(`/execution/units/${unitId}/close`, {
      session: field,
      body: envelope({ expectedVersion: version, payload: { result: 'COMPLETADA' } }),
    });
    expect(first.status).toBe(200);

    // A second device closing from the same read it had before.
    const second = await post<{ error: { code: string; message: string } }>(
      `/execution/units/${unitId}/close`,
      {
        session: field,
        body: envelope({ expectedVersion: version, payload: { result: 'PARCIAL', resultReason: 'otra lectura' } }),
      },
    );
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('VERSION_MISMATCH');
    expect(second.body.error.message).toMatch(/no se aplica\s+last-write-wins/);

    // The first close stands, unchanged.
    const [unit] = await sql<{ state: string; result: string }>(
      'SELECT state::text AS state, result FROM execution.execution_units WHERE id = $1',
      [unitId],
    );
    expect(unit!.state).toBe('CERRADA');
    expect(unit!.result).toBe('COMPLETADA');
  });
});

describe('RGT-17 — a preview authorises nothing', () => {
  it('evaluates without applying, and the real command re-evaluates', async () => {
    const scenario = await makeScenario({ requiresWorkPermit: true });
    const { unitId } = await preparePartWithUnit(field, scenario);

    // A permit in force now: the preview says ALLOW.
    const permitId = await makeWorkPermit({
      unitId,
      locationId: scenario.locationId,
      state: 'VIGENTE',
      validFrom: new Date(Date.now() - 3600_000),
      validUntil: null,
    });

    const preview = await post<{ decision: { decision: string; preview: boolean } }>(
      `/execution/units/${unitId}/evaluate-start`,
      { session: field, body: envelope() },
    );
    expect(preview.status).toBe(200);
    expect(preview.body.decision.decision).toBe('ALLOW');
    expect(preview.body.decision.preview).toBe(true);

    // Nothing happened.
    const [afterPreview] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM execution.execution_units WHERE id = $1',
      [unitId],
    );
    expect(afterPreview!.state).toBe('PENDIENTE');

    // The document is revoked between preview and command.
    await sql("UPDATE habilita.work_permits SET state = 'SUSPENDIDO', suspended_at = now() WHERE id = $1", [
      permitId,
    ]);

    const real = await post<{ error: { code: string } }>(`/execution/units/${unitId}/start`, {
      session: field,
      body: envelope(),
    });
    // The preview's ALLOW is worth nothing: the command re-evaluates and blocks.
    expect(real.status).toBe(422);
    expect(real.body.error.code).toBe('GATE_BLOCKED');
  });

  it('writes a trace for the preview, marked as a preview', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/evaluate-start`, { session: field, body: envelope() });
    const traces = await sql<{ preview: boolean }>(
      'SELECT preview FROM platform.decision_traces WHERE subject_id = $1',
      [unitId],
    );
    expect(traces.some((t) => t.preview === true)).toBe(true);
    // And no receipt for the START command: no command was accepted. (Creating the unit earlier
    // legitimately produced its own receipt, which is why this is scoped by command_type.)
    expect(
      await sql(
        "SELECT 1 FROM platform.command_receipts WHERE subject_id = $1 AND command_type = 'execution.units.start'",
        [unitId],
      ),
    ).toHaveLength(0);
  });
});

describe('closure gates and immutability', () => {
  it('requires a cause when the result is not a plain completion (RUL-019)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope() });

    const result = await post<{ error: { code: string; details: { path?: string }[] } }>(
      `/execution/units/${unitId}/close`,
      { session: field, body: envelope({ payload: { result: 'NO_REALIZADA' } }) },
    );
    expect(result.status).toBe(422);
    expect(result.body.error.details.some((d) => d.path === 'resultReason')).toBe(true);
  });

  it('writes an immutable version on close, which is what a UC will point at (C-030)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope() });
    await post(`/execution/units/${unitId}/close`, {
      session: field,
      body: envelope({ payload: { result: 'COMPLETADA' } }),
    });

    const versions = await sql<{ id: string; reason: string; snapshot: Record<string, unknown> }>(
      'SELECT id, reason, snapshot FROM execution.execution_unit_versions WHERE execution_unit_id = $1',
      [unitId],
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]!.reason).toBe('CLOSE');
    expect(versions[0]!.snapshot).toHaveProperty('timeEvents');

    // Interface B: commercial derivation reacts to the version, never to the mutable row.
    const events = await sql<{ payload: { versionId: string } }>(
      "SELECT payload FROM platform.domain_outbox WHERE event_type = 'execution.unit.closed' AND subject_id = $1",
      [unitId],
    );
    expect(events[0]!.payload.versionId).toBe(versions[0]!.id);
  });

  it('closes open intervals as part of closing the unit', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope() });
    await post(`/execution/units/${unitId}/close`, {
      session: field,
      body: envelope({ payload: { result: 'COMPLETADA' } }),
    });
    const open = await sql(
      'SELECT 1 FROM execution.time_events WHERE execution_unit_id = $1 AND ended_at IS NULL',
      [unitId],
    );
    expect(open).toHaveLength(0);
  });

  it('refuses to start a closed unit, pointing at the amendment path (TPR-010)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope() });
    await post(`/execution/units/${unitId}/close`, {
      session: field,
      body: envelope({ payload: { result: 'COMPLETADA' } }),
    });

    const result = await post<{ error: { code: string; blocks?: { ruleId: string; instead: string }[] } }>(
      `/execution/units/${unitId}/start`,
      { session: field, body: envelope() },
    );
    expect(result.status).toBe(422);
    const block = result.body.error.blocks?.find((b) => b.instead.includes('EnmiendaOperativa'));
    expect(block, 'the refusal must name the amendment path').toBeDefined();
  });

  it('refuses to close a Parte while a unit is open, counting what is outstanding (RUL-034)', async () => {
    const scenario = await makeScenario();
    const { partId, unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope() });

    const result = await post<{ error: { blocks?: { reason: string }[] } }>(
      `/execution/parts/${partId}/close`,
      { session: field, body: envelope() },
    );
    expect(result.status).toBe(422);
    expect(result.body.error.blocks?.some((b) => /unidad\(es\) de ejecución sin resolver/.test(b.reason))).toBe(
      true,
    );
  });

  it('closes the Parte once every unit is terminal', async () => {
    const scenario = await makeScenario();
    const { partId, unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope() });
    await post(`/execution/units/${unitId}/close`, {
      session: field,
      body: envelope({ payload: { result: 'COMPLETADA' } }),
    });

    const result = await post<{ decision: { decision: string } }>(`/execution/parts/${partId}/close`, {
      session: field,
      body: envelope(),
    });
    expect(result.status).toBe(200);
    const [part] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM execution.parts WHERE id = $1',
      [partId],
    );
    expect(part!.state).toBe('CERRADO_OPERATIVAMENTE');
  });
});

describe('C-009 — a started Parte has at least one UE', () => {
  it('cannot be violated through the API, because starting requires a unit', async () => {
    const scenario = await makeScenario();
    const prepared = await post<{ data: { subject: { id: string } } }>('/execution/parts/prepare', {
      session: field,
      body: envelope({ payload: { plannedAssignmentId: scenario.assignmentId } }),
    });
    const partId = prepared.body.data.subject.id;

    // There is no command that starts a Parte directly: it transitions as a consequence of a UE
    // starting, so the invariant holds by construction and the deferred trigger is the backstop.
    const [part] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM execution.parts WHERE id = $1',
      [partId],
    );
    expect(part!.state).toBe('PREPARADO');
    expect(await sql('SELECT 1 FROM execution.execution_units WHERE part_id = $1', [partId])).toHaveLength(0);
  });
});

describe('read models', () => {
  it('returns Mi jornada with the dimensions kept separate', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope() });

    const result = await get<{
      data: { partId: string; operational: { state: string; openUnits: number }; delivery: { outstanding: number } }[];
      meta: { asOf: string; source: string };
    }>('/field/my-day', { session: field });

    expect(result.status).toBe(200);
    const row = result.body.data.find((r) => r.operational.state === 'EN_EJECUCION');
    expect(row).toBeDefined();
    // Operational and delivery are different objects, not one status string.
    expect(row!.operational).toHaveProperty('state');
    expect(row!.delivery).toHaveProperty('outstanding');
    // Every read states its source and recency.
    expect(result.body.meta.asOf).toBeTruthy();
    expect(result.body.meta.source).toBe('execution');
  });

  it('returns the trace of a subject with winning and discarded rules', async () => {
    const scenario = await makeScenario({ requiresWorkPermit: true });
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope() });

    const result = await get<{
      data: { decision: string; trigger: string; rules: { ruleId: string; outcome: string }[] }[];
    }>(`/trace/UnidadEjecucion/${unitId}`, { session: supervisor });

    expect(result.status).toBe(200);
    const blocked = result.body.data.find((t) => t.decision === 'BLOCK');
    expect(blocked).toBeDefined();
    expect(blocked!.rules.some((r) => r.ruleId === 'RUL-042')).toBe(true);
  });

  it('serves the planning timeline from one projection', async () => {
    await makeScenario();
    const result = await get<{ data: { state: string; window_start: string }[]; meta: { source: string } }>(
      '/planning/timeline',
      { session: planner },
    );
    expect(result.status).toBe(200);
    expect(result.body.data.length).toBeGreaterThan(0);
    expect(result.body.meta.source).toMatch(/planned_assignments/);
  });

  it('refuses the timeline to an actor without planning.read', async () => {
    const result = await get('/planning/timeline', { session: reviewer });
    // The reviewer role does have planning.read; a client does not.
    const client = await makeSession({ role: 'client' });
    expect(result.status).toBe(200);
    expect((await get('/planning/timeline', { session: client })).status).toBe(403);
  });
});

describe('health and readiness', () => {
  it('reports ready only when migrations and the authorization table are present', async () => {
    const result = await get<{ status: string; migration: number; capabilities: number }>('/ready');
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('ready');
    expect(result.body.migration).toBeGreaterThanOrEqual(9);
    // Default deny: an empty capability table means nothing is authorised, so it is not "ready".
    expect(result.body.capabilities).toBeGreaterThan(0);
  });
});
