/**
 * Configuración — a read-only masters browser.
 *
 * There is no `config.publish` / `config.import` yet: masters are seeded via `scripts/seed.mjs`,
 * which is the explicit PENDING_CONFIGURATION stance (CLAUDE.md), not a workaround. This surface
 * exists so a `config.read` holder can actually see what that seed produced, instead of the shell
 * showing nothing at all for this nav entry.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ApiError, fetchConfigMasters, type ConfigMasters, type ConfigNamedRow } from '../../api/client.ts';

export function Config(): JSX.Element {
  const [data, setData] = useState<ConfigMasters | null>(null);
  const [meta, setMeta] = useState<{ source?: string; asOf?: string; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchConfigMasters();
      setData(result.data);
      setMeta(result.meta as { source?: string; asOf?: string; note?: string });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudieron cargar los maestros.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="vds-error">{error}</p>;
  if (!data) return <p className="vds-empty">Cargando maestros…</p>;

  return (
    <div className="vds-dashboard">
      <section className="vds-dashboard__section">
        <h2>Contratos</h2>
        <table className="vds-table" data-density="operations">
          <thead>
            <tr>
              <th scope="col">Cliente</th>
              <th scope="col">Contrato</th>
              <th scope="col">Versiones</th>
              <th scope="col">Versión publicada</th>
            </tr>
          </thead>
          <tbody>
            {data.contracts.length === 0 && (
              <tr>
                <td colSpan={4} className="vds-empty">
                  Sin contratos.
                </td>
              </tr>
            )}
            {data.contracts.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.client_name} <span className="vds-table__sub">{c.client_code}</span>
                </td>
                <td>
                  {c.name} <span className="vds-table__sub">{c.code}</span>
                </td>
                <td className="vds-numeric">{c.version_count}</td>
                <td className="vds-numeric">{c.published_version_no ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <MasterTable title="Servicios" rows={data.services} columns={[['code', 'Código'], ['name', 'Nombre']]} />
      <MasterTable
        title="Tipos de Parte"
        rows={data.partTypes}
        columns={[
          ['code', 'Código'],
          ['name', 'Nombre'],
          ['description', 'Descripción'],
        ]}
      />
      <MasterTable
        title="Unidades de medida"
        rows={data.unitsOfMeasure}
        columns={[
          ['code', 'Código'],
          ['name', 'Nombre'],
          ['dimension', 'Dimensión'],
        ]}
      />
      <MasterTable
        title="Tipos de recurso"
        rows={data.resourceTypes}
        columns={[
          ['code', 'Código'],
          ['name', 'Nombre'],
          ['metering', 'Medición'],
        ]}
      />
      <MasterTable
        title="Locaciones técnicas"
        rows={data.technicalLocations}
        columns={[
          ['code', 'Código'],
          ['name', 'Nombre'],
          ['kind', 'Tipo'],
          ['client_name', 'Cliente'],
        ]}
      />
      <MasterTable
        title="Cuadrillas"
        rows={data.crews}
        columns={[
          ['code', 'Código'],
          ['name', 'Nombre'],
          ['active_members', 'Integrantes activos'],
        ]}
      />
      <MasterTable
        title="Personas"
        rows={data.people}
        columns={[
          ['code', 'Código'],
          ['first_name', 'Nombre'],
          ['last_name', 'Apellido'],
          ['affiliation', 'Afiliación'],
          ['is_active', 'Activo'],
        ]}
      />
      <MasterTable
        title="Recursos"
        rows={data.resources}
        columns={[
          ['code', 'Código'],
          ['name', 'Nombre'],
          ['resource_type', 'Tipo'],
          ['is_active', 'Activo'],
        ]}
      />

      {meta?.note && <p className="vds-note">{meta.note}</p>}
      <p className="vds-asof vds-numeric">{meta?.source ?? '—'}</p>
    </div>
  );
}

function MasterTable({
  title,
  rows,
  columns,
}: {
  readonly title: string;
  readonly rows: readonly ConfigNamedRow[];
  readonly columns: readonly [string, string][];
}): JSX.Element {
  return (
    <section className="vds-dashboard__section">
      <h2>{title}</h2>
      <table className="vds-table" data-density="operations">
        <thead>
          <tr>
            {columns.map(([key, label]) => (
              <th key={key} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="vds-empty">
                Sin datos.
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map(([key]) => (
                <td key={key}>{formatCell(row[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return String(value);
}
