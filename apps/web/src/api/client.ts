/**
 * API client.
 *
 * Thin on purpose. The browser holds no business rules: 13 is explicit that frontend role visibility
 * is UX only, and 06 that the UI must not monopolise rules. So this translates HTTP into typed
 * results and nothing else — every gate, every scope check and every state transition is decided on
 * the server and arrives here as a DecisionEnvelope or a typed error.
 *
 * The one piece of judgement it does carry: it never invents a success. A failed fetch becomes a
 * typed error with `retryable`, so the UI can tell "it was refused" from "we could not ask" — which
 * is the same distinction the ports make, for the same reason.
 */
import type { DecisionEnvelope } from '@vds/kernel';

export interface ApiMeta {
  readonly requestId: string;
  readonly serverTime: string;
  readonly asOf?: string;
  readonly source?: string;
}

export interface ApiErrorDetail {
  readonly path?: string;
  readonly message: string;
  readonly ruleId?: string;
  readonly sourceRef?: string;
  readonly instead?: string;
}

export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details: readonly ApiErrorDetail[];
  readonly ruleIds: readonly string[];
  readonly decisionId?: string;
  readonly retryable: boolean;
  readonly blocks?: readonly {
    readonly ruleId: string;
    readonly reason: string;
    readonly instead?: string;
    readonly sourceRef?: string;
  }[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return this.body.code;
  }

  /** True when a gate refused this, as opposed to a validation or transport problem. */
  get isBlocked(): boolean {
    return this.body.code === 'GATE_BLOCKED' || this.body.code === 'CONFIRMATION_REQUIRED';
  }
}

export interface CommandResult<T = unknown> {
  readonly receipt: {
    readonly commandId: string;
    readonly receiptId: string;
    readonly decisionId?: string;
    readonly outcome: 'APPLIED' | 'REPLAYED' | 'NO_OP';
    readonly receiptAt: string;
  };
  readonly decision: DecisionEnvelope;
  readonly data: { readonly subject: { kind: string; id: string | null; code?: string }; readonly version?: number };
  readonly meta: ApiMeta;
}

const BASE = '/api';

let sessionToken: string | null = null;

/**
 * Hold the session token in memory only.
 *
 * Not localStorage: 13 requires that a shared tablet isolate sessions and that logout not leave a
 * usable credential behind. Durable offline state is a separate concern with its own policy (W4) and
 * does not include a bearer token.
 */
export function setSession(token: string | null): void {
  sessionToken = token;
}

