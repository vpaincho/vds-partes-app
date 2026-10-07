# Database

PostgreSQL 18 is the source of truth for **new operation** — Parte, UE, decisions, commercial
units. It is not a mirror of the VDS masters: an external master, an imported snapshot and new
operation are three different things, tracked by `platform.provenance_kind` on every table.

## Running

```bash
npm run db:up        # PostgreSQL 18 on 127.0.0.1:5434 (5433 was taken on this machine)
npm run db:migrate   # apply pending migrations
npm run db:status    # what is applied, and whether any applied file was edited
npm run db:reset     # DEV ONLY: drop owned schemas and re-apply from scratch
npm run test:db      # prove the invariants actually fire
```

`DATABASE_URL` overrides the connection string.

## Migrations

Forward-only, numbered `NNNN_lower_snake.sql`, **one transaction per file** so a failure leaves
nothing half-created. The runner records a checksum per applied migration: editing an applied file
is refused, because that is how two environments silently diverge. Add a new migration instead.

| File | Contents |
|---|---|
| `0001_platform.sql` | schemas, extensions, identity, capabilities, scopes, sessions, devices, rulesets, decision trace, command receipts, outbox, code sequences |
| `0002_config.sql` | masters, contract configuration, the rule registry, TipoParte, master-data import |
| `0003_habilita_prevent.sql` | requirements, documents, compliances, evaluations, override gates, work permits |
| `0004_planning_control.sql` | demand, plans and versions, assignments, requirements, nominations, readiness, plan-to-execution links, temporal conflicts, context bundles, directives |
| `0005_execution.sql` | Parte, UE and its immutable versions, person/resource intervals, time, location, measurement, allocation, transitions, availability, amendments |
| `0006_evidence_habilita_respond.sql` | evidence and typed links, Habilita events, classifications, escalation, cases, actions, notifications |
| `0007_review_commercial_billing.sql` | review decisions and observations, commercial units and N:M lineage, packages, conformity, adjustments, billable lines, lots, ERP attempts |
| `0008_sync.sql` | delivery state, cursors, change feed, discrepancies, evidence uploads, offline policies |
| `0009_integrity.sql` | append-only triggers, immutability after approval/closure, acyclic chains, cross-row gates |

116 tables across 11 schemas.

## Conventions

- `id uuid` primary key, **UUIDv7 generated client-side** so a device with no signal writes final
  identities. Human codes such as PD-0394 are allocated by the server from
  `platform.code_sequences`.
- `timestamptz` in UTC everywhere, **plus** explicit `operational_date` and `shift_id`. The
  operational date is decided by a configured shift boundary, never by truncating to midnight.
- Quantities are `numeric(18,6)` and always carry a `unit_of_measure_id`.
- `version integer` on every mutable aggregate, matched against the command's `expected_version`.
- JSONB only where the shape genuinely varies — rule parameters, trace inputs, provider payloads.
  Never to avoid modelling a relation.

## Why constraints and not only services

04 asks for referential, uniqueness and temporal integrity at the database level, and 03 forbids
one module reaching into another module's tables to mutate them. A trigger that refuses the write
is the backstop for when some future code path forgets. The things worth knowing:

- **Append-only**: traces, receipts, lifecycle events, UE versions, UC source links, amendments and
  override gates refuse UPDATE and DELETE outright.
- **Immutable after approval or closure**: an APROBADA plan version and the scope of its
  assignments cannot change (this is RGT-03 — the prototype shortened the approved range when a
  crew finished early); a closed UE's facts and a closed Parte's state cannot change; an ACEPTADA
  commercial unit's quantity and item cannot change.
- **Deferred**: C-009 (a started Parte has at least one UE), TPR-009 (no closing over open UE or
  intervals) and TPR-024 (no closing a case over unverified blocking actions) are DEFERRABLE
  INITIALLY DEFERRED constraint triggers, so one Start Work or Close transaction can write the
  state change and its children in any order and still be refused if the result is inconsistent.
- **Typed targets**: polymorphic references use one nullable FK per kind plus
  exactly-one-non-null, which keeps referential integrity without an opaque target id (MR-09).
- **No wildcards**: an allocation cannot claim RESUELTO without CS, CC and item, and an unresolved
  one must state why (C-004 / AP-06).

`tests/db/invariants.test.ts` proves each of these refuses the write *and* explains what to do
instead — a constraint that fires with an opaque message fails the sheet 56 contract as surely as
one that does not fire.
