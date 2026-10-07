import { useEffect, useState, type JSX } from 'react';
import { AppShell, type SurfaceId } from './shell/AppShell.tsx';
import { SignIn } from './shell/SignIn.tsx';
import { MyDay } from './modules/field/MyDay.tsx';
import { Timeline } from './modules/planning/Timeline.tsx';
import { Trace } from './modules/trace/Trace.tsx';
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
      {surface === 'planning.timeline' && <Timeline />}
      {surface === 'execution.parts' && <MyDay />}
      {surface === 'trace' && <Trace />}
    </AppShell>
  );
}