export const hasSession = (): boolean => sessionToken !== null;

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(sessionToken === null ? {} : { authorization: `Bearer ${sessionToken}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    // No answer at all. This is NOT a refusal, and the UI must not render it as one.
    throw new ApiError(0, {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'No se pudo contactar al servidor. Los cambios no fueron enviados.',
      details: [{ message: cause instanceof Error ? cause.message : 'fetch failed' }],
      ruleIds: [],
      retryable: true,
    });
  }

  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);

  if (!response.ok) {
    const errorBody = (parsed as { error?: ApiErrorBody } | null)?.error;
    throw new ApiError(
      response.status,
      errorBody ?? {
        code: 'INVARIANT_VIOLATED',
        message: `El servidor respondió ${response.status} sin un cuerpo interpretable.`,
        details: [],
        ruleIds: [],
        retryable: false,
      },
    );
  }

  return parsed as T;
}

/** A read model. `meta.source` and `meta.asOf` travel with the data by design. */
export const read = <T>(path: string): Promise<{ data: T; meta: ApiMeta }> =>
  call<{ data: T; meta: ApiMeta }>('GET', path);

/** Mint a command id. UUIDv7 so a queued command sorts by creation. */
export function newCommandId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const ms = Date.now();
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface CommandOptions {
  readonly commandId?: string;
  readonly occurredAt?: string;
  readonly expectedVersion?: number;
  readonly payload?: Record<string, unknown>;
  readonly confirmations?: Record<string, unknown>;
  readonly override?: { gateId: string; ruleId: string; reason: string; evidenceId?: string };
}

/**
 * Send a command.
 *
 * The command id is minted once per user intent and reused across retries, which is what makes the
 * retry safe (RGT-06). A caller that mints a fresh id on retry defeats idempotency, so the id is
 * accepted as an option rather than always generated here.
 */
export const command = <T = unknown>(path: string, options: CommandOptions = {}): Promise<CommandResult<T>> =>
  call<CommandResult<T>>('POST', path, {
    commandId: options.commandId ?? newCommandId(),
    occurredAt: options.occurredAt ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
    ...(options.confirmations ? { confirmations: options.confirmations } : {}),
    ...(options.override ? { override: options.override } : {}),
    payload: options.payload ?? {},
  });

/**
 * Evaluate without applying.
 *
 * Used to show a gate panel before the operator commits. The result authorises nothing: the command
 * re-evaluates, and a document revoked in between still blocks (RGT-17). The UI must not treat a
 * green preview as permission already granted.
 */
export function evaluate<T = unknown>(path: string, options: CommandOptions = {}): Promise<CommandResult<T>> {
  const previewPath = path.replace(/\/([^/]+)$/, '/evaluate-$1');
  return command<T>(previewPath, options);
}

/* --------------------------------------------------------------------- read models */

export interface MyDayRow {
  readonly partId: string;
  readonly code: string | null;
  readonly partType: string;
  readonly operational: { readonly state: string; readonly openUnits: number; readonly totalUnits: number };
  readonly delivery: { readonly outstanding: number };
  readonly operationalDate: string;
  readonly shiftId: string | null;
  readonly isEmergent: boolean;
  readonly crewName: string | null;
  readonly openIntervals: number;
}

export const fetchMyDay = (date?: string) =>
  read<MyDayRow[]>(`/field/my-day${date ? `?date=${date}` : ''}`);

export interface PartDetail {
  readonly part: Record<string, unknown>;
  readonly units: readonly Record<string, unknown>[];
  readonly intervals: readonly Record<string, unknown>[];
  readonly people: readonly Record<string, unknown>[];
  readonly locations: readonly Record<string, unknown>[];
  readonly measurements: readonly Record<string, unknown>[];
  readonly unitsOfMeasure: readonly { readonly id: string; readonly code: string; readonly name: string }[];
}

export const fetchPart = (partId: string) => read<PartDetail>(`/execution/parts/${partId}`);

export interface TimelineRow {
  readonly id: string;
  readonly code: string | null;
  readonly state: string;
  readonly window_start: string;
  readonly window_end: string;
  readonly operational_date: string;
  readonly shift_id: string | null;
  readonly priority: string;
  readonly requires_work_permit: boolean;
  readonly dispatched_at: string | null;
  readonly not_performed_reason: string | null;
  readonly version: number;
  readonly expected_part_type: string | null;
  readonly crew_id: string | null;
  readonly crew_name: string | null;
  readonly resource_id: string | null;
  readonly resource_code: string | null;
  readonly resource_name: string | null;
  readonly plan_id: string;
  readonly plan_name: string | null;
  readonly plan_version_id: string;
  readonly version_no: number;
  readonly plan_version_state: string;
  readonly readiness: string | null;
  readonly readiness_at: string | null;
  readonly readiness_until: string | null;
  readonly readiness_cause_count: number;
  readonly directives_open: string;
  readonly extension_pending: string;
  readonly linked_parts: string;
}

export const fetchTimeline = (from?: string, to?: string) => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return read<TimelineRow[]>(`/planning/timeline${query ? `?${query}` : ''}`);
};

/**
 * Occupancy, as two named metrics.
 *
 * Both are returned by the server and neither is combined here. 15 records that the prototype's
 * single "ocupación" silently mixed resource-days with hour utilisation; the client must not
 * reintroduce that by averaging them into a percentage.
 */
export interface OccupancyRow {
  readonly subject_kind: 'RECURSO' | 'CUADRILLA';
  readonly subject_id: string;
  readonly subject_code: string | null;
  readonly subject_name: string | null;
  readonly assignments: string;
  readonly occupied_days: string;
  readonly planned_hours: string;
}

export const fetchOccupancy = (from: string, to: string) =>
  read<OccupancyRow[]>(`/planning/occupancy?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);

export interface AssignmentDetail {
  readonly assignment: Record<string, unknown>;
  readonly units: readonly Record<string, unknown>[];
  readonly people: readonly Record<string, unknown>[];
  readonly resources: readonly Record<string, unknown>[];
  readonly readiness: readonly {
    readonly id: string;
    readonly result: string;
    readonly causes: readonly { ruleId?: string; reason?: string; instead?: string }[];
    readonly dependencies: unknown;
    readonly evaluated_at: string;
    readonly valid_until: string | null;
    readonly invalidated_at: string | null;
  }[];
  readonly directives: readonly DirectiveRow[];
  readonly extensions: readonly {
    readonly id: string;
    readonly state: string;
    readonly additional_days: number;
    readonly reason: string;
    readonly approved_window_end: string;
    readonly proposed_window_end: string;
    readonly requested_at: string;
    readonly resolved_at: string | null;
    readonly resolution_note: string | null;
    readonly resulting_assignment_id: string | null;
  }[];
  readonly versions: readonly {
    readonly id: string;
    readonly version_no: number;
    readonly state: string;
    readonly approved_at: string | null;
    readonly superseded_at: string | null;
    readonly assignments: string;
    readonly window_in_version: { windowStart: string; windowEnd: string } | null;
  }[];
  readonly links: readonly Record<string, unknown>[];
  readonly permits: readonly PermitRow[];
}

export const fetchAssignment = (assignmentId: string) =>
  read<AssignmentDetail>(`/planning/assignments/${assignmentId}`);

export interface NomineePerson {
  readonly id: string;
  readonly code: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly affiliation: string;
  readonly already_nominated: boolean;
  readonly in_crew: boolean;
  readonly overlapping: string;
  readonly unmet_requirements:
    | readonly {
        readonly requirementCode: string;
        readonly requirementName: string;
        readonly severity: string;
        readonly overrideableVia: string | null;
        readonly status: string;
      }[]
    | null;
}

export interface NomineeResource {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly resource_type: string | null;
  readonly already_nominated: boolean;
  readonly overlapping: string;
}

export const fetchNominees = (assignmentId: string, q = '') =>
  read<{ people: readonly NomineePerson[]; resources: readonly NomineeResource[] }>(
    `/planning/assignments/${assignmentId}/nominees${q ? `?q=${encodeURIComponent(q)}` : ''}`,
  );

export interface DirectiveLifecycleEvent {
  readonly eventType: string;
  readonly occurredAt: string;
  readonly fromState: string | null;
  readonly toState: string | null;
}

export interface DirectiveRow {
  readonly id: string;
  readonly code: string | null;
  readonly directive_type: string;
  readonly state: string;
  readonly reason: string;
  readonly issued_at: string;
  readonly valid_until: string | null;
  readonly received_at: string | null;
  readonly acknowledged_at: string | null;
  readonly applied_at: string | null;
  readonly applied_effect_ref: Record<string, unknown> | null;
  readonly rejected_at: string | null;
  readonly rejection_reason: string | null;
  readonly issued_by_name?: string | null;
  readonly targets?: readonly {
    readonly targetKind: string;
    readonly plannedAssignmentId: string | null;
    readonly assignmentCode: string | null;
  }[];
  readonly lifecycle: readonly DirectiveLifecycleEvent[] | null;
}

export const fetchDirectives = (options: { state?: string; open?: boolean } = {}) => {
  const params = new URLSearchParams();
  if (options.state) params.set('state', options.state);
  if (options.open) params.set('open', 'true');
  const query = params.toString();
  return read<DirectiveRow[]>(`/control/directives${query ? `?${query}` : ''}`);
};

export interface PermitRow {
  readonly id: string;
  readonly code: string | null;
  readonly permit_type: string;
  readonly state: string;
  readonly scope_description: string | null;
  readonly external_authority: string | null;
  readonly valid_from: string | null;
  readonly valid_until: string | null;
  readonly activated_at: string | null;
  readonly suspended_at: string | null;
  readonly closed_at: string | null;
  readonly expired_at: string | null;
  readonly location_code?: string | null;
  readonly location_name?: string | null;
  readonly client_name?: string | null;
  readonly requested_by_name?: string | null;
  readonly approved_by_name?: string | null;
  readonly covered_units?: string;
  readonly lifecycle?: readonly DirectiveLifecycleEvent[] | null;
}

export const fetchPermits = (options: { state?: string; locationId?: string } = {}) => {
  const params = new URLSearchParams();
  if (options.state) params.set('state', options.state);
  if (options.locationId) params.set('locationId', options.locationId);
  const query = params.toString();
  return read<PermitRow[]>(`/habilita/permits${query ? `?${query}` : ''}`);
};

export interface TraceEntry {
  readonly decisionId: string;
  readonly decision: string;
  readonly trigger: string;
  readonly currentState: string | null;
  readonly targetState: string | null;
  readonly blocks: readonly { ruleId: string; reason: string; instead?: string }[];
  readonly warnings: readonly { ruleId: string; reason: string }[];
  readonly preview: boolean;
  readonly decidedAt: string;
  readonly actor: string | null;
  readonly rules: readonly { ruleId: string; precedence: string; outcome: string; note: string | null }[];
}

export const fetchTrace = (subjectKind: string, subjectId: string) =>
  read<TraceEntry[]>(`/trace/${subjectKind}/${subjectId}`);

export interface CommandInfo {
  readonly name: string;
  readonly module: string;
  readonly capability: string;
  readonly subjectKind: string;
  readonly previewable: boolean;
  readonly implemented: boolean;
  readonly allowedForActor: boolean;
  readonly route: string | null;
  readonly description: string;
}

export const fetchCommands = () => read<CommandInfo[]>('/commands');
