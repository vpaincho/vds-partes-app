/**
 * API integration harness.
 *
 * Uses Fastify's `inject`, so requests go through the real route stack — auth hook, validation,
 * pipeline, transaction, error mapping — without binding a socket. The database is real: these tests
 * exist to prove that UI → domain → API → persistence actually holds, which a mocked repository
 * cannot show.
 *
 * Unlike the DB suite, these cannot run inside a rolled-back transaction: the pipeline opens its own
 * transaction per command, and deferred constraints must fire at a real commit. So each test seeds
 * what it needs with unique ids and the data accumulates in the dev database — which is also closer
 * to how the system actually behaves.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildServer } from '../../apps/api/src/server.ts';

export const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://vds:vds_dev_only@127.0.0.1:5434/vds_partes';

let app: FastifyInstance | null = null;
let pool: pg.Pool | null = null;

export async function getApp(): Promise<FastifyInstance> {
  app ??= await buildServer({ databaseUrl: connectionString, rulesetVersion: 'test', logger: false });
  return app;
}

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString, max: 4 });
  return pool;
}

export async function teardown(): Promise<void> {
  await app?.close();
  app = null;
  await pool?.end();
  pool = null;
}

export const sql = async <R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<R[]> => (await getPool().query<R>(text, params as unknown[])).rows;

/**
 * A short random token for labels and codes.
 *
 * NOT derived from a uuid: the leading hex of a UUIDv7 is its millisecond timestamp, so two
 * fixtures built in the same millisecond would produce the same label and collide on a UNIQUE
 * constraint. Use this for anything human-readable, and uuid() for identity.
 */
export const token = (length = 10): string => randomUUID().replaceAll('-', '').slice(-length);

