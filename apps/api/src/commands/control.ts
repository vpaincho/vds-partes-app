/**
 * Control Plane: directives.
 *
 * C-017 is the whole point of this module: emitted, received, acknowledged and applied are four
 * different states, and the prototype had none of them — a planner changed a job directly and the
 * history was a text line. Offline makes the distinction load-bearing: a change a planner made is
 * not a change a crew received, and neither is a change that took effect.
 *
 * What the handlers refuse:
 *  - marking a directive applied without traceable receipt and effect (TPR-016, also a DB check);
 *  - applying one that lost validity (RUL-058);
 *  - re-applying one already rejected (TPR-018).
 */
import { DomainError, uuidv7, type Instant, type Uuid } from '@vds/kernel';
import type { ApplyDirectiveInput, EmitDirectiveInput, RejectDirectiveInput } from '@vds/contracts';
import { registerHandler, type CommandHandler } from '../platform/pipeline.ts';
import type { Db } from '../platform/db.ts';
import { stateTransition } from './evaluators.ts';

interface DirectiveRow {
  id: Uuid;
  code: string | null;
  state: string;
  directive_type: string;
  valid_until: Date | null;
  received_at: Date | null;
  version: number;
}

async function loadDirective(db: Db, directiveId: string): Promise<DirectiveRow> {
  const row = await db.one<DirectiveRow>(
    `SELECT id, code, state::text AS state, directive_type::text AS directive_type,
            valid_until, received_at, version
     FROM control.directives WHERE id = $1`,
    [directiveId],
  );
  if (!row) {
    throw new DomainError({ code: 'NOT_FOUND', message: `No existe la directiva ${directiveId}.` });
  }
  return row;
}

const requireId = (subjectId: string | null, what: string): Uuid => {
  if (subjectId === null) {
    throw new Error(`${what} is addressed by its route path, but no subject id was supplied.`);
  }
  return subjectId as Uuid;
};

/* ------------------------------------------------------- control.directives.emit */

const emit: CommandHandler<EmitDirectiveInput> = {
  name: 'control.directives.emit',

  async resolveScope() {
    // A directive does not exist yet; scope is the actor's own, checked by assertAuthorised.
    return { subject: { kind: 'DirectivaOperativa', id: null }, scope: {} };
  },

  async evaluators({ db, payload }) {
    const subject = { kind: 'DirectivaOperativa', id: null };
    return [
      {
        stage: 'S4_TRANSITION',
        precedence: 'P2',
        owner: 'control/emit',
        evaluate: async () => {
          // Every target must exist. A directive aimed at nothing is not an instruction, and the
          // typed-target constraint would reject it at insert anyway — better to explain it here.
          const missing: string[] = [];
          for (const target of payload.targets) {
            const table = {
              PLANNED_ASSIGNMENT: 'planning.planned_assignments',
              PLANNED_UNIT: 'planning.planned_units',
              PLAN: 'planning.plans',
              PART: 'execution.parts',
              EXECUTION_UNIT: 'execution.execution_units',
              WORK_PERMIT: 'habilita.work_permits',
            }[target.targetKind];
            const found = await db.one(`SELECT 1 FROM ${table} WHERE id = $1`, [target.targetId]);
            if (!found) missing.push(`${target.targetKind} ${target.targetId}`);
          }

          if (missing.length > 0) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-054',
                  precedence: 'P2' as const,
                  reason: `Target inexistente: ${missing.join(', ')}.`,
                  instead: 'Emitir la directiva sobre un objetivo que exista.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }

          return {
            effects: [
              {
                kind: 'EMIT_DIRECTIVE',
                description:
                  'Publicar la instrucción como hecho nuevo. No muta el snapshot despachado (RUL-020).',
                ruleId: 'RUL-054',
              },
            ],
            rulesApplied: [{ ruleId: 'RUL-054', precedence: 'P2' as const, outcome: 'WON' as const }],
          };
        },
      },
    ];
  },

  async apply({ db, payload, actor, occurredAt, correlationId }) {
    const directiveId = uuidv7();
    await db.query(
      `INSERT INTO control.directives
         (id, code, directive_type, state, reason, issued_by, issued_at, valid_until)
       VALUES ($1, $2, $3::control.directive_type, 'EMITIDA', $4, $5, $6, $7)`,
      [
        directiveId,
        `DIR-${directiveId.slice(0, 8)}`,
        payload.directiveType,
        payload.reason,
        actor.identityId,
        occurredAt,
        payload.validUntil ?? null,
      ],
    );

    for (const target of payload.targets) {
      const column = {
        PLANNED_ASSIGNMENT: 'planned_assignment_id',
        PLANNED_UNIT: 'planned_unit_id',
        PLAN: 'plan_id',
        PART: 'part_id',
        EXECUTION_UNIT: 'execution_unit_id',
        WORK_PERMIT: 'work_permit_id',
      }[target.targetKind];
      await db.query(
        `INSERT INTO control.directive_targets (id, directive_id, target_kind, ${column})
         VALUES ($1, $2, $3, $4)`,
        [uuidv7(), directiveId, target.targetKind, target.targetId],
      );
    }

    await db.query(
      `INSERT INTO control.directive_events
         (id, directive_id, event_type, to_state, actor_id, occurred_at)
       VALUES ($1, $2, 'EMITIR', 'EMITIDA', $3, $4)`,
      [uuidv7(), directiveId, actor.identityId, occurredAt],
    );

    return {
      subject: { kind: 'DirectivaOperativa', id: directiveId, code: `DIR-${directiveId.slice(0, 8)}` },
      version: 1,
      effects: [
        {
          kind: 'DIRECTIVE_EMITTED',
          subjectKind: 'DirectivaOperativa',
          subjectId: directiveId,
          detail: { directiveType: payload.directiveType, targets: payload.targets.length },
          outboxEvent: {
            // Delivery is a separate concern: emission never promises receipt (C-017).
            type: 'control.directive.emitted',
            payload: { directiveId, directiveType: payload.directiveType, correlationId },
          },
        },
      ],
    };
  },
};

