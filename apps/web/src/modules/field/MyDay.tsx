/**
 * Mi jornada — the field surface, preserved and evolved.
 *
 * KEEP from the prototype (01, 15, adenda §3): the prioritised cards — what is running, what is ready
 * to start, what is upcoming, what was sent — and the visible work context. Those are the parts a
 * crew already knows how to read.
 *
 * What evolves:
 *
 *  - **Preparación before En curso.** 15 lists this as a justified evolution and S0 §6 requires the
 *    hard gate to run *before* starting. So a PREPARADO card shows "Evaluar e iniciar", which opens
 *    the gate panel, rather than a button that starts and validates afterwards.
 *  - **Dimensions stay separate.** Each card shows its operational state and its delivery state as
 *    different badges, because they are different facts (S0 §8).
 *  - **Truthful sync language.** Outstanding delivery is reported as outstanding, never as
 *    "Sincronizado" (12).
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import type { DecisionEnvelope } from '@vds/kernel';
import {
  ApiError,
  command,
  evaluate,
  fetchMyDay,
  fetchPart,
  newCommandId,
  type MyDayRow,
  type PartDetail,
} from '../../api/client.ts';
import { GatePanel } from '../../components/GatePanel.tsx';
import {
  StateBadge,
  StateBadgeRow,
  deliveryTone,
  operationalTone,
} from '../../components/StateBadge.tsx';

type Group = 'running' | 'ready' | 'upcoming' | 'closed';

/** Priority mirrors the prototype's ordering: current work first, then what can be started. */
function groupOf(row: MyDayRow): Group {
  switch (row.operational.state) {
    case 'EN_EJECUCION':
    case 'SUSPENDIDO':
      return 'running';
    case 'PREPARADO':
      return 'ready';
    case 'CERRADO_OPERATIVAMENTE':
      return 'closed';
    default:
      return 'upcoming';
  }
}

const GROUP_LABEL: Record<Group, string> = {
  running: 'En curso',
  ready: 'Preparados · listos para evaluar e iniciar',
  upcoming: 'Próximos',
  closed: 'Cerrados operativamente',
};

