#!/usr/bin/env node
/**
 * Generates the state-machine dataset from the canonical extracts.
 *
 * Why generate instead of hand-writing: 11 machines, ~90 transitions and 33
 * prohibitions is too much to transcribe by hand without introducing a silent
 * divergence from S2 — and a divergence here is a domain defect, not a typo. The
 * generated file keeps `source_sheet`/`source_row` on every record, so any assertion
 * in the codebase can be traced back to a spreadsheet row.
 *
 *   node scripts/gen-state-machines.mjs           # write
 *   node scripts/gen-state-machines.mjs --check    # fail if the committed file drifted
 *
 * Input  : full-implementation-pack/references/canonical/{48..56}*.json
 * Output : packages/domain/kernel/src/generated/state-machines.json
 *
 * Sheet layout (verified against 49–55): each machine is a block that starts with a
 * single-cell title "DOMAIN · Machine", followed by a one-line description, then up to
 * three tables identified by their header row's first cell:
 *   "Estado"  → states      (Estado | Tipo | Semántica | Terminal)
 *   "ID"      → transitions (ID | Desde | Evento | Hacia | Gate | Actor | Efecto | Tipo | Nota)
 *   "Desde"   → prohibited  (Desde | Hacia | Transición prohibida | Qué hacer en cambio)
 * A "SUBMÁQUINA / DIMENSIÓN PARALELA · X" title introduces a parallel dimension whose
 * states are given as prose, not as a table — it is captured as prose on purpose rather
 * than parsed into a machine we would be inventing.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonical = path.join(repoRoot, 'full-implementation-pack/references/canonical');
const outDir = path.join(repoRoot, 'packages/domain/kernel/src/generated');
const outFile = path.join(outDir, 'state-machines.json');

const MACHINE_SHEETS = [
  '49_SM_Planificacion',
  '50_SM_Ejecucion',
  '51_SM_Habilita_PTW',
  '52_SM_Directiva_Operativa',
  '53_SM_Habilita_Eventos',
  '54_SM_Certificacion',
  '55_SM_Facturacion',
];
const MASTER_SHEET = '48_Maquinas_Estado_Master';
const PROHIBITED_SHEET = '56_Transiciones_Prohibidas';

/** Expected totals, from 48 (11 principal machines) and 56 (33 prohibitions). */
const EXPECT = { machines: 11, prohibited: 33 };

const text = (cell) => (typeof cell === 'string' ? cell.trim() : cell == null ? '' : String(cell));
const isBlank = (cell) => text(cell) === '';

/** "Sí" / "Sí operacional" / "Sí del workflow evento" → true, with the nuance kept. */
function parseTerminal(raw) {
  const value = text(raw);
  const terminal = /^s[íi]/i.test(value);
  return { terminal, terminal_note: terminal && value.length > 2 ? value : undefined };
}

/** Split "PROGRAMADA/READY/DESPACHADA" and "EN_EJECUCION / SUSPENDIDO" into states. */
function parseStateList(raw) {
  const value = text(raw);
  if (value === '' || value === '—') return [];
  return value
    .split(/[/]/)
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '—');
}

async function loadSheet(name) {
  const raw = await readFile(path.join(canonical, `${name}.json`), 'utf8');
  const sheet = JSON.parse(raw);
  return sheet.rows.map((r) => ({ row: r.source_row, cells: r.cells }));
}

/**
 * Row 1 of each sheet is a banner that also happens to be a single cell with " · "
 * ("STATE MACHINES · PLANIFICACIÓN"). It names the sheet, not a machine, so it must not
 * open a block — otherwise every sheet yields a phantom stateless machine.
 */
const isBanner = (value) => /^(STATE MACHINES?|M[ÁA]QUINAS DE ESTADO)\b/i.test(value);

/** A machine/submachine title is a single populated cell containing " · ". */
function titleOf(cells) {
  const populated = cells.filter((c) => !isBlank(c));
  if (populated.length !== 1) return null;
  const value = text(populated[0]);
  if (!value.includes(' · ') || isBanner(value)) return null;
  return value;
}

/**
 * Abbreviations the source itself uses in the "Desde" column, where a transition lists
 * several origin states. Mapped explicitly rather than fuzzy-matched, so that a reader can
 * check each one against the row — a silent prefix match here would be a domain defect.
 *
 *   54_SM_Certificacion row 64 · T-PC10 · "BORRADOR/LISTO/OBSERVADO"
 *     → LISTO is PaqueteCertificacion.LISTO_PARA_ENVIO (row 44).
 */
