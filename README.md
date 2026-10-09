# VDS · Partes de campo

Aplicación web basada en la versión original `f6579e565bbacf97c7d15985893959003256533b` de `jmalo-star/vds-partes-app`. Conserva las pantallas y el circuito del parte diario, con la interfaz ocupando el navegador sin marco de tablet ni controles exteriores de demostración.

## Ejecutar

Requiere Node.js 22 o superior.

```sh
npm ci
npm run dev
npm test
npm run build
```

Vercel compila con Vite y sirve `dist/`. El manifest y el service worker permiten instalar la app y abrir los recursos locales luego de una primera carga completa en HTTPS. Las fuentes externas necesitan conexión en la primera descarga. El diseño se adapta a tablets; queda pendiente validar visualmente en dispositivos reales, incluyendo teclado, cámara, firma y orientación.

## Estado de esta versión

Es una base frontend modular para evaluación, todavía **no un sistema multiusuario de producción**. Los datos y las fotos se guardan en localStorage por navegador; no hay sincronización entre tablets, autenticación de servidor ni copias centralizadas. No usar datos operativos reales hasta conectar y verificar esos servicios. El espacio local es limitado: hay avisos de error y exportación JSON para respaldo. La interfaz muestra que el guardado es local.

Mantiene datos de ejemplo; sus fechas se desplazan al día actual únicamente en la primera carga. Mantiene los accesos de evaluación originales con contraseña `vds2026`: `sherrera` (administración), `lmendez` (planner), `darce` (operador), `grivas` (cliente). Los permisos de interfaz son para evaluación, no constituyen autorización segura de backend.

## Estructura y módulos

- `src/app.js`: lógica y pantallas originales, con puntos de extensión para menú, configuración y contexto del trabajo.
- `src/styles/baseline.css`: estilos originales. `app.css`: viewport, tablet y nuevos módulos.
- `src/core/storage.js`: adaptador de persistencia local. La futura conexión a la base debe contemplar operaciones asíncronas, sesión, permisos, conflictos y migración; no basta sustituir una URL.
- `src/features/registry.js`: registro de módulos y host compartido.
- `src/features/model.js`: datos adicionales separados en `state.extensions`, validaciones e historial de cambios.
- Un archivo por funcionalidad: `handover`, `issues`, `changes`, `materials`, `logbook`, `capture`, `evidence`, `live`.

Administración → Configuración permite activar o desactivar cada módulo. Desactivarlo retira sus accesos y conserva sus registros; reactivarlo recupera los datos. Cada módulo define sus campos, validaciones, tarjetas y perfiles en su archivo. Quitar un módulo del registro elimina su funcionalidad sin modificar las pantallas originales. Los registros se vinculan al ID del trabajo; no crean ítems de facturación automáticamente.

| Módulo | Alcance inicial |
| --- | --- |
| Relevo | Trabajo realizado, pendientes, condiciones, próximo paso y confirmación de lectura |
| Novedades | Responsable, prioridad, vencimiento, estado y resolución |
| Adicionales | Solicitud e impacto; decisión del planner/admin, separada de certificación |
| Materiales y reservas | Pedido, código manual, retiro, instrucciones y cantidades solicitadas, retiradas y usadas |
| Bitácora | Historia por trabajo, locación y equipo a partir de partes y registros adicionales |
| Captura rápida | Notas y dictado si el navegador lo admite; incorporación revisada a observaciones de un parte editable |
| Evidencias | Foto comprimida, actividad, etapa, fecha y ubicación descriptiva |
| Avance de jornada | Objetivo, avance, unidad, estado, bloqueo y siguiente paso |

## Reservas de la operadora

Los materiales pertenecen a la operadora. Esta app registra el seguimiento del pedido y la reserva, no administra un depósito propio ni genera un código externo. Planner/admin cargan y modifican; el operario consulta número, materiales e instrucciones. El código se exige al declarar la reserva recibida o avanzar al retiro. Se registra historial al editar.

Los estados y campos son provisionales y fácilmente modificables. Antes de integrar: confirmar quién genera la reserva, documento o sistema de origen, formato del código, responsables, retiros parciales, devoluciones y consumos informados a la operadora. No hay OCR ni conexión con su sistema en esta versión.

## Validación

`npm test` verifica login y vistas originales, los cinco pasos del parte y generación PDF; creación, modificación, consulta y persistencia de reservas; validaciones; relevo, novedades, adicionales, captura, avance y bitácora; desactivación sin pérdida de registros y fotografía contextual. Son pruebas DOM con JSDOM; no reemplazan pruebas visuales, servicio offline, micrófono o dispositivos reales.
