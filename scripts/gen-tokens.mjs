#!/usr/bin/env node
/**
 * Generates packages/ui/src/tokens.css from packages/ui/src/tokens.ts.
 *
 * Why generate: the contrast and ΔE tests run against tokens.ts. If the CSS were authored
 * separately, the tests would be verifying values that are not the ones shipped to the
 * browser. One source, one set of verified values.
 *
 *   node scripts/gen-tokens.mjs
 *   node scripts/gen-tokens.mjs --check     # CI: fail if tokens.css drifted
 *
 * Theme strategy follows the prototype's own approach, which worked and is kept: a
 * `prefers-color-scheme` block guarded so an explicit `data-theme="light"` wins, plus an
 * explicit `data-theme="dark"`. Density is a `data-density` attribute, inherited.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'node:module';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokensTs = path.join(repoRoot, 'packages/ui/src/tokens.ts');
const outFile = path.join(repoRoot, 'packages/ui/src/tokens.css');

/**
 * tokens.ts is type-only TypeScript (no runtime-only syntax: the base tsconfig sets
 * erasableSyntaxOnly), so Node's built-in type stripping can load it directly. No bundler
 * and no extra dependency for a build step this small.
 */
const tokens = await import(pathToFileURL(tokensTs).href);

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function colorBlock(theme, indent = '  ') {
  const lines = [];
  for (const [groupName, group] of Object.entries(tokens.tokenGroups)) {
    lines.push(`${indent}/* ${groupName} */`);
    for (const [name, token] of Object.entries(group)) {
      const prefix = groupName === 'semantic' || groupName === 'ink' ? '' : `${kebab(groupName)}-`;
      lines.push(`${indent}--vds-${prefix}${kebab(name)}: ${token[theme]};`);
    }
  }
  return lines.join('\n');
}

function scalarBlock() {
  const lines = [];
  lines.push('  /* type */');
  for (const [name, value] of Object.entries(tokens.font)) {
    lines.push(`  --vds-font-${kebab(name)}: ${value};`);
  }
  for (const [name, value] of Object.entries(tokens.fontSize)) {
    lines.push(`  --vds-text-${name}: ${value};`);
  }
  lines.push('  /* space */');
  for (const [name, value] of Object.entries(tokens.space)) {
    lines.push(`  --vds-space-${name}: ${value};`);
  }
  lines.push('  /* radius */');
  for (const [name, value] of Object.entries(tokens.radius)) {
    lines.push(`  --vds-radius-${name}: ${value};`);
  }
  return lines.join('\n');
}

function densityBlocks() {
  return Object.entries(tokens.density)
    .map(
      ([name, tier]) => `/* ${name} — ${tier.where} */
[data-density='${name}'] {
  --vds-row-height: ${tier.rowHeight};
  --vds-touch-target: ${tier.touchTarget};
  --vds-body-size: ${tier.bodySize};
  --vds-line-height: ${tier.lineHeight};
  --vds-gutter: ${tier.gutter};
}`,
    )
    .join('\n\n');
}

const css = `/*
 * DS-01 tokens — GENERATED from packages/ui/src/tokens.ts by scripts/gen-tokens.mjs.
 * Do not edit by hand: the contrast and ΔE tests run against the TypeScript source, so an
 * edit here would ship values that nothing verifies. Run \`npm run gen:tokens\`.
 *
 * Components reference these variables and never a literal colour.
 */

:root {
  color-scheme: light;
${colorBlock('light')}

${scalarBlock()}
}

/* Dark by system preference, unless an explicit light theme is set. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
${colorBlock('dark', '    ')}
  }
}

/* Dark by explicit choice. */
:root[data-theme='dark'] {
  color-scheme: dark;
${colorBlock('dark')}
}

/*
 * Density. Set data-density on a container; it is inherited.
 * Field never inherits analysis: the prototype scaled a 1366x1024 frame to fit, which made
 * controls physically small on a tablet. That is a finding to fix, not to reproduce.
 */
${densityBlocks()}

body {
  background: var(--vds-surface-canvas);
  color: var(--vds-ink);
  font-family: var(--vds-font-body);
  font-size: var(--vds-body-size, var(--vds-text-md));
  line-height: var(--vds-line-height, 1.4);
}

/* IDs, timestamps, quantities, versions: monospace with tabular figures so a column of
   PD-0394 / 07:20 / 1 200 m² lines up and can be scanned for difference. */
.vds-numeric {
  font-family: var(--vds-font-mono);
  font-variant-numeric: tabular-nums;
}

/* Focus must be visible on every interactive element: the prototype had this and it is kept. */
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--vds-action);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;

const rel = path.relative(repoRoot, outFile).replaceAll('\\', '/');
let current = null;
try {
  current = await readFile(outFile, 'utf8');
} catch {
  /* first run */
}

if (process.argv.includes('--check')) {
  if (current !== css) {
    console.error(`${rel} is out of date. Run: npm run gen:tokens`);
    process.exit(1);
  }
  console.log(`${rel} up to date`);
} else {
  await writeFile(outFile, css, 'utf8');
  console.log(`${current === css ? 'unchanged' : 'wrote'} ${rel}`);
}
