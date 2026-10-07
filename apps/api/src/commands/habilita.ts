/**
 * Habilita Prevent: the work permit lifecycle.
 *
 * The prototype held a PTW as three fields inside the Parte (`p.ptw`, `e.permiso`) with no lifecycle
 * and no window, which is how PD-0394 passed: a signature entered at 11:25 looked like authorisation
 * for work from 07:20. SM-05 gives the permit nine states and this module implements the transitions
 * that matter most:
 *
 *  - **APROBADO is not VIGENTE** (RUL-043, T-PTW05). Activation is a separate authorised act with its
 *    own window, and only an activated permit covers work.
 *  - **Expiry is not closure** (C-021, RUL-045, TPR-013). A timeout blocks and alerts; closing an
 *    expired permit needs an authorised administrative closure, which this module refuses to do
 *    through the ordinary close command.
 *  - **Suspension withdraws cover without closing** (RUL-044).
 */
import { DomainError, uuidv7, type Instant, type Uuid } from '@vds/kernel';
import type {
  ActivatePermitInput,
  ApprovePermitInput,
  ClosePermitInput,
  CreatePermitInput,
  FlashReportInput,
  SuspendPermitInput,
} from '@vds/contracts';
import { registerHandler, type CommandHandler, type EffectRecord } from '../platform/pipeline.ts';
import type { Db } from '../platform/db.ts';
import { stateTransition } from './evaluators.ts';

interface PermitRow {
  id: Uuid;
  code: string | null;
  state: string;
  valid_from: Date | null;
  valid_until: Date | null;
  activated_at: Date | null;
  expired_at: Date | null;
  client_id: Uuid | null;
  version: number;
}

async function loadPermit(db: Db, permitId: string): Promise<PermitRow> {
  const row = await db.one<PermitRow>(
    `SELECT id, code, state::text AS state, valid_from, valid_until, activated_at, expired_at,
            client_id, version
     FROM habilita.work_permits WHERE id = $1`,
    [permitId],
  );
  if (!row) {
    throw new DomainError({ code: 'NOT_FOUND', message: `No existe el permiso ${permitId}.` });
  }
  return row;
}

const requireId = (subjectId: string | null, what: string): Uuid => {
  if (subjectId === null) {
    throw new Error(`${what} is addressed by its route path, but no subject id was supplied.`);
  }
  return subjectId as Uuid;
};

