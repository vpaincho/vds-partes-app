/**
 * Temporal conflict detection.
 *
 * This file exists because of PL-093 / RGT-01. `clashes()` in the prototype was:
 *
 *     const clashes = t => S.trabajos.filter(o => o !== t && o.rec === t.rec && …)
 *
 * It excluded the subject under test by **object reference**. Evaluating a *proposal* — a copy of a
 * job with a longer window, which is exactly what an extension request is — produced an object that
 * was not `===` the original, so the original was included in the comparison and the job conflicted
 * with itself. The operator saw "se superpone con PL-093" about PL-093.
 *
 * Three rules follow from that, and all three are enforced here rather than left to each caller:
 *
 *  1. **Exclusion is by stable id**, never by reference. A proposal declares which aggregate it is a
 *     proposal *for*, and that aggregate is excluded regardless of object identity.
 *  2. **The proposed interval is compared against incumbents, not against itself.** A candidate is a
 *     window, not a row; it may not even be persisted yet.
 *  3. **An overlap is not automatically a conflict.** C-012 and RUL-027 are explicit: shared support
 *     resources can legitimately overlap, so detection reports pairs and the configured rule decides
 *     BLOCK, WARN or ALLOWED. There is no universal exclusivity.
 *
 * The database also refuses to store a self-conflict (`temporal_conflicts_not_self`), so if a future
 * detector forgets rule 1, the write fails instead of the bug reappearing silently.
 */
import { findOverlaps, overlapMinutes, type Instant } from '@vds/kernel';
import type { Db } from './db.ts';

export type SubjectKind = 'PERSON' | 'RESOURCE';

/** What is being proposed: a window for a subject, on behalf of some aggregate. */
export interface ConflictCandidate {
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly from: Instant;
  readonly until: Instant;
  /**
   * The aggregate this candidate belongs to, excluded from its own comparison.
   *
   * For an extension request this is the id of the assignment being extended — the whole point of
   * RGT-01. `null` means a genuinely new aggregate with nothing to exclude.
   */
  readonly aggregateKind: 'PLANNED_ASSIGNMENT' | 'EXECUTION_UNIT' | 'PART';
  readonly aggregateId: string | null;
}

export interface Incumbent {
  readonly aggregateKind: 'PLANNED_ASSIGNMENT' | 'EXECUTION_UNIT';
  readonly aggregateId: string;
  readonly code: string | null;
  readonly from: Instant;
  readonly until: Instant | null;
  /** The role the subject holds there, which is what decides whether exclusivity applies. */
  readonly role: string | null;
}

export type Verdict = 'BLOCK' | 'WARN' | 'ALLOWED';

export interface ConflictFinding {
  readonly candidate: ConflictCandidate;
  readonly incumbent: Incumbent;
  readonly overlapFrom: Instant;
  readonly overlapUntil: Instant;
  readonly overlapMinutes: number;
  readonly verdict: Verdict;
  readonly ruleId: string;
  readonly reason: string;
}

/**
 * The configured exclusivity rule for a subject in a role.
 *
 * Resolved from `config.rule_versions` with `rule_type = 'OVERLAP'`. Until a context configures one,
 * the default is **not** exclusive: RUL-027 says "no todo recurso de apoyo es exclusivo", and
 * defaulting to BLOCK would invent a universal rule the baseline forbids.
 */
export interface OverlapPolicy {
  readonly verdict: Verdict;
  readonly ruleId: string;
  readonly ruleVersionId: string | null;
  readonly basis: string;
}

const DEFAULT_POLICY: OverlapPolicy = {
  verdict: 'WARN',
  ruleId: 'RUL-027',
  ruleVersionId: null,
  basis:
    'Sin ReglaSolapamiento configurada para este rol/contexto. El default no es exclusivo: se ' +
    'reporta el solapamiento sin bloquear, porque C-012 y RUL-027 prohíben una exclusividad ' +
    'universal. Configurar una regla OVERLAP para que bloquee.',
};

