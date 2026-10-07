/**
 * Fixture implementations of every port.
 *
 * These are not stubs that return success. Each one can be told to fail, go stale, or answer
 * UNKNOWN, because the behaviours that matter most are the unhappy ones: 14 requires the contract
 * tests to cover "stale/unknown/error y mapping", and RGT-12/RGT-13/RGT-16 all turn on a provider
 * refusing to pretend.
 *
 * Everything returned is marked `TEST_FIXTURE`. That label reaches the UI, so a TEST ERP reference
 * can never be read as a real one.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Instant } from '@vds/kernel';
import type {
  ClientConformityRequest,
  ClientPort,
  DocumentaryPort,
  ErpPort,
  ErpSubmission,
  ErpSubmissionOutcome,
  ExternalClient,
  ExternalComplianceRecord,
  ExternalContract,
  ExternalCostCenter,
  ExternalPerson,
  ExternalResource,
  FilesPort,
  IdentityPort,
  MastersPort,
  NotificationPort,
  NotificationRequest,
  NotificationOutcome,
  Page,
  PageRequest,
  Providers,
  ProviderResult,
  StoredObject,
  VerifiedSubject,
  WeatherObservation,
  WeatherPort,
} from './ports.ts';

const now = (): Instant => new Date().toISOString() as Instant;
const correlation = (): string => randomUUID();

const ok = <T>(value: T, extra: Partial<ProviderResult<T>> = {}): ProviderResult<T> => ({
  status: 'OK',
  value,
  correlationId: correlation(),
  observedAt: now(),
  providerKind: 'TEST_FIXTURE',
  ...extra,
});

const notFound = <T>(): ProviderResult<T> => ({
  status: 'NOT_FOUND',
  correlationId: correlation(),
  providerKind: 'TEST_FIXTURE',
});

const unavailable = <T>(code = 'FIXTURE_UNAVAILABLE'): ProviderResult<T> => ({
  status: 'UNAVAILABLE',
  correlationId: correlation(),
  providerKind: 'TEST_FIXTURE',
  error: { code, message: 'El proveedor fixture fue configurado como no disponible.', retryable: true },
});

const stale = <T>(value: T, ageMinutes: number): ProviderResult<T> => ({
  status: 'STALE',
  value,
  correlationId: correlation(),
  observedAt: new Date(Date.now() - ageMinutes * 60_000).toISOString() as Instant,
  providerKind: 'TEST_FIXTURE',
});

const pendingMapping = <T>(externalId: string): ProviderResult<T> => ({
  status: 'PENDING_MAPPING',
  externalId,
  correlationId: correlation(),
  providerKind: 'TEST_FIXTURE',
});

function paginate<T>(items: readonly T[], page?: PageRequest): Page<T> {
  const limit = page?.limit ?? 50;
  const start = page?.cursor ? Number.parseInt(page.cursor, 10) : 0;
  const slice = items.slice(start, start + limit);
  const next = start + limit;
  return {
    items: slice,
    ...(next < items.length ? { nextCursor: String(next) } : {}),
    total: items.length,
  };
}

/** How a fixture should behave, so a test can exercise the unhappy paths. */
export interface FixtureBehaviour {
  /** Fail every call with UNAVAILABLE. */
  readonly unavailable?: boolean;
  /** Answer with a value this many minutes old, as STALE. */
  readonly staleByMinutes?: number;
  /** External ids that exist upstream but are not mapped yet. */
  readonly pendingMappingIds?: readonly string[];
}

/* ------------------------------------------------------------------- Masters */

export interface MastersSeed {
  readonly people?: readonly ExternalPerson[];
  readonly resources?: readonly ExternalResource[];
  readonly clients?: readonly ExternalClient[];
  readonly contracts?: readonly ExternalContract[];
  readonly costCenters?: readonly ExternalCostCenter[];
}

