/**
 * Sign-in.
 *
 * Product Baseline: the primary personas are Administrador, Planner, Operador, Validador VDS and
 * Cliente. Technical roles remain available for development, but they are secondary and do not
 * redefine the product's main personas.
 *
 * Authorization is still fully server-side. Selecting a DEV identity only creates a normal
 * platform.sessions row; /me resolves its real roles/capabilities before the shell is rendered.
 */
import { useEffect, useMemo, useState, type JSX } from 'react';
import {
  ApiError,
  createDevSession,
  fetchDevIdentities,
  fetchSessionActor,
  setSession,
  type DevIdentity,
} from '../api/client.ts';
import {
  isPrimaryProductRole,
  productProfileForRoles,
  profileDescription,
  profileLabel,
} from './productProfile.ts';

export interface SignInProps {
  readonly onSignedIn: (actor: {
    displayName: string;
    roles: readonly string[];
    capabilities: readonly string[];
  }) => void;
}

export function SignIn({ onSignedIn }: SignInProps): JSX.Element {
  const [token, setToken] = useState('');
  const [identities, setIdentities] = useState<readonly DevIdentity[]>([]);
  const [devAvailable, setDevAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const primaryIdentities = useMemo(() => {
    const order = ['admin', 'planner', 'field', 'review', 'client'];
    return identities
      .filter((identity) => identity.roles.some(isPrimaryProductRole))
      .slice()
      .sort(
        (a, b) =>
          order.indexOf(productProfileForRoles(a.roles)) -
          order.indexOf(productProfileForRoles(b.roles)),
      );
  }, [identities]);
  const technicalIdentities = useMemo(
    () => identities.filter((identity) => !identity.roles.some(isPrimaryProductRole)),
    [identities],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchDevIdentities()
      .then((result) => {
        if (cancelled) return;
        setIdentities(result.data);
        setDevAvailable(true);
      })
      .catch(() => {
        // Expected when devAuth is disabled (for example production).
        if (!cancelled) setDevAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function finishSignIn(sessionId: string): Promise<void> {
    setSession(sessionId);
    try {
      const actor = await fetchSessionActor();
      onSignedIn({
        displayName: actor.data.displayName,
        roles: actor.data.roles,
        capabilities: actor.data.capabilities,
      });
    } catch (cause) {
      setSession(null);
      throw cause;
    }
  }

  async function signInWithIdentity(identity: DevIdentity): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const session = await createDevSession(identity.identityId);
      await finishSignIn(session.data.sessionId);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'No se pudo crear la sesión de desarrollo.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function signInWithToken(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await finishSignIn(token.trim());
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'UNAUTHENTICATED'
          ? 'Sesión inválida, expirada o revocada.'
          : cause instanceof ApiError
            ? cause.message
            : 'No se pudo iniciar sesión.',
      );
    } finally {
      setBusy(false);
    }
  }

  const identityButton = (identity: DevIdentity) => (
    <button
      key={identity.identityId}
      type="button"
      className="vds-signin__identity"
      disabled={busy}
      onClick={() => void signInWithIdentity(identity)}
    >
      <span>
        <strong>{identity.displayName}</strong>
        <small>{profileDescription(identity.roles)}</small>
      </span>
      <span className="vds-signin__roles">{profileLabel(identity.roles)}</span>
    </button>
  );

  return (
    <main className="vds-signin">
      <section className="vds-signin__card" aria-labelledby="signin-title">
        <h1 id="signin-title">VDS Partes</h1>

        {devAvailable && (
          <>
            <div className="vds-signin__dev-banner">
              <strong>DEV · PRODUCT BASELINE</strong>
              <span>Elegí uno de los cinco perfiles principales de la aplicación.</span>
            </div>

            <div className="vds-signin__identities" aria-label="Perfiles principales">
              {primaryIdentities.map(identityButton)}
            </div>

            {technicalIdentities.length > 0 && (
              <details className="vds-signin__technical">
                <summary>Perfiles técnicos de prueba</summary>
                <p className="vds-signin__note">
                  Existen para probar capabilities especializadas. No forman parte de las cinco
                  personas principales definidas por la Product Baseline.
                </p>
                <div className="vds-signin__identities">
                  {technicalIdentities.map(identityButton)}
                </div>
              </details>
            )}
          </>
        )}

        {!devAvailable && (
          <p className="vds-signin__note">
            Ingresá una sesión válida. El proveedor corporativo se conecta detrás de IdentityPort.
          </p>
        )}

        <details className="vds-signin__manual" open={!devAvailable}>
          <summary>Ingresar session UUID manualmente</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void signInWithToken();
            }}
          >
            <label htmlFor="token">Identificador de sesión</label>
            <input
              id="token"
              className="vds-input vds-numeric"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <button
              type="submit"
              className="vds-button vds-button--primary"
              disabled={busy || token.trim() === ''}
            >
              {busy ? 'Verificando…' : 'Entrar'}
            </button>
          </form>
        </details>

        {error && (
          <p className="vds-signin__error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
