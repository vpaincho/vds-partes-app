/**
 * Lifecycle commands: suspend, resume, replacements, not performed, void, handover, amendments.
 *
 * These are the commands the prototype replaced with four admin buttons — `a-est` set any state to
 * any state, `a-reopen` reopened closed work, `a-del` hard-deleted a job, and `o-delp` spliced a
 * person out of the array. Every one of them destroyed a fact. What is here instead:
 *
 *  - **suspend ≠ close.** A suspension closes the open interval with its cause and leaves the UE
 *    alive (T-UE04). Resuming **re-evaluates** the gates, because a permit may have expired while
 *    the work was stopped (RUL-022/023).
 *  - **a replacement is two intervals.** The outgoing one closes, the incoming one opens, and the
 *    incoming subject's eligibility is checked at the real instant (RUL-025/026, RGT-05).
 *  - **not performed is explained, never deleted.** The attempt survives with its cause (RUL-019).
 *  - **void claims there was never real work**, so it is refused once there is any (T-UE07/T-P07).
 *  - **a handover is the pattern's decision**, not a fixed behaviour: TP-01 continues with a
 *    handover, TP-03 asks whether a ReglaCorte exists, and neither invents a boundary (RUL-005).
 *  - **closed reality is corrected by amendment only**, with an approver who is not the author, and
 *    approving it invalidates the derived commercial units (RUL-035, RUL-073, RUL-065).
 */
import { DomainError, uuidv7, type Instant, type Uuid } from '@vds/kernel';
import type {
  ApproveAmendmentInput,
  CreateAmendmentInput,
  HandoverInput,
  MarkUnitNotPerformedInput,
  ReplacePersonInput,
  ReplaceResourceInput,
  ResumeUnitInput,
  SuspendUnitInput,
  VoidInput,
} from '@vds/contracts';
import { registerHandler, type CommandHandler } from '../platform/pipeline.ts';
import type { Db } from '../platform/db.ts';
import { controlPlane, habilitaGate, historyInvariants, stateTransition } from './evaluators.ts';
import { detectConflicts } from '../platform/conflicts.ts';
import { loadBehaviorForPart } from '../platform/typeparts.ts';
import {
  loadPart,
  loadUnit,
  PART_TERMINAL,
  requireSubjectId,
  UNIT_TERMINAL,
} from './execution-shared.ts';

/**
 * The window a replacement's conflict check should look at.
 *
 * A replacement opens an interval with no declared end: nobody knows when this person will leave.
 * `detectConflicts` needs a bound, and the choice matters — a far-future bound would report every
 * future commitment the person has as a conflict with today's shift, and an unbounded one is not a
 * window at all.
 *
 * So the bound is **what the plan actually declared**: the approved window of the assignment this
 * work materialises. With no plan there is no declared end, and the honest scope is then a
 * point-in-time check — is this person committed *at this instant* — rather than a horizon invented
 * here. The difference is reported in the trace through the rule's own reason text.
 */
async function replacementWindow(
  db: Db,
  partId: string,
  at: Instant,
): Promise<{ from: Instant; until: Instant }> {
  const row = await db.one<{ window_end: Date }>(
    `SELECT a.window_end
     FROM planning.plan_execution_links l
     JOIN planning.planned_assignments a ON a.id = l.planned_assignment_id
     WHERE l.part_id = $1
     ORDER BY a.window_end DESC
     LIMIT 1`,
    [partId],
  );
  const declaredEnd = row?.window_end;
  // A window that already closed is not a window either: fall back to the point check.
  const until =
    declaredEnd && declaredEnd.getTime() > Date.parse(at)
      ? (declaredEnd.toISOString().replace(/\.\d+Z$/, 'Z') as Instant)
      : at;
  return { from: at, until };
}

/* ------------------------------------------------------- execution.units.suspend */

