-- 0009 — Integrity that a single-row CHECK cannot express.
--
-- 04 is explicit that these belong at the database level, not only in services: "DB:
-- referential/uniqueness/temporal integrity". And 03 requires that a module cannot reach into
-- another's tables to mutate them — a trigger that refuses the write is the backstop when some
-- future code path forgets.
--
-- Four kinds of rule live here:
--   1. append-only tables                     (C-002, P-02, P-03)
--   2. immutability after approval/closure    (R-022, TPR-007/010/025)
--   3. acyclic chains                          (C-034, R-012, R-063)
--   4. cross-row state gates                   (C-009, TPR-024)

-- ============================================================ 1. append-only tables

CREATE OR REPLACE FUNCTION platform.refuse_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only: % refused on row %',
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, TG_OP,
    coalesce(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END,
      'unknown'
    )
    USING
      HINT = 'A later fact never erases an earlier one (P-02, C-002). Record a new row: a new '
             'version, an amendment, a supersession or a compensating event.',
      ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION platform.refuse_mutation() IS
  'Refuses UPDATE and DELETE outright. Used on tables whose whole purpose is that history cannot
   be rewritten — the prototype allowed a-del, a-reopen and arbitrary estado edits on all of them.';

-- Facts and decisions. A trace is never edited: re-evaluating creates a related trace.
CREATE TRIGGER decision_traces_append_only
  BEFORE UPDATE OR DELETE ON platform.decision_traces
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

CREATE TRIGGER decision_trace_rules_append_only
  BEFORE UPDATE OR DELETE ON platform.decision_trace_rules
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

-- A receipt is the record of what the server already did. Rewriting one would break RGT-06.
CREATE TRIGGER command_receipts_append_only
  BEFORE UPDATE OR DELETE ON platform.command_receipts
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

-- Lifecycle logs.
CREATE TRIGGER work_permit_events_append_only
  BEFORE UPDATE OR DELETE ON habilita.work_permit_events
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

CREATE TRIGGER directive_events_append_only
  BEFORE UPDATE OR DELETE ON control.directive_events
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

CREATE TRIGGER case_events_append_only
  BEFORE UPDATE OR DELETE ON habilita.case_events
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

CREATE TRIGGER operational_events_append_only
  BEFORE UPDATE OR DELETE ON execution.operational_events
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

CREATE TRIGGER readiness_invalidation_append_only
  BEFORE UPDATE OR DELETE ON planning.readiness_invalidation_events
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

-- Immutable versions and lineage. C-030: a UC's source link must keep the exact version used.
CREATE TRIGGER execution_unit_versions_append_only
  BEFORE UPDATE OR DELETE ON execution.execution_unit_versions
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

CREATE TRIGGER uc_source_links_append_only
  BEFORE UPDATE OR DELETE ON commercial.commercial_unit_source_links
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

-- Amendments and overrides are the audit trail of corrections: they cannot themselves be edited.
CREATE TRIGGER amendments_append_only
  BEFORE UPDATE OR DELETE ON execution.operational_amendments
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

CREATE TRIGGER override_gates_append_only
  BEFORE UPDATE OR DELETE ON habilita.override_gates
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

-- Habilita: the initial report is preserved; reclassification is a new version row (RUL-049).
CREATE TRIGGER event_classifications_append_only
  BEFORE UPDATE OR DELETE ON habilita.event_classifications
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

CREATE TRIGGER escalation_evaluations_append_only
  BEFORE UPDATE OR DELETE ON habilita.escalation_evaluations
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

-- Evaluations are snapshots: C-015 says a later change invalidates, it does not rewrite.
CREATE TRIGGER habilita_evaluations_no_delete
  BEFORE DELETE ON habilita.evaluations
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

-- Commercial decisions by the client and authorised adjustments.
CREATE TRIGGER client_conformities_append_only
  BEFORE UPDATE OR DELETE ON commercial.client_conformities
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

CREATE TRIGGER cert_adjustments_append_only
  BEFORE UPDATE OR DELETE ON commercial.certification_adjustments
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

