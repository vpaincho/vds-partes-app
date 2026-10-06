/**
 * DS-01 tokens — the single source of truth.
 *
 * `tokens.css` is generated from this file (scripts/gen-tokens.mjs), so the contrast test
 * checks the values that actually ship rather than a parallel copy that can drift.
 *
 * Two decisions here carry domain weight and must not be "simplified" later:
 *
 *  1. `action` and `critical` are different hues. The prototype used one red for the brand
 *     and for every primary action, which left red unable to mean *critical*. RUL-040 and
 *     AP-04 make warning-vs-block a consequential distinction (a warning needs an
 *     OverrideGate; a hard block cannot be overridden), so the two must never be rendered
 *     alike. Red is now identity and critical signal only.
 *
 *  2. The six `domain` hues are inherited from the prototype's own --st-* / --t-* tokens.
 *     Keeping them preserves recognition for people already using the app while the
 *     semantic roles get reorganised — the product's visual memory stays, the semantics
 *     get fixed. See DESIGN_SYSTEM.md §3.
 */

export type Theme = 'light' | 'dark';
export type Density = 'field' | 'operations' | 'analysis';

export interface ThemedColor {
  readonly light: string;
  readonly dark: string;
  /** Why this token exists and the rule that depends on it being distinguishable. */
  readonly note?: string;
}

/** Semantic roles. Components reference these, never a literal colour. */
export const semantic = {
  brand: {
    light: '#C21F35',
    dark: '#E8495F',
    note: 'Identity only: logo and header signature. Never a primary action.',
  },
  action: {
    light: '#15608F',
    dark: '#58A6DC',
    note: 'Primary action, focus ring, selection. Deliberately not the brand red.',
  },
  critical: {
    light: '#C21F35',
    dark: '#F2586C',
    note: 'Hard block / hard gate / error. Reserved — never decorative (RUL-039, AP-04).',
  },
  warn: {
    // #B06A00 was the first choice and measured 4.28:1 on a white panel — below AA. A
    // warning requires an OverrideGate decision, so it has to be readable, not merely
    // noticeable. Darkened to 5.08:1 while keeping the amber character.
    light: '#A05F00',
    dark: '#E09B3D',
    note: 'Overrideable warning (RUL-040). Must never render as critical.',
  },
  ok: { light: '#1C7A52', dark: '#3DB184', note: 'Conforming, verified, accepted.' },
  // There is deliberately no generic `info` token. A first draft had one (#2A6F9E), and the
  // pairwise check measured ΔE 0.051 against `action` — the two were effectively the same
  // steel blue. That is worse than redundant: an informational badge rendered in the action
  // colour reads as clickable. In this product "informational" is always *about* something,
  // so it takes the colour of that thing: a state dimension uses its `domain.*` hue,
  // an unresolved value uses `pending`, and plain annotation uses `ink.muted`.
  pending: {
    // A true neutral, not the blue-grey first drafted (#5F6E7D): every blue-tinted grey
    // measured ΔE < 0.10 against `action`, so a pending chip read as a control. Neutral
    // grey also says "no state yet" more honestly than a tint that echoes the action hue.
    light: '#5E5E5E',
    dark: '#9B9B9B',
    note: 'Unresolved: PENDIENTE, AMBIGUO, PENDIENTE_CONFIGURACION.',
  },
} as const satisfies Record<string, ThemedColor>;

/**
 * One hue per state dimension, so a dimension is identifiable without reading the label.
 * A Parte carries several of these at once (plan + exec + review + commercial + delivery),
 * so they appear side by side in one badge row and must be mutually distinguishable — not
 * just distinguishable from the background.
 *
 * These stay in the **hue families** of the prototype (blue plan, green exec, violet
 * review, teal commercial, orange habilita) so the product keeps its visual memory, but the
 * values are **derived in OKLCH** rather than copied. Taking Juan's values literally failed
 * the pairwise test: --st-plan vs --st-env measured ΔE 0.098 and --st-plan vs --st-apr
 * 0.079, both below the perceptible floor. Nudging one hue at a time just moved the
 * collision, so the set is solved together.
 *
 * Construction (see DESIGN_SYSTEM.md §3):
 *   light  L 0.49–0.58, C 0.02–0.155, h 264/152/310/205/45/250
 *   dark   L 0.66–0.84, C 0.02–0.150, same hues
 * `delivery` is deliberately near-neutral (C 0.02) and offset in lightness: it is not a
 * domain of the work, it is transport status, and it should not compete with the five that
 * describe the work itself.
 *
 * Verified: all 15 pairs ΔE ≥ 0.112 in both themes; minimum contrast 4.12:1 (light) and
 * 4.85:1 (dark) against the panel, above the 3:1 needed for a badge.
 */
