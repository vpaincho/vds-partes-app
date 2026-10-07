-- 0006 — Evidence (60, 61) and Habilita RESPOND & LEARN (67..76).
--
-- Evidence: C-024 / MR-05 / R-048. A photo, signature or document validates many kinds of object
-- (UE version, PTW, Habilita event, case, commercial unit, package). The prototype stored base64
-- inside the state blob, so files shared the fate of the row that held them and had no hash,
-- no size and no independent delivery status. Here evidence is its own entity with object-store
-- metadata, and its links are typed with exactly-one-non-null rather than an opaque target id.
--
-- Habilita Respond: the prototype had no circuit at all — an incident was text in the
-- observations field. C-025 is explicit that an EventoHabilita is not a TipoParte and can exist
-- with no active execution (GS-033), and C-026 that one event may touch N UE, people, resources
-- and permits without changing its identity.

-- ------------------------------------------------------------------------- evidence

CREATE TYPE evidence.upload_status AS ENUM (
  'LOCAL_ONLY',   -- captured on the device, not yet uploaded
  'UPLOADING',
  'STORED',       -- object store confirmed, checksum verified
  'FAILED',
  'QUARANTINED'
);

CREATE TABLE evidence.evidence (
  id              uuid PRIMARY KEY,
  evidence_type   text NOT NULL,
  -- Object-store coordinates. Access is always through a short-lived signed URL granted after a
  -- permission check, never a predictable name (13).
  object_key      text,
  content_type    text,
  byte_size       bigint,
  -- Checksum of the bytes as captured on the device, so a corrupted or truncated upload is
  -- detectable rather than silently accepted.
  content_hash    text,
  upload_status   evidence.upload_status NOT NULL DEFAULT 'LOCAL_ONLY',
  upload_error    text,
  stored_at       timestamptz,
  captured_at     timestamptz NOT NULL,
  captured_by     uuid REFERENCES platform.identities(id),
  device_id       uuid REFERENCES platform.devices(id),
  caption         text,
  latitude        numeric(9, 6),
  longitude       numeric(9, 6),
  provenance      platform.provenance_kind NOT NULL DEFAULT 'NEW_OPERATION',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_type CHECK (evidence_type IN (
    'PHOTO', 'VIDEO', 'AUDIO', 'SIGNATURE', 'DOCUMENT', 'MEASUREMENT_READING'
  )),
  -- A STORED record must have the object coordinates and the checksum that prove it.
  CONSTRAINT evidence_stored_is_complete CHECK (
    upload_status <> 'STORED'
    OR (object_key IS NOT NULL AND content_hash IS NOT NULL AND byte_size IS NOT NULL
        AND stored_at IS NOT NULL)
  ),
  CONSTRAINT evidence_failed_has_error CHECK (upload_status <> 'FAILED' OR upload_error IS NOT NULL)
);

COMMENT ON CONSTRAINT evidence_stored_is_complete ON evidence.evidence IS
  'RGT-09: a closure that requires evidence must not be reported documentary-complete while the
   file has not actually been delivered. STORED is only reachable with real object metadata.';

CREATE INDEX evidence_pending_upload ON evidence.evidence (captured_at)
  WHERE upload_status IN ('LOCAL_ONLY', 'UPLOADING', 'FAILED');

