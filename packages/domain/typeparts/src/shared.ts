/**
 * The identity decisions that are the same for all three patterns.
 *
 * These exist because C-007, C-019 and B-03 state them once for the whole product: **a shift change,
 * an additional resource, a different PTW and a change of location do not cut identity by
 * themselves.** Putting them in each strategy would be three chances to disagree, and the prototype's
 * version of this question — there wasn't one; a job was a row and a day was a column — is exactly
 * what produced "fila horaria = UE".
 *
 * A strategy overrides one of these only where its own rule row says something different, and the
 * override cites that row.
 */
import type {
  ContextChange,
  IdentityDecision,
  PartState,
} from './contract.ts';

/**
 * A resource joining or leaving does not create a Parte (RUL-006).
 *
 * The real effect is an interval: the outgoing assignment closes, the incoming one opens. Nothing is
 * edited, which is the RGT-05 shape — `o-delp` spliced the person out of the array and the fact that
 * they had been there disappeared.
 */
export const resourceChange = (): IdentityDecision => ({
  outcome: 'KEEP_PART',
  ruleId: 'RUL-006',
  reason:
    'Un recurso nuevo apoya la misma unidad de trabajo: no crea un Parte. Se cierra el intervalo ' +
    'del saliente y se abre el del entrante.',
  effects: ['AsignacionRecursoEjecucion'],
  fromDefault: false,
});

/** A person joining or leaving: same shape as a resource, same reason (RUL-025). */
export const personChange = (): IdentityDecision => ({
  outcome: 'KEEP_PART',
  ruleId: 'RUL-025',
  reason:
    'Un reemplazo de persona se registra como intervalos: cierra el del saliente y abre el del ' +
    'entrante. El pasado no se edita y la presencia histórica no se borra.',
  effects: ['AsignacionPersonaEjecucion'],
  fromDefault: false,
});

/**
 * A different work permit does not cut identity (C-019).
 *
 * It does gate the work — a start without coverage is refused (RUL-042) — but gating and identity are
 * different questions, and the prototype collapsed them by holding the permit inside the Parte.
 */
export const workPermitChange = (): IdentityDecision => ({
  outcome: 'KEEP_PART',
  ruleId: 'RUL-042',
  reason:
    'Un PTW distinto no corta el Parte. Sí condiciona el inicio: hace falta cobertura temporal y de ' +
    'alcance en el instante real, lo que se evalúa como gate y no como identidad.',
  effects: ['EventoOperativo'],
  fromDefault: false,
});

/**
 * A change of technical location (RUL-008).
 *
 * Default: no cut. Location is a driver only where the TipoParte declares it, and TP-02 is the one
 * that does — but even there the driver is the *leg*, not the coordinate.
 */
export function locationChange(part: PartState): IdentityDecision {
  if (part.config.locationCutsPart === true) {
    return {
      outcome: 'NEW_PART',
      ruleId: 'RUL-008',
      reason:
        'La configuración de este TipoParte declara la ubicación como driver de corte, así que el ' +
        'cambio cierra el alcance actual y abre uno nuevo.',
      effects: ['EjecucionUbicacion', 'TransicionOperativa', 'Parte'],
      fromDefault: false,
    };
  }
  return {
    outcome: 'KEEP_PART',
    ruleId: 'RUL-008',
    reason:
      'Cambiar de ubicación no corta por sí solo. Se registra la ubicación y la transición, y el ' +
      'tiempo de traslado queda atribuido en lugar de quedar huérfano (C-013).',
    effects: ['EjecucionUbicacion', 'TransicionOperativa'],
    fromDefault: part.config.locationCutsPart === undefined,
  };
}

/**
 * A shift change (RUL-005, default B-01).
 *
 * No cut unless a ReglaCorte says otherwise: the Parte continues, a handover is generated, intervals
 * close and open, and the gates are revalidated — because the people changed, not the work.
 */
export function shiftChange(part: PartState): IdentityDecision {
  if (part.config.shiftCutsPart === true) {
    return {
      outcome: 'NEW_PART',
      ruleId: 'RUL-005',
      reason:
        'Existe una ReglaCorte configurada que obliga a partir por turno, así que el turno nuevo es ' +
        'un Parte nuevo.',
      effects: ['Parte', 'VinculoPlanEjecucion'],
      fromDefault: false,
    };
  }
  return {
    outcome: 'HANDOVER',
    ruleId: 'RUL-005',
    reason:
      'Sin ReglaCorte específica el Parte se mantiene: se genera un handover, se cierran y abren los ' +
      'intervalos y se revalidan los gates. El trabajo no terminó porque cambió la gente.',
    effects: ['EventoHandover', 'AsignacionPersonaEjecucion', 'ReevaluacionPTW'],
    fromDefault: part.config.shiftCutsPart === undefined,
  };
}

/**
 * A change of client.
 *
 * This is the one with no safe default. A client boundary plausibly separates two Partes — it
 * separates two contracts, two cost centres and two certifications — but asserting that without
 * configuration would be exactly the silent reinterpretation the baseline forbids. So it blocks on
 * missing configuration rather than guessing (RGT-12).
 */
