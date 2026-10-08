/**
 * The application shell.
 *
 * KEEP from the product baseline, per 01 and 15: navigation that differs by actor, a collapsible
 * rail, and visible identity and context. Those are the parts of the prototype that reflect how
 * people actually work, and 15 lists them as preserved surfaces.
 *
 * What changes is the basis of the navigation. `shell()` in the prototype branched on `S.user`, a
 * client-side role. Here the rail is built from the **capabilities the server reported**, and that is
 * presentation only — 13 is explicit that frontend visibility is UX and every call is authorised
 * server-side regardless of what the rail shows.
 *
 * The density tier is set per surface (DS-01 §5): field surfaces get touch targets and large rows,
 * planning gets an analytic density. Field never inherits analysis.
 */
import { useState, type JSX } from 'react';
import type { CommandInfo } from '../api/client.ts';

export type SurfaceId =
  | 'field.my-day'
  | 'planning.timeline'
  | 'execution.parts'
  | 'control.directives'
  | 'habilita.permits'
  | 'habilita.events'
  | 'habilita.matrix'
  | 'review.queue'
  | 'commercial.queue'
  | 'billing.queue'
  | 'dashboard'
  | 'config'
  | 'trace';

export interface Surface {
  readonly id: SurfaceId;
  readonly label: string;
  /** The capability that makes this surface worth showing. Visibility only. */
  readonly capability: string;
  /** DS-01 density tier. */
  readonly density: 'field' | 'operations' | 'analysis';
  readonly icon: string;
  /** Null when the surface is specified but not built yet, so the state is honest. */
  readonly status: 'built' | 'planned';
}

/**
 * Every surface of 02_TARGET_PRODUCT, with its real status.
 *
 * Listing the planned ones is deliberate. 02 forbids a "botón pendiente" standing in for a core
 * function, so a planned surface is labelled as such rather than rendered as an empty page that
 * looks finished.
 */
export const SURFACES: readonly Surface[] = [
  { id: 'field.my-day', label: 'Mi jornada', capability: 'execution.read', density: 'field', icon: '◉', status: 'built' },
  { id: 'planning.timeline', label: 'Planificación', capability: 'planning.read', density: 'operations', icon: '▤', status: 'built' },
  { id: 'execution.parts', label: 'Partes', capability: 'execution.read', density: 'operations', icon: '▦', status: 'built' },
  { id: 'control.directives', label: 'Directivas', capability: 'control.apply', density: 'operations', icon: '⇄', status: 'built' },
  { id: 'habilita.permits', label: 'Permisos', capability: 'habilita.read', density: 'operations', icon: '⬢', status: 'built' },
  { id: 'habilita.events', label: 'Habilita Respond', capability: 'habilita.read', density: 'operations', icon: '▲', status: 'built' },
  { id: 'trace', label: 'Trazabilidad', capability: 'trace.read', density: 'analysis', icon: '◈', status: 'built' },
  { id: 'habilita.matrix', label: 'Habilita', capability: 'habilita.documental', density: 'operations', icon: '◉', status: 'planned' },
  { id: 'review.queue', label: 'Revisión VDS', capability: 'review.read', density: 'operations', icon: '▷', status: 'built' },
  { id: 'commercial.queue', label: 'Certificación', capability: 'commercial.read', density: 'operations', icon: '◫', status: 'built' },
  { id: 'billing.queue', label: 'Facturación', capability: 'billing.read', density: 'operations', icon: '▣', status: 'built' },
  { id: 'dashboard', label: 'Dashboard', capability: 'commercial.client.read', density: 'analysis', icon: '▚', status: 'planned' },
  { id: 'config', label: 'Configuración', capability: 'config.read', density: 'operations', icon: '⚙', status: 'planned' },
];

export interface AppShellProps {
  readonly actor: { readonly displayName: string; readonly capabilities: readonly string[] } | null;
  readonly commands: readonly CommandInfo[];
  readonly current: SurfaceId;
  readonly onNavigate: (surface: SurfaceId) => void;
  readonly onSignOut: () => void;
  readonly children: React.ReactNode;
  /** Which providers are still fixtures, surfaced honestly (14). */
  readonly fixtureProviders?: readonly string[];
}

