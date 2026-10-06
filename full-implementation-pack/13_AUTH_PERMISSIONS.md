# Identity y authorization
P técnica requerida por S0; roles UX de S1. La baseline funcional no fija proveedor corporativo.

## Capabilities propuestas
| Actor fixture | Alcance y comandos |
|---|---|
| Planner | Base/contratos asignados; versiones/nominación/readiness/despacho/directivas permitidas |
| Campo | Trabajos propios/roster autorizado; start/tiempo/medición/evidencia/Flash |
| Supervisor | Scope operativo; reemplazos/autorizaciones/enmiendas según capability |
| Habilita | Documentos/PTW/eventos/casos/acciones; autoridad de override separada |
| Review VDS | Revisión sobre scope/version; no edición de ejecución |
| Cliente | Contratos permitidos; lectura comercial/conformidad; no escritura operacional |
| Administración | Líneas/lotes/ERP; no gate de seguridad |
| Config admin | Publicar catálogos/reglas dentro de ownership; no editar historia |

Role es bundle de capabilities, no control único. Verificar sesión, scope empresa/base/contrato, acción, objeto y propiedad en **cada API**, lecturas/downloads/pull sync incluidos. Default deny; resolver actor en servidor. P: separar emitir y autorizar overrides/enmiendas cuando policy requiera doble control.

Provider fixture genera identidades/sesiones controladas en entorno de desarrollo; permisos servidor reales funcionan. Ningún selector de rol frontend equivale a login productivo. Corporate provider adapter devuelve sujeto verificado/claims; el mapeo interno de permisos permanece independiente.

Sesiones/dispositivos: expiración/revocación, aislamiento local, logout sin pérdida silenciosa de cola; política define retención/cifrado/desbloqueo offline. No prometer autorización remota al estar offline. El envío al recuperar red revalida sesión/actor y conserva discrepancias de hechos ocurridos.

API P: session me/start/end/devices; permissions policy lookup solo para UX, enforcement autoritativo servidor. Object storage accesible por URL firmada de corta vida tras permiso, nunca por nombre predecible.

DoD: cliente A no accede a B, operator no aprueba review/override, admin técnico no obtiene autoridad Habilita implícita, scope local/cache/pull coherente y payload actor falsificado rechazado. El proveedor definitivo es conexión posterior, no motivo para mockear autorización.
