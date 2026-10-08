/**
 * Command catalogue: the capability each command requires and the shape of its payload.
 *
 * This table is the single place that answers "what may this actor do". 13_AUTH_PERMISSIONS
 * requires the check on **every** API call — action, object, base, contract and ownership — with
 * default deny. Keeping the requirement next to the schema means a new command cannot be added
 * without declaring what it needs; `assertEveryCommandIsRegistered` in the test proves the API
 * exposes nothing that is missing from here.
 *
 * `trigger` links a command to the rule rows in sheet 57 that fire for it, so the engine can
 * narrow candidates without a hand-maintained mapping.
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { InstantSchema, QuantitySchema, UuidSchema } from './envelope.ts';

export interface CommandDefinition {
  /** Route-stable name, e.g. 'execution.units.start'. */
  readonly name: string;
  readonly module: string;
  /** Capability required. Default deny: no capability means nobody can call it. */
  readonly capability: string;
  /** Semantic trigger from sheet 57, used to select candidate rules. */
  readonly trigger: string;
  /** The aggregate the command acts on, for scope checks and receipts. */
  readonly subjectKind: string;
  readonly payload: TSchema;
  /** True when a preview endpoint exists (POST .../evaluate-<command>). */
  readonly previewable: boolean;
  /** Human description, surfaced in the route listing. */
  readonly description: string;
}

const empty = Type.Object({}, { additionalProperties: false });

/* --------------------------------------------------------------------- execution */

export const PreparePartPayload = Type.Object(
  {
    // No tipoParteId: RUL-001 derives it and C-006 forbids a free selector on the normal path.
    // A caller may name the assignment it is materialising, and routing does the rest.
    plannedAssignmentId: Type.Optional(UuidSchema),
    plannedUnitIds: Type.Optional(Type.Array(UuidSchema)),
    crewId: Type.Optional(UuidSchema),
    operationalDate: Type.Optional(
      Type.String({
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Omit to let the configured shift policy decide from occurredAt (RGT-10).',
      }),
    ),
    // Emergent work: no plan. Permitted only when ReglaInicioEmergente allows it (RUL-037).
    emergent: Type.Optional(
      Type.Object({
        description: Type.String({ minLength: 3 }),
        reason: Type.String({ minLength: 3 }),
        candidateClientId: Type.Optional(UuidSchema),
        technicalLocationId: Type.Optional(UuidSchema),
      }),
    ),
  },
  { additionalProperties: false },
);

