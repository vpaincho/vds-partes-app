/**
 * Habilita Respond & Learn: triage, classification, cases, corrective actions, notifications.
 *
 * C-025/GS-033 still holds here: an EventoHabilita is not a TipoParte, and nothing in this module
 * gives it one. What this module adds is the rest of SM-EH/SM-CH past the Flash Report in
 * habilita.ts:
 *
 *  - **The initial report never changes.** Triage and classification are new rows/versions
 *    (RUL-048/049) — `habilita.events` itself only ever moves its `state` and points at the
 *    current classification.
 *  - **At most one Caso per Evento** (R-057), opened only when escalation says so; closing
 *    without a case still needs a classification first (TPR-019).
 *  - **A case's investigation can finish while its actions stay open** (T-CH03/GS-035) — actions
 *    and notifications are followed up on their own, and a case cannot reach CERRADO while a
 *    blocking action is unverified or a notification obligation is unresolved (RUL-053/TPR-024).
 *    That gate is enforced twice on purpose: here, with a reason an operator can read, and again
 *    by `habilita.assert_case_closure_gates()` at commit — the backstop for whichever path got
 *    here without going through this command.
 *  - **A corrective action and a notification obligation have no state machine entry of their own**
 *    (`AccionCorrectivaHabilita` is a parallel dimension, not a `MachineKey`) — their few legal
 *    moves are guarded here directly, the same shape `execution.allocations.resolve` uses.
 *  - **A TEST notification channel never resolves the obligation** (RGT-16): sending through a
 *    fixture is a recorded attempt, not evidence that the obligation was met.
 */
import { DomainError, uuidv7, type Uuid } from '@vds/kernel';
import type {
  ClassifyEventInput,
  CloseCaseInput,
  CloseEventWithoutCaseInput,
  CreateActionInput,
  CreateNotificationInput,
  DiscardEventInput,
  EscalateToCaseInput,
  FinishInvestigationInput,
  ImplementActionInput,
  ResolveNotificationInput,
  StartInvestigationInput,
  StartTriageInput,
  VerifyActionInput,
} from '@vds/contracts';
import { registerHandler, type CommandHandler } from '../platform/pipeline.ts';
import type { Db } from '../platform/db.ts';
import { stateTransition } from './evaluators.ts';
import { requireSubjectId } from './execution-shared.ts';

interface EventRow {
  id: Uuid;
  code: string | null;
  state: string;
  version: number;
}

async function loadEvent(db: Db, eventId: string): Promise<EventRow> {
  const row = await db.one<EventRow>(
    'SELECT id, code, state::text AS state, version FROM habilita.events WHERE id = $1',
    [eventId],
  );
  if (!row) throw new DomainError({ code: 'NOT_FOUND', message: `No existe el EventoHabilita ${eventId}.` });
  return row;
}

interface CaseRow {
  id: Uuid;
  code: string | null;
  state: string;
  event_id: Uuid;
  version: number;
}

async function loadCase(db: Db, caseId: string): Promise<CaseRow> {
  const row = await db.one<CaseRow>(
    'SELECT id, code, state::text AS state, event_id, version FROM habilita.cases WHERE id = $1',
    [caseId],
  );
  if (!row) throw new DomainError({ code: 'NOT_FOUND', message: `No existe el CasoHabilita ${caseId}.` });
  return row;
}

