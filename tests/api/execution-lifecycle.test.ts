/**
 * API integration: lifecycle commands — suspend/resume, replacements, not performed, void,
 * handover, amendments.
 *
 * These replaced four admin buttons that each destroyed a fact (`a-est`, `a-reopen`, `a-del`,
 * `o-delp`). The tests below prove the replacement actually holds through the real HTTP/pipeline/
 * Postgres stack:
 *
 *   T-UE04/05  suspend closes the open interval; resume re-evaluates the gate (a permit that
 *              expired during the suspension blocks the restart, RUL-022/023)
 *   RUL-025/026  a replacement is two intervals: the outgoing closes, the incoming opens
 *   RUL-019    not performed is explained, never deleted
 *   RUL-035    void only succeeds where there was never real work
 *   RUL-005    handover keeps the Parte by default; the people change, not the work
 *   RUL-073    an amendment's author cannot be its own approver
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attachPerson,
  envelope,
  getApp,
  hoursFromNow,
  makeScenario,
  makeSession,
  makeWorkPermit,
  post,
  preparePartWithUnit,
  sql,
  teardown,
  token,
  uuid,
  type Session,
} from './helpers.ts';

let field: Session;
let supervisorA: Session;
let supervisorB: Session;

beforeAll(async () => {
  await getApp();
  field = await makeSession({ role: 'field' });
  supervisorA = await makeSession({ role: 'supervisor' });
  supervisorB = await makeSession({ role: 'supervisor' });
});

afterAll(teardown);

/**
 * Satisfies every currently active PERSON requirement for a person.
 *
 * habilitaGate (RUL-039/040) checks against the WHOLE `habilita.requirements` table, which other
 * test files (and other runs of this one) keep adding HARD_BLOCK rows to — the suite shares one
 * dev database rather than resetting between files (see helpers.ts). A brand-new person otherwise
 * collects every accumulated requirement as a missing one, which is correct behaviour for the gate
 * but makes a fresh fixture person unusable for a replace-person happy path unless it is given
 * compliance explicitly, the same way the dev seed does for its named crew.
 */
async function giveCompliance(personId: string): Promise<void> {
  const requirements = await sql<{ id: string }>(
    "SELECT id FROM habilita.requirements WHERE applies_to = 'PERSON'",
  );
  for (const r of requirements) {
    await sql(
      `INSERT INTO habilita.compliances (id, requirement_id, subject_kind, person_id, valid_from, valid_until, status)
       VALUES ($1, $2, 'PERSON', $3, '2020-01-01', '2099-12-31', 'COMPLIANT')`,
      [uuid(), r.id, personId],
    );
  }
}

describe('execution.units.suspend / resume — T-UE04/05', () => {
  it('closes the open interval on suspend and opens a new one on resume', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });

    const suspended = await post(`/execution/units/${unitId}/suspend`, {
      session: field,
      body: envelope({ payload: { reason: 'Espera de condiciones' } }),
    });
    expect(suspended.status).toBe(200);

    const openAfterSuspend = await sql(
      'SELECT id FROM execution.time_events WHERE execution_unit_id = $1 AND ended_at IS NULL',
      [unitId],
    );
    expect(openAfterSuspend).toHaveLength(0);

    const [unitState] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM execution.execution_units WHERE id = $1',
      [unitId],
    );
    expect(unitState!.state).toBe('SUSPENDIDA');

    const resumed = await post(`/execution/units/${unitId}/resume`, {
      session: field,
      body: envelope({ payload: {} }),
    });
    expect(resumed.status).toBe(200);

    const openAfterResume = await sql(
      'SELECT id FROM execution.time_events WHERE execution_unit_id = $1 AND ended_at IS NULL',
      [unitId],
    );
    expect(openAfterResume).toHaveLength(1);
  });

  it('blocks resume when the covering permit expired during the suspension (RUL-022/023)', async () => {
    const scenario = await makeScenario({ requiresWorkPermit: true });
    const { unitId } = await preparePartWithUnit(field, scenario);
    await makeWorkPermit({
      unitId,
      locationId: scenario.locationId,
      state: 'VIGENTE',
      validFrom: new Date(Date.now() - 3_600_000),
      validUntil: new Date(Date.now() + 3_600_000),
    });

    const started = await post(`/execution/units/${unitId}/start`, {
      session: field,
      body: envelope({ payload: {} }),
    });
    expect(started.status).toBe(200);

    const suspended = await post(`/execution/units/${unitId}/suspend`, {
      session: field,
      body: envelope({ payload: { reason: 'Corte de suministro' } }),
    });
    expect(suspended.status).toBe(200);

    // Resuming two hours later: the permit's validUntil has passed.
    const resumed = await post(`/execution/units/${unitId}/resume`, {
      session: field,
      body: envelope({ occurredAt: hoursFromNow(2), payload: {} }),
    });
    expect(resumed.status).toBe(422);
    expect((resumed.body as { error: { code: string } }).error.code).toBe('GATE_BLOCKED');
  });
});

