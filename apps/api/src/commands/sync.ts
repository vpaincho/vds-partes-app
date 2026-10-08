/**
 * RGT-11's other half: a human resolves what a revoked session's offline device declared.
 *
 * `sync.discrepancies` has no `MachineKey` — like actions and notifications, its one legal move
 * (open -> resolved) is guarded directly. `discrepancies_resolved_has_actor` is the schema's own
 * backstop: resolving requires both an actor and a named resolution, never a bare "dismiss".
 */
import { DomainError, type Uuid } from '@vds/kernel';
import type { ResolveDiscrepancyInput } from '@vds/contracts';
import { registerHandler, type CommandHandler } from '../platform/pipeline.ts';
import type { Db } from '../platform/db.ts';
import { requireSubjectId } from '../commands/execution-shared.ts';

interface DiscrepancyRow {
  id: Uuid;
  resolved_at: Date | null;
  discrepancy_kind: string;
}

async function loadDiscrepancy(db: Db, discrepancyId: string): Promise<DiscrepancyRow> {
  const row = await db.one<DiscrepancyRow>(
    'SELECT id, resolved_at, discrepancy_kind FROM sync.discrepancies WHERE id = $1',
    [discrepancyId],
  );
  if (!row) throw new DomainError({ code: 'NOT_FOUND', message: `No existe la discrepancia ${discrepancyId}.` });
  return row;
}

const resolveDiscrepancy: CommandHandler<ResolveDiscrepancyInput> = {
  name: 'sync.discrepancies.resolve',

  async resolveScope({ db, subjectId }) {
    const row = await loadDiscrepancy(db, requireSubjectId(subjectId, 'DiscrepanciaSync'));
    return {
      subject: { kind: 'DiscrepanciaSync', id: row.id },
      scope: {},
      currentState: row.resolved_at ? 'RESUELTA' : 'ABIERTA',
    };
  },

  async evaluators({ subjectId, payload, currentState }) {
    const discrepancyId = requireSubjectId(subjectId, 'DiscrepanciaSync');
    const subject = { kind: 'DiscrepanciaSync', id: discrepancyId };
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'sync/reconcile',
        evaluate: () => {
          if (currentState === 'RESUELTA') {
            return {
              blocks: [
                {
                  ruleId: 'RGT-11',
                  precedence: 'P5' as const,
                  reason: 'La discrepancia ya fue resuelta.',
                  instead: 'Una discrepancia resuelta no se resuelve otra vez.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          if (payload.resolution === 'AMENDED' && !payload.amendmentId) {
            return {
              blocks: [
                {
                  ruleId: 'RGT-11',
                  precedence: 'P5' as const,
                  reason: 'Resolución AMENDED sin amendmentId.',
                  instead: 'Crear y aprobar la EnmiendaOperativa primero (execution.amendments), y referenciarla aquí.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          return {
            effects: [
              {
                kind: 'RESOLVE_DISCREPANCY',
                description:
                  `Resolver como ${payload.resolution}, con causa. Lo declarado por el dispositivo ` +
                  'queda en el registro tal como llegó, nunca reescrito (P-02).',
                ruleId: 'RGT-11',
              },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, subjectId, payload, actor, occurredAt }) {
    const discrepancyId = requireSubjectId(subjectId, 'DiscrepanciaSync');
    await db.query(
      `UPDATE sync.discrepancies
       SET resolved_at = $2, resolved_by = $3, resolution = $4, resolution_note = $5,
           amendment_id = $6
       WHERE id = $1`,
      [discrepancyId, occurredAt, actor.identityId, payload.resolution, payload.resolutionNote, payload.amendmentId ?? null],
    );
    return {
      subject: { kind: 'DiscrepanciaSync', id: discrepancyId },
      version: 1,
      effects: [
        {
          kind: 'DISCREPANCY_RESOLVED',
          subjectKind: 'DiscrepanciaSync',
          subjectId: discrepancyId,
          detail: { resolution: payload.resolution },
        },
      ],
    };
  },
};

export function registerSyncCommands(): void {
  registerHandler(resolveDiscrepancy);
}
