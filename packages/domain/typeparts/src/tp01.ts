/**
 * TP-01 — Intervención.
 *
 * Container: a work package with a specific objective. UE: a result, or an autonomous sub-work inside
 * that objective (RUL-007). The driver of identity is the **objective**, which is why a shift change
 * produces a handover rather than a new Parte (RUL-005) and a change of location produces a
 * transition rather than a cut (RUL-008).
 *
 * The one thing that does cut: the objective itself becoming independent (RUL-004).
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
import { locationChange, sharedCompletion, sharedIdentity, shiftChange } from './shared.ts';

const CAPTURE: Partial<Record<CaptureMoment, CaptureContract>> = {
  // CF-01, sheet 68 row 5.
  UNIT_START: {
    contractId: 'CF-01',
    moment: 'UNIT_START',
    systemKnows: [
      'Plan y asignación',
      'Usuario y perfil operativo',
      'Cliente y TipoParte',
      'Personas y recursos previstos',
      'Ubicación candidata',
      'Gates Habilita y PTW aplicables',
    ],
    humanProvides: ['Confirmar la ubicación si hace falta', 'INICIAR'],
    exceptionsOpen: [
      'Cambio de recurso o de persona',
      'Ubicación ambigua',
      'Trabajo emergente',
    ],
    budgetSeconds: 20,
  },
  // CF-02, row 6.
  DURING: {
    contractId: 'CF-02',
    moment: 'DURING',
    systemKnows: [
      'UE activa',
      'Intervalos abiertos',
      'Recursos y personas presentes',
      'Tiempo acumulado',
      'Ubicación actual',
      'Componentes y mediciones aplicables',
    ],
    humanProvides: [
      'Cambiar categoría de tiempo sólo si no es inferible',
      'Ingresar medición física o evidencia cuando aplica',
    ],
    exceptionsOpen: [
      'Desvío',
      'Espera',
      'Subtrabajo autónomo',
      'Reemplazo de persona o recurso',
      'Evento Habilita',
    ],
    budgetSeconds: 45,
  },
  // CF-03, row 7.
  UNIT_CLOSE: {
    contractId: 'CF-03',
    moment: 'UNIT_CLOSE',
    systemKnows: [
      'Tiempos e intervalos',
      'Evidencias y mediciones requeridas',
      'Bloqueos vigentes',
      'Contexto contractual',
    ],
    humanProvides: ['Elegir resultado', 'Causa si el resultado la exige', 'CERRAR'],
    exceptionsOpen: ['Faltantes reales', 'Trabajo no realizado', 'Error de medición'],
    budgetSeconds: 60,
  },
  // CF-04, row 8.
  PART_CLOSE: {
    contractId: 'CF-04',
    moment: 'PART_CLOSE',
    systemKnows: [
      'UE en estado terminal',
      'Resumen del work package',
      'Tiempos, personas y recursos',
      'Evidencias y bloqueos',
    ],
    humanProvides: ['Confirmar el cierre operativo'],
    exceptionsOpen: ['Alguna UE abierta', 'Inconsistencia temporal'],
    budgetSeconds: 20,
  },
};

export const tp01: TypePartBehavior = {
  id: 'TP-01',
  name: 'Intervención',
  describe:
    'Un work package con un objetivo específico. Cada UE es un resultado o un subtrabajo autónomo ' +
    'dentro de ese objetivo.',

  validateRouteContext(ctx: NormalizedContext): RouteDecision {
    if (ctx.partTypeHint === 'TP-01') {
      return {
        kind: 'APPLICABLE',
        reason: 'La asignación aprobada declara TP-01 como patrón previsto.',
        ruleId: 'RUL-001',
      };
    }
    if (ctx.hasOriginAndDestination) {
      return {
        kind: 'NOT_APPLICABLE',
        reason:
          'El alcance nombra origen y destino, que es el grano de TP-02. Una intervención tiene un ' +
          'objetivo, no un trayecto.',
        ruleId: 'RUL-001',
      };
    }
    if (ctx.hasCrew && !ctx.serviceCode) {
      return {
        kind: 'NOT_APPLICABLE',
        reason:
          'El alcance es una cuadrilla por jornada sin un objetivo de servicio identificado, que es ' +
          'el grano de TP-03.',
        ruleId: 'RUL-001',
      };
    }
    if (ctx.isEmergent && !ctx.serviceCode) {
      // RUL-036: emergent work is allowed to start with context pending. What is NOT allowed is
      // inventing the service in order to make routing look resolved (AP-06).
      return {
        kind: 'AMBIGUOUS',
        reason:
          'Trabajo emergente sin servicio identificado. TP-01 es compatible, pero el servicio queda ' +
          'pendiente y no se completa por defecto.',
        missing: ['serviceCode'],
        ruleId: 'RUL-002',
      };
    }
    return {
      kind: 'APPLICABLE',
      reason: 'Hay un objetivo de servicio identificable y el alcance no es un trayecto ni un turno.',
      ruleId: 'RUL-001',
    };
  },

  evaluateIdentity(change: ContextChange, part: PartState): IdentityDecision {
    const shared = sharedIdentity(change, part);
    if (shared) return shared;

    switch (change.kind) {
      case 'WORK_PACKAGE_CHANGED':
        // RUL-004: the one genuine cut for this pattern — and only when the new objective is
        // independent. "Different task" is not the same as "different work package".
        return change.independentObjective
          ? {
              outcome: 'NEW_PART',
              ruleId: 'RUL-004',
              reason:
                'El objetivo pasa a ser independiente del actual: se termina el alcance vigente ' +
                'según su estado y se crea un TP-01 nuevo.',
              effects: ['Parte', 'VinculoPlanEjecucion'],
              fromDefault: false,
            }
          : {
              outcome: 'NEW_EXECUTION_UNIT',
              ruleId: 'RUL-007',
              reason:
                'El trabajo nuevo pertenece al mismo work package: es una UE más, no un Parte ' +
                'nuevo. Un objetivo no se parte porque aparezca una tarea.',
              effects: ['UnidadEjecucion'],
              fromDefault: false,
            };
      case 'SHIFT_CHANGED':
        return shiftChange(part);
      case 'LOCATION_CHANGED':
        return locationChange(part);
      case 'TRANSPORT_LEG_COMPLETED':
        return {
          outcome: 'KEEP_PART',
          ruleId: 'RUL-003',
          reason:
            'Un tramo de transporte no es un driver de identidad en una intervención: se registra ' +
            'como transición operativa dentro del mismo objetivo.',
          effects: ['TransicionOperativa'],
          fromDefault: false,
        };
      default:
        return {
          outcome: 'KEEP_PART',
          ruleId: 'RUL-003',
          reason: 'Mismo work package y mismo objetivo operacional: se mantiene el TP-01.',
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
      reason: 'Componente configurado para TP-01 en la versión vigente.',
    }));
    out.push({
      code: 'RESULTADO_UE',
      label: 'Resultado de la UE',
      required: true,
      reason: 'RUL-033: una UE cerrada sin resultado no es información.',
    });
    if (ctx.hasMeasurableService) {
      out.push({
        code: 'MEDICION_SERVICIO',
        label: 'Medición del servicio o del activo',
        required: false,
        reason:
          'El servicio declara una métrica. La medición se registra como hecho de campo; que sea ' +
          'certificable lo decide la regla comercial (C-014).',
      });
    }
    return out;
  },

  captureContract: (moment) => CAPTURE[moment] ?? null,

  completionRequirements(scope: CompletionScope): readonly CompletionRule[] {
    return [
      ...sharedCompletion(scope),
      {
        ruleId: 'RUL-033',
        satisfied: scope.pendingEvidence === 0,
        requirement: 'La evidencia exigida por la regla aplicable está entregada.',
        ...(scope.pendingEvidence === 0
          ? {}
          : {
              instead:
                `Esperar o reintentar la subida de ${scope.pendingEvidence} archivo(s). El cierre ` +
                'operativo puede ocurrir, pero no se marca documentalmente completo mientras falte ' +
                'la entrega (RGT-09).',
            }),
      },
    ];
  },

  summaryProjection(): SummaryModel {
    return {
      unitLabel: 'resultado',
      unitLabelPlural: 'resultados',
      containerLabel: 'work package',
      sections: [
        {
          title: 'Resultados del work package',
          kind: 'UNITS',
          note: 'Una UE por resultado o subtrabajo autónomo, no por franja horaria.',
        },
        {
          title: 'Tiempos por categoría',
          kind: 'INTERVALS',
          note: 'Intervalos con instantes reales. Un solapamiento se cuenta una sola vez.',
        },
        {
          title: 'Personas',
          kind: 'PEOPLE',
          note: 'Intervalos de presencia. Un reemplazo cierra uno y abre otro; nada se borra.',
        },
        {
          title: 'Recursos',
          kind: 'RESOURCES',
          note: 'Principal y de apoyo, con sus intervalos.',
        },
        {
          title: 'Mediciones',
          kind: 'MEASUREMENTS',
          note: 'Hechos de campo con su fuente. No son todavía cantidad certificable.',
        },
        {
          title: 'Eventos y handovers',
          kind: 'EVENTS',
          note: 'Desvíos, esperas, cambios de contexto y entregas de turno.',
        },
      ],
    };
  },
};
