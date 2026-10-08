/**
 * Stage evaluators shared by the execution commands.
 *
 * Each is bound to one pipeline stage and one precedence level, because sheet 63 binds them and a
 * mismatch would silently reorder authority. The engine runs them; none of them decides the overall
 * outcome.
 *
 * The important one is `habilitaGate`: it is where PD-0394 is actually fixed. `checks()` in the
 * prototype verified that three PTW fields were non-empty, so a permit signed at 11:25 made work
 * from 07:20 look authorised. Here the question is whether a permit was **in force, covering this
 * scope, at the instant the work happened**.
 */
import {
  canTransition,
  isWithin,
  type AppliedRule,
  type Blocker,
  type Instant,
  type MachineKey,
  type SubjectRef,
  type Warning,
} from '@vds/kernel';
import { rule } from '@vds/rules';
import type { StageEvaluator, StageOutcome } from '@vds/rules';
import type { Db } from '../platform/db.ts';
import { buildRoutingContext } from '../platform/typeparts.ts';

const cite = (ruleId: string): { ruleId: string; sourceRef: string } => {
  const r = rule(ruleId);
  return { ruleId, sourceRef: `${r.sourceSheet}:${r.sourceRow}` };
};

/* ------------------------------------------------------------------ S2 invariants (P0) */

/**
 * P0: history and lineage. Refuses to touch anything already terminal.
 *
 * The database also refuses this (0009_integrity.sql), and that redundancy is deliberate: the
 * trigger is the backstop, but a block that reaches the operator should carry the rule id and the
 * correct path, not a constraint name.
 */
export function historyInvariants(input: {
  db: Db;
  subject: SubjectRef;
  currentState?: string;
  terminalStates: readonly string[];
}): StageEvaluator {
  return {
    stage: 'S2_INVARIANTS',
    precedence: 'P0',
    owner: 'execution/invariants',
    evaluate: (): StageOutcome => {
      if (input.currentState === undefined) return {};
      if (!input.terminalStates.includes(input.currentState)) {
        return { rulesApplied: [{ ruleId: 'RUL-035', precedence: 'P0', outcome: 'NOT_APPLICABLE' }] };
      }
      return {
        blocks: [
          {
            ...cite('RUL-035'),
            precedence: 'P0',
            reason:
              `${input.subject.kind} está en estado terminal ${input.currentState}: ` +
              'la realidad cerrada no se edita.',
            instead:
              'Crear una EnmiendaOperativa con valor anterior/nuevo, motivo, evidencia y ' +
              'aprobador. Genera una versión efectiva nueva y conserva la original.',
            subject: input.subject,
            overrideable: false,
          },
        ],
        rulesApplied: [{ ruleId: 'RUL-035', precedence: 'P0', outcome: 'WON' }],
      };
    },
  };
}

/* --------------------------------------------------------------------- S3 Habilita (P1) */

export interface HabilitaGateInput {
  readonly db: Db;
  readonly subject: SubjectRef;
  /** The UE being started, when there is one. */
  readonly executionUnitId?: string;
  readonly partId: string;
  /** The real instant the work happens. The whole point: coverage is judged at THIS moment. */
  readonly at: Instant;
  /** Whether a work permit is required for this context. */
  readonly requiresPermit: boolean;
  /** People whose clearance must be checked. */
  readonly personIds: readonly string[];
}

/**
 * P1 hard gates: documentary clearance and PTW temporal coverage.
 *
 * RUL-022 (HARD_BLOCK) then RUL-042 (PTW must be VIGENTE and actually covering). Neither is
 * overrideable: C-018 forbids a hard block becoming an override, and the blocker says so, so a UI
 * cannot offer a button that cannot exist.
 */
