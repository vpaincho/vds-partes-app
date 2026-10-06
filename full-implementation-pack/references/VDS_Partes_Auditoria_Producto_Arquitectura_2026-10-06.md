# VDS Partes — Auditoría de producto y arquitectura

Fecha: 6 de octubre de 2026. Alcance: comprender, contrastar y recomendar. No se modificó el repositorio, no se implementó funcionalidad y no se publicó nada.

## Evidencia y límites

**FACT — código:** revisión del repositorio `vpaincho/vds-partes-app`, rama `main`, referencia observada `0c117aacc6f04a745b3499b0479a938d36821502` (v0.4). Archivos: `README.md`, `index.html`, `.gitignore`. El contenido leído de README e index tiene los blobs `015eb82f2c4aa32ecedf331f5bc9dccb77f49fb8` y `1aa5fc9c6831855f50e78d2ca330d15518357521`. No hay un proyecto React/Next, backend, manifiesto de dependencias, esquema SQL o suite de tests en la raíz inspeccionada.

**FACT — dominio:** lectura del HTML adjunto “VDS Arquitectura Funcional 1.0.dc(4).html”, que se identifica como Frozen y derivado del Diccionario Canónico v3.0. Representa los tres patrones TP-01 Intervención, TP-02 Transporte y TP-03 Cuadrilla, P0–P8, interfaces A/B, Habilita, Control Plane y lineage.

**UNKNOWN — validación completa:** el HTML declara 87 entidades, 75 relaciones, 11 máquinas, 74 reglas y 56 escenarios PASS. No contiene las especificaciones completas ni la evidencia de ejecución de los 56 escenarios. Esos números son declaraciones del documento, no tests de software reproducidos por esta auditoría. Las notas del HTML dicen que el XLSX prevalece sobre el brief: ese XLSX no fue adjuntado.

**FACT — acceso online:** el enlace suministrado de `vds-system-blueprint` redirige al login de Vercel. No se recorrió el Blueprint protegido. La lectura autenticada fue rechazada automáticamente porque el mecanismo puede crear un enlace temporal de bypass. No se intentó sortearlo. Tampoco se verificó una URL desplegada de la app de Juan: el enlace suministrado pertenece al proyecto Blueprint; no hay evidencia para equipararlo con `vds-partes-app`. Una búsqueda de proyectos por la URL del repo no devolvió coincidencias en el contexto disponible; eso no prueba que no exista un despliegue.

**Método:** seguimiento estático UI → acción → estado → persistencia/cálculo, contrastado con el dominio del HTML. `WORKING` significa lógica local implementada y conectada, no prueba E2E ni preparación para producción. La evaluación visual, táctil y mobile queda pendiente. `INFERENCE` identifica interpretación; `RECOMMENDATION`, diseño propuesto; `UNKNOWN`, información no demostrada.

## 1. Executive verdict

**INFERENCE:** Juan construyó una base de producto valiosa y coherente para demostrar el circuito planificación → parte diario → revisión VDS → certificación cliente. Conviene preservar su organización por usuario, sus herramientas de planificación y sus mecanismos de feedback. El prototipo tiene más lógica que una maqueta de pantallas, pero todavía opera enteramente en un navegador con datos de ejemplo.

La mayor fortaleza es que conecta trabajo previsto, jornada, tareas, tiempos, personas, equipos y revisión en una experiencia reconocible para VDS. El mayor riesgo es convertir directamente sus objetos y mutaciones locales en un backend: consolidaría un único estado para varios dominios, el corte diario universal y la edición retroactiva como reglas del sistema.

**RECOMMENDATION:** evolución incremental del mismo producto, con TypeScript, React + Vite, API Node/Fastify, PostgreSQL y PWA con IndexedDB. Monolito modular, CRUD transaccional + eventos de dominio + versiones inmutables donde corresponda. Primero una vertical completa TP-03; después TP-02 y TP-01. No introducir microservicios, Kafka, tracking de alta frecuencia ni 3D.

La migración técnica es necesaria; un rediseño total del producto no está justificado por la evidencia disponible. Antes del piloto deben existir Start Work gate, identidad estable de UE, permisos reales, persistencia verificable, correcciones versionadas y sincronización reconciliable.

## 2. Current product map

| Superficie/capacidad | Actor y recorrido | Estado actual | Cadena técnica / evidencia |
|---|---|---|---|
| Ingreso y cambio de rol | Admin, planner, operador, validador, cliente | MOCKED para identidad; WORKING local para navegación | `USERS`, `PW`, `HOME`, formulario `loginf`, toolbar `jump` |
| Shell por rol | Cada usuario ve una navegación distinta | WORKING local; permisos de seguridad MOCKED | `shell()`, `view()`, `S.user`, `S.route` |
| Planificación | Crear trabajo por contrato, recurso, ubicación, tareas y fechas | WORKING local | `vPlan()` → `openTrab()` / `modal()` → `submitTrab()` → `S.trabajos` → `save()` |
| Gantt / recurso / mes | Mover, extender, acortar, ver ocupación y solapes | WORKING local | `vGantt()`, `vWeek()`, `vMonth()`, drag → `moveT()`, `minDias()`, `clashes()` |
| Detalle del trabajo | Ver partes, cambiar prioridad, pedir/aprobar extensión, cierre | WORKING local; control post-despacho PARTIAL | `drawer()`, acciones `x-ok`, `x-no`, `t-prio`, `a-reopen`, historial textual |
| Partes | Lista por estado, resumen, PDF | WORKING local | `vList()` → `sumHtml()` / `buildPdf()` → `S.partes` |
| Mi jornada | Pendientes de hoy, observados, próximos y enviados | WORKING local; asignación MOCKED | `vDay()`, cuadrilla fija `USERS.operador.rec`, `parteOf()` |
| Parte en cinco pasos | Inicio, personal, equipos, tareas/tiempos, cierre | WORKING local | `vEdit()` → `stInicio/Personal/Equipos/Reg/Cierre` → `setBind()` → `p.ejec` |
| Inicio operativo | Crear parte diario desde planificación | PARTIAL respecto al target | `o-start` crea `estado:'curso'`, snapshot y `newEjec()`; no llama al gate de Habilita |
| Validaciones | Seguridad, habilitaciones, horarios, cantidades, viento, cierre | WORKING local; reglas canónicas PARTIAL | `checks()` → `errs()` / `stepOk()`; controla envío y aprobación VDS |
| Habilitaciones | Matriz personal/equipos × operadora; editar vencimiento | WORKING local; Habilita PARTIAL | `vHab()` → `hab()` / `submitHab()` → `S.hab[sujeto+'|'+op]` |
| Permiso operadora | Número, nombre de firmante y hora | PARTIAL | `p.ptw`, `e.permiso`; `o-ptnow` completa hora y nombre sugerido; no verifica autorización formal |
| Clima | Manual o botón de actualización | MOCKED para fuente externa | `o-clima` escribe valores constantes; `genEjec()` genera ejemplos; no hay proveedor meteorológico |
| Revisión VDS | Aprobar o devolver con motivo obligatorio | WORKING local | `vInbox('v')` / `detail()` → `v-ok/v-obs` → estado, `dec`, `hist` |
| Certificación cliente | Certificar u observar partes aprobados | WORKING local como conformidad; target comercial PARTIAL | `vInbox('c')` → `c-ok/c-obs` → `p.estado`, `p.cert`; sin UC/paquetes/lineage |
| Dashboard cliente | HH, categorías de tiempo, producción, km, recursos | WORKING local | `vDash()` → `sums()` / `prod()` sobre `apr` y `cert`; fixtures como fuente |
| Configuración | Catálogo de tareas por contrato y usuarios visibles | WORKING local para tareas; usuarios DATA_ONLY | `vConf()`, `c-addtask/c-deltask`; no gestión real del directorio |
| Fotos / firma / PDF | FileReader, imagen comprimida, canvas, exportación | WORKING local por código; descarga no verificada en navegador | `onFiles()`, `initSig()`, `buildPdf()`, `downloadPdf()`; jsPDF y AutoTable vía CDN |
| Guardado automático | Cambios persistidos en navegador | WORKING local con límite relevante | `save()` guarda todo `S` en localStorage; captura errores sin mostrarlos |
| Sin señal / sincronización | Botón cambia conectividad y elimina bandera de cola | MOCKED | `S.offline`, `p.cola`, acción `sync`; sin red, servidor, ACK ni conflictos |
| UE, routing, enmiendas, reglas versionadas, directivas, UC, ERP | No hay superficies/datos equivalentes completos | No identificadas en código | Ausencias del modelo y del árbol inspeccionado; no clasificarlas como UNUSED |

