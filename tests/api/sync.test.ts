/**
 * API integration: the sync batch door and bundle read.
 *
 * `/sync/commands` is what a device replays through after reconnecting: this proves a queued
 * command run through the batch endpoint behaves exactly like the same command sent live —
 * including idempotency (RGT-06) — and that one bad item in a batch does not fail the others.
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
  uuid,
  type Session,
} from './helpers.ts';

let field: Session;
let planner: Session;

beforeAll(async () => {
  await getApp();
  field = await makeSession({ role: 'field' });
  planner = await makeSession({ role: 'planner' });
});

afterAll(teardown);

describe('POST /sync/commands', () => {
  it('applies a queued command the same way the live route would', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);

    const result = await post<{ data: { results: readonly { status: string; commandName: string }[] } }>(
      '/sync/commands',
      {
        session: field,
        body: {
          commands: [
            {
              commandName: 'execution.units.start',
              subjectId: unitId,
              envelope: envelope({ payload: {} }),
            },
          ],
        },
      },
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data.results).toHaveLength(1);
    expect(result.body.data.results[0]!.status).toBe('applied');

    const [unit] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM execution.execution_units WHERE id = $1',
      [unitId],
    );
    expect(unit!.state).toBe('EN_EJECUCION');
  });

  it('reports a per-item error without failing the rest of the batch', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const otherScenario = await makeScenario();
    const { unitId: otherUnitId } = await preparePartWithUnit(field, otherScenario);

    const result = await post<{
      data: { results: readonly { status: string; commandName: string; error?: { code: string } }[] };
    }>('/sync/commands', {
      session: field,
      body: {
        commands: [
          // Refers to a UE that does not exist: must fail without aborting the batch.
          {
            commandName: 'execution.units.start',
            subjectId: uuid(),
            envelope: envelope({ payload: {} }),
          },
          { commandName: 'execution.units.start', subjectId: unitId, envelope: envelope({ payload: {} }) },
          {
            commandName: 'execution.units.start',
            subjectId: otherUnitId,
            envelope: envelope({ payload: {} }),
          },
        ],
      },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data.results).toHaveLength(3);
    expect(result.body.data.results[0]!.status).toBe('error');
    expect(result.body.data.results[0]!.error?.code).toBe('NOT_FOUND');
    expect(result.body.data.results[1]!.status).toBe('applied');
    expect(result.body.data.results[2]!.status).toBe('applied');
  });

  it('replays the same command id idempotently when the batch is resent (RGT-06)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const commandId = uuid();

    const first = await post<{ data: { results: readonly { result?: { receipt: { outcome: string } } }[] } }>(
      '/sync/commands',
      {
        session: field,
        body: {
          commands: [
            {
              commandName: 'execution.units.start',
              subjectId: unitId,
              envelope: envelope({ commandId, payload: {} }),
            },
          ],
        },
      },
    );
    expect(first.body.data.results[0]!.result?.receipt.outcome).toBe('APPLIED');

    const replay = await post<{ data: { results: readonly { result?: { receipt: { outcome: string } } }[] } }>(
      '/sync/commands',
      {
        session: field,
        body: {
          commands: [
            {
              commandName: 'execution.units.start',
              subjectId: unitId,
              envelope: envelope({ commandId, payload: {} }),
            },
          ],
        },
      },
    );
    expect(replay.status).toBe(200);
    expect(replay.body.data.results[0]!.result?.receipt.outcome).toBe('REPLAYED');

    const timeEvents = await sql('SELECT id FROM execution.time_events WHERE execution_unit_id = $1', [unitId]);
    expect(timeEvents).toHaveLength(1);
  });

  it('refuses an unregistered command name as a per-item error', async () => {
    const result = await post<{ data: { results: readonly { status: string; error?: { code: string } }[] } }>(
      '/sync/commands',
      {
        session: field,
        body: { commands: [{ commandName: 'execution.units.does-not-exist', envelope: envelope() }] },
      },
    );
    expect(result.status).toBe(200);
    expect(result.body.data.results[0]!.status).toBe('error');
    expect(result.body.data.results[0]!.error?.code).toBe('NOT_FOUND');
  });

  it('refuses an empty batch', async () => {
    const result = await post('/sync/commands', { session: field, body: { commands: [] } });
    expect(result.status).toBe(400);
  });
});

describe('GET /sync/bundles/:assignmentId', () => {
  it('serves the bundle dispatch built, scoped to the identity it was built for', async () => {
    const scenario = await makeScenario();
    await sql(`UPDATE planning.planned_assignments SET state = 'READY' WHERE id = $1`, [scenario.assignmentId]);
    await post(`/planning/assignments/${scenario.assignmentId}/evaluate-readiness`, {
      session: planner,
      body: envelope(),
    });
    const dispatched = await post(`/planning/assignments/${scenario.assignmentId}/dispatch`, {
      session: planner,
      body: envelope({ payload: { identityId: field.identityId, bundleTtlMinutes: 60 } }),
    });
    expect(dispatched.status, JSON.stringify(dispatched.body)).toBe(200);

    const ownBundle = await get<{ data: { contentHash: string; expired: boolean } }>(
      `/sync/bundles/${scenario.assignmentId}`,
      { session: field },
    );
    expect(ownBundle.status, JSON.stringify(ownBundle.body)).toBe(200);
    expect(ownBundle.body.data.contentHash).toHaveLength(64);
    expect(ownBundle.body.data.expired).toBe(false);

    // Built for `field`'s identity: another identity reading it gets NOT_FOUND, not someone else's
    // context (13) — a bundle is not a shared document.
    const otherActor = await makeSession({ role: 'field' });
    const otherRead = await get(`/sync/bundles/${scenario.assignmentId}`, { session: otherActor });
    expect(otherRead.status).toBe(404);
  });

  it('reports NOT_FOUND for an assignment that was never dispatched', async () => {
    const result = await get(`/sync/bundles/${uuid()}`, { session: field });
    expect(result.status).toBe(404);
  });
});
