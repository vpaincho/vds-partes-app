/**
 * Application shell.
 *
 * Product rule: the primary navigation follows Juan's five Product Baseline personas
 * (Administrador, Planner, Operador, Validador VDS, Cliente). Granular capabilities remain the
 * authorization mechanism underneath; they no longer define the product's information architecture.
 *
 * Specialist roles keep a capability-driven fallback so Habilita / supervisor / backoffice flows
 * remain testable without becoming new primary personas by accident.
 */
import { useState, type JSX } from 'react';
import {
  primaryNavigationForRoles,
  productProfileForRoles,
  profileLabel,
} from './productProfile.ts';

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
  /** Capability used only by specialist-role fallback navigation. */
  readonly capability: string;
  readonly density: 'field' | 'operations' | 'analysis';
  readonly icon: string;
  readonly status: 'built' | 'planned';
}

export const SURFACES: readonly Surface[] = [
  { id: 'field.my-day', label: 'Mi jornada', capability: 'execution.read', density: 'field', icon: '◉', status: 'built' },
  { id: 'planning.timeline', label: 'Planificación', capability: 'planning.read', density: 'operations', icon: '▤', status: 'built' },
  { id: 'execution.parts', label: 'Partes', capability: 'execution.read', density: 'operations', icon: '▦', status: 'built' },
  { id: 'habilita.matrix', label: 'Habilitaciones', capability: 'habilita.read', density: 'operations', icon: '◉', status: 'built' },
  { id: 'review.queue', label: 'Revisión VDS', capability: 'review.read', density: 'operations', icon: '▷', status: 'built' },
  { id: 'commercial.queue', label: 'Certificación', capability: 'commercial.read', density: 'operations', icon: '◫', status: 'built' },
  { id: 'dashboard', label: 'Dashboard', capability: 'execution.read', density: 'analysis', icon: '▚', status: 'built' },
  { id: 'config', label: 'Configuración', capability: 'config.read', density: 'operations', icon: '⚙', status: 'built' },

  // Built secondary capabilities. They stay out of the five primary menus unless the actor is a
  // specialist/support identity; the functionality is preserved, only its product placement changes.
  { id: 'control.directives', label: 'Directivas', capability: 'control.apply', density: 'operations', icon: '⇄', status: 'built' },
  { id: 'habilita.permits', label: 'Permisos de trabajo', capability: 'habilita.read', density: 'operations', icon: '⬢', status: 'built' },
  { id: 'habilita.events', label: 'Eventos Habilita', capability: 'habilita.read', density: 'operations', icon: '▲', status: 'built' },
  { id: 'billing.queue', label: 'Facturación', capability: 'billing.read', density: 'operations', icon: '▣', status: 'built' },
  { id: 'trace', label: 'Trazabilidad', capability: 'trace.read', density: 'analysis', icon: '◈', status: 'built' },
];

export interface AppShellProps {
  readonly actor: {
    readonly displayName: string;
    readonly roles: readonly string[];
    readonly capabilities: readonly string[];
  } | null;
  readonly current: SurfaceId;
  readonly onNavigate: (surface: SurfaceId) => void;
  readonly onSignOut: () => void;
  readonly children: React.ReactNode;
  readonly fixtureProviders?: readonly string[];
}

function surfaceSubtitle(surfaceId: SurfaceId, roles: readonly string[]): string {
  const profile = productProfileForRoles(roles);

  switch (surfaceId) {
    case 'planning.timeline':
      return 'Trabajos por contrato, recurso y día';
    case 'execution.parts':
      return profile === 'admin' ? 'Todos los partes de la base, por estado' : 'Partes y ejecución vinculados a la planificación';
    case 'field.my-day':
      return 'Trabajo de campo · ejecución de la jornada';
    case 'habilita.matrix':
      return 'Personal y recursos habilitados por operadora';
    case 'review.queue':
      return 'Responsable técnico VDS';
    case 'commercial.queue':
      return profile === 'client' ? 'Certificación del servicio' : 'Unidades comerciales y certificación';
    case 'dashboard':
      return profile === 'client' ? 'Dashboard del servicio' : 'Indicadores del servicio';
    case 'config':
      return 'Contratos, catálogos y usuarios';
    case 'control.directives':
      return 'Cambios operativos con recepción y aplicación trazables';
    case 'habilita.permits':
      return 'Permisos de trabajo y vigencias';
    case 'habilita.events':
      return 'Eventos, triage, casos y acciones';
    case 'billing.queue':
      return 'Líneas y lotes de facturación';
    case 'trace':
      return 'Decisiones, reglas y lineage';
  }
}