-- The durable record of an external attempt must survive whatever the provider answers.
CREATE TRIGGER erp_attempts_no_delete
  BEFORE DELETE ON billing.erp_submission_attempts
  FOR EACH ROW EXECUTE FUNCTION platform.refuse_mutation();

-- ================================================ 2. immutability after approval/closure

-- R-022: an approved plan version is never edited. RGT-03 is exactly the case where the prototype
-- rewrote the approved range (t.dias) from an execution event, so this is the backstop.
CREATE OR REPLACE FUNCTION planning.refuse_approved_plan_version_edit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'plan_versions cannot be deleted (plan %, version %)',
      OLD.plan_id, OLD.version_no
      USING HINT = 'C-002: objects used in execution or certification are versioned, invalidated '
                   'or superseded, never hard-deleted.',
            ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.state = 'APROBADA' THEN
    -- The only permitted change to an approved version is becoming SUPERSEDIDA, which records
    -- that a newer version replaced it without touching what it said.
    IF NEW.state = 'SUPERSEDIDA'
       AND NEW.plan_id = OLD.plan_id
       AND NEW.version_no = OLD.version_no
       AND NEW.approved_at = OLD.approved_at
       AND NEW.approved_by = OLD.approved_by THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'plan version %.% is APROBADA and immutable', OLD.plan_id, OLD.version_no
      USING HINT = 'R-022: do not edit an assignment of an approved version — create a new '
                   'version. An early finish is a fact about execution and leaves the approved '
                   'intention intact (RGT-03).',
            ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER plan_versions_immutable_when_approved
  BEFORE UPDATE OR DELETE ON planning.plan_versions
  FOR EACH ROW EXECUTE FUNCTION planning.refuse_approved_plan_version_edit();

-- The assignments of an approved version carry the approved window. Changing one after approval
-- would silently rewrite the plan that execution is compared against.
CREATE OR REPLACE FUNCTION planning.refuse_approved_assignment_scope_edit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_state planning.plan_version_state;
BEGIN
  SELECT state INTO parent_state
  FROM planning.plan_versions WHERE id = OLD.plan_version_id;

  IF parent_state IN ('APROBADA', 'SUPERSEDIDA') THEN
    -- State transitions and dispatch/result timestamps are expected to change; the SCOPE of the
    -- intention is not.
    IF NEW.window_start <> OLD.window_start
       OR NEW.window_end <> OLD.window_end
       OR NEW.plan_version_id <> OLD.plan_version_id
       OR coalesce(NEW.crew_id::text, '') <> coalesce(OLD.crew_id::text, '')
       OR coalesce(NEW.resource_id::text, '') <> coalesce(OLD.resource_id::text, '')
       OR NEW.requires_work_permit <> OLD.requires_work_permit THEN
      RAISE EXCEPTION
        'assignment % belongs to an approved plan version: its scope is immutable', OLD.id
        USING HINT = 'Emit a DirectivaOperativa or approve a new PlanificacionVersion (RUL-020). '
                     'The dispatched snapshot is never mutated.',
              ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER planned_assignments_scope_immutable_when_approved
  BEFORE UPDATE ON planning.planned_assignments
  FOR EACH ROW EXECUTE FUNCTION planning.refuse_approved_assignment_scope_edit();