export function habilitaGate(input: HabilitaGateInput): StageEvaluator {
  return {
    stage: 'S3_HABILITA',
    precedence: 'P1',
    owner: 'habilita/prevent',
    evaluate: async (): Promise<StageOutcome> => {
      const blocks: Blocker[] = [];
      const warnings: Warning[] = [];
      const rulesApplied: AppliedRule[] = [];

      // --- RUL-042: is a permit required, and does one actually cover this instant?
      if (input.requiresPermit) {
        rulesApplied.push({ ruleId: 'RUL-042', precedence: 'P1', outcome: 'WON' });

        const { rows: permits } = await input.db.query<{
          id: string;
          code: string | null;
          state: string;
          valid_from: Date | null;
          valid_until: Date | null;
          activated_at: Date | null;
          covers_from: Date | null;
          covers_until: Date | null;
        }>(
          `SELECT p.id, p.code, p.state::text AS state, p.valid_from, p.valid_until, p.activated_at,
                  c.covers_from, c.covers_until
           FROM habilita.work_permits p
           LEFT JOIN habilita.work_permit_execution_units c
             ON c.work_permit_id = p.id AND c.execution_unit_id = $1
           WHERE c.execution_unit_id = $1`,
          [input.executionUnitId ?? null],
        );

        // A permit counts only if it is VIGENTE *and* its window (narrowed by the coverage row)
        // contains the moment of the work.
        const covering = permits.filter((p) => {
          if (p.state !== 'VIGENTE') return false;
          const from = (p.covers_from ?? p.valid_from)?.toISOString() as Instant | undefined;
          if (!from) return false;
          const until = (p.covers_until ?? p.valid_until)?.toISOString() as Instant | null;
          return isWithin(input.at, { validFrom: from, validUntil: until ?? null });
        });

        if (covering.length === 0) {
          const nearest = permits.find((p) => p.valid_from !== null);
          const explanation =
            permits.length === 0
              ? 'No hay ningún permiso de trabajo vinculado a esta unidad de ejecución.'
              : nearest
                ? `El permiso ${nearest.code ?? nearest.id} está en estado ${nearest.state} y su ` +
                  `vigencia comienza ${nearest.valid_from?.toISOString() ?? 'sin definir'}, ` +
                  `posterior al momento del trabajo (${input.at}).`
                : `Ningún permiso vinculado está VIGENTE y cubriendo ${input.at}.`;

          blocks.push({
            ...cite('RUL-022'),
            precedence: 'P1',
            reason:
              `Se requiere un permiso de trabajo vigente que cubra el instante real del trabajo. ` +
              explanation,
            instead:
              'Obtener y ACTIVAR el permiso antes de iniciar. Un permiso firmado o activado ' +
              'después no autoriza una ejecución anterior: aprobado no es vigente (RUL-043), y un ' +
              'hecho ya ocurrido se preserva como discrepancia, nunca como autorizado.',
            subject: input.subject,
            overrideable: false,
          });
        }
      }

      // --- RUL-039 / RUL-040: documentary clearance of the people involved.
      if (input.personIds.length > 0) {
        const { rows: findings } = await input.db.query<{
          person_id: string;
          first_name: string;
          last_name: string;
          requirement_code: string;
          requirement_name: string;
          severity: string;
          overrideable_via: string | null;
          status: string;
          valid_until: Date | null;
        }>(
          `SELECT p.id AS person_id, p.first_name, p.last_name,
                  r.code AS requirement_code, r.name AS requirement_name,
                  r.severity::text AS severity, r.overrideable_via,
                  coalesce(c.status, 'MISSING') AS status, c.valid_until
           FROM config.people p
           CROSS JOIN habilita.requirements r
           LEFT JOIN LATERAL (
             SELECT status, valid_until
             FROM habilita.compliances
             WHERE person_id = p.id AND requirement_id = r.id
               AND valid_from <= $2::timestamptz::date
               AND (valid_until IS NULL OR valid_until >= $2::timestamptz::date)
             ORDER BY valid_from DESC
             LIMIT 1
           ) c ON true
           WHERE p.id = ANY($1::uuid[])
             AND r.applies_to = 'PERSON'
             AND r.valid_from <= $2::timestamptz::date
             AND (r.valid_until IS NULL OR r.valid_until >= $2::timestamptz::date)
             AND coalesce(c.status, 'MISSING') <> 'COMPLIANT'`,
          [input.personIds, input.at],
        );

        for (const finding of findings) {
          const who = `${finding.first_name} ${finding.last_name}`;
          const what = `${finding.requirement_name} (${finding.requirement_code})`;
          const detail =
            finding.status === 'EXPIRED' && finding.valid_until
              ? `vencida el ${finding.valid_until.toISOString().slice(0, 10)}`
              : finding.status === 'NOT_VERIFIABLE'
                ? 'no verificable: el proveedor documental no respondió'
                : finding.status.toLowerCase();

          if (finding.severity === 'HARD_BLOCK') {
            rulesApplied.push({ ruleId: 'RUL-039', precedence: 'P1', outcome: 'WON' });
            blocks.push({
              ...cite('RUL-039'),
              precedence: 'P1',
              reason: `${who}: ${what} ${detail}.`,
              instead:
                'Regularizar el requisito, o iniciar sin esa persona. Un bloqueo duro no se ' +
                'convierte en override por conveniencia (C-018).',
              subject: { kind: 'Persona', id: finding.person_id as never },
              overrideable: false,
            });
          } else if (finding.severity === 'WARNING') {
            rulesApplied.push({ ruleId: 'RUL-040', precedence: 'P1', outcome: 'WON' });
            warnings.push({
              ...cite('RUL-040'),
              precedence: 'P1',
              reason: `${who}: ${what} ${detail}.`,
              subject: { kind: 'Persona', id: finding.person_id as never },
              // An advertencia is not permission: continuing needs an authorised override.
              ...(finding.overrideable_via === null
                ? {}
                : { requiresOverrideGate: finding.overrideable_via }),
            });
          }
        }
      }

      return { blocks, warnings, rulesApplied };
    },
  };
}

