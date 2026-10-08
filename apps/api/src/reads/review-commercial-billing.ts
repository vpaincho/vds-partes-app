/**
 * Read models for Review VDS, Commercial and Billing.
 *
 * Three inboxes, three detail views — the same list/detail shape habilita-respond.ts uses, and for
 * the same reason: a queue that shows the current dimension, and a detail that shows every version/
 * link/attempt behind it, never flattened into one status.
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

export async function registerReviewCommercialBillingReadRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------------------ review */

  app.get('/review/decisions', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      const query = request.query as { state?: string };
      readableContractIds(actor, 'review.read');
      const data = await withConnection(async (db) => {
        const { rows } = await db.query(
          `SELECT d.id, d.state::text AS state, d.execution_unit_version_id, d.part_id,
                  reviewer.display_name AS reviewer_name, d.decided_at, d.created_at,
                  (SELECT count(*)::text FROM review.observations o WHERE o.review_decision_id = d.id) AS observation_count
           FROM review.decisions d
           LEFT JOIN platform.identities reviewer ON reviewer.id = d.reviewer_id
           WHERE ($1::text IS NULL OR d.state::text = $1::text)
           ORDER BY d.created_at DESC
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
          source: 'review.decisions',
          note: 'Aceptar una revision no certifica comercialmente ni altera el estado del Parte (CC-06).',
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  app.get('/review/decisions/:decisionId', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      readableContractIds(actor, 'review.read');
      const { decisionId } = request.params as { decisionId: string };
      const data = await withConnection(async (db) => {
        const decision = await db.one(
          `SELECT d.id, d.state::text AS state, d.execution_unit_version_id, d.part_id,
                  reviewer.display_name AS reviewer_name, d.decided_at, d.decision_note, d.created_at
           FROM review.decisions d
           LEFT JOIN platform.identities reviewer ON reviewer.id = d.reviewer_id
           WHERE d.id = $1`,
          [decisionId],
        );
        if (!decision) return null;
        const observations = await db.query(
          `SELECT o.id, o.observation_kind, o.subject_path, o.description, o.raised_at,
                  raiser.display_name AS raised_by_name, o.resolved_at, o.resolution_note
           FROM review.observations o
           LEFT JOIN platform.identities raiser ON raiser.id = o.raised_by
           WHERE o.review_decision_id = $1 ORDER BY o.raised_at`,
          [decisionId],
        );
        const amendmentRequests = await db.query(
          `SELECT ar.id, ar.observation_id, ar.execution_unit_id, ar.part_id, ar.requested_change,
                  ar.justification, ar.status, ar.amendment_id, ar.requested_at, ar.resolved_at
           FROM review.amendment_requests ar
           WHERE ar.review_decision_id = $1 ORDER BY ar.requested_at`,
          [decisionId],
        );
        return { decision, observations: observations.rows, amendmentRequests: amendmentRequests.rows };
      });
      if (!data) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `No existe la DecisionRevision ${decisionId}.`, details: [], ruleIds: [], retryable: false },
          meta: meta(request),
        });
      }
      return { data, meta: { ...meta(request), asOf: instantNow(), source: 'review.decisions' } };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  /* -------------------------------------------------------------------- commercial */

  app.get('/commercial/units', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      const query = request.query as { state?: string };
      readableContractIds(actor, 'commercial.read');
      const data = await withConnection(async (db) => {
        const { rows } = await db.query(
          `SELECT u.id, u.code, u.state::text AS state, u.supersession_state::text AS supersession_state,
                  u.quantity, um.code AS unit_code, ci.code AS contract_item_code,
                  u.period_from, u.period_until, u.derived_at, u.eligible_at, u.accepted_at, u.rejected_at,
                  (SELECT count(*)::text FROM commercial.commercial_unit_source_links l
                    WHERE l.commercial_unit_id = u.id) AS source_count
           FROM commercial.commercial_units u
           JOIN config.units_of_measure um ON um.id = u.unit_of_measure_id
           JOIN config.contract_items ci ON ci.id = u.contract_item_id
           WHERE ($1::text IS NULL OR u.state::text = $1::text)
           ORDER BY u.derived_at DESC
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
          source: 'commercial.commercial_units',
          note: 'state y supersession_state son dimensiones paralelas (C-034/SM-09): una UC aceptada puede requerir recalculo sin perder su aceptacion historica.',
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  app.get('/commercial/units/:unitId', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      readableContractIds(actor, 'commercial.read');
      const { unitId } = request.params as { unitId: string };
      const data = await withConnection(async (db) => {
        const unit = await db.one(
          `SELECT u.id, u.code, u.state::text AS state, u.supersession_state::text AS supersession_state,
                  u.quantity, u.contract_service_id, u.contract_item_id, u.unit_of_measure_id,
                  u.period_from, u.period_until, u.derived_at, u.eligible_at, u.accepted_at, u.rejected_at,
                  u.supersedes_id, u.version
           FROM commercial.commercial_units u WHERE u.id = $1`,
          [unitId],
        );
        if (!unit) return null;
        const sources = await db.query(
          `SELECT l.id, l.execution_unit_version_id, l.execution_allocation_id, l.contribution_quantity,
                  v.version_no, v.effective_at, eu.description AS unit_description
           FROM commercial.commercial_unit_source_links l
           JOIN execution.execution_unit_versions v ON v.id = l.execution_unit_version_id
           JOIN execution.execution_units eu ON eu.id = v.execution_unit_id
           WHERE l.commercial_unit_id = $1`,
          [unitId],
        );
        const observations = await db.query(
          `SELECT id, reason_code, description, raised_at, resolved_at, resolution_note
           FROM commercial.certification_observations WHERE commercial_unit_id = $1 ORDER BY raised_at`,
          [unitId],
        );
        return { unit, sources: sources.rows, observations: observations.rows };
      });
      if (!data) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `No existe la UnidadComercial ${unitId}.`, details: [], ruleIds: [], retryable: false },
          meta: meta(request),
        });
      }
      return { data, meta: { ...meta(request), asOf: instantNow(), source: 'commercial.commercial_units' } };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  /* ----------------------------------------------------------------------- billing */

  app.get('/billing/lots', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      const query = request.query as { state?: string };
      readableContractIds(actor, 'billing.read');
      const data = await withConnection(async (db) => {
        const { rows } = await db.query(
          `SELECT lot.id, lot.code, lot.state::text AS state, cl.name AS client_name,
                  ct.code AS contract_code, lot.validated_at, lot.sent_at, lot.accepted_at,
                  (SELECT count(*)::text FROM billing.billable_lines bl
                    WHERE bl.billing_lot_id = lot.id AND bl.invalidated_at IS NULL) AS line_count
           FROM billing.billing_lots lot
           JOIN config.clients cl ON cl.id = lot.client_id
           LEFT JOIN config.contracts ct ON ct.id = lot.contract_id
           WHERE ($1::text IS NULL OR lot.state::text = $1::text)
           ORDER BY lot.created_at DESC
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
          source: 'billing.billing_lots',
          note: 'El modelo termina en el lote (C-035/MR-11): la factura es una referencia a un documento que el ERP posee.',
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  app.get('/billing/lots/:lotId', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      readableContractIds(actor, 'billing.read');
      const { lotId } = request.params as { lotId: string };
      const data = await withConnection(async (db) => {
        const lot = await db.one(
          `SELECT lot.id, lot.code, lot.state::text AS state, cl.name AS client_name,
                  ct.code AS contract_code, lot.validated_at, lot.sent_at, lot.accepted_at,
                  lot.cancelled_at, lot.version
           FROM billing.billing_lots lot
           JOIN config.clients cl ON cl.id = lot.client_id
           LEFT JOIN config.contracts ct ON ct.id = lot.contract_id
           WHERE lot.id = $1`,
          [lotId],
        );
        if (!lot) return null;
        const lines = await db.query(
          `SELECT bl.id, bl.commercial_unit_id, bl.quantity, um.code AS unit_code,
                  ci.code AS contract_item_code, bl.invalidated_at, bl.invalidation_reason
           FROM billing.billable_lines bl
           JOIN config.units_of_measure um ON um.id = bl.unit_of_measure_id
           JOIN config.contract_items ci ON ci.id = bl.contract_item_id
           WHERE bl.billing_lot_id = $1`,
          [lotId],
        );
        const attempts = await db.query(
          `SELECT id, attempt_no, status, provider_kind, external_ref, error_code, error_message,
                  started_at, completed_at
           FROM billing.erp_submission_attempts WHERE billing_lot_id = $1 ORDER BY attempt_no`,
          [lotId],
        );
        const documentRefs = await db.query(
          `SELECT external_system, external_id, document_kind, document_status, issued_at, observed_at
           FROM billing.external_document_refs WHERE billing_lot_id = $1`,
          [lotId],
        );
        return { lot, lines: lines.rows, attempts: attempts.rows, documentRefs: documentRefs.rows };
      });
      if (!data) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `No existe el LoteFacturacion ${lotId}.`, details: [], ruleIds: [], retryable: false },
          meta: meta(request),
        });
      }
      return { data, meta: { ...meta(request), asOf: instantNow(), source: 'billing.billing_lots' } };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });
}
