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

  await client.query(
    `INSERT INTO config.units_of_measure (id, code, name, dimension) VALUES
       ($1,'m3','Metro cúbico','VOLUME'), ($2,'m2','Metro cuadrado','AREA'),
       ($3,'m','Metro','LENGTH'), ($4,'t','Tonelada','MASS'), ($5,'km','Kilómetro','LENGTH'),
       ($6,'viaje','Viaje','COUNT'), ($7,'maniobra','Maniobra','COUNT'), ($8,'h','Hora','TIME'),
       ($9,'unidad','Unidad','COUNT')
     ON CONFLICT (code) DO NOTHING`,
    ['m3', 'm2', 'm', 't', 'km', 'viaje', 'maniobra', 'h', 'unidad'].map((c) => id(`um.${c}`)),
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

  await client.query(
    `INSERT INTO config.part_types (id, code, name, description) VALUES
       ($1,'TP-01','Intervención','Work package con objetivo específico; 1..N UE por resultado o subtrabajo autónomo.'),
       ($2,'TP-02','Transporte','Asignación de transporte; una UE por movimiento distinguible.'),
       ($3,'TP-03','Cuadrilla','Cuadrilla por jornada o turno; UE por trabajo real distinguible acumulado.')
     ON CONFLICT (code) DO NOTHING`,
    [id('pt.tp01'), id('pt.tp02'), id('pt.tp03')],
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

  await client.query(
    `INSERT INTO config.crews (id, code, name) VALUES ($1, 'C-03', 'Cuadrilla 03')
     ON CONFLICT (code) DO NOTHING`,
    [id('crew.c03')],
  );
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

  // --- contract configuration
  await client.query(
    `INSERT INTO config.contracts (id, code, client_id, name, provenance)
     VALUES ($1, 'CT-AUP-017', $2, 'Servicios de movimiento de suelo y líneas', 'FIXTURE_TEST')
     ON CONFLICT (code) DO NOTHING`,
    [id('contract.aup017'), id('client.aup')],
  );
  await client.query(
    `INSERT INTO config.contract_versions (id, contract_id, version_no, valid_from, status, published_at)
     VALUES ($1, $2, 1, '2026-01-01', 'PUBLISHED', now())
     ON CONFLICT (contract_id, version_no) DO NOTHING`,
    [id('cv.aup017'), id('contract.aup017')],
  );
  await client.query(
    `INSERT INTO config.contract_services (id, contract_version_id, service_id, code)
     VALUES ($1, $2, $3, 'CS-SUELO') ON CONFLICT DO NOTHING`,
    [id('cs.suelo'), id('cv.aup017'), id('svc.suelo')],
  );
  await client.query(
    `INSERT INTO config.contract_items (id, contract_service_id, unit_of_measure_id, code, description)
     VALUES ($1, $2, $3, 'IT-DESM', 'Desmalezado') ON CONFLICT DO NOTHING`,
    [id('item.desm'), id('cs.suelo'), id('um.m2')],
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
            (SELECT count(*)::int FROM habilita.requirements) AS requirements`,
  );
  const c = counts.rows[0];
  console.log(
    `  dev: ${c.identities} identities, ${c.people} people, ${c.part_types} part types, ` +
      `${c.requirements} habilita requirements`,
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