/* ------------------------------------------------------------------ S4 state machine (P2) */

/**
 * P2: is this transition permitted by the canonical state machine?
 *
 * Consults the generated dataset, so the 33 prohibitions are refused with their `instead` text. A
 * creation command (no current state) has nothing to validate here.
 */
export function stateTransition(input: {
  machine: MachineKey;
  event: string;
  currentState?: string;
  subject: SubjectRef;
  /** Effects to declare when the transition is permitted. */
  effects?: StageOutcome['effects'];
}): StageEvaluator {
  return {
    stage: 'S4_TRANSITION',
    precedence: 'P2',
    owner: 'kernel/state-machine',
    evaluate: (): StageOutcome => {
      if (input.currentState === undefined) {
        // Creation: there is no from-state. The handler declares the initial state itself.
        return { ...(input.effects ? { effects: input.effects } : {}) };
      }

      const verdict = canTransition(input.machine, input.currentState, input.event);
      if (verdict.allowed) {
        return {
          targetState: verdict.transition.to,
          ...(input.effects ? { effects: input.effects } : {}),
          rulesApplied: [
            {
              ruleId: verdict.transition.id,
              precedence: 'P2',
              outcome: 'WON',
              ...(verdict.gate === '' ? {} : { note: `gate: ${verdict.gate}` }),
            },
          ],
        };
      }

      return {
        blocks: [
          {
            ruleId: verdict.tpr_id ?? 'SM',
            precedence: 'P2',
            reason: verdict.message,
            ...(verdict.instead === undefined ? {} : { instead: verdict.instead }),
            ...(verdict.source === undefined ? {} : { sourceRef: verdict.source }),
            subject: input.subject,
            overrideable: false,
          },
        ],
        rulesApplied: [
          { ruleId: verdict.tpr_id ?? 'SM', precedence: 'P2', outcome: 'WON', note: verdict.reason },
        ] satisfies AppliedRule[],
      };
    },
  };
}

