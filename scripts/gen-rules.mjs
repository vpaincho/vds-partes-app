#!/usr/bin/env node
/**
 * Generates the rule catalogue from sheet 57 (+ 58 precedence, + the canonical test map).
 *
 * Same reasoning as the state machines: 74 rules with 15 columns each is not something to
 * retype, and a divergence from S2 here is a domain defect. Every rule keeps its source row.
 *
 *   node scripts/gen-rules.mjs            # write
 *   node scripts/gen-rules.mjs --check     # fail if the committed catalogue drifted
 *
 * Output: packages/domain/rules/src/generated/rules.json
 *
 * Sheet 57 layout: a banner, a note, a header at row 4, then one rule per row. Columns are
 * interleaved with empty spacer cells, so values are read by collapsing non-empty cells —
 * verified to yield exactly 15 values on all 74 rows before anything is emitted.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonical = path.join(repoRoot, 'full-implementation-pack/references/canonical');
const outDir = path.join(repoRoot, 'packages/domain/rules/src/generated');
const outFile = path.join(outDir, 'rules.json');

const EXPECTED_RULES = 74;
const FIELDS = [
  'ruleId',
  'domain',
  'precedence',
  'ruleClass',
  'subject',
  'trigger',
  'stateContext',
  'condition',
  'decision',
  'targetState',
  'sideEffects',
  'force',
  'configScope',
  'authority',
  'rationale',
];

const text = (cell) => (typeof cell === 'string' ? cell.trim() : cell == null ? '' : String(cell));

async function loadSheet(name) {
  const sheet = JSON.parse(await readFile(path.join(canonical, `${name}.json`), 'utf8'));
  return sheet.rows;
}

/**
 * `force` from the sheet is prose ("HARD_BLOCK comercial", "WARN/BLOCK según riesgo").
 * Normalise it into the two things code needs — can this rule block, and may it ever be
 * overridden — while keeping the verbatim text for the trace.
 */
function classifyForce(force) {
  const value = force.toUpperCase();
  const mentionsBlock = value.includes('BLOCK') || value.includes('GATE') || value.includes('HARD_RULE');
  const mentionsWarn = value.includes('WARN');
  const riskDependent = value.includes('SEGÚN RIESGO') || value.includes('SEGUN RIESGO');
  // "BLOCK/WARN" (RUL-027) and "WARN/BLOCK según riesgo" (RUL-002) do not have a fixed
  // outcome: the configured rule decides which of the two applies. Code must treat these as
  // undetermined and consult configuration rather than assuming the stricter or looser branch.
  const configDependent = mentionsBlock && mentionsWarn;
  return {
    force,
    // Potentially blocking: true whenever a BLOCK branch exists at all, so a caller can never
    // treat such a rule as advisory.
    blocking: mentionsBlock,
    configDependent,
    // A hard block or hard gate is never overrideable by convenience (C-018). Only a rule whose
    // force is a plain WARN carries an override path, and the gate must still be declared
    // explicitly in configuration (RUL-041).
    overrideable: value === 'WARN',
    riskDependent,
    commercialOnly: value.includes('COMERCIAL'),
    operationalOnly: value.includes('OPERACIONAL'),
  };
}

/** Which module owns the rule, from the canonical test map rather than guessed. */
async function ownerIndex() {
  const csv = await readFile(path.join(canonical, 'rule_test_map.csv'), 'utf8');
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0]);
  const idIndex = header.indexOf('rule_id');
  const ownerIndexCol = header.indexOf('owner_modules_proposed');
  const goldenIndexCol = header.indexOf('golden_links');
  const layersCol = header.indexOf('required_test_layers');
  const map = new Map();
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    map.set(cols[idIndex], {
      owners: (cols[ownerIndexCol] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      goldenLinks: (cols[goldenIndexCol] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      requiredTestLayers: cols[layersCol] ?? '',
    });
  }
  return map;
}