export function MyDay(): JSX.Element {
  const [rows, setRows] = useState<readonly MyDayRow[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchMyDay();
      setRows(result.data);
      setAsOf(result.meta.asOf ?? result.meta.serverTime);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo cargar la jornada.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && rows.length === 0) {
    return <p className="vds-empty">Cargando jornada…</p>;
  }

  if (error) {
    return (
      <section className="vds-error">
        <h2>No se pudo cargar</h2>
        <p>{error}</p>
        <button type="button" className="vds-button" onClick={() => void load()}>
          Reintentar
        </button>
      </section>
    );
  }

  const groups: readonly Group[] = ['running', 'ready', 'upcoming', 'closed'];

  return (
    <div className="vds-myday">
      {/* Every figure states when it was read. */}
      <p className="vds-asof vds-numeric">
        Datos al {asOf ? new Date(asOf).toLocaleString('es-AR') : '—'} · fuente: execution
      </p>

      {rows.length === 0 && <p className="vds-empty">No hay trabajos en la jornada.</p>}

      {groups.map((group) => {
        const groupRows = rows.filter((r) => groupOf(r) === group);
        if (groupRows.length === 0) return null;
        return (
          <section key={group} className="vds-myday__group">
            <h2>
              {GROUP_LABEL[group]} <span className="vds-numeric">({groupRows.length})</span>
            </h2>
            <ul className="vds-cards">
              {groupRows.map((row) => (
                <PartCard
                  key={row.partId}
                  row={row}
                  expanded={selected === row.partId}
                  onToggle={() => setSelected(selected === row.partId ? null : row.partId)}
                  onChanged={() => void load()}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function PartCard({
  row,
  expanded,
  onToggle,
  onChanged,
}: {
  readonly row: MyDayRow;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onChanged: () => void;
}): JSX.Element {
  return (
    <li className="vds-card" data-state={row.operational.state}>
      <button type="button" className="vds-card__header" onClick={onToggle} aria-expanded={expanded}>
        <span className="vds-card__title">
          <span className="vds-numeric">{row.code ?? row.partId.slice(0, 8)}</span>
          <span className="vds-card__type">{row.partType}</span>
          {row.isEmergent && <span className="vds-chip vds-chip--warn">Emergente</span>}
        </span>
        <span className="vds-card__meta vds-numeric">
          {row.operationalDate}
          {row.shiftId ? ` · turno ${row.shiftId}` : ''}
          {row.crewName ? ` · ${row.crewName}` : ''}
        </span>
      </button>

      {/* Separate dimensions, each with its own badge. */}
      <StateBadgeRow>
        <StateBadge
          dimension="exec"
          label="Operación"
          state={row.operational.state}
          tone={operationalTone(row.operational.state)}
          title="Estado operacional del Parte. No dice nada sobre revisión ni certificación."
        />
        {row.delivery.outstanding > 0 ? (
          <StateBadge
            dimension="delivery"
            label="Entrega"
            state={`${row.delivery.outstanding} pendiente(s)`}
            tone="pending"
            title="Comandos aún sin receipt del servidor. Enviado no prueba recepción."
          />
        ) : (
          <StateBadge
            dimension="delivery"
            label="Entrega"
            state="Sin pendientes"
            tone={deliveryTone('RECIBIDO')}
            title="Todo lo capturado tiene receipt durable del servidor."
          />
        )}
      </StateBadgeRow>

      <dl className="vds-card__stats">
        <div>
          <dt>Unidades</dt>
          <dd className="vds-numeric">
            {row.operational.totalUnits - row.operational.openUnits} / {row.operational.totalUnits}
          </dd>
        </div>
        <div>
          <dt>Intervalos abiertos</dt>
          <dd className="vds-numeric">{row.openIntervals}</dd>
        </div>
      </dl>

      {expanded && <PartWork partId={row.partId} onChanged={onChanged} />}
    </li>
  );
}

/**
 * The work itself: units, with evaluate-then-start.
 *
 * The two-step is the point. `o-start` in the prototype set the state and validated at send time; here
 * "Evaluar" runs the real pipeline in preview mode and shows blocks, warnings and confirmations, and
 * "Iniciar" sends the command — which re-evaluates, because the preview authorises nothing.
 */
function PartWork({ partId, onChanged }: { readonly partId: string; readonly onChanged: () => void }): JSX.Element {
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [decision, setDecision] = useState<DecisionEnvelope | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeUnit, setActiveUnit] = useState<string | null>(null);
  /** One command id per user intent, reused across retries so a retry stays idempotent (RGT-06). */
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchPart(partId);
    setDetail(result.data);
  }, [partId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runEvaluate = async (unitId: string) => {
    setActiveUnit(unitId);
    setEvaluating(true);
    setNotice(null);
    try {
      const result = await evaluate(`/execution/units/${unitId}/start`);
      setDecision(result.decision);
    } catch (cause) {
      if (cause instanceof ApiError && cause.isBlocked) {
        // A blocked preview arrives as an error; render its blocks in the panel rather than as a
        // generic failure, because the blocks are the useful part.
        setDecision({
          decisionId: cause.body.decisionId ?? '',
          decision: 'BLOCK',
          subject: { kind: 'UnidadEjecucion', id: unitId },
          trigger: 'START_WORK',
          blocks: (cause.body.blocks ?? []).map((b) => ({
            ruleId: b.ruleId,
            precedence: 'P1',
            reason: b.reason,
            ...(b.instead === undefined ? {} : { instead: b.instead }),
            ...(b.sourceRef === undefined ? {} : { sourceRef: b.sourceRef }),
            overrideable: false,
          })),
          warnings: [],
          confirmationsRequired: [],
          missing: [],
          effects: [],
          rulesApplied: [],
          rulesetVersion: '',
          evaluatedAt: new Date().toISOString() as never,
          contextHash: '',
          preview: true,
          // Reconstructed from an error body, so the branded id types do not apply here.
        } as unknown as DecisionEnvelope);
      } else {
        setNotice(cause instanceof ApiError ? cause.message : 'No se pudo evaluar.');
      }
    } finally {
      setEvaluating(false);
    }
  };

  const runStart = async (unitId: string) => {
    setBusy(true);
    setNotice(null);
    const commandId = pendingCommandId ?? newCommandId();
    setPendingCommandId(commandId);
    try {
      const result = await command(`/execution/units/${unitId}/start`, { commandId });
      setNotice(
        result.receipt.outcome === 'REPLAYED'
          ? 'Este comando ya se había registrado. Se devolvió el mismo receipt; no se aplicó un segundo efecto.'
          : 'Trabajo iniciado.',
      );
      setPendingCommandId(null);
      setDecision(null);
      await load();
      onChanged();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setNotice(cause.message);
        // Keep the command id: retrying the same intent must reuse it.
        if (cause.isBlocked && cause.body.blocks) {
          setDecision((previous) =>
            previous
              ? { ...previous, blocks: cause.body.blocks!.map((b) => ({ ...b, precedence: 'P1' as const, overrideable: false })) }
              : previous,
          );
        }
      }
    } finally {
      setBusy(false);
    }
  };

  if (!detail) return <p className="vds-empty">Cargando detalle…</p>;

  return (
    <div className="vds-card__body">
      {notice && <p className="vds-notice">{notice}</p>}

      <h3>Unidades de ejecución</h3>
      <ul className="vds-units">
        {detail.units.map((unit) => {
          const unitId = unit['id'] as string;
          const state = unit['state'] as string;
          const allocation = unit['allocation_status'] as string | null;
          return (
            <li key={unitId} className="vds-unit">
              <div className="vds-unit__head">
                <span className="vds-unit__desc">{unit['description'] as string}</span>
                <StateBadgeRow>
                  <StateBadge dimension="exec" label="UE" state={state} tone={operationalTone(state)} />
                  {allocation && allocation !== 'RESUELTO' && (
                    <StateBadge
                      dimension="commercial"
                      label="Imputación"
                      state={allocation}
                      tone="pending"
                      title={
                        (unit['pending_reason'] as string | null) ??
                        'La realidad se registra igual; la derivación comercial queda bloqueada.'
                      }
                    />
                  )}
                </StateBadgeRow>
              </div>

              {state === 'PENDIENTE' && (
                <div className="vds-unit__actions">
                  <button
                    type="button"
                    className="vds-button vds-button--secondary"
                    onClick={() => void runEvaluate(unitId)}
                    disabled={evaluating}
                  >
                    Evaluar gates
                  </button>
                  <button
                    type="button"
                    className="vds-button vds-button--primary"
                    onClick={() => void runStart(unitId)}
                    disabled={busy}
                  >
                    {busy ? 'Iniciando…' : 'Iniciar'}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {activeUnit && <GatePanel decision={decision} loading={evaluating} />}

      {detail.intervals.length > 0 && (
        <>
          <h3>Tiempos</h3>
          <table className="vds-table" data-density="operations">
            <thead>
              <tr>
                <th scope="col">Categoría</th>
                <th scope="col">Desde</th>
                <th scope="col">Hasta</th>
              </tr>
            </thead>
            <tbody>
              {detail.intervals.map((interval) => (
                <tr key={interval['id'] as string}>
                  <td>{interval['time_category'] as string}</td>
                  <td className="vds-numeric">
                    {new Date(interval['started_at'] as string).toLocaleTimeString('es-AR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </td>
                  <td className="vds-numeric">
                    {interval['ended_at']
                      ? new Date(interval['ended_at'] as string).toLocaleTimeString('es-AR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })
                      : '— abierto'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {detail.people.length > 0 && (
        <>
          <h3>Personal</h3>
          <ul className="vds-people">
            {detail.people.map((person) => (
              <li key={person['id'] as string}>
                <span>
                  {person['first_name'] as string} {person['last_name'] as string}
                </span>
                <span className="vds-people__role">{person['role'] as string}</span>
                {/* RGT-05: a non-compliance is recorded next to the presence, never by removing it. */}
                {(person['compliance_status'] as string) === 'NON_COMPLIANT_RECORDED' && (
                  <span className="vds-chip vds-chip--warn" title="Participación real registrada con incumplimiento">
                    Incumplimiento registrado
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
