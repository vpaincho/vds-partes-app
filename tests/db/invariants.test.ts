/**
 * Schema-level invariants, executed against a real PostgreSQL.
 *
 * Every assertion here corresponds to a numbered invariant, forbidden transition or regression in
 * S2 / 17_ACCEPTANCE_TESTS. The suite exists because "the schema enforces C-009" is a claim that
 * is worthless unless the database actually refuses the write — and because several of these are
 * precisely the mutations the prototype performed routinely.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  closePool,
  expectRefused,
  inRollbackTx,
  makeClient,
  makeExecutionUnit,
  makeExecutionUnitVersion,
  makeIdentity,
  makePart,
  makePartType,
  makeService,
  makeUnitOfMeasure,
  uuid,
  type Tx,
} from './helpers.ts';

afterAll(closePool);

describe('C-002 / P-02 — append-only tables refuse UPDATE and DELETE', () => {
  it('refuses to edit or delete a DecisionTrace', async () => {
    await inRollbackTx(async (tx) => {
      const actor = await makeIdentity(tx);
      const id = uuid();
      await tx.query(
        `INSERT INTO platform.decision_traces
           (id, decision, subject_kind, trigger, actor_id, normalized_inputs, context_hash,
            preview, decision_at)
         VALUES ($1, 'BLOCK', 'UnidadEjecucion', 'START_WORK', $2, '{}'::jsonb, 'h', false, now())`,
        [id, actor],
      );

      await expectRefused(
        tx,
        (t) => t.query('UPDATE platform.decision_traces SET decision = $1 WHERE id = $2', ['ALLOW', id]),
        { matches: /append-only/, hint: /never erases an earlier one/ },
      );
      await expectRefused(
        tx,
        (t) => t.query('DELETE FROM platform.decision_traces WHERE id = $1', [id]),
        { matches: /append-only/ },
      );
    });
  });

  it('refuses to rewrite a command receipt — RGT-06 depends on it surviving', async () => {
    await inRollbackTx(async (tx) => {
      const actor = await makeIdentity(tx);
      const id = uuid();
      await tx.query(
        `INSERT INTO platform.command_receipts
           (id, scope_id, command_id, command_type, subject_kind, actor_id, outcome,
            payload_hash, occurred_at, recorded_at)
         VALUES ($1, $2, $3, 'execution.start', 'UnidadEjecucion', $4, 'APPLIED', 'h1', now(), now())`,
        [id, uuid(), uuid(), actor],
      );
      await expectRefused(
        tx,
        (t) => t.query('UPDATE platform.command_receipts SET outcome = $1 WHERE id = $2', ['NO_OP', id]),
        { matches: /append-only/ },
      );
    });
  });

  it('refuses to delete a UC source link — C-030 lineage must survive', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'EN_EJECUCION' });
      const ue = await makeExecutionUnit(tx, part, { state: 'CERRADA' });
      const version = await makeExecutionUnitVersion(tx, ue);
      const { ucId } = await makeCommercialUnit(tx, { state: 'INCOMPLETA' });
      const linkId = uuid();
      await tx.query(
        `INSERT INTO commercial.commercial_unit_source_links
           (id, commercial_unit_id, execution_unit_version_id, contribution_quantity)
         VALUES ($1, $2, $3, 10)`,
        [linkId, ucId, version],
      );
      await expectRefused(
        tx,
        (t) => t.query('DELETE FROM commercial.commercial_unit_source_links WHERE id = $1', [linkId]),
        { matches: /append-only/ },
      );
    });
  });
});

describe('R-022 / RGT-03 — an approved plan version is immutable', () => {
  async function makeApprovedPlan(tx: Tx): Promise<{ planId: string; versionId: string; assignmentId: string }> {
    const actor = await makeIdentity(tx);
    const planId = uuid();
    const versionId = uuid();
    const assignmentId = uuid();
    await tx.query(`INSERT INTO planning.plans (id, name, state) VALUES ($1, 'Plan', 'ACTIVA')`, [planId]);
    await tx.query(
      `INSERT INTO planning.plan_versions (id, plan_id, version_no, state, approved_at, approved_by)
       VALUES ($1, $2, 1, 'APROBADA', now(), $3)`,
      [versionId, planId, actor],
    );
    // DESPACHADA requires dispatched_at by constraint, so it is set in the same insert: the
    // state and the evidence for it arrive together.
    await tx.query(
      `INSERT INTO planning.planned_assignments
         (id, plan_version_id, state, window_start, window_end, dispatched_at)
       VALUES ($1, $2, 'DESPACHADA', '2026-10-05T09:00:00Z', '2026-10-10T18:00:00Z', now())`,
      [assignmentId, versionId],
    );
    return { planId, versionId, assignmentId };
  }

  it('refuses to shorten the approved window when a crew finishes early', async () => {
    await inRollbackTx(async (tx) => {
      const { assignmentId } = await makeApprovedPlan(tx);
      // index.html:1629 did exactly this: t.dias = p.dia + 1 on an early finish.
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `UPDATE planning.planned_assignments SET window_end = '2026-10-07T18:00:00Z' WHERE id = $1`,
            [assignmentId],
          ),
        { matches: /scope is immutable/, hint: /DirectivaOperativa|new PlanificacionVersion/ },
      );
    });
  });

  it('refuses to edit an approved version, and to delete any version', async () => {
    await inRollbackTx(async (tx) => {
      const { versionId } = await makeApprovedPlan(tx);
      await expectRefused(
        tx,
        (t) => t.query(`UPDATE planning.plan_versions SET state = 'BORRADOR' WHERE id = $1`, [versionId]),
        { matches: /APROBADA and immutable/, hint: /create a new\s+version/ },
      );
      await expectRefused(
        tx,
        (t) => t.query('DELETE FROM planning.plan_versions WHERE id = $1', [versionId]),
        { matches: /cannot be deleted/ },
      );
    });
  });

  it('still allows the one legitimate change: becoming SUPERSEDIDA', async () => {
    await inRollbackTx(async (tx) => {
      const { versionId } = await makeApprovedPlan(tx);
      const result = await tx.attempt((t) =>
        t.query(`UPDATE planning.plan_versions SET state = 'SUPERSEDIDA' WHERE id = $1`, [versionId]),
      );
      expect(result.ok, 'replanning must remain possible').toBe(true);
    });
  });

  it('allows state and result timestamps to change on a dispatched assignment', async () => {
    await inRollbackTx(async (tx) => {
      const { assignmentId } = await makeApprovedPlan(tx);
      // The intention is frozen; the outcome of that intention is not.
      const result = await tx.attempt((t) =>
        t.query(
          `UPDATE planning.planned_assignments
           SET state = 'CUMPLIDA', fulfilled_at = now() WHERE id = $1`,
          [assignmentId],
        ),
      );
      expect(result.ok).toBe(true);
    });
  });
});

describe('TPR-007 / TPR-010 — closed operational objects do not reopen', () => {
  it('refuses to move a closed Parte back to EN_EJECUCION', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'EN_EJECUCION' });
      await makeExecutionUnit(tx, part, { state: 'CERRADA' });
      await tx.query(
        `UPDATE execution.parts SET state = 'CERRADO_OPERATIVAMENTE', closed_at = now() WHERE id = $1`,
        [part.partId],
      );
      await tx.checkDeferred();

      // index.html:1577 a-reopen did this with a single click.
      await expectRefused(
        tx,
        (t) => t.query(`UPDATE execution.parts SET state = 'EN_EJECUCION' WHERE id = $1`, [part.partId]),
        { matches: /cannot return to/, hint: /EnmiendaOperativa/ },
      );
    });
  });

  it('refuses to reopen or edit the facts of a closed UE', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'EN_EJECUCION' });
      const ue = await makeExecutionUnit(tx, part, { state: 'CERRADA' });

      await expectRefused(
        tx,
        (t) => t.query(`UPDATE execution.execution_units SET state = 'EN_EJECUCION' WHERE id = $1`, [ue]),
        { matches: /terminal/, hint: /EnmiendaOperativa/ },
      );
      await expectRefused(
        tx,
        (t) =>
          t.query(`UPDATE execution.execution_units SET description = 'corregido' WHERE id = $1`, [ue]),
        { matches: /operational facts are immutable/, hint: /old\/new, reason, evidence/ },
      );
    });
  });

  it('refuses to delete a Parte or a UE at all', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx);
      const ue = await makeExecutionUnit(tx, part);
      await expectRefused(tx, (t) => t.query('DELETE FROM execution.execution_units WHERE id = $1', [ue]), {
        matches: /never deleted/,
      });
      await expectRefused(tx, (t) => t.query('DELETE FROM execution.parts WHERE id = $1', [part.partId]), {
        matches: /never deleted/,
      });
    });
  });

  it('still allows the current version pointer to move — that is how an amendment lands', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'EN_EJECUCION' });
      const ue = await makeExecutionUnit(tx, part, { state: 'CERRADA' });
      const v1 = await makeExecutionUnitVersion(tx, ue);
      const result = await tx.attempt((t) =>
        t.query('UPDATE execution.execution_units SET current_version_id = $1 WHERE id = $2', [v1, ue]),
      );
      expect(result.ok).toBe(true);
    });
  });
});

describe('C-009 — a started Parte has at least one UE, checked at commit', () => {
  it('allows PREPARADO with zero UE — the association sheet 42 leaves optional', async () => {
    await inRollbackTx(async (tx) => {
      await makePart(tx, { state: 'PREPARADO' });
      // Over-tightening this to NOT NULL is what 04 warns against.
      const result = await tx.attempt((t) => t.checkDeferred());
      expect(result.ok).toBe(true);
    });
  });

  it('refuses EN_EJECUCION with zero UE', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'PREPARADO' });
      await tx.query(`UPDATE execution.parts SET state = 'EN_EJECUCION', started_at = now() WHERE id = $1`, [
        part.partId,
      ]);
      await expectRefused(tx, (t) => t.checkDeferred(), {
        matches: /with no UnidadEjecucion/,
        hint: /operational grain/,
      });
    });
  });

  it('accepts a Parte and its first UE created in the same transaction', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'PREPARADO' });
      // Start Work writes the state change and the first UE together; order must not matter.
      await tx.query(`UPDATE execution.parts SET state = 'EN_EJECUCION', started_at = now() WHERE id = $1`, [
        part.partId,
      ]);
      await makeExecutionUnit(tx, part, { state: 'EN_EJECUCION' });
      const result = await tx.attempt((t) => t.checkDeferred());
      expect(result.ok, 'the deferred check is what makes one-transaction Start Work possible').toBe(true);
    });
  });
});

describe('TPR-009 / RUL-034 — a Parte cannot close over unresolved work', () => {
  it('refuses closure while a UE is not terminal', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'EN_EJECUCION' });
      await makeExecutionUnit(tx, part, { state: 'EN_EJECUCION' });
      await tx.query(
        `UPDATE execution.parts SET state = 'CERRADO_OPERATIVAMENTE', closed_at = now() WHERE id = $1`,
        [part.partId],
      );
      await expectRefused(tx, (t) => t.checkDeferred(), {
        matches: /unit\(s\) are not terminal/,
        hint: /CERRADA, NO_REALIZADA or ANULADA/,
      });
    });
  });

  it('refuses closure while a time interval is still open', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'EN_EJECUCION' });
      const ue = await makeExecutionUnit(tx, part, { state: 'CERRADA' });
      await tx.query(
        `INSERT INTO execution.time_events (id, part_id, execution_unit_id, time_category, started_at)
         VALUES ($1, $2, $3, 'OPERATIVO', now() - interval '1 hour')`,
        [uuid(), part.partId, ue],
      );
      await tx.query(
        `UPDATE execution.parts SET state = 'CERRADO_OPERATIVAMENTE', closed_at = now() WHERE id = $1`,
        [part.partId],
      );
      await expectRefused(tx, (t) => t.checkDeferred(), { matches: /open time interval/ });
    });
  });

  it('allows closure once every UE is terminal and intervals are closed', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'EN_EJECUCION' });
      await makeExecutionUnit(tx, part, { state: 'CERRADA' });
      await makeExecutionUnit(tx, part, {
        state: 'NO_REALIZADA',
        result: 'NO_REALIZADA',
        resultReason: 'Clima: ráfagas de 72 km/h entre 12:00 y 13:30',
      });
      await tx.query(
        `UPDATE execution.parts SET state = 'CERRADO_OPERATIVAMENTE', closed_at = now() WHERE id = $1`,
        [part.partId],
      );
      const result = await tx.attempt((t) => t.checkDeferred());
      expect(result.ok).toBe(true);
    });
  });
});

describe('C-004 / AP-06 — an allocation never invents a wildcard code', () => {
  it('refuses RESUELTO without contract service, cost centre and item', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'EN_EJECUCION' });
      const ue = await makeExecutionUnit(tx, part, { state: 'EN_EJECUCION' });
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO execution.execution_allocations (id, execution_unit_id, status)
             VALUES ($1, $2, 'RESUELTO')`,
            [uuid(), ue],
          ),
        { matches: /allocations_resolved_is_complete/ },
      );
    });
  });

  it('refuses an unresolved allocation with no stated reason', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'EN_EJECUCION' });
      const ue = await makeExecutionUnit(tx, part, { state: 'EN_EJECUCION' });
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO execution.execution_allocations (id, execution_unit_id, status)
             VALUES ($1, $2, 'PENDIENTE')`,
            [uuid(), ue],
          ),
        { matches: /allocations_unresolved_has_reason/ },
      );
    });
  });

  it('accepts PENDIENTE with an explicit reason — reality still records (RGT-12)', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'EN_EJECUCION' });
      const ue = await makeExecutionUnit(tx, part, { state: 'EN_EJECUCION' });
      const result = await tx.attempt((t) =>
        t.query(
          `INSERT INTO execution.execution_allocations
             (id, execution_unit_id, status, pending_reason)
           VALUES ($1, $2, 'PENDIENTE_CONFIGURACION', 'Falta ReglaGranoUnidadComercial del contrato')`,
          [uuid(), ue],
        ),
      );
      expect(result.ok).toBe(true);
    });
  });
});

describe('C-018 — a hard block never carries an override path', () => {
  it('refuses a HARD_BLOCK requirement that declares an override gate', async () => {
    await inRollbackTx(async (tx) => {
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO habilita.requirements
               (id, code, name, requirement_type, applies_to, severity, overrideable_via, valid_from)
             VALUES ($1, $2, 'Inducción vigente', 'INDUCTION', 'PERSON', 'HARD_BLOCK', 'GATE-X', '2026-01-01')`,
            [uuid(), `RQ-${uuid().slice(0, 8)}`],
          ),
        { matches: /requirements_hard_block_not_overrideable/ },
      );
    });
  });

  it('allows a WARNING to declare one', async () => {
    await inRollbackTx(async (tx) => {
      const result = await tx.attempt((t) =>
        t.query(
          `INSERT INTO habilita.requirements
             (id, code, name, requirement_type, applies_to, severity, overrideable_via, valid_from)
           VALUES ($1, $2, 'Documento por vencer', 'DOC', 'PERSON', 'WARNING', 'GATE-DOC-SOON', '2026-01-01')`,
          [uuid(), `RQ-${uuid().slice(0, 8)}`],
        ),
      );
      expect(result.ok).toBe(true);
    });
  });

  it('refuses an override with no substantive reason', async () => {
    await inRollbackTx(async (tx) => {
      const actor = await makeIdentity(tx);
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO habilita.override_gates
               (id, gate_id, rule_id, authorised_by, reason, authorised_at)
             VALUES ($1, 'GATE-DOC-SOON', 'RUL-040', $2, 'ok', now())`,
            [uuid(), actor],
          ),
        { matches: /override_gates_reason_substantive/ },
      );
    });
  });
});

describe('TPR-016 / C-017 — emission is not application', () => {
  it('refuses APLICADA without receipt and recorded effect', async () => {
    await inRollbackTx(async (tx) => {
      const actor = await makeIdentity(tx);
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO control.directives
               (id, directive_type, state, reason, issued_by, issued_at, applied_at)
             VALUES ($1, 'SUSPENDER', 'APLICADA', 'Evento Habilita no controlado', $2, now(), now())`,
            [uuid(), actor],
          ),
        { matches: /directives_applied_requires_receipt_and_effect/ },
      );
    });
  });

  it('accepts the full lifecycle: emitted, received, acknowledged, applied with an effect', async () => {
    await inRollbackTx(async (tx) => {
      const actor = await makeIdentity(tx);
      const id = uuid();
      await tx.query(
        `INSERT INTO control.directives (id, directive_type, state, reason, issued_by, issued_at)
         VALUES ($1, 'SUSPENDER', 'EMITIDA', 'Evento Habilita no controlado', $2, now() - interval '1 hour')`,
        [id, actor],
      );
      const result = await tx.attempt((t) =>
        t.query(
          `UPDATE control.directives
           SET state = 'APLICADA', received_at = now() - interval '30 minutes',
               acknowledged_at = now() - interval '20 minutes', applied_at = now(),
               applied_effect_ref = '{"kind":"UE_SUSPENDED","id":"x"}'::jsonb
           WHERE id = $1`,
          [id],
        ),
      );
      expect(result.ok).toBe(true);
    });
  });

  it('refuses an impossible timestamp order', async () => {
    await inRollbackTx(async (tx) => {
      const actor = await makeIdentity(tx);
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO control.directives
               (id, directive_type, state, reason, issued_by, issued_at, received_at)
             VALUES ($1, 'CANCELAR', 'RECIBIDA', 'motivo', $2, now(), now() - interval '1 hour')`,
            [uuid(), actor],
          ),
        { matches: /directives_timestamps_ordered/ },
      );
    });
  });
});

describe('RGT-01 / PL-093 — a self-conflict cannot be stored', () => {
  it('refuses a conflict row whose two sides are the same object', async () => {
    await inRollbackTx(async (tx) => {
      const sameId = uuid();
      const client = await makeClient(tx);
      const personId = uuid();
      await tx.query(
        `INSERT INTO config.people (id, first_name, last_name, provenance)
         VALUES ($1, 'Hugo', 'Ruiz', 'FIXTURE_TEST')`,
        [personId],
      );
      void client;
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO planning.temporal_conflicts
               (id, subject_kind, person_id, candidate_kind, candidate_id, incumbent_kind,
                incumbent_id, overlap_from, overlap_until, overlap_minutes, verdict)
             VALUES ($1, 'PERSON', $2, 'PLANNED_ASSIGNMENT', $3, 'PLANNED_ASSIGNMENT', $3,
                     now(), now() + interval '1 hour', 60, 'BLOCK')`,
            [uuid(), personId, sameId],
          ),
        { matches: /temporal_conflicts_not_self/ },
      );
    });
  });

  it('accepts a conflict between two genuinely different assignments', async () => {
    await inRollbackTx(async (tx) => {
      const personId = uuid();
      await tx.query(
        `INSERT INTO config.people (id, first_name, last_name, provenance)
         VALUES ($1, 'Hugo', 'Ruiz', 'FIXTURE_TEST')`,
        [personId],
      );
      const result = await tx.attempt((t) =>
        t.query(
          `INSERT INTO planning.temporal_conflicts
             (id, subject_kind, person_id, candidate_kind, candidate_id, incumbent_kind,
              incumbent_id, overlap_from, overlap_until, overlap_minutes, verdict)
           VALUES ($1, 'PERSON', $2, 'PLANNED_ASSIGNMENT', $3, 'PLANNED_ASSIGNMENT', $4,
                   now(), now() + interval '1 hour', 60, 'BLOCK')`,
          [uuid(), personId, uuid(), uuid()],
        ),
      );
      expect(result.ok, 'a real overlap must still be recordable').toBe(true);
    });
  });
});

/* ------------------------------------------------------------- commercial / billing */