/** Resolve the overlap policy for a subject kind and role at a moment. */
export async function resolveOverlapPolicy(
  db: Db,
  input: { subjectKind: SubjectKind; role: string | null; at: Instant },
): Promise<OverlapPolicy> {
  const row = await db.one<{
    id: string;
    effect: string;
    params: { exclusiveRoles?: string[]; verdict?: Verdict };
    canonical_rule_id: string | null;
    scope_level: string | null;
  }>(
    `SELECT rv.id, rv.effect, rv.params, rd.canonical_rule_id, rs.scope_level
     FROM config.rule_versions rv
     JOIN config.rule_definitions rd ON rd.id = rv.rule_definition_id
     LEFT JOIN config.rule_scopes rs ON rs.rule_version_id = rv.id
     WHERE rd.rule_type = 'OVERLAP'
       AND rv.status = 'PUBLISHED'
       AND rv.valid_from <= $1::timestamptz
       AND (rv.valid_until IS NULL OR rv.valid_until > $1::timestamptz)
     -- Specificity: a scoped rule beats a global one (sheet 58 step 3).
     ORDER BY
       CASE rs.scope_level
         WHEN 'ITEM' THEN 1 WHEN 'CONTRACT_SERVICE' THEN 2 WHEN 'CLIENT' THEN 3
         WHEN 'SERVICE' THEN 4 WHEN 'PART_TYPE' THEN 5 ELSE 6
       END,
       rv.valid_from DESC
     LIMIT 1`,
    [input.at],
  );

  if (!row) return DEFAULT_POLICY;

  // The rule names which roles are exclusive. A role outside that list is not exclusive, even
  // though a rule exists.
  const exclusiveRoles = row.params.exclusiveRoles ?? [];
  const roleIsExclusive = input.role !== null && exclusiveRoles.includes(input.role);

  if (!roleIsExclusive) {
    return {
      verdict: 'WARN',
      ruleId: row.canonical_rule_id ?? 'RUL-027',
      ruleVersionId: row.id,
      basis:
        `La regla configurada marca como exclusivos ${exclusiveRoles.join(', ') || 'ningún rol'}, ` +
        `y el rol ${input.role ?? 'sin rol'} no está entre ellos.`,
    };
  }

  return {
    verdict: (row.params.verdict ?? (row.effect === 'BLOCK' ? 'BLOCK' : 'WARN')) as Verdict,
    ruleId: row.canonical_rule_id ?? 'RUL-027',
    ruleVersionId: row.id,
    basis: `El rol ${input.role} está configurado como exclusivo por la regla vigente.`,
  };
}

/**
 * Find conflicts for a candidate window.
 *
 * `excludeAggregateId` is applied in SQL, so the subject under test cannot appear among its own
 * incumbents — the fix for PL-093. It is a parameter rather than a filter the caller applies
 * afterwards, because an afterwards-filter is exactly what gets forgotten.
 */
