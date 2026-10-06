# Product Baseline (S1) — FROZEN

This directory holds Juan's prototype exactly as it was received. It is the **reference**
for what the Target Application must preserve, and the thing visual/UX verification
compares against. It is **not live code** and nothing in `apps/` or `packages/` imports it.

## Pinned identity

| Item | Value |
|---|---|
| Repo | `https://github.com/vpaincho/vds-partes-app` |
| Commit | `0c117aacc6f04a745b3499b0479a938d36821502` (v0.4) |
| `index.html` | `sha256 bfbc2756e92e850e92bb21ab77955bb5e5df657c159b7479d9f73b95fb236697` · 190 179 bytes |
| `README.md` | `sha256 246058ad64b160d1821745dac29bb36fb4fd9ff676d54fc283fca377b26694e4` · 3 395 bytes |
| Authority | `full-implementation-pack/00_MISSION.md` → **S1** · hashes from `reference_manifest.json` |

Verify at any time:

```bash
npm run verify:baseline     # re-hashes both files against reference_manifest.json
```

The working tree matches these hashes byte for byte because `.gitattributes` pins
`eol=lf`. Before that, `core.autocrlf=true` produced a CRLF checkout hashing
`ffc57d96…` — same content, 1736 extra CR bytes. See `.gitattributes` for the note.

## What this baseline IS authority for

Product structure and interaction, per `01_PRODUCT_BASELINE.md` and `15_UX_PRESERVATION.md`:

- navigation per actor, collapsible rail, visible identity/context;
- Planning: Gantt / resource / month, occupancy, drawer, extension request;
- Mi jornada prioritised by pending / current / upcoming / sent;
- contextual detail; the integrated tasks–times sheet, timeline and production;
- Review and Certification as list–detail inboxes; plan-vs-real; evidence; history;
- dashboard and configuration;
- information hierarchy, density, and the actions an operator already recognises.

## What this baseline is NOT authority for

1. **Visual skin.** Superseded by decision **D-2 / CC-03**: the Target Application has
   its own design system (`DESIGN_SYSTEM.md`, `packages/ui`). Product structure is
   preserved; palette, type scale, spacing, iconography and component styling evolve.
   Any *structural* change to navigation or behaviour still needs a functional reason.

2. **Domain semantics.** Thirteen mutations in this file are semantically incorrect
   against the frozen functional baseline (S2) and are deliberately **not ported**.
   They survive here as the negative fixtures behind RGT-01…RGT-05:

   | Line | What it does | Why it is wrong |
   |---|---|---|
   | `o-start` 1607 | sets `estado:'curso'` immediately | validation happens after execution; no Start Work gate |
   | `o-send` 1629 | `t.dias = p.dia+1` on early finish | rewrites the approved plan (**RGT-03**) |
   | `c-obs` 1634 | client observation sets `p.estado='obs'` | sends operational reality back to field editing (**RGT-04**) |
   | `o-delp` 1618 | `splice` of personnel | erases historical presence (**RGT-05**) |
   | `clashes` 835 | excludes by object identity `o!==t` | a copy/proposal conflicts with itself (**RGT-01 / PL-093**) |
   | `checks` 855 | PTW presence only | no temporal coverage (**RGT-02 / PD-0394**) |
   | `a-est` 1588 | admin sets any state | arbitrary state PATCH |
   | `a-reopen` 1577 | reopens a closed job | closed reality must use an amendment |
   | `a-del` 1576 | hard-deletes a job | C-002: version/invalidate/supersede, never delete |
   | `sync` 1557 | clears `cola`, writes "Sincronizado con la base" | no network, no receipt |
   | `lastKm` 848 | takes the maximum of prior parts | not the strictly prior reading by instant+version |
   | `sums`/`dur` 887/688 | sums overlapping intervals; `fin<inicio` ⇒ next day | no operational date / shift (**RGT-10**) |
   | `save` 814 | `try{}catch(e){}` while the UI says "Guardado automático" | quota failure is invisible (**RGT-09**) |

   `nextPD()` (841) also derives IDs from local `max+1`, which collides across devices.

3. **Layout requirements.** The scaled 1366×1024 tablet frame (`fit()`) is
   demonstrative. The Target Application is responsive; it does not scale the whole
   app to fit a frame.

4. **Demo affordances.** The role switcher, shared demo password and simulated
   offline toggle are demo-only and are excluded from the operational build.

## Rules for this directory

- **Never edit these files.** They are a pinned source, not a starting point.
- Serve, don't import: `npm run legacy` serves this folder at `/legacy` so a reviewer
  can walk the original beside the new app. No build step, no bundler entry.
- If a comparison shows the new app lost a capability listed above, the new app is
  wrong — not this baseline. Record it in `docs/ux-inventory.md` and fix it.