const STATE_ALIASES = {
  PaqueteCertificacion: { LISTO: 'LISTO_PARA_ENVIO' },
};

function parseMachineSheet(sheetName, rows) {
  const machines = [];
  let current = null;
  let table = null; // 'states' | 'transitions' | 'prohibited'

  const startMachine = (title, row, kind) => {
    const [domain, name] = title.split(' · ').map((s) => s.trim());
    current = {
      key: name,
      domain: kind === 'submachine' ? domain.replace(/^SUBM.*PARALELA$/i, domain) : domain,
      kind,
      source_sheet: sheetName,
      source_row: row,
      description: '',
      states: [],
      transitions: [],
      prohibited: [],
      parallel_dimension_note: undefined,
    };
    machines.push(current);
    table = null;
  };

  for (const { row, cells } of rows) {
    const first = text(cells[0]);
    const title = titleOf(cells);

    if (title) {
      const isSub = /^SUBM[ÁA]QUINA/i.test(title) || /DIMENSI[ÓO]N PARALELA/i.test(title);
      startMachine(title, row, isSub ? 'submachine' : 'machine');
      continue;
    }
    if (!current) continue; // sheet banner rows

    // Header rows switch the active table.
    if (first === 'Estado' && text(cells[1]) === 'Tipo') {
      table = 'states';
      continue;
    }
    if (first === 'ID' && text(cells[1]) === 'Desde') {
      table = 'transitions';
      continue;
    }
    if (first === 'Desde' && text(cells[1]) === 'Hacia') {
      table = 'prohibited';
      continue;
    }

    // The first non-title, non-header line of a block is its description.
    if (table === null) {
      const populated = cells.filter((c) => !isBlank(c));
      if (populated.length >= 1) {
        const value = text(populated[0]);
        if (current.kind === 'submachine') {
          current.parallel_dimension_note = current.parallel_dimension_note
            ? `${current.parallel_dimension_note} ${value}`
            : value;
        } else if (current.description === '') {
          current.description = value;
        }
      }
      continue;
    }

    if (table === 'states' && first !== '') {
      const { terminal, terminal_note } = parseTerminal(cells[3]);
      current.states.push({
        state: first,
        kind: text(cells[1]),
        semantics: text(cells[2]),
        terminal,
        ...(terminal_note ? { terminal_note } : {}),
        source_row: row,
      });
    } else if (table === 'transitions' && /^T-/.test(first)) {
      const aliases = STATE_ALIASES[current.key] ?? {};
      current.transitions.push({
        id: first,
        from: parseStateList(cells[1]).map((s) => aliases[s] ?? s),
        from_verbatim: text(cells[1]),
        from_is_creation: text(cells[1]) === '—',
        event: text(cells[2]),
        to: text(cells[3]),
        gate: text(cells[4]),
        actor: text(cells[5]),
        effect: text(cells[6]),
        kind: text(cells[7]), // PERMITIDA | CONDICIONAL
        note: text(cells[8]) || undefined,
        source_row: row,
      });
    } else if (table === 'prohibited' && first !== '') {
      current.prohibited.push({
        from: first,
        to: text(cells[1]),
        forbidden: text(cells[2]),
        instead: text(cells[3]),
        source_row: row,
      });
    }
  }
  return machines;
}

function parseMaster(rows) {
  const out = [];
  let seenHeader = false;
  for (const { row, cells } of rows) {
    const first = text(cells[0]);
    if (first === '#' && text(cells[1]) === 'Dominio') {
      seenHeader = true;
      continue;
    }
    if (!seenHeader) continue;
    if (!/^SM-\d+$/.test(first)) continue;
    out.push({
      id: first,
      domain: text(cells[1]),
      machine: text(cells[2]),
      principle: text(cells[3]),
      state_count: Number(text(cells[4])),
      terminals: parseStateList(cells[5]).length
        ? text(cells[5])
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      key_rule: text(cells[6]),
      parallel_submachine: text(cells[7]) === '—' ? undefined : text(cells[7]),
      source_row: row,
    });
  }
  return out;
}

