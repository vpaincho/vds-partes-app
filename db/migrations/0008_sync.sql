-- 0008 — Sync: delivery state, cursors, reconciliation and evidence upload tracking.
--
-- S0 §19 requires the delivery dimension to be kept apart from operational and commercial state,
-- with five explicit values. The prototype had `p.cola` plus a boolean `S.offline`, and the
-- `sync` action deleted the flag and wrote "Sincronizado con la base" with no network involved.
--
-- The server side of idempotency lives in platform.command_receipts (0001). This file holds what
-- the server needs to serve a device: a pull cursor per scope, the discrepancies raised when a
-- late command meets changed authorisation, and the upload state of evidence.

-- S0 §19: these five are a dimension of their own, never mixed with Parte/UE/UC state.
CREATE TYPE sync.delivery_state AS ENUM (
  'GUARDADO_LOCAL',        -- committed to device storage; nothing has left the device
  'PENDIENTE',             -- queued in the outbox
  'ENVIANDO',
  'ENVIADO',               -- transmitted; NOT proof the server committed it
  'RECIBIDO',              -- a durable server receipt exists
  'REQUIERE_INTERVENCION'  -- conflict, quota, expiry: needs a human
);

COMMENT ON TYPE sync.delivery_state IS
  'ENVIADO does not prove a commit; only RECIBIDO does, and only because a durable receipt exists
   (12_OFFLINE_SYNC). The word "Sincronizado" is reserved for this and nothing else.';

-- A monotonic pull cursor per (scope, device). Ordering is per aggregate, never by client clock.
CREATE TABLE sync.cursors (
  id          uuid PRIMARY KEY,
  scope_id    uuid NOT NULL,
  device_id   uuid NOT NULL REFERENCES platform.devices(id),
  identity_id uuid REFERENCES platform.identities(id),
  -- Opaque monotonic position the client sends back; not a timestamp, so a clock change cannot
  -- make a device skip or replay changes.
  position    bigint NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cursors_unique UNIQUE (scope_id, device_id)
);

-- The server-side change feed a device pulls. Monotonic within a scope.
CREATE SEQUENCE sync.change_position_seq AS bigint;

CREATE TABLE sync.changes (
  position     bigint PRIMARY KEY DEFAULT nextval('sync.change_position_seq'),
  scope_id     uuid NOT NULL,
  aggregate_kind text NOT NULL,
  aggregate_id uuid NOT NULL,
  change_kind  text NOT NULL,
  payload      jsonb NOT NULL,
  -- Grouping key so a client applies changes in dependency order per aggregate, not globally.
  aggregate_sequence integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT changes_kind CHECK (change_kind IN ('UPSERT', 'STATE_CHANGE', 'TOMBSTONE'))
);

CREATE INDEX changes_by_scope ON sync.changes (scope_id, position);

COMMENT ON TABLE sync.changes IS
  'A per-scope feed read with a cursor. TOMBSTONE marks something no longer in scope for a device
   — never a deletion of history, which C-002 forbids.';

-- When a command captured offline arrives after the authorising context changed, the declared
-- fact is preserved and raised as a discrepancy. 12: "capturar hecho no implica aceptarlo como
-- autorizado". This is the generalisation of PD-0394.
CREATE TABLE sync.discrepancies (
  id                 uuid PRIMARY KEY,
  command_receipt_id uuid REFERENCES platform.command_receipts(id),
  command_id         uuid NOT NULL,
  device_id          uuid REFERENCES platform.devices(id),
  identity_id        uuid REFERENCES platform.identities(id),
  discrepancy_kind   text NOT NULL,
  subject_kind       text NOT NULL,
  subject_id         uuid,
  -- What the field declared, kept verbatim. Never overwritten by the server's view.
  declared           jsonb NOT NULL,
  -- What the server knew at the time of reconciliation.
  server_state       jsonb,
  -- The base the device was working from, so a three-way comparison is possible (no LWW).
  base_state         jsonb,
  detected_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  resolved_by        uuid REFERENCES platform.identities(id),
  resolution         text,
  resolution_note    text,
  amendment_id       uuid REFERENCES execution.operational_amendments(id),
  decision_trace_id  uuid REFERENCES platform.decision_traces(id),
  CONSTRAINT discrepancies_kind CHECK (discrepancy_kind IN (
    'CONTEXT_CHANGED',        -- authorisation or context differed at execution time
    'BUNDLE_EXPIRED',         -- GS-024
    'SESSION_REVOKED',        -- RGT-11
    'VERSION_MISMATCH',       -- RGT-08
    'COMMAND_PAYLOAD_CONFLICT', -- RGT-07
    'DIRECTIVE_EXPIRED',      -- RGT-27 / RUL-058
    'PERMIT_NOT_COVERING'     -- RGT-02: the PD-0394 shape
  )),
  CONSTRAINT discrepancies_resolution CHECK (resolution IS NULL OR resolution IN (
    'ACCEPTED_AS_DECLARED', 'AMENDED', 'REJECTED', 'RECORDED_NON_COMPLIANT'
  )),
  CONSTRAINT discrepancies_resolved_has_actor
    CHECK (resolved_at IS NULL OR (resolved_by IS NOT NULL AND resolution IS NOT NULL))
);

