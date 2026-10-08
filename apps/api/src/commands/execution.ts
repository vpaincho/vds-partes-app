/**
 * Execution command handlers.
 *
 * A handler does three things and nothing more: resolve the subject and its scope, contribute stage
 * evaluators, and apply effects once the engine has authorised them. It never evaluates its own
 * gates — that is what keeps authority ordering consistent across every command (AP-01).
 */
import { createHash } from 'node:crypto';
import {
  resolveOperationalMoment,
  calendarDayPolicy,
  DEFAULT_OPERATIONAL_ZONE,
  uuidv7,
  type Blocker,
  type ConfirmationRequired,
  type Instant,
  type MissingItem,
  type Uuid,
} from '@vds/kernel';
import type { StageOutcome } from '@vds/rules';
import type {
  CloseUnitInput,
  CreateUnitInput,
  PreparePartInput,
  StartUnitInput,
} from '@vds/contracts';
import { registerHandler, type CommandHandler } from '../platform/pipeline.ts';
import type { Db } from '../platform/db.ts';
import {
  controlPlane,
  habilitaGate,
  historyInvariants,
  routeTipoParte,
  stateTransition,
} from './evaluators.ts';
import {
  loadPart,
  loadUnit,
  PART_TERMINAL,
  requireSubjectId,
  UNIT_TERMINAL,
} from './execution-shared.ts';


/* -------------------------------------------------------------- execution.parts.prepare */

const preparePart: CommandHandler<PreparePartInput> = {
  name: 'execution.parts.prepare',

  async resolveScope({ db, payload }) {
    // Scope comes from the assignment when there is one; emergent work is scoped by the actor's
    // own grants, which assertAuthorised then checks.
    let scope: { baseId?: Uuid | null; contractId?: Uuid | null } = {};
    if (payload.plannedAssignmentId) {
      const row = await db.one<{ base_id: Uuid | null; contract_id: Uuid | null }>(
        `SELECT p.base_id,
                c.id AS contract_id
         FROM planning.planned_assignments a
         JOIN planning.plan_versions pv ON pv.id = a.plan_version_id
         JOIN planning.plans p ON p.id = pv.plan_id
         LEFT JOIN planning.planned_units pu ON pu.planned_assignment_id = a.id
         LEFT JOIN config.contract_services cs ON cs.id = pu.contract_service_id
         LEFT JOIN config.contract_versions cv ON cv.id = cs.contract_version_id
         LEFT JOIN config.contracts c ON c.id = cv.contract_id
         WHERE a.id = $1
         LIMIT 1`,
        [payload.plannedAssignmentId],
      );
      scope = { baseId: row?.base_id ?? null, contractId: row?.contract_id ?? null };
    }
    // A Parte that does not exist yet has no id: the subject is the kind alone.
    return { subject: { kind: 'Parte', id: null }, scope };
  },

  async evaluators({ db, payload, envelope }) {
    return [
      routeTipoParte({
        db,
        subject: { kind: 'Parte', id: null },
        ...(payload.plannedAssignmentId ? { plannedAssignmentId: payload.plannedAssignmentId } : {}),
        isEmergent: payload.emergent !== undefined,
        at: envelope.occurredAt as Instant,
      }),
      // No from-state: creation. The target state is PREPARADO, declared by the handler.
      stateTransition({
        machine: 'Parte',
        event: 'CREAR_PARTE',
        subject: { kind: 'Parte', id: null },
        effects: [
          {
            kind: 'CREATE_PART',
            description: 'Crear el Parte en PREPARADO con el TipoParte derivado por ruteo.',
            ruleId: 'RUL-021',
          },
        ],
      }),
    ];
  },

  async apply({ db, payload, actor, occurredAt, derived, correlationId }) {
    const partTypeId = derived['partTypeId'] as Uuid | undefined;
    if (!partTypeId) {
      // Unreachable: routing either derives one or asks for confirmation, and a confirmation
      // request does not authorise. Guarding anyway, because C-005 makes this NOT NULL.
      throw new Error('routing produced no partTypeId; C-005 requires exactly one resolved TipoParte');
    }

    // RGT-10: the operational date comes from the configured shift policy, not from truncating the
    // timestamp. Until a context-specific policy is configured, the calendar-day default is used
    // and recorded as such.
    const policy = calendarDayPolicy(DEFAULT_OPERATIONAL_ZONE);
    const moment = resolveOperationalMoment(occurredAt, policy);
    const operationalDate = payload.operationalDate ?? moment.operationalDate;

    const partId = uuidv7();
    await db.query(
      `INSERT INTO execution.parts
         (id, part_type_id, state, crew_id, operational_date, shift_id, prepared_at,
          is_emergent, emergent_reason, emergent_authorised_by)
       VALUES ($1, $2, 'PREPARADO', $3, $4, $5, $6, $7, $8, $9)`,
      [
        partId,
        partTypeId,
        payload.crewId ?? null,
        operationalDate,
        moment.shiftId,
        occurredAt,
        payload.emergent !== undefined,
        payload.emergent?.reason ?? null,
        // RUL-037: emergent start needs an authority. The session actor is recorded; whether that
        // actor may authorise is checked by the capability on the command.
        payload.emergent !== undefined ? actor.identityId : null,
      ],
    );

    // Plan <-> real link. C-023: never 1:1, so the link is a row with a kind, and emergent work
    // records that it had no plan rather than inventing one.
    if (payload.plannedAssignmentId || payload.plannedUnitIds?.length) {
      for (const plannedUnitId of payload.plannedUnitIds ?? [null]) {
        await db.query(
          `INSERT INTO planning.plan_execution_links
             (id, planned_unit_id, planned_assignment_id, part_id, link_kind)
           VALUES ($1, $2, $3, $4, 'MATERIALISES')`,
          [uuidv7(), plannedUnitId, payload.plannedAssignmentId ?? null, partId],
        );
      }
    } else if (payload.emergent) {
      await db.query(
        `INSERT INTO planning.plan_execution_links (id, part_id, link_kind)
         VALUES ($1, $2, 'EMERGENT_NO_PLAN')`,
        [uuidv7(), partId],
      );
    }

    // An emergent Parte records its allocation as explicitly unresolved rather than guessing a
    // contract context (C-004 / AP-06). The UE-level allocation is created when the UE is.
    return {
      subject: { kind: 'Parte', id: partId },
      version: 1,
      effects: [
        {
          kind: 'PART_PREPARED',
          subjectKind: 'Parte',
          subjectId: partId,
          detail: { partTypeId, operationalDate, isEmergent: payload.emergent !== undefined },
          outboxEvent: {
            type: 'execution.part.prepared',
            payload: { partId, partTypeId, operationalDate, correlationId },
          },
        },
      ],
    };
  },
};