export function AppShell({
  actor,
  current,
  onNavigate,
  onSignOut,
  children,
  fixtureProviders = [],
}: AppShellProps): JSX.Element {
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  const surface = SURFACES.find((s) => s.id === current) ?? SURFACES[0]!;
  const baselineNavigation = actor ? primaryNavigationForRoles(actor.roles) : null;

  const visible = actor
    ? baselineNavigation
      ? baselineNavigation
          .map((id) => SURFACES.find((surfaceItem) => surfaceItem.id === id))
          .filter((item): item is Surface => item !== undefined)
      : SURFACES.filter((item) => actor.capabilities.includes(item.capability))
    : [];

  const roleLabel = actor ? profileLabel(actor.roles) : 'Sin perfil';

  return (
    <div
      className="vds-shell"
      data-rail={railCollapsed ? 'collapsed' : 'expanded'}
      {...(theme === null ? {} : { 'data-theme': theme })}
    >
      <nav className="vds-rail" aria-label="Navegación principal">
        <div className="vds-rail__brand">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--vds-brand)" />
            <path d="M8 8h4.2L16 19.2 19.8 8H24l-6 16h-4z" fill="#fff" />
          </svg>
          {!railCollapsed && (
            <span className="vds-rail__wordmark">
              <strong>VIENTOS DEL SUR</strong>
              <small>Partes de campo</small>
            </span>
          )}
        </div>

        {!railCollapsed && <div className="vds-rail__role">{roleLabel}</div>}

        <ul className="vds-rail__nav">
          {visible.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="vds-rail__link"
                aria-current={item.id === current ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
                title={item.label}
              >
                <span className="vds-rail__icon" aria-hidden="true">
                  {item.icon}
                </span>
                {!railCollapsed && <span>{item.label}</span>}
              </button>
            </li>
          ))}
        </ul>

        <div className="vds-rail__footer">
          {actor && !railCollapsed && (
            <div className="vds-rail__identity">
              <strong>{actor.displayName}</strong>
              <small>{roleLabel}</small>
            </div>
          )}

          <button
            type="button"
            className="vds-rail__link"
            onClick={() => setRailCollapsed((value) => !value)}
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
            onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
          >
            <span className="vds-rail__icon" aria-hidden="true">◐</span>
            {!railCollapsed && <span>Tema</span>}
          </button>

          {actor && (
            <button type="button" className="vds-rail__link" onClick={onSignOut}>
              <span className="vds-rail__icon" aria-hidden="true">↪</span>
              {!railCollapsed && <span>Salir</span>}
            </button>
          )}
        </div>
      </nav>

      <div className="vds-main" data-density={surface.density}>
        <header className="vds-topbar">
          <div>
            <h1>{surface.label}</h1>
            <p className="vds-topbar__context">{surfaceSubtitle(surface.id, actor?.roles ?? [])}</p>
          </div>

          <div className="vds-topbar__actions">
            {fixtureProviders.length > 0 && (
              <span
                className="vds-chip vds-chip--test"
                title={`Proveedores fixture: ${fixtureProviders.join(', ')}`}
              >
                MODO TEST
              </span>
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

function PlannedSurface({ surface }: { readonly surface: Surface }): JSX.Element {
  const CONTENT: Record<string, { summary: string; wave: string; items: readonly string[] }> = {
    'habilita.matrix': {
      summary:
        'Matriz documental de requisitos por persona y recurso: administración de requisitos, ' +
        'documentos, cumplimientos y evaluaciones.',
      wave: 'W4',
      items: [
        'Matriz sobre requisitos, documentos, cumplimientos y evaluaciones',
        'Vigencia y estado por persona/recurso',
        'Contexto y fecha de evaluación',
      ],
    },
    config: {
      summary:
        'Maestros, contratos y versiones, items, unidades, tipos, componentes y reglas versionadas.',
      wave: 'W6',
      items: [
        'Publicación versionada con vigencia',
        'Import de maestros con validación',
        'Configuración faltante visible como PENDIENTE_CONFIGURACION',
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
    </section>
  );
}