/** Translated from the prototype's CREW / EQ / CONTRATOS constants. */
const DEFAULT_MASTERS: Required<MastersSeed> = {
  people: [
    { externalId: 'P-1001', code: 'darce', firstName: 'Diego', lastName: 'Arce', affiliation: 'VDS', isActive: true },
    { externalId: 'P-1002', code: 'cpaz', firstName: 'Cristian', lastName: 'Paz', affiliation: 'VDS', isActive: true },
    { externalId: 'P-1003', code: 'lvillegas', firstName: 'Lucas', lastName: 'Villegas', affiliation: 'VDS', isActive: true },
    { externalId: 'P-1004', code: 'rojeda', firstName: 'Ramón', lastName: 'Ojeda', affiliation: 'VDS', isActive: true },
    // A client-side person, to prove the two populations stay apart (audit §9).
    { externalId: 'P-2001', code: 'grivas', firstName: 'Gustavo', lastName: 'Rivas', affiliation: 'CLIENT', isActive: true },
  ],
  resources: [
    { externalId: 'R-31', code: 'PU-31', name: 'Pick-up Hilux', resourceTypeCode: 'PICKUP', metering: 'ODOMETER_KM', isActive: true },
    { externalId: 'R-14', code: 'HG-14', name: 'Hidrogrúa 28 t', resourceTypeCode: 'HIDROGRUA', metering: 'HOURMETER_H', isActive: true },
    { externalId: 'R-22', code: 'CM-22', name: 'Camión batea', resourceTypeCode: 'CAMION', metering: 'ODOMETER_KM', isActive: true },
  ],
  clients: [
    { externalId: 'C-1', code: 'AUP', name: 'Austral Petróleo', operatorCode: 'AUP', operatorName: 'Austral Petróleo' },
    { externalId: 'C-2', code: 'GEN', name: 'Golfo Energía', operatorCode: 'GEN', operatorName: 'Golfo Energía' },
  ],
  contracts: [
    { externalId: 'CT-1', code: 'CT-AUP-017', clientExternalId: 'C-1', name: 'Movimiento de suelo y líneas' },
    { externalId: 'CT-2', code: 'CT-AUP-021', clientExternalId: 'C-1', name: 'Transporte de cargas' },
  ],
  costCenters: [
    { externalId: 'CC-1', code: '4410', name: 'Operaciones Comodoro', validFrom: '2026-01-01' },
    { externalId: 'CC-2', code: '4420', name: 'Operaciones Las Heras', validFrom: '2026-01-01' },
  ],
};

export function makeMastersFixture(
  seed: MastersSeed = {},
  behaviour: FixtureBehaviour = {},
): MastersPort {
  const data = { ...DEFAULT_MASTERS, ...seed };

  const guard = <T>(externalId: string | null, produce: () => ProviderResult<T>): ProviderResult<T> => {
    if (behaviour.unavailable) return unavailable<T>();
    if (externalId && behaviour.pendingMappingIds?.includes(externalId)) {
      return pendingMapping<T>(externalId);
    }
    const result = produce();
    if (behaviour.staleByMinutes !== undefined && result.status === 'OK' && result.value !== undefined) {
      return stale(result.value, behaviour.staleByMinutes);
    }
    return result;
  };

  return {
    kind: 'TEST_FIXTURE',
    async getPerson(externalId) {
      return guard(externalId, () => {
        const found = data.people.find((p) => p.externalId === externalId);
        return found ? ok(found, { externalId, sourceVersion: 'fixture-1' }) : notFound();
      });
    },
    async searchPeople(query, page) {
      return guard(null, () => {
        const q = query.toLowerCase();
        const matches = data.people.filter((p) =>
          `${p.firstName} ${p.lastName} ${p.code ?? ''}`.toLowerCase().includes(q),
        );
        return ok(paginate(matches, page));
      });
    },
    async listPeopleChangedSince(_since, page) {
      // A fixture has no change log; it returns everything and says when it observed it. A real
      // adapter filters, and the caller must not assume incrementality it did not get.
      return guard(null, () => ok(paginate(data.people, page)));
    },
    async getResource(externalId) {
      return guard(externalId, () => {
        const found = data.resources.find((r) => r.externalId === externalId);
        return found ? ok(found, { externalId }) : notFound();
      });
    },
    async listResourcesChangedSince(_since, page) {
      return guard(null, () => ok(paginate(data.resources, page)));
    },
    async getClient(externalId) {
      return guard(externalId, () => {
        const found = data.clients.find((c) => c.externalId === externalId);
        return found ? ok(found, { externalId }) : notFound();
      });
    },
    async listClients(page) {
      return guard(null, () => ok(paginate(data.clients, page)));
    },
    async getContract(externalId) {
      return guard(externalId, () => {
        const found = data.contracts.find((c) => c.externalId === externalId);
        return found ? ok(found, { externalId }) : notFound();
      });
    },
    async listContracts(page) {
      return guard(null, () => ok(paginate(data.contracts, page)));
    },
    async listCostCenters(page) {
      return guard(null, () => ok(paginate(data.costCenters, page)));
    },
  };
}

