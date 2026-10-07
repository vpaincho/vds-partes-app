-- Capabilities and roles.
--
-- Default deny means an empty platform.capabilities table makes every command unauthorised, which
-- is why /ready refuses to report healthy until this has run.
--
-- The roles mirror the actors of the prototype (admin, planner, operador, validador, cliente) so the
-- product remains recognisable, but a role is only a BUNDLE: every check is on a capability (13).
-- The demo role switcher is NOT reproduced — it is excluded from the operational build.

INSERT INTO platform.capabilities (id, module, description, dual_control) VALUES
  -- planning
  ('planning.read',             'planning',  'Leer planificación, timeline, recurso y mes.', false),
  ('planning.demand',           'planning',  'Crear y aceptar demanda operativa.', false),
  ('planning.plan',             'planning',  'Crear planes y versiones en borrador.', false),
  ('planning.version',          'planning',  'Validar una versión de planificación.', false),
  ('planning.approve',          'planning',  'Aprobar una versión: congela el snapshot (RUL-010).', false),
  ('planning.nominate',         'planning',  'Nominar personas y recursos (RUL-012).', false),
  ('planning.readiness',        'planning',  'Evaluar readiness (RUL-013/014).', false),
  ('planning.dispatch',         'planning',  'Despachar contexto a campo (RUL-016).', false),
  ('planning.result',           'planning',  'Resolver una asignación como cumplida o no realizada.', false),
  ('planning.cancel',           'planning',  'Cancelar una asignación antes del inicio.', false),

  -- control plane
  ('control.emit',              'control',   'Emitir directivas operativas (RUL-054).', false),
  ('control.apply',             'control',   'Aplicar o rechazar una directiva con causa.', false),

  -- execution
  ('execution.read',            'execution', 'Leer partes, UE, tiempos y evidencia.', false),
  ('execution.prepare',         'execution', 'Preparar un Parte y crear UE (RUL-021).', false),
  ('execution.start',           'execution', 'Iniciar trabajo: pasa por los gates duros (RUL-022/023).', false),
  ('execution.capture',         'execution', 'Registrar tiempos, ubicación, medición y evidencia.', false),
  -- Separate from capture: choosing who actually took a role is a supervisory act (IH-05).
  ('execution.replace',         'execution', 'Reemplazar persona o recurso (RUL-025/026).', false),
  ('execution.close',           'execution', 'Cerrar UE y Parte (RUL-033/034).', false),
  -- Dual control: amending closed reality needs an authority distinct from the requester (13).
  ('execution.amend',           'execution', 'Crear EnmiendaOperativa sobre realidad cerrada (RUL-073).', true),
  ('execution.emergent',        'execution', 'Autorizar inicio emergente con contexto pendiente (RUL-037).', true),

  -- habilita
  ('habilita.read',             'habilita',  'Leer matriz, evaluaciones, permisos, eventos y casos.', false),
  ('habilita.report',           'habilita',  'Reportar un evento Habilita (Flash Report, RUL-047).', false),
  ('habilita.documental',       'habilita',  'Administrar requisitos, documentos y cumplimientos.', false),
  ('habilita.triage',           'habilita',  'Triage y clasificación de eventos (RUL-048/049).', false),
  ('habilita.case',             'habilita',  'Gestionar casos, acciones y notificaciones.', false),
  -- The authority to override is separate from every operational capability (C-018, RUL-041).
  ('habilita.override',         'habilita',  'Autorizar un override sobre un warning overrideable.', true),
  ('habilita.permit.manage',    'habilita',  'Crear y enviar a aprobación un permiso de trabajo.', false),
  ('habilita.permit.approve',   'habilita',  'Aprobar o rechazar un permiso de trabajo.', true),
  ('habilita.permit.activate',  'habilita',  'Activar, suspender y cerrar un permiso (RUL-043/046).', false),

  -- review
  ('review.read',               'review',    'Leer la bandeja de revisión VDS.', false),
  ('review.decide',             'review',    'Aceptar u observar una versión; solicitar enmienda.', false),

  -- commercial
  ('commercial.read',           'commercial','Leer unidades comerciales, paquetes y lineage.', false),
  ('commercial.derive',         'commercial','Derivar unidades comerciales (RUL-059).', false),
  ('commercial.decide',         'commercial','Observar, aceptar o rechazar una UC o paquete.', false),
  ('commercial.adjust',         'commercial','Autorizar un AjusteCertificacion (RUL-064).', true),
  -- The client reads its own contract scope and signs conformity. It never writes operation.
  ('commercial.client.read',    'commercial','Lectura comercial del cliente sobre su contrato.', false),
  ('commercial.client.conform', 'commercial','Registrar conformidad o observación del cliente.', false),

  -- billing
  ('billing.read',              'billing',   'Leer líneas y lotes.', false),
  ('billing.build',             'billing',   'Construir líneas y lotes (RUL-070/071).', false),
  ('billing.send',              'billing',   'Enviar un lote al adapter ERP (RUL-072).', true),

  -- configuration
  ('config.read',               'config',    'Leer maestros, contratos y reglas.', false),
  ('config.publish',            'config',    'Publicar catálogos, contratos y versiones de regla.', true),
  ('config.import',             'config',    'Ejecutar y publicar importaciones de maestros.', true),

  -- trace
  ('trace.read',                'trace',     'Leer DecisionTrace y lineage.', false)