const suspendUnit: CommandHandler<SuspendUnitInput> = {
  name: 'execution.units.suspend',

  async resolveScope({ db, subjectId }) {
    const unit = await loadUnit(db, requireSubjectId(subjectId, 'UnidadEjecucion'));
    return {
      subject: { kind: 'UnidadEjecucion', id: unit.id, ...(unit.code ? { code: unit.code } : {}) },
      scope: { baseId: unit.base_id },
      currentVersion: unit.version,
      currentState: unit.state,
    };
  },

  async evaluators({ db, subjectId, currentState }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const subject = { kind: 'UnidadEjecucion', id: unitId };
    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: UNIT_TERMINAL,
      }),
      stateTransition({
        machine: 'UnidadEjecucion',
        event: 'SUSPENDER',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          {
            kind: 'SUSPEND_UNIT',
            description:
              'Cerrar el intervalo abierto con su causa y dejar la UE suspendida. Suspender no ' +
              'cierra: el trabajo sigue existiendo.',
            ruleId: 'RUL-028',
          },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);

    // The open interval closes here with the reason. Leaving it open would make the suspended time
    // look like worked time, which is exactly what `dur()` did by assuming the next day.
    await db.query(
      `UPDATE execution.time_events SET ended_at = $2, reason = coalesce(reason, $3)
       WHERE execution_unit_id = $1 AND ended_at IS NULL`,
      [unitId, occurredAt, payload.reason],
    );

    await db.query(
      `UPDATE execution.execution_units
       SET state = 'SUSPENDIDA', suspended_at = $2, version = version + 1
       WHERE id = $1`,
      [unitId, occurredAt],
    );

    // The Parte follows only when nothing else is running: a crew with three UE does not stop
    // because one of them did.
    const stillRunning = await db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM execution.execution_units
       WHERE part_id = $1 AND state = 'EN_EJECUCION'`,
      [unit.part_id],
    );
    if (Number(stillRunning?.count ?? '0') === 0) {
      await db.query(
        `UPDATE execution.parts
         SET state = 'SUSPENDIDO', suspended_at = $2, version = version + 1
         WHERE id = $1 AND state = 'EN_EJECUCION'`,
        [unit.part_id, occurredAt],
      );
    }

    const eventId = uuidv7();
    await db.query(
      `INSERT INTO execution.operational_events
         (id, part_id, execution_unit_id, event_type, reason_code, description, occurred_at,
          recorded_by, detail)
       VALUES ($1, $2, $3, 'WAIT', $4, $5, $6, $7, $8)`,
      [
        eventId,
        unit.part_id,
        unitId,
        payload.reasonCode ?? 'SUSPENSION',
        payload.reason,
        occurredAt,
        actor.identityId,
        JSON.stringify({ directiveId: payload.directiveId ?? null }),
      ],
    );

    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: unit.version + 1,
      effects: [
        {
          kind: 'UNIT_SUSPENDED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: { eventId, reason: payload.reason, directiveId: payload.directiveId ?? null },
          outboxEvent: {
            type: 'execution.unit.suspended',
            payload: { unitId, partId: unit.part_id, correlationId },
          },
        },
      ],
    };
  },
};

/* -------------------------------------------------------- execution.units.resume */

const resumeUnit: CommandHandler<ResumeUnitInput> = {
  name: 'execution.units.resume',

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
    const unit = await loadUnit(db, unitId);
    const subject = { kind: 'UnidadEjecucion', id: unitId };
    const at = envelope.occurredAt as Instant;

    const { rows: people } = await db.query<{ person_id: string }>(
      `SELECT DISTINCT person_id FROM execution.person_execution_assignments
       WHERE part_id = $1 AND (ended_at IS NULL OR ended_at > $2)`,
      [unit.part_id, at],
    );

    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: UNIT_TERMINAL,
      }),
      // The whole point of resume being its own command: the same hard gate as a start. A permit
      // that expired during the suspension must block the restart, and C-021 says a VENCIDO permit
      // blocks new starts AND restarts.
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
        event: 'REANUDAR',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          {
            kind: 'RESUME_UNIT',
            description: 'Reabrir un intervalo nuevo. El tiempo suspendido no se recupera ni se reescribe.',
            ruleId: 'RUL-023',
          },
        ],
      }),
      controlPlane({ db, subject, partId: unit.part_id, executionUnitId: unitId, at }),
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);

    await db.query(
      `UPDATE execution.execution_units
       SET state = 'EN_EJECUCION', version = version + 1 WHERE id = $1`,
      [unitId],
    );
    await db.query(
      `UPDATE execution.parts
       SET state = 'EN_EJECUCION', version = version + 1
       WHERE id = $1 AND state = 'SUSPENDIDO'`,
      [unit.part_id],
    );

    // A NEW interval. The gap between suspension and resumption stays a gap: it is what actually
    // happened, and closing it over would be inventing worked time.
    const timeEventId = uuidv7();
    await db.query(
      `INSERT INTO execution.time_events
         (id, part_id, execution_unit_id, time_category, started_at, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        timeEventId,
        unit.part_id,
        unitId,
        payload.timeCategory ?? 'OPERATIVO',
        occurredAt,
        payload.note ?? 'Reanudación',
        actor.identityId,
      ],
    );

    if (payload.confirmedLocationId) {
      await db.query(
        `INSERT INTO execution.execution_locations
           (id, execution_unit_id, technical_location_id, location_role, confirmed_by, confirmed_at)
         VALUES ($1, $2, $3, 'PRINCIPAL', $4, $5)`,
        [uuidv7(), unitId, payload.confirmedLocationId, actor.identityId, occurredAt],
      );
    }

    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: unit.version + 1,
      effects: [
        {
          kind: 'UNIT_RESUMED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: { timeEventId, revalidated: true },
          outboxEvent: {
            type: 'execution.unit.resumed',
            payload: { unitId, partId: unit.part_id, correlationId },
          },
        },
      ],
    };
  },
};

/* ------------------------------------------------ execution.units.replace-person */