**Estados existentes:** `plan`, `curso`, `env`, `obs`, `apr`, `cert`. Son estados de workflow combinados. `p.fin` expresa continuidad, cierre o extensión; `t.cierre` y `t.ext` son objetos separados. Hay 17 trabajos seed, cinco contratos, cinco recursos de planificación y catálogos fijos de personas/equipos. No se demostró un backend oculto ni código de servicios sin conectar.

**Dependencias actuales:** JavaScript y CSS nativos, APIs de navegador, Google Fonts, jsPDF 2.5.1 y AutoTable 3.8.2. Todas las superficies principales están conectadas en `view()`; no hay evidencia suficiente para etiquetar un módulo completo como UNUSED.

## 3. What Juan got right

| Decisión | Por qué tiene valor | Preservar / potenciar |
|---|---|---|
| Navegación según usuario | Campo no recibe todo el backoffice | KEEP “Mi jornada”, bandejas y planificación; convertir rol demo en capabilities reales |
| Planificación con varias vistas | La misma operación puede leerse por duración, recurso y calendario | KEEP Gantt/recurso/mes; agregar readiness y versiones sin cambiar la lógica visual básica |
| Contrato como contexto | Reduce elecciones y liga tareas con recursos y operadora | KEEP precarga; EXTEND con ContratoServicio, vigencia y CC independiente |
| Trabajo multidía y parte cotidiano | Distingue continuidad del trabajo de registro de jornada | KEEP la vista diaria; el corte del objeto Parte debe depender de TipoParte |
| Pedido de más días | Campo detecta necesidad; planificación decide | KEEP la interacción; versionar decisión y no sobrescribir la intención original |
| Plan vs. realizado | Hace visibles adicionales y pendientes | KEEP comparación; conectar a UE y vínculos N:M |
| Errores separados de alertas | Evita bloquear por cualquier dato incompleto | KEEP patrón de feedback; validar severidades con reglas del dominio |
| Observación obligatoria al devolver | La cuadrilla recibe algo accionable | KEEP motivo y acceso directo al problema; separar observación operativa/comercial |
| Bandeja lista + detalle | Permite revisar sin abrir ventanas sucesivas | KEEP como candidata desktop/tablet; comprobar en uso real |
| Horas base vs. zona, producción y tiempos | Distingue magnitudes que no deben mezclarse | KEEP etiquetas; mejorar intervalos, procedencia y reglas de cálculo |
| Autosave, copiar horarios, fotos, firma y PDF | Resuelve necesidades concretas de campo | KEEP capacidades; cambiar garantías de persistencia y de identidad de evidencia |
| Tokens visuales y componentes recurrentes | Existe un lenguaje visual consistente en el código | KEEP Barlow/Barlow Condensed/IBM Plex Mono y tokens como baseline; verificar contraste/tamaño real |

**INFERENCE:** el activo principal de Juan es la traducción del circuito operacional a acciones y vistas, no la estructura de un archivo único ni la forma exacta de sus arrays.

## 4. Gap matrix

