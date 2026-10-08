/**
 * Loaders and constants shared by the execution command modules.
 *
 * Extracted rather than duplicated because `loadUnit` carries a decision: `requires_work_permit`
 * comes from the planned assignment this work materialises, and for emergent work it is **not**
 * defaulted to true. That default would look prudent and be wrong — whether a permit is required is
 * configuration (RUL-042), and assuming it would block emergent work the rules allow while also
 * hiding that nobody had configured the answer. One copy, one decision.
 */
import { DomainError, type Uuid } from '@vds/kernel';
import type { Db } from '../platform/db.ts';

export const PART_TERMINAL = ['CERRADO_OPERATIVAMENTE', 'ANULADO'] as const;
export const UNIT_TERMINAL = ['CERRADA', 'NO_REALIZADA', 'ANULADA'] as const;

export interface PartRow {
  id: Uuid;
  code: string | null;
  state: string;
  base_id: Uuid | null;
  part_type_id: Uuid;
  crew_id: Uuid | null;
  operational_date: string;
  is_emergent: boolean;
  version: number;
}

export async function loadPart(db: Db, partId: string): Promise<PartRow> {
  const row = await db.one<PartRow>(
    `SELECT id, code, state::text AS state, base_id, part_type_id, crew_id,
            operational_date::text AS operational_date, is_emergent, version
     FROM execution.parts WHERE id = $1`,
    [partId],
  );
  if (!row) {
    throw new DomainError({ code: 'NOT_FOUND', message: `No existe el Parte ${partId}.` });
  }
  return row;
}

export interface UnitRow {
  id: Uuid;
  code: string | null;
  state: string;
  part_id: Uuid;
  base_id: Uuid | null;
  part_type_id: Uuid;
  version: number;
  requires_work_permit: boolean;
}

export async function loadUnit(db: Db, unitId: string): Promise<UnitRow> {
  const row = await db.one<UnitRow>(
    `SELECT u.id, u.code, u.state::text AS state, u.part_id, p.base_id, p.part_type_id, u.version,
            -- Whether a permit is required comes from the planned assignment that this work
            -- materialises. Absent a plan the context rule decides, and defaulting emergent work to
            -- "required" is NOT assumed here — that is configuration (RUL-042).
            coalesce(a.requires_work_permit, false) AS requires_work_permit
     FROM execution.execution_units u
     JOIN execution.parts p ON p.id = u.part_id
     LEFT JOIN planning.plan_execution_links l ON l.part_id = p.id
     LEFT JOIN planning.planned_assignments a ON a.id = l.planned_assignment_id
     WHERE u.id = $1
     LIMIT 1`,
    [unitId],
  );
  if (!row) {
    throw new DomainError({ code: 'NOT_FOUND', message: `No existe la UnidadEjecucion ${unitId}.` });
  }
  return row;
}

/** The subject id comes from the route path, supplied by the pipeline. */
export function requireSubjectId(subjectId: string | null, what: string): Uuid {
  if (subjectId === null) {
    throw new Error(`${what} is addressed by its route path, but no subject id was supplied.`);
  }
  return subjectId as Uuid;
}
