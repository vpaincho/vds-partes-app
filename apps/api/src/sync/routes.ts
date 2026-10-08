/**
 * Sync: what a device needs to recover after being offline.
 *
 * Two routes, deliberately narrow:
 *
 *  - `POST /sync/commands` is the batch door for the client outbox. It runs each queued command
 *    through the exact same `execute()` pipeline a live request would — same authorisation, same
 *    rule engine, same idempotency on `(scope_id, command_id)` — so a command replayed from the
 *    outbox after a lost connection behaves identically to one sent live (RGT-06/07). The response
 *    carries one result per command, success or typed error, never a single batch verdict: a
 *    partial batch is the normal case, not a failure of the whole request.
 *  - `GET /sync/bundles/:assignmentId` serves the context bundle `planning.assignments.dispatch`
 *    already builds into `sync.execution_context_bundles` (C-016: a cache, never the master). It is
 *    scoped to the identity the bundle was built for — a bundle is not a shared document.
 *
 * What is deliberately NOT here yet: `GET /sync/changes` (the per-scope push feed) and
 * `sync.delivery_status` bookkeeping. Nothing in this codebase populates `sync.changes` — that is
 * the worker's job (`apps/worker`, not built), consuming `platform.domain_outbox` and fanning it
 * out per device scope. Building the pull endpoint before anything feeds it would look implemented
 * while doing nothing; `sync.delivery_status`'s `scope_id` needs the same scoping model the worker
 * will define, so recording it here first risked guessing at a boundary rather than reusing one
 * (06: no silent domain reinterpretation). `platform.command_receipts`, which `execute()` already
 * writes on every call, is what actually makes a retried command idempotent — that guarantee holds
 * today, independent of this gap.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { instantNow, isDomainError, DomainError, HTTP_STATUS, type Uuid } from '@vds/kernel';
import { commandNames } from '@vds/contracts';
import { withConnection } from '../platform/db.ts';
import { unauthenticated } from '../platform/authz.ts';
import { execute, registeredCommands } from '../platform/pipeline.ts';

const meta = (request: FastifyRequest) => ({ requestId: request.requestId, serverTime: instantNow() });

function sendError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (isDomainError(error)) {
    return reply.code(HTTP_STATUS[error.code]).send({ ...error.toJSON(), meta: meta(request) });
  }
  request.log?.error({ err: error, requestId: request.requestId }, 'sync route failed');
  return reply.code(500).send({
    error: { code: 'INVARIANT_VIOLATED', message: 'Error interno.', details: [], ruleIds: [], retryable: false },
    meta: meta(request),
  });
}

interface BatchItem {
  readonly commandName: string;
  readonly subjectId?: string | null;
  readonly envelope: Record<string, unknown>;
}

interface BatchItemResult {
  readonly commandId: string | undefined;
  readonly commandName: string;
  readonly status: 'applied' | 'error';
  readonly result?: Awaited<ReturnType<typeof execute>>;
  readonly error?: ReturnType<DomainError['toJSON']>['error'] & { httpStatus: number };
}

export async function registerSyncRoutes(app: FastifyInstance, options: { rulesetVersion: string }): Promise<void> {
  /**
   * The batch outbox endpoint. Each item is processed independently and in the order received —
   * order matters because a later command in the same batch may depend on an earlier one's new
   * version (RUL-005 et al. re-load current state per command, so this is not an in-memory replay).
   */
  app.post('/sync/commands', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return sendError(reply, request, unauthenticated());

    const body = request.body as { commands?: readonly BatchItem[] } | null;
    const items = body?.commands ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      return sendError(
        reply,
        request,
        new DomainError({
          code: 'VALIDATION_FAILED',
          message: 'El lote necesita al menos un comando en "commands".',
        }),
      );
    }
    if (items.length > 100) {
      return sendError(
        reply,
        request,
        new DomainError({
          code: 'PAYLOAD_TOO_LARGE',
          message: `Lote de ${items.length} comandos: el máximo por envío es 100.`,
        }),
      );
    }

    const results: BatchItemResult[] = [];
    for (const item of items) {
      const commandId = (item.envelope?.['commandId'] as string | undefined) ?? undefined;
      if (!commandNames.includes(item.commandName) || !registeredCommands().includes(item.commandName)) {
        results.push({
          commandId,
          commandName: item.commandName,
          status: 'error',
          error: {
            code: 'NOT_FOUND',
            message: `Comando desconocido o no implementado: "${item.commandName}".`,
            details: [],
            ruleIds: [],
            retryable: false,
            httpStatus: 404,
          },
        });
        continue;
      }
      try {
        const result = await execute({
          commandName: item.commandName,
          actor,
          rawEnvelope: item.envelope,
          subjectId: item.subjectId ?? null,
          preview: false,
          rulesetVersion: options.rulesetVersion,
          requestId: request.requestId,
        });
        results.push({ commandId, commandName: item.commandName, status: 'applied', result });
      } catch (error) {
        if (isDomainError(error)) {
          const body2 = error.toJSON();
          results.push({
            commandId,
            commandName: item.commandName,
            status: 'error',
            error: { ...body2.error, httpStatus: HTTP_STATUS[error.code] },
          });
        } else {
          request.log?.error({ err: error, requestId: request.requestId }, 'sync batch item failed');
          results.push({
            commandId,
            commandName: item.commandName,
            status: 'error',
            error: {
              code: 'INVARIANT_VIOLATED',
              message: 'Error interno procesando este comando.',
              details: [],
              ruleIds: [],
              retryable: false,
              httpStatus: 500,
            },
          });
        }
      }
    }

    // 200 for the batch itself: a per-item failure is reported in that item, never as an HTTP
    // error for the whole request — the client still needs the results of the commands that did
    // apply.
    return reply.code(200).send({ data: { results }, meta: meta(request) });
  });

  /** The context bundle a dispatched assignment already built, scoped to who it was built for. */
  app.get('/sync/bundles/:assignmentId', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return sendError(reply, request, unauthenticated());
    if (!actor.capabilities.includes('execution.read')) {
      return sendError(
        reply,
        request,
        new DomainError({
          code: 'FORBIDDEN_SCOPE',
          message: 'La identidad no tiene la capability execution.read.',
        }),
      );
    }

    try {
      const { assignmentId } = request.params as { assignmentId: string };
      const bundle = await withConnection((db) =>
        db.one<{
          id: Uuid;
          payload: Record<string, unknown>;
          content_hash: string;
          built_at: Date;
          valid_until: Date;
          identity_id: Uuid | null;
        }>(
          `SELECT id, payload, content_hash, built_at, valid_until, identity_id
           FROM sync.execution_context_bundles
           WHERE planned_assignment_id = $1
           ORDER BY built_at DESC LIMIT 1`,
          [assignmentId],
        ),
      );
      if (!bundle) {
        return sendError(
          reply,
          request,
          new DomainError({
            code: 'NOT_FOUND',
            message: `No hay bundle para la asignación ${assignmentId}. El despacho construye uno.`,
          }),
        );
      }
      // A bundle is scoped to the identity it was built for — not a shared document (13).
      if (bundle.identity_id !== null && bundle.identity_id !== actor.identityId) {
        return sendError(
          reply,
          request,
          new DomainError({ code: 'NOT_FOUND', message: `No hay bundle para la asignación ${assignmentId}.` }),
        );
      }

      const now = Date.now();
      return reply.code(200).send({
        data: {
          id: bundle.id,
          payload: bundle.payload,
          contentHash: bundle.content_hash,
          builtAt: bundle.built_at,
          validUntil: bundle.valid_until,
          // GS-024: the client must not infer this itself from a stale local clock comparison.
          expired: bundle.valid_until.getTime() <= now,
        },
        meta: meta(request),
      });
    } catch (error) {
      return sendError(reply, request, error);
    }
  });
}