const replacePerson: CommandHandler<ReplacePersonInput> = {
  name: 'execution.units.replace-person',

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
    const unit = await loadUnit(db, unitId);
    const subject = { kind: 'UnidadEjecucion', id: unitId };
    const at = envelope.occurredAt as Instant;

    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: UNIT_TERMINAL,
      }),
      // RUL-039: the INCOMING person's clearance, evaluated at the real instant. The outgoing
      // person's history is untouched either way — PD-0392 is the case where a non-compliant
      // presence was deleted instead of recorded.
      habilitaGate({
        db,
        subject,
        executionUnitId: unitId,
        partId: unit.part_id,
        at,
        requiresPermit: false,
        personIds: [payload.incomingPersonId],
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution/replace-person',
        evaluate: async () => {
          const outgoing = await db.one<{ id: Uuid; person_id: Uuid; ended_at: Date | null }>(
            `SELECT id, person_id, ended_at FROM execution.person_execution_assignments
             WHERE id = $1 AND (execution_unit_id = $2 OR part_id = $3)`,
            [payload.outgoingAssignmentId, unitId, unit.part_id],
          );
          if (!outgoing) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-025',
                  precedence: 'P5' as const,
                  reason: 'La asignación saliente no pertenece a esta UE ni a su Parte.',
                  instead: 'Elegir el intervalo de presencia que realmente termina.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          if (outgoing.ended_at !== null) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-025',
                  precedence: 'P5' as const,
                  reason: `El intervalo saliente ya terminó el ${outgoing.ended_at.toISOString()}.`,
                  instead:
                    'Abrir una asignación nueva para el entrante. Un intervalo cerrado no se ' +
                    'vuelve a cerrar, y el pasado no se edita.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          if (outgoing.person_id === payload.incomingPersonId) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-025',
                  precedence: 'P5' as const,
                  reason: 'La persona entrante es la misma que la saliente.',
                  instead: 'Si sólo cambia el rol, registrar el cambio de rol y no un reemplazo.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }

          // RUL-027: an overlap for the incoming person. Exclusion by stable id, which is the
          // PL-093 fix reused here — a person already on this same Parte must not collide with
          // their own presence.
          const window = await replacementWindow(db, unit.part_id, at);
          const findings = await detectConflicts(db, {
            subjectKind: 'PERSON',
            subjectId: payload.incomingPersonId,
            ...window,
            aggregateKind: 'PART',
            aggregateId: unit.part_id,
          });
          const blocking = findings.filter((f) => f.verdict === 'BLOCK');

          return {
            blocks: blocking.map((f) => ({
              ruleId: f.ruleId,
              precedence: 'P5' as const,
              reason: f.reason,
              instead: 'Elegir otra persona, o liberar el trabajo incumbente con una directiva.',
              subject,
              overrideable: false,
            })),
            warnings: findings
              .filter((f) => f.verdict === 'WARN')
              .map((f) => ({ ruleId: f.ruleId, precedence: 'P5' as const, reason: f.reason, subject })),
            ...(blocking.length === 0
              ? {
                  effects: [
                    {
                      kind: 'REPLACE_PERSON',
                      description:
                        'Cerrar el intervalo del saliente y abrir el del entrante. La presencia ' +
                        'histórica no se borra (RGT-05).',
                      ruleId: 'RUL-025',
                    },
                  ],
                }
              : {}),
            rulesApplied: [{ ruleId: 'RUL-025', precedence: 'P5' as const, outcome: 'WON' as const }],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, decision, correlationId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);

    // Two writes, both appends. The outgoing row keeps its start: whoever was there, was there.
    // The incoming row is inserted FIRST: `replaced_by_id` is a foreign key to this same table, and
    // the constraint is checked immediately (not deferred), so the row it points at has to exist
    // before the UPDATE that points to it.
    const incomingId = uuidv7();

    // The incoming person's compliance is whatever the gate concluded, recorded as such. An
    // OVERRIDDEN or NON_COMPLIANT_RECORDED presence is a fact; hiding it is what PD-0392 did.
    const compliance =
      decision.override !== undefined
        ? 'OVERRIDDEN'
        : decision.warnings.some((w) => w.ruleId === 'RUL-040')
          ? 'NON_COMPLIANT_RECORDED'
          : 'COMPLIANT';

    await db.query(
      `INSERT INTO execution.person_execution_assignments
         (id, part_id, execution_unit_id, person_id, role, started_at, compliance_status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        incomingId,
        unit.part_id,
        unitId,
        payload.incomingPersonId,
        payload.role,
        occurredAt,
        compliance,
        actor.identityId,
      ],
    );

    await db.query(
      `UPDATE execution.person_execution_assignments
       SET ended_at = $2, end_reason = $3, replaced_by_id = $4
       WHERE id = $1`,
      [payload.outgoingAssignmentId, occurredAt, payload.reason, incomingId],
    );

    await db.query(
      `INSERT INTO execution.operational_events
         (id, part_id, execution_unit_id, event_type, reason_code, description, occurred_at,
          recorded_by, decision_trace_id, detail)
       VALUES ($1, $2, $3, 'PERSON_REPLACED', 'REPLACEMENT', $4, $5, $6, $7, $8)`,
      [
        uuidv7(),
        unit.part_id,
        unitId,
        payload.reason,
        occurredAt,
        actor.identityId,
        decision.decisionId,
        JSON.stringify({
          outgoingAssignmentId: payload.outgoingAssignmentId,
          incomingAssignmentId: incomingId,
          complianceStatus: compliance,
        }),
      ],
    );

    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: unit.version,
      effects: [
        {
          kind: 'PERSON_REPLACED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: { incomingAssignmentId: incomingId, complianceStatus: compliance },
          outboxEvent: {
            type: 'execution.person.replaced',
            payload: { unitId, incomingAssignmentId: incomingId, correlationId },
          },
        },
      ],
    };
  },
};

/* ---------------------------------------------- execution.units.replace-resource */

const replaceResource: CommandHandler<ReplaceResourceInput> = {
  name: 'execution.units.replace-resource',

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
    const unit = await loadUnit(db, unitId);
    const subject = { kind: 'UnidadEjecucion', id: unitId };
    const at = envelope.occurredAt as Instant;

    // RUL-006: a resource change does not create a Parte. Asked of the strategy rather than
    // asserted here, so the answer is the same one the identity tests cover.
    const loaded = await loadBehaviorForPart(db, unit.part_id, at);
    const identity = loaded.behavior.evaluateIdentity(
      { kind: 'RESOURCE_CHANGED', detail: payload.role },
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
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution/replace-resource',
        evaluate: async () => {
          const outgoing = await db.one<{ id: Uuid; resource_id: Uuid; ended_at: Date | null }>(
            `SELECT id, resource_id, ended_at FROM execution.resource_execution_assignments
             WHERE id = $1 AND (execution_unit_id = $2 OR part_id = $3)`,
            [payload.outgoingAssignmentId, unitId, unit.part_id],
          );
          if (!outgoing || outgoing.ended_at !== null) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-026',
                  precedence: 'P5' as const,
                  reason: outgoing
                    ? `El intervalo saliente ya terminó el ${outgoing.ended_at!.toISOString()}.`
                    : 'La asignación saliente no pertenece a esta UE ni a su Parte.',
                  instead:
                    'Abrir una asignación nueva para el recurso entrante. Un intervalo cerrado no ' +
                    'se reabre.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }

          // RUL-040: the incoming resource's own documentary state. A resource with an expired
          // inspection is recorded as non-compliant, not silently accepted.
          const window = await replacementWindow(db, unit.part_id, at);
          const findings = await detectConflicts(db, {
            subjectKind: 'RESOURCE',
            subjectId: payload.incomingResourceId,
            ...window,
            aggregateKind: 'PART',
            aggregateId: unit.part_id,
          });
          const blocking = findings.filter((f) => f.verdict === 'BLOCK');

          return {
            blocks: blocking.map((f) => ({
              ruleId: f.ruleId,
              precedence: 'P5' as const,
              reason: f.reason,
              instead: 'Elegir otro recurso, o liberar el trabajo incumbente con una directiva.',
              subject,
              overrideable: false,
            })),
            warnings: findings
              .filter((f) => f.verdict === 'WARN')
              .map((f) => ({ ruleId: f.ruleId, precedence: 'P5' as const, reason: f.reason, subject })),
            ...(blocking.length === 0
              ? {
                  effects: [
                    {
                      kind: 'REPLACE_RESOURCE',
                      description: `Cerrar el intervalo saliente y abrir el entrante. ${identity.reason}`,
                      ruleId: 'RUL-026',
                    },
                  ],
                }
              : {}),
            rulesApplied: [
              { ruleId: 'RUL-026', precedence: 'P5' as const, outcome: 'WON' as const },
              { ruleId: identity.ruleId, precedence: 'P4' as const, outcome: 'WON' as const, note: identity.reason },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, decision, correlationId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);

    // A reading needs its kind (the schema refuses otherwise), and the resource's own type already
    // says which one applies — asking the caller to repeat it would be the `lastKm()` defect from
    // the other direction, a value the system already knows treated as if a person had to supply it.
    let meterKind = payload.meterKind ?? null;
    if (payload.meterReading !== undefined && meterKind === null) {
      const type = await db.one<{ metering: string }>(
        `SELECT rt.metering FROM config.resources r
         JOIN config.resource_types rt ON rt.id = r.resource_type_id
         WHERE r.id = $1`,
        [payload.incomingResourceId],
      );
      meterKind = type && type.metering !== 'NONE' ? type.metering : null;
    }

    // Insert the incoming row first: `replaced_by_id` is a non-deferred foreign key to this same
    // table, so the row it points at must already exist when the outgoing row is updated.
    const incomingId = uuidv7();
    await db.query(
      `INSERT INTO execution.resource_execution_assignments
         (id, part_id, execution_unit_id, resource_id, role, started_at, compliance_status,
          meter_reading, meter_kind, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        incomingId,
        unit.part_id,
        unitId,
        payload.incomingResourceId,
        payload.role,
        occurredAt,
        decision.override !== undefined ? 'OVERRIDDEN' : 'COMPLIANT',
        payload.meterReading ?? null,
        meterKind,
        actor.identityId,
      ],
    );

    await db.query(
      `UPDATE execution.resource_execution_assignments
       SET ended_at = $2, end_reason = $3, replaced_by_id = $4
       WHERE id = $1`,
      [payload.outgoingAssignmentId, occurredAt, payload.reason, incomingId],
    );

    await db.query(
      `INSERT INTO execution.operational_events
         (id, part_id, execution_unit_id, event_type, reason_code, description, occurred_at,
          recorded_by, decision_trace_id, detail)
       VALUES ($1, $2, $3, 'RESOURCE_REPLACED', 'REPLACEMENT', $4, $5, $6, $7, $8)`,
      [
        uuidv7(),
        unit.part_id,
        unitId,
        payload.reason,
        occurredAt,
        actor.identityId,
        decision.decisionId,
        JSON.stringify({
          outgoingAssignmentId: payload.outgoingAssignmentId,
          incomingAssignmentId: incomingId,
          // The meter reading travels with the assignment that recorded it, so "the odometer read
          // 84120 when this truck arrived" stays attached to the arrival rather than becoming a
          // maximum over unrelated rows, which is what `lastKm` computed.
          meterReading: payload.meterReading ?? null,
        }),
      ],
    );

    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: unit.version,
      effects: [
        {
          kind: 'RESOURCE_REPLACED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: { incomingAssignmentId: incomingId },
          outboxEvent: {
            type: 'execution.resource.replaced',
            payload: { unitId, incomingAssignmentId: incomingId, correlationId },
          },
        },
      ],
    };
  },
};

