/**
 * API integration: Review VDS -> Commercial -> Billing, the chain S0 §8/C-033 keeps apart.
 *
 * One continuous journey proves the boundary holds in both directions: a review decision never
 * touches execution.* (RGT-04), a commercial rejection records its reason without editing the UE,
 * and the ERP attempt is durable before the fixture answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  envelope,
  get,
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
let reviewer: Session;
let backoffice: Session;

beforeAll(async () => {
  await getApp();
  field = await makeSession({ role: 'field' });
  reviewer = await makeSession({ role: 'review' });
  backoffice = await makeSession({ role: 'backoffice' });
});

afterAll(teardown);

/** A closed, resolved-allocation execution unit — the shared starting point for this chain. */
async function closedUnitWithVersion(): Promise<{
  clientId: string;
  contractId: string;
  contractServiceId: string;
  unitId: string;
  executionUnitVersionId: string;
  executionAllocationId: string;
  contractItemId: string;
  unitOfMeasureId: string;
}> {
  const scenario = await makeScenario();
  const { unitId } = await preparePartWithUnit(field, scenario);
  await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });

  const costCenterId = uuid();
  await sql(`INSERT INTO config.cost_centers (id, code, name) VALUES ($1, $2, 'CC revision')`, [
    costCenterId,
    `CC-${token(8)}`,
  ]);
  await sql(
    `INSERT INTO config.contract_service_cost_centers (id, contract_service_id, cost_center_id, valid_from)
     VALUES ($1, $2, $3, '2026-01-01')`,
    [uuid(), scenario.contractServiceId, costCenterId],
  );
  const [uom] = await sql<{ id: string }>("SELECT id FROM config.units_of_measure WHERE code = 'h'");
  if (!uom) throw new Error('fixture: no unit of measure seeded with code h');
  const contractItemId = uuid();
  await sql(
    `INSERT INTO config.contract_items (id, contract_service_id, unit_of_measure_id, code, description)
     VALUES ($1, $2, $3, $4, 'Item revision')`,
    [contractItemId, scenario.contractServiceId, uom.id, `IT-${token(8)}`],
  );

  const resolved = await post<{ data: { effects: readonly { allocationId?: string }[] } }>(
    `/execution/units/${unitId}/resolve-allocation`,
    {
      session: field,
      body: envelope({
        payload: { contractServiceId: scenario.contractServiceId, costCenterId, contractItemId },
      }),
    },
  );
  expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
  const executionAllocationId = resolved.body.data.effects[0]?.allocationId;
  if (!executionAllocationId) throw new Error('expected an allocationId in the resolve-allocation effect detail');

  const closed = await post(`/execution/units/${unitId}/close`, {
    session: field,
    body: envelope({ payload: { result: 'COMPLETADA' } }),
  });
  expect(closed.status, JSON.stringify(closed.body)).toBe(200);

  const [version] = await sql<{ id: string }>(
    'SELECT id FROM execution.execution_unit_versions WHERE execution_unit_id = $1 ORDER BY version_no DESC LIMIT 1',
    [unitId],
  );
  if (!version) throw new Error('expected a version to exist after close');

  return {
    clientId: scenario.clientId,
    contractId: scenario.contractId,
    contractServiceId: scenario.contractServiceId,
    unitId,
    executionUnitVersionId: version.id,
    executionAllocationId,
    contractItemId,
    unitOfMeasureId: uom.id,
  };
}

