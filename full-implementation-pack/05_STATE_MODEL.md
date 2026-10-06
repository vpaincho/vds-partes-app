# Estados y comandos
Authority: S2 49–56. Extractos íntegros por hoja en references/canonical. El resumen no es lista exhaustiva de transiciones.

| Owner | Estados canónicos principales |
|---|---|
| Plan | ABIERTA, ACTIVA, CERRADA, CANCELADA |
| PlanVersion | BORRADOR, EN_VALIDACION, APROBADA, SUPERSEDIDA; RECHAZADA |
| Asignación | PROGRAMADA, READY, DESPACHADA, CUMPLIDA, NO_REALIZADA, CANCELADA, SUPERSEDIDA |
| Parte | PREPARADO, EN_EJECUCION, SUSPENDIDO, CERRADO_OPERATIVAMENTE, ANULADO |
| UE | PENDIENTE, EN_EJECUCION, SUSPENDIDA, CERRADA, NO_REALIZADA, ANULADA |
| PTW | BORRADOR, PENDIENTE_APROBACION, APROBADO, VIGENTE, SUSPENDIDO, CERRADO, RECHAZADO, VENCIDO, ANULADO |
| Directiva | EMITIDA, RECIBIDA, RECONOCIDA, APLICADA, RECHAZADA, CANCELADA, EXPIRADA |
| EventoHabilita | REPORTADO, EN_TRIAGE, CLASIFICADO, ESCALADO_A_CASO, CERRADO_SIN_CASO, DESCARTADO |
| Caso | ABIERTO, EN_INVESTIGACION, SEGUIMIENTO_ACCIONES, LISTO_PARA_CIERRE, CERRADO |
| Acción | PENDIENTE, EN_PROGRESO, IMPLEMENTADA, EN_VERIFICACION, VERIFICADA; CANCELADA con causa |
| UC certificación | INCOMPLETA, ELEGIBLE, EN_REVISION, OBSERVADA, ACEPTADA, RECHAZADA |
| UC supersession | VIGENTE, REQUIERE_RECALCULO, EN_REVISION, SUSTITUIDA, INVALIDADA |
| Paquete | BORRADOR, LISTO_PARA_ENVIO, ENVIADO, EN_REVISION, OBSERVADO, ACEPTADO_PARCIAL, ACEPTADO, RECHAZADO, SUSTITUIDO |
| Lote | BORRADOR, VALIDADO, ENVIADO_ERP, ACEPTADO_ERP, ERROR_ERP, CANCELADO |

## Dimensiones adicionales propuestas P
Review VDS por versión: PENDIENTE_REVISION → EN_REVISION → ACEPTADA / OBSERVADA; una resolución genera decisión nueva referenciada, no «reabrir Parte». Política de elegibilidad comercial por revisión se configura explícitamente.
Entrega por comando/archivo: GUARDADO_LOCAL, PENDIENTE, ENVIANDO, ENVIADO, RECIBIDO, REQUIERE_INTERVENCION. ENVIADO no prueba commit; RECIBIDO requiere receipt durable del servidor. No confundir ACK técnico con ACK semántico de Directiva.
Imputación/config: RESUELTO, PENDIENTE, AMBIGUO y PENDIENTE_CONFIGURACION se muestran en su dimensión, no como nuevos estados universales de Parte.

## Contrato de transición
Cada comando declara actor/capability, subject tipado, from, timestamp efectivo, expected_version, gates, to, effects y trace. REST no permite PATCH arbitrario de estado. UI puede sintetizar badge con prioridad documentada y acceso a dimensiones originales.

No reabrir Parte/UE cerrado para corregir; usar enmienda. Excepción explícita: Caso cerrado puede reabrirse por evidencia/autoridad (T-CH06); eso agrega historia. PTW vencido no autocierra; cierre administrativo exige política/autoridad (51 fila 34), no transición inferida por reloj.
