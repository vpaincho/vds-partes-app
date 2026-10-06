# Golden acceptance — extracción literal S2

56 escenarios. Resultado PASS es el del diccionario, no evidencia de ejecución de software. Resolver diferencias de resumen/estado contra máquinas finales y registrar contradicción.

## GS-001 — Plan aprobado y despachado

Fuente: hoja 70_Golden_Scenarios_Master, fila 5.

**Scenario**: GS-001

**Dominio**: PLANIFICACIÓN

**Clase**: HAPPY PATH

**Nombre**: Plan aprobado y despachado

**GIVEN**: Demanda válida; PlanificacionVersion en validación; asignación consistente y sujetos elegibles.

**WHEN**: Planificación aprueba versión y ejecuta readiness.

**THEN esperado**: Versión APROBADA; Asignacion PROGRAMADA→READY→DESPACHADA; ExecutionContextBundle versionado.

**No debe ocurrir**: No crear Parte todavía ni confundir DESPACHADA con EN_EJECUCION.

**Reglas clave**: RUL-010,RUL-013,RUL-014,RUL-016,RUL-017

**Objetos/relaciones**: PlanificacionVersion, AsignacionPlanificada, EvaluacionPlanificacion, Bundle

**State transitions**: BORRADOR→APROBADA / PROGRAMADA→READY→DESPACHADA

**UX / tiempo**: 0 s campo

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-002 — Readiness invalidado después de READY

Fuente: hoja 70_Golden_Scenarios_Master, fila 6.

**Scenario**: GS-002

**Dominio**: PLANIFICACIÓN

**Clase**: ADVERSARIAL

**Nombre**: Readiness invalidado después de READY

**GIVEN**: Asignación READY con recurso/persona/documental vigente.

**WHEN**: Vence un requisito o cambia recurso/ventana antes del inicio.

**THEN esperado**: EventoInvalidacionReadiness; READY deja de habilitar despacho/inicio hasta reevaluación.

**No debe ocurrir**: No mantener READY como checkbox eterno.

**Reglas clave**: RUL-015,RUL-013,RUL-014

**Objetos/relaciones**: EvaluacionPlanificacion, EventoInvalidacionReadiness

**State transitions**: READY→PROGRAMADA/REEVALUAR

**UX / tiempo**: 0 s campo

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-003 — Cambio post-despacho con campo desconectado

Fuente: hoja 70_Golden_Scenarios_Master, fila 7.

**Scenario**: GS-003

**Dominio**: PLANIFICACIÓN

**Clase**: OFFLINE

**Nombre**: Cambio post-despacho con campo desconectado

**GIVEN**: Asignación DESPACHADA; tablet conserva snapshot válido; planificación cambia prioridad/alcance.

**WHEN**: Se aprueba una nueva versión mientras campo está offline.

**THEN esperado**: Snapshot original no se muta; se emite DirectivaOperativa / nueva versión; aplicación espera recepción.

**No debe ocurrir**: No cambiar retroactivamente lo que el dispositivo ya recibió.

**Reglas clave**: RUL-020,RUL-054,RUL-055

**Objetos/relaciones**: PlanificacionVersion, DirectivaOperativa, Bundle

**State transitions**: Directiva —→EMITIDA (hasta recepción)

**UX / tiempo**: 0 s campo inmediato

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-004 — Cancelar plan con ejecución ya iniciada

Fuente: hoja 70_Golden_Scenarios_Master, fila 8.

**Scenario**: GS-004

**Dominio**: PLANIFICACIÓN

**Clase**: ADVERSARIAL

**Nombre**: Cancelar plan con ejecución ya iniciada

**GIVEN**: Plan ACTIVO y una UE real EN_EJECUCION.

**WHEN**: Alguien intenta CANCELAR_PLAN_COMPLETO.

**THEN esperado**: Bloquear cancelación destructiva; usar DirectivaOperativa y resolver ejecuciones/asignaciones.

**No debe ocurrir**: No convertir ejecución real en inexistente.

**Reglas clave**: P0/P2 + State Machine Planificacion + RUL-054

**Objetos/relaciones**: Planificacion, Parte, UE, Directiva

**State transitions**: ACTIVA permanece; UE se resuelve por Control Plane

**UX / tiempo**: 0 s campo

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-005 — TipoParte derivado por perfil/contexto

Fuente: hoja 70_Golden_Scenarios_Master, fila 9.

**Scenario**: GS-005

**Dominio**: ROUTING

**Clase**: HAPPY PATH

**Nombre**: TipoParte derivado por perfil/contexto

**GIVEN**: Persona autenticada, perfil operativo vigente, asignación y servicio conocidos.

**WHEN**: Se prepara inicio de trabajo.

**THEN esperado**: Motor deriva TipoParte correcto y crea Parte/UE idempotentes.

**No debe ocurrir**: No mostrar selector libre como camino normal.

**Reglas clave**: RUL-001,RUL-021,RUL-074

**Objetos/relaciones**: PersonaPerfilOperativo, TipoParte, Parte, UE, DecisionTrace

**State transitions**: —→PREPARADO / —→PENDIENTE

**UX / tiempo**: UX-01 ≈5 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-006 — Ruteo ambiguo

Fuente: hoja 70_Golden_Scenarios_Master, fila 10.

**Scenario**: GS-006

**Dominio**: ROUTING

**Clase**: ADVERSARIAL

**Nombre**: Ruteo ambiguo

**GIVEN**: Dos TipoParte resultan compatibles con el contexto.

**WHEN**: El motor no puede discriminar confiablemente.

**THEN esperado**: Pedir confirmación mínima o escalar; registrar candidatos y decisión.

**No debe ocurrir**: No elegir silenciosamente por orden de catálogo.

**Reglas clave**: RUL-002,RUL-074

**Objetos/relaciones**: TipoParte, DecisionTrace

**State transitions**: sin transición hasta resolución

**UX / tiempo**: ≤20 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-007 — Intervención planificada normal

Fuente: hoja 70_Golden_Scenarios_Master, fila 11.

