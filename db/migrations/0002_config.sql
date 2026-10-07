-- 0002 — Configuration Plane: masters, contract configuration, rules, TipoParte.
--
-- Covers logical entities 01..32 of sheet 42 (plus crew_memberships and
-- external_identity_map, which the physical model adds).
--
-- Two decisions worth reading before changing anything here:
--
--  * The nine RULE entities of sheet 42 (11, 14, 26-32) become three tables —
--    rule_definitions + rule_versions + rule_scopes — discriminated by rule_type. 04 forbids
--    both "87 tablas por conteo" and "resolver todo con JSONB": each logical rule keeps its
--    identity in rule_type and logical_entity_id, its parameters are validated per type, and
--    its versions and scopes are real rows with real foreign keys.
--
--  * CentroCosto is an independent dimension bridged to ContratoServicio, never a child of
--    Contrato (C-003, R-007, MR-06). The prototype carried a single `cc` per contract, which
--    is the semantic error C-003 exists to prevent.

-- ------------------------------------------------------------- external identity mapping

CREATE TABLE config.external_identity_map (
  id             uuid PRIMARY KEY,
  source_system  text NOT NULL,          -- 'vds-mysql', 'erp', ...
  entity_type    text NOT NULL,          -- 'person', 'resource', 'contract', ...
  external_id    text NOT NULL,
  internal_id    uuid NOT NULL,
  -- How the match was made, so a questionable link can be reviewed rather than trusted.
  match_method   text NOT NULL DEFAULT 'EXPLICIT',
  match_notes    text,
  source_version text,
  observed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_identity_unique UNIQUE (source_system, entity_type, external_id),
  CONSTRAINT external_identity_match_method
    CHECK (match_method IN ('EXPLICIT', 'CODE', 'DOCUMENT_ID', 'REVIEWED', 'PENDING_MAPPING'))
);

COMMENT ON TABLE config.external_identity_map IS
  'Canonical internal id <-> external master id. Unique per (source, entity, external_id) so one
   provider cannot claim the same external id twice. Never match people by name (04, audit §9).';

-- ------------------------------------------------------------------------- masters

CREATE TABLE config.clients (
  id          uuid PRIMARY KEY,
  code        text NOT NULL,
  name        text NOT NULL,
  -- Sheet 42 #01: "Separado de Operadora". The operator that authorises site entry is not
  -- necessarily the commercial counterparty.
  operator_code text,
  operator_name text,
  is_active   boolean NOT NULL DEFAULT true,
  provenance  platform.provenance_kind NOT NULL DEFAULT 'FIXTURE_TEST',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT clients_code_unique UNIQUE (code)
);

CREATE TABLE config.contracts (
  id          uuid PRIMARY KEY,
  code        text NOT NULL,
  client_id   uuid NOT NULL REFERENCES config.clients(id),   -- R-001: always belongs to a client
  contract_type text,
  name        text NOT NULL,
  provenance  platform.provenance_kind NOT NULL DEFAULT 'FIXTURE_TEST',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT contracts_code_unique UNIQUE (code)
);

-- R-002: a historical execution references the rules of a concrete version. Versions are never
-- deleted once used, and an addendum creates a new version rather than editing one.
CREATE TABLE config.contract_versions (
  id           uuid PRIMARY KEY,
  contract_id  uuid NOT NULL REFERENCES config.contracts(id),
  version_no   integer NOT NULL,
  valid_from   date NOT NULL,
  valid_until  date,
  status       text NOT NULL DEFAULT 'DRAFT',
  published_at timestamptz,
  published_by uuid REFERENCES platform.identities(id),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_versions_unique UNIQUE (contract_id, version_no),
  CONSTRAINT contract_versions_window CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT contract_versions_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED'))
);

CREATE TABLE config.services (
  id         uuid PRIMARY KEY,
  code       text NOT NULL,
  name       text NOT NULL,
  -- R-004: a service is reusable across contracts and is not duplicated per contract.
  is_active  boolean NOT NULL DEFAULT true,
  provenance platform.provenance_kind NOT NULL DEFAULT 'FIXTURE_TEST',
  created_at timestamptz NOT NULL DEFAULT now(),
  version    integer NOT NULL DEFAULT 1,
  CONSTRAINT services_code_unique UNIQUE (code)
);

CREATE TABLE config.activities (
  id         uuid PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES config.services(id),
  code       text NOT NULL,
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activities_code_unique UNIQUE (service_id, code)
);

