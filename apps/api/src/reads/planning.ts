/**
 * Planning read models.
 *
 * One projection, three views. 07 is explicit that Gantt, resource calendar and month are the same
 * data over a different period and grouping — the prototype already worked that way (`vGantt`,
 * `vWeek`, `vMonth` all read `S.trabajos`), and splitting them into three server shapes would be the
 * fastest way to let them drift. So `/planning/timeline` returns rows and the client groups them.
 *
 * What this adds over the prototype's `S.trabajos`:
 *
 *  - **Readiness carries its validity.** READY is temporal (C-015); a row says when it was evaluated
 *    and until when, so a stale READY looks stale instead of looking approved.
 *  - **Occupancy is two named metrics, not one number.** 15 flags this: the prototype showed a single
 *    "ocupación" that silently mixed resource-days with hour utilisation. Both are returned, each
 *    labelled, and the client never computes a third.
 *  - **Pending control is visible on the bar.** A directive emitted and not yet applied is the
 *    difference between what the planner decided and what the crew is working to (C-017).
 *  - **The approved window is intention.** It is never recomputed from execution; plan-vs-real
 *    compares two separate things (RGT-03).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { instantNow, isDomainError, HTTP_STATUS, type Uuid } from '@vds/kernel';
import { withConnection } from '../platform/db.ts';
import { readableContractIds, readableContractIdsAny, unauthenticated } from '../platform/authz.ts';

const meta = (request: FastifyRequest) => ({
  requestId: request.requestId,
  serverTime: instantNow(),
});

function sendError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (isDomainError(error)) {
    return reply.code(HTTP_STATUS[error.code]).send({ ...error.toJSON(), meta: meta(request) });
  }
  request.log?.error({ err: error, requestId: request.requestId }, 'planning read failed');
  return reply.code(500).send({
    error: {
      code: 'INVARIANT_VIOLATED',
      message: 'Error interno.',
      details: [],
      ruleIds: [],
      retryable: false,
    },
    meta: meta(request),
  });
}

const notFound = (request: FastifyRequest, message: string) => ({
  error: { code: 'NOT_FOUND', message, details: [], ruleIds: [], retryable: false },
  meta: meta(request),
});

/**
 * The contract reachable from an assignment, through its planned units.
 *
 * Repeated in each query rather than factored into a view: the scope boundary should be visible at
 * every call site that claims to enforce it (RGT-15), not hidden one indirection away.
 */
const CONTRACT_OF_ASSIGNMENT = `
  SELECT DISTINCT cv.contract_id
  FROM planning.planned_units pu
  JOIN config.contract_services cs ON cs.id = pu.contract_service_id
  JOIN config.contract_versions cv ON cv.id = cs.contract_version_id
  WHERE pu.planned_assignment_id = a.id`;

