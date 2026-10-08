/**
 * Billing boundary: lines, lots, and the ERP fixture. No invoice is calculated here (C-035/MR-11)
 * — the internal model ends at `LoteFacturacion`; the fiscal document belongs to the ERP, and
 * `billing.external_document_refs` only ever holds a reference to it.
 *
 * Two things this module is careful about:
 *
 *  - **RUL-070**: a line may only come from a commercial unit that is both `ACEPTADA` and
 *    currently `VIGENTE` (not `supersession_state`-flagged). An amended source sets
 *    `REQUIERE_RECALCULO` elsewhere (RUL-065); this module simply refuses to build from it.
 *  - **The attempt is durable before the side effect** (03_TARGET_ARCHITECTURE): the
 *    `erp_submission_attempts` row is written and committed-in-this-transaction before
 *    `ErpPort.submit` is even called, and `ACCEPTED`/`ERROR`/`UNKNOWN` are three real, distinct
 *    outcomes — an HTTP 200 from the fixture is not fiscal issuance, and UNKNOWN is never
 *    collapsed into either success or failure.
 */
import { DomainError, uuidv7, type Uuid } from '@vds/kernel';
import { createHash } from 'node:crypto';
import type { BuildBillableLinesInput, CreateBillingLotInput } from '@vds/contracts';
import { registerHandler, type CommandHandler } from '../platform/pipeline.ts';
import type { Db } from '../platform/db.ts';
import { stateTransition } from './evaluators.ts';
import { requireSubjectId } from './execution-shared.ts';
import { getProviders } from '../platform/providers.ts';

interface LotRow {
  id: Uuid;
  state: string;
  version: number;
  code: string | null;
  client_id: Uuid;
}

async function loadLot(db: Db, lotId: string): Promise<LotRow> {
  const row = await db.one<LotRow>(
    'SELECT id, state::text AS state, version, code, client_id FROM billing.billing_lots WHERE id = $1',
    [lotId],
  );
  if (!row) throw new DomainError({ code: 'NOT_FOUND', message: `No existe el LoteFacturacion ${lotId}.` });
  return row;
}

/* -------------------------------------------------------------------- billing.lines.build */