CREATE TABLE config.cost_centers (
  id          uuid PRIMARY KEY,
  code        text NOT NULL,
  name        text NOT NULL,
  -- Owned by ERP/Administration. An independent economic dimension (C-003).
  valid_from  date,
  valid_until date,
  provenance  platform.provenance_kind NOT NULL DEFAULT 'EXTERNAL_MASTER',
  created_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT cost_centers_code_unique UNIQUE (code)
);

COMMENT ON TABLE config.cost_centers IS
  'C-003: an independent dimension, never a substitute for Contrato and never a rigid child of
   it. The prototype stored one cc per contract, which is the error this prevents.';

CREATE TABLE config.units_of_measure (
  id       uuid PRIMARY KEY,
  code     text NOT NULL,       -- m3, m2, m, t, km, viaje, maniobra, h, unidad
  name     text NOT NULL,
  -- Quantities are numeric(18,6) everywhere; this records what the number means.
  dimension text,
  CONSTRAINT units_code_unique UNIQUE (code)
);

CREATE TABLE config.operational_profiles (
  id         uuid PRIMARY KEY,
  code       text NOT NULL,
  name       text NOT NULL,
  -- Drives routing (RUL-001): the profile plus context derives TipoParte.
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_profiles_code_unique UNIQUE (code)
);

CREATE TABLE config.people (
  id          uuid PRIMARY KEY,
  code        text,
  first_name  text NOT NULL,
  last_name   text NOT NULL,
  document_id text,
  -- Sheet 42 #16 distinguishes VDS people from external ones; a client's staff is not VDS staff.
  affiliation text NOT NULL DEFAULT 'VDS',
  is_active   boolean NOT NULL DEFAULT true,
  provenance  platform.provenance_kind NOT NULL DEFAULT 'FIXTURE_TEST',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT people_affiliation CHECK (affiliation IN ('VDS', 'CLIENT', 'CONTRACTOR', 'OTHER'))
);

COMMENT ON COLUMN config.people.affiliation IS
  'Audit §9: do not mix client people with company people. Keeping this explicit stops an import
   from merging two populations that happen to share a name.';

ALTER TABLE platform.identities
  ADD CONSTRAINT identities_person_fk FOREIGN KEY (person_id) REFERENCES config.people(id);

