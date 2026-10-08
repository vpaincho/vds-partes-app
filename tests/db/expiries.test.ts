/**
 * The worker's expiries sweep, exercised directly against PostgreSQL.
 *
 * P-05: a timeout blocks and alerts, and never autocloses anything beyond the one object whose
 * deadline passed. These tests prove the sweep moves exactly that state, writes the append-only
 * event explaining why, and leaves everything not yet due untouched.
 */
import { describe, expect, it } from 'vitest';
import { runExpiriesJob } from '../../apps/worker/src/jobs/expiries.ts';
import { inRollbackTx, makeIdentity, uuid, type Tx } from './helpers.ts';

async function makePermit(
  tx: Tx,
  options: { state: string; validUntil: Date | null },
): Promise<string> {
  const id = uuid();
  const activated = options.state === 'VIGENTE' || options.state === 'SUSPENDIDO';
  await tx.query(
    `INSERT INTO habilita.work_permits
       (id, permit_type, state, scope_description, valid_from, valid_until, activated_at)
     VALUES ($1, 'CALIENTE', $2::habilita.permit_state, 'Trabajo de prueba', $3, $4, $5)`,
    [
      id,
      options.state,
      activated ? new Date(Date.now() - 2 * 3_600_000) : null,
      options.validUntil,
      activated ? new Date(Date.now() - 2 * 3_600_000) : null,
    ],
  );
  return id;
}

async function makeDirective(
  tx: Tx,
  options: { state: string; validUntil: Date | null },
): Promise<string> {
  const id = uuid();
  const issuedBy = await makeIdentity(tx, 'planner');
  await tx.query(
    `INSERT INTO control.directives
       (id, directive_type, state, reason, issued_by, issued_at, valid_until)
     VALUES ($1, 'SUSPENDER', $2::control.directive_state, 'Motivo de prueba', $3, now() - interval '3 hours', $4)`,
    [id, options.state, issuedBy, options.validUntil],
  );
  return id;
}

describe('runExpiriesJob', () => {
  it('moves an overdue VIGENTE permit to VENCIDO and logs why', async () => {
    await inRollbackTx(async (tx) => {
      const permitId = await makePermit(tx, { state: 'VIGENTE', validUntil: new Date(Date.now() - 60_000) });

      const result = await runExpiriesJob(tx);
      expect(result.permitsExpired).toContain(permitId);

      const { rows } = await tx.query<{ state: string; expired_at: Date | null }>(
        'SELECT state::text AS state, expired_at FROM habilita.work_permits WHERE id = $1',
        [permitId],
      );
      expect(rows[0]!.state).toBe('VENCIDO');
      expect(rows[0]!.expired_at).not.toBeNull();

      const events = await tx.query<{ event_type: string; from_state: string; to_state: string }>(
        'SELECT event_type, from_state::text AS from_state, to_state::text AS to_state FROM habilita.work_permit_events WHERE work_permit_id = $1',
        [permitId],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]).toEqual({ event_type: 'EXPIRAR', from_state: 'VIGENTE', to_state: 'VENCIDO' });
    });
  });

  it('leaves a permit with a future valid_until untouched', async () => {
    await inRollbackTx(async (tx) => {
      const permitId = await makePermit(tx, { state: 'VIGENTE', validUntil: new Date(Date.now() + 3_600_000) });
      const result = await runExpiriesJob(tx);
      expect(result.permitsExpired).not.toContain(permitId);

      const { rows } = await tx.query<{ state: string }>(
        'SELECT state::text AS state FROM habilita.work_permits WHERE id = $1',
        [permitId],
      );
      expect(rows[0]!.state).toBe('VIGENTE');
    });
  });

  it('leaves an already-closed permit untouched even with a past valid_until', async () => {
    await inRollbackTx(async (tx) => {
      const permitId = uuid();
      await tx.query(
        `INSERT INTO habilita.work_permits
           (id, permit_type, state, scope_description, valid_from, valid_until, activated_at, closed_at)
         VALUES ($1, 'CALIENTE', 'CERRADO', 'Trabajo de prueba', now() - interval '3 hours',
                 now() - interval '1 hour', now() - interval '3 hours', now() - interval '2 hours')`,
        [permitId],
      );
      const result = await runExpiriesJob(tx);
      expect(result.permitsExpired).not.toContain(permitId);
    });
  });

  it('moves an overdue EMITIDA directive to EXPIRADA and logs why', async () => {
    await inRollbackTx(async (tx) => {
      const directiveId = await makeDirective(tx, { state: 'EMITIDA', validUntil: new Date(Date.now() - 60_000) });

      const result = await runExpiriesJob(tx);
      expect(result.directivesExpired).toContain(directiveId);

      const { rows } = await tx.query<{ state: string; expired_at: Date | null }>(
        'SELECT state::text AS state, expired_at FROM control.directives WHERE id = $1',
        [directiveId],
      );
      expect(rows[0]!.state).toBe('EXPIRADA');
      expect(rows[0]!.expired_at).not.toBeNull();

      const events = await tx.query<{ event_type: string; to_state: string }>(
        'SELECT event_type, to_state::text AS to_state FROM control.directive_events WHERE directive_id = $1',
        [directiveId],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]!.to_state).toBe('EXPIRADA');
    });
  });

  it('leaves a directive with no valid_until untouched (not every directive expires)', async () => {
    await inRollbackTx(async (tx) => {
      const directiveId = await makeDirective(tx, { state: 'RECIBIDA', validUntil: null });
      const result = await runExpiriesJob(tx);
      expect(result.directivesExpired).not.toContain(directiveId);
    });
  });
});
