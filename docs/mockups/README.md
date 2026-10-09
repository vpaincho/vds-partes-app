# Mockups por rol · versión 1

Abrir `roles-v1.html` en un navegador. Es un único archivo sin dependencias, con datos ilustrativos y decisiones simuladas. No está conectado a la app, no cambia sus datos y no sustituye sus validaciones. El código de producción permanece sin cambios en esta etapa.

## Dirección acordada

El operario conserva el Parte diario de cinco secciones de la referencia: Inicio, Personal, Equipos, Tareas y tiempos, Cierre. Se descarta como dirección de UX la segunda interfaz de Parte rápido. La rapidez debe provenir de la precarga, edición y controles dentro del mismo parte. La navegación habitual no exige elegir entre dos formularios equivalentes.

La fila actual de herramientas se integra al contexto, conservando capacidad:

| Sección | Información y herramientas |
| --- | --- |
| Inicio | Planificación, indicaciones, condiciones de hoy, permiso, reserva y preparación documental |
| Personal | Asignación precargada, confirmación de presencia, ausencias/reemplazos, horarios comunes e individuales, habilitaciones |
| Equipos | Asignación precargada, confirmación de uso, cambio de equipo, lectura anterior como referencia y lectura actual |
| Tareas y tiempos | Tareas previstas sin ejecución asumida, tramos, cantidades, captura, evidencia, esperas, traslados, viento, novedades y solicitudes adicionales |
| Cierre | Revisión, firma, continuidad/extensión, observaciones, relevo y consulta de bitácora |

## Automatización y edición

Tres procedencias deben ser visibles: planificación, sugerencia anterior y registro de hoy. Una planificación alimenta contexto y asignaciones; no prueba ejecución. Una lectura anterior no se usa como lectura de hoy. La presencia, uso de equipos y comprobaciones de seguridad necesitan confirmación. El clima se precarga solo con una fuente conectada, fecha/hora y locación pertinentes; de lo contrario se solicita observación manual.

Los datos precargados pueden corregirse desde el contexto del parte. Cambiar contrato, imputación o asignaciones debe conservar el valor inicial, motivo y usuario y seguir los permisos y revisión correspondientes. Editar la ejecución no cambia silenciosamente el maestro ni la planificación de origen. La maqueta representa estos accesos; ese circuito de corrección aún debe detallarse.

Los horarios comunes se aplican por acción explícita solo al personal confirmado presente y conservan edición individual. Las tareas previstas se ofrecen sin cantidades ejecutadas. No hay confirmación automática de permisos ni de condiciones de seguridad.

## Experiencia por rol

- Operario: un solo parte, cinco secciones conocidas, contexto estable y acción siguiente siempre visible. Las herramientas secundarias aparecen donde se necesitan. Si hay varios trabajos, Cambiar parte abre un selector breve; no crea otro formulario de carga.
- Planner: planificación por recurso con panel de trabajo en la misma superficie. Preparación, ejecución e historial se consultan sin perder la fecha, filtros y selección. Revisión de partes y análisis operativo son espacios distinguibles; cada hallazgo debe llevar al registro que lo explica.
- Cliente: cola de partes del contrato, ejecución, evidencia y observación de corrección junto a la decisión. No confundir certificación de un parte con facturación ni asumir aprobación automática de adicionales.
- Admin: señales de producto, oportunidades y resultados; administración de usuarios, empresa y módulos separada de la tarea diaria. No convertirlo en analista operativo de la cuenca.

## Funcionalidad táctil

Controles de al menos 46 px en esta maqueta, contraste visible, etiquetas persistentes, paneles estables, acciones inferiores accesibles y detalle progresivo. En tablet, tablas conservan la información y pueden desplazarse horizontalmente; evaluar después si Personal y Tareas requieren filas en tarjetas según orientación y teclado. La pantalla debe evitar que el teclado tape la acción o el campo activo.

## Qué se puede probar aquí

Cambiar de rol, recorrer las cinco secciones, editar y conservar datos durante la sesión, confirmar personas y aplicar horarios comunes, abrir herramientas contextuales, simular revisión/firma/envío, seleccionar trabajos en planner, pasar al análisis operativo y simular una decisión del cliente. Los paneles secundarios representan ubicación y propósito; no son formularios completos de producción.

## Siguiente validación antes de integrar

1. Confirmar jerarquía, contenidos y accesos de cada rol sobre la maqueta.
2. Afinar estados: parte nuevo, continuidad, observado, sin conexión, guardado fallido y cambios de asignación.
3. Ejecutar un recorrido de campo habitual y otro con excepciones. Medir tiempo total, interacciones, correcciones, faltantes y retrabajo; el objetivo de dos minutos aún no está acreditado.
4. Integrar en el código conservando capacidades, historial y validaciones; retirar la duplicación visual del Parte rápido sin perder borradores ni registros existentes.
