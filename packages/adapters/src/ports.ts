/**
 * Typed ports for every external system.
 *
 * S0 §22 marks this as the key requirement: a fixture adapter must be replaceable by a real one
 * "sin modificar lógica de producto". That only holds if the port is honest about failure, which is
 * why `ProviderResult` has five non-success statuses and why nothing in this file can return a bare
 * boolean.
 *
 * 14_DATA_INTEGRATION_ADAPTERS states the rule these signatures enforce: "Nunca devolver `true` si
 * proveedor no respondió." A documentary provider that timed out must not be indistinguishable from
 * one that said "not compliant" — the first is UNAVAILABLE and blocks a gate for a different reason
 * than the second, and an operator is owed that distinction.
 *
 * Adapters translate schema and protocol. They never decide a business rule: no adapter may return
 * "this person may start work".
 */
import type { Instant, Uuid } from '@vds/kernel';

export type ProviderStatus =
  /** The provider answered and the value is present. */
  | 'OK'
  /** The provider answered and there is no such thing. Different from "we could not ask". */
  | 'NOT_FOUND'
  /** The provider did not answer, or answered with an error. The truth is unknown. */
  | 'UNAVAILABLE'
  /** A cached or last-known value, older than the freshness the caller asked for. */
  | 'STALE'
  /** The record exists upstream but cannot be mapped to a canonical id yet. */
  | 'PENDING_MAPPING';

export interface ProviderError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/**
 * The single result shape every port returns.
 *
 * `observedAt` and `sourceVersion` exist so a caller can decide whether the answer is fresh enough
 * for the decision it is about to make — the audit was explicit that a gate must not be satisfied by
 * stale data.
 */
export interface ProviderResult<T> {
  readonly status: ProviderStatus;
  readonly value?: T;
  readonly sourceId?: string;
  readonly externalId?: string;
  readonly sourceVersion?: string;
  readonly observedAt?: Instant;
  readonly correlationId: string;
  readonly error?: ProviderError;
  /**
   * Whether the answer came from a TEST fixture or a real provider. Surfaced in the UI (14: "product
   * UI deja visible modo proveedor"), so nobody mistakes a fixture reference for a real one.
   */
  readonly providerKind: 'TEST_FIXTURE' | 'REAL_PROVIDER';
}

/** True only for an OK result with a value. The one place this check should live. */
export function isUsable<T>(result: ProviderResult<T>): result is ProviderResult<T> & { value: T } {
  return result.status === 'OK' && result.value !== undefined;
}

/**
 * Can this result satisfy a gate?
 *
 * Deliberately stricter than `isUsable`: a STALE answer is a value but not evidence. RUL-045 and the
 * weather note in 14 both turn on this — "sin gate basado en dato viejo".
 */
export function canSatisfyGate<T>(
  result: ProviderResult<T>,
  options: { readonly maxAgeMinutes?: number; readonly now?: Instant } = {},
): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string } {
  if (result.status !== 'OK' || result.value === undefined) {
    return {
      ok: false,
      reason:
        result.status === 'UNAVAILABLE'
          ? `El proveedor no respondió (${result.error?.code ?? 'sin código'}): el estado es ` +
            'desconocido, no "cumple". Un gate no se satisface con una incógnita.'
          : result.status === 'STALE'
            ? 'El valor disponible es más viejo que la frescura requerida para esta decisión.'
            : result.status === 'PENDING_MAPPING'
              ? 'El registro existe en el origen pero todavía no está mapeado a un id canónico.'
              : 'El proveedor respondió que no existe.',
    };
  }

  if (options.maxAgeMinutes !== undefined && result.observedAt !== undefined) {
    const now = Date.parse(options.now ?? new Date().toISOString());
    const ageMinutes = (now - Date.parse(result.observedAt)) / 60_000;
    if (ageMinutes > options.maxAgeMinutes) {
      return {
        ok: false,
        reason:
          `El dato se observó hace ${Math.round(ageMinutes)} min y la decisión admite hasta ` +
          `${options.maxAgeMinutes} min.`,
      };
    }
  }

  return { ok: true, value: result.value };
}

export interface PageRequest {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
  readonly total?: number;
}

/* ------------------------------------------------------------------- Masters (VDS) */

export interface ExternalPerson {
  readonly externalId: string;
  readonly code?: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly documentId?: string;
  /** Audit §9: do not mix client staff with company staff. The provider must state which. */
  readonly affiliation: 'VDS' | 'CLIENT' | 'CONTRACTOR' | 'OTHER';
  readonly isActive: boolean;
}

export interface ExternalResource {
  readonly externalId: string;
  readonly code?: string;
  readonly name: string;
  readonly resourceTypeCode: string;
  /** Which meter this resource reports, if any. Not every resource reports kilometres. */
  readonly metering: 'NONE' | 'ODOMETER_KM' | 'HOURMETER_H';
  readonly isActive: boolean;
}

export interface ExternalClient {
  readonly externalId: string;
  readonly code: string;
  readonly name: string;
  readonly operatorCode?: string;
  readonly operatorName?: string;
}

