/**
 * Work permits (PTW).
 *
 * ADD. The prototype had no equivalent: a permit was three fields inside the Parte (`num`, `firmo`,
 * `hora`) and `o-ptnow` stamped "signed now" with one click. PD-0394 is exactly what that allows —
 * work logged from 07:20 with a permit activated at 11:25, and the controls reporting "sin bloqueos".
 *
 * So this surface exists to make three distinctions impossible to miss:
 *
 *  1. **APROBADO is not VIGENTE.** Approval is a decision; being in force is a separate authorised
 *     act with a window (RUL-043). The state column never merges them.
 *  2. **VENCIDO blocks and alerts; it never auto-closes.** An expired permit stops new starts and
 *     stays expired until someone with authority closes it administratively (C-021, RUL-045,
 *     TPR-013). The close button is therefore refused for a VENCIDO permit — by the server, with the
 *     correct path named.
 *  3. **Activation is forward-looking.** A permit cannot be activated to cover work that already
 *     happened; the server refuses a retroactive `validFrom`, and the form defaults to now.
 *
 * DS-01 treats this surface as signage: severity carries shape as well as colour, and a blocking
 * state is never a quiet grey chip.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ApiError, fetchPermits, type PermitRow } from '../../api/client.ts';
import { CommandOutcome, useCommand } from '../../components/CommandAction.tsx';
import { StateBadge } from '../../components/StateBadge.tsx';
import { fmtInstant } from '../planning/period.ts';

/** How each permit state reads, and what it does or does not authorise. */
const STATE_MEANING: Record<string, { tone: 'ok' | 'warn' | 'critical' | 'pending' | 'neutral'; note: string }> = {
  BORRADOR: { tone: 'pending', note: 'En preparación. No autoriza nada.' },
  PENDIENTE_APROBACION: { tone: 'pending', note: 'Enviado a aprobación. Todavía no autoriza.' },
  APROBADO: {
    tone: 'warn',
    note: 'Aprobado NO es vigente. Falta la activación con su ventana: RUL-043 separa la decisión del acto de poner en vigencia.',
  },
  VIGENTE: {
    tone: 'ok',
    note: 'En vigencia. Autoriza sólo dentro de su ventana y su alcance, evaluados en el instante real (RUL-042).',
  },
  SUSPENDIDO: {
    tone: 'warn',
    note: 'Suspendido sin cerrar (RUL-044). Reanudar exige revalidar sujeto y condiciones.',
  },
  VENCIDO: {
    tone: 'critical',
    note: 'Vencido: bloquea nuevos inicios y reinicios, y alerta. No se autocierra (C-021, RUL-045).',
  },
  CERRADO: { tone: 'neutral', note: 'Cerrado por su propio lifecycle, con autoridad.' },
  RECHAZADO: { tone: 'critical', note: 'Rechazado. No autoriza y no se reactiva: se emite otro.' },
  ANULADO: { tone: 'neutral', note: 'Anulado.' },
};

const FILTERS = ['TODOS', 'VIGENTE', 'APROBADO', 'PENDIENTE_APROBACION', 'VENCIDO', 'SUSPENDIDO'] as const;

export interface PermitsProps {
  readonly capabilities: readonly string[];
  readonly onShowTrace: (subjectKind: string, subjectId: string) => void;
}

