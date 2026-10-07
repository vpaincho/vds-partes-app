/**
 * Port contract tests.
 *
 * 14_DATA_INTEGRATION_ADAPTERS: "Pruebas contractuales iguales contra fixture y real." These
 * assertions are written against the *port*, not the implementation, so the day a real adapter
 * arrives it runs this same file. That is the mechanism behind S0 §22's "ESTO ES CLAVE" — swapping
 * `mock adapter` for `real adapter` without touching product logic is only safe if both are held to
 * one contract.
 *
 * The emphasis is on the unhappy paths. A fixture that only returns success proves nothing: the
 * behaviours that break systems are a provider that did not answer, answered staleley, or answered
 * "I do not know".
 */
import { describe, expect, it } from 'vitest';
import { toInstant } from '@vds/kernel';
import {
  canSatisfyGate,
  fixtureProviders,
  hasFixtureProvider,
  isUsable,
  makeDocumentaryFixture,
  makeErpFixture,
  makeFilesFixture,
  makeFixtureProviders,
  makeIdentityFixture,
  makeMastersFixture,
  makeNotificationFixture,
  makeWeatherFixture,
  type DocumentaryPort,
  type ErpPort,
  type MastersPort,
  type WeatherPort,
} from '../src/index.ts';

const AT = toInstant('2026-10-05T10:20:00Z');

/* ------------------------------------------------------- the result contract itself */