export interface ExternalContract {
  readonly externalId: string;
  readonly code: string;
  readonly clientExternalId: string;
  readonly name: string;
}

export interface ExternalCostCenter {
  readonly externalId: string;
  readonly code: string;
  readonly name: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
}

/**
 * Masters owned elsewhere. Read-only: an import never rewrites historical versions (14).
 *
 * `changedSince` is how a scheduled synchronisation stays incremental without CDC, which 14 defers
 * until latency and volume justify it.
 */
export interface MastersPort {
  readonly kind: 'TEST_FIXTURE' | 'REAL_PROVIDER';
  getPerson(externalId: string): Promise<ProviderResult<ExternalPerson>>;
  searchPeople(query: string, page?: PageRequest): Promise<ProviderResult<Page<ExternalPerson>>>;
  listPeopleChangedSince(since: Instant, page?: PageRequest): Promise<ProviderResult<Page<ExternalPerson>>>;
  getResource(externalId: string): Promise<ProviderResult<ExternalResource>>;
  listResourcesChangedSince(since: Instant, page?: PageRequest): Promise<ProviderResult<Page<ExternalResource>>>;
  getClient(externalId: string): Promise<ProviderResult<ExternalClient>>;
  listClients(page?: PageRequest): Promise<ProviderResult<Page<ExternalClient>>>;
  getContract(externalId: string): Promise<ProviderResult<ExternalContract>>;
  listContracts(page?: PageRequest): Promise<ProviderResult<Page<ExternalContract>>>;
  listCostCenters(page?: PageRequest): Promise<ProviderResult<Page<ExternalCostCenter>>>;
}

/* ------------------------------------------------------------- Corporate identity */

export interface VerifiedSubject {
  readonly subjectRef: string;
  readonly displayName: string;
  readonly email?: string;
  /** Claims as the provider states them. The internal permission mapping stays independent (13). */
  readonly claims: Readonly<Record<string, unknown>>;
  readonly expiresAt: Instant;
}

/**
 * Identity. Returns a verified subject and nothing more.
 *
 * It deliberately cannot return roles or capabilities: 13 requires that "el mapeo interno de
 * permisos permanece independiente", so changing IdP never changes who may do what.
 */
export interface IdentityPort {
  readonly kind: 'TEST_FIXTURE' | 'REAL_PROVIDER';
  verify(token: string): Promise<ProviderResult<VerifiedSubject>>;
  /** For a device enrolment flow; not every provider supports it. */
  startDeviceSession?(subjectRef: string, deviceId: Uuid): Promise<ProviderResult<VerifiedSubject>>;
}

/* ----------------------------------------------------------------- Documentary */

export interface ExternalComplianceRecord {
  readonly externalId: string;
  readonly subjectExternalId: string;
  readonly requirementCode: string;
  /**
   * The provider's own view. Note there is no 'COMPLIANT' | 'NOT_COMPLIANT' boolean: a provider that
   * cannot determine the state says so, and the domain decides what that means for a gate.
   */
  readonly state: 'VALID' | 'EXPIRED' | 'MISSING' | 'UNDETERMINED';
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly documentRef?: string;
}

export interface DocumentaryPort {
  readonly kind: 'TEST_FIXTURE' | 'REAL_PROVIDER';
  getCompliance(
    subjectExternalId: string,
    requirementCode: string,
  ): Promise<ProviderResult<ExternalComplianceRecord>>;
  listCompliance(subjectExternalId: string): Promise<ProviderResult<Page<ExternalComplianceRecord>>>;
  /** Fetch the document itself, when the provider exposes it. */
  getDocumentContent?(documentRef: string): Promise<ProviderResult<{ contentType: string; bytes: Uint8Array }>>;
}

/* ------------------------------------------------------------------------ ERP */

export interface ErpSubmission {
  readonly idempotencyKey: string;
  readonly lotCode: string;
  readonly clientExternalId: string;
  readonly lines: readonly {
    readonly itemCode: string;
    readonly quantity: string;
    readonly unitCode: string;
    readonly reference: string;
  }[];
}

/**
 * The ERP answer. UNKNOWN is a first-class outcome.
 *
 * 11 and 14 are explicit: an HTTP 200 is not fiscal issuance, and a lost response is neither success
 * nor failure. Collapsing UNKNOWN into either would make the system claim something it cannot know.
 */
