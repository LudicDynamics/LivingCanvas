import { useEffect, useState } from 'react';

/** Receipts come only from persisted world events, never tool-start guesses. */
export function WorldActivityToast({ worldKey }: { worldKey?: string }) {
  const [message, setMessage] = useState('');
  useEffect(() => {
    setMessage('');
    const seen = new Set<string>();
    const pending = new Map<string, string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hide: ReturnType<typeof setTimeout> | undefined;
    let lastShown = 0;
    const receive = (raw: Event) => {
      const frame = (raw as CustomEvent).detail;
      if (frame?.type !== 'world_event') return;
      const event = frame.event;
      if (!event?.id || seen.has(event.id)) return;
      seen.add(event.id); if (seen.size > 512) seen.delete(seen.values().next().value!);
      const d = event.detail ?? {};
      if (event.type === 'entity_created' && d.kind !== 'chalk' && typeof d.path === 'string' && !d.path.endsWith('/README.md')) pending.set(d.path, `Created: ${d.name || 'item'}`);
      if (event.type === 'entity_moved' && typeof d.from === 'string' && typeof d.to === 'string' && d.from !== d.to && !d.from.endsWith('/README.md')) pending.set(d.to, `${d.to.startsWith('player/') ? 'Collected' : 'Moved'}: ${d.name || 'item'}`);
      if (!pending.size || timer) return;
      timer = setTimeout(() => {
        const values = [...pending.values()]; pending.clear(); timer = undefined;
        setMessage(values.slice(0, 2).join(' · ') + (values.length > 2 ? ` · +${values.length - 2} more` : ''));
        lastShown = Date.now(); clearTimeout(hide); hide = setTimeout(() => setMessage(''), 3500);
      }, Math.max(800, lastShown + 4500 - Date.now()));
    };
    window.addEventListener('airp:agent-frame', receive);
    return () => { clearTimeout(timer); clearTimeout(hide); window.removeEventListener('airp:agent-frame', receive); };
  }, [worldKey]);
  return message ? <aside className="world-activity-toast" role="status">{message}</aside> : null;
}
