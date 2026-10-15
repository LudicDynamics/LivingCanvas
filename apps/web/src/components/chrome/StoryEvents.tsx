/**
 * Event cards.
 *
 * A story event (actions/story-event.ts) is narration with an address — "老莫
 * saw you open his logbook" — so it is shown as a card the player can read, not
 * as a one-line toast: who or what it landed on, the title, what happened.
 * Cards stack (newest on top, at most three) and fade after a while or on click.
 * Events replayed on reconnect are older than a minute and are not re-shown.
 */
import React, { useEffect, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import './story-events.css';

interface StoryEventCard {
  id: string;
  kind: 'character' | 'item' | 'place';
  name: string;
  title: string;
  text: string;
}

const SHOW_MS = 14_000;
const FRESH_MS = 60_000;
// One card at a time: every event is also in the message drawer, so the screen never stacks them.
const MAX_CARDS = 1;

function cardOf(detail: unknown): StoryEventCard | null {
  const ev = detail as { id?: unknown; createdAt?: unknown; detail?: Record<string, unknown> } | null;
  const d = ev?.detail;
  if (!ev || typeof ev.id !== 'string' || !d) return null;
  // A companion hint is a line said in the dock / a margin note, never an event card.
  if (typeof d.hint === 'string') return null;
  if (typeof ev.createdAt === 'string' && Date.now() - Date.parse(ev.createdAt) > FRESH_MS) return null;
  const kind = d.kind === 'character' || d.kind === 'item' || d.kind === 'place' ? d.kind : null;
  if (!kind || typeof d.title !== 'string' || typeof d.text !== 'string' || typeof d.name !== 'string') return null;
  return { id: ev.id, kind, name: d.name, title: d.title, text: d.text };
}

export function StoryEvents(): React.ReactElement | null {
  const { t } = useLocale();
  const [cards, setCards] = useState<StoryEventCard[]>([]);

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const onEvent = (e: Event) => {
      const card = cardOf((e as CustomEvent).detail);
      if (!card) return;
      setCards((prev) => (prev.some((c) => c.id === card.id) ? prev : [card, ...prev].slice(0, MAX_CARDS)));
      timers.set(card.id, setTimeout(() => setCards((prev) => prev.filter((c) => c.id !== card.id)), SHOW_MS));
    };
    window.addEventListener('airp:story-event', onEvent);
    return () => {
      window.removeEventListener('airp:story-event', onEvent);
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  if (cards.length === 0) return null;
  const kindLabel = { character: t('Character'), item: t('Item'), place: t('Place') } as const;
  return (
    <div className="story-events" role="log" aria-live="polite" aria-label={t('Events')}>
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          className="story-event"
          data-kind={card.kind}
          onClick={() => setCards((prev) => prev.filter((c) => c.id !== card.id))}
          aria-label={`${card.title}: ${card.text}`}
        >
          <span className="story-event__where">{kindLabel[card.kind]} · {card.name}</span>
          <strong className="story-event__title">{card.title}</strong>
          <span className="story-event__text">{card.text}</span>
        </button>
      ))}
    </div>
  );
}
