import React, { useEffect, useRef, useState } from 'react';
import { createImeGuard } from '../../lib/ime.js';
export interface NookNoteComposerProps {
  characterId: string;
  onCreated?: () => void;
  disabled?: boolean;
  lockMessage?: string;
}

function clientRefOf(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Fall through to a local, collision-resistant enough reference.
  }
  return `nook-note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const NookNoteComposer: React.FC<NookNoteComposerProps> = ({ characterId, onCreated, disabled = false, lockMessage }) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const imeGuardRef = useRef(createImeGuard());
  // The host owns the lane position. This local media state only controls
  // whether the panel is folded on narrow viewports; it never changes Canvas.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 700px)');
    const sync = () => {
      setNarrow(media.matches);
    };
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || busy || !title.trim() || !body.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/nook-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, title: title.trim(), body: body.trim(), clientRef: clientRefOf() }),
      });
      const result = (await response.json().catch(() => ({}))) as { path?: string; details?: { path?: string }; error?: string };
      const path = result.path ?? result.details?.path;
      if (!response.ok || !path) {
        throw new Error(result.error || `Could not leave this note (${response.status})`);
      }
      setTitle('');
      setBody('');
      setMessage('Note left in this nook.');
      onCreated?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not leave this note.');
    } finally {
      setBusy(false);
    }
  };

  const toggleLabel = collapsed ? 'Leave a note' : narrow ? 'Hide note form' : 'Fold note form';

  // Collapsed is a compact pill, not a full-width panel: at 390px a fixed
  // 18rem width reaches the lower-left live lane and overlaps its control.
  // Only the open form needs the reading width.
  const widthClass = collapsed ? 'w-fit' : 'w-[min(18rem,calc(100vw-1.5rem))]';

  return (
    <section className={`${widthClass} max-w-full rounded-2xl border border-ink/10 bg-paper-card/95 p-2 shadow-soft backdrop-blur-md`} aria-label="Leave a note">
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls="nook-note-form"
        onClick={() => setCollapsed(value => !value)}
        className="flex min-h-9 w-full items-center justify-between gap-3 rounded-xl border border-ink/10 bg-paper-wall/60 px-3 py-1.5 text-left text-xs text-ink transition-colors hover:bg-paper-wall"
      >
        <span className="italic">{toggleLabel}</span>
        <span aria-hidden className="font-mono text-[11px] text-ink/50">{collapsed ? '+' : '−'}</span>
      </button>
      <form id="nook-note-form" hidden={collapsed} onSubmit={submit} className="pt-2">
        <input
          value={title}
          onChange={event => setTitle(event.target.value)}
          onCompositionStart={imeGuardRef.current.onCompositionStart}
          onCompositionEnd={imeGuardRef.current.onCompositionEnd}
          onKeyDown={event => { imeGuardRef.current.guardKey(event); }}
          placeholder="Title"
          aria-label="Note title"
          disabled={disabled || busy}
          className="mb-2 w-full rounded-lg border border-ink/10 bg-paper-wall/60 px-2 py-1.5 text-xs text-ink outline-none"
        />
        <textarea
          value={body}
          onChange={event => setBody(event.target.value)}
          onCompositionStart={imeGuardRef.current.onCompositionStart}
          onCompositionEnd={imeGuardRef.current.onCompositionEnd}
          onKeyDown={event => { imeGuardRef.current.guardKey(event); }}
          placeholder="Write something for this nook…"
          aria-label="Note body"
          disabled={disabled || busy}
          rows={3}
          className="mb-2 w-full resize-none rounded-lg border border-ink/10 bg-paper-wall/60 px-2 py-1.5 text-xs text-ink outline-none"
        />
        <button
          type="submit"
          disabled={disabled || busy || !title.trim() || !body.trim()}
          className="rounded-lg bg-ink px-3 py-1.5 text-xs text-white disabled:opacity-40"
        >
          {busy ? 'Leaving note…' : 'Leave note'}
        </button>
      </form>
      {disabled && (
        <div role="status" className="mt-2 text-[10px] text-ink/60">
          {lockMessage || 'Notes are unavailable while the world is busy.'}
        </div>
      )}
      {message && (
        <div role="status" className="mt-2 text-[10px] text-ink/70">
          {message}
        </div>
      )}
    </section>
  );
};