/* ------------------------------------------------------------------ Identity */

export function makeIdentityFixture(
  subjects: readonly { token: string; subject: VerifiedSubject }[] = [],
  behaviour: FixtureBehaviour = {},
): IdentityPort {
  return {
    kind: 'TEST_FIXTURE',
    async verify(token) {
      if (behaviour.unavailable) return unavailable<VerifiedSubject>('IDP_UNAVAILABLE');
      const found = subjects.find((s) => s.token === token);
      // A dev provider still refuses an unknown token: 13 says "Ningún selector de rol frontend
      // equivale a un login productivo", and a fixture that accepts anything would be exactly that.
      return found ? ok(found.subject) : notFound<VerifiedSubject>();
    },
  };
}

/* ---------------------------------------------------------------- Documentary */

export function makeDocumentaryFixture(
  records: readonly ExternalComplianceRecord[] = [],
  behaviour: FixtureBehaviour = {},
): DocumentaryPort {
  return {
    kind: 'TEST_FIXTURE',
    async getCompliance(subjectExternalId, requirementCode) {
      if (behaviour.unavailable) return unavailable<ExternalComplianceRecord>('DOCS_UNAVAILABLE');
      const found = records.find(
        (r) => r.subjectExternalId === subjectExternalId && r.requirementCode === requirementCode,
      );
      if (!found) return notFound<ExternalComplianceRecord>();
      if (behaviour.staleByMinutes !== undefined) return stale(found, behaviour.staleByMinutes);
      return ok(found);
    },
    async listCompliance(subjectExternalId) {
      if (behaviour.unavailable) return unavailable<Page<ExternalComplianceRecord>>('DOCS_UNAVAILABLE');
      return ok(paginate(records.filter((r) => r.subjectExternalId === subjectExternalId)));
    },
  };
}

/* ----------------------------------------------------------------------- ERP */

export interface ErpFixtureOptions extends FixtureBehaviour {
  /** Force a particular outcome, to exercise ERROR and UNKNOWN handling. */
  readonly outcome?: 'ACCEPTED' | 'ERROR' | 'UNKNOWN';
}

export function makeErpFixture(options: ErpFixtureOptions = {}): ErpPort {
  // Keyed by idempotency key: resubmitting the same key returns the same answer, which is what a
  // real ERP integration must also guarantee (RUL-072).
  const submissions = new Map<string, ErpSubmissionOutcome>();

  const build = (submission: ErpSubmission): ErpSubmissionOutcome => {
    switch (options.outcome ?? 'ACCEPTED') {
      case 'ERROR':
        return {
          outcome: 'ERROR',
          errorCode: 'FIXTURE_REJECTED',
          errorMessage: 'El ERP fixture rechazó el payload.',
        };
      case 'UNKNOWN':
        // The call timed out. Neither success nor failure: it must be reconciled.
        return { outcome: 'UNKNOWN' };
      default:
        return {
          outcome: 'ACCEPTED',
          // The TEST- prefix is deliberate: a reference from a fixture must be unmistakable.
          externalRef: `TEST-${submission.lotCode}-${submission.idempotencyKey.slice(0, 8)}`,
        };
    }
  };

  return {
    kind: 'TEST_FIXTURE',
    async submit(submission) {
      if (options.unavailable) return unavailable<ErpSubmissionOutcome>('ERP_UNAVAILABLE');
      const existing = submissions.get(submission.idempotencyKey);
      if (existing) return ok(existing);
      const outcome = build(submission);
      submissions.set(submission.idempotencyKey, outcome);
      return ok(outcome);
    },
    async reconcile(idempotencyKey) {
      if (options.unavailable) return unavailable<ErpSubmissionOutcome>('ERP_UNAVAILABLE');
      const existing = submissions.get(idempotencyKey);
      if (!existing) return notFound<ErpSubmissionOutcome>();
      // Reconciling an UNKNOWN resolves it: the ERP did receive it after all.
      if (existing.outcome === 'UNKNOWN') {
        const resolved: ErpSubmissionOutcome = {
          outcome: 'ACCEPTED',
          externalRef: `TEST-RECONCILED-${idempotencyKey.slice(0, 8)}`,
        };
        submissions.set(idempotencyKey, resolved);
        return ok(resolved);
      }
      return ok(existing);
    },
  };
}

