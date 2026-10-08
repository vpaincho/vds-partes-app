/**
 * Loading a TipoParte strategy with its configuration.
 *
 * The strategies in `@vds/typeparts` are pure: they take configuration as a parameter and never go
 * looking for it. This module is where the looking happens — it reads the `PART_TYPE_CUT` and
 * `SHIFT_BOUNDARY` rule versions that apply at an instant, with scope specificity, and hands the
 * result to the strategy.
 *
 * Two deliberate properties:
 *
 *  1. **Absent configuration stays absent.** Every field of `TypePartConfig` is optional, and this
 *     loader leaves a field undefined rather than defaulting it. The strategy then says "this came
 *     from a default" or "this needs configuration", and the trace records which (B-01…B-09, RGT-12).
 *     Defaulting here would destroy that distinction before anyone could see it.
 *  2. **Specificity, not recency.** A rule scoped to the contract service beats one scoped to the
 *     part type, which beats a global one (sheet 58 step 3). Recency only breaks ties within a level.
 */
import { DomainError, type Instant, type Uuid } from '@vds/kernel';
import {
  behaviorFor,
  isTypePartId,
  routeContext,
  type NormalizedContext,
  type RoutingResult,
  type TypePartBehavior,
  type TypePartConfig,
  type TypePartId,
} from '@vds/typeparts';
import type { Db } from './db.ts';

/** The cut parameters a `PART_TYPE_CUT` rule version may carry. */
interface CutParams {
  readonly shiftCutsPart?: boolean;
  readonly locationCutsPart?: boolean;
  readonly clientCutsPart?: boolean;
  readonly transportContinuity?: 'SAME_PART' | 'NEW_PART';
}

interface ShiftParams {
  readonly boundary?: string;
}

const SPECIFICITY = `
  CASE rs.scope_level
    WHEN 'ITEM' THEN 1 WHEN 'CONTRACT_SERVICE' THEN 2 WHEN 'CLIENT' THEN 3
    WHEN 'SERVICE' THEN 4 WHEN 'PART_TYPE' THEN 5 ELSE 6
  END`;

/**
 * The configuration in force for a part type at an instant.
 *
 * `partTypeId` narrows PART_TYPE_CUT rules that declare a part-type scope; a global rule applies to
 * all patterns, which is why the scope filter accepts a null `part_type_id` as well.
 */
export async function loadTypePartConfig(
  db: Db,
  input: { partTypeId: Uuid; at: Instant; contractServiceId?: Uuid | null },
): Promise<TypePartConfig> {
  const cut = await db.one<{ params: CutParams }>(
    `SELECT rv.params
     FROM config.rule_versions rv
     JOIN config.rule_definitions rd ON rd.id = rv.rule_definition_id
     LEFT JOIN config.rule_scopes rs ON rs.rule_version_id = rv.id
     WHERE rd.rule_type = 'PART_TYPE_CUT'
       AND rv.status = 'PUBLISHED'
       AND rv.valid_from <= $2::timestamptz
       AND (rv.valid_until IS NULL OR rv.valid_until > $2::timestamptz)
       AND (rs.part_type_id IS NULL OR rs.part_type_id = $1)
       AND (rs.contract_service_id IS NULL OR rs.contract_service_id = $3::uuid)
     ORDER BY ${SPECIFICITY}, rv.valid_from DESC
     LIMIT 1`,
    [input.partTypeId, input.at, input.contractServiceId ?? null],
  );

  const shift = await db.one<{ params: ShiftParams }>(
    `SELECT rv.params
     FROM config.rule_versions rv
     JOIN config.rule_definitions rd ON rd.id = rv.rule_definition_id
     LEFT JOIN config.rule_scopes rs ON rs.rule_version_id = rv.id
     WHERE rd.rule_type = 'SHIFT_BOUNDARY'
       AND rv.status = 'PUBLISHED'
       AND rv.valid_from <= $2::timestamptz
       AND (rv.valid_until IS NULL OR rv.valid_until > $2::timestamptz)
       AND (rs.part_type_id IS NULL OR rs.part_type_id = $1)
       AND (rs.contract_service_id IS NULL OR rs.contract_service_id = $3::uuid)
     ORDER BY ${SPECIFICITY}, rv.valid_from DESC
     LIMIT 1`,
    [input.partTypeId, input.at, input.contractServiceId ?? null],
  );

  // Spread only the keys that are actually present. An explicit `undefined` would still be an own
  // property, and `'shiftCutsPart' in config` is the difference between "configured as false" and
  // "not configured" everywhere downstream.
  const config: Record<string, unknown> = {};
  const params = cut?.params ?? {};
  if (params.shiftCutsPart !== undefined) config['shiftCutsPart'] = params.shiftCutsPart;
  if (params.locationCutsPart !== undefined) config['locationCutsPart'] = params.locationCutsPart;
  if (params.clientCutsPart !== undefined) config['clientCutsPart'] = params.clientCutsPart;
  if (params.transportContinuity !== undefined) {
    config['transportContinuity'] = params.transportContinuity;
  }
  if (shift?.params.boundary !== undefined) config['shiftBoundary'] = shift.params.boundary;
  return config as TypePartConfig;
}

