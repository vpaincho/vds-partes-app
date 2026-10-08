/**
 * TP-03 — Cuadrilla.
 *
 * Container: a crew over a shift or an operational day. UE: **the real distinguishable work that
 * accumulated** during it.
 *
 * This is the pattern the prototype got most wrong, and the error has a name: *fila horaria = UE*.
 * `stReg` held a sheet of hourly rows and `sums()` added them up, so eight hours of two overlapping
 * tasks became sixteen, and two jobs in the same hour became one row. Here the UE is the work, the
 * interval is the time, and the two are separate records.
 *
 * The second thing it gets right: the shift boundary is **configuration**, not midnight. C-013 and
 * RGT-10 forbid cutting the operational day by UTC or by local midnight, so the boundary comes from
 * `config.shiftBoundary` and its absence is stated rather than filled in.
 */
import type {
  CaptureContract,
  CaptureMoment,
  ComponentContext,
  ComponentRequirement,
  CompletionRule,
  CompletionScope,
  ContextChange,
  IdentityDecision,
  NormalizedContext,
  PartState,
  RouteDecision,
  SummaryModel,
  TypePartBehavior,
} from './contract.ts';
import { locationChange, sharedCompletion, sharedIdentity } from './shared.ts';

const CAPTURE: Partial<Record<CaptureMoment, CaptureContract>> = {
  // CF-07, sheet 68 row 11.
  DURING: {
    contractId: 'CF-07',
    moment: 'DURING',
    systemKnows: [
      'Roster real con sus intervalos',
      'Recursos presentes',
      'UE y trabajos de la jornada',
      'Tiempos y eventos acumulados',
    ],
    humanProvides: ['Sólo registrar las excepciones que el sistema no capturó'],
    exceptionsOpen: [
      'Reemplazo de persona o recurso',
      'Trabajo adicional',
      'Trabajo no realizado',
      'Espera',
    ],
    budgetSeconds: null,
  },
  // CF-08, row 12.
  PART_CLOSE: {
    contractId: 'CF-08',
    moment: 'PART_CLOSE',
    systemKnows: [
      'Roster y recursos con sus intervalos',
      'UE del turno',
      'Horas por categoría',
      'Resumen real acumulado',
    ],
    humanProvides: ['Confirmar el resumen', 'Agregar la novedad excepcional si falta'],
    exceptionsOpen: ['Inconsistencia temporal', 'UE abierta'],
    budgetSeconds: 45,
  },
  UNIT_START: {
    contractId: 'CF-07',
    moment: 'UNIT_START',
    systemKnows: ['Cuadrilla activa', 'Ubicación actual', 'Contexto del turno', 'Gates aplicables'],
    humanProvides: ['Describir el trabajo', 'INICIAR'],
    exceptionsOpen: ['Trabajo fuera del alcance previsto', 'Ubicación no prevista'],
    budgetSeconds: 20,
  },
  UNIT_CLOSE: {
    contractId: 'CF-03',
    moment: 'UNIT_CLOSE',
    systemKnows: ['Intervalos del trabajo', 'Personas que participaron', 'Mediciones aplicables'],
    humanProvides: ['Elegir resultado', 'Causa si corresponde', 'CERRAR'],
    exceptionsOpen: ['No realizado', 'Faltante real'],
    budgetSeconds: 60,
  },
};