/* -------------------------------------------------------------------- Weather */

export function makeWeatherFixture(
  observation?: Partial<WeatherObservation>,
  behaviour: FixtureBehaviour = {},
): WeatherPort {
  return {
    kind: 'TEST_FIXTURE',
    async observe(input) {
      if (behaviour.unavailable) return unavailable<WeatherObservation>('WEATHER_UNAVAILABLE');
      const value: WeatherObservation = {
        temperatureC: 11,
        windKph: 42,
        gustKph: 68,
        direction: 'SO',
        condition: 'Ventoso',
        stationRef: 'FIXTURE-STATION',
        observedAt: input.at,
        ...observation,
      };
      // Stale weather is the normal failure mode worth testing: 14 forbids a gate on an old value.
      if (behaviour.staleByMinutes !== undefined) return stale(value, behaviour.staleByMinutes);
      // observedAt is when the OBSERVATION was taken, not when this call happened. Defaulting it to
      // the call time would make every reading look fresh, which is exactly the illusion the
      // prototype's clima button created.
      return ok(value, { observedAt: value.observedAt });
    },
  };
}

/* --------------------------------------------------------------- Notification */

export function makeNotificationFixture(behaviour: FixtureBehaviour = {}): NotificationPort {
  const sent = new Map<string, NotificationRequest>();
  return {
    kind: 'TEST_FIXTURE',
    async send(request) {
      if (behaviour.unavailable) return unavailable<NotificationOutcome>('CHANNEL_UNAVAILABLE');
      const ref = `TEST-NOTIF-${randomUUID().slice(0, 8)}`;
      sent.set(ref, request);
      // accepted:true means the fixture accepted it for sending. It does NOT mean the obligation is
      // discharged — that needs evidence (RGT-16, C-027).
      return ok({ accepted: true, channelRef: ref, channelKind: 'TEST_FIXTURE' });
    },
    async getStatus(channelRef) {
      if (!sent.has(channelRef)) return notFound<{ delivered: boolean }>();
      return ok({
        delivered: false,
        detail:
          'Canal TEST: no se realizó ninguna entrega externa. La obligación se resuelve con ' +
          'evidencia, no con una llamada exitosa a un fixture.',
      });
    },
  };
}

/* --------------------------------------------------------------------- Files */