-- R-048 + MR-09: typed targets with exactly-one-non-null. Integrity is real, the table count
-- stays sane, and a valid id of the wrong type cannot be stored.
CREATE TABLE evidence.evidence_links (
  id                        uuid PRIMARY KEY,
  evidence_id               uuid NOT NULL REFERENCES evidence.evidence(id),
  target_kind               text NOT NULL,
  execution_unit_version_id uuid REFERENCES execution.execution_unit_versions(id),
  execution_unit_id         uuid REFERENCES execution.execution_units(id),
  part_id                   uuid REFERENCES execution.parts(id),
  work_permit_id            uuid REFERENCES habilita.work_permits(id),
  habilita_event_id         uuid,              -- FK added below, after the table exists
  habilita_case_id          uuid,
  habilita_document_id      uuid REFERENCES habilita.documents(id),
  amendment_id              uuid REFERENCES execution.operational_amendments(id),
  override_gate_id          uuid REFERENCES habilita.override_gates(id),
  commercial_unit_id        uuid,              -- FK in 0007
  package_version_id        uuid,              -- FK in 0007
  role                      text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_links_exactly_one_target CHECK (
    (execution_unit_version_id IS NOT NULL)::int + (execution_unit_id IS NOT NULL)::int
    + (part_id IS NOT NULL)::int + (work_permit_id IS NOT NULL)::int
    + (habilita_event_id IS NOT NULL)::int + (habilita_case_id IS NOT NULL)::int
    + (habilita_document_id IS NOT NULL)::int + (amendment_id IS NOT NULL)::int
    + (override_gate_id IS NOT NULL)::int + (commercial_unit_id IS NOT NULL)::int
    + (package_version_id IS NOT NULL)::int = 1
  )
);

COMMENT ON TABLE evidence.evidence_links IS
  'MR-09 guardrail: "Mantener scope lógico, pero exigir implementación tipada/constraint fuerte."
   One nullable FK per target kind plus exactly-one-non-null gives referential integrity without
   an opaque polymorphic column and without eleven near-identical bridge tables.';

CREATE INDEX evidence_links_by_evidence ON evidence.evidence_links (evidence_id);
CREATE INDEX evidence_links_by_ue_version ON evidence.evidence_links (execution_unit_version_id)
  WHERE execution_unit_version_id IS NOT NULL;

-- Deferred evidence FKs from earlier migrations.
ALTER TABLE habilita.documents
  ADD CONSTRAINT documents_evidence_fk FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);
ALTER TABLE habilita.override_gates
  ADD CONSTRAINT override_gates_evidence_fk FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);
ALTER TABLE habilita.work_permit_checks
  ADD CONSTRAINT wp_checks_evidence_fk FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);
ALTER TABLE execution.operational_amendments
  ADD CONSTRAINT amendments_evidence_fk FOREIGN KEY (evidence_id) REFERENCES evidence.evidence(id);

-- ------------------------------------------------------------ Habilita events and cases

CREATE TYPE habilita.event_state AS ENUM (
  'REPORTADO', 'EN_TRIAGE', 'CLASIFICADO', 'ESCALADO_A_CASO', 'CERRADO_SIN_CASO', 'DESCARTADO'
);

CREATE TYPE habilita.case_state AS ENUM (
  'ABIERTO', 'EN_INVESTIGACION', 'SEGUIMIENTO_ACCIONES', 'LISTO_PARA_CIERRE', 'CERRADO'
);

CREATE TYPE habilita.action_state AS ENUM (
  'PENDIENTE', 'EN_PROGRESO', 'IMPLEMENTADA', 'EN_VERIFICACION', 'VERIFICADA', 'CANCELADA'
);

CREATE TABLE habilita.events (
  id                    uuid PRIMARY KEY,
  code                  text,
  state                 habilita.event_state NOT NULL DEFAULT 'REPORTADO',
  -- CF-09 / RUL-047: the minimum a reporter supplies. Severity, classification and root cause
  -- are NOT asked of the field — triage adds them later.
  initial_category      text NOT NULL,
  short_description     text NOT NULL,
  -- IH-13: an immediate judgement by the reporter that changes the response. RUL-051 makes
  -- "NO" default to a conservative immediate block on the affected work.
  situation_controlled  boolean NOT NULL,
  reported_by           uuid NOT NULL REFERENCES platform.identities(id),
  -- Three distinct instants: when it happened, when it was detected, when it was reported.
  occurred_at           timestamptz NOT NULL,
  detected_at           timestamptz,
  reported_at           timestamptz NOT NULL,
  technical_location_id uuid REFERENCES config.technical_locations(id),
  unmapped_location     text,
  latitude              numeric(9, 6),
  longitude             numeric(9, 6),
  device_id             uuid REFERENCES platform.devices(id),
  -- The classification currently in force, as a pointer. The initial report above is immutable.
  current_classification_id uuid,
  closed_without_case_at timestamptz,
  discarded_at          timestamptz,
  discarded_reason      text,
  duplicate_of_id       uuid REFERENCES habilita.events(id),
  decision_trace_id     uuid REFERENCES platform.decision_traces(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  CONSTRAINT events_discarded_has_reason
    CHECK (state <> 'DESCARTADO' OR discarded_reason IS NOT NULL),
  CONSTRAINT events_not_own_duplicate CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id),
  CONSTRAINT events_timestamps CHECK (reported_at >= occurred_at)
);

