/**
 * Expiries: PTW -> VENCIDO, Directiva -> EXPIRADA.
 *
 * P-05 / 12_OFFLINE_SYNC: a timeout blocks and alerts; it never autocloses anything downstream. So
 * this job moves exactly the one state that recognises the deadline passed — never a Parte, a UE or
 * a case that happened to depend on either — and records why, through the same append-only event
 * log (`work_permit_events` / `directive_events`) a human action would write. `actor_id` is NULL on
 * these rows: nobody decided this, the clock did, and T-PTW09/T-D07 are both named `EXPIRAR` in the
 * generated state machine for exactly that reason.
 *
 * `canTransition`/the command pipeline are not used here on purpose. Both transitions have exactly
 * one legal destination with no rule to evaluate and no actor to authorise — this is a scheduled
 * fact, not a command — so the UPDATE + event-log INSERT pair mirrors what `habilita.permits.close`
 * etc. already do in apps/api, at the scale a sweep needs (one SQL round trip per table instead of
 * one pipeline run per row).
 */
import { randomUUID } from 'node:crypto';
import type { JobDb } from '../db.ts';

export interface ExpirySweepResult {
  readonly permitsExpired: readonly string[];
  readonly directivesExpired: readonly string[];
}

export async function runExpiriesJob(db: JobDb, now: Date = new Date()): Promise<ExpirySweepResult> {
  const { rows: permits } = await db.query<{ id: string; state: string }>(
    `SELECT id, state::text AS state FROM habilita.work_permits
     WHERE state IN ('APROBADO', 'VIGENTE', 'SUSPENDIDO')
       AND valid_until IS NOT NULL AND valid_until <= $1`,
    [now],
  );
  for (const permit of permits) {
    await db.query(
      `UPDATE habilita.work_permits
       SET state = 'VENCIDO', expired_at = $2, updated_at = $2, version = version + 1
       WHERE id = $1`,
      [permit.id, now],
    );
    await db.query(
      `INSERT INTO habilita.work_permit_events
         (id, work_permit_id, event_type, from_state, to_state, reason, occurred_at)
       VALUES ($1, $2, 'EXPIRAR', $3::habilita.permit_state, 'VENCIDO', $4, $5)`,
      [
        randomUUID(),
        permit.id,
        permit.state,
        'Vigencia vencida (TTL). Un cierre todavía requiere el camino administrativo (RUL-045/C-021).',
        now,
      ],
    );
  }

  const { rows: directives } = await db.query<{ id: string; state: string }>(
    `SELECT id, state::text AS state FROM control.directives
     WHERE state IN ('EMITIDA', 'RECIBIDA', 'RECONOCIDA')
       AND valid_until IS NOT NULL AND valid_until <= $1`,
    [now],
  );
  for (const directive of directives) {
    await db.query(
      `UPDATE control.directives SET state = 'EXPIRADA', expired_at = $2, version = version + 1
       WHERE id = $1`,
      [directive.id, now],
    );
    await db.query(
      `INSERT INTO control.directive_events
         (id, directive_id, event_type, from_state, to_state, detail, occurred_at)
       VALUES ($1, $2, 'EXPIRAR', $3::control.directive_state, 'EXPIRADA', $4::jsonb, $5)`,
      [randomUUID(), directive.id, directive.state, JSON.stringify({ cause: 'TTL' }), now],
    );
  }

  return {
    permitsExpired: permits.map((p) => p.id),
    directivesExpired: directives.map((d) => d.id),
  };
}