describe('the full chain: review -> commercial -> billing', () => {
  it('runs end to end and the ERP accepts the lot', async () => {
    const ctx = await closedUnitWithVersion();

    const decision = await post<{ data: { subject: { id: string } } }>('/review/decisions', {
      session: reviewer,
      body: envelope({ payload: { executionUnitVersionId: ctx.executionUnitVersionId } }),
    });
    expect(decision.status, JSON.stringify(decision.body)).toBe(200);
    const decisionId = decision.body.data.subject.id;

    const accepted = await post(`/review/decisions/${decisionId}/accept`, {
      session: reviewer,
      body: envelope({ payload: {} }),
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);

    // RGT-04: accepting the review never touches execution.* — the UE stays exactly CERRADA.
    const [unitAfterReview] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM execution.execution_units WHERE id = $1',
      [ctx.unitId],
    );
    expect(unitAfterReview!.state).toBe('CERRADA');

    const derived = await post<{ data: { subject: { id: string } } }>('/commercial/units', {
      session: backoffice,
      body: envelope({
        payload: {
          contractServiceId: ctx.contractServiceId,
          contractItemId: ctx.contractItemId,
          unitOfMeasureId: ctx.unitOfMeasureId,
          sources: [
            { executionUnitVersionId: ctx.executionUnitVersionId, executionAllocationId: ctx.executionAllocationId },
          ],
        },
      }),
    });
    expect(derived.status, JSON.stringify(derived.body)).toBe(200);
    const ucId = derived.body.data.subject.id;

    const [links] = await sql<{ n: string }>(
      'SELECT count(*)::text AS n FROM commercial.commercial_unit_source_links WHERE commercial_unit_id = $1',
      [ucId],
    );
    expect(links!.n).toBe('1');

    const completed = await post(`/commercial/units/${ucId}/complete-requirements`, {
      session: backoffice,
      body: envelope({ payload: { quantity: '3.5' } }),
    });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);

    const entered = await post(`/commercial/units/${ucId}/enter-review`, {
      session: backoffice,
      body: envelope({ payload: {} }),
    });
    expect(entered.status).toBe(200);

    const ucAccepted = await post(`/commercial/units/${ucId}/accept`, {
      session: backoffice,
      body: envelope({ payload: {} }),
    });
    expect(ucAccepted.status, JSON.stringify(ucAccepted.body)).toBe(200);

    const linesBuilt = await post<{ data: { effects: readonly { lineIds?: readonly string[] }[] } }>(
      '/billing/lines',
      { session: backoffice, body: envelope({ payload: { commercialUnitIds: [ucId] } }) },
    );
    expect(linesBuilt.status, JSON.stringify(linesBuilt.body)).toBe(200);
    const lineId = linesBuilt.body.data.effects[0]?.lineIds?.[0];
    expect(lineId).toBeDefined();

    const lotCreated = await post<{ data: { subject: { id: string } } }>('/billing/lots', {
      session: backoffice,
      body: envelope({ payload: { clientId: ctx.clientId, contractId: ctx.contractId, billableLineIds: [lineId] } }),
    });
    expect(lotCreated.status, JSON.stringify(lotCreated.body)).toBe(200);
    const lotId = lotCreated.body.data.subject.id;

    const validated = await post(`/billing/lots/${lotId}/validate`, {
      session: backoffice,
      body: envelope({ payload: {} }),
    });
    expect(validated.status, JSON.stringify(validated.body)).toBe(200);

    const sent = await post<{ data: { effects: readonly { outcome?: string }[] } }>(
      `/billing/lots/${lotId}/send`,
      { session: backoffice, body: envelope({ payload: {} }) },
    );
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.data.effects[0]?.outcome).toBe('ACCEPTED');

    const [lot] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM billing.billing_lots WHERE id = $1',
      [lotId],
    );
    expect(lot!.state).toBe('ACEPTADO_ERP');

    const [attempt] = await sql<{ status: string; external_ref: string | null }>(
      'SELECT status, external_ref FROM billing.erp_submission_attempts WHERE billing_lot_id = $1',
      [lotId],
    );
    expect(attempt!.status).toBe('ACCEPTED');
    expect(attempt!.external_ref).toMatch(/^TEST-/);

    const docRefs = await sql('SELECT id FROM billing.external_document_refs WHERE billing_lot_id = $1', [lotId]);
    expect(docRefs).toHaveLength(1);
  });
});

describe('RUL-070 — only an ACEPTADA and VIGENTE commercial unit produces a line', () => {
  it('refuses to build a line from a UC still INCOMPLETA', async () => {
    const ctx = await closedUnitWithVersion();
    const derived = await post<{ data: { subject: { id: string } } }>('/commercial/units', {
      session: backoffice,
      body: envelope({
        payload: {
          contractServiceId: ctx.contractServiceId,
          contractItemId: ctx.contractItemId,
          unitOfMeasureId: ctx.unitOfMeasureId,
          sources: [
            { executionUnitVersionId: ctx.executionUnitVersionId, executionAllocationId: ctx.executionAllocationId },
          ],
        },
      }),
    });
    const ucId = derived.body.data.subject.id;

    const result = await post('/billing/lines', {
      session: backoffice,
      body: envelope({ payload: { commercialUnitIds: [ucId] } }),
    });
    expect(result.status).toBe(422);
  });
});