COMMENT ON TABLE habilita.events IS
  'C-025: an EventoHabilita is not a TipoParte and may exist with no active execution (GS-033).
   The initial report is immutable (RUL-048/049): reclassification is a new version, never an
   edit, so what the reporter actually said is preserved.';

CREATE INDEX events_by_state ON habilita.events (state, reported_at DESC);
CREATE INDEX events_uncontrolled ON habilita.events (reported_at DESC)
  WHERE situation_controlled = false;

ALTER TABLE evidence.evidence_links
  ADD CONSTRAINT evidence_links_habilita_event_fk
  FOREIGN KEY (habilita_event_id) REFERENCES habilita.events(id);

-- RUL-049: classification evolves as a version, without erasing the initial values.
CREATE TABLE habilita.event_classifications (
  id                 uuid PRIMARY KEY,
  event_id           uuid NOT NULL REFERENCES habilita.events(id),
  version_no         integer NOT NULL,
  category           text NOT NULL,
  severity           text,
  event_type_code    text,
  classified_by      uuid NOT NULL REFERENCES platform.identities(id),
  classified_at      timestamptz NOT NULL,
  justification      text,
  ruleset_version_id uuid REFERENCES platform.ruleset_versions(id),
  CONSTRAINT event_classifications_unique UNIQUE (event_id, version_no)
);

ALTER TABLE habilita.events
  ADD CONSTRAINT events_current_classification_fk
  FOREIGN KEY (current_classification_id) REFERENCES habilita.event_classifications(id);

-- C-026 / R-052..R-055: one event links to N UE, people, resources and permits with typed roles,
-- without duplicating the event.
CREATE TABLE habilita.event_execution_units (
  id                uuid PRIMARY KEY,
  event_id          uuid NOT NULL REFERENCES habilita.events(id),
  execution_unit_id uuid NOT NULL REFERENCES execution.execution_units(id),
  link_role         text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_ue_unique UNIQUE (event_id, execution_unit_id),
  CONSTRAINT event_ue_role CHECK (link_role IN ('ORIGIN', 'AFFECTED', 'RELATED'))
);

CREATE TABLE habilita.event_people (
  id         uuid PRIMARY KEY,
  event_id   uuid NOT NULL REFERENCES habilita.events(id),
  person_id  uuid NOT NULL REFERENCES config.people(id),
  link_role  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_people_unique UNIQUE (event_id, person_id, link_role),
  CONSTRAINT event_people_role CHECK (link_role IN ('AFFECTED', 'INVOLVED', 'WITNESS', 'REPORTER'))
);

CREATE TABLE habilita.event_resources (
  id          uuid PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES habilita.events(id),
  resource_id uuid NOT NULL REFERENCES config.resources(id),
  link_role   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_resources_unique UNIQUE (event_id, resource_id, link_role),
  CONSTRAINT event_resources_role CHECK (link_role IN ('AFFECTED', 'INVOLVED', 'RELATED'))
);

