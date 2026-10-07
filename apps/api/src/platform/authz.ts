/**
 * Authorization. Server-side, on every call, default deny.
 *
 * 13_AUTH_PERMISSIONS is unambiguous: "Verificar sesión, scope empresa/base/contrato, acción,
 * objeto y propiedad en **cada API**, lecturas/downloads/pull sync incluidos. Default deny;
 * resolver actor en servidor." The prototype filtered menus and data client-side, which is UX, not
 * authorization — `shell()` decided what to show and nothing decided what was allowed.
 *
 * Three checks, in order, because they fail for different reasons and the caller needs to know which:
 *
 *   1. session   — is there a live, unrevoked, unexpired session?        → UNAUTHENTICATED
 *   2. capability— does any active grant carry the required capability?  → FORBIDDEN_SCOPE
 *   3. scope     — does a grant cover this object's company/base/contract? → FORBIDDEN_SCOPE
 *
 * Step 3 is the one that stops RGT-15 (client A asking for client B's object). It is applied to
 * reads and downloads too, which is why `assertScope` takes the object's owning references rather
 * than trusting a query filter the caller supplied.
 */
import { DomainError, forbiddenScope, type Instant, type Uuid } from '@vds/kernel';
import type { Db } from './db.ts';

export interface SessionGrant {
  readonly scopeId: Uuid;
  readonly roleId: string;
  readonly companyId: Uuid | null;
  readonly baseId: Uuid | null;
  readonly contractId: Uuid | null;
  readonly capabilities: readonly string[];
}

export interface AuthenticatedActor {
  readonly identityId: Uuid;
  readonly sessionId: Uuid;
  readonly deviceId: Uuid | null;
  readonly displayName: string;
  readonly personId: Uuid | null;
  readonly grants: readonly SessionGrant[];
  /** Union of capabilities across grants, for cheap UX lookups. Never used for enforcement. */
  readonly capabilities: readonly string[];
}

/**
 * Resolve the actor from a session token. The actor is NEVER taken from the request body.
 *
 * Returns null when there is no usable session, so the caller raises UNAUTHENTICATED rather than
 * this function inventing an anonymous actor.
 */
export async function resolveActor(db: Db, sessionId: string): Promise<AuthenticatedActor | null> {
  const session = await db.one<{
    session_id: Uuid;
    identity_id: Uuid;
    device_id: Uuid | null;
    display_name: string;
    person_id: Uuid | null;
  }>(
    `SELECT s.id AS session_id, s.identity_id, s.device_id, i.display_name, i.person_id
     FROM platform.sessions s
     JOIN platform.identities i ON i.id = s.identity_id
     WHERE s.id = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
       AND i.is_active = true`,
    [sessionId],
  );
  if (!session) return null;

  // Grants are resolved fresh on every request. A revocation takes effect immediately for an
  // online caller; what an offline device already did is reconciled separately (RGT-11).
  const { rows } = await db.query<{
    scope_id: Uuid;
    role_id: string;
    company_id: Uuid | null;
    base_id: Uuid | null;
    contract_id: Uuid | null;
    capabilities: string[];
  }>(
    `SELECT sc.id AS scope_id, sc.role_id, sc.company_id, sc.base_id, sc.contract_id,
            coalesce(array_agg(rc.capability_id) FILTER (WHERE rc.capability_id IS NOT NULL), '{}')
              AS capabilities
     FROM platform.identity_scopes sc
     LEFT JOIN platform.role_capabilities rc ON rc.role_id = sc.role_id
     WHERE sc.identity_id = $1
       AND sc.valid_from <= now()
       AND (sc.valid_until IS NULL OR sc.valid_until > now())
     GROUP BY sc.id, sc.role_id, sc.company_id, sc.base_id, sc.contract_id`,
    [session.identity_id],
  );

  const grants: SessionGrant[] = rows.map((r) => ({
    scopeId: r.scope_id,
    roleId: r.role_id,
    companyId: r.company_id,
    baseId: r.base_id,
    contractId: r.contract_id,
    capabilities: r.capabilities,
  }));

  return {
    identityId: session.identity_id,
    sessionId: session.session_id,
    deviceId: session.device_id,
    displayName: session.display_name,
    personId: session.person_id,
    grants,
    capabilities: [...new Set(grants.flatMap((g) => g.capabilities))],
  };
}

/** The ownership references of the object being acted on. */
export interface ObjectScope {
  readonly companyId?: Uuid | null;
  readonly baseId?: Uuid | null;
  readonly contractId?: Uuid | null;
}

