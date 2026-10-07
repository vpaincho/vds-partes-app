/**
 * Boundary validation.
 *
 * The assertions that matter beyond "does Ajv work": a forged actor is rejected rather than
 * ignored, a local timestamp is rejected, a quantity cannot arrive without its unit, and every
 * command in the catalogue declares a capability.
 */
import { describe, expect, it } from 'vitest';
import { isDomainError } from '@vds/kernel';
import {
  COMMANDS,
  CommandEnvelopeSchema,
  CloseUnitPayload,
  FlashReportPayload,
  PreparePartPayload,
  QuantitySchema,
  check,
  command,
  commandNames,
  parse,
  requiredCapabilities,
  type CommandEnvelope,
} from '../src/index.ts';

const validEnvelope = {
  commandId: '019bb3f0-7c4a-7b2e-8f01-2d6b4a1c9e55',
  occurredAt: '2026-10-05T10:20:00Z',
};

describe('command envelope', () => {
  it('accepts the minimum: a command id and when it happened', () => {
    const parsed = parse<CommandEnvelope>(CommandEnvelopeSchema, validEnvelope);
    expect(parsed.commandId).toBe(validEnvelope.commandId);
  });

  it('rejects a forged actor instead of silently ignoring it', () => {
    // additionalProperties:false plus removeAdditional:false. A client that believes it can set
    // the actor must find out, not be quietly overruled.
    try {
      parse(CommandEnvelopeSchema, { ...validEnvelope, actorId: '019bb3f0-7c4a-7b2e-8f01-2d6b4a1c9e56' });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
      if (!isDomainError(error)) return;
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details[0]!.path).toBe('actorId');
      expect(error.details[0]!.message).toMatch(/derived from the\s+verified session/);
    }
  });

  it('rejects a local timestamp with no zone', () => {
    const result = check(CommandEnvelopeSchema, { ...validEnvelope, occurredAt: '2026-10-05T10:20:00' });
    expect(result.valid).toBe(false);
  });

  it('rejects an offset other than Z, so storage has one representation', () => {
    expect(check(CommandEnvelopeSchema, { ...validEnvelope, occurredAt: '2026-10-05T10:20:00-03:00' }).valid)
      .toBe(false);
  });

  it('rejects a non-uuid command id', () => {
    expect(check(CommandEnvelopeSchema, { ...validEnvelope, commandId: 'PD-0394' }).valid).toBe(false);
  });

  it('does not coerce a string into an integer version', () => {
    // "3" arriving where a version is expected usually means a client bug; coercing it would hide
    // that and could silently defeat optimistic concurrency.
    expect(check(CommandEnvelopeSchema, { ...validEnvelope, expectedVersion: '3' }).valid).toBe(false);
  });

  it('reports every problem at once', () => {
    const result = check(CommandEnvelopeSchema, { commandId: 'nope', occurredAt: 'nope' });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.details.length).toBeGreaterThanOrEqual(2);
  });

  it('requires a substantive reason on an override', () => {
    expect(
      check(CommandEnvelopeSchema, {
        ...validEnvelope,
        override: { gateId: 'GATE-DOC-SOON', ruleId: 'RUL-040', reason: 'ok' },
      }).valid,
    ).toBe(false);

    expect(
      check(CommandEnvelopeSchema, {
        ...validEnvelope,
        override: {
          gateId: 'GATE-DOC-SOON',
          ruleId: 'RUL-040',
          reason: 'Documento en trámite, copia verificada por el supervisor',
        },
      }).valid,
    ).toBe(true);
  });
});

