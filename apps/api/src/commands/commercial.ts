/**
 * Commercial: deriving and deciding on a UnidadComercial.
 *
 * C-029/R-061/C-030: a UC's lineage is N:M from the moment it exists — one or more execution
 * sources, each keeping the EXACT execution_unit_version it used, never the mutable UE row. That is
 * what lets a later EnmiendaOperativa mark a derivation `REQUIERE_RECALCULO` (RUL-065) without
 * having to guess which version a UC actually consumed.
 *
 * `supersession_state` (VIGENTE/REQUIERE_RECALCULO/...) is a dimension PARALLEL to `state`
 * (INCOMPLETA/.../ACEPTADA) — C-034/SM-09. This module only ever touches `state`; nothing here sets
 * `supersession_state`, because that is RUL-065's job when an amendment is approved, not a side
 * effect of a commercial decision.
 */
import { DomainError, uuidv7, type Uuid } from '@vds/kernel';
import type {
  AcceptCommercialUnitInput,
  CompleteCommercialRequirementsInput,
  DeriveCommercialUnitInput,
  RejectCommercialUnitInput,
} from '@vds/contracts';
import { registerHandler, type CommandHandler } from '../platform/pipeline.ts';
import type { Db } from '../platform/db.ts';
import { stateTransition } from './evaluators.ts';
import { requireSubjectId } from './execution-shared.ts';

interface CommercialUnitRow {
  id: Uuid;
  state: string;
  version: number;
}

async function loadUnit(db: Db, unitId: string): Promise<CommercialUnitRow> {
  const row = await db.one<CommercialUnitRow>(
    'SELECT id, state::text AS state, version FROM commercial.commercial_units WHERE id = $1',
    [unitId],
  );
  if (!row) throw new DomainError({ code: 'NOT_FOUND', message: `No existe la UnidadComercial ${unitId}.` });
  return row;
}

/* --------------------------------------------------------------- commercial.units.derive */