-- TPR-010 / RUL-035: a closed UE is not reopened to edit reality. Only the pointer to its current
-- version may move, which is how an amendment takes effect.
CREATE OR REPLACE FUNCTION execution.refuse_closed_unit_edit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'execution units are never deleted (unit %)', OLD.id
      USING HINT = 'C-002. Use ANULADA before start, NO_REALIZADA with a cause, or an amendment.',
            ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.state IN ('CERRADA', 'NO_REALIZADA', 'ANULADA') THEN
    IF NEW.state <> OLD.state THEN
      RAISE EXCEPTION
        'execution unit % is % (terminal): it cannot transition to %', OLD.id, OLD.state, NEW.state
        USING HINT = 'TPR-010/011/012. Correct with an EnmiendaOperativa, which produces a new '
                     'immutable version, or create a new UE.',
              ERRCODE = 'restrict_violation';
    END IF;
    -- Fields that describe what happened are frozen; only the version pointer and bookkeeping move.
    IF NEW.description <> OLD.description
       OR NEW.service_id <> OLD.service_id
       OR coalesce(NEW.result, '') <> coalesce(OLD.result, '')
       OR coalesce(NEW.started_at::text, '') <> coalesce(OLD.started_at::text, '')
       OR coalesce(NEW.ended_at::text, '') <> coalesce(OLD.ended_at::text, '') THEN
      RAISE EXCEPTION
        'execution unit % is closed: its operational facts are immutable', OLD.id
        USING HINT = 'RUL-035: block direct editing and create an EnmiendaOperativa with '
                     'old/new, reason, evidence and approver.',
              ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER execution_units_immutable_when_closed
  BEFORE UPDATE OR DELETE ON execution.execution_units
  FOR EACH ROW EXECUTE FUNCTION execution.refuse_closed_unit_edit();

-- TPR-007: a closed Parte is not reopened.
CREATE OR REPLACE FUNCTION execution.refuse_closed_part_reopen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'parts are never deleted (part %)', OLD.id
      USING HINT = 'C-002: the prototype a-del removed a job outright.',
            ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.state = 'CERRADO_OPERATIVAMENTE' AND NEW.state <> 'CERRADO_OPERATIVAMENTE' THEN
    RAISE EXCEPTION
      'part % is CERRADO_OPERATIVAMENTE and cannot return to %', OLD.id, NEW.state
      USING HINT = 'TPR-007: correct with an EnmiendaOperativa or a new execution. The prototype '
                   'a-reopen did exactly this.',
            ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.state = 'ANULADO' AND NEW.state <> 'ANULADO' THEN
    RAISE EXCEPTION 'part % is ANULADO: create a new valid Parte (TPR-008)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER parts_no_reopen
  BEFORE UPDATE OR DELETE ON execution.parts
  FOR EACH ROW EXECUTE FUNCTION execution.refuse_closed_part_reopen();

-- TPR-025: an accepted UC is not edited back to ELEGIBLE. Correction is supersession.
CREATE OR REPLACE FUNCTION commercial.refuse_accepted_unit_edit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commercial units are never deleted (unit %)', OLD.id
      USING HINT = 'RUL-066: never update or delete a previous UC; a new one supersedes it.',
            ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.state = 'ACEPTADA' THEN
    IF NEW.state <> 'ACEPTADA' THEN
      RAISE EXCEPTION
        'commercial unit % is ACEPTADA: it cannot move to %', OLD.id, NEW.state
        USING HINT = 'TPR-025: use supersession — a new UC replaces this one and this one '
                     'remains, because what was accepted stays accepted.',
              ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.quantity <> OLD.quantity OR NEW.contract_item_id <> OLD.contract_item_id THEN
      RAISE EXCEPTION
        'commercial unit % is ACEPTADA: quantity and item are immutable', OLD.id
        USING HINT = 'C-031: certification never silently modifies what was accepted. Nothing is '
                     'recalculated in place on an accepted UC.',
              ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER commercial_units_immutable_when_accepted
  BEFORE UPDATE OR DELETE ON commercial.commercial_units
  FOR EACH ROW EXECUTE FUNCTION commercial.refuse_accepted_unit_edit();

-- ====================================================================== 3. acyclic chains

-- C-034: the supersession chain must be acyclic. A UNIQUE on supersedes_id makes it linear; this
-- walks it to refuse a cycle.
CREATE OR REPLACE FUNCTION commercial.assert_acyclic_supersession() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cursor_id uuid;
  depth integer := 0;
