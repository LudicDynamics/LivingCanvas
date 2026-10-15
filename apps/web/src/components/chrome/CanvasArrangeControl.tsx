import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, Check, LayoutGrid, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useLocale } from '../../lib/i18n.js';
import {
  CanvasArrangeRequestError,
  subscribeCanvasArrangeFrames,
  type CanvasArrangeAccepted,
  type CanvasArrangeFrame,
  type CanvasArrangeRequest,
  type UseWorldApi,
} from '../../state/useWorld.js';
import './canvas-arrange-control.css';

export type CanvasArrangePhase =
  | 'idle'
  | 'accepted'
  | 'processing'
  | 'arranging'
  | 'verifying'
  | 'landed'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'conflict'
  | 'cancelled';

export interface CanvasArrangeControlHandle {
  request: () => void;
  cancel: () => boolean;
  isFocused: () => boolean;
}

export interface CanvasArrangeControlProps {
  worldId: string | null;
  layer: string;
  worldReady: boolean;
  writerBusy: boolean;
  worldChanging?: boolean;
  state: UseWorldApi['state'];
  requestArrange: UseWorldApi['requestArrange'];
  cancelArrange: UseWorldApi['cancelArrange'];
  refresh: UseWorldApi['refresh'];
}

const TERMINAL = new Set<CanvasArrangePhase>(['idle', 'completed', 'partial', 'failed', 'conflict', 'cancelled']);
const ACTIVE = new Set<CanvasArrangePhase>(['accepted', 'processing', 'arranging', 'verifying', 'landed']);
const TERMINAL_DETAIL_DURATION_MS = 5000;

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function outcomeOf(frame: CanvasArrangeFrame): string | undefined {
  const details = objectOf(frame.details) ?? objectOf(frame.result) ?? objectOf(frame.output);
  return textOf(frame.outcome) ?? textOf(details?.outcome) ?? textOf(frame.status) ?? textOf(frame.error);
}

function proofOf(frame: CanvasArrangeFrame): boolean {
  const details = objectOf(frame.details) ?? objectOf(frame.result) ?? objectOf(frame.output);
  const proof = objectOf(frame.proof) ?? objectOf(details?.proof);
  const overlaps = frame.overlaps ?? proof?.overlaps ?? details?.overlaps;
  return frame.verified === true || proof?.verified === true || details?.verified === true || (Array.isArray(overlaps) && overlaps.length === 0);
}

function changedCountOf(frame: CanvasArrangeFrame): number {
  const details = objectOf(frame.details) ?? objectOf(frame.result) ?? objectOf(frame.output);
  const value = frame.changedCards ?? frame.changedCount ?? details?.changedCards ?? details?.changedCount;
  return typeof value === 'number' && value > 0 ? value : 0;
}

function reasonFor(error: unknown): { phase: 'failed' | 'conflict'; message: string } {
  if (error instanceof CanvasArrangeRequestError) {
    if (['conflict', 'revision_conflict', 'stale', 'in_progress'].includes(error.code)) {
      return { phase: 'conflict', message: 'The canvas changed while arranging. Refresh, then retry.' };
    }
    if (error.code === 'screenshot_unavailable') {
      return { phase: 'failed', message: 'Could not inspect the canvas. Nothing was changed. Try again.' };
    }
    if (error.code === 'writer_busy') {
      return { phase: 'failed', message: 'The writer is working. Arrange the canvas after it finishes.' };
    }

    if (error.code === 'connection_lost' || error.code === 'timeout') {
      return { phase: 'failed', message: 'Connection lost while arranging. Refresh to check the saved canvas, then retry.' };
    }
  }
  return { phase: 'failed', message: 'Canvas arrangement is unavailable. Nothing was changed. Try again later.' };
}
function acceptedFromInProgress(error: unknown, input: CanvasArrangeRequest): { ack: CanvasArrangeAccepted; input: CanvasArrangeRequest } | null {
  if (!(error instanceof CanvasArrangeRequestError) || error.code !== 'in_progress') return null;
  const payload = error.payload;
  if (
    !payload ||
    typeof payload.operationId !== 'string' ||
    typeof payload.turnId !== 'string' ||
    payload.agentId !== 'canvas-arranger'
  ) return null;
  const boundInput = {
    ...input,
    requestId: typeof payload.requestId === 'string' ? payload.requestId : input.requestId,
  };
  return {
    input: boundInput,
    ack: {
      ok: true,
      operationId: payload.operationId,
      requestId: boundInput.requestId,
      worldId: typeof payload.worldId === 'string' ? payload.worldId : input.worldId,
      layer: typeof payload.layer === 'string' ? payload.layer : input.layer,
      agentId: 'canvas-arranger',
      turnId: payload.turnId,
      stage: 'accepted',
    },
  };
}

