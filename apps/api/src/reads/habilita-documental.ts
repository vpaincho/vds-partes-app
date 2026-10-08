/**
 * Habilita documental: the matrix the prototype showed (`S.hab[sujeto|operadora] = {vence}`),
 * preserved here as a *projection* over `habilita.requirements` / `documents` / `compliances` —
 * never the storage model itself (0003_habilita_prevent.sql's own header makes that the point of
 * the schema). Read-only: there is no `habilita.requirements.create` / `.documents.upload` /
 * `.compliances.record` command yet, so this gives a `habilita.documental` holder visibility into
 * what gates are actually configured and who currently satisfies them, without pretending they can
 * manage it from here yet.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { instantNow, isDomainError, HTTP_STATUS } from '@vds/kernel';
import { withConnection } from '../platform/db.ts';
import { readableContractIdsAny, unauthenticated } from '../platform/authz.ts';

const meta = (request: FastifyRequest) => ({ requestId: request.requestId, serverTime: instantNow() });

function sendError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (isDomainError(error)) {
    return reply.code(HTTP_STATUS[error.code]).send({ ...error.toJSON(), meta: meta(request) });
  }
  request.log?.error({ err: error, requestId: request.requestId }, 'habilita documental read failed');
  return reply.code(500).send({
    error: { code: 'INVARIANT_VIOLATED', message: 'Error interno.', details: [], ruleIds: [], retryable: false },
    meta: meta(request),
  });
}

export async function registerHabilitaDocumentalReadRoutes(app: FastifyInstance): Promise<void> {
  app.get('/habilita/documental/matrix', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      // Requirements/documents/compliances are not contract-scoped objects; this only asserts the
      // capability, the same way the dashboards do for execution.read.
      readableContractIdsAny(actor, ['habilita.documental', 'habilita.read']);

      const data = await withConnection(async (db) => {
        const requirements = await db.query(
          `SELECT r.id, r.code, r.name, r.requirement_type, r.applies_to::text AS applies_to,
                  r.severity::text AS severity, r.overrideable_via, r.valid_from, r.valid_until,
                  cl.name AS client_name, sv.name AS service_name
           FROM habilita.requirements r
           LEFT JOIN config.clients cl ON cl.id = r.client_id
           LEFT JOIN config.services sv ON sv.id = r.service_id
           ORDER BY r.code LIMIT 200`,
        );

        // One row per (person, requirement) they have any compliance history for — the most
        // recent one wins, same precedence the nominees read uses: COMPLIANT first, then newest.
        const personMatrix = await db.query(
          `SELECT p.id AS person_id, p.code AS person_code, p.first_name, p.last_name,
                  r.id AS requirement_id, r.code AS requirement_code, r.severity::text AS severity,
                  best.status, best.valid_from, best.valid_until, best.document_id
           FROM config.people p
           JOIN habilita.requirements r ON r.applies_to = 'PERSON'
           JOIN LATERAL (
             SELECT cp.status, cp.valid_from, cp.valid_until, cp.document_id
             FROM habilita.compliances cp
             WHERE cp.requirement_id = r.id AND cp.person_id = p.id
             ORDER BY (cp.status = 'COMPLIANT') DESC, cp.valid_from DESC
             LIMIT 1
           ) best ON true
           WHERE p.is_active
           ORDER BY p.last_name, p.first_name, r.code
           LIMIT 1000`,
        );

        const resourceMatrix = await db.query(
          `SELECT res.id AS resource_id, res.code AS resource_code, res.name AS resource_name,
                  r.id AS requirement_id, r.code AS requirement_code, r.severity::text AS severity,
                  best.status, best.valid_from, best.valid_until, best.document_id
           FROM config.resources res
           JOIN habilita.requirements r ON r.applies_to = 'RESOURCE'
           JOIN LATERAL (
             SELECT cp.status, cp.valid_from, cp.valid_until, cp.document_id
             FROM habilita.compliances cp
             WHERE cp.requirement_id = r.id AND cp.resource_id = res.id
             ORDER BY (cp.status = 'COMPLIANT') DESC, cp.valid_from DESC
             LIMIT 1
           ) best ON true
           WHERE res.is_active
           ORDER BY res.code, r.code
           LIMIT 1000`,
        );

        const recentDocuments = await db.query(
          `SELECT d.id, d.code, d.document_type, d.subject_kind::text AS subject_kind,
                  d.valid_from, d.valid_until, d.issuer, d.provenance,
                  p.first_name, p.last_name, res.code AS resource_code
           FROM habilita.documents d
           LEFT JOIN config.people p ON p.id = d.person_id
           LEFT JOIN config.resources res ON res.id = d.resource_id
           ORDER BY d.created_at DESC
           LIMIT 200`,
        );

        return {
          requirements: requirements.rows,
          personMatrix: personMatrix.rows,
          resourceMatrix: resourceMatrix.rows,
          recentDocuments: recentDocuments.rows,
        };
      });

      return {
        data,
        meta: {
          ...meta(request),
          asOf: instantNow(),
          source: 'habilita.requirements + documents + compliances',
          note:
            'Lectura únicamente — no existen aún comandos para crear/editar requisitos, documentos ' +
            'o cumplimientos. Un estado mostrado acá no autoriza nada por sí mismo: Start Work ' +
            'vuelve a evaluar en el instante real (RGT-17).',
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });
}
