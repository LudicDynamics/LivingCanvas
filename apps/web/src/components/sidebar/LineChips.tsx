/**
 * LineChips — a character's (or an NPC's) bubble of things to SAY.
 *
 * Written lines first (the opening's replies, the companion hint's replies, the layer's options said to this
 * person, an NPC card's `replies:`), then one last chip, 「再生成一批」: one cheap model call for a fresh batch in
 * context (`POST /api/replies/suggest`). A guest cannot — the chip is grey with a sign-in hint. With no written
 * lines, the bubble is only that chip. Tapping a line SAYS it (no keyboard); typing stays right under it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLocale } from '../../lib/i18n.js';

export interface LineChip { key: string; say: string }

export type BatchState = 'ready' | 'busy' | 'locked' | 'failed';

export interface LineBatch {
  /** The fresh batch, when one was asked for (it stands in for the written lines until the place changes). */
  lines: LineChip[];
  state: BatchState;
  /** Why the chip is grey (locked / failed): one short line. */
  reason: string | null;
  ask(): void;
  /** A batch line was said: it leaves the bubble. */
  spend(key: string): void;
}

/**
 * The batch for one subject (a character id / an NPC card path). Kept per subject while the page lives, so
 * turning back to someone shows their last batch; `place` changing (a new layer) drops every batch.
 */
export function useLineBatch(
  subject: string | null,
  place: string,
  request: ((signal: AbortSignal) => Promise<string[]>) | null,
  locked: string | null,
): LineBatch {
  const { t } = useLocale();
  const batches = useRef(new Map<string, LineChip[]>());
  const [, bump] = useState(0);
  const [state, setState] = useState<BatchState>('ready');
  const [reason, setReason] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { batches.current.clear(); bump((n) => n + 1); }, [place]);
  useEffect(() => {
    abort.current?.abort();
    abort.current = null;
    setState('ready');
    setReason(null);
  }, [subject]);
  useEffect(() => () => abort.current?.abort(), []);
  const ask = useCallback(() => {
    if (!subject || !request || locked || state === 'busy') return;
    const controller = new AbortController();
    abort.current = controller;
    setState('busy');
    setReason(null);
    const forSubject = subject;
    request(controller.signal).then((lines) => {
      if (controller.signal.aborted) return;
      batches.current.set(forSubject, lines.map((say, i) => ({ key: `gen:${Date.now()}:${i}`, say })));
      setState('ready');
      bump((n) => n + 1);
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const status = (failure as { status?: unknown } | null)?.status;
      setState('failed');
      setReason(status === 503 || status === 403 ? t('Sign in to get new lines') : t('No new lines this time. Try again.'));
    });
  }, [subject, request, locked, state, t]);
  const spend = useCallback((key: string) => {
    if (!subject) return;
    const list = batches.current.get(subject);
    if (!list) return;
    batches.current.set(subject, list.filter((l) => l.key !== key));
    bump((n) => n + 1);
  }, [subject]);
  return {
    lines: (subject && batches.current.get(subject)) || [],
    state: locked ? 'locked' : state,
    reason: locked ?? reason,
    ask,
    spend,
  };
}

export function LineChips({ lines, batch, busy, onSay, testId = 'line-chips' }: {
  /** The written lines (already filtered: unused, at most three). */
  lines: readonly LineChip[];
  /** The 「再生成一批」 batch; null = no chip (no way to ask here). */
  batch: LineBatch | null;
  /** The person is answering: nothing can be said right now. */
  busy: boolean;
  onSay(line: LineChip, generated: boolean): void;
  testId?: string;
}): React.ReactElement | null {
  const { t } = useLocale();
  const generated = batch && batch.lines.length > 0;
  const shown = generated ? batch!.lines : lines;
  if (shown.length === 0 && !batch) return null;
  const regenLabel = batch?.state === 'busy' ? t('Writing new lines…') : t('New lines');
  return (
    <div className="reply-chips reply-chips--strip line-chips" role="group" data-testid={testId} data-generated={generated ? 'true' : undefined}>
      {shown.map((line) => (
        <button key={line.key} type="button" className="reply-chip line-chip" title={line.say} disabled={busy} onClick={() => onSay(line, Boolean(generated))}>
          {line.say}
        </button>
      ))}
      {batch && (
        <button
          type="button"
          className="reply-chip line-chip line-chip--regen"
          data-testid="line-chips-regen"
          data-state={batch.state}
          disabled={busy || batch.state === 'busy' || batch.state === 'locked'}
          aria-busy={batch.state === 'busy' || undefined}
          title={batch.reason ?? regenLabel}
          onClick={batch.ask}
        >
          <RefreshCw size={13} aria-hidden="true" className={batch.state === 'busy' ? 'line-chip__spin' : undefined} />
          <span>{regenLabel}</span>
          {batch.reason && <small className="line-chip__why">{batch.reason}</small>}
        </button>
      )}
    </div>
  );
}
