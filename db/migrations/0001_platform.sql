-- 0001 — schemas, extensions and the platform tables.
--
-- Ordering note: platform comes first because command_receipts, decision_traces and
-- domain_outbox are referenced by every module. 19_IMPLEMENTATION_WAVES is explicit that
-- trace, auth and idempotency belong to W1, not to the end.

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- EXCLUDE constraints over (uuid, tstzrange)
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- digest() for payload hashes
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email, so no lower() everywhere

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS config;
CREATE SCHEMA IF NOT EXISTS planning;
CREATE SCHEMA IF NOT EXISTS execution;
CREATE SCHEMA IF NOT EXISTS habilita;
CREATE SCHEMA IF NOT EXISTS control;
CREATE SCHEMA IF NOT EXISTS evidence;
CREATE SCHEMA IF NOT EXISTS review;
CREATE SCHEMA IF NOT EXISTS commercial;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS sync;

COMMENT ON SCHEMA platform IS
  'Identity, capabilities, command receipts, decision trace, outbox. Owned by no business module.';

-- ---------------------------------------------------------------- shared conventions

-- Every operational table carries provenance. Telling an external master from an imported
-- snapshot from new operation is structural (14_DATA_INTEGRATION_ADAPTERS), not a convention.
CREATE TYPE platform.provenance_kind AS ENUM (
  'NEW_OPERATION',      -- originated here; PostgreSQL is the source of truth
  'EXTERNAL_MASTER',    -- owned by an external system (VDS MySQL, ERP)
  'IMPORTED_SNAPSHOT',  -- a point-in-time copy, never rewritten by a later import
  'FIXTURE_TEST'        -- TEST data behind a port; must never reach a productive base
);

CREATE TYPE platform.time_source AS ENUM (
  'DEVICE_CLOCK', 'SERVER_CLOCK', 'USER_DECLARED', 'EXTERNAL_SOURCE'
);

-- ---------------------------------------------------------------------- identity

CREATE TABLE platform.identities (
  id                uuid PRIMARY KEY,
  subject_ref       text NOT NULL,          -- verified subject as the provider states it
  provider          text NOT NULL,          -- 'fixture-dev' now; a corporate IdP later
  display_name      text NOT NULL,
  email             citext,
  person_id         uuid,                   -- FK added in 0002, once config.people exists
  is_active         boolean NOT NULL DEFAULT true,
  provenance        platform.provenance_kind NOT NULL DEFAULT 'FIXTURE_TEST',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT identities_provider_subject_unique UNIQUE (provider, subject_ref)
);

COMMENT ON TABLE platform.identities IS
  'A verified subject. The provider is swappable (13_AUTH_PERMISSIONS); the internal permission
   mapping stays independent of it, so changing IdP never changes authorisation.';

-- Capabilities, not roles. The check is always on a capability; a role is only a bundle.
CREATE TABLE platform.capabilities (
  id           text PRIMARY KEY,            -- 'execution.start', 'habilita.override'
  module       text NOT NULL,
  description  text NOT NULL,
  -- True when granting this needs a second authority: 13 asks to separate emitting from
  -- authorising overrides and amendments where policy requires dual control.
  dual_control boolean NOT NULL DEFAULT false
);

CREATE TABLE platform.roles (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  description text NOT NULL
);

CREATE TABLE platform.role_capabilities (
  role_id       text NOT NULL REFERENCES platform.roles(id) ON DELETE CASCADE,
  capability_id text NOT NULL REFERENCES platform.capabilities(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, capability_id)
);

