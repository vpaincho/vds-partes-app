# Modelo físico propuesto
S2 42–44 define 87 entidades lógicas. P: grouping de implementación en `references/canonical/entity_implementation_map.csv` cubre las 87; preserva grano, ownership, FK/temporalidad. No migrar 87 tablas por conteo ni resolver todo con JSONB.

## Grupos relacionales
| Grupo | Persistencia propuesta / integridad |
|---|---|
| Masters | clients, contracts, contract_versions, services, cost_centers, units, people, profiles, resources/types, locations, client_assets, crews; referencias externas por fuente+ID |
| Config | contract_services, allowed_cost_centers, contract_items, rule_definitions/versions, component_configs, person_profiles |
| Planning | demands, plans/versions, planned_assignments/units, requirements, planned_people/resources, readiness_evaluations/invalidations, plan_execution_links |
| Execution | parts, execution_units/versions, person/resource_intervals, execution_locations/measurements, time_intervals, operational_events/transitions, allocations, availability/conflicts |
| Evidence | evidence + typed links; object key/hash/bytes/type/status; documento habilitante reutiliza archivo |
| Habilita | requirements/documents/compliances/evaluations, overrides, permits/UE coverage, events + typed links, classifications/evaluations, cases/actions/notifications/measurements |
| Control | directives/targets + lifecycle events y timestamps |
| Review/commercial | review_decisions/observations/requests, UC/versions/source links, adjustments/conformities, packages/versions/inclusions |
| Billing/platform | lines/lots/attempts/external_refs, command_receipts, domain_outbox, trace, identity/sessions/scopes |

Todas las tablas operativas: ID estable, owner/scope, timestamps UTC, versión de concurrencia cuando se mutan, actor/provenance. Fechas operativas y zona `America/Argentina/Buenos_Aires` explícitas; no cortar universalmente a medianoche. IDs locales generables sin conexión, sin nombres como claves.

## Constraints y versiones
FKs tipadas, unicidad de source ID dentro de proveedor, command ID dentro de scope, no UC-source sin versión válida, cadenas supersession acíclicas. Intervalos: fin > inicio y política de solapamiento por rol/recurso. JSONB para payload rule/context snapshot/extensions validadas; no sustituye links N:M ni checks de integridad.

Plan aprobado, decisiones, versiones cerradas y derivados aceptados son inmutables. Current pointers/projections pueden cambiar; las filas históricas no. FK de UC apunta a `execution_unit_version_id`, no solo al current UE. `expected_version` controla cada comando concurrente.

## No fingir DDL ya validado
Claude Plan Mode entrega esquema ER físico, constraints, índices por queries, transacciones y migraciones ordenadas. Validar las asociaciones opcionales de S2 (por ejemplo Parte PREPARADO frente a mínimo 1 UE al iniciar); usar constraint diferido/servicio, no inventar cardinalidad más estricta.