CREATE TABLE habilita.event_permits (
  id             uuid PRIMARY KEY,
  event_id       uuid NOT NULL REFERENCES habilita.events(id),
  work_permit_id uuid NOT NULL REFERENCES habilita.work_permits(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_permits_unique UNIQUE (event_id, work_permit_id)
);

COMMENT ON TABLE habilita.event_permits IS
  'R-055: event and permit keep separate lifecycles. Linking them does not make one drive the
   other, and closing a Parte never closes either.';

-- R-056 / RUL-050 / C-027: an auditable escalation snapshot. Outputs reuse Directiva / PTW /
-- Caso / Notificación — there is no parallel Habilita bus.
CREATE TABLE habilita.escalation_evaluations (
  id                 uuid PRIMARY KEY,
  event_id           uuid NOT NULL REFERENCES habilita.events(id),
  rule_version_id    uuid REFERENCES config.rule_versions(id),
  inputs             jsonb NOT NULL,
  required_outputs   jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_case      boolean NOT NULL DEFAULT false,
  evaluated_at       timestamptz NOT NULL,
  ruleset_version_id uuid REFERENCES platform.ruleset_versions(id),
  decision_trace_id  uuid REFERENCES platform.decision_traces(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE habilita.escalation_evaluations IS
  'RUL-050: the rule and its version are recorded with the inputs, so thresholds are never
   hardcoded outside configuration and a past escalation can be explained.';

CREATE INDEX escalation_evaluations_by_event
  ON habilita.escalation_evaluations (event_id, evaluated_at DESC);

-- R-057: at most one case per event (UNIQUE), with its own lifecycle (C-028).
CREATE TABLE habilita.cases (
  id                    uuid PRIMARY KEY,
  event_id              uuid NOT NULL REFERENCES habilita.events(id),
  code                  text,
  state                 habilita.case_state NOT NULL DEFAULT 'ABIERTO',
  owner_id              uuid REFERENCES platform.identities(id),
  -- Investigation state is separate from case state: the investigation can finish while actions
  -- remain open (T-CH03, GS-035).
  investigation_state   text NOT NULL DEFAULT 'NO_INICIADA',
  investigation_summary text,
  opened_at             timestamptz NOT NULL,
  investigation_started_at timestamptz,
  investigation_finished_at timestamptz,
  ready_for_closure_at  timestamptz,
  closed_at             timestamptz,
  closed_by             uuid REFERENCES platform.identities(id),
  -- T-CH06 is CONDICIONAL: a closed case may reopen on material new evidence plus authority,
  -- and that adds history rather than erasing the closure.
  reopened_at           timestamptz,
  reopened_reason       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  CONSTRAINT cases_event_unique UNIQUE (event_id),
  CONSTRAINT cases_investigation_state CHECK (investigation_state IN (
    'NO_INICIADA', 'EN_CURSO', 'FINALIZADA'
  )),
  -- TPR-023: a case cannot close with its investigation still open.
  CONSTRAINT cases_closed_requires_finished_investigation
    CHECK (state <> 'CERRADO' OR investigation_state = 'FINALIZADA'),
  CONSTRAINT cases_closed_timestamp CHECK (state <> 'CERRADO' OR closed_at IS NOT NULL),
  CONSTRAINT cases_reopened_has_reason CHECK (reopened_at IS NULL OR reopened_reason IS NOT NULL)
);

COMMENT ON CONSTRAINT cases_closed_requires_finished_investigation ON habilita.cases IS
  'TPR-023 as a check. TPR-024 (no closing with unverified blocking actions) needs to see the
   action rows, so it is enforced by a trigger in 0008.';

ALTER TABLE evidence.evidence_links
  ADD CONSTRAINT evidence_links_habilita_case_fk
  FOREIGN KEY (habilita_case_id) REFERENCES habilita.cases(id);

-- R-058: estimate and confirmation coexist as versions (e.g. a spill volume refined later).
CREATE TABLE habilita.event_measurements (
  id                 uuid PRIMARY KEY,
  event_id           uuid NOT NULL REFERENCES habilita.events(id),
  metric_code        text NOT NULL,
  quantity           numeric(18, 6) NOT NULL,
  unit_of_measure_id uuid NOT NULL REFERENCES config.units_of_measure(id),
  measurement_kind   text NOT NULL,
  version_no         integer NOT NULL DEFAULT 1,
  measured_at        timestamptz NOT NULL,
  measured_by        uuid REFERENCES platform.identities(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_measurements_kind CHECK (measurement_kind IN ('ESTIMATE', 'CONFIRMED')),
  CONSTRAINT event_measurements_unique UNIQUE (event_id, metric_code, version_no)
);

-- R-059: an obligation with a responsible party, deadline, status and evidence. The technical
-- channel is NOT part of the obligation (C-027, FC-13): a fixture channel does not discharge it.
CREATE TABLE habilita.notifications (
  id                 uuid PRIMARY KEY,
  event_id           uuid REFERENCES habilita.events(id),
  case_id            uuid REFERENCES habilita.cases(id),
  escalation_evaluation_id uuid REFERENCES habilita.escalation_evaluations(id),
  obligation_code    text NOT NULL,
  recipient_role     text NOT NULL,
  recipient_identity_id uuid REFERENCES platform.identities(id),
  responsible_id     uuid REFERENCES platform.identities(id),
  due_at             timestamptz,
  status             text NOT NULL DEFAULT 'PENDIENTE',
  resolved_at        timestamptz,
  resolution_note    text,
  evidence_id        uuid REFERENCES evidence.evidence(id),
  -- Whether a delivery attempt was made through a real provider or a TEST channel. RGT-16: a
  -- fixture channel is labelled TEST and never proves external delivery.
  channel_kind       text NOT NULL DEFAULT 'NONE',
  channel_reference  text,
  channel_attempted_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_has_scope CHECK (event_id IS NOT NULL OR case_id IS NOT NULL),
  CONSTRAINT notifications_status CHECK (status IN (
    'PENDIENTE', 'EN_CURSO', 'RESUELTA', 'VENCIDA', 'CANCELADA'
  )),
  CONSTRAINT notifications_channel_kind CHECK (channel_kind IN ('NONE', 'TEST_FIXTURE', 'REAL_PROVIDER')),
  CONSTRAINT notifications_resolved_has_note
    CHECK (status <> 'RESUELTA' OR resolution_note IS NOT NULL)
);

COMMENT ON COLUMN habilita.notifications.channel_kind IS
  'RGT-16: TEST_FIXTURE marks a simulated send. Resolving the obligation requires evidence of the
   obligation being met, not a successful call to a fixture.';

CREATE INDEX notifications_open ON habilita.notifications (due_at)
  WHERE status IN ('PENDIENTE', 'EN_CURSO');

-- R-060 / C-028: an action has its own lifecycle. A case does not close with unverified blocking
-- actions (RUL-053, TPR-024), and actions do not close because a Parte closed.
CREATE TABLE habilita.corrective_actions (
  id              uuid PRIMARY KEY,
  case_id         uuid NOT NULL REFERENCES habilita.cases(id),
  code            text,
  state           habilita.action_state NOT NULL DEFAULT 'PENDIENTE',
  description     text NOT NULL,
  action_kind     text,
  -- Whether this action blocks closing the case. Configuration decides (B-09), so it is a
  -- column rather than an assumption.
  is_blocking     boolean NOT NULL DEFAULT false,
  responsible_id  uuid NOT NULL REFERENCES platform.identities(id),
  due_at          timestamptz,
  implemented_at  timestamptz,
  verified_at     timestamptz,
  verified_by     uuid REFERENCES platform.identities(id),
  cancelled_at    timestamptz,
  cancellation_reason text,
  evidence_id     uuid REFERENCES evidence.evidence(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT corrective_actions_verified_has_verifier
    CHECK (state <> 'VERIFICADA' OR (verified_at IS NOT NULL AND verified_by IS NOT NULL)),
  -- The submachine allows CANCELADA only with cause and authority.
  CONSTRAINT corrective_actions_cancelled_has_reason
    CHECK (state <> 'CANCELADA' OR cancellation_reason IS NOT NULL)
);

CREATE INDEX corrective_actions_by_case ON habilita.corrective_actions (case_id, state);
CREATE INDEX corrective_actions_blocking_open ON habilita.corrective_actions (case_id)
  WHERE is_blocking = true AND state <> 'VERIFICADA' AND state <> 'CANCELADA';

-- Case lifecycle log, append-only.
CREATE TABLE habilita.case_events (
  id          uuid PRIMARY KEY,
  case_id     uuid NOT NULL REFERENCES habilita.cases(id),
  event_type  text NOT NULL,
  from_state  habilita.case_state,
  to_state    habilita.case_state NOT NULL,
  actor_id    uuid REFERENCES platform.identities(id),
  reason      text,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX case_events_by_case ON habilita.case_events (case_id, occurred_at);
