/**
 * Planning command handlers.
 *
 * C-001 is what this module protects: Planning records intention, Execution records reality, and
 * neither overwrites the other. The prototype had one mutable `S.trabajos` row per job, so an
 * execution event could and did shorten the plan (`o-send` set `t.dias = p.dia + 1`). Here the
 * approved version is immutable — enforced by trigger — and every post-dispatch change becomes a new
 * version or a directive (RUL-020).
 *
 * The extension flow is the centrepiece, because it is where PL-093 lived: evaluating a proposed
 * longer window must not make the assignment collide with itself.
 */
import { addDays, instantFrom, uuidv7, type Instant, type Uuid } from '@vds/kernel';
import type {
  ApprovePlanVersionInput,
  DispatchInput,
  MarkNotPerformedInput,
  NominateInput,
  RequestExtensionInput,
  ResolveExtensionInput,
} from '@vds/contracts';
import { createHash } from 'node:crypto';
import { DomainError } from '@vds/kernel';
import { registerHandler, type CommandHandler } from '../platform/pipeline.ts';
import type { Db } from '../platform/db.ts';
import { detectConflicts, recordConflicts, type ConflictFinding } from '../platform/conflicts.ts';
import { historyInvariants, stateTransition } from './evaluators.ts';

const ASSIGNMENT_TERMINAL = ['CUMPLIDA', 'NO_REALIZADA', 'CANCELADA', 'SUPERSEDIDA'] as const;

interface AssignmentRow {
  id: Uuid;
  code: string | null;
  state: string;
  plan_version_id: Uuid;
  plan_id: Uuid;
  base_id: Uuid | null;
  contract_id: Uuid | null;
  window_start: Date;
  window_end: Date;
  version: number;
  plan_version_state: string;
}

async function loadAssignment(db: Db, assignmentId: string): Promise<AssignmentRow> {
  const row = await db.one<AssignmentRow>(
    `SELECT a.id, a.code, a.state::text AS state, a.plan_version_id, pv.plan_id, p.base_id,
            c.id AS contract_id, a.window_start, a.window_end, a.version,
            pv.state::text AS plan_version_state
     FROM planning.planned_assignments a
     JOIN planning.plan_versions pv ON pv.id = a.plan_version_id
     JOIN planning.plans p ON p.id = pv.plan_id
     LEFT JOIN planning.planned_units pu ON pu.planned_assignment_id = a.id
     LEFT JOIN config.contract_services cs ON cs.id = pu.contract_service_id
     LEFT JOIN config.contract_versions cv ON cv.id = cs.contract_version_id
     LEFT JOIN config.contracts c ON c.id = cv.contract_id
     WHERE a.id = $1
     LIMIT 1`,
    [assignmentId],
  );
  if (!row) {
    throw new DomainError({ code: 'NOT_FOUND', message: `No existe la asignación ${assignmentId}.` });
  }
  return row;
}

const hashOf = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/* ------------------------------------------------- planning.versions.approve */

