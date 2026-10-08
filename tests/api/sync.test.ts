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
let supervisor: Session;

beforeAll(async () => {
  await getApp();
  field = await makeSession({ role: 'field' });
  planner = await makeSession({ role: 'planner' });
  supervisor = await makeSession({ role: 'supervisor' });
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

/**
 * RGT-11: a device goes offline, its session is revoked server-side, and it reconnects and
 * replays its outbox. The batch door must not re-authorise what was declared — it preserves the
 * fact as a discrepancy for a `sync.reconcile` holder to decide.
 */
describe('RGT-11: session revoked while offline', () => {
  it('preserves a declared command as a discrepancy instead of applying or rejecting it outright', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);

    const revokedField = await makeSession({ role: 'field' });
    await sql('UPDATE platform.sessions SET revoked_at = now() WHERE id = $1', [revokedField.sessionId]);

    const commandId = uuid();
    const result = await post<{
      data: {
        results: readonly {
          commandId: string;
          commandName: string;
          status: string;
          error?: { code: string; httpStatus: number; retryable: boolean };
        }[];
      };
    }>('/sync/commands', {
      session: revokedField,
      body: {
        commands: [
          {
            commandName: 'execution.units.start',
            subjectId: unitId,
            envelope: envelope({ commandId, payload: {} }),
          },
        ],
      },
    });

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.data.results).toHaveLength(1);
    const item = result.body.data.results[0]!;
    expect(item.status).toBe('error');
    expect(item.error?.code).toBe('GATE_BLOCKED');
    expect(item.error?.httpStatus).toBe(409);
    expect(item.error?.retryable).toBe(false);

    // Nothing was applied: the unit never started.
    const [unit] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM execution.execution_units WHERE id = $1',
      [unitId],
    );
    expect(unit!.state).not.toBe('EN_EJECUCION');

    // The declaration itself is preserved verbatim, not dropped.
    const [discrepancy] = await sql<{
      discrepancy_kind: string;
      subject_kind: string;
      subject_id: string;
      identity_id: string;
      declared: { commandName: string; envelope: { commandId: string } };
      resolved_at: Date | null;
    }>(
      `SELECT discrepancy_kind, subject_kind, subject_id, identity_id, declared, resolved_at
       FROM sync.discrepancies WHERE command_id = $1`,
      [commandId],
    );
    expect(discrepancy).toBeDefined();
    expect(discrepancy!.discrepancy_kind).toBe('SESSION_REVOKED');
    expect(discrepancy!.subject_kind).toBe('UnidadEjecucion');
    expect(discrepancy!.subject_id).toBe(unitId);
    expect(discrepancy!.identity_id).toBe(revokedField.identityId);
    expect(discrepancy!.declared.commandName).toBe('execution.units.start');
    expect(discrepancy!.declared.envelope.commandId).toBe(commandId);
    expect(discrepancy!.resolved_at).toBeNull();
  });

  it('refuses an unrevoked, merely-unknown bearer the same way as always', async () => {
    const result = await post('/sync/commands', {
      session: { sessionId: uuid(), identityId: uuid(), token: uuid(), role: 'field' },
      body: { commands: [{ commandName: 'execution.units.start', subjectId: uuid(), envelope: envelope() }] },
    });
    expect(result.status).toBe(401);
  });

  it('lists the open discrepancy for a sync.reconcile holder, then resolves it', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const revokedField = await makeSession({ role: 'field' });
    await sql('UPDATE platform.sessions SET revoked_at = now() WHERE id = $1', [revokedField.sessionId]);
    const commandId = uuid();
    await post('/sync/commands', {
      session: revokedField,
      body: {
        commands: [
          {
            commandName: 'execution.units.start',
            subjectId: unitId,
            envelope: envelope({ commandId, payload: {} }),
          },
        ],
      },
    });

    const list = await get<{ data: readonly { id: string; subjectId: string; resolvedAt: string | null }[] }>(
      '/sync/discrepancies',
      { session: supervisor },
    );
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const found = list.body.data.find((d) => d.subjectId === unitId);
    expect(found).toBeDefined();
    expect(found!.resolvedAt).toBeNull();

    const resolved = await post(`/sync/discrepancies/${found!.id}/resolve`, {
      session: supervisor,
      body: envelope({
        payload: { resolution: 'RECORDED_NON_COMPLIANT', resolutionNote: 'Sesión revocada; se registra sin autorizar.' },
      }),
    });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);

    const [row] = await sql<{ resolved_at: Date | null; resolution: string }>(
      'SELECT resolved_at, resolution FROM sync.discrepancies WHERE id = $1',
      [found!.id],
    );
    expect(row!.resolved_at).not.toBeNull();
    expect(row!.resolution).toBe('RECORDED_NON_COMPLIANT');

    // Resolved, it drops off the open list and shows up in the resolved one.
    const openAfter = await get<{ data: readonly { id: string }[] }>('/sync/discrepancies', { session: supervisor });
    expect(openAfter.body.data.some((d) => d.id === found!.id)).toBe(false);
    const resolvedList = await get<{ data: readonly { id: string }[] }>('/sync/discrepancies?resolved=true', {
      session: supervisor,
    });
    expect(resolvedList.body.data.some((d) => d.id === found!.id)).toBe(true);

    // Resolving an already-resolved discrepancy is refused, not silently repeated.
    const again = await post(`/sync/discrepancies/${found!.id}/resolve`, {
      session: supervisor,
      body: envelope({
        payload: { resolution: 'ACCEPTED_AS_DECLARED', resolutionNote: 'Segundo intento, debe bloquear.' },
      }),
    });
    expect(again.status, JSON.stringify(again.body)).toBe(422);
  });

  it('blocks an AMENDED resolution with no amendmentId', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const revokedField = await makeSession({ role: 'field' });
    await sql('UPDATE platform.sessions SET revoked_at = now() WHERE id = $1', [revokedField.sessionId]);
    const commandId = uuid();
    await post('/sync/commands', {
      session: revokedField,
      body: {
        commands: [
          {
            commandName: 'execution.units.start',
            subjectId: unitId,
            envelope: envelope({ commandId, payload: {} }),
          },
        ],
      },
    });
    const [discrepancy] = await sql<{ id: string }>('SELECT id FROM sync.discrepancies WHERE command_id = $1', [
      commandId,
    ]);

    const result = await post(`/sync/discrepancies/${discrepancy!.id}/resolve`, {
      session: supervisor,
      body: envelope({ payload: { resolution: 'AMENDED', resolutionNote: 'Falta la enmienda referenciada.' } }),
    });
    expect(result.status, JSON.stringify(result.body)).toBe(422);
  });

  it('refuses sync.discrepancies.resolve to an actor without sync.reconcile', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const revokedField = await makeSession({ role: 'field' });
    await sql('UPDATE platform.sessions SET revoked_at = now() WHERE id = $1', [revokedField.sessionId]);
    const commandId = uuid();
    await post('/sync/commands', {
      session: revokedField,
      body: {
        commands: [
          {
            commandName: 'execution.units.start',
            subjectId: unitId,
            envelope: envelope({ commandId, payload: {} }),
          },
        ],
      },
    });
    const [discrepancy] = await sql<{ id: string }>('SELECT id FROM sync.discrepancies WHERE command_id = $1', [
      commandId,
    ]);

    const result = await post(`/sync/discrepancies/${discrepancy!.id}/resolve`, {
      session: planner,
      body: envelope({ payload: { resolution: 'ACCEPTED_AS_DECLARED', resolutionNote: 'Planner no tiene la capability.' } }),
    });
    expect(result.status, JSON.stringify(result.body)).toBe(403);

    const listAsPlanner = await get('/sync/discrepancies', { session: planner });
    expect(listAsPlanner.status).toBe(403);
  });
});
