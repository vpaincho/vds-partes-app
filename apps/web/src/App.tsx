import { useEffect, useState, type JSX } from 'react';
import { AppShell, type SurfaceId } from './shell/AppShell.tsx';
import { SignIn } from './shell/SignIn.tsx';
import { MyDay } from './modules/field/MyDay.tsx';
import { Planning } from './modules/planning/Planning.tsx';
import { Directives } from './modules/control/Directives.tsx';
import { Permits } from './modules/habilita/Permits.tsx';
import { HabilitaEvents } from './modules/habilita/Events.tsx';
import { Review } from './modules/review/Review.tsx';
import { Commercial } from './modules/commercial/Commercial.tsx';
import { Billing } from './modules/billing/Billing.tsx';
import { Dashboard } from './modules/dashboard/Dashboard.tsx';
import { Trace } from './modules/trace/Trace.tsx';
import { Config } from './modules/config/Config.tsx';
import { HabilitaDocumental } from './modules/habilita/Documental.tsx';
import { fetchCommands, hasSession, setSession, type CommandInfo } from './api/client.ts';

interface Actor {
  readonly displayName: string;
  readonly capabilities: readonly string[];
}

/**
 * Surface routing.
 *
 * 06 of the target product says not to impose a universal Home: a planner starts in Planning, field in
 * Mi Jornada, a reviewer in their queue. So the landing surface is derived from the actor's
 * capabilities rather than fixed.
 */
function landingSurface(capabilities: readonly string[]): SurfaceId {
  if (capabilities.includes('execution.start')) return 'field.my-day';
  if (capabilities.includes('planning.approve') || capabilities.includes('planning.dispatch')) {
    return 'planning.timeline';
  }
  if (capabilities.includes('review.decide')) return 'review.queue';
  if (capabilities.includes('commercial.client.read')) return 'dashboard';
  if (capabilities.includes('execution.read')) return 'execution.parts';
  return 'trace';
}

export function App(): JSX.Element {
  const [actor, setActor] = useState<Actor | null>(null);
  const [commands, setCommands] = useState<readonly CommandInfo[]>([]);
  const [surface, setSurface] = useState<SurfaceId>('field.my-day');
  // Set when another surface hands over to the trace, so "ver trazabilidad" lands on the subject
  // instead of an empty form. A decision that cannot be reached from the thing it affected is a
  // decision nobody will read.
  const [traceSubject, setTraceSubject] = useState<{ kind: string; id: string } | null>(null);

  const showTrace = (kind: string, id: string) => {
    setTraceSubject({ kind, id });
    setSurface('trace');
  };

  useEffect(() => {
    if (!actor || !hasSession()) return;
    void (async () => {
      const result = await fetchCommands();
      setCommands(result.data);
    })();
  }, [actor]);

  if (!actor) {
    return (
      <SignIn
        onSignedIn={(signedIn) => {
          setActor(signedIn);
          setSurface(landingSurface(signedIn.capabilities));
        }}
      />
    );
  }

  return (
    <AppShell
      actor={actor}
      commands={commands}
      current={surface}
      onNavigate={setSurface}
      onSignOut={() => {
        // The token lives in memory only, so signing out genuinely removes it (13: a shared tablet
        // must not leave a usable credential behind).
        setSession(null);
        setActor(null);
        setCommands([]);
      }}
      // Every provider is a fixture until W7 connects a real one, and the shell says so.
      fixtureProviders={['masters', 'identity', 'documentary', 'erp', 'weather', 'notification', 'files', 'client']}
    >
      {surface === 'field.my-day' && <MyDay />}
      {surface === 'planning.timeline' && (
        <Planning capabilities={actor.capabilities} onShowTrace={showTrace} />
      )}
      {surface === 'execution.parts' && <MyDay />}
      {surface === 'control.directives' && (
        <Directives capabilities={actor.capabilities} onShowTrace={showTrace} />
      )}
      {surface === 'habilita.permits' && (
        <Permits capabilities={actor.capabilities} onShowTrace={showTrace} />
      )}
      {surface === 'habilita.events' && <HabilitaEvents capabilities={actor.capabilities} />}
      {surface === 'review.queue' && <Review capabilities={actor.capabilities} />}
      {surface === 'commercial.queue' && <Commercial capabilities={actor.capabilities} />}
      {surface === 'billing.queue' && <Billing capabilities={actor.capabilities} />}
      {surface === 'dashboard' && <Dashboard capabilities={actor.capabilities} />}
      {surface === 'trace' && <Trace {...(traceSubject ? { subject: traceSubject } : {})} />}
      {surface === 'habilita.matrix' && <HabilitaDocumental />}
      {surface === 'config' && <Config />}
    </AppShell>
  );
}