/* ------------------------------------------------------------------- S5 control plane (P3) */

/**
 * P3: a directive in force over this subject. RUL-058: an expired directive must not be applied,
 * and a suspension directive blocks work it targets.
 */
export function controlPlane(input: {
  db: Db;
  subject: SubjectRef;
  partId?: string;
  executionUnitId?: string;
  at: Instant;
}): StageEvaluator {
  return {
    stage: 'S5_CONTROL_PLANE',
    precedence: 'P3',
    owner: 'control',
    evaluate: async (): Promise<StageOutcome> => {
      const { rows } = await input.db.query<{
        id: string;
        code: string | null;
        directive_type: string;
        state: string;
        reason: string;
        valid_until: Date | null;
      }>(
        `SELECT d.id, d.code, d.directive_type::text AS directive_type, d.state::text AS state,
                d.reason, d.valid_until
         FROM control.directives d
         JOIN control.directive_targets t ON t.directive_id = d.id
         WHERE d.state IN ('EMITIDA', 'RECIBIDA', 'RECONOCIDA')
           AND d.directive_type IN ('SUSPENDER', 'CANCELAR')
           AND (t.part_id = $1 OR t.execution_unit_id = $2)`,
        [input.partId ?? null, input.executionUnitId ?? null],
      );

      const live = rows.filter(
        (d) => d.valid_until === null || Date.parse(input.at) < d.valid_until.getTime(),
      );

      if (live.length === 0) {
        // An expired directive is reported as applied-to-nobody, not silently dropped: RUL-058.
        const expired = rows.length - live.length;
        return expired > 0
          ? {
              rulesApplied: [
                {
                  ruleId: 'RUL-058',
                  precedence: 'P3',
                  outcome: 'WON',
                  note: `${expired} directiva(s) perdieron vigencia y no se aplican`,
                },
              ],
            }
          : {};
      }

      const first = live[0]!;
      return {
        blocks: [
          {
            ...cite('RUL-057'),
            precedence: 'P3',
            reason:
              `Hay una directiva ${first.directive_type} vigente sobre este objeto ` +
              `(${first.code ?? first.id}): ${first.reason}`,
            instead:
              'Aplicar o rechazar la directiva con causa antes de continuar. Una orden aplicada se ' +
              'compensa con otra, no se cancela retroactivamente.',
            subject: input.subject,
            overrideable: false,
          },
        ],
        rulesApplied: [{ ruleId: 'RUL-057', precedence: 'P3', outcome: 'WON' }],
      };
    },
  };
}

/* --------------------------------------------------------------------- S6 routing (P4) */

/**
 * P4: derive TipoParte from profile and context (RUL-001). RUL-002: if more than one is compatible,
 * ask for a minimal confirmation or escalate — never pick one silently.
 *
 * C-006 forbids a free selector on the normal path, which is why the payload has no partTypeId.
 */