/* --------------------------------------------------------------- execution.units.create */

const createUnit: CommandHandler<CreateUnitInput> = {
  name: 'execution.units.create',

  async resolveScope({ db, payload }) {
    const part = await loadPart(db, payload.partId);
    return {
      subject: { kind: 'Parte', id: payload.partId as Uuid, ...(part.code ? { code: part.code } : {}) },
      scope: { baseId: part.base_id },
      currentVersion: part.version,
      currentState: part.state,
    };
  },

  async evaluators({ db, payload, currentState }) {
    const subject = { kind: 'Parte', id: payload.partId as Uuid };
    return [
      historyInvariants({ db, subject, ...(currentState ? { currentState } : {}), terminalStates: PART_TERMINAL }),
      // T-UE01 is a creation: no from-state. The evaluator still has to declare the effect, because
      // decide() derives NO_OP from an envelope with no effect and no target state — and a NO_OP
      // authorises nothing. Declaring it is what makes the command meaningful.
      stateTransition({
        machine: 'UnidadEjecucion',
        event: 'CREAR_UE',
        subject: { kind: 'UnidadEjecucion', id: null },
        effects: [
          {
            kind: 'CREATE_UE',
            description: 'Crear la unidad de ejecución dentro del Parte.',
            ruleId: 'RUL-007',
          },
        ],
      }),
    ];
  },

  async apply({ db, payload, occurredAt, correlationId }) {
    const unitId = uuidv7();
    await db.query(
      `INSERT INTO execution.execution_units
         (id, part_id, state, service_id, activity_id, client_asset_id, description, unit_kind,
          sequence_no)
       VALUES ($1, $2, 'PENDIENTE', $3, $4, $5, $6, $7,
               coalesce($8, (SELECT coalesce(max(sequence_no), 0) + 1
                             FROM execution.execution_units WHERE part_id = $2)))`,
      [
        unitId,
        payload.partId,
        payload.serviceId,
        payload.activityId ?? null,
        payload.clientAssetId ?? null,
        payload.description,
        payload.unitKind ?? null,
        payload.sequenceNo ?? null,
      ],
    );

    if (payload.technicalLocationId) {
      await db.query(
        `INSERT INTO execution.execution_locations
           (id, execution_unit_id, technical_location_id, location_role)
         VALUES ($1, $2, $3, 'PRINCIPAL')`,
        [uuidv7(), unitId, payload.technicalLocationId],
      );
    }

    // The contractual context starts explicitly unresolved. RGT-12: reality records regardless;
    // only the commercial derivation is blocked until configuration exists.
    await db.query(
      `INSERT INTO execution.execution_allocations
         (id, execution_unit_id, status, pending_reason)
       VALUES ($1, $2, 'PENDIENTE', 'Imputación pendiente de resolver al cierre o en backoffice')`,
      [uuidv7(), unitId],
    );

    void occurredAt;
    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: 1,
      effects: [
        {
          kind: 'UNIT_CREATED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: { partId: payload.partId },
          outboxEvent: {
            type: 'execution.unit.created',
            payload: { unitId, partId: payload.partId, correlationId },
          },
        },
      ],
    };
  },
};

