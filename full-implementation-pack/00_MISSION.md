# VDS Partes — Full Implementation Pack v1
Estado: contrato de construcción propuesto para revisión; **NO IMPLEMENTAR en esta ejecución**. Fecha: 06/10/2026.

## Misión y cierre de alcance
Construir una sola aplicación integral: producto de Juan + lógica VDS. Las waves ordenan dependencias de la misma aplicación; no redefinen el target ni habilitan entregar solo TP-03. TP-01/02/03, Planning, Field, Habilita, Review, Certification, boundary de facturación, configuración, dashboards, permisos, persistencia y sync son alcance de la release funcional.

«Completa con adapters» significa lógica y persistencia reales, UI conectada a API/DB, reglas ejecutadas y permisos servidor. Solo sistemas externos usan fixtures/adapters intercambiables. No significa aprobada para operación productiva: conexiones, reglas contractuales, políticas, dispositivos y despliegue deben validarse antes del uso real.

## Autoridad y fuentes
- **S0**: `references/mission_usuario.txt`: pedido actual. Sustituye el target previo «primer slice».
- **S1**: `references/product/index.html` y README, commit `0c117aacc6f04a745b3499b0479a938d36821502`. Product Baseline.
- **S2**: `references/Diccionario_Canonico_v3.0_BASELINE_FUNCIONAL_1.0_FROZEN_VDS.xlsx`. Authority funcional: 41–44, 48–58, 63, 65–74. Hojas candidatas/históricas son contexto, no reglas actuales.
- **S3**: [Blueprint](https://vds-system-blueprint.vercel.app/#/home). Navegación funcional, no UI target.
- **S4**: auditoría y adenda en references. Evidencia y reconciliación, no reemplazo del diccionario.
- **P**: propuestas técnicas o de producto de este pack. Etiquetadas; Claude debe revisarlas en Plan Mode.
Una contradicción se registra con fuente/hoja/fila, impacto y resolución propuesta. No resolver silenciosamente. `reference_manifest.json` fija hashes de bytes entregados; no asume igualdad binaria entre app desplegada y repo.

## Manejo de contexto
| Clase | Cargar |
|---|---|
| ALWAYS LOAD | 00, 01, 02, 03, 05, 06, 15, 18, 19, 22 |
| LOAD BY MODULE | 04, 07–14, 16, 17 + extracts de la hoja pertinente |
| REFERENCE ONLY | XLSX completo, HTML, auditorías, repo original; 20/21 cuando se invocan |
Extraídos exactos en `references/canonical/`; no son especificaciones inventadas. `17_ACCEPTANCE_TESTS.md` define el uso y `golden_acceptance.md` conserva los 56 Given/When/Then.

## Definition of Done global
Todos los módulos/patrones operan integrados con fixtures externas identificadas y DB real. Gates temporales, correcciones, lineage, conflictos y retry son verificables. Ejecutar plan de pruebas de 17; ninguna wave pendiente puede presentarse como app completa. Entregar runbook, migraciones, seed, configuración, matriz de fuentes y reporte de pruebas. Sin publicación ni conexión real por inferencia.