async function makeCommercialUnit(
  tx: Tx,
  options: { state?: string; supersession?: string; quantity?: number } = {},
): Promise<{ ucId: string; itemId: string; umId: string; csId: string }> {
  const clientId = await makeClient(tx);
  const serviceId = await makeService(tx);
  const umId = await makeUnitOfMeasure(tx);
  const contractId = uuid();
  const contractVersionId = uuid();
  const csId = uuid();
  const itemId = uuid();
  const ucId = uuid();

  await tx.query(
    `INSERT INTO config.contracts (id, code, client_id, name, provenance)
     VALUES ($1, $2, $3, 'Contrato', 'FIXTURE_TEST')`,
    [contractId, `CT-${contractId.slice(0, 8)}`, clientId],
  );
  await tx.query(
    `INSERT INTO config.contract_versions (id, contract_id, version_no, valid_from, status)
     VALUES ($1, $2, 1, '2026-01-01', 'PUBLISHED')`,
    [contractVersionId, contractId],
  );
  await tx.query(
    `INSERT INTO config.contract_services (id, contract_version_id, service_id)
     VALUES ($1, $2, $3)`,
    [csId, contractVersionId, serviceId],
  );
  await tx.query(
    `INSERT INTO config.contract_items (id, contract_service_id, unit_of_measure_id, code, description)
     VALUES ($1, $2, $3, 'IT-1', 'Item')`,
    [itemId, csId, umId],
  );

  const state = options.state ?? 'ACEPTADA';
  const quantity = options.quantity ?? 100;
  await tx.query(
    `INSERT INTO commercial.commercial_units
       (id, contract_service_id, contract_item_id, unit_of_measure_id, state, supersession_state,
        quantity, derived_at, eligible_at, accepted_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::commercial.unit_state,
             $6::commercial.supersession_state, $7::numeric, now(),
             CASE WHEN $5::text = 'INCOMPLETA' THEN NULL ELSE now() END,
             CASE WHEN $5::text = 'ACEPTADA' THEN now() ELSE NULL END)`,
    [ucId, csId, itemId, umId, state, options.supersession ?? 'VIGENTE', quantity],
  );
  return { ucId, itemId, umId, csId };
}

