# ADR propuesto — arquitectura y elecciones técnicas
Estado: propuesta para Plan Mode; S0 gobierna dirección. No se consultó disponibilidad comercial de herramientas ni se validó hardware real en esta entrega.

| Decisión | Status / razón | Validación pendiente |
|---|---|---|
| Una Target Application integral | Fijada por usuario | Coverage global 02/17 |
| Monolito modular | Dirección fijada | Transacciones/owners, operación simple |
| PostgreSQL | Candidato principal/SOT nueva operación | Hosting/restore/equipo; no sustituye ownership maestros externos |
| TypeScript + React/Vite + API Node | Dirección preferida | Compilación/contracts y capacidades del equipo |
| Fastify | Candidato | Schema/auth/stream/upload/testing compatibles |
| Drizzle | Candidato | FKs/versiones/transactions/migrations, SQL explícito para constraints especiales |
| TypeBox/Ajv | Candidato | Una fuente schema; evitar divergencia tipos/runtime, mensajes útiles |
| Dexie/IndexedDB | Candidato | Cuota/persistencia/migrations/binary/outbox en dispositivos |
| PWA frente a native | Hipótesis | Duración offline, browser/device/shared use y sync/evidencias reales |
| Object storage | Necesidad de evidencias | Proveedor final posterior; adapter dev con hashes/ACL |
| CRUD + domain events/outbox | Preferido | Retries/concurrencia; no full event sourcing |
| TP-03 como primer circuito construido | Opción de orden, no target | Orden óptimo 19; tres TP diseñados y entregados |

No decidir nueva tecnología por preferencia de agente. Si evidencia contradice candidato, ADR con requisito fallido, alternativa, migración y efecto sobre producto. Librerías no se vuelven constraints funcionales.

Backend/API/worker deben compartir regla canónica sin importar UI. Consultar documentación oficial vigente al implementar versiones concretas; no fijar versiones por memoria. Contracts/auth schemas/upload deben verificarse en runtime seleccionado.

## Herramientas / responsabilidades
Astra: resolver contrato global, contradicciones y arquitectura.
Diseño dirigido («Claude Design» si disponible): evolución de targets 16 sobre Juan.
Claude Code: implementador principal con repo, terminal, migrations y tests; **primera ejecución Plan Mode sin cambios**. Artifacts/prototipo de diseño no sustituyen backend/DB/sync. PATH C se mantiene con alcance full product, no slice-only.
No declarar una herramienta «mejor» por disponibilidad no verificada: el requerimiento de implementación principal es operar sobre repo y ejecutar pruebas, por eso Claude Code es el destino definido.