**Scenario**: GS-007

**Dominio**: TP-01

**Clase**: HAPPY PATH

**Nombre**: Intervención planificada normal

**GIVEN**: TP-01 PREPARADO, UE PENDIENTE, Habilita/doc OK, PTW VIGENTE.

**WHEN**: Operario confirma ubicación e inicia.

**THEN esperado**: Parte/UE pasan EN_EJECUCION; persona/recurso/timestamps/contexto se derivan.

**No debe ocurrir**: No recapturar cliente, tipo de parte, roster, recursos ni reglas.

**Reglas clave**: RUL-022,RUL-023,RUL-024,RUL-031

**Objetos/relaciones**: Parte, UE, asignaciones, ubicación, PTW

**State transitions**: PREPARADO→EN_EJECUCION / PENDIENTE→EN_EJECUCION

**UX / tiempo**: UX-01 ≈5 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-008 — Cambio de turno sin cambio de work package

Fuente: hoja 70_Golden_Scenarios_Master, fila 12.

**Scenario**: GS-008

**Dominio**: TP-01

**Clase**: TEMPORAL

**Nombre**: Cambio de turno sin cambio de work package

**GIVEN**: TP-01 EN_EJECUCION con turno A y PTW aplicable.

**WHEN**: Ingresa turno B.

**THEN esperado**: Mismo TP-01; handover; cerrar/abrir intervalos; revalidar Habilita/PTW.

**No debe ocurrir**: No crear Parte nuevo solo por turno.

**Reglas clave**: RUL-005,RUL-025,RUL-044

**Objetos/relaciones**: Parte, AsignacionPersonaEjecucion, EventoOperativo/Handover, PTW

**State transitions**: Parte permanece EN_EJECUCION

**UX / tiempo**: UX-03 ≈26 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-009 — Reemplazo de operario

Fuente: hoja 70_Golden_Scenarios_Master, fila 13.

**Scenario**: GS-009

**Dominio**: TP-01

**Clase**: TEMPORAL

**Nombre**: Reemplazo de operario

**GIVEN**: UE EN_EJECUCION con persona A.

**WHEN**: Persona A sale y persona B elegible la reemplaza.

**THEN esperado**: Cerrar intervalo A; abrir intervalo B; mantener Parte/UE.

**No debe ocurrir**: No editar persona original ni crear Parte nuevo.

**Reglas clave**: RUL-025,RUL-039

**Objetos/relaciones**: AsignacionPersonaEjecucion, EvaluacionHabilitacion

**State transitions**: UE permanece EN_EJECUCION

**UX / tiempo**: UX-04 ≈12 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-010 — Reemplazo por persona no habilitada

Fuente: hoja 70_Golden_Scenarios_Master, fila 14.

**Scenario**: GS-010

**Dominio**: TP-01

**Clase**: TEMPORAL

**Nombre**: Reemplazo por persona no habilitada

**GIVEN**: UE activa; candidato B disponible pero falla requisito crítico Habilita.

**WHEN**: Supervisor intenta seleccionarlo.

**THEN esperado**: Hard block; reemplazo no se materializa.

**No debe ocurrir**: No permitir por necesidad operativa ni por override comercial.

**Reglas clave**: RUL-039,RUL-041,RUL-027

**Objetos/relaciones**: Persona, CumplimientoHabilitacion, ConflictoTemporal

**State transitions**: sin cambio

**UX / tiempo**: UX-04 bloqueado

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-011 — Recurso adicional como apoyo

Fuente: hoja 70_Golden_Scenarios_Master, fila 15.

**Scenario**: GS-011

**Dominio**: TP-01

**Clase**: IDENTIDAD

**Nombre**: Recurso adicional como apoyo

**GIVEN**: UE activa con retro A; llega equipo B para apoyar la misma unidad de trabajo.

**WHEN**: Se incorpora B.

**THEN esperado**: Nueva AsignacionRecursoEjecucion dentro de misma UE/Parte.

**No debe ocurrir**: No crear UE ni TP-01 por el mero recurso adicional.

**Reglas clave**: RUL-006,RUL-026

**Objetos/relaciones**: UE, AsignacionRecursoEjecucion

**State transitions**: UE permanece EN_EJECUCION

**UX / tiempo**: UX-04 ≈12 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-012 — Subtrabajo autónomo dentro del mismo work package

Fuente: hoja 70_Golden_Scenarios_Master, fila 16.

**Scenario**: GS-012

**Dominio**: TP-01

**Clase**: IDENTIDAD

**Nombre**: Subtrabajo autónomo dentro del mismo work package

**GIVEN**: TP-01 activo; aparece subtrabajo con resultado/tiempo propio pero mismo objetivo de intervención.

**WHEN**: Comienza subtrabajo.

**THEN esperado**: Crear nueva UE dentro del mismo TP-01.

**No debe ocurrir**: No fragmentar en otro Parte.

**Reglas clave**: RUL-007,RUL-003

**Objetos/relaciones**: Parte, UE

**State transitions**: —→PENDIENTE→EN_EJECUCION

**UX / tiempo**: micro ≤20 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-013 — Cambio real de work package

Fuente: hoja 70_Golden_Scenarios_Master, fila 17.

**Scenario**: GS-013

**Dominio**: TP-01

**Clase**: IDENTIDAD

**Nombre**: Cambio real de work package

**GIVEN**: TP-01 activo.

**WHEN**: La cuadrilla termina objetivo A y comienza objetivo B independiente.

**THEN esperado**: Resolver/cerrar alcance anterior y crear nuevo TP-01.

**No debe ocurrir**: No mezclar dos work packages bajo la misma identidad.

**Reglas clave**: RUL-004,RUL-034

**Objetos/relaciones**: Parte, UE, VinculoPlanEjecucion

**State transitions**: Parte A→CERRADO_OPERATIVAMENTE; Parte B→PREPARADO

**UX / tiempo**: ≤20 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-014 — Cambio de ubicación sin regla de corte

Fuente: hoja 70_Golden_Scenarios_Master, fila 18.

**Scenario**: GS-014