const approveVersion: CommandHandler<ApprovePlanVersionInput> = {
  name: 'planning.versions.approve',

  async resolveScope({ db, subjectId }) {
    const versionId = requireId(subjectId, 'PlanificacionVersion');
    const row = await db.one<{ id: Uuid; state: string; plan_id: Uuid; base_id: Uuid | null; version_no: number }>(
      `SELECT pv.id, pv.state::text AS state, pv.plan_id, p.base_id, pv.version_no
       FROM planning.plan_versions pv
       JOIN planning.plans p ON p.id = pv.plan_id
       WHERE pv.id = $1`,
      [versionId],
    );
    if (!row) {
      throw new DomainError({ code: 'NOT_FOUND', message: `No existe la versión ${versionId}.` });
    }
    return {
      subject: { kind: 'PlanificacionVersion', id: versionId, code: `v${row.version_no}` },
      scope: { baseId: row.base_id },
      currentState: row.state,
    };
  },

  async evaluators({ db, subjectId, currentState }) {
    const versionId = requireId(subjectId, 'PlanificacionVersion');
    const subject = { kind: 'PlanificacionVersion', id: versionId };
    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: ['APROBADA', 'SUPERSEDIDA', 'RECHAZADA'],
      }),
      {
        stage: 'S4_TRANSITION',
        precedence: 'P2',
        owner: 'planning/approve',
        // RUL-010 is a HARD_GATE: consistent assignments, no critical errors, versioned catalogues.
        evaluate: async () => {
          const checks = await db.one<{ assignments: string; without_units: string; bad_window: string }>(
            `SELECT
               (SELECT count(*)::text FROM planning.planned_assignments
                WHERE plan_version_id = $1) AS assignments,
               (SELECT count(*)::text FROM planning.planned_assignments a
                WHERE a.plan_version_id = $1
                  AND NOT EXISTS (SELECT 1 FROM planning.planned_units u
                                  WHERE u.planned_assignment_id = a.id)) AS without_units,
               (SELECT count(*)::text FROM planning.planned_assignments
                WHERE plan_version_id = $1 AND window_end <= window_start) AS bad_window`,
            [versionId],
          );

          const assignments = Number(checks?.assignments ?? '0');
          const withoutUnits = Number(checks?.without_units ?? '0');
          const badWindow = Number(checks?.bad_window ?? '0');
          const blocks = [];

          // T-P02 requires at least one assignment for the plan to become ACTIVA.
          if (assignments === 0) {
            blocks.push({
              ruleId: 'RUL-010',
              precedence: 'P2' as const,
              reason: 'La versión no tiene ninguna asignación planificada.',
              instead: 'Agregar al menos una asignación antes de aprobar (T-P02).',
              subject,
              overrideable: false,
            });
          }
          if (withoutUnits > 0) {
            blocks.push({
              ruleId: 'RUL-010',
              precedence: 'P2' as const,
              reason: `${withoutUnits} asignación(es) sin unidad planificada (R-023 exige 1..N).`,
              instead: 'Definir el trabajo previsto de cada asignación antes de congelar el snapshot.',
              subject,
              overrideable: false,
            });
          }
          if (badWindow > 0) {
            blocks.push({
              ruleId: 'RUL-010',
              precedence: 'P2' as const,
              reason: `${badWindow} asignación(es) con ventana inválida.`,
              instead: 'Corregir la ventana: el fin debe ser posterior al inicio.',
              subject,
              overrideable: false,
            });
          }

          return blocks.length > 0
            ? { blocks, rulesApplied: [{ ruleId: 'RUL-010', precedence: 'P2' as const, outcome: 'WON' as const }] }
            : {
                targetState: 'APROBADA',
                effects: [
                  {
                    kind: 'APPROVE_VERSION',
                    description: 'Congelar el snapshot de intención y activar el plan.',
                    ruleId: 'RUL-010',
                  },
                ],
                rulesApplied: [{ ruleId: 'RUL-010', precedence: 'P2' as const, outcome: 'WON' as const }],
              };
        },
      },
    ];
  },

  async apply({ db, subjectId, actor, payload, occurredAt, correlationId }) {
    const versionId = requireId(subjectId, 'PlanificacionVersion');
    const current = await db.one<{ plan_id: Uuid; version_no: number }>(
      'SELECT plan_id, version_no FROM planning.plan_versions WHERE id = $1',
      [versionId],
    );

    // T-P03: approving a new version supersedes the previous one. The previous one stays readable;
    // only its state moves, which the immutability trigger explicitly permits.
    await db.query(
      `UPDATE planning.plan_versions
       SET state = 'SUPERSEDIDA', superseded_at = $3, superseded_by_id = $2
       WHERE plan_id = $1 AND state = 'APROBADA' AND id <> $2`,
      [current!.plan_id, versionId, occurredAt],
    );

    await db.query(
      `UPDATE planning.plan_versions
       SET state = 'APROBADA', approved_at = $2, approved_by = $3
       WHERE id = $1`,
      [versionId, occurredAt, actor.identityId],
    );

    await db.query(`UPDATE planning.plans SET state = 'ACTIVA' WHERE id = $1`, [current!.plan_id]);

    void payload;
    return {
      subject: { kind: 'PlanificacionVersion', id: versionId },
      effects: [
        {
          kind: 'VERSION_APPROVED',
          subjectKind: 'PlanificacionVersion',
          subjectId: versionId,
          detail: { planId: current!.plan_id, versionNo: current!.version_no },
          outboxEvent: {
            // Interface A (FC-01): the approved intention becomes available to Execution.
            type: 'planning.version.approved',
            payload: { planVersionId: versionId, planId: current!.plan_id, correlationId },
          },
        },
      ],
    };
  },
};

/* ------------------------------------- planning.assignments.evaluate-readiness */