/* ---------------------------------------------------------------- execution.units.start */

const startUnit: CommandHandler<StartUnitInput> = {
  name: 'execution.units.start',

  async resolveScope({ db, subjectId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);
    return {
      subject: { kind: 'UnidadEjecucion', id: unitId, ...(unit.code ? { code: unit.code } : {}) },
      scope: { baseId: unit.base_id },
      currentVersion: unit.version,
      currentState: unit.state,
    };
  },

  async evaluators({ db, envelope, subjectId, currentState }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);
    const subject = { kind: 'UnidadEjecucion', id: unitId };
    const at = envelope.occurredAt as Instant;

    // Who is actually present, so their clearance is checked at the real instant.
    const { rows: people } = await db.query<{ person_id: string }>(
      `SELECT DISTINCT person_id FROM execution.person_execution_assignments
       WHERE part_id = $1 AND (ended_at IS NULL OR ended_at > $2)`,
      [unit.part_id, at],
    );

    return [
      historyInvariants({ db, subject, ...(currentState ? { currentState } : {}), terminalStates: UNIT_TERMINAL }),
      habilitaGate({
        db,
        subject,
        executionUnitId: unitId,
        partId: unit.part_id,
        at,
        requiresPermit: unit.requires_work_permit,
        personIds: people.map((p) => p.person_id),
      }),
      stateTransition({
        machine: 'UnidadEjecucion',
        event: 'INICIAR',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          { kind: 'START_UNIT', description: 'Abrir timestamps e intervalos.', ruleId: 'RUL-023' },
        ],
      }),
      controlPlane({ db, subject, partId: unit.part_id, executionUnitId: unitId, at }),
    ];
  },

  async apply({ db, subjectId, payload, occurredAt, correlationId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);

    await db.query(
      `UPDATE execution.execution_units
       SET state = 'EN_EJECUCION', started_at = $2, version = version + 1
       WHERE id = $1`,
      [unitId, occurredAt],
    );

    // The Parte follows: T-PA02. Already-started stays started.
    await db.query(
      `UPDATE execution.parts
       SET state = 'EN_EJECUCION',
           started_at = coalesce(started_at, $2),
           version = version + 1
       WHERE id = $1 AND state IN ('PREPARADO', 'SUSPENDIDO')`,
      [unit.part_id, occurredAt],
    );

    // RUL-028: a time interval opens with its category. The category is recorded even when the
    // contract does not pay for it.
    const timeEventId = uuidv7();
    await db.query(
      `INSERT INTO execution.time_events
         (id, part_id, execution_unit_id, time_category, started_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [timeEventId, unit.part_id, unitId, payload.timeCategory ?? 'OPERATIVO', occurredAt],
    );

    if (payload.confirmedLocationId) {
      await db.query(
        `INSERT INTO execution.execution_locations
           (id, execution_unit_id, technical_location_id, location_role, confirmed_at)
         VALUES ($1, $2, $3, 'PRINCIPAL', $4)
         ON CONFLICT DO NOTHING`,
        [uuidv7(), unitId, payload.confirmedLocationId, occurredAt],
      );
    }

    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: unit.version + 1,
      effects: [
        {
          kind: 'UNIT_STARTED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: { startedAt: occurredAt, timeEventId },
          outboxEvent: {
            type: 'execution.unit.started',
            payload: { unitId, partId: unit.part_id, startedAt: occurredAt, correlationId },
          },
        },
      ],
    };
  },
};

/* ---------------------------------------------------------------- execution.units.close */

const closeUnit: CommandHandler<CloseUnitInput> = {
  name: 'execution.units.close',

  async resolveScope({ db, subjectId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);
    return {
      subject: { kind: 'UnidadEjecucion', id: unitId, ...(unit.code ? { code: unit.code } : {}) },
      scope: { baseId: unit.base_id },
      currentVersion: unit.version,
      currentState: unit.state,
    };
  },

  async evaluators({ db, subjectId, payload, envelope, currentState }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const subject = { kind: 'UnidadEjecucion', id: unitId };
    const occurredAt = envelope.occurredAt as Instant;

    // RUL-033: a cause is required when the result is not a plain completion. Expressed as a
    // confirmation rather than a schema rule, so the operator is told which field and why.
    const needsReason = payload.result !== 'COMPLETADA' && !payload.resultReason;

    return [
      historyInvariants({ db, subject, ...(currentState ? { currentState } : {}), terminalStates: UNIT_TERMINAL }),
      stateTransition({
        machine: 'UnidadEjecucion',
        event: 'CERRAR',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          {
            kind: 'CLOSE_UNIT',
            description: 'Cerrar la UE y escribir su versión inmutable.',
            ruleId: 'RUL-033',
          },
        ],
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution/close',
        evaluate: async (): Promise<StageOutcome> => {
          const outcome: {
            confirmationsRequired?: ConfirmationRequired[];
            missing?: MissingItem[];
            blocks?: Blocker[];
          } = {};
          if (needsReason) {
            outcome.confirmationsRequired = [
              {
                field: 'resultReason',
                reason:
                  `Un resultado ${payload.result} necesita causa estructurada: lo planificado y no ` +
                  'realizado nunca se borra, se explica (RUL-019).',
                ruleId: 'RUL-033',
              },
            ];
          }
          // Open intervals are reported as missing, not as a block: the operator closes them as
          // part of closing, and listing them separately is what the prototype's "9 pendientes"
          // could not do.
          const { rows: open } = await db.query<{ count: string; latest_start: Date | null }>(
            `SELECT count(*)::text AS count, max(started_at) AS latest_start
             FROM execution.time_events
             WHERE execution_unit_id = $1 AND ended_at IS NULL`,
            [unitId],
          );
          const openCount = Number(open[0]?.count ?? '0');
          if (openCount > 0) {
            outcome.missing = [
              {
                what: `${openCount} intervalo(s) de tiempo abiertos`,
                reason: 'Se cierran automáticamente al cerrar la UE.',
              },
            ];
          }

          // RUL-033 requires consistent times. Closing at or before the moment an interval opened
          // would produce a zero-length or inverted interval, which the schema refuses outright —
          // and an operator deserves the reason rather than a constraint name. This is also the
          // honest answer to the prototype's dur(), which silently added 24 h instead.
          const latestStart = open[0]?.latest_start ?? null;
          if (latestStart !== null && Date.parse(occurredAt) <= latestStart.getTime()) {
            outcome.blocks = [
              {
                ruleId: 'RUL-033',
                precedence: 'P5',
                reason:
                  `El cierre está fechado ${occurredAt}, que no es posterior al inicio del ` +
                  `intervalo abierto (${latestStart.toISOString()}). Un intervalo de duración cero ` +
                  'o invertido no es un hecho registrable.',
                instead:
                  'Fechar el cierre después del último inicio registrado. Un turno que cruza la ' +
                  'medianoche se expresa con los instantes, no con un ajuste de 24 h.',
                subject,
                overrideable: false,
              },
            ];
          }
          return outcome;
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);

    // Close any interval still open, so no time is left dangling (RUL-034 precondition).
    await db.query(
      `UPDATE execution.time_events SET ended_at = $2
       WHERE execution_unit_id = $1 AND ended_at IS NULL`,
      [unitId, occurredAt],
    );

    await db.query(
      `UPDATE execution.execution_units
       SET state = 'CERRADA', ended_at = $2, result = $3, result_reason = $4,
           closed_by = $5, version = version + 1
       WHERE id = $1`,
      [unitId, occurredAt, payload.result, payload.resultReason ?? null, actor.identityId],
    );

    // The immutable version a commercial unit will later point at (C-030). Built from what is
    // actually stored, so it can be compared with a later amendment.
    const snapshot = await buildUnitSnapshot(db, unitId);
    const versionId = uuidv7();
    await db.query(
      `INSERT INTO execution.execution_unit_versions
         (id, execution_unit_id, version_no, reason, snapshot, content_hash, effective_at, created_by)
       VALUES ($1, $2,
               (SELECT coalesce(max(version_no), 0) + 1 FROM execution.execution_unit_versions
                WHERE execution_unit_id = $2),
               'CLOSE', $3, $4, $5, $6)`,
      [versionId, unitId, JSON.stringify(snapshot), hashOf(snapshot), occurredAt, actor.identityId],
    );
    await db.query('UPDATE execution.execution_units SET current_version_id = $2 WHERE id = $1', [
      unitId,
      versionId,
    ]);

    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: unit.version + 1,
      effects: [
        {
          kind: 'UNIT_CLOSED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: { versionId, result: payload.result },
          outboxEvent: {
            // Interface B (FC-08). Commercial derivation reacts to this, and only to a version.
            type: 'execution.unit.closed',
            payload: { unitId, versionId, partId: unit.part_id, correlationId },
          },
        },
      ],
    };
  },
};

/* ---------------------------------------------------------------- execution.parts.close */

const closePart: CommandHandler<Record<string, never>> = {
  name: 'execution.parts.close',

  async resolveScope({ db, subjectId }) {
    const partId = requireSubjectId(subjectId, 'Parte');
    const part = await loadPart(db, partId);
    return {
      subject: { kind: 'Parte', id: partId, ...(part.code ? { code: part.code } : {}) },
      scope: { baseId: part.base_id },
      currentVersion: part.version,
      currentState: part.state,
    };
  },

  async evaluators({ db, subjectId, currentState }) {
    const partId = requireSubjectId(subjectId, 'Parte');
    const subject = { kind: 'Parte', id: partId };
    return [
      historyInvariants({ db, subject, ...(currentState ? { currentState } : {}), terminalStates: PART_TERMINAL }),
      stateTransition({
        machine: 'Parte',
        event: 'CERRAR_OPERATIVAMENTE',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          {
            kind: 'CLOSE_PART',
            description: 'Cerrar la verdad operacional del Parte.',
            ruleId: 'RUL-034',
          },
        ],
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution/close-part',
        evaluate: async () => {
          // RUL-034 hard gate: every UE terminal, no open intervals. The database also refuses it
          // (TPR-009), but a block here names the rule and counts what is outstanding.
          const { rows } = await db.query<{ open_units: string; open_intervals: string }>(
            `SELECT
               (SELECT count(*)::text FROM execution.execution_units
                WHERE part_id = $1 AND state NOT IN ('CERRADA','NO_REALIZADA','ANULADA')) AS open_units,
               (SELECT count(*)::text FROM execution.time_events
                WHERE part_id = $1 AND ended_at IS NULL) AS open_intervals`,
            [partId],
          );
          const openUnits = Number(rows[0]?.open_units ?? '0');
          const openIntervals = Number(rows[0]?.open_intervals ?? '0');
          if (openUnits === 0 && openIntervals === 0) return {};
          return {
            blocks: [
              ...(openUnits > 0
                ? [
                    {
                      ruleId: 'RUL-034',
                      precedence: 'P2' as const,
                      reason: `${openUnits} unidad(es) de ejecución sin resolver.`,
                      instead:
                        'Cerrar cada UE con resultado, o marcarla NO_REALIZADA con causa, o ANULADA ' +
                        'si nunca hubo trabajo real.',
                      subject,
                      overrideable: false,
                    },
                  ]
                : []),
              ...(openIntervals > 0
                ? [
                    {
                      ruleId: 'RUL-034',
                      precedence: 'P2' as const,
                      reason: `${openIntervals} intervalo(s) de tiempo abiertos.`,
                      instead: 'Cerrar los intervalos antes de cerrar el Parte.',
                      subject,
                      overrideable: false,
                    },
                  ]
                : []),
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, actor, occurredAt, correlationId }) {
    const partId = requireSubjectId(subjectId, 'Parte');
    const part = await loadPart(db, partId);
    await db.query(
      `UPDATE execution.parts
       SET state = 'CERRADO_OPERATIVAMENTE', closed_at = $2, closed_by = $3, version = version + 1
       WHERE id = $1`,
      [partId, occurredAt, actor.identityId],
    );
    return {
      subject: { kind: 'Parte', id: partId },
      version: part.version + 1,
      effects: [
        {
          kind: 'PART_CLOSED',
          subjectKind: 'Parte',
          subjectId: partId,
          detail: { closedAt: occurredAt },
          outboxEvent: {
            type: 'execution.part.closed',
            payload: { partId, closedAt: occurredAt, correlationId },
          },
        },
      ],
    };
  },
};

/* ------------------------------------------------------------------------- helpers */

async function buildUnitSnapshot(db: Db, unitId: string): Promise<Record<string, unknown>> {
  const unit = await db.one(
    `SELECT id, part_id, state::text AS state, service_id, activity_id, description,
            started_at, ended_at, result, result_reason
     FROM execution.execution_units WHERE id = $1`,
    [unitId],
  );
  const [people, resources, times, locations, measurements, allocation] = await Promise.all([
    db.query(
      `SELECT person_id, role, started_at, ended_at, compliance_status
       FROM execution.person_execution_assignments WHERE execution_unit_id = $1 OR part_id =
         (SELECT part_id FROM execution.execution_units WHERE id = $1)`,
      [unitId],
    ),
    db.query(
      `SELECT resource_id, role, started_at, ended_at, meter_reading, meter_kind
       FROM execution.resource_execution_assignments WHERE execution_unit_id = $1`,
      [unitId],
    ),
    db.query(
      'SELECT time_category, started_at, ended_at, reason FROM execution.time_events WHERE execution_unit_id = $1 ORDER BY started_at',
      [unitId],
    ),
    db.query(
      'SELECT technical_location_id, location_role, unmapped_label FROM execution.execution_locations WHERE execution_unit_id = $1',
      [unitId],
    ),
    db.query(
      'SELECT metric_code, quantity, unit_of_measure_id, measurement_source, measured_at FROM execution.execution_measurements WHERE execution_unit_id = $1',
      [unitId],
    ),
    db.query(
      'SELECT status::text AS status, contract_service_id, cost_center_id, contract_item_id, pending_reason FROM execution.execution_allocations WHERE execution_unit_id = $1 ORDER BY version_no DESC LIMIT 1',
      [unitId],
    ),
  ]);

  return {
    unit,
    people: people.rows,
    resources: resources.rows,
    timeEvents: times.rows,
    locations: locations.rows,
    measurements: measurements.rows,
    allocation: allocation.rows[0] ?? null,
  };
}

function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function registerExecutionCommands(): void {
  registerHandler(preparePart);
  registerHandler(createUnit);
  registerHandler(startUnit);
  registerHandler(closeUnit);
  registerHandler(closePart);
}