**Dominio**: TP-01

**Clase**: IDENTIDAD

**Nombre**: Cambio de ubicación sin regla de corte

**GIVEN**: TP-01 activo y TipoParte/servicio no usa ubicación como driver de corte.

**WHEN**: Trabajo se desplaza a otra ubicación.

**THEN esperado**: Mismo Parte; registrar nueva ubicación/transición.

**No debe ocurrir**: No crear Parte por default.

**Reglas clave**: RUL-008,RUL-031,RUL-030

**Objetos/relaciones**: EjecucionUbicacion, TransicionOperativa

**State transitions**: Parte permanece

**UX / tiempo**: UX-05 ≈4 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-015 — Cliente exige corte por ubicación

Fuente: hoja 70_Golden_Scenarios_Master, fila 19.

**Scenario**: GS-015

**Dominio**: TP-01

**Clase**: CONFIGURABLE

**Nombre**: Cliente exige corte por ubicación

**GIVEN**: Mismo caso anterior pero existe ReglaCorte específica vigente.

**WHEN**: Se cambia ubicación según contexto configurado.

**THEN esperado**: Regla específica P4 gana al default; cerrar/split según configuración.

**No debe ocurrir**: No ignorar configuración específica.

**Reglas clave**: RUL-003,RUL-008 + precedencia/especificidad

**Objetos/relaciones**: ReglaCorteTipoParte, Parte

**State transitions**: según regla específica

**UX / tiempo**: configurable

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-016 — Cambio de categoría de tiempo

Fuente: hoja 70_Golden_Scenarios_Master, fila 20.

**Scenario**: GS-016

**Dominio**: EJECUCIÓN

**Clase**: TEMPORAL

**Nombre**: Cambio de categoría de tiempo

**GIVEN**: UE EN_EJECUCION con intervalo ejecución abierto.

**WHEN**: Comienza espera/standby/traslado.

**THEN esperado**: Cerrar intervalo previo y abrir nueva categoría sin gaps/solapes.

**No debe ocurrir**: No reescribir horas al cierre.

**Reglas clave**: RUL-028,RUL-029

**Objetos/relaciones**: EventoTiempo

**State transitions**: UE sin cambio

**UX / tiempo**: UX-06 ≈7 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-017 — Solapamiento incompatible de recurso

Fuente: hoja 70_Golden_Scenarios_Master, fila 21.

**Scenario**: GS-017

**Dominio**: EJECUCIÓN

**Clase**: ADVERSARIAL

**Nombre**: Solapamiento incompatible de recurso

**GIVEN**: Recurso exclusivo ya asignado en intervalo activo.

**WHEN**: Otra UE intenta asignarlo simultáneamente.

**THEN esperado**: ConflictoTemporal; bloquear o warning solo según ReglaSolapamiento.

**No debe ocurrir**: No permitir doble uso silencioso.

**Reglas clave**: RUL-027

**Objetos/relaciones**: Disponibilidad/AsignacionRecurso, ConflictoTemporal

**State transitions**: sin cambio

**UX / tiempo**: excepción

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-018 — Cierre UE con medición requerida faltante

Fuente: hoja 70_Golden_Scenarios_Master, fila 22.

**Scenario**: GS-018

**Dominio**: EJECUCIÓN

**Clase**: CLOSE

**Nombre**: Cierre UE con medición requerida faltante

**GIVEN**: UE activa cuyo componente exige una medición.

**WHEN**: Operario intenta cerrar sin valor.

**THEN esperado**: Cierre bloqueado y UI pide solo la medición faltante.

**No debe ocurrir**: No pedir un formulario completo ni cerrar incompleta.

**Reglas clave**: RUL-032,RUL-033

**Objetos/relaciones**: UE, EjecucionMedicion

**State transitions**: permanece EN_EJECUCION/SUSPENDIDA

**UX / tiempo**: UX-08 condicional

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-019 — Cierre operativo con contrato pendiente

Fuente: hoja 70_Golden_Scenarios_Master, fila 23.

**Scenario**: GS-019

**Dominio**: EJECUCIÓN

**Clase**: CLOSE

**Nombre**: Cierre operativo con contrato pendiente

**GIVEN**: UE ejecutada; contexto contractual=PENDIENTE.

**WHEN**: Operario cierra trabajo real.

**THEN esperado**: UE/Parte pueden cerrar operacionalmente; derivación comercial queda bloqueada.

**No debe ocurrir**: No obligar al campo a inventar CC/Item para cerrar.

**Reglas clave**: RUL-033,RUL-034,RUL-038

**Objetos/relaciones**: UE, Parte, ImputacionEjecucion

**State transitions**: UE→CERRADA; Parte→CERRADO_OPERATIVAMENTE

**UX / tiempo**: UX-08≈10 s / UX-09≈2 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-020 — Error descubierto después del cierre

Fuente: hoja 70_Golden_Scenarios_Master, fila 24.

**Scenario**: GS-020

**Dominio**: EJECUCIÓN

**Clase**: CORRECCIÓN

**Nombre**: Error descubierto después del cierre

**GIVEN**: UE CERRADA registra 80 h, realidad era 8 h.

**WHEN**: Supervisor descubre error.

**THEN esperado**: Bloquear edición directa; crear EnmiendaOperativa/nueva versión efectiva.

**No debe ocurrir**: No reabrir UE y sobrescribir 80.

**Reglas clave**: RUL-035,RUL-073

**Objetos/relaciones**: UE, EnmiendaOperativa

**State transitions**: UE histórica sigue CERRADA

**UX / tiempo**: back office

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-021 — Emergente con contrato desconocido autorizado

Fuente: hoja 70_Golden_Scenarios_Master, fila 25.

**Scenario**: GS-021

**Dominio**: EMERGENTE

**Clase**: OFFLINE

**Nombre**: Emergente con contrato desconocido autorizado

**GIVEN**: Trabajo urgente offline; persona/recurso/ubicación conocidos; contrato/CC/Item no resueltos; Habilita OK.

**WHEN**: ReglaInicioEmergente permite con autorización válida.