| Capability | Current | Target need | Gap / impacto | Recomendación |
|---|---|---|---|---|
| Planning | Trabajo mutable por recurso y fechas | Intención aprobada/versionada, demanda y asignaciones | Alto: cambia el plan histórico | EXTEND con versión aprobada y revisión propuesta |
| Dispatch / Control Plane | Cambios directos e historial textual | Directiva emitida/recibida/ACK/aplicada | Alto en campo offline: cambio visible no equivale a aplicado | ADD directivas mínimas y ACK; no broker externo |
| Readiness | Vencimiento consultado en UI | Evaluación contextual y temporal, invalidación | Crítico: sin snapshot ni fecha efectiva suficiente | ADD evaluación con vigencia y causas; revalidar inicio/cambio |
| Start Work | Inicia `curso` antes de completar requisitos | Gate ALLOW antes de EN_EJECUCION | Crítico: validación llega al envío | IMPROVE separando preparación y autorización de inicio |
| Parte / routing | Parte por trabajo y fecha, mismo editor para todos | TP-01/02/03 con cortes propios | Alto: daily universal rompe Intervención/Transporte | EXTEND router determinista; conservar jornada como proyección |
| UE | Filas de tareas y tiempos sin identidad propia | Trabajo distinguible con ciclo de vida | Crítico: no hay hub operacional | ADD UE; no convertir cada fila horaria en UE |
| Plan ↔ Real | `p.pl` único y `parteOf(pl,fecha)` | Vínculos N:M, split/merge/emergente | Alto: no admite divergencia real | ADD vínculo con versión, alcance y procedencia |
| Personas / recursos | Nombres, roster fijo, equipos del Parte | IDs canónicos, nominación y asignación temporal UE | Alto: reemplazo no preserva participación | EXTEND intervalos y eventos de incorporación/relevo |
| Temporalidad | HH:MM + fecha Parte; solapes como warning | Instantes, intervalos, timezone y concurrencia | Alto: medianoche y doble conteo | IMPROVE tiempos completos, cierre abierto y política de solapes |
| Ubicación | Yacimiento + texto libre único | Ubicación técnica, activo, roles y cambios por UE | Medio/alto: ambigüedad y transporte incompleto | EXTEND catálogo + texto pendiente de resolución; GPS candidato |
| Mediciones | Cantidad/unidad por tramo operativo | Valor no derivable, UM y regla del ítem | Alto: actividad e ítem comercial confundidos | EXTEND medición independiente y mapping versionado |
| Imputación | CC único del contrato | CS ↔ CC configurable, ítem, RESUELTO/PENDIENTE | Alto: bloquea casos válidos o imputa mal | ADD resolución automática + bandeja backoffice |
| Evidencia | Base64/firma embebida en estado local | Archivo identificable y vínculo trazable | Alto: pérdida, cuota y falta de versión | EXTEND blobs locales y object storage con metadatos |
| Correcciones | Edición directa y retorno a `obs` | Enmienda, fuente versionada y recalculo derivado | Crítico: realidad puede reescribirse | ADD enmiendas; restringir mutación de registros emitidos/cerrados |
| Habilita Prevent | Una fecha por sujeto/operadora | Requisito/documento/cumplimiento/evaluación | Crítico: no representa requisitos múltiples | EXTEND dominio; mantener matriz como vista resumida |
| PTW | Campos dentro del Parte | Objeto formal con estados y vínculo temporal N:M UE | Crítico: dato declarado ≠ permiso vigente | ADD PTW independiente; registrar fuente/verificación |
| Habilita Respond | Texto en observaciones | Flash Report, triage, caso y acciones | Alto: incidentes quedan sin circuito | ADD reporte mínimo y seguimiento progresivo |
| Emergente | Solo trabajo preplanificado | Inicio sin plan bajo regla explícita | Alto: fuerza planificación ficticia | ADD emergente con contexto pendiente permitido; nunca saltar gates |
| Offline | localStorage + flag manual | Outbox durable, ACK, reintentos, conflictos, freshness | Crítico: no hay sync real | ADD protocolo y UI de entrega separada de estado de negocio |
| Certificación | Certificación del Parte | UC, paquetes, parciales, versiones y N:M | Alto: conformidad equivale a transformación comercial | EXTEND la bandeja; ADD modelo comercial separado |
| Rules / trace | `checks()` hardcodeado + `hist` | Reglas efectivas, precedencia, DecisionTrace | Alto: no explica “por qué” históricamente | EXTEND funciones puras + configuración publicada/versionada |
| Permissions | Menús y datos filtrados por rol en cliente | Autorización por acción/objeto/contrato | Crítico para multiusuario | ADD enforcement servidor y sesiones de dispositivo |
| Masters / configuration | Objetos locales editables | Ownership, IDs estables, vigencias y mapping legacy | Alto: cambios retroactivos alteran interpretación | EXTEND catálogos versionados; integración read-only inicial |
| Dashboards | Aprobados/certificados y fixture | Operación/revisión/comercial diferenciados | Medio/alto: cifras desaparecen tras observación | IMPROVE proyecciones con definición y versión fuente |
| Facturación | No identificada | Líneas/lote + adapter ERP | Medio; no es carga de campo | ADD contrato de salida cuando llegue el slice comercial |

### Contradicciones que deben resolverse explícitamente

1. **Daily universal vs. identidad por patrón.** El repo hace un Parte por día de trabajo. El HTML establece work package para Intervención, movimientos para Transporte y acumulación de turno para Cuadrilla. La vista “Parte diario” puede sobrevivir; la identidad persistida no debe ser diaria para todos. TP-03 es la mejor entrada porque se parece más a lo existente.
2. **Observación cliente vs. reescritura operacional.** `c-obs` pone `p.estado='obs'` y modifica `p.dec`; el operador ve el mismo objeto como corregible. Conservar la observación, pero derivarla a revisión comercial o a solicitud de enmienda operacional según motivo. No pedir a campo que cambie cantidades solo para satisfacer una interpretación comercial.
3. **Cierre anticipado vs. intención histórica.** `o-send` reduce `t.dias` cuando termina antes. Mantener fecha prevista de la versión aprobada y fecha real de cierre por separado; liberar disponibilidad futura sin borrar la comparación original.
4. **Reglas al cierre vs. gates al inicio.** `checks()` es útil para completitud, pero `o-start` ya inicia `curso`. Añadir checks por comando; salida pendiente al inicio es normal y no debe bloquearlo. Documentación/PTW sí pueden bloquear Start Work.
5. **Snapshot parcial vs. historia reproducible.** `snap()` copia contexto, pero `checks()`, `unitOf()`, `lastKm()` y `buildPdf()` vuelven a consultar datos mutables. Un cambio en catálogo o habilitación puede cambiar la explicación de un parte anterior. Guardar IDs/versiones y evaluación del hecho; mostrar “estado al hecho” y “estado actual” como lecturas distintas.

### Riesgos concretos adicionales

- `save()` silencia fallos de localStorage mientras la UI sigue diciendo “Guardado automático”. Mostrar éxito solo después de persistencia confirmada; pérdida de capacidad local debe bloquear nuevas acciones que no puedan guardarse y ofrecer recuperación.
- `nextPD()` y los IDs de trabajo usan máximo local + 1: dos dispositivos pueden emitir el mismo identificador. UUID para identidad; número humano asignado por servidor o reservado sin colisión.
- `sync` elimina `cola` y escribe “Sincronizado con la base” sin comunicación con una base. La frase debe conservarse exclusivamente para un ACK real.
- `sums()` suma intervalos incluso superpuestos; `clashes()` y `checks()` alertan pero no corrigen el denominador. Ocupación actual es proporción de recurso-días con trabajo previsto, no utilización horaria ni productividad. No cambiar la métrica silenciosamente: definir ambas.
- `lastKm()` selecciona el mayor valor entre partes previos, no una lectura estrictamente anterior por instante y versión. Revisiones retroactivas pueden cambiar recorridos derivados. Versionar lectura y referencia; no aplicar kilometraje a todos los equipos si corresponde horómetro.
- `dur()` interpreta cualquier hora final menor como día siguiente y la timeline usa una ventana 06:00–20:00. Sirve al demo; no prueba soporte de turno nocturno, cruces de medianoche o fechas inválidas.
- El botón de clima y “Firmado ahora” son atajos de demo. No presentarlos como verificación externa. El texto de viento/tiempo reconocido por operadora está hardcodeado; necesita una regla contractual/operacional validada, no convertirse en política universal.

## 5. UX audit

**FACT:** el archivo representa una tablet horizontal de 1366 × 1024 dentro de un marco, escalada con `fit()`. No se identifican breakpoints de distribución mobile; las media queries son de tema y movimiento reducido. **INFERENCE:** escalar el lienzo conserva composición, pero reduce tamaño físico de controles y no constituye responsive de campo. No se midió en dispositivo real.

**Campo.** Mantener “Mi jornada”, contexto y botón principal. Transformar el editor en dos modos complementarios: operación durante el trabajo y revisión del parte. El primero debe ofrecer Iniciar, cambiar actividad/tiempo, medir, pausar, incorporar/reemplazar, reportar evento y cerrar. Los cinco pasos actuales pueden permanecer como resumen, completitud y corrección guiada. El usuario no necesita conocer `UnidadEjecucion` ni los nombres de reglas.

El inicio debe mostrar contexto precargado, quiénes/equipos están listos, permiso aplicable, vigencia/freshness y excepciones. La confirmación inicia el hecho y abre el intervalo. Horarios personales pueden precargarse desde eventos comunes y confirmarse por excepción, sin convertir “copiar horarios” en evidencia de que todos tuvieron la misma jornada. La firma y las fotos se solicitan según regla, sin cargar todos los cierres con evidencias irrelevantes.

