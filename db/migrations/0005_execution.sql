-- 0005 — Execution core: Parte, UnidadEjecucion and its immutable versions, intervals, time,
-- location, measurement, allocation, transitions, availability, amendments.
--
-- Logical entities 48..59 and 66.
--
-- This file carries the most consequential corrections in the whole build:
--
--  * **UE has its own identity** (S0 §7). The prototype had `p.ejec.reg[]`, an array of time
--    rows. A row is evidence of time and task, never an identity — so "no convertir cada fila
--    horaria en una UE" is enforced by giving UE its own table, state machine and versions,
--    and by making time_events reference a UE rather than constitute one.
--
--  * **Versions, not edits.** execution_unit_versions is the immutable record a commercial unit
--    points at (C-030). Closing a UE writes a version; an amendment writes another. Nothing
--    rewrites a closed row, so TPR-010 and RGT-04 hold at the storage level.
--
--  * **Intervals, not fields.** Person and resource participation is a set of half-open
--    intervals (C-011). A replacement closes one and opens another; it never edits the past,
--    which is what made the prototype's `o-delp` able to erase that someone was present
--    (PD-0392 / RGT-05).
--
--  * **Operational date and shift are explicit columns**, not derived by truncating a timestamp
--    (RGT-10). The prototype keyed a Parte by `fecha` with a universal daily cut.

CREATE TYPE execution.part_state AS ENUM (
  'PREPARADO', 'EN_EJECUCION', 'SUSPENDIDO', 'CERRADO_OPERATIVAMENTE', 'ANULADO'
);

CREATE TYPE execution.unit_state AS ENUM (
  'PENDIENTE', 'EN_EJECUCION', 'SUSPENDIDA', 'CERRADA', 'NO_REALIZADA', 'ANULADA'
);

-- The contractual context of an allocation. C-004 / AP-06: uncertainty is explicit and a
-- wildcard code is never invented to fill a form.
CREATE TYPE execution.allocation_status AS ENUM (
  'RESUELTO', 'PENDIENTE', 'AMBIGUO', 'PENDIENTE_CONFIGURACION'
);

-- ---------------------------------------------------------------------------- Parte

CREATE TABLE execution.parts (
  id                    uuid PRIMARY KEY,
  code                  text,                 -- PD-0394 style, allocated by the server
  -- C-005: exactly one resolved TipoParte. RUL-001 derives it; there is no free selector on the
  -- normal path (C-006), so this is NOT NULL from creation.
  part_type_id          uuid NOT NULL REFERENCES config.part_types(id),
  state                 execution.part_state NOT NULL DEFAULT 'PREPARADO',
  client_id             uuid REFERENCES config.clients(id),
  contract_service_id   uuid REFERENCES config.contract_services(id),
  crew_id               uuid REFERENCES config.crews(id),
  base_id               uuid,
  -- RGT-10: configured, never derived from midnight. Both are explicit attributes.
  operational_date      date NOT NULL,
  shift_id              text,
  -- Which shift policy decided the two columns above, so the choice can be explained.
  shift_policy_rule_version_id uuid REFERENCES config.rule_versions(id),
  prepared_at           timestamptz NOT NULL,
  started_at            timestamptz,
  suspended_at          timestamptz,
  closed_at             timestamptz,
  voided_at             timestamptz,
  closed_by             uuid REFERENCES platform.identities(id),
  -- Emergent work: no plan, contractual context possibly unresolved (C-022). Permitted only
  -- when ReglaInicioEmergente allows it and an authority approved (RUL-037).
  is_emergent           boolean NOT NULL DEFAULT false,
  emergent_authorised_by uuid REFERENCES platform.identities(id),
  emergent_reason       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  -- T-PA02: a start timestamp exists exactly when the Parte has started.
  CONSTRAINT parts_started_timestamp CHECK (
    (state = 'PREPARADO' AND started_at IS NULL)
    OR (state = 'ANULADO' AND started_at IS NULL)
    OR (state IN ('EN_EJECUCION', 'SUSPENDIDO', 'CERRADO_OPERATIVAMENTE') AND started_at IS NOT NULL)
  ),
  -- T-PA06: only a Parte that never started may be voided.
  CONSTRAINT parts_void_only_before_start CHECK (state <> 'ANULADO' OR started_at IS NULL),
  CONSTRAINT parts_closed_timestamp
    CHECK (state <> 'CERRADO_OPERATIVAMENTE' OR closed_at IS NOT NULL),
  CONSTRAINT parts_emergent_has_reason
    CHECK (NOT is_emergent OR emergent_reason IS NOT NULL)
);