**THEN esperado**: Crear UE/Parte; estado contractual=PENDIENTE; iniciar; trazabilidad de autorización; commercial downstream bloqueado.

**No debe ocurrir**: No inventar CC/Item ni bloquear la realidad por falta comercial.

**Reglas clave**: RUL-036,RUL-037,RUL-038,RUL-074

**Objetos/relaciones**: UE, ImputacionEjecucion, DecisionTrace

**State transitions**: PENDIENTE→EN_EJECUCION

**UX / tiempo**: UX-02 ≈48 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-022 — Emergente con hard block Habilita

Fuente: hoja 70_Golden_Scenarios_Master, fila 26.

**Scenario**: GS-022

**Dominio**: EMERGENTE

**Clase**: ADVERSARIAL

**Nombre**: Emergente con hard block Habilita

**GIVEN**: Trabajo urgente y supervisor dispuesto a autorizar; PTW requerido no vigente/requisito crítico falla.

**WHEN**: Se intenta iniciar.

**THEN esperado**: P1 Habilita BLOCK domina sobre autorización emergente/comercial.

**No debe ocurrir**: No usar modo contingencia como bypass de Habilita.

**Reglas clave**: RUL-022,RUL-039,RUL-042 + precedencia P1>P6/P7

**Objetos/relaciones**: PTW, EvalHabilitacion, DecisionTrace

**State transitions**: sin Start Work

**UX / tiempo**: bloqueado

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-023 — Emergente sin autoridad válida

Fuente: hoja 70_Golden_Scenarios_Master, fila 27.

**Scenario**: GS-023

**Dominio**: EMERGENTE

**Clase**: ADVERSARIAL

**Nombre**: Emergente sin autoridad válida

**GIVEN**: Contrato pendiente; Habilita OK; regla requiere PERMITIR_AUTORIZADO.

**WHEN**: Operario intenta iniciar sin aprobación de rol autorizado.

**THEN esperado**: Bloquear Start Work.

**No debe ocurrir**: No convertir warning o necesidad en autorización.

**Reglas clave**: RUL-037,RUL-041

**Objetos/relaciones**: ReglaInicioEmergente, DecisionTrace

**State transitions**: sin cambio

**UX / tiempo**: bloqueado

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-024 — Bundle vencido antes de Start Work

Fuente: hoja 70_Golden_Scenarios_Master, fila 28.

**Scenario**: GS-024

**Dominio**: OFFLINE

**Clase**: ADVERSARIAL

**Nombre**: Bundle vencido antes de Start Work

**GIVEN**: Dispositivo offline con ExecutionContextBundle cuyo valid_until_at ya expiró.

**WHEN**: Operario intenta iniciar.

**THEN esperado**: No asumir contexto válido; reevaluar si existe política offline válida o bloquear/escalar.

**No debe ocurrir**: No usar cache vieja como fuente maestra.

**Reglas clave**: RUL-017 + invariant Bundle projection + P1/P2

**Objetos/relaciones**: ExecutionContextBundle, DecisionTrace

**State transitions**: sin Start Work salvo regla explícita

**UX / tiempo**: bloqueado/config

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-025 — Retry duplica evento de inicio

Fuente: hoja 70_Golden_Scenarios_Master, fila 29.

**Scenario**: GS-025

**Dominio**: OFFLINE

**Clase**: IDEMPOTENCIA

**Nombre**: Retry duplica evento de inicio

**GIVEN**: Tablet envió START_WORK; servidor lo procesó, ACK se perdió.

**WHEN**: Tablet reenvía mismo event/correlation key.

**THEN esperado**: Misma decisión/side effect; no crear segundo Parte/UE ni segundo intervalo.

**No debe ocurrir**: No duplicar hechos por retry.

**Reglas clave**: RUL-074 + contrato idempotencia

**Objetos/relaciones**: DecisionTrace, Parte, UE

**State transitions**: permanece EN_EJECUCION

**UX / tiempo**: 0 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-026 — Directiva emitida todavía no recibida

Fuente: hoja 70_Golden_Scenarios_Master, fila 30.

**Scenario**: GS-026

**Dominio**: CONTROL

**Clase**: OFFLINE

**Nombre**: Directiva emitida todavía no recibida

**GIVEN**: Campo offline, Parte activo; supervisión emite SUSPENDER.

**WHEN**: Directiva queda EMITIDA sin receipt.

**THEN esperado**: No afirmar que trabajo ya está suspendido; mantener diferencia entre emitida/recibida/aplicada.

**No debe ocurrir**: No marcar APLICADA por emisión.

**Reglas clave**: RUL-054,RUL-055,RUL-057

**Objetos/relaciones**: DirectivaOperativa

**State transitions**: —→EMITIDA

**UX / tiempo**: 0 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-027 — Directiva expirada llega tarde

Fuente: hoja 70_Golden_Scenarios_Master, fila 31.

**Scenario**: GS-027

**Dominio**: CONTROL

**Clase**: ADVERSARIAL

**Nombre**: Directiva expirada llega tarde

**GIVEN**: Directiva EMITIDA/RECIBIDA supera valid_until antes de aplicarse.

**WHEN**: Dispositivo intenta aplicarla.

**THEN esperado**: Marcar EXPIRADA; bloquear efecto; requerir nueva directiva.

**No debe ocurrir**: No ejecutar orden obsoleta.

**Reglas clave**: RUL-058

**Objetos/relaciones**: DirectivaOperativa, DecisionTrace

**State transitions**: EMITIDA/RECIBIDA→EXPIRADA

**UX / tiempo**: 0 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-028 — PTW completo y activado

Fuente: hoja 70_Golden_Scenarios_Master, fila 32.

**Scenario**: GS-028

**Dominio**: HABILITA

**Clase**: HAPPY PATH

**Nombre**: PTW completo y activado

**GIVEN**: Permiso BORRADOR con requisitos y mediciones completas.

**WHEN**: Se aprueba y contexto real coincide.

**THEN esperado**: PENDIENTE_APROBACION→APROBADO→VIGENTE; Start Work queda habilitable.

