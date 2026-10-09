# Centros de control · guía de evaluación

## Separación de responsabilidades

Admin tiene un centro de producto: tiempo observado de carga, envíos medidos, proporción observada hasta 120 segundos, mediana y percentil 90, controles que frenan el envío, errores de ejecución o persistencia y uso de módulos. Puede convertir una señal en una oportunidad, registrar evidencia, hipótesis, responsable, esfuerzo y resultado, y seguir su estado. No se calcula rentabilidad sin costo y beneficio verificados.

Planner tiene un centro operativo con filtros por período, operadora, recurso y locación. Muestra cobertura de partes respecto de jornadas planificadas hasta hoy, composición del tiempo, horas hombre, producción por actividad y unidad, pendientes de revisión/certificación, preparación documental y reservas. Las sugerencias muestran la evidencia que las disparó y la acción a revisar. Coincidencias de fechas de asignación requieren revisión: no prueban un conflicto horario.

La orientación a la cuenca Golfo San Jorge contempla viento, traslados, permisos de ingreso y materiales de la operadora como causas a observar. No hay geolocalización de rutas, pronóstico, distancias, ventanas de ingreso ni umbral de viento universal. Los límites de operación deben venir del procedimiento aprobado y del contexto de cada tarea. Esta versión no compara cuadrillas sin controlar diferencias de actividad, unidad y condiciones.

## Procedencia y calidad de datos

- Las métricas operativas excluyen por defecto ejemplos y registros heredados sin procedencia. Elegir **Explorar con ejemplos** permite conocer los gráficos, con advertencia visible; no son indicadores de desempeño real.
- Los trabajos nuevos tienen procedencia registrada; sus partes la heredan. Los ejemplos siguen siendo ejemplos aunque se editen. La base antigua no se reclasifica automáticamente como actividad real.
- Los partes enviados, observados, aprobados y certificados alimentan tiempos y producción; lo observado es provisional. Los borradores no cuentan como producción enviada.
- La cobertura mide presentación de partes, no cumplimiento de producción. Las cantidades se separan por actividad y unidad; no representan importe certificable.
- Se excluyen de tiempo, producción y horas hombre los partes con tramos superpuestos. Los cálculos de duración contemplan medianoche; revisar jornadas mayores de 24 horas requiere otro modelo temporal.
- Aprobación y certificación usan marcas temporales nuevas normalizadas. No se reconstruyen fechas desde historiales de texto de ejemplo.

La telemetría se guarda en este navegador y no se envía a Friquarks ni a otra herramienta. Registra tipos de interacción y secciones, no contenidos de campos, contraseñas, firmas ni fotos. Cuenta intervalos entre interacciones de hasta 30 segundos mientras la página está visible; pausa al ocultarla. Por eso el tiempo observado puede ser parcial y no equivale a tiempo total de trabajo ni demuestra por sí solo el objetivo de dos minutos. Hay límites de 5.000 eventos y 1.000 sesiones. Los reenvíos pueden generar nuevos envíos medidos; no son necesariamente partes únicos. Desactivar Producto pausa el seguimiento y conserva lo registrado.

## Parte rápido y automatización revisable

El operario abre el parte rápido desde Mi jornada. La planificación ofrece tareas pendientes con cantidades y horarios vacíos: no las da por ejecutadas. Los horarios anteriores pueden sugerirse; aplicarlos a toda la cuadrilla requiere una confirmación específica. Seguridad, permiso, clima observado y firma se controlan antes de enviar. Las habilitaciones originales siguen bloqueando cuando corresponde.

Guardar y revisar o Guardar y enviar conserva esperas y traslados. Para ausencias, reemplazos, jornadas nocturnas, diferencias de horarios, adicionales y otros casos, se conserva el circuito original de cinco pasos. El borrador rápido sobrevive al dibujo de la firma; si el parte cambió en el detalle, debe descartarse o revisarse antes de guardar, para no sobrescribirlo silenciosamente.

El relevo puede preparar un resumen de actividades y pendientes. El avance puede tomar cantidades del parte para la misma tarea, unidad, fecha y trabajo; existe una fuente manual explícita. La captura estructurada incorpora una actividad revisada una sola vez y controla horarios y cantidades. Las evidencias pueden vincularse al tramo registrado. Planner puede reutilizar una planificación en un trabajo nuevo conservando el original.

## Control documental

Admin configura requisitos por persona o equipo y, opcionalmente, sujeto, operadora, locación y actividad, con criticidad, anticipación de aviso, responsable y antigüedad máxima de verificación. Puede delegar gestión documental a una cuenta planner desde Usuarios y accesos; el planner sin ese permiso consulta. Operario ve el estado de su trabajo, sin formularios administrativos.

La evidencia almacena referencias y fechas, no el archivo de un portal externo. Un registro pendiente de revisión no acredita conformidad. Se distingue falta de evidencia, rechazo, vencimiento, verificación antigua, próximo vencimiento y vigencia aprobada. Cada nueva evidencia conserva la anterior y hay historial de configuración. Desactivar un requisito preserva sus registros.

Una matriz sin configurar aparece como pendiente, nunca como habilitación global. El panel de preparación evalúa hasta la fecha prevista de cierre, para advertir vencimientos durante el trabajo. Los nuevos requisitos críticos generan alertas y quedan en la evaluación del parte enviado; en esta versión no introducen un segundo bloqueo de envío adicional al circuito original. La política de impedimento de asignar, movilizar o enviar debe acordarse con la empresa y aplicarse también en backend.

Los avisos se recalculan al abrir la app. No hay notificaciones por correo, mensajes, tareas programadas ni consultas automáticas a operadoras. No sustituye las habilitaciones originales ni confirma que un documento externo sea auténtico.

## Recorrido de prueba

1. Entrar con `sherrera`, abrir el centro de producto y registrar una oportunidad. Sin uso medido, se muestran estados vacíos. En Administración del sistema, revisar módulos e identidad visual.
2. Configurar un requisito y registrar evidencia pendiente; verificar que no aparezca conforme. Registrar después una evidencia aprobada vigente y comparar. Probar vencimiento y fechas de cierre.
3. Entrar con `lmendez`, abrir el centro operativo y seleccionar **Explorar con ejemplos** para conocerlo. Volver a registros cargados antes de interpretar resultados de un piloto. Crear una planificación nueva para generar datos con procedencia registrada.
4. Entrar con `darce`, completar un parte con confirmación explícita y controles vigentes; comparar recorrido rápido y cinco pasos. Un equipo con habilitación vencida debe impedir el envío.
5. Volver al centro de producto para revisar las observaciones de carga de este navegador. Validar el objetivo de dos minutos con una prueba de campo que mida también tiempo total, errores y retrabajo.

Contraseña de evaluación de las cuentas originales: `vds2026`. La identidad, permisos, documentos y métricas siguen siendo locales. Antes de producción falta backend, autorización de servidor, almacenamiento documental, sincronización, auditoría central, notificaciones y pruebas reales de tablet/offline.
