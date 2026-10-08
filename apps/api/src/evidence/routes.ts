/**
 * Evidence upload: a separate, resumable transaction from the command that referenced it.
 *
 * `execution.evidence.attach` (apps/api/src/commands/execution-capture.ts) already wrote the
 * metadata — hash, size, actor, instant — with `upload_status = LOCAL_ONLY`. These four routes are
 * what moves the actual bytes, and only these four ever touch `FilesPort`:
 *
 *  - `POST /evidence/init` opens an upload against the metadata already on file (the declared size/
 *    hash/content-type travel with the evidence row, never retyped here).
 *  - `PUT /evidence/:evidenceId/chunk` is idempotent by offset (`FilesPort.putChunk`'s own
 *    contract) — resending a chunk after a dropped connection does not double-count.
 *  - `POST /evidence/:evidenceId/complete` verifies the whole file against the declared hash and
 *    only then marks the evidence `STORED`.
 *  - `GET /evidence/:evidenceId/status` and `GET /evidence/:evidenceId/url` are read-only; the url
 *    is short-lived and signed, never a predictable object key (13).
 *
 * RGT-09: `evidence.evidence.upload_status` only reaches `STORED` after `completeUpload` confirms
 * the checksum. A command that requires evidence to close is not documentarily complete while this
 * status is anything else — that check lives wherever the closure gate is, not here.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, instantNow, isDomainError, uuidv7, HTTP_STATUS, type Uuid } from '@vds/kernel';
import { withConnection } from '../platform/db.ts';
import { unauthenticated } from '../platform/authz.ts';
import { getProviders } from '../platform/providers.ts';

const meta = (request: FastifyRequest) => ({ requestId: request.requestId, serverTime: instantNow() });

function sendError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (isDomainError(error)) {
    return reply.code(HTTP_STATUS[error.code]).send({ ...error.toJSON(), meta: meta(request) });
  }
  request.log?.error({ err: error, requestId: request.requestId }, 'evidence route failed');
  return reply.code(500).send({
    error: { code: 'INVARIANT_VIOLATED', message: 'Error interno.', details: [], ruleIds: [], retryable: false },
    meta: meta(request),
  });
}

interface EvidenceRow {
  id: Uuid;
  content_type: string | null;
  byte_size: string | null;
  content_hash: string | null;
  upload_status: string;
  object_key: string | null;
}

async function loadEvidence(db: import('../platform/db.ts').Db, evidenceId: string): Promise<EvidenceRow> {
  const row = await db.one<EvidenceRow>(
    'SELECT id, content_type, byte_size, content_hash, upload_status, object_key FROM evidence.evidence WHERE id = $1',
    [evidenceId],
  );
  if (!row) throw new DomainError({ code: 'NOT_FOUND', message: `No existe la evidencia ${evidenceId}.` });
  return row;
}

export async function registerEvidenceRoutes(app: FastifyInstance): Promise<void> {
  app.post('/evidence/init', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return sendError(reply, request, unauthenticated());
    if (!actor.capabilities.includes('execution.capture')) {
      return sendError(
        reply,
        request,
        new DomainError({ code: 'FORBIDDEN_SCOPE', message: 'La identidad no tiene la capability execution.capture.' }),
      );
    }

    try {
      const body = request.body as { evidenceId?: string } | null;
      const evidenceId = body?.evidenceId;
      if (!evidenceId) {
        return sendError(
          reply,
          request,
          new DomainError({ code: 'VALIDATION_FAILED', message: 'Falta evidenceId.' }),
        );
      }

      const result = await withConnection(async (db) => {
        const evidence = await loadEvidence(db, evidenceId);
        if (evidence.upload_status === 'STORED') {
          return { already: true as const, evidence };
        }
        const objectKey = `evidence/${evidenceId}`;
        const init = await getProviders().files.initUpload({
          objectKey,
          byteSize: Number(evidence.byte_size ?? 0),
          contentType: evidence.content_type ?? 'application/octet-stream',
          contentHash: evidence.content_hash ?? '',
        });
        if (init.status !== 'OK' || !init.value) {
          throw new DomainError({
            code: 'PROVIDER_UNAVAILABLE',
            message: `El proveedor de archivos no respondió (${init.status}).`,
            retryable: true,
          });
        }

        const uploadId = uuidv7();
        await db.query(
          `INSERT INTO sync.evidence_uploads
             (id, evidence_id, upload_token, byte_size, content_hash, status)
           VALUES ($1, $2, $3, $4, $5, 'INITIATED')`,
          [uploadId, evidenceId, init.value.uploadToken, evidence.byte_size, evidence.content_hash],
        );
        await db.query(`UPDATE evidence.evidence SET upload_status = 'UPLOADING' WHERE id = $1`, [evidenceId]);

        return { already: false as const, uploadId, uploadToken: init.value.uploadToken, objectKey };
      });

      if (result.already) {
        return reply.code(200).send({
          data: { alreadyStored: true, objectKey: result.evidence.object_key },
          meta: meta(request),
        });
      }
      return reply.code(200).send({
        data: { uploadId: result.uploadId, uploadToken: result.uploadToken, objectKey: result.objectKey },
        meta: meta(request),
      });
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  app.put('/evidence/:evidenceId/chunk', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return sendError(reply, request, unauthenticated());

    try {
      const { evidenceId } = request.params as { evidenceId: string };
      const body = request.body as { uploadToken?: string; offset?: number; bytesBase64?: string } | null;
      if (!body?.uploadToken || body.offset === undefined || !body.bytesBase64) {
        return sendError(
          reply,
          request,
          new DomainError({ code: 'VALIDATION_FAILED', message: 'Faltan uploadToken, offset o bytesBase64.' }),
        );
      }

      const bytes = Buffer.from(body.bytesBase64, 'base64');
      const result = await getProviders().files.putChunk({
        uploadToken: body.uploadToken,
        offset: body.offset,
        bytes,
      });
      if (result.status === 'NOT_FOUND') {
        return sendError(
          reply,
          request,
          new DomainError({
            code: 'NOT_FOUND',
            message: 'El upload no existe o ya fue completado. Hay que iniciar uno nuevo (POST /evidence/init).',
          }),
        );
      }
      if (result.status !== 'OK' || !result.value) {
        return sendError(
          reply,
          request,
          new DomainError({ code: 'PROVIDER_UNAVAILABLE', message: 'El proveedor de archivos no respondió.', retryable: true }),
        );
      }

      await withConnection((db) =>
        db.query(
          `UPDATE sync.evidence_uploads
           SET bytes_received = $2, status = 'IN_PROGRESS'
           WHERE upload_token = $1`,
          [body.uploadToken, result.value!.bytesReceived],
        ),
      );

      return reply.code(200).send({ data: { bytesReceived: result.value.bytesReceived }, meta: meta(request) });
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  app.post('/evidence/:evidenceId/complete', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return sendError(reply, request, unauthenticated());

    try {
      const { evidenceId } = request.params as { evidenceId: string };
      const body = request.body as { uploadToken?: string } | null;
      if (!body?.uploadToken) {
        return sendError(reply, request, new DomainError({ code: 'VALIDATION_FAILED', message: 'Falta uploadToken.' }));
      }

      const result = await getProviders().files.completeUpload(body.uploadToken);

      if (result.status !== 'OK' || !result.value) {
        const message = result.error?.message ?? 'La subida no se pudo completar.';
        await withConnection((db) =>
          db.query(
            `UPDATE sync.evidence_uploads SET status = 'FAILED', last_error = $2 WHERE upload_token = $1`,
            [body.uploadToken, message],
          ),
        );
        return sendError(
          reply,
          request,
          new DomainError({
            code: 'VALIDATION_FAILED',
            message,
            retryable: result.error?.retryable ?? true,
          }),
        );
      }

      await withConnection(async (db) => {
        await db.query(
          `UPDATE sync.evidence_uploads
           SET status = 'COMPLETE', completed_at = now(), bytes_received = byte_size
           WHERE upload_token = $1`,
          [body.uploadToken],
        );
        await db.query(
          `UPDATE evidence.evidence
           SET upload_status = 'STORED', object_key = $2, stored_at = now()
           WHERE id = $1`,
          [evidenceId, result.value!.objectKey],
        );
      });

      return reply.code(200).send({ data: { stored: true, objectKey: result.value.objectKey }, meta: meta(request) });
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  app.get('/evidence/:evidenceId/status', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return sendError(reply, request, unauthenticated());

    try {
      const { evidenceId } = request.params as { evidenceId: string };
      const data = await withConnection(async (db) => {
        const evidence = await loadEvidence(db, evidenceId);
        const upload = await db.one<{
          upload_token: string;
          byte_size: string;
          bytes_received: string;
          status: string;
          last_error: string | null;
        }>(
          `SELECT upload_token, byte_size, bytes_received, status, last_error
           FROM sync.evidence_uploads WHERE evidence_id = $1
           ORDER BY started_at DESC LIMIT 1`,
          [evidenceId],
        );
        return { uploadStatus: evidence.upload_status, attempt: upload };
      });
      return { data, meta: meta(request) };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });

  app.get('/evidence/:evidenceId/url', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return sendError(reply, request, unauthenticated());

    try {
      const { evidenceId } = request.params as { evidenceId: string };
      const evidence = await withConnection((db) => loadEvidence(db, evidenceId));
      if (evidence.upload_status !== 'STORED' || !evidence.object_key) {
        return sendError(
          reply,
          request,
          new DomainError({
            code: 'PENDING_CONFIGURATION',
            message: 'La evidencia todavía no está STORED: no hay bytes confirmados para firmar una URL.',
          }),
        );
      }
      const signed = await getProviders().files.getSignedUrl(evidence.object_key, 300);
      if (signed.status !== 'OK' || !signed.value) {
        return sendError(
          reply,
          request,
          new DomainError({ code: 'NOT_FOUND', message: 'No se encontró el objeto almacenado.' }),
        );
      }
      return { data: signed.value, meta: meta(request) };
    } catch (error) {
      return sendError(reply, request, error);
    }
  });
}