**Operaciones.** Preservar Gantt/recurso/mes y el drawer. Agregar bandas de readiness, disponibilidad y conflictos; distinguir borrador/versión aprobada de directiva pendiente. Un drag de planificación futura propone una revisión; un drag que afecta ejecución despachada necesita mostrar el cambio y su ACK. No sustituir todas las vistas por un mapa.

**Revisión y certificación.** Mantener lista + detalle, controles y motivo obligatorio. Mostrar origen, versión y evidencia del dato observado; observaciones específicas sobre objeto/campo, con comentario general cuando sea suficiente. Separar “dato operacional incorrecto” de “criterio comercial discutido”. Para grandes volúmenes, agrupación y aceptación por paquete, con revisión de excepciones; medir necesidad antes de agregar acciones masivas.

**Accesibilidad / consistencia.** Existen labels, estados ARIA, foco visible, mensajes `role=status` y reducción de movimiento: KEEP. Revisar navegación de filas clicables que son `tr` y Gantt basado solo en pointer; dar alternativa por teclado y edición por formulario. Verificar foco dentro de modales, retorno al disparador, contraste real, lector de pantalla, zoom y target táctil tras escalado. No afirmar WCAG cumplido sin evaluación.

**Budget de campo.** Los segundos del HTML son objetivos de diseño, no tiempos medidos. Medir p50/p95 por acción, éxito sin ayuda, errores, correcciones posteriores y pérdida de datos en el hardware real. La aceptación debería incluir p95 ≤120 s para interacciones críticas normales; reportar excepciones complejas aparte. No esconder carga posterior ni tiempo de recuperación de errores para “cumplir” el indicador.

## 6. Target product architecture

| Superficie | Evolución desde Juan | Usuario y acción principal | Relación con dominio |
|---|---|---|---|
| Mi jornada / Trabajo activo | KEEP + IMPROVE | Campo: próximo trabajo válido, ejecutar, excepciones y pendientes de entrega | Parte/UE, context bundle, Habilita y outbox |
| Planificación | KEEP + EXTEND | Planner: preparar, evaluar, aprobar y despachar | Demanda, requerimientos, nominación, versiones |
| Partes | KEEP + EXTEND | Operaciones: buscar, revisar realidad y versiones | Registro operacional y proyección diaria |
| Revisión VDS | KEEP + IMPROVE | Responsable: aceptar completitud/consistencia o pedir enmienda | Workflow de revisión separado del estado operativo |
| Habilita | EXTEND Habilitaciones | Control documental/HSE: requisitos, vencimientos, gates, reportes y casos | Prevent + Respond & Learn; accesos contextuales desde campo |
| Certificación | KEEP bandeja + EXTEND | Comercial/cliente: revisar UC, paquetes y conformidad | Derivación comercial y lineage hacia fuentes |
| Control operacional | ADD vista liviana | Supervisión: operación activa, bloqueos, directivas y ACK pendientes | Proyecciones de varios dominios; no nueva verdad |
| Personas y recursos | EXTEND catálogos | Operaciones: disponibilidad, perfiles, habilitación, historial | Maestros + intervalos, sin duplicar documentación |
| Configuración | KEEP + EXTEND | Admin autorizado: publicar contratos/reglas/catalogos con vigencia | Config versionada y mappings |
| Trace / historial | EXTEND detalle contextual | Quien tenga permiso: explicar una decisión o cifra | Drawer/timeline común; búsqueda especializada solo si hace falta |
| Dashboard cliente | KEEP + IMPROVE | Cliente autorizado: servicio, revisión y aceptación | Proyecciones aisladas por contrato y fuente |

**RECOMMENDATION:** no imponer una Home universal. Planner puede seguir entrando en Planificación; campo en Mi jornada; validador en su bandeja; cliente en Dashboard/Certificación. Supervisión puede necesitar Control. Trace es primero una capacidad transversal, no otra sección obligatoria. Facturación es boundary de salida, no un módulo administrativo completo en H1.

## 7. Target technical architecture

**RECOMMENDATION — estructura lógica:** un frontend y una API de negocio con módulos `identity`, `masters-contracts`, `planning`, `execution`, `habilita`, `certification`, `billing-adapter`, `audit` e `integrations`. Los nombres son boundaries, no servicios separados. La ejecución sigue en el centro; planificación y certificación poseen sus respectivos datos.

Cada comando atraviesa: autenticar/autorizar → deduplicar → cargar contexto/versiones → evaluar invariantes/gates/estado → aplicar transición → escribir estado + evento + trace + outbox en una transacción → responder con resultado persistido. Efectos externos se procesan después mediante worker con reintentos. No devolver éxito antes del commit.

El núcleo determinista puede ser un paquete TypeScript de funciones puras. Separar contratos serializables, reglas y adaptadores de I/O. Cliente usa una proyección suficiente para feedback offline; servidor conserva autoridad de aceptación. Reglas declaradas y sus parámetros son versionados y publicados, no código arbitrario escrito por administradores.

**Rule Engine mínimo:** catálogo de decisiones con IDs, precedencia P0–P8, scopes, vigencias y código de evaluación probado; resolver empates según baseline y fallar cerrado cuando no hay decisión segura. `DecisionTrace` registra comando, actor/dispositivo, contexto/versiones, reglas aplicadas y descartadas con motivo, resultado y confirmaciones/override permitidos. Evitar duplicar todos los datos personales en cada traza: referencias más snapshot mínimo reproducible.

Una reevaluación por cambio de ruleset crea una nueva traza; no transforma un retry del mismo comando en otro hecho. La clave idempotente identifica el comando estable; si se repite con otro payload debe rechazarse. `correlation_id` enlaza hechos relacionados y no sustituye `command_id`. El envelope del HTML describe coordinación, no licencia para un motor central que pueda escribir cualquier dominio.

### Modelo de eventos

| Opción | Evaluación para VDS |
|---|---|
| CRUD puro | Insuficiente para directivas, versiones, offline y explicar derivaciones |
| CRUD + eventos + versiones | RECOMMENDED: estado actual transaccional, hechos append-only y lineage |
| Event sourcing selectivo | Posible en un flujo particular si la reconstrucción justifica su coste; no necesario inicialmente |
| Full event sourcing | DEFER: migraciones de eventos, replay y proyecciones agregan complejidad sin evidencia de necesidad |

No todo evento es fuente autoritativa de todo el sistema. Definir por agregado si manda la versión persistida o el registro de hechos, y mantenerlos atómicos. Historial textual se deriva de eventos estructurados; no usarlo como único contrato entre módulos.

### Seguridad y operación

Autenticación OIDC con directorio corporativo disponible; elegir proveedor luego de confirmar identidad VDS. Backend valida capability + alcance de contrato/base + objeto + estado para cada acción. Cliente externo con acceso explícito al contrato, no filtro de frontend. Admin no tiene permiso universal de reescribir historia; puede ejecutar enmienda/reapertura autorizada con motivo. Separar cargo, perfil operativo y capability.