/** UUIDv7, matching how the application mints ids. */
export function uuid(ms = Date.now()): string {
  const bytes = Buffer.from(randomUUID().replaceAll('-', ''), 'hex');
  bytes.writeUIntBE(Math.floor(ms), 0, 6);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface Session {
  readonly sessionId: string;
  readonly identityId: string;
  readonly token: string;
  readonly role: string;
}

/**
 * Create an identity with a role and a live session.
 *
 * `contractId` scopes the grant, which is how the RGT-15 cross-tenant test is set up: two clients
 * with grants on different contracts.
 */
export async function makeSession(options: {
  role: string;
  contractId?: string | null;
  baseId?: string | null;
  deviceId?: string | null;
  label?: string;
}): Promise<Session> {
  const identityId = uuid();
  const sessionId = uuid();
  const subject = `${options.label ?? options.role}-${token()}`;

  await sql(
    `INSERT INTO platform.identities (id, subject_ref, provider, display_name, provenance)
     VALUES ($1, $2, 'fixture-dev', $3, 'FIXTURE_TEST')`,
    [identityId, subject, `Test ${options.role}`],
  );
  await sql(
    `INSERT INTO platform.identity_scopes
       (id, identity_id, role_id, contract_id, base_id, valid_from)
     VALUES ($1, $2, $3, $4, $5, now() - interval '1 day')`,
    [uuid(), identityId, options.role, options.contractId ?? null, options.baseId ?? null],
  );
  await sql(
    `INSERT INTO platform.sessions (id, identity_id, device_id, expires_at)
     VALUES ($1, $2, $3, now() + interval '1 hour')`,
    [sessionId, identityId, options.deviceId ?? null],
  );

  return { sessionId, identityId, token: sessionId, role: options.role };
}

export async function makeDevice(label = 'Tablet test'): Promise<string> {
  const deviceId = uuid();
  await sql(
    `INSERT INTO platform.devices (id, label, offline_policy_version)
     VALUES ($1, $2, 'dev-conservative')`,
    [deviceId, label],
  );
  return deviceId;
}

export interface CallOptions {
  readonly session?: Session;
  readonly body?: Record<string, unknown>;
}

export interface CallResult<T = unknown> {
  readonly status: number;
  readonly body: T;
}

export async function post<T = unknown>(url: string, options: CallOptions = {}): Promise<CallResult<T>> {
  const instance = await getApp();
  const response = await instance.inject({
    method: 'POST',
    url,
    ...(options.session ? { headers: { authorization: `Bearer ${options.session.token}` } } : {}),
    payload: options.body ?? {},
  });
  return { status: response.statusCode, body: response.json() as T };
}

export async function get<T = unknown>(url: string, options: CallOptions = {}): Promise<CallResult<T>> {
  const instance = await getApp();
  const response = await instance.inject({
    method: 'GET',
    url,
    ...(options.session ? { headers: { authorization: `Bearer ${options.session.token}` } } : {}),
  });
  return { status: response.statusCode, body: response.json() as T };
}

/**
 * A monotonic clock for fixtures.
 *
 * Commands that follow one another must carry strictly increasing instants: closing an interval at
 * the same second it opened is a zero-length interval, which the schema refuses. Truncating
 * `new Date()` to the second made consecutive calls collide.
 */
let clockOffsetMs = 0;
export function nextInstant(): string {
  clockOffsetMs += 1000;
  return new Date(Date.now() + clockOffsetMs).toISOString().replace(/\.\d+Z$/, 'Z');
}

/** An instant N hours from now, in the Instant format the envelope expects. */
export const hoursFromNow = (hours: number): string =>
  new Date(Date.now() + hours * 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z');

/** The standard command envelope, with a fresh command id unless one is supplied. */
export function envelope(input: {
  commandId?: string;
  occurredAt?: string;
  recordedAt?: string;
  expectedVersion?: number;
  deviceId?: string;
  payload?: Record<string, unknown>;
  override?: Record<string, unknown>;
  confirmations?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  return {
    commandId: input.commandId ?? uuid(),
    occurredAt: input.occurredAt ?? nextInstant(),
    ...(input.recordedAt ? { recordedAt: input.recordedAt } : {}),
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    ...(input.override ? { override: input.override } : {}),
    ...(input.confirmations ? { confirmations: input.confirmations } : {}),
    payload: input.payload ?? {},
  };
}

/* --------------------------------------------------------------- scenario fixtures */

export interface Scenario {
  readonly clientId: string;
  readonly contractId: string;
  readonly contractServiceId: string;
  readonly serviceId: string;
  readonly partTypeId: string;
  readonly locationId: string;
  readonly planId: string;
  readonly planVersionId: string;
  readonly assignmentId: string;
  readonly plannedUnitId: string;
  readonly crewId: string;
  readonly personId: string;
}

/**
 * An approved, dispatched assignment ready to be materialised — the normal path.
 *
 * `requiresWorkPermit` drives the PD-0394 test: with it true and no covering permit, Start Work must
 * block; with a permit activated only later, it must still block for the earlier instant.
 */
export async function makeScenario(
  options: {
    requiresWorkPermit?: boolean;
    expectedPartType?: 'TP-01' | 'TP-02' | 'TP-03';
    /**
     * The approved window. Set it here, never with a later UPDATE: an assignment under an APROBADA
     * version has an immutable scope (R-022), so the trigger refuses to move it afterwards.
     */
    windowStart?: Date;
    windowEnd?: Date;
  } = {},
): Promise<Scenario> {
  const suffix = token(8);
  const clientId = uuid();
  const contractId = uuid();
  const contractVersionId = uuid();
  const contractServiceId = uuid();
  const serviceId = uuid();
  const locationId = uuid();
  const planId = uuid();
  const planVersionId = uuid();
  const assignmentId = uuid();
  const plannedUnitId = uuid();
  const crewId = uuid();
  const personId = uuid();
  const approver = await makeSession({ role: 'planner' });

  const [{ id: partTypeId }] = await sql<{ id: string }>(
    'SELECT id FROM config.part_types WHERE code = $1',
    [options.expectedPartType ?? 'TP-03'],
  );

  await sql(
    `INSERT INTO config.clients (id, code, name, provenance)
     VALUES ($1, $2, 'Cliente escenario', 'FIXTURE_TEST')`,
    [clientId, `CL-${suffix}`],
  );
  await sql(
    `INSERT INTO config.contracts (id, code, client_id, name, provenance)
     VALUES ($1, $2, $3, 'Contrato escenario', 'FIXTURE_TEST')`,
    [contractId, `CT-${suffix}`, clientId],
  );
  await sql(
    `INSERT INTO config.contract_versions (id, contract_id, version_no, valid_from, status)
     VALUES ($1, $2, 1, '2026-01-01', 'PUBLISHED')`,
    [contractVersionId, contractId],
  );
  await sql(
    `INSERT INTO config.services (id, code, name, provenance)
     VALUES ($1, $2, 'Servicio escenario', 'FIXTURE_TEST')`,
    [serviceId, `SV-${suffix}`],
  );
  await sql(
    `INSERT INTO config.contract_services (id, contract_version_id, service_id)
     VALUES ($1, $2, $3)`,
    [contractServiceId, contractVersionId, serviceId],
  );
  await sql(
    `INSERT INTO config.technical_locations (id, code, name, kind, client_id, provenance)
     VALUES ($1, $2, 'Locación escenario', 'BATERIA', $3, 'FIXTURE_TEST')`,
    [locationId, `TL-${suffix}`, clientId],
  );
  await sql(
    `INSERT INTO config.crews (id, code, name) VALUES ($1, $2, 'Cuadrilla escenario')`,
    [crewId, `CR-${suffix}`],
  );
  await sql(
    `INSERT INTO config.people (id, code, first_name, last_name, affiliation, provenance)
     VALUES ($1, $2, 'Operario', 'Escenario', 'VDS', 'FIXTURE_TEST')`,
    [personId, `PE-${suffix}`],
  );

  await sql(`INSERT INTO planning.plans (id, name, state) VALUES ($1, 'Plan escenario', 'ACTIVA')`, [
    planId,
  ]);
  await sql(
    `INSERT INTO planning.plan_versions (id, plan_id, version_no, state, approved_at, approved_by)
     VALUES ($1, $2, 1, 'APROBADA', now(), $3)`,
    [planVersionId, planId, approver.identityId],
  );
  await sql(
    `INSERT INTO planning.planned_assignments
       (id, plan_version_id, state, window_start, window_end, operational_date,
        expected_part_type_id, crew_id, requires_work_permit, dispatched_at)
     VALUES ($1, $2, 'DESPACHADA',
             coalesce($6::timestamptz, now() - interval '2 hours'),
             coalesce($7::timestamptz, now() + interval '8 hours'),
             current_date, $3, $4, $5, now() - interval '3 hours')`,
    [
      assignmentId,
      planVersionId,
      partTypeId,
      crewId,
      options.requiresWorkPermit ?? false,
      options.windowStart ?? null,
      options.windowEnd ?? null,
    ],
  );
  await sql(
    `INSERT INTO planning.planned_units
       (id, planned_assignment_id, service_id, technical_location_id, contract_service_id, description)
     VALUES ($1, $2, $3, $4, $5, 'Trabajo previsto')`,
    [plannedUnitId, assignmentId, serviceId, locationId, contractServiceId],
  );

  return {
    clientId,
    contractId,
    contractServiceId,
    serviceId,
    partTypeId,
    locationId,
    planId,
    planVersionId,
    assignmentId,
    plannedUnitId,
    crewId,
    personId,
  };
}

/**
 * A second scenario whose approved window starts where another one's ends.
 *
 * For overlap tests: an extension of the first assignment runs into the second one's window. Built
 * at insert time because the scope of an approved assignment cannot be moved afterwards.
 */
export async function makeAdjacentScenario(
  after: Scenario,
  options: { days?: number } = {},
): Promise<Scenario> {
  const [anchor] = await sql<{ window_end: Date }>(
    'SELECT window_end FROM planning.planned_assignments WHERE id = $1',
    [after.assignmentId],
  );
  if (!anchor) throw new Error(`no assignment ${after.assignmentId}`);
  const start = anchor.window_end;
  const end = new Date(start.getTime() + (options.days ?? 3) * 86_400_000);
  return makeScenario({ windowStart: start, windowEnd: end });
}

/** Prepare a Parte and create one UE through the API, returning both ids. */
export async function preparePartWithUnit(
  session: Session,
  scenario: Scenario,
): Promise<{ partId: string; unitId: string }> {
  const prepared = await post<{ data: { subject: { id: string } } }>(
    '/execution/parts/prepare',
    {
      session,
      body: envelope({
        payload: { plannedAssignmentId: scenario.assignmentId, crewId: scenario.crewId },
      }),
    },
  );
  if (prepared.status !== 200) {
    throw new Error(`prepare failed: ${prepared.status} ${JSON.stringify(prepared.body)}`);
  }
  const partId = prepared.body.data.subject.id;

  const created = await post<{ data: { subject: { id: string } } }>('/execution/units', {
    session,
    body: envelope({
      payload: {
        partId,
        serviceId: scenario.serviceId,
        description: 'Desmalezado sector sur',
        technicalLocationId: scenario.locationId,
      },
    }),
  });
  if (created.status !== 200) {
    throw new Error(`unit create failed: ${created.status} ${JSON.stringify(created.body)}`);
  }

  return { partId, unitId: created.body.data.subject.id };
}

/** A work permit, with explicit control over when it becomes effective. */
export async function makeWorkPermit(options: {
  unitId: string;
  locationId: string;
  state: 'APROBADO' | 'VIGENTE' | 'VENCIDO' | 'SUSPENDIDO';
  validFrom?: Date;
  validUntil?: Date | null;
}): Promise<string> {
  const permitId = uuid();
  const activated = options.state === 'VIGENTE' ? (options.validFrom ?? new Date()) : null;
  await sql(
    `INSERT INTO habilita.work_permits
       (id, code, permit_type, state, technical_location_id, scope_description,
        valid_from, valid_until, activated_at)
     VALUES ($1, $2, 'CALIENTE', $3, $4, 'Trabajo en batería', $5, $6, $7)`,
    [
      permitId,
      `PT-${token(8)}`,
      options.state,
      options.locationId,
      options.validFrom ?? null,
      options.validUntil ?? null,
      activated,
    ],
  );
  await sql(
    `INSERT INTO habilita.work_permit_execution_units
       (id, work_permit_id, execution_unit_id, covers_from, covers_until)
     VALUES ($1, $2, $3, $4, $5)`,
    [uuid(), permitId, options.unitId, options.validFrom ?? null, options.validUntil ?? null],
  );
  return permitId;
}

/** Attach a person to a Parte as actually present, for clearance checks. */
export async function attachPerson(options: {
  partId: string;
  personId: string;
  role?: string;
  startedAt?: Date;
}): Promise<string> {
  const assignmentId = uuid();
  await sql(
    `INSERT INTO execution.person_execution_assignments
       (id, part_id, person_id, role, started_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      assignmentId,
      options.partId,
      options.personId,
      options.role ?? 'OPERARIO',
      options.startedAt ?? new Date(Date.now() - 3600_000),
    ],
  );
  return assignmentId;
}
