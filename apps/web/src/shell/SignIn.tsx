/**
 * Sign-in.
 *
 * Production authentication remains session based and server resolved.
 * In local development, the API exposes fixture identities and mints an ordinary platform.sessions
 * row for the selected identity. This is convenience only: every subsequent request still passes
 * through resolveActor(), scopes and capability checks.
 */
import { useEffect, useState, type JSX } from 'react';
import {
  ApiError,
  createDevSession,
  fetchCommands,
  fetchDevIdentities,
  setSession,
  type DevIdentity,
} from '../api/client.ts';

export interface SignInProps {
  readonly onSignedIn: (actor: { displayName: string; capabilities: readonly string[] }) => void;
}

export function SignIn({ onSignedIn }: SignInProps): JSX.Element {
  const [token, setToken] = useState('');
  const [identities, setIdentities] = useState<readonly DevIdentity[]>([]);
  const [devAvailable, setDevAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function finishSignIn(sessionId: string, displayName: string): Promise<void> {
    setSession(sessionId);
    try {
      const result = await fetchCommands();
      const capabilities = [
        ...new Set(result.data.filter((c) => c.allowedForActor).map((c) => c.capability)),
      ];
      onSignedIn({ displayName, capabilities });
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
      await finishSignIn(session.data.sessionId, session.data.displayName);
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
      await finishSignIn(token.trim(), 'Sesión activa');
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

  return (
    <main className="vds-signin">
      <section className="vds-signin__card" aria-labelledby="signin-title">
        <h1 id="signin-title">VDS Partes</h1>

        {devAvailable && (
          <>
            <div className="vds-signin__dev-banner">
              <strong>DEV · FIXTURE_TEST</strong>
              <span>Elegí una identidad seed para recorrer la aplicación local.</span>
            </div>

            <div className="vds-signin__identities" aria-label="Identidades de desarrollo">
              {identities.map((identity) => (
                <button
                  key={identity.identityId}
                  type="button"
                  className="vds-signin__identity"
                  disabled={busy}
                  onClick={() => void signInWithIdentity(identity)}
                >
                  <span>
                    <strong>{identity.displayName}</strong>
                    <small>{identity.subjectRef}</small>
                  </span>
                  <span className="vds-signin__roles">
                    {identity.roles.length > 0 ? identity.roles.join(' · ') : 'sin rol'}
                  </span>
                </button>
              ))}
            </div>
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