export const tp03: TypePartBehavior = {
  id: 'TP-03',
  name: 'Cuadrilla',
  describe:
    'Una cuadrilla por jornada o turno. Cada UE es un trabajo real distinguible que se acumuló ' +
    'durante el turno. Una fila horaria no es una UE.',

  validateRouteContext(ctx: NormalizedContext): RouteDecision {
    if (ctx.partTypeHint === 'TP-03') {
      return {
        kind: 'APPLICABLE',
        reason: 'La asignación aprobada declara TP-03 como patrón previsto.',
        ruleId: 'RUL-001',
      };
    }
    if (ctx.hasOriginAndDestination) {
      return {
        kind: 'NOT_APPLICABLE',
        reason: 'El alcance es un trayecto, que es el grano de TP-02 y no de una jornada.',
        ruleId: 'RUL-001',
      };
    }
    if (!ctx.hasCrew) {
      return {
        kind: 'NOT_APPLICABLE',
        reason: 'No hay cuadrilla asignada: no hay contenedor de jornada.',
        ruleId: 'RUL-001',
      };
    }
    if (ctx.config.shiftBoundary === undefined) {
      // The pattern applies; what is missing is where its day ends. Stating that is the point —
      // falling back to midnight is precisely the RGT-10 defect.
      return {
        kind: 'AMBIGUOUS',
        reason:
          'TP-03 es aplicable, pero la frontera de jornada o turno no está configurada para este ' +
          'contrato. No se corta por medianoche: eso es lo que RGT-10 prohíbe.',
        missing: ['shiftBoundary'],
        ruleId: 'RUL-002',
      };
    }
    return {
      kind: 'APPLICABLE',
      reason:
        'Hay cuadrilla y la frontera de jornada está configurada: el turno es el contenedor y el ' +
        'trabajo real es la UE.',
      ruleId: 'RUL-001',
    };
  },

  evaluateIdentity(change: ContextChange, part: PartState): IdentityDecision {
    const shared = sharedIdentity(change, part);
    if (shared) return shared;

    switch (change.kind) {
      case 'SHIFT_CHANGED': {
        // For a crew pattern the shift IS the container, so this is the one place where a shift
        // change plausibly cuts. It still depends on configuration: a 12×12 rotation that hands over
        // mid-job is not the same as a day shift that ends the day.
        if (part.config.shiftCutsPart === undefined) {
          return {
            outcome: 'HANDOVER',
            ruleId: 'RUL-005',
            reason:
              'Sin ReglaCorte configurada se aplica el default conservador: se mantiene el Parte, se ' +
              'genera handover, se cierran y abren los intervalos y se revalidan los gates.',
            effects: ['EventoHandover', 'AsignacionPersonaEjecucion', 'ReevaluacionPTW'],
            fromDefault: true,
            pendingConfiguration:
              'ReglaCorte por turno para TP-03. Hasta que exista, el turno no parte el Parte: ' +
              'preservar la continuidad del trabajo es menos dañino que inventar una frontera.',
          };
        }
        return part.config.shiftCutsPart
          ? {
              outcome: 'NEW_PART',
              ruleId: 'RUL-005',
              reason:
                'La ReglaCorte configurada trata el turno como frontera del contenedor, así que el ' +
                'turno nuevo es un Parte nuevo con su propio roster.',
              effects: ['Parte', 'VinculoPlanEjecucion', 'EventoHandover'],
              fromDefault: false,
            }
          : {
              outcome: 'HANDOVER',
              ruleId: 'RUL-005',
              reason:
                'La ReglaCorte configurada no parte por turno: el Parte continúa con un handover y ' +
                'los intervalos del roster se cierran y abren.',
              effects: ['EventoHandover', 'AsignacionPersonaEjecucion', 'ReevaluacionPTW'],
              fromDefault: false,
            };
      }
      case 'WORK_PACKAGE_CHANGED':
        // A crew taking on another job during the shift is the normal case, not a new Parte: the
        // container is the shift, and the new job is another accumulated UE.
        return {
          outcome: 'NEW_EXECUTION_UNIT',
          ruleId: 'RUL-007',
          reason:
            'La cuadrilla toma otro trabajo dentro del mismo turno: es una UE más. El contenedor es ' +
            'la jornada, así que un trabajo distinto no abre un Parte.',
          effects: ['UnidadEjecucion'],
          fromDefault: false,
        };
      case 'LOCATION_CHANGED':
        return locationChange(part);
      case 'TRANSPORT_LEG_COMPLETED':
        return {
          outcome: 'KEEP_PART',
          ruleId: 'RUL-008',
          reason:
            'El traslado de la cuadrilla entre frentes se registra como transición operativa: el ' +
            'tiempo queda atribuido y no huérfano (C-013).',
          effects: ['TransicionOperativa'],
          fromDefault: false,
        };
      default:
        return {
          outcome: 'KEEP_PART',
          ruleId: 'RUL-003',
          reason: 'Mismo turno y misma cuadrilla: se mantiene el TP-03.',
          effects: ['EventoOperativo'],
          fromDefault: false,
        };
    }
  },

  requiredComponents(ctx: ComponentContext): readonly ComponentRequirement[] {
    const out: ComponentRequirement[] = ctx.configured.map((c) => ({
      code: c.code,
      label: c.code,
      required: c.required,
      reason: 'Componente configurado para TP-03 en la versión vigente.',
    }));
    out.push({
      code: 'ROSTER_REAL',
      label: 'Roster real del turno',
      required: true,
      reason:
        'CAP-061: el roster se autoderiva de los intervalos reales y sólo se confirma la excepción. ' +
        'No se reconstruye la lista a mano, y una corrección es un evento.',
    });
    if (ctx.hasMeasurableService) {
      out.push({
        code: 'MEDICION_UE',
        label: 'Medición por trabajo, si aplica',
        required: false,
        reason: 'La métrica es por UE y no por turno: el turno no es la unidad de medida.',
      });
    }
    return out;
  },

  captureContract: (moment) => CAPTURE[moment] ?? null,

  completionRequirements(scope: CompletionScope): readonly CompletionRule[] {
    const confirmed = scope.shiftSummaryConfirmed ?? false;
    return [
      ...sharedCompletion(scope),
      {
        ruleId: 'RUL-034',
        satisfied: confirmed,
        requirement: 'El resumen acumulado del turno está confirmado (CF-08).',
        ...(confirmed
          ? {}
          : {
              instead:
                'Revisar el resumen derivado y confirmarlo, agregando la novedad excepcional si ' +
                'falta. El sistema lo arma; la cuadrilla lo valida.',
            }),
      },
    ];
  },

  summaryProjection(): SummaryModel {
    return {
      unitLabel: 'trabajo',
      unitLabelPlural: 'trabajos',
      containerLabel: 'turno',
      sections: [
        {
          title: 'Trabajos del turno',
          kind: 'UNITS',
          note: 'Una UE por trabajo real distinguible. Una fila horaria no es una UE.',
        },
        {
          title: 'Horas por categoría',
          kind: 'INTERVALS',
          note:
            'Intervalos con instantes reales. Un solapamiento se cuenta una vez: ocho horas de dos ' +
            'tareas simultáneas son ocho, no dieciséis.',
        },
        {
          title: 'Roster real',
          kind: 'PEOPLE',
          note: 'Derivado de los intervalos. Un reemplazo cierra uno y abre otro.',
        },
        {
          title: 'Equipo presente',
          kind: 'RESOURCES',
          note: 'Derivado de los intervalos reales, no de la nominación prevista.',
        },
        {
          title: 'Mediciones por trabajo',
          kind: 'MEASUREMENTS',
          note: 'Por UE donde aplique. El turno no es la unidad de medida.',
        },
        {
          title: 'Novedades del turno',
          kind: 'EVENTS',
          note: 'Esperas, no realizados, reemplazos, handover y eventos Habilita.',
        },
      ],
    };
  },
};
