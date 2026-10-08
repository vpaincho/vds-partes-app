/**
 * Fastify application.
 *
 * Routes are thin: validate, resolve the actor, hand the command to the pipeline, map the result.
 * Every command shares one path, so authorization, idempotency, rule evaluation, the transaction and
 * the trace cannot be forgotten per endpoint — 03_TARGET_ARCHITECTURE requires that uniformity, and
 * it is also what makes the permissions test matrix tractable.
 *
 * Deliberately absent: any `PATCH /parts/:id` that sets a state. 05_STATE_MODEL is explicit — "REST
 * no permite PATCH arbitrario de estado." A state changes only through a named command whose
 * transition the state machine permits.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  DomainError,
  HTTP_STATUS,
  instantNow,
  isDomainError,
  isUuid,
  uuidv4,
  type Uuid,
} from '@vds/kernel';
import { COMMANDS, command as commandDefinition } from '@vds/contracts';
import { closeDb, initDb, withConnection } from './platform/db.ts';
import {
  findRevokedSession,
  resolveActor,
  touchSession,
  unauthenticated,
  type AuthenticatedActor,
  type RevokedSessionInfo,
} from './platform/authz.ts';
import { execute, registeredCommands } from './platform/pipeline.ts';
import { registerExecutionCommands } from './commands/execution.ts';
import { registerExecutionCaptureCommands } from './commands/execution-capture.ts';
import { registerExecutionLifecycleCommands } from './commands/execution-lifecycle.ts';
import { registerPlanningCommands } from './commands/planning.ts';
import { registerControlCommands } from './commands/control.ts';
import { registerHabilitaCommands } from './commands/habilita.ts';
import { registerHabilitaRespondCommands } from './commands/habilita-respond.ts';
import { registerReviewCommands } from './commands/review.ts';
import { registerCommercialCommands } from './commands/commercial.ts';
import { registerBillingCommands } from './commands/billing.ts';
import { registerSyncCommands } from './commands/sync.ts';
import { registerReadRoutes } from './reads/routes.ts';
import { registerHabilitaRespondReadRoutes } from './reads/habilita-respond.ts';
import { registerReviewCommercialBillingReadRoutes } from './reads/review-commercial-billing.ts';
import { registerDashboardReadRoutes } from './reads/dashboard.ts';
import { registerSyncReadRoutes } from './reads/sync.ts';
import { registerConfigReadRoutes } from './reads/config.ts';
import { registerHabilitaDocumentalReadRoutes } from './reads/habilita-documental.ts';
import { registerSyncRoutes } from './sync/routes.ts';
import { registerEvidenceRoutes } from './evidence/routes.ts';
import { registerPlanningReadRoutes } from './reads/planning.ts';
import { registerDevAuthRoutes } from './dev/auth.ts';

export interface ServerOptions {
  readonly databaseUrl: string;
  readonly rulesetVersion: string;
  readonly logger?: boolean;
  /** DEV-only fixture login helper. Defaults false for embedded/test servers. */
  readonly devAuth?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor?: AuthenticatedActor;
    requestId: Uuid;
    /** RGT-11: set only on /sync/commands when the bearer names a session that was revoked. */
    revokedSession?: RevokedSessionInfo;
  }
}

/**
 * Which URL segment carries the subject id for each command, and which payload key the handler
 * expects it under. Keeping this next to the routes means a command cannot be exposed without
 * saying how its subject is addressed.
 */