BEGIN
  IF NEW.supersedes_id IS NULL THEN RETURN NEW; END IF;

  cursor_id := NEW.supersedes_id;
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION
        'supersession cycle: commercial unit % would supersede itself through the chain', NEW.id
        USING HINT = 'C-034: the chain must be acyclic and the previous unit stays historical.',
              ERRCODE = 'restrict_violation';
    END IF;
    depth := depth + 1;
    IF depth > 100 THEN
      RAISE EXCEPTION 'supersession chain for % exceeds 100 links', NEW.id
        USING HINT = 'Either a cycle slipped through or the chain is pathological; both need review.',
              ERRCODE = 'restrict_violation';
    END IF;
    SELECT supersedes_id INTO cursor_id FROM commercial.commercial_units WHERE id = cursor_id;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER commercial_units_acyclic_supersession
  BEFORE INSERT OR UPDATE OF supersedes_id ON commercial.commercial_units
  FOR EACH ROW EXECUTE FUNCTION commercial.assert_acyclic_supersession();

-- R-012: no cycles in the technical location tree.
CREATE OR REPLACE FUNCTION config.assert_acyclic_location_tree() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cursor_id uuid;
  depth integer := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;

  cursor_id := NEW.parent_id;
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION 'technical location % would become its own ancestor', NEW.id
        USING HINT = 'R-012: the technical tree has no cycles.', ERRCODE = 'restrict_violation';
    END IF;
    depth := depth + 1;
    IF depth > 50 THEN
      RAISE EXCEPTION 'location hierarchy deeper than 50 levels at %', NEW.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT parent_id INTO cursor_id FROM config.technical_locations WHERE id = cursor_id;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER technical_locations_acyclic
  BEFORE INSERT OR UPDATE OF parent_id ON config.technical_locations
  FOR EACH ROW EXECUTE FUNCTION config.assert_acyclic_location_tree();

-- ================================================================ 4. cross-row gates

-- C-009: "Un Parte iniciado debe tener al menos una UnidadEjecucion."
--
-- 04 asks for a deferred constraint or a service check rather than inventing a stricter
-- cardinality: a PREPARADO Parte legitimately has zero UE (sheet 42 allows it, R-035 says 1..N).
-- A CONSTRAINT TRIGGER deferred to commit lets the START_WORK transaction create the Parte state
-- change and its first UE in either order, and still refuses to commit a started Parte with none.
CREATE OR REPLACE FUNCTION execution.assert_started_part_has_unit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unit_count integer;
BEGIN
  IF NEW.state IN ('PREPARADO', 'ANULADO') THEN RETURN NULL; END IF;

  SELECT count(*) INTO unit_count
  FROM execution.execution_units WHERE part_id = NEW.id;

  IF unit_count = 0 THEN
    RAISE EXCEPTION
      'part % is % with no UnidadEjecucion', NEW.id, NEW.state
      USING HINT = 'C-009: a started Parte has at least one UE, because the UE is the operational '
                   'grain. Checked at commit so Start Work may create both in one transaction.',
            ERRCODE = 'restrict_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER parts_started_has_unit
  AFTER INSERT OR UPDATE OF state ON execution.parts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION execution.assert_started_part_has_unit();

COMMENT ON FUNCTION execution.assert_started_part_has_unit() IS
  'C-009 as a deferred constraint trigger. PREPARADO with zero UE stays legal, which is what sheet
   42 permits and what 04 warns against over-tightening.';

-- TPR-009: a Parte cannot close with unresolved UE. Needs to see the child rows, so it is a
-- deferred constraint trigger too.
CREATE OR REPLACE FUNCTION execution.assert_closed_part_has_terminal_units() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  open_units integer;
  open_intervals integer;
BEGIN
  IF NEW.state <> 'CERRADO_OPERATIVAMENTE' THEN RETURN NULL; END IF;

  SELECT count(*) INTO open_units
  FROM execution.execution_units
  WHERE part_id = NEW.id AND state NOT IN ('CERRADA', 'NO_REALIZADA', 'ANULADA');

  IF open_units > 0 THEN
    RAISE EXCEPTION
      'part % cannot close: % unit(s) are not terminal', NEW.id, open_units
      USING HINT = 'TPR-009 / RUL-034: every UE must be CERRADA, NO_REALIZADA or ANULADA '
                   'explicitly. The prototype accumulated blockers at send time instead.',
            ERRCODE = 'restrict_violation';
  END IF;

  -- RUL-034 also requires no open time intervals.
  SELECT count(*) INTO open_intervals
  FROM execution.time_events WHERE part_id = NEW.id AND ended_at IS NULL;

  IF open_intervals > 0 THEN
    RAISE EXCEPTION
      'part % cannot close: % open time interval(s)', NEW.id, open_intervals
      USING HINT = 'RUL-034: close every interval before closing the Parte.',
            ERRCODE = 'restrict_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER parts_closed_units_terminal
  AFTER UPDATE OF state ON execution.parts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION execution.assert_closed_part_has_terminal_units();

