/**
 * Habilita Respond & Learn: Flash Report, triage, cases, actions, notifications.
 *
 * ADD. The baseline had nothing here — an incident was, at best, a line in a free-text field. This
 * surface makes the same distinctions the backend already enforces impossible to miss:
 *
 *  1. **The initial report never changes.** What the reporter said is shown as-is; triage adds a
 *     classification, it does not edit the report (RUL-048/049).
 *  2. **An event may never get a case.** C-025/GS-033: closing without a case is a normal outcome,
 *     not a shortcut, and it still needs a classification first.
 *  3. **A case cannot close with a blocking action unverified or a notification unresolved**
 *     (RUL-053/TPR-024) — the gate panel shows exactly what is outstanding, never a single
 *     "no se puede cerrar".
 *
 * Triage/case actions are gated on `habilita.triage`/`habilita.case` (the `habilita` role only);
 * anyone with `habilita.report` can file a Flash Report, matching the server's own capability split.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import {
  ApiError,
  fetchHabilitaEvent,
  fetchHabilitaEvents,
  type HabilitaEventDetail,
  type HabilitaEventRow,
} from '../../api/client.ts';
import { CommandOutcome, useCommand } from '../../components/CommandAction.tsx';
import { StateBadge } from '../../components/StateBadge.tsx';
import { fmtInstant } from '../planning/period.ts';

const EVENT_TONE: Record<string, 'ok' | 'warn' | 'critical' | 'pending' | 'neutral'> = {
  REPORTADO: 'pending',
  EN_TRIAGE: 'pending',
  CLASIFICADO: 'warn',
  ESCALADO_A_CASO: 'critical',
  CERRADO_SIN_CASO: 'neutral',
  DESCARTADO: 'neutral',
};

const CASE_TONE: Record<string, 'ok' | 'warn' | 'critical' | 'pending' | 'neutral'> = {
  ABIERTO: 'warn',
  EN_INVESTIGACION: 'warn',
  SEGUIMIENTO_ACCIONES: 'warn',
  LISTO_PARA_CIERRE: 'ok',
  CERRADO: 'neutral',
};

const EVENT_FILTERS = [
  'TODOS',
  'REPORTADO',
  'EN_TRIAGE',
  'CLASIFICADO',
  'ESCALADO_A_CASO',
  'CERRADO_SIN_CASO',
  'DESCARTADO',
] as const;

export interface HabilitaEventsProps {
  readonly capabilities: readonly string[];
}

export function HabilitaEvents({ capabilities }: HabilitaEventsProps): JSX.Element {
  const [events, setEvents] = useState<readonly HabilitaEventRow[]>([]);
  const [filter, setFilter] = useState<(typeof EVENT_FILTERS)[number]>('TODOS');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showReportForm, setShowReportForm] = useState(false);

  const can = (capability: string) => capabilities.includes(capability);

  const load = useCallback(async () => {
    try {
      const result = await fetchHabilitaEvents(filter === 'TODOS' ? {} : { state: filter });
      setEvents(result.data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudieron cargar los eventos.');
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="vds-permits" data-density="operations">
      <header className="vds-permits__bar">
        <div role="group" aria-label="Filtrar por estado" className="vds-permits__filters">
          {EVENT_FILTERS.map((state) => (
            <button
              key={state}
              type="button"
              className="vds-permits__filter"
              aria-current={state === filter ? 'true' : undefined}
              onClick={() => setFilter(state)}
            >
              {state === 'TODOS' ? 'Todos' : state}
            </button>
          ))}
        </div>
        {can('habilita.report') && (
          <button type="button" className="vds-button vds-button--primary" onClick={() => setShowReportForm((v) => !v)}>
            {showReportForm ? 'Cerrar' : 'Reportar evento'}
          </button>
        )}
      </header>

      {showReportForm && (
        <FlashReportForm
          onReported={() => {
            setShowReportForm(false);
            void load();
          }}
        />
      )}

      {error && <p className="vds-error">{error}</p>}

      {events.length === 0 ? (
        <p className="vds-empty">Sin eventos para ese filtro.</p>
      ) : (
        <ul className="vds-permits__list">
          {events.map((event) => {
            const isExpanded = expanded === event.id;
            return (
              <li key={event.id} data-state={event.state} data-tone={EVENT_TONE[event.state] ?? 'neutral'}>
                <div className="vds-permits__head">
                  <span className="vds-numeric vds-permits__code">{event.code ?? event.id.slice(0, 8)}</span>
                  <StateBadge
                    dimension="habilita"
                    label="Evento"
                    state={event.state}
                    tone={EVENT_TONE[event.state] ?? 'neutral'}
                  />
                  {!event.situation_controlled && (
                    <span className="vds-chip vds-chip--warn" title="Reportado como NO controlado: default conservador de suspensión (RUL-051)">
                      No controlado
                    </span>
                  )}
                  <span className="vds-permits__type">
                    {event.current_category ?? event.initial_category}
                    {event.current_severity ? ` · ${event.current_severity}` : ''}
                  </span>
                  {event.case_id && (
                    <StateBadge
                      dimension="habilita"
                      label="Caso"
                      state={event.case_state ?? '—'}
                      tone={CASE_TONE[event.case_state ?? ''] ?? 'neutral'}
                    />
                  )}
                  <button
                    type="button"
                    className="vds-button vds-button--ghost"
                    aria-expanded={isExpanded}
                    onClick={() => setExpanded(isExpanded ? null : event.id)}
                  >
                    {isExpanded ? 'Ocultar' : 'Detalle'}
                  </button>
                </div>
                <p className="vds-permits__meaning">{event.short_description}</p>

                {isExpanded && (
                  <EventDetailView
                    eventId={event.id}
                    canTriage={can('habilita.triage')}
                    canCase={can('habilita.case')}
                    onChanged={load}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FlashReportForm({ onReported }: { readonly onReported: () => void }): JSX.Element {
  const action = useCommand(onReported);
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [controlled, setControlled] = useState(true);

  return (
    <form
      className="vds-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run('/habilita/events/flash-report', {
          payload: {
            initialCategory: category.trim(),
            shortDescription: description.trim(),
            situationControlled: controlled,
            occurredAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
          },
        });
      }}
    >
      <label htmlFor="eh-category">Categoría</label>
      <input
        id="eh-category"
        className="vds-input"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="DERRAME, FUGA_GAS, CASI_ACCIDENTE…"
      />
      <label htmlFor="eh-desc">Descripción breve</label>
      <input
        id="eh-desc"
        className="vds-input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <label>
        <input type="checkbox" checked={controlled} onChange={(e) => setControlled(e.target.checked)} />
        Situación controlada
      </label>
      <p className="vds-note">
        Severidad y causa raíz NO se preguntan ahora (RUL-047): eso lo agrega el triage. Si la
        situación no está controlada, el trabajo afectado queda suspendido por default (RUL-051).
      </p>
      <button
        type="submit"
        className="vds-button vds-button--primary"
        disabled={category.trim().length === 0 || description.trim().length < 3}
      >
        Reportar
      </button>
      <CommandOutcome state={action.state} />
    </form>
  );
}

function EventDetailView({
  eventId,
  canTriage,
  canCase,
  onChanged,
}: {
  readonly eventId: string;
  readonly canTriage: boolean;
  readonly canCase: boolean;
  readonly onChanged: () => void;
}): JSX.Element {
  const [detail, setDetail] = useState<HabilitaEventDetail | null>(null);

  const load = useCallback(async () => {
    const result = await fetchHabilitaEvent(eventId);
    setDetail(result.data);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = () => {
    void load();
    onChanged();
  };

  if (!detail) return <p className="vds-empty">Cargando detalle…</p>;
  const { event, classifications, case: kase, actions, notifications, caseLifecycle } = detail;

  return (
    <div className="vds-permits__detail">
      <dl className="vds-drawer__facts">
        <dt>Reportó</dt>
        <dd>{event.reported_by_name ?? '—'}</dd>
        <dt>Ocurrió / reportado</dt>
        <dd className="vds-numeric">
          {fmtInstant(event.occurred_at)} / {fmtInstant(event.reported_at)}
        </dd>
        <dt>Ubicación</dt>
        <dd>{event.location_name ?? event.unmapped_location ?? '—'}</dd>
      </dl>

      {classifications.length > 0 && (
        <>
          <h4>Clasificación (versionada — RUL-049)</h4>
          <ul className="vds-list--compact">
            {classifications.map((c) => (
              <li key={c.id}>
                <span className="vds-numeric">v{c.version_no}</span>
                <span>
                  {c.category}
                  {c.severity ? ` · ${c.severity}` : ''} — {c.classified_by_name ?? '—'} ·{' '}
                  {fmtInstant(c.classified_at)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {canTriage && event.state !== 'ESCALADO_A_CASO' && event.state !== 'CERRADO_SIN_CASO' && event.state !== 'DESCARTADO' && (
        <TriageActions eventId={eventId} state={event.state} onChanged={refresh} />
      )}

      {kase && (
        <CaseSection
          caseId={kase.id}
          caseState={kase.state}
          investigationState={kase.investigation_state}
          actions={actions}
          notifications={notifications}
          lifecycle={caseLifecycle}
          canCase={canCase}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function TriageActions({
  eventId,
  state,
  onChanged,
}: {
  readonly eventId: string;
  readonly state: string;
  readonly onChanged: () => void;
}): JSX.Element {
  const triageAction = useCommand(onChanged);
  const classifyAction = useCommand(onChanged);
  const closeAction = useCommand(onChanged);
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');
  const [justification, setJustification] = useState('');
  const base = `/habilita/events/${eventId}`;

  if (state === 'REPORTADO') {
    return (
      <div className="vds-unit__active">
        <div className="vds-inline-form">
          <button type="button" className="vds-button vds-button--primary" onClick={() => void triageAction.run(`${base}/start-triage`)}>
            Iniciar triage
          </button>
          <CommandOutcome state={triageAction.state} />
        </div>
      </div>
    );
  }

  if (state === 'EN_TRIAGE') {
    return (
      <form
        className="vds-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void classifyAction.run(`${base}/classify`, {
            payload: { category: category.trim(), ...(severity.trim() ? { severity: severity.trim() } : {}) },
          });
        }}
      >
        <label htmlFor={`cls-cat-${eventId}`}>Clasificar — categoría</label>
        <input id={`cls-cat-${eventId}`} className="vds-input" value={category} onChange={(e) => setCategory(e.target.value)} />
        <input className="vds-input" value={severity} onChange={(e) => setSeverity(e.target.value)} placeholder="severidad (opcional)" />
        <button type="submit" className="vds-button vds-button--primary" disabled={category.trim().length === 0}>
          Clasificar
        </button>
        <CommandOutcome state={classifyAction.state} />
      </form>
    );
  }

  if (state === 'CLASIFICADO') {
    return (
      <div className="vds-unit__active">
        <EscalateForm eventId={eventId} onChanged={onChanged} />
        <form
          className="vds-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void closeAction.run(`${base}/close-without-case`, { payload: { justification: justification.trim() } });
          }}
        >
          <label htmlFor={`close-just-${eventId}`}>Cerrar sin caso — justificación</label>
          <input
            id={`close-just-${eventId}`}
            className="vds-input"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
          <button type="submit" className="vds-button vds-button--secondary" disabled={justification.trim().length < 10}>
            Cerrar sin caso
          </button>
          <CommandOutcome state={closeAction.state} />
        </form>
      </div>
    );
  }

  return <></>;
}

/**
 * Escalation needs an owner — the identity who will drive the case. There is no "pick a person"
 * widget yet (that belongs with a people-search surface this module does not have), so the form
 * asks for an identity id directly rather than inventing a default owner the server was never told
 * to assume (C-005/C-006: no silent default for a decision that has no safe one).
 */
