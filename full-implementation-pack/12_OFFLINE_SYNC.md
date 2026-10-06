# Offline durable y sincronización real
S2 C-016/017, RUL-017/074, 63 y GS-024–027/037. Tecnología P: IndexedDB/Dexie y PWA candidatas.

## Local transaction y command envelope
Guardar command+optimistic projection+IDs/evidence refs en una transacción durable. command_id estable; device_id; schema_version; subject_ref; expected_version; occurred_at + recorded_at; bundle/ruleset refs; correlation/causation; payload hash. Actor se verifica servidor, no se confía al JSON.
Outbox sobrevive reload/reinicio. UI no anuncia guardado hasta éxito; fallo de cuota/almacenamiento visible. Mantener pendientes al cambiar vista; dispositivo compartido aísla scope y sesión.
Bundle generado servidor: versión plan, configuración/gates/dependencies, valid_until, alcance actor/device e integridad. Es cache, no SOT.

## Servidor/receipts
Deduplicar scope+command_id; mismo ID con payload distinto produce conflicto explícito. Receipt durable y outcome original para retries; cambio de contexto genera nueva evaluación/trace relacionada, nunca duplicación del mismo efecto. Transacción reúne receipt, efectos y trace/outbox. No prometer exactly-once de red.
P: `POST /sync/commands` (resultado individual por command), `GET /sync/changes?cursor=...`, context bundles y endpoints separados de evidence upload/status. Cursor monotónico por scope; ordenar dependencias por aggregate, no por reloj del cliente. ACK únicamente después de commit.

## Reconciliación
Version mismatch no usa last-write-wins. Envío antiguo conserva declarado de campo y lo eleva a discrepancia si autorización/contexto cambió; capturar hecho no implica aceptarlo como autorizado.
Resolver con comparación base/local/server, actor habilitado y causa; enmienda si fuente ya cerrada. Conflicto de cierre, directiva expirada o doble dispositivo nunca descarta historia.
Archivos: hash/size/checksum, upload reanudable/idempotente, metadata y receipt independiente. No marcar cierre documental completo cuando evidencia requerida sigue pendiente.

## Política y sesiones
Offline no conoce revocación remota. Política versionada define TTL, comandos permitidos y autorización de contingencia; default fixture conservador bloquea inicio sin contexto/policy vigente. Gates conocidos críticos nunca se omiten. Modo desconectado real, no toggle de estado.
PWA instala/cachea app shell tras preparación online; background sync opcional, retry al abrir/reconectar/manual. Hardware/retención/SSO a validar; native continúa alternativa.

DoD: GS-024/025/026/027/037 + pérdida ACK, reinicio, cuota, evidence failure, revocación/conflicto probados con API/DB reales.