const SUBJECT_ROUTES: Record<string, { path: string; idParam?: string }> = {
  // planning
  'planning.versions.approve': {
    path: '/planning/versions/:planVersionId/approve',
    idParam: 'planVersionId',
  },
  'planning.assignments.evaluate-readiness': {
    path: '/planning/assignments/:assignmentId/evaluate-readiness',
    idParam: 'assignmentId',
  },
  'planning.assignments.dispatch': {
    path: '/planning/assignments/:assignmentId/dispatch',
    idParam: 'assignmentId',
  },
  'planning.assignments.nominate': {
    path: '/planning/assignments/:assignmentId/nominate',
    idParam: 'assignmentId',
  },
  'planning.assignments.request-extension': {
    path: '/planning/assignments/:assignmentId/request-extension',
    idParam: 'assignmentId',
  },
  'planning.assignments.resolve-extension': {
    path: '/planning/assignments/:assignmentId/resolve-extension',
    idParam: 'assignmentId',
  },
  'planning.assignments.mark-not-performed': {
    path: '/planning/assignments/:assignmentId/mark-not-performed',
    idParam: 'assignmentId',
  },
  // control plane
  'control.directives.emit': { path: '/control/directives/emit' },
  'control.directives.ack': { path: '/control/directives/:directiveId/ack', idParam: 'directiveId' },
  'control.directives.apply': { path: '/control/directives/:directiveId/apply', idParam: 'directiveId' },
  'control.directives.reject': { path: '/control/directives/:directiveId/reject', idParam: 'directiveId' },
  // habilita
  'habilita.permits.create': { path: '/habilita/permits' },
  'habilita.permits.submit': { path: '/habilita/permits/:permitId/submit', idParam: 'permitId' },
  'habilita.permits.approve': { path: '/habilita/permits/:permitId/approve', idParam: 'permitId' },
  'habilita.permits.activate': { path: '/habilita/permits/:permitId/activate', idParam: 'permitId' },
  'habilita.permits.suspend': { path: '/habilita/permits/:permitId/suspend', idParam: 'permitId' },
  'habilita.permits.close': { path: '/habilita/permits/:permitId/close', idParam: 'permitId' },
  'habilita.events.flash-report': { path: '/habilita/events/flash-report' },
  'habilita.events.start-triage': {
    path: '/habilita/events/:eventId/start-triage',
    idParam: 'eventId',
  },
  'habilita.events.classify': { path: '/habilita/events/:eventId/classify', idParam: 'eventId' },
  'habilita.events.escalate-to-case': {
    path: '/habilita/events/:eventId/escalate-to-case',
    idParam: 'eventId',
  },
  'habilita.events.close-without-case': {
    path: '/habilita/events/:eventId/close-without-case',
    idParam: 'eventId',
  },
  'habilita.events.discard': { path: '/habilita/events/:eventId/discard', idParam: 'eventId' },
  'habilita.cases.start-investigation': {
    path: '/habilita/cases/:caseId/start-investigation',
    idParam: 'caseId',
  },
  'habilita.cases.finish-investigation': {
    path: '/habilita/cases/:caseId/finish-investigation',
    idParam: 'caseId',
  },
  'habilita.cases.evaluate-closure': {
    path: '/habilita/cases/:caseId/evaluate-closure',
    idParam: 'caseId',
  },
  'habilita.cases.close': { path: '/habilita/cases/:caseId/close', idParam: 'caseId' },
  'habilita.actions.create': { path: '/habilita/actions' },
  'habilita.actions.implement': { path: '/habilita/actions/:actionId/implement', idParam: 'actionId' },
  'habilita.actions.verify': { path: '/habilita/actions/:actionId/verify', idParam: 'actionId' },
  'habilita.notifications.create': { path: '/habilita/notifications' },
  'habilita.notifications.resolve': {
    path: '/habilita/notifications/:notificationId/resolve',
    idParam: 'notificationId',
  },
  'habilita.notifications.attempt-channel': {
    path: '/habilita/notifications/:notificationId/attempt-channel',
    idParam: 'notificationId',
  },
  // review
  'review.decisions.create': { path: '/review/decisions' },
  'review.decisions.accept': { path: '/review/decisions/:decisionId/accept', idParam: 'decisionId' },
  'review.decisions.observe': { path: '/review/decisions/:decisionId/observe', idParam: 'decisionId' },
  'review.amendment-requests.create': { path: '/review/amendment-requests' },
  'review.amendment-requests.resolve': {
    path: '/review/amendment-requests/:requestId/resolve',
    idParam: 'requestId',
  },
  // commercial
  'commercial.units.derive': { path: '/commercial/units' },
  'commercial.units.complete-requirements': {
    path: '/commercial/units/:unitId/complete-requirements',
    idParam: 'unitId',
  },
  'commercial.units.enter-review': { path: '/commercial/units/:unitId/enter-review', idParam: 'unitId' },
  'commercial.units.accept': { path: '/commercial/units/:unitId/accept', idParam: 'unitId' },
  'commercial.units.reject': { path: '/commercial/units/:unitId/reject', idParam: 'unitId' },
  // billing
  'billing.lines.build': { path: '/billing/lines' },
  'billing.lots.create': { path: '/billing/lots' },
  'billing.lots.validate': { path: '/billing/lots/:lotId/validate', idParam: 'lotId' },
  'billing.lots.send': { path: '/billing/lots/:lotId/send', idParam: 'lotId' },
  // execution
  'execution.parts.prepare': { path: '/execution/parts/prepare' },
  'execution.units.create': { path: '/execution/units' },
  'execution.units.start': { path: '/execution/units/:executionUnitId/start', idParam: 'executionUnitId' },
  'execution.units.suspend': { path: '/execution/units/:executionUnitId/suspend', idParam: 'executionUnitId' },
  'execution.units.resume': { path: '/execution/units/:executionUnitId/resume', idParam: 'executionUnitId' },
  'execution.units.change-time-category': {
    path: '/execution/units/:executionUnitId/change-time-category',
    idParam: 'executionUnitId',
  },
  'execution.units.confirm-location': {
    path: '/execution/units/:executionUnitId/confirm-location',
    idParam: 'executionUnitId',
  },
  'execution.units.capture-measurement': {
    path: '/execution/units/:executionUnitId/capture-measurement',
    idParam: 'executionUnitId',
  },
  'execution.units.replace-person': {
    path: '/execution/units/:executionUnitId/replace-person',
    idParam: 'executionUnitId',
  },
  'execution.units.replace-resource': {
    path: '/execution/units/:executionUnitId/replace-resource',
    idParam: 'executionUnitId',
  },
  'execution.units.record-transition': {
    path: '/execution/units/:executionUnitId/record-transition',
    idParam: 'executionUnitId',
  },
  'execution.units.mark-not-performed': {
    path: '/execution/units/:executionUnitId/mark-not-performed',
    idParam: 'executionUnitId',
  },
  'execution.units.void': { path: '/execution/units/:executionUnitId/void', idParam: 'executionUnitId' },
  'execution.units.close': { path: '/execution/units/:executionUnitId/close', idParam: 'executionUnitId' },
  'execution.allocations.resolve': {
    path: '/execution/units/:executionUnitId/resolve-allocation',
    idParam: 'executionUnitId',
  },
  'execution.parts.close': { path: '/execution/parts/:partId/close', idParam: 'partId' },
  'execution.parts.void': { path: '/execution/parts/:partId/void', idParam: 'partId' },
  'execution.parts.handover': { path: '/execution/parts/:partId/handover', idParam: 'partId' },
  'execution.amendments.create': { path: '/execution/amendments' },
  'execution.amendments.approve': {
    path: '/execution/amendments/:amendmentId/approve',
    idParam: 'amendmentId',
  },
  'execution.evidence.attach': { path: '/execution/evidence' },
  // sync (RGT-11)
  'sync.discrepancies.resolve': {
    path: '/sync/discrepancies/:discrepancyId/resolve',
    idParam: 'discrepancyId',
  },
};

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  initDb({ connectionString: options.databaseUrl });
  registerExecutionCommands();
  registerExecutionCaptureCommands();
  registerExecutionLifecycleCommands();
  registerPlanningCommands();
  registerControlCommands();
  registerHabilitaCommands();
  registerHabilitaRespondCommands();
  registerReviewCommands();
  registerCommercialCommands();
  registerBillingCommands();
  registerSyncCommands();

  const devAuth = options.devAuth ?? false;

  const app = Fastify({
    logger: options.logger ?? false,
    // A command payload is small; evidence goes through the upload endpoints, not here.
    bodyLimit: 512 * 1024,
    disableRequestLogging: true,
  });

  app.addHook('onRequest', async (request) => {
    request.requestId = uuidv4();
  });

  /**
   * Authentication. The actor comes from the session, never from the payload.
   *
   * A bearer session id stands in for the corporate IdP: 13_AUTH_PERMISSIONS keeps the provider
   * swappable and the internal permission mapping independent of it, so this is the only place that
   * changes when a real IdP arrives.
   */
  app.addHook('preHandler', async (request, reply) => {
    if (
      request.url === '/health' ||
      request.url === '/ready' ||
      request.url === '/' ||
      (devAuth && request.url.startsWith('/dev/'))
    ) return;

    const header = request.headers.authorization;
    const sessionId = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    // A malformed bearer (not a uuid at all) is still just "no usable session" — it must not reach
    // the database as a raw value and surface as a 500 from a type error.
    if (!sessionId || !isUuid(sessionId)) {
      return sendError(reply, request, unauthenticated());
    }

    const actor = await withConnection((db) => resolveActor(db, sessionId));
    if (!actor) {
      // RGT-11: only /sync/commands gets a second look, and only to recognise a session that was
      // revoked (never merely expired or unknown) — this never authorises anything by itself. The
      // route handler still refuses to apply any command; it records what was declared.
      if (request.url.startsWith('/sync/commands')) {
        const revoked = await withConnection((db) => findRevokedSession(db, sessionId));
        if (revoked) {
          request.revokedSession = revoked;
          return;
        }
      }
      return sendError(reply, request, unauthenticated());
    }
    request.actor = actor;
    // Fire-and-forget would hide a failure; it is cheap and inside the request.
    await withConnection((db) => touchSession(db, actor.sessionId, instantNow()));
  });

  app.get('/health', async () => ({ status: 'ok', time: instantNow() }));

  app.get('/ready', async (_request, reply) => {
    // Ready means the dependencies a command needs are actually usable, and that migrations are
    // current — serving traffic against a half-migrated schema is worse than refusing.
    try {
      const result = await withConnection(async (db) => {
        const migration = await db.one<{ version: number }>(
          'SELECT max(version) AS version FROM platform.schema_migrations',
        );
        const rules = await db.one<{ count: string }>(
          "SELECT count(*)::text AS count FROM platform.capabilities",
        );
        return { migration: migration?.version ?? 0, capabilities: Number(rules?.count ?? '0') };
      });
      if (result.capabilities === 0) {
        return reply.code(503).send({
          status: 'not-ready',
          reason: 'platform.capabilities is empty: the seed has not run, so every command is denied.',
          ...result,
        });
      }
      return { status: 'ready', ...result };
    } catch (error) {
      return reply.code(503).send({
        status: 'not-ready',
        reason: error instanceof Error ? error.message : 'database unreachable',
      });
    }
  });

  registerDevAuthRoutes(app, devAuth);

  app.get('/me', async (request, reply) => {
    const actor = request.actor;
    if (!actor) return sendError(reply, request, unauthenticated());

    return {
      data: {
        identityId: actor.identityId,
        displayName: actor.displayName,
        personId: actor.personId,
        roles: [...new Set(actor.grants.map((grant) => grant.roleId))],
        capabilities: actor.capabilities,
      },
      meta: meta(request),
    };
  });

  /** The command catalogue, so a client can discover what exists and what it needs. */
  app.get('/commands', async (request) => ({
    data: COMMANDS.map((c) => ({
      name: c.name,
      module: c.module,
      capability: c.capability,
      trigger: c.trigger,
      subjectKind: c.subjectKind,
      previewable: c.previewable,
      implemented: registeredCommands().includes(c.name),
      // Visibility only. Enforcement happens in the pipeline on every call (13).
      allowedForActor: request.actor?.capabilities.includes(c.capability) ?? false,
      route: SUBJECT_ROUTES[c.name]?.path ?? null,
      description: c.description,
    })),
    meta: meta(request),
  }));

  // ------------------------------------------------------------------ command routes
  for (const name of registeredCommands()) {
    const definition = commandDefinition(name);
    const route = SUBJECT_ROUTES[name];
    if (!route) {
      throw new Error(
        `Command "${name}" is registered but has no route in SUBJECT_ROUTES. Exposing a command ` +
          'without declaring how its subject is addressed would make the subject ambiguous.',
      );
    }

    const handle = (preview: boolean) => async (request: FastifyRequest, reply: FastifyReply) => {
      const actor = request.actor;
      if (!actor) return sendError(reply, request, unauthenticated());

      // The subject id travels alongside the envelope, never inside the validated payload: every
      // payload sets additionalProperties:false, and routing is not a domain concern.
      const body = (request.body ?? {}) as Record<string, unknown>;
      const params = request.params as Record<string, string>;
      const subjectId = route.idParam ? (params[route.idParam] ?? null) : null;

      try {
        const result = await execute({
          commandName: name,
          actor,
          rawEnvelope: body,
          subjectId,
          preview,
          rulesetVersion: options.rulesetVersion,
          requestId: request.requestId,
        });
        // 200 for an applied command and for a replay: a retry is not an error, and the client
        // needs the original receipt (RGT-06).
        return reply.code(200).send({ ...result, meta: meta(request) });
      } catch (error) {
        return sendError(reply, request, error);
      }
    };

    app.post(route.path, handle(false));

    if (definition.previewable) {
      // The preview endpoint evaluates and explains, and authorises nothing (RGT-17).
      const previewPath = route.path.replace(/\/([^/]+)$/, '/evaluate-$1');
      app.post(previewPath, handle(true));
    }
  }

  await registerReadRoutes(app);
  await registerHabilitaRespondReadRoutes(app);
  await registerReviewCommercialBillingReadRoutes(app);
  await registerDashboardReadRoutes(app);
  await registerSyncRoutes(app, { rulesetVersion: options.rulesetVersion });
  await registerSyncReadRoutes(app);
  await registerConfigReadRoutes(app);
  await registerHabilitaDocumentalReadRoutes(app);
  await registerEvidenceRoutes(app);
  await registerPlanningReadRoutes(app);

  app.setNotFoundHandler(async (request, reply) =>
    sendError(
      reply,
      request,
      new DomainError({
        code: 'NOT_FOUND',
        message: `No existe la ruta ${request.method} ${request.url}.`,
        details: [
          {
            message:
              'Un estado no se cambia con PATCH: cada transición tiene un comando con nombre cuya ' +
              'transición la máquina de estados permite (05_STATE_MODEL).',
          },
        ],
      }),
    ),
  );

  app.addHook('onClose', async () => {
    await closeDb();
  });

  return app;
}

