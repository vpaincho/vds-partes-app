# Accesos y fuentes · base local v0.7

## Implementado

El usuario tiene una identidad propia (`accountId`), un rol (`admin`, `planner`, `operador`, `cliente`) y asignaciones. El rol decide qué vistas y acciones están disponibles; las asignaciones determinan qué trabajos y partes puede consultar. Al iniciar sesión se actualiza el nombre y el alcance de la vista original, no se abre una pantalla compartida para todos.

| Perfil | Vistas originales | Alcance de datos | Edición |
| --- | --- | --- | --- |
| Admin | Planificación, partes, habilitaciones, aprobación, certificación, dashboard, configuración | Toda la base | Operación original, estados/partes, contratos/centros de costo, imputaciones/tareas, habilitaciones y usuarios |
| Planner | Planificación, aprobación, partes, habilitaciones | Todos los contratos de VDS en esta primera versión | Planificar, revisar, aprobar y devolver; no gestionar usuarios o configuración administrativa |
| Operario | Mi jornada, cinco pasos del parte | Recurso asignado a su cuenta | Partes en curso u observados de ese recurso; no reabrir enviados/aprobados/certificados |
| Cliente | Dashboard, certificación | Operadora asignada a su cuenta | Certificar o observar partes aprobados de esa operadora |

Los módulos adicionales conservan su configuración y se filtran por el mismo alcance de trabajos. Administración puede desactivarlos sin eliminar datos, para evaluar primero el circuito base.

La gestión de usuarios permite crear, editar nombre/usuario/cargo, asignar rol y recurso/operadora, cambiar contraseña y desactivar. Los usuarios no se borran para conservar trazabilidad. La cuenta actual no puede quitarse su propio acceso de administrador y debe quedar un administrador activo. Las nuevas contraseñas se guardan como PBKDF2-SHA256 con sal; no se guarda el texto de la contraseña. Los accesos originales de evaluación continúan disponibles.

`src/core/access.js` concentra proveedor de identidad, política de rutas y acciones y selección de datos por cuenta. `src/admin/console.js` contiene las pantallas de administración. `src/app.js` conserva las vistas originales y conecta esos servicios.

La persistencia escribe el estado completo, no la selección visible del usuario. Así un operario que guarda su parte no elimina los registros de otras cuadrillas. La numeración local se calcula sobre todos los partes, y se evita iniciar dos partes para un mismo trabajo y fecha. En producción se necesitan IDs y unicidad garantizados por la base, también al trabajar offline.

## Conexión de datos pendiente

| Subsistema | Fuente prevista | Consumidores |
| --- | --- | --- |
| Identidad | Directorio/auth y asignaciones autorizadas por servidor | Login, sesión, administración de usuarios |
| Core | Personas, recursos/equipos, clientes y habilitaciones; esquema definitivo por confirmar | Todas las vistas, sin duplicar catálogos en cada rol |
| Planificación | Contratos, imputaciones, trabajos y asignaciones | Planner/admin; jornada del operario |
| Ejecución | Partes y sus actividades, personal, equipos, evidencias | Operario/admin; aprobación del planner |
| Certificación | Decisiones de aprobación, observaciones y firma de cliente | Planner, cliente, admin; facturación posterior |
| Materiales | Pedidos internos y reserva emitida por la operadora | Planner gestiona; operario consulta |

Administración del sistema permite registrar referencias de origen por subsistema. Es documentación editable de procedencia, no un conector SQL/API. No registra secretos ni ejecuta conexiones. Los nombres de tablas, IDs canónicos y relaciones deben acordarse con la base de datos en desarrollo.

Para conectar: sustituir el proveedor local de identidad por autenticación de servidor y cargar datos autorizados por sesión. La selección local muestra el comportamiento esperado, pero **no es una frontera de seguridad**: los datos locales están en el navegador y quien controla ese navegador puede alterarlos. El backend debe autorizar cada lectura y escritura, validar asignaciones/estados, revocar sesiones de usuarios desactivados y conservar auditoría de actores por ID. Nunca descargar toda la base a clientes u operarios y confiar solamente en ocultar filas.

Los formularios de configuración administran datos del sistema; no permiten editar código de servidor desde el navegador. La edición del contrato conserva su ID y los snapshots de partes existentes. No se permite cambiar la operadora de un contrato con registros para evitar reasignar su historia a otro cliente.

## Verificación

11 pruebas de integración DOM cubren circuito original, módulos, cuatro menús, navegación denegada y permisos; altas de cuentas, cambio de recurso/contraseña, desactivación; aislamiento por cuadrilla/operadora; preservación del conjunto completo al guardar; modificación de catálogos sin alterar snapshots; aprobación del planner y certificación con identidad individual. Compilación Vite verificada. Verificación visual en tablet y autenticación multiusuario de servidor pendientes.
