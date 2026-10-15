import { useEffect, useRef, useState } from 'react';
import { useWriterState } from '../lib/writer-state.js';
import { useLocale } from '../lib/i18n.js';
import {
  deriveContinueHintAvailability,
  usePlayHintsEnabled,
  type ContinueHintAvailability,
} from '../lib/play-hints.js';

interface WriterResultProps {
  worldKey?: string;
  worldReady?: boolean;
  worldFrozen?: boolean;
  submitPending?: boolean;
  onContinue?: () => boolean;
}

/** One ephemeral receipt per settled turn; never render reasoning or tool arguments. */
export function WriterResult({
  worldKey,
  worldReady = true,
  worldFrozen = false,
  submitPending = false,
  onContinue,
}: WriterResultProps) {
  const { t } = useLocale();
  const writer = useWriterState();
  const hintsEnabled = usePlayHintsEnabled();
  // The snapshot owns the receipt text. Local state only controls its
  // seven-second visibility window; it never copies or caches writer content.
  const [visibleSeq, setVisibleSeq] = useState<number | null>(null);
  const [preparedSeq, setPreparedSeq] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const seenCompletion = useRef(0);
  const preparedGuard = useRef<number | null>(null);

  useEffect(() => {
    setVisibleSeq(null);
    setPreparedSeq(null);
    preparedGuard.current = null;
    seenCompletion.current = writer.completionSeq;
    clearTimeout(timer.current);
    timer.current = undefined;
  }, [worldKey]);

  useEffect(() => {
    if (writer.error || (writer.phase === 'idle' && writer.stage === null)) {
      setVisibleSeq(null);
      setPreparedSeq(null);
      preparedGuard.current = null;
      seenCompletion.current = writer.completionSeq;
      return;
    }
    if (writer.phase !== 'idle' || writer.completionSeq === 0 || writer.completionSeq === seenCompletion.current) return;
    seenCompletion.current = writer.completionSeq;
    setPreparedSeq(null);
    preparedGuard.current = null;
    setVisibleSeq(writer.completionSeq);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisibleSeq(null), 7000);
  }, [writer.completionSeq, writer.error, writer.phase, writer.stage]);

  useEffect(() => () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const availability: ContinueHintAvailability = deriveContinueHintAvailability({
    enabled: hintsEnabled && onContinue !== undefined,
    phase: writer.phase,
    stage: writer.stage,
    error: writer.error,
    completionSeq: writer.completionSeq,
    visibleSeq,
    worldReady,
    worldFrozen,
    submitPending,
    preparedSeq,
  });
  if (visibleSeq === null || visibleSeq !== writer.completionSeq || writer.error) return null;
  const text = (writer.lastMessage ?? '').replace(/\s+/g, ' ').trim() || t('Your action has been processed.');
  const canContinue = availability === 'available' && onContinue !== undefined;
  const handleContinue = () => {
    if (!canContinue || preparedGuard.current === writer.completionSeq) return;
    preparedGuard.current = writer.completionSeq;
    if (onContinue!()) {
      setPreparedSeq(writer.completionSeq);
    } else {
      preparedGuard.current = null;
    }
  };
  return (
    <div key={visibleSeq} data-depth-surface="ui" className="writer-result" role="status" aria-live="polite">
      <span>{text}</span>
      {onContinue && (
        <button
          type="button"
          data-writer-continue
          disabled={!canContinue}
          aria-label={t('Continue · next-step hint')}
          onClick={handleContinue}
        >
          {t('Continue · next-step hint →')}
        </button>
      )}
    </div>
  );
}