export function makeFilesFixture(behaviour: FixtureBehaviour = {}): FilesPort {
  interface Upload {
    objectKey: string;
    declaredSize: number;
    declaredHash: string;
    contentType: string;
    chunks: Uint8Array[];
    received: number;
  }
  const uploads = new Map<string, Upload>();
  const stored = new Map<string, { bytes: Uint8Array; contentType: string; hash: string }>();

  return {
    kind: 'TEST_FIXTURE',
    async initUpload(input) {
      if (behaviour.unavailable) return unavailable<{ uploadToken: string }>('STORAGE_UNAVAILABLE');
      const uploadToken = randomUUID();
      uploads.set(uploadToken, {
        objectKey: input.objectKey,
        declaredSize: input.byteSize,
        declaredHash: input.contentHash,
        contentType: input.contentType,
        chunks: [],
        received: 0,
      });
      return ok({ uploadToken });
    },
    async putChunk(input) {
      const upload = uploads.get(input.uploadToken);
      if (!upload) return notFound<{ bytesReceived: number }>();
      // Idempotent by offset: re-sending a chunk after a dropped connection must not double-count.
      if (input.offset < upload.received) return ok({ bytesReceived: upload.received });
      upload.chunks.push(input.bytes);
      upload.received += input.bytes.byteLength;
      return ok({ bytesReceived: upload.received });
    },
    async completeUpload(uploadToken) {
      const upload = uploads.get(uploadToken);
      if (!upload) return notFound<StoredObject>();
      const bytes = Buffer.concat(upload.chunks.map((c) => Buffer.from(c)));
      const hash = createHash('sha256').update(bytes).digest('hex');

      // A truncated or corrupted upload is NOT complete. RGT-09: a closure that requires evidence
      // must not be reported documentary-complete while the file never really arrived.
      if (bytes.byteLength !== upload.declaredSize) {
        return {
          status: 'UNAVAILABLE',
          correlationId: correlation(),
          providerKind: 'TEST_FIXTURE',
          error: {
            code: 'SIZE_MISMATCH',
            message: `Se declararon ${upload.declaredSize} bytes y llegaron ${bytes.byteLength}.`,
            retryable: true,
          },
        };
      }
      if (hash !== upload.declaredHash) {
        return {
          status: 'UNAVAILABLE',
          correlationId: correlation(),
          providerKind: 'TEST_FIXTURE',
          error: {
            code: 'CHECKSUM_MISMATCH',
            message: 'El contenido recibido no coincide con el hash declarado.',
            retryable: true,
          },
        };
      }

      stored.set(upload.objectKey, { bytes, contentType: upload.contentType, hash });
      uploads.delete(uploadToken);
      return ok({
        objectKey: upload.objectKey,
        byteSize: bytes.byteLength,
        contentHash: hash,
        contentType: upload.contentType,
      });
    },
    async getSignedUrl(objectKey, ttlSeconds) {
      if (!stored.has(objectKey)) return notFound<{ url: string; expiresAt: Instant }>();
      // Short-lived and opaque, never a predictable name (13).
      const token = randomUUID();
      return ok({
        url: `fixture://evidence/${encodeURIComponent(objectKey)}?token=${token}`,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() as Instant,
      });
    },
    async get(objectKey) {
      const found = stored.get(objectKey);
      return found ? ok({ bytes: found.bytes, contentType: found.contentType }) : notFound();
    },
  };
}

/* -------------------------------------------------------------------- Client */

export function makeClientFixture(behaviour: FixtureBehaviour = {}): ClientPort {
  const sent = new Map<string, ClientConformityRequest>();
  const decisions = new Map<string, { decision: 'ACEPTA' | 'RECHAZA' | 'OBSERVA'; note?: string }>();

  return {
    kind: 'TEST_FIXTURE',
    async sendForConformity(request) {
      if (behaviour.unavailable) return unavailable<{ externalRef: string }>('CLIENT_UNAVAILABLE');
      const externalRef = `TEST-CONF-${randomUUID().slice(0, 8)}`;
      sent.set(externalRef, request);
      return ok({ externalRef });
    },
    async getConformity(externalRef) {
      if (!sent.has(externalRef)) {
        return notFound<{ decision: 'ACEPTA' | 'RECHAZA' | 'OBSERVA' | 'PENDIENTE' }>();
      }
      const decided = decisions.get(externalRef);
      // Pending is the honest default: the client has not answered, and nothing should assume it did.
      return ok(
        decided
          ? { decision: decided.decision, ...(decided.note ? { note: decided.note } : {}), decidedAt: now() }
          : { decision: 'PENDIENTE' as const },
      );
    },
  };
}

/* -------------------------------------------------------------------- bundle */

export interface FixtureProvidersOptions {
  readonly masters?: MastersSeed;
  readonly compliance?: readonly ExternalComplianceRecord[];
  readonly identities?: readonly { token: string; subject: VerifiedSubject }[];
  readonly erp?: ErpFixtureOptions;
  readonly behaviour?: FixtureBehaviour;
}

/** Every provider as a fixture. The default for development and for the test suite. */
export function makeFixtureProviders(options: FixtureProvidersOptions = {}): Providers {
  const behaviour = options.behaviour ?? {};
  return {
    masters: makeMastersFixture(options.masters, behaviour),
    identity: makeIdentityFixture(options.identities, behaviour),
    documentary: makeDocumentaryFixture(options.compliance, behaviour),
    erp: makeErpFixture({ ...behaviour, ...options.erp }),
    weather: makeWeatherFixture(undefined, behaviour),
    notification: makeNotificationFixture(behaviour),
    files: makeFilesFixture(behaviour),
    client: makeClientFixture(behaviour),
  };
}
