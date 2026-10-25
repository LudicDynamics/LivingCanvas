/**
 * The one status line of a call (LiveCallStatus): what the player should read
 * at a glance — 连接中 / 在听 / 听到了「…」 / 思考中 / 说话中 / 出错（原因）.
 *
 * Pure: a projection of the store's snapshot (live-call-store.ts), which is in
 * turn driven by the frames voice-live already sends — `hello` (connecting →
 * live), `user_start` / `transcript` (heard), `state{bot}` thinking / speaking
 * / idle, `error` (fatal → the call's error; per turn → a notice). No React,
 * no timers, so the test reads it directly.
 */
import type { LiveCallState } from './live-call-store.js';

export type CallStatusKind = 'connecting' | 'listening' | 'heard' | 'thinking' | 'speaking' | 'error';

export interface CallStatusLine {
  kind: CallStatusKind;
  /** `heard`: what was heard (also carried while `thinking`, so the line keeps it). */
  heard?: string;
  /** `error`: why, as the store already worded it. */
  reason?: string;
}

/** Long transcripts are shortened for the line; the subtitles keep them whole. */
export const HEARD_MAX_CHARS = 40;

const clip = (text: string): string => {
  const chars = Array.from(text.trim());
  return chars.length > HEARD_MAX_CHARS ? `${chars.slice(0, HEARD_MAX_CHARS).join('')}…` : chars.join('');
};

export function callStatusLine(call: Pick<LiveCallState, 'phase' | 'bot' | 'heard' | 'error'>): CallStatusLine | null {
  switch (call.phase) {
    case 'connecting':
      return { kind: 'connecting' };
    case 'error':
      return { kind: 'error', ...(call.error ? { reason: call.error } : {}) };
    case 'live': {
      const heard = call.heard?.trim() ? clip(call.heard) : undefined;
      if (call.bot === 'speaking') return { kind: 'speaking' };
      if (call.bot === 'thinking') return { kind: 'thinking', ...(heard ? { heard } : {}) };
      if (heard) return { kind: 'heard', heard };
      return { kind: 'listening' };
    }
    default:
      return null;
  }
}