COMMENT ON TABLE execution.parts IS
  'The operational container resolved by TipoParte. CERRADO_OPERATIVAMENTE means operational
   closure only: not documentary completeness and not certification (SM-03). The prototype had a
   single estado spanning operation, review and commercial, which is what S0 §8 removes.';

COMMENT ON COLUMN execution.parts.operational_date IS
  'RGT-10: an explicit attribute decided by the configured shift boundary of this context, never
   by truncating a timestamp to midnight. A night shift keeps one operational date.';

CREATE INDEX parts_by_crew_date ON execution.parts (crew_id, operational_date DESC, state);
CREATE INDEX parts_active ON execution.parts (state, operational_date DESC)
  WHERE state IN ('PREPARADO', 'EN_EJECUCION', 'SUSPENDIDO');
CREATE UNIQUE INDEX parts_code_unique ON execution.parts (code) WHERE code IS NOT NULL;

-- ------------------------------------------------------------------- UnidadEjecucion

CREATE TABLE execution.execution_units (
  id                    uuid PRIMARY KEY,
  part_id               uuid NOT NULL REFERENCES execution.parts(id),
  code                  text,
  state                 execution.unit_state NOT NULL DEFAULT 'PENDIENTE',
  service_id            uuid NOT NULL REFERENCES config.services(id),
  activity_id           uuid REFERENCES config.activities(id),
  client_asset_id       uuid REFERENCES config.client_assets(id),
  description           text NOT NULL,
  sequence_no           integer,
  -- TP-02: a movement is a distinguishable UE. TP-01: an autonomous sub-task is (RUL-007).
  -- TP-03: real distinguishable accumulated work. The strategy decides, the schema does not.
  unit_kind             text,
  started_at            timestamptz,
  suspended_at          timestamptz,
  ended_at              timestamptz,
  -- T-UE05/T-UE06: a terminal UE states its result, and a cause when it was not performed.
  result                text,
  result_reason         text,
  closed_by             uuid REFERENCES platform.identities(id),
  -- Points at the version in force. The versions themselves are immutable.
  current_version_id    uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  CONSTRAINT execution_units_interval CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at > started_at),
  CONSTRAINT execution_units_started_timestamp CHECK (
    state = 'PENDIENTE' OR state = 'ANULADA' OR started_at IS NOT NULL
  ),
  CONSTRAINT execution_units_void_only_before_start
    CHECK (state <> 'ANULADA' OR started_at IS NULL),
  CONSTRAINT execution_units_closed_has_result
    CHECK (state <> 'CERRADA' OR result IS NOT NULL),
  -- RUL-019 / T-UE06: never delete what was planned and not done; state the cause.
  CONSTRAINT execution_units_not_performed_has_reason
    CHECK (state <> 'NO_REALIZADA' OR result_reason IS NOT NULL),
  CONSTRAINT execution_units_result_values CHECK (result IS NULL OR result IN (
    'COMPLETADA', 'PARCIAL', 'NO_REALIZADA', 'OTRO'
  ))
);

COMMENT ON TABLE execution.execution_units IS
  'The distinguishable operational grain (SM-04). S0 §7: a UE is first-class, with identity,
   state, versions and lineage. A time row or an extra resource never creates one (C-010).';

CREATE INDEX execution_units_by_part ON execution.execution_units (part_id, sequence_no);
CREATE INDEX execution_units_active ON execution.execution_units (state)
  WHERE state IN ('PENDIENTE', 'EN_EJECUCION', 'SUSPENDIDA');

-- The immutable record. A commercial unit's source link points HERE, not at the mutable UE row
-- (C-030), so an amendment can be detected as making a derived UC obsolete (RUL-065).
CREATE TABLE execution.execution_unit_versions (
  id                 uuid PRIMARY KEY,
  execution_unit_id  uuid NOT NULL REFERENCES execution.execution_units(id),
  version_no         integer NOT NULL,
  -- Why this version exists: the close itself, or a later authorised amendment.
  reason             text NOT NULL,
  amendment_id       uuid,                 -- set when produced by an EnmiendaOperativa
  -- A full snapshot of the operational truth at this version: times, people, resources,
  -- locations, measurements, allocation. Reconstructable without replaying the whole history.
  snapshot           jsonb NOT NULL,
  content_hash       text NOT NULL,
  effective_at       timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES platform.identities(id),
  decision_trace_id  uuid REFERENCES platform.decision_traces(id),
  CONSTRAINT execution_unit_versions_unique UNIQUE (execution_unit_id, version_no),
  CONSTRAINT execution_unit_versions_reason CHECK (reason IN ('CLOSE', 'AMENDMENT', 'CORRECTION'))
);

