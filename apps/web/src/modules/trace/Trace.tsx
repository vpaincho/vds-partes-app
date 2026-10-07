/**
 * Trace — why the system decided what it decided.
 *
 * S0 §17 lists what must be explainable: what happened, who, when, which version, which rule, which
 * decision, which override, which datum changed and what the source was. This surface is that list,
 * queryable.
 *
 * Two things it shows that the prototype could not:
 *
 *  - **Refusals.** A BLOCK has a trace too (06), so a crew can see exactly why a start was refused and
 *    what the remedy is. `hist` in the prototype only recorded things that succeeded.
 *  - **The rules that lost.** Sheet 58 step 8 requires the discarded candidates with the reason, which
 *    is the only way a past conflict can be explained once configuration has moved on.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ApiError, fetchTrace, type TraceEntry } from '../../api/client.ts';

const SUBJECT_KINDS = [
  'UnidadEjecucion',
  'Parte',
  'AsignacionPlanificada',
  'DirectivaOperativa',
  'PermisoTrabajo',
  'EventoHabilita',
  'UnidadComercial',
] as const;

export interface TraceProps {
  /** Handed over by another surface, so "ver trazabilidad" lands on the subject it came from. */
  readonly subject?: { readonly kind: string; readonly id: string };
}

export function Trace({ subject }: TraceProps = {}): JSX.Element {
  const [subjectKind, setSubjectKind] = useState<string>(subject?.kind ?? 'UnidadEjecucion');
  const [subjectId, setSubjectId] = useState(subject?.id ?? '');
  const [entries, setEntries] = useState<readonly TraceEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = useCallback(async (kind: string, id: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fetchTrace(kind, id.trim());
      setEntries(result.data);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo consultar la traza.');
      setEntries(null);
    } finally {
      setBusy(false);
    }
  }, []);

  // Arriving with a subject means the question was already asked elsewhere; asking it again by hand
  // would be busywork.
  useEffect(() => {
    if (!subject) return;
    setSubjectKind(subject.kind);
    setSubjectId(subject.id);
    void lookup(subject.kind, subject.id);
  }, [subject, lookup]);

  return (
    <div className="vds-trace">
      <form
        className="vds-trace__form"
        onSubmit={(event) => {
          event.preventDefault();
          void lookup(subjectKind, subjectId);
        }}
      >
        <label htmlFor="trace-kind">Tipo de objeto</label>
        <select
          id="trace-kind"
          className="vds-input"
          value={subjectKind}
          onChange={(event) => setSubjectKind(event.target.value)}
        >
          {SUBJECT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>

        <label htmlFor="trace-id">Identificador</label>
        <input
          id="trace-id"
          className="vds-input vds-numeric"
          value={subjectId}
          onChange={(event) => setSubjectId(event.target.value)}
          placeholder="uuid del objeto"
          spellCheck={false}
          required
        />

        <button type="submit" className="vds-button vds-button--primary" disabled={busy}>
          {busy ? 'Buscando…' : 'Ver traza'}
        </button>
      </form>

      {error && <p className="vds-error">{error}</p>}

      {entries !== null && entries.length === 0 && (
        <p className="vds-empty">No hay decisiones registradas para ese objeto.</p>
      )}

      {entries !== null && entries.length > 0 && (
        <ol className="vds-trace__list">
          {entries.map((entry) => (
            <li key={entry.decisionId} className="vds-trace__entry" data-decision={entry.decision}>
              <header>
                <span className="vds-trace__decision" data-decision={entry.decision}>
                  {entry.decision}
                </span>
                <span className="vds-numeric">{entry.trigger}</span>
                {entry.preview && (
                  <span className="vds-chip" title="Evaluación previa: no autorizó nada">
                    preview
                  </span>
                )}
                <span className="vds-trace__when vds-numeric">
                  {new Date(entry.decidedAt).toLocaleString('es-AR')}
                </span>
              </header>

              <p className="vds-trace__who">
                {entry.actor ?? 'sistema'}
                {entry.currentState && (
                  <>
                    {' · '}
                    <span className="vds-numeric">
                      {entry.currentState}
                      {entry.targetState ? ` → ${entry.targetState}` : ' (sin transición)'}
                    </span>
                  </>
                )}
              </p>

              {entry.blocks.length > 0 && (
                <div className="vds-trace__blocks">
                  <h4>Bloqueos</h4>
                  <ul>
                    {entry.blocks.map((block, index) => (
                      <li key={`${block.ruleId}-${index}`}>
                        <span className="vds-numeric">{block.ruleId}</span> — {block.reason}
                        {block.instead && (
                          <div className="vds-trace__instead">Qué hacer: {block.instead}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {entry.warnings.length > 0 && (
                <div className="vds-trace__warnings">
                  <h4>Avisos</h4>
                  <ul>
                    {entry.warnings.map((warning, index) => (
                      <li key={`${warning.ruleId}-${index}`}>
                        <span className="vds-numeric">{warning.ruleId}</span> — {warning.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {entry.rules.length > 0 && (
                <details className="vds-trace__rules">
                  <summary>
                    Reglas evaluadas <span className="vds-numeric">({entry.rules.length})</span>
                  </summary>
                  <table className="vds-table" data-density="analysis">
                    <thead>
                      <tr>
                        <th scope="col">Regla</th>
                        <th scope="col">P</th>
                        <th scope="col">Resultado</th>
                        <th scope="col">Nota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.rules.map((rule, index) => (
                        <tr key={`${rule.ruleId}-${index}`} data-outcome={rule.outcome}>
                          <td className="vds-numeric">{rule.ruleId}</td>
                          <td className="vds-numeric">{rule.precedence}</td>
                          <td>{rule.outcome}</td>
                          {/* The reason a rule lost is the part that makes a past conflict explainable. */}
                          <td className="vds-trace__note">{rule.note ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
