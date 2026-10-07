/**
 * Sign-in.
 *
 * A session token, not a role selector. The prototype's `demo` action set `S.user` and the shell
 * branched on it; 13 is explicit that no frontend role selector is equivalent to a productive login.
 * So this exchanges a token for a server-resolved actor, and the rail is built from what the server
 * reports rather than from a client-side choice.
 *
 * In development the token is a session id created by the seed. The corporate provider arrives behind
 * IdentityPort and nothing above this component changes.
 */
import { useState, type JSX } from 'react';
import { ApiError, fetchCommands, setSession } from '../api/client.ts';

export interface SignInProps {
  readonly onSignedIn: (actor: { displayName: string; capabilities: readonly string[] }) => void;
}

export function SignIn({ onSignedIn }: SignInProps): JSX.Element {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <main className="vds-signin">
      <form
        className="vds-signin__card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          setSession(token.trim());
          try {
            // /commands reports which capabilities this actor actually holds, so the rail reflects the
            // server's answer. It is still visibility only: every call is authorised server-side.
            const result = await fetchCommands();
            const capabilities = [
              ...new Set(result.data.filter((c) => c.allowedForActor).map((c) => c.capability)),
            ];
            onSignedIn({ displayName: 'Sesión activa', capabilities });
          } catch (cause) {
            setSession(null);
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
        }}
      >
        <h1>VDS Partes</h1>
        <p className="vds-signin__note">
          Entorno de desarrollo: el identificador de sesión lo crea el seed. El proveedor corporativo
          se conecta detrás de IdentityPort sin cambiar esta pantalla.
        </p>
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
        {error && (
          <p className="vds-signin__error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="vds-button vds-button--primary"
          disabled={busy || token.trim() === ''}
        >
          {busy ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
