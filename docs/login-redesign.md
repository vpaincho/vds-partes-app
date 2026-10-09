# Rediseño de acceso · revisión por capas

Rama: `app/rediseno-login`. Base funcional: `5ab7f57b9c4b45eaa9970b5d93a9f815e138775b`.

Esta etapa implementa únicamente el login. Conserva la lógica de identidad local, la configuración de empresa, el direccionamiento por rol y las pantallas funcionales de la base. El rediseño anterior queda separado en `app/instrumentacion-campo`.

## Dirección visual

Fondo de AIB generado para esta aplicación: representa un ambiente patagónico; no es una fotografía de instalaciones reales de Vientos del Sur. Navy #0F172A, acción naranja #F97316, superficies pizarra y texto de alto contraste. Formulario en modo nocturno por defecto y alternancia a modo diurno; ambos se limitan al acceso. Inter para UI y JetBrains Mono para señales técnicas. Marca y logo toman la configuración existente de empresa.

En escritorio, relato de operación a la izquierda y formulario a la derecha. En pantallas estrechas, composición vertical y formulario central. Inputs y CTA de 56px; controles auxiliares de al menos 48px. Botones con foco visible, respuesta al presionar y carga durante la validación. Mostrar/ocultar contraseña y cambiar tema conservan los valores ingresados. El formulario admite valores completados por gestores de contraseñas.

No se agregan proveedores de identidad, cuentas, recuperación de contraseña, sincronización ni servicios remotos. El aviso de evaluación y almacenamiento local sigue visible. La internacionalización completa y los cambios de unidades pertenecen a etapas posteriores; no se simulan en el acceso.

## Capacidad y acceso

| Capacidad existente | Ubicación y acceso |
| --- | --- |
| Ingreso individual | Usuario y contraseña; mismo proveedor local existente |
| Marca de empresa | Cabecera; configuración actual del admin |
| Planner | Después del ingreso: planificación, recursos, revisión, módulos y centro de control existentes |
| Operario | Después del ingreso: jornada, editor original de cinco pasos, firmas, controles y módulos existentes |
| Cliente | Después del ingreso: dashboard, revisión y certificación existentes |
| Admin | Después del ingreso: usuarios, catálogos, documentos, configuración y centro de control existentes |

## Archivos

`src/styles/login.css`: estilos aislados, temas, composición y adaptación.
`src/app.js`: vista del acceso, icono lunar, acciones visuales y lectura del formulario al enviar.
`index.html`: fuentes adicionales en la carga de fuentes existente.
`public/images/login-aib.webp`: imagen generada y optimizada.
`tests/app.test.mjs`: tres pruebas de acceso y selector explícito del botón submit en el helper (el formulario ahora también tiene un botón para mostrar contraseña).

## Ejecutar desde una carpeta del usuario en Windows

Descomprimir el código, abrir PowerShell en esa carpeta y ejecutar:

```powershell
npm.cmd ci
npm.cmd run dev
```

Abrir la URL que indique Vite. `npm.cmd` evita el bloqueo de `npm.ps1` sin cambiar políticas de PowerShell. No ejecutar desde `C:\Windows\System32`.

Validación:

```powershell
npm.cmd test
npm.cmd run build
```

27 pruebas automatizadas cubren acceso, vistas de cuatro roles, permisos y capacidades de la base. Build de Vite. La revisión visual en navegador y tablet real sigue pendiente: las pruebas DOM no validan encuadre, reflejos, disposición ni calidad visual. La siguiente capa de diseño será planner.

## Ajuste de revisión 2

Se corrigió la compresión vertical del área central: su altura mínima respeta el contenido y el acceso puede desplazarse cuando el viewport es bajo. Cabecera y contenido comparten márgenes laterales. Se retiró el pie inferior redundante y la referencia a Cuenca Golfo San Jorge. Sólo queda el sello Patagonia Argentina bajo la secuencia; Friquarks continúa en el lockup de marca.

Planificar, Registrar y Certificar ahora muestran una breve explicación y una señal animada que recorre las etapas. Es una ilustración del circuito, no un indicador de actividad o progreso real. Respeta la preferencia de movimiento reducido, también en sus conectores. La revisión usa la captura enviada como evidencia del desborde anterior; queda pendiente comprobar el resultado en navegador/tablet.