describe('TPR-025 / C-031 — an accepted UC is corrected by supersession, never in place', () => {
  it('refuses to move an accepted UC back to ELEGIBLE', async () => {
    await inRollbackTx(async (tx) => {
      const { ucId } = await makeCommercialUnit(tx, { state: 'ACEPTADA' });
      await expectRefused(
        tx,
        (t) => t.query(`UPDATE commercial.commercial_units SET state = 'ELEGIBLE' WHERE id = $1`, [ucId]),
        { matches: /ACEPTADA: it cannot move/, hint: /supersession/ },
      );
    });
  });

  it('refuses to change the quantity of an accepted UC', async () => {
    await inRollbackTx(async (tx) => {
      const { ucId } = await makeCommercialUnit(tx, { state: 'ACEPTADA' });
      await expectRefused(
        tx,
        (t) => t.query('UPDATE commercial.commercial_units SET quantity = 999 WHERE id = $1', [ucId]),
        { matches: /quantity and item are immutable/, hint: /C-031/ },
      );
    });
  });

  it('allows the parallel supersession dimension to change — RUL-065', async () => {
    await inRollbackTx(async (tx) => {
      const { ucId } = await makeCommercialUnit(tx, { state: 'ACEPTADA' });
      // An amended source marks the accepted UC as needing recalculation without undoing the
      // acceptance of the version that was accepted.
      const result = await tx.attempt((t) =>
        t.query(
          `UPDATE commercial.commercial_units SET supersession_state = 'REQUIERE_RECALCULO' WHERE id = $1`,
          [ucId],
        ),
      );
      expect(result.ok).toBe(true);
    });
  });

  it('refuses a supersession cycle (C-034)', async () => {
    await inRollbackTx(async (tx) => {
      const a = await makeCommercialUnit(tx, { state: 'ELEGIBLE' });
      const b = await makeCommercialUnit(tx, { state: 'ELEGIBLE' });
      await tx.query('UPDATE commercial.commercial_units SET supersedes_id = $1 WHERE id = $2', [
        a.ucId,
        b.ucId,
      ]);
      await expectRefused(
        tx,
        (t) =>
          t.query('UPDATE commercial.commercial_units SET supersedes_id = $1 WHERE id = $2', [b.ucId, a.ucId]),
        { matches: /supersession cycle/, hint: /acyclic/ },
      );
    });
  });
});

