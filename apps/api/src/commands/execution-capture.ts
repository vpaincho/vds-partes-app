/**
 * Capture commands: time, location, measurement, transition, evidence, allocation.
 *
 * These are the commands that run *during* execution, and they share one property that the
 * prototype's edit screen did not have: **none of them overwrites anything**. A category change
 * closes an interval and opens another. A location is appended with its role. A measurement
 * supersedes rather than replaces. An allocation is resolved by a new version.
 *
 * That is not stylistic. `stReg` in the prototype held an hourly sheet and `sums()` added the rows
 * up, so two overlapping tasks in the same hour became two hours and a correction destroyed the
 * original reading. Every write here is an append, so plan-vs-real and a later amendment both have
 * something to compare against.
 */
import {
  DomainError,
  uuidv7,
  type Instant,
  type Uuid,
} from '@vds/kernel';
import type {
  AttachEvidenceInput,
  CaptureMeasurementInput,
  ChangeTimeCategoryInput,
  ConfirmLocationInput,
  RecordTransitionInput,
  ResolveAllocationInput,
} from '@vds/contracts';
import { registerHandler, type CommandHandler } from '../platform/pipeline.ts';
import type { Db } from '../platform/db.ts';
import { historyInvariants } from './evaluators.ts';
import { loadBehaviorForPart } from '../platform/typeparts.ts';
import { loadUnit, requireSubjectId, UNIT_TERMINAL } from './execution-shared.ts';

/* ------------------------------------------- execution.units.change-time-category */

