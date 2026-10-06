# Acceptance de la aplicación completa
Fuentes S2 70/71 y 44/56; S4 regresiones. **Especificaciones de pruebas, no tests ejecutados.**

`references/canonical/golden_acceptance.md` incluye exactamente GS-001–056 con Given/When/Then/Must-not, reglas, objetos, transición y fila fuente. Convertirlos en tests reproducibles; conservar ID. GS-055/056 son casos de configuración/governance verificables con validación del pack/import, no fingir E2E de hardware.

`golden_test_map.csv` propone módulos/capas/archivo por cada GS; `rule_test_map.csv` cubre las 74 RUL y sus enlaces a GS. Ambos están en `references/canonical/`, con estado SPEC_NOT_RUN. Una regla sin GS enlazado sigue requiriendo test directo positivo/negativo; completar el mapa C-001–036 y transiciones en Plan Mode, sin asumir que los GS agotan la cobertura.

## Capas requeridas
| Capa | Verifica |
|---|---|
| Domain/rules | C-001–036, RUL-001–074, precedencia/timestamps/scope/empates |
| State | Todas permitidas/condicionales/prohibidas de 49–56, subdimensiones incluidas |
| API/DB | Constraints, transacción/rollback, version mismatch, receipts, source lineage |
| Permissions | Cada comando/lectura por rol y objeto/contrato/base; no IDOR |
| Adapter | Fixture/real cumplen mismos puertos, stale/unknown/error y mapping |
| Offline | Reload, retries/red cortada, conflictos, expiración, sesión/quota/evidencia |
| E2E | Tres TP + Planning/Habilita/review/UC/billing integrados |
| Visual | KEEP de 15 + nuevos estados con viewport comparable |
| Ops | Health, logging sin secretos, migración/restore y ausencia de datos TEST en prod |

## Regresiones adicionales RGT (propuestas P)
| ID | Given / When | Then / prohibición |
|---|---|---|
| RGT-01 PL-093 | Propuesta copia de misma asignación; evaluar extensión | No self-conflict por referencia; otro trabajo realmente solapado sí |
| RGT-02 PD-0394 | Operativo 07:20; PTW activado 11:25 | Nuevo Start a 07:20 bloqueado; histórico importado queda discrepante, nunca autorizado retroactivamente |
| RGT-03 | Plan aprobado 5 días; cierre real día 3 | Versión prevista conserva 5 días; disponibilidad futura cambia por decisión/evento |
| RGT-04 | Cliente observa UC; resolver disputa comercial | UE/Parte/tiempos fuente inalterados |
| RGT-05 | Cristian participó realmente sin habilitación; revisión observa | Presencia histórica permanece; incumplimiento/enmienda explícitos |
| RGT-06 | ACK perdido tras commit; retry mismo command/payload | Mismo receipt/IDs; un solo efecto/intervalo/outbox |
| RGT-07 | Mismo command ID, otro payload | Conflicto tipado, cero efecto adicional |
| RGT-08 | Dos dispositivos cierran expected_version igual | Un cierre; otro requiere resolución, no LWW |
| RGT-09 | Guardado con cuota llena / evidencia upload falla | Error visible; no falso guardado/recepción/cierre documental completo |
| RGT-10 | Turno cruza medianoche | Fecha operativa/turno configurados; no corte global automático |
| RGT-11 | Sesión revocada mientras offline | Reconciliar conserva declaraciones; no autorización silenciosa ni fuga entre usuarios |
| RGT-12 | Falta regla comercial | PENDIENTE_CONFIGURACION; realidad cerrable según gates; nada facturable inventado |
| RGT-13 | Source enmienda y worker retrasado; SEND_ERP | Verificar fuente efectiva al enviar; bloquear UC obsoleta aunque projection no actualizada |
| RGT-14 | Fuente/unidad de dashboard cambia estado o regla futura | Hechos históricos no desaparecen; filtro semántico/versionado explícito |
| RGT-15 | Cliente A pide objeto/download/pull de B | 403/404 conforme policy; sin datos de B |
| RGT-16 | Obligación notificación con canal fixture | Marcada TEST; no prueba entrega externa real |
| RGT-17 | Evaluación preview ALLOW; documento revocado antes del comando | Re-evaluate Start y BLOCK; no confiar en preview |

## Salida QA
Matriz ID→módulo→test→fixture→resultado→evidencia. Fixture canónica y casos inválidos separados. Cobertura cuantitativa de entidades/RUL/GS no sustituye escenarios integrados. No añadir números de tests aprobados hasta ejecutarlos. DoD global exige todas waves y casos aplicables sin pendientes ocultos.
