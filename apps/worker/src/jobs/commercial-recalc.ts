/**
 * RUL-065: an approved EnmiendaOperativa invalidates the commercial derivations that consumed the
 * execution unit it corrected.
 *
 * `execution.amendments.approve` (apps/api/src/commands/execution-lifecycle.ts) already queues a
 * `platform.domain_outbox` row of type `execution.amendment.approved` — that comment says "the
 * worker does that" about marking affected commercial units. This is that worker.
 *
 * C-034/SM-09: `supersession_state` is a dimension PARALLEL to `state` — flipping a unit to
 * `REQUIERE_RECALCULO` never touches `state`. An already-`ACEPTADA` unit stays `ACEPTADA`: the
 * historical acceptance is still true of the version it accepted (C-030). What changes is that
 * `billing.lines.build`'s RUL-070 gate (only ACEPTADA + VIGENTE produces a line) now refuses it
 * until someone re-derives or otherwise resolves the recalculation — this job only flags that, it
 * never re-derives automatically, because a new quantity is a decision, not a mechanical copy.
 *
 * Only `VIGENTE` units move. A unit already `SUSTITUIDA`, `INVALIDADA` or mid-`EN_REVISION` is left
 * alone: the amendment does not get to silently overwrite whatever that other process is doing.
 */
import type { JobDb } from '../db.ts';

export interface CommercialRecalcResult {
  readonly outboxEventsProcessed: number;
  readonly unitsFlagged: readonly string[];
}

export async function runCommercialRecalcJob(db: JobDb): Promise<CommercialRecalcResult> {
  const { rows: events } = await db.query<{ id: string; payload: { executionUnitId?: string } }>(
    `SELECT id, payload FROM platform.domain_outbox
     WHERE event_type = 'execution.amendment.approved' AND status IN ('PENDING', 'FAILED')
     ORDER BY available_at
     LIMIT 50`,
  );

  const flagged: string[] = [];
  for (const event of events) {
    const executionUnitId = event.payload?.executionUnitId;
    if (executionUnitId) {
      const { rows } = await db.query<{ id: string }>(
        `UPDATE commercial.commercial_units
         SET supersession_state = 'REQUIERE_RECALCULO', updated_at = now()
         WHERE supersession_state = 'VIGENTE'
           AND id IN (
             SELECT l.commercial_unit_id
             FROM commercial.commercial_unit_source_links l
             JOIN execution.execution_unit_versions v ON v.id = l.execution_unit_version_id
             WHERE v.execution_unit_id = $1
           )
         RETURNING id`,
        [executionUnitId],
      );
      flagged.push(...rows.map((r) => r.id));
    }
    await db.query(
      `UPDATE platform.domain_outbox SET status = 'DONE', completed_at = now() WHERE id = $1`,
      [event.id],
    );
  }

  return { outboxEventsProcessed: events.length, unitsFlagged: flagged };
}
