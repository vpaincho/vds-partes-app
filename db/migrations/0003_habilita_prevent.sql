-- 0003 — Habilita PREVENT: requirements, documents, compliances, evaluations, overrides, PTW.
--
-- Logical entities 23, 24, 25, 62, 63, 64, 65.
--
-- This is where the prototype's single `S.hab[sujeto|operadora] = {vence}` becomes a real
-- model. That one date per subject per operator could not express multiple requirements, could
-- not say which document satisfied what, and had no notion of a work permit as an object — so
-- `checks()` could only confirm that three PTW fields were non-empty, which is exactly how
-- PD-0394 passed with "Sin bloqueos" while work ran 4 hours before the permit was signed.
--
-- The matrix the prototype showed is preserved as a *projection* over these tables (10), not as
-- the storage model.

CREATE TYPE habilita.requirement_severity AS ENUM (
  'HARD_BLOCK',   -- RUL-039: never overrideable (C-018)
  'WARNING',      -- RUL-040: overrideable only through a declared OverrideGate (RUL-041)
  'INFORMATIVE'
);

CREATE TYPE habilita.subject_kind AS ENUM ('PERSON', 'RESOURCE');

CREATE TABLE habilita.requirements (
  id                 uuid PRIMARY KEY,
  code               text NOT NULL,
  name               text NOT NULL,
  requirement_type   text NOT NULL,
  applies_to         habilita.subject_kind NOT NULL,
  severity           habilita.requirement_severity NOT NULL,
  -- Non-null only for a WARNING that declares its own exception. A HARD_BLOCK must leave this
  -- null: a hard block does not become an override by convenience (C-018), and 0013 enforces it.
  overrideable_via   text,
  -- Scope: which client/operator, location or service demands it.
  client_id          uuid REFERENCES config.clients(id),
  service_id         uuid REFERENCES config.services(id),
  description        text,
  valid_from         date NOT NULL,
  valid_until        date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT requirements_code_unique UNIQUE (code),
  CONSTRAINT requirements_window CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT requirements_hard_block_not_overrideable
    CHECK (severity <> 'HARD_BLOCK' OR overrideable_via IS NULL)
);

COMMENT ON CONSTRAINT requirements_hard_block_not_overrideable ON habilita.requirements IS
  'C-018: a documentary/Habilita hard block never turns into an implicit override. Encoded as a
   check so no configuration row can grant one.';