const deriveUnit: CommandHandler<DeriveCommercialUnitInput> = {
  name: 'commercial.units.derive',

  async resolveScope() {
    return { subject: { kind: 'UnidadComercial', id: null }, scope: {} };
  },

  async evaluators({ db, payload }) {
    const subject = { kind: 'UnidadComercial', id: null };
    return [
      stateTransition({
        machine: 'UnidadComercial',
        event: 'GENERAR_UC',
        subject,
        effects: [
          {
            kind: 'DERIVE_COMMERCIAL_UNIT',
            description: 'Derivar la UC con su lineage N:M, conservando la version exacta de cada fuente.',
            ruleId: 'RUL-059',
          },
        ],
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'commercial/derive',
        evaluate: async () => {
          for (const source of payload.sources) {
            const version = await db.one<{ id: Uuid }>(
              'SELECT id FROM execution.execution_unit_versions WHERE id = $1',
              [source.executionUnitVersionId],
            );
            if (!version) {
              return {
                blocks: [
                  {
                    ruleId: 'C-030',
                    precedence: 'P5' as const,
                    reason: `La version de ejecucion ${source.executionUnitVersionId} no existe.`,
                    instead: 'Verificar el identificador de la version (execution_unit_versions.id, no el de la UE).',
                    subject,
                    overrideable: false,
                  },
                ],
              };
            }
            if (source.executionAllocationId) {
              const allocation = await db.one<{ contract_service_id: Uuid | null; status: string }>(
                'SELECT contract_service_id, status::text AS status FROM execution.execution_allocations WHERE id = $1',
                [source.executionAllocationId],
              );
              if (!allocation) {
                return {
                  blocks: [
                    {
                      ruleId: 'R-045',
                      precedence: 'P5' as const,
                      reason: `La imputacion ${source.executionAllocationId} no existe.`,
                      instead: 'Verificar el identificador de la imputacion.',
                      subject,
                      overrideable: false,
                    },
                  ],
                };
              }
              if (allocation.status !== 'RESUELTO' || allocation.contract_service_id !== payload.contractServiceId) {
                return {
                  blocks: [
                    {
                      ruleId: 'R-045',
                      precedence: 'P5' as const,
                      reason:
                        'La imputacion no esta RESUELTO para el mismo contractServiceId que se declara ' +
                        'para la UC.',
                      instead:
                        'Resolver la imputacion de la UE (execution.allocations.resolve) con el ' +
                        'contractServiceId correcto antes de derivar.',
                      subject,
                      overrideable: false,
                    },
                  ],
                };
              }
            }
          }
          return {};
        },
      },
    ];
  },

  async apply({ db, payload }) {
    const unitId = uuidv7();
    await db.query(
      `INSERT INTO commercial.commercial_units
         (id, contract_service_id, contract_item_id, unit_of_measure_id, state, period_from,
          period_until, derived_at)
       VALUES ($1, $2, $3, $4, 'INCOMPLETA', $5, $6, now())`,
      [
        unitId,
        payload.contractServiceId,
        payload.contractItemId,
        payload.unitOfMeasureId,
        payload.periodFrom ?? null,
        payload.periodUntil ?? null,
      ],
    );
    for (const source of payload.sources) {
      await db.query(
        `INSERT INTO commercial.commercial_unit_source_links
           (id, commercial_unit_id, execution_unit_version_id, execution_allocation_id,
            contribution_quantity, contribution_note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv7(),
          unitId,
          source.executionUnitVersionId,
          source.executionAllocationId ?? null,
          source.contributionQuantity ?? null,
          null,
        ],
      );
    }
    return {
      subject: { kind: 'UnidadComercial', id: unitId },
      version: 1,
      effects: [
        {
          kind: 'COMMERCIAL_UNIT_DERIVED',
          subjectKind: 'UnidadComercial',
          subjectId: unitId,
          detail: { sourceCount: payload.sources.length },
          outboxEvent: {
            type: 'commercial.unit.derived',
            payload: { commercialUnitId: unitId },
          },
        },
      ],
    };
  },
};

/* ---------------------------------------------------- commercial.units.complete-requirements */

const completeRequirements: CommandHandler<CompleteCommercialRequirementsInput> = {
  name: 'commercial.units.complete-requirements',

  async resolveScope({ db, subjectId }) {
    const unit = await loadUnit(db, requireSubjectId(subjectId, 'UnidadComercial'));
    return { subject: { kind: 'UnidadComercial', id: unit.id }, scope: {}, currentVersion: unit.version, currentState: unit.state };
  },

  async evaluators({ subjectId, currentState }) {
    const unitId = requireSubjectId(subjectId, 'UnidadComercial');
    return [
      stateTransition({
        machine: 'UnidadComercial',
        event: 'COMPLETAR_REQUISITOS',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'UnidadComercial', id: unitId },
        effects: [
          { kind: 'COMPLETE_REQUIREMENTS', description: 'INCOMPLETA -> ELEGIBLE con cantidad.', ruleId: 'RUL-059' },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, payload, occurredAt }) {
    const unitId = requireSubjectId(subjectId, 'UnidadComercial');
    const unit = await loadUnit(db, unitId);
    await db.query(
      `UPDATE commercial.commercial_units
       SET state = 'ELEGIBLE', quantity = $2, eligible_at = $3, updated_at = $3, version = version + 1
       WHERE id = $1`,
      [unitId, payload.quantity, occurredAt],
    );
    return {
      subject: { kind: 'UnidadComercial', id: unitId },
      version: unit.version + 1,
      effects: [{ kind: 'COMMERCIAL_UNIT_ELIGIBLE', subjectKind: 'UnidadComercial', subjectId: unitId }],
    };
  },
};

/* -------------------------------------------------------------- commercial.units.enter-review */

const enterReview: CommandHandler<Record<string, never>> = {
  name: 'commercial.units.enter-review',

  async resolveScope({ db, subjectId }) {
    const unit = await loadUnit(db, requireSubjectId(subjectId, 'UnidadComercial'));
    return { subject: { kind: 'UnidadComercial', id: unit.id }, scope: {}, currentVersion: unit.version, currentState: unit.state };
  },

  async evaluators({ subjectId, currentState }) {
    const unitId = requireSubjectId(subjectId, 'UnidadComercial');
    return [
      stateTransition({
        machine: 'UnidadComercial',
        event: 'INGRESAR_REVISION',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'UnidadComercial', id: unitId },
        effects: [{ kind: 'ENTER_COMMERCIAL_REVIEW', description: 'ELEGIBLE -> EN_REVISION.', ruleId: 'RUL-059' }],
      }),
    ];
  },

  async apply({ db, subjectId }) {
    const unitId = requireSubjectId(subjectId, 'UnidadComercial');
    const unit = await loadUnit(db, unitId);
    await db.query(
      `UPDATE commercial.commercial_units SET state = 'EN_REVISION', version = version + 1 WHERE id = $1`,
      [unitId],
    );
    return {
      subject: { kind: 'UnidadComercial', id: unitId },
      version: unit.version + 1,
      effects: [{ kind: 'COMMERCIAL_UNIT_IN_REVIEW', subjectKind: 'UnidadComercial', subjectId: unitId }],
    };
  },
};

/* ------------------------------------------------------------------ commercial.units.accept */

const acceptUnit: CommandHandler<AcceptCommercialUnitInput> = {
  name: 'commercial.units.accept',

  async resolveScope({ db, subjectId }) {
    const unit = await loadUnit(db, requireSubjectId(subjectId, 'UnidadComercial'));
    return { subject: { kind: 'UnidadComercial', id: unit.id }, scope: {}, currentVersion: unit.version, currentState: unit.state };
  },

  async evaluators({ subjectId, currentState }) {
    const unitId = requireSubjectId(subjectId, 'UnidadComercial');
    return [
      // TPR-027/RUL-062: the state machine only allows ACEPTAR from EN_REVISION, which is only
      // reachable via ELEGIBLE — eligible_at is therefore always set here. The CHECK constraint on
      // the table is the backstop for any path that reaches this row some other way.
      stateTransition({
        machine: 'UnidadComercial',
        event: 'ACEPTAR',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'UnidadComercial', id: unitId },
        effects: [{ kind: 'ACCEPT_COMMERCIAL_UNIT', description: 'EN_REVISION -> ACEPTADA.', ruleId: 'RUL-062' }],
      }),
    ];
  },

  async apply({ db, subjectId, occurredAt }) {
    const unitId = requireSubjectId(subjectId, 'UnidadComercial');
    const unit = await loadUnit(db, unitId);
    await db.query(
      `UPDATE commercial.commercial_units
       SET state = 'ACEPTADA', accepted_at = $2, updated_at = $2, version = version + 1
       WHERE id = $1`,
      [unitId, occurredAt],
    );
    return {
      subject: { kind: 'UnidadComercial', id: unitId },
      version: unit.version + 1,
      effects: [
        {
          kind: 'COMMERCIAL_UNIT_ACCEPTED',
          subjectKind: 'UnidadComercial',
          subjectId: unitId,
          outboxEvent: { type: 'commercial.unit.accepted', payload: { commercialUnitId: unitId } },
        },
      ],
    };
  },
};

/* ------------------------------------------------------------------ commercial.units.reject */

const rejectUnit: CommandHandler<RejectCommercialUnitInput> = {
  name: 'commercial.units.reject',

  async resolveScope({ db, subjectId }) {
    const unit = await loadUnit(db, requireSubjectId(subjectId, 'UnidadComercial'));
    return { subject: { kind: 'UnidadComercial', id: unit.id }, scope: {}, currentVersion: unit.version, currentState: unit.state };
  },

  async evaluators({ subjectId, currentState }) {
    const unitId = requireSubjectId(subjectId, 'UnidadComercial');
    return [
      stateTransition({
        machine: 'UnidadComercial',
        event: 'RECHAZAR',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'UnidadComercial', id: unitId },
        effects: [{ kind: 'REJECT_COMMERCIAL_UNIT', description: 'EN_REVISION -> RECHAZADA, con causa.', ruleId: 'RUL-059' }],
      }),
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt }) {
    const unitId = requireSubjectId(subjectId, 'UnidadComercial');
    const unit = await loadUnit(db, unitId);
    await db.query(
      `UPDATE commercial.commercial_units
       SET state = 'RECHAZADA', rejected_at = $2, updated_at = $2, version = version + 1
       WHERE id = $1`,
      [unitId, occurredAt],
    );
    // commercial_units has no reason column of its own; a rejection's cause is a commercial fact
    // in exactly the shape certification_observations already models (R-068), so it is recorded
    // there rather than discarded.
    await db.query(
      `INSERT INTO commercial.certification_observations
         (id, target_kind, commercial_unit_id, reason_code, description, raised_by_identity_id, raised_at)
       VALUES ($1, 'COMMERCIAL_UNIT', $2, 'REJECTED', $3, $4, $5)`,
      [uuidv7(), unitId, payload.reason, actor.identityId, occurredAt],
    );
    return {
      subject: { kind: 'UnidadComercial', id: unitId },
      version: unit.version + 1,
      effects: [{ kind: 'COMMERCIAL_UNIT_REJECTED', subjectKind: 'UnidadComercial', subjectId: unitId }],
    };
  },
};

export function registerCommercialCommands(): void {
  registerHandler(deriveUnit);
  registerHandler(completeRequirements);
  registerHandler(enterReview);
  registerHandler(acceptUnit);
  registerHandler(rejectUnit);
}