describe('quantities carry their unit (C-014)', () => {
  it('accepts a decimal string with a unit', () => {
    expect(
      check(QuantitySchema, { value: '1200.500000', unitOfMeasureId: '019bb3f0-7c4a-7b2e-8f01-2d6b4a1c9e55' })
        .valid,
    ).toBe(true);
  });

  it('rejects a quantity with no unit', () => {
    expect(check(QuantitySchema, { value: '1200' }).valid).toBe(false);
  });

  it('rejects a float, because a binary rounding error must not reach a commercial derivation', () => {
    expect(check(QuantitySchema, { value: 1200.5, unitOfMeasureId: '019bb3f0-7c4a-7b2e-8f01-2d6b4a1c9e55' }).valid)
      .toBe(false);
  });

  it('rejects more precision than the column stores', () => {
    expect(
      check(QuantitySchema, { value: '1.1234567', unitOfMeasureId: '019bb3f0-7c4a-7b2e-8f01-2d6b4a1c9e55' })
        .valid,
    ).toBe(false);
  });
});

describe('payload shapes encode domain rules', () => {
  it('offers no way to choose a TipoParte when preparing a Parte (C-006)', () => {
    // The routing engine derives it; a free selector is not the normal path.
    expect(check(PreparePartPayload, { partTypeId: '019bb3f0-7c4a-7b2e-8f01-2d6b4a1c9e55' }).valid).toBe(false);
    expect(check(PreparePartPayload, {}).valid).toBe(true);
  });

  it('accepts a Flash Report with no execution context at all (C-025 / GS-033)', () => {
    expect(
      check(FlashReportPayload, {
        initialCategory: 'DERRAME',
        shortDescription: 'Derrame menor en batería 3',
        situationControlled: true,
        occurredAt: '2026-10-05T10:20:00Z',
      }).valid,
    ).toBe(true);
  });

  it('does not ask the reporter for severity or root cause (RUL-047)', () => {
    expect(
      check(FlashReportPayload, {
        initialCategory: 'DERRAME',
        shortDescription: 'Derrame menor',
        situationControlled: true,
        occurredAt: '2026-10-05T10:20:00Z',
        severity: 'ALTA',
      }).valid,
    ).toBe(false);
  });

  it('accepts a close with a result, and a cause when one is given', () => {
    expect(check(CloseUnitPayload, { result: 'COMPLETADA' }).valid).toBe(true);
    expect(
      check(CloseUnitPayload, { result: 'NO_REALIZADA', resultReason: 'Ráfagas de 72 km/h' }).valid,
    ).toBe(true);
    expect(check(CloseUnitPayload, { result: 'INVENTADO' }).valid).toBe(false);
  });
});

describe('the command catalogue is the authorisation table', () => {
  it('gives every command a capability, trigger and subject kind', () => {
    for (const definition of COMMANDS) {
      expect(definition.capability, definition.name).toMatch(/^[a-z]+\.[a-z.]+$/);
      expect(definition.trigger, definition.name).toMatch(/^[A-Z_]+$/);
      expect(definition.subjectKind, definition.name).toBeTruthy();
      expect(definition.description.length, definition.name).toBeGreaterThan(20);
    }
  });

  it('has unique names', () => {
    expect(new Set(commandNames).size).toBe(commandNames.length);
  });

  it('throws a useful error for an unregistered command — default deny', () => {
    expect(() => command('execution.units.do-whatever')).toThrow(/must be registered in COMMANDS/);
  });

  it('exposes the capability list needed to seed platform.capabilities', () => {
    expect(requiredCapabilities).toContain('execution.start');
    expect(requiredCapabilities).toContain('habilita.permit.activate');
    // Sorted and deduplicated, so seeding is deterministic.
    expect([...requiredCapabilities].sort()).toEqual([...requiredCapabilities]);
  });

  it('separates capture, close, replace and amend — they are different authorities', () => {
    // 13: a field operator captures; closing, replacing and amending are distinct capabilities, so
    // an operator cannot amend closed reality by holding the capture capability.
    expect(command('execution.units.capture-measurement').capability).toBe('execution.capture');
    expect(command('execution.units.close').capability).toBe('execution.close');
    expect(command('execution.units.replace-person').capability).toBe('execution.replace');
    expect(command('execution.amendments.create').capability).toBe('execution.amend');
  });

  it('marks Start Work previewable, because evaluate-start must exist (RGT-17)', () => {
    expect(command('execution.units.start').previewable).toBe(true);
    expect(command('execution.units.start').trigger).toBe('START_WORK');
  });
});