describe('commercial.units.reject', () => {
  it('records the reason as a certification observation rather than discarding it', async () => {
    const ctx = await closedUnitWithVersion();
    const derived = await post<{ data: { subject: { id: string } } }>('/commercial/units', {
      session: backoffice,
      body: envelope({
        payload: {
          contractServiceId: ctx.contractServiceId,
          contractItemId: ctx.contractItemId,
          unitOfMeasureId: ctx.unitOfMeasureId,
          sources: [
            { executionUnitVersionId: ctx.executionUnitVersionId, executionAllocationId: ctx.executionAllocationId },
          ],
        },
      }),
    });
    const ucId = derived.body.data.subject.id;
    await post(`/commercial/units/${ucId}/complete-requirements`, {
      session: backoffice,
      body: envelope({ payload: { quantity: '1' } }),
    });
    await post(`/commercial/units/${ucId}/enter-review`, { session: backoffice, body: envelope({ payload: {} }) });

    const rejected = await post(`/commercial/units/${ucId}/reject`, {
      session: backoffice,
      body: envelope({ payload: { reason: 'Cantidad declarada no coincide con la medicion operativa' } }),
    });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);

    const [observation] = await sql<{ description: string; reason_code: string }>(
      "SELECT description, reason_code FROM commercial.certification_observations WHERE commercial_unit_id = $1",
      [ucId],
    );
    expect(observation!.reason_code).toBe('REJECTED');
    expect(observation!.description).toMatch(/medicion/);
  });
});

describe('review.amendment-requests — review requests, execution decides (RGT-04)', () => {
  it('links to a real EnmiendaOperativa and refuses to resolve before it is approved', async () => {
    const ctx = await closedUnitWithVersion();
    const supervisorA = await makeSession({ role: 'supervisor' });
    const supervisorB = await makeSession({ role: 'supervisor' });

    const decision = await post<{ data: { subject: { id: string } } }>('/review/decisions', {
      session: reviewer,
      body: envelope({ payload: { executionUnitVersionId: ctx.executionUnitVersionId } }),
    });
    const decisionId = decision.body.data.subject.id;

    const observed = await post<{ data: { effects: readonly { observationId?: string }[] } }>(
      `/review/decisions/${decisionId}/observe`,
      {
        session: reviewer,
        body: envelope({
          payload: {
            observationKind: 'OPERATIONAL_ERROR',
            description: 'La cantidad registrada en campo parece un error de tipeo',
          },
        }),
      },
    );
    expect(observed.status, JSON.stringify(observed.body)).toBe(200);
    const observationId = observed.body.data.effects[0]?.observationId;

    const requested = await post<{ data: { subject: { id: string } } }>('/review/amendment-requests', {
      session: reviewer,
      body: envelope({
        payload: {
          observationId,
          executionUnitId: ctx.unitId,
          requestedChange: 'Corregir la cantidad registrada',
          justification: 'El valor registrado excede por un orden de magnitud lo esperado para esta tarea',
        },
      }),
    });
    expect(requested.status, JSON.stringify(requested.body)).toBe(200);
    const requestId = requested.body.data.subject.id;

    const amendmentCreated = await post<{ data: { subject: { id: string } } }>('/execution/amendments', {
      session: supervisorA,
      body: envelope({
        payload: {
          targetKind: 'EXECUTION_UNIT',
          executionUnitId: ctx.unitId,
          fieldPath: 'result_reason',
          oldValue: null,
          newValue: 'corregido por solicitud de revision',
          reason: 'Corrección solicitada por Revisión VDS sobre un error de tipeo',
        },
      }),
    });
    const amendmentId = amendmentCreated.body.data.subject.id;

    const tooEarly = await post(`/review/amendment-requests/${requestId}/resolve`, {
      session: reviewer,
      body: envelope({ payload: { amendmentId } }),
    });
    expect(tooEarly.status).toBe(422);

    await post(`/execution/amendments/${amendmentId}/approve`, {
      session: supervisorB,
      body: envelope({ payload: {} }),
    });

    const resolved = await post(`/review/amendment-requests/${requestId}/resolve`, {
      session: reviewer,
      body: envelope({ payload: { amendmentId } }),
    });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);

    const [request] = await sql<{ status: string; amendment_id: string }>(
      'SELECT status, amendment_id FROM review.amendment_requests WHERE id = $1',
      [requestId],
    );
    expect(request!.status).toBe('RESUELTA');
    expect(request!.amendment_id).toBe(amendmentId);
  });
});