describe('ProviderResult never lets a non-answer look like a yes', () => {
  it('distinguishes NOT_FOUND from UNAVAILABLE', async () => {
    const present: MastersPort = makeMastersFixture();
    const broken: MastersPort = makeMastersFixture({}, { unavailable: true });

    const missing = await present.getPerson('P-9999');
    expect(missing.status).toBe('NOT_FOUND');
    expect(isUsable(missing)).toBe(false);

    const down = await broken.getPerson('P-1001');
    expect(down.status).toBe('UNAVAILABLE');
    expect(down.error?.retryable).toBe(true);
    // The difference matters: "there is no such person" and "we could not ask" are not the same
    // fact, and a gate must treat them differently.
    expect(down.status).not.toBe(missing.status);
  });

  it('refuses to satisfy a gate with an UNAVAILABLE answer', async () => {
    const broken = makeMastersFixture({}, { unavailable: true });
    const verdict = canSatisfyGate(await broken.getPerson('P-1001'));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toMatch(/no respondió/);
    expect(verdict.reason).toMatch(/no "cumple"/);
  });

  it('refuses to satisfy a gate with a STALE answer', async () => {
    const stale = makeMastersFixture({}, { staleByMinutes: 240 });
    const result = await stale.getPerson('P-1001');
    expect(result.status).toBe('STALE');
    // A value, but not evidence.
    expect(result.value).toBeDefined();
    expect(canSatisfyGate(result).ok).toBe(false);
  });

  it('refuses a gate when the answer is older than the decision allows', async () => {
    const weather: WeatherPort = makeWeatherFixture();
    const observed = await weather.observe({ at: AT, locationRef: 'ET-B3' });
    expect(observed.status).toBe('OK');

    // 14: "sin gate basado en dato viejo". The prototype's clima button wrote constants and called
    // them an update.
    const later = toInstant('2026-10-05T16:20:00Z'); // six hours later
    const verdict = canSatisfyGate(observed, { maxAgeMinutes: 60, now: later });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toMatch(/se observó hace/);

    // Within the window it is usable.
    expect(canSatisfyGate(observed, { maxAgeMinutes: 60, now: toInstant('2026-10-05T10:50:00Z') }).ok).toBe(
      true,
    );
  });

  it('reports PENDING_MAPPING rather than inventing a canonical id', async () => {
    const masters = makeMastersFixture({}, { pendingMappingIds: ['P-1001'] });
    const result = await masters.getPerson('P-1001');
    expect(result.status).toBe('PENDING_MAPPING');
    expect(result.externalId).toBe('P-1001');
    expect(canSatisfyGate(result).ok).toBe(false);
  });

  it('labels every answer with the provider kind', async () => {
    const masters = makeMastersFixture();
    expect((await masters.getPerson('P-1001')).providerKind).toBe('TEST_FIXTURE');
  });

  it('carries a correlation id on every answer, including failures', async () => {
    const broken = makeMastersFixture({}, { unavailable: true });
    expect((await broken.getPerson('P-1001')).correlationId).toBeTruthy();
    expect((await makeMastersFixture().getPerson('P-1001')).correlationId).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ masters */

describe('MastersPort', () => {
  const masters = makeMastersFixture();

  it('returns a person by external id with its source version', async () => {
    const result = await masters.getPerson('P-1001');
    expect(isUsable(result)).toBe(true);
    if (!isUsable(result)) return;
    expect(result.value.lastName).toBe('Arce');
    expect(result.externalId).toBe('P-1001');
    expect(result.sourceVersion).toBeTruthy();
  });

  it('keeps client staff distinguishable from company staff', async () => {
    // Audit §9: an import must not merge two populations that happen to share a name.
    const vds = await masters.getPerson('P-1001');
    const client = await masters.getPerson('P-2001');
    expect(isUsable(vds) && vds.value.affiliation).toBe('VDS');
    expect(isUsable(client) && client.value.affiliation).toBe('CLIENT');
  });

  it('states which meter a resource reports', async () => {
    // The prototype applied kilometres to everything, including a crane that reports hours.
    const pickup = await masters.getResource('R-31');
    const crane = await masters.getResource('R-14');
    expect(isUsable(pickup) && pickup.value.metering).toBe('ODOMETER_KM');
    expect(isUsable(crane) && crane.value.metering).toBe('HOURMETER_H');
  });

  it('paginates with an opaque cursor', async () => {
    const first = await masters.listClients({ limit: 1 });
    expect(isUsable(first)).toBe(true);
    if (!isUsable(first)) return;
    expect(first.value.items).toHaveLength(1);
    expect(first.value.nextCursor).toBeTruthy();

    const second = await masters.listClients({ limit: 1, cursor: first.value.nextCursor });
    expect(isUsable(second) && second.value.items[0]?.externalId).not.toBe(
      first.value.items[0]?.externalId,
    );
  });

  it('searches without claiming completeness it cannot offer', async () => {
    const result = await masters.searchPeople('arce');
    expect(isUsable(result)).toBe(true);
    if (!isUsable(result)) return;
    expect(result.value.items).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- identity */

describe('IdentityPort', () => {
  const subject = {
    subjectRef: 'darce@vds',
    displayName: 'Diego Arce',
    claims: { department: 'operaciones' },
    expiresAt: toInstant('2026-10-05T18:00:00Z'),
  };

  it('verifies a known token and returns only a verified subject', async () => {
    const identity = makeIdentityFixture([{ token: 'tok-1', subject }]);
    const result = await identity.verify('tok-1');
    expect(isUsable(result)).toBe(true);
    if (!isUsable(result)) return;
    expect(result.value.subjectRef).toBe('darce@vds');
    // No roles, no capabilities: the internal permission mapping stays independent of the IdP (13).
    expect(result.value).not.toHaveProperty('roles');
    expect(result.value).not.toHaveProperty('capabilities');
  });

  it('refuses an unknown token even as a dev provider', async () => {
    const identity = makeIdentityFixture([{ token: 'tok-1', subject }]);
    expect((await identity.verify('whatever')).status).toBe('NOT_FOUND');
  });

  it('reports UNAVAILABLE when the IdP is down, not a successful anonymous subject', async () => {
    const identity = makeIdentityFixture([{ token: 'tok-1', subject }], { unavailable: true });
    const result = await identity.verify('tok-1');
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.value).toBeUndefined();
  });
});

/* -------------------------------------------------------------- documentary */

describe('DocumentaryPort', () => {
  const records = [
    {
      externalId: 'D-1',
      subjectExternalId: 'P-1001',
      requirementCode: 'RQ-INDUCCION',
      state: 'VALID' as const,
      validFrom: '2026-01-01',
      validUntil: '2027-03-31',
    },
    {
      externalId: 'D-2',
      subjectExternalId: 'P-1002',
      requirementCode: 'RQ-INDUCCION',
      state: 'EXPIRED' as const,
      validFrom: '2025-01-01',
      validUntil: '2026-09-28',
    },
    {
      externalId: 'D-3',
      subjectExternalId: 'P-1003',
      requirementCode: 'RQ-INDUCCION',
      // The provider holds a record but cannot tell us its state.
      state: 'UNDETERMINED' as const,
    },
  ];
  const docs: DocumentaryPort = makeDocumentaryFixture(records);

  it('reports VALID, EXPIRED and UNDETERMINED as three different answers', async () => {
    const valid = await docs.getCompliance('P-1001', 'RQ-INDUCCION');
    const expired = await docs.getCompliance('P-1002', 'RQ-INDUCCION');
    const undetermined = await docs.getCompliance('P-1003', 'RQ-INDUCCION');

    expect(isUsable(valid) && valid.value.state).toBe('VALID');
    expect(isUsable(expired) && expired.value.state).toBe('EXPIRED');
    // UNDETERMINED is NOT compliant and NOT a failure: the domain decides what it means for a gate.
    expect(isUsable(undetermined) && undetermined.value.state).toBe('UNDETERMINED');
  });

  it('has no boolean "compliant" anywhere in its answer', async () => {
    const result = await docs.getCompliance('P-1001', 'RQ-INDUCCION');
    expect(isUsable(result)).toBe(true);
    if (!isUsable(result)) return;
    // A boolean here would force the adapter to decide a business rule, which 14 forbids.
    expect(Object.values(result.value).every((v) => typeof v !== 'boolean')).toBe(true);
  });

  it('reports UNAVAILABLE rather than MISSING when the provider is down', async () => {
    const broken = makeDocumentaryFixture(records, { unavailable: true });
    const result = await broken.getCompliance('P-1001', 'RQ-INDUCCION');
    // This is the distinction that stops an outage from silently blocking everyone as "missing", or
    // worse, from being treated as compliant.
    expect(result.status).toBe('UNAVAILABLE');
  });
});

/* --------------------------------------------------------------------- ERP */

describe('ErpPort', () => {
  const submission = {
    idempotencyKey: 'idem-1',
    lotCode: 'LOTE-001',
    clientExternalId: 'C-1',
    lines: [{ itemCode: 'IT-DESM', quantity: '1200.000000', unitCode: 'm2', reference: 'UC-1' }],
  };

  it('returns a TEST-prefixed reference, so a fixture ref is unmistakable', async () => {
    const erp: ErpPort = makeErpFixture();
    const result = await erp.submit(submission);
    expect(isUsable(result)).toBe(true);
    if (!isUsable(result)) return;
    expect(result.value.outcome).toBe('ACCEPTED');
    expect(result.value.externalRef).toMatch(/^TEST-/);
  });

  it('is idempotent on the key: resubmitting returns the same answer', async () => {
    const erp = makeErpFixture();
    const first = await erp.submit(submission);
    const second = await erp.submit(submission);
    expect(isUsable(first) && isUsable(second)).toBe(true);
    if (!isUsable(first) || !isUsable(second)) return;
    expect(second.value.externalRef).toBe(first.value.externalRef);
  });

  it('surfaces a structured ERROR without inventing an emission', async () => {
    const erp = makeErpFixture({ outcome: 'ERROR' });
    const result = await erp.submit(submission);
    expect(isUsable(result)).toBe(true);
    if (!isUsable(result)) return;
    expect(result.value.outcome).toBe('ERROR');
    expect(result.value.externalRef).toBeUndefined();
    expect(result.value.errorCode).toBeTruthy();
  });

  it('returns UNKNOWN for a lost response, and reconcile resolves it', async () => {
    // 11/14: an HTTP 200 is not fiscal issuance, and a timeout is neither success nor failure.
    const erp = makeErpFixture({ outcome: 'UNKNOWN' });
    const submitted = await erp.submit(submission);
    expect(isUsable(submitted) && submitted.value.outcome).toBe('UNKNOWN');
    expect(isUsable(submitted) && submitted.value.externalRef).toBeUndefined();

    const reconciled = await erp.reconcile('idem-1');
    expect(isUsable(reconciled)).toBe(true);
    if (!isUsable(reconciled)) return;
    expect(reconciled.value.outcome).toBe('ACCEPTED');
    expect(reconciled.value.externalRef).toMatch(/^TEST-RECONCILED-/);
  });

  it('reports NOT_FOUND when reconciling a key it never saw', async () => {
    expect((await makeErpFixture().reconcile('never-sent')).status).toBe('NOT_FOUND');
  });
});

/* ------------------------------------------------------------- notification */

describe('NotificationPort — sending is not discharging', () => {
  it('accepts a send but reports that nothing was delivered externally', async () => {
    const channel = makeNotificationFixture();
    const sent = await channel.send({
      obligationCode: 'NOTIF-DERRAME',
      recipientRole: 'habilita',
      subject: 'Derrame menor en batería 3',
      body: 'Se reportó un derrame menor.',
    });
    expect(isUsable(sent)).toBe(true);
    if (!isUsable(sent)) return;
    expect(sent.value.accepted).toBe(true);
    expect(sent.value.channelKind).toBe('TEST_FIXTURE');

    const status = await channel.getStatus(sent.value.channelRef!);
    expect(isUsable(status)).toBe(true);
    if (!isUsable(status)) return;
    // RGT-16: a fixture channel proves nothing about external delivery.
    expect(status.value.delivered).toBe(false);
    expect(status.value.detail).toMatch(/no se realizó ninguna entrega externa/);
    expect(status.value.detail).toMatch(/se resuelve con\s+evidencia/);
  });
});

/* ------------------------------------------------------------------- files */

describe('FilesPort — a partial or corrupt upload is not an upload', () => {
  const content = Buffer.from('contenido de la evidencia');
  const hash = (b: Buffer): string =>
    // Same algorithm the port declares; computed here so the test does not trust the fixture.
    require('node:crypto').createHash('sha256').update(b).digest('hex') as string;

  it('completes when the bytes match the declared size and hash', async () => {
    const files = makeFilesFixture();
    const init = await files.initUpload({
      objectKey: 'evidence/ok.jpg',
      byteSize: content.byteLength,
      contentType: 'image/jpeg',
      contentHash: hash(content),
    });
    expect(isUsable(init)).toBe(true);
    if (!isUsable(init)) return;

    await files.putChunk({ uploadToken: init.value.uploadToken, offset: 0, bytes: content });
    const done = await files.completeUpload(init.value.uploadToken);
    expect(isUsable(done)).toBe(true);
    if (!isUsable(done)) return;
    expect(done.value.byteSize).toBe(content.byteLength);
    expect(done.value.contentHash).toBe(hash(content));
  });

  it('refuses to complete a truncated upload (RGT-09)', async () => {
    const files = makeFilesFixture();
    const init = await files.initUpload({
      objectKey: 'evidence/truncated.jpg',
      byteSize: content.byteLength,
      contentType: 'image/jpeg',
      contentHash: hash(content),
    });
    if (!isUsable(init)) throw new Error('init failed');

    await files.putChunk({
      uploadToken: init.value.uploadToken,
      offset: 0,
      bytes: content.subarray(0, 5),
    });
    const done = await files.completeUpload(init.value.uploadToken);
    expect(done.status).toBe('UNAVAILABLE');
    expect(done.error?.code).toBe('SIZE_MISMATCH');
  });

  it('refuses to complete when the content does not match the declared hash', async () => {
    const files = makeFilesFixture();
    const other = Buffer.from('contenido distinto!!!!!!!');
    const init = await files.initUpload({
      objectKey: 'evidence/corrupt.jpg',
      byteSize: other.byteLength,
      contentType: 'image/jpeg',
      contentHash: hash(content), // declares one thing, sends another
    });
    if (!isUsable(init)) throw new Error('init failed');
    await files.putChunk({ uploadToken: init.value.uploadToken, offset: 0, bytes: other });
    const done = await files.completeUpload(init.value.uploadToken);
    expect(done.status).toBe('UNAVAILABLE');
    expect(done.error?.code).toBe('CHECKSUM_MISMATCH');
  });

  it('is idempotent per offset, so a retried chunk does not double-count', async () => {
    const files = makeFilesFixture();
    const init = await files.initUpload({
      objectKey: 'evidence/retry.jpg',
      byteSize: content.byteLength,
      contentType: 'image/jpeg',
      contentHash: hash(content),
    });
    if (!isUsable(init)) throw new Error('init failed');

    await files.putChunk({ uploadToken: init.value.uploadToken, offset: 0, bytes: content });
    const again = await files.putChunk({ uploadToken: init.value.uploadToken, offset: 0, bytes: content });
    expect(isUsable(again) && again.value.bytesReceived).toBe(content.byteLength);
    expect((await files.completeUpload(init.value.uploadToken)).status).toBe('OK');
  });

  it('hands out a short-lived opaque URL, never a predictable name', async () => {
    const files = makeFilesFixture();
    const init = await files.initUpload({
      objectKey: 'evidence/signed.jpg',
      byteSize: content.byteLength,
      contentType: 'image/jpeg',
      contentHash: hash(content),
    });
    if (!isUsable(init)) throw new Error('init failed');
    await files.putChunk({ uploadToken: init.value.uploadToken, offset: 0, bytes: content });
    await files.completeUpload(init.value.uploadToken);

    const url = await files.getSignedUrl('evidence/signed.jpg', 60);
    expect(isUsable(url)).toBe(true);
    if (!isUsable(url)) return;
    expect(url.value.url).toMatch(/token=/);
    expect(url.value.expiresAt).toBeTruthy();
  });

  it('reports NOT_FOUND for an object that was never stored', async () => {
    expect((await makeFilesFixture().getSignedUrl('evidence/nope.jpg', 60)).status).toBe('NOT_FOUND');
  });
});

/* ------------------------------------------------------------------ bundle */

describe('the provider bundle is honest about being fixtures', () => {
  it('reports that fixtures are in use, and which ones', () => {
    const providers = makeFixtureProviders();
    expect(hasFixtureProvider(providers)).toBe(true);
    // This list drives the operations banner (14: "product UI deja visible modo proveedor") and the
    // ops test that no TEST provider is active in a productive base.
    expect(fixtureProviders(providers)).toEqual([
      'client',
      'documentary',
      'erp',
      'files',
      'identity',
      'masters',
      'notification',
      'weather',
    ]);
  });

  it('exposes all eight ports the architecture declares', () => {
    expect(Object.keys(makeFixtureProviders()).sort()).toEqual([
      'client',
      'documentary',
      'erp',
      'files',
      'identity',
      'masters',
      'notification',
      'weather',
    ]);
  });

  it('propagates a behaviour to every port, so an outage can be simulated as a whole', async () => {
    const providers = makeFixtureProviders({ behaviour: { unavailable: true } });
    expect((await providers.masters.getPerson('P-1001')).status).toBe('UNAVAILABLE');
    expect((await providers.documentary.getCompliance('P-1001', 'RQ')).status).toBe('UNAVAILABLE');
    expect((await providers.weather.observe({ at: AT })).status).toBe('UNAVAILABLE');
  });
});
