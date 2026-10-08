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
import { CommandOutcome, useCommand } from '../../components/CommandAction.tsx';
import {
  StateBadge,
  StateBadgeRow,
  deliveryTone,
  operationalTone,
} from '../../components/StateBadge.tsx';

/** Common, non-exhaustive suggestions. Time category is configuration, not a closed enum (C-005). */
const TIME_CATEGORY_SUGGESTIONS = ['OPERATIVO', 'ESPERA', 'TRASLADO', 'MANTENIMIENTO', 'OTRO'];
const LOCATION_ROLES = ['PRINCIPAL', 'ORIGEN', 'DESTINO', 'CARGA', 'DESCARGA'] as const;
const MEASUREMENT_SOURCES = [
  { value: 'HUMAN_READING', label: 'Lectura humana' },
  { value: 'INSTRUMENT', label: 'Instrumento' },
  { value: 'PRELOADED_CONFIRMED', label: 'Precargado, confirmado' },
  { value: 'EXTERNAL_DOCUMENT', label: 'Documento externo' },
] as const;
const CLOSE_RESULTS = [
  { value: 'COMPLETADA', label: 'Completada' },
  { value: 'PARCIAL', label: 'Parcial' },
  { value: 'NO_REALIZADA', label: 'No realizada' },
  { value: 'OTRO', label: 'Otro' },
] as const;

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

              {(state === 'EN_EJECUCION' || state === 'SUSPENDIDA') && (
                <ActiveUnitWork
                  unitId={unitId}
                  state={state}
                  unitsOfMeasure={detail.unitsOfMeasure}
                  locations={detail.locations.filter((l) => l['execution_unit_id'] === unitId)}
                  measurements={detail.measurements.filter((m) => m['execution_unit_id'] === unitId)}
                  onChanged={() => {
                    onChanged();
                    void load();
                  }}
                />
              )}

              {(state === 'CERRADA' || state === 'NO_REALIZADA' || state === 'ANULADA') &&
                (unit['result'] != null || unit['result_reason'] != null) && (
                  <p className="vds-note vds-numeric">
                    {unit['result'] as string}
                    {unit['result_reason'] ? ` — ${unit['result_reason'] as string}` : ''}
                  </p>
                )}
            </li>
          );
        })}
      </ul>

      {activeUnit && <GatePanel decision={decision} loading={evaluating} />}

      <PartCloseSection
        partId={partId}
        partState={detail.part['state'] as string}
        units={detail.units}
        onChanged={() => {
          onChanged();
          void load();
        }}
      />

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

/**
 * The work itself, grouped by capability rather than by step.
 *
 * 09_TP01_TP02_TP03 §Contrato de componentes: temporal/category/location/measurement widgets are
 * shared across the three TypePartBehavior strategies, and this is that shared surface. It does not
 * ask the pattern which fields to show — `requiredComponents` is a config.part_type_components
 * question answered server-side when a unit is created; here every capture is offered and the server
 * is the one that accepts, refuses, or asks for a confirmation (CF-01…13 run at the gate, not in the
 * form).
 */
