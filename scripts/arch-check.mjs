#!/usr/bin/env node
/**
 * Enforces the module boundaries the target architecture depends on.
 *
 * These are not style preferences — each rule protects something the baseline requires:
 *
 *  - The domain must be reusable by api, worker and web alike (03: "Backend/API/worker
 *    deben compartir regla canónica sin importar UI"). If React, Fastify or SQL leak into
 *    packages/domain, the rule stops being shared and starts being duplicated.
 *  - No adapter SDK may reach the browser (14: "UI no importa SDK MySQL/ERP"). A provider
 *    credential in a bundle is a security problem, and business logic in the frontend is
 *    the exact failure the prototype had.
 *  - legacy/baseline is a pinned source, not a library: importing it would make the frozen
 *    prototype live code (01: "no como código vivo mezclado con nueva API").
 *  - The dependency graph has a direction (§2.3 of the plan). A cycle between domain
 *    modules means ownership is no longer clear about who decides what.
 *
 *   npm run arch:check
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Layer order: a package may only depend on layers at or below its own. */
const LAYER = {
  '@vds/kernel': 0,
  '@vds/contracts': 1,
  '@vds/rules': 2,
  '@vds/config': 3,
  '@vds/planning': 4,
  '@vds/habilita': 4,
  '@vds/control': 5,
  '@vds/execution': 6,
  '@vds/review': 7,
  '@vds/commercial': 8,
  '@vds/billing': 9,
  '@vds/sync': 2,
  '@vds/ui': 2,
  '@vds/adapters': 3,
  '@vds/testkit': 10,
};

const FORBIDDEN = [
  {
    scope: /^packages[\\/]domain[\\/]/,
    deny: [
      /^react(-dom)?(\/|$)/,
      /^fastify(\/|$)/,
      /^@fastify\//,
      /^(pg|postgres|drizzle-orm|drizzle-kit)(\/|$)/,
      /^dexie(\/|$)/,
      /^@vds\/(ui|adapters)(\/|$)/,
    ],
    why:
      'the domain must run unchanged in api, worker and web — no UI framework, no HTTP ' +
      'framework, no database driver, no browser storage, no adapter',
  },
  {
    scope: /^apps[\\/]web[\\/]/,
    deny: [/^@vds\/adapters(\/|$)/, /^(pg|postgres|drizzle-orm|mysql2)(\/|$)/, /^@aws-sdk\//],
    why: 'no provider SDK or database driver may be bundled into the browser',
  },
  {
    scope: /^(apps|packages)[\\/]/,
    deny: [/legacy[\\/]baseline/],
    why: 'legacy/baseline is a pinned source to compare against, never a dependency',
  },
];

const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs']);
const SKIP_DIR = new Set(['node_modules', 'dist', '.git', '.data', 'coverage', '.vite']);

/** static imports, re-exports, dynamic import(), and require() */
const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
    } else if (SOURCE_EXT.has(path.extname(entry.name))) {
      yield path.join(dir, entry.name);
    }
  }
}

function specifiersOf(source) {
  const out = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (spec) out.push(spec);
  }
  return out;
}

async function packageNames() {
  const names = new Map(); // dir (relative, posix) -> package name
  for (const base of ['apps', 'packages', 'packages/domain']) {
    const abs = path.join(repoRoot, base);
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIR.has(entry.name)) continue;
      const manifest = path.join(abs, entry.name, 'package.json');
      try {
        await stat(manifest);
      } catch {
        continue;
      }
      const { name } = JSON.parse(await readFile(manifest, 'utf8'));
      names.set(`${base}/${entry.name}`, name);
    }
  }
  return names;
}

async function main() {
  const violations = [];
  const packages = await packageNames();
  /** package name -> set of @vds/* it imports */
  const graph = new Map();

  for (const [dir, name] of packages) {
    graph.set(name, new Set());
  }

  for (const base of ['apps', 'packages']) {
    for await (const file of walk(path.join(repoRoot, base))) {
      const rel = path.relative(repoRoot, file);
      const relPosix = rel.replaceAll('\\', '/');
      const source = await readFile(file, 'utf8');
      const specs = specifiersOf(source);

      // Which package does this file belong to?
      const owner = [...packages.entries()]
        .filter(([dir]) => relPosix.startsWith(`${dir}/`))
        .sort((a, b) => b[0].length - a[0].length)[0];

      for (const spec of specs) {
        for (const rule of FORBIDDEN) {
          if (!rule.scope.test(rel)) continue;
          if (rule.deny.some((re) => re.test(spec))) {
            violations.push(`${relPosix}\n    imports "${spec}" — ${rule.why}`);
          }
        }
        if (owner && spec.startsWith('@vds/')) {
          const dep = spec.split('/').slice(0, 2).join('/');
          graph.get(owner[1])?.add(dep);
        }
      }
    }
  }

  // Layer direction.
  for (const [pkg, deps] of graph) {
    const from = LAYER[pkg];
    if (from === undefined) continue;
    for (const dep of deps) {
      const to = LAYER[dep];
      if (to === undefined) continue;
      if (to > from) {
        violations.push(
          `${pkg} depends on ${dep}\n    the graph has a direction: ${dep} (layer ${to}) sits ` +
            `above ${pkg} (layer ${from}), so this inverts ownership`,
        );
      }
    }
  }

  // Cycles.
  const seen = new Set();
  const stack = [];
  const visit = (node) => {
    if (stack.includes(node)) {
      violations.push(`dependency cycle: ${[...stack.slice(stack.indexOf(node)), node].join(' -> ')}`);
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);
    stack.push(node);
    for (const dep of graph.get(node) ?? []) visit(dep);
    stack.pop();
  };
  for (const node of graph.keys()) visit(node);

  if (violations.length > 0) {
    console.error(`Architecture boundaries violated (${violations.length}):\n`);
    for (const v of violations) console.error(`  - ${v}\n`);
    process.exit(1);
  }

  console.log(`Architecture boundaries OK — ${packages.size} package(s) checked.`);
  for (const [, name] of packages) {
    const deps = [...(graph.get(name) ?? [])].sort();
    console.log(`  ${name}${deps.length ? ` -> ${deps.join(', ')}` : ''}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
