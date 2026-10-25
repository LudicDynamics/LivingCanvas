import React, { useEffect, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import type { LiveCallState } from '../../lib/live-call-store.js';
import { callStatusLine } from '../../lib/live-call-status-line.js';
import './live-call-status.css';

export interface LiveCallStatusProps {
  /** Display fields only — never the owner or the character (same rule as LiveCallTranscript). */
  call: Pick<LiveCallState, 'phase' | 'bot' | 'notice' | 'endsAt' | 'billingUrl'> & Partial<Pick<LiveCallState, 'heard' | 'error'>>;
  className?: string;
  /** Test seam for the minutes countdown. */
  now?: () => number;
}

/** Below this the minutes line turns into a warning. */
const LOW_MS = 2 * 60_000;

/**
 * What the call is doing between the subtitles (voice-live audit #3 #7): whether
 * she is listening, thinking or speaking — so a 3-second think reads as a
 * think, not a dead line — a short notice when one turn failed, the minutes
 * left, and, when the call was refused for minutes or plan, the way to get more.
 *
 * Props-driven like the transcript: it reads no store and controls no call.
 */
export const LiveCallStatus: React.FC<LiveCallStatusProps> = ({ call, className, now = Date.now }) => {
  const { t } = useLocale();
  const counting = call.phase === 'live' && typeof call.endsAt === 'number';
  const [at, setAt] = useState(() => now());
  useEffect(() => {
    if (!counting) return undefined;
    setAt(now());
    const timer = setInterval(() => setAt(now()), 15_000);
    return () => clearInterval(timer);
  }, [counting, now]);

  const root = className ? `live-call-status ${className}` : 'live-call-status';
  if (call.phase === 'error') {
    if (!call.billingUrl) return null;
    return (
      <div data-live-call-status="" className={root}>
        <a className="live-call-status__upgrade" href={call.billingUrl} target="_blank" rel="noopener noreferrer">
          {t('Get more minutes')}
        </a>
      </div>
    );
  }
  if (call.phase !== 'live') return null;

  const left = typeof call.endsAt === 'number' ? call.endsAt - at : null;
  // GPT Live reports no bot state: no badge rather than a guess. Connecting and a failed call
  // are worded by the host (its call bar / alert), so the line covers the live states.
  const line = call.bot ? callStatusLine(call) : null;
  return (
    <div data-live-call-status="" className={root}>
      {line && (
        <span className={`live-call-status__bot live-call-status__bot--${line.kind}`} aria-live="polite" data-call-state={line.kind}>
          <span className="live-call-status__dot" aria-hidden="true" />
          {line.kind === 'thinking'
            ? t('Thinking')
            : line.kind === 'speaking'
              ? t('Speaking')
              : line.kind === 'heard'
                ? t('Heard “{text}”', { text: line.heard ?? '' })
                : t('Listening')}
        </span>
      )}
      {left !== null && (
        <span className={`live-call-status__minutes${left < LOW_MS ? ' live-call-status__minutes--low' : ''}`}>
          {left < LOW_MS
            ? t('Less than 2 minutes left')
            : t('{minutes} min left this month', { minutes: Math.ceil(left / 60_000) })}
        </span>
      )}
      {call.notice && (
        <p className="live-call-status__notice" role="status">{call.notice}</p>
      )}
    </div>
  );
};
