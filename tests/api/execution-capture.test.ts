/**
 * API integration: the capture commands that run *during* execution.
 *
 * None of these overwrite anything — a category change closes an interval and opens another, a
 * location is appended with its role, a measurement supersedes rather than replaces, and an
 * allocation is resolved by a new version. These tests prove that append-only shape holds through
 * the real HTTP/pipeline/Postgres stack, not just in a unit test of the handler.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  envelope,
  getApp,
  makeScenario,
  makeSession,
  post,
  preparePartWithUnit,
  sql,
  teardown,
  token,
  uuid,
  type Session,
} from './helpers.ts';

let field: Session;

beforeAll(async () => {
  await getApp();
  field = await makeSession({ role: 'field' });
});

afterAll(teardown);

describe('execution.units.change-time-category', () => {
  it('closes the open interval and opens the next one under the new category', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });

    const before = await sql<{ id: string; ended_at: Date | null }>(
      'SELECT id, ended_at FROM execution.time_events WHERE execution_unit_id = $1',
      [unitId],
    );
    expect(before.filter((r) => r.ended_at === null)).toHaveLength(1);

    const result = await post(`/execution/units/${unitId}/change-time-category`, {
      session: field,
      body: envelope({ payload: { timeCategory: 'ESPERA' } }),
    });
    expect(result.status).toBe(200);

    const after = await sql<{ time_category: string; ended_at: Date | null }>(
      'SELECT time_category, ended_at FROM execution.time_events WHERE execution_unit_id = $1 ORDER BY started_at',
      [unitId],
    );
    expect(after).toHaveLength(2);
    expect(after[0]!.ended_at).not.toBeNull();
    expect(after[1]!.time_category).toBe('ESPERA');
    expect(after[1]!.ended_at).toBeNull();
  });

  it('refuses a category change with no open interval (RUL-028)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    // Never started: PENDIENTE, no open interval.
    const result = await post(`/execution/units/${unitId}/change-time-category`, {
      session: field,
      body: envelope({ payload: { timeCategory: 'ESPERA' } }),
    });
    expect(result.status).toBe(422);
    expect((result.body as { error: { code: string } }).error.code).toBe('GATE_BLOCKED');
  });
});

describe('execution.units.confirm-location', () => {
  it('records a mapped location without cutting identity (RUL-008)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });

    const result = await post<{ decision: { decision: string } }>(`/execution/units/${unitId}/confirm-location`, {
      session: field,
      body: envelope({
        payload: { technicalLocationId: scenario.locationId, locationRole: 'PRINCIPAL' },
      }),
    });
    expect(result.status).toBe(200);
    expect(result.body.decision.decision).toBe('ALLOW');

    const rows = await sql(
      'SELECT technical_location_id, location_role FROM execution.execution_locations WHERE execution_unit_id = $1 ORDER BY confirmed_at DESC',
      [unitId],
    );
    expect(rows[0]!['technical_location_id']).toBe(scenario.locationId);
  });

  it('records an unmapped location as PENDING_MAPPING with a warning, never typed as a master (RUL-031)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });

    const result = await post<{ decision: { decision: string; warnings: readonly { ruleId: string }[] } }>(
      `/execution/units/${unitId}/confirm-location`,
      {
        session: field,
        body: envelope({ payload: { unmappedLabel: 'Pad 7 norte', locationRole: 'DESTINO' } }),
      },
    );
    expect(result.status).toBe(200);
    expect(result.body.decision.decision).toBe('WARN');
    expect(result.body.decision.warnings.some((w) => w.ruleId === 'RUL-031')).toBe(true);

    // locationRole DESTINO disambiguates this row from the PRINCIPAL one createUnit already
    // inserted (unconfirmed, confirmed_at NULL) for the scenario's planned location.
    const rows = await sql<{ technical_location_id: string | null; unmapped_label: string | null }>(
      'SELECT technical_location_id, unmapped_label FROM execution.execution_locations WHERE execution_unit_id = $1 AND location_role = $2',
      [unitId, 'DESTINO'],
    );
    expect(rows[0]!.technical_location_id).toBeNull();
    expect(rows[0]!.unmapped_label).toBe('Pad 7 norte');
  });
});

describe('execution.units.capture-measurement', () => {
  it('registers a magnitude with its unit, and a re-reading supersedes without deleting (C-014/RUL-032)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });

    const [uom] = await sql<{ id: string }>("SELECT id FROM config.units_of_measure WHERE code = 'h'");
    if (!uom) throw new Error('fixture: no unit of measure seeded with code h');

    const first = await post(`/execution/units/${unitId}/capture-measurement`, {
      session: field,
      body: envelope({
        payload: {
          metricCode: 'horas-equipo',
          quantity: { value: '3.5', unitOfMeasureId: uom.id },
          measurementSource: 'HUMAN_READING',
        },
      }),
    });
    expect(first.status).toBe(200);

    const second = await post<{ decision: { warnings: readonly { ruleId: string }[] } }>(
      `/execution/units/${unitId}/capture-measurement`,
      {
        session: field,
        body: envelope({
          payload: {
            metricCode: 'horas-equipo',
            quantity: { value: '4.0', unitOfMeasureId: uom.id },
            measurementSource: 'INSTRUMENT',
          },
        }),
      },
    );
    expect(second.status).toBe(200);
    expect(second.body.decision.warnings.some((w) => w.ruleId === 'RUL-032')).toBe(true);

    const rows = await sql<{ quantity: string; supersedes_id: string | null }>(
      'SELECT quantity, supersedes_id FROM execution.execution_measurements WHERE execution_unit_id = $1 ORDER BY measured_at',
      [unitId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.supersedes_id).toBeNull();
    expect(rows[1]!.supersedes_id).not.toBeNull();
  });

  it('refuses a unit of measure that does not exist (RUL-032)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });

    const result = await post(`/execution/units/${unitId}/capture-measurement`, {
      session: field,
      body: envelope({
        payload: {
          metricCode: 'horas-equipo',
          quantity: { value: '1', unitOfMeasureId: uuid() },
          measurementSource: 'HUMAN_READING',
        },
      }),
    });
    expect(result.status).toBe(422);
  });
});

describe('execution.units.record-transition', () => {
  it('registers real time between work packages so it is never orphaned (C-013/RUL-030)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });

    const started = new Date(Date.now() - 5 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');
    const ended = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const result = await post(`/execution/units/${unitId}/record-transition`, {
      session: field,
      body: envelope({
        payload: { startedAt: started, endedAt: ended, transitionKind: 'TRASLADO', note: 'Entre frentes' },
      }),
    });
    expect(result.status).toBe(200);

    const rows = await sql('SELECT transition_kind FROM execution.operational_transitions WHERE part_id = (SELECT part_id FROM execution.execution_units WHERE id = $1)', [unitId]);
    expect(rows).toHaveLength(1);
  });

  it('refuses a transition that ends before it starts (RUL-030)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });

    const now = new Date();
    const result = await post(`/execution/units/${unitId}/record-transition`, {
      session: field,
      body: envelope({
        payload: {
          startedAt: now.toISOString().replace(/\.\d+Z$/, 'Z'),
          endedAt: new Date(now.getTime() - 60_000).toISOString().replace(/\.\d+Z$/, 'Z'),
          transitionKind: 'ESPERA',
        },
      }),
    });
    expect(result.status).toBe(422);
  });
});

describe('execution.allocations.resolve', () => {
  it('versions the allocation as RESUELTO when the cost centre and item are allowed by the contract (R-045/R-046)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);

    const costCenterId = uuid();
    await sql(
      `INSERT INTO config.cost_centers (id, code, name) VALUES ($1, $2, 'Centro de costo escenario')`,
      [costCenterId, `CC-${token(8)}`],
    );
    await sql(
      `INSERT INTO config.contract_service_cost_centers
         (id, contract_service_id, cost_center_id, valid_from)
       VALUES ($1, $2, $3, '2026-01-01')`,
      [uuid(), scenario.contractServiceId, costCenterId],
    );
    const [uom] = await sql<{ id: string }>('SELECT id FROM config.units_of_measure LIMIT 1');
    if (!uom) throw new Error('fixture: no unit of measure seeded');
    const itemId = uuid();
    await sql(
      `INSERT INTO config.contract_items (id, contract_service_id, unit_of_measure_id, code, description)
       VALUES ($1, $2, $3, $4, 'Item escenario')`,
      [itemId, scenario.contractServiceId, uom.id, `IT-${token(8)}`],
    );

    const result = await post(`/execution/units/${unitId}/resolve-allocation`, {
      session: field,
      body: envelope({
        payload: { contractServiceId: scenario.contractServiceId, costCenterId, contractItemId: itemId },
      }),
    });
    expect(result.status).toBe(200);

    const rows = await sql<{ status: string }>(
      'SELECT status::text AS status FROM execution.execution_allocations WHERE execution_unit_id = $1 ORDER BY version_no DESC LIMIT 1',
      [unitId],
    );
    expect(rows[0]!.status).toBe('RESUELTO');
  });

  it('refuses a cost centre the contract service does not allow (R-045)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);

    // A cost centre that exists but was never linked to this contract service.
    const costCenterId = uuid();
    await sql(`INSERT INTO config.cost_centers (id, code, name) VALUES ($1, $2, 'CC no vinculado')`, [
      costCenterId,
      `CC-${token(8)}`,
    ]);
    const [uom] = await sql<{ id: string }>('SELECT id FROM config.units_of_measure LIMIT 1');
    if (!uom) throw new Error('fixture: no unit of measure seeded');
    const itemId = uuid();
    await sql(
      `INSERT INTO config.contract_items (id, contract_service_id, unit_of_measure_id, code, description)
       VALUES ($1, $2, $3, $4, 'Item escenario')`,
      [itemId, scenario.contractServiceId, uom.id, `IT-${token(8)}`],
    );

    const result = await post(`/execution/units/${unitId}/resolve-allocation`, {
      session: field,
      body: envelope({
        payload: { contractServiceId: scenario.contractServiceId, costCenterId, contractItemId: itemId },
      }),
    });
    expect(result.status).toBe(422);
  });
});

describe('execution.evidence.attach', () => {
  it('registers evidence metadata with its hash, LOCAL_ONLY until the bytes land (RGT-09)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const checksum = createHash('sha256').update('fixture-evidence-bytes').digest('hex');

    const result = await post<{ data: { subject: { id: string } } }>('/execution/evidence', {
      session: field,
      body: envelope({
        payload: {
          targetKind: 'EXECUTION_UNIT',
          targetId: unitId,
          evidenceKind: 'PHOTO',
          fileName: 'foto-pad7.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 123_456,
          checksum,
        },
      }),
    });
    expect(result.status).toBe(200);

    const rows = await sql<{ upload_status: string }>(
      'SELECT upload_status FROM evidence.evidence WHERE id = $1',
      [result.body.data.subject.id],
    );
    expect(rows[0]!.upload_status).toBe('LOCAL_ONLY');
  });
});