Para dispositivo offline, sesión enrolada y autorización de vigencia limitada; no almacenar contraseña corporativa. Definir cambio de usuario y protección de pendientes en tablet compartida. Logs estructurados, correlation IDs, errores frontend/backend, métricas de cola y backups con prueba de restauración desde el piloto. La observabilidad no debe incorporar fotos, credenciales o contenido completo de partes por defecto.

## 8. Technology decision

### Matriz 1–10

**INFERENCE:** puntuación de adecuación a este proyecto, no benchmark de lenguajes. Peso igual, 13 criterios. “Talento” asume equipo pequeño que podrá trabajar con JS/TS; competencias efectivas de Juan/equipo son UNKNOWN. Python/Go no perjudican por sí mismos la UX web: la diferencia aquí es coordinar contratos y reglas entre runtimes.

| Criterio | A: TS end-to-end | B: TS + Python | C: TS + Go | D: políglota desde ahora |
|---|---:|---:|---:|---:|
| Compatibilidad con repo JS | 9 | 7 | 6 | 5 |
| Velocidad de desarrollo H1 | 9 | 8 | 6 | 4 |
| Mantenibilidad equipo pequeño | 9 | 7 | 7 | 4 |
| UX web | 9 | 9 | 9 | 9 |
| Mobile/offline y reglas compartidas | 9 | 7 | 7 | 6 |
| Realtime ligero | 8 | 8 | 9 | 9 |
| Geospatial relacional | 8 | 9 | 8 | 9 |
| Performance requerida H1 | 9 | 8 | 10 | 9 |
| Escalabilidad razonable | 8 | 8 | 9 | 9 |
| Testing / contratos | 9 | 7 | 8 | 5 |
| Talento bajo supuesto explícito | 8 | 7 | 5 | 4 |
| Deployment / operación | 9 | 7 | 8 | 4 |
| Flexibilidad futura | 8 | 9 | 9 | 10 |
| Promedio | **8,6** | **7,8** | **7,8** | **6,7** |

Si el equipo domina Python claramente más que Node, B puede superar A en velocidad/mantenibilidad; no fingir certeza de staffing. Go es razonable para un servicio con carga medida que lo justifique, no por tracking hipotético. Una arquitectura políglota progresiva es una buena posibilidad futura; comenzar políglota H1 no es la recomendación.

### Stack recommended now

| Capa | Recomendación | Motivo / límite |
|---|---|---|
| Lenguaje | TypeScript | Evolución de JS actual; contratos y núcleo determinista compartibles |
| Frontend | React + Vite | App operacional cliente con offline; no hay Next existente que preservar ni requerimiento SEO/SSR |
| UI | Componentes propios a partir del CSS/tokens de Juan | Extraer shell, botones, tablas, badges, drawer y timeline; no cambiar toda la estética por una librería |
| Backend | Node LTS + Fastify | API modular simple; endpoints de comando y consultas; evitar framework pesado inicialmente |
| Validación | JSON Schema/TypeBox + Ajv | Runtime en API y contratos compartidos; TypeScript por sí solo no valida datos entrantes |
| DB | PostgreSQL gestionado | Relación, transacciones, restricciones, versiones y consultas |
| Data layer | Drizzle + SQL explícito donde aporte | Migraciones revisables; intervalos/constraints complejos no se esconden detrás del ORM |
| Auth | OIDC corporativo; adapter proveedor | Decidir Google/Entra/otro con directorio real; no inventar credenciales ni auth propia |
| Estado | React para UI; TanStack Query para consultas online | Datos pendientes de campo viven en almacenamiento local durable; cache de query no es outbox |
| Offline | IndexedDB/Dexie + service worker | Estado, comandos y blobs; transacción local antes de confirmar al usuario |
| Realtime | Refresco/polling inicial; SSE si hay necesidad comprobada | No usar realtime como garantía de entrega; conservar reconsulta y cursor |
| Evidencia | Object storage + metadatos PostgreSQL | Preservar archivos fuera de filas de negocio; cargas reanudables y permisos |
| Testing | Vitest, integración contra PostgreSQL, Playwright, contratos | Golden Scenarios y fallas de sync como aceptación |
| Deploy | Frontend estático en Vercel; API/worker contenedorizables | Cloud Run es candidato si se confirma entorno GCP; ubicación de DB/API coherente. No requiere Kubernetes |
| Observabilidad | Logs estructurados, errores, métricas y correlation IDs | Pendientes, latencia, rechazo, duplicados, conflictos y restore |

Vite documenta producción como bundle apto para hosting estático. Fastify valida entradas y serializa salidas mediante schemas; los schemas son código de aplicación confiable, no material arbitrario cargado por usuarios. PostgreSQL ofrece PK/FK/unique/check/exclusion para sostener invariantes además del código. Fuentes oficiales al final.

**Possible evolution stack:** servicio Python para interpretación documental/analítica cuando exista necesidad; servicio especializado Go/otro si un cuello medido lo requiere; PostGIS cuando las consultas espaciales lo justifiquen; Expo/native si el piloto demuestra necesidad de operación prolongada en segundo plano. Se conectan por API/eventos versionados sin desplazar la fuente operacional.

No introducir ahora Redis, broker, warehouse, vector DB, motor 3D, CV, IoT o microservicios. No introducir Next solo por ser Vercel; sí reconsiderarlo si hay necesidades concretas de SSR/BFF que compensen otra capa.

## 9. Data + offline strategy

### Persistencia y ownership

No traducir 87 entidades a 87 tablas ni guardar un JSON gigante equivalente a `S`. Materializar primero agregados, relaciones e invariantes del slice. PostgreSQL relacional para identidad, versiones, asignaciones, estados, lineage e idempotencia. JSONB para payloads de hechos/contexto y parámetros cuya variabilidad lo justifique, no para esconder todas las relaciones.

Identidad UUID emitible offline; código humano separado. Cantidades con precisión decimal y UM explícita. Instantes UTC + zona operacional y fecha de jornada como atributos distintos; `occurred_at`, `recorded_at`, `received_at` y fuente del tiempo. La hora del dispositivo no basta para probar orden o autorización: registrar desvío conocido y reconciliar sin falsificar cuándo el operador declaró el hecho.

Versiones aprobadas de plan/contrato/reglas inmutables. Intervalos persona/recurso con inicio/fin y UE, eventos de cambio, validación de exclusividad donde la regla lo exige. No bloquear toda superposición por una regla global: apoyos compartidos pueden ser válidos. Constraints y control transaccional deben reflejar el caso permitido. UE/UC con puente N:M que identifica versión y cantidad/contribución para prevenir doble imputación.

**Legacy MySQL:** ownership por atributo, no “sincronizar todo”. Resolver servidor/base correctos antes de mapear; los resultados de una búsqueda en otro servidor no validan clientes/contratos. Ingesta inicial read-only con origen, ID externo, fecha/corte, versión y estado de mapping. Maestros canónicos mantienen alias `(sistema, entidad, id_externo)` y decisiones de matching. No vincular personas por nombre como clave. Nunca asumir que CC es hijo rígido de contrato; conservar la relación CS↔CC del HTML.

