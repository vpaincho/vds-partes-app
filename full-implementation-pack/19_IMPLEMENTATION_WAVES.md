# Waves de una única aplicación final
P: orden por dependencias; cada wave deja integración runnable y regression KEEP. Ninguna wave intermedia se vende como producto completo.

| Wave | Construcción / dependencias | Salida integrada y gate |
|---|---|---|
| W0 | Fijar fuentes/fixtures/capturas, mapa 87/RUL/GS, repo target, ADR/contratos de todos TP | Plan aprobado; target global ya definido; no cambio visual arbitrario |
| W1 | DB/migrations, identity fixture+server permissions, masters/config/rules/trace, storage, receipts/outbox, contratos sync | API/DB real y skeleton shell Juan; tests de fuentes/scopes/atomicidad |
| W2 | Planning versionado + readiness/Habilita Prevent/PTW mínimo + control + bundles | Gantt/recurso/mes/drawer reales; aprobar/despachar/directivas con historia; Start gates disponibles antes de ejecución |
| W3 | Core Parte/UE, tiempos/personas/recursos/ubicación/medición/evidencia/cierre/enmienda/emergente y estrategias TP-01/02/03 | Tres journeys sobre mismo core; Planning N:M enlazado; tests de identidad/PTW temporal |
| W4 | Mi jornada/trabajo activo completo + offline outbox/ACK/reconcile/conflicts/evidence + Flash y Habilita response/control | Reinicio/retry/evento standalone/caso/acciones funcionan; UI y sync reales, no toggles |
| W5 | Review versionado + UC N:M/quantities/eligibility/observations/adjustments/supersession/packages + billing adapter | Ciclo Planning→Execution→Review→Commercial→ERP fixture; source invalidation verificada |
| W6 | Dashboards con fuente/drilldown, config UI mínima completa, restantes commands/lifecycles, adapters/ops/QA | Coverage global 02 + GS/constraints/UX; release funcional íntegra con proveedores TEST |
| W7 | Fuentes/permisos/red/config real, proveedor auth/documental/ERP, despliegue/productización y pruebas de campo | Etapa posterior de conexión/validación; sin reconstrucción core por diseño |

Trace/auth/idempotencia se construyen W1, no al final. Gates PTW/readiness W2, antes de Start W3. Offline se diseña W0/W1 y completa W4, antes de release de campo. UI añade flow de cada módulo al hacerlo; no esperar W6 para mostrar trabajo real. W6 no es cajón para funcionalidades sin dueño.

Dependencias comerciales parametrizadas permiten fixture TEST; ausencia de conexión no detiene W1–W6. Ausencia de regla real produce pending-config y variante fixture, no invención productiva.

## Gestión de entrega
Commit boundaries dentro de waves: contracts → migrations → services/commands → UI → pruebas. Ejecutar checks pertinentes y regression preservada; no migraciones destructivas sin revisión. Mantener changelog, matriz coverage, decisiones abiertas por clase (14). Una falla no habilita eliminar módulo; resolver o declarar pendiente con impacto.

DoD W6: todos módulos y tres TP completos según 02/17, API/DB reales, permisos servidor, storage/sync/concurrency/trace, runbook/restore básico y adapters contract tested. W7 es conexión/productización; si QA revela bug interno se corrige, no se promete que «solo credenciales» eliminan toda validación.