**No debe ocurrir**: No asumir APROBADO=VIGENTE.

**Reglas clave**: RUL-042,RUL-043

**Objetos/relaciones**: PermisoTrabajo, EvalHabilitacion

**State transitions**: BORRADOR→PENDIENTE→APROBADO→VIGENTE

**UX / tiempo**: UX-13 ≤120 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-029 — PTW vence durante el trabajo

Fuente: hoja 70_Golden_Scenarios_Master, fila 33.

**Scenario**: GS-029

**Dominio**: HABILITA

**Clase**: ADVERSARIAL

**Nombre**: PTW vence durante el trabajo

**GIVEN**: UE activa cubierta por PTW VIGENTE.

**WHEN**: Se alcanza valid_until.

**THEN esperado**: PTW→VENCIDO; bloquear nuevos Start/Restart; disparar alerta/suspensión según regla.

**No debe ocurrir**: No autocerrar PTW ni seguir como si siguiera vigente.

**Reglas clave**: RUL-045,RUL-044

**Objetos/relaciones**: PermisoTrabajo, DirectivaOperativa

**State transitions**: VIGENTE→VENCIDO; UE puede suspender

**UX / tiempo**: automático

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-030 — Timeout de PTW no es cierre

Fuente: hoja 70_Golden_Scenarios_Master, fila 34.

**Scenario**: GS-030

**Dominio**: HABILITA

**Clase**: ADVERSARIAL

**Nombre**: Timeout de PTW no es cierre

**GIVEN**: PTW VENCIDO no cerrado formalmente.

**WHEN**: Sistema procesa job de timeout.

**THEN esperado**: Permanece VENCIDO hasta cierre autorizado/administrativo.

**No debe ocurrir**: No pasar a CERRADO por reloj.

**Reglas clave**: RUL-045,RUL-046

**Objetos/relaciones**: PermisoTrabajo

**State transitions**: VENCIDO permanece

**UX / tiempo**: 0 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-031 — Flash Report controlado sin caso

Fuente: hoja 70_Golden_Scenarios_Master, fila 35.

**Scenario**: GS-031

**Dominio**: HABILITA

**Clase**: HAPPY PATH

**Nombre**: Flash Report controlado sin caso

**GIVEN**: Evento reportable, situación controlada, contexto activo disponible.

**WHEN**: Operario reporta categoría + descripción breve + controlada=Sí.

**THEN esperado**: Evento REPORTADO→EN_TRIAGE→CLASIFICADO→CERRADO_SIN_CASO si regla no exige caso.

**No debe ocurrir**: No pedir causa raíz al operario.

**Reglas clave**: RUL-047,RUL-048,RUL-049,RUL-050

**Objetos/relaciones**: EventoHabilita, EvalEscalamiento

**State transitions**: REPORTADO→EN_TRIAGE→CLASIFICADO→CERRADO_SIN_CASO

**UX / tiempo**: UX-12 ≈54 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-032 — Evento no controlado

Fuente: hoja 70_Golden_Scenarios_Master, fila 36.

**Scenario**: GS-032

**Dominio**: HABILITA

**Clase**: ADVERSARIAL

**Nombre**: Evento no controlado

**GIVEN**: Flash Report con situación_controlada=NO.

**WHEN**: Se registra reporte.

**THEN esperado**: Default conservador: suspender trabajo afectado/escalar triage; crear Caso si regla lo exige.

**No debe ocurrir**: No seguir happy path por defecto.

**Reglas clave**: RUL-051,RUL-050,RUL-052

**Objetos/relaciones**: EventoHabilita, Directiva, CasoHabilita

**State transitions**: REPORTADO→...→ESCALADO_A_CASO

**UX / tiempo**: ≤120 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-033 — Evento standalone sin Parte

Fuente: hoja 70_Golden_Scenarios_Master, fila 37.

**Scenario**: GS-033

**Dominio**: HABILITA

**Clase**: BOUNDARY

**Nombre**: Evento standalone sin Parte

**GIVEN**: Se detecta condición/evento fuera de ejecución activa.

**WHEN**: Persona genera Flash Report.

**THEN esperado**: Crear EventoHabilita válido sin Parte/UE; contexto opcional.

**No debe ocurrir**: No forzar Parte ficticio para registrar Habilita.

**Reglas clave**: RUL-047 + ERD EventoHabilita standalone

**Objetos/relaciones**: EventoHabilita

**State transitions**: —→REPORTADO

**UX / tiempo**: ≤120 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-034 — Evento afecta múltiples UE

Fuente: hoja 70_Golden_Scenarios_Master, fila 38.

**Scenario**: GS-034

**Dominio**: HABILITA

**Clase**: RELACIONAL

**Nombre**: Evento afecta múltiples UE

**GIVEN**: Un hecho impacta dos operaciones/UE simultáneamente.

**WHEN**: Habilita vincula ambas.

**THEN esperado**: Un EventoHabilita con N vínculos UE; identidad del evento única.

**No debe ocurrir**: No duplicar evento por cada UE.

**Reglas clave**: ERD R-052 + Habilita core

**Objetos/relaciones**: EventoHabilitaUnidadEjecucion

**State transitions**: sin cambio de lifecycle

**UX / tiempo**: back office

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-035 — Investigación finaliza con acciones abiertas

Fuente: hoja 70_Golden_Scenarios_Master, fila 39.

**Scenario**: GS-035

**Dominio**: HABILITA

**Clase**: LIFECYCLE

**Nombre**: Investigación finaliza con acciones abiertas

**GIVEN**: Caso EN_INVESTIGACION; investigación terminada; se definieron acciones.

**WHEN**: Habilita finaliza investigación.

**THEN esperado**: Caso→SEGUIMIENTO_ACCIONES; acciones continúan su lifecycle independiente.

**No debe ocurrir**: No cerrar todas las acciones por cerrar investigación.

**Reglas clave**: State Machine CasoHabilita + RUL-053

**Objetos/relaciones**: CasoHabilita, AccionCorrectivaHabilita

