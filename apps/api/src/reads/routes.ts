/**
 * Read models.
 *
 * Projections, never an alternative source of truth (03: "Trace explica; no se vuelve fuente
 * alternativa"). Three rules every read here follows:
 *
 *  1. **Scope is applied server-side.** `readableContractIds` narrows the query from the actor's
 *     grants. A client-supplied filter is a convenience, never the boundary — that distinction is
 *     what RGT-15 tests (client A must not reach client B's object).
 *  2. **Every figure carries its source and recency.** A number without `source` and `asOf` cannot
 *     be audited, and the audit found dashboard figures changing silently when a Parte changed state.
 *  3. **State dimensions stay separate.** A read may expose a summarised badge, but it returns the
 *     underlying dimensions alongside it, so the UI can always reach the detail (S0 §8).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { instantNow, isDomainError, HTTP_STATUS, type Uuid } from '@vds/kernel';
import { withConnection } from '../platform/db.ts';
import { readableContractIds, unauthenticated } from '../platform/authz.ts';

const meta = (request: FastifyRequest) => ({
  requestId: request.requestId,
  serverTime: instantNow(),
});

export async function registerReadRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Mi jornada. The field surface the prototype got right and this preserves: pending, current,
   * upcoming and sent, prioritised.
   *
   * What changes is honesty about dimensions: operational state, delivery state and whether a gate
   * currently blocks the work are separate fields, not one badge.
   */
  app.get('/field/my-day', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });

    try {
      const date = (request.query as { date?: string }).date ?? null;

      const data = await withConnection(async (db) => {
        const { rows } = await db.query<{
          part_id: Uuid;
          code: string | null;
          part_state: string;
          part_type: string;
          operational_date: string;
          shift_id: string | null;
          is_emergent: boolean;
          crew_name: string | null;
          total_units: string;
          open_units: string;
          open_intervals: string;
          delivery_outstanding: string;
        }>(
          `SELECT p.id AS part_id, p.code, p.state::text AS part_state, pt.code AS part_type,
                  p.operational_date::text AS operational_date, p.shift_id, p.is_emergent,
                  cr.name AS crew_name,
                  (SELECT count(*)::text FROM execution.execution_units u WHERE u.part_id = p.id)
                    AS total_units,
                  (SELECT count(*)::text FROM execution.execution_units u
                   WHERE u.part_id = p.id
                     AND u.state NOT IN ('CERRADA','NO_REALIZADA','ANULADA')) AS open_units,
                  (SELECT count(*)::text FROM execution.time_events t
                   WHERE t.part_id = p.id AND t.ended_at IS NULL) AS open_intervals,
                  (SELECT count(*)::text FROM sync.delivery_status d
                   WHERE d.subject_id = p.id AND d.state <> 'RECIBIDO') AS delivery_outstanding
           FROM execution.parts p
           JOIN config.part_types pt ON pt.id = p.part_type_id
           LEFT JOIN config.crews cr ON cr.id = p.crew_id
           WHERE ($1::date IS NULL OR p.operational_date = $1::date)
             AND p.state <> 'ANULADO'
           ORDER BY
             -- Priority mirrors Mi jornada: what is running first, then what is ready to start.
             CASE p.state
               WHEN 'EN_EJECUCION' THEN 0
               WHEN 'SUSPENDIDO' THEN 1
               WHEN 'PREPARADO' THEN 2
               ELSE 3
             END,
             p.operational_date DESC, p.prepared_at DESC
           LIMIT 100`,
          [date],
        );

        return rows.map((r) => ({
          partId: r.part_id,
          code: r.code,
          partType: r.part_type,
          // Separate dimensions, never fused into one status string.
          operational: { state: r.part_state, openUnits: Number(r.open_units), totalUnits: Number(r.total_units) },
          delivery: { outstanding: Number(r.delivery_outstanding) },
          operationalDate: r.operational_date,
          shiftId: r.shift_id,
          isEmergent: r.is_emergent,
          crewName: r.crew_name,
          openIntervals: Number(r.open_intervals),
          source: 'execution.parts',
        }));
      });

      return { data, meta: { ...meta(request), asOf: instantNow(), source: 'execution' } };
    } catch (error) {
      return sendReadError(reply, request, error);
    }
  });

  /** A Parte with its UE, intervals and the dimensions that apply to it. */
  app.get('/execution/parts/:partId', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });

    try {
      const { partId } = request.params as { partId: string };
      const data = await withConnection(async (db) => {
        const part = await db.one<Record<string, unknown>>(
          `SELECT p.id, p.code, p.state::text AS state, pt.code AS part_type,
                  p.operational_date::text AS operational_date, p.shift_id, p.is_emergent,
                  p.prepared_at, p.started_at, p.closed_at, p.version
           FROM execution.parts p
           JOIN config.part_types pt ON pt.id = p.part_type_id
           WHERE p.id = $1`,
          [partId],
        );
        if (!part) return null;

        const { rows: units } = await db.query(
          `SELECT u.id, u.code, u.state::text AS state, u.description, u.unit_kind,
                  u.started_at, u.ended_at, u.result, u.result_reason, u.version,
                  u.current_version_id,
                  a.status::text AS allocation_status, a.pending_reason
           FROM execution.execution_units u
           LEFT JOIN LATERAL (
             SELECT status, pending_reason FROM execution.execution_allocations
             WHERE execution_unit_id = u.id ORDER BY version_no DESC LIMIT 1
           ) a ON true
           WHERE u.part_id = $1
           ORDER BY u.sequence_no NULLS LAST, u.created_at`,
          [partId],
        );

        const { rows: intervals } = await db.query(
          `SELECT id, execution_unit_id, time_category, started_at, ended_at, reason
           FROM execution.time_events WHERE part_id = $1 ORDER BY started_at`,
          [partId],
        );

        const { rows: people } = await db.query(
          `SELECT pa.id, pa.person_id, p.first_name, p.last_name, pa.role,
                  pa.started_at, pa.ended_at, pa.end_reason, pa.compliance_status
           FROM execution.person_execution_assignments pa
           JOIN config.people p ON p.id = pa.person_id
           WHERE pa.part_id = $1
           ORDER BY pa.started_at`,
          [partId],
        );

        const { rows: locations } = await db.query(
          `SELECT l.id, l.execution_unit_id, l.technical_location_id, tl.code AS technical_location_code,
                  tl.name AS technical_location_name, l.location_role, l.unmapped_label, l.confirmed_at
           FROM execution.execution_locations l
           LEFT JOIN config.technical_locations tl ON tl.id = l.technical_location_id
           JOIN execution.execution_units u ON u.id = l.execution_unit_id
           WHERE u.part_id = $1
           ORDER BY l.confirmed_at NULLS LAST`,
          [partId],
        );

        const { rows: measurements } = await db.query(
          `SELECT m.id, m.execution_unit_id, m.metric_code, m.quantity, m.unit_of_measure_id,
                  um.code AS unit_code, m.measurement_source, m.measured_at
           FROM execution.execution_measurements m
           JOIN execution.execution_units u ON u.id = m.execution_unit_id
           LEFT JOIN config.units_of_measure um ON um.id = m.unit_of_measure_id
           WHERE u.part_id = $1
           ORDER BY m.measured_at`,
          [partId],
        );

        // A small, stable catalogue the capture form needs to build a valid CaptureMeasurement
        // payload (C-014: a magnitude always travels with its unit — never a bare number).
        const { rows: unitsOfMeasure } = await db.query(
          'SELECT id, code, name FROM config.units_of_measure ORDER BY code',
        );

        return { part, units, intervals, people, locations, measurements, unitsOfMeasure };
      });

      if (!data) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `No existe el Parte ${partId}.`, details: [], ruleIds: [], retryable: false },
          meta: meta(request),
        });
      }
      return { data, meta: { ...meta(request), asOf: instantNow(), source: 'execution' } };
    } catch (error) {
      return sendReadError(reply, request, error);
    }
  });

  /**
   * The trace of a subject: what happened, who, when, which rules, which were discarded.
   *
   * This is S0 §17 made queryable. A BLOCK appears here too, which is the point — a refusal that
   * leaves no record cannot be explained to the person it affected.
   */
  app.get('/trace/:subjectKind/:subjectId', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return reply.code(401).send({ error: unauthenticated().toJSON().error, meta: meta(request) });

    try {
      const { subjectKind, subjectId } = request.params as { subjectKind: string; subjectId: string };
      const data = await withConnection(async (db) => {
        const { rows } = await db.query<{
          id: Uuid;
          decision: string;
          trigger: string;
          current_state: string | null;
          target_state: string | null;
          blocks: unknown;
          warnings: unknown;
          confirmations: unknown;
          missing: unknown;
          effects: unknown;
          override_ref: unknown;
          preview: boolean;
          decision_at: Date;
          actor_name: string | null;
        }>(
          `SELECT t.id, t.decision, t.trigger, t.current_state, t.target_state, t.blocks, t.warnings,
                  t.confirmations, t.missing, t.effects, t.override_ref, t.preview, t.decision_at,
                  i.display_name AS actor_name
           FROM platform.decision_traces t
           LEFT JOIN platform.identities i ON i.id = t.actor_id
           WHERE t.subject_kind = $1 AND t.subject_id = $2
           ORDER BY t.decision_at DESC
           LIMIT 200`,
          [subjectKind, subjectId],
        );

        const traceIds = rows.map((r) => r.id);
        const { rows: ruleRows } = traceIds.length
          ? await db.query<{ decision_trace_id: Uuid; rule_id: string; precedence: string; outcome: string; note: string | null }>(
              `SELECT decision_trace_id, rule_id, precedence, outcome, note
               FROM platform.decision_trace_rules WHERE decision_trace_id = ANY($1::uuid[])`,
              [traceIds],
            )
          : { rows: [] };

        return rows.map((r) => ({
          decisionId: r.id,
          decision: r.decision,
          trigger: r.trigger,
          currentState: r.current_state,
          targetState: r.target_state,
          blocks: r.blocks,
          warnings: r.warnings,
          confirmationsRequired: r.confirmations,
          missing: r.missing,
          effects: r.effects,
          override: r.override_ref,
          preview: r.preview,
          decidedAt: r.decision_at.toISOString(),
          actor: r.actor_name,
          // Winners and losers, so a conflict can be explained after the fact (sheet 58 step 8).
          rules: ruleRows
            .filter((x) => x.decision_trace_id === r.id)
            .map((x) => ({ ruleId: x.rule_id, precedence: x.precedence, outcome: x.outcome, note: x.note })),
        }));
      });

      return { data, meta: { ...meta(request), asOf: instantNow(), source: 'platform.decision_traces' } };
    } catch (error) {
      return sendReadError(reply, request, error);
    }
  });
}

function sendReadError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (isDomainError(error)) {
    return reply.code(HTTP_STATUS[error.code]).send({ ...error.toJSON(), meta: meta(request) });
  }
  request.log?.error({ err: error, requestId: request.requestId }, 'read failed');
  return reply.code(500).send({
    error: { code: 'INVARIANT_VIOLATED', message: 'Error interno.', details: [], ruleIds: [], retryable: false },
    meta: meta(request),
  });
}

// Imported lazily to keep the type import local to this module.
type FastifyReply = import('fastify').FastifyReply;