async function logCaseEvent(
  db: Db,
  input: {
    caseId: Uuid;
    eventType: string;
    fromState: string | null;
    toState: string;
    actorId: Uuid;
    reason?: string;
    occurredAt: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO habilita.case_events
       (id, case_id, event_type, from_state, to_state, actor_id, reason, occurred_at)
     VALUES ($1, $2, $3, $4::habilita.case_state, $5::habilita.case_state, $6, $7, $8)`,
    [
      uuidv7(),
      input.caseId,
      input.eventType,
      input.fromState,
      input.toState,
      input.actorId,
      input.reason ?? null,
      input.occurredAt,
    ],
  );
}

/* ---------------------------------------------------------- habilita.events.start-triage */

const startTriage: CommandHandler<StartTriageInput> = {
  name: 'habilita.events.start-triage',

  async resolveScope({ db, subjectId }) {
    const event = await loadEvent(db, requireSubjectId(subjectId, 'EventoHabilita'));
    return {
      subject: { kind: 'EventoHabilita', id: event.id, ...(event.code ? { code: event.code } : {}) },
      scope: {},
      currentVersion: event.version,
      currentState: event.state,
    };
  },

  async evaluators({ subjectId, currentState }) {
    const eventId = requireSubjectId(subjectId, 'EventoHabilita');
    return [
      stateTransition({
        machine: 'EventoHabilita',
        event: 'INICIAR_TRIAGE',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'EventoHabilita', id: eventId },
        effects: [
          { kind: 'START_TRIAGE', description: 'Pasar el evento a triage.', ruleId: 'RUL-047' },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, payload, occurredAt }) {
    const eventId = requireSubjectId(subjectId, 'EventoHabilita');
    const event = await loadEvent(db, eventId);
    await db.query(
      `UPDATE habilita.events SET state = 'EN_TRIAGE', detected_at = coalesce(detected_at, $2),
              updated_at = $2, version = version + 1
       WHERE id = $1`,
      [eventId, occurredAt],
    );
    void payload.assignedTo;
    return {
      subject: { kind: 'EventoHabilita', id: eventId },
      version: event.version + 1,
      effects: [{ kind: 'TRIAGE_STARTED', subjectKind: 'EventoHabilita', subjectId: eventId }],
    };
  },
};

/* ------------------------------------------------------------- habilita.events.classify */

const classifyEvent: CommandHandler<ClassifyEventInput> = {
  name: 'habilita.events.classify',

  async resolveScope({ db, subjectId }) {
    const event = await loadEvent(db, requireSubjectId(subjectId, 'EventoHabilita'));
    return {
      subject: { kind: 'EventoHabilita', id: event.id, ...(event.code ? { code: event.code } : {}) },
      scope: {},
      currentVersion: event.version,
      currentState: event.state,
    };
  },

  async evaluators({ subjectId, currentState }) {
    const eventId = requireSubjectId(subjectId, 'EventoHabilita');
    return [
      stateTransition({
        machine: 'EventoHabilita',
        event: 'CLASIFICAR',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'EventoHabilita', id: eventId },
        effects: [
          {
            kind: 'CLASSIFY_EVENT',
            description: 'Escribir una clasificación versionada; el reporte original no se toca (RUL-049).',
            ruleId: 'RUL-049',
          },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt }) {
    const eventId = requireSubjectId(subjectId, 'EventoHabilita');
    const event = await loadEvent(db, eventId);

    // Insert the new version first: `events.current_classification_id` points at it, and the row
    // it points at has to exist before that pointer is written.
    const classificationId = uuidv7();
    await db.query(
      `INSERT INTO habilita.event_classifications
         (id, event_id, version_no,
          category, severity, event_type_code, classified_by, classified_at, justification)
       VALUES ($1, $2,
               (SELECT coalesce(max(version_no), 0) + 1 FROM habilita.event_classifications
                WHERE event_id = $2),
               $3, $4, $5, $6, $7, $8)`,
      [
        classificationId,
        eventId,
        payload.category,
        payload.severity ?? null,
        payload.eventTypeCode ?? null,
        actor.identityId,
        occurredAt,
        payload.justification ?? null,
      ],
    );

    await db.query(
      `UPDATE habilita.events
       SET state = 'CLASIFICADO', current_classification_id = $2, updated_at = $3, version = version + 1
       WHERE id = $1`,
      [eventId, classificationId, occurredAt],
    );

    return {
      subject: { kind: 'EventoHabilita', id: eventId },
      version: event.version + 1,
      effects: [
        {
          kind: 'EVENT_CLASSIFIED',
          subjectKind: 'EventoHabilita',
          subjectId: eventId,
          detail: { classificationId, category: payload.category, severity: payload.severity ?? null },
        },
      ],
    };
  },
};

/* ------------------------------------------------------ habilita.events.escalate-to-case */

const escalateToCase: CommandHandler<EscalateToCaseInput> = {
  name: 'habilita.events.escalate-to-case',

  async resolveScope({ db, subjectId }) {
    const event = await loadEvent(db, requireSubjectId(subjectId, 'EventoHabilita'));
    return {
      subject: { kind: 'EventoHabilita', id: event.id, ...(event.code ? { code: event.code } : {}) },
      scope: {},
      currentVersion: event.version,
      currentState: event.state,
    };
  },

  async evaluators({ subjectId, currentState }) {
    const eventId = requireSubjectId(subjectId, 'EventoHabilita');
    return [
      stateTransition({
        machine: 'EventoHabilita',
        event: 'EVALUAR_ESCALAMIENTO_ABRE_CASO',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'EventoHabilita', id: eventId },
        effects: [
          {
            kind: 'ESCALATE_TO_CASE',
            description: 'Abrir el único CasoHabilita del evento (R-057).',
            ruleId: 'RUL-050',
          },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt, decision }) {
    const eventId = requireSubjectId(subjectId, 'EventoHabilita');
    const event = await loadEvent(db, eventId);

    const classification = await db.one<{ category: string; severity: string | null }>(
      'SELECT category, severity FROM habilita.event_classifications WHERE id = (SELECT current_classification_id FROM habilita.events WHERE id = $1)',
      [eventId],
    );

    const evaluationId = uuidv7();
    await db.query(
      `INSERT INTO habilita.escalation_evaluations
         (id, event_id, inputs, required_outputs, requires_case, evaluated_at, decision_trace_id)
       VALUES ($1, $2, $3, '["CASO"]'::jsonb, true, $4, $5)`,
      [
        evaluationId,
        eventId,
        JSON.stringify({ classification, justification: payload.justification }),
        occurredAt,
        decision.decisionId,
      ],
    );

    const caseId = uuidv7();
    const caseCode = `CH-${caseId.slice(0, 8)}`;
    await db.query(
      `INSERT INTO habilita.cases (id, event_id, code, state, owner_id, opened_at)
       VALUES ($1, $2, $3, 'ABIERTO', $4, $5)`,
      [caseId, eventId, caseCode, payload.ownerId, occurredAt],
    );
    await logCaseEvent(db, {
      caseId,
      eventType: 'ABRIR_CASO',
      fromState: null,
      toState: 'ABIERTO',
      actorId: actor.identityId,
      reason: payload.justification,
      occurredAt,
    });

    await db.query(
      `UPDATE habilita.events SET state = 'ESCALADO_A_CASO', updated_at = $2, version = version + 1
       WHERE id = $1`,
      [eventId, occurredAt],
    );

    return {
      subject: { kind: 'EventoHabilita', id: eventId },
      version: event.version + 1,
      effects: [
        {
          kind: 'CASE_OPENED',
          subjectKind: 'CasoHabilita',
          subjectId: caseId,
          detail: { code: caseCode, eventId, evaluationId },
          outboxEvent: { type: 'habilita.case.opened', payload: { caseId, eventId } },
        },
      ],
    };
  },
};

/* ------------------------------------------------- habilita.events.close-without-case */

const closeEventWithoutCase: CommandHandler<CloseEventWithoutCaseInput> = {
  name: 'habilita.events.close-without-case',

  async resolveScope({ db, subjectId }) {
    const event = await loadEvent(db, requireSubjectId(subjectId, 'EventoHabilita'));
    return {
      subject: { kind: 'EventoHabilita', id: event.id, ...(event.code ? { code: event.code } : {}) },
      scope: {},
      currentVersion: event.version,
      currentState: event.state,
    };
  },

  async evaluators({ subjectId, currentState }) {
    const eventId = requireSubjectId(subjectId, 'EventoHabilita');
    return [
      // TPR-019: the transition table only has CLASIFICADO -> CERRADO_SIN_CASO, so an event with
      // no classification yet is refused here with "no such transition" rather than silently
      // allowed through.
      stateTransition({
        machine: 'EventoHabilita',
        event: 'CERRAR_SIN_CASO',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'EventoHabilita', id: eventId },
        effects: [
          {
            kind: 'CLOSE_EVENT_WITHOUT_CASE',
            description: 'Cerrar sin seguimiento formal: la regla no lo exige.',
            ruleId: 'RUL-050',
          },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, payload, occurredAt, decision }) {
    const eventId = requireSubjectId(subjectId, 'EventoHabilita');
    const event = await loadEvent(db, eventId);

    const classification = await db.one<{ category: string; severity: string | null }>(
      'SELECT category, severity FROM habilita.event_classifications WHERE id = (SELECT current_classification_id FROM habilita.events WHERE id = $1)',
      [eventId],
    );
    await db.query(
      `INSERT INTO habilita.escalation_evaluations
         (id, event_id, inputs, required_outputs, requires_case, evaluated_at, decision_trace_id)
       VALUES ($1, $2, $3, '[]'::jsonb, false, $4, $5)`,
      [
        uuidv7(),
        eventId,
        JSON.stringify({ classification, justification: payload.justification }),
        occurredAt,
        decision.decisionId,
      ],
    );

    await db.query(
      `UPDATE habilita.events
       SET state = 'CERRADO_SIN_CASO', closed_without_case_at = $2, updated_at = $2, version = version + 1
       WHERE id = $1`,
      [eventId, occurredAt],
    );

    return {
      subject: { kind: 'EventoHabilita', id: eventId },
      version: event.version + 1,
      effects: [{ kind: 'EVENT_CLOSED_WITHOUT_CASE', subjectKind: 'EventoHabilita', subjectId: eventId }],
    };
  },
};

/* ------------------------------------------------------------- habilita.events.discard */

const discardEvent: CommandHandler<DiscardEventInput> = {
  name: 'habilita.events.discard',

  async resolveScope({ db, subjectId }) {
    const event = await loadEvent(db, requireSubjectId(subjectId, 'EventoHabilita'));
    return {
      subject: { kind: 'EventoHabilita', id: event.id, ...(event.code ? { code: event.code } : {}) },
      scope: {},
      currentVersion: event.version,
      currentState: event.state,
    };
  },

  async evaluators({ db, subjectId, payload, currentState }) {
    const eventId = requireSubjectId(subjectId, 'EventoHabilita');
    const subject = { kind: 'EventoHabilita', id: eventId };
    return [
      stateTransition({
        machine: 'EventoHabilita',
        event: 'DESCARTAR_DUPLICADO_NO_EVENTO',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          {
            kind: 'DISCARD_EVENT',
            description: 'Duplicado o no-evento, con causa. Nunca se reutiliza (TPR-021).',
            ruleId: 'RUL-048',
          },
        ],
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'habilita/discard',
        evaluate: async () => {
          if (!payload.duplicateOfId) return {};
          const other = await db.one<{ id: Uuid }>('SELECT id FROM habilita.events WHERE id = $1', [
            payload.duplicateOfId,
          ]);
          if (!other) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-048',
                  precedence: 'P5' as const,
                  reason: `El evento referenciado como original ${payload.duplicateOfId} no existe.`,
                  instead: 'Verificar el identificador del evento original.',
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

  async apply({ db, subjectId, payload, occurredAt }) {
    const eventId = requireSubjectId(subjectId, 'EventoHabilita');
    const event = await loadEvent(db, eventId);
    await db.query(
      `UPDATE habilita.events
       SET state = 'DESCARTADO', discarded_at = $2, discarded_reason = $3, duplicate_of_id = $4,
           updated_at = $2, version = version + 1
       WHERE id = $1`,
      [eventId, occurredAt, payload.reason, payload.duplicateOfId ?? null],
    );
    return {
      subject: { kind: 'EventoHabilita', id: eventId },
      version: event.version + 1,
      effects: [{ kind: 'EVENT_DISCARDED', subjectKind: 'EventoHabilita', subjectId: eventId }],
    };
  },
};

/* ------------------------------------------------- habilita.cases.start-investigation */

const startInvestigation: CommandHandler<StartInvestigationInput> = {
  name: 'habilita.cases.start-investigation',

  async resolveScope({ db, subjectId }) {
    const kase = await loadCase(db, requireSubjectId(subjectId, 'CasoHabilita'));
    return {
      subject: { kind: 'CasoHabilita', id: kase.id, ...(kase.code ? { code: kase.code } : {}) },
      scope: {},
      currentVersion: kase.version,
      currentState: kase.state,
    };
  },

  async evaluators({ subjectId, currentState }) {
    const caseId = requireSubjectId(subjectId, 'CasoHabilita');
    return [
      stateTransition({
        machine: 'CasoHabilita',
        event: 'INICIAR_INVESTIGACION',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'CasoHabilita', id: caseId },
        effects: [
          { kind: 'START_INVESTIGATION', description: 'Abrir la investigación.', ruleId: 'RUL-050' },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt }) {
    const caseId = requireSubjectId(subjectId, 'CasoHabilita');
    const kase = await loadCase(db, caseId);
    await db.query(
      `UPDATE habilita.cases
       SET state = 'EN_INVESTIGACION', investigation_state = 'EN_CURSO',
           investigation_started_at = $2, updated_at = $2, version = version + 1
       WHERE id = $1`,
      [caseId, occurredAt],
    );
    await logCaseEvent(db, {
      caseId,
      eventType: 'INICIAR_INVESTIGACION',
      fromState: kase.state,
      toState: 'EN_INVESTIGACION',
      actorId: actor.identityId,
      ...(payload.scope ? { reason: payload.scope } : {}),
      occurredAt,
    });
    return {
      subject: { kind: 'CasoHabilita', id: caseId },
      version: kase.version + 1,
      effects: [{ kind: 'INVESTIGATION_STARTED', subjectKind: 'CasoHabilita', subjectId: caseId }],
    };
  },
};

/* ------------------------------------------------ habilita.cases.finish-investigation */

const finishInvestigation: CommandHandler<FinishInvestigationInput> = {
  name: 'habilita.cases.finish-investigation',

  async resolveScope({ db, subjectId }) {
    const kase = await loadCase(db, requireSubjectId(subjectId, 'CasoHabilita'));
    return {
      subject: { kind: 'CasoHabilita', id: kase.id, ...(kase.code ? { code: kase.code } : {}) },
      scope: {},
      currentVersion: kase.version,
      currentState: kase.state,
    };
  },

  async evaluators({ subjectId, currentState }) {
    const caseId = requireSubjectId(subjectId, 'CasoHabilita');
    return [
      stateTransition({
        machine: 'CasoHabilita',
        event: 'FINALIZAR_INVESTIGACION',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'CasoHabilita', id: caseId },
        effects: [
          {
            kind: 'FINISH_INVESTIGATION',
            description:
              'La investigación termina; las acciones pueden seguir abiertas (T-CH03, GS-035).',
            ruleId: 'RUL-050',
          },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt }) {
    const caseId = requireSubjectId(subjectId, 'CasoHabilita');
    const kase = await loadCase(db, caseId);
    await db.query(
      `UPDATE habilita.cases
       SET state = 'SEGUIMIENTO_ACCIONES', investigation_state = 'FINALIZADA',
           investigation_finished_at = $2, investigation_summary = $3, updated_at = $2,
           version = version + 1
       WHERE id = $1`,
      [caseId, occurredAt, payload.summary],
    );
    await logCaseEvent(db, {
      caseId,
      eventType: 'FINALIZAR_INVESTIGACION',
      fromState: kase.state,
      toState: 'SEGUIMIENTO_ACCIONES',
      actorId: actor.identityId,
      reason: payload.summary,
      occurredAt,
    });
    return {
      subject: { kind: 'CasoHabilita', id: caseId },
      version: kase.version + 1,
      effects: [{ kind: 'INVESTIGATION_FINISHED', subjectKind: 'CasoHabilita', subjectId: caseId }],
    };
  },
};

/* ---------------------------------------------------- habilita.cases.evaluate-closure */

const evaluateClosure: CommandHandler<Record<string, never>> = {
  name: 'habilita.cases.evaluate-closure',

  async resolveScope({ db, subjectId }) {
    const kase = await loadCase(db, requireSubjectId(subjectId, 'CasoHabilita'));
    return {
      subject: { kind: 'CasoHabilita', id: kase.id, ...(kase.code ? { code: kase.code } : {}) },
      scope: {},
      currentVersion: kase.version,
      currentState: kase.state,
    };
  },

  async evaluators({ db, subjectId, currentState }) {
    const caseId = requireSubjectId(subjectId, 'CasoHabilita');
    const subject = { kind: 'CasoHabilita', id: caseId };
    return [
      stateTransition({
        machine: 'CasoHabilita',
        event: 'EVALUAR_CIERRE_OK',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          {
            kind: 'EVALUATE_CLOSURE',
            description: 'Verificar que no quede una acción bloqueante ni una obligación abierta.',
            ruleId: 'RUL-053',
          },
        ],
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'habilita/case-closure',
        evaluate: async () => {
          const subject = { kind: 'CasoHabilita', id: caseId };
          const { rows: blockingActions } = await db.query<{ id: Uuid; description: string }>(
            `SELECT id, description FROM habilita.corrective_actions
             WHERE case_id = $1 AND is_blocking = true AND state NOT IN ('VERIFICADA', 'CANCELADA')`,
            [caseId],
          );
          const { rows: openNotifications } = await db.query<{ id: Uuid; obligation_code: string }>(
            `SELECT id, obligation_code FROM habilita.notifications
             WHERE case_id = $1 AND status IN ('PENDIENTE', 'EN_CURSO')`,
            [caseId],
          );
          if (blockingActions.length === 0 && openNotifications.length === 0) return {};
          // A real hard gate (RUL-053/TPR-024), counted so the operator sees exactly what is
          // outstanding rather than a single opaque refusal — but still a block: nothing here
          // resolves itself by closing, unlike an interval that closeUnit closes as part of closing.
          return {
            blocks: [
              ...blockingActions.map((a) => ({
                ruleId: 'RUL-053',
                precedence: 'P5' as const,
                reason: `Acción bloqueante sin verificar: ${a.description}`,
                instead: 'Implementar y verificar la acción, o cancelarla con causa.',
                subject,
                overrideable: false,
              })),
              ...openNotifications.map((n) => ({
                ruleId: 'RUL-053',
                precedence: 'P5' as const,
                reason: `Obligación sin resolver: ${n.obligation_code}`,
                instead: 'Resolver la obligación con evidencia (RGT-16: un envío de canal fixture no alcanza).',
                subject,
                overrideable: false,
              })),
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, actor, occurredAt }) {
    const caseId = requireSubjectId(subjectId, 'CasoHabilita');
    const kase = await loadCase(db, caseId);
    await db.query(
      `UPDATE habilita.cases
       SET state = 'LISTO_PARA_CIERRE', ready_for_closure_at = $2, updated_at = $2, version = version + 1
       WHERE id = $1`,
      [caseId, occurredAt],
    );
    await logCaseEvent(db, {
      caseId,
      eventType: 'EVALUAR_CIERRE_OK',
      fromState: kase.state,
      toState: 'LISTO_PARA_CIERRE',
      actorId: actor.identityId,
      occurredAt,
    });
    return {
      subject: { kind: 'CasoHabilita', id: caseId },
      version: kase.version + 1,
      effects: [{ kind: 'CASE_READY_FOR_CLOSURE', subjectKind: 'CasoHabilita', subjectId: caseId }],
    };
  },
};

/* ------------------------------------------------------------------ habilita.cases.close */

const closeCase: CommandHandler<CloseCaseInput> = {
  name: 'habilita.cases.close',

  async resolveScope({ db, subjectId }) {
    const kase = await loadCase(db, requireSubjectId(subjectId, 'CasoHabilita'));
    return {
      subject: { kind: 'CasoHabilita', id: kase.id, ...(kase.code ? { code: kase.code } : {}) },
      scope: {},
      currentVersion: kase.version,
      currentState: kase.state,
    };
  },

  async evaluators({ subjectId, currentState }) {
    const caseId = requireSubjectId(subjectId, 'CasoHabilita');
    return [
      // LISTO_PARA_CIERRE -> CERRADO is the only path (TPR-022/023 forbid any other origin).
      // habilita.assert_case_closure_gates() re-checks blocking actions/notifications at commit —
      // the backstop for a case that reached LISTO_PARA_CIERRE and then grew a new blocking action.
      stateTransition({
        machine: 'CasoHabilita',
        event: 'CERRAR',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'CasoHabilita', id: caseId },
        effects: [{ kind: 'CLOSE_CASE', description: 'Cerrar el caso.', ruleId: 'RUL-053' }],
      }),
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt }) {
    const caseId = requireSubjectId(subjectId, 'CasoHabilita');
    const kase = await loadCase(db, caseId);
    await db.query(
      `UPDATE habilita.cases
       SET state = 'CERRADO', closed_at = $2, closed_by = $3, updated_at = $2, version = version + 1
       WHERE id = $1`,
      [caseId, occurredAt, actor.identityId],
    );
    await logCaseEvent(db, {
      caseId,
      eventType: 'CERRAR',
      fromState: kase.state,
      toState: 'CERRADO',
      actorId: actor.identityId,
      ...(payload.note ? { reason: payload.note } : {}),
      occurredAt,
    });
    return {
      subject: { kind: 'CasoHabilita', id: caseId },
      version: kase.version + 1,
      effects: [{ kind: 'CASE_CLOSED', subjectKind: 'CasoHabilita', subjectId: caseId }],
    };
  },
};

/* ----------------------------------------------------------------- habilita.actions.* */
//
// AccionCorrectivaHabilita has no entry in the generated state machine (it is a parallel
// dimension, not a MachineKey): its few legal moves are guarded directly, the way
// execution.allocations.resolve guards an allocation with no machine of its own.

interface ActionRow {
  id: Uuid;
  state: string;
  case_id: Uuid;
  is_blocking: boolean;
  responsible_id: Uuid;
  version: number;
}

async function loadAction(db: Db, actionId: string): Promise<ActionRow> {
  const row = await db.one<ActionRow>(
    `SELECT id, state::text AS state, case_id, is_blocking, responsible_id, version
     FROM habilita.corrective_actions WHERE id = $1`,
    [actionId],
  );
  if (!row) {
    throw new DomainError({ code: 'NOT_FOUND', message: `No existe la AccionCorrectivaHabilita ${actionId}.` });
  }
  return row;
}

const createAction: CommandHandler<CreateActionInput> = {
  name: 'habilita.actions.create',

  async resolveScope({ db, payload }) {
    const kase = await loadCase(db, payload.caseId);
    return { subject: { kind: 'AccionCorrectivaHabilita', id: null }, scope: {}, currentState: kase.state };
  },

  async evaluators({ db, payload }) {
    const subject = { kind: 'AccionCorrectivaHabilita', id: null };
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'habilita/action-create',
        evaluate: async () => {
          const kase = await loadCase(db, payload.caseId);
          if (kase.state === 'CERRADO') {
            return {
              blocks: [
                {
                  ruleId: 'RUL-053',
                  precedence: 'P5' as const,
                  reason: 'El caso ya está CERRADO: una acción no se agrega sobre un caso cerrado.',
                  instead: 'Reabrir el caso por nueva evidencia, o crear un caso nuevo.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          return {
            effects: [
              {
                kind: 'CREATE_ACTION',
                description: 'Registrar la acción correctiva con responsable (R-060).',
                ruleId: 'RUL-053',
              },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, payload, occurredAt }) {
    const actionId = uuidv7();
    await db.query(
      `INSERT INTO habilita.corrective_actions
         (id, case_id, code, description, action_kind, is_blocking, responsible_id, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        actionId,
        payload.caseId,
        `AC-${actionId.slice(0, 8)}`,
        payload.description,
        payload.actionKind ?? null,
        payload.isBlocking,
        payload.responsibleId,
        payload.dueAt ?? null,
      ],
    );
    void occurredAt;
    return {
      subject: { kind: 'AccionCorrectivaHabilita', id: actionId },
      version: 1,
      effects: [
        {
          kind: 'ACTION_CREATED',
          subjectKind: 'AccionCorrectivaHabilita',
          subjectId: actionId,
          detail: { caseId: payload.caseId, isBlocking: payload.isBlocking },
        },
      ],
    };
  },
};