async function logPermitEvent(
  db: Db,
  input: {
    permitId: Uuid;
    eventType: string;
    fromState: string | null;
    toState: string;
    actorId: Uuid;
    reason?: string;
    decisionTraceId?: string;
    occurredAt: Instant;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO habilita.work_permit_events
       (id, work_permit_id, event_type, from_state, to_state, actor_id, reason,
        decision_trace_id, occurred_at)
     VALUES ($1, $2, $3, $4::habilita.permit_state, $5::habilita.permit_state, $6, $7, $8, $9)`,
    [
      uuidv7(),
      input.permitId,
      input.eventType,
      input.fromState,
      input.toState,
      input.actorId,
      input.reason ?? null,
      input.decisionTraceId ?? null,
      input.occurredAt,
    ],
  );
}

/* ---------------------------------------------------- habilita.permits.create */

const createPermit: CommandHandler<CreatePermitInput> = {
  name: 'habilita.permits.create',

  async resolveScope({ payload }) {
    return {
      subject: { kind: 'PermisoTrabajo', id: null },
      scope: { ...(payload.clientId ? { contractId: null } : {}) },
    };
  },

  async evaluators() {
    return [
      {
        stage: 'S4_TRANSITION',
        precedence: 'P2',
        owner: 'habilita/permit',
        evaluate: () => ({
          effects: [
            {
              kind: 'CREATE_PERMIT',
              description: 'Crear el PTW en BORRADOR. Es una autorización independiente del Parte.',
              ruleId: 'RUL-042',
            },
          ],
        }),
      },
    ];
  },

  async apply({ db, payload, actor, occurredAt, correlationId }) {
    const permitId = uuidv7();
    const code = `PT-${permitId.slice(0, 8)}`;
    await db.query(
      `INSERT INTO habilita.work_permits
         (id, code, permit_type, state, technical_location_id, client_id, scope_description,
          requested_by)
       VALUES ($1, $2, $3, 'BORRADOR', $4, $5, $6, $7)`,
      [
        permitId,
        code,
        payload.permitType,
        payload.technicalLocationId ?? null,
        payload.clientId ?? null,
        payload.scopeDescription,
        actor.identityId,
      ],
    );

    // C-020: coverage is N:M. A permit may cover several UE and a UE may need several permits.
    for (const unitId of payload.executionUnitIds ?? []) {
      await db.query(
        `INSERT INTO habilita.work_permit_execution_units (id, work_permit_id, execution_unit_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [uuidv7(), permitId, unitId],
      );
    }

    await logPermitEvent(db, {
      permitId,
      eventType: 'CREAR',
      fromState: null,
      toState: 'BORRADOR',
      actorId: actor.identityId,
      occurredAt,
    });

    return {
      subject: { kind: 'PermisoTrabajo', id: permitId, code },
      version: 1,
      effects: [
        {
          kind: 'PERMIT_CREATED',
          subjectKind: 'PermisoTrabajo',
          subjectId: permitId,
          detail: { code, coveredUnits: (payload.executionUnitIds ?? []).length },
          outboxEvent: {
            type: 'habilita.permit.created',
            payload: { permitId, code, correlationId },
          },
        },
      ],
    };
  },
};

/* ---------------------------------------------------- habilita.permits.submit */

const submitPermit: CommandHandler<Record<string, never>> = {
  name: 'habilita.permits.submit',

  async resolveScope({ db, subjectId }) {
    const permit = await loadPermit(db, requireId(subjectId, 'PermisoTrabajo'));
    return {
      subject: { kind: 'PermisoTrabajo', id: permit.id, ...(permit.code ? { code: permit.code } : {}) },
      scope: {},
      currentVersion: permit.version,
      currentState: permit.state,
    };
  },

  async evaluators({ db, subjectId, currentState }) {
    const permitId = requireId(subjectId, 'PermisoTrabajo');
    const subject = { kind: 'PermisoTrabajo', id: permitId };
    return [
      stateTransition({
        machine: 'PermisoTrabajo',
        event: 'ENVIAR_APROBACION',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          { kind: 'SUBMIT_PERMIT', description: 'Solicitar aprobación.', ruleId: 'RUL-042' },
        ],
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'habilita/permit',
        evaluate: async () => {
          // T-PTW02 requires the minimum checks to be present. Missing ones are reported as
          // missing, not as blocks: completing them is part of submitting.
          const pending = await db.one<{ count: string }>(
            `SELECT count(*)::text AS count FROM habilita.work_permit_checks
             WHERE work_permit_id = $1 AND is_required = true AND result IS NULL`,
            [permitId],
          );
          const count = Number(pending?.count ?? '0');
          return count > 0
            ? {
                missing: [
                  {
                    what: `${count} control(es) obligatorio(s) sin resultado`,
                    reason:
                      'IH-14: son verificaciones físicas que completa quien está en el lugar, no ' +
                      'datos derivables.',
                  },
                ],
              }
            : {};
        },
      },
    ];
  },

  async apply({ db, subjectId, actor, occurredAt }) {
    const permitId = requireId(subjectId, 'PermisoTrabajo');
    const permit = await loadPermit(db, permitId);
    await db.query(
      `UPDATE habilita.work_permits SET state = 'PENDIENTE_APROBACION', version = version + 1
       WHERE id = $1`,
      [permitId],
    );
    await logPermitEvent(db, {
      permitId,
      eventType: 'ENVIAR_APROBACION',
      fromState: permit.state,
      toState: 'PENDIENTE_APROBACION',
      actorId: actor.identityId,
      occurredAt,
    });
    return {
      subject: { kind: 'PermisoTrabajo', id: permitId },
      version: permit.version + 1,
      effects: [
        { kind: 'PERMIT_SUBMITTED', subjectKind: 'PermisoTrabajo', subjectId: permitId },
      ],
    };
  },
};