function ActiveUnitWork({
  unitId,
  state,
  unitsOfMeasure,
  locations,
  measurements,
  onChanged,
}: {
  readonly unitId: string;
  readonly state: string;
  readonly unitsOfMeasure: PartDetail['unitsOfMeasure'];
  readonly locations: readonly Record<string, unknown>[];
  readonly measurements: readonly Record<string, unknown>[];
  readonly onChanged: () => void;
}): JSX.Element {
  const base = `/execution/units/${unitId}`;

  return (
    <div className="vds-unit__active">
      {state === 'SUSPENDIDA' ? (
        <ResumeForm base={base} onChanged={onChanged} />
      ) : (
        <>
          <SuspendForm base={base} onChanged={onChanged} />
          <TimeCategoryForm base={base} onChanged={onChanged} />
          <LocationForm base={base} onChanged={onChanged} />
          <MeasurementForm base={base} unitsOfMeasure={unitsOfMeasure} onChanged={onChanged} />
          <CloseUnitForm base={base} onChanged={onChanged} />
        </>
      )}

      {locations.length > 0 && (
        <div className="vds-unit__sub">
          <h4>Ubicaciones</h4>
          <ul className="vds-list--compact">
            {locations.map((l) => (
              <li key={l['id'] as string}>
                <span>{l['location_role'] as string}</span>
                <span>
                  {(l['technical_location_name'] as string | null) ??
                    `${l['unmapped_label'] as string} (no mapeada)`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {measurements.length > 0 && (
        <div className="vds-unit__sub">
          <h4>Mediciones</h4>
          <ul className="vds-list--compact">
            {measurements.map((m) => (
              <li key={m['id'] as string} className="vds-numeric">
                {m['metric_code'] as string}: {m['quantity'] as string} {m['unit_code'] as string}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SuspendForm({ base, onChanged }: { readonly base: string; readonly onChanged: () => void }): JSX.Element {
  const action = useCommand(onChanged);
  const [reason, setReason] = useState('');
  return (
    <form
      className="vds-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(`${base}/suspend`, { payload: { reason: reason.trim() } });
      }}
    >
      <label htmlFor={`suspend-reason-${base}`}>Suspender — motivo</label>
      <input
        id={`suspend-reason-${base}`}
        className="vds-input"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Espera de condiciones, directiva, etc."
      />
      <button type="submit" className="vds-button vds-button--secondary" disabled={reason.trim().length < 3}>
        Suspender
      </button>
      <CommandOutcome state={action.state} />
    </form>
  );
}

function ResumeForm({ base, onChanged }: { readonly base: string; readonly onChanged: () => void }): JSX.Element {
  const action = useCommand(onChanged);
  return (
    <div className="vds-inline-form">
      <p className="vds-note">
        Reanudar vuelve a evaluar los gates: un permiso vencido durante la suspensión bloquea el
        reinicio (RUL-022/023).
      </p>
      <button type="button" className="vds-button vds-button--primary" onClick={() => void action.run(`${base}/resume`)}>
        Reanudar
      </button>
      <CommandOutcome state={action.state} />
    </div>
  );
}

function TimeCategoryForm({ base, onChanged }: { readonly base: string; readonly onChanged: () => void }): JSX.Element {
  const action = useCommand(onChanged);
  const [category, setCategory] = useState('');
  return (
    <form
      className="vds-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(`${base}/change-time-category`, { payload: { timeCategory: category.trim() } });
      }}
    >
      <label htmlFor={`category-${base}`}>Cambiar categoría de tiempo</label>
      <input
        id={`category-${base}`}
        className="vds-input"
        list="time-category-suggestions"
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        placeholder="OPERATIVO"
      />
      <datalist id="time-category-suggestions">
        {TIME_CATEGORY_SUGGESTIONS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <button type="submit" className="vds-button vds-button--secondary" disabled={category.trim().length === 0}>
        Cambiar
      </button>
      <CommandOutcome state={action.state} />
    </form>
  );
}

function LocationForm({ base, onChanged }: { readonly base: string; readonly onChanged: () => void }): JSX.Element {
  const action = useCommand(onChanged);
  const [role, setRole] = useState<(typeof LOCATION_ROLES)[number]>('PRINCIPAL');
  const [label, setLabel] = useState('');
  return (
    <form
      className="vds-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(`${base}/confirm-location`, {
          payload: { locationRole: role, unmappedLabel: label.trim() },
        });
      }}
    >
      <label htmlFor={`location-role-${base}`}>Confirmar ubicación</label>
      <select
        id={`location-role-${base}`}
        className="vds-input"
        value={role}
        onChange={(event) => setRole(event.target.value as (typeof LOCATION_ROLES)[number])}
      >
        {LOCATION_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <input
        className="vds-input"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="Lugar declarado en campo"
      />
      <p className="vds-note">
        Sin maestro cargado, queda registrada como no mapeada (RUL-031): referencia a lo declarado,
        nunca inventada.
      </p>
      <button type="submit" className="vds-button vds-button--secondary" disabled={label.trim().length < 2}>
        Confirmar
      </button>
      <CommandOutcome state={action.state} />
    </form>
  );
}

function MeasurementForm({
  base,
  unitsOfMeasure,
  onChanged,
}: {
  readonly base: string;
  readonly unitsOfMeasure: PartDetail['unitsOfMeasure'];
  readonly onChanged: () => void;
}): JSX.Element {
  const action = useCommand(onChanged);
  const [metricCode, setMetricCode] = useState('');
  const [value, setValue] = useState('');
  const [unitId, setUnitId] = useState(unitsOfMeasure[0]?.id ?? '');
  const [source, setSource] = useState<(typeof MEASUREMENT_SOURCES)[number]['value']>('HUMAN_READING');

  return (
    <form
      className="vds-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(`${base}/capture-measurement`, {
          payload: {
            metricCode: metricCode.trim(),
            quantity: { value: value.trim(), unitOfMeasureId: unitId },
            measurementSource: source,
          },
        });
      }}
    >
      <label htmlFor={`metric-${base}`}>Registrar medición</label>
      <input
        id={`metric-${base}`}
        className="vds-input"
        value={metricCode}
        onChange={(event) => setMetricCode(event.target.value)}
        placeholder="código de métrica"
      />
      <input
        className="vds-input vds-numeric"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="cantidad"
        inputMode="decimal"
      />
      <select className="vds-input" value={unitId} onChange={(event) => setUnitId(event.target.value)}>
        {unitsOfMeasure.map((u) => (
          <option key={u.id} value={u.id}>
            {u.code}
          </option>
        ))}
      </select>
      <select
        className="vds-input"
        value={source}
        onChange={(event) => setSource(event.target.value as (typeof MEASUREMENT_SOURCES)[number]['value'])}
      >
        {MEASUREMENT_SOURCES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="vds-button vds-button--secondary"
        disabled={metricCode.trim().length === 0 || value.trim().length === 0 || !unitId}
      >
        Registrar
      </button>
      <CommandOutcome state={action.state} />
    </form>
  );
}

function CloseUnitForm({ base, onChanged }: { readonly base: string; readonly onChanged: () => void }): JSX.Element {
  const action = useCommand(onChanged);
  const [result, setResult] = useState<(typeof CLOSE_RESULTS)[number]['value']>('COMPLETADA');
  const [reason, setReason] = useState('');
  const needsReason = result !== 'COMPLETADA';

  return (
    <form
      className="vds-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(`${base}/close`, {
          payload: { result, ...(reason.trim() ? { resultReason: reason.trim() } : {}) },
        });
      }}
    >
      <label htmlFor={`close-result-${base}`}>Cerrar unidad — resultado</label>
      <select
        id={`close-result-${base}`}
        className="vds-input"
        value={result}
        onChange={(event) => setResult(event.target.value as (typeof CLOSE_RESULTS)[number]['value'])}
      >
        {CLOSE_RESULTS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      {needsReason && (
        <input
          className="vds-input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Causa (obligatoria para este resultado, RUL-019)"
        />
      )}
      <button
        type="submit"
        className="vds-button vds-button--primary"
        disabled={needsReason && reason.trim().length < 3}
      >
        Cerrar UE
      </button>
      <CommandOutcome state={action.state} />
    </form>
  );
}

/**
 * Closing the Parte, once its units are resolved.
 *
 * Mirrors the evaluate-then-apply shape of Start Work (RGT-17: a green preview authorises nothing),
 * because closing is also a hard gate (RUL-034) and the operator deserves to see what is outstanding
 * before trying — the prototype's "9 pendientes" mixed counts; the GatePanel here does not.
 */
function PartCloseSection({
  partId,
  partState,
  units,
  onChanged,
}: {
  readonly partId: string;
  readonly partState: string;
  readonly units: readonly Record<string, unknown>[];
  readonly onChanged: () => void;
}): JSX.Element | null {
  const action = useCommand(onChanged);
  if (partState !== 'EN_EJECUCION' && partState !== 'SUSPENDIDO') return null;

  const openUnits = units.filter(
    (u) => !['CERRADA', 'NO_REALIZADA', 'ANULADA'].includes(u['state'] as string),
  ).length;

  return (
    <div className="vds-part-close">
      <h3>Cierre del Parte</h3>
      <p className="vds-note vds-numeric">{openUnits} unidad(es) sin resolver.</p>
      <div className="vds-unit__actions">
        <button
          type="button"
          className="vds-button vds-button--secondary"
          onClick={() => void action.preview(`/execution/parts/${partId}/close`)}
        >
          Evaluar cierre
        </button>
        <button
          type="button"
          className="vds-button vds-button--primary"
          onClick={() => void action.run(`/execution/parts/${partId}/close`)}
        >
          Cerrar Parte
        </button>
      </div>
      <CommandOutcome state={action.state} />
    </div>
  );
}