-- TPR-024 / RUL-053: a case cannot close while a blocking action is unverified. B-09 makes which
-- actions block configurable, so the column decides and this enforces it.
CREATE OR REPLACE FUNCTION habilita.assert_case_closure_gates() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  blocking_open integer;
  notifications_open integer;
BEGIN
  IF NEW.state <> 'CERRADO' THEN RETURN NULL; END IF;

  SELECT count(*) INTO blocking_open
  FROM habilita.corrective_actions
  WHERE case_id = NEW.id AND is_blocking = true AND state NOT IN ('VERIFICADA', 'CANCELADA');

  IF blocking_open > 0 THEN
    RAISE EXCEPTION
      'case % cannot close: % blocking action(s) unverified', NEW.id, blocking_open
      USING HINT = 'TPR-024 / RUL-053: only configuration marking an action non-blocking allows '
                   'closure. An investigation may finish while actions remain open (T-CH03).',
            ERRCODE = 'restrict_violation';
  END IF;

  SELECT count(*) INTO notifications_open
  FROM habilita.notifications
  WHERE case_id = NEW.id AND status IN ('PENDIENTE', 'EN_CURSO');

  IF notifications_open > 0 THEN
    RAISE EXCEPTION
      'case % cannot close: % notification obligation(s) unresolved', NEW.id, notifications_open
      USING HINT = 'T-CH04: required notifications must be resolved before closure is enabled. A '
                   'fixture channel does not resolve an obligation (RGT-16).',
            ERRCODE = 'restrict_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cases_closure_gates
  AFTER UPDATE OF state ON habilita.cases
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION habilita.assert_case_closure_gates();

-- RUL-070: a billable line may only exist for an ACCEPTED and CURRENT commercial unit. RGT-13
-- requires this to be re-checked at send time, and the database refuses the row outright.
CREATE OR REPLACE FUNCTION billing.assert_line_source_is_billable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unit_state commercial.unit_state;
  unit_supersession commercial.supersession_state;
BEGIN
  SELECT state, supersession_state INTO unit_state, unit_supersession
  FROM commercial.commercial_units WHERE id = NEW.commercial_unit_id;

  IF unit_state <> 'ACEPTADA' THEN
    RAISE EXCEPTION
      'commercial unit % is % — only an ACEPTADA unit can be billed', NEW.commercial_unit_id, unit_state
      USING HINT = 'RUL-070.', ERRCODE = 'restrict_violation';
  END IF;

  IF unit_supersession <> 'VIGENTE' THEN
    RAISE EXCEPTION
      'commercial unit % has supersession state % — it is no longer current',
      NEW.commercial_unit_id, unit_supersession
      USING HINT = 'RUL-065 / RGT-13: an amended source blocks new billing even when a projection '
                   'has not caught up. Resolve the supersession first.',
            ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER billable_lines_source_billable
  BEFORE INSERT ON billing.billable_lines
  FOR EACH ROW EXECUTE FUNCTION billing.assert_line_source_is_billable();

-- Keep updated_at honest on mutable aggregates, so a projection can trust it.
CREATE OR REPLACE FUNCTION platform.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.column_name = 'updated_at'
      AND t.table_type = 'BASE TABLE'
      AND c.table_schema IN ('platform','config','planning','execution','habilita','control',
                             'evidence','review','commercial','billing','sync')
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at()',
      't_touch_' || target.table_name, target.table_schema, target.table_name
    );
  END LOOP;
END;
$$;
