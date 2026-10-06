# Reglas, invariantes y trace
Authority S2: 44 (36 invariantes), 57 (74 reglas), 58, 63. Catálogos exactos incluidos en references/canonical.

## Familias y cobertura
| Reglas | Responsable |
|---|---|
| RUL-001–008 | Routing/identidad/cortes |
| RUL-009–020 | Planning/readiness/dispatch |
| RUL-021–038 | Execution/tiempos/cierre/emergente |
| RUL-039–046 | Habilita/gates/overrides/PTW |
| RUL-047–053 | Flash/triage/escalamiento/caso |
| RUL-054–058 | Control/directiva |
| RUL-059–069 | Commercial/UC/paquete |
| RUL-070–072 | Billing/ERP |
| RUL-073–074 | Enmienda/DecisionTrace |

Motor interno determinista: normalizar contexto → ruleset vigente → P0 historia/lineage → P1 Habilita → P2 estados → P3 control → P4 routing → P5 operación → P6 comercial → P7 UX. P8 advisory no decide core.

A mismo nivel: vigencia → especificidad Item/CS/cliente sobre servicio/TP/global → contexto exacto → configuración explícita admitida. Empate incompatible sin prioridad: BLOCK + escalamiento. No resolver por orden de carga. Override solo satisface excepción declarada por la misma regla; no vence hard block.

## DecisionEnvelope
decision ALLOW/BLOCK/WARN/REQUIRE_CONFIRMATION/NO_OP; subject; trigger; current/target state; blocks/warnings; confirmations_required; side_effects; rules_applied/candidates; ruleset_version. P: añadir decision_id, evaluated_at, context_hash, expected_version y correlation. Distinguir evaluación preview de decisión ejecutada.

Trace persiste actor, inputs normalizados, provenance, versiones efectivas, reglas ganadoras/descartadas relevantes, override, outcome y efectos referenciados. BLOCK también tiene trace/receipt sin efectos operativos. Motivos legibles, no solo IDs.

No editar pasado con reglas actuales. Datos reportados tarde guardan ocurrido_at/registrado_at; replay histórico y autorización actual son decisiones distintas. Una firma posterior no autoriza retroactivamente.

## Enforcements mínimos
DB: referential/uniqueness/temporal integrity. Domain: C-001–036 y máquinas. API: scopes y validación. UI: feedback y captura, sin monopolizar reglas.
`PENDIENTE_CONFIGURACION` bloquea comercial definitivo si faltan reglas; no rellena thresholds ni pagos. Fixtures de reglas rotuladas TEST, fuera de configuración productiva.

DoD: cada RUL/C tiene test(s)/módulo o justificación explícita de parametrización; ningún PASS documental se reporta como software ejecutado.
