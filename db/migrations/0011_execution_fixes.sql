-- 0011 — Two corrections surfaced by exercising the W3 execution commands end to end.
--
-- 1. `execution_units_started_timestamp` (0005) required `started_at IS NOT NULL` for every state
--    except PENDIENTE/ANULADA. But T-UE06 (MARCAR_NO_REALIZADA) transitions PENDIENTE -> NO_REALIZADA
--    precisely for work that was planned and never started (RUL-019): the whole point is that it
--    preserves the attempt without pretending it began. NO_REALIZADA belongs in the exemption.
--
-- 2. `amendments_append_only` (0009) refused UPDATE on `execution.operational_amendments`
--    outright. But RUL-073 requires creation and approval to be two separate acts by two different
--    actors at two different times, and `approved_by`/`approved_at`/`new_version_id` can only be
--    known at approval time — there is no way to fill them except by updating the row created
--    earlier. `planning.extension_requests` is the working precedent for exactly this shape
--    (create now, resolve later by a different actor, same row, no append-only trigger) — it was
--    deliberately NOT made append-only in 0010. Amendments follow the same pattern: the one-time
--    transition PENDIENTE -> APROBADA is a direct UPDATE, guarded in the handler (an amendment
--    already approved, or approved by its own author, is refused there). What stays immutable is
--    the correction itself: old_value/new_value/reason/requested_by are never touched by that
--    UPDATE, and the new execution_unit_version it produces is its own append-only row.

ALTER TABLE execution.execution_units DROP CONSTRAINT execution_units_started_timestamp;
ALTER TABLE execution.execution_units ADD CONSTRAINT execution_units_started_timestamp CHECK (
  state IN ('PENDIENTE', 'ANULADA', 'NO_REALIZADA') OR started_at IS NOT NULL
);

DROP TRIGGER IF EXISTS amendments_append_only ON execution.operational_amendments;
