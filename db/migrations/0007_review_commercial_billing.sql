-- 0007 — Review VDS (proposed dimension), Certification (77..83) and Billing (84..86).
--
-- The separation this file exists to enforce, from S0 §8 and C-033:
--
--   operational truth   → execution.*          corrected by EnmiendaOperativa
--   review decision     → review.*             a decision ON a version, not a Parte state
--   commercial agreement→ commercial.*         corrected by AjusteCertificacion
--   billing boundary    → billing.*            ends at the ERP adapter
--
-- The prototype collapsed all four: `c-obs` (client observation) set `p.estado='obs'`, so a
-- commercial disagreement sent operational reality back to field editing. RGT-04 asserts that
-- cannot happen; here it is structurally impossible, because nothing in commercial.* can write
-- to execution.*, and an observation is its own row.

-- ----------------------------------------------------------------------- Review VDS

-- 05 marks this dimension as a proposal (P): it is NOT in the frozen state machines. It reviews a
-- VERSION and never changes the operational state of the Parte (11).
CREATE TYPE review.decision_state AS ENUM (
  'PENDIENTE_REVISION', 'EN_REVISION', 'ACEPTADA', 'OBSERVADA'
);

CREATE TABLE review.decisions (
  id                        uuid PRIMARY KEY,
  -- The subject is a version, not a mutable row: a later version may need its own review.
  execution_unit_version_id uuid REFERENCES execution.execution_unit_versions(id),
  part_id                   uuid REFERENCES execution.parts(id),
  state                     review.decision_state NOT NULL DEFAULT 'PENDIENTE_REVISION',
  reviewer_id               uuid REFERENCES platform.identities(id),
  taken_at                  timestamptz,
  decided_at                timestamptz,
  decision_note             text,
  -- A resolution produces a NEW decision referencing this one, rather than reopening the Parte.
  supersedes_id             uuid REFERENCES review.decisions(id),
  decision_trace_id         uuid REFERENCES platform.decision_traces(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  version                   integer NOT NULL DEFAULT 1,
  CONSTRAINT review_decisions_has_subject
    CHECK (execution_unit_version_id IS NOT NULL OR part_id IS NOT NULL),
  CONSTRAINT review_decisions_decided_has_actor
    CHECK (state NOT IN ('ACEPTADA', 'OBSERVADA')
           OR (reviewer_id IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT review_decisions_not_self_superseding
    CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);

COMMENT ON TABLE review.decisions IS
  'A review decision identifies version, actor, instant and cause (11). Accepting a review does
   NOT certify commercially and does NOT alter the Parte state. Whether review acceptance gates
   commercial eligibility is explicit configuration, not an implicit coupling (CC-06).';

CREATE INDEX review_decisions_queue ON review.decisions (state, created_at)
  WHERE state IN ('PENDIENTE_REVISION', 'EN_REVISION');

-- An observation distinguishes its own nature, because the three have different consequences:
-- a clarification needs an answer, an operational error needs an amendment request, a commercial
-- dispute needs an adjustment — and only the first two concern the field at all.
CREATE TABLE review.observations (
  id                 uuid PRIMARY KEY,
  review_decision_id uuid NOT NULL REFERENCES review.decisions(id),
  observation_kind   text NOT NULL,
  -- What exactly is being observed, so the UI can link to the datum rather than to the Parte.
  subject_path       text,
  description        text NOT NULL,
  raised_by          uuid NOT NULL REFERENCES platform.identities(id),
  raised_at          timestamptz NOT NULL,
  resolved_at        timestamptz,
  resolution_note    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_observations_kind CHECK (observation_kind IN (
    'CLARIFICATION', 'COMPLETENESS', 'OPERATIONAL_ERROR', 'COMMERCIAL_DISPUTE'
  ))
);

COMMENT ON CONSTRAINT review_observations_kind ON review.observations IS
  'OPERATIONAL_ERROR routes to an amendment request; COMMERCIAL_DISPUTE routes to a certification
   adjustment. The prototype had one undifferentiated observation that returned the Parte to
   field editing regardless of which it was.';

-- An amendment is REQUESTED here and decided in execution: review never edits reality itself.
CREATE TABLE review.amendment_requests (
  id                 uuid PRIMARY KEY,
  review_decision_id uuid REFERENCES review.decisions(id),
  observation_id     uuid REFERENCES review.observations(id),
  execution_unit_id  uuid REFERENCES execution.execution_units(id),
  part_id            uuid REFERENCES execution.parts(id),
  requested_change   text NOT NULL,
  justification      text NOT NULL,
  requested_by       uuid NOT NULL REFERENCES platform.identities(id),
  requested_at       timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'PENDIENTE',
  -- The amendment that actually resolved it, once execution performed one.
  amendment_id       uuid REFERENCES execution.operational_amendments(id),
  resolved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amendment_requests_status CHECK (status IN (
    'PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'RESUELTA'
  )),
  CONSTRAINT amendment_requests_has_target
    CHECK (execution_unit_id IS NOT NULL OR part_id IS NOT NULL),
  CONSTRAINT amendment_requests_resolved_has_amendment
    CHECK (status <> 'RESUELTA' OR amendment_id IS NOT NULL)
);

-- -------------------------------------------------------------------- commercial units

CREATE TYPE commercial.unit_state AS ENUM (
  'INCOMPLETA', 'ELEGIBLE', 'EN_REVISION', 'OBSERVADA', 'ACEPTADA', 'RECHAZADA'
);

-- SM-09: a dimension running in PARALLEL to certification state, not inside it.
CREATE TYPE commercial.supersession_state AS ENUM (
  'VIGENTE', 'REQUIERE_RECALCULO', 'EN_REVISION', 'SUSTITUIDA', 'INVALIDADA'
);

CREATE TABLE commercial.commercial_units (
  id                  uuid PRIMARY KEY,
  code                text,
  contract_service_id uuid NOT NULL REFERENCES config.contract_services(id),
  contract_item_id    uuid NOT NULL REFERENCES config.contract_items(id),
  unit_of_measure_id  uuid NOT NULL REFERENCES config.units_of_measure(id),
  state               commercial.unit_state NOT NULL DEFAULT 'INCOMPLETA',
  -- Two independent dimensions (C-034, SM-09). An accepted UC can require recalculation without
  -- its historical acceptance being undone.
  supersession_state  commercial.supersession_state NOT NULL DEFAULT 'VIGENTE',
  quantity            numeric(18, 6),
  -- The rule versions that produced the quantity, so a figure can be explained (RUL-060/061).
  grain_rule_version_id uuid REFERENCES config.rule_versions(id),
  time_rule_version_id  uuid REFERENCES config.rule_versions(id),
  measurement_rule_version_id uuid REFERENCES config.rule_versions(id),
  period_from         date,
  period_until        date,
  -- C-034 / R-063: an acyclic supersession chain; the previous unit stays.
  supersedes_id       uuid REFERENCES commercial.commercial_units(id),
  derived_at          timestamptz NOT NULL,
  eligible_at         timestamptz,
  accepted_at         timestamptz,
  rejected_at         timestamptz,
  decision_trace_id   uuid REFERENCES platform.decision_traces(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  -- R-063: one successor per predecessor keeps the chain linear and auditable.
  CONSTRAINT commercial_units_supersedes_unique UNIQUE (supersedes_id),
  CONSTRAINT commercial_units_not_self_superseding
    CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  -- TPR-027 / RUL-062: acceptance cannot skip eligibility.
  CONSTRAINT commercial_units_accepted_was_eligible
    CHECK (state <> 'ACEPTADA' OR (eligible_at IS NOT NULL AND accepted_at IS NOT NULL)),
  -- An eligible or later unit must have a quantity; INCOMPLETA is exactly where it may be null.
  CONSTRAINT commercial_units_quantity_when_eligible
    CHECK (state = 'INCOMPLETA' OR quantity IS NOT NULL),
  CONSTRAINT commercial_units_period
    CHECK (period_until IS NULL OR period_from IS NULL OR period_until >= period_from)
);

COMMENT ON TABLE commercial.commercial_units IS
  'The minimum grain of commercial acceptance. Certification state and supersession state are
   parallel dimensions: RUL-065 sets REQUIERE_RECALCULO when a source is amended, which blocks new
   billing while the historical acceptance remains true of the version it accepted.';

CREATE INDEX commercial_units_queue ON commercial.commercial_units (state, derived_at)
  WHERE state IN ('INCOMPLETA', 'ELEGIBLE', 'EN_REVISION', 'OBSERVADA');
CREATE INDEX commercial_units_needs_recalc ON commercial.commercial_units (supersession_state)
  WHERE supersession_state <> 'VIGENTE';

ALTER TABLE evidence.evidence_links
  ADD CONSTRAINT evidence_links_commercial_unit_fk
  FOREIGN KEY (commercial_unit_id) REFERENCES commercial.commercial_units(id);

-- C-029 / MR-01 / R-061: the N:M lineage. A UC may consolidate many UE; one UE may feed many UC.
-- C-030: each link keeps the EXACT execution version used.
CREATE TABLE commercial.commercial_unit_source_links (
  id                        uuid PRIMARY KEY,
  commercial_unit_id        uuid NOT NULL REFERENCES commercial.commercial_units(id),
  -- NOT NULL on purpose: pointing at the mutable UE row would lose the ability to detect that an
  -- amendment made this derivation obsolete.
  execution_unit_version_id uuid NOT NULL REFERENCES execution.execution_unit_versions(id),
  -- R-062: the commercial source may be only a portion / one allocation of a UE.
  execution_allocation_id   uuid REFERENCES execution.execution_allocations(id),
  -- How much of the UC's quantity this source contributed, so double counting is detectable.
  contribution_quantity     numeric(18, 6),
  contribution_note         text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_source_unique UNIQUE (commercial_unit_id, execution_unit_version_id, execution_allocation_id)
);

COMMENT ON TABLE commercial.commercial_unit_source_links IS
  'C-030: "Cada vínculo fuente de UC conserva la versión exacta de ejecución usada." This is what
   lets RGT-13 refuse to send an obsolete UC to the ERP even when a projection has not caught up:
   effectiveness is re-checked against the source version at send time.';

CREATE INDEX uc_source_by_unit ON commercial.commercial_unit_source_links (commercial_unit_id);
CREATE INDEX uc_source_by_execution_version
  ON commercial.commercial_unit_source_links (execution_unit_version_id);

-- --------------------------------------------------------- packages, conformity, adjustments

CREATE TYPE commercial.package_state AS ENUM (
  'BORRADOR', 'LISTO_PARA_ENVIO', 'ENVIADO', 'EN_REVISION', 'OBSERVADO',
  'ACEPTADO_PARCIAL', 'ACEPTADO', 'RECHAZADO', 'SUSTITUIDO'
);

CREATE TABLE commercial.certification_packages (
  id                  uuid PRIMARY KEY,
  code                text,
  contract_service_id uuid NOT NULL REFERENCES config.contract_services(id),
  grouping_rule_version_id uuid REFERENCES config.rule_versions(id),
  state               commercial.package_state NOT NULL DEFAULT 'BORRADOR',
  current_version_id  uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1
);

-- C-032 / MR-02 / R-066: composition is versioned through the bridge. Historical UC are never
-- moved or deleted out of a package.
CREATE TABLE commercial.certification_package_versions (
  id         uuid PRIMARY KEY,
  package_id uuid NOT NULL REFERENCES commercial.certification_packages(id),
  version_no integer NOT NULL,
  state      commercial.package_state NOT NULL DEFAULT 'BORRADOR',
  sent_at    timestamptz,
  reviewed_at timestamptz,
  decided_at timestamptz,
  supersedes_id uuid REFERENCES commercial.certification_package_versions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_versions_unique UNIQUE (package_id, version_no),
  CONSTRAINT package_versions_not_self_superseding
    CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  -- TPR-033 analogue for packages: ENVIADO requires the timestamp that proves it.
  CONSTRAINT package_versions_sent_timestamp
    CHECK (state NOT IN ('ENVIADO', 'EN_REVISION', 'ACEPTADO', 'ACEPTADO_PARCIAL', 'RECHAZADO')
           OR sent_at IS NOT NULL)
);

ALTER TABLE commercial.certification_packages
  ADD CONSTRAINT packages_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES commercial.certification_package_versions(id);

ALTER TABLE evidence.evidence_links
  ADD CONSTRAINT evidence_links_package_version_fk
  FOREIGN KEY (package_version_id) REFERENCES commercial.certification_package_versions(id);

CREATE TABLE commercial.certification_package_inclusions (
  id                 uuid PRIMARY KEY,
  package_version_id uuid NOT NULL REFERENCES commercial.certification_package_versions(id),
  commercial_unit_id uuid NOT NULL REFERENCES commercial.commercial_units(id),
  -- For an authorised partial acceptance, which subset was actually accepted (RUL-068).
  accepted           boolean,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_inclusions_unique UNIQUE (package_version_id, commercial_unit_id)
);

-- R-067 / R-079: the client's decision. Scope may be a package version or a single unit.
CREATE TABLE commercial.client_conformities (
  id                 uuid PRIMARY KEY,
  target_kind        text NOT NULL,
  package_version_id uuid REFERENCES commercial.certification_package_versions(id),
  commercial_unit_id uuid REFERENCES commercial.commercial_units(id),
  decision           text NOT NULL,
  client_id          uuid NOT NULL REFERENCES config.clients(id),
  -- The acting party may be an external client user, so this is an identity when we have one and
  -- a recorded external actor otherwise.
  decided_by_identity_id uuid REFERENCES platform.identities(id),
  decided_by_external   text,
  decided_at         timestamptz NOT NULL,
  note               text,
  evidence_id        uuid REFERENCES evidence.evidence(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conformities_target_kind CHECK (target_kind IN ('PACKAGE_VERSION', 'COMMERCIAL_UNIT')),
  CONSTRAINT conformities_target_exactly_one CHECK (
    (package_version_id IS NOT NULL)::int + (commercial_unit_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT conformities_decision CHECK (decision IN ('ACEPTA', 'RECHAZA', 'OBSERVA')),
  CONSTRAINT conformities_has_actor
    CHECK (decided_by_identity_id IS NOT NULL OR decided_by_external IS NOT NULL)
);

COMMENT ON TABLE commercial.client_conformities IS
  'RUL-069: acceptance here does not mean an invoice was issued. And a client decision never
   writes to execution.*: the client cannot modify a field (S0, RGT-04).';

-- R-068 / RUL-063: an observation blocks or conditions certification. It does not edit the field.
CREATE TABLE commercial.certification_observations (
  id                 uuid PRIMARY KEY,
  target_kind        text NOT NULL,
  commercial_unit_id uuid REFERENCES commercial.commercial_units(id),
  package_version_id uuid REFERENCES commercial.certification_package_versions(id),
  reason_code        text,
  description        text NOT NULL,
  raised_by_identity_id uuid REFERENCES platform.identities(id),
  raised_by_external text,
  raised_at          timestamptz NOT NULL,
  resolved_at        timestamptz,
  resolution_note    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cert_observations_target_kind
    CHECK (target_kind IN ('COMMERCIAL_UNIT', 'PACKAGE_VERSION')),
  CONSTRAINT cert_observations_target_exactly_one CHECK (
    (commercial_unit_id IS NOT NULL)::int + (package_version_id IS NOT NULL)::int = 1
  )
);

-- C-033 / R-069 / RUL-064: an authorised COMMERCIAL correction. Explicitly NOT an operational
-- amendment, and it leaves the UE untouched.
CREATE TABLE commercial.certification_adjustments (
  id                 uuid PRIMARY KEY,
  target_kind        text NOT NULL,
  commercial_unit_id uuid REFERENCES commercial.commercial_units(id),
  package_version_id uuid REFERENCES commercial.certification_package_versions(id),
  observation_id     uuid REFERENCES commercial.certification_observations(id),
  adjustment_kind    text NOT NULL,
  quantity_delta     numeric(18, 6),
  reason             text NOT NULL,
  authorised_by      uuid NOT NULL REFERENCES platform.identities(id),
  authorised_at      timestamptz NOT NULL,
  decision_trace_id  uuid REFERENCES platform.decision_traces(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cert_adjustments_target_kind
    CHECK (target_kind IN ('COMMERCIAL_UNIT', 'PACKAGE_VERSION')),
  CONSTRAINT cert_adjustments_target_exactly_one CHECK (
    (commercial_unit_id IS NOT NULL)::int + (package_version_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT cert_adjustments_kind CHECK (adjustment_kind IN (
    'QUANTITY', 'PRICE_BASIS', 'SCOPE', 'CREDIT', 'OTHER'
  )),
  CONSTRAINT cert_adjustments_reason_substantive CHECK (length(btrim(reason)) >= 10)
);

COMMENT ON TABLE commercial.certification_adjustments IS
  'C-033: an AjusteCertificacion corrects the commercial agreement; an EnmiendaOperativa corrects
   operational reality. Two different truths, two different tables, and this one has no path to
   execution.* at all (RGT-04).';

-- ------------------------------------------------------------------------- billing

CREATE TYPE billing.lot_state AS ENUM (
  'BORRADOR', 'VALIDADO', 'ENVIADO_ERP', 'ACEPTADO_ERP', 'ERROR_ERP', 'CANCELADO'
);

-- R-070 / RUL-070: only an ACCEPTED and CURRENT commercial unit can produce a line.
CREATE TABLE billing.billable_lines (
  id                 uuid PRIMARY KEY,
  commercial_unit_id uuid NOT NULL REFERENCES commercial.commercial_units(id),
  adjustment_id      uuid REFERENCES commercial.certification_adjustments(id),
  billing_lot_id     uuid,
  quantity           numeric(18, 6) NOT NULL,
  unit_of_measure_id uuid NOT NULL REFERENCES config.units_of_measure(id),
  contract_item_id   uuid NOT NULL REFERENCES config.contract_items(id),
  billing_rule_version_id uuid REFERENCES config.rule_versions(id),
  version_no         integer NOT NULL DEFAULT 1,
  -- Set when a superseded source invalidated this line rather than deleting it.
  invalidated_at     timestamptz,
  invalidation_reason text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billable_lines_quantity_positive CHECK (quantity <> 0)
);

CREATE INDEX billable_lines_by_lot ON billing.billable_lines (billing_lot_id);
CREATE INDEX billable_lines_unbilled ON billing.billable_lines (created_at)
  WHERE billing_lot_id IS NULL AND invalidated_at IS NULL;

-- C-035 / R-071: a lot is NOT a certification package. Different grain, different cadence.
CREATE TABLE billing.billing_lots (
  id                 uuid PRIMARY KEY,
  code               text,
  contract_id        uuid REFERENCES config.contracts(id),
  client_id          uuid NOT NULL REFERENCES config.clients(id),
  billing_rule_version_id uuid REFERENCES config.rule_versions(id),
  state              billing.lot_state NOT NULL DEFAULT 'BORRADOR',
  validated_at       timestamptz,
  sent_at            timestamptz,
  accepted_at        timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  -- TPR-033: the ERP boundary must be crossed explicitly; no jumping to ACEPTADO_ERP.
  CONSTRAINT billing_lots_accepted_requires_send
    CHECK (state <> 'ACEPTADO_ERP' OR (sent_at IS NOT NULL AND accepted_at IS NOT NULL)),
  CONSTRAINT billing_lots_sent_requires_validation
    CHECK (state NOT IN ('ENVIADO_ERP', 'ACEPTADO_ERP', 'ERROR_ERP') OR validated_at IS NOT NULL)
);

COMMENT ON TABLE billing.billing_lots IS
  'C-035: distinct from PaqueteCertificacion. The functional model ends at the ERP boundary and
   invents no fiscal states (SM-11).';

ALTER TABLE billing.billable_lines
  ADD CONSTRAINT billable_lines_lot_fk FOREIGN KEY (billing_lot_id) REFERENCES billing.billing_lots(id);

-- A durable record of the attempt, written BEFORE the external side effect (03: "registrar
-- intento durable antes del side effect externo"). An HTTP 200 is not fiscal issuance.
CREATE TABLE billing.erp_submission_attempts (
  id              uuid PRIMARY KEY,
  billing_lot_id  uuid NOT NULL REFERENCES billing.billing_lots(id),
  attempt_no      integer NOT NULL,
  -- The exact payload and its hash, so a resend can be proven identical or different.
  payload         jsonb NOT NULL,
  payload_hash    text NOT NULL,
  idempotency_key text NOT NULL,
  -- Which provider answered: a TEST fixture or a real ERP. Never conflated.
  provider_kind   text NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING',
  response        jsonb,
  external_ref    text,
  error_code      text,
  error_message   text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  CONSTRAINT erp_attempts_unique UNIQUE (billing_lot_id, attempt_no),
  CONSTRAINT erp_attempts_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT erp_attempts_provider_kind CHECK (provider_kind IN ('TEST_FIXTURE', 'REAL_PROVIDER')),
  -- UNKNOWN is a first-class outcome: a timeout means we do not know, and claiming either
  -- success or failure would be a lie (14: adapter returns accept/error/unknown).
  CONSTRAINT erp_attempts_status CHECK (status IN ('PENDING', 'ACCEPTED', 'ERROR', 'UNKNOWN')),
  CONSTRAINT erp_attempts_accepted_has_ref CHECK (status <> 'ACCEPTED' OR external_ref IS NOT NULL)
);

COMMENT ON CONSTRAINT erp_attempts_status ON billing.erp_submission_attempts IS
  'UNKNOWN exists because a lost response is not a failure and not a success. Resolving it needs
   reconciliation against the ERP, not an assumption.';

-- 86 Factura / Documento ERP: a boundary reference. The ERP owns the fiscal document (MR-11).
CREATE TABLE billing.external_document_refs (
  id             uuid PRIMARY KEY,
  billing_lot_id uuid NOT NULL REFERENCES billing.billing_lots(id),
  external_system text NOT NULL,
  external_id    text NOT NULL,
  document_kind  text,
  document_status text,
  issued_at      timestamptz,
  observed_at    timestamptz NOT NULL DEFAULT now(),
  raw            jsonb,
  CONSTRAINT external_document_unique UNIQUE (external_system, external_id)
);

COMMENT ON TABLE billing.external_document_refs IS
  'MR-11: the internal model ends at LoteFacturacion; the invoice itself is a reference to a
   document owned elsewhere. No fiscal calculation happens in this system.';
