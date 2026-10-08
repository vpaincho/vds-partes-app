/**
 * Review VDS.
 *
 * 05/11: this dimension is explicitly a proposal — not in the frozen state machines — because it
 * reviews a VERSION and never touches the Parte's own state. `review.decisions` therefore has no
 * `MachineKey`: its few legal moves are guarded directly, the same shape actions and notifications
 * use in habilita-respond.ts.
 *
 * Three things this module keeps separate, per C-033/RGT-04:
 *
 *  - **Accepting a review is not certifying commercially.** Whether review acceptance gates
 *    commercial eligibility is configuration, never an implicit coupling (CC-06) — nothing here
 *    touches `commercial.*`.
 *  - **An observation routes by kind.** Only `OPERATIONAL_ERROR` can produce an amendment request;
 *    a `COMMERCIAL_DISPUTE` belongs to commercial.*, and review raises it there, not here.
 *  - **Review requests a correction; execution decides it.** `review.amendment_requests` is filled
 *    in by a REAL `EnmiendaOperativa` created through `execution.amendments.create` (W3) — this
 *    module only records the link, never the correction itself.
 */
import { DomainError, uuidv7, type Uuid } from '@vds/kernel';
import type {
  AcceptReviewInput,
  CreateReviewDecisionInput,
  ObserveReviewInput,
  RequestAmendmentInput,
  ResolveAmendmentRequestInput,
} from '@vds/contracts';
import { registerHandler, type CommandHandler } from '../platform/pipeline.ts';
import type { Db } from '../platform/db.ts';
import { requireSubjectId } from './execution-shared.ts';

interface DecisionRow {
  id: Uuid;
  state: string;
  version: number;
}

async function loadDecision(db: Db, decisionId: string): Promise<DecisionRow> {
  const row = await db.one<DecisionRow>(
    'SELECT id, state::text AS state, version FROM review.decisions WHERE id = $1',
    [decisionId],
  );
  if (!row) throw new DomainError({ code: 'NOT_FOUND', message: `No existe la DecisionRevision ${decisionId}.` });
  return row;
}

/* ------------------------------------------------------------- review.decisions.create */

const createDecision: CommandHandler<CreateReviewDecisionInput> = {
  name: 'review.decisions.create',

  async resolveScope({ payload }) {
    if (!payload.executionUnitVersionId && !payload.partId) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        message: 'La revision necesita una version de UE o un Parte: revisar nada no es una revision.',
      });
    }
    return { subject: { kind: 'DecisionRevision', id: null }, scope: {} };
  },

  async evaluators() {
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'review/create',
        evaluate: () => ({
          effects: [
            {
              kind: 'CREATE_REVIEW_DECISION',
              description: 'Abrir la revision sobre una version (11): nunca sobre el Parte directamente.',
              ruleId: 'R-050',
            },
          ],
        }),
      },
    ];
  },

  async apply({ db, payload }) {
    const id = uuidv7();
    await db.query(
      `INSERT INTO review.decisions (id, execution_unit_version_id, part_id, state)
       VALUES ($1, $2, $3, 'PENDIENTE_REVISION')`,
      [id, payload.executionUnitVersionId ?? null, payload.partId ?? null],
    );
    return {
      subject: { kind: 'DecisionRevision', id },
      version: 1,
      effects: [{ kind: 'REVIEW_DECISION_CREATED', subjectKind: 'DecisionRevision', subjectId: id }],
    };
  },
};

/* ------------------------------------------------------------- review.decisions.accept */

