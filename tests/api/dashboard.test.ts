/**
 * API integration: dashboards as projections, never a second source of truth (RGT-14).
 *
 * Each dashboard carries source and asOf, and state/supersession_state stay in separate buckets
 * (C-034) rather than being fused into one number.
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
  type Session,
} from './helpers.ts';

let field: Session;
let reviewer: Session;
let backoffice: Session;
let client: Session;

beforeAll(async () => {
  await getApp();
  field = await makeSession({ role: 'field' });
  reviewer = await makeSession({ role: 'review' });
  backoffice = await makeSession({ role: 'backoffice' });
  client = await makeSession({ role: 'client' });
});

afterAll(teardown);

describe('GET /dashboard/operational', () => {
  it('counts Partes and UE by state, with source and asOf, reflecting a just-started unit', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });

    const result = await get<{
      data: {
        partsByState: readonly { state: string; count: number }[];
        unitsByState: readonly { state: string; count: number }[];
        openIntervals: number;
      };
      meta: { source: string; asOf: string };
    }>('/dashboard/operational', { session: field });

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.meta.source).toMatch(/execution\.parts/);
    expect(result.body.meta.asOf).toBeDefined();

    const enEjecucion = result.body.data.unitsByState.find((r) => r.state === 'EN_EJECUCION');
    expect(enEjecucion).toBeDefined();
    expect(enEjecucion!.count).toBeGreaterThanOrEqual(1);
    expect(result.body.data.openIntervals).toBeGreaterThanOrEqual(1);
  });

  it('refuses an actor without execution.read', async () => {
    const result = await get('/dashboard/operational', { session: client });
    expect(result.status).toBe(403);
  });
});

describe('GET /dashboard/review', () => {
  it('counts a real decision by state, with source and asOf', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    await post(`/execution/units/${unitId}/start`, { session: field, body: envelope({ payload: {} }) });
    await post(`/execution/units/${unitId}/close`, {
      session: field,
      body: envelope({ payload: { result: 'COMPLETADA' } }),
    });
    const [version] = await sql<{ id: string }>(
      'SELECT id FROM execution.execution_unit_versions WHERE execution_unit_id = $1',
      [unitId],
    );
    await post('/review/decisions', {
      session: reviewer,
      body: envelope({ payload: { executionUnitVersionId: version!.id } }),
    });

    const result = await get<{
      data: { decisionsByState: readonly { state: string; count: number }[] };
      meta: { source: string };
    }>('/dashboard/review', { session: reviewer });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.meta.source).toMatch(/review\.decisions/);
    const pending = result.body.data.decisionsByState.find((r) => r.state === 'PENDIENTE_REVISION');
    expect(pending?.count).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /dashboard/commercial', () => {
  it('reports state and supersession_state as separate buckets (C-034)', async () => {
    const result = await get<{
      data: {
        unitsByState: readonly { state: string; count: number }[];
        unitsBySupersessionState: readonly { state: string; count: number }[];
        lotsByState: readonly { state: string; count: number }[];
      };
      meta: { source: string; note: string };
    }>('/dashboard/commercial', { session: backoffice });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data.unitsByState).toBeInstanceOf(Array);
    expect(result.body.data.unitsBySupersessionState).toBeInstanceOf(Array);
    expect(result.body.meta.note).toMatch(/dimensiones paralelas/);
  });
});