COMMENT ON TABLE sync.discrepancies IS
  'A late command whose authorisation no longer holds is NOT discarded and NOT silently accepted.
   The declaration is preserved and escalated for an authorised human decision, which is the only
   honest handling of "the work happened but the permit did not cover it".';

CREATE INDEX discrepancies_open ON sync.discrepancies (detected_at DESC) WHERE resolved_at IS NULL;

-- Per-command delivery state as the SERVER last knew it. The device holds its own copy; this
-- exists so an operator or supervisor can see what is outstanding for a device.
CREATE TABLE sync.delivery_status (
  id             uuid PRIMARY KEY,
  command_id     uuid NOT NULL,
  device_id      uuid NOT NULL REFERENCES platform.devices(id),
  scope_id       uuid NOT NULL,
  state          sync.delivery_state NOT NULL,
  command_type   text NOT NULL,
  subject_kind   text,
  subject_id     uuid,
  attempts       integer NOT NULL DEFAULT 0,
  last_error     text,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  receipt_id     uuid REFERENCES platform.command_receipts(id),
  CONSTRAINT delivery_status_unique UNIQUE (scope_id, command_id),
  -- RECIBIDO is only claimable with a receipt. This is the constraint that stops the prototype's
  -- "Sincronizado con la base" message from ever being storable without one.
  CONSTRAINT delivery_status_recibido_requires_receipt
    CHECK (state <> 'RECIBIDO' OR receipt_id IS NOT NULL)
);

COMMENT ON CONSTRAINT delivery_status_recibido_requires_receipt ON sync.delivery_status IS
  'index.html:1557 removed the queue flag and announced synchronisation with no server involved.
   Here RECIBIDO cannot exist without a durable receipt row.';

CREATE INDEX delivery_status_outstanding ON sync.delivery_status (device_id, state)
  WHERE state <> 'RECIBIDO';

-- Resumable, idempotent evidence upload (12). Separate from the command that referenced it, so a
-- failed file does not fail the operational fact — and a required file still blocks documentary
-- completeness (RGT-09).
CREATE TABLE sync.evidence_uploads (
  id             uuid PRIMARY KEY,
  evidence_id    uuid NOT NULL REFERENCES evidence.evidence(id),
  device_id      uuid REFERENCES platform.devices(id),
  upload_token   text NOT NULL,
  byte_size      bigint NOT NULL,
  bytes_received bigint NOT NULL DEFAULT 0,
  chunk_size     integer,
  content_hash   text NOT NULL,
  status         text NOT NULL DEFAULT 'INITIATED',
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  last_error     text,
  CONSTRAINT evidence_uploads_token_unique UNIQUE (upload_token),
  CONSTRAINT evidence_uploads_status CHECK (status IN (
    'INITIATED', 'IN_PROGRESS', 'COMPLETE', 'FAILED', 'CHECKSUM_MISMATCH'
  )),
  CONSTRAINT evidence_uploads_progress CHECK (bytes_received >= 0 AND bytes_received <= byte_size),
  CONSTRAINT evidence_uploads_complete_is_whole
    CHECK (status <> 'COMPLETE' OR (bytes_received = byte_size AND completed_at IS NOT NULL))
);

COMMENT ON CONSTRAINT evidence_uploads_complete_is_whole ON sync.evidence_uploads IS
  'A partial upload can never be recorded COMPLETE. CHECKSUM_MISMATCH is its own status because a
   file that arrived corrupted is not a file that arrived.';

CREATE INDEX evidence_uploads_incomplete ON sync.evidence_uploads (started_at)
  WHERE status IN ('INITIATED', 'IN_PROGRESS', 'FAILED');

-- The versioned offline policy a device operated under: TTL, which commands are allowed offline,
-- and what contingency authority exists. 12: offline cannot know a later remote revocation, so
-- the policy in force has to be recorded rather than assumed.
CREATE TABLE sync.offline_policies (
  id                  uuid PRIMARY KEY,
  version_label       text NOT NULL UNIQUE,
  bundle_ttl_minutes  integer NOT NULL,
  allowed_commands    jsonb NOT NULL,
  -- Gates that may never be skipped offline, whatever the policy says.
  never_skip_gates    jsonb NOT NULL DEFAULT '[]'::jsonb,
  contingency_authority jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at        timestamptz NOT NULL DEFAULT now(),
  published_by        uuid REFERENCES platform.identities(id),
  is_default          boolean NOT NULL DEFAULT false,
  CONSTRAINT offline_policies_ttl_positive CHECK (bundle_ttl_minutes > 0)
);

COMMENT ON TABLE sync.offline_policies IS
  '12: "default fixture conservador bloquea inicio sin contexto/policy vigente". never_skip_gates
   holds the critical gates that a known expiry always blocks, regardless of TTL.';

CREATE UNIQUE INDEX offline_policies_one_default ON sync.offline_policies (is_default)
  WHERE is_default = true;