**State transitions**: EN_INVESTIGACION→SEGUIMIENTO_ACCIONES

**UX / tiempo**: back office

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-036 — Acción crítica bloquea cierre de Caso

Fuente: hoja 70_Golden_Scenarios_Master, fila 40.

**Scenario**: GS-036

**Dominio**: HABILITA

**Clase**: ADVERSARIAL

**Nombre**: Acción crítica bloquea cierre de Caso

**GIVEN**: Caso en seguimiento; una acción marcada bloqueante aún no verificada.

**WHEN**: Se intenta cerrar caso.

**THEN esperado**: Cierre bloqueado hasta verificación o cambio autorizado de política.

**No debe ocurrir**: No cerrar por conveniencia administrativa.

**Reglas clave**: RUL-053

**Objetos/relaciones**: CasoHabilita, AccionCorrectivaHabilita

**State transitions**: permanece SEGUIMIENTO_ACCIONES

**UX / tiempo**: back office

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-037 — Reporte duplicado por retry/offline

Fuente: hoja 70_Golden_Scenarios_Master, fila 41.

**Scenario**: GS-037

**Dominio**: HABILITA

**Clase**: IDEMPOTENCIA

**Nombre**: Reporte duplicado por retry/offline

**GIVEN**: Mismo Flash Report se reenvía tras perder ACK.

**WHEN**: Servidor recibe correlation key repetida.

**THEN esperado**: No crear segundo EventoHabilita; reutilizar/relacionar DecisionTrace.

**No debe ocurrir**: No duplicar incidentes por sincronización.

**Reglas clave**: RUL-074 + idempotencia

**Objetos/relaciones**: EventoHabilita, DecisionTrace

**State transitions**: sin duplicado

**UX / tiempo**: 0 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-038 — Movimiento planificado

Fuente: hoja 70_Golden_Scenarios_Master, fila 42.

**Scenario**: GS-038

**Dominio**: TP-02

**Clase**: HAPPY PATH

**Nombre**: Movimiento planificado

**GIVEN**: TP-02 con origen/destino/recurso/chofer/carga prevista.

**WHEN**: Operario confirma contexto y realiza movimiento.

**THEN esperado**: Registrar movimiento/UE, timestamps, ubicaciones, carga real; cierre rápido.

**No debe ocurrir**: No recargar identidad/cliente/recurso desde cero.

**Reglas clave**: RUL-023,RUL-024,RUL-031,RUL-032,RUL-033

**Objetos/relaciones**: Parte TP-02, UE, Ubicacion, Medicion

**State transitions**: PENDIENTE→EN_EJECUCION→CERRADA

**UX / tiempo**: UX-10 ≈17 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-039 — Destino real difiere del plan

Fuente: hoja 70_Golden_Scenarios_Master, fila 43.

**Scenario**: GS-039

**Dominio**: TP-02

**Clase**: DEVIATION

**Nombre**: Destino real difiere del plan

**GIVEN**: Movimiento activo con destino previsto A.

**WHEN**: Por directiva/operación termina en B.

**THEN esperado**: Registrar ubicación B como realidad + EventoOperativo/Directiva si aplica; plan permanece histórico.

**No debe ocurrir**: No editar destino planificado para que coincida.

**Reglas clave**: RUL-020,RUL-031,RUL-054

**Objetos/relaciones**: UnidadPlanificada, UE, EjecucionUbicacion

**State transitions**: UE cierra con realidad B

**UX / tiempo**: ≤45 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-040 — Cierre diario de cuadrilla

Fuente: hoja 70_Golden_Scenarios_Master, fila 44.

**Scenario**: GS-040

**Dominio**: TP-03

**Clase**: HAPPY PATH

**Nombre**: Cierre diario de cuadrilla

**GIVEN**: Durante turno se acumularon UE, personas, recursos y EventosTiempo.

**WHEN**: Supervisor/operario cierra TP-03.

**THEN esperado**: Roster/horas/trabajos se derivan; humano solo confirma/novedad excepcional.

**No debe ocurrir**: No reconstruir el día manualmente.

**Reglas clave**: RUL-025,RUL-026,RUL-028,RUL-034

**Objetos/relaciones**: Parte TP-03, UE, asignaciones, tiempos

**State transitions**: Parte→CERRADO_OPERATIVAMENTE

**UX / tiempo**: UX-11 ≈23 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-041 — N ejecuciones consolidan 1 UC

Fuente: hoja 70_Golden_Scenarios_Master, fila 45.

**Scenario**: GS-041

**Dominio**: CERTIFICACIÓN

**Clase**: LINEAGE

**Nombre**: N ejecuciones consolidan 1 UC

**GIVEN**: Varias UE cerradas pertenecen al mismo grano comercial mensual/período.

**WHEN**: Motor aplica ReglaGranoUC.

**THEN esperado**: Crear una UC con N UnidadComercialFuenteEjecucion y versiones exactas.

**No debe ocurrir**: No perder qué ejecuciones alimentaron la UC.

**Reglas clave**: RUL-059,RUL-074

**Objetos/relaciones**: UC, UnidadComercialFuenteEjecucion

**State transitions**: —→INCOMPLETA/ELEGIBLE

**UX / tiempo**: 0 s campo

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-042 — Una UE genera múltiples UC

Fuente: hoja 70_Golden_Scenarios_Master, fila 46.

**Scenario**: GS-042

**Dominio**: CERTIFICACIÓN

**Clase**: LINEAGE

**Nombre**: Una UE genera múltiples UC

**GIVEN**: Una UE contiene imputaciones/items distintos válidos.

**WHEN**: Motor aplica grano/item.

**THEN esperado**: Crear múltiples UC con lineage a la misma UE/imputaciones correspondientes.

**No debe ocurrir**: No forzar 1 UE=1 UC.

**Reglas clave**: RUL-059,RUL-061

**Objetos/relaciones**: UE, ImputacionEjecucion, UC source bridge

**State transitions**: varias UC creadas

**UX / tiempo**: 0 s campo

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-043 — Standby registrado pero no certificable

