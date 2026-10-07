/**
 * W2 read models.
 *
 * Projections are tested for the two things that make them trustworthy rather than merely present:
 *
 *  1. **They say where the number came from and how fresh it is.** A figure without `source` and
 *     `asOf` cannot be audited, and the audit found dashboard numbers changing silently.
 *  2. **They do not merge what the domain keeps apart.** An expired READY is not a READY; occupancy
 *     is two metrics; an invalidated readiness row survives; the approved window of an older version
 *     is still readable after supersession (RGT-03 from the read side).
 *
 * Scope is checked too: a client identity must not reach planning (RGT-15).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  envelope,
  get,
  getApp,
  makeScenario,
  makeSession,
  post,
  sql,
  teardown,
  type Scenario,
  type Session,
} from './helpers.ts';

let planner: Session;
let field: Session;
let client: Session;

beforeAll(async () => {
  await getApp();
  planner = await makeSession({ role: 'planner' });
  field = await makeSession({ role: 'field' });
  client = await makeSession({ role: 'client' });
});

afterAll(teardown);

/** Nominate one person onto an assignment and return the person id. */
async function nominate(scenario: Scenario): Promise<string> {
  const result = await post(`/planning/assignments/${scenario.assignmentId}/nominate`, {
    session: planner,
    body: envelope({ payload: { personIds: [scenario.personId], role: 'OPERARIO' } }),
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return scenario.personId;
}

/**
 * A scenario in a period of its own.
 *
 * The test database is shared and accumulates assignments, so an unbounded timeline read cannot be
 * relied on to contain a row created a moment ago. Giving each scenario a distinct future window is
 * also how the surface is really used: a planner asks for a week.
 */
let windowOffsetDays = 400;
async function makeScenarioInOwnPeriod(
  options: { requiresWorkPermit?: boolean } = {},
): Promise<{ scenario: Scenario; query: string }> {
  windowOffsetDays += 3;
  const start = new Date(Date.now() + windowOffsetDays * 86_400_000);
  const end = new Date(start.getTime() + 10 * 3_600_000);
  const scenario = await makeScenario({ ...options, windowStart: start, windowEnd: end });
  const from = new Date(start.getTime() - 3_600_000).toISOString();
  const to = new Date(end.getTime() + 3_600_000).toISOString();
  return { scenario, query: `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` };
}

describe('/planning/timeline', () => {
  it('carries source and asOf with the data', async () => {
    const { query } = await makeScenarioInOwnPeriod();
    const result = await get<{
      data: unknown[];
      meta: { source?: string; asOf?: string; scoped?: boolean };
    }>(`/planning/timeline?${query}`, { session: planner });

    expect(result.status).toBe(200);
    expect(result.body.meta.source).toBeTruthy();
    expect(result.body.meta.asOf).toBeTruthy();
  });

  it('reports readiness with its validity window, not as a flag', async () => {
    const { scenario, query } = await makeScenarioInOwnPeriod();
    await sql(`UPDATE planning.planned_assignments SET state = 'READY' WHERE id = $1`, [
      scenario.assignmentId,
    ]);
    await post(`/planning/assignments/${scenario.assignmentId}/evaluate-readiness`, {
      session: planner,
      body: envelope({ payload: { validForMinutes: 120 } }),
    });

    const result = await get<{
      data: { id: string; readiness: string | null; readiness_at: string | null; readiness_until: string | null }[];
    }>(`/planning/timeline?${query}`, { session: planner });
    const row = result.body.data.find((r) => r.id === scenario.assignmentId);

    expect(row?.readiness).toBe('READY');
    // C-015: without these two instants the client cannot tell a current READY from a stale one.
    expect(row?.readiness_at).toBeTruthy();
    expect(row?.readiness_until).toBeTruthy();
  });

  it('counts directives that are emitted but not applied', async () => {
    const { scenario, query } = await makeScenarioInOwnPeriod();
    const emitted = await post<{ data: { subject: { id: string } } }>('/control/directives/emit', {
      session: planner,
      body: envelope({
        payload: {
          directiveType: 'REPRIORIZAR',
          reason: 'Cambio de prioridad por pedido de la operadora.',
          targets: [{ targetKind: 'PLANNED_ASSIGNMENT', targetId: scenario.assignmentId }],
        },
      }),
    });
    expect(emitted.status, JSON.stringify(emitted.body)).toBe(200);

    const result = await get<{ data: { id: string; directives_open: string }[] }>(
      `/planning/timeline?${query}`,
      { session: planner },
    );
    const row = result.body.data.find((r) => r.id === scenario.assignmentId);
    // C-017: a decision taken and not yet in force is exactly the gap this count exists to show.
    expect(Number(row?.directives_open)).toBe(1);
  });

  it('denies a client identity (RGT-15)', async () => {
    const result = await get('/planning/timeline', { session: client });
    expect(result.status).toBe(403);
  });
});

describe('/planning/occupancy', () => {
  it('returns two named metrics and declares what each one means', async () => {
    const { scenario, query } = await makeScenarioInOwnPeriod();
    const result = await get<{
      data: { subject_kind: string; subject_id: string; occupied_days: string; planned_hours: string }[];
      meta: { metrics?: Record<string, string> };
    }>(`/planning/occupancy?${query}`, { session: planner });

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const crew = result.body.data.find((r) => r.subject_id === scenario.crewId);
    expect(crew?.subject_kind).toBe('CUADRILLA');
    expect(Number(crew?.occupied_days)).toBeGreaterThan(0);
    expect(Number(crew?.planned_hours)).toBeGreaterThan(0);
    // 15: the two metrics must be named, because one number silently mixed them before.
    expect(result.body.meta.metrics?.['occupied_days']).toMatch(/Días operativos/);
    expect(result.body.meta.metrics?.['planned_hours']).toMatch(/solapamiento una sola vez/);
  });

  it('counts an overlap once rather than reporting 200%', async () => {
    // Two assignments on one crew at the same time is a conflict for the rules to judge, not twice
    // the available hours. Summing them would make the metric meaningless exactly where it matters.
    const { scenario: first, query } = await makeScenarioInOwnPeriod();
    await sql(
      `INSERT INTO planning.planned_assignments
         (id, plan_version_id, state, window_start, window_end, operational_date,
          expected_part_type_id, crew_id, requires_work_permit)
       SELECT gen_random_uuid(), plan_version_id, 'PROGRAMADA', window_start, window_end,
              operational_date, expected_part_type_id, crew_id, requires_work_permit
       FROM planning.planned_assignments WHERE id = $1`,
      [first.assignmentId],
    );

    const result = await get<{ data: { subject_id: string; assignments: string; planned_hours: string }[] }>(
      `/planning/occupancy?${query}`,
      { session: planner },
    );
    const crew = result.body.data.find((r) => r.subject_id === first.crewId);
    expect(Number(crew?.assignments)).toBe(2);
    // The window is 10 hours wide in the fixture; two copies of it are still 10.
    expect(Number(crew?.planned_hours)).toBeLessThan(12);
  });

  it('refuses to compute occupancy without a declared period', async () => {
    const result = await get<{ error: { code: string } }>('/planning/occupancy', { session: planner });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('/planning/assignments/:id — the drawer', () => {
  it('returns the dimensions separately, including the version chain', async () => {
    const scenario = await makeScenario();
    await nominate(scenario);

    const result = await get<{
      data: {
        assignment: { id: string; state: string; plan_version_state: string };
        units: unknown[];
        people: { person_code: string; role: string }[];
        versions: { version_no: number; state: string }[];
      };
    }>(`/planning/assignments/${scenario.assignmentId}`, { session: planner });

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data.assignment.id).toBe(scenario.assignmentId);
    // Plan state and assignment state are two dimensions, returned as two fields.
    expect(result.body.data.assignment.state).toBe('DESPACHADA');
    expect(result.body.data.assignment.plan_version_state).toBe('APROBADA');
    expect(result.body.data.units.length).toBe(1);
    expect(result.body.data.people[0]?.role).toBe('OPERARIO');
    expect(result.body.data.versions.length).toBeGreaterThan(0);
  });

  it('keeps an invalidated readiness evaluation visible', async () => {
    const scenario = await makeScenario();
    await sql(`UPDATE planning.planned_assignments SET state = 'READY' WHERE id = $1`, [
      scenario.assignmentId,
    ]);
    await post(`/planning/assignments/${scenario.assignmentId}/evaluate-readiness`, {
      session: planner,
      body: envelope(),
    });
    // RUL-015 invalidates without erasing: the planner has to be able to see that it WAS ready.
    await sql(
      `UPDATE planning.readiness_evaluations SET invalidated_at = now()
       WHERE planned_assignment_id = $1`,
      [scenario.assignmentId],
    );

    const result = await get<{ data: { readiness: { invalidated_at: string | null }[] } }>(
      `/planning/assignments/${scenario.assignmentId}`,
      { session: planner },
    );
    expect(result.body.data.readiness.length).toBe(1);
    expect(result.body.data.readiness[0]?.invalidated_at).toBeTruthy();
  });

  it('shows the original window after an approved extension superseded it (RGT-03)', async () => {
    const scenario = await makeScenario();
    await nominate(scenario);
    const [before] = await sql<{ window_end: Date }>(
      'SELECT window_end FROM planning.planned_assignments WHERE id = $1',
      [scenario.assignmentId],
    );

    await post(`/planning/assignments/${scenario.assignmentId}/request-extension`, {
      session: field,
      body: envelope({ payload: { additionalDays: 2, reason: 'La operadora amplió el alcance.' } }),
    });
    const resolved = await post(`/planning/assignments/${scenario.assignmentId}/resolve-extension`, {
      session: planner,
      body: envelope({ payload: { decision: 'APROBAR' } }),
    });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);

    const result = await get<{
      data: {
        assignment: { window_end: string; state: string };
        extensions: { state: string; approved_window_end: string; proposed_window_end: string }[];
      };
    }>(`/planning/assignments/${scenario.assignmentId}`, { session: planner });

    // The superseded row still reads its own approved window. Plan-vs-real compares against what
    // was approved at the time, not against what was later approved instead.
    expect(new Date(result.body.data.assignment.window_end).getTime()).toBe(before!.window_end.getTime());
    expect(result.body.data.assignment.state).toBe('SUPERSEDIDA');
    const request = result.body.data.extensions[0];
    expect(request?.state).toBe('APROBADA');
    expect(new Date(request!.approved_window_end).getTime()).toBe(before!.window_end.getTime());
  });

  it('404s for an assignment that does not exist', async () => {
    const result = await get(`/planning/assignments/00000000-0000-7000-8000-000000000000`, {
      session: planner,
    });
    expect(result.status).toBe(404);
  });
});

describe('/planning/assignments/:id/nominees', () => {
  it('flags a person already nominated and says the list authorises nothing', async () => {
    const scenario = await makeScenario();
    await nominate(scenario);
    const [person0] = await sql<{ code: string }>('SELECT code FROM config.people WHERE id = $1', [
      scenario.personId,
    ]);
    const code = person0!.code;

    const result = await get<{
      data: {
        people: { id: string; already_nominated: boolean; in_crew: boolean; overlapping: string }[];
        resources: unknown[];
      };
      meta: { note?: string };
    }>(`/planning/assignments/${scenario.assignmentId}/nominees?q=${code}`, { session: planner });

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const person = result.body.data.people.find((p) => p.id === scenario.personId);
    expect(person?.already_nominated).toBe(true);
    // RGT-17: the list is context, never pre-authorisation.
    expect(result.body.meta.note).toMatch(/vuelve a evaluar/);
  });

  it('is denied to an identity that cannot nominate', async () => {
    const scenario = await makeScenario();
    const result = await get(`/planning/assignments/${scenario.assignmentId}/nominees`, {
      session: field,
    });
    expect(result.status).toBe(403);
  });
});

describe('/control/directives — four states, four facts', () => {
  it('reports the lifecycle and never collapses ACK into applied', async () => {
    const scenario = await makeScenario();
    const emitted = await post<{ data: { subject: { id: string } } }>('/control/directives/emit', {
      session: planner,
      body: envelope({
        payload: {
          directiveType: 'SUSPENDER',
          reason: 'Viento por encima del límite operativo.',
          targets: [{ targetKind: 'PLANNED_ASSIGNMENT', targetId: scenario.assignmentId }],
        },
      }),
    });
    const directiveId = emitted.body.data.subject.id;
    await sql(
      `UPDATE control.directives SET state = 'RECIBIDA', received_at = issued_at WHERE id = $1`,
      [directiveId],
    );
    const acked = await post(`/control/directives/${directiveId}/ack`, {
      session: field,
      body: envelope(),
    });
    expect(acked.status, JSON.stringify(acked.body)).toBe(200);

    const result = await get<{
      data: {
        id: string;
        state: string;
        acknowledged_at: string | null;
        applied_at: string | null;
        lifecycle: { eventType: string }[] | null;
      }[];
      meta: { note?: string };
    }>('/control/directives?open=true', { session: planner });

    const row = result.body.data.find((d) => d.id === directiveId);
    expect(row?.state).toBe('RECONOCIDA');
    expect(row?.acknowledged_at).toBeTruthy();
    // RUL-056 / TPR-016: acknowledged is not applied, and the read must not suggest otherwise.
    expect(row?.applied_at).toBeNull();
    expect(row?.lifecycle?.map((e) => e.eventType)).toEqual(['EMITIR', 'ACK']);
    expect(result.body.meta.note).toMatch(/no es APLICADA/);
  });
});

describe('/habilita/permits', () => {
  it('distinguishes approved from in force and carries the lifecycle', async () => {
    const scenario = await makeScenario({ requiresWorkPermit: true });
    const created = await post<{ data: { subject: { id: string } } }>('/habilita/permits', {
      session: await makeSession({ role: 'habilita' }),
      body: envelope({
        payload: {
          permitType: 'PTW_CALIENTE',
          technicalLocationId: scenario.locationId,
          scopeDescription: 'Trabajo en caliente en el sector sur.',
        },
      }),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const permitId = created.body.data.subject.id;

    const result = await get<{
      data: { id: string; state: string; activated_at: string | null; lifecycle: { eventType: string }[] | null }[];
      meta: { note?: string };
    }>('/habilita/permits', { session: planner });

    const row = result.body.data.find((p) => p.id === permitId);
    expect(row?.state).toBe('BORRADOR');
    expect(row?.activated_at).toBeNull();
    // RUL-043: the read states the distinction the prototype did not have at all.
    expect(result.body.meta.note).toMatch(/APROBADO no habilita/);
  });
});