describe('execution.units.replace-person — RUL-025', () => {
  it('closes the outgoing interval and opens the incoming one without deleting the outgoing presence', async () => {
    const scenario = await makeScenario();
    const { partId, unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });

    const outgoingAssignmentId = await attachPerson({ partId, personId: scenario.personId, role: 'OPERARIO' });

    const incomingPersonId = uuid();
    await sql(
      `INSERT INTO config.people (id, code, first_name, last_name, affiliation, provenance)
       VALUES ($1, $2, 'Entrante', 'Reemplazo', 'VDS', 'FIXTURE_TEST')`,
      [incomingPersonId, `PE-${token(8)}`],
    );
    await giveCompliance(incomingPersonId);

    const result = await post(`/execution/units/${unitId}/replace-person`, {
      session: supervisorA,
      body: envelope({
        payload: {
          outgoingAssignmentId,
          incomingPersonId,
          role: 'OPERARIO',
          reason: 'Cambio de turno programado',
        },
      }),
    });
    expect(result.status).toBe(200);

    const rows = await sql<{ person_id: string; ended_at: Date | null }>(
      'SELECT person_id, ended_at FROM execution.person_execution_assignments WHERE part_id = $1 ORDER BY started_at',
      [partId],
    );
    const outgoing = rows.find((r) => r.person_id === scenario.personId);
    const incoming = rows.find((r) => r.person_id === incomingPersonId);
    expect(outgoing?.ended_at).not.toBeNull();
    expect(incoming?.ended_at).toBeNull();
  });

  it('refuses the capability a field role does not hold (execution.replace is supervisor only)', async () => {
    const scenario = await makeScenario();
    const { partId, unitId } = await preparePartWithUnit(field, scenario);
    const outgoingAssignmentId = await attachPerson({ partId, personId: scenario.personId });
    const result = await post(`/execution/units/${unitId}/replace-person`, {
      session: field,
      body: envelope({
        payload: { outgoingAssignmentId, incomingPersonId: uuid(), role: 'OPERARIO', reason: 'Prueba' },
      }),
    });
    expect(result.status).toBe(403);
  });
});

describe('execution.units.replace-resource — RUL-026', () => {
  it('closes the outgoing resource interval and opens the incoming one', async () => {
    const scenario = await makeScenario();
    const { partId, unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });

    const resourceTypeId = uuid();
    await sql(
      `INSERT INTO config.resource_types (id, code, name, metering) VALUES ($1, $2, 'Camión', 'ODOMETER_KM')`,
      [resourceTypeId, `RT-${token(8)}`],
    );
    const outgoingResourceId = uuid();
    await sql(
      `INSERT INTO config.resources (id, resource_type_id, code, name) VALUES ($1, $2, $3, 'Saliente')`,
      [outgoingResourceId, resourceTypeId, `RS-${token(8)}`],
    );
    const incomingResourceId = uuid();
    await sql(
      `INSERT INTO config.resources (id, resource_type_id, code, name) VALUES ($1, $2, $3, 'Entrante')`,
      [incomingResourceId, resourceTypeId, `RS-${token(8)}`],
    );
    const outgoingAssignmentId = uuid();
    await sql(
      `INSERT INTO execution.resource_execution_assignments
         (id, part_id, execution_unit_id, resource_id, role, started_at, compliance_status)
       VALUES ($1, $2, $3, $4, 'PRINCIPAL', $5, 'COMPLIANT')`,
      [outgoingAssignmentId, partId, unitId, outgoingResourceId, new Date(Date.now() - 3_600_000)],
    );

    const result = await post(`/execution/units/${unitId}/replace-resource`, {
      session: supervisorA,
      body: envelope({
        payload: {
          outgoingAssignmentId,
          incomingResourceId,
          role: 'PRINCIPAL',
          reason: 'Avería mecánica',
          meterReading: '84120.5',
        },
      }),
    });
    expect(result.status).toBe(200);

    const rows = await sql<{ resource_id: string; ended_at: Date | null }>(
      'SELECT resource_id, ended_at FROM execution.resource_execution_assignments WHERE part_id = $1 ORDER BY started_at',
      [partId],
    );
    const outgoing = rows.find((r) => r.resource_id === outgoingResourceId);
    const incoming = rows.find((r) => r.resource_id === incomingResourceId);
    expect(outgoing?.ended_at).not.toBeNull();
    expect(incoming?.ended_at).toBeNull();
  });
});