function parseMasterPrinciples(rows) {
  return rows
    .filter(({ cells }) => /^P-\d+$/.test(text(cells[0])))
    .map(({ row, cells }) => ({
      id: text(cells[0]),
      title: text(cells[1]),
      statement: text(cells[2]),
      source_row: row,
    }));
}

function parseProhibited(rows) {
  return rows
    .filter(({ cells }) => /^TPR-\d+$/.test(text(cells[0])))
    .map(({ row, cells }) => ({
      id: text(cells[0]),
      machine: text(cells[1]),
      from: text(cells[2]),
      to: text(cells[3]),
      forbidden: text(cells[4]),
      instead: text(cells[5]),
      severity: text(cells[6]),
      source_row: row,
    }));
}

async function main() {
  const check = process.argv.includes('--check');

  const machines = [];
  for (const sheet of MACHINE_SHEETS) {
    machines.push(...parseMachineSheet(sheet, await loadSheet(sheet)));
  }

  const masterRows = await loadSheet(MASTER_SHEET);
  const payload = {
    $generated_by: 'scripts/gen-state-machines.mjs',
    $source: 'S2 — Diccionario Canonico v3.0 BASELINE FUNCIONAL 1.0 FROZEN',
    $note:
      'Do not edit by hand. Every record carries source_sheet/source_row so an assertion ' +
      'in code can be traced to a spreadsheet row. Regenerate with the script; CI runs --check.',
    master: parseMaster(masterRows),
    principles: parseMasterPrinciples(masterRows),
    machines,
    prohibited_transitions: parseProhibited(await loadSheet(PROHIBITED_SHEET)),
  };

  // --- integrity gates: refuse to emit something that misrepresents the source ---
  const problems = [];
  const principal = machines.filter((m) => m.kind === 'machine');
  if (principal.length !== EXPECT.machines) {
    problems.push(`expected ${EXPECT.machines} principal machines, parsed ${principal.length}`);
  }
  if (payload.prohibited_transitions.length !== EXPECT.prohibited) {
    problems.push(
      `expected ${EXPECT.prohibited} prohibited transitions, parsed ${payload.prohibited_transitions.length}`,
    );
  }
  if (payload.master.length !== EXPECT.machines) {
    problems.push(`sheet 48 lists ${payload.master.length} machines, expected ${EXPECT.machines}`);
  }
  for (const m of principal) {
    if (m.states.length === 0) problems.push(`${m.key}: no states parsed`);
    if (m.transitions.length === 0) problems.push(`${m.key}: no transitions parsed`);
    const known = new Set(m.states.map((s) => s.state));
    for (const t of m.transitions) {
      for (const from of t.from) {
        if (!known.has(from)) problems.push(`${m.key} ${t.id}: unknown from-state "${from}"`);
      }
      if (t.to !== '' && !known.has(t.to) && !/^seg[úu]n|^sin cambio/i.test(t.to)) {
        problems.push(`${m.key} ${t.id}: unknown to-state "${t.to}"`);
      }
    }
  }
  // Every machine named in 48 must have been parsed out of 49–55.
  const parsedKeys = new Set(principal.map((m) => m.key));
  for (const row of payload.master) {
    if (!parsedKeys.has(row.machine)) {
      problems.push(`sheet 48 ${row.id} names "${row.machine}" but no block was parsed for it`);
    }
  }

  if (problems.length > 0) {
    console.error('Refusing to emit — the parse does not faithfully represent S2:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const json = JSON.stringify(payload, null, 2) + '\n';
  let current = null;
  try {
    current = await readFile(outFile, 'utf8');
  } catch {
    /* first run */
  }

  const rel = path.relative(repoRoot, outFile).replaceAll('\\', '/');
  const counts =
    `${principal.length} machines, ` +
    `${machines.filter((m) => m.kind === 'submachine').length} parallel dimensions, ` +
    `${principal.reduce((n, m) => n + m.states.length, 0)} states, ` +
    `${principal.reduce((n, m) => n + m.transitions.length, 0)} transitions, ` +
    `${payload.prohibited_transitions.length} prohibitions`;

  if (check) {
    if (current !== json) {
      console.error(`${rel} is out of date. Run: node scripts/gen-state-machines.mjs`);
      process.exit(1);
    }
    console.log(`${rel} up to date — ${counts}`);
    return;
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, json, 'utf8');
  console.log(`${current === json ? 'unchanged' : 'wrote'} ${rel}`);
  console.log(counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
