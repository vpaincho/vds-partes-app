/**
 * Product-facing profiles recovered from Juan's Product Baseline.
 *
 * Important distinction:
 * - roles/capabilities remain granular for authorization;
 * - these five profiles define the primary UX, landing surface and navigation.
 *
 * Specialist roles (supervisor, habilita, backoffice, config) remain valid technical roles, but
 * they are not promoted to primary product personas unless the business explicitly decides so.
 */

export type ProductProfile = 'admin' | 'planner' | 'field' | 'review' | 'client' | 'support';

export interface ProductProfileMeta {
  readonly role: ProductProfile;
  readonly label: string;
  readonly description: string;
  readonly landing: string;
  readonly navigation: readonly string[];
}

export const PRODUCT_ROLE_ORDER = ['admin', 'planner', 'field', 'review', 'client'] as const;

export const PRODUCT_PROFILES: Record<Exclude<ProductProfile, 'support'>, ProductProfileMeta> = {
  admin: {
    role: 'admin',
    label: 'Administrador',
    description: 'Visión integral de trabajos, partes, habilitaciones, revisión, certificación y configuración.',
    landing: 'planning.timeline',
    navigation: [
      'planning.timeline',
      'execution.parts',
      'habilita.matrix',
      'review.queue',
      'commercial.queue',
      'dashboard',
      'config',
    ],
  },
  planner: {
    role: 'planner',
    label: 'Planner',
    description: 'Planifica trabajos por contrato y recurso y gestiona su preparación.',
    landing: 'planning.timeline',
    navigation: ['planning.timeline', 'execution.parts', 'habilita.matrix'],
  },
  field: {
    role: 'field',
    label: 'Operador',
    description: 'Completa la jornada de campo y registra la ejecución real.',
    landing: 'field.my-day',
    navigation: ['field.my-day'],
  },
  review: {
    role: 'review',
    label: 'Validador VDS',
    description: 'Revisa la ejecución, evidencia y versiones antes de la derivación comercial.',
    landing: 'review.queue',
    navigation: ['review.queue'],
  },
  client: {
    role: 'client',
    label: 'Cliente',
    description: 'Consulta el servicio y gestiona su conformidad/certificación.',
    landing: 'dashboard',
    navigation: ['dashboard', 'commercial.queue'],
  },
};

export const TECHNICAL_ROLE_LABELS: Readonly<Record<string, string>> = {
  supervisor: 'Supervisor operativo',
  habilita: 'Habilita',
  backoffice: 'Administración / Backoffice',
  config: 'Configuración',
};

export function productProfileForRoles(roles: readonly string[]): ProductProfile {
  for (const role of PRODUCT_ROLE_ORDER) {
    if (roles.includes(role)) return role;
  }
  return 'support';
}

export function isPrimaryProductRole(role: string): boolean {
  return (PRODUCT_ROLE_ORDER as readonly string[]).includes(role);
}

export function profileLabel(roles: readonly string[]): string {
  const profile = productProfileForRoles(roles);
  if (profile !== 'support') return PRODUCT_PROFILES[profile].label;
  const first = roles[0];
  return first ? (TECHNICAL_ROLE_LABELS[first] ?? first) : 'Sin perfil';
}

export function profileDescription(roles: readonly string[]): string {
  const profile = productProfileForRoles(roles);
  if (profile !== 'support') return PRODUCT_PROFILES[profile].description;
  return 'Perfil técnico de soporte. Sus capacidades siguen siendo verificadas por el servidor.';
}

export function primaryNavigationForRoles(roles: readonly string[]): readonly string[] | null {
  const profile = productProfileForRoles(roles);
  return profile === 'support' ? null : PRODUCT_PROFILES[profile].navigation;
}

export function landingForRoles(roles: readonly string[]): string | null {
  const profile = productProfileForRoles(roles);
  return profile === 'support' ? null : PRODUCT_PROFILES[profile].landing;
}
