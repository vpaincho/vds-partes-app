/**
 * The assignment drawer.
 *
 * KEEP from the prototype `drawer()`: a side panel over the timeline holding the detail of one job,
 * with its actions in reach. That is the interaction planners already have and 15 preserves it.
 *
 * What it holds that the prototype could not:
 *
 *  - **The version chain.** The prototype had one `trabajo` object and `t.dias = p.dia + 1` wrote
 *    over it. Here every version is listed with the window it approved, so RGT-03 is visible rather
 *    than asserted: the older version still says five days.
 *  - **Readiness as history.** Including the invalidated evaluations. RUL-015 invalidates a READY
 *    without erasing it, and "it was ready and then stopped being ready" is the useful fact.
 *  - **Directives with their lifecycle.** Emitted, received, acknowledged and applied are four
 *    separate facts (C-017); the prototype had none of them.
 *  - **Extension requests as decisions.** The request keeps the window that was approved when it was
 *    made, so approving it creates a new version instead of editing the old one.
 *  - **Every action as a command with its gate.** No action here mutates anything directly: each one
 *    posts a command, and a refusal arrives as blocks with what to do instead.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import {
  ApiError,
  fetchAssignment,
  fetchNominees,
  type AssignmentDetail,
  type NomineePerson,
  type NomineeResource,
} from '../../api/client.ts';
import { CommandOutcome, useCommand } from '../../components/CommandAction.tsx';
import { StateBadge, StateBadgeRow } from '../../components/StateBadge.tsx';
import { fmtInstant } from './period.ts';
import { ASSIGNMENT_STATE_MEANING, assignmentTone, READINESS_TONE } from './state.ts';

export interface AssignmentDrawerProps {
  readonly assignmentId: string;
  readonly capabilities: readonly string[];
  readonly onClose: () => void;
  /** Called after any applied command, so the timeline behind the drawer refreshes. */
  readonly onChanged: () => void;
  readonly onShowTrace: (subjectKind: string, subjectId: string) => void;
}

type Tab = 'alcance' | 'personas' | 'readiness' | 'control' | 'versiones' | 'ejecucion';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'alcance', label: 'Alcance' },
  { id: 'personas', label: 'Personas y recursos' },
  { id: 'readiness', label: 'Readiness' },
  { id: 'control', label: 'Control y permisos' },
  { id: 'versiones', label: 'Versiones' },
  { id: 'ejecucion', label: 'Ejecución' },
];