const evaluateReadiness: CommandHandler<{ validForMinutes?: number }> = {
  name: 'planning.assignments.evaluate-readiness',

  async resolveScope({ db, subjectId }) {
    const assignment = await loadAssignment(db, requireId(subjectId, 'AsignacionPlanificada'));
    return {
      subject: {
        kind: 'AsignacionPlanificada',
        id: assignment.id,
        ...(assignment.code ? { code: assignment.code } : {}),
      },
      scope: { baseId: assignment.base_id, contractId: assignment.contract_id },
      currentVersion: assignment.version,
      currentState: assignment.state,
    };
  },

  async evaluators({ db, subjectId, currentState }) {
    const assignmentId = requireId(subjectId, 'AsignacionPlanificada');
    const subject = { kind: 'AsignacionPlanificada', id: assignmentId };
    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: ASSIGNMENT_TERMINAL,
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'planning/readiness',
        // The effect has to be declared: decide() derives NO_OP from an envelope with no effect and
        // no target state, and a NO_OP authorises nothing. Evaluating readiness always produces an
        // append-only evaluation row, so there is always an effect.
        evaluate: () => ({
          effects: [
            {
              kind: 'EVALUATE_READINESS',
              description:
                'Registrar una evaluación de readiness con evaluado_at y valido_hasta. Un cambio ' +
                'de dependencia la invalida sin borrarla (C-015).',
              ruleId: 'RUL-014',
            },
          ],
          rulesApplied: [{ ruleId: 'RUL-014', precedence: 'P5' as const, outcome: 'WON' as const }],
        }),
      },
    ];
  },

  async apply({ db, subjectId, payload, occurredAt, decision, correlationId }) {
    const assignmentId = requireId(subjectId, 'AsignacionPlanificada');
    const assignment = await loadAssignment(db, assignmentId);

    // RUL-013: a hard documentary/Habilita failure forces NOT_READY. Collect the causes rather than
    // returning a bare boolean — RUL-013 requires the reasons to be preserved.
    const causes: { ruleId: string; reason: string }[] = [];

    const { rows: nominated } = await db.query<{ person_id: Uuid; first_name: string; last_name: string }>(
      `SELECT DISTINCT p.person_id, pe.first_name, pe.last_name
       FROM planning.planned_person_assignments p
       JOIN config.people pe ON pe.id = p.person_id
       WHERE p.planned_assignment_id = $1
          OR p.planned_unit_id IN (SELECT id FROM planning.planned_units WHERE planned_assignment_id = $1)`,
      [assignmentId],
    );

    if (nominated.length > 0) {
      const { rows: failures } = await db.query<{
        first_name: string;
        last_name: string;
        requirement_name: string;
        severity: string;
      }>(
        `SELECT pe.first_name, pe.last_name, r.name AS requirement_name, r.severity::text AS severity
         FROM config.people pe
         CROSS JOIN habilita.requirements r
         LEFT JOIN LATERAL (
           SELECT status FROM habilita.compliances
           WHERE person_id = pe.id AND requirement_id = r.id
             AND valid_from <= $2::timestamptz::date
             AND (valid_until IS NULL OR valid_until >= $2::timestamptz::date)
           ORDER BY valid_from DESC LIMIT 1
         ) c ON true
         WHERE pe.id = ANY($1::uuid[])
           AND r.applies_to = 'PERSON'
           AND r.severity = 'HARD_BLOCK'
           AND coalesce(c.status, 'MISSING') <> 'COMPLIANT'`,
        [nominated.map((n) => n.person_id), occurredAt],
      );

      for (const failure of failures) {
        causes.push({
          ruleId: 'RUL-013',
          reason: `${failure.first_name} ${failure.last_name}: ${failure.requirement_name} no cumplida.`,
        });
      }
    }

    const result = causes.length === 0 ? 'READY' : 'NOT_READY';

    // C-015: READY is temporal. It carries evaluated_at and valid_until, and a dependency change
    // invalidates it without erasing the evaluation.
    const validForMinutes = payload.validForMinutes ?? 720;
    const validUntil = new Date(Date.parse(occurredAt) + validForMinutes * 60_000).toISOString();

    const evaluationId = uuidv7();
    await db.query(
      `INSERT INTO planning.readiness_evaluations
         (id, planned_assignment_id, plan_version_id, result, causes, dependencies,
          decision_trace_id, evaluated_at, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        evaluationId,
        assignmentId,
        assignment.plan_version_id,
        result,
        JSON.stringify(causes),
        JSON.stringify({ people: nominated.map((n) => n.person_id) }),
        decision.decisionId,
        occurredAt,
        validUntil,
      ],
    );

    // T-A02 / T-A03: the state follows the evaluation, and NOT_READY returns it to PROGRAMADA so
    // dispatch is refused until a new evaluation says otherwise.
    const nextState =
      result === 'READY'
        ? assignment.state === 'PROGRAMADA'
          ? 'READY'
          : assignment.state
        : assignment.state === 'READY'
          ? 'PROGRAMADA'
          : assignment.state;

    if (nextState !== assignment.state) {
      await db.query(
        `UPDATE planning.planned_assignments SET state = $2::planning.assignment_state,
                version = version + 1 WHERE id = $1`,
        [assignmentId, nextState],
      );
    }

    return {
      subject: { kind: 'AsignacionPlanificada', id: assignmentId },
      version: assignment.version + (nextState !== assignment.state ? 1 : 0),
      effects: [
        {
          kind: result === 'READY' ? 'READINESS_OK' : 'READINESS_BLOCKED',
          subjectKind: 'AsignacionPlanificada',
          subjectId: assignmentId,
          detail: { evaluationId, result, validUntil, causes: causes.length },
          outboxEvent: {
            type: 'planning.readiness.evaluated',
            payload: { assignmentId, evaluationId, result, correlationId },
          },
        },
      ],
    };
  },
};

/* ----------------------------------------------- planning.assignments.dispatch */

const dispatch: CommandHandler<DispatchInput> = {
  name: 'planning.assignments.dispatch',

  async resolveScope({ db, subjectId }) {
    const assignment = await loadAssignment(db, requireId(subjectId, 'AsignacionPlanificada'));
    return {
      subject: {
        kind: 'AsignacionPlanificada',
        id: assignment.id,
        ...(assignment.code ? { code: assignment.code } : {}),
      },
      scope: { baseId: assignment.base_id, contractId: assignment.contract_id },
      currentVersion: assignment.version,
      currentState: assignment.state,
    };
  },

  async evaluators({ db, subjectId, envelope, currentState }) {
    const assignmentId = requireId(subjectId, 'AsignacionPlanificada');
    const subject = { kind: 'AsignacionPlanificada', id: assignmentId };
    // The instant the dispatch claims to have happened. A command that travelled through an offline
    // outbox is judged at its own moment, not at the moment the server got round to it — the same
    // rule control/apply applies to RUL-058.
    const at = Date.parse(envelope.occurredAt as string);
    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: ASSIGNMENT_TERMINAL,
      }),
      stateTransition({
        machine: 'AsignacionPlanificada',
        event: 'DESPACHAR',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          {
            kind: 'DISPATCH',
            description: 'Entregar el contexto a campo y construir el bundle versionado.',
            ruleId: 'RUL-016',
          },
        ],
      }),
      {
        stage: 'S5_CONTROL_PLANE',
        precedence: 'P3',
        owner: 'planning/dispatch',
        // RUL-016 HARD_GATE: a current readiness evaluation must exist. An expired one does not
        // count — C-015 is explicit that READY is not a permanent checkbox.
        evaluate: async () => {
          const readiness = await db.one<{ result: string; valid_until: Date | null; evaluated_at: Date }>(
            `SELECT result, valid_until, evaluated_at
             FROM planning.readiness_evaluations
             WHERE planned_assignment_id = $1 AND invalidated_at IS NULL
             ORDER BY evaluated_at DESC LIMIT 1`,
            [assignmentId],
          );

          if (!readiness) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-016',
                  precedence: 'P3' as const,
                  reason: 'No hay evaluación de readiness para esta asignación.',
                  instead: 'Ejecutar evaluate-readiness antes de despachar.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          if (readiness.result !== 'READY') {
            return {
              blocks: [
                {
                  ruleId: 'RUL-016',
                  precedence: 'P3' as const,
                  reason: 'La evaluación vigente es NOT_READY.',
                  instead: 'Resolver las causas y volver a evaluar. No se despacha una asignación NO_READY.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          if (readiness.valid_until !== null && readiness.valid_until.getTime() <= at) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-016',
                  precedence: 'P3' as const,
                  reason:
                    `El READY venció el ${readiness.valid_until.toISOString()}. ` +
                    'READY es temporal, no un checkbox permanente (C-015).',
                  instead: 'Volver a evaluar readiness con el contexto actual.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          return {};
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const assignmentId = requireId(subjectId, 'AsignacionPlanificada');
    const assignment = await loadAssignment(db, assignmentId);

    // RUL-017: the bundle is a versioned projection with an expiry, never a source of truth
    // (C-016 / MR-08). It carries enough to operate offline within its validity and no more.
    const { rows: units } = await db.query(
      `SELECT pu.id, pu.description, pu.service_id, pu.technical_location_id, pu.contract_service_id,
              pu.contract_item_id, pu.planned_quantity, pu.unit_of_measure_id
       FROM planning.planned_units pu WHERE pu.planned_assignment_id = $1
       ORDER BY pu.sequence_no NULLS LAST`,
      [assignmentId],
    );
    const { rows: people } = await db.query(
      `SELECT p.person_id, pe.first_name, pe.last_name, p.role
       FROM planning.planned_person_assignments p
       JOIN config.people pe ON pe.id = p.person_id
       WHERE p.planned_assignment_id = $1`,
      [assignmentId],
    );
    const { rows: requirements } = await db.query(
      `SELECT id, code, name, severity::text AS severity, overrideable_via
       FROM habilita.requirements
       WHERE valid_from <= $1::timestamptz::date
         AND (valid_until IS NULL OR valid_until >= $1::timestamptz::date)`,
      [occurredAt],
    );
    const policy = await db.one<{ version_label: string; bundle_ttl_minutes: number; never_skip_gates: string[] }>(
      `SELECT version_label, bundle_ttl_minutes, never_skip_gates
       FROM sync.offline_policies WHERE is_default = true LIMIT 1`,
    );

    const ttl = payload.bundleTtlMinutes ?? policy?.bundle_ttl_minutes ?? 720;
    const validUntil = new Date(Date.parse(occurredAt) + ttl * 60_000).toISOString();
    const content = {
      assignment: {
        id: assignmentId,
        code: assignment.code,
        windowStart: assignment.window_start.toISOString(),
        windowEnd: assignment.window_end.toISOString(),
      },
      units,
      people,
      requirements,
      offlinePolicy: policy?.version_label ?? null,
      neverSkipGates: policy?.never_skip_gates ?? [],
    };

    const bundleId = uuidv7();
    await db.query(
      `INSERT INTO sync.execution_context_bundles
         (id, plan_version_id, planned_assignment_id, identity_id, device_id, payload,
          content_hash, built_at, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        bundleId,
        assignment.plan_version_id,
        assignmentId,
        payload.identityId ?? actor.identityId,
        payload.deviceId ?? null,
        JSON.stringify(content),
        hashOf(content),
        occurredAt,
        validUntil,
      ],
    );

    await db.query(
      `UPDATE planning.planned_assignments
       SET state = 'DESPACHADA', dispatched_at = $2, version = version + 1
       WHERE id = $1`,
      [assignmentId, occurredAt],
    );

    return {
      subject: { kind: 'AsignacionPlanificada', id: assignmentId },
      version: assignment.version + 1,
      effects: [
        {
          kind: 'DISPATCHED',
          subjectKind: 'AsignacionPlanificada',
          subjectId: assignmentId,
          detail: { bundleId, validUntil },
          outboxEvent: {
            type: 'planning.assignment.dispatched',
            payload: { assignmentId, bundleId, validUntil, correlationId },
          },
        },
      ],
    };
  },
};