export const domain = {
  plan: {
    light: '#365DB8',
    dark: '#89B0FF',
    note: 'Planning / intention. Blue family of --st-plan, OKLCH h=264.',
  },
  exec: {
    light: '#037E3F',
    dark: '#69D98D',
    note: 'Execution / reality. Green family of --t-op, OKLCH h=152.',
  },
  review: {
    light: '#7B41A1',
    dark: '#C88EF1',
    note: 'Review VDS. Violet family of --st-env, OKLCH h=310.',
  },
  commercial: {
    light: '#118A95',
    dark: '#55E1F0',
    note: 'Commercial / certification. Teal family of --st-apr, OKLCH h=205.',
  },
  habilita: {
    light: '#AF4803',
    dark: '#FF9A6B',
    note: 'Habilita / risk. Orange family of --st-obs, OKLCH h=45.',
  },
  delivery: {
    light: '#404952',
    dark: '#89939E',
    note: 'Delivery / sync. Near-neutral by design: the prototype had no delivery dimension.',
  },
} as const satisfies Record<string, ThemedColor>;

/** Surfaces: canvas → surface → panel → raised, each with its border. */
export const surface = {
  canvas: { light: '#E9EDF1', dark: '#0F1620' },
  surface: { light: '#F4F6F8', dark: '#151E2A' },
  panel: { light: '#FFFFFF', dark: '#1C2733' },
  raised: { light: '#FFFFFF', dark: '#243140' },
  border: { light: '#D8DEE5', dark: '#2C3A49' },
  borderStrong: { light: '#BCC6D0', dark: '#3C4C5C' },
} as const satisfies Record<string, ThemedColor>;

export const ink = {
  ink: { light: '#0E1620', dark: '#E6ECF2' },
  muted: { light: '#4D5B6A', dark: '#9BA8B5' },
  faint: { light: '#6B7A8A', dark: '#74828F' },
  onAccent: { light: '#FFFFFF', dark: '#0F1620' },
} as const satisfies Record<string, ThemedColor>;

export const font = {
  body: "'Barlow', 'Segoe UI', Roboto, Arial, sans-serif",
  display: "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif",
  /** IDs, timestamps, quantities, versions, hashes — anything compared or aligned. */
  mono: "'IBM Plex Mono', ui-monospace, Consolas, monospace",
} as const;

export const fontSize = {
  xs: '12px',
  sm: '13px',
  md: '14px',
  lg: '16px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '32px',
} as const;

export const space = {
  '0': '0',
  '1': '2px',
  '2': '4px',
  '3': '8px',
  '4': '12px',
  '5': '16px',
  '6': '24px',
  '7': '32px',
  '8': '48px',
} as const;

export const radius = { sm: '3px', md: '5px', lg: '8px', pill: '999px' } as const;

export interface DensityTier {
  readonly rowHeight: string;
  /** Minimum interactive target. 44px in the field is a target to verify on a device. */
  readonly touchTarget: string;
  readonly bodySize: string;
  readonly lineHeight: string;
  readonly gutter: string;
  readonly where: string;
}

export const density = {
  field: {
    rowHeight: '56px',
    touchTarget: '44px',
    bodySize: fontSize.lg,
    lineHeight: '1.45',
    gutter: space['5'],
    where: 'Mi Jornada, Trabajo activo, Flash Report, Start Work',
  },
  operations: {
    rowHeight: '38px',
    touchTarget: '32px',
    bodySize: fontSize.md,
    lineHeight: '1.4',
    gutter: space['4'],
    where: 'Planning, inboxes, Habilita matrix, configuration',
  },
  analysis: {
    rowHeight: '30px',
    touchTarget: '28px',
    bodySize: fontSize.sm,
    lineHeight: '1.35',
    gutter: space['3'],
    where: 'dashboards, trace, lineage, coverage',
  },
} as const satisfies Record<Density, DensityTier>;

/**
 * Pairs that must meet WCAG AA, asserted by test rather than by inspection.
 * 4.5:1 for text, 3:1 for UI components and graphical objects.
 */
