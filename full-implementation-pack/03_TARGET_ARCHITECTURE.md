# Target Architecture
Fuentes S0/S2 36, 42–44, 63. Diseño físico P; no restricción funcional nueva.

## Monolito modular
React/Vite consume API Node/TypeScript. PostgreSQL guarda nueva operación, versiones y receipts. Evidencias en object storage con metadata/hash en DB. Worker del mismo código procesa outbox, vencimientos, reconciliación y adapters. IndexedDB guarda contexto/commands/evidencia de campo; la DB servidor es autoridad de nueva operación.

| Módulo propietario | Productor / contrato | Consumidor |
|---|---|---|
| Config/catalogs | Referencias/versiones con ownership | Todos |
| Planning | Interface A: versión aprobada + asignación/UP + readiness | Execution/routing/bundle |
| Execution | Interface B: UE cerradas/versiones, tiempos, recursos, evidencia, imputación | Review/commercial |
| Habilita | Evaluaciones/PTW/evento/caso/obligaciones | Gates/control; consumidores con permiso |
| Control | Directiva tipada + recepción/ACK/efecto | Planning/Execution/Habilita |
| Review | Decisión sobre versión operacional | Commercial eligibility según policy explícita |
| Commercial | UC/source lineage, paquetes/conformidad/ajuste | Billing |
| Billing | Líneas/lotes y referencias externas | ERP adapter |
| Trace | DecisionTrace + eventos de módulos | Lecturas auditables |

Trace explica; no se vuelve fuente alternativa ni edita propietarios. No acceso SQL de un módulo para mutar otro: comandos/servicios de aplicación y transacción compartida cuando la invariancia requiere atomicidad.

## Repo propuesto
`apps/web`, `apps/api`, `apps/worker`; `packages/domain/{config,planning,execution,habilita,control,review,commercial,billing}`; `packages/contracts`, `packages/sync`, `packages/ui`, `packages/adapters`; `db/migrations`, `tests/{domain,integration,e2e,offline,visual}`.
Worker comparte dominio/despliegue lógico; no microservicio. Dominio puro sin React/Fastify/SQL. Contratos validados en límites; la regla servidor no se confía a UI.

## Atomicidad mínima
Start: receipts + evaluación/trace + estados/intervalos. Replacement: fin anterior + nueva asignación tras gate. Close: resultado + cierre tiempos + versión. Amendment: nueva versión + lineage invalidation + evento outbox. Commercial derivation: UC + source versions. ERP: registrar intento durable antes del side effect externo; receipt/ref de respuesta separado.

Los hechos de dominio usan transactional outbox para reacciones; no full event sourcing. API síncrona para invariantes inmediatas. Emisión eventual nunca promete recepción externa. Deployment topology/hosting se selecciona después; no adoptar Sites/Vercel ni publicar por defecto.