COMMENT ON TABLE execution.execution_unit_versions IS
  'Immutable per version (C-002, 0013 enforces it). FK target of
   commercial.commercial_unit_source_links: a UC records the exact version it consumed, which is
   how RGT-13 blocks billing an obsolete source even when a projection lags.';

ALTER TABLE execution.execution_units
  ADD CONSTRAINT execution_units_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES execution.execution_unit_versions(id);

-- Deferred FKs that pointed forward from earlier migrations.
ALTER TABLE habilita.evaluations
  ADD CONSTRAINT evaluations_part_fk FOREIGN KEY (part_id) REFERENCES execution.parts(id),
  ADD CONSTRAINT evaluations_ue_fk FOREIGN KEY (execution_unit_id) REFERENCES execution.execution_units(id),
  ADD CONSTRAINT evaluations_planned_assignment_fk
    FOREIGN KEY (planned_assignment_id) REFERENCES planning.planned_assignments(id);

ALTER TABLE habilita.work_permit_execution_units
  ADD CONSTRAINT wp_ue_execution_unit_fk
  FOREIGN KEY (execution_unit_id) REFERENCES execution.execution_units(id);

ALTER TABLE planning.plan_execution_links
  ADD CONSTRAINT plan_execution_links_part_fk FOREIGN KEY (part_id) REFERENCES execution.parts(id),
  ADD CONSTRAINT plan_execution_links_ue_fk
    FOREIGN KEY (execution_unit_id) REFERENCES execution.execution_units(id);

ALTER TABLE control.directive_targets
  ADD CONSTRAINT directive_targets_part_fk FOREIGN KEY (part_id) REFERENCES execution.parts(id),
  ADD CONSTRAINT directive_targets_ue_fk
    FOREIGN KEY (execution_unit_id) REFERENCES execution.execution_units(id);

-- ---------------------------------------------------------- person and resource intervals

-- C-011: intervals, never edited retroactively. A replacement closes the outgoing interval and
-- opens the incoming one (RUL-025/026).
CREATE TABLE execution.person_execution_assignments (
  id                uuid PRIMARY KEY,
  part_id           uuid NOT NULL REFERENCES execution.parts(id),
  execution_unit_id uuid REFERENCES execution.execution_units(id),
  person_id         uuid NOT NULL REFERENCES config.people(id),
  role              text NOT NULL,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz,
  -- Why the interval ended: shift handover, replacement, end of work.
  end_reason        text,
  -- The interval that replaced this one, when it was a replacement. Keeps the chain explicit.
  replaced_by_id    uuid REFERENCES execution.person_execution_assignments(id),
  -- RUL-039/040: the evaluation that admitted this person. A person who actually participated
  -- without clearance is preserved as a fact with its non-compliance recorded (RGT-05), never
  -- deleted to make a control pass.
  habilita_evaluation_id uuid REFERENCES habilita.evaluations(id),
  compliance_status text NOT NULL DEFAULT 'UNKNOWN',
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES platform.identities(id),
  CONSTRAINT person_assignments_interval CHECK (ended_at IS NULL OR ended_at > started_at),
  CONSTRAINT person_assignments_not_self_replaced
    CHECK (replaced_by_id IS NULL OR replaced_by_id <> id),
  CONSTRAINT person_assignments_compliance CHECK (compliance_status IN (
    'COMPLIANT', 'NON_COMPLIANT_RECORDED', 'OVERRIDDEN', 'UNKNOWN'
  ))
);

COMMENT ON COLUMN execution.person_execution_assignments.compliance_status IS
  'RGT-05 / PD-0392: if someone really took part without a valid habilitation, the presence is
   preserved and marked NON_COMPLIANT_RECORDED. The prototype offered to remove them from the
   list, which rewrites history to satisfy a control.';

CREATE INDEX person_assignments_by_part ON execution.person_execution_assignments (part_id);
CREATE INDEX person_assignments_by_person
  ON execution.person_execution_assignments (person_id, started_at DESC);
-- Overlap detection by person over time (RUL-027). A GiST index, not an EXCLUDE: whether an
-- overlap is a conflict is a rule decision, so overlaps must be queryable, not forbidden.
CREATE INDEX person_assignments_range_gist ON execution.person_execution_assignments
  USING gist (person_id, tstzrange(started_at, ended_at, '[)'));

