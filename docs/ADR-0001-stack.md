# ADR-0001 — Stack and foundations

- **Status:** accepted for W0–W6, with the items marked *provisional* re-examined at the wave that first exercises them
- **Date:** 2026-10-06
- **Supersedes:** the candidate list in `full-implementation-pack/18_TECHNICAL_ADR.md` (which was explicitly a proposal for Plan Mode)
- **Context:** S0 §27 fixes the direction (TypeScript, React + Vite, Node API, PostgreSQL, modular monolith, CRUD + domain events, versioning, object storage, durable offline, adapter pattern) and keeps Fastify, Drizzle, TypeBox/Ajv, Dexie and PWA as *candidates to validate*. `18_TECHNICAL_ADR.md` requires that concrete versions be checked against current official sources rather than fixed from memory, and that a candidate be confirmed with runtime evidence.

## Versions: resolved, not remembered

Resolved from the npm registry on 2026-10-06, `dist-tags.latest` confirmed for each (not
`next`, not `beta`):

| Package | Resolved `latest` | Note |
|---|---|---|
| typescript | **7.0.2** | the native compiler; `rc` was 7.0.1-rc, `next` 7.1.0-dev |
| vitest | **5.0.3** | v3 and v4 still tagged; 5 is latest |
| vite | **8.3.3** | `previous` 6.4.4 |
| react / react-dom | **19.3.0** | |
| fastify | **5.12.5** | `next` is 6.0.0-alpha — stay on 5 |
| drizzle-orm / drizzle-kit | **0.45.3** / 0.31.11 | see the caveat below |
| @sinclair/typebox | **0.34.52** | |
| ajv | **8.20.0** | |
| pg | **8.23.1** | |
| dexie | **4.4.6** | |
| @playwright/test | **1.63.0** | |

Three of these differ materially from what a from-memory guess would have produced
(TypeScript 7, Vitest 5, Vite 8). That is precisely why the pack demanded the check.

## Decisions

### 1. TypeScript 7.0.2, strict, with project references — **confirmed by runtime evidence**

Verified in this repo, not assumed:

- `tsc --version` → 7.0.2, and `tsc --build` exists with its BUILD OPTIONS section.
- `tsc --build` compiles `@vds/kernel` and `@vds/ui` as composite projects, emitting
  declarations and maps, exit 0.
- The strict set the base config turns on all hold: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly`,
  `noPropertyAccessFromIndexSignature`.
- `resolveJsonModule` plus `import … with { type: 'json' }` works, which is how the
  generated state-machine dataset reaches the domain.

`erasableSyntaxOnly` earns its place beyond strictness: because the domain and token sources
contain no runtime-only TypeScript syntax, **Node can load them directly** via type
stripping. `scripts/gen-tokens.mjs` imports `packages/ui/src/tokens.ts` with no bundler and
no build step, so the generated CSS and the tests that verify contrast read the *same*
source. Keep this constraint.

### 2. npm workspaces — **forced by the environment**

`pnpm` is not installed; `npm 11.17.0` is. Workspaces are `apps/*`, `packages/*`,
`packages/domain/*` (the third is required because the domain packages are nested one level
deeper than the plan's tree implies). No functional consequence; revisit only if install
time becomes a real problem.

### 3. PostgreSQL 18 via Docker Compose in development — **confirmed available**

Docker 29.8.1 is present; no `psql` client is. So migrations run through a Node CLI and
never shell out to `psql`. Port 5433 on the host to avoid colliding with a local server.
Hosting stays undecided: `03_TARGET_ARCHITECTURE` defers deployment topology and explicitly
says not to adopt Vercel or publish by default.

### 4. MinIO in development behind `FilesPort` — **provisional**

Evidence must live outside business rows with hash and metadata in PostgreSQL. MinIO is
S3-compatible and local. The final provider is a W7 decision; nothing above `FilesPort` may
know which one it is.

### 5. Fastify 5 — **provisional, validate in W1**

Chosen as a candidate. What must be proven when the API lands: schema-driven validation and
serialisation via TypeBox/Ajv at the boundary, auth hooks that can enforce capability +
scope *before* a handler runs, streamed/resumable uploads for evidence, and testability
without a live socket. If any of those fails, this ADR gets a successor stating the failed
requirement, the alternative and the effect on the product — not a silent swap.

### 6. Drizzle 0.45.3 with explicit SQL for special constraints — **provisional, caveat recorded**

Drizzle is the candidate for schema and typed queries. **Caveat:** the registry shows a
`1.0.0-rc.4` alongside `latest` 0.45.3. Pinning 0.45.3 (stable) is deliberate; a 1.0 upgrade
is a tracked decision, not a drift.

Independent of the ORM: `EXCLUDE USING gist` for interval exclusivity, deferred constraint
triggers (C-009), append-only triggers, and the supersession cycle check are written as
**explicit SQL migrations**. The baseline requires these at the database level, and they must
not be hidden behind the ORM where a future refactor can lose them.

### 7. TypeBox + Ajv as the single schema source — **provisional, validate in W1**

One schema, used for runtime validation and for types. The failure to avoid is divergence
between the compile-time type and the runtime check. Error messages must name the field and
the reason, because the API's job is to explain a block, not just refuse it.

### 8. Dexie 4 for the durable local outbox — **provisional, validate in W4**

What must be proven on a real device, not in a unit test: quota behaviour and a visible,
blocking failure when storage is full (RGT-09); survival across reload and restart; schema
migration of pending commands; binary evidence stored outside the command JSON. S0 §19 is
explicit that sync must not be simulated.

### 9. PWA before native — **hypothesis, settled in W7 with field evidence**

Offline duration, shared-device use, browser/device matrix and evidence upload decide this.
Native stays the alternative. The domain and sync packages are kept free of DOM assumptions
so the decision does not force a rewrite.

### 10. CRUD + domain events + transactional outbox — **accepted, not event sourcing**

Current state transactional, facts append-only, lineage explicit. Full event sourcing is
rejected for now: no evidence justifies replay and event-migration cost.

### 11. Design system: own identity, Juan's structure — **accepted (decision D-2 / CC-03)**

See `DESIGN_SYSTEM.md`. This supersedes the "no new visual identity" clause of
`15_UX_PRESERVATION.md` on the user's explicit instruction. Change-control class
IMPLEMENTACIÓN per sheet 73: it reopens no part of the functional freeze. Consequence for
the test map: the visual layer verifies **capability equivalence** against the frozen
baseline plus DS-01 conformance, no longer pixel equality.

## Consequences

- The domain stays free of React, Fastify, SQL, Dexie and adapters, enforced by
  `npm run arch:check` (verified to actually fail on a planted violation, not just written).
- Anything generated from S2 carries `source_sheet` / `source_row`, so a runtime block can be
  traced to a spreadsheet row, and CI re-derives it to detect drift.
- Colour decisions are measured, not asserted: WCAG contrast for legibility, OKLab ΔE for
  distinguishability, over every token pair.

## What is explicitly *not* decided here

Hosting and deployment topology; the final auth provider; the ERP contract; the documentary
provider; the object-storage provider; device/browser matrix and offline TTL policy. All are
W7, all sit behind typed ports, and none blocks W1–W6.
