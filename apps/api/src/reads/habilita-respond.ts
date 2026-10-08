/**
 * Habilita Respond & Learn read models.
 *
 * Two shapes, matching the two surfaces the field and Habilita need:
 *
 *  - `/habilita/events` is a list — the inbox a reporter or triage works from, with the current
 *    classification (never the full version history) and whether a case already exists.
 *  - `/habilita/events/:id` is the full detail: the immutable original report, every classification
 *    version (RUL-048/049 — the point is that these are plural and none of them replaces another),
 *    the case if one was opened, its actions and notifications, and the case's own append-only
 *    lifecycle log.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { instantNow, isDomainError, HTTP_STATUS } from '@vds/kernel';
import { withConnection } from '../platform/db.ts';
import { readableContractIds, unauthenticated } from '../platform/authz.ts';

const meta = (request: FastifyRequest) => ({ requestId: request.requestId, serverTime: instantNow() });

function sendError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (isDomainError(error)) {
    return reply.code(HTTP_STATUS[error.code]).send({ ...error.toJSON(), meta: meta(request) });
  }
  request.log?.error({ err: error, requestId: request.requestId }, 'read failed');
  return reply.code(500).send({
    error: { code: 'INVARIANT_VIOLATED', message: 'Error interno.', details: [], ruleIds: [], retryable: false },
    meta: meta(request),
  });
}

export async function registerHabilitaRespondReadRoutes(app: FastifyInstance): Promise<void> {
  app.get('/habilita/events', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });

    try {
      const query = request.query as { state?: string };
      readableContractIds(actor, 'habilita.read');

      const data = await withConnection(async (db) => {
        const { rows } = await db.query(
          `SELECT e.id, e.code, e.state::text AS state, e.initial_category, e.short_description,
                  e.situation_controlled, e.occurred_at, e.reported_at,
                  reporter.display_name AS reported_by_name,
                  tl.code AS location_code, tl.name AS location_name, e.unmapped_location,
                  c.category AS current_category, c.severity AS current_severity,
                  (SELECT id FROM habilita.cases WHERE event_id = e.id) AS case_id,
                  (SELECT state::text FROM habilita.cases WHERE event_id = e.id) AS case_state
           FROM habilita.events e
           LEFT JOIN platform.identities reporter ON reporter.id = e.reported_by
           LEFT JOIN config.technical_locations tl ON tl.id = e.technical_location_id
           LEFT JOIN habilita.event_classifications c ON c.id = e.current_classification_id
           WHERE ($1::text IS NULL OR e.state::text = $1::text)
           ORDER BY e.reported_at DESC
           LIMIT 200`,
          [query.state ?? null],
        );
        return rows;
      });

      return {
        data,
        meta: {
          ...meta(request),
          asOf: instantNow(),
          source: 'habilita.events + event_classifications + cases',
          note:
            'El reporte inicial no se edita: lo que cambia es el estado y la clasificación vigente ' +
            '(RUL-048/049). Un evento puede no tener caso — C-025/GS-033.',
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  app.get('/habilita/events/:eventId', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });

    try {
      readableContractIds(actor, 'habilita.read');
      const { eventId } = request.params as { eventId: string };

      const data = await withConnection(async (db) => {
        const event = await db.one(
          `SELECT e.id, e.code, e.state::text AS state, e.initial_category, e.short_description,
                  e.situation_controlled, e.occurred_at, e.detected_at, e.reported_at,
                  reporter.display_name AS reported_by_name,
                  tl.code AS location_code, tl.name AS location_name, e.unmapped_location,
                  e.closed_without_case_at, e.discarded_at, e.discarded_reason, e.duplicate_of_id,
                  e.version
           FROM habilita.events e
           LEFT JOIN platform.identities reporter ON reporter.id = e.reported_by
           LEFT JOIN config.technical_locations tl ON tl.id = e.technical_location_id
           WHERE e.id = $1`,
          [eventId],
        );
        if (!event) return null;

        const { rows: classifications } = await db.query(
          `SELECT ec.id, ec.version_no, ec.category, ec.severity, ec.event_type_code,
                  ec.justification, ec.classified_at, classifier.display_name AS classified_by_name
           FROM habilita.event_classifications ec
           LEFT JOIN platform.identities classifier ON classifier.id = ec.classified_by
           WHERE ec.event_id = $1 ORDER BY ec.version_no`,
          [eventId],
        );

        const kase = await db.one<{ id: string }>(
          `SELECT id, code, state::text AS state, owner_id, investigation_state,
                  investigation_summary, opened_at, investigation_started_at,
                  investigation_finished_at, ready_for_closure_at, closed_at, version
           FROM habilita.cases WHERE event_id = $1`,
          [eventId],
        );

        let actions: unknown[] = [];
        let notifications: unknown[] = [];
        let caseLifecycle: unknown[] = [];
        if (kase) {
          const actionsResult = await db.query(
            `SELECT ca.id, ca.code, ca.state::text AS state, ca.description, ca.action_kind,
                    ca.is_blocking, ca.responsible_id, responsible.display_name AS responsible_name,
                    ca.due_at, ca.implemented_at, ca.verified_at, ca.cancelled_at,
                    ca.cancellation_reason
             FROM habilita.corrective_actions ca
             LEFT JOIN platform.identities responsible ON responsible.id = ca.responsible_id
             WHERE ca.case_id = $1 ORDER BY ca.created_at`,
            [kase.id],
          );
          actions = actionsResult.rows;

          const notificationsResult = await db.query(
            `SELECT n.id, n.obligation_code, n.recipient_role, n.responsible_id,
                    responsible.display_name AS responsible_name, n.due_at, n.status,
                    n.resolved_at, n.resolution_note
             FROM habilita.notifications n
             LEFT JOIN platform.identities responsible ON responsible.id = n.responsible_id
             WHERE n.case_id = $1 ORDER BY n.created_at`,
            [kase.id],
          );
          notifications = notificationsResult.rows;

          const lifecycleResult = await db.query(
            `SELECT ce.event_type, ce.from_state::text AS from_state, ce.to_state::text AS to_state,
                    ce.actor_id, actor.display_name AS actor_name, ce.reason, ce.occurred_at
             FROM habilita.case_events ce
             LEFT JOIN platform.identities actor ON actor.id = ce.actor_id
             WHERE ce.case_id = $1 ORDER BY ce.occurred_at`,
            [kase.id],
          );
          caseLifecycle = lifecycleResult.rows;
        }

        return { event, classifications, case: kase, actions, notifications, caseLifecycle };
      });

      if (!data) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `No existe el EventoHabilita ${eventId}.`, details: [], ruleIds: [], retryable: false },
          meta: meta(request),
        });
      }
      return { data, meta: { ...meta(request), asOf: instantNow(), source: 'habilita.events' } };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });
}
