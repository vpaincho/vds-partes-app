# VDS · Partes de campo

Prototipo navegable de la app de tablet de **Vientos del Sur** para gestionar partes de servicio con las operadoras.

Circuito: **Planificación → Parte diario → Revisión VDS → Certificación del cliente**.

> Es un prototipo de interfaz: no tiene backend. Los datos son de ejemplo y se guardan en el navegador (`localStorage`). El botón "Reiniciar demo" vuelve a los datos iniciales.

## Usuarios de prueba

Clave para todos: `vds2026`

| Rol | Usuario | Qué hace |
|---|---|---|
| Administrador | `sherrera` | Ve y cambia todo: trabajos, estados de partes, habilitaciones y catálogo de tareas |
| Planner | `lmendez` | Planifica trabajos por contrato (Gantt, por recurso, mes), prioridad, duración y permiso de la operadora; aprueba pedidos de más días |
| Operador | `darce` | Completa el parte diario en campo (Cuadrilla 03) y cierra el trabajo |
| Validador VDS | `msosa` | Responsable técnico: aprueba o devuelve partes |
| Cliente | `grivas` | Austral Petróleo: dashboard del servicio y certificación de partes aprobados |

## Qué incluye

- Planificación por contrato: el contrato define operadora, centro de costos, recursos y catálogo de tareas.
- Indicador de si el trabajo requiere permiso de trabajo firmado por el supervisor de la operadora.
- Vistas Gantt, calendario por recurso y calendario mensual, con ocupación en %.
- Trabajos de varios días: un parte por día. El último día (o antes, si se terminó) el jefe de cuadrilla hace el cierre total del trabajo. Si necesita más días, lo pide desde el parte y el planner lo aprueba.
- En el Gantt los trabajos se estiran, acortan o mueven arrastrando la barra.
- Parte diario estándar en 5 pasos: inicio (llegada a instalación, permiso, clima y checklist), personal (ingreso a base, llegada a zona y salida), equipos (km actual y observación), tareas y tiempos en una sola hoja, y cierre.
- Habilitaciones de ingreso a yacimiento por operadora para personal y vehículos.
- Controles automáticos antes de enviar y en la revisión.
- Dashboard del cliente: horas hombre, tiempos, producción, recursos y estado de partes y trabajos.
- Resumen del parte y descarga en PDF.
- Menú lateral que se contrae.
- Modo sin señal simulado.

## Correrlo localmente

Es un único archivo estático. Abrí `index.html` en el navegador, o levantá un servidor local:

```bash
npx serve .
```

## Publicarlo en Vercel

1. En [vercel.com](https://vercel.com), **Add New → Project** e importá este repositorio.
2. Framework preset: **Other**. Sin comando de build. Output directory: la raíz del repo.
3. **Deploy**. Cada push a `main` vuelve a publicar.

## Estructura

```
index.html   # toda la app: estilos, datos de ejemplo y lógica
README.md
```

Las librerías de PDF (jsPDF y jspdf-autotable) y las fuentes se cargan desde CDN.

## Cómo modificar

- **Datos de ejemplo** (contratos, recursos, personal, habilitaciones, trabajos): en `index.html`, constantes `CONTRATOS`, `RECURSOS`, `CREW`, `EQ`, `HAB` y la función `seedTrabajos()`.
- **Reglas del parte**: función `checks(p)`.
- **Pantallas**: funciones `vPlan`, `vGantt`, `vWeek`, `vMonth`, `vDay`, `vEdit`, `vInbox`, `detail`, `vDash` y `vConf`.
- **PDF**: función `buildPdf(p)`.

Si cambiás la estructura de los datos, subí la versión en la constante `KEY` para que los navegadores no carguen datos viejos guardados.
