/**
 * API integration: evidence upload as its own resumable, idempotent transaction.
 *
 * RGT-09: `execution.evidence.attach` already wrote the metadata with upload_status LOCAL_ONLY —
 * these tests prove the bytes travel through a SEPARATE transaction that only reaches STORED once
 * the whole file is received and its checksum verified, never on the strength of a 200 alone.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envelope, get, getApp, makeScenario, makeSession, post, preparePartWithUnit, put, sql, teardown, type Session } from './helpers.ts';

let field: Session;

beforeAll(async () => {
  await getApp();
  field = await makeSession({ role: 'field' });
});

afterAll(teardown);

async function attachEvidence(unitId: string, bytes: Buffer): Promise<string> {
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const result = await post<{ data: { subject: { id: string } } }>('/execution/evidence', {
    session: field,
    body: envelope({
      payload: {
        targetKind: 'EXECUTION_UNIT',
        targetId: unitId,
        evidenceKind: 'PHOTO',
        fileName: 'foto.jpg',
        contentType: 'image/jpeg',
        sizeBytes: bytes.byteLength,
        checksum,
      },
    }),
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body.data.subject.id;
}

describe('evidence upload', () => {
  it('goes LOCAL_ONLY -> UPLOADING -> STORED across init/chunk/complete, in one chunk', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const bytes = Buffer.from('a single-chunk photo, pretend bytes');
    const evidenceId = await attachEvidence(unitId, bytes);

    const [beforeInit] = await sql<{ upload_status: string }>(
      'SELECT upload_status FROM evidence.evidence WHERE id = $1',
      [evidenceId],
    );
    expect(beforeInit!.upload_status).toBe('LOCAL_ONLY');

    const init = await post<{ data: { uploadToken: string } }>('/evidence/init', {
      session: field,
      body: { evidenceId },
    });
    expect(init.status, JSON.stringify(init.body)).toBe(200);
    const { uploadToken } = init.body.data;

    const [afterInit] = await sql<{ upload_status: string }>(
      'SELECT upload_status FROM evidence.evidence WHERE id = $1',
      [evidenceId],
    );
    expect(afterInit!.upload_status).toBe('UPLOADING');

    const chunk = await put(`/evidence/${evidenceId}/chunk`, {
      session: field,
      body: { uploadToken, offset: 0, bytesBase64: bytes.toString('base64') },
    });
    expect(chunk.status).toBe(200);

    const complete = await post<{ data: { stored: boolean; objectKey: string } }>(
      `/evidence/${evidenceId}/complete`,
      { session: field, body: { uploadToken } },
    );
    expect(complete.status, JSON.stringify(complete.body)).toBe(200);
    expect(complete.body.data.stored).toBe(true);

    const status = await get<{ data: { uploadStatus: string; attempt: { status: string } | null } }>(
      `/evidence/${evidenceId}/status`,
      { session: field },
    );
    expect(status.status, JSON.stringify(status.body)).toBe(200);
    expect(status.body.data.uploadStatus).toBe('STORED');
    expect(status.body.data.attempt?.status).toBe('COMPLETE');

    // Re-init after STORED reports it is already stored rather than opening a pointless new upload.
    const reinit = await post<{ data: { alreadyStored: boolean } }>('/evidence/init', {
      session: field,
      body: { evidenceId },
    });
    expect(reinit.body.data).toMatchObject({ alreadyStored: true });

    const url = await get<{ data: { url: string } }>(`/evidence/${evidenceId}/url`, { session: field });
    expect(url.status, JSON.stringify(url.body)).toBe(200);
  });

  it('accumulates bytes across two chunks before completing (resumable)', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const part1 = Buffer.from('first half of the file...');
    const part2 = Buffer.from('...second half of the file');
    const bytes = Buffer.concat([part1, part2]);
    const evidenceId = await attachEvidence(unitId, bytes);

    const init = await post<{ data: { uploadToken: string } }>('/evidence/init', { session: field, body: { evidenceId } });
    const { uploadToken } = init.body.data;

    const chunk1 = await put<{ data: { bytesReceived: number } }>(`/evidence/${evidenceId}/chunk`, {
      session: field,
      body: { uploadToken, offset: 0, bytesBase64: part1.toString('base64') },
    });
    expect(chunk1.body.data.bytesReceived).toBe(part1.byteLength);

    const chunk2 = await put<{ data: { bytesReceived: number } }>(`/evidence/${evidenceId}/chunk`, {
      session: field,
      body: { uploadToken, offset: part1.byteLength, bytesBase64: part2.toString('base64') },
    });
    expect(chunk2.body.data.bytesReceived).toBe(bytes.byteLength);

    const complete = await post<{ data: { stored: boolean } }>(`/evidence/${evidenceId}/complete`, {
      session: field,
      body: { uploadToken },
    });
    expect(complete.status, JSON.stringify(complete.body)).toBe(200);
  });

  it('re-sending the same chunk (a retried PUT after a dropped connection) does not double-count bytes', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const bytes = Buffer.from('idempotent chunk test payload');
    const evidenceId = await attachEvidence(unitId, bytes);

    const init = await post<{ data: { uploadToken: string } }>('/evidence/init', { session: field, body: { evidenceId } });
    const { uploadToken } = init.body.data;

    const first = await put<{ data: { bytesReceived: number } }>(`/evidence/${evidenceId}/chunk`, {
      session: field,
      body: { uploadToken, offset: 0, bytesBase64: bytes.toString('base64') },
    });
    expect(first.body.data.bytesReceived).toBe(bytes.byteLength);

    // Same offset again — the client never learned the first PUT succeeded.
    const retry = await put<{ data: { bytesReceived: number } }>(`/evidence/${evidenceId}/chunk`, {
      session: field,
      body: { uploadToken, offset: 0, bytesBase64: bytes.toString('base64') },
    });
    expect(retry.body.data.bytesReceived).toBe(bytes.byteLength);

    const complete = await post<{ data: { stored: boolean } }>(`/evidence/${evidenceId}/complete`, {
      session: field,
      body: { uploadToken },
    });
    expect(complete.status, JSON.stringify(complete.body)).toBe(200);
  });

  it('refuses to complete when the received bytes do not match the declared checksum', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const declared = Buffer.from('what the attach command declared');
    const evidenceId = await attachEvidence(unitId, declared);

    const init = await post<{ data: { uploadToken: string } }>('/evidence/init', { session: field, body: { evidenceId } });
    const { uploadToken } = init.body.data;

    // Upload different bytes than what was declared — same length, different content.
    const wrong = Buffer.from('something else entirely here!!!');
    await put(`/evidence/${evidenceId}/chunk`, {
      session: field,
      body: { uploadToken, offset: 0, bytesBase64: wrong.toString('base64') },
    });

    const complete = await post(`/evidence/${evidenceId}/complete`, { session: field, body: { uploadToken } });
    expect(complete.status).toBe(400);

    const [row] = await sql<{ upload_status: string }>(
      'SELECT upload_status FROM evidence.evidence WHERE id = $1',
      [evidenceId],
    );
    // Never STORED on a checksum mismatch — RGT-09.
    expect(row!.upload_status).not.toBe('STORED');
  });

  it('refuses a signed URL before the evidence is STORED', async () => {
    const scenario = await makeScenario();
    const { unitId } = await preparePartWithUnit(field, scenario);
    const evidenceId = await attachEvidence(unitId, Buffer.from('not uploaded yet'));

    const url = await get(`/evidence/${evidenceId}/url`, { session: field });
    expect(url.status).toBe(422);
  });
});