La app nueva posee ejecución y decisiones nuevas. Personas/vehículos/contratos pueden seguir teniendo master externo si se valida. Catálogos no confiables se marcan pendientes, no se completan silenciosamente. CDC solo cuando latencia/volumen hagan insuficiente la sincronización programada y exista acceso autorizado.

### Offline V1 real

1. Preparar un `ExecutionContextBundle` autorizado por asignación: IDs/versiones de plan, catálogos mínimos, reglas relevantes, evaluaciones, vigencia, alcance y actor/dispositivo. Es proyección, nunca fuente maestra.
2. Persistir evento declarado + proyección local + comando en outbox mediante transacción IndexedDB. Confirmar “guardado en dispositivo” al commit local. Mantener blobs de evidencia fuera del JSON de comandos.
3. Enviar lotes con `command_id`, `correlation_id`, `device_id`, actor, agregado, secuencia local, `expected_version`, instante declarado y referencias a bundle/ruleset. Procesar en orden por agregado; no exigir orden global entre todos los trabajos.
4. Servidor autentica, valida alcance, deduplica de forma transaccional y responde por comando: aceptado, duplicado con mismo resultado, pendiente de revisión o rechazado con causa. Retry devuelve el resultado anterior; payload distinto con mismo ID no es válido.
5. Conservar comando hasta ACK durable y descargar cambios por cursor. Si la respuesta se pierde después del commit, retry no crea otro Parte/UE ni duplica una medición. Outbox del servidor coordina efectos externos con consumidores idempotentes.
6. Conciliar conflictos sin last-write-wins sobre verdad operativa. Agregados con versión esperada detectan carreras; evidencias/eventos independientes pueden anexarse; dos cierres, reemplazos incompatibles o directivas contradictorias van a resolución explícita.
7. Separar estados de entrega — local, pendiente, enviando, recibido, requiere intervención — de los estados Parte/UE/revisión/comercial. “Sincronizado” no debe significar “aceptado comercialmente”. Mostrar pendientes de evidencia de manera independiente.

**Límite esencial:** offline no puede conocer una revocación remota posterior al último bundle. No prometer readiness en tiempo real sin red. Decidir qué inicios permite una autorización local de vigencia limitada y cuáles requieren confirmación online; la expiración de documentación crítica conocida siempre bloquea. El piloto debe acordar alcance/TTL/política de emergencia. Firma del bundle prueba origen e integridad, no vigencia infinita ni ausencia de cambios remotos.

Un evento ya ocurrido y sincronizado con contexto vencido debe preservarse como declaración de campo y elevarse a discrepancia; no borrarse, ni aceptarse automáticamente como ejecución autorizada. Separar captura del hecho y autorización del comando. Las decisiones conocidas al momento y la reevaluación servidor quedan registradas por separado.

**PWA:** cachear app shell, fuentes/librerías propias y bundles; primer uso requiere preparación online. Solicitar persistencia donde esté disponible, mostrar capacidad restante y fallos; IndexedDB no elimina todos los riesgos de pérdida. Reintentar al abrir, recuperar conectividad y por acción manual. Background Sync es mejora opcional: tiene soporte limitado y restricciones de ejecución/reintento; no basar el SLA de entrega en que el navegador cierre y sincronice solo.

**Evidencia:** blob local con hash, tipo, tamaño, actor, instante y vínculo a versión UE/Parte. Upload separado/reintentable, checksum y ACK de archivo; no marcar completo un cierre que exige evidencia mientras falta su entrega. Evitar compresión destructiva del único original si su legibilidad exige conservarlo. La firma dibujada evidencia interacción, no demuestra por sí sola autorización PTW o identidad robusta.

### Qué almacenamiento extra aparece y cuándo

| Tecnología | Condición real para introducirla |
|---|---|
| Object storage | H1: fotos, documentos y firmas |
| Redis | Cache compartida/rate limit/cola si métricas lo justifican; no fuente operacional |
| Broker | Varios consumidores independientes, volumen y necesidad de desacoplar que superen outbox + worker |
| Search engine | Búsqueda relevante/volumen que excedan índices y búsqueda PostgreSQL |
| Warehouse | BI histórico pesado o integración de varias fuentes que afecte OLTP |
| Time-series | Telemetría densa real, no timestamps ordinarios de partes |
| Vector DB | Retrieval semántico demostrado; no almacenamiento de reglas críticas |
| PostGIS | Geofencing/distancias/consultas espaciales persistentes comprobadas |

## 10. Preservation decisions

| Clasificación | Elementos |
|---|---|
| KEEP | Navegación por usuario, Mi jornada, Gantt/recurso/mes, drawer, lista+detalle, comparación plan-real, PDF, categorías de tiempo como baseline validable |
| IMPROVE | Inicio autorizado, controles oportunos, autosave verificable, targets táctiles, estados múltiples, dashboard con semántica explícita |
| EXTEND | Partes con UE/routing, habilitaciones, revisiones, certificación, contratos, reemplazos, evidencia e historial |
| MERGE | Helpers/componentes duplicados en una biblioteca compartida; timeline/trace contextual reutilizado. No fusionar dominios con ownership distinto |
| ADD | API/DB/auth reales, context bundle/outbox, enmiendas, reglas/versiones, directivas/ACK, Flash Report, UC y lineage |
| DEFER | Native si PWA cumple; mapas avanzados, IA/voz hasta evidencia; tracking masivo, 3D, CV/IoT, microservicios |
| REMOVE | Solo del build de producción: cambio de roles sin auth, credenciales demo, botón de sync simulado, edición arbitraria de estado/historia. Mantenerlos en demo aislada si ayudan a validar |

Ante duda de utilidad de una vista o regla: KEEP + INVESTIGATE. No borrar módulos por simplificar el árbol de navegación.

## 11. Opportunity map

| Horizonte / oportunidad | Usuario y problema | Valor | Complejidad / dependencia | Riesgo y prueba |
|---|---|---|---|---|
| NOW: preparación de jornada | Campo llega sin contexto listo | Menos carga y fallos al inicio | Media: bundle + readiness | Datos viejos; mostrar vigencia y probar pérdida de señal |
| NOW: bandeja de resolución | Supervisor dispersa excepciones por chat | Ubicar bloqueos, sync, imputaciones y devoluciones | Media: estados/ownership claros | Convertirse en otra verdad; cada item enlaza al origen |
| NOW: trazabilidad de cifras | Comercial pregunta de dónde salen HH/cantidad | Revisar sin reconstrucción manual | Media: UE/UC/versiones | Duplicación; mostrar contribución/versiones |
| NOW: evidencia solo cuando aplica | Campo carga fotos por costumbre | Menos tiempo y archivos mejores | Baja/media: requisito explícito | Omitir evidencia necesaria; criterios contractuales |
| NEXT: alerta por duración prevista | Planner detecta tarde extensión | Reaccionar antes del fin del trabajo | Media: ejecución fiable y comparación plan-real | Alertas ruidosas; calibrar con piloto |
| NEXT: sustitutos habilitados | Supervisor tarda en reemplazar | Alternativas compatibles con perfil, recurso y fecha | Media/alta: maestros, disponibilidad y requisitos | Sugerencia parece autorización; gate sigue independiente |
| NEXT: integraciones documentales | HSE duplica carga en varios sistemas | Reducir trabajo repetido y vencimientos | Alta: APIs/acceso y ownership | Datos parciales; provenance y freshness |
| EXPERIMENT: dictado de observaciones | Campo escribe con guantes/contexto difícil | Reducir tecleo | Media: audio/privacidad/offline a evaluar | IA inventa contenido; confirmar transcripción antes de registro |
| EXPERIMENT: GPS como candidato | Ubicaciones con nombres ambiguos | Confirmación más rápida | Media: catálogo/permisos/precisión | Punto incorrecto; nunca asumir locación por proximidad sola |
| LATER: optimización/telemetría/3D | Necesidad todavía no demostrada | Valor estratégico potencial | Alta; requiere datos/hardware/caso económico | Feature bloat; stress test arquitectónico solamente |