-- A concrete document with its own validity. Reused across requirements rather than re-uploaded
-- per Parte (10: "Reutilizar archivos existentes; no pedir documentos en cada Parte").
CREATE TABLE habilita.documents (
  id             uuid PRIMARY KEY,
  code           text,
  document_type  text NOT NULL,
  subject_kind   habilita.subject_kind NOT NULL,
  person_id      uuid REFERENCES config.people(id),
  resource_id    uuid REFERENCES config.resources(id),
  issued_at      date,
  valid_from     date NOT NULL,
  valid_until    date,
  issuer         text,
  -- Where this came from and how fresh it is. A documentary provider that did not answer must
  -- never look like a valid document (14: never return true if the provider did not respond).
  provenance     platform.provenance_kind NOT NULL DEFAULT 'FIXTURE_TEST',
  source_system  text,
  source_version text,
  observed_at    timestamptz,
  evidence_id    uuid,                    -- FK added in 0006, once evidence exists
  created_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT documents_window CHECK (valid_until IS NULL OR valid_until >= valid_from),
  -- Typed subject: exactly one of person/resource, never a polymorphic id (MR-09).
  CONSTRAINT documents_subject_exactly_one CHECK (
    (person_id IS NOT NULL)::int + (resource_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT documents_subject_kind_matches CHECK (
    (subject_kind = 'PERSON' AND person_id IS NOT NULL)
    OR (subject_kind = 'RESOURCE' AND resource_id IS NOT NULL)
  )
);

CREATE INDEX documents_person ON habilita.documents (person_id, valid_until)
  WHERE person_id IS NOT NULL;
CREATE INDEX documents_resource ON habilita.documents (resource_id, valid_until)
  WHERE resource_id IS NOT NULL;

-- R-014/R-015: rule and concrete evidence are separate; one document may satisfy several
-- requirements depending on policy.
CREATE TABLE habilita.compliances (
  id             uuid PRIMARY KEY,
  requirement_id uuid NOT NULL REFERENCES habilita.requirements(id),
  document_id    uuid REFERENCES habilita.documents(id),
  subject_kind   habilita.subject_kind NOT NULL,
  person_id      uuid REFERENCES config.people(id),
  resource_id    uuid REFERENCES config.resources(id),
  valid_from     date NOT NULL,
  valid_until    date,
  status         text NOT NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliances_window CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT compliances_subject_exactly_one CHECK (
    (person_id IS NOT NULL)::int + (resource_id IS NOT NULL)::int = 1
  ),
  -- NOT_VERIFIABLE exists so a provider outage is never recorded as compliance.
  CONSTRAINT compliances_status CHECK (status IN (
    'COMPLIANT', 'EXPIRED', 'MISSING', 'PENDING_VERIFICATION', 'NOT_VERIFIABLE'
  ))
);

CREATE INDEX compliances_by_subject_person ON habilita.compliances (person_id, requirement_id, valid_from DESC)
  WHERE person_id IS NOT NULL;
CREATE INDEX compliances_by_subject_resource ON habilita.compliances (resource_id, requirement_id, valid_from DESC)
  WHERE resource_id IS NOT NULL;

-- R-029 analogue for Habilita: an immutable evaluation snapshot with its causes. Append-only;
-- re-evaluating adds a row (C-015 for readiness, same principle here).
CREATE TABLE habilita.evaluations (
  id                 uuid PRIMARY KEY,
  -- What was being evaluated: a planned assignment, a Parte, a UE, or a bare subject.
  scope_kind         text NOT NULL,
  planned_assignment_id uuid,             -- FK in 0004
  part_id            uuid,                -- FK in 0005
  execution_unit_id  uuid,                -- FK in 0005
  person_id          uuid REFERENCES config.people(id),
  resource_id        uuid REFERENCES config.resources(id),
  result             text NOT NULL,
  -- Blocking and warning causes, each citing its requirement and rule.
  blocks             jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings           jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_trace_id  uuid REFERENCES platform.decision_traces(id),
  evaluated_at       timestamptz NOT NULL,
  -- C-015: an evaluation is temporal, never a permanent checkbox.
  valid_until        timestamptz,
  ruleset_version_id uuid REFERENCES platform.ruleset_versions(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluations_result CHECK (result IN ('HABILITA', 'ADVIERTE', 'BLOQUEA')),
  CONSTRAINT evaluations_scope_kind CHECK (scope_kind IN (
    'PLANNED_ASSIGNMENT', 'PART', 'EXECUTION_UNIT', 'PERSON', 'RESOURCE'
  ))
);

COMMENT ON TABLE habilita.evaluations IS
  'Append-only evaluation snapshot. Start Work re-evaluates rather than trusting a prior result:
   a preview that said ALLOW does not authorise a later command (RGT-17).';

CREATE INDEX evaluations_by_part ON habilita.evaluations (part_id, evaluated_at DESC)
  WHERE part_id IS NOT NULL;
CREATE INDEX evaluations_by_ue ON habilita.evaluations (execution_unit_id, evaluated_at DESC)
  WHERE execution_unit_id IS NOT NULL;

-- R-051: only configured warnings; a hard block is never the subject of an override.
CREATE TABLE habilita.override_gates (
  id              uuid PRIMARY KEY,
  evaluation_id   uuid REFERENCES habilita.evaluations(id),
  gate_id         text NOT NULL,
  -- The rule whose declared exception this override satisfies. Step 7 of sheet 58: an override
  -- does not defeat a rule, it satisfies an exception that rule declared.
  rule_id         text NOT NULL,
  requirement_id  uuid REFERENCES habilita.requirements(id),
  authorised_by   uuid NOT NULL REFERENCES platform.identities(id),
  -- 13: separate emitting from authorising where policy requires dual control.
  requested_by    uuid REFERENCES platform.identities(id),
  reason          text NOT NULL,
  evidence_id     uuid,                   -- FK in 0006
  authorised_at   timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT override_gates_reason_substantive CHECK (length(btrim(reason)) >= 10)
);

COMMENT ON CONSTRAINT override_gates_reason_substantive ON habilita.override_gates IS
  'An override without a stated reason is indistinguishable from a bypass. RUL-041 requires
   authority AND motive AND evidence where applicable.';

CREATE INDEX override_gates_by_evaluation ON habilita.override_gates (evaluation_id);

-- ------------------------------------------------------------------------ work permits

-- SM-05, nine states. VENCIDO and CERRADO are both terminal and are NOT the same thing: a
-- timeout blocks and alerts, it never closes (C-021, RUL-045, TPR-013).
CREATE TYPE habilita.permit_state AS ENUM (
  'BORRADOR',
  'PENDIENTE_APROBACION',
  'APROBADO',
  'VIGENTE',
  'SUSPENDIDO',
  'CERRADO',
  'RECHAZADO',
  'VENCIDO',
  'ANULADO'
);

CREATE TABLE habilita.work_permits (
  id                    uuid PRIMARY KEY,
  code                  text,
  permit_type           text NOT NULL,
  state                 habilita.permit_state NOT NULL DEFAULT 'BORRADOR',
  -- Scope: what work, where. A permit is an authorisation in its own right, independent of any
  -- Parte (C-019): a different PTW does not create a TP-01.
  technical_location_id uuid REFERENCES config.technical_locations(id),
  client_asset_id       uuid REFERENCES config.client_assets(id),
  client_id             uuid REFERENCES config.clients(id),
  scope_description     text NOT NULL,
  -- The temporal window. This is what PD-0394 turned on: coverage is checked against the real
  -- instant of the work, not against the presence of a signature field.
  valid_from            timestamptz,
  valid_until           timestamptz,
  activated_at          timestamptz,
  suspended_at          timestamptz,
  closed_at             timestamptz,
  expired_at            timestamptz,
  requested_by          uuid REFERENCES platform.identities(id),
  approved_by           uuid REFERENCES platform.identities(id),
  approved_at           timestamptz,
  -- The operator's authority, who is not a VDS identity.
  external_authority    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  CONSTRAINT work_permits_window CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from),
  -- APROBADO is not VIGENTE (RUL-043, T-PTW05). Only an activated permit carries a start.
  CONSTRAINT work_permits_vigente_requires_activation
    CHECK (state <> 'VIGENTE' OR (activated_at IS NOT NULL AND valid_from IS NOT NULL)),
  -- An expired permit is not a closed permit.
  CONSTRAINT work_permits_expiry_is_not_closure
    CHECK (NOT (expired_at IS NOT NULL AND closed_at IS NOT NULL AND state = 'CERRADO')
           OR closed_at >= expired_at)
);

COMMENT ON TABLE habilita.work_permits IS
  'An independent formal authorisation (C-019). The prototype held PTW as three fields inside the
   Parte (p.ptw / e.permiso), with no lifecycle and no window — so a signature entered at 11:25
   appeared to authorise work from 07:20. Approval, activation, suspension, expiry and closure
   are now distinct, timestamped transitions.';

CREATE INDEX work_permits_applicable
  ON habilita.work_permits (technical_location_id, state, valid_from, valid_until);

-- C-020 / R-049: N:M coverage. A UE may need several permits; a permit may cover several UE.
CREATE TABLE habilita.work_permit_execution_units (
  id                uuid PRIMARY KEY,
  work_permit_id    uuid NOT NULL REFERENCES habilita.work_permits(id),
  execution_unit_id uuid NOT NULL,        -- FK in 0005
  -- Coverage may be narrower than the permit's own window.
  covers_from       timestamptz,
  covers_until      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wp_ue_unique UNIQUE (work_permit_id, execution_unit_id),
  CONSTRAINT wp_ue_window CHECK (covers_until IS NULL OR covers_from IS NULL OR covers_until > covers_from)
);

-- Lifecycle events: who did what, when, under which authority. Append-only (0013).
CREATE TABLE habilita.work_permit_events (
  id               uuid PRIMARY KEY,
  work_permit_id   uuid NOT NULL REFERENCES habilita.work_permits(id),
  event_type       text NOT NULL,
  from_state       habilita.permit_state,
  to_state         habilita.permit_state NOT NULL,
  actor_id         uuid REFERENCES platform.identities(id),
  reason           text,
  decision_trace_id uuid REFERENCES platform.decision_traces(id),
  occurred_at      timestamptz NOT NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_permit_events_type CHECK (event_type IN (
    'CREAR', 'ENVIAR_APROBACION', 'APROBAR', 'RECHAZAR', 'ACTIVAR', 'SUSPENDER',
    'REVALIDAR_REANUDAR', 'CERRAR', 'EXPIRAR', 'ANULAR', 'CIERRE_ADMINISTRATIVO'
  ))
);

COMMENT ON CONSTRAINT work_permit_events_type ON habilita.work_permit_events IS
  'CIERRE_ADMINISTRATIVO is listed separately because sheet 51 row 34 requires an explicit
   authorised administrative closure for an expired permit: the clock may not close it.';

CREATE INDEX work_permit_events_by_permit
  ON habilita.work_permit_events (work_permit_id, occurred_at DESC);

-- Checks and measurements actually performed on the permit (IH-14): physical verifications,
-- pre-loaded as a checklist, completed with real values only.
CREATE TABLE habilita.work_permit_checks (
  id             uuid PRIMARY KEY,
  work_permit_id uuid NOT NULL REFERENCES habilita.work_permits(id),
  check_code     text NOT NULL,
  label          text NOT NULL,
  is_required    boolean NOT NULL DEFAULT true,
  result         text,
  numeric_value  numeric(18, 6),
  unit_of_measure_id uuid REFERENCES config.units_of_measure(id),
  performed_by   uuid REFERENCES platform.identities(id),
  performed_at   timestamptz,
  evidence_id    uuid,                    -- FK in 0006
  CONSTRAINT wp_checks_unique UNIQUE (work_permit_id, check_code),
  CONSTRAINT wp_checks_result CHECK (result IS NULL OR result IN ('OK', 'NOT_OK', 'NOT_APPLICABLE'))
);
