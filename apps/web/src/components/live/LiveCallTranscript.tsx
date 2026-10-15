import React from 'react';
import { useLocale } from '../../lib/i18n.js';
import type { LiveCallLines, LiveCallState } from '../../lib/live-call-store.js';
import './live-call-transcript.css';

export interface LiveCallTranscriptProps {
  /**
   * 角色真实台词（已提交 + 流式），由载体从 store 快照取出后传入。
   * 契约 30 §3.2 冻结 4：组件 MUST NOT 自己读 store。
   */
  lines: LiveCallLines;
  /**
   * 只读三个字段。MUST NOT 传归属字段（角色 id / 通话持有者）—— 归属不属展示，
   * 组件 MUST NOT 假定通话归属（30 §3.2 冻结 4）。
   * `phase` 只用于空态文案二选一（§3.5 第 3 步）。
   */
  call: Pick<LiveCallState, 'outputText' | 'inputText' | 'phase'>;
  /** 宿主版式钩子：追加到根元素的 class（不改组件自身 CSS）。 */
  className?: string;
}

/**
 * The single subtitle projection shared by every call surface.
 *
 * It is props-driven and self-contained: it never subscribes to the call store,
 * never touches call lifecycle, and never assumes which entry opened the call —
 * everything it needs is handed in (contract 30 §3.2 freeze 4). Status bars and
 * hang-up controls stay with the host, because they branch on `phase` and trigger
 * lifecycle work.
 *
 * Render order is fixed at `lines → streaming → outputText → inputText` so the same
 * call reads identically in every projection (31 §3.5 step 8).
 */
export const LiveCallTranscript: React.FC<LiveCallTranscriptProps> = ({ lines, call, className }) => {
  const { t } = useLocale();
  // Recomputed on every render, never cached: a cached value would leave the
  // placeholder on screen next to the first real line (31 §3.5 step 1).
  const empty =
    lines.lines.length === 0 &&
    lines.streaming === '' &&
    call.outputText === '' &&
    call.inputText === '';
  return (
    <div
      data-live-call-transcript=""
      className={className ? `live-call-transcript ${className}` : 'live-call-transcript'}
    >
      {empty && (
        <p className="live-call-transcript__placeholder">
          {call.phase === 'connecting' ? t('Connecting…') : t('Listening…')}
        </p>
      )}
      {lines.lines.map((line, i) => (
        <p key={i} className="live-call-transcript__line">
          <span className="live-call-transcript__speaker">{t('They say')}</span>
          {line}
        </p>
      ))}
      {lines.streaming !== '' && (
        <p className="live-call-transcript__line live-call-transcript__line--streaming">
          <span className="live-call-transcript__speaker">{t('They say')}</span>
          {lines.streaming}
        </p>
      )}
      {lines.streaming === '' && call.outputText !== '' && (
        <p className="live-call-transcript__line live-call-transcript__line--voice">
          <span className="live-call-transcript__speaker">{t('They say')}</span>
          {call.outputText}
        </p>
      )}
      {call.inputText !== '' && (
        <p className="live-call-transcript__line live-call-transcript__line--player">
          <span className="live-call-transcript__speaker">{t('You')}</span>
          {call.inputText}
        </p>
      )}
    </div>
  );
};