export const CreateUnitPayload = Type.Object(
  {
    partId: UuidSchema,
    serviceId: UuidSchema,
    activityId: Type.Optional(UuidSchema),
    description: Type.String({ minLength: 1 }),
    unitKind: Type.Optional(Type.String()),
    technicalLocationId: Type.Optional(UuidSchema),
    clientAssetId: Type.Optional(UuidSchema),
    sequenceNo: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const StartUnitPayload = Type.Object(
  {
    // The location the operator confirmed, when one was required (CF-01, IH-01).
    confirmedLocationId: Type.Optional(UuidSchema),
    timeCategory: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ChangeTimeCategoryPayload = Type.Object(
  {
    timeCategory: Type.String({ minLength: 1 }),
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ReplacePersonPayload = Type.Object(
  {
    outgoingAssignmentId: UuidSchema,
    incomingPersonId: UuidSchema,
    role: Type.String({ minLength: 1 }),
    reason: Type.String({ minLength: 3, description: 'IH-05: the cause belongs to the field.' }),
  },
  { additionalProperties: false },
);

export const CaptureMeasurementPayload = Type.Object(
  {
    metricCode: Type.String({ minLength: 1 }),
    quantity: QuantitySchema,
    measurementSource: Type.Union([
      Type.Literal('HUMAN_READING'),
      Type.Literal('INSTRUMENT'),
      Type.Literal('PRELOADED_CONFIRMED'),
      Type.Literal('EXTERNAL_DOCUMENT'),
    ]),
    notes: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const CloseUnitPayload = Type.Object(
  {
    result: Type.Union([
      Type.Literal('COMPLETADA'),
      Type.Literal('PARCIAL'),
      Type.Literal('NO_REALIZADA'),
      Type.Literal('OTRO'),
    ]),
    // Required by the schema when the result is not COMPLETADA; RUL-019 forbids losing the cause.
    resultReason: Type.Optional(Type.String({ minLength: 3 })),
  },
  { additionalProperties: false },
);

export const CreateAmendmentPayload = Type.Object(
  {
    targetKind: Type.Union([Type.Literal('PART'), Type.Literal('EXECUTION_UNIT')]),
    partId: Type.Optional(UuidSchema),
    executionUnitId: Type.Optional(UuidSchema),
    fieldPath: Type.String({ minLength: 1 }),
    oldValue: Type.Unknown(),
    newValue: Type.Unknown(),
    reason: Type.String({ minLength: 10 }),
    evidenceId: Type.Optional(UuidSchema),
  },
  { additionalProperties: false },
);

export const SuspendUnitPayload = Type.Object(
  {
    // A suspension without a cause is indistinguishable from work stopping for no reason, and the
    // reason is what a later resume has to revalidate against.
    reason: Type.String({ minLength: 3 }),
    reasonCode: Type.Optional(Type.String({ minLength: 1 })),
    /** The directive that ordered it, when the suspension came from the control plane. */
    directiveId: Type.Optional(UuidSchema),
  },
  { additionalProperties: false },
);

export const ResumeUnitPayload = Type.Object(
  {
    // RUL-023 again on the way back in: resuming re-evaluates the subject and the conditions. A
    // permit that expired during the suspension has to block the restart.
    confirmedLocationId: Type.Optional(UuidSchema),
    timeCategory: Type.Optional(Type.String()),
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ConfirmLocationPayload = Type.Object(
  {
    // RUL-031: a master, not free text. `unmappedLabel` exists for the honest case where the place
    // is real and the master does not have it yet — it is recorded as unmapped, never typed as if
    // it were a known location.
    technicalLocationId: Type.Optional(UuidSchema),
    unmappedLabel: Type.Optional(Type.String({ minLength: 2 })),
    locationRole: Type.Union([
      Type.Literal('PRINCIPAL'),
      Type.Literal('ORIGEN'),
      Type.Literal('DESTINO'),
      Type.Literal('CARGA'),
      Type.Literal('DESCARGA'),
    ]),
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ReplaceResourcePayload = Type.Object(
  {
    outgoingAssignmentId: UuidSchema,
    incomingResourceId: UuidSchema,
    role: Type.String({ minLength: 1 }),
    reason: Type.String({ minLength: 3 }),
    /** Odometer or hour-meter of the incoming resource, when the resource type has one. */
    meterReading: Type.Optional(Type.String({ pattern: '^-?\\d+(\\.\\d{1,6})?$' })),
    meterKind: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const RecordTransitionPayload = Type.Object(
  {
    // RUL-030: real time between work packages. Without this the travel time is orphaned, which is
    // the C-013 defect.
    fromExecutionUnitId: Type.Optional(UuidSchema),
    toExecutionUnitId: Type.Optional(UuidSchema),
    fromLocationId: Type.Optional(UuidSchema),
    toLocationId: Type.Optional(UuidSchema),
    startedAt: InstantSchema,
    endedAt: Type.Optional(InstantSchema),
    transitionKind: Type.Union([
      Type.Literal('TRASLADO'),
      Type.Literal('ESPERA'),
      Type.Literal('CAMBIO_FRENTE'),
      Type.Literal('OTRO'),
    ]),
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MarkUnitNotPerformedPayload = Type.Object(
  {
    // RUL-019: what was planned and not done is explained, never deleted. The attempt survives.
    reason: Type.String({ minLength: 3 }),
    reasonCode: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const VoidPayload = Type.Object(
  {
    reason: Type.String({
      minLength: 10,
      description: 'Annulling claims there was never real work. That claim needs a stated basis.',
    }),
  },
  { additionalProperties: false },
);

export const HandoverPayload = Type.Object(
  {
    // RUL-005: the shift changed and the work did not. The outgoing roster closes, the incoming one
    // opens, and the gates are revalidated — the Parte continues.
    incomingCrewId: Type.Optional(UuidSchema),
    incomingPersonIds: Type.Optional(Type.Array(UuidSchema)),
    note: Type.String({ minLength: 3 }),
  },
  { additionalProperties: false },
);

export const ResolveAllocationPayload = Type.Object(
  {
    // All three are required because that is what RESUELTO means: the contract service, the cost
    // centre allowed by the context (R-045) and the item of that service (R-046). A partial
    // resolution is not a resolution, and the database refuses it outright. Anything missing leaves
    // the allocation PENDIENTE, which is a real state and blocks only the commercial derivation.
    contractServiceId: UuidSchema,
    costCenterId: UuidSchema,
    contractItemId: UuidSchema,
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ApproveAmendmentPayload = Type.Object(
  {
    // RUL-073 requires an approver distinct from the author, which the handler enforces: an
    // amendment one person both wrote and approved is an edit with extra steps.
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AttachEvidencePayload = Type.Object(
  {
    targetKind: Type.Union([
      Type.Literal('EXECUTION_UNIT'),
      Type.Literal('PART'),
      Type.Literal('WORK_PERMIT'),
      Type.Literal('HABILITA_EVENT'),
    ]),
    targetId: UuidSchema,
    evidenceKind: Type.Union([
      Type.Literal('PHOTO'),
      Type.Literal('VIDEO'),
      Type.Literal('AUDIO'),
      Type.Literal('SIGNATURE'),
      Type.Literal('DOCUMENT'),
      Type.Literal('MEASUREMENT_READING'),
    ]),
    fileName: Type.String({ minLength: 1 }),
    contentType: Type.String({ minLength: 3 }),
    sizeBytes: Type.Integer({ minimum: 1 }),
    /** sha256 of the bytes. The upload is a separate, resumable transaction (RGT-09). */
    checksum: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    capturedAt: Type.Optional(InstantSchema),
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/* ---------------------------------------------------------------------- planning */

export const ApprovePlanVersionPayload = Type.Object(
  { note: Type.Optional(Type.String()) },
  { additionalProperties: false },
);

export const EvaluateReadinessPayload = Type.Object(
  { validForMinutes: Type.Optional(Type.Integer({ minimum: 1 })) },
  { additionalProperties: false },
);

/**
 * An extension request over an existing assignment.
 *
 * This is the PL-093 shape. The payload names the assignment being extended, which is what lets
 * conflict detection exclude it from its own comparison — the prototype evaluated a *copy* of the
 * job and excluded by object reference, so the copy collided with the original (RGT-01).
 */
export const RequestExtensionPayload = Type.Object(
  {
    additionalDays: Type.Integer({ minimum: 1, maximum: 30 }),
    reason: Type.String({ minLength: 3 }),
  },
  { additionalProperties: false },
);

export const ResolveExtensionPayload = Type.Object(
  {
    decision: Type.Union([Type.Literal('APROBAR'), Type.Literal('RECHAZAR')]),
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const NominatePayload = Type.Object(
  {
    personIds: Type.Optional(Type.Array(UuidSchema)),
    resourceIds: Type.Optional(Type.Array(UuidSchema)),
    role: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MarkNotPerformedPayload = Type.Object(
  {
    // RUL-019: what was planned and not done is never deleted; it is explained.
    reason: Type.String({ minLength: 3 }),
  },
  { additionalProperties: false },
);

export const DispatchPayload = Type.Object(
  {
    deviceId: Type.Optional(UuidSchema),
    identityId: Type.Optional(UuidSchema),
    bundleTtlMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

/* ------------------------------------------------------------------------ control */

export const EmitDirectivePayload = Type.Object(
  {
    directiveType: Type.Union([
      Type.Literal('CANCELAR'),
      Type.Literal('SUSPENDER'),
      Type.Literal('REPROGRAMAR'),
      Type.Literal('REPRIORIZAR'),
      Type.Literal('CAMBIO_ALCANCE'),
    ]),
    reason: Type.String({ minLength: 5 }),
    validUntil: Type.Optional(InstantSchema),
    targets: Type.Array(
      Type.Object(
        {
          targetKind: Type.Union([
            Type.Literal('PLANNED_ASSIGNMENT'),
            Type.Literal('PLANNED_UNIT'),
            Type.Literal('PLAN'),
            Type.Literal('PART'),
            Type.Literal('EXECUTION_UNIT'),
            Type.Literal('WORK_PERMIT'),
          ]),
          targetId: UuidSchema,
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);

export const ApplyDirectivePayload = Type.Object(
  {
    // RUL-057: application must be auditable, so the effect is referenced, never assumed.
    effectRef: Type.Object(
      {
        kind: Type.String({ minLength: 1 }),
        id: Type.Optional(UuidSchema),
        note: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const RejectDirectivePayload = Type.Object(
  { reason: Type.String({ minLength: 5 }) },
  { additionalProperties: false },
);

/* ----------------------------------------------------------------------- habilita */

export const FlashReportPayload = Type.Object(
  {
    // CF-09 / RUL-047: the minimum. Severity and root cause are NOT asked of the reporter.
    initialCategory: Type.String({ minLength: 1 }),
    shortDescription: Type.String({ minLength: 3 }),
    situationControlled: Type.Boolean(),
    occurredAt: InstantSchema,
    technicalLocationId: Type.Optional(UuidSchema),
    unmappedLocation: Type.Optional(Type.String()),
    // C-025: may be standalone, with no execution context at all (GS-033).
    executionUnitIds: Type.Optional(Type.Array(UuidSchema)),
    personIds: Type.Optional(Type.Array(UuidSchema)),
    resourceIds: Type.Optional(Type.Array(UuidSchema)),
    evidenceIds: Type.Optional(Type.Array(UuidSchema)),
  },
  { additionalProperties: false },
);

export const CreatePermitPayload = Type.Object(
  {
    permitType: Type.String({ minLength: 1 }),
    scopeDescription: Type.String({ minLength: 5 }),
    technicalLocationId: Type.Optional(UuidSchema),
    clientId: Type.Optional(UuidSchema),
    executionUnitIds: Type.Optional(Type.Array(UuidSchema)),
  },
  { additionalProperties: false },
);

export const ApprovePermitPayload = Type.Object(
  {
    externalAuthority: Type.Optional(Type.String()),
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const SuspendPermitPayload = Type.Object(
  { reason: Type.String({ minLength: 5 }) },
  { additionalProperties: false },
);

export const ClosePermitPayload = Type.Object(
  {
    // RUL-046: closure needs the authority the policy requires. A VENCIDO permit cannot be closed
    // this way at all — that needs an authorised administrative closure (sheet 51 row 34).
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ActivatePermitPayload = Type.Object(
  {
    validFrom: InstantSchema,
    validUntil: Type.Optional(InstantSchema),
    externalAuthority: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/* ----------------------------------------------------------------- the catalogue */

export const COMMANDS: readonly CommandDefinition[] = [
  // --- planning
  {
    name: 'planning.versions.approve',
    module: 'planning',
    capability: 'planning.approve',
    trigger: 'APPROVE_VERSION',
    subjectKind: 'PlanificacionVersion',
    payload: ApprovePlanVersionPayload,
    previewable: true,
    description: 'RUL-010 hard gate. Freezes the snapshot; the version becomes immutable.',
  },
  {
    name: 'planning.assignments.evaluate-readiness',
    module: 'planning',
    capability: 'planning.readiness',
    trigger: 'EVALUATE_READINESS',
    subjectKind: 'AsignacionPlanificada',
    payload: EvaluateReadinessPayload,
    previewable: false,
    description: 'RUL-013/014. READY carries evaluated_at and valid_until, never a permanent flag.',
  },
  {
    name: 'planning.assignments.dispatch',
    module: 'planning',
    capability: 'planning.dispatch',
    trigger: 'DISPATCH',
    subjectKind: 'AsignacionPlanificada',
    payload: DispatchPayload,
    previewable: true,
    description: 'RUL-016/017. Builds the context bundle. DESPACHADA is not EN_EJECUCION.',
  },

  {
    name: 'planning.assignments.request-extension',
    module: 'planning',
    capability: 'execution.capture',
    trigger: 'POST_DISPATCH_CHANGE',
    subjectKind: 'AsignacionPlanificada',
    payload: RequestExtensionPayload,
    previewable: true,
    description:
      'Pedido de mas dias desde campo. PL-093 / RGT-01: evaluar la extension no debe hacer que la ' +
      'asignacion choque consigo misma.',
  },
  {
    name: 'planning.assignments.resolve-extension',
    module: 'planning',
    capability: 'planning.result',
    trigger: 'POST_DISPATCH_CHANGE',
    subjectKind: 'AsignacionPlanificada',
    payload: ResolveExtensionPayload,
    previewable: true,
    description:
      'RUL-020: el cambio post-despacho produce una version nueva o una directiva; nunca muta el ' +
      'snapshot aprobado (RGT-03).',
  },
  {
    name: 'planning.assignments.nominate',
    module: 'planning',
    capability: 'planning.nominate',
    trigger: 'NOMINATE',
    subjectKind: 'AsignacionPlanificada',
    payload: NominatePayload,
    previewable: true,
    description:
      'RUL-012 hard gate: no se nomina un sujeto inelegible, y un solapamiento se evalua por regla.',
  },
  {
    name: 'planning.assignments.mark-not-performed',
    module: 'planning',
    capability: 'planning.result',
    trigger: 'WINDOW_CLOSED_NO_EXECUTION',
    subjectKind: 'AsignacionPlanificada',
    payload: MarkNotPerformedPayload,
    previewable: false,
    description: 'RUL-019: preserva el desvio previsto vs real con causa estructurada.',
  },

  // --- control plane
  {
    name: 'control.directives.emit',
    module: 'control',
    capability: 'control.emit',
    trigger: 'POST_DISPATCH_COMMAND',
    subjectKind: 'DirectivaOperativa',
    payload: EmitDirectivePayload,
    previewable: false,
    description: 'RUL-054: publica el hecho con target y motivo. Emitir no es aplicar (C-017).',
  },
  {
    name: 'control.directives.ack',
    module: 'control',
    capability: 'control.apply',
    trigger: 'ACK',
    subjectKind: 'DirectivaOperativa',
    payload: empty,
    previewable: false,
    description: 'RUL-056: ACK semantico. No significa aplicada.',
  },
  {
    name: 'control.directives.apply',
    module: 'control',
    capability: 'control.apply',
    trigger: 'EFFECT_EXECUTED',
    subjectKind: 'DirectivaOperativa',
    payload: ApplyDirectivePayload,
    previewable: true,
    description: 'RUL-057: exige evidencia del efecto y los gates del target (TPR-016).',
  },
  {
    name: 'control.directives.reject',
    module: 'control',
    capability: 'control.apply',
    trigger: 'EFFECT_EXECUTED',
    subjectKind: 'DirectivaOperativa',
    payload: RejectDirectivePayload,
    previewable: false,
    description: 'T-D05: cierra el lifecycle sin aplicacion, con causa estructurada.',
  },

  // --- execution
  {
    name: 'execution.parts.prepare',
    module: 'execution',
    capability: 'execution.prepare',
    trigger: 'CREATE_PART',
    subjectKind: 'Parte',
    payload: PreparePartPayload,
    previewable: true,
    description: 'RUL-001 routes TipoParte; RUL-021 hard gate. PREPARADO does not mean executing.',
  },
  {
    name: 'execution.units.create',
    module: 'execution',
    capability: 'execution.prepare',
    trigger: 'CREATE_UE',
    subjectKind: 'UnidadEjecucion',
    payload: CreateUnitPayload,
    previewable: false,
    description: 'T-UE01. The operational grain, created by the TipoParte composition rule.',
  },
  {
    name: 'execution.units.start',
    module: 'execution',
    capability: 'execution.start',
    trigger: 'START_WORK',
    subjectKind: 'UnidadEjecucion',
    payload: StartUnitPayload,
    previewable: true,
    description:
      'RUL-022 hard block then RUL-023 hard gate, including PTW temporal coverage at the real ' +
      'instant (PD-0394). Re-evaluates: a preview does not authorise this (RGT-17).',
  },
  {
    name: 'execution.units.change-time-category',
    module: 'execution',
    capability: 'execution.capture',
    trigger: 'TIME_CATEGORY_CHANGE',
    subjectKind: 'UnidadEjecucion',
    payload: ChangeTimeCategoryPayload,
    previewable: false,
    description: 'RUL-029. Closes the previous interval and opens the next; no overwriting.',
  },
  {
    name: 'execution.units.replace-person',
    module: 'execution',
    capability: 'execution.replace',
    trigger: 'PERSON_REPLACED',
    subjectKind: 'UnidadEjecucion',
    payload: ReplacePersonPayload,
    previewable: true,
    description: 'RUL-025. Closes the outgoing interval and opens the incoming one. No retro-edit.',
  },
  {
    name: 'execution.units.capture-measurement',
    module: 'execution',
    capability: 'execution.capture',
    trigger: 'MEASUREMENT_CAPTURED',
    subjectKind: 'UnidadEjecucion',
    payload: CaptureMeasurementPayload,
    previewable: false,
    description: 'RUL-032. Operational magnitude; the certifiable quantity is derived later.',
  },
  {
    name: 'execution.units.close',
    module: 'execution',
    capability: 'execution.close',
    trigger: 'CLOSE_UE',
    subjectKind: 'UnidadEjecucion',
    payload: CloseUnitPayload,
    previewable: true,
    description: 'RUL-033 hard gate. Writes the immutable version a UC will later point at.',
  },
  {
    name: 'execution.parts.close',
    module: 'execution',
    capability: 'execution.close',
    trigger: 'CLOSE_PART',
    subjectKind: 'Parte',
    payload: empty,
    previewable: true,
    description: 'RUL-034 hard gate. Operational closure only: not documentary, not certified.',
  },
  {
    name: 'execution.amendments.create',
    module: 'execution',
    capability: 'execution.amend',
    trigger: 'REAL_ERROR_DISCOVERED',
    subjectKind: 'EnmiendaOperativa',
    payload: CreateAmendmentPayload,
    previewable: true,
    description: 'RUL-073. The only way to correct closed reality; produces a new version.',
  },

  {
    name: 'execution.units.suspend',
    module: 'execution',
    capability: 'execution.capture',
    trigger: 'SUSPEND',
    subjectKind: 'UnidadEjecucion',
    payload: SuspendUnitPayload,
    previewable: false,
    description: 'T-UE04. Cierra el intervalo abierto con causa. Suspender no es cerrar.',
  },
  {
    name: 'execution.units.resume',
    module: 'execution',
    capability: 'execution.start',
    trigger: 'RESTART_WORK',
    subjectKind: 'UnidadEjecucion',
    payload: ResumeUnitPayload,
    previewable: true,
    description:
      'T-UE05. Reanudar revalida sujeto y condiciones: un PTW vencido durante la suspension ' +
      'bloquea el reinicio (RUL-022/023).',
  },
  {
    name: 'execution.units.confirm-location',
    module: 'execution',
    capability: 'execution.capture',
    trigger: 'LOCATION_CHANGED',
    subjectKind: 'UnidadEjecucion',
    payload: ConfirmLocationPayload,
    previewable: false,
    description: 'RUL-031 maestro, no texto libre. RUL-008: la ubicacion no corta por si sola.',
  },
  {
    name: 'execution.units.replace-resource',
    module: 'execution',
    capability: 'execution.replace',
    trigger: 'RESOURCE_REPLACED',
    subjectKind: 'UnidadEjecucion',
    payload: ReplaceResourcePayload,
    previewable: true,
    description: 'RUL-026. Cierra el intervalo saliente y abre el entrante; no edita el pasado.',
  },
  {
    name: 'execution.units.record-transition',
    module: 'execution',
    capability: 'execution.capture',
    trigger: 'TRANSITION_RECORDED',
    subjectKind: 'UnidadEjecucion',
    payload: RecordTransitionPayload,
    previewable: false,
    description: 'RUL-030. Tiempo real entre work packages: evita tiempo huerfano (C-013).',
  },
  {
    name: 'execution.units.mark-not-performed',
    module: 'execution',
    capability: 'execution.capture',
    trigger: 'NOT_PERFORMED',
    subjectKind: 'UnidadEjecucion',
    payload: MarkUnitNotPerformedPayload,
    previewable: false,
    description: 'RUL-019. Preserva el intento con causa estructurada; nunca borra.',
  },
  {
    name: 'execution.units.void',
    module: 'execution',
    capability: 'execution.close',
    trigger: 'VOID',
    subjectKind: 'UnidadEjecucion',
    payload: VoidPayload,
    previewable: true,
    description: 'T-UE07. Solo si no hubo trabajo real: anular no es una forma de corregir.',
  },
  {
    name: 'execution.parts.void',
    module: 'execution',
    capability: 'execution.close',
    trigger: 'VOID',
    subjectKind: 'Parte',
    payload: VoidPayload,
    previewable: true,
    description: 'T-P07. Solo desde PREPARADO y sin evidencia de ejecucion.',
  },
  {
    name: 'execution.parts.handover',
    module: 'execution',
    capability: 'execution.capture',
    trigger: 'SHIFT_CHANGED',
    subjectKind: 'Parte',
    payload: HandoverPayload,
    previewable: true,
    description:
      'RUL-005. El patron decide: handover y continuidad por default, Parte nuevo solo si una ' +
      'ReglaCorte configurada lo exige.',
  },
  {
    name: 'execution.allocations.resolve',
    module: 'execution',
    capability: 'execution.capture',
    trigger: 'ALLOCATION_RESOLVED',
    subjectKind: 'UnidadEjecucion',
    payload: ResolveAllocationPayload,
    previewable: true,
    description: 'R-045/R-046. Resuelve la imputacion versionando, sin inventar CC ni item (AP-06).',
  },
  {
    name: 'execution.amendments.approve',
    module: 'execution',
    capability: 'execution.amend',
    trigger: 'AMENDMENT_APPROVED',
    subjectKind: 'EnmiendaOperativa',
    payload: ApproveAmendmentPayload,
    previewable: true,
    description:
      'RUL-073. Produce la version efectiva nueva e invalida los derivados (RUL-065). El aprobador ' +
      'no puede ser el autor.',
  },
  {
    name: 'execution.evidence.attach',
    module: 'execution',
    capability: 'execution.capture',
    trigger: 'EVIDENCE_ATTACHED',
    subjectKind: 'Evidencia',
    payload: AttachEvidencePayload,
    previewable: false,
    description:
      'Registra la evidencia con hash, tamano, actor e instante. La subida es una transaccion ' +
      'aparte y reanudable: un cierre que exige evidencia no queda completo hasta la entrega.',
  },

  // --- habilita
  {
    name: 'habilita.events.flash-report',
    module: 'habilita',
    capability: 'habilita.report',
    trigger: 'REPORT_EVENT',
    subjectKind: 'EventoHabilita',
    payload: FlashReportPayload,
    previewable: false,
    description: 'RUL-047. Minimum input, context auto-derived, may be standalone (GS-033).',
  },
  {
    name: 'habilita.permits.create',
    module: 'habilita',
    capability: 'habilita.permit.manage',
    trigger: 'CREAR',
    subjectKind: 'PermisoTrabajo',
    payload: CreatePermitPayload,
    previewable: false,
    description: 'T-PTW01. El PTW es una autorizacion formal independiente del Parte (C-019).',
  },
  {
    name: 'habilita.permits.submit',
    module: 'habilita',
    capability: 'habilita.permit.manage',
    trigger: 'ENVIAR_APROBACION',
    subjectKind: 'PermisoTrabajo',
    payload: empty,
    previewable: false,
    description: 'T-PTW02: solicita aprobacion con los campos minimos completos.',
  },
  {
    name: 'habilita.permits.approve',
    module: 'habilita',
    capability: 'habilita.permit.approve',
    trigger: 'APROBAR',
    subjectKind: 'PermisoTrabajo',
    payload: ApprovePermitPayload,
    previewable: true,
    description: 'T-PTW03. Aprobado NO es vigente: activar es un acto autorizado aparte (RUL-043).',
  },
  {
    name: 'habilita.permits.suspend',
    module: 'habilita',
    capability: 'habilita.permit.activate',
    trigger: 'CONDITION_CHANGED',
    subjectKind: 'PermisoTrabajo',
    payload: SuspendPermitPayload,
    previewable: false,
    description: 'RUL-044: retira cobertura y bloquea el trabajo cubierto. No cierra el permiso.',
  },
  {
    name: 'habilita.permits.close',
    module: 'habilita',
    capability: 'habilita.permit.activate',
    trigger: 'CLOSE',
    subjectKind: 'PermisoTrabajo',
    payload: ClosePermitPayload,
    previewable: true,
    description: 'RUL-046 hard gate. Un permiso VENCIDO no se cierra por aca (TPR-013).',
  },
  {
    name: 'habilita.permits.activate',
    module: 'habilita',
    capability: 'habilita.permit.activate',
    trigger: 'ACTIVATE',
    subjectKind: 'PermisoTrabajo',
    payload: ActivatePermitPayload,
    previewable: true,
    description: 'RUL-043. APROBADO is not VIGENTE: activation is its own authorised act.',
  },
];

const byName = new Map(COMMANDS.map((c) => [c.name, c]));

export function command(name: string): CommandDefinition {
  const found = byName.get(name);
  if (!found) {
    throw new Error(
      `Unknown command "${name}". Every command must be registered in COMMANDS with the ` +
        'capability it requires — default deny means an unregistered command is callable by nobody.',
    );
  }
  return found;
}

export const commandNames: readonly string[] = COMMANDS.map((c) => c.name);

/** Every distinct capability the catalogue references, for seeding platform.capabilities. */
export const requiredCapabilities: readonly string[] = [
  ...new Set(COMMANDS.map((c) => c.capability)),
].sort();

export type PreparePartInput = Static<typeof PreparePartPayload>;
export type CreateUnitInput = Static<typeof CreateUnitPayload>;
export type StartUnitInput = Static<typeof StartUnitPayload>;
export type CloseUnitInput = Static<typeof CloseUnitPayload>;
export type FlashReportInput = Static<typeof FlashReportPayload>;
export type ReplacePersonInput = Static<typeof ReplacePersonPayload>;
export type CaptureMeasurementInput = Static<typeof CaptureMeasurementPayload>;
export type CreateAmendmentInput = Static<typeof CreateAmendmentPayload>;
export type ActivatePermitInput = Static<typeof ActivatePermitPayload>;
export type DispatchInput = Static<typeof DispatchPayload>;
export type ApprovePlanVersionInput = Static<typeof ApprovePlanVersionPayload>;
export type EvaluateReadinessInput = Static<typeof EvaluateReadinessPayload>;
export type RequestExtensionInput = Static<typeof RequestExtensionPayload>;
export type ResolveExtensionInput = Static<typeof ResolveExtensionPayload>;
export type NominateInput = Static<typeof NominatePayload>;
export type MarkNotPerformedInput = Static<typeof MarkNotPerformedPayload>;
export type EmitDirectiveInput = Static<typeof EmitDirectivePayload>;
export type ApplyDirectiveInput = Static<typeof ApplyDirectivePayload>;
export type RejectDirectiveInput = Static<typeof RejectDirectivePayload>;
export type CreatePermitInput = Static<typeof CreatePermitPayload>;
export type ApprovePermitInput = Static<typeof ApprovePermitPayload>;
export type SuspendPermitInput = Static<typeof SuspendPermitPayload>;
export type ClosePermitInput = Static<typeof ClosePermitPayload>;
export type ChangeTimeCategoryInput = Static<typeof ChangeTimeCategoryPayload>;
export type SuspendUnitInput = Static<typeof SuspendUnitPayload>;
export type ResumeUnitInput = Static<typeof ResumeUnitPayload>;
export type ConfirmLocationInput = Static<typeof ConfirmLocationPayload>;
export type ReplaceResourceInput = Static<typeof ReplaceResourcePayload>;
export type RecordTransitionInput = Static<typeof RecordTransitionPayload>;
export type MarkUnitNotPerformedInput = Static<typeof MarkUnitNotPerformedPayload>;
export type VoidInput = Static<typeof VoidPayload>;
export type HandoverInput = Static<typeof HandoverPayload>;
export type ResolveAllocationInput = Static<typeof ResolveAllocationPayload>;
export type ApproveAmendmentInput = Static<typeof ApproveAmendmentPayload>;
export type AttachEvidenceInput = Static<typeof AttachEvidencePayload>;
