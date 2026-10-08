/**
 * API integration: Habilita Respond & Learn, past the Flash Report.
 *
 * One continuous journey — report → triage → classify → escalate → investigate → act → notify →
 * close — proven end to end over the real HTTP/pipeline/Postgres stack, plus the close-without-case
 * branch and the gates that keep a case from closing early:
 *
 *   TPR-019  closing without a case still requires a classification first
 *   RUL-053/TPR-024  a case cannot reach LISTO_PARA_CIERRE/CERRADO with a blocking action
 *                     unverified or a notification obligation unresolved
 *   RUL-049  classification is a new version; the initial report is never edited
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envelope, get, getApp, makeSession, post, sql, teardown, type Session } from './helpers.ts';

let field: Session;
let habilita: Session;

beforeAll(async () => {
  await getApp();
  field = await makeSession({ role: 'field' });
  habilita = await makeSession({ role: 'habilita' });
});

afterAll(teardown);

async function reportEvent(category: string, controlled = true): Promise<string> {
  const result = await post<{ data: { subject: { id: string } } }>('/habilita/events/flash-report', {
    session: field,
    body: envelope({
      payload: {
        initialCategory: category,
        shortDescription: `Reporte de prueba: ${category}`,
        situationControlled: controlled,
        occurredAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      },
    }),
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body.data.subject.id;
}

describe('the full journey: report -> triage -> classify -> escalate -> investigate -> act -> notify -> close', () => {
  it('runs end to end and closes the case only once every gate clears', async () => {
    const eventId = await reportEvent('DERRAME');

    const triaged = await post(`/habilita/events/${eventId}/start-triage`, {
      session: habilita,
      body: envelope({ payload: {} }),
    });
    expect(triaged.status, JSON.stringify(triaged.body)).toBe(200);

    const classified = await post(`/habilita/events/${eventId}/classify`, {
      session: habilita,
      body: envelope({
        payload: { category: 'AMBIENTAL', severity: 'ALTA', justification: 'Derrame sobre suelo natural' },
      }),
    });
    expect(classified.status, JSON.stringify(classified.body)).toBe(200);

    const [classificationRow] = await sql<{ version_no: number; category: string }>(
      'SELECT version_no, category FROM habilita.event_classifications WHERE event_id = $1',
      [eventId],
    );
    expect(classificationRow!.version_no).toBe(1);
    expect(classificationRow!.category).toBe('AMBIENTAL');

    const escalated = await post<{ effects: unknown; data: unknown }>(
      `/habilita/events/${eventId}/escalate-to-case`,
      {
        session: habilita,
        body: envelope({
          payload: { ownerId: habilita.identityId, justification: 'Severidad alta: requiere caso formal' },
        }),
      },
    );
    expect(escalated.status, JSON.stringify(escalated.body)).toBe(200);

    const [eventRow] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM habilita.events WHERE id = $1',
      [eventId],
    );
    expect(eventRow!.state).toBe('ESCALADO_A_CASO');

    const [caseRow] = await sql<{ id: string; state: string; code: string | null }>(
      'SELECT id, state::text AS state, code FROM habilita.cases WHERE event_id = $1',
      [eventId],
    );
    expect(caseRow).toBeDefined();
    expect(caseRow!.state).toBe('ABIERTO');
    const caseId = caseRow!.id;

    const investigationStarted = await post(`/habilita/cases/${caseId}/start-investigation`, {
      session: habilita,
      body: envelope({ payload: {} }),
    });
    expect(investigationStarted.status).toBe(200);

    // A blocking action, created while the investigation is still open — closing the investigation
    // does not require it to be resolved yet (T-CH03/GS-035).
    const actionCreated = await post<{ data: { subject: { id: string } } }>('/habilita/actions', {
      session: habilita,
      body: envelope({
        payload: {
          caseId,
          description: 'Contener y remediar el derrame',
          isBlocking: true,
          responsibleId: habilita.identityId,
        },
      }),
    });
    expect(actionCreated.status, JSON.stringify(actionCreated.body)).toBe(200);
    const actionId = actionCreated.body.data.subject.id;

    // A notification obligation, also still open.
    const notificationCreated = await post<{ data: { subject: { id: string } } }>('/habilita/notifications', {
      session: habilita,
      body: envelope({
        payload: {
          caseId,
          obligationCode: 'NOTIFICAR_AUTORIDAD_AMBIENTAL',
          recipientRole: 'AUTORIDAD_AMBIENTAL',
          responsibleId: habilita.identityId,
        },
      }),
    });
    expect(notificationCreated.status).toBe(200);
    const notificationId = notificationCreated.body.data.subject.id;

    const investigationFinished = await post(`/habilita/cases/${caseId}/finish-investigation`, {
      session: habilita,
      body: envelope({ payload: { summary: 'Causa raíz: falla de junta en acople rápido.' } }),
    });
    expect(investigationFinished.status, JSON.stringify(investigationFinished.body)).toBe(200);

    // RUL-053/TPR-024: the blocking action and the open notification both stand in the way.
    const tooEarly = await post<{ error?: { code: string; blocks?: readonly { reason: string }[] } }>(
      `/habilita/cases/${caseId}/evaluate-closure`,
      { session: habilita, body: envelope({ payload: {} }) },
    );
    expect(tooEarly.status).toBe(422);
    expect(tooEarly.body.error?.blocks?.length).toBeGreaterThanOrEqual(2);

    const [caseAfterEvaluate] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM habilita.cases WHERE id = $1',
      [caseId],
    );
    expect(caseAfterEvaluate!.state).toBe('SEGUIMIENTO_ACCIONES');

    const implemented = await post(`/habilita/actions/${actionId}/implement`, {
      session: habilita,
      body: envelope({ payload: {} }),
    });
    expect(implemented.status).toBe(200);

    const verified = await post(`/habilita/actions/${actionId}/verify`, {
      session: habilita,
      body: envelope({ payload: {} }),
    });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);

    const resolved = await post(`/habilita/notifications/${notificationId}/resolve`, {
      session: habilita,
      body: envelope({ payload: { resolutionNote: 'Autoridad ambiental notificada por correo documentado.' } }),
    });
    expect(resolved.status).toBe(200);

    const readyNow = await post(`/habilita/cases/${caseId}/evaluate-closure`, {
      session: habilita,
      body: envelope({ payload: {} }),
    });
    expect(readyNow.status, JSON.stringify(readyNow.body)).toBe(200);

    const [caseReady] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM habilita.cases WHERE id = $1',
      [caseId],
    );
    expect(caseReady!.state).toBe('LISTO_PARA_CIERRE');

    const closed = await post(`/habilita/cases/${caseId}/close`, {
      session: habilita,
      body: envelope({ payload: { note: 'Acciones verificadas, obligación resuelta.' } }),
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);

    const [caseClosed] = await sql<{ state: string; closed_at: Date | null }>(
      'SELECT state::text AS state, closed_at FROM habilita.cases WHERE id = $1',
      [caseId],
    );
    expect(caseClosed!.state).toBe('CERRADO');
    expect(caseClosed!.closed_at).not.toBeNull();

    const lifecycle = await sql<{ event_type: string }>(
      'SELECT event_type FROM habilita.case_events WHERE case_id = $1 ORDER BY occurred_at',
      [caseId],
    );
    expect(lifecycle.map((r) => r.event_type)).toEqual([
      'ABRIR_CASO',
      'INICIAR_INVESTIGACION',
      'FINALIZAR_INVESTIGACION',
      'EVALUAR_CIERRE_OK',
      'CERRAR',
    ]);
  });

  it('refuses to close while a blocking action is still unverified (RUL-053/TPR-024 at commit)', async () => {
    const eventId = await reportEvent('CASI_ACCIDENTE');
    await post(`/habilita/events/${eventId}/start-triage`, { session: habilita, body: envelope({ payload: {} }) });
    await post(`/habilita/events/${eventId}/classify`, {
      session: habilita,
      body: envelope({ payload: { category: 'SEGURIDAD', severity: 'MEDIA' } }),
    });
    const escalated = await post<{ data: unknown }>(`/habilita/events/${eventId}/escalate-to-case`, {
      session: habilita,
      body: envelope({ payload: { ownerId: habilita.identityId, justification: 'Requiere seguimiento' } }),
    });
    expect(escalated.status).toBe(200);
    const [caseRow] = await sql<{ id: string }>('SELECT id FROM habilita.cases WHERE event_id = $1', [eventId]);
    const caseId = caseRow!.id;

    await post(`/habilita/cases/${caseId}/start-investigation`, { session: habilita, body: envelope({ payload: {} }) });
    await post(`/habilita/actions`, {
      session: habilita,
      body: envelope({
        payload: { caseId, description: 'Acción bloqueante sin resolver', isBlocking: true, responsibleId: habilita.identityId },
      }),
    });
    await post(`/habilita/cases/${caseId}/finish-investigation`, {
      session: habilita,
      body: envelope({ payload: { summary: 'Sin hallazgos adicionales.' } }),
    });

    // evaluate-closure itself is a no-op here (the state stays SEGUIMIENTO_ACCIONES, as above);
    // forcing the state directly to LISTO_PARA_CIERRE proves the DB trigger is the real backstop,
    // independent of the application-level gate.
    await sql("UPDATE habilita.cases SET state = 'LISTO_PARA_CIERRE', ready_for_closure_at = now() WHERE id = $1", [
      caseId,
    ]);

    const closeAttempt = await post(`/habilita/cases/${caseId}/close`, {
      session: habilita,
      body: envelope({ payload: {} }),
    });
    expect(closeAttempt.status).toBe(422);
  });
});

describe('habilita.events.close-without-case', () => {
  it('refuses to close without a classification first (TPR-019)', async () => {
    const eventId = await reportEvent('OTRO');
    const result = await post(`/habilita/events/${eventId}/close-without-case`, {
      session: habilita,
      body: envelope({ payload: { justification: 'No requiere seguimiento formal' } }),
    });
    expect(result.status).toBe(422);
  });

  it('closes once classified, with no case opened', async () => {
    const eventId = await reportEvent('OTRO');
    await post(`/habilita/events/${eventId}/start-triage`, { session: habilita, body: envelope({ payload: {} }) });
    await post(`/habilita/events/${eventId}/classify`, {
      session: habilita,
      body: envelope({ payload: { category: 'MENOR', severity: 'BAJA' } }),
    });

    const result = await post(`/habilita/events/${eventId}/close-without-case`, {
      session: habilita,
      body: envelope({ payload: { justification: 'Severidad baja, sin seguimiento formal' } }),
    });
    expect(result.status, JSON.stringify(result.body)).toBe(200);

    const [row] = await sql<{ state: string }>(
      'SELECT state::text AS state FROM habilita.events WHERE id = $1',
      [eventId],
    );
    expect(row!.state).toBe('CERRADO_SIN_CASO');
    const cases = await sql('SELECT id FROM habilita.cases WHERE event_id = $1', [eventId]);
    expect(cases).toHaveLength(0);
  });
});

describe('habilita.events.discard', () => {
  it('discards a duplicate with cause and reference, never reusable afterwards (TPR-021)', async () => {
    const originalId = await reportEvent('DERRAME');
    const duplicateId = await reportEvent('DERRAME');

    const discarded = await post(`/habilita/events/${duplicateId}/discard`, {
      session: habilita,
      body: envelope({
        payload: { reason: 'Duplicado del evento original reportado minutos antes', duplicateOfId: originalId },
      }),
    });
    expect(discarded.status, JSON.stringify(discarded.body)).toBe(200);

    const blocked = await post(`/habilita/events/${duplicateId}/start-triage`, {
      session: habilita,
      body: envelope({ payload: {} }),
    });
    expect(blocked.status).toBe(422);
  });
});

describe('read models', () => {
  it('lists events with their current classification and linked case, without exposing version history', async () => {
    const eventId = await reportEvent('DERRAME');
    await post(`/habilita/events/${eventId}/start-triage`, { session: habilita, body: envelope({ payload: {} }) });
    await post(`/habilita/events/${eventId}/classify`, {
      session: habilita,
      body: envelope({ payload: { category: 'AMBIENTAL', severity: 'ALTA' } }),
    });

    const list = await get<{ data: readonly { id: string; current_category: string | null }[] }>(
      '/habilita/events?state=CLASIFICADO',
      { session: habilita },
    );
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const row = list.body.data.find((r) => r.id === eventId);
    expect(row?.current_category).toBe('AMBIENTAL');
  });

  it('returns the full detail with classification history, case, actions and notifications', async () => {
    const eventId = await reportEvent('FUGA_GAS');
    await post(`/habilita/events/${eventId}/start-triage`, { session: habilita, body: envelope({ payload: {} }) });
    await post(`/habilita/events/${eventId}/classify`, {
      session: habilita,
      body: envelope({ payload: { category: 'SEGURIDAD', severity: 'MEDIA' } }),
    });
    await post(`/habilita/events/${eventId}/escalate-to-case`, {
      session: habilita,
      body: envelope({ payload: { ownerId: habilita.identityId, justification: 'Requiere seguimiento' } }),
    });

    const detail = await get<{
      data: {
        event: { id: string; state: string };
        classifications: readonly { version_no: number }[];
        case: { id: string; state: string } | null;
      };
    }>(`/habilita/events/${eventId}`, { session: habilita });
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data.event.state).toBe('ESCALADO_A_CASO');
    expect(detail.body.data.classifications).toHaveLength(1);
    expect(detail.body.data.case?.state).toBe('ABIERTO');
  });

  it('404s for an event that does not exist', async () => {
    const result = await get(`/habilita/events/${crypto.randomUUID()}`, { session: habilita });
    expect(result.status).toBe(404);
  });
});

describe('habilita.notifications.attempt-channel — RGT-16', () => {
  it('labels the attempt TEST_FIXTURE and never resolves the obligation by itself', async () => {
    const eventId = await reportEvent('DERRAME');
    await post(`/habilita/events/${eventId}/start-triage`, { session: habilita, body: envelope({ payload: {} }) });
    await post(`/habilita/events/${eventId}/classify`, {
      session: habilita,
      body: envelope({ payload: { category: 'AMBIENTAL', severity: 'ALTA' } }),
    });
    const escalated = await post(`/habilita/events/${eventId}/escalate-to-case`, {
      session: habilita,
      body: envelope({ payload: { ownerId: habilita.identityId, justification: 'Requiere seguimiento' } }),
    });
    expect(escalated.status).toBe(200);
    const [caseRow] = await sql<{ id: string }>('SELECT id FROM habilita.cases WHERE event_id = $1', [eventId]);
    const caseId = caseRow!.id;

    const notificationCreated = await post<{ data: { subject: { id: string } } }>('/habilita/notifications', {
      session: habilita,
      body: envelope({
        payload: {
          caseId,
          obligationCode: 'NOTIFICAR_AUTORIDAD',
          recipientRole: 'AUTORIDAD_AMBIENTAL',
          responsibleId: habilita.identityId,
        },
      }),
    });
    const notificationId = notificationCreated.body.data.subject.id;

    const attempted = await post<{ data: { effects: readonly { channelKind?: string; accepted?: boolean }[] } }>(
      `/habilita/notifications/${notificationId}/attempt-channel`,
      { session: habilita, body: envelope({ payload: {} }) },
    );
    expect(attempted.status, JSON.stringify(attempted.body)).toBe(200);
    expect(attempted.body.data.effects[0]?.channelKind).toBe('TEST_FIXTURE');
    expect(attempted.body.data.effects[0]?.accepted).toBe(true);

    const [row] = await sql<{ status: string; channel_kind: string; channel_reference: string | null }>(
      'SELECT status, channel_kind, channel_reference FROM habilita.notifications WHERE id = $1',
      [notificationId],
    );
    expect(row!.channel_kind).toBe('TEST_FIXTURE');
    expect(row!.channel_reference).toMatch(/^TEST-NOTIF-/);
    // RGT-16: a channel send is not a resolution — status moved off PENDIENTE but never to RESUELTA.
    expect(row!.status).toBe('EN_CURSO');

    // Only an explicit resolve, with its own evidence, closes the obligation.
    const resolved = await post(`/habilita/notifications/${notificationId}/resolve`, {
      session: habilita,
      body: envelope({ payload: { resolutionNote: 'Autoridad notificada y confirmó recepción por escrito.' } }),
    });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    const [resolvedRow] = await sql<{ status: string }>(
      'SELECT status FROM habilita.notifications WHERE id = $1',
      [notificationId],
    );
    expect(resolvedRow!.status).toBe('RESUELTA');
  });
});