/* --------------------------------------------------- habilita.permits.approve */

const approvePermit: CommandHandler<ApprovePermitInput> = {
  name: 'habilita.permits.approve',

  async resolveScope({ db, subjectId }) {
    const permit = await loadPermit(db, requireId(subjectId, 'PermisoTrabajo'));
    return {
      subject: { kind: 'PermisoTrabajo', id: permit.id, ...(permit.code ? { code: permit.code } : {}) },
      scope: {},
      currentVersion: permit.version,
      currentState: permit.state,
    };
  },

  async evaluators({ subjectId, currentState }) {
    const permitId = requireId(subjectId, 'PermisoTrabajo');
    return [
      stateTransition({
        machine: 'PermisoTrabajo',
        event: 'APROBAR',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'PermisoTrabajo', id: permitId },
        effects: [
          {
            kind: 'APPROVE_PERMIT',
            // The distinction PD-0394 turns on, stated in the effect itself.
            description:
              'Aprobar el permiso. NO lo vuelve vigente: activar es un acto aparte con su ventana ' +
              '(RUL-043).',
            ruleId: 'RUL-043',
          },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const permitId = requireId(subjectId, 'PermisoTrabajo');
    const permit = await loadPermit(db, permitId);
    await db.query(
      `UPDATE habilita.work_permits
       SET state = 'APROBADO', approved_by = $2, approved_at = $3, external_authority = $4,
           version = version + 1
       WHERE id = $1`,
      [permitId, actor.identityId, occurredAt, payload.externalAuthority ?? null],
    );
    await logPermitEvent(db, {
      permitId,
      eventType: 'APROBAR',
      fromState: permit.state,
      toState: 'APROBADO',
      actorId: actor.identityId,
      ...(payload.note ? { reason: payload.note } : {}),
      occurredAt,
    });
    return {
      subject: { kind: 'PermisoTrabajo', id: permitId },
      version: permit.version + 1,
      effects: [
        {
          kind: 'PERMIT_APPROVED',
          subjectKind: 'PermisoTrabajo',
          subjectId: permitId,
          detail: { approvedAt: occurredAt, note: 'Aprobado no es vigente' },
          outboxEvent: {
            type: 'habilita.permit.approved',
            payload: { permitId, correlationId },
          },
        },
      ],
    };
  },
};

/* -------------------------------------------------- habilita.permits.activate */

const activatePermit: CommandHandler<ActivatePermitInput> = {
  name: 'habilita.permits.activate',

  async resolveScope({ db, subjectId }) {
    const permit = await loadPermit(db, requireId(subjectId, 'PermisoTrabajo'));
    return {
      subject: { kind: 'PermisoTrabajo', id: permit.id, ...(permit.code ? { code: permit.code } : {}) },
      scope: {},
      currentVersion: permit.version,
      currentState: permit.state,
    };
  },

  async evaluators({ db, subjectId, payload, envelope, currentState }) {
    const permitId = requireId(subjectId, 'PermisoTrabajo');
    const subject = { kind: 'PermisoTrabajo', id: permitId };
    const at = envelope.occurredAt as Instant;

    return [
      stateTransition({
        machine: 'PermisoTrabajo',
        event: 'ACTIVAR',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          {
            kind: 'ACTIVATE_PERMIT',
            description: 'Poner el permiso VIGENTE con su ventana real.',
            ruleId: 'RUL-043',
          },
        ],
      }),
      {
        stage: 'S3_HABILITA',
        precedence: 'P1',
        owner: 'habilita/permit',
        evaluate: async () => {
          const permit = await loadPermit(db, permitId);
          const blocks = [];

          // RUL-043 HARD_GATE: the real window and context must be valid. A permit cannot be
          // activated with a window that already ended.
          if (payload.validUntil && Date.parse(payload.validUntil) <= Date.parse(payload.validFrom)) {
            blocks.push({
              ruleId: 'RUL-043',
              precedence: 'P1' as const,
              reason: 'La ventana de vigencia termina antes de empezar.',
              instead: 'Corregir la ventana: el fin debe ser posterior al inicio.',
              subject,
              overrideable: false,
            });
          }

          // An already-expired permit cannot be activated: T-PTW09 makes VENCIDO terminal.
          if (permit.expired_at !== null) {
            blocks.push({
              ruleId: 'RUL-045',
              precedence: 'P1' as const,
              reason: `El permiso venció el ${permit.expired_at.toISOString()}.`,
              instead:
                'Emitir un permiso nuevo. Un permiso vencido no se reactiva ni se cierra por ' +
                'timeout: requiere cierre administrativo autorizado (TPR-013).',
              subject,
              overrideable: false,
            });
          }

          // Activating retroactively is the PD-0394 trap in reverse: it would make an earlier
          // execution look authorised. The window may start now or later, never before.
          if (Date.parse(payload.validFrom) < Date.parse(at) - 60_000) {
            blocks.push({
              ruleId: 'RUL-043',
              precedence: 'P1' as const,
              reason:
                `Se pidió activar con vigencia desde ${payload.validFrom}, anterior al momento de ` +
                `la activación (${at}).`,
              instead:
                'Activar con vigencia desde ahora o desde un momento futuro. Un permiso activado ' +
                'después no autoriza una ejecución anterior (PD-0394).',
              subject,
              overrideable: false,
            });
          }

          return blocks.length > 0
            ? { blocks, rulesApplied: [{ ruleId: 'RUL-043', precedence: 'P1' as const, outcome: 'WON' as const }] }
            : { rulesApplied: [{ ruleId: 'RUL-043', precedence: 'P1' as const, outcome: 'WON' as const }] };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const permitId = requireId(subjectId, 'PermisoTrabajo');
    const permit = await loadPermit(db, permitId);
    await db.query(
      `UPDATE habilita.work_permits
       SET state = 'VIGENTE', activated_at = $2, valid_from = $3, valid_until = $4,
           external_authority = coalesce($5, external_authority), version = version + 1
       WHERE id = $1`,
      [
        permitId,
        occurredAt,
        payload.validFrom,
        payload.validUntil ?? null,
        payload.externalAuthority ?? null,
      ],
    );
    // Coverage rows inherit the window unless they were narrowed explicitly.
    await db.query(
      `UPDATE habilita.work_permit_execution_units
       SET covers_from = coalesce(covers_from, $2), covers_until = coalesce(covers_until, $3)
       WHERE work_permit_id = $1`,
      [permitId, payload.validFrom, payload.validUntil ?? null],
    );
    await logPermitEvent(db, {
      permitId,
      eventType: 'ACTIVAR',
      fromState: permit.state,
      toState: 'VIGENTE',
      actorId: actor.identityId,
      occurredAt,
    });
    return {
      subject: { kind: 'PermisoTrabajo', id: permitId },
      version: permit.version + 1,
      effects: [
        {
          kind: 'PERMIT_ACTIVATED',
          subjectKind: 'PermisoTrabajo',
          subjectId: permitId,
          detail: { validFrom: payload.validFrom, validUntil: payload.validUntil ?? null },
          outboxEvent: {
            type: 'habilita.permit.activated',
            payload: { permitId, validFrom: payload.validFrom, correlationId },
          },
        },
      ],
    };
  },
};

/* --------------------------------------------------- habilita.permits.suspend */

const suspendPermit: CommandHandler<SuspendPermitInput> = {
  name: 'habilita.permits.suspend',

  async resolveScope({ db, subjectId }) {
    const permit = await loadPermit(db, requireId(subjectId, 'PermisoTrabajo'));
    return {
      subject: { kind: 'PermisoTrabajo', id: permit.id, ...(permit.code ? { code: permit.code } : {}) },
      scope: {},
      currentVersion: permit.version,
      currentState: permit.state,
    };
  },

  async evaluators({ subjectId, currentState }) {
    const permitId = requireId(subjectId, 'PermisoTrabajo');
    return [
      stateTransition({
        machine: 'PermisoTrabajo',
        event: 'SUSPENDER',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'PermisoTrabajo', id: permitId },
        effects: [
          {
            kind: 'SUSPEND_PERMIT',
            description:
              'Retirar la cobertura y bloquear el trabajo cubierto. NO cierra el permiso (RUL-044).',
            ruleId: 'RUL-044',
          },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, correlationId }) {
    const permitId = requireId(subjectId, 'PermisoTrabajo');
    const permit = await loadPermit(db, permitId);
    await db.query(
      `UPDATE habilita.work_permits SET state = 'SUSPENDIDO', suspended_at = $2, version = version + 1
       WHERE id = $1`,
      [permitId, occurredAt],
    );
    await logPermitEvent(db, {
      permitId,
      eventType: 'SUSPENDER',
      fromState: permit.state,
      toState: 'SUSPENDIDO',
      actorId: actor.identityId,
      reason: payload.reason,
      occurredAt,
    });
    return {
      subject: { kind: 'PermisoTrabajo', id: permitId },
      version: permit.version + 1,
      effects: [
        {
          kind: 'PERMIT_SUSPENDED',
          subjectKind: 'PermisoTrabajo',
          subjectId: permitId,
          detail: { reason: payload.reason },
          outboxEvent: {
            // Work covered by this permit must stop; the control plane carries the order.
            type: 'habilita.permit.suspended',
            payload: { permitId, reason: payload.reason, correlationId },
          },
        },
      ],
    };
  },
};

/* ----------------------------------------------------- habilita.permits.close */

const closePermit: CommandHandler<ClosePermitInput> = {
  name: 'habilita.permits.close',

  async resolveScope({ db, subjectId }) {
    const permit = await loadPermit(db, requireId(subjectId, 'PermisoTrabajo'));
    return {
      subject: { kind: 'PermisoTrabajo', id: permit.id, ...(permit.code ? { code: permit.code } : {}) },
      scope: {},
      currentVersion: permit.version,
      currentState: permit.state,
    };
  },

  async evaluators({ db, subjectId, currentState }) {
    const permitId = requireId(subjectId, 'PermisoTrabajo');
    const subject = { kind: 'PermisoTrabajo', id: permitId };
    return [
      stateTransition({
        machine: 'PermisoTrabajo',
        event: 'CERRAR',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          { kind: 'CLOSE_PERMIT', description: 'Cerrar formalmente el permiso.', ruleId: 'RUL-046' },
        ],
      }),
      {
        stage: 'S3_HABILITA',
        precedence: 'P1',
        owner: 'habilita/permit',
        evaluate: async () => {
          const permit = await loadPermit(db, permitId);
          // TPR-013: VENCIDO → CERRADO is forbidden through the ordinary close. The state machine
          // already refuses it, and this makes the remedy explicit rather than leaving the operator
          // with "no such transition".
          if (permit.state === 'VENCIDO') {
            return {
              blocks: [
                {
                  ruleId: 'RUL-045',
                  precedence: 'P1' as const,
                  reason:
                    'El permiso está VENCIDO. Un timeout nunca equivale a un cierre: vencido y ' +
                    'cerrado son estados distintos (C-021).',
                  instead:
                    'Registrar un cierre administrativo autorizado conforme a la política ' +
                    '(EventoCierreAdministrativoPTW, hoja 51 fila 34).',
                  subject,
                  overrideable: false,
                },
              ],
              rulesApplied: [{ ruleId: 'RUL-045', precedence: 'P1' as const, outcome: 'WON' as const }],
            };
          }
          return {};
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt }) {
    const permitId = requireId(subjectId, 'PermisoTrabajo');
    const permit = await loadPermit(db, permitId);
    await db.query(
      `UPDATE habilita.work_permits SET state = 'CERRADO', closed_at = $2, version = version + 1
       WHERE id = $1`,
      [permitId, occurredAt],
    );
    await logPermitEvent(db, {
      permitId,
      eventType: 'CERRAR',
      fromState: permit.state,
      toState: 'CERRADO',
      actorId: actor.identityId,
      ...(payload.note ? { reason: payload.note } : {}),
      occurredAt,
    });
    return {
      subject: { kind: 'PermisoTrabajo', id: permitId },
      version: permit.version + 1,
      effects: [{ kind: 'PERMIT_CLOSED', subjectKind: 'PermisoTrabajo', subjectId: permitId }],
    };
  },
};

/* ------------------------------------------------ habilita.events.flash-report */

/**
 * Flash Report.
 *
 * CF-09 / RUL-047: the system derives the context and asks for the minimum. Severity, classification
 * and root cause are NOT asked of the reporter — triage adds them later, and the initial report stays
 * immutable (RUL-048/049).
 *
 * C-025 / GS-033: the event may be standalone, with no execution context at all.
 */
const flashReport: CommandHandler<FlashReportInput> = {
  name: 'habilita.events.flash-report',

  async resolveScope() {
    return { subject: { kind: 'EventoHabilita', id: null }, scope: {} };
  },

  async evaluators({ payload }) {
    const subject = { kind: 'EventoHabilita', id: null };
    return [
      {
        stage: 'S3_HABILITA',
        precedence: 'P1',
        owner: 'habilita/respond',
        evaluate: () => {
          const effects = [
            {
              kind: 'REPORT_EVENT',
              description: 'Preservar el reporte original tal como lo dio el reportante.',
              ruleId: 'RUL-047',
            },
          ];

          // RUL-051: an uncontrolled situation defaults conservatively to suspending the affected
          // work. The block is local and immediate; the Directiva is a separate object emitted as an
          // effect, because offline cannot receive a remote order (CC-07).
          if (!payload.situationControlled) {
            effects.push({
              kind: 'PROPOSE_SUSPENSION',
              description:
                'Situación no controlada: default conservador de suspender el trabajo afectado y ' +
                'escalar el triage. No se presenta como operación segura mientras la orden remota ' +
                'no llegó.',
              ruleId: 'RUL-051',
            });
          }

          return {
            effects,
            ...(payload.situationControlled
              ? {}
              : {
                  warnings: [
                    {
                      ruleId: 'RUL-051',
                      precedence: 'P1' as const,
                      reason:
                        'La situación se reportó como NO controlada. El trabajo afectado queda ' +
                        'suspendido por default hasta que Habilita evalúe.',
                      subject,
                    },
                  ],
                }),
            rulesApplied: [{ ruleId: 'RUL-047', precedence: 'P1' as const, outcome: 'WON' as const }],
          };
        },
      },
    ];
  },

  async apply({ db, payload, actor, occurredAt, recordedAt, correlationId }) {
    const eventId = uuidv7();
    const code = `EH-${eventId.slice(0, 8)}`;

    await db.query(
      `INSERT INTO habilita.events
         (id, code, state, initial_category, short_description, situation_controlled, reported_by,
          occurred_at, reported_at, technical_location_id, unmapped_location, latitude, longitude)
       VALUES ($1, $2, 'REPORTADO', $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL)`,
      [
        eventId,
        code,
        payload.initialCategory,
        payload.shortDescription,
        payload.situationControlled,
        actor.identityId,
        payload.occurredAt,
        recordedAt,
        payload.technicalLocationId ?? null,
        payload.unmappedLocation ?? null,
      ],
    );

    // C-026: one event links to N UE, people, resources and permits without changing its identity.
    for (const unitId of payload.executionUnitIds ?? []) {
      await db.query(
        `INSERT INTO habilita.event_execution_units (id, event_id, execution_unit_id, link_role)
         VALUES ($1, $2, $3, 'AFFECTED') ON CONFLICT DO NOTHING`,
        [uuidv7(), eventId, unitId],
      );
    }
    for (const personId of payload.personIds ?? []) {
      await db.query(
        `INSERT INTO habilita.event_people (id, event_id, person_id, link_role)
         VALUES ($1, $2, $3, 'INVOLVED') ON CONFLICT DO NOTHING`,
        [uuidv7(), eventId, personId],
      );
    }
    for (const resourceId of payload.resourceIds ?? []) {
      await db.query(
        `INSERT INTO habilita.event_resources (id, event_id, resource_id, link_role)
         VALUES ($1, $2, $3, 'INVOLVED') ON CONFLICT DO NOTHING`,
        [uuidv7(), eventId, resourceId],
      );
    }
    for (const evidenceId of payload.evidenceIds ?? []) {
      await db.query(
        `INSERT INTO evidence.evidence_links (id, evidence_id, target_kind, habilita_event_id)
         VALUES ($1, $2, 'HABILITA_EVENT', $3)`,
        [uuidv7(), evidenceId, eventId],
      );
    }

    const effects: EffectRecord[] = [
      {
        kind: 'EVENT_REPORTED',
        subjectKind: 'EventoHabilita',
        subjectId: eventId,
        detail: {
          code,
          standalone: (payload.executionUnitIds ?? []).length === 0,
          situationControlled: payload.situationControlled,
        },
        outboxEvent: {
          type: 'habilita.event.reported',
          payload: { eventId, code, situationControlled: payload.situationControlled, correlationId },
        },
      },
    ];

    // RUL-051: the conservative default is recorded as an operational event on each affected UE, so
    // the suspension is a fact rather than an assumption, even before a Directiva is applied.
    if (!payload.situationControlled) {
      for (const unitId of payload.executionUnitIds ?? []) {
        await db.query(
          `INSERT INTO execution.operational_events
             (id, part_id, execution_unit_id, event_type, reason_code, description, occurred_at,
              recorded_by, detail)
           SELECT $1, u.part_id, u.id, 'DEVIATION', 'HABILITA_UNCONTROLLED', $2, $3, $4, $5
           FROM execution.execution_units u WHERE u.id = $6`,
          [
            uuidv7(),
            `Evento Habilita no controlado ${code}: suspensión por default conservador (RUL-051).`,
            occurredAt,
            actor.identityId,
            JSON.stringify({ habilitaEventId: eventId }),
            unitId,
          ],
        );
      }
      effects.push({
        kind: 'SUSPENSION_PROPOSED',
        subjectKind: 'EventoHabilita',
        subjectId: eventId,
        detail: { affectedUnits: (payload.executionUnitIds ?? []).length },
        outboxEvent: {
          type: 'habilita.event.uncontrolled',
          payload: { eventId, units: payload.executionUnitIds ?? [], correlationId },
        },
      });
    }

    return { subject: { kind: 'EventoHabilita', id: eventId, code }, version: 1, effects };
  },
};

export function registerHabilitaCommands(): void {
  registerHandler(createPermit);
  registerHandler(submitPermit);
  registerHandler(approvePermit);
  registerHandler(activatePermit);
  registerHandler(suspendPermit);
  registerHandler(closePermit);
  registerHandler(flashReport);
}
