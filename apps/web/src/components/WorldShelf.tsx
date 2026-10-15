import React, { useEffect, useRef, useState } from 'react';
import { airpGateway, type WorldShelf as Shelf } from '../lib/airp-gateway.js';
import { useLocale } from '../lib/i18n.js';
import type { FocusCoordinator, FocusSurfaceLease } from '../lib/focus-coordinator.js';
import { RemoteWorlds } from './RemoteWorlds.js';
import { groupPlaceBadge, savePlaceBadge, type PlaceBadge } from '../lib/world-sync.js';

/** 官方 / 云端 / 本机. */
function PlaceMark({ badge, t }: { badge: PlaceBadge | null; t: (key: string) => string }) {
  return badge ? <em className={`world-place world-place--${badge.tone}`} data-place={badge.tone}>{t(badge.label)}</em> : null;
}

export function WorldShelf({ shelf, loading, onLoad, onClose, onRefresh, focus }: {
  shelf: Shelf; loading: string | null; onLoad: (path: string) => void;
  onClose: () => void; onRefresh: () => Promise<void>; focus?: FocusCoordinator;
}) {
  const { t, locale } = useLocale();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // 「远端」: the hosted AIRP's drafts and public worlds.
  const [remote, setRemote] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  const requestClose = () => {
    const lease = leaseRef.current;
    if (lease && !lease.markClosing()) return;
    closeHandler.current();
  };
  useEffect(() => {
    if (!focus) return;
    let previous: HTMLElement | null = null;
    let restored = false;
    const lease = focus.registerSurface({
      key: 'world-shelf',
      owner: 'world-shelf',
      // Above the lobby wall (WorldLauncher, 400) it opens over: at 390 Esc closed the wall behind it instead.
      priority: 402,
      root: panel.current,
      close: () => closeHandler.current(),
      returnFocus: {
        capture: () => {
          if (previous) return;
          const active = document.activeElement;
          if (active instanceof HTMLElement && active !== document.body) previous = active;
        },
        restore: () => {
          if (restored) return false;
          restored = true;
          if (previous && document.contains(previous)) {
            previous.focus();
            return true;
          }
          return false;
        },
      },
    });
    leaseRef.current = lease;
    return () => {
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.unregister();
      window.requestAnimationFrame(() => {
        if (!restored && previous && document.contains(previous)) {
          restored = true;
          previous.focus();
        }
      });
    };
  }, [focus]);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!busy && !panel.current?.contains(e.target as Node)) requestClose(); };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, [busy]);
  const group = shelf.groups?.find(g => g.id === selected);
  const remove = async (savePath: string) => {
    setBusy(true); setMessage('');
    try {
      await airpGateway.deleteSave(savePath);
      setConfirm(null);
      setMessage(t('Save moved to trash.'));
      await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <section ref={panel} className="prototype-world-picker world-directory" role="dialog" aria-modal="false" aria-label={t(group ? 'Saved games' : 'Choose a world')}>
      <header className="world-directory__header"><span>{t('WORLD SHELF')}</span><button autoFocus disabled={busy} onClick={requestClose} aria-label={t('Close')}>×</button></header>
      <h2>{remote ? t('Remote') : group?.name || t('Choose a world')}</h2>
      {!group && <button type="button" disabled={busy || loading !== null} aria-pressed={remote} onClick={() => { setRemote((value) => !value); setMessage(''); }}>{remote ? t('← All worlds') : t('Remote worlds')}</button>}
      {!group && remote ? <RemoteWorlds onChanged={onRefresh} disabled={busy || loading !== null} /> : !group ? (shelf.groups || []).map((entry, index) => <button className="world-directory__entry" key={entry.id} onClick={() => { setSelected(entry.id); setMessage(''); }}>
        <small aria-hidden="true">{String(index + 1).padStart(2, '0')}</small><div><b>{entry.name} <PlaceMark badge={groupPlaceBadge(entry.place)} t={t} /></b><span>{t('{count} saves', { count: entry.saves.length })}</span></div><span aria-hidden="true">↗</span>
      </button>) : <>
        <button disabled={busy || loading !== null} onClick={() => { setSelected(null); setConfirm(null); setMessage(''); }}>{t('← All worlds')}</button>
        {group.templatePath && <button disabled={busy || loading !== null} onClick={() => onLoad(group.templatePath!)}>{t('＋ Start a new game')}</button>}
        <h3>{t('Saved games')}</h3>
        {!group.saves.length && <p>{t('No saves yet. Start a new game above.')}</p>}
        {group.saves.map(save => <article className="world-save-row" key={save.path}>
          <button className="world-save-open" disabled={busy || loading !== null || confirm !== null} onClick={() => onLoad(save.path)}>
            <b>{t('Save ID')}: {save.id} <PlaceMark badge={savePlaceBadge(save.place)} t={t} /></b>
            <span>{new Date(save.updatedAt).toLocaleString(locale)}{save.active ? ` · ${t('Current game')}` : ''}{loading === save.path ? t(' · opening…') : ''}</span>
          </button>
          <button disabled={busy || loading !== null || save.active} aria-label={`${t('Delete save')}: ${save.id}`} title={save.active ? t('Open another save before deleting this one.') : undefined} onClick={() => { setConfirm(save.path); setMessage(''); }}>{t('Delete save')}</button>
          {confirm === save.path && <div className="world-save-confirm">
            <p>{t('Move this save to trash? Its files will be kept for recovery.')}</p>
            <button disabled={busy} onClick={() => void remove(save.path)}>{t('Move to trash')}</button>
            <button disabled={busy} onClick={() => setConfirm(null)}>{t('Cancel')}</button>
          </div>}
        </article>)}
      </>}
      {message && <p role="status">{message}</p>}
      <button className="prototype-close" disabled={busy} onClick={requestClose}>{t('Continue this story')}</button>
    </section>;
}