export async function detectConflicts(
  db: Db,
  candidate: ConflictCandidate,
): Promise<readonly ConflictFinding[]> {
  const incumbents = await loadIncumbents(db, candidate);

  // Defensive: the SQL already excludes it, and the DB refuses to store a self-conflict. Asserting
  // here turns a future regression into a loud failure rather than a wrong answer.
  if (candidate.aggregateId !== null) {
    const selfIncluded = incumbents.some((i) => i.aggregateId === candidate.aggregateId);
    if (selfIncluded) {
      throw new Error(
        `Conflict detection included the subject under test (${candidate.aggregateId}) among its ` +
          'own incumbents. This is the PL-093 defect: exclusion must be by stable id, never by ' +
          'object reference, so that evaluating a proposal does not collide with its own original.',
      );
    }
  }

  const items = [
    { kind: 'candidate' as const, startedAt: candidate.from, endedAt: candidate.until },
    ...incumbents.map((i) => ({
      kind: 'incumbent' as const,
      incumbent: i,
      startedAt: i.from,
      endedAt: i.until,
    })),
  ];

  const overlaps = findOverlaps(items, (item) => ({
    startedAt: item.startedAt,
    endedAt: item.endedAt,
  }));

  const findings: ConflictFinding[] = [];
  for (const overlap of overlaps) {
    // Only pairs that involve the candidate matter here. Two incumbents overlapping each other is a
    // pre-existing fact, not something this proposal creates.
    const pair = [overlap.a, overlap.b];
    const candidateSide = pair.find((p) => p.kind === 'candidate');
    const incumbentSide = pair.find((p) => p.kind === 'incumbent');
    if (!candidateSide || !incumbentSide || incumbentSide.kind !== 'incumbent') continue;

    const incumbent = incumbentSide.incumbent;
    const policy = await resolveOverlapPolicy(db, {
      subjectKind: candidate.subjectKind,
      role: incumbent.role,
      at: candidate.from,
    });

    const overlapFrom = (Date.parse(candidate.from) > Date.parse(incumbent.from)
      ? candidate.from
      : incumbent.from) as Instant;
    const incumbentEnd = incumbent.until ?? candidate.until;
    const overlapUntil = (Date.parse(candidate.until) < Date.parse(incumbentEnd)
      ? candidate.until
      : incumbentEnd) as Instant;

    findings.push({
      candidate,
      incumbent,
      overlapFrom,
      overlapUntil,
      overlapMinutes: Math.round(
        overlapMinutes(
          { startedAt: candidate.from, endedAt: candidate.until },
          { startedAt: incumbent.from, endedAt: incumbent.until },
        ),
      ),
      verdict: policy.verdict,
      ruleId: policy.ruleId,
      reason:
        `Se solapa con ${incumbent.code ?? incumbent.aggregateId} ` +
        `(${new Date(overlapFrom).toLocaleString('es-AR')} → ` +
        `${new Date(overlapUntil).toLocaleString('es-AR')}). ${policy.basis}`,
    });
  }

  return findings;
}

