# REFERENCE ONLY — canonical extracts

JSON files retain sheet names, actual Excel row numbers and all non-empty values. Header position varies by sheet: do not assume row 4 for every JSON. Original XLSX remains authority.

- `entity_implementation_map.csv`: 87 logical entities → proposed storage/owner; no final DDL.
- `rule_test_map.csv`: all 74 rules → proposed owner/layers + canonical GS links. Rules without GS links still require independent positive/negative tests.
- `golden_test_map.csv`: all 56 scenarios → proposed test layers/file; SPEC_NOT_RUN.
- `golden_acceptance.md`: all canonical scenario columns including explicit non-events.
- JSON 43/44/49–56/58/63: complete relations, constraints, state transitions, precedence and engine contract.

The maps are planning proposals P, not new functional rules. See 04/17 before using them. Old TP details and flags are contextual; final machines/rules prevail. No spreadsheet was edited.

## Added in W0 — hallazgo H-01 / contradicción CC-02

The pack cited sheets as authority that it had not extracted. `03_TARGET_ARCHITECTURE.md`
and `14_DATA_INTEGRATION_ADAPTERS.md` both reference "S2 36", and sheet 36 holds the
functional contracts between domains — Interfaces A and B. Planning the target
architecture without it would have meant reconstructing those contracts by inference.
These nine sheets were extracted with `scripts/extract-canonical.py`, in the same format,
and added to `reference_manifest.json: extracted_sheets` (25 → 34). The workbook was not
modified; its hash still verifies (`npm run verify:sources`).

- `36_Contratos_Funcionales_REV_E`: **FC-01…FC-14** — Interface A (Planificación→Ejecución),
  Execution Context Bundle, Control Plane, Habilita Prevent→Start Work, TipoParte→Ejecución,
  Habilita Event Bus, Escalation, Interface B (Ejecución→Certificación), derivación comercial,
  Enmienda→downstream, supersession, Certificación→Facturación, Notificación, Caso/Acciones.
  Each row states what the producer must deliver, what the consumer **may assume** and what it
  **may not** — the authority for module ownership and for every cross-module contract.
- `39_Gates_REV_E_Final`: G-01…G-05, the gates resolved as `RESUELTO DEFAULT / REABRIBLE`.
  These are the provenance of the B-01…B-09 defaults in sheet 41: useful when deciding whether
  a question is configuration or a reopening of the freeze.
- `45_Hallazgos_Modelo_Relacional`: MR-01…MR-12, the normalisation findings that justify the
  N:M bridges. **MR-10 (Cuadrilla: master or temporal composition) is still
  `ABIERTO NO BLOQUEANTE`** and is tracked as CC-05 in the build plan.
- `46_ERD_Logico_Core`, `47_Nomenclatura_Habilita`: core ERD layout and Habilita naming.
- `59_Reglas_Planificacion`, `60_Reglas_Ejecucion`, `61_Reglas_Habilita_Control`,
  `62_Reglas_Cert_Fact`: per-domain rule detail.

**Verified when extracting:** sheets 59–62 reference exactly the 74 ids `RUL-001…RUL-074`
and introduce **no rule beyond** them. Sheet 57 is therefore the complete rule set and 59–62
are per-domain views of the same rules, not an additional source of rules. Re-check with
`python scripts/extract-canonical.py --check` (must report no differences).