describe('RUL-070 / RGT-13 — only an accepted, current UC can be billed', () => {
  it('refuses a line from a UC that is not accepted', async () => {
    await inRollbackTx(async (tx) => {
      const { ucId, itemId, umId } = await makeCommercialUnit(tx, { state: 'ELEGIBLE' });
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO billing.billable_lines
               (id, commercial_unit_id, quantity, unit_of_measure_id, contract_item_id)
             VALUES ($1, $2, 10, $3, $4)`,
            [uuid(), ucId, umId, itemId],
          ),
        { matches: /only an ACEPTADA unit can be billed/, hint: /RUL-070/ },
      );
    });
  });

  it('refuses a line from an accepted UC whose source was amended (RGT-13)', async () => {
    await inRollbackTx(async (tx) => {
      const { ucId, itemId, umId } = await makeCommercialUnit(tx, {
        state: 'ACEPTADA',
        supersession: 'REQUIERE_RECALCULO',
      });
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO billing.billable_lines
               (id, commercial_unit_id, quantity, unit_of_measure_id, contract_item_id)
             VALUES ($1, $2, 10, $3, $4)`,
            [uuid(), ucId, umId, itemId],
          ),
        { matches: /no longer current/, hint: /projection has not caught up/ },
      );
    });
  });

  it('allows a line from an accepted, current UC', async () => {
    await inRollbackTx(async (tx) => {
      const { ucId, itemId, umId } = await makeCommercialUnit(tx, { state: 'ACEPTADA' });
      const result = await tx.attempt((t) =>
        t.query(
          `INSERT INTO billing.billable_lines
             (id, commercial_unit_id, quantity, unit_of_measure_id, contract_item_id)
           VALUES ($1, $2, 10, $3, $4)`,
          [uuid(), ucId, umId, itemId],
        ),
      );
      expect(result.ok).toBe(true);
    });
  });

  it('refuses ACEPTADO_ERP without a validated send', async () => {
    await inRollbackTx(async (tx) => {
      const clientId = await makeClient(tx);
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO billing.billing_lots (id, client_id, state, accepted_at)
             VALUES ($1, $2, 'ACEPTADO_ERP', now())`,
            [uuid(), clientId],
          ),
        { matches: /billing_lots_(accepted_requires_send|sent_requires_validation)/ },
      );
    });
  });
});

describe('MR-09 — typed targets, never an opaque polymorphic id', () => {
  it('refuses an evidence link with two targets at once', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx);
      const ue = await makeExecutionUnit(tx, part);
      const evidenceId = uuid();
      await tx.query(
        `INSERT INTO evidence.evidence (id, evidence_type, captured_at) VALUES ($1, 'PHOTO', now())`,
        [evidenceId],
      );
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO evidence.evidence_links
               (id, evidence_id, target_kind, part_id, execution_unit_id)
             VALUES ($1, $2, 'PART', $3, $4)`,
            [uuid(), evidenceId, part.partId, ue],
          ),
        { matches: /evidence_links_exactly_one_target/ },
      );
    });
  });

  it('refuses an evidence link with no target', async () => {
    await inRollbackTx(async (tx) => {
      const evidenceId = uuid();
      await tx.query(
        `INSERT INTO evidence.evidence (id, evidence_type, captured_at) VALUES ($1, 'SIGNATURE', now())`,
        [evidenceId],
      );
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO evidence.evidence_links (id, evidence_id, target_kind)
             VALUES ($1, $2, 'PART')`,
            [uuid(), evidenceId],
          ),
        { matches: /evidence_links_exactly_one_target/ },
      );
    });
  });

  it('refuses a directive target whose kind contradicts the populated column', async () => {
    await inRollbackTx(async (tx) => {
      const actor = await makeIdentity(tx);
      const part = await makePart(tx);
      const directiveId = uuid();
      await tx.query(
        `INSERT INTO control.directives (id, directive_type, state, reason, issued_by, issued_at)
         VALUES ($1, 'SUSPENDER', 'EMITIDA', 'motivo suficiente', $2, now())`,
        [directiveId, actor],
      );
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO control.directive_targets (id, directive_id, target_kind, part_id)
             VALUES ($1, $2, 'WORK_PERMIT', $3)`,
            [uuid(), directiveId, part.partId],
          ),
        { matches: /directive_targets_(kind_matches|exactly_one)/ },
      );
    });
  });
});