Fuente: hoja 70_Golden_Scenarios_Master, fila 47.

**Scenario**: GS-043

**Dominio**: CERTIFICACIÓN

**Clase**: CONTRATO

**Nombre**: Standby registrado pero no certificable

**GIVEN**: EventoTiempo STANDBY existe en ejecución.

**WHEN**: ReglaTratamientoTiempo indica no certificable o mapea a otro item.

**THEN esperado**: Mantener standby operacional intacto; derivar cantidad comercial según regla.

**No debe ocurrir**: No borrar/cambiar categoría de tiempo para cobrar.

**Reglas clave**: RUL-060

**Objetos/relaciones**: EventoTiempo, ReglaTratamientoTiempo, UC

**State transitions**: sin cambio ejecución

**UX / tiempo**: 0 s campo

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-044 — Cliente observa UC

Fuente: hoja 70_Golden_Scenarios_Master, fila 48.

**Scenario**: GS-044

**Dominio**: CERTIFICACIÓN

**Clase**: OBSERVATION

**Nombre**: Cliente observa UC

**GIVEN**: UC EN_REVISION.

**WHEN**: Cliente/certificador observa evidencia/cantidad comercial.

**THEN esperado**: UC→OBSERVADA + ObservacionCertificacion; ejecución permanece intacta.

**No debe ocurrir**: No editar Parte/UE para hacer coincidir criterio comercial.

**Reglas clave**: RUL-063,RUL-064

**Objetos/relaciones**: UC, ObservacionCertificacion, AjusteCertificacion

**State transitions**: EN_REVISION→OBSERVADA

**UX / tiempo**: 0 s campo

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-045 — Aceptación parcial permitida

Fuente: hoja 70_Golden_Scenarios_Master, fila 49.

**Scenario**: GS-045

**Dominio**: CERTIFICACIÓN

**Clase**: PARTIAL

**Nombre**: Aceptación parcial permitida

**GIVEN**: Paquete EN_REVISION y ReglaParcialidad permite subset.

**WHEN**: Cliente acepta algunas UC.

**THEN esperado**: Paquete→ACEPTADO_PARCIAL con subset explícito/versionado.

**No debe ocurrir**: No asumir aceptación de todas las UC.

**Reglas clave**: RUL-068

**Objetos/relaciones**: PaqueteCertificacion, bridge UC, Conformidad

**State transitions**: EN_REVISION→ACEPTADO_PARCIAL

**UX / tiempo**: 0 s campo

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-046 — Aceptación parcial no permitida

Fuente: hoja 70_Golden_Scenarios_Master, fila 50.

**Scenario**: GS-046

**Dominio**: CERTIFICACIÓN

**Clase**: ADVERSARIAL

**Nombre**: Aceptación parcial no permitida

**GIVEN**: Paquete EN_REVISION; contrato no permite parcialidad.

**WHEN**: Cliente/usuario intenta aceptar subset.

**THEN esperado**: Bloquear transición parcial; exigir resolución compatible con regla.

**No debe ocurrir**: No saltarse configuración contractual.

**Reglas clave**: RUL-068 + P6 hard gate

**Objetos/relaciones**: PaqueteCertificacion

**State transitions**: permanece EN_REVISION

**UX / tiempo**: 0 s campo

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-047 — Enmienda después de aceptación, antes de factura

Fuente: hoja 70_Golden_Scenarios_Master, fila 51.

**Scenario**: GS-047

**Dominio**: CERTIFICACIÓN

**Clase**: CORRECCIÓN

**Nombre**: Enmienda después de aceptación, antes de factura

**GIVEN**: UC v1 ACEPTADA deriva de ejecución v1; EnmiendaOperativa crea ejecución v2.

**WHEN**: Motor detecta fuente superada.

**THEN esperado**: UC v1 supersession→REQUIERE_RECALCULO; nueva UC v2 sustituye v1; requiere nueva revisión según flujo.

**No debe ocurrir**: No borrar aceptación histórica ni actualizar v1 en sitio.

**Reglas clave**: RUL-065,RUL-066,RUL-073

**Objetos/relaciones**: Enmienda, UC source, supersession

**State transitions**: UC v1 histórica + UC v2 nueva

**UX / tiempo**: 0 s campo

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-048 — Enmienda después de factura/ERP

Fuente: hoja 70_Golden_Scenarios_Master, fila 52.

**Scenario**: GS-048

**Dominio**: FACTURACIÓN

**Clase**: CORRECCIÓN

**Nombre**: Enmienda después de factura/ERP

**GIVEN**: UC/línea ya cruzó boundary ERP.

**WHEN**: Se descubre error operacional.

**THEN esperado**: Preservar documento original; generar nueva verdad + supersession + necesidad de ajuste/reversión administrativa downstream.

**No debe ocurrir**: No editar factura/documento histórico desde el sistema de Partes.

**Reglas clave**: RUL-065,RUL-066,RUL-070,RUL-072,RUL-073

**Objetos/relaciones**: UC, LineaFacturable, Lote, ERP boundary

**State transitions**: nuevo flujo compensatorio

**UX / tiempo**: 0 s campo

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-049 — Intento de facturar UC sustituida

Fuente: hoja 70_Golden_Scenarios_Master, fila 53.

**Scenario**: GS-049

**Dominio**: FACTURACIÓN

**Clase**: ADVERSARIAL

**Nombre**: Intento de facturar UC sustituida

**GIVEN**: UC ACEPTADA históricamente pero supersession=SUSTITUIDA/INVALIDADA.

**WHEN**: Motor intenta construir línea.

**THEN esperado**: Bloquear; solo UC vigente puede producir línea facturable nueva.

**No debe ocurrir**: No usar aceptación histórica como vigencia actual.

**Reglas clave**: RUL-065,RUL-070

**Objetos/relaciones**: UC, LineaFacturable

**State transitions**: sin línea nueva

**UX / tiempo**: 0 s campo

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-050 — UC aceptada vigente a ERP

Fuente: hoja 70_Golden_Scenarios_Master, fila 54.