const acceptDecision: CommandHandler<AcceptReviewInput> = {
  name: 'review.decisions.accept',

  async resolveScope({ db, subjectId }) {
    const decision = await loadDecision(db, requireSubjectId(subjectId, 'DecisionRevision'));
    return { subject: { kind: 'DecisionRevision', id: decision.id }, scope: {}, currentVersion: decision.version, currentState: decision.state };
  },

  async evaluators({ subjectId, currentState }) {
    const decisionId = requireSubjectId(subjectId, 'DecisionRevision');
    const subject = { kind: 'DecisionRevision', id: decisionId };
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'review/accept',
        evaluate: () => {
          if (currentState !== 'PENDIENTE_REVISION' && currentState !== 'EN_REVISION') {
            return {
              blocks: [
                {
                  ruleId: 'R-050',
                  precedence: 'P5' as const,
                  reason: `La revision esta ${currentState ?? 'desconocida'}: no hay nada que aceptar desde ahi.`,
                  instead: 'Una revision ya decidida no se vuelve a decidir; abrir una nueva sobre la version siguiente.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          return {
            effects: [
              {
                kind: 'ACCEPT_REVIEW',
                description: 'Aceptar la revision. No certifica comercialmente ni altera el Parte (CC-06).',
                ruleId: 'R-050',
              },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt }) {
    const decisionId = requireSubjectId(subjectId, 'DecisionRevision');
    const decision = await loadDecision(db, decisionId);
    await db.query(
      `UPDATE review.decisions
       SET state = 'ACEPTADA', reviewer_id = $2, decided_at = $3, decision_note = $4,
           updated_at = $3, version = version + 1
       WHERE id = $1`,
      [decisionId, actor.identityId, occurredAt, payload.note ?? null],
    );
    return {
      subject: { kind: 'DecisionRevision', id: decisionId },
      version: decision.version + 1,
      effects: [{ kind: 'REVIEW_ACCEPTED', subjectKind: 'DecisionRevision', subjectId: decisionId }],
    };
  },
};

/* ------------------------------------------------------------ review.decisions.observe */

const observeDecision: CommandHandler<ObserveReviewInput> = {
  name: 'review.decisions.observe',

  async resolveScope({ db, subjectId }) {
    const decision = await loadDecision(db, requireSubjectId(subjectId, 'DecisionRevision'));
    return { subject: { kind: 'DecisionRevision', id: decision.id }, scope: {}, currentVersion: decision.version, currentState: decision.state };
  },

  async evaluators({ subjectId, currentState }) {
    const decisionId = requireSubjectId(subjectId, 'DecisionRevision');
    const subject = { kind: 'DecisionRevision', id: decisionId };
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'review/observe',
        evaluate: () => {
          if (currentState !== 'PENDIENTE_REVISION' && currentState !== 'EN_REVISION') {
            return {
              blocks: [
                {
                  ruleId: 'R-050',
                  precedence: 'P5' as const,
                  reason: `La revision esta ${currentState ?? 'desconocida'}: no hay nada que observar desde ahi.`,
                  instead: 'Abrir una revision nueva si hace falta observar una version distinta.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          return {
            effects: [
              {
                kind: 'OBSERVE_REVIEW',
                description: 'Registrar la observacion tipada sin editar la realidad (RGT-04).',
                ruleId: 'R-050',
              },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt }) {
    const decisionId = requireSubjectId(subjectId, 'DecisionRevision');
    const decision = await loadDecision(db, decisionId);
    await db.query(
      `UPDATE review.decisions SET state = 'OBSERVADA', reviewer_id = $2, decided_at = $3,
              updated_at = $3, version = version + 1
       WHERE id = $1`,
      [decisionId, actor.identityId, occurredAt],
    );
    const observationId = uuidv7();
    await db.query(
      `INSERT INTO review.observations
         (id, review_decision_id, observation_kind, subject_path, description, raised_by, raised_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        observationId,
        decisionId,
        payload.observationKind,
        payload.subjectPath ?? null,
        payload.description,
        actor.identityId,
        occurredAt,
      ],
    );
    return {
      subject: { kind: 'DecisionRevision', id: decisionId },
      version: decision.version + 1,
      effects: [
        {
          kind: 'REVIEW_OBSERVED',
          subjectKind: 'DecisionRevision',
          subjectId: decisionId,
          detail: { observationId, observationKind: payload.observationKind },
        },
      ],
    };
  },
};

/* ------------------------------------------------------- review.amendment-requests.create */

const createAmendmentRequest: CommandHandler<RequestAmendmentInput> = {
  name: 'review.amendment-requests.create',

  async resolveScope({ payload }) {
    if (!payload.executionUnitId && !payload.partId) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        message: 'La solicitud de enmienda necesita una UE o un Parte objetivo.',
      });
    }
    return { subject: { kind: 'SolicitudEnmienda', id: null }, scope: {} };
  },

  async evaluators({ db, payload }) {
    const subject = { kind: 'SolicitudEnmienda', id: null };
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'review/amendment-request',
        evaluate: async () => {
          if (payload.observationId) {
            const observation = await db.one<{ observation_kind: string }>(
              'SELECT observation_kind FROM review.observations WHERE id = $1',
              [payload.observationId],
            );
            if (!observation) {
              return {
                blocks: [
                  {
                    ruleId: 'R-050',
                    precedence: 'P5' as const,
                    reason: `La observacion ${payload.observationId} no existe.`,
                    instead: 'Verificar el identificador de la observacion.',
                    subject,
                    overrideable: false,
                  },
                ],
              };
            }
            if (observation.observation_kind !== 'OPERATIONAL_ERROR') {
              return {
                blocks: [
                  {
                    ruleId: 'R-050',
                    precedence: 'P5' as const,
                    reason: `La observacion es ${observation.observation_kind}, no OPERATIONAL_ERROR.`,
                    instead:
                      'Una enmienda corrige un error operativo. COMMERCIAL_DISPUTE va a un ' +
                      'AjusteCertificacion, no a una EnmiendaOperativa.',
                    subject,
                    overrideable: false,
                  },
                ],
              };
            }
          }
          return {
            effects: [
              {
                kind: 'CREATE_AMENDMENT_REQUEST',
                description: 'Pedir la correccion; la decide execution.amendments, nunca review (RGT-04).',
                ruleId: 'R-050',
              },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, payload, actor, occurredAt }) {
    const id = uuidv7();
    await db.query(
      `INSERT INTO review.amendment_requests
         (id, review_decision_id, observation_id, execution_unit_id, part_id, requested_change,
          justification, requested_by, requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        payload.observationId
          ? (
              await db.one<{ review_decision_id: Uuid }>(
                'SELECT review_decision_id FROM review.observations WHERE id = $1',
                [payload.observationId],
              )
            )?.review_decision_id ?? null
          : null,
        payload.observationId ?? null,
        payload.executionUnitId ?? null,
        payload.partId ?? null,
        payload.requestedChange,
        payload.justification,
        actor.identityId,
        occurredAt,
      ],
    );
    return {
      subject: { kind: 'SolicitudEnmienda', id },
      version: 1,
      effects: [{ kind: 'AMENDMENT_REQUESTED', subjectKind: 'SolicitudEnmienda', subjectId: id }],
    };
  },
};

/* ------------------------------------------------------ review.amendment-requests.resolve */

const resolveAmendmentRequest: CommandHandler<ResolveAmendmentRequestInput> = {
  name: 'review.amendment-requests.resolve',

  async resolveScope({ db, subjectId }) {
    const requestId = requireSubjectId(subjectId, 'SolicitudEnmienda');
    const row = await db.one<{ id: Uuid; status: string }>(
      'SELECT id, status FROM review.amendment_requests WHERE id = $1',
      [requestId],
    );
    if (!row) throw new DomainError({ code: 'NOT_FOUND', message: `No existe la SolicitudEnmienda ${requestId}.` });
    return { subject: { kind: 'SolicitudEnmienda', id: row.id }, scope: {}, currentState: row.status };
  },

  async evaluators({ db, subjectId, payload, currentState }) {
    const requestId = requireSubjectId(subjectId, 'SolicitudEnmienda');
    const subject = { kind: 'SolicitudEnmienda', id: requestId };
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'review/amendment-request-resolve',
        evaluate: async () => {
          if (currentState === 'RESUELTA') {
            return {
              blocks: [
                {
                  ruleId: 'R-050',
                  precedence: 'P5' as const,
                  reason: 'La solicitud ya esta RESUELTA.',
                  instead: 'Una solicitud resuelta no se vuelve a resolver.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          const amendment = await db.one<{ approved_at: Date | null }>(
            'SELECT approved_at FROM execution.operational_amendments WHERE id = $1',
            [payload.amendmentId],
          );
          if (!amendment) {
            return {
              blocks: [
                {
                  ruleId: 'R-050',
                  precedence: 'P5' as const,
                  reason: `La EnmiendaOperativa ${payload.amendmentId} no existe.`,
                  instead: 'Verificar el identificador de la enmienda.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          if (!amendment.approved_at) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-073',
                  precedence: 'P5' as const,
                  reason: 'La EnmiendaOperativa todavia no fue aprobada.',
                  instead: 'Esperar la aprobacion (execution.amendments.approve) antes de cerrar la solicitud.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          return {
            effects: [
              {
                kind: 'RESOLVE_AMENDMENT_REQUEST',
                description: 'Vincular la solicitud con la enmienda que efectivamente la resolvio.',
                ruleId: 'R-050',
              },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, occurredAt }) {
    const requestId = requireSubjectId(subjectId, 'SolicitudEnmienda');
    await db.query(
      `UPDATE review.amendment_requests
       SET status = 'RESUELTA', amendment_id = $2, resolved_at = $3
       WHERE id = $1`,
      [requestId, payload.amendmentId, occurredAt],
    );
    return {
      subject: { kind: 'SolicitudEnmienda', id: requestId },
      version: 1,
      effects: [{ kind: 'AMENDMENT_REQUEST_RESOLVED', subjectKind: 'SolicitudEnmienda', subjectId: requestId }],
    };
  },
};

export function registerReviewCommands(): void {
  registerHandler(createDecision);
  registerHandler(acceptDecision);
  registerHandler(observeDecision);
  registerHandler(createAmendmentRequest);
  registerHandler(resolveAmendmentRequest);
}