function splitCsvLine(line) {
  const out = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function parsePrecedenceSheet(rows) {
  const levels = [];
  const algorithm = [];
  const antipatterns = [];
  for (const row of rows) {
    const values = row.cells.map(text).filter((v) => v !== '');
    const first = values[0] ?? '';
    if (/^P[0-8]$/.test(first) && values.length >= 6) {
      levels.push({
        precedence: first,
        family: values[1],
        protects: values[2],
        examples: values[3],
        overrideable: values[4],
        ownedBy: values[5],
        status: values[6] ?? '',
        sourceRow: row.source_row,
      });
    } else if (/^[1-8]$/.test(first) && values.length >= 3) {
      algorithm.push({
        step: Number(first),
        name: values[1],
        rule: values[2],
        obligation: values[3] ?? '',
        sourceRow: row.source_row,
      });
    } else if (/^AP-\d+$/.test(first)) {
      antipatterns.push({
        id: first,
        name: values[1],
        example: values[2],
        verdict: values[3],
        correction: values[4] ?? '',
        sourceRow: row.source_row,
      });
    }
  }
  return { levels, algorithm, antipatterns };
}

async function main() {
  const check = process.argv.includes('--check');

  const rulesRows = await loadSheet('57_Matriz_Maestra_Reglas');
  const owners = await ownerIndex();

  const rules = [];
  for (const row of rulesRows) {
    const values = row.cells.map(text).filter((v) => v !== '');
    if (!/^RUL-\d{3}$/.test(values[0] ?? '')) continue;
    if (values.length !== FIELDS.length) {
      console.error(
        `Refusing to emit — ${values[0]} (row ${row.source_row}) has ${values.length} ` +
          `values, expected ${FIELDS.length}. The column layout changed; fix the parser rather ` +
          'than guessing which value is which.',
      );
      process.exit(1);
    }
    const rule = Object.fromEntries(FIELDS.map((field, i) => [field, values[i]]));
    const meta = owners.get(rule.ruleId) ?? { owners: [], goldenLinks: [], requiredTestLayers: '' };
    rules.push({
      ...rule,
      ...classifyForce(rule.force),
      owners: meta.owners,
      goldenLinks: meta.goldenLinks,
      requiredTestLayers: meta.requiredTestLayers,
      sourceSheet: '57_Matriz_Maestra_Reglas',
      sourceRow: row.source_row,
    });
  }

  const precedence = parsePrecedenceSheet(await loadSheet('58_Prioridad_Conflictos_Reglas'));

  // --- integrity gates ---
  const problems = [];
  if (rules.length !== EXPECTED_RULES) {
    problems.push(`expected ${EXPECTED_RULES} rules, parsed ${rules.length}`);
  }
  const ids = rules.map((r) => r.ruleId);
  for (let i = 1; i <= EXPECTED_RULES; i += 1) {
    const expected = `RUL-${String(i).padStart(3, '0')}`;
    if (!ids.includes(expected)) problems.push(`missing ${expected}`);
  }
  if (new Set(ids).size !== ids.length) problems.push('duplicate rule ids');
  for (const rule of rules) {
    if (!/^P[0-8]$/.test(rule.precedence)) {
      problems.push(`${rule.ruleId}: precedence "${rule.precedence}" is not P0..P8`);
    }
    if (rule.decision === '') problems.push(`${rule.ruleId}: empty decision`);
  }
  if (precedence.levels.length !== 9) {
    problems.push(`expected 9 precedence levels P0..P8, parsed ${precedence.levels.length}`);
  }
  if (precedence.algorithm.length !== 8) {
    problems.push(`expected 8 resolution steps, parsed ${precedence.algorithm.length}`);
  }
  if (precedence.antipatterns.length !== 6) {
    problems.push(`expected 6 antipatterns AP-01..AP-06, parsed ${precedence.antipatterns.length}`);
  }
  if (problems.length > 0) {
    console.error('Refusing to emit — the parse does not faithfully represent S2:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const payload = {
    $generated_by: 'scripts/gen-rules.mjs',
    $source: 'S2 sheets 57 (master rule matrix) and 58 (precedence and conflict resolution)',
    $note:
      'Do not edit by hand. Every rule keeps sourceSheet/sourceRow. `force` is the verbatim ' +
      'sheet text; blocking/overrideable are derived from it so code never re-interprets prose.',
    precedence,
    rules,
  };

  const json = JSON.stringify(payload, null, 2) + '\n';
  let current = null;
  try {
    current = await readFile(outFile, 'utf8');
  } catch {
    /* first run */
  }

  const rel = path.relative(repoRoot, outFile).replaceAll('\\', '/');
  const byPrecedence = Object.entries(
    rules.reduce((acc, r) => ({ ...acc, [r.precedence]: (acc[r.precedence] ?? 0) + 1 }), {}),
  )
    .sort()
    .map(([p, n]) => `${p}:${n}`)
    .join(' ');
  const summary =
    `${rules.length} rules (${byPrecedence}), ` +
    `${rules.filter((r) => r.blocking).length} blocking, ` +
    `${rules.filter((r) => r.overrideable).length} overrideable, ` +
    `${precedence.antipatterns.length} antipatterns`;

  if (check) {
    if (current !== json) {
      console.error(`${rel} is out of date. Run: node scripts/gen-rules.mjs`);
      process.exit(1);
    }
    console.log(`${rel} up to date — ${summary}`);
    return;
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, json, 'utf8');
  console.log(`${current === json ? 'unchanged' : 'wrote'} ${rel}`);
  console.log(summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