**Scenario**: GS-050

**Dominio**: FACTURACIÓN

**Clase**: HAPPY PATH

**Nombre**: UC aceptada vigente a ERP

**GIVEN**: UC ACEPTADA, vigente, reglas completas.

**WHEN**: Se agrupan líneas y se envía lote.

**THEN esperado**: LineaFacturable→Lote BORRADOR→VALIDADO→ENVIADO_ERP→ACEPTADO_ERP.

**No debe ocurrir**: No volver a preguntarle nada al operario.

**Reglas clave**: RUL-070,RUL-071,RUL-072

**Objetos/relaciones**: UC, Linea, Lote, ERP boundary

**State transitions**: Lote lifecycle completo

**UX / tiempo**: 0 s campo

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-051 — Una evidencia valida múltiples scopes

Fuente: hoja 70_Golden_Scenarios_Master, fila 55.

**Scenario**: GS-051

**Dominio**: TRACE

**Clase**: RELACIONAL

**Nombre**: Una evidencia valida múltiples scopes

**GIVEN**: Foto/documento aplica a UE y EventoHabilita o PTW.

**WHEN**: Sistema vincula evidencia a más de un objeto.

**THEN esperado**: Una Evidencia con múltiples EvidenciaVinculo tipados.

**No debe ocurrir**: No duplicar archivo innecesariamente ni usar FK polimórfica opaca.

**Reglas clave**: ERD R-048 + invariant evidencia

**Objetos/relaciones**: Evidencia, EvidenciaVinculo

**State transitions**: sin state transition

**UX / tiempo**: 0 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-052 — Explicar decisión histórica con reglas antiguas

Fuente: hoja 70_Golden_Scenarios_Master, fila 56.

**Scenario**: GS-052

**Dominio**: TRACE

**Clase**: AUDIT

**Nombre**: Explicar decisión histórica con reglas antiguas

**GIVEN**: Una decisión fue tomada con ruleset v1; hoy existe v2.

**WHEN**: Auditor consulta por qué se permitió/bloqueó.

**THEN esperado**: DecisionTrace referencia ruleset efectivo v1 y reproduce lógica histórica.

**No debe ocurrir**: No recalcular pasado con configuración actual.

**Reglas clave**: RUL-074 + precedencia temporal

**Objetos/relaciones**: DecisionTrace

**State transitions**: inmutable

**UX / tiempo**: 0 s

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-053 — Commercial rule contradice Habilita

Fuente: hoja 70_Golden_Scenarios_Master, fila 57.

**Scenario**: GS-053

**Dominio**: TRACE

**Clase**: ADVERSARIAL

**Nombre**: Commercial rule contradice Habilita

**GIVEN**: Contrato permitiría ejecutar/cobrar; PTW requerido no vigente.

**WHEN**: Motor evalúa ambas reglas.

**THEN esperado**: P1 BLOCK gana sobre P6 ALLOW; DecisionTrace registra conflicto/resolución.

**No debe ocurrir**: No permitir por prioridad comercial.

**Reglas clave**: precedencia P1>P6 + RUL-022,RUL-042

**Objetos/relaciones**: DecisionTrace, PTW

**State transitions**: sin Start Work

**UX / tiempo**: bloqueado

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-054 — Dos reglas iguales se contradicen

Fuente: hoja 70_Golden_Scenarios_Master, fila 58.

**Scenario**: GS-054

**Dominio**: TRACE

**Clase**: ADVERSARIAL

**Nombre**: Dos reglas iguales se contradicen

**GIVEN**: Dos reglas de misma precedencia, vigencia y especificidad producen ALLOW/BLOCK.

**WHEN**: Motor intenta resolver.

**THEN esperado**: FAIL CLOSED: bloquear/escalar y registrar conflicto.

**No debe ocurrir**: No elegir arbitrariamente.

**Reglas clave**: 58_Prioridad_Conflictos_Reglas

**Objetos/relaciones**: DecisionTrace

**State transitions**: sin transición

**UX / tiempo**: bloqueado

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-055 — Contrato futuro introduce nueva regla comercial

Fuente: hoja 70_Golden_Scenarios_Master, fila 59.

**Scenario**: GS-055

**Dominio**: CHANGE CONTROL

**Clase**: BOUNDARY

**Nombre**: Contrato futuro introduce nueva regla comercial

**GIVEN**: Llega contrato real con tratamiento de tiempos/grano/agrupación no conocido hoy.

**WHEN**: Se parametriza configuración.

**THEN esperado**: Nueva versión de reglas P6 sin cambiar Parte/UE/Habilita/Interfaces si el patrón existente alcanza.

**No debe ocurrir**: No reabrir arquitectura por cada nuevo valor contractual.

**Reglas clave**: P6 configuration + baseline contract-agnostic

**Objetos/relaciones**: ContratoVersion, ContratoServicio, reglas

**State transitions**: sin cambio core

**UX / tiempo**: CONFIGURABLE

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO

## GS-056 — Contrato futuro parece requerir cuarto TipoParte

Fuente: hoja 70_Golden_Scenarios_Master, fila 60.

**Scenario**: GS-056

**Dominio**: CHANGE CONTROL

**Clase**: STRUCTURAL TEST

**Nombre**: Contrato futuro parece requerir cuarto TipoParte

**GIVEN**: Nueva evidencia contractual/operativa no encaja en TP-01/02/03 incluso mediante componentes/reglas.

**WHEN**: Equipo evalúa el caso.

**THEN esperado**: NO auto-extender baseline: abrir Change Control arquitectónico y demostrar nuevo patrón operacional.

**No debe ocurrir**: No inventar TP-04 por presión de formulario.

**Reglas clave**: Baseline governance / Freeze rule

**Objetos/relaciones**: TipoParte, Change Control

**State transitions**: baseline se reabre solo si evidencia lo exige

**UX / tiempo**: EXCEPCIÓN

**Resultado canónico (NO test de software)**: PASS

**Tipo resolución**: ESTRUCTURAL

**Patch estructural**: NO