describe('RGT-09 — evidence and delivery cannot claim more than happened', () => {
  it('refuses STORED evidence without object key, hash and size', async () => {
    await inRollbackTx(async (tx) => {
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO evidence.evidence (id, evidence_type, captured_at, upload_status)
             VALUES ($1, 'PHOTO', now(), 'STORED')`,
            [uuid()],
          ),
        { matches: /evidence_stored_is_complete/ },
      );
    });
  });

  it('refuses a COMPLETE upload that received fewer bytes than it declared', async () => {
    await inRollbackTx(async (tx) => {
      const evidenceId = uuid();
      await tx.query(
        `INSERT INTO evidence.evidence (id, evidence_type, captured_at) VALUES ($1, 'PHOTO', now())`,
        [evidenceId],
      );
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO sync.evidence_uploads
               (id, evidence_id, upload_token, byte_size, bytes_received, content_hash, status, completed_at)
             VALUES ($1, $2, $3, 1000, 400, 'h', 'COMPLETE', now())`,
            [uuid(), evidenceId, uuid()],
          ),
        { matches: /evidence_uploads_complete_is_whole/ },
      );
    });
  });

  it('refuses RECIBIDO delivery state with no receipt — the "Sincronizado" lie', async () => {
    await inRollbackTx(async (tx) => {
      const deviceId = uuid();
      await tx.query(`INSERT INTO platform.devices (id, label) VALUES ($1, 'Tablet 1')`, [deviceId]);
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO sync.delivery_status
               (id, command_id, device_id, scope_id, state, command_type)
             VALUES ($1, $2, $3, $4, 'RECIBIDO', 'execution.start')`,
            [uuid(), uuid(), deviceId, uuid()],
          ),
        { matches: /delivery_status_recibido_requires_receipt/ },
      );
    });
  });

  it('allows ENVIADO with no receipt — transmitted is not committed', async () => {
    await inRollbackTx(async (tx) => {
      const deviceId = uuid();
      await tx.query(`INSERT INTO platform.devices (id, label) VALUES ($1, 'Tablet 1')`, [deviceId]);
      const result = await tx.attempt((t) =>
        t.query(
          `INSERT INTO sync.delivery_status
             (id, command_id, device_id, scope_id, state, command_type)
           VALUES ($1, $2, $3, $4, 'ENVIADO', 'execution.start')`,
          [uuid(), uuid(), deviceId, uuid()],
        ),
      );
      expect(result.ok).toBe(true);
    });
  });
});

describe('idempotency keys', () => {
  it('refuses a second receipt for the same (scope, command) — RGT-06', async () => {
    await inRollbackTx(async (tx) => {
      const actor = await makeIdentity(tx);
      const scopeId = uuid();
      const commandId = uuid();
      const insert = (hash: string) =>
        tx.query(
          `INSERT INTO platform.command_receipts
             (id, scope_id, command_id, command_type, subject_kind, actor_id, outcome,
              payload_hash, occurred_at, recorded_at)
           VALUES ($1, $2, $3, 'execution.start', 'UnidadEjecucion', $4, 'APPLIED', $5, now(), now())`,
          [uuid(), scopeId, commandId, actor, hash],
        );
      await insert('hash-1');
      // A retry with a different payload must be a typed conflict, not a second effect (RGT-07).
      await expectRefused(tx, () => insert('hash-2'), {
        matches: /command_receipts_scope_command_unique/,
      });
    });
  });

  it('refuses a duplicate ERP idempotency key', async () => {
    await inRollbackTx(async (tx) => {
      const clientId = await makeClient(tx);
      const lotId = uuid();
      await tx.query(
        `INSERT INTO billing.billing_lots (id, client_id, state, validated_at)
         VALUES ($1, $2, 'VALIDADO', now())`,
        [lotId, clientId],
      );
      const key = `idem-${uuid()}`;
      const insert = (attempt: number) =>
        tx.query(
          `INSERT INTO billing.erp_submission_attempts
             (id, billing_lot_id, attempt_no, payload, payload_hash, idempotency_key, provider_kind)
           VALUES ($1, $2, $3, '{}'::jsonb, 'h', $4, 'TEST_FIXTURE')`,
          [uuid(), lotId, attempt, key],
        );
      await insert(1);
      await expectRefused(tx, () => insert(2), { matches: /erp_attempts_idempotency_unique/ });
    });
  });

  it('refuses ACCEPTED ERP attempt without an external reference', async () => {
    await inRollbackTx(async (tx) => {
      const clientId = await makeClient(tx);
      const lotId = uuid();
      await tx.query(
        `INSERT INTO billing.billing_lots (id, client_id, state, validated_at)
         VALUES ($1, $2, 'VALIDADO', now())`,
        [lotId, clientId],
      );
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO billing.erp_submission_attempts
               (id, billing_lot_id, attempt_no, payload, payload_hash, idempotency_key,
                provider_kind, status)
             VALUES ($1, $2, 1, '{}'::jsonb, 'h', $3, 'TEST_FIXTURE', 'ACCEPTED')`,
            [uuid(), lotId, uuid()],
          ),
        { matches: /erp_attempts_accepted_has_ref/ },
      );
    });
  });
});

