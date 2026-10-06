# Boundaries y sustitución de proveedores
S0; S2 36/41/42; source ownership permanece explícito.

| Puerto | Fixture inicial | Contrato de sustitución |
|---|---|---|
| Masters VDS | people/resources/clients/contracts/CC/service/document dataset | read/search/by-external-id + cambios/paginación/freshness |
| Corporate identity | Dev session provider aislado | identidad verificada/claims/expiración; authorization interno |
| Documental | Requisitos/cumplimientos temporales fixture | proveniencia, vigencia, evidencia, estados no inferidos |
| ERP | Respuestas accept/error/unknown rotuladas TEST | submit/reconcile external_ref + idempotency, nunca emisión ficticia |
| Clima | Valores fixture rotulados | lugar/hora/fuente/freshness/unknown; sin gate basado en dato viejo |
| Cliente | Conformidad fixture vía actor de test | envío/recepción/referencia; API externa por contrato real |
| Notificación | Inbox/obligación persistida + canal test | send/status/ref; destinatarios/plazos configurados |
| Files | Object storage local compatible en dev | put/resume/get/hash/status; ACL en application |

## Contrato común P
`ProviderResult<T>`: status OK/NOT_FOUND/UNAVAILABLE/STALE/PENDING_MAPPING, value opcional, source_id/external_id, source_version/observed_at, correlation y error tipado. Nunca devolver `true` si proveedor no respondió.
Domain ports son TypeScript; adapters traducen esquema/protocolo sin decidir regla de negocio. Config/env elige proveedor; UI no importa SDK MySQL/ERP. Pruebas contractuales iguales contra fixture y real.

Masters externos: `external_identity_map` única por source+entity+external_id; ID canónico interno estable. Distinguir ERP master, snapshot importado y nueva operación PostgreSQL; import no reescribe versiones históricas. Estructura fuente real puede requerir mapping/limpieza y reconciliación, pero no cambio de core. No prometer plug-and-play sin ese trabajo.

Import: staging→validación→preview de discrepancias→publicación por owner→version/freshness. Evitar mezclar personas cliente con empresas; no reutilizar extracción del servidor equivocado.

## Preguntas separadas
BLOCKS ARCHITECTURE: no bloqueo conocido para definir target; toda contradicción identidad/cardinalidad nueva abre change control, no se esconde en adapter.
BLOCKS REAL CONNECTION: servidor correcto, permisos/red, ownership, schemas/IDs, scopes, proveedor auth, contrato ERP y storage/hosting.
CONFIGURATION LATER: turnos, corte transporte/reemplazo, PTW/requisitos, TTL/contingencia, grano/medición/parcialidad, matriz Habilita/destinatarios/plazos. Fixtures prueban variantes y ausencia de configuración.
Toda conexión real exige autorización/acceso explícito posterior.
