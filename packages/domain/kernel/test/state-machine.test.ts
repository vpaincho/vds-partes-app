/**
 * State machine conformance against S2.
 *
 * These are not unit tests of a helper — they assert that the shipped dataset still
 * represents sheets 48–56 and that the engine refuses the 33 prohibited transitions. The
 * counts are taken from the workbook and from 74_Arquitectura_FINAL_FROZEN ("STATE
 * MACHINES · 11 principales + submáquinas"), so a drift in either direction fails here
 * rather than surfacing later as a domain defect.
 */
import { describe, expect, it } from 'vitest';
import {
  allProhibitions,
  canTransition,
  isProhibitedPair,
  isTerminal,
  machine,
  machineKeys,
  master,
  parallelDimensions,
  principles,
  prohibitions,
  states,
  type MachineKey,
} from '../src/state-machine.ts';

describe('dataset represents S2', () => {
  it('has the 11 principal machines named by sheet 48', () => {
    expect(machineKeys).toHaveLength(11);
    expect([...machineKeys].sort()).toEqual([...master.map((m) => m.machine)].sort());
  });

  it('has the 3 parallel dimensions sheet 48 declares', () => {
    // SM-01 PlanificacionVersion, SM-08 AccionCorrectivaHabilita, SM-09 supersession.
    const declared = master.filter((m) => m.parallel_submachine).map((m) => m.parallel_submachine);
    expect(declared).toHaveLength(3);
    expect(parallelDimensions).toHaveLength(3);
    for (const dimension of parallelDimensions) {
      // Captured as prose, not parsed into a machine we would be inventing.
      expect(dimension.parallel_dimension_note, dimension.key).toBeTruthy();
    }
  });

  it('agrees with sheet 48 on the state count of every machine', () => {
    for (const row of master) {
      expect(states(row.machine as MachineKey), row.machine).toHaveLength(row.state_count);
    }
  });

  it('carries the 6 transversal state principles P-01..P-06', () => {
    expect(principles.map((p) => p.id)).toEqual(['P-01', 'P-02', 'P-03', 'P-04', 'P-05', 'P-06']);
  });

  it('keeps provenance on every record so a block can be traced to a row', () => {
    for (const key of machineKeys) {
      const m = machine(key);
      expect(m.source_sheet).toMatch(/^\d{2}_/);
      for (const s of m.states) expect(s.source_row).toBeGreaterThan(0);
      for (const t of m.transitions) expect(t.source_row).toBeGreaterThan(0);
    }
  });

  it('declares at least one terminal state per machine', () => {
    for (const key of machineKeys) {
      expect(machine(key).states.some((s) => s.terminal), key).toBe(true);
    }
  });
});

describe('TPR-001..TPR-033 are refused, with the correct path to take instead', () => {
  it('covers exactly the 33 prohibitions of sheet 56', () => {
    expect(allProhibitions).toHaveLength(33);
    const ids = allProhibitions.map((p) => p.id);
    expect(ids).toEqual([...new Set(ids)]);
    expect(ids[0]).toBe('TPR-001');
    expect(ids.at(-1)).toBe('TPR-033');
  });

  it('attributes every prohibition to a known machine', () => {
    for (const p of allProhibitions) {
      expect(machineKeys, p.id).toContain(p.machine as MachineKey);
    }
  });

  it.each(allProhibitions.map((p) => [p.id, p] as const))(
    '%s is refused as a state pair and explains the alternative',
    (_id, p) => {
      const found = isProhibitedPair(p.machine as MachineKey, p.from, p.to);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(p.id);
      // The actionable half: a bare "invalid transition" would lose this.
      expect(found!.instead.length).toBeGreaterThan(10);
      expect(found!.severity).toBe('CRÍTICA');
    },
  );

  it.each(allProhibitions.map((p) => [p.id, p] as const))(
    '%s cannot be reached through any event of its machine',
    (_id, p) => {
      const key = p.machine as MachineKey;
      // Whatever event claims to produce this pair, canTransition must refuse it.
      for (const t of machine(key).transitions) {
        if (!t.from.includes(p.from) || t.to !== p.to) continue;
        const verdict = canTransition(key, p.from, t.event);
        expect(verdict.allowed, `${p.id} via ${t.id}`).toBe(false);
        if (!verdict.allowed) {
          expect(verdict.reason).toBe('PROHIBITED');
          expect(verdict.tpr_id).toBe(p.id);
          expect(verdict.instead).toBeTruthy();
        }
      }
    },
  );
});