export interface LoadedBehavior {
  readonly behavior: TypePartBehavior;
  readonly config: TypePartConfig;
  readonly partTypeId: Uuid;
  readonly partTypeCode: string;
}

/** The strategy for a part type id, with its configuration at an instant. */
export async function loadBehaviorByPartTypeId(
  db: Db,
  partTypeId: Uuid,
  at: Instant,
  contractServiceId?: Uuid | null,
): Promise<LoadedBehavior> {
  const row = await db.one<{ code: string }>('SELECT code FROM config.part_types WHERE id = $1', [
    partTypeId,
  ]);
  if (!row) {
    throw new DomainError({ code: 'NOT_FOUND', message: `No existe el TipoParte ${partTypeId}.` });
  }
  if (!isTypePartId(row.code)) {
    // A fourth pattern in the catalogue without a strategy is a configuration error, not something
    // to approximate with the nearest one (GS-056).
    throw new DomainError({
      code: 'PENDING_CONFIGURATION',
      message:
        `El TipoParte ${row.code} existe en el catálogo pero no tiene una estrategia implementada. ` +
        'Un cuarto patrón requiere Change Control antes de poder operar.',
    });
  }
  return {
    behavior: behaviorFor(row.code),
    config: await loadTypePartConfig(db, { partTypeId, at, ...(contractServiceId !== undefined ? { contractServiceId } : {}) }),
    partTypeId,
    partTypeCode: row.code,
  };
}

/** The strategy for an existing Parte. */
export async function loadBehaviorForPart(
  db: Db,
  partId: string,
  at: Instant,
): Promise<LoadedBehavior> {
  const row = await db.one<{ part_type_id: Uuid }>(
    'SELECT part_type_id FROM execution.parts WHERE id = $1',
    [partId],
  );
  if (!row) {
    throw new DomainError({ code: 'NOT_FOUND', message: `No existe el Parte ${partId}.` });
  }
  return loadBehaviorByPartTypeId(db, row.part_type_id, at);
}

/**
 * Build the normalised context a routing decision needs.
 *
 * Everything here is read from the plan and the catalogue, never from a payload field a client could
 * set: C-006 forbids a free TipoParte selector as the normal path, so the only "hint" is what an
 * approved assignment declared.
 */
