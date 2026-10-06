# Planning y Control Plane
S1 vistas existentes; S2 42–44, 49, 52, RUL-009–020/054–058, GS-001–004/026–027.

## Recorrido
Crear demanda/alcance → programar requerimientos → nominar si corresponde → validar versión → aprobar snapshot → readiness temporal → despachar contexto → vincular realidad N:M → evaluar cumplimiento/no realizado. Cerrar Parte no marca CUMPLIDA automáticamente: alcance real debe satisfacer intención.

Gantt, recurso y mes leen la misma projection y cambian período explícito. Drawer integra contexto, tareas, nominaciones/readiness, versiones, directivas y Partes/UE vinculados. Extensión/cierre anticipado son solicitudes/decisiones sobre futuro; conservar rango aprobado original para plan–real.

## Comandos y API propuesta P
`POST /planning/demands`, `POST /planning/plans`, `POST /planning/plans/:id/versions`; comandos validate/approve/nominate/evaluate-readiness/dispatch/supersede/close-no-realizada. Lecturas timeline/resource-calendar/month/details/plan-vs-real. No endpoint que acorte el plan histórico al cerrar ejecución.

Conflicto se calcula por ID estable, scope, intervalo y compatibilidad; excluir el propio agregado incluso cuando se evalúa copia/propuesta. PL-093 es regresión. P: overlaps durante draft pueden advertir; bloqueo final según regla, no exclusividad universal.

## Directivas
Post-despacho: nueva versión y/o directiva según efecto. Tipos cancelar/suspender/reprogramar/repriorizar/cambio-alcance; target Parte/UE/Asignación tipado. Emitir, recibir, reconocer, aplicar, rechazar con causa, cancelar antes de aplicación, expirar.
Aplicación exige evidencia del efecto y gates del target. Offline no permite afirmar aplicación por emisión. Una orden aplicada se compensa con otra, no se cancela retroactivamente.

Readiness guarda evaluado_at/valid_until y dependencias/versiones. Cambios de documento, recurso, alcance o ventana invalidan evaluación; al Start se vuelve a evaluar.

DoD: vistas preservadas conectadas a DB, aprobación inmutable, despacho/bundle trazable y escenarios anteriores más cierre anticipado/auto-conflicto aprobados.
