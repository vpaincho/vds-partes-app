/**
 * Habilita documental — the matrix the prototype showed, as a read-only projection.
 *
 * 0003_habilita_prevent.sql is explicit that the matrix is a *view* over requirements/documents/
 * compliances, never the storage model. There is no `habilita.requirements.create` /
 * `.documents.upload` / `.compliances.record` command yet — so this surface shows what gates are
 * configured and who currently satisfies them, without pretending it can manage them from here.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import {
  ApiError,
  fetchHabilitaDocumentalMatrix,
  type HabilitaDocumentalMatrix,
  type HabilitaMatrixRow,
} from '../../api/client.ts';
import { StateBadge, type Tone } from '../../components/StateBadge.tsx';

function complianceTone(status: string): Tone {
  switch (status) {
    case 'COMPLIANT':
      return 'ok';
    case 'EXPIRED':
    case 'MISSING':
      return 'critical';
    case 'PENDING_VERIFICATION':
      return 'pending';
    case 'NOT_VERIFIABLE':
      return 'warn';
    default:
      return 'neutral';
  }
}

function severityTone(severity: string): Tone {
  if (severity === 'HARD_BLOCK') return 'critical';
  if (severity === 'WARNING') return 'warn';
  return 'neutral';
}

export function HabilitaDocumental(): JSX.Element {
  const [data, setData] = useState<HabilitaDocumentalMatrix | null>(null);
  const [meta, setMeta] = useState<{ source?: string; asOf?: string; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchHabilitaDocumentalMatrix();
      setData(result.data);
      setMeta(result.meta as { source?: string; asOf?: string; note?: string });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo cargar la matriz documental.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="vds-error">{error}</p>;
  if (!data) return <p className="vds-empty">Cargando matriz documental…</p>;

  return (
    <div className="vds-dashboard">
      <section className="vds-dashboard__section">
        <h2>Requisitos configurados</h2>
        <table className="vds-table" data-density="operations">
          <thead>
            <tr>
              <th scope="col">Código</th>
              <th scope="col">Nombre</th>
              <th scope="col">Aplica a</th>
              <th scope="col">Severidad</th>
              <th scope="col">Alcance</th>
            </tr>
          </thead>
          <tbody>
            {data.requirements.length === 0 && (
              <tr>
                <td colSpan={5} className="vds-empty">
                  Sin requisitos configurados.
                </td>
              </tr>
            )}
            {data.requirements.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.name}</td>
                <td>{r.applies_to}</td>
                <td>
                  <StateBadge dimension="habilita" label="Severidad" state={r.severity} tone={severityTone(r.severity)} />
                </td>
                <td className="vds-table__sub">{[r.client_name, r.service_name].filter(Boolean).join(' · ') || 'General'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="vds-dashboard__section">
        <h2>Cumplimiento — personas</h2>
        <ComplianceMatrix
          rows={data.personMatrix}
          subjectLabel={(row) => {
            const r = row as (typeof data.personMatrix)[number];
            return `${r.last_name}, ${r.first_name}${r.person_code ? ` (${r.person_code})` : ''}`;
          }}
        />
      </section>

      <section className="vds-dashboard__section">
        <h2>Cumplimiento — recursos</h2>
        <ComplianceMatrix
          rows={data.resourceMatrix}
          subjectLabel={(row) => {
            const r = row as (typeof data.resourceMatrix)[number];
            return `${r.resource_name} (${r.resource_code})`;
          }}
        />
      </section>

      <section className="vds-dashboard__section">
        <h2>Documentos recientes</h2>
        <table className="vds-table" data-density="operations">
          <thead>
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Sujeto</th>
              <th scope="col">Vigencia</th>
              <th scope="col">Emisor</th>
              <th scope="col">Procedencia</th>
            </tr>
          </thead>
          <tbody>
            {data.recentDocuments.length === 0 && (
              <tr>
                <td colSpan={5} className="vds-empty">
                  Sin documentos.
                </td>
              </tr>
            )}
            {data.recentDocuments.map((d) => (
              <tr key={d.id}>
                <td>{d.document_type}</td>
                <td>
                  {d.subject_kind === 'PERSON' ? `${d.last_name}, ${d.first_name}` : d.resource_code}
                </td>
                <td className="vds-numeric">
                  {d.valid_from} → {d.valid_until ?? '—'}
                </td>
                <td>{d.issuer ?? '—'}</td>
                <td className="vds-table__sub">{d.provenance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {meta?.note && <p className="vds-note">{meta.note}</p>}
      <p className="vds-asof vds-numeric">{meta?.source ?? '—'}</p>
    </div>
  );
}

function ComplianceMatrix<T extends HabilitaMatrixRow>({
  rows,
  subjectLabel,
}: {
  readonly rows: readonly T[];
  readonly subjectLabel: (row: T) => string;
}): JSX.Element {
  return (
    <table className="vds-table" data-density="operations">
      <thead>
        <tr>
          <th scope="col">Sujeto</th>
          <th scope="col">Requisito</th>
          <th scope="col">Estado</th>
          <th scope="col">Vigencia</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={4} className="vds-empty">
              Sin datos.
            </td>
          </tr>
        )}
        {rows.map((row) => (
          <tr key={`${subjectLabel(row)}-${row.requirement_id}`}>
            <td>{subjectLabel(row)}</td>
            <td>{row.requirement_code}</td>
            <td>
              <StateBadge dimension="habilita" label="Cumplimiento" state={row.status} tone={complianceTone(row.status)} />
            </td>
            <td className="vds-numeric">
              {row.valid_from} → {row.valid_until ?? '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