CREATE TABLE execution.resource_execution_assignments (
  id                uuid PRIMARY KEY,
  part_id           uuid NOT NULL REFERENCES execution.parts(id),
  execution_unit_id uuid REFERENCES execution.execution_units(id),
  resource_id       uuid NOT NULL REFERENCES config.resources(id),
  role              text NOT NULL,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz,
  end_reason        text,
  replaced_by_id    uuid REFERENCES execution.resource_execution_assignments(id),
  habilita_evaluation_id uuid REFERENCES habilita.evaluations(id),
  compliance_status text NOT NULL DEFAULT 'UNKNOWN',
  -- Metering reading at the start of this interval, with its type from the resource type.
  -- lastKm() took the maximum over prior parts; a reading belongs to an interval and a version.
  meter_reading     numeric(18, 2),
  meter_kind        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES platform.identities(id),
  CONSTRAINT resource_assignments_interval CHECK (ended_at IS NULL OR ended_at > started_at),
  CONSTRAINT resource_assignments_not_self_replaced
    CHECK (replaced_by_id IS NULL OR replaced_by_id <> id),
  CONSTRAINT resource_assignments_compliance CHECK (compliance_status IN (
    'COMPLIANT', 'NON_COMPLIANT_RECORDED', 'OVERRIDDEN', 'UNKNOWN'
  )),
  CONSTRAINT resource_assignments_meter_kind
    CHECK (meter_kind IS NULL OR meter_kind IN ('ODOMETER_KM', 'HOURMETER_H')),
  CONSTRAINT resource_assignments_meter_has_kind
    CHECK (meter_reading IS NULL OR meter_kind IS NOT NULL)
);

COMMENT ON CONSTRAINT resource_assignments_meter_has_kind ON execution.resource_execution_assignments IS
  'A reading without its kind is meaningless. The audit noted the prototype applied kilometres to
   every resource, including ones that should report engine hours.';

CREATE INDEX resource_assignments_by_part ON execution.resource_execution_assignments (part_id);
CREATE INDEX resource_assignments_range_gist ON execution.resource_execution_assignments
  USING gist (resource_id, tstzrange(started_at, ended_at, '[)'));

-- ------------------------------------------------------------------ time, place, measure

-- R-040: time intervals are append-only and never overwritten. RUL-028/029: a category change
-- closes the previous interval and opens the next.
CREATE TABLE execution.time_events (
  id                uuid PRIMARY KEY,
  part_id           uuid NOT NULL REFERENCES execution.parts(id),
  execution_unit_id uuid REFERENCES execution.execution_units(id),
  -- Operativo, traslado, espera, parada por viento, standby... a configured catalogue, since
  -- RUL-028 records the category even when the contract does not pay for it.
  time_category     text NOT NULL,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz,
  -- Why this category, when the system could not infer it (IH-06).
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES platform.identities(id),
  CONSTRAINT time_events_interval CHECK (ended_at IS NULL OR ended_at > started_at)
);

COMMENT ON TABLE execution.time_events IS
  'A time row is evidence of time, NOT an identity. S0 §7: "NO convertir automáticamente cada
   tarea o fila horaria de Juan en una UE". The link to a UE is a reference, not a definition.';

CREATE INDEX time_events_by_part ON execution.time_events (part_id, started_at);
CREATE INDEX time_events_by_ue ON execution.time_events (execution_unit_id, started_at)
  WHERE execution_unit_id IS NOT NULL;
CREATE INDEX time_events_open ON execution.time_events (part_id) WHERE ended_at IS NULL;

-- R-038: a UE may have a principal location plus origin/destination/load/unload roles, which is
-- what TP-02 needs per movement.
CREATE TABLE execution.execution_locations (
  id                    uuid PRIMARY KEY,
  execution_unit_id     uuid NOT NULL REFERENCES execution.execution_units(id),
  technical_location_id uuid REFERENCES config.technical_locations(id),
  location_role         text NOT NULL,
  -- Preserved when the real location is not in the master yet: a pending mapping, never a
  -- silently invented catalogue entry (RUL-031 + audit on free-text locations).
  unmapped_label        text,
  confirmed_by          uuid REFERENCES platform.identities(id),
  confirmed_at          timestamptz,
  latitude              numeric(9, 6),
  longitude             numeric(9, 6),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_locations_role CHECK (location_role IN (
    'PRINCIPAL', 'ORIGEN', 'DESTINO', 'CARGA', 'DESCARGA'
  )),
  CONSTRAINT execution_locations_has_reference
    CHECK (technical_location_id IS NOT NULL OR unmapped_label IS NOT NULL)
);