export function AssignmentDrawer({
  assignmentId,
  capabilities,
  onClose,
  onChanged,
  onShowTrace,
}: AssignmentDrawerProps): JSX.Element {
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const [meta, setMeta] = useState<{ source?: string; asOf?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('alcance');

  const load = useCallback(async () => {
    try {
      const result = await fetchAssignment(assignmentId);
      setDetail(result.data);
      setMeta(result.meta);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo cargar la asignación.');
    }
  }, [assignmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);

  const can = (capability: string) => capabilities.includes(capability);

  if (error) {
    return (
      <aside className="vds-drawer" aria-label="Detalle de la asignación">
        <DrawerHead code={null} onClose={onClose} />
        <p className="vds-error">{error}</p>
      </aside>
    );
  }
  if (!detail) {
    return (
      <aside className="vds-drawer" aria-label="Detalle de la asignación" aria-busy="true">
        <DrawerHead code={null} onClose={onClose} />
        <p className="vds-empty">Cargando…</p>
      </aside>
    );
  }

  const a = detail.assignment as Record<string, string | number | boolean | null>;
  const state = String(a['state']);
  const currentReadiness = detail.readiness.find((r) => r.invalidated_at === null);
  const pendingExtension = detail.extensions.find((e) => e.state === 'PENDIENTE');

  return (
    <aside className="vds-drawer" aria-label={`Detalle de ${String(a['code'] ?? assignmentId)}`}>
      <DrawerHead code={(a['code'] as string | null) ?? assignmentId.slice(0, 8)} onClose={onClose} />

      <div className="vds-drawer__summary">
        <StateBadgeRow>
          <StateBadge
            dimension="plan"
            label="Asignación"
            state={state}
            tone={assignmentTone(state)}
            title={ASSIGNMENT_STATE_MEANING[state] ?? state}
          />
          <StateBadge
            dimension="plan"
            label="Versión"
            state={`v${a['version_no']} ${a['plan_version_state']}`}
            tone={a['plan_version_state'] === 'APROBADA' ? 'ok' : 'neutral'}
            title="La versión aprobada es el snapshot contra el que se compara la ejecución. Es inmutable."
          />
          {currentReadiness && (
            <StateBadge
              dimension="plan"
              label="Readiness"
              state={currentReadiness.result}
              tone={READINESS_TONE[currentReadiness.result === 'READY' ? 'READY' : 'NOT_READY']}
              title={
                currentReadiness.valid_until
                  ? `Vigente hasta ${fmtInstant(currentReadiness.valid_until)}.`
                  : 'Sin vencimiento declarado.'
              }
            />
          )}
          {Boolean(a['requires_work_permit']) && (
            <StateBadge
              dimension="habilita"
              label="PTW"
              state={
                detail.permits.some((p) => p.state === 'VIGENTE') ? 'hay vigente' : 'sin permiso vigente'
              }
              tone={detail.permits.some((p) => p.state === 'VIGENTE') ? 'ok' : 'critical'}
              title="RUL-042: un permiso debe cubrir el instante y el alcance reales, no sólo existir."
            />
          )}
        </StateBadgeRow>

        <dl className="vds-drawer__facts">
          <dt>Ventana aprobada</dt>
          <dd className="vds-numeric">
            {fmtInstant(a['window_start'] as string)} → {fmtInstant(a['window_end'] as string)}
            <small> intención, no realidad</small>
          </dd>
          <dt>Fecha operativa</dt>
          <dd className="vds-numeric">
            {String(a['operational_date'])}
            {a['shift_id'] ? ` · turno ${String(a['shift_id'])}` : ''}
          </dd>
          <dt>TipoParte previsto</dt>
          <dd className="vds-numeric">
            {String(a['expected_part_type'] ?? '—')}
            <small> derivado por regla, no elegido</small>
          </dd>
          <dt>Despachada</dt>
          <dd className="vds-numeric">{fmtInstant(a['dispatched_at'] as string | null)}</dd>
        </dl>

        {a['not_performed_reason'] && (
          <p className="vds-notice">
            <strong>No realizada:</strong> {String(a['not_performed_reason'])}
          </p>
        )}
      </div>

      <nav className="vds-drawer__tabs" aria-label="Secciones del detalle">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="vds-drawer__tab"
            aria-current={t.id === tab ? 'true' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="vds-drawer__body">
        {tab === 'alcance' && <ScopeTab detail={detail} />}
        {tab === 'personas' && (
          <PeopleTab
            detail={detail}
            assignmentId={assignmentId}
            canNominate={can('planning.nominate')}
            onChanged={refresh}
          />
        )}
        {tab === 'readiness' && (
          <ReadinessTab
            detail={detail}
            assignmentId={assignmentId}
            canEvaluate={can('planning.readiness')}
            canDispatch={can('planning.dispatch')}
            onChanged={refresh}
          />
        )}
        {tab === 'control' && (
          <ControlTab
            detail={detail}
            assignmentId={assignmentId}
            canEmit={can('control.emit')}
            canApply={can('control.apply')}
            onChanged={refresh}
            onShowTrace={onShowTrace}
          />
        )}
        {tab === 'versiones' && (
          <VersionsTab
            detail={detail}
            assignmentId={assignmentId}
            pendingExtensionId={pendingExtension?.id ?? null}
            canRequest={can('execution.capture')}
            canResolve={can('planning.result')}
            onChanged={refresh}
          />
        )}
        {tab === 'ejecucion' && <ExecutionTab detail={detail} onShowTrace={onShowTrace} />}
      </div>

      <footer className="vds-drawer__foot">
        <button
          type="button"
          className="vds-button vds-button--ghost"
          onClick={() => onShowTrace('AsignacionPlanificada', assignmentId)}
        >
          Ver trazabilidad de esta asignación
        </button>
        <p className="vds-asof vds-numeric">
          {meta?.source ?? '—'} · {fmtInstant(meta?.asOf)}
        </p>
      </footer>
    </aside>
  );
}

function DrawerHead({
  code,
  onClose,
}: {
  readonly code: string | null;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <header className="vds-drawer__head">
      <h2 className="vds-numeric">{code ?? 'Asignación'}</h2>
      <button type="button" className="vds-button vds-button--ghost" onClick={onClose}>
        Cerrar
      </button>
    </header>
  );
}

/* ------------------------------------------------------------------------- alcance */

function ScopeTab({ detail }: { readonly detail: AssignmentDetail }): JSX.Element {
  if (detail.units.length === 0) {
    return <p className="vds-empty">Esta asignación no tiene unidades previstas.</p>;
  }
  return (
    <>
      <table className="vds-table" data-density="operations">
        <thead>
          <tr>
            <th scope="col">Servicio</th>
            <th scope="col">Ubicación</th>
            <th scope="col">Cliente</th>
            <th scope="col">Cantidad prevista</th>
            <th scope="col">Ítem de contrato</th>
          </tr>
        </thead>
        <tbody>
          {detail.units.map((unit) => {
            const u = unit as Record<string, string | number | null>;
            return (
              <tr key={String(u['id'])}>
                <td>
                  {String(u['service_name'] ?? '—')}
                  <div className="vds-table__sub vds-numeric">{String(u['service_code'] ?? '')}</div>
                </td>
                <td>
                  {String(u['location_name'] ?? '—')}
                  <div className="vds-table__sub vds-numeric">{String(u['location_code'] ?? '')}</div>
                </td>
                <td>{String(u['client_name'] ?? '—')}</td>
                <td className="vds-numeric">
                  {u['planned_quantity'] === null ? '—' : String(u['planned_quantity'])}
                  {u['unit_of_measure'] ? ` ${String(u['unit_of_measure'])}` : ''}
                </td>
                <td className="vds-numeric">
                  {/* An unresolved item is PENDIENTE, not zero and not invented (AP-06). */}
                  {u['contract_item_code'] === null ? 'pendiente' : String(u['contract_item_code'])}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="vds-note">
        La cantidad prevista es intención. La cantidad certificable se deriva de la ejecución y de la
        regla comercial, y no es la medición de campo (C-014).
      </p>
    </>
  );
}

/* ------------------------------------------------------------------------ personas */

function PeopleTab({
  detail,
  assignmentId,
  canNominate,
  onChanged,
}: {
  readonly detail: AssignmentDetail;
  readonly assignmentId: string;
  readonly canNominate: boolean;
  readonly onChanged: () => void;
}): JSX.Element {
  const nominate = useCommand(onChanged);
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<{
    people: readonly NomineePerson[];
    resources: readonly NomineeResource[];
  } | null>(null);
  const [role, setRole] = useState('OPERARIO');

  const loadCandidates = useCallback(
    async (q: string) => {
      try {
        const result = await fetchNominees(assignmentId, q);
        setCandidates(result.data);
      } catch {
        setCandidates(null);
      }
    },
    [assignmentId],
  );

  useEffect(() => {
    if (canNominate) void loadCandidates('');
  }, [canNominate, loadCandidates]);

  return (
    <>
      <h3>Nominados</h3>
      {detail.people.length === 0 && detail.resources.length === 0 ? (
        <p className="vds-empty">Sin nominaciones. Readiness no puede evaluar competencias todavía.</p>
      ) : (
        <ul className="vds-people">
          {detail.people.map((person) => {
            const p = person as Record<string, string | null>;
            return (
              <li key={String(p['id'])}>
                <span>
                  {String(p['first_name'])} {String(p['last_name'])}
                </span>
                <span className="vds-people__role">{String(p['role'])}</span>
                <span className="vds-numeric">{String(p['person_code'] ?? '')}</span>
              </li>
            );
          })}
          {detail.resources.map((resource) => {
            const r = resource as Record<string, string | null>;
            return (
              <li key={String(r['id'])}>
                <span>{String(r['resource_name'] ?? r['resource_code'])}</span>
                <span className="vds-people__role">{String(r['role'])}</span>
                <span className="vds-numeric">{String(r['resource_code'] ?? '')}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="vds-note">
        La nominación es intención de planificación. Quién estuvo realmente, y en qué intervalo, es un
        hecho del Parte y no se edita desde acá.
      </p>

      {canNominate && (
        <section className="vds-drawer__action">
          <h3>Nominar</h3>
          <label htmlFor="nominee-search">Buscar persona o recurso</label>
          <input
            id="nominee-search"
            className="vds-input"
            type="search"
            value={search}
            placeholder="código, nombre o apellido"
            onChange={(event) => {
              setSearch(event.target.value);
              void loadCandidates(event.target.value);
            }}
          />
          <label htmlFor="nominee-role">Rol</label>
          <input
            id="nominee-role"
            className="vds-input"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          />

          {candidates === null ? (
            <p className="vds-empty">Sin candidatos para esa búsqueda.</p>
          ) : (
            <ul className="vds-candidates">
              {candidates.people.map((person) => {
                const hardBlocks = (person.unmet_requirements ?? []).filter(
                  (r) => r.severity === 'HARD_BLOCK',
                );
                return (
                  <li key={person.id} data-blocked={hardBlocks.length > 0 || undefined}>
                    <div className="vds-candidates__who">
                      <strong>
                        {person.first_name} {person.last_name}
                      </strong>
                      <span className="vds-numeric">{person.code}</span>
                      {person.in_crew && <span className="vds-chip">cuadrilla</span>}
                      {person.affiliation !== 'VDS' && (
                        <span className="vds-chip vds-chip--warn">{person.affiliation}</span>
                      )}
                    </div>
                    {/* Shown before the attempt, because the gate runs before the action, not after.
                        It is still only context: nominate re-evaluates (RGT-17). */}
                    {hardBlocks.length > 0 && (
                      <p className="vds-candidates__block">
                        {hardBlocks.length} requisito(s) duro(s) sin cumplir:{' '}
                        {hardBlocks.map((r) => `${r.requirementCode} (${r.status})`).join(', ')}
                      </p>
                    )}
                    {Number(person.overlapping) > 0 && (
                      <p className="vds-candidates__warn">
                        {person.overlapping} asignación(es) solapada(s). El veredicto lo da la regla
                        vigente, no esta lista.
                      </p>
                    )}
                    <button
                      type="button"
                      className="vds-button vds-button--secondary"
                      disabled={person.already_nominated || nominate.state.phase === 'running'}
                      onClick={() =>
                        void nominate.run(`/planning/assignments/${assignmentId}/nominate`, {
                          payload: { personIds: [person.id], role },
                        })
                      }
                    >
                      {person.already_nominated ? 'Ya nominado' : 'Nominar'}
                    </button>
                  </li>
                );
              })}
              {candidates.resources.map((resource) => (
                <li key={resource.id}>
                  <div className="vds-candidates__who">
                    <strong>{resource.name}</strong>
                    <span className="vds-numeric">{resource.code}</span>
                    {resource.resource_type && <span className="vds-chip">{resource.resource_type}</span>}
                  </div>
                  {Number(resource.overlapping) > 0 && (
                    <p className="vds-candidates__warn">
                      {resource.overlapping} asignación(es) solapada(s).
                    </p>
                  )}
                  <button
                    type="button"
                    className="vds-button vds-button--secondary"
                    disabled={resource.already_nominated || nominate.state.phase === 'running'}
                    onClick={() =>
                      void nominate.run(`/planning/assignments/${assignmentId}/nominate`, {
                        payload: { resourceIds: [resource.id], role: 'PRINCIPAL' },
                      })
                    }
                  >
                    {resource.already_nominated ? 'Ya nominado' : 'Nominar'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <CommandOutcome state={nominate.state} />
        </section>
      )}
    </>
  );
}

/* ----------------------------------------------------------------------- readiness */

function ReadinessTab({
  detail,
  assignmentId,
  canEvaluate,
  canDispatch,
  onChanged,
}: {
  readonly detail: AssignmentDetail;
  readonly assignmentId: string;
  readonly canEvaluate: boolean;
  readonly canDispatch: boolean;
  readonly onChanged: () => void;
}): JSX.Element {
  const evaluateCmd = useCommand(onChanged);
  const dispatchCmd = useCommand(onChanged);
  const [ttl, setTtl] = useState(240);

  return (
    <>
      <h3>Evaluaciones</h3>
      {detail.readiness.length === 0 ? (
        <p className="vds-empty">Sin evaluaciones. Despachar exige una evaluación vigente (RUL-016).</p>
      ) : (
        <ol className="vds-readiness">
          {detail.readiness.map((evaluation) => (
            <li
              key={evaluation.id}
              data-result={evaluation.result}
              data-invalidated={evaluation.invalidated_at !== null || undefined}
            >
              <div className="vds-readiness__head">
                <strong>{evaluation.result}</strong>
                <span className="vds-numeric">{fmtInstant(evaluation.evaluated_at)}</span>
                {evaluation.valid_until && (
                  <span className="vds-numeric">
                    vigente hasta {fmtInstant(evaluation.valid_until)}
                  </span>
                )}
              </div>
              {evaluation.invalidated_at && (
                <p className="vds-readiness__invalid">
                  {/* RUL-015: invalidated, not deleted. The planner needs the history. */}
                  Invalidada el {fmtInstant(evaluation.invalidated_at)} por un cambio de dependencia.
                  La evaluación no se borra: el READY existió y dejó de valer.
                </p>
              )}
              {evaluation.causes.length > 0 && (
                <ul className="vds-readiness__causes">
                  {evaluation.causes.map((cause, index) => (
                    <li key={`${cause.ruleId ?? index}`}>
                      <span className="vds-numeric">{cause.ruleId ?? '—'}</span> {cause.reason}
                      {cause.instead && <em> → {cause.instead}</em>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      {canEvaluate && (
        <section className="vds-drawer__action">
          <h3>Evaluar readiness</h3>
          <label htmlFor="readiness-ttl">Vigencia de la evaluación (minutos)</label>
          <input
            id="readiness-ttl"
            className="vds-input"
            type="number"
            min={1}
            value={ttl}
            onChange={(event) => setTtl(Number(event.target.value))}
          />
          <p className="vds-note">
            READY es temporal por definición (C-015). La vigencia se declara; no existe un READY sin
            vencimiento implícito.
          </p>
          <button
            type="button"
            className="vds-button vds-button--primary"
            disabled={evaluateCmd.state.phase === 'running'}
            onClick={() =>
              void evaluateCmd.run(`/planning/assignments/${assignmentId}/evaluate-readiness`, {
                payload: { validForMinutes: ttl },
              })
            }
          >
            Evaluar
          </button>
          <CommandOutcome state={evaluateCmd.state} />
        </section>
      )}

      {canDispatch && (
        <section className="vds-drawer__action">
          <h3>Despachar</h3>
          <p className="vds-note">
            Despachar entrega el contexto y construye el bundle versionado. DESPACHADA no es
            EN_EJECUCION: no afirma que el trabajo empezó.
          </p>
          <button
            type="button"
            className="vds-button vds-button--secondary"
            disabled={dispatchCmd.state.phase === 'running'}
            onClick={() =>
              void dispatchCmd.preview(`/planning/assignments/${assignmentId}/dispatch`, {
                payload: { bundleTtlMinutes: 720 },
              })
            }
          >
            Evaluar antes de despachar
          </button>
          <button
            type="button"
            className="vds-button vds-button--primary"
            disabled={dispatchCmd.state.phase === 'running'}
            onClick={() =>
              void dispatchCmd.run(`/planning/assignments/${assignmentId}/dispatch`, {
                payload: { bundleTtlMinutes: 720 },
              })
            }
          >
            Despachar
          </button>
          <CommandOutcome state={dispatchCmd.state} />
        </section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------- control */

const DIRECTIVE_TYPES = ['SUSPENDER', 'REPROGRAMAR', 'REPRIORIZAR', 'CAMBIO_ALCANCE', 'CANCELAR'] as const;

function ControlTab({
  detail,
  assignmentId,
  canEmit,
  canApply,
  onChanged,
  onShowTrace,
}: {
  readonly detail: AssignmentDetail;
  readonly assignmentId: string;
  readonly canEmit: boolean;
  readonly canApply: boolean;
  readonly onChanged: () => void;
  readonly onShowTrace: (kind: string, id: string) => void;
}): JSX.Element {
  const emit = useCommand(onChanged);
  const act = useCommand(onChanged);
  const [directiveType, setDirectiveType] = useState<(typeof DIRECTIVE_TYPES)[number]>('SUSPENDER');
  const [reason, setReason] = useState('');

  return (
    <>
      <h3>Directivas</h3>
      {detail.directives.length === 0 ? (
        <p className="vds-empty">Sin directivas sobre esta asignación.</p>
      ) : (
        <ul className="vds-directives">
          {detail.directives.map((directive) => (
            <li key={directive.id} data-state={directive.state}>
              <div className="vds-directives__head">
                <strong>{directive.directive_type}</strong>
                <span className="vds-badge" data-dimension="plan" data-tone={
                  directive.state === 'APLICADA'
                    ? 'ok'
                    : directive.state === 'RECHAZADA' || directive.state === 'EXPIRADA'
                      ? 'critical'
                      : 'pending'
                }>
                  <span className="vds-badge__state">{directive.state}</span>
                </span>
                <span className="vds-numeric">{directive.code ?? directive.id.slice(0, 8)}</span>
              </div>
              <p>{directive.reason}</p>
              {/* The four facts, each with its own instant. Blank is blank, not "probably yes". */}
              <dl className="vds-directives__steps">
                <dt>Emitida</dt>
                <dd className="vds-numeric">{fmtInstant(directive.issued_at)}</dd>
                <dt>Recibida</dt>
                <dd className="vds-numeric">{fmtInstant(directive.received_at)}</dd>
                <dt>Reconocida</dt>
                <dd className="vds-numeric">{fmtInstant(directive.acknowledged_at)}</dd>
                <dt>Aplicada</dt>
                <dd className="vds-numeric">{fmtInstant(directive.applied_at)}</dd>
              </dl>
              {directive.valid_until && (
                <p className="vds-note">
                  Pierde vigencia el {fmtInstant(directive.valid_until)}. Después de eso no se aplica:
                  una orden obsoleta se compensa con otra (RUL-058).
                </p>
              )}
              {directive.acknowledged_at && !directive.applied_at && (
                <p className="vds-notice">
                  Reconocida pero no aplicada. El ACK dice que llegó, no que se hizo (RUL-056).
                </p>
              )}
              {canApply && !directive.applied_at && !directive.rejected_at && (
                <div className="vds-directives__actions">
                  {!directive.acknowledged_at && (
                    <button
                      type="button"
                      className="vds-button vds-button--secondary"
                      onClick={() => void act.run(`/control/directives/${directive.id}/ack`)}
                    >
                      Reconocer
                    </button>
                  )}
                  <button
                    type="button"
                    className="vds-button vds-button--primary"
                    onClick={() =>
                      void act.run(`/control/directives/${directive.id}/apply`, {
                        payload: {
                          effectRef: {
                            kind:
                              directive.directive_type === 'SUSPENDER'
                                ? 'UE_SUSPENDED'
                                : directive.directive_type === 'REPROGRAMAR'
                                  ? 'RESCHEDULED'
                                  : 'ACKNOWLEDGED_EFFECT',
                            note: 'Efecto registrado desde Planificación.',
                          },
                        },
                      })
                    }
                  >
                    Registrar aplicación
                  </button>
                </div>
              )}
              <button
                type="button"
                className="vds-button vds-button--ghost"
                onClick={() => onShowTrace('DirectivaOperativa', directive.id)}
              >
                Trazabilidad
              </button>
            </li>
          ))}
        </ul>
      )}
      <CommandOutcome state={act.state} />

      {canEmit && (
        <section className="vds-drawer__action">
          <h3>Emitir directiva</h3>
          <p className="vds-note">
            Un cambio después del despacho no muta el snapshot aprobado (RUL-020): produce una
            directiva o una versión nueva.
          </p>
          <label htmlFor="directive-type">Tipo</label>
          <select
            id="directive-type"
            className="vds-input"
            value={directiveType}
            onChange={(event) => setDirectiveType(event.target.value as (typeof DIRECTIVE_TYPES)[number])}
          >
            {DIRECTIVE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <label htmlFor="directive-reason">Motivo (mínimo 5 caracteres)</label>
          <textarea
            id="directive-reason"
            className="vds-input"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <button
            type="button"
            className="vds-button vds-button--primary"
            disabled={reason.trim().length < 5 || emit.state.phase === 'running'}
            onClick={() =>
              void emit.run('/control/directives/emit', {
                payload: {
                  directiveType,
                  reason: reason.trim(),
                  targets: [{ targetKind: 'PLANNED_ASSIGNMENT', targetId: assignmentId }],
                },
              })
            }
          >
            Emitir
          </button>
          <CommandOutcome state={emit.state} />
        </section>
      )}

      <h3>Permisos de trabajo en la ubicación</h3>
      {detail.permits.length === 0 ? (
        <p className="vds-empty">Sin permisos registrados para esta ubicación.</p>
      ) : (
        <table className="vds-table" data-density="operations">
          <thead>
            <tr>
              <th scope="col">Permiso</th>
              <th scope="col">Estado</th>
              <th scope="col">Vigencia</th>
              <th scope="col">Activado</th>
            </tr>
          </thead>
          <tbody>
            {detail.permits.map((permit) => (
              <tr key={permit.id}>
                <td className="vds-numeric">{permit.code ?? permit.id.slice(0, 8)}</td>
                <td>
                  <StateBadge
                    dimension="habilita"
                    label="PTW"
                    state={permit.state}
                    tone={
                      permit.state === 'VIGENTE'
                        ? 'ok'
                        : permit.state === 'VENCIDO' || permit.state === 'RECHAZADO'
                          ? 'critical'
                          : permit.state === 'SUSPENDIDO'
                            ? 'warn'
                            : 'pending'
                    }
                    title={
                      permit.state === 'APROBADO'
                        ? 'Aprobado no habilita: hace falta activación y cobertura temporal (RUL-043).'
                        : permit.state
                    }
                  />
                </td>
                <td className="vds-numeric">
                  {fmtInstant(permit.valid_from)} → {fmtInstant(permit.valid_until)}
                </td>
                <td className="vds-numeric">{fmtInstant(permit.activated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ----------------------------------------------------------------------- versiones */

function VersionsTab({
  detail,
  assignmentId,
  pendingExtensionId,
  canRequest,
  canResolve,
  onChanged,
}: {
  readonly detail: AssignmentDetail;
  readonly assignmentId: string;
  readonly pendingExtensionId: string | null;
  readonly canRequest: boolean;
  readonly canResolve: boolean;
  readonly onChanged: () => void;
}): JSX.Element {
  const request = useCommand(onChanged);
  const resolve = useCommand(onChanged);
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState('');

  return (
    <>
      <h3>Cadena de versiones</h3>
      <table className="vds-table" data-density="analysis">
        <thead>
          <tr>
            <th scope="col">Versión</th>
            <th scope="col">Estado</th>
            <th scope="col">Aprobada</th>
            <th scope="col">Ventana de esta asignación en esa versión</th>
          </tr>
        </thead>
        <tbody>
          {detail.versions.map((version) => (
            <tr key={version.id} data-current={version.state === 'APROBADA' || undefined}>
              <td className="vds-numeric">v{version.version_no}</td>
              <td>{version.state}</td>
              <td className="vds-numeric">{fmtInstant(version.approved_at)}</td>
              <td className="vds-numeric">
                {/* The point of the whole table: an older version still says what it approved. */}
                {version.window_in_version
                  ? `${fmtInstant(version.window_in_version.windowStart)} → ${fmtInstant(
                      version.window_in_version.windowEnd,
                    )}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="vds-note">
        Una versión aprobada es inmutable. Extender el trabajo crea una versión nueva y la anterior
        queda SUPERSEDIDA con su ventana original intacta — por eso plan contra real sigue comparando
        contra lo que de verdad se aprobó (RGT-03).
      </p>

      <h3>Pedidos de extensión</h3>
      {detail.extensions.length === 0 ? (
        <p className="vds-empty">Sin pedidos.</p>
      ) : (
        <ul className="vds-extensions">
          {detail.extensions.map((extension) => (
            <li key={extension.id} data-state={extension.state}>
              <div className="vds-extensions__head">
                <strong>+{extension.additional_days} día(s)</strong>
                <span className="vds-badge" data-dimension="plan" data-tone={
                  extension.state === 'APROBADA' ? 'ok' : extension.state === 'RECHAZADA' ? 'critical' : 'pending'
                }>
                  <span className="vds-badge__state">{extension.state}</span>
                </span>
                <span className="vds-numeric">{fmtInstant(extension.requested_at)}</span>
              </div>
              <p>{extension.reason}</p>
              <p className="vds-numeric vds-extensions__windows">
                aprobado hasta {fmtInstant(extension.approved_window_end)} · pedido hasta{' '}
                {fmtInstant(extension.proposed_window_end)}
              </p>
              {extension.resolution_note && <p className="vds-note">{extension.resolution_note}</p>}
            </li>
          ))}
        </ul>
      )}

      {canRequest && !pendingExtensionId && (
        <section className="vds-drawer__action">
          <h3>Pedir más días</h3>
          <label htmlFor="extension-days">Días adicionales</label>
          <input
            id="extension-days"
            className="vds-input"
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          />
          <label htmlFor="extension-reason">Motivo</label>
          <textarea
            id="extension-reason"
            className="vds-input"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <button
            type="button"
            className="vds-button vds-button--primary"
            disabled={reason.trim().length < 3 || request.state.phase === 'running'}
            onClick={() =>
              void request.run(`/planning/assignments/${assignmentId}/request-extension`, {
                payload: { additionalDays: days, reason: reason.trim() },
              })
            }
          >
            Pedir
          </button>
          <CommandOutcome state={request.state} />
        </section>
      )}

      {canResolve && pendingExtensionId && (
        <section className="vds-drawer__action">
          <h3>Resolver el pedido pendiente</h3>
          <p className="vds-note">
            Aprobar crea una versión nueva con la ventana extendida. Rechazar deja la ventana aprobada
            como está y conserva el pedido en la historia.
          </p>
          <div className="vds-drawer__buttons">
            <button
              type="button"
              className="vds-button vds-button--primary"
              onClick={() =>
                void resolve.run(`/planning/assignments/${assignmentId}/resolve-extension`, {
                  payload: { decision: 'APROBAR' },
                })
              }
            >
              Aprobar
            </button>
            <button
              type="button"
              className="vds-button vds-button--secondary"
              onClick={() =>
                void resolve.run(`/planning/assignments/${assignmentId}/resolve-extension`, {
                  payload: { decision: 'RECHAZAR', note: 'Rechazado desde Planificación.' },
                })
              }
            >
              Rechazar
            </button>
          </div>
          <CommandOutcome state={resolve.state} />
        </section>
      )}
    </>
  );
}

/* ----------------------------------------------------------------------- ejecución */

function ExecutionTab({
  detail,
  onShowTrace,
}: {
  readonly detail: AssignmentDetail;
  readonly onShowTrace: (kind: string, id: string) => void;
}): JSX.Element {
  if (detail.links.length === 0) {
    return (
      <>
        <p className="vds-empty">Todavía no hay ejecución vinculada a esta asignación.</p>
        <p className="vds-note">
          El vínculo plan–ejecución es N:M: una asignación puede materializarse en varios Partes y un
          Parte puede cubrir varias asignaciones. Por eso no hay un campo «su Parte».
        </p>
      </>
    );
  }
  return (
    <>
      <table className="vds-table" data-density="operations">
        <thead>
          <tr>
            <th scope="col">Parte</th>
            <th scope="col">Fecha operativa</th>
            <th scope="col">Estado operacional</th>
            <th scope="col">UE</th>
            <th scope="col">Vínculo</th>
          </tr>
        </thead>
        <tbody>
          {detail.links.map((link) => {
            const l = link as Record<string, string | null>;
            return (
              <tr key={String(l['id'])}>
                <td>
                  <button
                    type="button"
                    className="vds-button vds-button--ghost vds-numeric"
                    onClick={() => onShowTrace('Parte', String(l['part_id']))}
                  >
                    {String(l['part_code'] ?? l['part_id'] ?? '—').slice(0, 12)}
                  </button>
                </td>
                <td className="vds-numeric">{String(l['part_operational_date'] ?? '—')}</td>
                <td>{String(l['part_state'] ?? '—')}</td>
                <td className="vds-numeric">{String(l['unit_code'] ?? '—')}</td>
                <td>
                  {String(l['link_kind'])}
                  {l['contribution_note'] && (
                    <div className="vds-table__sub">{String(l['contribution_note'])}</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="vds-note">
        Cerrar el Parte no marca la asignación CUMPLIDA por sí solo: eso es una decisión sobre si el
        alcance real satisfizo la intención (RUL-018).
      </p>
    </>
  );
}