/**
 * Does this grant cover that object?
 *
 * A null dimension on the grant means "any value of this dimension" — a company-wide planner has
 * `baseId: null`. A null dimension on the *object* means it is not scoped that way.
 *
 * The asymmetry matters: a grant scoped to contract X must NOT cover an object with no contract,
 * because that would let a contract-scoped client reach unscoped data.
 */
function grantCovers(grant: SessionGrant, scope: ObjectScope): boolean {
  const dimensions: readonly [Uuid | null, Uuid | null | undefined][] = [
    [grant.companyId, scope.companyId],
    [grant.baseId, scope.baseId],
    [grant.contractId, scope.contractId],
  ];

  for (const [granted, required] of dimensions) {
    if (granted === null) continue; // the grant does not restrict this dimension
    if (required === undefined || required === null) return false; // grant is narrower than the object
    if (granted !== required) return false;
  }
  return true;
}

/**
 * Assert the actor may perform `capability` on an object with `scope`.
 *
 * Returns the grant that authorised it, which the pipeline records as the receipt's `scope_id` —
 * so idempotency is keyed to the authorisation under which the command was accepted, not to a
 * global namespace.
 */
export function assertAuthorised(
  actor: AuthenticatedActor,
  capability: string,
  scope: ObjectScope = {},
): SessionGrant {
  const withCapability = actor.grants.filter((g) => g.capabilities.includes(capability));

  if (withCapability.length === 0) {
    throw forbiddenScope(`ejecutar ${capability}`, {
      message:
        `La identidad no tiene la capability ${capability}. ` +
        `Capabilities activas: ${actor.capabilities.join(', ') || 'ninguna'}.`,
      ruleId: 'C-006',
    });
  }

  const covering = withCapability.find((g) => grantCovers(g, scope));
  if (!covering) {
    // Deliberately does not echo the object's ids back: a 403 that confirms which contract an id
    // belongs to is itself a leak (RGT-15).
    throw forbiddenScope(`operar sobre este objeto con ${capability}`, {
      message:
        'La capability existe pero ningún alcance activo cubre este objeto ' +
        '(empresa / base / contrato).',
    });
  }

  return covering;
}

/** True when any grant carries the capability, ignoring scope. For UX hints only. */
export const hasCapability = (actor: AuthenticatedActor, capability: string): boolean =>
  actor.capabilities.includes(capability);

/**
 * Contract ids this actor may read, for scoping a list query.
 *
 * `null` means unrestricted by contract. A caller that gets a list MUST apply this rather than
 * trusting a client-supplied filter — that is the difference between the prototype's `vDash`
 * filtering by `S.dop` and an authorization boundary.
 */
export function readableContractIds(
  actor: AuthenticatedActor,
  capability: string,
): readonly Uuid[] | null {
  const grants = actor.grants.filter((g) => g.capabilities.includes(capability));
  if (grants.length === 0) {
    throw forbiddenScope(`leer con ${capability}`, {
      message: `La identidad no tiene la capability ${capability}.`,
    });
  }
  if (grants.some((g) => g.contractId === null)) return null;
  return [...new Set(grants.map((g) => g.contractId as Uuid))];
}

/**
 * Contract scope for a read that several capabilities can legitimately open.
 *
 * The directive inbox is the case this exists for: a planner reaches it through `control.emit` and a
 * crew through `control.apply`, and inventing a `control.read` capability nobody is granted would
 * lock both out. The scope is still the union of the matching grants — widening *who* may read does
 * not widen *what* they may read.
 */
export function readableContractIdsAny(
  actor: AuthenticatedActor,
  capabilities: readonly string[],
): readonly Uuid[] | null {
  const grants = actor.grants.filter((g) => capabilities.some((c) => g.capabilities.includes(c)));
  if (grants.length === 0) {
    throw forbiddenScope(`leer con ${capabilities.join(' | ')}`, {
      message: `La identidad no tiene ninguna de las capabilities ${capabilities.join(', ')}.`,
    });
  }
  if (grants.some((g) => g.contractId === null)) return null;
  return [...new Set(grants.map((g) => g.contractId as Uuid))];
}

export const unauthenticated = (): DomainError =>
  new DomainError({
    code: 'UNAUTHENTICATED',
    message: 'Sesión inválida, expirada o revocada.',
    details: [
      {
        message:
          'El actor se resuelve en el servidor desde la sesión verificada. Ningún selector de rol ' +
          'del frontend equivale a un login (13_AUTH_PERMISSIONS).',
      },
    ],
  });

/** Record that a session was seen, so an idle timeout is measurable. */
export async function touchSession(db: Db, sessionId: Uuid, at: Instant): Promise<void> {
  await db.query('UPDATE platform.sessions SET last_seen_at = $2 WHERE id = $1', [sessionId, at]);
}