export function clientChange(part: PartState): IdentityDecision {
  if (part.config.clientCutsPart === undefined) {
    return {
      outcome: 'KEEP_PART',
      ruleId: 'RUL-003',
      reason:
        'No hay ReglaCorte configurada para el cambio de cliente. No se corta por inferencia, y el ' +
        'cambio queda registrado como evento para que alguien lo resuelva.',
      effects: ['EventoOperativo'],
      fromDefault: true,
      pendingConfiguration:
        'ReglaCorte por cambio de cliente. Hasta que exista, el corte no se decide automáticamente: ' +
        'un límite inventado acá se arrastraría a la imputación y a la certificación.',
    };
  }
  return part.config.clientCutsPart
    ? {
        outcome: 'NEW_PART',
        ruleId: 'RUL-003',
        reason: 'La ReglaCorte configurada trata el cambio de cliente como frontera de Parte.',
        effects: ['Parte', 'EventoOperativo'],
        fromDefault: false,
      }
    : {
        outcome: 'KEEP_PART',
        ruleId: 'RUL-003',
        reason:
          'La ReglaCorte configurada no trata el cambio de cliente como frontera. Se registra el ' +
          'cambio y sigue el mismo Parte.',
        effects: ['EventoOperativo'],
        fromDefault: false,
      };
}

/**
 * An autonomous sub-work inside the same work package (RUL-007).
 *
 * A new UE, not a new Parte. This is the rule that makes "one time row = one UE" wrong: the driver is
 * a distinguishable result, not a row in a sheet.
 */
export const independentSubwork = (): IdentityDecision => ({
  outcome: 'NEW_EXECUTION_UNIT',
  ruleId: 'RUL-007',
  reason:
    'Mismo work package con un subtrabajo autónomo y un resultado distinguible: se crea una UE ' +
    'nueva dentro del mismo Parte. El driver es el resultado, no una fila de horario.',
  effects: ['UnidadEjecucion'],
  fromDefault: false,
});

/** The non-overridable part of the common table, applied before any pattern-specific rule. */
export function sharedIdentity(change: ContextChange, part: PartState): IdentityDecision | null {
  switch (change.kind) {
    case 'RESOURCE_CHANGED':
      return resourceChange();
    case 'PERSON_CHANGED':
      return personChange();
    case 'WORK_PERMIT_CHANGED':
      return workPermitChange();
    case 'INDEPENDENT_SUBWORK_DETECTED':
      return independentSubwork();
    case 'CLIENT_CHANGED':
      return clientChange(part);
    default:
      return null;
  }
}

/* --------------------------------------------------------------- shared completion */

/**
 * The completion requirements every pattern shares (RUL-033/034).
 *
 * Note what is NOT here: a list of mandatory fields. "Exigir campos que no aplican al tipo" is called
 * out explicitly in the baseline, so the per-pattern requirements come from the strategy and the
 * measurement list comes from the configured components.
 */
export function sharedCompletion(scope: {
  openUnits: number;
  openIntervals: number;
  unitsWithoutResult: number;
  missingMeasurements: readonly string[];
}): readonly CompletionRuleShape[] {
  return [
    {
      ruleId: 'RUL-034',
      satisfied: scope.openUnits === 0,
      requirement: 'Todas las UE del Parte están en un estado terminal.',
      ...(scope.openUnits === 0
        ? {}
        : {
            instead:
              `Cerrar, marcar NO_REALIZADA o anular las ${scope.openUnits} UE abiertas. Cerrar el ` +
              'Parte con trabajo abierto dejaría tiempo sin atribuir.',
          }),
    },
    {
      ruleId: 'RUL-033',
      satisfied: scope.openIntervals === 0,
      requirement: 'No quedan intervalos de tiempo abiertos.',
      ...(scope.openIntervals === 0
        ? {}
        : {
            instead:
              `Cerrar los ${scope.openIntervals} intervalos abiertos con su instante real. Un ` +
              'intervalo sin fin no se puede sumar ni certificar.',
          }),
    },
    {
      ruleId: 'RUL-033',
      satisfied: scope.unitsWithoutResult === 0,
      requirement: 'Cada UE cerrada declara resultado y, si corresponde, causa.',
      ...(scope.unitsWithoutResult === 0
        ? {}
        : { instead: 'Elegir el resultado de cada UE. Un cierre sin resultado no es información.' }),
    },
    {
      ruleId: 'RUL-032',
      satisfied: scope.missingMeasurements.length === 0,
      requirement: 'Las mediciones obligatorias aplicables están registradas.',
      ...(scope.missingMeasurements.length === 0
        ? {}
        : {
            instead:
              `Registrar: ${scope.missingMeasurements.join(', ')}. Sólo se exigen las mediciones ` +
              'que este TipoParte declara; las demás no se piden.',
          }),
    },
  ];
}

interface CompletionRuleShape {
  readonly ruleId: string;
  readonly satisfied: boolean;
  readonly requirement: string;
  readonly instead?: string;
}