describe('read models', () => {
  it('lists and shows the detail of a review decision, with its observations and amendment requests', async () => {
    const ctx = await closedUnitWithVersion();
    const decision = await post<{ data: { subject: { id: string } } }>('/review/decisions', {
      session: reviewer,
      body: envelope({ payload: { executionUnitVersionId: ctx.executionUnitVersionId } }),
    });
    const decisionId = decision.body.data.subject.id;

    const list = await get<{ data: readonly { id: string; state: string }[] }>(
      '/review/decisions?state=PENDIENTE_REVISION',
      { session: reviewer },
    );
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data.some((d) => d.id === decisionId)).toBe(true);

    const detail = await get<{
      data: { decision: { id: string; state: string }; observations: readonly unknown[]; amendmentRequests: readonly unknown[] };
    }>(`/review/decisions/${decisionId}`, { session: reviewer });
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data.decision.state).toBe('PENDIENTE_REVISION');
    expect(detail.body.data.observations).toEqual([]);
  });

  it('lists and shows the detail of a commercial unit, with its N:M source lineage', async () => {
    const ctx = await closedUnitWithVersion();
    const derived = await post<{ data: { subject: { id: string } } }>('/commercial/units', {
      session: backoffice,
      body: envelope({
        payload: {
          contractServiceId: ctx.contractServiceId,
          contractItemId: ctx.contractItemId,
          unitOfMeasureId: ctx.unitOfMeasureId,
          sources: [
            { executionUnitVersionId: ctx.executionUnitVersionId, executionAllocationId: ctx.executionAllocationId },
          ],
        },
      }),
    });
    const ucId = derived.body.data.subject.id;

    const list = await get<{ data: readonly { id: string; state: string; source_count: string }[] }>(
      '/commercial/units?state=INCOMPLETA',
      { session: backoffice },
    );
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const row = list.body.data.find((u) => u.id === ucId);
    expect(row?.source_count).toBe('1');

    const detail = await get<{ data: { unit: { id: string }; sources: readonly { execution_unit_version_id: string }[] } }>(
      `/commercial/units/${ucId}`,
      { session: backoffice },
    );
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data.sources).toHaveLength(1);
    expect(detail.body.data.sources[0]!.execution_unit_version_id).toBe(ctx.executionUnitVersionId);
  });

  it('lists and shows the detail of a billing lot, with its lines, ERP attempts and document refs', async () => {
    const ctx = await closedUnitWithVersion();
    const derived = await post<{ data: { subject: { id: string } } }>('/commercial/units', {
      session: backoffice,
      body: envelope({
        payload: {
          contractServiceId: ctx.contractServiceId,
          contractItemId: ctx.contractItemId,
          unitOfMeasureId: ctx.unitOfMeasureId,
          sources: [
            { executionUnitVersionId: ctx.executionUnitVersionId, executionAllocationId: ctx.executionAllocationId },
          ],
        },
      }),
    });
    const ucId = derived.body.data.subject.id;
    await post(`/commercial/units/${ucId}/complete-requirements`, {
      session: backoffice,
      body: envelope({ payload: { quantity: '2' } }),
    });
    await post(`/commercial/units/${ucId}/enter-review`, { session: backoffice, body: envelope({ payload: {} }) });
    await post(`/commercial/units/${ucId}/accept`, { session: backoffice, body: envelope({ payload: {} }) });

    const linesBuilt = await post<{ data: { effects: readonly { lineIds?: readonly string[] }[] } }>('/billing/lines', {
      session: backoffice,
      body: envelope({ payload: { commercialUnitIds: [ucId] } }),
    });
    const lineId = linesBuilt.body.data.effects[0]?.lineIds?.[0];

    const lotCreated = await post<{ data: { subject: { id: string } } }>('/billing/lots', {
      session: backoffice,
      body: envelope({ payload: { clientId: ctx.clientId, contractId: ctx.contractId, billableLineIds: [lineId] } }),
    });
    const lotId = lotCreated.body.data.subject.id;
    await post(`/billing/lots/${lotId}/validate`, { session: backoffice, body: envelope({ payload: {} }) });
    await post(`/billing/lots/${lotId}/send`, { session: backoffice, body: envelope({ payload: {} }) });

    const list = await get<{ data: readonly { id: string; state: string; line_count: string }[] }>(
      '/billing/lots?state=ACEPTADO_ERP',
      { session: backoffice },
    );
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const row = list.body.data.find((l) => l.id === lotId);
    expect(row?.line_count).toBe('1');

    const detail = await get<{
      data: {
        lot: { id: string; state: string };
        lines: readonly unknown[];
        attempts: readonly { status: string; external_ref: string | null }[];
        documentRefs: readonly unknown[];
      };
    }>(`/billing/lots/${lotId}`, { session: backoffice });
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data.lot.state).toBe('ACEPTADO_ERP');
    expect(detail.body.data.lines).toHaveLength(1);
    expect(detail.body.data.attempts[0]?.status).toBe('ACCEPTED');
    expect(detail.body.data.documentRefs).toHaveLength(1);
  });

  it('404s for a billing lot that does not exist', async () => {
    const result = await get(`/billing/lots/${uuid()}`, { session: backoffice });
    expect(result.status).toBe(404);
  });
});