-- Scope is multi-dimensional: company, base, contract. Every API call checks action + object +
-- ownership, reads and downloads included.
CREATE TABLE platform.identity_scopes (
  id          uuid PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES platform.identities(id) ON DELETE CASCADE,
  role_id     text NOT NULL REFERENCES platform.roles(id),
  company_id  uuid,
  base_id     uuid,
  contract_id uuid,
  valid_from  timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  granted_by  uuid REFERENCES platform.identities(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_scopes_window CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX identity_scopes_lookup
  ON platform.identity_scopes (identity_id, valid_from DESC)
  INCLUDE (role_id, company_id, base_id, contract_id);

CREATE TABLE platform.sessions (
  id             uuid PRIMARY KEY,
  identity_id    uuid NOT NULL REFERENCES platform.identities(id),
  device_id      uuid,
  started_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text,
  CONSTRAINT sessions_expiry CHECK (expires_at > started_at)
);

CREATE INDEX sessions_active ON platform.sessions (identity_id) WHERE revoked_at IS NULL;

-- A shared tablet isolates scope and queue per device (12_OFFLINE_SYNC).
CREATE TABLE platform.devices (
  id                     uuid PRIMARY KEY,
  label                  text NOT NULL,
  enrolled_at            timestamptz NOT NULL DEFAULT now(),
  enrolled_by            uuid REFERENCES platform.identities(id),
  revoked_at             timestamptz,
  last_sync_at           timestamptz,
  -- The offline policy this device was provisioned with. Offline cannot know a later remote
  -- revocation, so the policy it acted under has to be on record.
  offline_policy_version text
);

ALTER TABLE platform.sessions
  ADD CONSTRAINT sessions_device_fk FOREIGN KEY (device_id) REFERENCES platform.devices(id);

-- ------------------------------------------------------- rulesets and decision trace

CREATE TABLE platform.ruleset_versions (
  id            uuid PRIMARY KEY,
  version_label text NOT NULL UNIQUE,
  published_at  timestamptz NOT NULL DEFAULT now(),
  published_by  uuid REFERENCES platform.identities(id),
  -- Hash over every rule_version included, so a trace can prove which rules were in force.
  content_hash  text NOT NULL,
  notes         text
);

CREATE TABLE platform.decision_traces (
  id                 uuid PRIMARY KEY,
  decision           text NOT NULL,
  subject_kind       text NOT NULL,
  subject_id         uuid,
  trigger            text NOT NULL,
  current_state      text,
  target_state       text,
  actor_id           uuid REFERENCES platform.identities(id),
  device_id          uuid REFERENCES platform.devices(id),
  ruleset_version_id uuid REFERENCES platform.ruleset_versions(id),
  -- Normalised inputs plus a context snapshot: enough to reconstruct the decision without
  -- copying every personal field into every trace.
  normalized_inputs  jsonb NOT NULL,
  context_hash       text NOT NULL,
  blocks             jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings           jsonb NOT NULL DEFAULT '[]'::jsonb,
  confirmations      jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing            jsonb NOT NULL DEFAULT '[]'::jsonb,
  effects            jsonb NOT NULL DEFAULT '[]'::jsonb,
  override_ref       jsonb,
  preview            boolean NOT NULL,
  parent_trace_id    uuid REFERENCES platform.decision_traces(id),
  correlation_id     uuid,
  decision_at        timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decision_traces_decision_kind
    CHECK (decision IN ('ALLOW', 'BLOCK', 'WARN', 'REQUIRE_CONFIRMATION', 'NO_OP'))
);

COMMENT ON TABLE platform.decision_traces IS
  'Append-only explanation of an evaluation (RUL-074, R-073..R-075). A BLOCK also gets a trace,
   with no operational effects. Never updated: re-evaluating creates a new, related trace.';

CREATE INDEX decision_traces_subject
  ON platform.decision_traces (subject_kind, subject_id, decision_at DESC);
CREATE INDEX decision_traces_correlation
  ON platform.decision_traces (correlation_id) WHERE correlation_id IS NOT NULL;

-- Which rules won, which lost and why (sheet 58 step 8).
CREATE TABLE platform.decision_trace_rules (
  id                uuid PRIMARY KEY,
  decision_trace_id uuid NOT NULL REFERENCES platform.decision_traces(id) ON DELETE CASCADE,
  rule_id           text NOT NULL,
  precedence        text NOT NULL,
  outcome           text NOT NULL,
  note              text,
  rule_version_id   uuid,
  CONSTRAINT decision_trace_rules_outcome CHECK (outcome IN (
    'WON', 'DISCARDED_BY_PRECEDENCE', 'DISCARDED_BY_SPECIFICITY', 'NOT_APPLICABLE'
  )),
  CONSTRAINT decision_trace_rules_precedence CHECK (precedence ~ '^P[0-8]$')
);

CREATE INDEX decision_trace_rules_by_trace ON platform.decision_trace_rules (decision_trace_id);
CREATE INDEX decision_trace_rules_by_rule ON platform.decision_trace_rules (rule_id, outcome);

-- ---------------------------------------------------------- receipts and idempotency

CREATE TABLE platform.command_receipts (
  id                uuid PRIMARY KEY,
  -- Deduplication is (scope_id, command_id). scope_id is the authorisation scope the command
  -- was accepted under, so two scopes cannot collide on a client-minted id.
  scope_id          uuid NOT NULL,
  command_id        uuid NOT NULL,
  command_type      text NOT NULL,
  subject_kind      text NOT NULL,
  subject_id        uuid,
  actor_id          uuid NOT NULL REFERENCES platform.identities(id),
  device_id         uuid REFERENCES platform.devices(id),
  -- The original outcome, returned verbatim on every retry (RGT-06: same receipt, same ids,
  -- one single effect).
  outcome           text NOT NULL,
  decision_trace_id uuid REFERENCES platform.decision_traces(id),
  -- Hash of the canonical payload. The same id with a different hash is a typed conflict and
  -- produces no further effect (RGT-07).
  payload_hash      text NOT NULL,
  payload_meta      jsonb NOT NULL DEFAULT '{}'::jsonb,
  effects           jsonb NOT NULL DEFAULT '[]'::jsonb,
  occurred_at       timestamptz NOT NULL,
  recorded_at       timestamptz NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT command_receipts_scope_command_unique UNIQUE (scope_id, command_id),
  CONSTRAINT command_receipts_outcome CHECK (outcome IN ('APPLIED', 'NO_OP', 'BLOCKED'))
);

COMMENT ON CONSTRAINT command_receipts_scope_command_unique ON platform.command_receipts IS
  'The idempotency key. A retry after a lost ACK returns this row; it never creates a second
   Parte, UE, measurement or directive.';

-- ------------------------------------------------------------------ transactional outbox

CREATE TYPE platform.outbox_status AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'FAILED', 'DEAD');

CREATE TABLE platform.domain_outbox (
  id             uuid PRIMARY KEY,
  event_type     text NOT NULL,
  subject_kind   text NOT NULL,
  subject_id     uuid,
  payload        jsonb NOT NULL,
  correlation_id uuid,
  causation_id   uuid,
  status         platform.outbox_status NOT NULL DEFAULT 'PENDING',
  attempts       integer NOT NULL DEFAULT 0,
  last_error     text,
  available_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);

COMMENT ON TABLE platform.domain_outbox IS
  'Domain facts awaiting reaction, written in the same transaction as the state change
   (03_TARGET_ARCHITECTURE). Not event sourcing: current state stays transactional. Eventual
   emission never promises external receipt.';

CREATE INDEX domain_outbox_ready ON platform.domain_outbox (available_at)
  WHERE status IN ('PENDING', 'FAILED');

-- Human-facing codes are allocated here, never derived on a device from max+1.
CREATE TABLE platform.code_sequences (
  prefix     text NOT NULL,
  scope_id   uuid NOT NULL,
  next_value bigint NOT NULL DEFAULT 1,
  width      smallint NOT NULL DEFAULT 4,
  PRIMARY KEY (prefix, scope_id)
);

COMMENT ON TABLE platform.code_sequences IS
  'Server-side allocation of PD-/PL- style codes. index.html derived them from max(local)+1, so
   two offline devices minted the same code for different work.';