function requestInput(
  worldId: string,
  layer: string,
  state: UseWorldApi['state'],
): CanvasArrangeRequest | null {
  if (
    state?.revision === undefined ||
    state.canvasVersion === undefined ||
    state.snapshotId === undefined
  ) return null;
  return {
    worldId,
    layer,
    mode: 'grid',
    requestId: crypto.randomUUID(),
    expectedRevision: state.revision,
    expectedCanvasVersion: state.canvasVersion,
    snapshotId: state.snapshotId,
    screenshotPolicy: 'none',
  };
}

export const CanvasArrangeControl = forwardRef<CanvasArrangeControlHandle, CanvasArrangeControlProps>(function CanvasArrangeControl({
  worldId,
  layer,
  worldReady,
  writerBusy,
  worldChanging = false,
  state,
  requestArrange,
  cancelArrange,
  refresh,
}, ref) {
  const { t } = useLocale();
  const [phase, setPhase] = useState<CanvasArrangePhase>('idle');
  const [message, setMessage] = useState('');
  const [messageCompact, setMessageCompact] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [request, setRequest] = useState<CanvasArrangeRequest | null>(null);
  const [accepted, setAccepted] = useState<CanvasArrangeAccepted | null>(null);
  const phaseRef = useRef(phase);
  const requestRef = useRef(request);
  const acceptedRef = useRef(accepted);
  const cancelledRef = useRef(false);
  const sawPatchRef = useRef(false);
  const pendingOutcomeRef = useRef<string | undefined>(undefined);
  const cancelInFlightRef = useRef(false);
  const terminalTimerRef = useRef<number | null>(null);
  const scopeRef = useRef({ worldId, layer, worldChanging });
  const rootRef = useRef<HTMLDivElement>(null);

  const clearTerminalTimer = useCallback(() => {
    if (terminalTimerRef.current !== null) {
      window.clearTimeout(terminalTimerRef.current);
      terminalTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearTerminalTimer, [clearTerminalTimer]);

  const setLocalPhase = useCallback((next: CanvasArrangePhase, nextMessage: string) => {
    const current = phaseRef.current;
    if (TERMINAL.has(current) && current !== 'idle' && next !== 'idle') return;
    clearTerminalTimer();
    phaseRef.current = next;
    setPhase(next);
    setMessage(nextMessage);
    setMessageCompact(false);
    if (next === 'failed' || next === 'conflict') {
      terminalTimerRef.current = window.setTimeout(() => {
        terminalTimerRef.current = null;
        setMessageCompact(true);
      }, TERMINAL_DETAIL_DURATION_MS);
    }
  }, [clearTerminalTimer]);

  const finishFromOutcome = useCallback(async (outcome: string | undefined, frame: CanvasArrangeFrame) => {
    const requestId = requestRef.current?.requestId;
    if (cancelledRef.current || !requestId) return;
    if (outcome === 'cancelled') {
      const message = changedCountOf(frame) > 0
        ? 'Some cards were already arranged before cancellation. Refresh to see them.'
        : 'Arrangement cancelled before positions were saved. Nothing changed.';
      setLocalPhase('cancelled', t(message));
      return;
    }
    if (outcome === 'failed') {
      setLocalPhase('failed', t('Canvas arrangement failed. Refresh, then retry.'));
      return;
    }
    if (outcome === 'partial') {
      await refresh();
      if (requestRef.current?.requestId !== requestId || cancelledRef.current) return;
      setLocalPhase('partial', t('Positions saved, but visual verification is incomplete. Refresh and inspect the canvas.'));
      return;
    }
    if (outcome !== 'completed' || !sawPatchRef.current) {
      pendingOutcomeRef.current = outcome;
      return;
    }
    await refresh();
    if (requestRef.current?.requestId !== requestId || cancelledRef.current) return;
    if (proofOf(frame)) {
      setLocalPhase('completed', t('Canvas arranged. The current layer has been refreshed.'));
    } else {
      setLocalPhase('landed', t('Positions saved. Confirming the final layout…'));
    }
  }, [refresh, setLocalPhase, t]);

  useEffect(() => {
    const unsubscribe = subscribeCanvasArrangeFrames((frame) => {
      const current = acceptedRef.current;
      const activeRequest = requestRef.current;
      if (!current || !activeRequest || cancelledRef.current) return;
      if (typeof frame.agentId === 'string' && frame.agentId !== 'canvas-arranger') return;
      if (typeof frame.operationId === 'string' && frame.operationId !== current.operationId) return;
      if (typeof frame.requestId === 'string' && frame.requestId !== activeRequest.requestId) return;
      if (typeof frame.turnId === 'string' && frame.turnId !== current.turnId) return;
      if (frame.type === 'agent_activity') {
        if (frame.phase === 'started' && (frame.operation === 'look' || frame.operation === 'read')) {
          setLocalPhase('processing', t('Reading the current canvas…'));
        } else if (frame.phase === 'started' && frame.operation === 'edit') {
          setLocalPhase('arranging', t('Arranging cards on this layer…'));
        } else if (frame.phase === 'failed') {
          const outcome = outcomeOf(frame);
          void finishFromOutcome(
            ['conflict', 'revision_conflict', 'stale'].includes(outcome ?? '') ? 'conflict' : outcome === 'cancelled' ? 'cancelled' : 'failed',
            frame,
          );
        } else if (frame.phase === 'completed') {
          void finishFromOutcome(outcomeOf(frame), frame);
        }
      }
      if (frame.type === 'canvas_patched') {
        if (typeof frame.layer !== 'string' || frame.layer !== activeRequest.layer) return;
        if (typeof frame.source === 'string' && frame.source !== 'functional') return;
        sawPatchRef.current = true;
        void refresh().then(() => {
          if (requestRef.current?.requestId !== activeRequest.requestId || cancelledRef.current) return;
          const outcome = pendingOutcomeRef.current;
          if (outcome) {
            pendingOutcomeRef.current = undefined;
            void finishFromOutcome(outcome, frame);
          }
        });
      }
    });
    return unsubscribe;
  }, [finishFromOutcome, refresh, setLocalPhase, t]);

  const cancel = useCallback(() => {
    const current = acceptedRef.current;
    const activeRequest = requestRef.current;
    if (!current || !activeRequest || cancelInFlightRef.current || TERMINAL.has(phaseRef.current)) return false;
    cancelInFlightRef.current = true;
    setCancelPending(true);
    setMessage(t('Cancellation requested. Waiting for the saved result…'));
    void cancelArrange(current.operationId, {
      worldId: activeRequest.worldId,
      layer: activeRequest.layer,
      requestId: activeRequest.requestId,
    }).then((result) => {
      if (result.stage === 'already_cancelled') {
        cancelledRef.current = true;
        setCancelPending(false);
        setLocalPhase('cancelled', t('Arrangement cancelled before positions were saved. Nothing changed.'));
      } else if (result.stage === 'already_completed') {
        setCancelPending(false);
        setMessage(t('The arrangement already completed. Checking the saved result…'));
      }
    }).catch((error) => {

      cancelInFlightRef.current = false;
      setCancelPending(false);
      const result = reasonFor(error);
      setLocalPhase(result.phase, result.message);
    });
    return true;
  }, [cancelArrange, setLocalPhase, t]);
  const requestNow = useCallback(() => {
    if (worldChanging || !worldReady || writerBusy || ACTIVE.has(phaseRef.current)) {
      if (writerBusy) setMessage(t('The writer is working. Arrange the canvas after it finishes.'));
      else if (!worldReady) setMessage(t('Load a world and wait for the scene to appear before arranging the canvas.'));
      return;
    }
    if (!worldId) {
      setLocalPhase('failed', t('Canvas arrangement is unavailable. Nothing was changed. Try again later.'));
      return;
    }
    const input = requestInput(worldId, layer, state);
    if (!input) {
      setLocalPhase('failed', t('Canvas arrangement is unavailable. Nothing was changed. Try again later.'));
      return;
    }
    clearTerminalTimer();
    setMessageCompact(false);
    cancelledRef.current = false;
    sawPatchRef.current = false;
    pendingOutcomeRef.current = undefined;
    cancelInFlightRef.current = false;
    setRequest(input);
    requestRef.current = input;
    setAccepted(null);
    acceptedRef.current = null;
    phaseRef.current = 'idle';
    setPhase('idle');
    setMessage('');
    void requestArrange(input).then((ack) => {
      if (requestRef.current?.requestId !== input.requestId || cancelledRef.current) {
        if (cancelledRef.current) {
          void cancelArrange(ack.operationId, {
            worldId: input.worldId,
            layer: input.layer,
            requestId: input.requestId,
          }).catch(() => {});
        }
        return;
      }
      setAccepted(ack);
      acceptedRef.current = ack;
      setLocalPhase('processing', t('Reading the current canvas…'));
    }).catch((error) => {
      if (requestRef.current?.requestId !== input.requestId || cancelledRef.current) return;
      const bound = acceptedFromInProgress(error, input);
      if (bound) {
        setRequest(bound.input);
        requestRef.current = bound.input;
        setAccepted(bound.ack);
        acceptedRef.current = bound.ack;
        setLocalPhase('processing', t('Reading the current canvas…'));
        return;
      }
      const result = reasonFor(error);
      setLocalPhase(result.phase, result.message);
    });
  }, [clearTerminalTimer, layer, requestArrange, setLocalPhase, state, t, worldChanging, worldId, worldReady, writerBusy]);

  useImperativeHandle(ref, () => ({
    request: requestNow,
    cancel,
    isFocused: () => Boolean(rootRef.current?.contains(document.activeElement)),
  }), [cancel, requestNow]);

  useEffect(() => {
    const previous = scopeRef.current;
    const changed = previous.worldId !== worldId || previous.layer !== layer || (!previous.worldChanging && worldChanging);
    scopeRef.current = { worldId, layer, worldChanging };
    if (!changed) return;
    clearTerminalTimer();
    if (acceptedRef.current && requestRef.current && ACTIVE.has(phaseRef.current)) {
      const old = acceptedRef.current;
      const oldRequest = requestRef.current;
      void cancelArrange(old.operationId, { worldId: oldRequest.worldId, layer: oldRequest.layer, requestId: oldRequest.requestId }).catch(() => {});
    }
    cancelledRef.current = true;
    requestRef.current = null;
    acceptedRef.current = null;
    pendingOutcomeRef.current = undefined;
    setRequest(null);
    setAccepted(null);
    setCancelPending(false);
    phaseRef.current = 'idle';
    setPhase('idle');
    setMessage('');
    setMessageCompact(false);
  }, [cancelArrange, clearTerminalTimer, layer, worldChanging, worldId]);

  const active = ACTIVE.has(phase);
  const disabled = active || cancelPending || worldChanging || !worldReady || writerBusy;
  const visibleMessage = message || (writerBusy
    ? t('The writer is working. Arrange the canvas after it finishes.')
    : !worldReady
      ? t('Load a world and wait for the scene to appear before arranging the canvas.')
      : worldChanging
        ? t('The world is changing. Wait for the current scene to load.')
        : '');
  const statusMessage = messageCompact && phase === 'failed'
    ? t('Arrangement failed. Retry is available.')
    : messageCompact && phase === 'conflict'
      ? t('Canvas changed. Review and retry.')
      : visibleMessage;
  const retryDisabled = worldChanging || !worldReady || writerBusy || !worldId;
  const label = phase === 'idle' || phase === 'completed' || phase === 'partial' || phase === 'failed' || phase === 'conflict' || phase === 'cancelled'
    ? t('Arrange canvas')
    : t('Arranging…');
  const icon = active ? <LoaderCircle aria-hidden="true" size={16} className="canvas-arrange-control__spin" /> : phase === 'completed' ? <Check aria-hidden="true" size={16} /> : <LayoutGrid aria-hidden="true" size={16} />;

  return (
    <div ref={rootRef} className="canvas-arrange-control">
      <button
        type="button"
        className="canvas-arrange-control__button"
        data-testid="canvas-arrange-control"
        onClick={requestNow}
        disabled={disabled}
        aria-label={t('Arrange the current layer (Shift+R)')}
        aria-keyshortcuts="Shift+R"
        title={t('Arrange the current layer')}
      >
        {icon}
        <span>{label}</span>
      </button>
      {active && (
        <button type="button" className="canvas-arrange-control__cancel" onClick={cancel} disabled={cancelPending}>
          <X aria-hidden="true" size={13} /> {cancelPending ? t('Cancellation requested…') : t('Cancel arrangement')}
        </button>
      )}
      {(visibleMessage || phase !== 'idle') && (
        <div className="canvas-arrange-control__status" data-phase={phase} data-compact={messageCompact || undefined} role="status" aria-live="polite" aria-atomic="true">
          <span className="canvas-arrange-control__status-icon" aria-hidden="true">
            {phase === 'completed' ? <Check size={13} /> : phase === 'conflict' || phase === 'failed' ? <AlertTriangle size={13} /> : phase === 'partial' ? <RefreshCw size={13} /> : null}
          </span>
          <span>{statusMessage}</span>
          {(phase === 'failed' || phase === 'conflict' || phase === 'partial' || phase === 'cancelled') && (
            <button type="button" className="canvas-arrange-control__retry" onClick={requestNow} disabled={retryDisabled}>
              {t('Retry arrangement')}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

CanvasArrangeControl.displayName = 'CanvasArrangeControl';
