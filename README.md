# VDS Partes

Field-reporting application for **Vientos del Sur**: Planning → Execution → Habilita →
Review VDS → Certification → billing boundary.

This repo holds one Target Application, built as a modular monolith. It grew out of Juan's
navigable prototype, which is preserved — unmodified — at `legacy/baseline/` as the product
reference the new app is measured against.

> **Status: W0 (foundations).** The build plan runs W0–W6 with typed ports and TEST/fixture
> providers for every external system. W7 — real connections, providers, contractual
> configuration, deployment — is a later, explicit stage. Nothing here is approved for
> production operation.

## Authority

Decisions trace to fixed sources, never to preference. `full-implementation-pack/00_MISSION.md`
holds the authority map:

| | Source | Governs |
|---|---|---|
| **S0** | `references/mission_usuario.txt` | the current request; supersedes earlier targets |
| **S1** | `legacy/baseline/` @ `0c117aa` | product baseline: structure, navigation, hierarchy |
| **S2** | `references/Diccionario_Canonico_v3.0_…FROZEN_VDS.xlsx` | functional logic: 87 entities, 75 relations, 36 invariants, 74 rules, 11 state machines, 33 forbidden transitions, 56 golden scenarios, 14 inter-domain contracts |
| **S3** | Blueprint | functional navigation, not target UI |
| **S4** | audit + addendum in `references/` | evidence and reconciliation |

Ambiguity is resolved with source + sheet + row and recorded as change control — never
silently. `npm run verify:sources` proves the pinned sources are byte-identical to the
manifest.

## Quick start

```bash
npm install
npm run verify          # sources + generated artefacts + boundaries + types + tests
npm run legacy          # Juan's frozen prototype at http://127.0.0.1:4178 for comparison
npm run db:up           # PostgreSQL 18 + MinIO (dev only)
```

## Layout

```
apps/web                React + Vite, PWA
apps/api                Node + Fastify
apps/worker             same code, own entrypoint: outbox, expiries, reconcile, ERP
packages/domain/*       kernel, rules, and one package per owning module
packages/contracts      TypeBox schemas — one source for types and runtime validation
packages/sync           command envelope, outbox, cursor, conflict resolution
packages/ui             design system (DS-01): tokens, primitives, patterns
packages/adapters       typed ports + fixtures; real providers arrive in W7
db/migrations           forward-only SQL; special constraints stay explicit
tests/*                 domain, rules, state, api, db, permissions, offline, e2e, visual
legacy/baseline         S1, frozen and servable — never imported
full-implementation-pack  the sources themselves
```

**Enforced boundaries** (`npm run arch:check`): the domain imports no React, Fastify, SQL
driver, browser storage or adapter, so the same rules run in api, worker and web; no provider
SDK reaches the browser; nothing imports `legacy/baseline`; the dependency graph stays
acyclic and directional.

## Generated artefacts

Anything derived from S2 is generated, carries `source_sheet` / `source_row`, and is
drift-checked by `npm run gen:check`:

| Artefact | From | Script |
|---|---|---|
| `packages/domain/kernel/src/generated/state-machines.json` | sheets 48–56 | `gen:state-machines` |
| `packages/ui/src/tokens.css` | `packages/ui/src/tokens.ts` | `gen:tokens` |
| `references/canonical/{36,39,45,46,47,59–62}.json` | the workbook | `scripts/extract-canonical.py` |

Generating rather than transcribing is deliberate: a hand-copied state machine that diverges
from S2 is a domain defect, not a typo. The generators refuse to emit when the parse stops
matching the source — the 11 machine count, the per-machine state counts from sheet 48, and
the 33 prohibitions are all gates.

## Design

`DESIGN_SYSTEM.md` (DS-01). The product structure of the prototype is preserved; the visual
identity is the application's own. Colour is **measured, not asserted**: WCAG contrast for
legibility, OKLab ΔE for distinguishability, over every token pair — because rendering an
overrideable warning like a hard block is a domain error, not a cosmetic one.

## Working here

`CLAUDE.md` holds the rules that apply to every change. The ones that bite most often:

- Planning records intention, Execution records reality; neither overwrites the other.
- Operational ≠ Review VDS ≠ Commercial ≠ Delivery. Five dimensions, persisted separately.
- Hard gates run **before** Start/Restart, never after the fact.
- Closed operational data is corrected with an amendment; commercial disagreement with an
  adjustment. History is never overwritten.
- Missing integration → typed port + fixture. Missing configuration → explicit
  `PENDING_CONFIGURATION`, never an invented default.
- A functional PASS in the workbook is evidence, **never** a software test result.

`legacy/baseline/FROZEN.md` lists the thirteen mutations in the prototype that are
deliberately **not** ported, each with its line and its regression test.