describe('execution.units.mark-not-performed — RUL-019', () => {
  it('preserves the unit with CAUSE rather than deleting the attempt', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    // Never started: the planned work simply did not happen.
    const result = await post(`/execution/units/${unitId}/mark-not-performed`, {
      session: field,
      body: envelope({ payload: { reason: 'Cliente canceló el acceso al predio' } }),
    });
    expect(result.status).toBe(200);

    const rows = await sql<{ state: string; result: string | null; result_reason: string | null }>(
      'SELECT state::text AS state, result, result_reason FROM execution.execution_units WHERE id = $1',
      [unitId],
    );
    expect(rows[0]!.state).toBe('NO_REALIZADA');
    expect(rows[0]!.result_reason).toContain('canceló');
  });
});

describe('execution.units.void / execution.parts.void — RUL-035', () => {
  it('voids a unit that never had real work', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const result = await post(`/execution/units/${unitId}/void`, {
      session: field,
      body: envelope({ payload: { reason: 'Unidad creada por error de tipeo' } }),
    });
    expect(result.status).toBe(200);
    const rows = await sql<{ state: string }>(
      'SELECT state::text AS state FROM execution.execution_units WHERE id = $1',
      [unitId],
    );
    expect(rows[0]!.state).toBe('ANULADA');
  });

  it('refuses to void a unit once it has real work (an open interval)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });
    const result = await post(`/execution/units/${unitId}/void`, {
      session: field,
      body: envelope({ payload: { reason: 'Intento de anular después de iniciar' } }),
    });
    expect(result.status).toBe(422);
  });

  it('voids a Parte that never executed', async () => {
    const scenario = await makeScenario();
    const { partId } = await preparePartWithUnit(field, scenario);
    const result = await post(`/execution/parts/${partId}/void`, {
      session: field,
      body: envelope({ payload: { reason: 'Parte duplicado por error de carga' } }),
    });
    expect(result.status).toBe(200);
    const rows = await sql<{ state: string }>(
      'SELECT state::text AS state FROM execution.parts WHERE id = $1',
      [partId],
    );
    expect(rows[0]!.state).toBe('ANULADO');
  });
});

describe('execution.parts.handover — RUL-005', () => {
  it('keeps the Parte by default, closing the outgoing roster and opening the incoming one', async () => {
    const scenario = await makeScenario({ expectedPartType: 'TP-01' });
    const { partId, unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });
    const outgoingAssignmentId = await attachPerson({ partId, personId: scenario.personId });

    const incomingPersonId = uuid();
    await sql(
      `INSERT INTO config.people (id, code, first_name, last_name, affiliation, provenance)
       VALUES ($1, $2, 'Turno', 'Entrante', 'VDS', 'FIXTURE_TEST')`,
      [incomingPersonId, `PE-${token(8)}`],
    );

    const result = await post<{ decision: { decision: string } }>(`/execution/parts/${partId}/handover`, {
      session: field,
      body: envelope({
        payload: { incomingPersonIds: [incomingPersonId], note: 'Cambio de turno 18:00' },
      }),
    });
    expect(result.status).toBe(200);

    const [part] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM execution.parts WHERE id = $1',
      [partId],
    );
    // RUL-005 default: the Parte continues. A handover is not a close.
    expect(part!.state).not.toBe('CERRADO_OPERATIVAMENTE');
    expect(part!.state).not.toBe('ANULADO');

    const outgoing = await sql<{ ended_at: Date | null }>(
      'SELECT ended_at FROM execution.person_execution_assignments WHERE id = $1',
      [outgoingAssignmentId],
    );
    expect(outgoing[0]!.ended_at).not.toBeNull();

    const incoming = await sql<{ compliance_status: string }>(
      'SELECT compliance_status FROM execution.person_execution_assignments WHERE part_id = $1 AND person_id = $2',
      [partId, incomingPersonId],
    );
    expect(incoming[0]!.compliance_status).toBe('UNKNOWN');
  });
});

