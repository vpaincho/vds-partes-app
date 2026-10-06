#!/usr/bin/env node
/**
 * Verifies the pinned sources against the byte hashes in
 * full-implementation-pack/reference_manifest.json.
 *
 * Why this exists: the manifest pins sha256 for S1 (product baseline) and S2
 * (canonical workbook). Those hashes are the only mechanical proof that the repo
 * still holds the sources the plan was built against. `.gitattributes` pins
 * eol=lf so the working tree matches byte for byte on every machine.
 *
 *   npm run verify:baseline    # S1 only (index.html, README.md)
 *   npm run verify:sources     # every entry in the manifest
 *
 * The manifest records paths relative to full-implementation-pack/. The product
 * baseline additionally lives at legacy/baseline/ as the frozen, servable copy;
 * both locations are checked and must agree.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packRoot = path.join(repoRoot, 'full-implementation-pack');
const manifestPath = path.join(packRoot, 'reference_manifest.json');

/** Paths the manifest pins that we also keep as a frozen servable copy. */
const MIRRORS = {
  'references/product/index.html': 'legacy/baseline/index.html',
  'references/product/README.md': 'legacy/baseline/README.md',
};

const BASELINE_ONLY = new Set(Object.keys(MIRRORS));

async function sha256(abs) {
  const buf = await readFile(abs);
  return { hash: createHash('sha256').update(buf).digest('hex'), bytes: buf.byteLength };
}

function fmt(ok) {
  return ok ? 'OK  ' : 'FAIL';
}

async function main() {
  const all = process.argv.includes('--all');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  const sources = manifest.sources.filter((s) => all || BASELINE_ONLY.has(s.path));
  if (sources.length === 0) {
    console.error('No manifest entries matched. Did reference_manifest.json change shape?');
    process.exit(2);
  }

  const failures = [];
  console.log(`reference_manifest.json · pack ${manifest.pack_version} · ${manifest.date}`);
  console.log(`product_repo_commit ${manifest.product_repo_commit}\n`);

  for (const src of sources) {
    const targets = [path.join(packRoot, src.path)];
    if (MIRRORS[src.path]) targets.push(path.join(repoRoot, MIRRORS[src.path]));

    for (const abs of targets) {
      const rel = path.relative(repoRoot, abs).replaceAll('\\', '/');
      let actual;
      try {
        actual = await sha256(abs);
      } catch (err) {
        failures.push(`${rel}: unreadable (${err.code ?? err.message})`);
        console.log(`${fmt(false)} ${rel} — unreadable`);
        continue;
      }
      const hashOk = actual.hash === src.sha256;
      const bytesOk = actual.bytes === src.bytes;
      const ok = hashOk && bytesOk;
      if (!ok) {
        failures.push(
          `${rel}: expected ${src.sha256} (${src.bytes} B), got ${actual.hash} (${actual.bytes} B)`,
        );
      }
      console.log(`${fmt(ok)} ${rel}  ${actual.bytes} B  ${actual.hash.slice(0, 16)}…`);
      if (!ok && actual.bytes - src.bytes > 0) {
        console.log(
          `       hint: ${actual.bytes - src.bytes} extra bytes — looks like CRLF. ` +
            'Check .gitattributes (eol=lf) and re-checkout.',
        );
      }
    }
  }

  // The commit the manifest pins must still be an ancestor of HEAD, otherwise the
  // baseline we are preserving is not the baseline that was audited.
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', manifest.product_repo_commit, 'HEAD'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    console.log(`\nOK   ${manifest.product_repo_commit} is an ancestor of HEAD`);
  } catch {
    failures.push(
      `pinned commit ${manifest.product_repo_commit} is not an ancestor of HEAD — ` +
        'the product baseline history was rewritten or detached',
    );
    console.log(`\nFAIL ${manifest.product_repo_commit} is NOT an ancestor of HEAD`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n${sources.length} manifest entr${sources.length === 1 ? 'y' : 'ies'} verified.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