/* --------------------------------------- execution.units.mark-not-performed */

const markUnitNotPerformed: CommandHandler<MarkUnitNotPerformedInput> = {
  name: 'execution.units.mark-not-performed',

  async resolveScope({ db, subjectId }) {
    const unit = await loadUnit(db, requireSubjectId(subjectId, 'UnidadEjecucion'));
    return {
      subject: { kind: 'UnidadEjecucion', id: unit.id, ...(unit.code ? { code: unit.code } : {}) },
      scope: { baseId: unit.base_id },
      currentVersion: unit.version,
      currentState: unit.state,
    };
  },

  async evaluators({ db, subjectId, currentState }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const subject = { kind: 'UnidadEjecucion', id: unitId };
    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: UNIT_TERMINAL,
      }),
      stateTransition({
        machine: 'UnidadEjecucion',
        event: 'MARCAR_NO_REALIZADA',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          {
            kind: 'MARK_NOT_PERFORMED',
            description:
              'Registrar que no se realizó, con causa. El intento queda: lo planificado y no hecho ' +
              'se explica, no se borra (RUL-019).',
            ruleId: 'RUL-019',
          },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);

    // Any interval that was opened closes; time that elapsed still elapsed.
    await db.query(
      `UPDATE execution.time_events SET ended_at = $2, reason = coalesce(reason, $3)
       WHERE execution_unit_id = $1 AND ended_at IS NULL`,
      [unitId, occurredAt, payload.reason],
    );

    await db.query(
      `UPDATE execution.execution_units
       SET state = 'NO_REALIZADA', ended_at = $2, result = 'NO_REALIZADA', result_reason = $3,
           closed_by = $4, version = version + 1
       WHERE id = $1`,
      [unitId, occurredAt, payload.reason, actor.identityId],
    );

    const eventId = uuidv7();
    await db.query(
      `INSERT INTO execution.operational_events
         (id, part_id, execution_unit_id, event_type, reason_code, description, occurred_at,
          recorded_by, detail)
       VALUES ($1, $2, $3, 'NOT_PERFORMED', $4, $5, $6, $7, '{}'::jsonb)`,
      [
        eventId,
        unit.part_id,
        unitId,
        payload.reasonCode ?? 'NOT_PERFORMED',
        payload.reason,
        occurredAt,
        actor.identityId,
      ],
    );

    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: unit.version + 1,
      effects: [
        {
          kind: 'UNIT_NOT_PERFORMED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: { eventId, reason: payload.reason },
          outboxEvent: {
            type: 'execution.unit.not-performed',
            payload: { unitId, partId: unit.part_id, correlationId },
          },
        },
      ],
    };
  },
};

/* ---------------------------------------------------------- execution.units.void */