/* -------------------------------------------------------- control.directives.ack */

const ack: CommandHandler<Record<string, never>> = {
  name: 'control.directives.ack',

  async resolveScope({ db, subjectId }) {
    const directive = await loadDirective(db, requireId(subjectId, 'DirectivaOperativa'));
    return {
      subject: {
        kind: 'DirectivaOperativa',
        id: directive.id,
        ...(directive.code ? { code: directive.code } : {}),
      },
      scope: {},
      currentVersion: directive.version,
      currentState: directive.state,
    };
  },

  async evaluators({ db, subjectId, currentState }) {
    const directiveId = requireId(subjectId, 'DirectivaOperativa');
    const subject = { kind: 'DirectivaOperativa', id: directiveId };
    return [
      stateTransition({
        machine: 'DirectivaOperativa',
        event: 'ACK',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          {
            kind: 'ACK_DIRECTIVE',
            description: 'Registrar el ACK semántico. No significa aplicada (RUL-056).',
            ruleId: 'RUL-056',
          },
        ],
      }),
      {
        stage: 'S5_CONTROL_PLANE',
        precedence: 'P3',
        owner: 'control/ack',
        evaluate: async () => {
          // T-D03 runs from RECIBIDA. A directive that never reached the device cannot be
          // acknowledged by it, which is the distinction the prototype collapsed.
          const directive = await loadDirective(db, directiveId);
          if (directive.received_at === null) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-055',
                  precedence: 'P3' as const,
                  reason: 'La directiva no fue recibida todavía: no puede reconocerse.',
                  instead:
                    'Registrar primero la recepción técnica. Emitida, recibida y reconocida son ' +
                    'estados distintos (C-017).',
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

  async apply({ db, subjectId, actor, occurredAt }) {
    const directiveId = requireId(subjectId, 'DirectivaOperativa');
    const directive = await loadDirective(db, directiveId);
    await db.query(
      `UPDATE control.directives
       SET state = 'RECONOCIDA', acknowledged_at = $2, acknowledged_by = $3, version = version + 1
       WHERE id = $1`,
      [directiveId, occurredAt, actor.identityId],
    );
    await db.query(
      `INSERT INTO control.directive_events
         (id, directive_id, event_type, from_state, to_state, actor_id, occurred_at)
       VALUES ($1, $2, 'ACK', 'RECIBIDA', 'RECONOCIDA', $3, $4)`,
      [uuidv7(), directiveId, actor.identityId, occurredAt],
    );
    return {
      subject: { kind: 'DirectivaOperativa', id: directiveId },
      version: directive.version + 1,
      effects: [
        {
          kind: 'DIRECTIVE_ACKNOWLEDGED',
          subjectKind: 'DirectivaOperativa',
          subjectId: directiveId,
          detail: { acknowledgedAt: occurredAt },
        },
      ],
    };
  },
};

/* ------------------------------------------------------ control.directives.apply */

const apply: CommandHandler<ApplyDirectiveInput> = {
  name: 'control.directives.apply',

  async resolveScope({ db, subjectId }) {
    const directive = await loadDirective(db, requireId(subjectId, 'DirectivaOperativa'));
    return {
      subject: {
        kind: 'DirectivaOperativa',
        id: directive.id,
        ...(directive.code ? { code: directive.code } : {}),
      },
      scope: {},
      currentVersion: directive.version,
      currentState: directive.state,
    };
  },

  async evaluators({ db, subjectId, envelope, currentState }) {
    const directiveId = requireId(subjectId, 'DirectivaOperativa');
    const subject = { kind: 'DirectivaOperativa', id: directiveId };
    const at = envelope.occurredAt as Instant;

    return [
      stateTransition({
        machine: 'DirectivaOperativa',
        event: 'APLICAR',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [
          {
            kind: 'APPLY_DIRECTIVE',
            description: 'Registrar la aplicación con referencia al efecto (RUL-057).',
            ruleId: 'RUL-057',
          },
        ],
      }),
      {
        stage: 'S5_CONTROL_PLANE',
        precedence: 'P3',
        owner: 'control/apply',
        evaluate: async () => {
          const directive = await loadDirective(db, directiveId);

          // RUL-058: a directive that lost validity must never be applied. This is RGT-27's shape —
          // an expired order arriving late from an offline device.
          if (directive.valid_until !== null && Date.parse(at) >= directive.valid_until.getTime()) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-058',
                  precedence: 'P3' as const,
                  reason:
                    `La directiva perdió vigencia el ${directive.valid_until.toISOString()} y el ` +
                    `comando está fechado ${at}.`,
                  instead:
                    'Emitir una directiva nueva. Nunca aplicar una instrucción obsoleta: una orden ' +
                    'aplicada se compensa con otra, no se cancela retroactivamente.',
                  subject,
                  overrideable: false,
                },
              ],
              rulesApplied: [
                { ruleId: 'RUL-058', precedence: 'P3' as const, outcome: 'WON' as const },
              ],
            };
          }

          // TPR-016: receipt is a precondition for application, and the DB check enforces it too.
          if (directive.received_at === null) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-057',
                  precedence: 'P3' as const,
                  reason: 'No hay registro de recepción: no se puede marcar aplicada.',
                  instead:
                    'Registrar la recepción y el ACK. TPR-016 prohíbe EMITIDA → APLICADA sin ' +
                    'trazabilidad de recepción y efecto.',
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
    const directiveId = requireId(subjectId, 'DirectivaOperativa');
    const directive = await loadDirective(db, directiveId);

    await db.query(
      `UPDATE control.directives
       SET state = 'APLICADA', applied_at = $2, applied_effect_ref = $3, version = version + 1
       WHERE id = $1`,
      [directiveId, occurredAt, JSON.stringify(payload.effectRef)],
    );
    await db.query(
      `INSERT INTO control.directive_events
         (id, directive_id, event_type, from_state, to_state, actor_id, detail, occurred_at)
       VALUES ($1, $2, 'APLICAR', $3::control.directive_state, 'APLICADA', $4, $5, $6)`,
      [
        uuidv7(),
        directiveId,
        directive.state,
        actor.identityId,
        JSON.stringify(payload.effectRef),
        occurredAt,
      ],
    );

    return {
      subject: { kind: 'DirectivaOperativa', id: directiveId },
      version: directive.version + 1,
      effects: [
        {
          kind: 'DIRECTIVE_APPLIED',
          subjectKind: 'DirectivaOperativa',
          subjectId: directiveId,
          detail: { effectRef: payload.effectRef },
          outboxEvent: {
            type: 'control.directive.applied',
            payload: { directiveId, effectRef: payload.effectRef, correlationId },
          },
        },
      ],
    };
  },
};

/* ----------------------------------------------------- control.directives.reject */

const reject: CommandHandler<RejectDirectiveInput> = {
  name: 'control.directives.reject',

  async resolveScope({ db, subjectId }) {
    const directive = await loadDirective(db, requireId(subjectId, 'DirectivaOperativa'));
    return {
      subject: {
        kind: 'DirectivaOperativa',
        id: directive.id,
        ...(directive.code ? { code: directive.code } : {}),
      },
      scope: {},
      currentVersion: directive.version,
      currentState: directive.state,
    };
  },

  async evaluators({ subjectId, currentState }) {
    const directiveId = requireId(subjectId, 'DirectivaOperativa');
    return [
      stateTransition({
        machine: 'DirectivaOperativa',
        event: 'RECHAZAR',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'DirectivaOperativa', id: directiveId },
        effects: [
          {
            kind: 'REJECT_DIRECTIVE',
            description: 'Cerrar el lifecycle sin aplicación, con causa.',
            ruleId: 'RUL-057',
          },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt }) {
    const directiveId = requireId(subjectId, 'DirectivaOperativa');
    const directive = await loadDirective(db, directiveId);
    await db.query(
      `UPDATE control.directives
       SET state = 'RECHAZADA', rejected_at = $2, rejection_reason = $3, version = version + 1
       WHERE id = $1`,
      [directiveId, occurredAt, payload.reason],
    );
    await db.query(
      `INSERT INTO control.directive_events
         (id, directive_id, event_type, from_state, to_state, actor_id, occurred_at)
       VALUES ($1, $2, 'RECHAZAR', $3::control.directive_state, 'RECHAZADA', $4, $5)`,
      [uuidv7(), directiveId, directive.state, actor.identityId, occurredAt],
    );
    return {
      subject: { kind: 'DirectivaOperativa', id: directiveId },
      version: directive.version + 1,
      effects: [
        {
          kind: 'DIRECTIVE_REJECTED',
          subjectKind: 'DirectivaOperativa',
          subjectId: directiveId,
          detail: { reason: payload.reason },
        },
      ],
    };
  },
};

export function registerControlCommands(): void {
  registerHandler(emit);
  registerHandler(ack);
  registerHandler(apply);
  registerHandler(reject);
}