async function loadIncumbents(db: Db, candidate: ConflictCandidate): Promise<readonly Incumbent[]> {
  // Planned nominations for this subject, excluding the aggregate under test BY ID.
  const planned = await db.query<{
    aggregate_id: string;
    code: string | null;
    from: Date;
    until: Date | null;
    role: string | null;
  }>(
    candidate.subjectKind === 'PERSON'
      ? `SELECT a.id AS aggregate_id, a.code,
                coalesce(p.planned_from, a.window_start) AS from,
                coalesce(p.planned_until, a.window_end) AS until,
                p.role
         FROM planning.planned_person_assignments p
         JOIN planning.planned_assignments a
           ON a.id = coalesce(p.planned_assignment_id,
                              (SELECT planned_assignment_id FROM planning.planned_units
                               WHERE id = p.planned_unit_id))
         WHERE p.person_id = $1
           -- Terminal intentions do not compete for the subject any more.
           AND a.state NOT IN ('CANCELADA', 'SUPERSEDIDA', 'NO_REALIZADA')
           -- RGT-01: exclude the aggregate under test by stable id.
           AND ($2::uuid IS NULL OR a.id <> $2::uuid)
           AND tstzrange(coalesce(p.planned_from, a.window_start),
                         coalesce(p.planned_until, a.window_end), '[)')
               && tstzrange($3::timestamptz, $4::timestamptz, '[)')`
      : `SELECT a.id AS aggregate_id, a.code,
                coalesce(p.planned_from, a.window_start) AS from,
                coalesce(p.planned_until, a.window_end) AS until,
                p.role
         FROM planning.planned_resource_assignments p
         JOIN planning.planned_assignments a
           ON a.id = coalesce(p.planned_assignment_id,
                              (SELECT planned_assignment_id FROM planning.planned_units
                               WHERE id = p.planned_unit_id))
         WHERE p.resource_id = $1
           AND a.state NOT IN ('CANCELADA', 'SUPERSEDIDA', 'NO_REALIZADA')
           AND ($2::uuid IS NULL OR a.id <> $2::uuid)
           AND tstzrange(coalesce(p.planned_from, a.window_start),
                         coalesce(p.planned_until, a.window_end), '[)')
               && tstzrange($3::timestamptz, $4::timestamptz, '[)')`,
    [
      candidate.subjectId,
      candidate.aggregateKind === 'PLANNED_ASSIGNMENT' ? candidate.aggregateId : null,
      candidate.from,
      candidate.until,
    ],
  );

  // Real participation. An actual interval competes for a person just as a nomination does, and
  // 07 requires the conflict to be computed over both.
  const actual = await db.query<{
    aggregate_id: string;
    code: string | null;
    from: Date;
    until: Date | null;
    role: string | null;
  }>(
    candidate.subjectKind === 'PERSON'
      ? `SELECT coalesce(a.execution_unit_id, a.part_id) AS aggregate_id,
                u.code, a.started_at AS from, a.ended_at AS until, a.role
         FROM execution.person_execution_assignments a
         LEFT JOIN execution.execution_units u ON u.id = a.execution_unit_id
         WHERE a.person_id = $1
           AND ($2::uuid IS NULL OR coalesce(a.execution_unit_id, a.part_id) <> $2::uuid)
           AND tstzrange(a.started_at, a.ended_at, '[)')
               && tstzrange($3::timestamptz, $4::timestamptz, '[)')`
      : `SELECT coalesce(a.execution_unit_id, a.part_id) AS aggregate_id,
                u.code, a.started_at AS from, a.ended_at AS until, a.role
         FROM execution.resource_execution_assignments a
         LEFT JOIN execution.execution_units u ON u.id = a.execution_unit_id
         WHERE a.resource_id = $1
           AND ($2::uuid IS NULL OR coalesce(a.execution_unit_id, a.part_id) <> $2::uuid)
           AND tstzrange(a.started_at, a.ended_at, '[)')
               && tstzrange($3::timestamptz, $4::timestamptz, '[)')`,
    [
      candidate.subjectId,
      candidate.aggregateKind === 'PLANNED_ASSIGNMENT' ? null : candidate.aggregateId,
      candidate.from,
      candidate.until,
    ],
  );

  return [
    ...planned.rows.map((r) => ({
      aggregateKind: 'PLANNED_ASSIGNMENT' as const,
      aggregateId: r.aggregate_id,
      code: r.code,
      from: r.from.toISOString() as Instant,
      until: r.until === null ? null : (r.until.toISOString() as Instant),
      role: r.role,
    })),
    ...actual.rows.map((r) => ({
      aggregateKind: 'EXECUTION_UNIT' as const,
      aggregateId: r.aggregate_id,
      code: r.code,
      from: r.from.toISOString() as Instant,
      until: r.until === null ? null : (r.until.toISOString() as Instant),
      role: r.role,
    })),
  ];
}

/** Persist the findings so a decision can be reviewed and resolved later (C-012). */
export async function recordConflicts(
  db: Db,
  findings: readonly ConflictFinding[],
  decisionTraceId: string | null,
): Promise<void> {
  const { uuidv7 } = await import('@vds/kernel');
  for (const finding of findings) {
    await db.query(
      `INSERT INTO planning.temporal_conflicts
         (id, subject_kind, person_id, resource_id, candidate_kind, candidate_id,
          incumbent_kind, incumbent_id, overlap_from, overlap_until, overlap_minutes,
          verdict, rule_id, decision_trace_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        uuidv7(),
        finding.candidate.subjectKind,
        finding.candidate.subjectKind === 'PERSON' ? finding.candidate.subjectId : null,
        finding.candidate.subjectKind === 'RESOURCE' ? finding.candidate.subjectId : null,
        finding.candidate.aggregateKind,
        // A candidate with no id yet is recorded against the incumbent it would have hit; the DB
        // constraint still guarantees the two sides differ.
        finding.candidate.aggregateId ?? finding.incumbent.aggregateId,
        finding.incumbent.aggregateKind,
        finding.incumbent.aggregateId,
        finding.overlapFrom,
        finding.overlapUntil,
        finding.overlapMinutes,
        finding.verdict,
        finding.ruleId,
        decisionTraceId,
      ],
    );
  }
}
