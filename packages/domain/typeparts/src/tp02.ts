/**
 * TP-02 — Transporte.
 *
 * Container: a transport assignment with a homogeneous configuration. UE: **one distinguishable
 * movement** — a leg with an origin, a destination and, where it applies, a load.
 *
 * The distinction that matters here: *a trip is not a Parte*. A vehicle doing six runs between the
 * same battery and the same plant in one shift is one assignment with six UE, not six Partes and not
 * one UE with six time rows. The prototype could express neither.
 *
 * Location IS a driver for this pattern — but the driver is the **leg**, not the coordinate. Passing
 * through somewhere is a transition; completing a delivery is a movement.
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
import { sharedCompletion, sharedIdentity, shiftChange } from './shared.ts';

const CAPTURE: Partial<Record<CaptureMoment, CaptureContract>> = {
  // CF-05, sheet 68 row 9.
  UNIT_START: {
    contractId: 'CF-05',
    moment: 'UNIT_START',
    systemKnows: [
      'Origen y destino previstos',
      'Recurso y chofer',
      'Carga prevista',
      'Permisos y contexto aplicables',
    ],
    humanProvides: ['Confirmar origen, destino y carga', 'START del movimiento'],
    exceptionsOpen: ['Cambio real de destino', 'Cambio de carga', 'Cambio de recurso'],
    budgetSeconds: 20,
  },
  // CF-06, row 10.
  UNIT_CLOSE: {
    contractId: 'CF-06',
    moment: 'UNIT_CLOSE',
    systemKnows: [
      'Contexto del destino',
      'Timestamps de salida y llegada',
      'Transición operativa',
      'Carga prevista',
    ],
    humanProvides: ['Confirmar llegada', 'Cantidad real sólo si varió', 'FINALIZAR'],
    exceptionsOpen: ['Incidente', 'Descarga parcial', 'Destino distinto al previsto'],
    budgetSeconds: 20,
  },
  DURING: {
    contractId: 'CF-06',
    moment: 'DURING',
    systemKnows: ['Movimiento activo', 'Intervalos', 'Recurso y chofer', 'Carga declarada'],
    humanProvides: ['Registrar espera o desvío si el sistema no lo detectó'],
    exceptionsOpen: ['Espera en origen o destino', 'Desvío de ruta', 'Evento Habilita'],
    budgetSeconds: 45,
  },
  PART_CLOSE: {
    contractId: 'CF-04',
    moment: 'PART_CLOSE',
    systemKnows: ['Movimientos resueltos', 'Horas y kilómetros', 'Cargas declaradas'],
    humanProvides: ['Confirmar el cierre de la asignación'],
    exceptionsOpen: ['Un movimiento iniciado y sin resolver'],
    budgetSeconds: 20,
  },
};

export const tp02: TypePartBehavior = {
  id: 'TP-02',
  name: 'Transporte',
  describe:
    'Una asignación de transporte. Cada UE es un movimiento distinguible: origen, destino y carga ' +
    'cuando aplica. Un viaje no es un Parte.',

  validateRouteContext(ctx: NormalizedContext): RouteDecision {
    if (ctx.partTypeHint === 'TP-02') {
      return {
        kind: 'APPLICABLE',
        reason: 'La asignación aprobada declara TP-02 como patrón previsto.',
        ruleId: 'RUL-001',
      };
    }
    if (ctx.hasOriginAndDestination) {
      return {
        kind: 'APPLICABLE',
        reason: 'El alcance nombra origen y destino: el grano natural es el movimiento.',
        ruleId: 'RUL-001',
      };
    }
    if (ctx.principalResourceType && /CAMION|CISTERNA|SEMI|ACOPLADO/i.test(ctx.principalResourceType)) {
      // A transport vehicle is a strong hint and a weak proof: the same truck also does
      // interventions. So this is ambiguous and asks, rather than deciding (RUL-002).
      return {
        kind: 'AMBIGUOUS',
        reason:
          `El recurso principal es de transporte (${ctx.principalResourceType}), pero el alcance no ` +
          'declara origen y destino. El mismo camión también hace intervenciones.',
        missing: ['origen', 'destino'],
        ruleId: 'RUL-002',
      };
    }
    return {
      kind: 'NOT_APPLICABLE',
      reason:
        'No hay trayecto en el alcance ni recurso de transporte: no hay movimiento que sea el grano ' +
        'de la UE.',
      ruleId: 'RUL-001',
    };
  },

  evaluateIdentity(change: ContextChange, part: PartState): IdentityDecision {
    const shared = sharedIdentity(change, part);
    if (shared) return shared;

    switch (change.kind) {
      case 'TRANSPORT_LEG_COMPLETED': {
        if (!change.hasNextLeg) {
          return {
            outcome: 'KEEP_PART',
            ruleId: 'RUL-007',
            reason:
              'El movimiento terminó y no hay otro: se cierra la UE y la asignación queda lista ' +
              'para su cierre. No se crea nada.',
            effects: ['UnidadEjecucion'],
            fromDefault: false,
          };
        }
        // Continuity is configuration: a new leg after unloading may be the same assignment or a
        // new one, and that depends on the contract, not on the vehicle.
        const continuity = part.config.transportContinuity;
        if (continuity === 'NEW_PART') {
          return {
            outcome: 'NEW_PART',
            ruleId: 'RUL-004',
            reason:
              'La configuración de continuidad trata cada tramo como una asignación propia, así que ' +
              'el tramo siguiente abre un Parte nuevo.',
            effects: ['Parte', 'VinculoPlanEjecucion'],
            fromDefault: false,
          };
        }
        return {
          outcome: 'NEW_EXECUTION_UNIT',
          ruleId: 'RUL-007',
          reason:
            'El tramo siguiente es otro movimiento distinguible dentro de la misma asignación: una ' +
            'UE nueva. Seis viajes en un turno son seis UE, no seis Partes.',
          effects: ['UnidadEjecucion'],
          fromDefault: continuity === undefined,
          ...(continuity === undefined
            ? {
                pendingConfiguration:
                  'ReglaContinuidad de transporte. Sin configurar se aplica el default conservador ' +
                  '(misma asignación), que preserva el vínculo con el plan.',
              }
            : {}),
        };
      }
      case 'LOCATION_CHANGED':
        // For transport, the leg is the driver and the coordinate is not. Passing through a place is
        // a transition; arriving at the destination is the end of a movement, and that arrives as
        // TRANSPORT_LEG_COMPLETED instead.
        return {
          outcome: 'KEEP_PART',
          ruleId: 'RUL-008',
          reason:
            'En transporte el driver es el tramo, no la coordenada. Pasar por un lugar se registra ' +
            'como transición; llegar al destino cierra el movimiento, que es otro evento.',
          effects: ['EjecucionUbicacion', 'TransicionOperativa'],
          fromDefault: false,
        };
      case 'SHIFT_CHANGED':
        return shiftChange(part);
      case 'WORK_PACKAGE_CHANGED':
        return change.independentObjective
          ? {
              outcome: 'NEW_PART',
              ruleId: 'RUL-004',
              reason:
                'El alcance de transporte pasa a ser independiente del actual: asignación nueva.',
              effects: ['Parte', 'VinculoPlanEjecucion'],
              fromDefault: false,
            }
          : {
              outcome: 'NEW_EXECUTION_UNIT',
              ruleId: 'RUL-007',
              reason: 'Mismo alcance de transporte con otro movimiento: una UE más.',
              effects: ['UnidadEjecucion'],
              fromDefault: false,
            };
      default:
        return {
          outcome: 'KEEP_PART',
          ruleId: 'RUL-003',
          reason: 'Misma asignación de transporte y misma configuración: se mantiene el TP-02.',
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
      reason: 'Componente configurado para TP-02 en la versión vigente.',
    }));
    out.push(
      {
        code: 'ROL_ORIGEN',
        label: 'Ubicación de origen',
        required: true,
        reason: 'RUL-031: el origen del movimiento es un maestro, no texto libre.',
      },
      {
        code: 'ROL_DESTINO',
        label: 'Ubicación de destino',
        required: true,
        reason: 'RUL-031: el destino del movimiento es un maestro, no texto libre.',
      },
    );
    if (ctx.hasMeasurableService) {
      // Solids and liquids are COMPONENTS of the same pattern, not separate applications. The
      // baseline is explicit that a new cargo branch does not justify a new TipoParte.
      out.push({
        code: 'CARGA',
        label: 'Carga: tipo y cantidad',
        required: false,
        reason:
          'La rama de carga (sólidos, líquidos) es un componente de TP-02, no un TipoParte aparte. ' +
          'Se precarga lo previsto y manda la realidad; sólo se pide el delta (IH-10).',
      });
    }
    return out;
  },

  captureContract: (moment) => CAPTURE[moment] ?? null,

  completionRequirements(scope: CompletionScope): readonly CompletionRule[] {
    const unresolved = scope.unresolvedLegs ?? 0;
    return [
      ...sharedCompletion(scope),
      {
        ruleId: 'RUL-034',
        satisfied: unresolved === 0,
        requirement: 'Todos los movimientos iniciados están resueltos.',
        ...(unresolved === 0
          ? {}
          : {
              instead:
                `Cerrar o declarar no realizado ${unresolved} movimiento(s). Un movimiento ` +
                'iniciado y sin resolver deja la carga sin destino declarado.',
            }),
      },
    ];
  },

  summaryProjection(): SummaryModel {
    return {
      unitLabel: 'movimiento',
      unitLabelPlural: 'movimientos',
      containerLabel: 'asignación de transporte',
      sections: [
        {
          title: 'Secuencia de movimientos',
          kind: 'MOVEMENTS',
          note: 'Uno por tramo distinguible, en orden. Seis viajes en un turno son seis UE.',
        },
        {
          title: 'Salida, llegada y espera',
          kind: 'INTERVALS',
          note: 'Instantes reales por tramo. La espera se registra aunque el contrato no la pague.',
        },
        {
          title: 'Carga declarada',
          kind: 'MEASUREMENTS',
          note: 'Previsto como candidato; la realidad manda y se pide sólo la diferencia.',
        },
        {
          title: 'Recurso y chofer',
          kind: 'RESOURCES',
          note: 'Principal, semi o acoplado y apoyo, con sus intervalos.',
        },
        {
          title: 'Personas',
          kind: 'PEOPLE',
          note: 'Intervalos de presencia, con los reemplazos como hechos.',
        },
        {
          title: 'Eventos del trayecto',
          kind: 'EVENTS',
          note: 'Incidentes, desvíos, descargas parciales y destinos distintos al previsto.',
        },
      ],
    };
  },
};
