# Execution Core y Mi jornada
S2 42–44, 50, 57 RUL-021–038/073–074, 68. S1: jornada y detalle/tareas/tiempos.

## Identidad y captura
Parte contiene UE distinguibles, no una UE por input/fila horaria. Recurso de apoyo pertenece a misma UE; subtrabajo autónomo crea UE; nuevo work package exige nuevo TP-01. Relaciones personas/recursos tienen rol e intervalos; ubicaciones rol principal/origen/destino/carga/descarga; medición conserva magnitud operacional/unidad/fuente. Imputación comercial pendiente es explícita.

Mi jornada muestra preparación/readiness → actividad actual → historial/resumen → cierre. Auto/precarga+confirmación según CF-01–13; humano registra realidad no inferible y excepciones. Los cinco pasos de Juan pasan a agrupaciones accesibles, no megaformulario obligatorio al final.

## Comandos API propuestos P
`POST /execution/parts/prepare`; `POST /execution/units`; `POST /execution/units/:id/evaluate-start`; comandos start/suspend/resume/change-time-category/replace-person/replace-resource/confirm-location/capture-measurement/close/no-realizada/anular; `POST /execution/parts/:id/close`; emergent y amendments separados.
Todos reciben command_id, subject/version, actor derivado de sesión, occurred_at, context refs/confirmaciones. API reevalúa gates/estado; preview ALLOW no autoriza un comando posterior con contexto cambiado.

## Start / reanudación
PREPARE → EVALUATE → BLOCK/WARN/REQUIRE_CONFIRMATION o ALLOW → START. Override explícito autorizado solo si gate lo admite. PTW vigente y cobertura temporal/alcance al instante real; permiso firmado después no habilita antes (PD-0394). Parte preparado no comunica ejecución. Replacement/reanudación revalidan sujeto y condiciones.

## Cierre, emergentes y enmiendas
Cerrar UE con resultado/causa, tiempos coherentes y medición/evidencia aplicables; cerrar Parte con todas UE terminales, sin intervalos activos y requisitos de cierre del contexto. Resolver PTW por su lifecycle, sin autocerrar.
Emergente no crea plan ficticio: contexto candidato + motivo/autorización + gates. No inventar CC/item.
Corrección cerrada produce EnmiendaOperativa con old/new/actor/motivo/evidencia/aprobación y versión efectiva nueva; invalida derivados según lineage. La historia de presencia no se cambia para ocultar incumplimiento.

DoD: mismo core satisface 09; jornada y timeline reconstruyen hechos sin nueva captura al certificar.