export async function registerPlanningReadRoutes(app: FastifyInstance): Promise<void> {
  /**
   * The timeline. Feeds Gantt, resource calendar and month alike.
   *
   * The period defaults to a window around today rather than everything: a planner opens the surface
   * on the current operation, and an unbounded read of a year of plans is a different question.
   */
  app.get('/planning/timeline', async (request, reply) => {
    const actor = request.actor;
    if (!actor) {
      return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    }

    try {
      const query = request.query as { from?: string; to?: string };
      // Scope from grants, never from the query string.
      const contractIds = readableContractIds(actor, 'planning.read');

      const rows = await withConnection(async (db) => {
        const { rows } = await db.query(
          `SELECT a.id, a.code, a.state::text AS state, a.window_start, a.window_end,
                  a.operational_date::text AS operational_date, a.shift_id, a.priority,
                  a.requires_work_permit, a.dispatched_at, a.not_performed_reason, a.version,
                  pt.code AS expected_part_type,
                  a.crew_id, cr.name AS crew_name,
                  a.resource_id, r.code AS resource_code, r.name AS resource_name,
                  pv.id AS plan_version_id, pv.version_no, pv.state::text AS plan_version_state,
                  pl.id AS plan_id, pl.name AS plan_name, pl.base_id,
                  -- Current readiness. Temporal by design, so its window travels with it (C-015).
                  re.result AS readiness, re.evaluated_at AS readiness_at,
                  re.valid_until AS readiness_until,
                  coalesce(jsonb_array_length(re.causes), 0) AS readiness_cause_count,
                  -- A decision taken but not yet in force. ACK is not application (RUL-056).
                  (SELECT count(*) FROM control.directive_targets dt
                     JOIN control.directives d ON d.id = dt.directive_id
                    WHERE dt.planned_assignment_id = a.id
                      AND d.state IN ('EMITIDA', 'RECIBIDA', 'RECONOCIDA')) AS directives_open,
                  (SELECT count(*) FROM planning.extension_requests er
                    WHERE er.planned_assignment_id = a.id AND er.state = 'PENDIENTE')
                    AS extension_pending,
                  -- Plan-vs-real is a comparison of two things, so the link is reported, not merged.
                  (SELECT count(DISTINCT l.part_id) FROM planning.plan_execution_links l
                    WHERE l.planned_assignment_id = a.id AND l.part_id IS NOT NULL) AS linked_parts
           FROM planning.planned_assignments a
           JOIN planning.plan_versions pv ON pv.id = a.plan_version_id
           JOIN planning.plans pl ON pl.id = pv.plan_id
           LEFT JOIN config.part_types pt ON pt.id = a.expected_part_type_id
           LEFT JOIN config.crews cr ON cr.id = a.crew_id
           LEFT JOIN config.resources r ON r.id = a.resource_id
           LEFT JOIN LATERAL (
             SELECT result, evaluated_at, valid_until, causes
             FROM planning.readiness_evaluations
             WHERE planned_assignment_id = a.id AND invalidated_at IS NULL
             ORDER BY evaluated_at DESC LIMIT 1
           ) re ON true
           WHERE ($1::timestamptz IS NULL OR a.window_end >= $1::timestamptz)
             AND ($2::timestamptz IS NULL OR a.window_start <= $2::timestamptz)
             AND ($3::uuid[] IS NULL OR EXISTS (${CONTRACT_OF_ASSIGNMENT} AND cv.contract_id = ANY($3::uuid[])))
           ORDER BY a.window_start, a.code NULLS LAST
           LIMIT 500`,
          [query.from ?? null, query.to ?? null, contractIds === null ? null : [...contractIds]],
        );
        return rows;
      });

      return {
        data: rows,
        meta: {
          ...meta(request),
          asOf: instantNow(),
          source: 'planning.planned_assignments + readiness_evaluations + control.directives',
          scoped: contractIds !== null,
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  /**
   * Occupancy per resource and per crew, for the resource calendar.
   *
   * Two metrics, both named. 15: "definir las dos métricas de ocupación (recurso-día vs utilización
   * horaria) sin cambiarlas en silencio". `occupied_days` counts distinct operational dates with at
   * least one assignment; `planned_hours` sums the approved windows clipped to the period. They
   * answer different questions and a single "ocupación %" cannot stand for both.
   */
  app.get('/planning/occupancy', async (request, reply) => {
    const actor = request.actor;
    if (!actor) {
      return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    }

    try {
      const query = request.query as { from?: string; to?: string };
      const contractIds = readableContractIds(actor, 'planning.read');
      if (!query.from || !query.to) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Se requieren `from` y `to`: la ocupación sólo tiene sentido en un período declarado.',
            details: [{ path: 'from', message: 'Instante ISO requerido.' }],
            ruleIds: [],
            retryable: false,
          },
          meta: meta(request),
        });
      }

      const data = await withConnection(async (db) => {
        const { rows } = await db.query(
          `WITH scoped AS (
             SELECT a.id, a.crew_id, a.resource_id, a.operational_date,
                    a.window_start, a.window_end, a.state
             FROM planning.planned_assignments a
             WHERE a.window_end >= $1::timestamptz AND a.window_start <= $2::timestamptz
               AND a.state NOT IN ('CANCELADA', 'SUPERSEDIDA')
               AND ($3::uuid[] IS NULL OR EXISTS (${CONTRACT_OF_ASSIGNMENT} AND cv.contract_id = ANY($3::uuid[])))
           ),
           per_subject AS (
             SELECT 'RECURSO' AS subject_kind, resource_id AS subject_id, operational_date,
                    window_start, window_end, id
             FROM scoped WHERE resource_id IS NOT NULL
             UNION ALL
             SELECT 'CUADRILLA', crew_id, operational_date, window_start, window_end, id
             FROM scoped WHERE crew_id IS NOT NULL
           )
           SELECT s.subject_kind, s.subject_id,
                  coalesce(r.code, cr.code) AS subject_code,
                  coalesce(r.name, cr.name) AS subject_name,
                  count(DISTINCT s.id) AS assignments,
                  -- Metric 1: resource-days. "Ese recurso estuvo comprometido ese día."
                  count(DISTINCT s.operational_date) AS occupied_days,
                  -- Metric 2: planned hours inside the period. Overlapping windows are counted once,
                  -- because two assignments on one resource at one time is a conflict, not 200%.
                  round(
                    extract(epoch FROM coalesce(
                      (SELECT sum(upper(x) - lower(x))
                       FROM unnest(range_agg(tstzrange(
                         greatest(s.window_start, $1::timestamptz),
                         least(s.window_end, $2::timestamptz), '[)'))) AS x),
                      interval '0')) / 3600.0, 2) AS planned_hours
           FROM per_subject s
           LEFT JOIN config.resources r ON r.id = s.subject_id AND s.subject_kind = 'RECURSO'
           LEFT JOIN config.crews cr ON cr.id = s.subject_id AND s.subject_kind = 'CUADRILLA'
           GROUP BY s.subject_kind, s.subject_id, r.code, r.name, cr.code, cr.name
           ORDER BY s.subject_kind, subject_code NULLS LAST`,
          [query.from, query.to, contractIds === null ? null : [...contractIds]],
        );
        return rows;
      });

      return {
        data,
        meta: {
          ...meta(request),
          asOf: instantNow(),
          source: 'planning.planned_assignments',
          metrics: {
            occupied_days:
              'Días operativos distintos con al menos una asignación. Mide compromiso, no uso.',
            planned_hours:
              'Horas de ventana aprobada dentro del período, contando un solapamiento una sola vez. ' +
              'Mide intención de uso, no horas ejecutadas: eso vive en el Parte.',
          },
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  /**
   * The drawer: everything about one assignment, with the dimensions kept apart.
   *
   * KEEP from the prototype (`drawer()`), extended with what the prototype could not hold: the
   * version chain, the nominations, the readiness history INCLUDING the invalidated evaluations, the
   * directives and their lifecycle, the extension requests and their resolution, and the N:M link to
   * the Partes that actually materialised.
   *
   * The invalidated readiness rows are returned on purpose. RUL-015 invalidates a READY without
   * erasing it: the planner needs to see that it was ready and why it stopped being ready.
   */
  app.get('/planning/assignments/:assignmentId', async (request, reply) => {
    const actor = request.actor;
    if (!actor) {
      return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    }

    try {
      const { assignmentId } = request.params as { assignmentId: string };
      const contractIds = readableContractIds(actor, 'planning.read');

      const data = await withConnection(async (db) => {
        const assignment = await db.one<Record<string, unknown>>(
          `SELECT a.id, a.code, a.state::text AS state, a.window_start, a.window_end,
                  a.operational_date::text AS operational_date, a.shift_id, a.priority,
                  a.requires_work_permit, a.dispatched_at, a.fulfilled_at,
                  a.not_performed_at, a.not_performed_reason, a.cancelled_at, a.superseded_at,
                  a.version,
                  pt.code AS expected_part_type, pt.name AS expected_part_type_name,
                  a.crew_id, cr.name AS crew_name, a.resource_id, r.code AS resource_code,
                  pv.id AS plan_version_id, pv.version_no, pv.state::text AS plan_version_state,
                  pv.approved_at, pv.superseded_at AS version_superseded_at,
                  pl.id AS plan_id, pl.name AS plan_name, pl.state::text AS plan_state
           FROM planning.planned_assignments a
           JOIN planning.plan_versions pv ON pv.id = a.plan_version_id
           JOIN planning.plans pl ON pl.id = pv.plan_id
           LEFT JOIN config.part_types pt ON pt.id = a.expected_part_type_id
           LEFT JOIN config.crews cr ON cr.id = a.crew_id
           LEFT JOIN config.resources r ON r.id = a.resource_id
           WHERE a.id = $1
             AND ($2::uuid[] IS NULL OR EXISTS (${CONTRACT_OF_ASSIGNMENT} AND cv.contract_id = ANY($2::uuid[])))`,
          [assignmentId, contractIds === null ? null : [...contractIds]],
        );
        if (!assignment) return null;

        const { rows: units } = await db.query(
          `SELECT pu.id, pu.description, pu.planned_quantity, pu.sequence_no,
                  s.code AS service_code, s.name AS service_name,
                  tl.code AS location_code, tl.name AS location_name,
                  um.code AS unit_of_measure,
                  ci.code AS contract_item_code,
                  cl.name AS client_name
           FROM planning.planned_units pu
           LEFT JOIN config.services s ON s.id = pu.service_id
           LEFT JOIN config.technical_locations tl ON tl.id = pu.technical_location_id
           LEFT JOIN config.units_of_measure um ON um.id = pu.unit_of_measure_id
           LEFT JOIN config.contract_items ci ON ci.id = pu.contract_item_id
           LEFT JOIN config.contract_services cs ON cs.id = pu.contract_service_id
           LEFT JOIN config.contract_versions cv2 ON cv2.id = cs.contract_version_id
           LEFT JOIN config.contracts ct ON ct.id = cv2.contract_id
           LEFT JOIN config.clients cl ON cl.id = ct.client_id
           WHERE pu.planned_assignment_id = $1
           ORDER BY pu.sequence_no NULLS LAST, pu.created_at`,
          [assignmentId],
        );

        const { rows: people } = await db.query(
          `SELECT pa.id, pa.person_id, p.code AS person_code, p.first_name, p.last_name,
                  pa.role, pa.planned_from, pa.planned_until
           FROM planning.planned_person_assignments pa
           JOIN config.people p ON p.id = pa.person_id
           WHERE pa.planned_assignment_id = $1
           ORDER BY pa.role, p.last_name`,
          [assignmentId],
        );

        const { rows: resources } = await db.query(
          `SELECT ra.id, ra.resource_id, r.code AS resource_code, r.name AS resource_name,
                  ra.role, ra.planned_from, ra.planned_until
           FROM planning.planned_resource_assignments ra
           JOIN config.resources r ON r.id = ra.resource_id
           WHERE ra.planned_assignment_id = $1
           ORDER BY ra.role, r.code`,
          [assignmentId],
        );

        // Invalidated evaluations included deliberately: RUL-015 invalidates, it does not erase.
        const { rows: readiness } = await db.query(
          `SELECT id, result, causes, dependencies, evaluated_at, valid_until, invalidated_at,
                  decision_trace_id
           FROM planning.readiness_evaluations
           WHERE planned_assignment_id = $1
           ORDER BY evaluated_at DESC
           LIMIT 20`,
          [assignmentId],
        );

        const { rows: directives } = await db.query(
          `SELECT d.id, d.code, d.directive_type, d.state::text AS state, d.reason,
                  d.issued_at, d.valid_until, d.received_at, d.acknowledged_at, d.applied_at,
                  d.applied_effect_ref, d.rejected_at, d.rejection_reason,
                  (SELECT jsonb_agg(jsonb_build_object(
                     'eventType', e.event_type, 'occurredAt', e.occurred_at,
                     'fromState', e.from_state, 'toState', e.to_state)
                     ORDER BY e.occurred_at)
                   FROM control.directive_events e WHERE e.directive_id = d.id) AS lifecycle
           FROM control.directives d
           JOIN control.directive_targets dt ON dt.directive_id = d.id
           WHERE dt.planned_assignment_id = $1
           ORDER BY d.issued_at DESC`,
          [assignmentId],
        );

        const { rows: extensions } = await db.query(
          `SELECT er.id, er.state::text AS state, er.additional_days, er.reason,
                  er.approved_window_end, er.proposed_window_end,
                  er.requested_at, er.resolved_at, er.resolution_note,
                  er.resulting_assignment_id
           FROM planning.extension_requests er
           WHERE er.planned_assignment_id = $1
           ORDER BY er.requested_at DESC`,
          [assignmentId],
        );

        // The version chain, so "the approved window survived" is visible rather than asserted.
        const { rows: versions } = await db.query(
          `SELECT pv.id, pv.version_no, pv.state::text AS state, pv.approved_at, pv.superseded_at,
                  pv.superseded_by_id,
                  (SELECT count(*) FROM planning.planned_assignments x WHERE x.plan_version_id = pv.id)
                    AS assignments,
                  (SELECT jsonb_build_object('windowStart', x.window_start, 'windowEnd', x.window_end)
                   FROM planning.planned_assignments x
                   WHERE x.plan_version_id = pv.id AND x.code = (
                     SELECT code FROM planning.planned_assignments WHERE id = $1)
                   LIMIT 1) AS window_in_version
           FROM planning.plan_versions pv
           WHERE pv.plan_id = (SELECT plan_id FROM planning.plan_versions
                                WHERE id = (SELECT plan_version_id FROM planning.planned_assignments
                                             WHERE id = $1))
           ORDER BY pv.version_no DESC`,
          [assignmentId],
        );

        const { rows: links } = await db.query(
          `SELECT l.id, l.link_kind, l.contribution_note, l.part_id, l.execution_unit_id,
                  p.code AS part_code, p.state::text AS part_state,
                  p.operational_date::text AS part_operational_date,
                  u.code AS unit_code, u.state::text AS unit_state
           FROM planning.plan_execution_links l
           LEFT JOIN execution.parts p ON p.id = l.part_id
           LEFT JOIN execution.execution_units u ON u.id = l.execution_unit_id
           WHERE l.planned_assignment_id = $1
           ORDER BY l.created_at`,
          [assignmentId],
        );

        const { rows: permits } = await db.query(
          `SELECT DISTINCT wp.id, wp.code, wp.permit_type, wp.state::text AS state,
                  wp.valid_from, wp.valid_until, wp.activated_at, wp.scope_description
           FROM habilita.work_permits wp
           WHERE wp.technical_location_id IN (
             SELECT technical_location_id FROM planning.planned_units
             WHERE planned_assignment_id = $1 AND technical_location_id IS NOT NULL)
           ORDER BY wp.valid_from DESC NULLS LAST
           LIMIT 20`,
          [assignmentId],
        );

        return {
          assignment,
          units,
          people,
          resources,
          readiness,
          directives,
          extensions,
          versions,
          links,
          permits,
        };
      });

      if (!data) {
        return reply.code(404).send(notFound(request, `No existe la asignación ${assignmentId}.`));
      }
      return {
        data,
        meta: {
          ...meta(request),
          asOf: instantNow(),
          source: 'planning + control + habilita (proyección, no fuente)',
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  /**
   * Who can be nominated to this assignment, and what already stands against them.
   *
   * The list is a planning question, so it is guarded by `planning.nominate` rather than by
   * `config.read`: a planner who may nominate may see the roster, and nothing more.
   *
   * Each candidate carries the documentary blocks and the overlaps already visible. That is
   * convenience, not authority — RGT-17: nominate re-evaluates, and a document that expires between
   * this read and the command still blocks. A candidate shown as clear here is not pre-authorised.
   */
  app.get('/planning/assignments/:assignmentId/nominees', async (request, reply) => {
    const actor = request.actor;
    if (!actor) {
      return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    }

    try {
      const { assignmentId } = request.params as { assignmentId: string };
      const search = (request.query as { q?: string }).q?.trim() ?? '';
      readableContractIds(actor, 'planning.nominate');

      const data = await withConnection(async (db) => {
        const assignment = await db.one<{ window_start: Date; window_end: Date; crew_id: Uuid | null }>(
          'SELECT window_start, window_end, crew_id FROM planning.planned_assignments WHERE id = $1',
          [assignmentId],
        );
        if (!assignment) return null;

        const { rows: people } = await db.query(
          `SELECT p.id, p.code, p.first_name, p.last_name, p.affiliation,
                  -- Already on this assignment, so the UI does not offer a duplicate nomination.
                  EXISTS (SELECT 1 FROM planning.planned_person_assignments x
                           WHERE x.planned_assignment_id = $1 AND x.person_id = p.id) AS already_nominated,
                  EXISTS (SELECT 1 FROM config.crew_memberships m
                           WHERE m.crew_id = $2 AND m.person_id = p.id
                             AND (m.valid_until IS NULL OR m.valid_until > $3::timestamptz)) AS in_crew,
                  -- Hard documentary requirements not currently satisfied for the window.
                  -- Requirements with no COMPLIANT document covering the whole window. The status
                  -- actually found travels with each one: "vencido" and "nunca presentado" are
                  -- different problems and the planner resolves them differently.
                  (SELECT jsonb_agg(jsonb_build_object(
                     'requirementCode', r.code, 'requirementName', r.name,
                     'severity', r.severity::text, 'overrideableVia', r.overrideable_via,
                     'status', coalesce(best.status, 'SIN_DOCUMENTO')))
                   FROM habilita.requirements r
                   LEFT JOIN LATERAL (
                     SELECT cp.status FROM habilita.compliances cp
                     WHERE cp.requirement_id = r.id AND cp.person_id = p.id
                     ORDER BY (cp.status = 'COMPLIANT') DESC, cp.valid_from DESC
                     LIMIT 1
                   ) best ON true
                   WHERE r.applies_to = 'PERSON'
                     AND r.valid_from <= $3::timestamptz
                     AND (r.valid_until IS NULL OR r.valid_until >= $3::timestamptz)
                     AND NOT EXISTS (
                       SELECT 1 FROM habilita.compliances ok
                       WHERE ok.requirement_id = r.id AND ok.person_id = p.id
                         AND ok.status = 'COMPLIANT'
                         AND ok.valid_from <= $3::timestamptz
                         AND (ok.valid_until IS NULL OR ok.valid_until >= $4::timestamptz))
                  ) AS unmet_requirements,
                  -- Overlaps already on record. The verdict is the rule's, not this read's.
                  (SELECT count(*) FROM planning.planned_person_assignments x
                    JOIN planning.planned_assignments a2 ON a2.id = x.planned_assignment_id
                   WHERE x.person_id = p.id
                     AND a2.id <> $1
                     AND a2.state NOT IN ('CANCELADA', 'SUPERSEDIDA', 'NO_REALIZADA')
                     AND tstzrange(a2.window_start, a2.window_end, '[)')
                         && tstzrange($3::timestamptz, $4::timestamptz, '[)')) AS overlapping
           FROM config.people p
           WHERE p.is_active
             AND ($5::text = '' OR p.code ILIKE '%' || $5 || '%'
                  OR p.first_name ILIKE '%' || $5 || '%' OR p.last_name ILIKE '%' || $5 || '%')
           -- Already nominated first, then the crew's own people: those are the two groups a planner
           -- is actually looking at. The rest is a search, not a list to scroll.
           ORDER BY already_nominated DESC, in_crew DESC, p.last_name, p.first_name
           LIMIT 100`,
          [assignmentId, assignment.crew_id, assignment.window_start, assignment.window_end, search],
        );

        const { rows: resources } = await db.query(
          `SELECT r.id, r.code, r.name, rt.code AS resource_type,
                  EXISTS (SELECT 1 FROM planning.planned_resource_assignments x
                           WHERE x.planned_assignment_id = $1 AND x.resource_id = r.id) AS already_nominated,
                  (SELECT count(*) FROM planning.planned_resource_assignments x
                    JOIN planning.planned_assignments a2 ON a2.id = x.planned_assignment_id
                   WHERE x.resource_id = r.id
                     AND a2.id <> $1
                     AND a2.state NOT IN ('CANCELADA', 'SUPERSEDIDA', 'NO_REALIZADA')
                     AND tstzrange(a2.window_start, a2.window_end, '[)')
                         && tstzrange($2::timestamptz, $3::timestamptz, '[)')) AS overlapping
           FROM config.resources r
           LEFT JOIN config.resource_types rt ON rt.id = r.resource_type_id
           WHERE r.is_active
             AND ($4::text = '' OR r.code ILIKE '%' || $4 || '%' OR r.name ILIKE '%' || $4 || '%')
           ORDER BY already_nominated DESC, rt.code NULLS LAST, r.code
           LIMIT 100`,
          [assignmentId, assignment.window_start, assignment.window_end, search],
        );

        return { people, resources };
      });

      if (!data) {
        return reply.code(404).send(notFound(request, `No existe la asignación ${assignmentId}.`));
      }
      return {
        data,
        meta: {
          ...meta(request),
          asOf: instantNow(),
          source: 'config.people + config.resources + habilita.requirements/compliances',
          note:
            'Lo que se muestra acá es contexto. El comando vuelve a evaluar: un documento vencido ' +
            'entre esta lectura y la nominación sigue bloqueando (RGT-17).',
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  /**
   * The directive inbox.
   *
   * Four states are four facts (C-017), so this returns all of them rather than a boolean "pending".
   * The prototype had no equivalent at all: a planner edited the job and the crew found out by
   * looking at it.
   */
  app.get('/control/directives', async (request, reply) => {
    const actor = request.actor;
    if (!actor) {
      return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    }

    try {
      const query = request.query as { state?: string; open?: string };
      // No `control.read` capability exists: a planner reaches the inbox through control.emit and
      // a crew through control.apply. Inventing one would lock both out of their own decisions.
      readableContractIdsAny(actor, ['control.emit', 'control.apply', 'planning.read']);
      const onlyOpen = query.open === 'true';

      const data = await withConnection(async (db) => {
        const { rows } = await db.query(
          `SELECT d.id, d.code, d.directive_type, d.state::text AS state, d.reason,
                  d.issued_at, d.valid_until, d.received_at, d.acknowledged_at,
                  d.applied_at, d.applied_effect_ref, d.rejected_at, d.rejection_reason,
                  d.expired_at, d.version,
                  i.display_name AS issued_by_name,
                  (SELECT jsonb_agg(jsonb_build_object(
                     'targetKind', t.target_kind,
                     'plannedAssignmentId', t.planned_assignment_id,
                     'partId', t.part_id,
                     'executionUnitId', t.execution_unit_id,
                     'workPermitId', t.work_permit_id,
                     'assignmentCode', a.code))
                   FROM control.directive_targets t
                   LEFT JOIN planning.planned_assignments a ON a.id = t.planned_assignment_id
                   WHERE t.directive_id = d.id) AS targets,
                  (SELECT jsonb_agg(jsonb_build_object(
                     'eventType', e.event_type, 'occurredAt', e.occurred_at,
                     'fromState', e.from_state, 'toState', e.to_state)
                     ORDER BY e.occurred_at)
                   FROM control.directive_events e WHERE e.directive_id = d.id) AS lifecycle
           FROM control.directives d
           LEFT JOIN platform.identities i ON i.id = d.issued_by
           WHERE ($1::text IS NULL OR d.state::text = $1::text)
             AND (NOT $2::boolean OR d.state IN ('EMITIDA', 'RECIBIDA', 'RECONOCIDA'))
           ORDER BY d.issued_at DESC
           LIMIT 200`,
          [query.state ?? null, onlyOpen],
        );
        return rows;
      });

      return {
        data,
        meta: {
          ...meta(request),
          asOf: instantNow(),
          source: 'control.directives + directive_events',
          note:
            'RECONOCIDA no es APLICADA. Un ACK dice que llegó, no que se hizo (RUL-056, TPR-016).',
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  /**
   * Work permits, with their coverage.
   *
   * The prototype held a permit as three fields inside the Parte (`num`, `firmo`, `hora`) and checked
   * that they were present. This returns the permit as an object with a lifecycle and the units it
   * covers, because PD-0394 was exactly the gap between "a permit exists" and "a permit covered this
   * work at this moment" (RUL-042).
   */
  app.get('/habilita/permits', async (request, reply) => {
    const actor = request.actor;
    if (!actor) {
      return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    }

    try {
      const query = request.query as { state?: string; locationId?: string };
      readableContractIds(actor, 'habilita.read');

      const data = await withConnection(async (db) => {
        const { rows } = await db.query(
          `SELECT wp.id, wp.code, wp.permit_type, wp.state::text AS state,
                  wp.scope_description, wp.external_authority,
                  wp.valid_from, wp.valid_until, wp.activated_at, wp.suspended_at,
                  wp.closed_at, wp.expired_at, wp.approved_at, wp.version,
                  tl.code AS location_code, tl.name AS location_name,
                  cl.name AS client_name,
                  requester.display_name AS requested_by_name,
                  approver.display_name AS approved_by_name,
                  (SELECT count(*) FROM habilita.work_permit_execution_units c
                    WHERE c.work_permit_id = wp.id) AS covered_units,
                  (SELECT jsonb_agg(jsonb_build_object(
                     'eventType', e.event_type, 'occurredAt', e.occurred_at,
                     'fromState', e.from_state, 'toState', e.to_state)
                     ORDER BY e.occurred_at)
                   FROM habilita.work_permit_events e WHERE e.work_permit_id = wp.id) AS lifecycle
           FROM habilita.work_permits wp
           LEFT JOIN config.technical_locations tl ON tl.id = wp.technical_location_id
           LEFT JOIN config.clients cl ON cl.id = wp.client_id
           LEFT JOIN platform.identities requester ON requester.id = wp.requested_by
           LEFT JOIN platform.identities approver ON approver.id = wp.approved_by
           WHERE ($1::text IS NULL OR wp.state::text = $1::text)
             AND ($2::uuid IS NULL OR wp.technical_location_id = $2::uuid)
           ORDER BY wp.valid_from DESC NULLS LAST, wp.created_at DESC
           LIMIT 200`,
          [query.state ?? null, (query.locationId as Uuid | undefined) ?? null],
        );
        return rows;
      });

      return {
        data,
        meta: {
          ...meta(request),
          asOf: instantNow(),
          source: 'habilita.work_permits + work_permit_events',
          note:
            'APROBADO no habilita: sólo VIGENTE con cobertura temporal y de alcance en el instante ' +
            'real autoriza un inicio (RUL-043, RUL-042). VENCIDO bloquea y alerta, nunca autocierra.',
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });
}