-- R-010: a profile can change or expire, so the bridge is temporal.
CREATE TABLE config.person_profiles (
  id                     uuid PRIMARY KEY,
  person_id              uuid NOT NULL REFERENCES config.people(id),
  operational_profile_id uuid NOT NULL REFERENCES config.operational_profiles(id),
  valid_from             date NOT NULL,
  valid_until            date,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_profiles_window CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

CREATE INDEX person_profiles_lookup ON config.person_profiles (person_id, valid_from DESC);

CREATE TABLE config.resource_types (
  id         uuid PRIMARY KEY,
  code       text NOT NULL,
  name       text NOT NULL,
  -- Whether this type measures odometer km or engine hours. lastKm() in the prototype applied
  -- kilometres to every resource; sheet 42 and the audit both treat that as a type property.
  metering   text NOT NULL DEFAULT 'NONE',
  CONSTRAINT resource_types_code_unique UNIQUE (code),
  CONSTRAINT resource_types_metering CHECK (metering IN ('NONE', 'ODOMETER_KM', 'HOURMETER_H'))
);

CREATE TABLE config.resources (
  id               uuid PRIMARY KEY,
  resource_type_id uuid NOT NULL REFERENCES config.resource_types(id),
  code             text NOT NULL,
  name             text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  provenance       platform.provenance_kind NOT NULL DEFAULT 'FIXTURE_TEST',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT resources_code_unique UNIQUE (code)
);

COMMENT ON TABLE config.resources IS
  'R-011: the type classifies the resource; its role in an execution is a different relation
   entirely (AsignacionRecursoEjecucion). Operational availability lives in its own table.';

-- R-012: a hierarchy with no cycles, enforced in 0013.
CREATE TABLE config.technical_locations (
  id                 uuid PRIMARY KEY,
  parent_id          uuid REFERENCES config.technical_locations(id),
  code               text NOT NULL,
  name               text NOT NULL,
  kind               text,                -- yacimiento, batería, pozo, planta, playa...
  client_id          uuid REFERENCES config.clients(id),
  latitude           numeric(9, 6),
  longitude          numeric(9, 6),
  valid_from         date,
  valid_until        date,
  provenance         platform.provenance_kind NOT NULL DEFAULT 'FIXTURE_TEST',
  created_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT technical_locations_code_unique UNIQUE (code),
  CONSTRAINT technical_locations_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

-- R-013: an asset may move; it is not a VDS resource.
CREATE TABLE config.client_assets (
  id                    uuid PRIMARY KEY,
  technical_location_id uuid REFERENCES config.technical_locations(id),
  client_id             uuid NOT NULL REFERENCES config.clients(id),
  code                  text NOT NULL,
  name                  text NOT NULL,
  asset_kind            text,
  provenance            platform.provenance_kind NOT NULL DEFAULT 'FIXTURE_TEST',
  created_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  CONSTRAINT client_assets_code_unique UNIQUE (client_id, code)
);

-- MR-10 is still ABIERTO NO BLOQUEANTE: crew as master or as temporal composition. Resolved
-- here as CONFIG identity + temporal membership, with the real roster always derived from
-- execution.person_execution_assignments. A crew never substitutes for an assignment, which is
-- what MR-10 warns would duplicate AsignacionPersonaEjecucion.
CREATE TABLE config.crews (
  id         uuid PRIMARY KEY,
  code       text NOT NULL,
  name       text NOT NULL,
  base_id    uuid,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  version    integer NOT NULL DEFAULT 1,
  CONSTRAINT crews_code_unique UNIQUE (code)
);

COMMENT ON TABLE config.crews IS
  'MR-10 resolution: a stable group identity when one has operational value. The nominal
   membership below is planning input, NOT evidence of who actually worked. Real participation
   is always execution.person_execution_assignments (C-011).';

CREATE TABLE config.crew_memberships (
  id         uuid PRIMARY KEY,
  crew_id    uuid NOT NULL REFERENCES config.crews(id),
  person_id  uuid NOT NULL REFERENCES config.people(id),
  role       text,
  valid_from date NOT NULL,
  valid_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_memberships_window CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

CREATE INDEX crew_memberships_lookup ON config.crew_memberships (crew_id, valid_from DESC);

-- ------------------------------------------------------------- contract configuration

-- R-003/R-004: belongs to a contract version and points at a reusable service.
CREATE TABLE config.contract_services (
  id                  uuid PRIMARY KEY,
  contract_version_id uuid NOT NULL REFERENCES config.contract_versions(id),
  service_id          uuid NOT NULL REFERENCES config.services(id),
  code                text,
  notes               text,
  valid_from          date,
  valid_until         date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_services_unique UNIQUE (contract_version_id, service_id),
  CONSTRAINT contract_services_window CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

-- R-007: the CS <-> CC bridge. A cost centre can cross services and contexts.
CREATE TABLE config.contract_service_cost_centers (
  id                  uuid PRIMARY KEY,
  contract_service_id uuid NOT NULL REFERENCES config.contract_services(id),
  cost_center_id      uuid NOT NULL REFERENCES config.cost_centers(id),
  valid_from          date NOT NULL,
  valid_until         date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cs_cc_unique UNIQUE (contract_service_id, cost_center_id, valid_from),
  CONSTRAINT cs_cc_window CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

-- R-005/R-006: a measurable, certifiable contract position. The unit of measure is never free
-- text written by an execution.
CREATE TABLE config.contract_items (
  id                  uuid PRIMARY KEY,
  contract_service_id uuid NOT NULL REFERENCES config.contract_services(id),
  unit_of_measure_id  uuid NOT NULL REFERENCES config.units_of_measure(id),
  code                text NOT NULL,
  description         text NOT NULL,
  valid_from          date,
  valid_until         date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT contract_items_unique UNIQUE (contract_service_id, code),
  CONSTRAINT contract_items_window CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

-- ------------------------------------------------------------------- TipoParte registry

CREATE TABLE config.part_types (
  id          uuid PRIMARY KEY,
  code        text NOT NULL,          -- TP-01, TP-02, TP-03
  name        text NOT NULL,
  description text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT part_types_code_unique UNIQUE (code),
  -- FZ-03 froze the catalogue at three. A fourth needs Change Control (RF-01), so it cannot
  -- arrive as configuration.
  CONSTRAINT part_types_frozen_catalogue CHECK (code IN ('TP-01', 'TP-02', 'TP-03'))
);

COMMENT ON CONSTRAINT part_types_frozen_catalogue ON config.part_types IS
  'FZ-03 / RF-01: TP-01/02/03 absorb every known scenario. A new operational pattern must be
   demonstrated impossible to express before a TP-04 exists — not inserted as a row.';

CREATE TABLE config.part_components (
  id          uuid PRIMARY KEY,
  code        text NOT NULL,
  name        text NOT NULL,
  description text,
  CONSTRAINT part_components_code_unique UNIQUE (code)
);

-- R-009: TipoParte composes behaviour, not fixed columns.
CREATE TABLE config.part_type_components (
  id                uuid PRIMARY KEY,
  part_type_id      uuid NOT NULL REFERENCES config.part_types(id),
  part_component_id uuid NOT NULL REFERENCES config.part_components(id),
  is_required       boolean NOT NULL DEFAULT false,
  valid_from        date NOT NULL,
  valid_until       date,
  config            jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT part_type_components_unique
    UNIQUE (part_type_id, part_component_id, valid_from),
  CONSTRAINT part_type_components_window CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

-- ---------------------------------------------------------------------- rule registry

-- The nine RULE entities of sheet 42 keep their identity in rule_type. Each one is a real,
-- queryable kind — not a JSON blob and not nine near-identical tables.
CREATE TYPE config.rule_type AS ENUM (
  'MEASUREMENT_ITEM',          -- 11 ReglaMedicionItem
  'PART_TYPE_CUT',             -- 14 ReglaCorteTipoParte
  'TIME_TREATMENT',            -- 26 ReglaTratamientoTiempo
  'COMMERCIAL_UNIT_GRAIN',     -- 27 ReglaGranoUnidadComercial
  'CERTIFICATION_GROUPING',    -- 28 ReglaAgrupacionCertificacion
  'CERTIFICATION_PARTIALITY',  -- 29 ReglaParcialidadCertificacion
  'BILLING',                   -- 30 ReglaFacturacion
  'EMERGENT_START',            -- 31 ReglaInicioEmergente
  'HABILITA_ESCALATION',       -- 32 ReglaEscalamientoHabilita
  'OVERLAP',                   -- supports RUL-027: which roles are exclusive
  'SHIFT_BOUNDARY',            -- supports RGT-10: operational date / shift per context
  'READINESS',                 -- supports RUL-014/015
  'PTW_REQUIREMENT'            -- supports RUL-042
);

CREATE TABLE config.rule_definitions (
  id                uuid PRIMARY KEY,
  rule_type         config.rule_type NOT NULL,
  code              text NOT NULL,
  -- The canonical rule this configuration serves, e.g. 'RUL-027'. Keeps the link from a
  -- configured row back to the sheet 57 row that authorises it.
  canonical_rule_id text,
  -- The logical entity number from sheet 42 (11, 14, 26..32), so no logical identity is lost
  -- by sharing a table (04: "no perder identidad lógica de la regla").
  logical_entity_id text,
  name              text NOT NULL,
  description       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rule_definitions_code_unique UNIQUE (code)
);

COMMENT ON TABLE config.rule_definitions IS
  'Identity of a configurable rule. 04 forbids both one table per logical entity and a generic
   JSONB dump: rule_type discriminates, logical_entity_id preserves the sheet 42 identity, and
   params below are validated per type at the application boundary.';

CREATE TABLE config.rule_versions (
  id                 uuid PRIMARY KEY,
  rule_definition_id uuid NOT NULL REFERENCES config.rule_definitions(id),
  version_no         integer NOT NULL,
  -- Typed parameters, validated against a per-rule_type schema before insert. JSONB is used
  -- because the shape genuinely varies by rule type, never to avoid modelling a relation.
  params             jsonb NOT NULL,
  -- Resolved decision when the rule fires, so the engine does not parse prose at runtime.
  effect             text NOT NULL,
  force              text NOT NULL,
  -- Non-null only when this rule declares its own overrideable exception (RUL-041).
  overrideable_via   text,
  valid_from         timestamptz NOT NULL,
  valid_until        timestamptz,
  status             text NOT NULL DEFAULT 'DRAFT',
  published_at       timestamptz,
  published_by       uuid REFERENCES platform.identities(id),
  ruleset_version_id uuid REFERENCES platform.ruleset_versions(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rule_versions_unique UNIQUE (rule_definition_id, version_no),
  CONSTRAINT rule_versions_window CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT rule_versions_effect
    CHECK (effect IN ('ALLOW', 'BLOCK', 'WARN', 'REQUIRE_CONFIRMATION', 'DERIVE', 'NO_OP')),
  CONSTRAINT rule_versions_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED'))
);

COMMENT ON COLUMN config.rule_versions.valid_from IS
  'Sheet 58 step 2: a decision is evaluated with the version effective at the timestamp of the
   FACT, never with today''s configuration. This column is what makes AP-02 impossible.';

CREATE INDEX rule_versions_effective
  ON config.rule_versions (rule_definition_id, valid_from DESC)
  WHERE status = 'PUBLISHED';

-- Scope specificity (sheet 58 step 3): ITEM > CONTRACT_SERVICE > CLIENT > SERVICE > PART_TYPE
-- > GLOBAL. A rule version may be scoped several ways; the most specific match wins.
CREATE TABLE config.rule_scopes (
  id                  uuid PRIMARY KEY,
  rule_version_id     uuid NOT NULL REFERENCES config.rule_versions(id) ON DELETE CASCADE,
  scope_level         text NOT NULL,
  contract_item_id    uuid REFERENCES config.contract_items(id),
  contract_service_id uuid REFERENCES config.contract_services(id),
  client_id           uuid REFERENCES config.clients(id),
  service_id          uuid REFERENCES config.services(id),
  part_type_id        uuid REFERENCES config.part_types(id),
  CONSTRAINT rule_scopes_level CHECK (scope_level IN (
    'ITEM', 'CONTRACT_SERVICE', 'CLIENT', 'SERVICE', 'PART_TYPE', 'GLOBAL'
  )),
  -- The named level must carry its reference, and GLOBAL must carry none. Without this a row
  -- could claim ITEM specificity while pointing at nothing, and win on specificity by accident.
  CONSTRAINT rule_scopes_level_matches_reference CHECK (
    CASE scope_level
      WHEN 'ITEM'             THEN contract_item_id IS NOT NULL
      WHEN 'CONTRACT_SERVICE' THEN contract_service_id IS NOT NULL
      WHEN 'CLIENT'           THEN client_id IS NOT NULL
      WHEN 'SERVICE'          THEN service_id IS NOT NULL
      WHEN 'PART_TYPE'        THEN part_type_id IS NOT NULL
      WHEN 'GLOBAL'           THEN contract_item_id IS NULL AND contract_service_id IS NULL
                                   AND client_id IS NULL AND service_id IS NULL
                                   AND part_type_id IS NULL
    END
  )
);

CREATE INDEX rule_scopes_by_version ON config.rule_scopes (rule_version_id);
CREATE INDEX rule_scopes_by_item ON config.rule_scopes (contract_item_id)
  WHERE contract_item_id IS NOT NULL;
CREATE INDEX rule_scopes_by_contract_service ON config.rule_scopes (contract_service_id)
  WHERE contract_service_id IS NOT NULL;

-- ------------------------------------------------------------------ master data import

CREATE TABLE config.import_batches (
  id            uuid PRIMARY KEY,
  source_system text NOT NULL,
  entity_type   text NOT NULL,
  status        text NOT NULL DEFAULT 'STAGING',
  cut_at        timestamptz,
  rows_total    integer NOT NULL DEFAULT 0,
  rows_valid    integer NOT NULL DEFAULT 0,
  rows_rejected integer NOT NULL DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  published_by  uuid REFERENCES platform.identities(id),
  notes         text,
  CONSTRAINT import_batches_status
    CHECK (status IN ('STAGING', 'VALIDATED', 'PREVIEW', 'PUBLISHED', 'REJECTED'))
);

COMMENT ON TABLE config.import_batches IS
  'staging -> validation -> discrepancy preview -> publication by owner (14). An import never
   rewrites historical versions; it adds a snapshot with its own cut and provenance.';

CREATE TABLE config.import_staging_rows (
  id              uuid PRIMARY KEY,
  import_batch_id uuid NOT NULL REFERENCES config.import_batches(id) ON DELETE CASCADE,
  external_id     text,
  raw             jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING',
  -- Why a row could not be mapped. Unreliable catalogue data is marked pending, never
  -- silently completed (14, audit §9).
  rejection_reason text,
  mapped_internal_id uuid,
  CONSTRAINT import_staging_status
    CHECK (status IN ('PENDING', 'VALID', 'REJECTED', 'PENDING_MAPPING', 'PUBLISHED'))
);

CREATE INDEX import_staging_by_batch ON config.import_staging_rows (import_batch_id, status);
