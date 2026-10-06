/**
 * DS-01 token contract.
 *
 * Contrast and distinguishability are asserted, not inspected. The audit was explicit that
 * WCAG conformance must not be claimed without evaluation, and two of these assertions
 * carry domain weight rather than taste:
 *
 *  - warn vs critical must be distinguishable, because RUL-040 (overrideable warning,
 *    needs an OverrideGate) and RUL-039 (hard block, cannot be overridden) have different
 *    consequences. Rendering them alike invites AP-04 "warning = permission".
 *  - plan vs exec must be distinguishable, because C-001 separates intention from reality.
 */
import { describe, expect, it } from 'vitest';
import {
  DELTA_E_PERCEPTIBLE,
  contrastContract,
  density,
  distinguishabilityContract,
  domain,
  ink,
  resolveColor,
  semantic,
  surface,
  tokenGroups,
  type Theme,
} from '../src/tokens.ts';

const THEMES: readonly Theme[] = ['light', 'dark'];

function linearRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return linear as [number, number, number];
}

/** sRGB relative luminance, WCAG 2.x definition. */
function luminance(hex: string): number {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio — the right metric for text legibility against a background. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * OKLab — the right metric for "can these two colours be told apart". WCAG contrast would
 * report ~1.0 for a blue and a green of similar lightness, which says nothing about whether
 * an operator can distinguish a warning badge from a block badge.
 */
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = linearRgb(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

describe('token hygiene', () => {
  it('every colour token is a 6-digit hex in both themes', () => {
    for (const [groupName, group] of Object.entries(tokenGroups)) {
      for (const [name, token] of Object.entries(group)) {
        for (const theme of THEMES) {
          expect(token[theme], `${groupName}.${name}.${theme}`).toMatch(/^#[0-9A-F]{6}$/i);
        }
      }
    }
  });

  it('documents why each semantic and domain role exists', () => {
    for (const [name, token] of Object.entries({ ...semantic, ...domain })) {
      expect(token.note, `${name} needs a note explaining the role it protects`).toBeTruthy();
    }
  });

  it('keeps action distinct from brand — red is identity and critical only', () => {
    for (const theme of THEMES) {
      expect(semantic.action[theme]).not.toBe(semantic.brand[theme]);
    }
    // The prototype's single red (#C21F35) survives as brand and as critical, not as action.
    expect(semantic.brand.light).toBe('#C21F35');
    expect(semantic.action.light).not.toBe('#C21F35');
  });

  it('keeps the six domain hues distinct from one another within a theme', () => {
    for (const theme of THEMES) {
      const values = Object.values(domain).map((t) => t[theme].toUpperCase());
      expect(new Set(values).size, `duplicate domain hue in ${theme}`).toBe(values.length);
    }
  });
});

describe('WCAG AA contrast', () => {
  const cases = contrastContract.flatMap((c) => THEMES.map((theme) => ({ ...c, theme })));

  it.each(cases.map((c) => [`${c.theme} · ${c.foreground} on ${c.background}`, c] as const))(
    '%s',
    (_label, c) => {
      const ratio = contrast(resolveColor(c.foreground, c.theme), resolveColor(c.background, c.theme));
      expect(
        Number(ratio.toFixed(2)),
        `${c.reason} — needs ${c.minimum}:1, got ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(c.minimum);
    },
  );
});

describe('states that must not be confused with each other', () => {
  const cases = distinguishabilityContract.flatMap((c) => THEMES.map((theme) => ({ ...c, theme })));

  it.each(cases.map((c) => [`${c.theme} · ${c.a} vs ${c.b}`, c] as const))('%s', (_label, c) => {
    const distance = deltaE(resolveColor(c.a, c.theme), resolveColor(c.b, c.theme));
    expect(
      Number(distance.toFixed(3)),
      `${c.reason} — needs ΔE ≥ ${c.minimum}, got ${distance.toFixed(3)}`,
    ).toBeGreaterThanOrEqual(c.minimum);
  });

  it('holds every semantic pair apart, not just the documented ones', () => {
    // A future token edit that accidentally makes two roles near-identical should fail here
    // even if nobody remembered to add the pair to the contract.
    const names = Object.keys(semantic);
    for (const theme of THEMES) {
      for (let i = 0; i < names.length; i += 1) {
        for (let j = i + 1; j < names.length; j += 1) {
          const [a, b] = [names[i]!, names[j]!];
          // brand and critical intentionally share the VDS red: identity and the critical
          // signal are the same hue by design, and are never used in the same context.
          if (new Set([a, b]).size === 2 && a === 'brand' && b === 'critical') continue;
          const distance = deltaE(
            resolveColor(`semantic.${a}`, theme),
            resolveColor(`semantic.${b}`, theme),
          );
          expect(distance, `${theme}: semantic.${a} vs semantic.${b}`).toBeGreaterThanOrEqual(
            DELTA_E_PERCEPTIBLE,
          );
        }
      }
    }
  });

  it('holds the six domain hues perceptibly apart from each other', () => {
    const names = Object.keys(domain);
    for (const theme of THEMES) {
      for (let i = 0; i < names.length; i += 1) {
        for (let j = i + 1; j < names.length; j += 1) {
          const distance = deltaE(
            resolveColor(`domain.${names[i]}`, theme),
            resolveColor(`domain.${names[j]}`, theme),
          );
          expect(distance, `${theme}: domain.${names[i]} vs domain.${names[j]}`).toBeGreaterThanOrEqual(
            DELTA_E_PERCEPTIBLE,
          );
        }
      }
    }
  });
});

describe('density tiers', () => {
  it('declares the three tiers DS-01 specifies', () => {
    expect(Object.keys(density)).toEqual(['field', 'operations', 'analysis']);
  });

  it('gives field a 44px touch target and the largest rows', () => {
    // The prototype scaled a 1366x1024 frame, which made controls physically small. The
    // field tier exists so that cannot happen again.
    expect(Number.parseInt(density.field.touchTarget, 10)).toBeGreaterThanOrEqual(44);
    const heights = (['field', 'operations', 'analysis'] as const).map((t) =>
      Number.parseInt(density[t].rowHeight, 10),
    );
    expect(heights[0]).toBeGreaterThan(heights[1]!);
    expect(heights[1]).toBeGreaterThan(heights[2]!);
  });

  it('never lets a denser tier carry a larger body size than a looser one', () => {
    const sizes = (['field', 'operations', 'analysis'] as const).map((t) =>
      Number.parseInt(density[t].bodySize, 10),
    );
    expect(sizes[0]).toBeGreaterThanOrEqual(sizes[1]!);
    expect(sizes[1]).toBeGreaterThanOrEqual(sizes[2]!);
  });

  it('says where each tier applies, so a surface cannot pick one by accident', () => {
    for (const [name, tier] of Object.entries(density)) {
      expect(tier.where, name).toBeTruthy();
    }
  });
});

describe('surfaces and ink', () => {
  it('orders light surfaces from canvas up to panel', () => {
    // canvas is the recessed backdrop; panel is the raised reading surface.
    expect(luminance(surface.canvas.light)).toBeLessThan(luminance(surface.panel.light));
    // and inverts in dark mode
    expect(luminance(surface.canvas.dark)).toBeLessThan(luminance(surface.panel.dark));
  });

  it('inverts ink between themes', () => {
    expect(luminance(ink.ink.light)).toBeLessThan(0.2);
    expect(luminance(ink.ink.dark)).toBeGreaterThan(0.6);
  });
});
