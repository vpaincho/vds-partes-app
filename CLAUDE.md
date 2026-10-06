# VDS Partes — global rules

Root rules for this repo. Authority and context map: `full-implementation-pack/00_MISSION.md`
(S0 pedido · S1 producto · S2 lógica vigente · S3 navegación · S4 reconciliación · P propuestas).
Approved build plan: `~/.claude/plans/noble-kindling-curry.md`.

## Domain
- Preserve the Juan Product Baseline: navigation, capabilities, information hierarchy. No arbitrary rewrite.
- Build one complete integrated Target Application; waves are dependency order, not reduced product scope. Define/implement TP-01/02/03.
- No silent domain reinterpretation. Resolve ambiguity with fuente/hoja/fila, propuesta y change control.
- Planning is intention; Execution is reality. Preserve approved snapshots.
- Operational ≠ Review VDS ≠ Commercial ≠ Delivery/sync. Own lifecycles for PTW/Habilita/control.
- UE is first-class. A time row, an additional resource or a different PTW is not an automatic UE/Parte identity rule.
- Hard gates run before Start/Restart and contextual changes. Validate PTW temporal coverage and scope.
- Preserve history; corrections to closed operational data use EnmiendaOperativa. Commercial differences use AjusteCertificacion.
- Preserve source versions and N:M lineage; supersession blocks new billing of obsolete UC.
- Habilita is transversal and can be standalone; report/triage/case/actions are separate lifecycles.
- Missing external access uses typed ports + fixtures, never fake business logic in the frontend. Missing configuration is explicit (`PENDING_CONFIGURATION`).
- Authorization on the server for action/object/base/contract; frontend role visibility is UX only.
- Real durable local outbox and server receipts/idempotency; no last-write-wins, no simulated sync.
- Modular monolith; no premature microservices/brokers/IoT/CV/3D.
- Build trace/permissions/idempotency from the foundations. Keep the app integrated after every wave.
- Required tests follow `17_ACCEPTANCE_TESTS.md`. Never report a functional PASS from the workbook as executed software.

## UI (decision D-2 / CC-03 — supersedes the "no new visual identity" clause of 15)
- The Target Application has **its own design system**: `DESIGN_SYSTEM.md` + `packages/ui`. Read it before writing any UI.
- Preserved from Juan: information architecture, per-role navigation, surface hierarchy, Mi Jornada, Planning (Gantt/resource/month), drawer, list–detail inboxes, plan-vs-real, interaction logic and information density.
- Free to evolve: palette, typography, scale, spacing, iconography, cards, tables, panels, states, badges, alerts, hierarchy, density, secondary navigation, touch interaction, offline/sync feedback, risk/readiness representation.
- Forbidden: copying Juan's skin literally; copying the Blueprint's editorial aesthetic; arbitrary redesign disconnected from the product; a generic SaaS template.
- Any **structural** change to navigation or behaviour needs a functional justification, never an aesthetic one.
- `legacy/baseline/` is a pinned, never-edited reference. Serve it (`npm run legacy`), never import it. See `legacy/baseline/FROZEN.md` for the 13 mutations that must not be ported.

## Repo
- `apps/{web,api,worker}` · `packages/{contracts,domain,sync,ui,adapters,testkit}` · `db/{migrations,seed}` · `tests/*` · `legacy/baseline` (frozen S1) · `full-implementation-pack` (sources).
- `packages/domain/**` imports no React, no Fastify, no SQL. `apps/web` imports no adapter SDK. The worker shares the domain; it is not a microservice.
- Migrations are forward-only, reviewable SQL; special constraints (EXCLUDE, deferred constraint triggers, append-only triggers, cycle checks) stay in explicit SQL.
- Commit order inside a wave: contracts → migrations → services/commands → UI → tests.
- Fixtures for external providers are labelled TEST in the model and visible as TEST in the UI.