IA asistiva interpreta o sugiere; no autoriza inicio, decide gates, inventa mediciones o cambia certificación. Voz no debe volverse requisito para usar la app.

## 12. Implementation roadmap — vertical slices

No se propone ejecutar estas fases en esta auditoría. Las salidas son criterios para una implementación posterior.

| Fase | Slice / resultado | Preservación y trabajo mínimo | Criterio de salida |
|---|---|---|---|
| 0 | Golden Baseline y reglas de preservación | Fijar commit/fixtures; walkthrough por rol; screenshots desktop/tablet; inventario de flows | Baseline reproducible, diferencia entre demo y real explícita, métricas actuales medidas |
| 1 | TP-03: planificar → preparar → iniciar → ejecutar → cerrar → revisar → certificar | Migrar un circuito manteniendo superficies; IDs, UE, plan aprobado, CS/CC, gate, roles, DB, eventos, UC/lineage básico | Un caso real online extremo a extremo sin reescribir ejecución; PDF reproducible; observación comercial separada |
| 2 | El mismo TP-03 con conectividad intermitente | Bundle, outbox/ACK, evidencia, versión/conflicto, sesión de dispositivo | Reinicio, retry tras commit perdido, doble dispositivo, bundle vencido y upload fallido conservan hechos sin duplicados |
| 3 | Excepciones del mismo circuito | Reemplazo, pausa/reanudar, cambio de ubicación, cierre anticipado, extensión, directiva y enmienda | Historia del plan intacta; ACK no equivale a aplicado; recalculo comercial conserva versiones |
| 4 | TP-02 Transporte | Reusar shell/gates/sync; origen-destino/carga/UE por movimiento | Viajes múltiples, origen/destino y recursos no forzados a una ubicación diaria única |
| 5 | TP-01 Intervención | Work package estable, subtrabajos, handover/PTW independiente | Turno/permiso/recurso distinto no crea otro Parte sin regla de corte |
| 6 | Habilita y comercial ampliados | Requisitos múltiples, Flash/caso/acciones, paquetes/parciales, exportación ERP | Reporte inicial preservado, fuentes trazables y UC vigente/aceptada antes de facturar |
| 7 | Integración legacy + operación piloto | Reemplazar masters fixture gradualmente; ownership y reconciliación; rollout por base/contrato | Calidad/mapping aceptados, permisos, restore y métricas de adopción/persistencia |

La infraestructura offline se diseña antes de fase 1, aunque la aceptación offline completa sea fase 2. El gate/documentación crítica mínimo existe en fase 1; no esperar a fase 6 para seguridad operacional. Flash Report mínimo debe estar disponible antes del piloto en campo, aunque investigación completa llegue después. No conectar masters reales sin resolver fuente correcta.

**Testing recomendado:** reglas/invariantes y routing unitarios; transiciones permitidas/prohibidas; integración transaccional + rollback; permisos por objeto/contrato; contratos de API/migración local; sync con red/flujos interrumpidos; E2E por rol; regresión visual de vistas preservadas; rendimiento con volumen representativo. Convertir Golden Scenarios a Given/When/Then con referencias al diccionario y versión. Los 56 PASS declarados no reemplazan esas pruebas.

Casos de aceptación prioritarios: inicio bloqueado por documento/PTW; inicio offline fuera de vigencia; retry después de commit; cambio de plan remoto con trabajo offline; reemplazo parcial de turno; conflicto temporal real; noche/medianoche; cierre anticipado sin alterar plan original; observación comercial sin edición campo; enmienda con UC obsoleta; evidencia pendiente; sesión revocada y tablet compartida. Las pruebas deben verificar significado operacional y no solamente que una función ejecute.

**Piloto:** una base, un contrato/contexto y un grupo pequeño elegido con operaciones; operar en paralelo con el proceso existente hasta verificar completitud, entrega y conciliación. Medir tiempo campo, tasa de corrección, dato faltante, cola más antigua, errores de gate y reconstrucción comercial. No estimar cronograma calendario sin disponibilidad del equipo y hardware.

## 13. Claude strategy

**RECOMMENDATION: PATH C, híbrido por módulo.** Claude Code para modularización técnica preservando UI, dominio, tests y sync. Diseño dirigido para trabajo activo mobile/táctil y excepciones; no rediseño integral de Planificación o bandejas sin evidencia de uso. Se puede conservar visualmente el backoffice mientras se diseña el comportamiento de campo.

| Herramienta / rol | Tarea concreta | Handoff / restricción |
|---|---|---|
| Astra / arquitectura | Resolver semántica y decisiones; criterios de aceptación; límites del slice | Reglas con fuente/versiones, no opiniones visuales como lógica |
| Claude Design o equivalente | Probar Inicio/Trabajo activo/Cierre, feedback offline y conflictos sobre tokens de Juan | Prototipos con estados y excepciones ya especificados; no inventar TipoParte, gates o modelos comerciales |
| Claude Code o equivalente | Migrar componentes, construir API/DB/dominio/sync y ejecutar pruebas | Golden Baseline, scope, interfaces y tests; no simplificar módulos ni cambiar navegación arbitrariamente |

Estas etiquetas describen responsabilidades, no capacidades de productos verificadas en esta auditoría. Si la herramienta de diseño no está disponible, prototipo dirigido con la herramienta existente y validación humana; no condiciona la arquitectura.

**Paquete mínimo de handoff:** commit fijado del repo; diccionario canónico completo vigente con reglas/estados; HTML como mapa; 6–10 Golden Scenarios del primer slice con evidencia; contrato/parte real anonimizado y hardware/conectividad objetivo. Blueprint accesible como referencia navegable. Evitar enviar todos los históricos: priorizar baseline y referencias de casos, con procedencia y autoridad claras.

## 14. Top 15 decisions