describe('execution.amendments.create / approve — RUL-073', () => {
  it('refuses the amendment while the target is still open, and refuses the author as approver', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });

    // Still EN_EJECUCION: amending open reality is editing with extra steps (RUL-035).
    const tooEarly = await post('/execution/amendments', {
      session: supervisorA,
      body: envelope({
        payload: {
          targetKind: 'EXECUTION_UNIT',
          executionUnitId: unitId,
          fieldPath: 'result_reason',
          oldValue: null,
          newValue: 'corregido',
          reason: 'Corrección de un dato registrado con error',
        },
      }),
    });
    expect(tooEarly.status).toBe(422);

    await post(`/execution/units/${unitId}/close`, {
      session: field,
      body: envelope({ payload: { result: 'COMPLETADA' } }),
    });

    const created = await post<{ data: { subject: { id: string } } }>('/execution/amendments', {
      session: supervisorA,
      body: envelope({
        payload: {
          targetKind: 'EXECUTION_UNIT',
          executionUnitId: unitId,
          fieldPath: 'result_reason',
          oldValue: null,
          newValue: 'corregido',
          reason: 'Corrección de un dato registrado con error',
        },
      }),
    });
    expect(created.status).toBe(200);
    const amendmentId = created.body.data.subject.id;

    const sameActor = await post(`/execution/amendments/${amendmentId}/approve`, {
      session: supervisorA,
      body: envelope({ payload: {} }),
    });
    expect(sameActor.status).toBe(422);

    const differentActor = await post(`/execution/amendments/${amendmentId}/approve`, {
      session: supervisorB,
      body: envelope({ payload: {} }),
    });
    expect(differentActor.status).toBe(200);

    const rows = await sql<{ current_version_id: string | null }>(
      'SELECT current_version_id FROM execution.execution_units WHERE id = $1',
      [unitId],
    );
    const versions = await sql(
      'SELECT reason FROM execution.execution_unit_versions WHERE execution_unit_id = $1 ORDER BY version_no',
      [unitId],
    );
    expect(versions.map((v) => (v as { reason: string }).reason)).toEqual(['CLOSE', 'AMENDMENT']);
    expect(rows[0]!.current_version_id).not.toBeNull();
  });
});

describe('TP-01 / TP-02 / TP-03 — the same core, three strategies', () => {
  it.each(['TP-01', 'TP-02', 'TP-03'] as const)(
    'runs prepare → start → close for %s without changing another pattern\'s grain',
    async (expectedPartType) => {
      const scenario = await makeScenario({ expectedPartType });
      const { partId, unitId } = await preparePartWithUnit(field, scenario);

      const [part] = await sql<{ part_type_code: string }>(
        `SELECT pt.code AS part_type_code FROM execution.parts p
         JOIN config.part_types pt ON pt.id = p.part_type_id WHERE p.id = $1`,
        [partId],
      );
      expect(part!.part_type_code).toBe(expectedPartType);

      const started = await post(`/execution/units/${unitId}/start`, {
        session: field,
        body: envelope({ payload: {} }),
      });
      expect(started.status).toBe(200);

      const closed = await post(`/execution/units/${unitId}/close`, {
        session: field,
        body: envelope({ payload: { result: 'COMPLETADA' } }),
      });
      expect(closed.status).toBe(200);

      const partClosed = await post(`/execution/parts/${partId}/close`, {
        session: field,
        body: envelope({ payload: {} }),
      });
      expect(partClosed.status).toBe(200);
    },
  );
});