CREATE INDEX execution_locations_by_ue ON execution.execution_locations (execution_unit_id);

-- C-014: operational magnitude. The certifiable quantity is derived downstream and never
-- written back here.
CREATE TABLE execution.execution_measurements (
  id                 uuid PRIMARY KEY,
  execution_unit_id  uuid NOT NULL REFERENCES execution.execution_units(id),
  metric_code        text NOT NULL,
  quantity           numeric(18, 6) NOT NULL,
  unit_of_measure_id uuid NOT NULL REFERENCES config.units_of_measure(id),
  -- How the value arrived: human reading, instrument, plan pre-load confirmed.
  measurement_source text NOT NULL,
  measured_at        timestamptz NOT NULL,
  measured_by        uuid REFERENCES platform.identities(id),
  notes              text,
  -- A correction supersedes rather than overwrites.
  supersedes_id      uuid REFERENCES execution.execution_measurements(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT measurements_source CHECK (measurement_source IN (
    'HUMAN_READING', 'INSTRUMENT', 'PRELOADED_CONFIRMED', 'EXTERNAL_DOCUMENT'
  )),
  CONSTRAINT measurements_not_self_superseding CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);

COMMENT ON TABLE execution.execution_measurements IS
  'C-014: operational magnitude with its unit and source. "Medición operativa != cantidad
   certificada" (R-039): ReglaMedicionItem derives the commercial quantity later, and never
   deforms this to make a number add up.';

CREATE INDEX measurements_by_ue ON execution.execution_measurements (execution_unit_id);

-- R-041: a deviation is an event, not a boolean column.
CREATE TABLE execution.operational_events (
  id                uuid PRIMARY KEY,
  part_id           uuid NOT NULL REFERENCES execution.parts(id),
  execution_unit_id uuid REFERENCES execution.execution_units(id),
  event_type        text NOT NULL,
  reason_code       text,
  description       text,
  occurred_at       timestamptz NOT NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  recorded_by       uuid REFERENCES platform.identities(id),
  decision_trace_id uuid REFERENCES platform.decision_traces(id),
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT operational_events_type CHECK (event_type IN (
    'HANDOVER', 'PERSON_REPLACED', 'RESOURCE_REPLACED', 'WAIT', 'DEVIATION',
    'SCOPE_CHANGE', 'LOCATION_CHANGE', 'NOT_PERFORMED', 'EMERGENT_START', 'OTHER'
  ))
);

CREATE INDEX operational_events_by_part ON execution.operational_events (part_id, occurred_at);

-- C-013 / R-042: time between work packages, so no real time is orphaned. One end may be null.
CREATE TABLE execution.operational_transitions (
  id                     uuid PRIMARY KEY,
  origin_execution_unit_id uuid REFERENCES execution.execution_units(id),
  destination_execution_unit_id uuid REFERENCES execution.execution_units(id),
  part_id                uuid REFERENCES execution.parts(id),
  started_at             timestamptz NOT NULL,
  ended_at               timestamptz,
  transition_kind        text,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transitions_interval CHECK (ended_at IS NULL OR ended_at > started_at),
  -- R-042: one end may be null, but not both — a transition between nothing and nothing is not
  -- a fact about anything.
  CONSTRAINT transitions_has_an_end CHECK (
    origin_execution_unit_id IS NOT NULL OR destination_execution_unit_id IS NOT NULL
  ),
  CONSTRAINT transitions_distinct_ends CHECK (
    origin_execution_unit_id IS NULL
    OR destination_execution_unit_id IS NULL
    OR origin_execution_unit_id <> destination_execution_unit_id
  )
);

-- R-043..R-046: the contractual context of a UE. Nullable until resolved, and explicitly so.
CREATE TABLE execution.execution_allocations (
  id                  uuid PRIMARY KEY,
  execution_unit_id   uuid NOT NULL REFERENCES execution.execution_units(id),
  status              execution.allocation_status NOT NULL DEFAULT 'PENDIENTE',
  contract_service_id uuid REFERENCES config.contract_services(id),
  cost_center_id      uuid REFERENCES config.cost_centers(id),
  contract_item_id    uuid REFERENCES config.contract_items(id),
  -- Why it is not resolved, so a backoffice queue can act on it (RUL-038).
  pending_reason      text,
  resolved_at         timestamptz,
  resolved_by         uuid REFERENCES platform.identities(id),
  -- The version of this allocation, since resolving it later is a change to be tracked.
  version_no          integer NOT NULL DEFAULT 1,
  supersedes_id       uuid REFERENCES execution.execution_allocations(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- C-004 / AP-06: a RESUELTO allocation must actually carry its references; anything else must
  -- NOT pretend to. This is the constraint that makes a wildcard code impossible.
  CONSTRAINT allocations_resolved_is_complete CHECK (
    status <> 'RESUELTO'
    OR (contract_service_id IS NOT NULL AND cost_center_id IS NOT NULL AND contract_item_id IS NOT NULL)
  ),
  CONSTRAINT allocations_unresolved_has_reason CHECK (
    status = 'RESUELTO' OR pending_reason IS NOT NULL
  ),
  CONSTRAINT allocations_not_self_superseding CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);

COMMENT ON CONSTRAINT allocations_resolved_is_complete ON execution.execution_allocations IS
  'C-004 and AP-06 as a check: an allocation cannot claim RESUELTO without CS, CC and item, and
   an unresolved one cannot carry invented defaults. Reality still closes (RGT-12); only the
   commercial derivation is blocked.';

CREATE INDEX allocations_by_ue ON execution.execution_allocations (execution_unit_id);
CREATE INDEX allocations_pending ON execution.execution_allocations (status)
  WHERE status <> 'RESUELTO';

-- R-047: availability history, never derived by deleting the past.
CREATE TABLE execution.resource_availability (
  id            uuid PRIMARY KEY,
  resource_id   uuid NOT NULL REFERENCES config.resources(id),
  availability  text NOT NULL,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resource_availability_interval CHECK (ended_at IS NULL OR ended_at > started_at),
  CONSTRAINT resource_availability_values CHECK (availability IN (
    'AVAILABLE', 'IN_USE', 'MAINTENANCE', 'OUT_OF_SERVICE', 'RESERVED'
  ))
);

CREATE INDEX resource_availability_range ON execution.resource_availability
  USING gist (resource_id, tstzrange(started_at, ended_at, '[)'));

-- ------------------------------------------------------------------------- amendments

-- R-050 / RUL-073 / C-033: corrects operational reality. Distinct from a commercial adjustment.
CREATE TABLE execution.operational_amendments (
  id                 uuid PRIMARY KEY,
  target_kind        text NOT NULL,
  part_id            uuid REFERENCES execution.parts(id),
  execution_unit_id  uuid REFERENCES execution.execution_units(id),
  -- The version being corrected and the version produced. The original never disappears.
  previous_version_id uuid REFERENCES execution.execution_unit_versions(id),
  new_version_id     uuid REFERENCES execution.execution_unit_versions(id),
  field_path         text,
  old_value          jsonb,
  new_value          jsonb,
  reason             text NOT NULL,
  requested_by       uuid NOT NULL REFERENCES platform.identities(id),
  -- 13: emitting and authorising are separable when policy requires dual control.
  approved_by        uuid REFERENCES platform.identities(id),
  approved_at        timestamptz,
  evidence_id        uuid,                 -- FK in 0006
  decision_trace_id  uuid REFERENCES platform.decision_traces(id),
  occurred_at        timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amendments_target_kind CHECK (target_kind IN ('PART', 'EXECUTION_UNIT')),
  CONSTRAINT amendments_target_exactly_one CHECK (
    (part_id IS NOT NULL)::int + (execution_unit_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT amendments_reason_substantive CHECK (length(btrim(reason)) >= 10),
  CONSTRAINT amendments_versions_differ
    CHECK (previous_version_id IS NULL OR new_version_id IS NULL OR previous_version_id <> new_version_id)
);

COMMENT ON TABLE execution.operational_amendments IS
  'RUL-035: a closed UE or Parte is not reopened for editing — a correction is an amendment with
   old/new, reason, evidence, actor and approver, producing a NEW effective version. RUL-065 then
   marks derived commercial units REQUIERE_RECALCULO.';

ALTER TABLE execution.execution_unit_versions
  ADD CONSTRAINT execution_unit_versions_amendment_fk
  FOREIGN KEY (amendment_id) REFERENCES execution.operational_amendments(id);

CREATE INDEX amendments_by_ue ON execution.operational_amendments (execution_unit_id)
  WHERE execution_unit_id IS NOT NULL;