describe('TPR-024 — a case does not close over unverified blocking actions', () => {
  async function makeCaseWithAction(
    tx: Tx,
    options: { blocking: boolean; actionState: string },
  ): Promise<string> {
    const actor = await makeIdentity(tx);
    const eventId = uuid();
    const caseId = uuid();
    await tx.query(
      `INSERT INTO habilita.events
         (id, state, initial_category, short_description, situation_controlled, reported_by,
          occurred_at, reported_at)
       VALUES ($1, 'ESCALADO_A_CASO', 'DERRAME', 'Derrame menor en batería', true, $2,
               now() - interval '2 hours', now() - interval '1 hour')`,
      [eventId, actor],
    );
    await tx.query(
      `INSERT INTO habilita.cases
         (id, event_id, state, investigation_state, opened_at, investigation_finished_at)
       VALUES ($1, $2, 'SEGUIMIENTO_ACCIONES', 'FINALIZADA', now() - interval '1 hour', now())`,
      [caseId, eventId],
    );
    await tx.query(
      `INSERT INTO habilita.corrective_actions
         (id, case_id, state, description, is_blocking, responsible_id, verified_at, verified_by)
       VALUES ($1::uuid, $2::uuid, $3::habilita.action_state, 'Reemplazar sello de la brida',
               $4::boolean, $5::uuid,
               CASE WHEN $3::text = 'VERIFICADA' THEN now() ELSE NULL END,
               CASE WHEN $3::text = 'VERIFICADA' THEN $5::uuid ELSE NULL END)`,
      [uuid(), caseId, options.actionState, options.blocking, actor],
    );
    return caseId;
  }

  it('refuses closure with a blocking action still pending', async () => {
    await inRollbackTx(async (tx) => {
      const caseId = await makeCaseWithAction(tx, { blocking: true, actionState: 'PENDIENTE' });
      await tx.query(
        `UPDATE habilita.cases SET state = 'CERRADO', closed_at = now() WHERE id = $1`,
        [caseId],
      );
      await expectRefused(tx, (t) => t.checkDeferred(), {
        matches: /blocking action\(s\) unverified/,
        hint: /non-blocking/,
      });
    });
  });

  it('allows closure when the blocking action is verified', async () => {
    await inRollbackTx(async (tx) => {
      const caseId = await makeCaseWithAction(tx, { blocking: true, actionState: 'VERIFICADA' });
      await tx.query(
        `UPDATE habilita.cases SET state = 'CERRADO', closed_at = now() WHERE id = $1`,
        [caseId],
      );
      const result = await tx.attempt((t) => t.checkDeferred());
      expect(result.ok).toBe(true);
    });
  });

  it('allows closure with a NON-blocking action open — B-09 makes this configurable', async () => {
    await inRollbackTx(async (tx) => {
      const caseId = await makeCaseWithAction(tx, { blocking: false, actionState: 'EN_PROGRESO' });
      await tx.query(
        `UPDATE habilita.cases SET state = 'CERRADO', closed_at = now() WHERE id = $1`,
        [caseId],
      );
      const result = await tx.attempt((t) => t.checkDeferred());
      expect(result.ok, 'an investigation may finish while actions continue (T-CH03)').toBe(true);
    });
  });

  it('refuses closing a case whose investigation is still open (TPR-023)', async () => {
    await inRollbackTx(async (tx) => {
      const actor = await makeIdentity(tx);
      const eventId = uuid();
      const caseId = uuid();
      await tx.query(
        `INSERT INTO habilita.events
           (id, state, initial_category, short_description, situation_controlled, reported_by,
            occurred_at, reported_at)
         VALUES ($1, 'ESCALADO_A_CASO', 'CASI_ACCIDENTE', 'Casi accidente', true, $2, now(), now())`,
        [eventId, actor],
      );
      await tx.query(
        `INSERT INTO habilita.cases (id, event_id, state, investigation_state, opened_at)
         VALUES ($1, $2, 'EN_INVESTIGACION', 'EN_CURSO', now())`,
        [caseId, eventId],
      );
      await expectRefused(
        tx,
        (t) =>
          t.query(`UPDATE habilita.cases SET state = 'CERRADO', closed_at = now() WHERE id = $1`, [caseId]),
        { matches: /cases_closed_requires_finished_investigation/ },
      );
    });
  });
});