export const contrastContract: readonly {
  readonly foreground: string;
  readonly background: string;
  readonly minimum: number;
  readonly reason: string;
}[] = [
  { foreground: 'ink.ink', background: 'surface.panel', minimum: 4.5, reason: 'body text' },
  { foreground: 'ink.ink', background: 'surface.canvas', minimum: 4.5, reason: 'body on canvas' },
  { foreground: 'ink.muted', background: 'surface.panel', minimum: 4.5, reason: 'secondary text' },
  {
    foreground: 'ink.faint',
    background: 'surface.panel',
    minimum: 3,
    reason: 'non-essential hint text and icon strokes',
  },
  {
    foreground: 'semantic.action',
    background: 'surface.panel',
    minimum: 3,
    reason: 'focus ring and control borders must be perceivable',
  },
  {
    foreground: 'semantic.critical',
    background: 'surface.panel',
    minimum: 4.5,
    reason: 'a hard block is text the operator must be able to read',
  },
  {
    foreground: 'semantic.warn',
    background: 'surface.panel',
    minimum: 4.5,
    reason: 'a warning requires an OverrideGate decision: it has to be legible',
  },
  { foreground: 'semantic.ok', background: 'surface.panel', minimum: 4.5, reason: 'accepted state' },
  {
    foreground: 'semantic.pending',
    background: 'surface.panel',
    minimum: 4.5,
    reason: 'PENDIENTE_CONFIGURACION blocks downstream work and must not look decorative',
  },
  {
    foreground: 'ink.onAccent',
    background: 'semantic.action',
    minimum: 4.5,
    reason: 'label on a primary button',
  },
  {
    foreground: 'ink.onAccent',
    background: 'semantic.critical',
    minimum: 4.5,
    reason: 'label on a destructive/blocking control',
  },
  { foreground: 'domain.plan', background: 'surface.panel', minimum: 3, reason: 'dimension badge' },
  { foreground: 'domain.exec', background: 'surface.panel', minimum: 3, reason: 'dimension badge' },
  {
    foreground: 'domain.review',
    background: 'surface.panel',
    minimum: 3,
    reason: 'dimension badge',
  },
  {
    foreground: 'domain.commercial',
    background: 'surface.panel',
    minimum: 3,
    reason: 'dimension badge',
  },
  {
    foreground: 'domain.habilita',
    background: 'surface.panel',
    minimum: 3,
    reason: 'dimension badge',
  },
  {
    foreground: 'domain.delivery',
    background: 'surface.panel',
    minimum: 3,
    reason: 'dimension badge',
  },
];

/**
 * Pairs that must be *distinguishable from each other*, not merely from the background.
 * Rendering a warning like a block, or a plan state like an execution state, is a domain
 * error with operational consequences — not a cosmetic slip.
 *
 * Measured as OKLab ΔE, **not** as WCAG contrast ratio. WCAG contrast compares relative
 * luminance, which answers "is this text legible on that background". It is the wrong
 * question here: two clearly different hues at similar lightness (a blue and a green)
 * score ~1.0 while being obviously distinct. OKLab is perceptually uniform, so a single
 * distance threshold means the same thing across the palette.
 *
 * Floor of 0.10 ≈ a clearly perceptible difference in OKLab; the two pairs whose confusion
 * has operational consequences are held to 0.13.
 *
 * This is a necessary condition, never a sufficient one: DS-01 requires severity to be
 * carried by **icon and shape as well as colour**, so the interface still works for a
 * colour-blind operator and in direct sunlight. That is asserted at component level
 * (GateBanner, StateBadge), not here.
 */
export const DELTA_E_PERCEPTIBLE = 0.1;
export const DELTA_E_CONSEQUENTIAL = 0.13;

export const distinguishabilityContract: readonly {
  readonly a: string;
  readonly b: string;
  readonly minimum: number;
  readonly reason: string;
}[] = [
  {
    a: 'semantic.warn',
    b: 'semantic.critical',
    minimum: DELTA_E_CONSEQUENTIAL,
    reason:
      'overrideable warning vs hard block — RUL-040 needs an OverrideGate, RUL-039 cannot ' +
      'be overridden at all; confusing them is AP-04 "warning = permission"',
  },
  {
    a: 'semantic.ok',
    b: 'semantic.pending',
    minimum: DELTA_E_PERCEPTIBLE,
    reason: 'accepted vs PENDIENTE_CONFIGURACION, which blocks downstream commercial work',
  },
  {
    a: 'domain.plan',
    b: 'domain.exec',
    minimum: DELTA_E_CONSEQUENTIAL,
    reason: 'intention vs reality — C-001, the separation the whole model rests on',
  },
  {
    a: 'domain.review',
    b: 'domain.commercial',
    minimum: DELTA_E_PERCEPTIBLE,
    reason: 'Review VDS acceptance does not certify commercially; separate dimensions',
  },
  {
    a: 'semantic.brand',
    b: 'semantic.action',
    minimum: DELTA_E_CONSEQUENTIAL,
    reason: 'identity must not read as a call to action',
  },
];

export const tokenGroups = { semantic, domain, surface, ink } as const;

/** Resolve "group.name" against the token groups, for tests and tooling. */
export function resolveColor(reference: string, theme: Theme): string {
  const [group, name] = reference.split('.');
  const groups = tokenGroups as Record<string, Record<string, ThemedColor>>;
  const value = group && name ? groups[group]?.[name] : undefined;
  if (!value) throw new Error(`Unknown token reference "${reference}"`);
  return value[theme];
}
