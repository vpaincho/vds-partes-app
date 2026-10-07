/**
 * Running a command from the UI, with the refusal shown rather than swallowed.
 *
 * Every command in this product can be refused, and a refusal carries blocks, warnings, missing
 * items and confirmations that the operator is supposed to read. The prototype's `A` table called a
 * mutation and rendered a toast; a block had nowhere to appear. So this hook keeps three things:
 *
 *  - the **decision** of the last attempt, whether it was applied or refused, for the gate panel;
 *  - the **command id**, reused across retries. A fresh id on retry defeats idempotency, and RGT-06
 *     requires the same receipt to come back. The id is minted once per user intent and only
 *     replaced after an outcome the user acknowledged.
 *  - the distinction between "it was refused" and "we could not ask", because a transport failure is
 *     not a decision and must never be rendered as one.
 */
import { useCallback, useRef, useState, type JSX } from 'react';
import type { DecisionEnvelope } from '@vds/kernel';
import {
  ApiError,
  command,
  evaluate,
  newCommandId,
  type CommandOptions,
  type CommandResult,
} from '../api/client.ts';
import { GatePanel } from './GatePanel.tsx';

export type CommandPhase = 'idle' | 'running' | 'applied' | 'blocked' | 'unreachable';

export interface CommandState {
  readonly phase: CommandPhase;
  readonly decision: DecisionEnvelope | null;
  /** Set only when the failure was NOT a decision — no answer, or an invalid request. */
  readonly error: ApiError | null;
  readonly receipt: CommandResult['receipt'] | null;
}

const IDLE: CommandState = { phase: 'idle', decision: null, error: null, receipt: null };

export interface UseCommandResult {
  readonly state: CommandState;
  readonly run: (path: string, options?: CommandOptions) => Promise<CommandResult | null>;
  readonly preview: (path: string, options?: CommandOptions) => Promise<CommandResult | null>;
  readonly reset: () => void;
}

export function useCommand(onApplied?: () => void): UseCommandResult {
  const [state, setState] = useState<CommandState>(IDLE);
  // One id per intent, held across retries so a retry replays instead of duplicating.
  const commandId = useRef<string>(newCommandId());

  const invoke = useCallback(
    async (
      send: typeof command,
      path: string,
      options: CommandOptions = {},
      isPreview = false,
    ): Promise<CommandResult | null> => {
      setState({ phase: 'running', decision: null, error: null, receipt: null });
      try {
        const result = await send(path, { commandId: commandId.current, ...options });
        setState({
          phase: 'applied',
          decision: result.decision,
          error: null,
          receipt: result.receipt,
        });
        // A preview keeps the id: the real command must reuse it so the two are one intent.
        if (!isPreview) {
          commandId.current = newCommandId();
          onApplied?.();
        }
        return result;
      } catch (cause) {
        if (cause instanceof ApiError && cause.isBlocked) {
          // A refusal is an answer. Keep the command id: resolving the cause and retrying is the
          // same intent, and the server must recognise it as such.
          setState({
            phase: 'blocked',
            decision: null,
            error: cause,
            receipt: null,
          });
          return null;
        }
        setState({
          phase: 'unreachable',
          decision: null,
          error: cause instanceof ApiError ? cause : null,
          receipt: null,
        });
        return null;
      }
    },
    [onApplied],
  );

  return {
    state,
    run: (path, options) => invoke(command, path, options, false),
    preview: (path, options) => invoke(evaluate, path, options, true),
    reset: () => setState(IDLE),
  };
}

/**
 * The outcome of the last attempt.
 *
 * A blocked command is rendered through the same GatePanel as a preview, from the error's `blocks`.
 * That is deliberate: the operator should not have to learn two different layouts for "this is what
 * stands in the way", one before the action and one after.
 */
export function CommandOutcome({ state }: { readonly state: CommandState }): JSX.Element | null {
  if (state.phase === 'idle') return null;
  if (state.phase === 'running') return <GatePanel decision={null} loading />;

  if (state.phase === 'unreachable') {
    const error = state.error;
    return (
      <section className="vds-gate" data-decision="UNREACHABLE" aria-live="polite">
        <p className="vds-gate__headline">
          {error?.body.retryable
            ? 'No se pudo contactar al servidor. El comando no fue enviado.'
            : (error?.message ?? 'La solicitud no fue aceptada.')}
        </p>
        {error?.body.details.map((detail) => (
          <p key={`${detail.path ?? ''}${detail.message}`} className="vds-gate__note">
            {detail.path ? `${detail.path}: ` : ''}
            {detail.message}
          </p>
        ))}
        <p className="vds-gate__note">
          {/* The honest statement, and the one the prototype's silent catch did not make. */}
          Nada cambió en el servidor. Reintentar con el mismo pedido no duplica el efecto.
        </p>
      </section>
    );
  }

  if (state.phase === 'blocked') {
    const body = state.error?.body;
    // Rebuilt from the error so the same panel renders it. The blocks the server sent are the only
    // content; nothing is inferred, and `overrideable` stays false because the error envelope does
    // not carry it — offering an override the rule never declared would be worse than offering none
    // (C-018).
    const envelope: DecisionEnvelope = {
      decisionId: (body?.decisionId ?? '00000000-0000-0000-0000-000000000000') as DecisionEnvelope['decisionId'],
      decision: 'BLOCK',
      subject: { kind: 'Comando', id: null },
      trigger: 'COMMAND_REFUSED',
      blocks: (body?.blocks ?? []).map((b) => ({
        ruleId: b.ruleId,
        precedence: 'P5' as const,
        reason: b.reason,
        ...(b.instead ? { instead: b.instead } : {}),
        ...(b.sourceRef ? { sourceRef: b.sourceRef } : {}),
        overrideable: false,
      })),
      warnings: [],
      confirmationsRequired: [],
      missing: [],
      effects: [],
      rulesApplied: [],
      rulesetVersion: '',
      evaluatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z') as DecisionEnvelope['evaluatedAt'],
      contextHash: '',
      preview: false,
    };
    return <GatePanel decision={envelope} />;
  }

  // Applied. The receipt is shown because "it was accepted" is a fact with an id behind it.
  return (
    <section className="vds-gate vds-gate--clear" data-decision={state.decision?.decision} aria-live="polite">
      <p className="vds-gate__headline">
        {state.receipt?.outcome === 'REPLAYED'
          ? 'Ya estaba aplicado. Se devolvió el recibo original, sin un segundo efecto.'
          : state.receipt?.outcome === 'NO_OP'
            ? 'Evaluado sin efecto: no había nada que aplicar.'
            : state.decision?.preview
              ? 'Evaluación previa sin bloqueos. No autoriza: el comando vuelve a evaluar.'
              : 'Aplicado.'}
      </p>
      {state.receipt && (
        <p className="vds-gate__provenance vds-numeric">
          recibo {state.receipt.receiptId.slice(0, 8)} · {state.receipt.outcome} ·{' '}
          {new Date(state.receipt.receiptAt).toLocaleString('es-AR')}
        </p>
      )}
      {(state.decision?.warnings.length ?? 0) > 0 && <GatePanel decision={state.decision} />}
    </section>
  );
}
