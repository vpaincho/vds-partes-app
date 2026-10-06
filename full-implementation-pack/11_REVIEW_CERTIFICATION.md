# Review, Certification y Billing boundary
S2 44, 54/55, RUL-059–073, GS-041–050. S1: bandejas, detalle y dashboard.

## Review VDS (modelo propuesto P)
Revisa una versión fuente: completitud, consistencia, desvíos y evidencia. Aceptación de review no certifica comercial ni modifica estado Parte. Observación específica diferencia aclaración/completitud, error operacional (solicitud enmienda) y disputa comercial.
Una decisión identifica versión/actor/instante/causa. Nueva versión puede exigir revisión nueva según policy; no reemplazar aceptación previa. Criterio de elegibilidad comercial ligado a review queda declarado/configurado, no implícito.

## Commercial
Derivar UC solo con grano/mapping/reglas disponibles; si faltan, cola PENDIENTE_CONFIGURACION sin valores ficticios. UC puede consumir N UE/versiones y una UE producir N UC. Source link conserva versión exacta y contribución; um/item/cantidad derivada rastreables.
Completitud → ELEGIBLE → EN_REVISION → ACEPTADA/OBSERVADA/RECHAZADA. AjusteCertificacion resuelve diferencia comercial sin editar campo. Error operacional usa Enmienda.
Paquetes agrupan por regla, composiciones versionadas; subset explícito si parcialidad autorizada. No mover/borrar inclusiones históricas.

Enmienda de fuente: aceptación histórica permanece; supersession REQUIERE_RECALCULO bloquea nueva facturación, nueva UC sustituye anterior mediante cadena acíclica, revisión nueva según flujo. Nada recalculado en sitio sobre UC aceptada.

## Billing mínimo
Línea solo desde UC ACEPTADA y VIGENTE con ReglaFacturacion. Lote distinto del paquete; validar → enviar adapter → receipt/aceptación/error externo. Revalidar vigencia al enviar.
Persistir payload/version/hash e intento idempotente, no asumir emisión fiscal por success HTTP. ERP fixture devuelve referencia TEST; product UI deja visible modo proveedor.
Enmienda después del boundary preserva documento/ref original y abre ajuste/compensación externa pendiente; no se diseña impuesto/factura propia.

API P: reviews submit/take/observe/accept/request-amendment; commercial derive/check-eligibility/review/observe/resolve/accept/reject/adjust/supersede; packages group/validate/send/review/partial-accept; billing build-line/group/validate/send/reconcile.

DoD: conservar lista–detalle/plan–real, probar N:M/observación/supersession/partiality/billing; cliente accede solo a contrato/scope autorizado.
