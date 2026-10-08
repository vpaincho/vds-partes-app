import { describe, expect, it } from 'vitest';
import {
  landingForRoles,
  primaryNavigationForRoles,
  productProfileForRoles,
  profileLabel,
} from '../../apps/web/src/shell/productProfile.ts';

describe('product profiles', () => {
  it('recovers Juan primary personas', () => {
    expect(productProfileForRoles(['admin'])).toBe('admin');
    expect(productProfileForRoles(['planner'])).toBe('planner');
    expect(productProfileForRoles(['field'])).toBe('field');
    expect(productProfileForRoles(['review'])).toBe('review');
    expect(productProfileForRoles(['client'])).toBe('client');
    expect(productProfileForRoles(['habilita'])).toBe('support');
  });

  it('recovers Juan landing surfaces', () => {
    expect(landingForRoles(['admin'])).toBe('planning.timeline');
    expect(landingForRoles(['planner'])).toBe('planning.timeline');
    expect(landingForRoles(['field'])).toBe('field.my-day');
    expect(landingForRoles(['review'])).toBe('review.queue');
    expect(landingForRoles(['client'])).toBe('dashboard');
  });

  it('keeps Juan primary navigation concise', () => {
    expect(primaryNavigationForRoles(['field'])).toEqual(['field.my-day']);
    expect(primaryNavigationForRoles(['review'])).toEqual(['review.queue']);
    expect(primaryNavigationForRoles(['client'])).toEqual(['dashboard', 'commercial.queue']);
    expect(primaryNavigationForRoles(['planner'])).toEqual([
      'planning.timeline',
      'execution.parts',
      'habilita.matrix',
    ]);
  });

  it('uses product labels rather than technical role ids', () => {
    expect(profileLabel(['field'])).toBe('Operador');
    expect(profileLabel(['review'])).toBe('Validador VDS');
  });
});
