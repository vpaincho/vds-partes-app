# Prompt — Claude Code, primera ejecución PLAN MODE ONLY
Abrir el repo en Claude Code; usar Plan Mode. Adjuntar este pack y fuentes. `22_CLAUDE.md` es propuesta de reglas globales: copiar como CLAUDE.md raíz solo en futura sesión autorizada; este pack no modifica repo.

---

Prepará el plan completo para construir VDS Partes. **En esta ejecución no escribas ni modifiques código, migraciones, configuración ni datos; no despliegues ni conectes externos.** Inspeccioná repo y fuentes disponibles en modo lectura.

Leé ALWAYS LOAD de 00 y el prompt; después LOAD BY MODULE. El objetivo es una aplicación integral funcional, no MVP ni primer slice. TP-01/02/03 y todos los módulos de 02 son target desde ahora. Las waves solo ordenan construcción. No postergues definir TP-01/02 para después del piloto TP-03.

Autoridad: pedido S0; lógica vigente S2, no hojas históricas; producto/UI S1. Reconciliación S4. Este pack propone traducción física P; verificá cada propuesta contra fuentes. No copies HTML a backend conservando mutaciones semánticamente incorrectas ni reemplaces app de Juan por estética Blueprint.

Mantener monolito modular, TypeScript candidato principal, React/Vite/API Node, PostgreSQL principal, domain events/versionado, object storage y offline durable. Fastify/Drizzle/TypeBox-Ajv/Dexie/PWA siguen candidatos; validar constraints y runtime antes de fijar ADR. No microservicios/IoT/CV/3D.

Entregá:
1. Inventario repo/commit/dependencias y diferencia frente a fuente fijada.
2. Target repo tree/módulos/ownership, contratos A/B/control/trace y grafo de dependencias.
3. ER físico con PK/FK/cardinalidades/versiones/índices/constraints; mapping de las 87 entidades. No 87 tablas automáticas ni JSONB generalista.
4. State/command matrix desde 49–56 + proposals review/sync; capability/scope, from/to/gates/effects por comando.
5. Catálogo API con schema/envelopes/errors/query/read models; transacciones, concurrency/receipt/outbox.
6. Estrategias TP-01/02/03 completas y composición UI shared/específica.
7. Lista KEEP/MODIFY/ADD de pantallas/componentes; incorporar diseño aprobado o especificar target de diseño, nunca inventar rediseño.
8. Adapters/mapping/provenance/freshness y fixture contract tests; distinguir nueva operación de masters externos.
9. Offline protocol, bundles/TTL, sesiones, evidence, retries/conflicts y límites de autorización.
10. Migraciones/seed/env/storage/worker/ops y restore; fuentes TEST separadas.
11. Waves/commits con dependencias, salida integrada y Definition of Done global.
12. Test map C/RUL/GS/RGT → unit/API/DB/permissions/offline/E2E/visual.
13. Contradicciones/riesgos/open questions: blocks architecture, blocks connection y configuration later.
14. Criterios para afirmar «release funcional completa» y lista posterior de conexiones/config/productización.

Incluí las correcciones PL-093/PD-0394 y todos escenarios de 17. Tratá los PASS del XLSX como evidencia funcional, no como tests ejecutados. Falta de proveedor externo no impide planear producto; usar port+fixture. Falta de dato contractual no se rellena: pending-config y downstream bloqueado.

No usar selector libre de TipoParte como camino normal. No fila horaria=UE por defecto. No current rules que reescriben pasado. No cliente que modifica campo. ACK no significa aplicación. PTW posterior no autoriza antes. La captura de realidad discrepante se preserva, no se certifica como autorizada.

Terminá con plan global reviewable, cobertura y decisiones técnicas propuestas. **Esperá aprobación del plan para implementar**, manteniendo toda la aplicación como alcance autorizado de la fase futura. No entregar únicamente una propuesta TP-03.