describe('canonical transitions are allowed', () => {
  const cases = machineKeys.flatMap((key) =>
    machine(key)
      .transitions.filter((t) => !t.from_is_creation)
      .flatMap((t) => t.from.map((from) => ({ key, from, t }))),
  );

  it('evaluates every non-creation transition in the dataset', () => {
    // 82 transitions total; creations ("—" origin) are excluded since they have no from-state.
    expect(cases.length).toBeGreaterThan(50);
  });

  it.each(cases.map((c) => [`${c.key} ${c.t.id} ${c.from}`, c] as const))(
    '%s',
    (_label, { key, from, t }) => {
      const verdict = canTransition(key, from, t.event);
      const blocked = isProhibitedPair(key, from, t.to);
      if (blocked) {
        // A sheet can both list a transition and forbid the resulting pair; the
        // prohibition wins. T-P06 (ACTIVA→CANCELADA) is the canonical example.
        expect(verdict.allowed).toBe(false);
        return;
      }
      expect(verdict.allowed, `${t.id}: ${verdict.allowed ? '' : verdict.message}`).toBe(true);
      if (verdict.allowed) {
        expect(verdict.transition.id).toBe(t.id);
        expect(verdict.conditional).toBe(t.kind === 'CONDICIONAL');
      }
    },
  );
});

describe('refusals that protect history', () => {
  it('refuses to reopen a closed Parte and points at EnmiendaOperativa (TPR-007)', () => {
    const verdict = canTransition('Parte', 'CERRADO_OPERATIVAMENTE', 'START_WORK');
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      // Reached as TERMINAL: there is no START_WORK edge out of the closed state at all.
      expect(verdict.reason).toBe('TERMINAL');
      expect(verdict.message).toMatch(/amendment|history/i);
    }
    // And the pair itself is explicitly on the deny list.
    const pair = isProhibitedPair('Parte', 'CERRADO_OPERATIVAMENTE', 'EN_EJECUCION');
    expect(pair?.id).toBe('TPR-007');
    expect(pair?.instead).toMatch(/Enmienda/i);
  });

  it('refuses to reopen a closed UE (TPR-010)', () => {
    expect(isProhibitedPair('UnidadEjecucion', 'CERRADA', 'EN_EJECUCION')?.id).toBe('TPR-010');
  });

  it('never auto-closes an expired PTW — VENCIDO is terminal, not CERRADO (TPR-013)', () => {
    const pair = isProhibitedPair('PermisoTrabajo', 'VENCIDO', 'CERRADO');
    expect(pair?.id).toBe('TPR-013');
    expect(pair?.instead).toMatch(/CierreAdministrativo|autorizado/i);
    expect(isTerminal('PermisoTrabajo', 'VENCIDO')).toBe(true);
    // The distinction the baseline insists on: expiry is not closure.
    expect(isTerminal('PermisoTrabajo', 'CERRADO')).toBe(true);
  });

  it('refuses APLICADA straight from EMITIDA — emission is not application (TPR-016)', () => {
    const pair = isProhibitedPair('DirectivaOperativa', 'EMITIDA', 'APLICADA');
    expect(pair?.id).toBe('TPR-016');
    expect(canTransition('DirectivaOperativa', 'EMITIDA', 'APLICAR').allowed).toBe(false);
    // ACK is its own step and does not imply application.
    expect(canTransition('DirectivaOperativa', 'RECIBIDA', 'ACK').allowed).toBe(true);
    expect(canTransition('DirectivaOperativa', 'RECONOCIDA', 'APLICAR').allowed).toBe(true);
  });

  it('refuses to edit an accepted UC and points at supersession (TPR-025)', () => {
    const pair = isProhibitedPair('UnidadComercial', 'ACEPTADA', 'ELEGIBLE');
    expect(pair?.id).toBe('TPR-025');
    expect(pair?.instead).toMatch(/supersession/i);
  });

  it('refuses to close a Parte with unresolved UE (TPR-009)', () => {
    expect(isProhibitedPair('Parte', 'PREPARADO', 'CERRADO_OPERATIVAMENTE')?.id).toBe('TPR-009');
  });

  it('reports an unknown state instead of silently denying', () => {
    const verdict = canTransition('Parte', 'curso', 'START_WORK');
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe('UNKNOWN_STATE');
  });
});

describe('the states the prototype collapsed into one are separate machines here', () => {
  it('keeps operational, commercial and billing lifecycles distinct (P-01)', () => {
    // index.html had a single EST = {plan,curso,env,obs,apr,cert} across four domains.
    expect(states('Parte')).toContain('CERRADO_OPERATIVAMENTE');
    expect(states('UnidadComercial')).toContain('ACEPTADA');
    expect(states('LoteFacturacion')).toContain('ACEPTADO_ERP');
    // No machine owns another's vocabulary.
    expect(states('Parte')).not.toContain('ACEPTADA');
    expect(states('UnidadComercial')).not.toContain('CERRADO_OPERATIVAMENTE');
  });

  it('closing a Parte operationally says nothing about certification', () => {
    const closed = machine('Parte').states.find((s) => s.state === 'CERRADO_OPERATIVAMENTE')!;
    expect(closed.terminal).toBe(true);
    expect(closed.terminal_note).toMatch(/operacional/i);
    expect(machine('Parte').description).toMatch(/certificaci[óo]n/i);
  });
});
