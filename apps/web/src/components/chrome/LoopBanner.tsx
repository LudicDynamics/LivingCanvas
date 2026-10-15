/**
 * 「第 N 轮」: a looping world went back to its first
 * morning. The world files are already the loop start's (the layer refetch
 * shows them); this is the one line that tells the player it happened, and
 * that only they remember. The picture before it is the world's own
 * `show_cg`; the words after it are the writer's.
 *
 * Opens on `airp:loop-reset` (`useWorld` relays a `loop_reset` world event);
 * `lib/loop-banner.ts` decides what it says.
 */
import React, { useEffect, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { loopOf } from '../../lib/loop-banner.js';
import './loop-banner.css';

const SHOW_MS = 5_000;

export function LoopBanner(): React.ReactElement | null {
  const { t } = useLocale();
  const [shown, setShown] = useState<{ id: string; loop: number } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onReset = (e: Event) => {
      const next = loopOf((e as CustomEvent).detail);
      if (!next) return;
      setShown(next);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setShown(null), SHOW_MS);
    };
    window.addEventListener('airp:loop-reset', onReset);
    return () => {
      window.removeEventListener('airp:loop-reset', onReset);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!shown) return null;
  return (
    <button key={shown.id} type="button" className="loop-banner" role="status" aria-live="polite" onClick={() => setShown(null)}>
      <strong className="loop-banner__round">{t('Loop {n}', { n: shown.loop })}</strong>
      <span className="loop-banner__line">{t('Back to the first morning. Only you remember.')}</span>
    </button>
  );
}
