# Contrato de aplicación completa
Fuentes: S0; S2 41–44, 68, 70. Implementación propuesta P donde se amplía UI.

| Módulo | Resultado funcional requerido | Surface baseline/nueva | Cierre verificable |
|---|---|---|---|
| Configuration | Maestros, contratos/versiones, CS/CC/item/UM, tipos/componentes, reglas | Config de Juan + administración mínima | Publicar configuración válida y explicar pendiente |
| Planning | Demanda, capacidad/nominación, versión, readiness, aprobación/despacho, reprogramación | Gantt/recurso/mes/drawer | Intención histórica íntegra y real vinculado N:M |
| Execution | Parte/UE, routing, asignaciones reales, tiempos/ubicación/medición/evidencia | Partes/Mi jornada | Los tres TP completan ciclo con realidad persistida |
| Control | Directivas con delivery/ACK/effect/rechazo/expiración | Drawer y trabajo activo | Emisión nunca equivale a aplicación |
| Habilita prevent | Documentos/requisitos, evaluaciones/overrides, PTW | Matriz + preparación/PTW | Bloquea antes de iniciar y revalida cambios |
| Habilita respond | Flash, evento/triage/clasificación/caso, acciones/notificaciones/cierre | Nueva superficie dirigida | Reporte original íntegro y lifecycles independientes |
| Review VDS | Completitud/consistencia/versiones/observación/enmienda/aceptación | Bandeja de Juan | No cambia el estado operacional |
| Certification | UC, source versions N:M, elegibilidad/conformidad, ajustes/paquetes/supersession | Bandeja cliente | Aceptación histórica y vigencia actual separadas |
| Billing boundary | Línea/lote, envío/respuesta adapter ERP | Vista administrativa mínima | Solo UC aceptada vigente; no ERP fiscal propio |
| Trace/dashboard | Historia, reglas/decisiones, fuente de cada cifra | Historial/dashboard + drilldown | Cambiar estado no hace desaparecer hechos |
| Platform | Sesiones/capabilities/scope, API/DB, archivos, sync y observabilidad | Transversal | Sin autorización solo frontend ni sync fingido |

La release incluye UI mínima operable de todos los módulos de negocio, no solo entidades vacías. No requiere CRUD independiente para cada entidad lógica: configuración rara puede importarse/validarse por backoffice con preview, errores y control de versión. Prohibir «botón pendiente» como sustituto de una función del core.

No contiene tracking/IoT/CV/3D, optimizador, IA decisora ni infraestructura distribuida. Adaptadores externos faltantes sí tienen implementaciones fixture verificables (14).

## Completion gates
F1 arquitectura/esquema aprobados; F2 flujos por TP; F3 Habilita/control/excepciones; F4 review/UC/billing; F5 offline/permisos/trace; F6 aceptación global. Todos obligatorios para «app completa». Conexión/productización es una etapa posterior explícita, sin reconstrucción prevista del dominio.