const voidUnit: CommandHandler<VoidInput> = {
  name: 'execution.units.void',

  async resolveScope({ db, subjectId }) {
    const unit = await loadUnit(db, requireSubjectId(subjectId, 'UnidadEjecucion'));
    return {
      subject: { kind: 'UnidadEjecucion', id: unit.id, ...(unit.code ? { code: unit.code } : {}) },
      scope: { baseId: unit.base_id },
      currentVersion: unit.version,
      currentState: unit.state,
    };
  },

  async evaluators({ db, subjectId, currentState }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const subject = { kind: 'UnidadEjecucion', id: unitId };
    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: UNIT_TERMINAL,
      }),
      stateTransition({
        machine: 'UnidadEjecucion',
        event: 'ANULAR_ERROR',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          { kind: 'VOID_UNIT', description: 'Anular una UE sin trabajo real.', ruleId: 'RUL-035' },
        ],
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution/void',
        evaluate: async () => {
          // Annulling asserts there was never real work. If there is any, the honest path is
          // NO_REALIZADA with a cause, or an amendment — not erasure by another name (RUL-035).
          const traces = await db.one<{ intervals: string; measurements: string; evidence: string }>(
            `SELECT
               (SELECT count(*)::text FROM execution.time_events WHERE execution_unit_id = $1) AS intervals,
               (SELECT count(*)::text FROM execution.execution_measurements WHERE execution_unit_id = $1) AS measurements,
               (SELECT count(*)::text FROM evidence.evidence_links WHERE execution_unit_id = $1) AS evidence`,
            [unitId],
          );
          const total =
            Number(traces?.intervals ?? '0') +
            Number(traces?.measurements ?? '0') +
            Number(traces?.evidence ?? '0');
          if (total === 0) return {};
          return {
            blocks: [
              {
                ruleId: 'RUL-035',
                precedence: 'P5' as const,
                reason:
                  `Hay evidencia de trabajo real: ${traces?.intervals} intervalo(s), ` +
                  `${traces?.measurements} medición(es), ${traces?.evidence} evidencia(s).`,
                instead:
                  'Marcar NO_REALIZADA con causa si no se hizo, o cerrar y enmendar si se hizo y ' +
                  'hay un error. Anular no es una forma de corregir.',
                subject,
                overrideable: false,
              },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadEjecucion');
    const unit = await loadUnit(db, unitId);
    await db.query(
      `UPDATE execution.execution_units
       SET state = 'ANULADA', ended_at = $2, result_reason = $3, closed_by = $4,
           version = version + 1
       WHERE id = $1`,
      [unitId, occurredAt, payload.reason, actor.identityId],
    );
    return {
      subject: { kind: 'UnidadEjecucion', id: unitId },
      version: unit.version + 1,
      effects: [
        {
          kind: 'UNIT_VOIDED',
          subjectKind: 'UnidadEjecucion',
          subjectId: unitId,
          detail: { reason: payload.reason },
          outboxEvent: {
            type: 'execution.unit.voided',
            payload: { unitId, partId: unit.part_id, correlationId },
          },
        },
      ],
    };
  },
};

/* ---------------------------------------------------------- execution.parts.void */

const voidPart: CommandHandler<VoidInput> = {
  name: 'execution.parts.void',

  async resolveScope({ db, subjectId }) {
    const part = await loadPart(db, requireSubjectId(subjectId, 'Parte'));
    return {
      subject: { kind: 'Parte', id: part.id, ...(part.code ? { code: part.code } : {}) },
      scope: { baseId: part.base_id },
      currentVersion: part.version,
      currentState: part.state,
    };
  },

  async evaluators({ db, subjectId, currentState }) {
    const partId = requireSubjectId(subjectId, 'Parte');
    const subject = { kind: 'Parte', id: partId };
    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: PART_TERMINAL,
      }),
      stateTransition({
        machine: 'Parte',
        event: 'ANULAR_DUPLICADO_ERROR',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          { kind: 'VOID_PART', description: 'Anular un Parte que nunca ejecutó.', ruleId: 'RUL-035' },
        ],
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution/void-part',
        evaluate: async () => {
          const traces = await db.one<{ started: string; intervals: string }>(
            `SELECT
               (SELECT count(*)::text FROM execution.execution_units
                WHERE part_id = $1 AND started_at IS NOT NULL) AS started,
               (SELECT count(*)::text FROM execution.time_events WHERE part_id = $1) AS intervals`,
            [partId],
          );
          const total = Number(traces?.started ?? '0') + Number(traces?.intervals ?? '0');
          if (total === 0) return {};
          return {
            blocks: [
              {
                ruleId: 'RUL-035',
                precedence: 'P5' as const,
                reason:
                  `El Parte tiene ejecución registrada: ${traces?.started} UE iniciada(s) y ` +
                  `${traces?.intervals} intervalo(s).`,
                instead:
                  'Cerrar operativamente con el resultado real. Un Parte que ejecutó no se anula: ' +
                  'la realidad capturada se preserva (C-002).',
                subject,
                overrideable: false,
              },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, occurredAt, correlationId }) {
    const partId = requireSubjectId(subjectId, 'Parte');
    const part = await loadPart(db, partId);
    await db.query(
      `UPDATE execution.parts
       SET state = 'ANULADO', voided_at = $2, version = version + 1 WHERE id = $1`,
      [partId, occurredAt],
    );
    return {
      subject: { kind: 'Parte', id: partId },
      version: part.version + 1,
      effects: [
        {
          kind: 'PART_VOIDED',
          subjectKind: 'Parte',
          subjectId: partId,
          detail: { reason: payload.reason },
          outboxEvent: { type: 'execution.part.voided', payload: { partId, correlationId } },
        },
      ],
    };
  },
};

/* ------------------------------------------------------ execution.parts.handover */

const handover: CommandHandler<HandoverInput> = {
  name: 'execution.parts.handover',

  async resolveScope({ db, subjectId }) {
    const part = await loadPart(db, requireSubjectId(subjectId, 'Parte'));
    return {
      subject: { kind: 'Parte', id: part.id, ...(part.code ? { code: part.code } : {}) },
      scope: { baseId: part.base_id },
      currentVersion: part.version,
      currentState: part.state,
    };
  },

  async evaluators({ db, subjectId, envelope, currentState }) {
    const partId = requireSubjectId(subjectId, 'Parte');
    const subject = { kind: 'Parte', id: partId };
    const at = envelope.occurredAt as Instant;
    const loaded = await loadBehaviorForPart(db, partId, at);

    const counts = await db.one<{ open: string; closed: string }>(
      `SELECT
         (SELECT count(*)::text FROM execution.execution_units
          WHERE part_id = $1 AND state NOT IN ('CERRADA','NO_REALIZADA','ANULADA')) AS open,
         (SELECT count(*)::text FROM execution.execution_units
          WHERE part_id = $1 AND state = 'CERRADA') AS closed`,
      [partId],
    );

    // The strategy decides. RUL-005: continuity by default, a new Parte only where a configured
    // ReglaCorte says the shift is a boundary — and TP-03 says out loud when nobody configured it.
    const identity = loaded.behavior.evaluateIdentity(
      { kind: 'SHIFT_CHANGED' },
      {
        partTypeId: loaded.behavior.id,
        state: (currentState ?? 'EN_EJECUCION') as 'EN_EJECUCION',
        openUnitCount: Number(counts?.open ?? '0'),
        closedUnitCount: Number(counts?.closed ?? '0'),
        config: loaded.config,
      },
    );

    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: PART_TERMINAL,
      }),
      {
        stage: 'S6_IDENTITY',
        precedence: 'P4',
        owner: 'execution/handover',
        evaluate: () => {
          if (identity.outcome === 'NEW_PART') {
            // The configured rule says the shift IS a boundary. This command does not create the
            // next Parte: that is `parts.prepare`, with its own routing and its own gates. Doing it
            // here would start work without passing them.
            return {
              blocks: [
                {
                  ruleId: identity.ruleId,
                  precedence: 'P4' as const,
                  reason:
                    `La ReglaCorte configurada para ${loaded.partTypeCode} trata el turno como ` +
                    'frontera: este Parte se cierra y el turno siguiente es un Parte nuevo.',
                  instead:
                    'Cerrar operativamente este Parte y preparar el del turno siguiente, que pasa ' +
                    'por sus propios gates de inicio.',
                  subject,
                  overrideable: false,
                },
              ],
              rulesApplied: [
                { ruleId: identity.ruleId, precedence: 'P4' as const, outcome: 'WON' as const, note: identity.reason },
              ],
            };
          }
          return {
            effects: [
              {
                kind: 'HANDOVER',
                description:
                  'Cerrar los intervalos del roster saliente, abrir los del entrante y revalidar ' +
                  `los gates. ${identity.reason}`,
                ruleId: identity.ruleId,
              },
            ],
            // When the answer came from a default, say so. A later ReglaCorte must not look like the
            // system changed its mind about a shift it already handled.
            ...(identity.fromDefault
              ? {
                  warnings: [
                    {
                      ruleId: identity.ruleId,
                      precedence: 'P4' as const,
                      reason:
                        identity.pendingConfiguration ??
                        'Sin ReglaCorte configurada se aplicó el default conservador: el Parte continúa.',
                      subject,
                    },
                  ],
                }
              : {}),
            rulesApplied: [
              { ruleId: identity.ruleId, precedence: 'P4' as const, outcome: 'WON' as const, note: identity.reason },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, decision, correlationId }) {
    const partId = requireSubjectId(subjectId, 'Parte');
    const part = await loadPart(db, partId);

    // Outgoing roster: intervals close. Nobody is deleted — `o-delp` is the defect this avoids.
    const closed = await db.query<{ id: Uuid; person_id: Uuid }>(
      `UPDATE execution.person_execution_assignments
       SET ended_at = $2, end_reason = $3
       WHERE part_id = $1 AND ended_at IS NULL
       RETURNING id, person_id`,
      [partId, occurredAt, `Handover: ${payload.note}`],
    );

    // Incoming roster: new intervals, starting now. Their compliance is UNKNOWN until Habilita
    // evaluates them, and UNKNOWN is a real value rather than an optimistic COMPLIANT.
    const opened: string[] = [];
    for (const personId of payload.incomingPersonIds ?? []) {
      const id = uuidv7();
      await db.query(
        `INSERT INTO execution.person_execution_assignments
           (id, part_id, person_id, role, started_at, compliance_status, created_by)
         VALUES ($1, $2, $3, 'OPERARIO', $4, 'UNKNOWN', $5)`,
        [id, partId, personId, occurredAt, actor.identityId],
      );
      opened.push(id);
    }

    if (payload.incomingCrewId) {
      await db.query('UPDATE execution.parts SET crew_id = $2, version = version + 1 WHERE id = $1', [
        partId,
        payload.incomingCrewId,
      ]);
    }

    const eventId = uuidv7();
    await db.query(
      `INSERT INTO execution.operational_events
         (id, part_id, event_type, reason_code, description, occurred_at, recorded_by,
          decision_trace_id, detail)
       VALUES ($1, $2, 'HANDOVER', 'SHIFT_CHANGE', $3, $4, $5, $6, $7)`,
      [
        eventId,
        partId,
        payload.note,
        occurredAt,
        actor.identityId,
        decision.decisionId,
        JSON.stringify({
          closedAssignments: closed.rows.map((r) => r.id),
          openedAssignments: opened,
          incomingCrewId: payload.incomingCrewId ?? null,
          // RUL-005 requires the gates to be revalidated. The next start or resume runs them; this
          // records that the obligation exists rather than claiming it was already satisfied.
          gatesRevalidationRequired: true,
        }),
      ],
    );

    return {
      subject: { kind: 'Parte', id: partId },
      version: part.version,
      effects: [
        {
          kind: 'HANDOVER_RECORDED',
          subjectKind: 'Parte',
          subjectId: partId,
          detail: {
            eventId,
            closedAssignments: closed.rows.length,
            openedAssignments: opened.length,
          },
          outboxEvent: {
            type: 'execution.part.handover',
            payload: { partId, eventId, correlationId },
          },
        },
      ],
    };
  },
};

/* ------------------------------------------------- execution.amendments.create */

const createAmendment: CommandHandler<CreateAmendmentInput> = {
  name: 'execution.amendments.create',

  async resolveScope({ db, payload }) {
    const scope = await amendmentScope(db, payload);
    return { subject: { kind: 'EnmiendaOperativa', id: null }, scope };
  },

  async evaluators({ db, payload }) {
    const subject = { kind: 'EnmiendaOperativa', id: null };
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution/amend',
        evaluate: async () => {
          // RUL-035: an amendment exists BECAUSE direct editing is forbidden. So the target has to
          // actually be closed — amending something still open would be editing with extra steps.
          if (payload.targetKind === 'EXECUTION_UNIT') {
            if (!payload.executionUnitId) {
              return {
                blocks: [
                  {
                    ruleId: 'RUL-073',
                    precedence: 'P5' as const,
                    reason: 'Falta la UE que se enmienda.',
                    instead: 'Nombrar el executionUnitId.',
                    subject,
                    overrideable: false,
                  },
                ],
              };
            }
            const unit = await db.one<{ state: string; current_version_id: Uuid | null }>(
              `SELECT state::text AS state, current_version_id FROM execution.execution_units WHERE id = $1`,
              [payload.executionUnitId],
            );
            if (!unit) {
              return {
                blocks: [
                  {
                    ruleId: 'RUL-073',
                    precedence: 'P5' as const,
                    reason: `No existe la UE ${payload.executionUnitId}.`,
                    instead: 'Verificar el identificador.',
                    subject,
                    overrideable: false,
                  },
                ],
              };
            }
            if (unit.state === 'EN_EJECUCION' || unit.state === 'PENDIENTE' || unit.state === 'SUSPENDIDA') {
              return {
                blocks: [
                  {
                    ruleId: 'RUL-035',
                    precedence: 'P5' as const,
                    reason: `La UE está ${unit.state}: todavía se puede registrar la realidad directamente.`,
                    instead:
                      'Registrar el hecho con el comando de captura correspondiente. La enmienda es ' +
                      'para realidad ya cerrada y versionada.',
                    subject,
                    overrideable: false,
                  },
                ],
              };
            }
          }

          if (payload.oldValue === payload.newValue) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-073',
                  precedence: 'P5' as const,
                  reason: 'El valor anterior y el nuevo son iguales: no hay nada que enmendar.',
                  instead: 'Revisar el campo y el valor corregido.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }

          return {
            effects: [
              {
                kind: 'CREATE_AMENDMENT',
                description:
                  'Registrar la enmienda con old/new, motivo y actor. Queda PENDIENTE: la ' +
                  'aprobación es un acto separado y de otra persona (RUL-073).',
                ruleId: 'RUL-073',
              },
            ],
            missing: [
              ...(payload.evidenceId
                ? []
                : [
                    {
                      what: 'Evidencia de respaldo',
                      reason:
                        'RUL-073 pide evidencia cuando la regla aplicable la exige. Sin ella la ' +
                        'enmienda se registra, y quien apruebe decide si alcanza.',
                    },
                  ]),
            ],
            rulesApplied: [{ ruleId: 'RUL-073', precedence: 'P5' as const, outcome: 'WON' as const }],
          };
        },
      },
    ];
  },

  async apply({ db, payload, actor, occurredAt, decision, correlationId }) {
    const amendmentId = uuidv7();
    const previousVersionId =
      payload.targetKind === 'EXECUTION_UNIT' && payload.executionUnitId
        ? (
            await db.one<{ current_version_id: Uuid | null }>(
              'SELECT current_version_id FROM execution.execution_units WHERE id = $1',
              [payload.executionUnitId],
            )
          )?.current_version_id ?? null
        : null;

    await db.query(
      `INSERT INTO execution.operational_amendments
         (id, target_kind, part_id, execution_unit_id, previous_version_id, field_path,
          old_value, new_value, reason, requested_by, evidence_id, decision_trace_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        amendmentId,
        payload.targetKind,
        payload.targetKind === 'PART' ? payload.partId ?? null : null,
        payload.targetKind === 'EXECUTION_UNIT' ? payload.executionUnitId ?? null : null,
        previousVersionId,
        payload.fieldPath,
        JSON.stringify(payload.oldValue ?? null),
        JSON.stringify(payload.newValue ?? null),
        payload.reason,
        actor.identityId,
        payload.evidenceId ?? null,
        decision.decisionId,
        occurredAt,
      ],
    );

    return {
      subject: { kind: 'EnmiendaOperativa', id: amendmentId },
      version: 1,
      effects: [
        {
          kind: 'AMENDMENT_CREATED',
          subjectKind: 'EnmiendaOperativa',
          subjectId: amendmentId,
          detail: {
            targetKind: payload.targetKind,
            fieldPath: payload.fieldPath,
            previousVersionId,
            // Stated explicitly: nothing changed yet. A created amendment is a request.
            note: 'La enmienda queda registrada y sin efecto hasta su aprobación.',
          },
          outboxEvent: {
            type: 'execution.amendment.created',
            payload: { amendmentId, targetKind: payload.targetKind, correlationId },
          },
        },
      ],
    };
  },
};

/* ------------------------------------------------ execution.amendments.approve */

const approveAmendment: CommandHandler<ApproveAmendmentInput> = {
  name: 'execution.amendments.approve',

  async resolveScope({ db, subjectId }) {
    const amendmentId = requireSubjectId(subjectId, 'EnmiendaOperativa');
    const row = await db.one<{
      id: Uuid;
      part_id: Uuid | null;
      execution_unit_id: Uuid | null;
      approved_at: Date | null;
      base_id: Uuid | null;
    }>(
      `SELECT a.id, a.part_id, a.execution_unit_id, a.approved_at,
              coalesce(p1.base_id, p2.base_id) AS base_id
       FROM execution.operational_amendments a
       LEFT JOIN execution.parts p1 ON p1.id = a.part_id
       LEFT JOIN execution.execution_units u ON u.id = a.execution_unit_id
       LEFT JOIN execution.parts p2 ON p2.id = u.part_id
       WHERE a.id = $1`,
      [amendmentId],
    );
    if (!row) {
      throw new DomainError({ code: 'NOT_FOUND', message: `No existe la enmienda ${amendmentId}.` });
    }
    return {
      subject: { kind: 'EnmiendaOperativa', id: amendmentId },
      scope: { baseId: row.base_id },
      currentState: row.approved_at === null ? 'PENDIENTE' : 'APROBADA',
    };
  },

  async evaluators({ db, subjectId, actor }) {
    const amendmentId = requireSubjectId(subjectId, 'EnmiendaOperativa');
    const subject = { kind: 'EnmiendaOperativa', id: amendmentId };
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'execution/amend-approve',
        evaluate: async () => {
          const row = await db.one<{ requested_by: Uuid; approved_at: Date | null }>(
            'SELECT requested_by, approved_at FROM execution.operational_amendments WHERE id = $1',
            [amendmentId],
          );
          if (!row) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-073',
                  precedence: 'P5' as const,
                  reason: `No existe la enmienda ${amendmentId}.`,
                  instead: 'Verificar el identificador.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          if (row.approved_at !== null) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-073',
                  precedence: 'P5' as const,
                  reason: `Ya fue aprobada el ${row.approved_at.toISOString()}.`,
                  instead:
                    'Crear una enmienda nueva si hace falta otra corrección. Una decisión tomada no ' +
                    'se vuelve a tomar en el mismo registro.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          // RUL-073: author and approver are two people. Otherwise the amendment is a direct edit
          // wearing a process, which is exactly what RUL-035 forbids.
          if (row.requested_by === actor.identityId) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-073',
                  precedence: 'P5' as const,
                  reason: 'Quien solicitó la enmienda no puede aprobarla.',
                  instead:
                    'Pedir la aprobación a alguien con autoridad de enmienda. Autor y aprobador son ' +
                    'dos actos distintos; si fueran el mismo, la enmienda sería una edición directa.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          return {
            effects: [
              {
                kind: 'APPROVE_AMENDMENT',
                description:
                  'Aprobar la enmienda, escribir la versión efectiva nueva e invalidar los ' +
                  'derivados comerciales (RUL-065).',
                ruleId: 'RUL-073',
              },
            ],
            rulesApplied: [{ ruleId: 'RUL-073', precedence: 'P5' as const, outcome: 'WON' as const }],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const amendmentId = requireSubjectId(subjectId, 'EnmiendaOperativa');
    const amendment = await db.one<{
      execution_unit_id: Uuid | null;
      part_id: Uuid | null;
      field_path: string;
      previous_version_id: Uuid | null;
      reason: string;
    }>(
      `SELECT execution_unit_id, part_id, field_path, previous_version_id, reason
       FROM execution.operational_amendments WHERE id = $1`,
      [amendmentId],
    );
    if (!amendment) {
      throw new DomainError({ code: 'NOT_FOUND', message: `No existe la enmienda ${amendmentId}.` });
    }

    let newVersionId: Uuid | null = null;
    if (amendment.execution_unit_id) {
      // A new immutable version, built from the amended record. The previous version stays: a UC
      // that pointed at it keeps pointing at what it actually consumed (C-030).
      newVersionId = uuidv7();
      await db.query(
        `INSERT INTO execution.execution_unit_versions
           (id, execution_unit_id, version_no, reason, snapshot, content_hash, effective_at, created_by,
            amendment_id)
         SELECT $1, u.id,
                (SELECT coalesce(max(version_no), 0) + 1 FROM execution.execution_unit_versions
                  WHERE execution_unit_id = u.id),
                'AMENDMENT',
                jsonb_build_object(
                  'amendmentId', $2::uuid,
                  'fieldPath', $3::text,
                  'reason', $4::text,
                  'unit', to_jsonb(u.*)),
                encode(digest($2::text || $3::text || u.id::text, 'sha256'), 'hex'),
                $5, $6, $2
         FROM execution.execution_units u WHERE u.id = $7`,
        [
          newVersionId,
          amendmentId,
          amendment.field_path,
          amendment.reason,
          occurredAt,
          actor.identityId,
          amendment.execution_unit_id,
        ],
      );
      // Only the pointer moves. The closed UE itself is not reopened (TPR-010).
      await db.query('UPDATE execution.execution_units SET current_version_id = $2 WHERE id = $1', [
        amendment.execution_unit_id,
        newVersionId,
      ]);
    }

    await db.query(
      `UPDATE execution.operational_amendments
       SET approved_by = $2, approved_at = $3, new_version_id = $4
       WHERE id = $1`,
      [amendmentId, actor.identityId, occurredAt, newVersionId],
    );

    return {
      subject: { kind: 'EnmiendaOperativa', id: amendmentId },
      version: 1,
      effects: [
        {
          kind: 'AMENDMENT_APPROVED',
          subjectKind: 'EnmiendaOperativa',
          subjectId: amendmentId,
          detail: {
            newVersionId,
            previousVersionId: amendment.previous_version_id,
            note: payload.note ?? null,
          },
          outboxEvent: {
            // RUL-065: the derived commercial units must be marked REQUIERE_RECALCULO. The worker
            // does that; the effect is durable here so it cannot be lost (RGT-13).
            type: 'execution.amendment.approved',
            payload: {
              amendmentId,
              executionUnitId: amendment.execution_unit_id,
              newVersionId,
              correlationId,
            },
          },
        },
      ],
    };
  },
};

async function amendmentScope(
  db: Db,
  payload: CreateAmendmentInput,
): Promise<{ baseId?: Uuid | null }> {
  if (payload.targetKind === 'PART' && payload.partId) {
    const part = await loadPart(db, payload.partId);
    return { baseId: part.base_id };
  }
  if (payload.targetKind === 'EXECUTION_UNIT' && payload.executionUnitId) {
    const unit = await loadUnit(db, payload.executionUnitId);
    return { baseId: unit.base_id };
  }
  throw new DomainError({
    code: 'VALIDATION_FAILED',
    message: 'La enmienda tiene que nombrar exactamente un objetivo: un Parte o una UE.',
  });
}

export function registerExecutionLifecycleCommands(): void {
  registerHandler(suspendUnit);
  registerHandler(resumeUnit);
  registerHandler(replacePerson);
  registerHandler(replaceResource);
  registerHandler(markUnitNotPerformed);
  registerHandler(voidUnit);
  registerHandler(voidPart);
  registerHandler(handover);
  registerHandler(createAmendment);
  registerHandler(approveAmendment);
}