/* --------------------------------------- planning.assignments.request-extension */

/**
 * The PL-093 command.
 *
 * A crew asks for more days. Evaluating that request means asking "would this longer window conflict
 * with anything?" — and the assignment being extended must be excluded from its own comparison. The
 * prototype built a copy and excluded by object reference, so the copy hit the original.
 *
 * Nothing about the approved version changes here. The request is recorded as an operational event
 * and resolved by a planner, who creates a new version or a directive (RUL-020, RGT-03).
 */
const requestExtension: CommandHandler<RequestExtensionInput> = {
  name: 'planning.assignments.request-extension',

  async resolveScope({ db, subjectId }) {
    const assignment = await loadAssignment(db, requireId(subjectId, 'AsignacionPlanificada'));
    return {
      subject: {
        kind: 'AsignacionPlanificada',
        id: assignment.id,
        ...(assignment.code ? { code: assignment.code } : {}),
      },
      scope: { baseId: assignment.base_id, contractId: assignment.contract_id },
      currentVersion: assignment.version,
      currentState: assignment.state,
    };
  },

  async evaluators({ db, subjectId, payload, currentState }) {
    const assignmentId = requireId(subjectId, 'AsignacionPlanificada');
    const subject = { kind: 'AsignacionPlanificada', id: assignmentId };
    const assignment = await loadAssignment(db, assignmentId);

    // The proposed window: the approved one, extended. It exists only as a candidate.
    const proposedUntil = instantFrom(
      new Date(assignment.window_end.getTime() + payload.additionalDays * 86_400_000),
    );

    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: ASSIGNMENT_TERMINAL,
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'planning/extension',
        evaluate: async () => {
          const { rows: subjects } = await db.query<{ kind: string; id: Uuid }>(
            `SELECT 'PERSON' AS kind, person_id AS id
             FROM planning.planned_person_assignments
             WHERE planned_assignment_id = $1
             UNION ALL
             SELECT 'RESOURCE' AS kind, resource_id AS id
             FROM planning.planned_resource_assignments
             WHERE planned_assignment_id = $1`,
            [assignmentId],
          );

          const findings: ConflictFinding[] = [];
          for (const subjectRow of subjects) {
            findings.push(
              ...(await detectConflicts(db, {
                subjectKind: subjectRow.kind as 'PERSON' | 'RESOURCE',
                subjectId: subjectRow.id,
                from: instantFrom(assignment.window_end),
                until: proposedUntil,
                aggregateKind: 'PLANNED_ASSIGNMENT',
                // RGT-01: the assignment being extended is excluded from its own comparison.
                aggregateId: assignmentId,
              })),
            );
          }

          const blocking = findings.filter((f) => f.verdict === 'BLOCK');
          const warning = findings.filter((f) => f.verdict === 'WARN');

          return {
            blocks: blocking.map((f) => ({
              ruleId: f.ruleId,
              precedence: 'P5' as const,
              reason: f.reason,
              instead:
                'Liberar el recurso en ese tramo, extender menos días, o reprogramar el trabajo ' +
                'incumbente con una directiva.',
              subject,
              overrideable: false,
            })),
            warnings: warning.map((f) => ({
              ruleId: f.ruleId,
              precedence: 'P5' as const,
              reason: f.reason,
              subject,
            })),
            ...(blocking.length === 0
              ? {
                  effects: [
                    {
                      kind: 'REQUEST_EXTENSION',
                      description: 'Registrar el pedido de más días como hecho, sin tocar la versión aprobada.',
                      ruleId: 'RUL-020',
                    },
                  ],
                }
              : {}),
            rulesApplied: [
              {
                ruleId: 'RUL-027',
                precedence: 'P5' as const,
                outcome: 'WON' as const,
                note:
                  `${findings.length} solapamiento(s) evaluados sobre la ventana propuesta, ` +
                  'excluyendo la propia asignación por id estable (PL-093).',
              },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, decision, correlationId }) {
    const assignmentId = requireId(subjectId, 'AsignacionPlanificada');
    const assignment = await loadAssignment(db, assignmentId);

    // Record any non-blocking overlaps so a planner can see them when resolving.
    const { rows: subjects } = await db.query<{ kind: string; id: Uuid }>(
      `SELECT 'PERSON' AS kind, person_id AS id FROM planning.planned_person_assignments
       WHERE planned_assignment_id = $1
       UNION ALL
       SELECT 'RESOURCE' AS kind, resource_id AS id FROM planning.planned_resource_assignments
       WHERE planned_assignment_id = $1`,
      [assignmentId],
    );
    const proposedUntil = instantFrom(
      new Date(assignment.window_end.getTime() + payload.additionalDays * 86_400_000),
    );
    for (const subjectRow of subjects) {
      const findings = await detectConflicts(db, {
        subjectKind: subjectRow.kind as 'PERSON' | 'RESOURCE',
        subjectId: subjectRow.id,
        from: instantFrom(assignment.window_end),
        until: proposedUntil,
        aggregateKind: 'PLANNED_ASSIGNMENT',
        aggregateId: assignmentId,
      });
      await recordConflicts(db, findings, decision.decisionId);
    }

    // The request is a PLANNING fact about the assignment, not an execution event: it may be raised
    // before any Parte exists, and execution.operational_events requires a part_id. It never touches
    // the approved window — RGT-03 and the immutability trigger both forbid that, and the planner
    // resolves it by creating a new version.
    const requestId = uuidv7();
    const linkedPart = await db.one<{ part_id: Uuid }>(
      `SELECT part_id FROM planning.plan_execution_links
       WHERE planned_assignment_id = $1 AND part_id IS NOT NULL LIMIT 1`,
      [assignmentId],
    );

    await db.query(
      `INSERT INTO planning.extension_requests
         (id, planned_assignment_id, part_id, state, additional_days, reason,
          approved_window_end, proposed_window_end, requested_by, requested_at, decision_trace_id)
       VALUES ($1, $2, $3, 'PENDIENTE', $4, $5, $6, $7, $8, $9, $10)`,
      [
        requestId,
        assignmentId,
        linkedPart?.part_id ?? null,
        payload.additionalDays,
        payload.reason,
        assignment.window_end,
        proposedUntil,
        actor.identityId,
        occurredAt,
        decision.decisionId,
      ],
    );

    // When the request did come from a Parte, the field-side fact is recorded there too, so the
    // crew's own timeline shows what they asked for.
    if (linkedPart?.part_id) {
      await db.query(
        `INSERT INTO execution.operational_events
           (id, part_id, event_type, reason_code, description, occurred_at, recorded_by, detail)
         VALUES ($1, $2, 'SCOPE_CHANGE', 'EXTENSION_REQUESTED', $3, $4, $5, $6)`,
        [
          uuidv7(),
          linkedPart.part_id,
          `Pedido de ${payload.additionalDays} día(s) más: ${payload.reason}`,
          occurredAt,
          actor.identityId,
          JSON.stringify({ assignmentId, extensionRequestId: requestId }),
        ],
      );
    }

    return {
      subject: { kind: 'AsignacionPlanificada', id: assignmentId },
      version: assignment.version,
      effects: [
        {
          kind: 'EXTENSION_REQUESTED',
          subjectKind: 'AsignacionPlanificada',
          subjectId: assignmentId,
          detail: {
            extensionRequestId: requestId,
            additionalDays: payload.additionalDays,
            approvedWindowEnd: assignment.window_end.toISOString(),
            proposedWindowEnd: proposedUntil,
          },
          outboxEvent: {
            type: 'planning.extension.requested',
            payload: { assignmentId, additionalDays: payload.additionalDays, correlationId },
          },
        },
      ],
    };
  },
};

/* --------------------------------------- planning.assignments.resolve-extension */

const resolveExtension: CommandHandler<ResolveExtensionInput> = {
  name: 'planning.assignments.resolve-extension',

  async resolveScope({ db, subjectId }) {
    const assignment = await loadAssignment(db, requireId(subjectId, 'AsignacionPlanificada'));
    return {
      subject: {
        kind: 'AsignacionPlanificada',
        id: assignment.id,
        ...(assignment.code ? { code: assignment.code } : {}),
      },
      scope: { baseId: assignment.base_id, contractId: assignment.contract_id },
      currentVersion: assignment.version,
      currentState: assignment.state,
    };
  },

  async evaluators({ db, subjectId, currentState }) {
    const assignmentId = requireId(subjectId, 'AsignacionPlanificada');
    const subject = { kind: 'AsignacionPlanificada', id: assignmentId };
    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: ASSIGNMENT_TERMINAL,
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'planning/resolve-extension',
        evaluate: () => ({
          effects: [
            {
              kind: 'RESOLVE_EXTENSION',
              description:
                'Resolver el pedido creando una versión nueva. La versión aprobada anterior queda ' +
                'intacta y legible.',
              ruleId: 'RUL-020',
            },
          ],
        }),
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const assignmentId = requireId(subjectId, 'AsignacionPlanificada');
    const assignment = await loadAssignment(db, assignmentId);

    const request = await db.one<{
      id: Uuid;
      additional_days: number;
      proposed_window_end: Date;
      part_id: Uuid | null;
    }>(
      `SELECT id, additional_days, proposed_window_end, part_id
       FROM planning.extension_requests
       WHERE planned_assignment_id = $1 AND state = 'PENDIENTE'`,
      [assignmentId],
    );
    if (!request) {
      throw new DomainError({
        code: 'NOT_FOUND',
        message: 'No hay un pedido de extensión pendiente para esta asignación.',
      });
    }

    if (payload.decision === 'RECHAZAR') {
      await db.query(
        `UPDATE planning.extension_requests
         SET state = 'RECHAZADA', resolved_by = $2, resolved_at = $3, resolution_note = $4
         WHERE id = $1`,
        [request.id, actor.identityId, occurredAt, payload.note ?? null],
      );
      if (request.part_id) {
        await db.query(
          `INSERT INTO execution.operational_events
             (id, part_id, event_type, reason_code, description, occurred_at, recorded_by)
           VALUES ($1, $2, 'SCOPE_CHANGE', 'EXTENSION_REJECTED', $3, $4, $5)`,
          [
            uuidv7(),
            request.part_id,
            `Extensión rechazada${payload.note ? `: ${payload.note}` : ''}`,
            occurredAt,
            actor.identityId,
          ],
        );
      }
      return {
        subject: { kind: 'AsignacionPlanificada', id: assignmentId },
        version: assignment.version,
        effects: [
          {
            kind: 'EXTENSION_REJECTED',
            subjectKind: 'AsignacionPlanificada',
            subjectId: assignmentId,
            detail: { note: payload.note ?? null },
          },
        ],
      };
    }

    // RGT-03 in positive form: approving an extension creates a NEW version with the longer window.
    // The previous version keeps its original window, so plan-vs-real still compares against what was
    // actually approved at the time.
    const newVersionId = uuidv7();
    const nextVersionNo = await db.one<{ next: number }>(
      'SELECT coalesce(max(version_no), 0) + 1 AS next FROM planning.plan_versions WHERE plan_id = $1',
      [assignment.plan_id],
    );

    // Born BORRADOR, not APROBADA: plan_versions_one_approved allows exactly one approved version
    // per plan, so the hand-over is ordered — create, supersede the incumbent, then approve. At no
    // point do two versions both claim to be the plan execution is compared against.
    await db.query(
      `INSERT INTO planning.plan_versions (id, plan_id, version_no, state)
       VALUES ($1, $2, $3, 'BORRADOR')`,
      [newVersionId, assignment.plan_id, nextVersionNo!.next],
    );

    // A new assignment row under the new version, carrying the extended window. The original row is
    // marked SUPERSEDIDA and keeps its approved window verbatim.
    const newAssignmentId = uuidv7();
    await db.query(
      `INSERT INTO planning.planned_assignments
         (id, plan_version_id, code, state, window_start, window_end, operational_date, priority,
          expected_part_type_id, crew_id, resource_id, requires_work_permit, dispatched_at)
       SELECT $1, $2, code, state, window_start, $3::timestamptz, operational_date, priority,
              expected_part_type_id, crew_id, resource_id, requires_work_permit, dispatched_at
       FROM planning.planned_assignments WHERE id = $4`,
      [newAssignmentId, newVersionId, request.proposed_window_end, assignmentId],
    );

    // Now the incumbent steps down — the only mutation the trigger allows on an approved version —
    // and the successor takes its place.
    await db.query(
      `UPDATE planning.plan_versions
       SET state = 'SUPERSEDIDA', superseded_at = $2, superseded_by_id = $3
       WHERE id = $1 AND state = 'APROBADA'`,
      [assignment.plan_version_id, occurredAt, newVersionId],
    );
    await db.query(
      `UPDATE planning.plan_versions
       SET state = 'APROBADA', approved_at = $2, approved_by = $3
       WHERE id = $1`,
      [newVersionId, occurredAt, actor.identityId],
    );

    await db.query(
      `UPDATE planning.extension_requests
       SET state = 'APROBADA', resolved_by = $2, resolved_at = $3, resolution_note = $4,
           resulting_assignment_id = $5
       WHERE id = $1`,
      [request.id, actor.identityId, occurredAt, payload.note ?? null, newAssignmentId],
    );

    await db.query(
      `UPDATE planning.planned_assignments
       SET state = 'SUPERSEDIDA', superseded_at = $2, version = version + 1 WHERE id = $1`,
      [assignmentId, occurredAt],
    );

    return {
      subject: { kind: 'AsignacionPlanificada', id: newAssignmentId },
      effects: [
        {
          kind: 'EXTENSION_APPROVED',
          subjectKind: 'AsignacionPlanificada',
          subjectId: newAssignmentId,
          detail: {
            supersededAssignmentId: assignmentId,
            newPlanVersionId: newVersionId,
            previousWindowEnd: assignment.window_end.toISOString(),
            newWindowEnd: request.proposed_window_end.toISOString(),
          },
          outboxEvent: {
            type: 'planning.extension.approved',
            payload: { assignmentId: newAssignmentId, supersedes: assignmentId, correlationId },
          },
        },
      ],
    };
  },
};

/* ---------------------------------------- planning.assignments.mark-not-performed */

const markNotPerformed: CommandHandler<MarkNotPerformedInput> = {
  name: 'planning.assignments.mark-not-performed',

  async resolveScope({ db, subjectId }) {
    const assignment = await loadAssignment(db, requireId(subjectId, 'AsignacionPlanificada'));
    return {
      subject: {
        kind: 'AsignacionPlanificada',
        id: assignment.id,
        ...(assignment.code ? { code: assignment.code } : {}),
      },
      scope: { baseId: assignment.base_id, contractId: assignment.contract_id },
      currentVersion: assignment.version,
      currentState: assignment.state,
    };
  },

  async evaluators({ db, subjectId, currentState }) {
    const assignmentId = requireId(subjectId, 'AsignacionPlanificada');
    const subject = { kind: 'AsignacionPlanificada', id: assignmentId };
    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: ASSIGNMENT_TERMINAL,
      }),
      stateTransition({
        machine: 'AsignacionPlanificada',
        event: 'CERRAR_NO_REALIZADA',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          {
            kind: 'MARK_NOT_PERFORMED',
            description: 'Preservar el desvío previsto vs real con su causa.',
            ruleId: 'RUL-019',
          },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, payload, occurredAt, correlationId }) {
    const assignmentId = requireId(subjectId, 'AsignacionPlanificada');
    const assignment = await loadAssignment(db, assignmentId);
    await db.query(
      `UPDATE planning.planned_assignments
       SET state = 'NO_REALIZADA', not_performed_at = $2, not_performed_reason = $3,
           version = version + 1
       WHERE id = $1`,
      [assignmentId, occurredAt, payload.reason],
    );
    return {
      subject: { kind: 'AsignacionPlanificada', id: assignmentId },
      version: assignment.version + 1,
      effects: [
        {
          kind: 'NOT_PERFORMED',
          subjectKind: 'AsignacionPlanificada',
          subjectId: assignmentId,
          detail: { reason: payload.reason },
          outboxEvent: {
            type: 'planning.assignment.not-performed',
            payload: { assignmentId, reason: payload.reason, correlationId },
          },
        },
      ],
    };
  },
};

/* ---------------------------------------------- planning.assignments.nominate */

const nominate: CommandHandler<NominateInput> = {
  name: 'planning.assignments.nominate',

  async resolveScope({ db, subjectId }) {
    const assignment = await loadAssignment(db, requireId(subjectId, 'AsignacionPlanificada'));
    return {
      subject: {
        kind: 'AsignacionPlanificada',
        id: assignment.id,
        ...(assignment.code ? { code: assignment.code } : {}),
      },
      scope: { baseId: assignment.base_id, contractId: assignment.contract_id },
      currentVersion: assignment.version,
      currentState: assignment.state,
    };
  },

  async evaluators({ db, subjectId, payload, currentState }) {
    const assignmentId = requireId(subjectId, 'AsignacionPlanificada');
    const subject = { kind: 'AsignacionPlanificada', id: assignmentId };
    const assignment = await loadAssignment(db, assignmentId);

    return [
      historyInvariants({
        db,
        subject,
        ...(currentState ? { currentState } : {}),
        terminalStates: ASSIGNMENT_TERMINAL,
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'planning/nominate',
        // RUL-012 is a HARD_GATE on eligibility; overlap is RUL-027 and decided by configuration.
        evaluate: async () => {
          const findings: ConflictFinding[] = [];
          for (const personId of payload.personIds ?? []) {
            findings.push(
              ...(await detectConflicts(db, {
                subjectKind: 'PERSON',
                subjectId: personId,
                from: instantFrom(assignment.window_start),
                until: instantFrom(assignment.window_end),
                aggregateKind: 'PLANNED_ASSIGNMENT',
                aggregateId: assignmentId,
              })),
            );
          }
          for (const resourceId of payload.resourceIds ?? []) {
            findings.push(
              ...(await detectConflicts(db, {
                subjectKind: 'RESOURCE',
                subjectId: resourceId,
                from: instantFrom(assignment.window_start),
                until: instantFrom(assignment.window_end),
                aggregateKind: 'PLANNED_ASSIGNMENT',
                aggregateId: assignmentId,
              })),
            );
          }

          const blocking = findings.filter((f) => f.verdict === 'BLOCK');
          return {
            blocks: blocking.map((f) => ({
              ruleId: f.ruleId,
              precedence: 'P5' as const,
              reason: f.reason,
              instead: 'Elegir otro sujeto, o reprogramar el trabajo incumbente.',
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
                      kind: 'NOMINATE',
                      description: 'Registrar la nominación prevista.',
                      ruleId: 'RUL-012',
                    },
                  ],
                }
              : {}),
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, correlationId }) {
    const assignmentId = requireId(subjectId, 'AsignacionPlanificada');
    const assignment = await loadAssignment(db, assignmentId);

    for (const personId of payload.personIds ?? []) {
      await db.query(
        `INSERT INTO planning.planned_person_assignments
           (id, planned_assignment_id, person_id, role, planned_from, planned_until)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv7(),
          assignmentId,
          personId,
          payload.role ?? 'OPERARIO',
          assignment.window_start,
          assignment.window_end,
        ],
      );
    }
    for (const resourceId of payload.resourceIds ?? []) {
      await db.query(
        `INSERT INTO planning.planned_resource_assignments
           (id, planned_assignment_id, resource_id, role, planned_from, planned_until)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv7(),
          assignmentId,
          resourceId,
          payload.role ?? 'PRINCIPAL',
          assignment.window_start,
          assignment.window_end,
        ],
      );
    }

    return {
      subject: { kind: 'AsignacionPlanificada', id: assignmentId },
      version: assignment.version,
      effects: [
        {
          kind: 'NOMINATED',
          subjectKind: 'AsignacionPlanificada',
          subjectId: assignmentId,
          detail: {
            people: (payload.personIds ?? []).length,
            resources: (payload.resourceIds ?? []).length,
          },
          outboxEvent: {
            // Nominating changes a readiness dependency, so the existing evaluation must be
            // revisited (RUL-015).
            type: 'planning.assignment.nominated',
            payload: { assignmentId, correlationId },
          },
        },
      ],
    };
  },
};

function requireId(subjectId: string | null, what: string): Uuid {
  if (subjectId === null) {
    throw new Error(`${what} is addressed by its route path, but no subject id was supplied.`);
  }
  return subjectId as Uuid;
}

export function registerPlanningCommands(): void {
  registerHandler(approveVersion);
  registerHandler(evaluateReadiness);
  registerHandler(dispatch);
  registerHandler(requestExtension);
  registerHandler(resolveExtension);
  registerHandler(markNotPerformed);
  registerHandler(nominate);
}

// Keep the unused import from being dropped by a future refactor: addDays documents that the
// extension arithmetic is day-based and belongs to the kernel, not to ad-hoc millisecond maths.
void addDays;
