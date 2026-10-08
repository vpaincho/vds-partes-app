/**
 * Configuración: a read-only masters browser.
 *
 * `config.publish` / `config.import` (versioned catalog publishing, rule-version promotion) are not
 * built — masters are managed today via `scripts/seed.mjs`, which is itself the explicit
 * `PENDING_CONFIGURATION` stance rather than a workaround. This gives a `config.read` holder
 * visibility into what is actually seeded, which the shell had no surface for at all before.
 *
 * Catalog entities (services, part types, units, resource types) are not contract-scoped — they are
 * shared definitions referenced *by* contract-scoped links, the same precedent
 * `/planning/assignments/:id/nominees` already follows for `config.people` / `config.resources`.
 * Only `contracts` (and, transitively, the clients that own them) are filtered by
 * `readableContractIds`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { instantNow, isDomainError, HTTP_STATUS, type Uuid } from '@vds/kernel';
import { withConnection } from '../platform/db.ts';
import { readableContractIds, unauthenticated } from '../platform/authz.ts';

const meta = (request: FastifyRequest) => ({ requestId: request.requestId, serverTime: instantNow() });

function sendError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (isDomainError(error)) {
    return reply.code(HTTP_STATUS[error.code]).send({ ...error.toJSON(), meta: meta(request) });
  }
  request.log?.error({ err: error, requestId: request.requestId }, 'config read failed');
  return reply.code(500).send({
    error: { code: 'INVARIANT_VIOLATED', message: 'Error interno.', details: [], ruleIds: [], retryable: false },
    meta: meta(request),
  });
}

export async function registerConfigReadRoutes(app: FastifyInstance): Promise<void> {
  app.get('/config/masters', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      const contractIds = readableContractIds(actor, 'config.read');

      const data = await withConnection(async (db) => {
        const contracts = await db.query(
          `SELECT c.id, c.code, c.name, cl.id AS client_id, cl.code AS client_code, cl.name AS client_name,
                  (SELECT count(*)::text FROM config.contract_versions v WHERE v.contract_id = c.id) AS version_count,
                  (SELECT max(v.version_no) FROM config.contract_versions v WHERE v.contract_id = c.id AND v.status = 'PUBLISHED') AS published_version_no
           FROM config.contracts c
           JOIN config.clients cl ON cl.id = c.client_id
           WHERE ($1::uuid[] IS NULL OR c.id = ANY($1::uuid[]))
           ORDER BY cl.name, c.code
           LIMIT 500`,
          [contractIds],
        );

        const clients = await db.query(
          `SELECT cl.id, cl.code, cl.name
           FROM config.clients cl
           WHERE $1::uuid[] IS NULL
              OR EXISTS (SELECT 1 FROM config.contracts c WHERE c.client_id = cl.id AND c.id = ANY($1::uuid[]))
           ORDER BY cl.name
           LIMIT 500`,
          [contractIds],
        );

        // Shared catalogs — not contract-scoped (see file header).
        const services = await db.query(
          "SELECT id, code, name FROM config.services WHERE is_active ORDER BY name LIMIT 500",
        );
        const partTypes = await db.query(
          'SELECT id, code, name, description FROM config.part_types ORDER BY code LIMIT 100',
        );
        const unitsOfMeasure = await db.query(
          'SELECT id, code, name, dimension FROM config.units_of_measure ORDER BY code LIMIT 200',
        );
        const resourceTypes = await db.query(
          'SELECT id, code, name, metering FROM config.resource_types ORDER BY code LIMIT 200',
        );
        const technicalLocations = await db.query(
          `SELECT tl.id, tl.code, tl.name, tl.kind, cl.name AS client_name
           FROM config.technical_locations tl
           LEFT JOIN config.clients cl ON cl.id = tl.client_id
           ORDER BY tl.code LIMIT 500`,
        );
        const crews = await db.query(
          `SELECT cr.id, cr.code, cr.name,
                  (SELECT count(*)::text FROM config.crew_memberships m
                    WHERE m.crew_id = cr.id AND (m.valid_until IS NULL OR m.valid_until > now())) AS active_members
           FROM config.crews cr ORDER BY cr.code LIMIT 500`,
        );
        const people = await db.query(
          `SELECT id, code, first_name, last_name, affiliation, is_active
           FROM config.people ORDER BY last_name, first_name LIMIT 500`,
        );
        const resources = await db.query(
          `SELECT r.id, r.code, r.name, rt.code AS resource_type, r.is_active
           FROM config.resources r LEFT JOIN config.resource_types rt ON rt.id = r.resource_type_id
           ORDER BY r.code LIMIT 500`,
        );

        return {
          contracts: contracts.rows,
          clients: clients.rows,
          services: services.rows,
          partTypes: partTypes.rows,
          unitsOfMeasure: unitsOfMeasure.rows,
          resourceTypes: resourceTypes.rows,
          technicalLocations: technicalLocations.rows,
          crews: crews.rows,
          people: people.rows,
          resources: resources.rows,
        };
      });

      return {
        data,
        meta: {
          ...meta(request),
          asOf: instantNow(),
          source: 'config.* (maestros)',
          note:
            'Lectura únicamente. No existen aún config.publish / config.import: los maestros se ' +
            'administran hoy vía scripts/seed.mjs, explícito como PENDING_CONFIGURATION.',
        },
      };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  /** One contract's version history — what `config.publish` will eventually append to. */
  app.get('/config/contracts/:contractId', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });
    try {
      const contractIds = readableContractIds(actor, 'config.read');
      const { contractId } = request.params as { contractId: Uuid };
      if (contractIds !== null && !contractIds.includes(contractId)) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `No existe el contrato ${contractId}.`, details: [], ruleIds: [], retryable: false },
          meta: meta(request),
        });
      }

      const data = await withConnection(async (db) => {
        const contract = await db.one<{ id: Uuid; code: string; name: string }>(
          'SELECT id, code, name FROM config.contracts WHERE id = $1',
          [contractId],
        );
        if (!contract) return null;
        const versions = await db.query(
          `SELECT v.id, v.version_no, v.status::text AS status, v.valid_from, v.valid_until,
                  (SELECT count(*)::text FROM config.contract_services s WHERE s.contract_version_id = v.id) AS service_count
           FROM config.contract_versions v WHERE v.contract_id = $1 ORDER BY v.version_no DESC`,
          [contractId],
        );
        return { contract, versions: versions.rows };
      });

      if (!data) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `No existe el contrato ${contractId}.`, details: [], ruleIds: [], retryable: false },
          meta: meta(request),
        });
      }
      return { data, meta: { ...meta(request), asOf: instantNow(), source: 'config.contracts + contract_versions' } };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });
}
