/**
 * MapCardPanel — a card, opened from its pin on the map.
 *
 * Not a second implementation: the reader text is the card's own body (the
 * same letter-body rule as `CanvasObject`), and everything you can DO with the
 * card — choices, the dice roller, take along (which honours `portable:
 * false`), enter, talk, its declared actions — is `EntityInteractions`, the
 * component the canvas card uses, in its `anchored` mode (the map places the
 * panel; the canvas side-placement is skipped). A roll made here posts the
 * same request, so the App-level DiceCeremony plays over the map.
 */
import React from 'react';
import { useLocale } from '../../lib/i18n.js';
import { MarkdownText } from '../../lib/md.js';
import { EntityInteractions } from '../narrative/EntityInteractions.js';
import type { FocusCoordinator } from '../../lib/focus-coordinator.js';

export interface MapCardItem {
  path: string;
  filename?: string;
  body?: string;
  frontmatter: Record<string, any> | null;
}

/** The text the reader shows: a letter keeps its body in frontmatter. */
export function readerBodyOf(item: MapCardItem): string {
  return item.frontmatter?.component === 'letter' && typeof item.frontmatter.body === 'string'
    ? item.frontmatter.body
    : item.body ?? '';
}

export function titleOfCard(item: MapCardItem): string {
  const fm = item.frontmatter ?? {};
  const name = fm.title ?? fm.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  return (item.filename ?? item.path.split('/').pop() ?? item.path).replace(/\.md$/, '');
}

export function MapCardPanel({ item, style, className = 'map-float map-card', focus, onClose, onEntityAction, onEnterPlace, onMeetCharacter }: {
  item: MapCardItem;
  style?: React.CSSProperties;
  className?: string;
  focus?: FocusCoordinator;
  onClose(): void;
  onEntityAction?(prompt: string): void;
  onEnterPlace?(target: string): void;
  onMeetCharacter?(id: string): void;
}): React.ReactElement {
  const { t } = useLocale();
  const title = titleOfCard(item);
  const body = readerBodyOf(item).trim();
  return (
    <section className={className} style={style} role="dialog" aria-label={title} data-card-path={item.path}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <header className="map-card__head">
        <h3>{title}</h3>
        <button type="button" className="map-card__close" onClick={onClose} aria-label={t('Close')} title={t('Close')}>×</button>
      </header>
      {body && <div className="map-card__reader"><MarkdownText text={body} /></div>}
      <EntityInteractions
        anchored
        active
        item={item}
        focus={focus}
        onChoice={onEntityAction}
        onEnterGate={onEnterPlace}
        onOpenCharacter={onMeetCharacter}
      />
    </section>
  );
}
