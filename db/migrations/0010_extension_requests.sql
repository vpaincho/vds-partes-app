-- 0010 — Extension requests as a planning fact.
--
-- Why this table exists: an extension request ("necesito más días") is a fact about an *assignment*,
-- not about a Parte. The first implementation recorded it as an execution.operational_events row,
-- which requires a part_id — so a request made before any Parte existed could not be stored, and the
-- resolution step could not find it.
--
-- It is also the right home semantically. 07 describes extension and early closure as "solicitudes y
-- decisiones sobre el futuro", and requires the originally approved range to survive for plan-vs-real
-- (RGT-03). Keeping the request next to the assignment, with the approved window copied in verbatim,
-- means the resolution can create a new version while the original window stays provably untouched.

CREATE TYPE planning.extension_state AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');

CREATE TABLE planning.extension_requests (
  id                    uuid PRIMARY KEY,
  planned_assignment_id uuid NOT NULL REFERENCES planning.planned_assignments(id),
  -- The Parte the request came from, when it came from the field. Optional on purpose: a planner can
  -- raise one before any Parte exists.
  part_id               uuid REFERENCES execution.parts(id),
  state                 planning.extension_state NOT NULL DEFAULT 'PENDIENTE',
  additional_days       integer NOT NULL,
  reason                text NOT NULL,
  -- The approved window as it stood when the request was made, copied so plan-vs-real can be
  -- reconstructed even after a new version supersedes this assignment.
  approved_window_end   timestamptz NOT NULL,
  proposed_window_end   timestamptz NOT NULL,
  requested_by          uuid NOT NULL REFERENCES platform.identities(id),
  requested_at          timestamptz NOT NULL,
  resolved_by           uuid REFERENCES platform.identities(id),
  resolved_at           timestamptz,
  resolution_note       text,
  -- The assignment created by approving this request. Null for a rejection.
  resulting_assignment_id uuid REFERENCES planning.planned_assignments(id),
  decision_trace_id     uuid REFERENCES platform.decision_traces(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT extension_requests_days_positive CHECK (additional_days > 0),
  CONSTRAINT extension_requests_window_extends CHECK (proposed_window_end > approved_window_end),
  CONSTRAINT extension_requests_resolved_has_actor
    CHECK (state = 'PENDIENTE' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)),
  -- An approved request must name what it produced, so the chain from request to new version is
  -- traceable (RUL-020).
  CONSTRAINT extension_requests_approved_has_result
    CHECK (state <> 'APROBADA' OR resulting_assignment_id IS NOT NULL)
);

COMMENT ON TABLE planning.extension_requests IS
  'A request over the future. It never mutates the approved window: approving it creates a new
   PlanificacionVersion and the previous one becomes SUPERSEDIDA (RUL-020, RGT-03). The prototype
   instead did t.dias = p.dia + 1 and the approved range was gone.';

-- One pending request per assignment at a time; resolved ones accumulate as history.
CREATE UNIQUE INDEX extension_requests_one_pending
  ON planning.extension_requests (planned_assignment_id)
  WHERE state = 'PENDIENTE';

CREATE INDEX extension_requests_by_assignment
  ON planning.extension_requests (planned_assignment_id, requested_at DESC);

-- A resolved request is history: it is never edited or deleted, only superseded by a later request.
CREATE OR REPLACE FUNCTION planning.refuse_resolved_extension_edit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'extension requests are never deleted (request %)', OLD.id
      USING HINT = 'C-002: the request and its resolution are part of the plan-vs-real record.',
            ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.state <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'extension request % is already %', OLD.id, OLD.state
      USING HINT = 'Raise a new request. A resolved decision is not re-decided in place.',
            ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER extension_requests_immutable_once_resolved
  BEFORE UPDATE OR DELETE ON planning.extension_requests
  FOR EACH ROW EXECUTE FUNCTION planning.refuse_resolved_extension_edit();