export async function buildRoutingContext(
  db: Db,
  input: { plannedAssignmentId?: string; isEmergent: boolean; at: Instant },
): Promise<{ context: NormalizedContext; result: RoutingResult }> {
  let hint: TypePartId | undefined;
  let partTypeId: Uuid | null = null;
  let serviceCode: string | undefined;
  let principalResourceType: string | undefined;
  let locationCount = 0;
  let hasOriginAndDestination = false;
  let hasCrew = false;
  let contractServiceId: Uuid | null = null;

  if (input.plannedAssignmentId) {
    const row = await db.one<{
      part_type_id: Uuid | null;
      part_type_code: string | null;
      crew_id: Uuid | null;
      resource_type: string | null;
      service_code: string | null;
      contract_service_id: Uuid | null;
      location_count: string;
      role_count: string;
    }>(
      `SELECT a.expected_part_type_id AS part_type_id, pt.code AS part_type_code, a.crew_id,
              rt.code AS resource_type,
              (SELECT s.code FROM planning.planned_units pu2
                 JOIN config.services s ON s.id = pu2.service_id
                WHERE pu2.planned_assignment_id = a.id LIMIT 1) AS service_code,
              (SELECT pu3.contract_service_id FROM planning.planned_units pu3
                WHERE pu3.planned_assignment_id = a.id AND pu3.contract_service_id IS NOT NULL
                LIMIT 1) AS contract_service_id,
              (SELECT count(DISTINCT pu4.technical_location_id)::text
                 FROM planning.planned_units pu4
                WHERE pu4.planned_assignment_id = a.id
                  AND pu4.technical_location_id IS NOT NULL) AS location_count,
              -- Origin and destination are LOCATION ROLES on the planned resources, which is how a
              -- transport scope declares a trip rather than a place.
              (SELECT count(*)::text FROM planning.planned_resource_assignments pra
                WHERE pra.planned_assignment_id = a.id
                  AND pra.role IN ('ORIGEN', 'DESTINO')) AS role_count
       FROM planning.planned_assignments a
       LEFT JOIN config.part_types pt ON pt.id = a.expected_part_type_id
       LEFT JOIN config.resources r ON r.id = a.resource_id
       LEFT JOIN config.resource_types rt ON rt.id = r.resource_type_id
       WHERE a.id = $1`,
      [input.plannedAssignmentId],
    );
    if (row) {
      partTypeId = row.part_type_id;
      if (row.part_type_code && isTypePartId(row.part_type_code)) hint = row.part_type_code;
      if (row.service_code) serviceCode = row.service_code;
      if (row.resource_type) principalResourceType = row.resource_type;
      locationCount = Number(row.location_count);
      hasOriginAndDestination = Number(row.role_count) >= 2 || locationCount >= 2;
      hasCrew = row.crew_id !== null;
      contractServiceId = row.contract_service_id;
    }
  }

  // The configuration is read for the hinted pattern when there is one, because a routing question
  // like "is the shift boundary configured?" is only answerable per pattern.
  const config =
    partTypeId !== null
      ? await loadTypePartConfig(db, { partTypeId, at: input.at, contractServiceId })
      : {};

  const context: NormalizedContext = {
    ...(hint ? { partTypeHint: hint } : {}),
    ...(input.plannedAssignmentId ? { plannedAssignmentId: input.plannedAssignmentId } : {}),
    ...(serviceCode ? { serviceCode } : {}),
    ...(principalResourceType ? { principalResourceType } : {}),
    plannedLocationCount: locationCount,
    hasOriginAndDestination,
    hasCrew,
    isEmergent: input.isEmergent,
    config,
  };

  return { context, result: routeContext(context) };
}

/** Which components the configuration attached to a part type, with their required flag. */
export async function loadConfiguredComponents(
  db: Db,
  partTypeId: Uuid,
  at: Instant,
): Promise<readonly { code: string; required: boolean }[]> {
  const { rows } = await db.query<{ code: string; is_required: boolean }>(
    `SELECT pc.code, ptc.is_required
     FROM config.part_type_components ptc
     JOIN config.part_components pc ON pc.id = ptc.part_component_id
     WHERE ptc.part_type_id = $1
       AND ptc.valid_from <= $2::timestamptz
       AND (ptc.valid_until IS NULL OR ptc.valid_until > $2::timestamptz)
     ORDER BY pc.code`,
    [partTypeId, at],
  );
  return rows.map((r) => ({ code: r.code, required: r.is_required }));
}
