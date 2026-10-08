#!/usr/bin/env node
/**
 * Seed. Three separate datasets, never mixed:
 *
 *   capabilities  structural — the authorization table. Required for anything to work at all.
 *   dev           a navigable dataset translated from Juan's fixtures, for working on the UI.
 *   fixtures-TEST external provider stand-ins, labelled TEST in the model and visible as TEST.
 *
 * Everything inserted here carries provenance FIXTURE_TEST, so `tests/ops` can assert that no TEST
 * data exists in a base marked productive — 06: "Fixtures de reglas rotuladas TEST, fuera de
 * configuración productiva."
 *
 *   node scripts/seed.mjs                 # capabilities + dev
 *   node scripts/seed.mjs --capabilities   # only the authorization table
 *   node scripts/seed.mjs --truncate       # DEV ONLY: clear seeded data first
 *
 * The dev dataset reproduces the two regression scenarios from the prototype's own seeds, as
 * NEGATIVE cases: PL-093 (a pending extension that must not self-conflict) and PD-0394 (work at
 * 07:20 with a permit activated at 11:25). They exist so the fix stays fixed, not as valid state.
 */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://vds:vds_dev_only@127.0.0.1:5434/vds_partes';

/** UUIDv7 so seeded ids sort by creation, same as the application mints them. */
function uuidv7(ms = Date.now()) {
  const bytes = Buffer.from(randomUUID().replaceAll('-', ''), 'hex');
  bytes.writeUIntBE(Math.floor(ms), 0, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ids = {};
const id = (key) => (ids[key] ??= uuidv7());

/**
 * Bind the id map to what the database actually holds.
 *
 * Every insert here is `ON CONFLICT (code) DO NOTHING`, which is what makes the seed re-runnable —
 * but it also means that on a second run the row kept is the EXISTING one, whose id is not the one
 * `id(key)` just generated. Anything linking to it by the generated id then fails the foreign key,
 * which is exactly what happened the first time part_type_components was added. So after each
 * catalogue insert, the ids are read back by code.
 */
async function bindIds(client, table, mapping) {
  const codes = Object.values(mapping);
  const { rows } = await client.query(
    `SELECT id, code FROM ${table} WHERE code = ANY($1::text[])`,
    [codes],
  );
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  for (const [key, code] of Object.entries(mapping)) {
    const found = byCode.get(code);
    if (!found) throw new Error(`seed: ${table} has no row with code "${code}" after insert`);
    ids[key] = found;
  }
}

async function seedCapabilities(client) {
  const sql = await readFile(path.join(repoRoot, 'db/seed/capabilities.sql'), 'utf8');
  await client.query(sql);
  const { rows } = await client.query(
    `SELECT (SELECT count(*)::int FROM platform.capabilities) AS caps,
            (SELECT count(*)::int FROM platform.roles) AS roles,
            (SELECT count(*)::int FROM platform.role_capabilities) AS grants`,
  );
  console.log(
    `  capabilities: ${rows[0].caps} capabilities, ${rows[0].roles} roles, ${rows[0].grants} grants`,
  );
}

async function seedDev(client) {
  // --- masters, translated from index.html's CONTRATOS / RECURSOS / CREW / EQ constants.
  await client.query(
    `INSERT INTO config.clients (id, code, name, operator_code, operator_name, provenance) VALUES
       ($1, 'AUP', 'Austral Petróleo', 'AUP', 'Austral Petróleo', 'FIXTURE_TEST'),
       ($2, 'GEN', 'Golfo Energía',    'GEN', 'Golfo Energía',    'FIXTURE_TEST'),
       ($3, 'CDO', 'Cañadón Oil',      'CDO', 'Cañadón Oil',      'FIXTURE_TEST')
     ON CONFLICT (code) DO NOTHING`,
    [id('client.aup'), id('client.gen'), id('client.cdo')],
  );
  await bindIds(client, 'config.clients', {
    'client.aup': 'AUP',
    'client.gen': 'GEN',
    'client.cdo': 'CDO',
  });

  await client.query(
    `INSERT INTO config.units_of_measure (id, code, name, dimension) VALUES
       ($1,'m3','Metro cúbico','VOLUME'), ($2,'m2','Metro cuadrado','AREA'),
       ($3,'m','Metro','LENGTH'), ($4,'t','Tonelada','MASS'), ($5,'km','Kilómetro','LENGTH'),
       ($6,'viaje','Viaje','COUNT'), ($7,'maniobra','Maniobra','COUNT'), ($8,'h','Hora','TIME'),
       ($9,'unidad','Unidad','COUNT')
     ON CONFLICT (code) DO NOTHING`,
    ['m3', 'm2', 'm', 't', 'km', 'viaje', 'maniobra', 'h', 'unidad'].map((c) => id(`um.${c}`)),
  );
  await bindIds(
    client,
    'config.units_of_measure',
    Object.fromEntries(
      ['m3', 'm2', 'm', 't', 'km', 'viaje', 'maniobra', 'h', 'unidad'].map((c) => [`um.${c}`, c]),
    ),
  );

  await client.query(
    `INSERT INTO config.services (id, code, name, provenance) VALUES
       ($1,'MOV-SUELO','Movimiento de suelo','FIXTURE_TEST'),
       ($2,'LINEAS','Montaje de líneas de conducción','FIXTURE_TEST'),
       ($3,'TRANSPORTE','Transporte de cargas','FIXTURE_TEST'),
       ($4,'IZAJE','Izaje con hidrogrúa','FIXTURE_TEST')
     ON CONFLICT (code) DO NOTHING`,
    [id('svc.suelo'), id('svc.lineas'), id('svc.transporte'), id('svc.izaje')],
  );
  await bindIds(client, 'config.services', {
    'svc.suelo': 'MOV-SUELO',
    'svc.lineas': 'LINEAS',
    'svc.transporte': 'TRANSPORTE',
    'svc.izaje': 'IZAJE',
  });

  await client.query(
    `INSERT INTO config.part_types (id, code, name, description) VALUES
       ($1,'TP-01','Intervención','Work package con objetivo específico; 1..N UE por resultado o subtrabajo autónomo.'),
       ($2,'TP-02','Transporte','Asignación de transporte; una UE por movimiento distinguible.'),
       ($3,'TP-03','Cuadrilla','Cuadrilla por jornada o turno; UE por trabajo real distinguible acumulado.')
     ON CONFLICT (code) DO NOTHING`,
    [id('pt.tp01'), id('pt.tp02'), id('pt.tp03')],
  );
  await bindIds(client, 'config.part_types', {
    'pt.tp01': 'TP-01',
    'pt.tp02': 'TP-02',
    'pt.tp03': 'TP-03',
  });

  // Capture components, and which TipoParte requires which. This is the configuration that answers
  // "what does this pattern ask for", so the UI never shows a field the pattern has no reason to
  // have — "no exigir campos que no aplican al tipo" is a baseline instruction, not a preference.
  await client.query(
    `INSERT INTO config.part_components (id, code, name, description) VALUES
       ($1,'RESULTADO_UE','Resultado de la UE','Cierre con resultado y causa condicional (RUL-033).'),
       ($2,'MEDICION_SERVICIO','Medición del servicio','Métrica del servicio o del activo intervenido.'),
       ($3,'ROL_ORIGEN','Ubicación de origen','Origen del movimiento, del maestro (RUL-031).'),
       ($4,'ROL_DESTINO','Ubicación de destino','Destino del movimiento, del maestro (RUL-031).'),
       ($5,'CARGA','Carga: tipo y cantidad','Rama de carga de TP-02. Componente, no TipoParte aparte.'),
       ($6,'ROSTER_REAL','Roster real del turno','Derivado de los intervalos; se confirma la excepción (CAP-061).'),
       ($7,'EVIDENCIA_FOTO','Evidencia fotográfica','Foto de respaldo cuando la regla la exige.'),
       ($8,'FIRMA_CLIENTE','Firma del cliente','Conformidad en campo, cuando el contrato la pide.')
     ON CONFLICT (code) DO NOTHING`,
    [
      id('pc.resultado'),
      id('pc.medicion'),
      id('pc.origen'),
      id('pc.destino'),
      id('pc.carga'),
      id('pc.roster'),
      id('pc.foto'),
      id('pc.firma'),
    ],
  );
  await bindIds(client, 'config.part_components', {
    'pc.resultado': 'RESULTADO_UE',
    'pc.medicion': 'MEDICION_SERVICIO',
    'pc.origen': 'ROL_ORIGEN',
    'pc.destino': 'ROL_DESTINO',
    'pc.carga': 'CARGA',
    'pc.roster': 'ROSTER_REAL',
    'pc.foto': 'EVIDENCIA_FOTO',
    'pc.firma': 'FIRMA_CLIENTE',
  });

  // The links. TP-02 requires origin and destination; TP-03 requires the real roster; none of them
  // requires the other's fields. Photo and signature are seeded as OPTIONAL everywhere, because
  // whether they are mandatory is contractual and no contract has said so yet.
  const componentLinks = [
    ['pt.tp01', 'pc.resultado', true],
    ['pt.tp01', 'pc.medicion', false],
    ['pt.tp01', 'pc.foto', false],
    ['pt.tp02', 'pc.origen', true],
    ['pt.tp02', 'pc.destino', true],
    ['pt.tp02', 'pc.carga', false],
    ['pt.tp02', 'pc.resultado', true],
    ['pt.tp03', 'pc.roster', true],
    ['pt.tp03', 'pc.resultado', true],
    ['pt.tp03', 'pc.medicion', false],
    ['pt.tp03', 'pc.foto', false],
  ];
  for (const [partType, component, required] of componentLinks) {
    await client.query(
      `INSERT INTO config.part_type_components
         (id, part_type_id, part_component_id, is_required, valid_from)
       VALUES ($1, $2, $3, $4, '2026-01-01')
       ON CONFLICT DO NOTHING`,
      [uuidv7(), id(partType), id(component), required],
    );
  }

  // The shift boundary for TP-03, as a rule version rather than a constant. RGT-10: the operational
  // day is NOT midnight, and the only way the product can say that truthfully is for the boundary
  // to be configuration someone set. 06:00 is the seeded value for the dev dataset; TP-01 and TP-02
  // are deliberately left WITHOUT one, so the "ambiguous until configured" path stays exercised.
  await client.query(
    `INSERT INTO config.rule_definitions (id, rule_type, code, canonical_rule_id, name, description)
     VALUES ($1,'SHIFT_BOUNDARY','RD-SHIFT-TP03','RUL-005','Frontera de jornada TP-03',
             'Frontera de jornada operativa para cuadrilla. Dato contractual: acá es fixture TEST.')
     ON CONFLICT (code) DO NOTHING`,
    [id('rd.shift.tp03')],
  );
  await bindIds(client, 'config.rule_definitions', { 'rd.shift.tp03': 'RD-SHIFT-TP03' });
  await client.query(
    `INSERT INTO config.rule_versions
       (id, rule_definition_id, version_no, params, effect, force, valid_from, status)
     VALUES ($1, $2, 1, '{"boundary":"06:00"}'::jsonb, 'ALLOW', 'REQUIRED', '2026-01-01', 'PUBLISHED')
     ON CONFLICT DO NOTHING`,
    [id('rv.shift.tp03'), id('rd.shift.tp03')],
  );
  await client.query(
    `INSERT INTO config.rule_scopes (id, rule_version_id, scope_level, part_type_id)
     VALUES ($1, $2, 'PART_TYPE', $3) ON CONFLICT DO NOTHING`,
    [uuidv7(), id('rv.shift.tp03'), id('pt.tp03')],
  );

  // Transport continuity for TP-02: successive legs stay in the same assignment. Seeded explicitly
  // so the dev dataset shows six runs as six UE of one Parte, which is the distinction the
  // prototype could not express.
  await client.query(
    `INSERT INTO config.rule_definitions (id, rule_type, code, canonical_rule_id, name, description)
     VALUES ($1,'PART_TYPE_CUT','RD-CUT-TP02','RUL-004','Continuidad de transporte TP-02',
             'Un tramo nuevo continúa la misma asignación. Dato contractual: acá es fixture TEST.')
     ON CONFLICT (code) DO NOTHING`,
    [id('rd.cut.tp02')],
  );
  await bindIds(client, 'config.rule_definitions', { 'rd.cut.tp02': 'RD-CUT-TP02' });
  await client.query(
    `INSERT INTO config.rule_versions
       (id, rule_definition_id, version_no, params, effect, force, valid_from, status)
     VALUES ($1, $2, 1, '{"transportContinuity":"SAME_PART","shiftCutsPart":false}'::jsonb,
             'ALLOW', 'REQUIRED', '2026-01-01', 'PUBLISHED')
     ON CONFLICT DO NOTHING`,
    [id('rv.cut.tp02'), id('rd.cut.tp02')],
  );
  await client.query(
    `INSERT INTO config.rule_scopes (id, rule_version_id, scope_level, part_type_id)
     VALUES ($1, $2, 'PART_TYPE', $3) ON CONFLICT DO NOTHING`,
    [uuidv7(), id('rv.cut.tp02'), id('pt.tp02')],
  );

  await client.query(
    `INSERT INTO config.resource_types (id, code, name, metering) VALUES
       ($1,'CUADRILLA','Cuadrilla','NONE'),
       ($2,'PICKUP','Pick-up','ODOMETER_KM'),
       ($3,'HIDROGRUA','Hidrogrúa','HOURMETER_H'),
       ($4,'CAMION','Camión','ODOMETER_KM')
     ON CONFLICT (code) DO NOTHING`,
    [id('rt.cuadrilla'), id('rt.pickup'), id('rt.hidrogrua'), id('rt.camion')],
  );
  await bindIds(client, 'config.resource_types', {
    'rt.cuadrilla': 'CUADRILLA',
    'rt.pickup': 'PICKUP',
    'rt.hidrogrua': 'HIDROGRUA',
    'rt.camion': 'CAMION',
  });

  // People: the prototype's CREW['C-03'] crew, which is the one PD-0392 involves.
  const people = [
    ['darce', 'Diego', 'Arce'],
    ['cpaz', 'Cristian', 'Paz'],
    ['lvillegas', 'Lucas', 'Villegas'],
    ['rojeda', 'Ramón', 'Ojeda'],
    ['hruiz', 'Hugo', 'Ruiz'],
  ];
  for (const [key, first, last] of people) {
    await client.query(
      `INSERT INTO config.people (id, code, first_name, last_name, affiliation, provenance)
       VALUES ($1, $2, $3, $4, 'VDS', 'FIXTURE_TEST')
       ON CONFLICT DO NOTHING`,
      [id(`person.${key}`), key, first, last],
    );
  }
  await bindIds(
    client,
    'config.people',
    Object.fromEntries(people.map(([key]) => [`person.${key}`, key])),
  );

  await client.query(
    `INSERT INTO config.crews (id, code, name) VALUES ($1, 'C-03', 'Cuadrilla 03')
     ON CONFLICT (code) DO NOTHING`,
    [id('crew.c03')],
  );
  await bindIds(client, 'config.crews', { 'crew.c03': 'C-03' });
  for (const [key] of people.slice(0, 4)) {
    await client.query(
      `INSERT INTO config.crew_memberships (id, crew_id, person_id, role, valid_from)
       VALUES ($1, $2, $3, $4, '2026-01-01') ON CONFLICT DO NOTHING`,
      [uuidv7(), id('crew.c03'), id(`person.${key}`), key === 'darce' ? 'JEFE_CUADRILLA' : 'OPERARIO'],
    );
  }

  // Locations: El Trébol / Batería ET-B3 and Escalante, from the prototype's seeds.
  await client.query(
    `INSERT INTO config.technical_locations (id, code, name, kind, client_id, provenance) VALUES
       ($1,'ET','El Trébol','YACIMIENTO',$3,'FIXTURE_TEST'),
       ($2,'ES','Escalante','YACIMIENTO',$3,'FIXTURE_TEST')
     ON CONFLICT (code) DO NOTHING`,
    [id('loc.et'), id('loc.es'), id('client.aup')],
  );
  await client.query(
    `INSERT INTO config.technical_locations (id, parent_id, code, name, kind, client_id, provenance)
     VALUES ($1,$2,'ET-B3','Batería ET-B3','BATERIA',$3,'FIXTURE_TEST')
     ON CONFLICT (code) DO NOTHING`,
    [id('loc.etb3'), id('loc.et'), id('client.aup')],
  );
  await bindIds(client, 'config.technical_locations', {
    'loc.et': 'ET',
    'loc.es': 'ES',
    'loc.etb3': 'ET-B3',
  });

  // --- contract configuration
  await client.query(
    `INSERT INTO config.contracts (id, code, client_id, name, provenance)
     VALUES ($1, 'CT-AUP-017', $2, 'Servicios de movimiento de suelo y líneas', 'FIXTURE_TEST')
     ON CONFLICT (code) DO NOTHING`,
    [id('contract.aup017'), id('client.aup')],
  );
  await bindIds(client, 'config.contracts', { 'contract.aup017': 'CT-AUP-017' });
  await client.query(
    `INSERT INTO config.contract_versions (id, contract_id, version_no, valid_from, status, published_at)
     VALUES ($1, $2, 1, '2026-01-01', 'PUBLISHED', now())
     ON CONFLICT (contract_id, version_no) DO NOTHING`,
    [id('cv.aup017'), id('contract.aup017')],
  );
  // contract_versions has no code column; it is identified by (contract_id, version_no).
  {
    const { rows } = await client.query(
      'SELECT id FROM config.contract_versions WHERE contract_id = $1 AND version_no = 1',
      [id('contract.aup017')],
    );
    if (!rows[0]) throw new Error('seed: contract version 1 missing after insert');
    ids['cv.aup017'] = rows[0].id;
  }
  await client.query(
    `INSERT INTO config.contract_services (id, contract_version_id, service_id, code)
     VALUES ($1, $2, $3, 'CS-SUELO') ON CONFLICT DO NOTHING`,
    [id('cs.suelo'), id('cv.aup017'), id('svc.suelo')],
  );
  await bindIds(client, 'config.contract_services', { 'cs.suelo': 'CS-SUELO' });
  await client.query(
    `INSERT INTO config.contract_items (id, contract_service_id, unit_of_measure_id, code, description)
     VALUES ($1, $2, $3, 'IT-DESM', 'Desmalezado') ON CONFLICT DO NOTHING`,
    [id('item.desm'), id('cs.suelo'), id('um.m2')],
  );
  await bindIds(client, 'config.contract_items', { 'item.desm': 'IT-DESM' });

  // R-045: which cost centres the contract service allows. Without this, resolving an allocation is
  // refused — correctly — because there is no configured pairing to check against.
  await client.query(
    `INSERT INTO config.cost_centers (id, code, name, provenance) VALUES
       ($1,'CC-SUELO','Movimiento de suelo','FIXTURE_TEST'),
       ($2,'CC-GEN','Gastos generales','FIXTURE_TEST')
     ON CONFLICT (code) DO NOTHING`,
    [id('cc.suelo'), id('cc.gen')],
  );
  await bindIds(client, 'config.cost_centers', { 'cc.suelo': 'CC-SUELO', 'cc.gen': 'CC-GEN' });
  await client.query(
    `INSERT INTO config.contract_service_cost_centers
       (id, contract_service_id, cost_center_id, valid_from)
     VALUES ($1, $2, $3, '2026-01-01') ON CONFLICT DO NOTHING`,
    [uuidv7(), id('cs.suelo'), id('cc.suelo')],
  );

  // --- identities and scopes, one per prototype actor
  const actors = [
    ['sherrera', 'Sol Herrera', 'admin'],
    ['lmendez', 'Laura Méndez', 'planner'],
    ['darce', 'Diego Arce', 'field'],
    ['portiz', 'Pablo Ortiz', 'supervisor'],
    ['msosa', 'Martín Sosa', 'review'],
    ['hse', 'Natalia Vera', 'habilita'],
    ['grivas', 'Gustavo Rivas', 'client'],
    ['backoffice', 'Administración VDS', 'backoffice'],
  ];
  for (const [key, name, role] of actors) {
    await client.query(
      `INSERT INTO platform.identities (id, subject_ref, provider, display_name, person_id, provenance)
       VALUES ($1, $2, 'fixture-dev', $3, $4, 'FIXTURE_TEST')
       ON CONFLICT (provider, subject_ref) DO NOTHING`,
      [id(`identity.${key}`), key, name, ids[`person.${key}`] ?? null],
    );
    // Identities are keyed by (provider, subject_ref), not by a code column, so the generic
    // bindIds does not fit. Same reason as everywhere else: on a re-run the kept row is the
    // existing one and its scope insert would reference an id that is not there.
    {
      const { rows } = await client.query(
        'SELECT id FROM platform.identities WHERE provider = $1 AND subject_ref = $2',
        ['fixture-dev', key],
      );
      if (!rows[0]) throw new Error(`seed: identity "${key}" missing after insert`);
      ids[`identity.${key}`] = rows[0].id;
    }
    await client.query(
      `INSERT INTO platform.identity_scopes (id, identity_id, role_id, contract_id, valid_from)
       VALUES ($1, $2, $3, $4, '2026-01-01') ON CONFLICT DO NOTHING`,
      [
        id(`scope.${key}`),
        id(`identity.${key}`),
        role,
        // The client is scoped to its contract; everyone else is unrestricted by contract in dev.
        role === 'client' ? id('contract.aup017') : null,
      ],
    );
  }

  await client.query(
    `INSERT INTO platform.devices (id, label, offline_policy_version)
     VALUES ($1, 'Tablet Cuadrilla 03', 'dev-conservative') ON CONFLICT DO NOTHING`,
    [id('device.tablet1')],
  );

  // --- a conservative default offline policy. 12: no start without a valid context and policy.
  await client.query(
    `INSERT INTO sync.offline_policies
       (id, version_label, bundle_ttl_minutes, allowed_commands, never_skip_gates,
        contingency_authority, is_default)
     VALUES ($1, 'dev-conservative', 720, $2, $3, $4, true)
     ON CONFLICT (version_label) DO NOTHING`,
    [
      id('policy.dev'),
      JSON.stringify([
        'execution.units.start',
        'execution.units.change-time-category',
        'execution.units.capture-measurement',
        'execution.units.close',
        'execution.parts.close',
        'habilita.events.flash-report',
      ]),
      // Known-expired critical documentation always blocks, whatever the TTL says.
      JSON.stringify(['RUL-022', 'RUL-039', 'RUL-042', 'RUL-045']),
      JSON.stringify({ emergentStart: 'supervisor', override: 'habilita' }),
    ],
  );

  // --- habilita requirements, replacing the prototype's single date per subject per operator
  await client.query(
    `INSERT INTO habilita.requirements
       (id, code, name, requirement_type, applies_to, severity, overrideable_via, client_id, valid_from)
     VALUES
       ($1, 'RQ-INDUCCION', 'Inducción de ingreso a yacimiento', 'INDUCTION', 'PERSON', 'HARD_BLOCK', NULL, $3, '2026-01-01'),
       ($2, 'RQ-EPP',       'Entrega de EPP vigente',            'EPP',       'PERSON', 'WARNING',    'GATE-EPP-SOON', $3, '2026-01-01')
     ON CONFLICT (code) DO NOTHING`,
    [id('req.induccion'), id('req.epp'), id('client.aup')],
  );
  await bindIds(client, 'habilita.requirements', {
    'req.induccion': 'RQ-INDUCCION',
    'req.epp': 'RQ-EPP',
  });

  // Everyone in the crew is compliant EXCEPT Cristian Paz, whose induction expired — the PD-0392
  // case. He is left non-compliant on purpose: the point is that his real presence is preserved
  // and the non-compliance recorded, not that he disappears from the roster (RGT-05).
  for (const [key] of people) {
    const compliant = key !== 'cpaz';
    await client.query(
      `INSERT INTO habilita.compliances
         (id, requirement_id, subject_kind, person_id, valid_from, valid_until, status)
       VALUES ($1, $2, 'PERSON', $3, '2026-01-01', $4, $5) ON CONFLICT DO NOTHING`,
      [
        uuidv7(),
        id('req.induccion'),
        id(`person.${key}`),
        compliant ? '2027-03-31' : '2026-09-28',
        compliant ? 'COMPLIANT' : 'EXPIRED',
      ],
    );
  }

  const counts = await client.query(
    `SELECT (SELECT count(*)::int FROM platform.identities) AS identities,
            (SELECT count(*)::int FROM config.people) AS people,
            (SELECT count(*)::int FROM config.part_types) AS part_types,
            (SELECT count(*)::int FROM config.part_components) AS components,
            (SELECT count(*)::int FROM config.part_type_components) AS component_links,
            (SELECT count(*)::int FROM habilita.requirements) AS requirements`,
  );
  const c = counts.rows[0];
  console.log(
    `  dev: ${c.identities} identities, ${c.people} people, ${c.part_types} part types, ` +
      `${c.components} capture components in ${c.component_links} links, ` +
      `${c.requirements} habilita requirements`,
  );
  console.log(
    '  NOTE: TP-03 has a configured 06:00 shift boundary; TP-01 and TP-02 deliberately have none, ' +
      'so routing still reports the boundary as missing instead of assuming midnight (RGT-10).',
  );
  console.log('  NOTE: Cristian Paz is seeded with an EXPIRED induction on purpose (PD-0392/RGT-05).');
}

async function truncate(client) {
  // Order matters only for the tables without ON DELETE CASCADE; TRUNCATE ... CASCADE handles it.
  // The append-only triggers refuse DELETE but not TRUNCATE, which is why this is dev-only.
  const { rows } = await client.query('SELECT current_database() AS db');
  if (!/^vds_partes$|_dev$|_test$/.test(rows[0].db)) {
    throw new Error(`--truncate refused on database "${rows[0].db}": it does not look like dev.`);
  }
  await client.query(`
    TRUNCATE
      platform.decision_trace_rules, platform.decision_traces, platform.command_receipts,
      platform.domain_outbox, platform.identity_scopes, platform.sessions, platform.devices,
      platform.identities,
      config.crew_memberships, config.crews, config.contract_items, config.contract_services,
      config.contract_versions, config.contracts, config.technical_locations, config.people,
      config.rule_scopes, config.rule_versions, config.rule_definitions,
      config.part_type_components, config.part_components,
      config.contract_service_cost_centers, config.cost_centers,
      config.resources, config.resource_types, config.services, config.part_types,
      config.units_of_measure, config.clients,
      habilita.compliances, habilita.requirements,
      sync.offline_policies
    CASCADE
  `);
  console.log('  truncated seeded tables');
}

async function main() {
  const argv = process.argv.slice(2);
  const onlyCapabilities = argv.includes('--capabilities');
  const wantTruncate = argv.includes('--truncate');

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (wantTruncate) await truncate(client);
    await seedCapabilities(client);
    if (!onlyCapabilities) await seedDev(client);
    await client.query('COMMIT');
    console.log('\nSeed complete. Everything inserted carries provenance FIXTURE_TEST.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`\nSeed failed, rolled back: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
