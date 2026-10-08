/**
 * Development-only authentication helper.
 *
 * This never bypasses authorization: it only mints a normal platform.sessions row for an
 * active fixture-dev identity. Every subsequent request is resolved through resolveActor()
 * and the regular scope/capability checks.
 *
 * The routes are registered only when ServerOptions.devAuth === true.
 */
import type { FastifyInstance } from 'fastify';
import { instantNow, isUuid, uuidv4 } from '@vds/kernel';
import { withConnection, withTransaction } from '../platform/db.ts';

interface DevIdentityRow {
  readonly id: string;
  readonly subject_ref: string;
  readonly display_name: string;
  readonly roles: string[];
}

const errorBody = (code: string, message: string) => ({
  error: {
    code,
    message,
    details: [],
    ruleIds: [],
    retryable: false,
  },
});

export function registerDevAuthRoutes(app: FastifyInstance, enabled: boolean): void {
  if (!enabled) return;

  app.get('/dev/identities', async (request) => {
    const { rows } = await withConnection((db) =>
      db.query<DevIdentityRow>(
        `SELECT i.id, i.subject_ref, i.display_name,
                coalesce(
                  array_agg(DISTINCT s.role_id) FILTER (WHERE s.role_id IS NOT NULL),
                  '{}'
                ) AS roles
           FROM platform.identities i
           LEFT JOIN platform.identity_scopes s
             ON s.identity_id = i.id
            AND s.valid_from <= now()
            AND (s.valid_until IS NULL OR s.valid_until > now())
          WHERE i.provider = 'fixture-dev'
            AND i.is_active = true
          GROUP BY i.id, i.subject_ref, i.display_name
          ORDER BY i.display_name`,
      ),
    );

    return {
      data: rows.map((row) => ({
        identityId: row.id,
        subjectRef: row.subject_ref,
        displayName: row.display_name,
        roles: row.roles,
      })),
      meta: { requestId: request.requestId, serverTime: instantNow(), source: 'FIXTURE_TEST' },
    };
  });

  app.post('/dev/sessions', async (request, reply) => {
    const identityId = (request.body as { identityId?: unknown } | null)?.identityId;
    if (typeof identityId !== 'string' || !isUuid(identityId)) {
      return reply
        .code(400)
        .send(errorBody('VALIDATION_FAILED', 'identityId debe ser un UUID válido.'));
    }

    const result = await withTransaction(async (db) => {
      const identity = await db.one<{
        id: string;
        display_name: string;
        roles: string[];
      }>(
        `SELECT i.id, i.display_name,
                coalesce(
                  array_agg(DISTINCT s.role_id) FILTER (WHERE s.role_id IS NOT NULL),
                  '{}'
                ) AS roles
           FROM platform.identities i
           LEFT JOIN platform.identity_scopes s
             ON s.identity_id = i.id
            AND s.valid_from <= now()
            AND (s.valid_until IS NULL OR s.valid_until > now())
          WHERE i.id = $1
            AND i.provider = 'fixture-dev'
            AND i.is_active = true
          GROUP BY i.id, i.display_name`,
        [identityId],
      );

      if (!identity) return null;

      const sessionId = uuidv4();
      await db.query(
        `INSERT INTO platform.sessions (id, identity_id, expires_at)
         VALUES ($1, $2, now() + interval '8 hours')`,
        [sessionId, identity.id],
      );

      return {
        sessionId,
        displayName: identity.display_name,
        roles: identity.roles,
        expiresInHours: 8,
      };
    });

    if (!result) {
      return reply
        .code(404)
        .send(errorBody('NOT_FOUND', 'La identidad DEV no existe o está inactiva.'));
    }

    return {
      data: result,
      meta: { requestId: request.requestId, serverTime: instantNow(), source: 'FIXTURE_TEST' },
    };
  });
}