export function Permits({ capabilities, onShowTrace }: PermitsProps): JSX.Element {
  const [permits, setPermits] = useState<readonly PermitRow[]>([]);
  const [meta, setMeta] = useState<{ source?: string; asOf?: string; note?: string } | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('TODOS');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchPermits(filter === 'TODOS' ? {} : { state: filter });
      setPermits(result.data);
      setMeta(result.meta as { source?: string; asOf?: string; note?: string });
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudieron cargar los permisos.');
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const can = (capability: string) => capabilities.includes(capability);

  return (
    <div className="vds-permits" data-density="operations">
      <header className="vds-permits__bar">
        <div role="group" aria-label="Filtrar por estado" className="vds-permits__filters">
          {FILTERS.map((state) => (
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
      </header>

      {meta?.note && <p className="vds-notice">{meta.note}</p>}
      {error && <p className="vds-error">{error}</p>}

      {permits.length === 0 ? (
        <p className="vds-empty">Sin permisos para ese filtro.</p>
      ) : (
        <ul className="vds-permits__list">
          {permits.map((permit) => {
            const meaning = STATE_MEANING[permit.state] ?? { tone: 'neutral' as const, note: permit.state };
            const isExpanded = expanded === permit.id;
            return (
              <li key={permit.id} data-state={permit.state} data-tone={meaning.tone}>
                <div className="vds-permits__head">
                  <span className="vds-numeric vds-permits__code">
                    {permit.code ?? permit.id.slice(0, 8)}
                  </span>
                  <StateBadge
                    dimension="habilita"
                    label="PTW"
                    state={permit.state}
                    tone={meaning.tone}
                    title={meaning.note}
                  />
                  <span className="vds-permits__type">{permit.permit_type}</span>
                  <span className="vds-numeric vds-permits__window">
                    {fmtInstant(permit.valid_from)} → {fmtInstant(permit.valid_until)}
                  </span>
                  <button
                    type="button"
                    className="vds-button vds-button--ghost"
                    aria-expanded={isExpanded}
                    onClick={() => setExpanded(isExpanded ? null : permit.id)}
                  >
                    {isExpanded ? 'Ocultar' : 'Detalle'}
                  </button>
                </div>

                <p className="vds-permits__meaning">{meaning.note}</p>

                {isExpanded && (
                  <div className="vds-permits__detail">
                    <dl className="vds-drawer__facts">
                      <dt>Alcance</dt>
                      <dd>{permit.scope_description ?? '—'}</dd>
                      <dt>Ubicación</dt>
                      <dd className="vds-numeric">
                        {permit.location_name ?? '—'}{' '}
                        {permit.location_code ? `(${permit.location_code})` : ''}
                      </dd>
                      <dt>Autoridad externa</dt>
                      <dd>{permit.external_authority ?? 'no registrada'}</dd>
                      <dt>Solicitó / aprobó</dt>
                      <dd>
                        {permit.requested_by_name ?? '—'} / {permit.approved_by_name ?? 'sin aprobar'}
                      </dd>
                      <dt>UE cubiertas</dt>
                      <dd className="vds-numeric">
                        {permit.covered_units ?? '0'}
                        <small> la cobertura es N:M (C-020)</small>
                      </dd>
                      <dt>Activado</dt>
                      <dd className="vds-numeric">{fmtInstant(permit.activated_at)}</dd>
                    </dl>

                    {permit.lifecycle && permit.lifecycle.length > 0 && (
                      <ol className="vds-lifecycle">
                        {permit.lifecycle.map((event, index) => (
                          <li key={`${event.eventType}-${index}`}>
                            <span className="vds-numeric">{fmtInstant(event.occurredAt)}</span>
                            <strong>{event.eventType}</strong>
                            {event.fromState && (
                              <span>
                                {event.fromState} → {event.toState}
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}

                    <PermitActions
                      permit={permit}
                      canManage={can('habilita.permit.manage')}
                      canApprove={can('habilita.permit.approve')}
                      canActivate={can('habilita.permit.activate')}
                      onChanged={load}
                    />

                    <button
                      type="button"
                      className="vds-button vds-button--ghost"
                      onClick={() => onShowTrace('PermisoTrabajo', permit.id)}
                    >
                      Ver trazabilidad
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="vds-asof vds-numeric">
        {meta?.source ?? '—'} · leído {fmtInstant(meta?.asOf)}
      </p>
    </div>
  );
}

function PermitActions({
  permit,
  canManage,
  canApprove,
  canActivate,
  onChanged,
}: {
  readonly permit: PermitRow;
  readonly canManage: boolean;
  readonly canApprove: boolean;
  readonly canActivate: boolean;
  readonly onChanged: () => void;
}): JSX.Element {
  const action = useCommand(onChanged);
  // Activation defaults to now and never to the past: a permit cannot cover work already done.
  const [validFrom, setValidFrom] = useState(() => toLocalInput(new Date()));
  const [validUntil, setValidUntil] = useState(() => toLocalInput(new Date(Date.now() + 12 * 3_600_000)));
  const [authority, setAuthority] = useState('');
  const [reason, setReason] = useState('');

  const base = `/habilita/permits/${permit.id}`;

  return (
    <div className="vds-permits__actions">
      {canManage && permit.state === 'BORRADOR' && (
        <button
          type="button"
          className="vds-button vds-button--primary"
          onClick={() => void action.run(`${base}/submit`)}
        >
          Enviar a aprobación
        </button>
      )}

      {canApprove && permit.state === 'PENDIENTE_APROBACION' && (
        <form
          className="vds-permits__form"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(`${base}/approve`, {
              payload: authority.trim() ? { externalAuthority: authority.trim() } : {},
            });
          }}
        >
          <label htmlFor={`authority-${permit.id}`}>Autoridad externa (opcional)</label>
          <input
            id={`authority-${permit.id}`}
            className="vds-input"
            value={authority}
            onChange={(event) => setAuthority(event.target.value)}
          />
          <p className="vds-note">
            Quien aprueba no puede ser quien solicitó. Aprobar no pone el permiso en vigencia.
          </p>
          <button type="submit" className="vds-button vds-button--primary">
            Aprobar
          </button>
        </form>
      )}

      {canActivate && permit.state === 'APROBADO' && (
        <form
          className="vds-permits__form"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(`${base}/activate`, {
              payload: {
                validFrom: toInstant(validFrom),
                ...(validUntil ? { validUntil: toInstant(validUntil) } : {}),
                ...(authority.trim() ? { externalAuthority: authority.trim() } : {}),
              },
            });
          }}
        >
          <label htmlFor={`from-${permit.id}`}>Vigente desde</label>
          <input
            id={`from-${permit.id}`}
            className="vds-input"
            type="datetime-local"
            value={validFrom}
            onChange={(event) => setValidFrom(event.target.value)}
          />
          <label htmlFor={`until-${permit.id}`}>Vigente hasta</label>
          <input
            id={`until-${permit.id}`}
            className="vds-input"
            type="datetime-local"
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
          />
          <p className="vds-note">
            Una activación con fecha anterior al momento real es rechazada: un permiso posterior no
            autoriza trabajo anterior (PD-0394). Si el trabajo ya ocurrió, queda como discrepancia.
          </p>
          <button type="submit" className="vds-button vds-button--primary">
            Poner en vigencia
          </button>
        </form>
      )}

      {canActivate && permit.state === 'VIGENTE' && (
        <form
          className="vds-permits__form"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(`${base}/suspend`, { payload: { reason: reason.trim() } });
          }}
        >
          <label htmlFor={`reason-${permit.id}`}>Motivo de la suspensión (mínimo 5)</label>
          <textarea
            id={`reason-${permit.id}`}
            className="vds-input"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="vds-note">
            Suspender no cierra: el permiso sigue existiendo y reanudarlo revalida las condiciones
            (RUL-044).
          </p>
          <button type="submit" className="vds-button vds-button--secondary" disabled={reason.trim().length < 5}>
            Suspender
          </button>
        </form>
      )}

      {canActivate && (permit.state === 'VIGENTE' || permit.state === 'SUSPENDIDO') && (
        <button
          type="button"
          className="vds-button vds-button--secondary"
          onClick={() => void action.run(`${base}/close`, { payload: { note: 'Cierre desde Habilita.' } })}
        >
          Cerrar
        </button>
      )}

      {permit.state === 'VENCIDO' && (
        <p className="vds-notice">
          {/* The button is absent rather than disabled-with-a-tooltip: TPR-013 says this path does
              not exist for a VENCIDO permit, and offering it would imply it might work. */}
          Un permiso vencido no se cierra desde acá. Requiere un cierre administrativo autorizado con
          política y autoridad (TPR-013). Mientras tanto bloquea nuevos inicios.
        </p>
      )}

      <CommandOutcome state={action.state} />
    </div>
  );
}

/** `datetime-local` value from a Date, in local time. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Local input back to a UTC instant. The server stores instants; the operator reads local time. */
const toInstant = (value: string): string =>
  new Date(value).toISOString().replace(/\.\d+Z$/, 'Z');
