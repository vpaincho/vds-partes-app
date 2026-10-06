# Design dirigido: trabajo concreto
S0/S1/S2 68; aplicar 15. No diseño ejecutado por este documento.

| Target | Entrada existente | Estados/casos obligatorios | Output |
|---|---|---|---|
| Preparación/Start | Mi jornada + Inicio | READY vigente/invalidado, PTW aprobado/no vigente, BLOCK/warning/override/confirm | Panel previo y causa/acción |
| Trabajo activo | Tareas/tiempos | TP-01 subtrabajo/handover; TP-02 movimiento; TP-03 acumulación | Componente shared + paneles TP |
| Personas/recursos | Tablas actuales | Presente histórico, reemplazo parcial, inelegible/overlap | Intervalos sin edición retroactiva |
| Cierre | Cierre actual | UE abierta, medición/evidencia falta, contrato pendiente, anticipado | Resumen derivado con controles separados |
| Offline/discrepancias | Badge y autosave | pending/receipt/failure/quota/conflict/bundle viejo | Feedback y resolución comparada |
| Habilita | Matriz actual | PTW lifecycle, Flash standalone/no controlado, caso/acción | Vistas nuevas mínimas |
| Enmienda/Review | Observados/lista–detalle | Operacional vs comercial, versión base/nueva, aprobaciones | Solicitud/corrección trazable |
| UC/Facturación | Bandeja cliente | N:M/partiality/supersession/config falta/ERP unknown | Evolución detalle y boundary mínimo |

P: Design outputs en archivos/component specs con tokens/estados/interacción/focus/empty/loading/error y field provenance. No alterar grano de UE, reglas de corte o gates para hacer caber pantalla. Un flow ambiguo se devuelve como contradicción al owner.

Data mocks de diseño llevan TEST/fixture, no nuevos requisitos contractuales. Diagramas/capturas de baseline son referencia; no «llenar» producción con fake aprobaciones.

Gate de diseño: comparar cada panel con 15, verificar todas decisiones/reglas usadas y entregar anotaciones que Claude Code pueda implementar sin adivinar. Design no es dependencia para modularizar backend; bloquear solo UI afectada cuando falte decisión de interacción. La herramienta concreta de diseño se elige por disponibilidad, sin comprometer arquitectura.