const implementAction: CommandHandler<ImplementActionInput> = {
  name: 'habilita.actions.implement',

  async resolveScope({ db, subjectId }) {
    const action = await loadAction(db, requireSubjectId(subjectId, 'AccionCorrectivaHabilita'));
    return {
      subject: { kind: 'AccionCorrectivaHabilita', id: action.id },
      scope: {},
      currentVersion: action.version,
      currentState: action.state,
    };
  },

  async evaluators({ subjectId, currentState }) {
    const actionId = requireSubjectId(subjectId, 'AccionCorrectivaHabilita');
    const subject = { kind: 'AccionCorrectivaHabilita', id: actionId };
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'habilita/action-implement',
        evaluate: () => {
          if (currentState !== 'PENDIENTE' && currentState !== 'EN_PROGRESO') {
            return {
              blocks: [
                {
                  ruleId: 'RUL-053',
                  precedence: 'P5' as const,
                  reason: `La acción está ${currentState}: no hay nada que implementar desde ahí.`,
                  instead: 'Una acción VERIFICADA o CANCELADA no vuelve a implementarse.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          return {
            effects: [
              { kind: 'IMPLEMENT_ACTION', description: 'Marcar la acción implementada.', ruleId: 'RUL-053' },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, occurredAt }) {
    const actionId = requireSubjectId(subjectId, 'AccionCorrectivaHabilita');
    const action = await loadAction(db, actionId);
    await db.query(
      `UPDATE habilita.corrective_actions
       SET state = 'IMPLEMENTADA', implemented_at = $2, updated_at = $2, version = version + 1
       WHERE id = $1`,
      [actionId, occurredAt],
    );
    return {
      subject: { kind: 'AccionCorrectivaHabilita', id: actionId },
      version: action.version + 1,
      effects: [{ kind: 'ACTION_IMPLEMENTED', subjectKind: 'AccionCorrectivaHabilita', subjectId: actionId }],
    };
  },
};

const verifyAction: CommandHandler<VerifyActionInput> = {
  name: 'habilita.actions.verify',

  async resolveScope({ db, subjectId }) {
    const action = await loadAction(db, requireSubjectId(subjectId, 'AccionCorrectivaHabilita'));
    return {
      subject: { kind: 'AccionCorrectivaHabilita', id: action.id },
      scope: {},
      currentVersion: action.version,
      currentState: action.state,
    };
  },

  async evaluators({ subjectId, currentState }) {
    const actionId = requireSubjectId(subjectId, 'AccionCorrectivaHabilita');
    const subject = { kind: 'AccionCorrectivaHabilita', id: actionId };
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'habilita/action-verify',
        evaluate: () => {
          if (currentState !== 'IMPLEMENTADA' && currentState !== 'EN_VERIFICACION') {
            return {
              blocks: [
                {
                  ruleId: 'RUL-053',
                  precedence: 'P5' as const,
                  reason: `La acción está ${currentState}: sólo se verifica una acción implementada.`,
                  instead: 'Implementar la acción antes de verificarla.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          return {
            effects: [
              {
                kind: 'VERIFY_ACTION',
                description: 'Marcar la acción verificada: queda disponible para el cierre del caso.',
                ruleId: 'RUL-053',
              },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, actor, occurredAt }) {
    const actionId = requireSubjectId(subjectId, 'AccionCorrectivaHabilita');
    const action = await loadAction(db, actionId);
    await db.query(
      `UPDATE habilita.corrective_actions
       SET state = 'VERIFICADA', verified_at = $2, verified_by = $3, updated_at = $2, version = version + 1
       WHERE id = $1`,
      [actionId, occurredAt, actor.identityId],
    );
    return {
      subject: { kind: 'AccionCorrectivaHabilita', id: actionId },
      version: action.version + 1,
      effects: [{ kind: 'ACTION_VERIFIED', subjectKind: 'AccionCorrectivaHabilita', subjectId: actionId }],
    };
  },
};

/* ------------------------------------------------------------- habilita.notifications.* */
//
// A notification is a tracked obligation (R-059), not a message send: it has no MachineKey either,
// and its status moves directly, the same way an action's does.

interface NotificationRow {
  id: Uuid;
  status: string;
}

async function loadNotification(db: Db, notificationId: string): Promise<NotificationRow> {
  const row = await db.one<NotificationRow>(
    'SELECT id, status FROM habilita.notifications WHERE id = $1',
    [notificationId],
  );
  if (!row) {
    throw new DomainError({ code: 'NOT_FOUND', message: `No existe la Notificacion ${notificationId}.` });
  }
  return row;
}

const createNotification: CommandHandler<CreateNotificationInput> = {
  name: 'habilita.notifications.create',

  async resolveScope({ payload }) {
    if (!payload.eventId && !payload.caseId) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        message: 'La notificación necesita un evento o un caso: una obligación sin alcance no es rastreable.',
      });
    }
    return { subject: { kind: 'Notificacion', id: null }, scope: {} };
  },

  async evaluators() {
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'habilita/notification-create',
        evaluate: () => ({
          effects: [
            {
              kind: 'CREATE_NOTIFICATION',
              description: 'Registrar la obligación con responsable y plazo (R-059).',
              ruleId: 'RUL-050',
            },
          ],
        }),
      },
    ];
  },

  async apply({ db, payload, occurredAt }) {
    const notificationId = uuidv7();
    await db.query(
      `INSERT INTO habilita.notifications
         (id, event_id, case_id, obligation_code, recipient_role, responsible_id, due_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDIENTE')`,
      [
        notificationId,
        payload.eventId ?? null,
        payload.caseId ?? null,
        payload.obligationCode,
        payload.recipientRole,
        payload.responsibleId ?? null,
        payload.dueAt ?? null,
      ],
    );
    void occurredAt;
    return {
      subject: { kind: 'Notificacion', id: notificationId },
      version: 1,
      effects: [
        {
          kind: 'NOTIFICATION_CREATED',
          subjectKind: 'Notificacion',
          subjectId: notificationId,
          detail: { obligationCode: payload.obligationCode },
        },
      ],
    };
  },
};

const resolveNotification: CommandHandler<ResolveNotificationInput> = {
  name: 'habilita.notifications.resolve',

  async resolveScope({ db, subjectId }) {
    const notification = await loadNotification(db, requireSubjectId(subjectId, 'Notificacion'));
    return {
      subject: { kind: 'Notificacion', id: notification.id },
      scope: {},
      currentState: notification.status,
    };
  },

  async evaluators({ subjectId, currentState }) {
    const notificationId = requireSubjectId(subjectId, 'Notificacion');
    const subject = { kind: 'Notificacion', id: notificationId };
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'habilita/notification-resolve',
        evaluate: () => {
          if (currentState === 'RESUELTA' || currentState === 'CANCELADA') {
            return {
              blocks: [
                {
                  ruleId: 'RGT-16',
                  precedence: 'P5' as const,
                  reason: `La obligación ya está ${currentState}.`,
                  instead: 'Una obligación resuelta o cancelada no se vuelve a resolver.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          return {
            effects: [
              {
                kind: 'RESOLVE_NOTIFICATION',
                description:
                  'Resolver con evidencia de la obligación cumplida. Un envío por canal fixture no ' +
                  'la descarga por sí solo (RGT-16).',
                ruleId: 'RGT-16',
              },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, occurredAt }) {
    const notificationId = requireSubjectId(subjectId, 'Notificacion');
    await db.query(
      `UPDATE habilita.notifications
       SET status = 'RESUELTA', resolved_at = $2, resolution_note = $3, evidence_id = $4
       WHERE id = $1`,
      [notificationId, occurredAt, payload.resolutionNote, payload.evidenceId ?? null],
    );
    return {
      subject: { kind: 'Notificacion', id: notificationId },
      version: 1,
      effects: [{ kind: 'NOTIFICATION_RESOLVED', subjectKind: 'Notificacion', subjectId: notificationId }],
    };
  },
};

export function registerHabilitaRespondCommands(): void {
  registerHandler(startTriage);
  registerHandler(classifyEvent);
  registerHandler(escalateToCase);
  registerHandler(closeEventWithoutCase);
  registerHandler(discardEvent);
  registerHandler(startInvestigation);
  registerHandler(finishInvestigation);
  registerHandler(evaluateClosure);
  registerHandler(closeCase);
  registerHandler(createAction);
  registerHandler(implementAction);
  registerHandler(verifyAction);
  registerHandler(createNotification);
  registerHandler(resolveNotification);
}