describe('structural guards', () => {
  it('refuses a fourth TipoParte — FZ-03 / RF-01 needs Change Control, not a row', async () => {
    await inRollbackTx(async (tx) => {
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO config.part_types (id, code, name, description)
             VALUES ($1, 'TP-04', 'Nuevo patrón', 'inventado')`,
            [uuid()],
          ),
        { matches: /part_types_frozen_catalogue/ },
      );
    });
  });

  it('refuses a cycle in the technical location tree (R-012)', async () => {
    await inRollbackTx(async (tx) => {
      const a = uuid();
      const b = uuid();
      await tx.query(
        `INSERT INTO config.technical_locations (id, code, name, provenance)
         VALUES ($1, $2, 'Yacimiento', 'FIXTURE_TEST')`,
        [a, `TL-${a.slice(0, 8)}`],
      );
      await tx.query(
        `INSERT INTO config.technical_locations (id, parent_id, code, name, provenance)
         VALUES ($1, $2, $3, 'Batería', 'FIXTURE_TEST')`,
        [b, a, `TL-${b.slice(0, 8)}`],
      );
      await expectRefused(
        tx,
        (t) => t.query('UPDATE config.technical_locations SET parent_id = $1 WHERE id = $2', [b, a]),
        { matches: /own ancestor/ },
      );
    });
  });

  it('refuses an inverted interval on a person assignment', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'EN_EJECUCION' });
      const personId = uuid();
      await tx.query(
        `INSERT INTO config.people (id, first_name, last_name, provenance)
         VALUES ($1, 'Diego', 'Arce', 'FIXTURE_TEST')`,
        [personId],
      );
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO execution.person_execution_assignments
               (id, part_id, person_id, role, started_at, ended_at)
             VALUES ($1, $2, $3, 'JEFE_CUADRILLA', '2026-10-05T18:00:00Z', '2026-10-05T06:00:00Z')`,
            [uuid(), part.partId, personId],
          ),
        { matches: /person_assignments_interval/ },
      );
    });
  });

  it('refuses a rule scope that claims ITEM specificity with no item', async () => {
    await inRollbackTx(async (tx) => {
      const defId = uuid();
      const versionId = uuid();
      await tx.query(
        `INSERT INTO config.rule_definitions (id, rule_type, code, name)
         VALUES ($1, 'OVERLAP', $2, 'Solapamiento')`,
        [defId, `RD-${defId.slice(0, 8)}`],
      );
      await tx.query(
        `INSERT INTO config.rule_versions
           (id, rule_definition_id, version_no, params, effect, force, valid_from, status)
         VALUES ($1, $2, 1, '{}'::jsonb, 'WARN', 'WARN', '2026-01-01T00:00:00Z', 'PUBLISHED')`,
        [versionId, defId],
      );
      // Without this check a row could win on specificity while pointing at nothing.
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO config.rule_scopes (id, rule_version_id, scope_level) VALUES ($1, $2, 'ITEM')`,
            [uuid(), versionId],
          ),
        { matches: /rule_scopes_level_matches_reference/ },
      );
    });
  });

  it('refuses a resource meter reading with no meter kind', async () => {
    await inRollbackTx(async (tx) => {
      const part = await makePart(tx, { state: 'EN_EJECUCION' });
      const typeId = uuid();
      const resourceId = uuid();
      await tx.query(
        `INSERT INTO config.resource_types (id, code, name, metering)
         VALUES ($1, $2, 'Pick-up', 'ODOMETER_KM')`,
        [typeId, `RT-${typeId.slice(0, 8)}`],
      );
      await tx.query(
        `INSERT INTO config.resources (id, resource_type_id, code, name, provenance)
         VALUES ($1, $2, $3, 'PU-31', 'FIXTURE_TEST')`,
        [resourceId, typeId, `RS-${resourceId.slice(0, 8)}`],
      );
      await expectRefused(
        tx,
        (t) =>
          t.query(
            `INSERT INTO execution.resource_execution_assignments
               (id, part_id, resource_id, role, started_at, meter_reading)
             VALUES ($1, $2, $3, 'PRINCIPAL', now(), 84000)`,
            [uuid(), part.partId, resourceId],
          ),
        { matches: /resource_assignments_meter_has_kind/ },
      );
    });
  });
});