ON CONFLICT (id) DO UPDATE
  SET description = excluded.description, dual_control = excluded.dual_control;

INSERT INTO platform.roles (id, label, description) VALUES
  ('admin',     'Administrador',  'Administración técnica. NO otorga autoridad Habilita ni de enmienda por sí sola.'),
  ('planner',   'Planner',        'Planifica por contrato: versiones, nominación, readiness, despacho y directivas.'),
  ('field',     'Operador',       'Completa el parte en campo: inicio, tiempos, medición, evidencia y cierre.'),
  ('supervisor','Supervisor',     'Alcance operativo: reemplazos, autorizaciones y enmiendas según capability.'),
  ('habilita',  'Habilita',       'Documental, PTW, eventos, casos y acciones. Autoridad de override separada.'),
  ('review',    'Validador VDS',  'Revisa sobre una versión. No edita ejecución.'),
  ('client',    'Cliente',        'Lectura comercial y conformidad sobre su contrato. Sin escritura operacional.'),
  ('backoffice','Administración', 'Líneas, lotes y ERP. No es un gate de seguridad.'),
  ('config',    'Config admin',   'Publica catálogos y reglas dentro de su ownership. No edita historia.')
ON CONFLICT (id) DO UPDATE SET label = excluded.label, description = excluded.description;

-- Role to capability. The DoD cases of 13 are what these grants must satisfy:
--   * a client cannot reach another client's data  -> scope, not capability
--   * an operator cannot approve a review or an override
--   * a technical admin does not implicitly gain Habilita authority
INSERT INTO platform.role_capabilities (role_id, capability_id) VALUES
  -- planner
  ('planner', 'planning.read'), ('planner', 'planning.demand'), ('planner', 'planning.plan'),
  ('planner', 'planning.version'), ('planner', 'planning.approve'), ('planner', 'planning.nominate'),
  ('planner', 'planning.readiness'), ('planner', 'planning.dispatch'), ('planner', 'planning.result'),
  ('planner', 'planning.cancel'), ('planner', 'control.emit'), ('planner', 'execution.read'),
  ('planner', 'habilita.read'), ('planner', 'config.read'), ('planner', 'trace.read'),

  -- field: captures reality. Cannot close a review, cannot override, cannot amend.
  ('field', 'execution.read'), ('field', 'execution.prepare'), ('field', 'execution.start'),
  ('field', 'execution.capture'), ('field', 'execution.close'), ('field', 'habilita.report'),
  ('field', 'habilita.read'), ('field', 'planning.read'), ('field', 'control.apply'),

  -- supervisor: adds replacement and amendment, still not Habilita override.
  ('supervisor', 'execution.read'), ('supervisor', 'execution.prepare'), ('supervisor', 'execution.start'),
  ('supervisor', 'execution.capture'), ('supervisor', 'execution.replace'), ('supervisor', 'execution.close'),
  ('supervisor', 'execution.amend'), ('supervisor', 'execution.emergent'),
  ('supervisor', 'habilita.report'), ('supervisor', 'habilita.read'),
  ('supervisor', 'habilita.permit.manage'), ('supervisor', 'habilita.permit.activate'),
  ('supervisor', 'planning.read'), ('supervisor', 'control.emit'), ('supervisor', 'control.apply'),
  ('supervisor', 'trace.read'),

  -- habilita: the only role with override authority and permit approval.
  ('habilita', 'habilita.read'), ('habilita', 'habilita.report'), ('habilita', 'habilita.documental'),
  ('habilita', 'habilita.triage'), ('habilita', 'habilita.case'), ('habilita', 'habilita.override'),
  ('habilita', 'habilita.permit.manage'), ('habilita', 'habilita.permit.approve'),
  ('habilita', 'habilita.permit.activate'), ('habilita', 'control.emit'),
  ('habilita', 'execution.read'), ('habilita', 'planning.read'), ('habilita', 'trace.read'),

  -- review: decides on a version. No execution write at all.
  ('review', 'review.read'), ('review', 'review.decide'), ('review', 'execution.read'),
  ('review', 'planning.read'), ('review', 'habilita.read'), ('review', 'trace.read'),

  -- client: reads its own scope and signs. Zero operational write (S0, RGT-04).
  ('client', 'commercial.client.read'), ('client', 'commercial.client.conform'),

  -- backoffice: commercial derivation and billing. Not a security gate.
  ('backoffice', 'commercial.read'), ('backoffice', 'commercial.derive'), ('backoffice', 'commercial.decide'),
  ('backoffice', 'commercial.adjust'), ('backoffice', 'billing.read'), ('backoffice', 'billing.build'),
  ('backoffice', 'billing.send'), ('backoffice', 'execution.read'), ('backoffice', 'trace.read'),

  -- config admin: publishes configuration, never edits history.
  ('config', 'config.read'), ('config', 'config.publish'), ('config', 'config.import'),
  ('config', 'trace.read'),

  -- admin: technical breadth, but NOT habilita.override, NOT execution.amend, NOT permit.approve,
  -- NOT review.decide. 13: "admin técnico no obtiene autoridad Habilita implícita".
  ('admin', 'planning.read'), ('admin', 'execution.read'), ('admin', 'habilita.read'),
  ('admin', 'review.read'), ('admin', 'commercial.read'), ('admin', 'billing.read'),
  ('admin', 'config.read'), ('admin', 'trace.read')
ON CONFLICT (role_id, capability_id) DO NOTHING;