export interface ErpSubmissionOutcome {
  readonly outcome: 'ACCEPTED' | 'ERROR' | 'UNKNOWN';
  readonly externalRef?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

export interface ErpPort {
  readonly kind: 'TEST_FIXTURE' | 'REAL_PROVIDER';
  submit(submission: ErpSubmission): Promise<ProviderResult<ErpSubmissionOutcome>>;
  /** Resolve an UNKNOWN by asking the ERP what it actually has. */
  reconcile(idempotencyKey: string): Promise<ProviderResult<ErpSubmissionOutcome>>;
}

/* ---------------------------------------------------------------------- Weather */

export interface WeatherObservation {
  readonly temperatureC: number;
  readonly windKph: number;
  readonly gustKph: number;
  readonly direction: string;
  readonly condition: string;
  readonly stationRef?: string;
  readonly observedAt: Instant;
}

/**
 * Weather. The port exists mainly to make staleness explicit.
 *
 * The prototype's `o-clima` wrote constants and labelled them "actualizado desde la app". 14 requires
 * place, time, source, freshness and an `unknown` outcome, and forbids a gate based on an old value —
 * so a caller must pass this through `canSatisfyGate` with a max age.
 */
export interface WeatherPort {
  readonly kind: 'TEST_FIXTURE' | 'REAL_PROVIDER';
  observe(input: {
    readonly latitude?: number;
    readonly longitude?: number;
    readonly locationRef?: string;
    readonly at: Instant;
  }): Promise<ProviderResult<WeatherObservation>>;
}

/* ------------------------------------------------------------------ Notification */

export interface NotificationRequest {
  readonly obligationCode: string;
  readonly recipientRole: string;
  readonly recipientRef?: string;
  readonly subject: string;
  readonly body: string;
  readonly dueAt?: Instant;
}

export interface NotificationOutcome {
  readonly accepted: boolean;
  readonly channelRef?: string;
  readonly channelKind: 'TEST_FIXTURE' | 'REAL_PROVIDER';
}

/**
 * Notification channel.
 *
 * Sending is NOT discharging the obligation. RGT-16 and C-027 both say a fixture channel proves
 * nothing about external delivery, and the obligation row in `habilita.notifications` is resolved by
 * evidence, not by a successful call here.
 */
export interface NotificationPort {
  readonly kind: 'TEST_FIXTURE' | 'REAL_PROVIDER';
  send(request: NotificationRequest): Promise<ProviderResult<NotificationOutcome>>;
  getStatus(channelRef: string): Promise<ProviderResult<{ delivered: boolean; detail?: string }>>;
}

/* ---------------------------------------------------------------------- Files */

export interface StoredObject {
  readonly objectKey: string;
  readonly byteSize: number;
  readonly contentHash: string;
  readonly contentType: string;
}

/**
 * Object storage for evidence.
 *
 * Resumable and idempotent, because a crew uploads photos over a bad link. ACL stays in the
 * application: access is a short-lived signed URL granted after a permission check, never a
 * predictable name (13).
 */
export interface FilesPort {
  readonly kind: 'TEST_FIXTURE' | 'REAL_PROVIDER';
  initUpload(input: {
    readonly objectKey: string;
    readonly byteSize: number;
    readonly contentType: string;
    readonly contentHash: string;
  }): Promise<ProviderResult<{ uploadToken: string }>>;
  putChunk(input: {
    readonly uploadToken: string;
    readonly offset: number;
    readonly bytes: Uint8Array;
  }): Promise<ProviderResult<{ bytesReceived: number }>>;
  /** Completes only when the received bytes hash to what was declared. */
  completeUpload(uploadToken: string): Promise<ProviderResult<StoredObject>>;
  getSignedUrl(objectKey: string, ttlSeconds: number): Promise<ProviderResult<{ url: string; expiresAt: Instant }>>;
  get(objectKey: string): Promise<ProviderResult<{ bytes: Uint8Array; contentType: string }>>;
}

/* ----------------------------------------------------------------------- Client */

export interface ClientConformityRequest {
  readonly packageRef: string;
  readonly clientExternalId: string;
  readonly summary: Readonly<Record<string, unknown>>;
}

export interface ClientPort {
  readonly kind: 'TEST_FIXTURE' | 'REAL_PROVIDER';
  sendForConformity(request: ClientConformityRequest): Promise<ProviderResult<{ externalRef: string }>>;
  getConformity(externalRef: string): Promise<
    ProviderResult<{
      readonly decision: 'ACEPTA' | 'RECHAZA' | 'OBSERVA' | 'PENDIENTE';
      readonly note?: string;
      readonly decidedAt?: Instant;
    }>
  >;
}

/** Everything the application needs from the outside world, in one place. */
export interface Providers {
  readonly masters: MastersPort;
  readonly identity: IdentityPort;
  readonly documentary: DocumentaryPort;
  readonly erp: ErpPort;
  readonly weather: WeatherPort;
  readonly notification: NotificationPort;
  readonly files: FilesPort;
  readonly client: ClientPort;
}

/** True when any provider is still a fixture, so the UI can say so honestly. */
export const hasFixtureProvider = (providers: Providers): boolean =>
  Object.values(providers).some((p) => (p as { kind: string }).kind === 'TEST_FIXTURE');

/** Which providers are fixtures, for an operations banner and for the ops test. */
export const fixtureProviders = (providers: Providers): readonly string[] =>
  Object.entries(providers)
    .filter(([, p]) => (p as { kind: string }).kind === 'TEST_FIXTURE')
    .map(([name]) => name)
    .sort();