function EscalateForm({ eventId, onChanged }: { readonly eventId: string; readonly onChanged: () => void }): JSX.Element {
  const action = useCommand(onChanged);
  const [ownerId, setOwnerId] = useState('');
  const [justification, setJustification] = useState('');

  return (
    <form
      className="vds-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(`/habilita/events/${eventId}/escalate-to-case`, {
          payload: { ownerId: ownerId.trim(), justification: justification.trim() },
        });
      }}
    >
      <label htmlFor={`esc-owner-${eventId}`}>Escalar a caso — owner (id de identidad)</label>
      <input id={`esc-owner-${eventId}`} className="vds-input vds-numeric" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} />
      <input
        className="vds-input"
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
        placeholder="justificación (mínimo 10 caracteres)"
      />
      <button
        type="submit"
        className="vds-button vds-button--primary"
        disabled={ownerId.trim().length === 0 || justification.trim().length < 10}
      >
        Abrir caso
      </button>
      <CommandOutcome state={action.state} />
    </form>
  );
}

function CaseSection({
  caseId,
  caseState,
  investigationState,
  actions,
  notifications,
  lifecycle,
  canCase,
  onChanged,
}: {
  readonly caseId: string;
  readonly caseState: string;
  readonly investigationState: string;
  readonly actions: HabilitaEventDetail['actions'];
  readonly notifications: HabilitaEventDetail['notifications'];
  readonly lifecycle: HabilitaEventDetail['caseLifecycle'];
  readonly canCase: boolean;
  readonly onChanged: () => void;
}): JSX.Element {
  const base = `/habilita/cases/${caseId}`;
  const startInvestigation = useCommand(onChanged);
  const finishInvestigation = useCommand(onChanged);
  const evaluateClosure = useCommand(onChanged);
  const closeCase = useCommand(onChanged);
  const [summary, setSummary] = useState('');

  return (
    <div className="vds-part-close">
      <h4>
        Caso <StateBadge dimension="habilita" label="Caso" state={caseState} tone={CASE_TONE[caseState] ?? 'neutral'} />
        <span className="vds-note"> investigación: {investigationState}</span>
      </h4>

      {canCase && caseState === 'ABIERTO' && (
        <div className="vds-inline-form">
          <button type="button" className="vds-button vds-button--primary" onClick={() => void startInvestigation.run(`${base}/start-investigation`)}>
            Iniciar investigación
          </button>
          <CommandOutcome state={startInvestigation.state} />
        </div>
      )}

      {canCase && caseState === 'EN_INVESTIGACION' && (
        <>
          <ActionsAndNotifications caseId={caseId} actions={actions} notifications={notifications} onChanged={onChanged} />
          <form
            className="vds-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void finishInvestigation.run(`${base}/finish-investigation`, { payload: { summary: summary.trim() } });
            }}
          >
            <label htmlFor={`inv-summary-${caseId}`}>Finalizar investigación — resumen</label>
            <input id={`inv-summary-${caseId}`} className="vds-input" value={summary} onChange={(e) => setSummary(e.target.value)} />
            <p className="vds-note">La investigación puede terminar con acciones todavía abiertas (T-CH03).</p>
            <button type="submit" className="vds-button vds-button--primary" disabled={summary.trim().length < 10}>
              Finalizar investigación
            </button>
            <CommandOutcome state={finishInvestigation.state} />
          </form>
        </>
      )}

      {canCase && caseState === 'SEGUIMIENTO_ACCIONES' && (
        <>
          <ActionsAndNotifications caseId={caseId} actions={actions} notifications={notifications} onChanged={onChanged} />
          <div className="vds-inline-form">
            <button type="button" className="vds-button vds-button--secondary" onClick={() => void evaluateClosure.run(`${base}/evaluate-closure`)}>
              Evaluar cierre
            </button>
            <CommandOutcome state={evaluateClosure.state} />
          </div>
        </>
      )}

      {canCase && caseState === 'LISTO_PARA_CIERRE' && (
        <div className="vds-inline-form">
          <button type="button" className="vds-button vds-button--primary" onClick={() => void closeCase.run(`${base}/close`)}>
            Cerrar caso
          </button>
          <CommandOutcome state={closeCase.state} />
        </div>
      )}

      {(actions.length > 0 || notifications.length > 0) && caseState !== 'EN_INVESTIGACION' && caseState !== 'SEGUIMIENTO_ACCIONES' && (
        <ReadOnlyActionsAndNotifications actions={actions} notifications={notifications} />
      )}

      {lifecycle.length > 0 && (
        <ol className="vds-lifecycle">
          {lifecycle.map((e, i) => (
            <li key={`${e.event_type}-${i}`}>
              <span className="vds-numeric">{fmtInstant(e.occurred_at)}</span>
              <strong>{e.event_type}</strong>
              <span>
                {e.from_state ?? '—'} → {e.to_state}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ReadOnlyActionsAndNotifications({
  actions,
  notifications,
}: {
  readonly actions: HabilitaEventDetail['actions'];
  readonly notifications: HabilitaEventDetail['notifications'];
}): JSX.Element {
  return (
    <>
      {actions.length > 0 && (
        <ul className="vds-list--compact">
          {actions.map((a) => (
            <li key={a.id}>
              <span>
                {a.description} {a.is_blocking ? '(bloqueante)' : ''}
              </span>
              <span className="vds-numeric">{a.state}</span>
            </li>
          ))}
        </ul>
      )}
      {notifications.length > 0 && (
        <ul className="vds-list--compact">
          {notifications.map((n) => (
            <li key={n.id}>
              <span>{n.obligation_code}</span>
              <span className="vds-numeric">{n.status}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ActionsAndNotifications({
  caseId,
  actions,
  notifications,
  onChanged,
}: {
  readonly caseId: string;
  readonly actions: HabilitaEventDetail['actions'];
  readonly notifications: HabilitaEventDetail['notifications'];
  readonly onChanged: () => void;
}): JSX.Element {
  return (
    <div className="vds-unit__sub">
      <h4>Acciones correctivas</h4>
      <ul className="vds-list--compact">
        {actions.map((a) => (
          <li key={a.id}>
            <span>
              {a.description} {a.is_blocking ? '(bloqueante)' : ''}
            </span>
            <ActionLifecycle actionId={a.id} caseId={caseId} state={a.state} onChanged={onChanged} />
          </li>
        ))}
      </ul>
      <CreateActionForm caseId={caseId} onChanged={onChanged} />

      <h4>Notificaciones (obligaciones)</h4>
      <ul className="vds-list--compact">
        {notifications.map((n) => (
          <li key={n.id}>
            <span>{n.obligation_code}</span>
            <NotificationLifecycle notificationId={n.id} status={n.status} onChanged={onChanged} />
          </li>
        ))}
      </ul>
      <CreateNotificationForm caseId={caseId} onChanged={onChanged} />
    </div>
  );
}

function ActionLifecycle({
  actionId,
  state,
  onChanged,
}: {
  readonly actionId: string;
  readonly caseId: string;
  readonly state: string;
  readonly onChanged: () => void;
}): JSX.Element {
  const action = useCommand(onChanged);
  const base = `/habilita/actions/${actionId}`;
  if (state === 'PENDIENTE' || state === 'EN_PROGRESO') {
    return (
      <span>
        <button type="button" className="vds-button vds-button--secondary" onClick={() => void action.run(`${base}/implement`)}>
          Implementar
        </button>
        <CommandOutcome state={action.state} />
      </span>
    );
  }
  if (state === 'IMPLEMENTADA' || state === 'EN_VERIFICACION') {
    return (
      <span>
        <button type="button" className="vds-button vds-button--primary" onClick={() => void action.run(`${base}/verify`)}>
          Verificar
        </button>
        <CommandOutcome state={action.state} />
      </span>
    );
  }
  return <span className="vds-numeric">{state}</span>;
}

function NotificationLifecycle({
  notificationId,
  status,
  onChanged,
}: {
  readonly notificationId: string;
  readonly status: string;
  readonly onChanged: () => void;
}): JSX.Element {
  const action = useCommand(onChanged);
  const [note, setNote] = useState('');
  if (status === 'RESUELTA' || status === 'CANCELADA') {
    return <span className="vds-numeric">{status}</span>;
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(`/habilita/notifications/${notificationId}/resolve`, { payload: { resolutionNote: note.trim() } });
      }}
    >
      <input className="vds-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="nota de resolución" />
      <button type="submit" className="vds-button vds-button--secondary" disabled={note.trim().length < 3}>
        Resolver
      </button>
      <CommandOutcome state={action.state} />
    </form>
  );
}

function CreateActionForm({ caseId, onChanged }: { readonly caseId: string; readonly onChanged: () => void }): JSX.Element {
  const action = useCommand(onChanged);
  const [description, setDescription] = useState('');
  const [isBlocking, setIsBlocking] = useState(true);
  const [responsibleId, setResponsibleId] = useState('');

  return (
    <form
      className="vds-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run('/habilita/actions', {
          payload: { caseId, description: description.trim(), isBlocking, responsibleId: responsibleId.trim() },
        });
      }}
    >
      <label htmlFor={`new-action-${caseId}`}>Nueva acción correctiva</label>
      <input id={`new-action-${caseId}`} className="vds-input" value={description} onChange={(e) => setDescription(e.target.value)} />
      <input
        className="vds-input vds-numeric"
        value={responsibleId}
        onChange={(e) => setResponsibleId(e.target.value)}
        placeholder="responsable (id de identidad)"
      />
      <label>
        <input type="checkbox" checked={isBlocking} onChange={(e) => setIsBlocking(e.target.checked)} />
        Bloqueante para el cierre
      </label>
      <button
        type="submit"
        className="vds-button vds-button--secondary"
        disabled={description.trim().length < 5 || responsibleId.trim().length === 0}
      >
        Crear acción
      </button>
      <CommandOutcome state={action.state} />
    </form>
  );
}

function CreateNotificationForm({ caseId, onChanged }: { readonly caseId: string; readonly onChanged: () => void }): JSX.Element {
  const action = useCommand(onChanged);
  const [obligationCode, setObligationCode] = useState('');
  const [recipientRole, setRecipientRole] = useState('');

  return (
    <form
      className="vds-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run('/habilita/notifications', {
          payload: { caseId, obligationCode: obligationCode.trim(), recipientRole: recipientRole.trim() },
        });
      }}
    >
      <label htmlFor={`new-notif-${caseId}`}>Nueva obligación de notificación</label>
      <input id={`new-notif-${caseId}`} className="vds-input" value={obligationCode} onChange={(e) => setObligationCode(e.target.value)} />
      <input
        className="vds-input"
        value={recipientRole}
        onChange={(e) => setRecipientRole(e.target.value)}
        placeholder="rol destinatario"
      />
      <button
        type="submit"
        className="vds-button vds-button--secondary"
        disabled={obligationCode.trim().length === 0 || recipientRole.trim().length === 0}
      >
        Crear obligación
      </button>
      <CommandOutcome state={action.state} />
    </form>
  );
}
