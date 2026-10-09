# Operario · primera integración sobre la base original

Rama de trabajo: `app/rediseno-login-operario`. Login aprobado guardado en GitHub en el commit `bfa70c2ca385d8159a7f47da4cb28dfd91ff0b19`.

Comparación realizada contra el editor de Juan, commit `f6579e5` del repo original `jmalo-star/vds-partes-app`. La base modular `5ab7f57` ya conserva sus funciones de Inicio, Personal, Equipos, Tareas y Cierre. Esta etapa reutiliza esas mismas funciones, bindings y validaciones, con integración contextual y estilos propios de operario.

## Experiencia

Si existe un parte editable del día en el alcance del usuario, el ingreso abre directamente ese parte. No crea un registro ni presume ejecución por ingresar. Si no existe uno, se muestran las asignaciones para iniciar explícitamente el parte. Cambiar parte permite consultar otros trabajos, correcciones y enviados. El selector conserva los trabajos próximos y resúmenes del original.

El editor habitual contiene las cinco secciones originales. Se retira el formulario rápido del recorrido habitual, preservando su lógica y borradores anteriores para recuperación explícita. La barra lateral conserva los módulos bajo Herramientas de campo; los accesos necesarios también aparecen en la sección pertinente.

| Sección | Base conservada | Integración nueva |
| --- | --- | --- |
| Inicio | Plan, indicaciones, contrato/imputación, llegada, clima manual, charla, EPP y permiso | Reserva, materiales e instrucciones del planner; evaluación documental |
| Personal | Presencia, ausencias, reemplazos, habilitaciones y horas individuales/comunes | Sugerencia explícita desde el último parte anterior del recurso; sólo campos vacíos de personas presentes |
| Equipos | Equipos asignados, agregar/quitar, habilitaciones, lectura actual, referencia anterior y novedades | Presentación táctil con edición del registro de hoy |
| Tareas y tiempos | Categorías, tareas del contrato, cantidades/unidades, esperas, traslados, viento, descansos, producción y composición del tiempo | Captura/dictado según navegador, evidencia por actividad, novedades, adicionales y seguimiento |
| Cierre | Continuidad, fin anticipado, extensión, responsables, observaciones, fotos, firma y controles | Relevo y bitácora en contexto |

Los módulos respetan su activación por admin y los permisos actuales. El operario consulta la reserva y materiales, sin asumir gestión de stock ni integración con la operadora. Volver desde un módulo devuelve al mismo parte y sección, preservando sus registros.

## Datos y permisos

Asignaciones vienen del plan, pero pueden editarse mediante las acciones originales de presencia, reemplazo y cambio de equipo. Tareas previstas no se convierten en ejecución hasta registrarlas. Lectura anterior es referencia, nunca lectura de hoy. Los horarios previos se presentan como sugerencia identificada por parte y fecha; no se aplican al abrir Personal y no sobrescriben valores de hoy. La matriz documental avisa; las habilitaciones y controles originales siguen bloqueando cuando corresponde. No se agregan servicios remotos ni clima ficticio.

El guardado continúa siendo local. La firma usa una superficie clara y tinta oscura para preservar legibilidad de firmas anteriores. No se modifican los catálogos ni las pantallas de los otros roles.

## Validación y límites

Pruebas de base conservadas, con expectativas de ruta adaptadas al ingreso directo y pruebas de borradores antiguos ejecutadas por recuperación explícita. Tres nuevas pruebas comprueban herramientas por sección y retorno, sugerencias sin sobrescritura y envío bloqueado/recuperación de borrador. Build de Vite.

Revisión visual en navegador/tablet pendiente. El objetivo de menos de dos minutos todavía requiere un piloto medido con partes normales y excepciones. La telemetría existente registra duración activa y fricción, sin garantizar ese objetivo por diseño. La siguiente iteración debe revisar densidad de Personal y Tareas, orientación de tablet y desplazamiento horizontal.