const buildLines: CommandHandler<BuildBillableLinesInput> = {
  name: 'billing.lines.build',

  async resolveScope() {
    return { subject: { kind: 'LineaFacturable', id: null }, scope: {} };
  },

  async evaluators({ db, payload }) {
    const subject = { kind: 'LineaFacturable', id: null };
    return [
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'billing/build-lines',
        evaluate: async () => {
          const { rows } = await db.query<{
            id: Uuid;
            state: string;
            supersession_state: string;
            quantity: string | null;
            unit_of_measure_id: Uuid;
            contract_item_id: Uuid;
          }>(
            `SELECT id, state::text AS state, supersession_state::text AS supersession_state,
                    quantity, unit_of_measure_id, contract_item_id
             FROM commercial.commercial_units WHERE id = ANY($1::uuid[])`,
            [payload.commercialUnitIds],
          );
          const found = new Map(rows.map((r) => [r.id, r]));
          const blocks = [];
          for (const id of payload.commercialUnitIds) {
            const unit = found.get(id as Uuid);
            if (!unit) {
              blocks.push({
                ruleId: 'RUL-070',
                precedence: 'P5' as const,
                reason: `La UnidadComercial ${id} no existe.`,
                instead: 'Verificar el identificador.',
                subject,
                overrideable: false,
              });
              continue;
            }
            if (unit.state !== 'ACEPTADA' || unit.supersession_state !== 'VIGENTE') {
              blocks.push({
                ruleId: 'RUL-070',
                precedence: 'P5' as const,
                reason: `La UC ${id} esta ${unit.state}/${unit.supersession_state}: solo ACEPTADA+VIGENTE produce linea.`,
                instead:
                  unit.supersession_state !== 'VIGENTE'
                    ? 'Esta UC requiere recalculo por una enmienda posterior; resolverlo antes de facturar.'
                    : 'Aceptar la UC antes de construir la linea.',
                subject,
                overrideable: false,
              });
            }
          }
          if (blocks.length > 0) return { blocks };
          return {
            effects: [
              {
                kind: 'BUILD_BILLABLE_LINES',
                description: 'Construir una linea por UC ACEPTADA y VIGENTE.',
                ruleId: 'RUL-070',
              },
            ],
          };
        },
      },
    ];
  },

  async apply({ db, payload }) {
    const { rows: units } = await db.query<{
      id: Uuid;
      quantity: string;
      unit_of_measure_id: Uuid;
      contract_item_id: Uuid;
    }>(
      'SELECT id, quantity, unit_of_measure_id, contract_item_id FROM commercial.commercial_units WHERE id = ANY($1::uuid[])',
      [payload.commercialUnitIds],
    );
    const lineIds: Uuid[] = [];
    for (const unit of units) {
      const lineId = uuidv7();
      await db.query(
        `INSERT INTO billing.billable_lines
           (id, commercial_unit_id, quantity, unit_of_measure_id, contract_item_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [lineId, unit.id, unit.quantity, unit.unit_of_measure_id, unit.contract_item_id],
      );
      lineIds.push(lineId);
    }
    return {
      subject: { kind: 'LineaFacturable', id: lineIds[0] ?? null },
      version: 1,
      effects: [
        {
          kind: 'BILLABLE_LINES_BUILT',
          subjectKind: 'LineaFacturable',
          subjectId: lineIds[0] ?? null,
          detail: { lineIds },
        },
      ],
    };
  },
};

/* --------------------------------------------------------------------- billing.lots.create */

const createLot: CommandHandler<CreateBillingLotInput> = {
  name: 'billing.lots.create',

  async resolveScope() {
    return { subject: { kind: 'LoteFacturacion', id: null }, scope: {} };
  },

  async evaluators({ db, payload }) {
    const subject = { kind: 'LoteFacturacion', id: null };
    return [
      stateTransition({
        machine: 'LoteFacturacion',
        event: 'CREAR_LOTE',
        subject,
        effects: [{ kind: 'CREATE_BILLING_LOT', description: 'Agrupar lineas en un lote (C-035).', ruleId: 'RUL-071' }],
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'billing/create-lot',
        evaluate: async () => {
          const { rows } = await db.query<{ id: Uuid; billing_lot_id: Uuid | null; invalidated_at: Date | null }>(
            'SELECT id, billing_lot_id, invalidated_at FROM billing.billable_lines WHERE id = ANY($1::uuid[])',
            [payload.billableLineIds],
          );
          const found = new Map(rows.map((r) => [r.id, r]));
          const blocks = [];
          for (const id of payload.billableLineIds) {
            const line = found.get(id as Uuid);
            if (!line || line.billing_lot_id !== null || line.invalidated_at !== null) {
              blocks.push({
                ruleId: 'RUL-071',
                precedence: 'P5' as const,
                reason: !line
                  ? `La linea ${id} no existe.`
                  : line.billing_lot_id !== null
                    ? `La linea ${id} ya pertenece a otro lote.`
                    : `La linea ${id} esta invalidada.`,
                instead: 'Elegir lineas sin lote y no invalidadas.',
                subject,
                overrideable: false,
              });
            }
          }
          if (blocks.length > 0) return { blocks };
          return {};
        },
      },
    ];
  },

  async apply({ db, payload }) {
    const lotId = uuidv7();
    const code = `LF-${lotId.slice(0, 8)}`;
    await db.query(
      `INSERT INTO billing.billing_lots (id, code, contract_id, client_id, state)
       VALUES ($1, $2, $3, $4, 'BORRADOR')`,
      [lotId, code, payload.contractId ?? null, payload.clientId],
    );
    await db.query('UPDATE billing.billable_lines SET billing_lot_id = $2 WHERE id = ANY($1::uuid[])', [
      payload.billableLineIds,
      lotId,
    ]);
    return {
      subject: { kind: 'LoteFacturacion', id: lotId, code },
      version: 1,
      effects: [{ kind: 'BILLING_LOT_CREATED', subjectKind: 'LoteFacturacion', subjectId: lotId }],
    };
  },
};

/* ------------------------------------------------------------------- billing.lots.validate */

const validateLot: CommandHandler<Record<string, never>> = {
  name: 'billing.lots.validate',

  async resolveScope({ db, subjectId }) {
    const lot = await loadLot(db, requireSubjectId(subjectId, 'LoteFacturacion'));
    return { subject: { kind: 'LoteFacturacion', id: lot.id }, scope: {}, currentVersion: lot.version, currentState: lot.state };
  },

  async evaluators({ db, subjectId, currentState }) {
    const lotId = requireSubjectId(subjectId, 'LoteFacturacion');
    const subject = { kind: 'LoteFacturacion', id: lotId };
    return [
      stateTransition({
        machine: 'LoteFacturacion',
        event: 'VALIDAR',
        ...(currentState ? { currentState } : {}),
        subject,
        effects: [{ kind: 'VALIDATE_LOT', description: 'BORRADOR -> VALIDADO.', ruleId: 'RUL-071' }],
      }),
      {
        stage: 'S7_OPERATION',
        precedence: 'P5',
        owner: 'billing/validate-lot',
        evaluate: async () => {
          const count = await db.one<{ n: string }>(
            "SELECT count(*)::text AS n FROM billing.billable_lines WHERE billing_lot_id = $1 AND invalidated_at IS NULL",
            [lotId],
          );
          if (Number(count?.n ?? '0') === 0) {
            return {
              blocks: [
                {
                  ruleId: 'RUL-071',
                  precedence: 'P5' as const,
                  reason: 'El lote no tiene lineas vigentes.',
                  instead: 'Un lote vacio no se valida.',
                  subject,
                  overrideable: false,
                },
              ],
            };
          }
          return {};
        },
      },
    ];
  },

  async apply({ db, subjectId, occurredAt }) {
    const lotId = requireSubjectId(subjectId, 'LoteFacturacion');
    const lot = await loadLot(db, lotId);
    await db.query(
      `UPDATE billing.billing_lots SET state = 'VALIDADO', validated_at = $2, updated_at = $2, version = version + 1
       WHERE id = $1`,
      [lotId, occurredAt],
    );
    return {
      subject: { kind: 'LoteFacturacion', id: lotId },
      version: lot.version + 1,
      effects: [{ kind: 'BILLING_LOT_VALIDATED', subjectKind: 'LoteFacturacion', subjectId: lotId }],
    };
  },
};

/* ----------------------------------------------------------------------- billing.lots.send */

const sendLot: CommandHandler<Record<string, never>> = {
  name: 'billing.lots.send',

  async resolveScope({ db, subjectId }) {
    const lot = await loadLot(db, requireSubjectId(subjectId, 'LoteFacturacion'));
    return { subject: { kind: 'LoteFacturacion', id: lot.id }, scope: {}, currentVersion: lot.version, currentState: lot.state };
  },

  async evaluators({ subjectId, currentState }) {
    const lotId = requireSubjectId(subjectId, 'LoteFacturacion');
    return [
      stateTransition({
        machine: 'LoteFacturacion',
        event: 'ENVIAR_ERP',
        ...(currentState ? { currentState } : {}),
        subject: { kind: 'LoteFacturacion', id: lotId },
        effects: [
          {
            kind: 'SEND_LOT_TO_ERP',
            description: 'Registrar el intento ANTES de llamar al adapter (RUL-072).',
            ruleId: 'RUL-072',
          },
        ],
      }),
    ];
  },

  async apply({ db, subjectId, occurredAt }) {
    const lotId = requireSubjectId(subjectId, 'LoteFacturacion');
    const lot = await loadLot(db, lotId);

    const { rows: lines } = await db.query<{
      id: Uuid;
      quantity: string;
      contract_item_code: string;
      unit_code: string;
    }>(
      `SELECT bl.id, bl.quantity, ci.code AS contract_item_code, um.code AS unit_code
       FROM billing.billable_lines bl
       JOIN config.contract_items ci ON ci.id = bl.contract_item_id
       JOIN config.units_of_measure um ON um.id = bl.unit_of_measure_id
       WHERE bl.billing_lot_id = $1 AND bl.invalidated_at IS NULL`,
      [lotId],
    );

    const idempotencyKey = uuidv7();
    const payload = {
      idempotencyKey,
      lotCode: lot.code ?? lotId,
      clientExternalId: lot.client_id,
      lines: lines.map((l) => ({
        itemCode: l.contract_item_code,
        quantity: l.quantity,
        unitCode: l.unit_code,
        reference: l.id,
      })),
    };
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    // Durable intent, written and committed-in-this-transaction BEFORE the external call
    // (03_TARGET_ARCHITECTURE: "registrar intento durable antes del side effect externo").
    const attemptId = uuidv7();
    await db.query(
      `INSERT INTO billing.erp_submission_attempts
         (id, billing_lot_id, attempt_no, payload, payload_hash, idempotency_key, provider_kind, status)
       VALUES ($1, $2, 1, $3, $4, $5, 'TEST_FIXTURE', 'PENDING')`,
      [attemptId, lotId, JSON.stringify(payload), payloadHash, idempotencyKey],
    );

    const result = await getProviders().erp.submit(payload);
    if (result.status !== 'OK' || !result.value) {
      throw new DomainError({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'El adapter ERP no respondio.',
        retryable: true,
      });
    }
    const outcome = result.value;

    await db.query(
      `UPDATE billing.billing_lots SET state = 'ENVIADO_ERP', sent_at = $2, updated_at = $2, version = version + 1
       WHERE id = $1`,
      [lotId, occurredAt],
    );
    let finalVersion = lot.version + 1;

    if (outcome.outcome === 'ACCEPTED') {
      await db.query(
        `UPDATE billing.erp_submission_attempts
         SET status = 'ACCEPTED', external_ref = $2, response = $3, completed_at = now()
         WHERE id = $1`,
        [attemptId, outcome.externalRef ?? null, JSON.stringify(outcome)],
      );
      await db.query(
        `UPDATE billing.billing_lots SET state = 'ACEPTADO_ERP', accepted_at = $2, version = version + 1
         WHERE id = $1`,
        [lotId, occurredAt],
      );
      finalVersion += 1;
      if (outcome.externalRef) {
        await db.query(
          `INSERT INTO billing.external_document_refs
             (id, billing_lot_id, external_system, external_id, document_kind, raw)
           VALUES ($1, $2, 'ERP_FIXTURE', $3, 'FACTURA', $4)
           ON CONFLICT (external_system, external_id) DO NOTHING`,
          [uuidv7(), lotId, outcome.externalRef, JSON.stringify(outcome)],
        );
      }
    } else if (outcome.outcome === 'ERROR') {
      await db.query(
        `UPDATE billing.erp_submission_attempts
         SET status = 'ERROR', error_code = $2, error_message = $3, response = $4, completed_at = now()
         WHERE id = $1`,
        [attemptId, outcome.errorCode ?? null, outcome.errorMessage ?? null, JSON.stringify(outcome)],
      );
      await db.query(`UPDATE billing.billing_lots SET state = 'ERROR_ERP', version = version + 1 WHERE id = $1`, [
        lotId,
      ]);
      finalVersion += 1;
    } else {
      // UNKNOWN: neither success nor failure. The lot stays ENVIADO_ERP pending reconciliation —
      // claiming either outcome here would be exactly the lie 14_DATA_INTEGRATION_ADAPTERS forbids.
      await db.query(
        `UPDATE billing.erp_submission_attempts SET status = 'UNKNOWN', response = $2, completed_at = now()
         WHERE id = $1`,
        [attemptId, JSON.stringify(outcome)],
      );
    }

    return {
      subject: { kind: 'LoteFacturacion', id: lotId },
      version: finalVersion,
      effects: [
        {
          kind: 'BILLING_LOT_SENT',
          subjectKind: 'LoteFacturacion',
          subjectId: lotId,
          detail: { outcome: outcome.outcome, externalRef: outcome.externalRef ?? null },
          outboxEvent: { type: 'billing.lot.sent', payload: { lotId, outcome: outcome.outcome } },
        },
      ],
    };
  },
};

export function registerBillingCommands(): void {
  registerHandler(buildLines);
  registerHandler(createLot);
  registerHandler(validateLot);
  registerHandler(sendLot);
}