| # / Decision | Why | Impact | Reversibility | Decide |
|---|---|---|---|---|
| 1. Preservar producto/navegación por rol | La estructura refleja trabajos reales | Reduce retrabajo y adopción | Alta, si se documenta baseline | NOW |
| 2. Migrar por TP-03 primero | Es el patrón más cercano al prototipo | Valor temprano sin forzar todos los TP | Media; no universalizar su corte | NOW |
| 3. Separar UE/Parte/tiempo | La fila de tramo no representa el trabajo entero | Hace posible asignación, medición y lineage | Baja después de datos reales | NOW |
| 4. Separar estado operativo/revisión/comercial/sync | Mismo `obs` mezcla responsabilidades | Evita reabrir realidad por discusión comercial | Baja tras integraciones | NOW |
| 5. Versionar plan/contrato/reglas | Reconstrucción histórica hoy imposible completa | Comparaciones y decisiones reproducibles | Baja | NOW |
| 6. Gates por comando, especialmente Start Work | Checks al enviar llegan tarde | Control de inicio/cambio/relevo | Media en código; baja en política | NOW |
| 7. Monolito modular | Equipo/volumen no justifican distribución | Simplifica transacciones y operación | Media si boundaries son claros | NOW |
| 8. TS end-to-end bajo validación de talento | Compartir contratos y lógica cliente/servidor | Rapidez y consistencia | Media | NOW; revisar competencias |
| 9. PostgreSQL relacional + JSONB selectivo | Dominio con relaciones/versiones | Integridad y consultas | Baja después del piloto | NOW |
| 10. CRUD + eventos/versiones | Trace sin full event sourcing | Historial y sync con coste razonable | Media | NOW |
| 11. PWA + outbox; native por evidencia | Offline real sin duplicar app prematuramente | Campo utilizable; SLA honesto | Media si dominio/sync son portables | NOW; native LATER |
| 12. Política offline explícita de autorización | No se conoce revocación remota sin red | Decide qué puede hacer campo con datos viejos | Baja operativamente | BEFORE PILOT |
| 13. Enmiendas/UC lineage N:M | Comercial no reescribe ejecución | Correcciones y derivados confiables | Baja | NOW |
| 14. Legacy read-only con ownership/mapping | Servidor y calidad todavía relevándose | Evita doble master y vínculos erróneos | Alta si adapters aislados | NOW; mappings tras acceso correcto |
| 15. Gates humanos/técnicos deterministas; H3 diferido | IA/tracking no son necesidad actual | Evita dependencia opaca y sobrearquitectura | Alta para agregar asistentes/servicios luego | NOW |

## 15. Open questions

Solo decisiones que la evidencia disponible no resuelve:

1. ¿Qué contrato/base/caso real y actores serán el primer piloto TP-03? Define catálogo mínimo, gate, grano comercial y aceptación.
2. ¿Cuál es el directorio corporativo y quién tendrá acceso externo? Define OIDC, enrolamiento, alcance y separación de funciones.
3. ¿Qué tablets/teléfonos, navegador, uso compartido y máximo tiempo offline existen? Define retención local, sesión, TTL y si PWA basta.
4. ¿Qué inicia/reanuda campo offline y con qué autorización de vigencia limitada? Define política de riesgo operativo, no solo implementación de sync.
5. ¿Qué sistema/área posee personas, recursos, contratos, CC y documentación, y cuál es el servidor legacy correcto? Define master y mappings; no reutilizar la extracción equivocada.
6. ¿Qué requisitos/gates/PTW reales del piloto tienen fuente verificable, severidad y excepciones permitidas? El HTML fija estructura, no entrega toda la configuración contractual.
7. ¿Cuál es el grano de aceptación comercial del contrato piloto y quién resuelve discrepancias de medición? Define UC/paquete/parcialidad sin inventar 1 Parte = 1 certificado.
8. ¿Cuál es la capacidad efectiva del equipo en TS/Node/Python y dónde puede operar API/DB? Puede cambiar el stack recomendado y deployment.

Para cerrar las partes no verificadas de la auditoría: URL accesible del prototipo de Juan, acceso permitido al Blueprint protegido y diccionario/XLSX baseline con escenarios. No hacen falta para demostrar los gaps del código ya citados; sí para afirmar equivalencia visual, cumplimiento completo o rendimiento real.

## Registro de evidencia

Repo: [vds-partes-app](https://github.com/vpaincho/vds-partes-app). Referencia: [commit observado](https://github.com/vpaincho/vds-partes-app/commit/0c117aacc6f04a745b3499b0479a938d36821502). [README](https://github.com/vpaincho/vds-partes-app/blob/0c117aacc6f04a745b3499b0479a938d36821502/README.md). [index.html](https://github.com/vpaincho/vds-partes-app/blob/0c117aacc6f04a745b3499b0479a938d36821502/index.html).

| Referencia | Ubicación en index.html | Afirmación soportada |
|---|---|---|
| E01 | 592–641 | Demo v4, fecha fija, roles, catálogos y estados |
| E02 | 725–817 | Seeds, snapshot, estado global y localStorage |
| E03 | 818–909 | Relación plan-fecha, ocupación, km, checks, métricas y ejecución |
| E04 | 910–1002 | Render global, shell, menús y rutas |
| E05 | 1014–1167 | Planificación, Gantt/calendarios, drawer, matriz documental y formulario |
| E06 | 1189–1337 | Jornada, cinco pasos, editor de tiempos, cierre y evidencia |
| E07 | 1339–1395 | Bandejas y detalle, workflow de revisión/certificación |
| E08 | 1397–1450 | Métricas del dashboard y catálogos editables |
| E09 | 1451–1533 | PDF, descarga y firma canvas |
| E10 | 1534–1659 | Bindings, cambio de plan, sync simulado, inicio, cierre, revisión, observación y edición |
| E11 | 1662–1735 | Autosave eventos, login demo, drag, toolbar y escalado |
| E12 | CSS `.device`, `.screen`, `@media`; 551–586 | Marco tablet, modos tema y controles de demo |

Arquitectura HTML: Configuration Plane (CS↔CC, TipoParte), Master Rule Engine (P0–P8), Data Plane (plan/UE/UC), Habilita Plane (gates/PTW), Control Plane (directivas), Field Automation (budgets), Trace/Lineage y notas N-01–N-06. Las cardinalidades citadas provienen del mapa; detalles de campos y las 74 reglas completas quedan sujetos al diccionario fuente.

Fuentes técnicas primarias consultadas el 6/10/2026:

- [Vite — Building for Production](https://vite.dev/guide/build): bundle para hosting estático.
- [Fastify — Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/): schemas y validación runtime.
- [PostgreSQL — Data Definition](https://www.postgresql.org/docs/current/ddl.html): restricciones relacionales.
- [PostgreSQL — Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html): concurrencia y necesidad de retry de transacciones según aislamiento.
- [Dexie — Transaction](https://dexie.org/docs/Transaction/Transaction): transacciones locales sobre IndexedDB.
- [MDN — Background Synchronization](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API): soporte limitado.
- [MDN — Offline and background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation): restricciones de duración/reintentos en segundo plano.
- [MDN — Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API): almacenamiento y persistencia por origen.

**Estado del entregable:** auditoría de código y mapa funcional terminada; inspección online y validación UX empírica pendientes por acceso/materiales. Las recomendaciones no equivalen a aprobación para producción ni a implementación completada.
