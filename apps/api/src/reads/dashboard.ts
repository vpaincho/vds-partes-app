/**
 * Dashboards: operational, review, commercial — each a count-by-dimension projection, never a
 * second source of truth.
 *
 * Every response carries `source` and `asOf` at the top level, matching the convention every other
 * read route in this codebase already follows (RGT-14: a figure's source and recency must be
 * visible, and a later state change must never make an earlier fact disappear — nothing here
 * deletes anything; a count is always `SELECT count(*) ... GROUP BY state` over rows that stay in
 * place).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { instantNow, isDomainError, HTTP_STATUS } from '@vds/kernel';
import { withConnection } from '../platform/db.ts';
import { readableContractIds, readableContractIdsAny, unauthenticated } from '../platform/authz.ts';

const meta = (request: FastifyRequest) => ({ requestId: request.requestId, serverTime: instantNow() });

function sendError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (isDomainError(error)) {
    return reply.code(HTTP_STATUS[error.code]).send({ ...error.toJSON(), meta: meta(request) });
  }
  request.log?.error({ err: error, requestId: request.requestId }, 'dashboard read failed');
  return reply.code(500).send({
    error: { code: 'INVARIANT_VIOLATED', message: 'Error interno.', details: [], ruleIds: [], retryable: false },
    meta: meta(request),
  });
}

/** `[{state, count}]` from a `GROUP BY state` — the shape every section of every dashboard uses. */
function countsBy<R extends { readonly count: string }>(
  rows: readonly R[],
  key: keyof R,
): readonly { readonly state: string; readonly count: number }[] {
  return rows.map((r) => ({ state: String(r[key]), count: Number(r.count) }));
}

export async function registerDashboardReadRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard/operational', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      readableContractIds(actor, 'execution.read');
      const data = await withConnection(async (db) => {
        const parts = await db.query<{ state: string; count: string }>(
          'SELECT state::text AS state, count(*)::text AS count FROM execution.parts GROUP BY state',
        );
        const units = await db.query<{ state: string; count: string }>(
          'SELECT state::text AS state, count(*)::text AS count FROM execution.execution_units GROUP BY state',
        );
        const openIntervals = await db.one<{ count: string }>(
          'SELECT count(*)::text AS count FROM execution.time_events WHERE ended_at IS NULL',
        );
        const permits = await db.query<{ state: string; count: string }>(
          'SELECT state::text AS state, count(*)::text AS count FROM habilita.work_permits GROUP BY state',
        );
        const openDirectives = await db.one<{ count: string }>(
          `SELECT count(*)::text AS count FROM control.directives WHERE state IN ('EMITIDA', 'RECIBIDA', 'RECONOCIDA')`,
        );
        return {
          partsByState: countsBy(parts.rows, 'state'),
          unitsByState: countsBy(units.rows, 'state'),
          openIntervals: Number(openIntervals?.count ?? '0'),
          permitsByState: countsBy(permits.rows, 'state'),
          openDirectives: Number(openDirectives?.count ?? '0'),
        };
      });
      return {
        data,
        meta: {
          ...meta(request),
          asOf: instantNow(),
          source: 'execution.parts + execution_units + time_events, habilita.work_permits, control.directives',
          note: 'Estado actual por dimensión. Ningún histórico desaparece: un cambio de estado agrega una fila, nunca borra la anterior (RGT-14).',
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  app.get('/dashboard/review', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      readableContractIds(actor, 'review.read');
      const data = await withConnection(async (db) => {
        const decisions = await db.query<{ state: string; count: string }>(
          'SELECT state::text AS state, count(*)::text AS count FROM review.decisions GROUP BY state',
        );
        const observations = await db.query<{ observation_kind: string; count: string }>(
          'SELECT observation_kind, count(*)::text AS count FROM review.observations GROUP BY observation_kind',
        );
        const amendmentRequests = await db.query<{ status: string; count: string }>(
          'SELECT status, count(*)::text AS count FROM review.amendment_requests GROUP BY status',
        );
        return {
          decisionsByState: countsBy(decisions.rows, 'state'),
          observationsByKind: countsBy(observations.rows, 'observation_kind'),
          amendmentRequestsByStatus: countsBy(amendmentRequests.rows, 'status'),
        };
      });
      return {
        data,
        meta: {
          ...meta(request),
          asOf: instantNow(),
          source: 'review.decisions + observations + amendment_requests',
          note: 'Aceptar una revisión no certifica comercialmente (CC-06): este tablero no mezcla esa dimensión con commercial.*.',
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  app.get('/dashboard/commercial', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      const contractIds = readableContractIdsAny(actor, [
        'commercial.read',
        'commercial.client.read',
      ]);
      const contractScope = contractIds === null ? null : [...contractIds];
      const data = await withConnection(async (db) => {
        const units = await db.query<{ state: string; count: string }>(
          `SELECT u.state::text AS state, count(*)::text AS count
             FROM commercial.commercial_units u
             JOIN config.contract_services cs ON cs.id = u.contract_service_id
             JOIN config.contract_versions cv ON cv.id = cs.contract_version_id
            WHERE ($1::uuid[] IS NULL OR cv.contract_id = ANY($1::uuid[]))
            GROUP BY u.state`,
          [contractScope],
        );
        const supersession = await db.query<{ supersession_state: string; count: string }>(
          `SELECT u.supersession_state::text AS supersession_state, count(*)::text AS count
             FROM commercial.commercial_units u
             JOIN config.contract_services cs ON cs.id = u.contract_service_id
             JOIN config.contract_versions cv ON cv.id = cs.contract_version_id
            WHERE ($1::uuid[] IS NULL OR cv.contract_id = ANY($1::uuid[]))
            GROUP BY u.supersession_state`,
          [contractScope],
        );
        const lots = await db.query<{ state: string; count: string }>(
          `SELECT state::text AS state, count(*)::text AS count
             FROM billing.billing_lots
            WHERE ($1::uuid[] IS NULL OR contract_id = ANY($1::uuid[]))
            GROUP BY state`,
          [contractScope],
        );
        return {
          unitsByState: countsBy(units.rows, 'state'),
          // Separate from state on purpose (C-034/SM-09): a dashboard that fused these would hide
          // exactly the "accepted but needs recalculation" case RUL-065 exists to surface.
          unitsBySupersessionState: countsBy(supersession.rows, 'supersession_state'),
          lotsByState: countsBy(lots.rows, 'state'),
        };
      });
      return {
        data,
        meta: {
          ...meta(request),
          asOf: instantNow(),
          source: 'commercial.commercial_units + billing.billing_lots',
          note: 'state y supersession_state son dimensiones paralelas (C-034): se muestran por separado, nunca fusionadas en una sola cifra.',
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });
}
