# Product Baseline de Juan
Fuente S1 + S4. [App](https://vds-partes-app.vercel.app/) y repo fijado en 00.

## Preservar y evolucionar
| Área | Superficie KEEP | Evolución requerida |
|---|---|---|
| Shell | Navegación según actor, menú contraíble, identidad/contexto | Capabilities y scopes reales; demo role switch fuera del build operativo |
| Planning | Gantt/recurso/mes, ocupación, drawer, extensión | Versiones, readiness, despacho, directivas y conflictos por ID |
| Field | Mi jornada: corregir/actual/próximos/enviados; contexto visible | Preparación, trabajo activo progresivo, TP-01/02/03, sync veraz |
| Parte | Personal/equipos, hoja tareas–tiempos, timeline, producción, evidencia, resumen/PDF | UE explícita y temporalidad; no equiparar tramo con UE |
| Review | Lista–detalle, controles, motivo, plan–real, historia | Dimensión propia y solicitud de enmienda |
| Commercial | Bandeja cliente, resumen y conformidad | UC N:M y paquetes, ajuste separado |
| Dashboard/config | Contrato, indicadores y catálogos | Fuentes/versiones y gestión autorizada |

Retener jerarquía, agrupaciones, lenguaje visual y acciones reconocibles. Diseñar cambios solo donde un comportamiento nuevo lo exige. El marco tablet escalado es demostrativo, no requisito de layout de producción.

## Migración semántica
`S.trabajos` no se copia como único Plan/Asignación/Parte. `S.partes` no permanece con estado universal. `p.ejec.reg` es evidencia de tiempo/tarea; no regla de identidad UE. `S.hab` pasa a vista de requisitos/cumplimientos temporales. `p.cert` no representa toda la UC/paquete.

Se conserva repo original de consulta, no como código vivo mezclado con nueva API. P: modularización incremental en el mismo proyecto con regresión visual; no nueva app visual desde cero.

## Regresiones obligatorias
PL-093 auto-conflicto, PD-0394 PTW posterior, cierre anticipado sin truncar intención, observación comercial sin devolver realidad a edición. S4 sustenta comportamiento visible/código. No mover silenciosamente fixtures históricas inconsistentes al estado «válido»: conservar como casos negativos.

DoD: inventario de pantallas/components KEEP/MODIFY/ADD con razón, screenshots comparables y cada capacidad enlazada a módulo de 02.
