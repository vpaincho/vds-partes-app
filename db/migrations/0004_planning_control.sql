-- 0004 — Planning (intention) and Control Plane (post-dispatch instructions).
--
-- Logical entities 33..47.
--
-- C-001 is the invariant this file serves: Planning records intention, Execution records
-- reality, and neither overwrites the other. The prototype had one mutable `S.trabajos` row per
-- job; `o-send` shortened `t.dias` when a crew finished early, destroying the approved plan
-- (RGT-03). Here an approved PlanificacionVersion is immutable (enforced in 0013) and an early
-- finish is a fact about execution that leaves the intention intact.
--
-- PL-093 (RGT-01) is addressed by conflict detection on **stable ids**: `clashes()` excluded the
-- current job by object identity (`o !== t`), so evaluating a copy or a proposal made a job
-- collide with itself. planning.temporal_conflicts below records candidate and incumbent by id,
-- and the detection service excludes by aggregate id, never by reference.

CREATE TYPE planning.plan_state AS ENUM ('ABIERTA', 'ACTIVA', 'CERRADA', 'CANCELADA');

CREATE TYPE planning.plan_version_state AS ENUM (
  'BORRADOR', 'EN_VALIDACION', 'APROBADA', 'SUPERSEDIDA', 'RECHAZADA'
);

CREATE TYPE planning.assignment_state AS ENUM (
  'PROGRAMADA', 'READY', 'DESPACHADA', 'CUMPLIDA', 'NO_REALIZADA', 'CANCELADA', 'SUPERSEDIDA'
);

CREATE TYPE planning.demand_state AS ENUM (
  'ABIERTA', 'PROGRAMADA', 'CUMPLIDA', 'CANCELADA'
);

-- ------------------------------------------------------------------------- demand

CREATE TABLE planning.operational_demands (
  id                  uuid PRIMARY KEY,
  code                text,
  client_id           uuid REFERENCES config.clients(id),
  contract_service_id uuid REFERENCES config.contract_services(id),
  service_id          uuid REFERENCES config.services(id),
  state               planning.demand_state NOT NULL DEFAULT 'ABIERTA',
  description         text NOT NULL,
  requested_by        text,
  requested_at        timestamptz NOT NULL,
  needed_from         date,
  needed_until        date,
  priority            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT demands_window CHECK (needed_until IS NULL OR needed_from IS NULL OR needed_until >= needed_from)
);

COMMENT ON TABLE planning.operational_demands IS
  'RUL-009: a need recorded before resources are scheduled. R-024: one demand may split into
   several planned units, which is why plan<->real is never 1:1.';

-- --------------------------------------------------------------- plan and its versions

CREATE TABLE planning.plans (
  id         uuid PRIMARY KEY,
  code       text,
  name       text NOT NULL,
  base_id    uuid,
  state      planning.plan_state NOT NULL DEFAULT 'ABIERTA',
  closed_at  timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version    integer NOT NULL DEFAULT 1
);