export function AppShell({
  actor,
  commands,
  current,
  onNavigate,
  onSignOut,
  children,
  fixtureProviders = [],
}: AppShellProps): JSX.Element {
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  const surface = SURFACES.find((s) => s.id === current) ?? SURFACES[0]!;
  // The rail shows what this actor could use. The server still decides on every call.
  const visible = SURFACES.filter((s) => actor?.capabilities.includes(s.capability));

  return (
    <div
      className="vds-shell"
      data-rail={railCollapsed ? 'collapsed' : 'expanded'}
      {...(theme === null ? {} : { 'data-theme': theme })}
    >
      <nav className="vds-rail" aria-label="Navegación principal">
        <div className="vds-rail__brand">
          {/* The brand mark keeps the VDS red. DS-01 restricts that red to identity and to the
              critical signal, so it never doubles as an action colour. */}
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--vds-brand)" />
            <path d="M8 8h4.2L16 19.2 19.8 8H24l-6 16h-4z" fill="#fff" />
          </svg>
          {!railCollapsed && (
            <span className="vds-rail__wordmark">
              <strong>VIENTOS DEL SUR</strong>
              <small>Partes</small>
            </span>
          )}
        </div>

        <ul className="vds-rail__nav">
          {visible.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="vds-rail__link"
                aria-current={item.id === current ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
                title={item.status === 'planned' ? `${item.label} — especificada, aún no construida` : item.label}
              >
                <span className="vds-rail__icon" aria-hidden="true">
                  {item.icon}
                </span>
                {!railCollapsed && (
                  <>
                    <span>{item.label}</span>
                    {item.status === 'planned' && <span className="vds-rail__planned">pendiente</span>}
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="vds-rail__footer">
          <button
            type="button"
            className="vds-rail__link"
            onClick={() => setRailCollapsed((v) => !v)}
            aria-expanded={!railCollapsed}
          >
            <span className="vds-rail__icon" aria-hidden="true">
              {railCollapsed ? '»' : '«'}
            </span>
            {!railCollapsed && <span>Contraer</span>}
          </button>
          <button
            type="button"
            className="vds-rail__link"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            <span className="vds-rail__icon" aria-hidden="true">
              ◐
            </span>
            {!railCollapsed && <span>Tema</span>}
          </button>
        </div>
      </nav>

      <div className="vds-main" data-density={surface.density}>
        <header className="vds-topbar">
          <div>
            <h1>{surface.label}</h1>
            {/* Context stays visible, which 01 lists as a KEEP. */}
            <p className="vds-topbar__context">
              {actor ? actor.displayName : 'Sin sesión'}
              {actor && (
                <>
                  {' · '}
                  <span className="vds-numeric">
                    {commands.filter((c) => c.allowedForActor && c.implemented).length} comandos
                    habilitados
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="vds-topbar__actions">
            {fixtureProviders.length > 0 && (
              // 14: the UI leaves the provider mode visible. A TEST ERP reference must never be
              // mistaken for a real one.
              <span className="vds-chip vds-chip--test" title={`Proveedores fixture: ${fixtureProviders.join(', ')}`}>
                MODO TEST · {fixtureProviders.length} proveedor(es) fixture
              </span>
            )}
            {actor && (
              <button type="button" className="vds-button vds-button--ghost" onClick={onSignOut}>
                Salir
              </button>
            )}
          </div>
        </header>

        <main className="vds-content">
          {surface.status === 'planned' ? <PlannedSurface surface={surface} /> : children}
        </main>
      </div>
    </div>
  );
}

/**
 * An honest placeholder.
 *
 * 02 forbids a "botón pendiente" substituting for a core function, and the plan's DoD requires that
 * no wave be presented as a finished product. So a surface that is specified but not built says so,
 * names what it will contain, and offers no controls that do nothing.
 */
function PlannedSurface({ surface }: { readonly surface: Surface }): JSX.Element {
  const CONTENT: Record<string, { summary: string; wave: string; items: readonly string[] }> = {
    'habilita.matrix': {
      summary:
        'Matriz documental de requisitos por persona y recurso: administración de requisitos, ' +
        'documentos, cumplimientos y evaluaciones. El circuito de eventos (Flash Report, triage, ' +
        'caso, acciones, notificaciones) ya tiene su propia superficie en "Habilita Respond", y los ' +
        'permisos de trabajo en "Permisos".',
      wave: 'W4 (Respond & Learn ya construido); la administración documental queda para esta superficie',
      items: [
        'Matriz como projection sobre requisitos, documentos, cumplimientos y evaluaciones',
        'Alta y versionado de requisitos por tipo de sujeto (persona/recurso)',
        'Carga y vigencia de documentos, con freshness explícito',
        'Vista cruzada persona/recurso × requisito × contexto × fecha',
      ],
    },
    dashboard: {
      summary: 'Indicadores con fuente y vigencia por cifra, y drilldown hasta los hechos.',
      wave: 'W6',
      items: [
        'Métricas separadas por fuente: plan, operación, revisión y comercial',
        'Cada cifra con su source y su as_of',
        'Un cambio de estado no hace desaparecer un histórico',
      ],
    },
    config: {
      summary:
        'Maestros, contratos y versiones, items, unidades, tipos y componentes, y reglas versionadas ' +
        'con publicación y preview de errores.',
      wave: 'W6',
      items: [
        'Publicación versionada con vigencia',
        'Import de maestros: staging, validación, preview de discrepancias, publicación por owner',
        'Configuración faltante visible como PENDIENTE_CONFIGURACION, nunca completada por defecto',
      ],
    },
  };

  const content = CONTENT[surface.id];

  return (
    <section className="vds-planned">
      <h2>{surface.label}</h2>
      <p className="vds-planned__status">
        Superficie especificada y <strong>aún no construida</strong>. Prevista en {content?.wave ?? 'una wave posterior'}.
      </p>
      {content && (
        <>
          <p>{content.summary}</p>
          <ul>
            {content.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
      <p className="vds-planned__note">
        No hay controles aquí a propósito: un botón que no hace nada es peor que una ausencia
        declarada.
      </p>
    </section>
  );
}
