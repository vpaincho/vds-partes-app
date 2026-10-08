/**
 * Sync discrepancies: the list a `sync.reconcile` holder works from to resolve what a revoked
 * device declared (RGT-11). Read-only — resolution itself is `sync.discrepancies.resolve`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { instantNow, isDomainError, DomainError, HTTP_STATUS, type Uuid } from '@vds/kernel';
import { withConnection } from '../platform/db.ts';
import { readableContractIds, unauthenticated } from '../platform/authz.ts';

const meta = (request: FastifyRequest) => ({ requestId: request.requestId, serverTime: instantNow() });

function sendError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (isDomainError(error)) {
    return reply.code(HTTP_STATUS[error.code]).send({ ...error.toJSON(), meta: meta(request) });
  }
  request.log?.error({ err: error, requestId: request.requestId }, 'sync read failed');
  return reply.code(500).send({
    error: { code: 'INVARIANT_VIOLATED', message: 'Error interno.', details: [], ruleIds: [], retryable: false },
    meta: meta(request),
  });
}

interface DiscrepancyRow {
  id: Uuid;
  command_id: Uuid;
  device_id: Uuid | null;
  identity_id: Uuid | null;
  discrepancy_kind: string;
  subject_kind: string;
  subject_id: Uuid | null;
  declared: unknown;
  server_state: unknown;
  base_state: unknown;
  detected_at: Date;
  resolved_at: Date | null;
  resolved_by: Uuid | null;
  resolution: string | null;
  resolution_note: string | null;
  amendment_id: Uuid | null;
}

const toView = (r: DiscrepancyRow) => ({
  id: r.id,
  commandId: r.command_id,
  deviceId: r.device_id,
  identityId: r.identity_id,
  discrepancyKind: r.discrepancy_kind,
  subjectKind: r.subject_kind,
  subjectId: r.subject_id,
  declared: r.declared,
  serverState: r.server_state,
  baseState: r.base_state,
  detectedAt: r.detected_at,
  resolvedAt: r.resolved_at,
  resolvedBy: r.resolved_by,
  resolution: r.resolution,
  resolutionNote: r.resolution_note,
  amendmentId: r.amendment_id,
});

export async function registerSyncReadRoutes(app: FastifyInstance): Promise<void> {
  /** `?resolved=false` (default) lists open discrepancies; `?resolved=true` lists resolved ones. */
  app.get('/sync/discrepancies', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      // sync.reconcile is not contract-scoped — a discrepancy's subject may belong to any contract,
      // and the capability itself is dual-control (supervisor-only), so this only confirms the
      // actor holds it at all, matching how `sync.discrepancies.resolve` is authorised.
      readableContractIds(actor, 'sync.reconcile');
      const { resolved } = request.query as { resolved?: string };
      const wantResolved = resolved === 'true';
      const rows = await withConnection((db) =>
        db.query<DiscrepancyRow>(
          `SELECT id, command_id, device_id, identity_id, discrepancy_kind, subject_kind, subject_id,
                  declared, server_state, base_state, detected_at, resolved_at, resolved_by,
                  resolution, resolution_note, amendment_id
           FROM sync.discrepancies
           WHERE resolved_at IS ${wantResolved ? 'NOT NULL' : 'NULL'}
           ORDER BY detected_at DESC
           LIMIT 200`,
        ),
      );
      return {
        data: rows.rows.map(toView),
        meta: { ...meta(request), source: 'sync.discrepancies' },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  app.get('/sync/discrepancies/:discrepancyId', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      readableContractIds(actor, 'sync.reconcile');
      const { discrepancyId } = request.params as { discrepancyId: string };
      const row = await withConnection((db) =>
        db.one<DiscrepancyRow>(
          `SELECT id, command_id, device_id, identity_id, discrepancy_kind, subject_kind, subject_id,
                  declared, server_state, base_state, detected_at, resolved_at, resolved_by,
                  resolution, resolution_note, amendment_id
           FROM sync.discrepancies WHERE id = $1`,
          [discrepancyId],
        ),
      );
      if (!row) {
        return sendError(
          reply,
          request,
          new DomainError({ code: 'NOT_FOUND', message: `No existe la discrepancia ${discrepancyId}.` }),
        );
      }
      return { data: toView(row), meta: { ...meta(request), source: 'sync.discrepancies' } };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });
}