const changeTimeCategory: CommandHandler<ChangeTimeCategoryInput> = {
  name: 'execution.units.change-time-category',

  async resolveScope({ db, subjectId }) {
    const unit = await loadUnit(db, requireSubjectId(subjectId, 'UnidadEjecucion'));
    return {
      subject: { kind: 'UnidadEjecucion', id: unit.id, ...(unit.code ? { code: unit.code } : {}) },
      scope: { baseId: unit.base_id },
      currentVersion: unit.version,
      currentState: unit.state,
    };
  },

  async evaluators({ db, subjectId, envelope, currentState }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const subject = { kind: 'UnidadEjecucion', id: unitId };
    const at = envelope.occurredAt as Instant;

    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: UNIT_TERMINAL,
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution/time',
        evaluate: async () => {
          if (currentState !== 'EN_EJECUCION') {
            return {
              blocks: [
                {
                  ruleId: 'RUL-028',
                  precedence: 'P5' as const,
                  reason: `La UE está ${currentState}: no hay un intervalo abierto al que cambiarle la categoría.`,
                  instead:
                    'Iniciar o reanudar la UE primero. Una categoría de tiempo describe tiempo que ' +
                    'está transcurriendo.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }

          // RUL-029: closing the previous interval at this instant must produce a positive
          // duration. The schema refuses a zero-length interval and the operator deserves the
          // reason, not a constraint name.
          const open = await db.one<{ id: Uuid; started_at: Date; time_category: string }>(
            `SELECT id, started_at, time_category FROM execution.time_events
             WHERE execution_unit_id = $1 AND ended_at IS NULL
             ORDER BY started_at DESC LIMIT 1`,
            [unitId],
          );
          if (open && Date.parse(at) <= open.started_at.getTime()) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-029',
                  precedence: 'P5' as const,
                  reason:
                    `El cambio está fechado ${at}, que no es posterior al inicio del intervalo ` +
                    `${open.time_category} (${open.started_at.toISOString()}).`,
                  instead:
                    'Fechar el cambio después del inicio del intervalo vigente. Un intervalo de ' +
                    'duración cero no es un hecho registrable.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }

          return {
            effects: [
              {
                kind: 'CHANGE_TIME_CATEGORY',
                description:
                  'Cerrar el EventoTiempo vigente y abrir el siguiente. La categoría se registra ' +
                  'aunque el contrato no la pague.',
                ruleId: 'RUL-029',
              },
            ],
            rulesApplied: [{ ruleId: 'RUL-029', precedence: 'P5' as const, outcome: 'WON' as const }],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);

    // Close, then open. Never an UPDATE of the category in place: the time already spent belongs to
    // the category it was spent in, and rewriting it would make the two indistinguishable.
    const closed = await db.query<{ id: Uuid; time_category: string }>(
      `UPDATE execution.time_events SET ended_at = $2
       WHERE execution_unit_id = $1 AND ended_at IS NULL
       RETURNING id, time_category`,
      [unitId, occurredAt],
    );

    const nextId = uuidv7();
    await db.query(
      `INSERT INTO execution.time_events
         (id, part_id, execution_unit_id, time_category, started_at, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        nextId,
        unit.part_id,
        unitId,
        payload.timeCategory,
        occurredAt,
        payload.reason ?? null,
        actor.identityId,
      ],
    );

    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: unit.version,
      effects: [
        {
          kind: 'TIME_CATEGORY_CHANGED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: {
            closedEventIds: closed.rows.map((r) => r.id),
            previousCategories: closed.rows.map((r) => r.time_category),
            openedEventId: nextId,
            timeCategory: payload.timeCategory,
          },
          outboxEvent: {
            type: 'execution.time.category-changed',
            payload: { unitId, timeCategory: payload.timeCategory, correlationId },
          },
        },
      ],
    };
  },
};

/* ------------------------------------------------ execution.units.confirm-location */

const confirmLocation: CommandHandler<ConfirmLocationInput> = {
  name: 'execution.units.confirm-location',

  async resolveScope({ db, subjectId }) {
    const unit = await loadUnit(db, requireSubjectId(subjectId, 'UnidadEjecucion'));
    return {
      subject: { kind: 'UnidadEjecucion', id: unit.id, ...(unit.code ? { code: unit.code } : {}) },
      scope: { baseId: unit.base_id },
      currentVersion: unit.version,
      currentState: unit.state,
    };
  },

  async evaluators({ db, subjectId, payload, envelope, currentState }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const subject = { kind: 'UnidadEjecucion', id: unitId };
    const unit = await loadUnit(db, unitId);
    const at = envelope.occurredAt as Instant;

    // The pattern decides what a location change means. RUL-008 is the default — it does not cut —
    // but TP-02 reads it differently and a configured ReglaCorte can change it. Asking the strategy
    // is what keeps that decision in one place.
    const loaded = await loadBehaviorForPart(db, unit.part_id, at);
    const identity = loaded.behavior.evaluateIdentity(
      { kind: 'LOCATION_CHANGED', detail: payload.locationRole },
      {
        partTypeId: loaded.behavior.id,
        state: 'EN_EJECUCION',
        openUnitCount: 1,
        closedUnitCount: 0,
        config: loaded.config,
      },
    );

    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: UNIT_TERMINAL,
      }),
      {
        stage: 'S6_IDENTITY',
        precedence: 'P4',
        owner: 'execution/location',
        evaluate: () => ({
          // An unmapped place is recorded as unmapped. RUL-031 forbids free text standing in for a
          // master, and PENDING_MAPPING is the honest answer when the place is real and the
          // catalogue does not have it yet (CC-12).
          ...(payload.technicalLocationId === undefined
            ? {
                warnings: [
                  {
                    ruleId: 'RUL-031',
                    precedence: 'P4' as const,
                    reason:
                      `La ubicación "${payload.unmappedLabel ?? ''}" no está en el maestro: queda ` +
                      'registrada como no mapeada, con referencia a lo declarado en campo.',
                    subject,
                  },
                ],
              }
            : {}),
          effects: [
            {
              kind: 'CONFIRM_LOCATION',
              description:
                `Registrar la ubicación con rol ${payload.locationRole}. ` +
                `Identidad: ${identity.outcome} — ${identity.reason}`,
              ruleId: identity.ruleId,
            },
          ],
          rulesApplied: [
            { ruleId: identity.ruleId, precedence: 'P4' as const, outcome: 'WON' as const, note: identity.reason },
          ],
        }),
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);

    if (payload.technicalLocationId === undefined && payload.unmappedLabel === undefined) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        message:
          'Hace falta una ubicación del maestro o una etiqueta declarada en campo. Una ubicación ' +
          'sin referencia no se puede usar para evaluar cobertura de PTW ni para imputar.',
      });
    }

    const locationId = uuidv7();
    await db.query(
      `INSERT INTO execution.execution_locations
         (id, execution_unit_id, technical_location_id, location_role, unmapped_label,
          confirmed_by, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        locationId,
        unitId,
        payload.technicalLocationId ?? null,
        payload.locationRole,
        payload.unmappedLabel ?? null,
        actor.identityId,
        occurredAt,
      ],
    );

    // RUL-008: the location itself does not cut, but the change IS a fact and is recorded as one.
    await db.query(
      `INSERT INTO execution.operational_events
         (id, part_id, execution_unit_id, event_type, reason_code, description, occurred_at,
          recorded_by, detail)
       VALUES ($1, $2, $3, 'LOCATION_CHANGE', $4, $5, $6, $7, $8)`,
      [
        uuidv7(),
        unit.part_id,
        unitId,
        payload.locationRole,
        payload.note ??
          `Ubicación confirmada con rol ${payload.locationRole}${
            payload.technicalLocationId ? '' : ' (no mapeada)'
          }`,
        occurredAt,
        actor.identityId,
        JSON.stringify({
          locationId,
          technicalLocationId: payload.technicalLocationId ?? null,
          unmappedLabel: payload.unmappedLabel ?? null,
          mappingStatus: payload.technicalLocationId ? 'MAPPED' : 'PENDING_MAPPING',
        }),
      ],
    );

    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: unit.version,
      effects: [
        {
          kind: 'LOCATION_CONFIRMED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: { locationId, locationRole: payload.locationRole },
          outboxEvent: {
            type: 'execution.location.confirmed',
            payload: { unitId, locationId, correlationId },
          },
        },
      ],
    };
  },
};

/* --------------------------------------------- execution.units.capture-measurement */

const captureMeasurement: CommandHandler<CaptureMeasurementInput> = {
  name: 'execution.units.capture-measurement',

  async resolveScope({ db, subjectId }) {
    const unit = await loadUnit(db, requireSubjectId(subjectId, 'UnidadEjecucion'));
    return {
      subject: { kind: 'UnidadEjecucion', id: unit.id, ...(unit.code ? { code: unit.code } : {}) },
      scope: { baseId: unit.base_id },
      currentVersion: unit.version,
      currentState: unit.state,
    };
  },

  async evaluators({ db, subjectId, payload, currentState }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const subject = { kind: 'UnidadEjecucion', id: unitId };

    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: UNIT_TERMINAL,
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution/measurement',
        evaluate: async () => {
          // RUL-032: the unit of measure must exist. A magnitude without its unit is not a
          // quantity, and a bare number would reach the commercial derivation meaning nothing.
          const uom = await db.one<{ code: string }>(
            'SELECT code FROM config.units_of_measure WHERE id = $1',
            [payload.quantity.unitOfMeasureId],
          );
          if (!uom) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-032',
                  precedence: 'P5' as const,
                  reason: `La unidad de medida ${payload.quantity.unitOfMeasureId} no existe en el maestro.`,
                  instead: 'Elegir una unidad del catálogo. C-014: una magnitud viaja con su unidad.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }

          // A re-reading of the same metric supersedes the previous one. It does not overwrite it:
          // "the operator first read 120 and then 118" is information, and `lastKm` in the prototype
          // took the maximum of whatever rows existed instead.
          const previous = await db.one<{ id: Uuid }>(
            `SELECT id FROM execution.execution_measurements
             WHERE execution_unit_id = $1 AND metric_code = $2
               AND NOT EXISTS (SELECT 1 FROM execution.execution_measurements later
                               WHERE later.supersedes_id = execution_measurements.id)
             ORDER BY measured_at DESC LIMIT 1`,
            [unitId, payload.metricCode],
          );

          return {
            effects: [
              {
                kind: 'CAPTURE_MEASUREMENT',
                description:
                  previous
                    ? `Registrar ${payload.metricCode} en ${uom.code}, sustituyendo la lectura anterior sin borrarla.`
                    : `Registrar ${payload.metricCode} en ${uom.code} con su fuente.`,
                ruleId: 'RUL-032',
              },
            ],
            ...(previous
              ? {
                  warnings: [
                    {
                      ruleId: 'RUL-032',
                      precedence: 'P5' as const,
                      reason:
                        `Ya había una lectura de ${payload.metricCode}. La nueva la sustituye y la ` +
                        'anterior queda en la historia: una corrección no borra lo que se leyó antes.',
                      subject,
                    },
                  ],
                }
              : {}),
            rulesApplied: [{ ruleId: 'RUL-032', precedence: 'P5' as const, outcome: 'WON' as const }],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);

    const previous = await db.one<{ id: Uuid }>(
      `SELECT id FROM execution.execution_measurements
       WHERE execution_unit_id = $1 AND metric_code = $2
         AND NOT EXISTS (SELECT 1 FROM execution.execution_measurements later
                         WHERE later.supersedes_id = execution_measurements.id)
       ORDER BY measured_at DESC LIMIT 1`,
      [unitId, payload.metricCode],
    );

    const measurementId = uuidv7();
    await db.query(
      `INSERT INTO execution.execution_measurements
         (id, execution_unit_id, metric_code, quantity, unit_of_measure_id, measurement_source,
          measured_at, measured_by, notes, supersedes_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        measurementId,
        unitId,
        payload.metricCode,
        payload.quantity.value,
        payload.quantity.unitOfMeasureId,
        payload.measurementSource,
        occurredAt,
        actor.identityId,
        payload.notes ?? null,
        previous?.id ?? null,
      ],
    );

    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: unit.version,
      effects: [
        {
          kind: 'MEASUREMENT_CAPTURED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: {
            measurementId,
            metricCode: payload.metricCode,
            supersedes: previous?.id ?? null,
            // C-014 stated where it can be read: this is an operational fact, and whether any of it
            // is certifiable is a commercial decision made later with its own rule.
            note: 'Medición operativa. No es cantidad certificable (C-014).',
          },
          outboxEvent: {
            type: 'execution.measurement.captured',
            payload: { unitId, measurementId, metricCode: payload.metricCode, correlationId },
          },
        },
      ],
    };
  },
};

/* ------------------------------------------------ execution.units.record-transition */

const recordTransition: CommandHandler<RecordTransitionInput> = {
  name: 'execution.units.record-transition',

  async resolveScope({ db, subjectId }) {
    const unit = await loadUnit(db, requireSubjectId(subjectId, 'UnidadEjecucion'));
    return {
      subject: { kind: 'UnidadEjecucion', id: unit.id, ...(unit.code ? { code: unit.code } : {}) },
      scope: { baseId: unit.base_id },
      currentVersion: unit.version,
      currentState: unit.state,
    };
  },

  async evaluators({ db, subjectId, payload, currentState }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const subject = { kind: 'UnidadEjecucion', id: unitId };

    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: UNIT_TERMINAL,
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution/transition',
        evaluate: () => {
          const ends = payload.endedAt !== undefined;
          if (ends && Date.parse(payload.endedAt as string) <= Date.parse(payload.startedAt)) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-030',
                  precedence: 'P5' as const,
                  reason: 'La transición termina antes o cuando empieza.',
                  instead:
                    'Corregir los instantes. Un traslado de duración cero no explica el tiempo que ' +
                    'buscaba explicar.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          return {
            effects: [
              {
                kind: 'RECORD_TRANSITION',
                description:
                  'Registrar el tiempo real entre work packages, para que no quede huérfano (C-013).',
                ruleId: 'RUL-030',
              },
            ],
            rulesApplied: [{ ruleId: 'RUL-030', precedence: 'P5' as const, outcome: 'WON' as const }],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, correlationId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);

    // The subject UE is one end of the transition; the other end is whatever the payload names. The
    // schema requires at least one end and refuses the two being the same.
    const origin = payload.fromExecutionUnitId ?? unitId;
    const destination =
      payload.toExecutionUnitId !== undefined && payload.toExecutionUnitId !== origin
        ? payload.toExecutionUnitId
        : null;

    const transitionId = uuidv7();
    await db.query(
      `INSERT INTO execution.operational_transitions
         (id, origin_execution_unit_id, destination_execution_unit_id, part_id, started_at,
          ended_at, transition_kind, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        transitionId,
        origin,
        destination,
        unit.part_id,
        payload.startedAt,
        payload.endedAt ?? null,
        payload.transitionKind,
        payload.note ?? null,
      ],
    );

    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: unit.version,
      effects: [
        {
          kind: 'TRANSITION_RECORDED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: { transitionId, transitionKind: payload.transitionKind },
          outboxEvent: {
            type: 'execution.transition.recorded',
            payload: { unitId, transitionId, correlationId },
          },
        },
      ],
    };
  },
};

/* ------------------------------------------------- execution.allocations.resolve */

const resolveAllocation: CommandHandler<ResolveAllocationInput> = {
  name: 'execution.allocations.resolve',

  async resolveScope({ db, subjectId }) {
    const unit = await loadUnit(db, requireSubjectId(subjectId, 'UnidadEjecucion'));
    return {
      subject: { kind: 'UnidadEjecucion', id: unit.id, ...(unit.code ? { code: unit.code } : {}) },
      scope: { baseId: unit.base_id },
      currentVersion: unit.version,
      currentState: unit.state,
    };
  },

  async evaluators({ db, subjectId, payload }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const subject = { kind: 'UnidadEjecucion', id: unitId };

    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution/allocation',
        evaluate: async () => {
          // R-045: the cost centre has to be one the contract service actually allows. Accepting an
          // arbitrary pairing here is how a correct-looking allocation reaches billing wrong.
          const allowed = await db.one<{ ok: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM config.contract_service_cost_centers csc
               WHERE csc.contract_service_id = $1 AND csc.cost_center_id = $2
             ) AS ok`,
            [payload.contractServiceId, payload.costCenterId],
          );
          if (!allowed?.ok) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-038',
                  precedence: 'P5' as const,
                  reason:
                    'El centro de costo no está habilitado para ese servicio del contrato (R-045).',
                  instead:
                    'Elegir un centro de costo permitido por el contexto contractual, o configurar ' +
                    'la combinación. No se imputa a un CC que el contrato no admite.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }

          // R-046: the item must belong to that contract service.
          const item = await db.one<{ ok: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM config.contract_items ci
               WHERE ci.id = $2 AND ci.contract_service_id = $1
             ) AS ok`,
            [payload.contractServiceId, payload.contractItemId],
          );
          if (!item?.ok) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-038',
                  precedence: 'P5' as const,
                  reason: 'El ítem no pertenece a la versión de contrato de ese servicio (R-046).',
                  instead: 'Elegir un ítem de la versión vigente del contrato.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }

          return {
            effects: [
              {
                kind: 'RESOLVE_ALLOCATION',
                description:
                  'Versionar la imputación como RESUELTO. La anterior queda como historia: la ' +
                  'imputación es una dimensión propia, no un estado del Parte.',
                ruleId: 'RUL-038',
              },
            ],
            rulesApplied: [{ ruleId: 'RUL-038', precedence: 'P5' as const, outcome: 'WON' as const }],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);

    const current = await db.one<{ id: Uuid; version_no: number; status: string }>(
      `SELECT id, version_no, status::text AS status FROM execution.execution_allocations
       WHERE execution_unit_id = $1 ORDER BY version_no DESC LIMIT 1`,
      [unitId],
    );

    // A new version, never an UPDATE: the fact that the context WAS pending is part of the record,
    // and the commercial derivation needs to know which version it consumed.
    const allocationId = uuidv7();
    await db.query(
      `INSERT INTO execution.execution_allocations
         (id, execution_unit_id, status, contract_service_id, cost_center_id, contract_item_id,
          resolved_at, resolved_by, version_no, supersedes_id)
       VALUES ($1, $2, 'RESUELTO', $3, $4, $5, $6, $7, $8, $9)`,
      [
        allocationId,
        unitId,
        payload.contractServiceId,
        payload.costCenterId,
        payload.contractItemId,
        occurredAt,
        actor.identityId,
        (current?.version_no ?? 0) + 1,
        current?.id ?? null,
      ],
    );

    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: unit.version,
      effects: [
        {
          kind: 'ALLOCATION_RESOLVED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: { allocationId, supersedes: current?.id ?? null, previousStatus: current?.status ?? null },
          outboxEvent: {
            // Commercial derivation was blocked while this was PENDIENTE (RGT-12); now it can run.
            type: 'execution.allocation.resolved',
            payload: { unitId, allocationId, correlationId },
          },
        },
      ],
    };
  },
};

/* --------------------------------------------------- execution.evidence.attach */

const attachEvidence: CommandHandler<AttachEvidenceInput> = {
  name: 'execution.evidence.attach',

  async resolveScope({ db, payload }) {
    // Scope comes from the target, so a crew cannot attach evidence to another base's Parte.
    const scope = await resolveEvidenceScope(db, payload);
    return { subject: { kind: 'Evidencia', id: null }, scope };
  },

  async evaluators({ payload }) {
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'evidence/attach',
        evaluate: () => ({
          effects: [
            {
              kind: 'ATTACH_EVIDENCE',
              description:
                `Registrar ${payload.evidenceKind} (${payload.sizeBytes} bytes) con su hash y ` +
                'vincularla al objeto. La subida de los bytes es una transacción aparte.',
              ruleId: 'RUL-033',
            },
          ],
          // The honest statement the prototype's "Guardado" did not make: metadata registered is
          // not bytes delivered, and a closure that requires evidence is not documentarily complete
          // until the upload lands (RGT-09).
          missing: [
            {
              what: 'Entrega de los bytes al object storage',
              reason:
                'La evidencia queda en LOCAL_ONLY hasta que la subida confirme. Un cierre que ' +
                'exige evidencia no se marca completo mientras falte la entrega (RGT-09).',
            },
          ],
          rulesApplied: [{ ruleId: 'RUL-033', precedence: 'P5' as const, outcome: 'WON' as const }],
        }),
      },
    ];
  },

  async apply({ db, payload, actor, occurredAt, envelope, correlationId }) {
    const evidenceId = uuidv7();
    await db.query(
      `INSERT INTO evidence.evidence
         (id, evidence_type, content_type, byte_size, content_hash, upload_status,
          captured_at, captured_by, device_id, caption, provenance)
       VALUES ($1, $2, $3, $4, $5, 'LOCAL_ONLY', $6, $7, $8, $9, 'NEW_OPERATION')`,
      [
        evidenceId,
        payload.evidenceKind,
        payload.contentType,
        payload.sizeBytes,
        payload.checksum,
        payload.capturedAt ?? occurredAt,
        actor.identityId,
        (envelope.deviceId as string | undefined) ?? null,
        payload.note ?? null,
      ],
    );

    // A typed target column, not a polymorphic id: MR-09, and the DB check enforces exactly one.
    const column = {
      EXECUTION_UNIT: 'execution_unit_id',
      PART: 'part_id',
      WORK_PERMIT: 'work_permit_id',
      HABILITA_EVENT: 'habilita_event_id',
    }[payload.targetKind];
    const linkId = uuidv7();
    await db.query(
      `INSERT INTO evidence.evidence_links (id, evidence_id, target_kind, ${column})
       VALUES ($1, $2, $3, $4)`,
      [linkId, evidenceId, payload.targetKind, payload.targetId],
    );

    return {
      subject: { kind: 'Evidencia', id: evidenceId },
      version: 1,
      effects: [
        {
          kind: 'EVIDENCE_ATTACHED',
          subjectKind: 'Evidencia',
          subjectId: evidenceId,
          detail: {
            linkId,
            targetKind: payload.targetKind,
            targetId: payload.targetId,
            uploadStatus: 'LOCAL_ONLY',
          },
          outboxEvent: {
            type: 'evidence.attached',
            payload: { evidenceId, targetKind: payload.targetKind, targetId: payload.targetId, correlationId },
          },
        },
      ],
    };
  },
};

async function resolveEvidenceScope(
  db: Db,
  payload: AttachEvidenceInput,
): Promise<{ baseId?: Uuid | null }> {
  switch (payload.targetKind) {
    case 'EXECUTION_UNIT': {
      const unit = await loadUnit(db, payload.targetId);
      return { baseId: unit.base_id };
    }
    case 'PART': {
      const row = await db.one<{ base_id: Uuid | null }>(
        'SELECT base_id FROM execution.parts WHERE id = $1',
        [payload.targetId],
      );
      if (!row) {
        throw new DomainError({ code: 'NOT_FOUND', message: `No existe el Parte ${payload.targetId}.` });
      }
      return { baseId: row.base_id };
    }
    default:
      // Permits and Habilita events are scoped by their own module; the capability check still runs,
      // and the base is left unconstrained rather than guessed from an unrelated join.
      return {};
  }
}

export function registerExecutionCaptureCommands(): void {
  registerHandler(changeTimeCategory);
  registerHandler(confirmLocation);
  registerHandler(captureMeasurement);
  registerHandler(recordTransition);
  registerHandler(resolveAllocation);
  registerHandler(attachEvidence);
}