export function routeTipoParte(input: {
  db: Db;
  subject: SubjectRef;
  plannedAssignmentId?: string;
  isEmergent: boolean;
  at: Instant;
}): StageEvaluator {
  return {
    stage: 'S6_IDENTITY',
    precedence: 'P4',
    owner: 'config/routing',
    evaluate: async (): Promise<StageOutcome> => {
      // The decision belongs to the three strategies, not to this evaluator. Each pattern says
      // whether it applies to the context, and `routeContext` reports the outcome: resolved,
      // ambiguous, or nothing applicable. Keeping the judgement in @vds/typeparts is what lets the
      // same answer be computed in a test, in the worker and (later) offline on a device.
      const { context, result } = await buildRoutingContext(input.db, {
        ...(input.plannedAssignmentId ? { plannedAssignmentId: input.plannedAssignmentId } : {}),
        isEmergent: input.isEmergent,
        at: input.at,
      });

      if (result.resolved) {
        const winner = result.applicable.find((a) => a.id === result.resolved)!;
        const row = await input.db.one<{ id: string }>(
          'SELECT id FROM config.part_types WHERE code = $1 AND is_active = true',
          [result.resolved],
        );
        if (!row) {
          // The strategy exists but the catalogue does not carry the pattern: configuration, not
          // something to approximate.
          return {
            blocks: [
              {
                ruleId: 'RUL-001',
                precedence: 'P4',
                reason: `El patrón ${result.resolved} no está activo en el catálogo de TipoParte.`,
                instead: 'Activar el TipoParte en configuración antes de operar con ese patrón.',
                subject: input.subject,
                overrideable: false,
              },
            ],
            rulesApplied: [{ ruleId: 'RUL-001', precedence: 'P4', outcome: 'WON' }],
          };
        }
        return {
          derived: { partTypeId: row.id, partTypeCode: result.resolved },
          rulesApplied: [
            {
              ruleId: winner.decision.ruleId,
              precedence: 'P4',
              outcome: 'WON',
              note: winner.decision.reason,
            },
            // The patterns that were considered and did not win are recorded too. Sheet 58 step 8
            // requires the discarded candidates with their reason: once configuration moves on, a
            // past routing decision can only be explained if the alternatives are on record.
            ...result.rejected.map((r) => ({
              ruleId: r.decision.ruleId,
              precedence: 'P4' as const,
              outcome: 'DISCARDED_BY_SPECIFICITY' as const,
              note: `${r.id}: ${r.decision.reason}`,
            })),
          ],
        };
      }

      // Nothing applies at all. That is not an ambiguity to confirm — it is a context no pattern
      // covers, and inventing one would decide the grain of the Parte by accident.
      if (result.applicable.length === 0 && result.ambiguous.length === 0) {
        return {
          blocks: [
            {
              ruleId: 'RUL-001',
              precedence: 'P4',
              reason:
                'Ningún TipoParte es aplicable a este contexto: ' +
                result.rejected.map((r) => `${r.id} (${r.decision.reason})`).join(' · '),
              instead:
                'Revisar el alcance de la asignación. Un contexto que no corresponde a ningún ' +
                'patrón no se fuerza al más parecido: el grano del Parte quedaría decidido por azar.',
              subject: input.subject,
              overrideable: false,
            },
          ],
          rulesApplied: [{ ruleId: 'RUL-001', precedence: 'P4', outcome: 'WON' }],
        };
      }

      // RUL-002: more than one pattern compatible, or a discriminating datum missing. Ask for the
      // minimum confirmation and record the candidates — never take the first match (AP-03).
      const candidates = [...result.applicable, ...result.ambiguous].map((c) => c.id);
      return {
        confirmationsRequired: [
          {
            field: 'partTypeId',
            reason:
              `Más de un TipoParte es compatible con el contexto (${candidates.join(', ')}) o falta ` +
              `un dato discriminante (${result.missing.join(', ') || 'sin especificar'}). ` +
              'Confirmá el patrón o escalá a supervisión.',
            candidate: candidates,
            ruleId: 'RUL-002',
          },
        ],
        ...(result.missing.length > 0
          ? {
              missing: result.missing.map((what) => ({
                what,
                reason:
                  'Dato discriminante del ruteo. No se completa por defecto: un valor inventado acá ' +
                  'se arrastra a la imputación y a la certificación (AP-06).',
              })),
            }
          : {}),
        rulesApplied: [
          {
            ruleId: 'RUL-002',
            precedence: 'P4',
            outcome: 'WON',
            note:
              `candidatos: ${candidates.join(', ')}` +
              (result.missing.length > 0 ? ` · falta: ${result.missing.join(', ')}` : '') +
              ` · contexto: ${context.hasOriginAndDestination ? 'trayecto' : 'sin trayecto'}, ` +
              `${context.hasCrew ? 'con cuadrilla' : 'sin cuadrilla'}`,
          },
        ],
      };
    },
  };
}
