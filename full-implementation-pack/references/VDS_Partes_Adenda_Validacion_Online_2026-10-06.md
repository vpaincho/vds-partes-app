# VDS Partes — Adenda de validación online

6 de octubre de 2026. Complementa la auditoría aprobada; no la reemplaza. No se implementó, publicó ni modificó código o registros de negocio.

## Evidencia del recorrido

**Product Baseline:** [app de Juan](https://vds-partes-app.vercel.app/), enlazada desde el About del [repositorio](https://github.com/vpaincho/vds-partes-app). La app se identifica como prototipo v0.4; el repo conserva el commit auditado `0c117aacc6f04a745b3499b0479a938d36821502`. Esto acredita correspondencia visible, no identidad binaria del despliegue.

**Functional Architecture Baseline:** [Blueprint](https://vds-system-blueprint.vercel.app/#/home), accesible directamente y rotulado Public read-only handoff. No fue necesario generar acceso temporal. Declara como autoridad el XLSX `Diccionario_Canonico_v3.0_BASELINE_FUNCIONAL_1.0_FROZEN_VDS.xlsx`; el sitio diferencia contenido generado y vistas editoriales.

Se recorrieron en Juan planificación Gantt/recurso/mes, drawer, Mi jornada, los cinco pasos de un parte existente, revisión VDS, dashboard y certificación cliente. En Blueprint: Overview, estados/Parte, handoff, Start Work, GS-024, simulador, interfaces, captura de campo, entidades/UE, búsqueda global, RUL-022, DecisionTrace y Sources. Se probaron filtros, vínculos y presets explicativos. No se ejecutaron Start Work, envíos, correcciones, aprobaciones, cierres ni arrastres que alteran planificación. PDF, persistencia ante reinicio, conectividad real y dispositivo físico siguen sin prueba empírica.

## 1. Conclusiones confirmadas

- La estructura de Juan merece preservarse: navegación por rol, planificación en varias vistas, jornada priorizada, contexto contractual y revisión con evidencia.
- Blueprint confirma UE independiente, intención frente a realidad, gates anteriores a Start Work, interfaces A/B y lineage comercial N:M. El lifecycle del Parte prohíbe reabrir el cerrado para editarlo: corresponde enmienda/nueva ejecución.
- La separación operacional/revisión VDS/comercial/sincronización sigue necesaria. La navegación de Juan muestra los estados combinados identificados en código.
- Offline durable e idempotente sigue siendo trabajo pendiente. “Sincronizado” y “Guardado automático” están visibles, pero no prueban entrega o almacenamiento durable.
- Los 56 PASS siguen sin equivaler a tests productivos: GS-024 define PASS como comportamiento expresable con la baseline. El simulador declara que explica presets y no ejecuta lógica productiva. Field Automation califica sus tiempos como estimaciones, no benchmarks.

## 2. Qué cambia

Se cierran los límites de acceso y de evaluación visual: ambas fuentes tienen despliegues distintos y accesibles. El Blueprint aporta ahora contratos detallados navegables con hoja/fila, no solo cifras del mapa HTML. Esto mejora el handoff, aunque no sustituye recibir y verificar el XLSX canónico completo.

No se revierte ningún hallazgo arquitectónico de la auditoría. Los efectos de cierre anticipado y devolución comercial permanecen sustentados en código; no se ejecutaron por la restricción de no modificar registros.

## 3. Preservación visual/interactiva obligatoria

Conservar el shell por rol y menú contraíble; tarjetas de Mi jornada con pendientes, trabajo actual, próximos y enviados; Gantt/recurso/mes con ocupación y acceso al detalle lateral; contexto del trabajo visible; hoja integrada de tareas/tiempos, timeline y producción; bandeja lista–detalle con controles, plan–real, evidencia e historial; dashboard cliente con filtro por contrato y alcance de datos explícito.

Mantener la jerarquía visual clara, tarjetas claras, sidebar oscuro y acciones principales reconocibles. Los cinco pasos sirven como baseline de organización; su carga manual debe evolucionar según los contratos de captura. Preservar estructura no obliga a copiar el marco de tablet ni su escalado.

## 4. Problemas UX observados y reconciliación con código

| Caso observado | Implicación / reconciliación |
|---|---|
| Pedido de extensión PL-093: “se superpone con PL-093” | Falso conflicto consigo mismo. `clashes()` excluye por referencia de objeto (`o !== t`); evaluar una copia del trabajo permite incluir el original. Excluir por identidad estable y distinguir intervalo vigente del propuesto. |
| PD-0397 aparece En curso con permiso vacío, EPP pendiente y MB-08 vencido | El estado comunica ejecución antes de readiness. Los pasos permiten navegar y el cierre acumula bloqueos. Confirma el gate tardío; no se probó un inicio nuevo. |
| PD-0394 muestra operativo 07:20–10:00 y firma PTW 11:25, con “Sin bloqueos” | `checks()` comprueba presencia de campos PTW, pero no cobertura temporal sobre los tramos. Un dato completado tarde no demuestra autorización al ejecutar. Incorporar discrepancia y trazabilidad sin borrar lo reportado. |
| PD-0392 pide quitar como presente a una persona no habilitada | El copy invita a alterar lo ocurrido. Si participó realmente, preservar el hecho y registrar incumplimiento/enmienda según corresponda; no corregir historia para hacer pasar el control. |
| Gantt con etiquetas truncadas; bandeja cliente con scroll horizontal y detalle vertical largo | Mantener vistas, mejorar lectura y targets. El marco escalado hace pequeños algunos controles en el viewport observado; falta validación táctil real. |
| Cierre: “9 pendientes” agrupa más mensajes visibles, incluidos avisos no bloqueantes | Separar cantidad de bloqueos, advertencias y faltantes para explicar por qué no se puede enviar. |
| Inicio promete funcionamiento sin señal; badge dice “Sincronizado” | El lenguaje supera lo demostrado por la demo. En producción, distinguir guardado local, pendiente de envío y recepción confirmada. |

## 5–7. Arquitectura, stack y PATH C

**Sin cambio de dirección:** potenciar Juan; cuatro dimensiones de estado; UE propia; gate real; intención/realidad separadas; historia/versiones/enmiendas; offline durable e idempotente; monolito modular; PostgreSQL como source of truth de la nueva operación. Sin microservicios ni infraestructura prematura.

**Stack candidato sin cambio:** React/Vite + TypeScript + Fastify + PostgreSQL. PWA frente a native, TP-03 primero, Drizzle, TypeBox/Ajv y Dexie quedan como hipótesis de implementación hasta validar piloto, equipo y dispositivos. El Developer Handoff del Blueprint deja explícitamente abiertos framework, DB física, auth, tecnología offline y UI de producción.

**PATH C se mantiene:** Astra → diseño dirigido → Claude Code. Dirigir diseño a preparación/inicio, trabajo activo, cierre, feedback de guardado/sync y discrepancias observadas. No rediseñar íntegramente planificación, navegación o bandejas ni trasladar la estética documental del Blueprint a campo por defecto.

## Paquete mínimo para Claude

| Entrega | Contenido mínimo |
|---|---|
| `00_README_HANDOFF.md` | Autoridad de cada fuente, alcance y prohibiciones: preservar producto; no reinterpretar reglas ni resolver ambigüedades silenciosamente. |
| Product Baseline fijada | Commit + fixtures + capturas desktop/tablet de los recorridos anteriores; inventario KEEP. URLs sirven de consulta, no de versión reproducible. |
| Functional Baseline | XLSX canónico completo, mapa HTML y extracto trazable de entidades, relaciones, reglas, estados y captura aplicables al slice elegido. Workflows editoriales enlazados a reglas fuente. |
| Contrato del slice | Caso/contrato piloto, actores, límites, comandos, gates, cuatro estados independientes, IDs UE/Parte, versiones, permisos y derivación comercial mínima según contrato. TP-03 es candidato. |
| Diseño dirigido | Pantallas de Juan anotadas + estados faltantes de preparación, bloqueo, guardado, recepción, discrepancia y enmienda; criterios visuales de preservación. |
| Aceptación y fixtures | 6–10 escenarios Given/When/Then con fuente y resultado verificable: happy path, hard block/PTW temporal, recurso vencido, cierre anticipado, observación comercial, enmienda, reinicio offline, retry tras commit, bundle vencido y conflicto. Incluir PL-093/PD-0394 como regresiones concretas. |
| Decisiones técnicas | ADR breve: monolito modular y PostgreSQL; stack candidato; alternativas abiertas, hardware, política de inicio offline y TTL. No convertir librerías candidatas en contratos funcionales. |

**Antes de construir:** elegir el caso piloto y recibir baseline fuente y reglas contractuales mínimas. Claude debe presentar un mapa de cambios y ambigüedades; después implementar el circuito autorizado con pruebas de invariantes y regresión visual. Esta adenda no autoriza implementación.