const meta = (request: FastifyRequest) => ({
  requestId: request.requestId,
  serverTime: instantNow(),
});

/**
 * One error shape for everything.
 *
 * A GATE_BLOCKED response carries blocks, warnings and confirmations as separate arrays, so a client
 * can show three counts without a second round trip — the prototype's single "9 pendientes" is the
 * thing this prevents.
 */
function sendError(reply: FastifyReply, request: FastifyRequest, error: unknown): FastifyReply {
  if (isDomainError(error)) {
    const body = error.toJSON();
    return reply.code(HTTP_STATUS[error.code]).send({
      error: {
        ...body.error,
        // Surface the structured parts for a blocked decision.
        ...(error.code === 'GATE_BLOCKED' || error.code === 'CONFIRMATION_REQUIRED'
          ? {
              blocks: error.details
                .filter((d) => d.ruleId !== undefined && d.instead !== undefined)
                .map((d) => ({
                  ruleId: d.ruleId,
                  reason: d.message,
                  instead: d.instead,
                  sourceRef: d.sourceRef,
                })),
            }
          : {}),
      },
      meta: meta(request),
    });
  }

  // An unexpected error is a bug. It is logged with the request id and returned without internals:
  // observability must not leak payload contents (13 / ops).
  request.log?.error({ err: error, requestId: request.requestId }, 'unhandled error');
  return reply.code(500).send({
    error: {
      code: 'INVARIANT_VIOLATED',
      message: 'Error interno. El identificador de la solicitud permite ubicarlo en los logs.',
      details: [],
      ruleIds: [],
      retryable: false,
    },
    meta: meta(request),
  });
}

/** Entry point. */
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  const app = await buildServer({
    databaseUrl: process.env['DATABASE_URL'] ?? 'postgres://vds:vds_dev_only@127.0.0.1:5434/vds_partes',
    rulesetVersion: process.env['RULESET_VERSION'] ?? 'dev',
    logger: true,
    devAuth: process.env['NODE_ENV'] !== 'production' && process.env['VDS_DEV_AUTH'] !== '0',
  });
  const port = Number(process.env['PORT'] ?? 4180);
  await app.listen({ port, host: '127.0.0.1' });
  console.log(`VDS Partes API on http://127.0.0.1:${port}`);
}