CREATE TABLE planning.plan_versions (
  id              uuid PRIMARY KEY,
  plan_id         uuid NOT NULL REFERENCES planning.plans(id),
  version_no      integer NOT NULL,
  state           planning.plan_version_state NOT NULL DEFAULT 'BORRADOR',
  -- R-021: only one version may be the approved/current one per workflow.
  approved_at     timestamptz,
  approved_by     uuid REFERENCES platform.identities(id),
  rejected_at     timestamptz,
  rejection_reason text,
  superseded_at   timestamptz,
  superseded_by_id uuid REFERENCES planning.plan_versions(id),
  -- The catalogue and ruleset the snapshot was approved against, so plan-vs-real can be
  -- reconstructed with the configuration of the time rather than today's.
  ruleset_version_id uuid REFERENCES platform.ruleset_versions(id),
  decision_trace_id  uuid REFERENCES platform.decision_traces(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_versions_unique UNIQUE (plan_id, version_no),
  CONSTRAINT plan_versions_approved_has_approver
    CHECK (state <> 'APROBADA' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CONSTRAINT plan_versions_supersede_is_not_self
    CHECK (superseded_by_id IS NULL OR superseded_by_id <> id)
);

COMMENT ON TABLE planning.plan_versions IS
  'R-022: an approved version is never edited — replanning creates a new version. 0013 adds a
   trigger that refuses UPDATE on an APROBADA row, because RGT-03 is precisely the case where
   the prototype rewrote the approved range from an execution event.';

CREATE UNIQUE INDEX plan_versions_one_approved
  ON planning.plan_versions (plan_id)
  WHERE state = 'APROBADA';

COMMENT ON INDEX planning.plan_versions_one_approved IS
  'R-021: at most one approved version per plan at a time. Earlier ones become SUPERSEDIDA and
   remain readable; they are never deleted.';

-- ------------------------------------------------------------- assignments and units

CREATE TABLE planning.planned_assignments (
  id                 uuid PRIMARY KEY,
  plan_version_id    uuid NOT NULL REFERENCES planning.plan_versions(id),
  code               text,
  state              planning.assignment_state NOT NULL DEFAULT 'PROGRAMADA',
  -- The dispatchable window. Preserved verbatim for plan-vs-real even when reality diverges.
  window_start       timestamptz NOT NULL,
  window_end         timestamptz NOT NULL,
  operational_date   date,
  shift_id           text,
  priority           text NOT NULL DEFAULT 'MEDIA',
  expected_part_type_id uuid REFERENCES config.part_types(id),
  crew_id            uuid REFERENCES config.crews(id),
  resource_id        uuid REFERENCES config.resources(id),
  requires_work_permit boolean NOT NULL DEFAULT false,
  dispatched_at      timestamptz,
  fulfilled_at       timestamptz,
  not_performed_at   timestamptz,
  not_performed_reason text,
  cancelled_at       timestamptz,
  superseded_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT planned_assignments_window CHECK (window_end > window_start),
  CONSTRAINT planned_assignments_priority CHECK (priority IN ('URGENTE', 'ALTA', 'MEDIA', 'BAJA')),
  -- T-A07: a terminal NO_REALIZADA always carries a structured cause (RUL-019). Never deleted.
  CONSTRAINT planned_assignments_not_performed_needs_reason
    CHECK (state <> 'NO_REALIZADA' OR not_performed_reason IS NOT NULL),
  -- T-A04: DESPACHADA means context was delivered; it does NOT mean EN_EJECUCION (SM-02).
  CONSTRAINT planned_assignments_dispatch_timestamp
    CHECK (state NOT IN ('DESPACHADA', 'CUMPLIDA') OR dispatched_at IS NOT NULL)
);

COMMENT ON CONSTRAINT planned_assignments_dispatch_timestamp ON planning.planned_assignments IS
  'SM-02: DESPACHADA is not EN_EJECUCION. Real state lives in execution.parts / execution_units;
   this table never mirrors it.';

CREATE INDEX planned_assignments_by_window
  ON planning.planned_assignments (window_start, window_end);
CREATE INDEX planned_assignments_by_state
  ON planning.planned_assignments (state, window_start);
-- The Gantt / resource / month views read one projection over this range (07).
CREATE INDEX planned_assignments_range_gist
  ON planning.planned_assignments USING gist (tstzrange(window_start, window_end, '[)'));

CREATE TABLE planning.planned_units (
  id                    uuid PRIMARY KEY,
  planned_assignment_id uuid NOT NULL REFERENCES planning.planned_assignments(id),
  demand_id             uuid REFERENCES planning.operational_demands(id),
  service_id            uuid NOT NULL REFERENCES config.services(id),
  activity_id           uuid REFERENCES config.activities(id),
  technical_location_id uuid REFERENCES config.technical_locations(id),
  client_asset_id       uuid REFERENCES config.client_assets(id),
  contract_service_id   uuid REFERENCES config.contract_services(id),
  contract_item_id      uuid REFERENCES config.contract_items(id),
  description           text NOT NULL,
  planned_quantity      numeric(18, 6),
  unit_of_measure_id    uuid REFERENCES config.units_of_measure(id),
  sequence_no           integer,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- A planned quantity needs its unit; a bare number is not a quantity.
  CONSTRAINT planned_units_quantity_has_unit
    CHECK (planned_quantity IS NULL OR unit_of_measure_id IS NOT NULL)
);

CREATE INDEX planned_units_by_assignment ON planning.planned_units (planned_assignment_id);

-- R-025/R-026/MR-07: a requirement ("I need one backhoe") is a different fact from a nomination
-- ("I assign Backhoe 803"). The prototype only had the latter.
CREATE TABLE planning.resource_requirements (
  id               uuid PRIMARY KEY,
  planned_unit_id  uuid NOT NULL REFERENCES planning.planned_units(id),
  resource_type_id uuid NOT NULL REFERENCES config.resource_types(id),
  quantity         integer NOT NULL DEFAULT 1,
  notes            text,
  CONSTRAINT resource_requirements_quantity CHECK (quantity > 0)
);

CREATE TABLE planning.competence_requirements (
  id                     uuid PRIMARY KEY,
  planned_unit_id        uuid NOT NULL REFERENCES planning.planned_units(id),
  operational_profile_id uuid REFERENCES config.operational_profiles(id),
  competence_code        text,
  quantity               integer NOT NULL DEFAULT 1,
  notes                  text,
  CONSTRAINT competence_requirements_quantity CHECK (quantity > 0),
  CONSTRAINT competence_requirements_has_subject
    CHECK (operational_profile_id IS NOT NULL OR competence_code IS NOT NULL)
);

-- R-027/R-028: nominal, planned participation. Does not replace real participation.
CREATE TABLE planning.planned_person_assignments (
  id                    uuid PRIMARY KEY,
  planned_assignment_id uuid REFERENCES planning.planned_assignments(id),
  planned_unit_id       uuid REFERENCES planning.planned_units(id),
  person_id             uuid NOT NULL REFERENCES config.people(id),
  role                  text,
  planned_from          timestamptz,
  planned_until         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planned_person_window
    CHECK (planned_until IS NULL OR planned_from IS NULL OR planned_until > planned_from),
  -- Attached to the assignment or to a unit, but it must be attached to something.
  CONSTRAINT planned_person_has_parent
    CHECK (planned_assignment_id IS NOT NULL OR planned_unit_id IS NOT NULL)
);

CREATE TABLE planning.planned_resource_assignments (
  id                    uuid PRIMARY KEY,
  planned_assignment_id uuid REFERENCES planning.planned_assignments(id),
  planned_unit_id       uuid REFERENCES planning.planned_units(id),
  resource_id           uuid NOT NULL REFERENCES config.resources(id),
  role                  text,
  planned_from          timestamptz,
  planned_until         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planned_resource_window
    CHECK (planned_until IS NULL OR planned_from IS NULL OR planned_until > planned_from),
  CONSTRAINT planned_resource_has_parent
    CHECK (planned_assignment_id IS NOT NULL OR planned_unit_id IS NOT NULL)
);

-- ------------------------------------------------------------------------ readiness

-- R-029/C-015: READY carries evaluated_at and valid_until plus its causes. Not a checkbox.
CREATE TABLE planning.readiness_evaluations (
  id                    uuid PRIMARY KEY,
  planned_assignment_id uuid NOT NULL REFERENCES planning.planned_assignments(id),
  plan_version_id       uuid NOT NULL REFERENCES planning.plan_versions(id),
  result                text NOT NULL,
  causes                jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What this evaluation depended on, so a change to any of them can invalidate it (RUL-015).
  dependencies          jsonb NOT NULL DEFAULT '{}'::jsonb,
  habilita_evaluation_id uuid REFERENCES habilita.evaluations(id),
  decision_trace_id     uuid REFERENCES platform.decision_traces(id),
  evaluated_at          timestamptz NOT NULL,
  valid_until           timestamptz,
  -- Set when a later event invalidated this evaluation. The row itself is never rewritten.
  invalidated_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT readiness_result CHECK (result IN ('READY', 'NOT_READY')),
  CONSTRAINT readiness_window CHECK (valid_until IS NULL OR valid_until > evaluated_at),
  CONSTRAINT readiness_not_ready_has_causes
    CHECK (result = 'READY' OR jsonb_array_length(causes) > 0)
);

COMMENT ON CONSTRAINT readiness_not_ready_has_causes ON planning.readiness_evaluations IS
  'RUL-013: NOT_READY must say why. A refusal without causes cannot be acted on.';

CREATE INDEX readiness_current
  ON planning.readiness_evaluations (planned_assignment_id, evaluated_at DESC)
  WHERE invalidated_at IS NULL;

-- R-030: the invalidating fact is its own append-only row; the prior evaluation is not erased.
CREATE TABLE planning.readiness_invalidation_events (
  id                      uuid PRIMARY KEY,
  readiness_evaluation_id uuid NOT NULL REFERENCES planning.readiness_evaluations(id),
  cause                   text NOT NULL,
  changed_dependency      text NOT NULL,
  detail                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at             timestamptz NOT NULL,
  recorded_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT readiness_invalidation_cause CHECK (cause IN (
    'DOCUMENT_CHANGED', 'RESOURCE_CHANGED', 'PERSON_CHANGED', 'SCOPE_CHANGED',
    'WINDOW_CHANGED', 'CONTRACT_CHANGED', 'PERMIT_CHANGED', 'RULESET_CHANGED'
  ))
);

-- -------------------------------------------------------- plan <-> execution linkage

-- R-031/C-023/MR-04: 0..N <-> 0..N. Never assume one planned unit equals one UE. Emergent work
-- has no plan at all; a planned unit may be split, merged or not performed.
CREATE TABLE planning.plan_execution_links (
  id                    uuid PRIMARY KEY,
  planned_unit_id       uuid REFERENCES planning.planned_units(id),
  planned_assignment_id uuid REFERENCES planning.planned_assignments(id),
  part_id               uuid,              -- FK in 0005
  execution_unit_id     uuid,              -- FK in 0005
  link_kind             text NOT NULL,
  -- How much of the planned intention this link accounts for, when partial.
  contribution_note     text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_execution_links_kind CHECK (link_kind IN (
    'MATERIALISES', 'PARTIAL', 'SPLIT', 'MERGED', 'SUBSTITUTE', 'EMERGENT_NO_PLAN'
  )),
  -- At least one side of the plan and one side of the execution, except for emergent work which
  -- legitimately has no planned side (C-022).
  CONSTRAINT plan_execution_links_has_execution
    CHECK (part_id IS NOT NULL OR execution_unit_id IS NOT NULL),
  CONSTRAINT plan_execution_links_plan_or_emergent CHECK (
    link_kind = 'EMERGENT_NO_PLAN'
    OR planned_unit_id IS NOT NULL
    OR planned_assignment_id IS NOT NULL
  )
);

COMMENT ON TABLE planning.plan_execution_links IS
  'MR-04 calls this the central piece of the ERD. The prototype had p.pl plus parteOf(pl, fecha),
   a 1:1 assumption that cannot express split, merge, not-performed or emergent work.';

CREATE INDEX plan_execution_links_by_plan ON planning.plan_execution_links (planned_unit_id);
CREATE INDEX plan_execution_links_by_part ON planning.plan_execution_links (part_id);

-- ------------------------------------------------------------------ temporal conflicts

-- C-012 / RUL-027: detected overlaps are facts. Not every overlap is a conflict — shared support
-- may legitimately overlap — so the rule decides BLOCK or WARN and the row records the outcome.
CREATE TABLE planning.temporal_conflicts (
  id               uuid PRIMARY KEY,
  subject_kind     text NOT NULL,
  person_id        uuid REFERENCES config.people(id),
  resource_id      uuid REFERENCES config.resources(id),
  -- Both sides by stable id. PL-093 / RGT-01: the prototype excluded the current job by object
  -- reference, so a proposal collided with itself. Identity here is always an id.
  candidate_kind   text NOT NULL,
  candidate_id     uuid NOT NULL,
  incumbent_kind   text NOT NULL,
  incumbent_id     uuid NOT NULL,
  overlap_from     timestamptz NOT NULL,
  overlap_until    timestamptz NOT NULL,
  overlap_minutes  integer NOT NULL,
  verdict          text NOT NULL,
  rule_id          text,
  decision_trace_id uuid REFERENCES platform.decision_traces(id),
  resolved_at      timestamptz,
  resolution_note  text,
  detected_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT temporal_conflicts_window CHECK (overlap_until > overlap_from),
  CONSTRAINT temporal_conflicts_verdict CHECK (verdict IN ('BLOCK', 'WARN', 'ALLOWED')),
  CONSTRAINT temporal_conflicts_subject_exactly_one CHECK (
    (person_id IS NOT NULL)::int + (resource_id IS NOT NULL)::int = 1
  ),
  -- A row that reports something conflicting with itself is a detection bug, not data.
  CONSTRAINT temporal_conflicts_not_self CHECK (
    NOT (candidate_kind = incumbent_kind AND candidate_id = incumbent_id)
  )
);

COMMENT ON CONSTRAINT temporal_conflicts_not_self ON planning.temporal_conflicts IS
  'RGT-01 / PL-093 at the storage level: a self-conflict can never be persisted, so the bug
   cannot reappear silently if a future detector forgets to exclude the aggregate under test.';

CREATE INDEX temporal_conflicts_open ON planning.temporal_conflicts (detected_at DESC)
  WHERE resolved_at IS NULL;

-- --------------------------------------------------------------------- context bundle

-- C-016 / MR-08 / FC-02: a versioned projection with an expiry. Never a source of truth.
CREATE TABLE sync.execution_context_bundles (
  id                    uuid PRIMARY KEY,
  plan_version_id       uuid NOT NULL REFERENCES planning.plan_versions(id),
  planned_assignment_id uuid REFERENCES planning.planned_assignments(id),
  -- Who and which device this bundle was scoped to.
  identity_id           uuid REFERENCES platform.identities(id),
  device_id             uuid REFERENCES platform.devices(id),
  ruleset_version_id    uuid REFERENCES platform.ruleset_versions(id),
  payload               jsonb NOT NULL,
  content_hash          text NOT NULL,
  built_at              timestamptz NOT NULL DEFAULT now(),
  -- RUL-017: a bundle carries context_valid_until_at. An expired bundle does not enable Start
  -- Work (GS-024); it is re-evaluated or refused.
  valid_until           timestamptz NOT NULL,
  CONSTRAINT bundles_validity CHECK (valid_until > built_at)
);

COMMENT ON TABLE sync.execution_context_bundles IS
  'A cache, never the master (C-016). A signed bundle proves origin and integrity, not continued
   validity: it cannot know about a revocation issued after it was built.';

CREATE INDEX bundles_for_assignment
  ON sync.execution_context_bundles (planned_assignment_id, built_at DESC);

-- -------------------------------------------------------------------- control plane

-- SM-06: EMITIDA != RECIBIDA != RECONOCIDA != APLICADA (C-017).
CREATE TYPE control.directive_state AS ENUM (
  'EMITIDA', 'RECIBIDA', 'RECONOCIDA', 'APLICADA', 'RECHAZADA', 'CANCELADA', 'EXPIRADA'
);

CREATE TYPE control.directive_type AS ENUM (
  'CANCELAR', 'SUSPENDER', 'REPROGRAMAR', 'REPRIORIZAR', 'CAMBIO_ALCANCE'
);

CREATE TABLE control.directives (
  id                 uuid PRIMARY KEY,
  code               text,
  directive_type     control.directive_type NOT NULL,
  state              control.directive_state NOT NULL DEFAULT 'EMITIDA',
  reason             text NOT NULL,
  issued_by          uuid NOT NULL REFERENCES platform.identities(id),
  issued_at          timestamptz NOT NULL,
  -- The plan version / context the instruction was issued against. RUL-020: a post-dispatch
  -- change travels as a new fact and never mutates the dispatched snapshot.
  plan_version_id    uuid REFERENCES planning.plan_versions(id),
  valid_until        timestamptz,
  received_at        timestamptz,
  acknowledged_at    timestamptz,
  acknowledged_by    uuid REFERENCES platform.identities(id),
  applied_at         timestamptz,
  -- RUL-057: application must be auditable, so the effect is referenced, not assumed.
  applied_effect_ref jsonb,
  rejected_at        timestamptz,
  rejection_reason   text,
  cancelled_at       timestamptz,
  expired_at         timestamptz,
  decision_trace_id  uuid REFERENCES platform.decision_traces(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  -- TPR-016: APLICADA requires evidence of receipt and of effect.
  CONSTRAINT directives_applied_requires_receipt_and_effect CHECK (
    state <> 'APLICADA'
    OR (received_at IS NOT NULL AND applied_at IS NOT NULL AND applied_effect_ref IS NOT NULL)
  ),
  CONSTRAINT directives_rejected_requires_reason
    CHECK (state <> 'RECHAZADA' OR rejection_reason IS NOT NULL),
  -- Ordering of the lifecycle timestamps, so a row cannot claim an impossible sequence.
  CONSTRAINT directives_timestamps_ordered CHECK (
    (received_at IS NULL OR received_at >= issued_at)
    AND (acknowledged_at IS NULL OR received_at IS NOT NULL)
    AND (acknowledged_at IS NULL OR acknowledged_at >= received_at)
    AND (applied_at IS NULL OR applied_at >= received_at)
  )
);

COMMENT ON CONSTRAINT directives_applied_requires_receipt_and_effect ON control.directives IS
  'TPR-016 as a check: marking a directive applied without traceable receipt and effect is the
   forbidden transition EMITIDA -> APLICADA. An ACK is not an application either (RUL-056).';

CREATE INDEX directives_pending ON control.directives (state, issued_at DESC)
  WHERE state IN ('EMITIDA', 'RECIBIDA', 'RECONOCIDA');
CREATE INDEX directives_expiring ON control.directives (valid_until)
  WHERE valid_until IS NOT NULL AND state IN ('EMITIDA', 'RECIBIDA', 'RECONOCIDA');

-- R-032: a directive affects 1..N typed targets. Typed columns with exactly-one-non-null, so
-- there is no opaque polymorphic target (MR-09).
CREATE TABLE control.directive_targets (
  id                    uuid PRIMARY KEY,
  directive_id          uuid NOT NULL REFERENCES control.directives(id) ON DELETE CASCADE,
  target_kind           text NOT NULL,
  planned_assignment_id uuid REFERENCES planning.planned_assignments(id),
  planned_unit_id       uuid REFERENCES planning.planned_units(id),
  plan_id               uuid REFERENCES planning.plans(id),
  part_id               uuid,              -- FK in 0005
  execution_unit_id     uuid,              -- FK in 0005
  work_permit_id        uuid REFERENCES habilita.work_permits(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT directive_targets_kind CHECK (target_kind IN (
    'PLANNED_ASSIGNMENT', 'PLANNED_UNIT', 'PLAN', 'PART', 'EXECUTION_UNIT', 'WORK_PERMIT'
  )),
  CONSTRAINT directive_targets_exactly_one CHECK (
    (planned_assignment_id IS NOT NULL)::int + (planned_unit_id IS NOT NULL)::int
    + (plan_id IS NOT NULL)::int + (part_id IS NOT NULL)::int
    + (execution_unit_id IS NOT NULL)::int + (work_permit_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT directive_targets_kind_matches CHECK (
    CASE target_kind
      WHEN 'PLANNED_ASSIGNMENT' THEN planned_assignment_id IS NOT NULL
      WHEN 'PLANNED_UNIT'       THEN planned_unit_id IS NOT NULL
      WHEN 'PLAN'               THEN plan_id IS NOT NULL
      WHEN 'PART'               THEN part_id IS NOT NULL
      WHEN 'EXECUTION_UNIT'     THEN execution_unit_id IS NOT NULL
      WHEN 'WORK_PERMIT'        THEN work_permit_id IS NOT NULL
    END
  )
);

CREATE INDEX directive_targets_by_directive ON control.directive_targets (directive_id);

-- Append-only lifecycle log (enforced in 0013).
CREATE TABLE control.directive_events (
  id           uuid PRIMARY KEY,
  directive_id uuid NOT NULL REFERENCES control.directives(id),
  event_type   text NOT NULL,
  from_state   control.directive_state,
  to_state     control.directive_state NOT NULL,
  actor_id     uuid REFERENCES platform.identities(id),
  device_id    uuid REFERENCES platform.devices(id),
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT directive_events_type CHECK (event_type IN (
    'EMITIR', 'RECIBIR', 'ACK', 'APLICAR', 'RECHAZAR', 'CANCELAR', 'EXPIRAR'
  ))
);

CREATE INDEX directive_events_by_directive ON control.directive_events (directive_id, occurred_at);
