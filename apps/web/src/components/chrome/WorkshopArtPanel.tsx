/**
 * The 素材 panel: in creation mode, every picture
 * the world needs with the prompt that paints it. The current place comes
 * first — its scene picture and its map, one toggle apart, the prompt on top —
 * then portraits, CGs, endings and the other places.
 *
 * It is the first tab of the planned authoring panel (the design notes
 * §panel); the second, 设定, edits the world type / rules / structure the
 * create form picked with the same picker. 状态 /
 * 触发条件 / 结果 are placeholders until they are built.
 * Mounted only for the author's own draft (`isArtAuthoring`).
 */
import { track } from '../../lib/analytics.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { airpGateway, type WorkshopArtList, type WorkshopArtSlot, type WorkshopThemeSaved } from '../../lib/airp-gateway.js';
import { useLocale } from '../../lib/i18n.js';
import { formatSize, quotaNoticeText, remoteErrorCode, remoteErrorText } from '../../lib/remote-sync.js';
import { OpenAccountButton } from './AccountPanel.js';
import {
  ART_PANEL_TABS,
  artPreview,
  artSections,
  base64OfDataUrl,
  promptDirty,
  uploadProblem,
  withSlot,
  type ArtPanelTab,
} from '../../lib/workshop-art.js';
import { sameThemeDraft, themeDraftOf, themeRequestOf, type ThemeDraft } from '../../lib/world-theme.js';
import { ThemePicker } from '../ThemePicker.js';
import { SheetEditor } from './SheetEditor.js';
import { MusicPicker } from './MusicPicker.js';
import './workshop-art.css';

/** The slot list for the active draft; `key` changes when the world or its files may have changed. */
export function useWorkshopArt(enabled: boolean, key: string) {
  const [art, setArt] = useState<WorkshopArtList | null>(null);
  const reload = useCallback(async () => {
    if (!enabled) { setArt(null); return; }
    try { setArt(await airpGateway.workshopArt()); } catch { setArt(null); }
  }, [enabled]);
  useEffect(() => { void reload(); }, [reload, key]);
  const update = useCallback((slot: WorkshopArtSlot | null) => {
    setArt((current) => (current ? { ...current, slots: withSlot(current.slots, slot) } : current));
  }, []);
  return { art, reload, update };
}

interface PanelProps {
  art: WorkshopArtList | null;
  layer: string;
  layerName: string;
  open: boolean;
  onToggle(): void;
  onNavigate(layer: string): void;
  /** A slot changed on the server; `landed`: a picture landed, so the page may need a refresh. */
  onSlot(slot: WorkshopArtSlot | null, landed: boolean): void;
  /** The 设定 tab saved a new theme (world.json `theme` + `mode` changed). */
  onThemeSaved?(saved: WorkshopThemeSaved): void;
  /** 试玩: start a fresh play copy of this draft (its latest content, at the opening). */
  onTrial?(): void;
  /** 「清除草稿里的试玩痕迹」 rewrote cards of the draft itself. */
  onPlayCleared?(): void;
  /** The draft's save path (`worlds/made-…`), for 「上传到我的远端草稿」. */
  worldPath?: string;
}

export function WorkshopArtPanel({ art, layer, layerName, open, onToggle, onNavigate, onSlot, onThemeSaved, onTrial, onPlayCleared, worldPath }: PanelProps) {
  const { t } = useLocale();
  const [tab, setTab] = useState<ArtPanelTab>('assets');
  const [view, setView] = useState<'scene' | 'map'>('scene');
  const [expanded, setExpanded] = useState<string | null>(null);
  const sections = artSections(art?.slots ?? [], layer);
  const current = view === 'map' ? sections.map : sections.scene;
  const canPaint = art?.canPaint === true;

  // 试玩 is the one action an author reaches for between every two edits, so it
  // stays on screen with the panel open or collapsed.
  const trial = onTrial && (
    <button type="button" className="workshop-art__trial" data-testid="workshop-trial" title={t('Play this world from its opening, as a player would. The draft is not changed.')} onClick={onTrial}>
      {t('Play test')}
    </button>
  );

  if (!open) {
    return (
      <>
        <button type="button" className="workshop-art__tab-handle" onClick={onToggle} aria-expanded={false}>
          {t('Assets')}
        </button>
        {trial && <div className="workshop-art__trial-float">{trial}</div>}
      </>
    );
  }

  const list = (title: string, slots: WorkshopArtSlot[], navigable = false) => slots.length > 0 && (
    <section className="workshop-art__section">
      <h3>{title}</h3>
      <ul>
        {slots.map((slot) => (
          <li key={slot.id} className="workshop-art__row" data-exists={slot.exists}>
            <button type="button" className="workshop-art__row-head" aria-expanded={expanded === slot.id} onClick={() => setExpanded(expanded === slot.id ? null : slot.id)}>
              <span className="workshop-art__dot" aria-hidden="true" />
              <span className="workshop-art__row-label">{slot.label}</span>
              <span className="workshop-art__row-kind">{t(KIND_LABEL[slot.kind])}</span>
            </button>
            {navigable && slot.layer && slot.layer !== layer && (
              <button type="button" className="workshop-art__go" onClick={() => onNavigate(slot.layer!)}>{t('Go there')}</button>
            )}
            {expanded === slot.id && <SlotEditor slot={slot} canPaint={canPaint} onSlot={onSlot} />}
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <aside className="workshop-art" aria-label={t('Authoring panel')}>
      <header className="workshop-art__header">
        <div role="tablist" className="workshop-art__tabs">
          {ART_PANEL_TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              disabled={!entry.ready}
              title={entry.ready ? undefined : t('Coming soon')}
              onClick={() => setTab(entry.id)}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>
        {trial}
        <button type="button" className="workshop-art__close" onClick={onToggle} aria-label={t('Collapse')}>›</button>
      </header>
      {tab === 'setup' ? (
        <SetupTab onSaved={onThemeSaved} onPlayCleared={onPlayCleared} worldPath={worldPath} layer={layer} layerName={layerName} />
      ) : tab !== 'assets' ? (
        <p className="workshop-art__soon">{t('Coming soon')}</p>
      ) : !art ? (
        <p className="workshop-art__soon">{t('Loading…')}</p>
      ) : (
        <div className="workshop-art__body">
          <section className="workshop-art__section workshop-art__current">
            <h3>{t('This place')} · {layerName}</h3>
            <div role="radiogroup" className="workshop-art__switch">
              <button type="button" role="radio" aria-checked={view === 'scene'} onClick={() => setView('scene')}>{t('Scene picture')}</button>
              <button type="button" role="radio" aria-checked={view === 'map'} onClick={() => setView('map')}>{t('Map')}</button>
            </div>
            {current ? <SlotEditor key={current.id} slot={current} canPaint={canPaint} onSlot={onSlot} /> : <p className="workshop-art__soon">{t('This place has no README yet.')}</p>}
          </section>
          {list(t('Portraits'), sections.portraits)}
          {list(t('CGs'), sections.cgs)}
          {list(t('Endings'), sections.endings)}
          {list(t('Other places'), sections.places, true)}
        </div>
      )}
    </aside>
  );
}

/**
 * 设定: the draft's world type, rule pack and structure, with the create form's
 * own picker. Saving rewrites world.json `theme` + `mode` and adds the new
 * type's default states; states the old type brought are kept (and named).
 */
function SetupTab({ onSaved, onPlayCleared, worldPath, layer, layerName }: { onSaved?: PanelProps['onThemeSaved']; onPlayCleared?: PanelProps['onPlayCleared']; worldPath?: string; layer: string; layerName: string }) {
  const { t } = useLocale();
  const [stored, setStored] = useState<ThemeDraft | null>(null);
  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheetsVersion, setSheetsVersion] = useState(0);
  /** Sheets a rule-system switch would replace, while the author decides. */
  const [resetAsk, setResetAsk] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    airpGateway.workshopTheme()
      .then((state) => { if (!alive) return; const d = themeDraftOf(state.theme); setStored(d); setDraft(d); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed) return <p className="workshop-art__soon">{t('That did not work. Try again.')}</p>;
  if (!stored || !draft) return <p className="workshop-art__soon">{t('Loading…')}</p>;
  const dirty = !sameThemeDraft(stored, draft);

  const save = async (confirmReset = false) => {
    setBusy(true);
    setMessage(null);
    setResetAsk(null);
    try {
      const saved = await airpGateway.saveWorkshopTheme(themeRequestOf(draft), confirmReset);
      const next = themeDraftOf(saved.theme);
      setStored(next);
      setDraft(next);
      const kept = [...saved.unused.player, ...saved.unused.world, ...saved.unused.character];
      const reset = saved.sheetsReset?.length ? ` ${t('The character sheets now follow the new rules: {list}.', { list: saved.sheetsReset.join(', ') })}` : '';
      setMessage((kept.length
        ? `${t('Saved. The writer follows the new setup from the next turn.')} ${t('States the previous setup brought are kept: {list}. Delete them from the READMEs if the world no longer needs them.', { list: [...new Set(kept)].join(', ') })}`
        : t('Saved. The writer follows the new setup from the next turn.')) + reset);
      setSheetsVersion((v) => v + 1);
      onSaved?.(saved);
    } catch (error) {
      const payload = (error as { payload?: { error?: unknown; code?: unknown; replace?: unknown } } | null)?.payload;
      // A CoC ↔ D&D switch replaces the character sheets: ask first.
      if (payload?.code === 'sheets_reset_required' && Array.isArray(payload.replace)) {
        setResetAsk(payload.replace.filter((x): x is string => typeof x === 'string'));
      } else {
        setMessage(typeof payload?.error === 'string' ? payload.error : t('That did not work. Try again.'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="workshop-art__body workshop-art__setup" role="region" aria-label={t('World setup')}>
      {resetAsk && (
        <div className="workshop-ask" role="alertdialog" aria-modal="true" aria-labelledby="workshop-ask-title" data-testid="sheets-reset-confirm"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setResetAsk(null); setDraft(stored); } }}>
          <div className="workshop-ask__card">
            <p id="workshop-ask-title" className="workshop-ask__title">{t('Switch the rule system?')}</p>
            <p>{t('The new rules read skills differently, so these character sheets will be replaced with the new rules’ defaults:')}</p>
            <ul className="workshop-ask__list">{resetAsk.map((f) => <li key={f}>{f}</li>)}</ul>
            <div className="workshop-art__actions">
              <button type="button" autoFocus onClick={() => { setResetAsk(null); setDraft(stored); }}>{t('Cancel')}</button>
              <button type="button" className="workshop-ask__go" onClick={() => void save(true)}>{t('Replace the sheets')}</button>
            </div>
          </div>
        </div>
      )}
      <p className="workshop-art__when">{t('What this world is. Changing it keeps everything already built; new default states are added, none are removed.')}</p>
      <ThemePicker theme={draft} onChange={(next) => { setDraft(next); setMessage(null); }} disabled={busy} />
      <div className="workshop-art__actions">
        <button type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? t('Working…') : t('Save setup')}</button>
        <button type="button" disabled={busy || !dirty} onClick={() => { setDraft(stored); setMessage(null); }}>{t('Revert')}</button>
      </div>
      {message && <p className="workshop-art__message" role="status">{message}</p>}
      <MusicPicker layer={layer} layerName={layerName} />
      <SheetEditor version={sheetsVersion} />
      <ClearPlayTraces onCleared={onPlayCleared} />
      {worldPath && <RemoteUpload worldPath={worldPath} />}
    </div>
  );
}

/**
 * 「清除草稿里的试玩痕迹」: for a draft that was played in place (before 试玩
 * existed, or by testing a roll while building). Runs the trial reset on the
 * draft itself behind an in-panel confirm; the server backs every text file up
 * under `.airpworld/backups/` first.
 */
function ClearPlayTraces({ onCleared }: { onCleared?: () => void }) {
  const { t } = useLocale();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const clear = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const done = await airpGateway.clearDraftPlay();
      const count = done.reset.length + done.deleted.length + done.moved.length;
      const lines = [count ? t('Cleared {count} play traces. A backup is in {path}.', { count, path: done.backup }) : t('No play traces found.')];
      if (done.unresolved.length) lines.push(t('Left as they are: {list}', { list: done.unresolved.map((u) => `${u.path} (${u.reason})`).join('; ') }));
      setMessage(lines.join(' '));
      if (count) onCleared?.();
    } catch (error) {
      const payload = (error as { payload?: { error?: unknown } } | null)?.payload;
      setMessage(typeof payload?.error === 'string' ? payload.error : t('That did not work. Try again.'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <section className="workshop-art__section workshop-art__clear-play">
      <h3>{t('Play traces')}</h3>
      <p className="workshop-art__when">{t('Play test always starts from a clean copy. If this draft itself was played, clear what play left in it: rolled dice, found and picked-up items, states, endings, NPC talk.')}</p>
      {confirming ? (
        <div className="workshop-art__actions" role="group" aria-label={t('Clear play traces from the draft')}>
          <button type="button" disabled={busy} onClick={() => void clear()}>{busy ? t('Working…') : t('Clear them')}</button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}>{t('Cancel')}</button>
        </div>
      ) : (
        <div className="workshop-art__actions">
          <button type="button" data-testid="workshop-clear-play" onClick={() => { setConfirming(true); setMessage(null); }}>{t('Clear play traces from the draft')}</button>
        </div>
      )}
      {message && <p className="workshop-art__message" role="status">{message}</p>}
    </section>
  );
}

/**
 * 「上传到我的远端草稿」: bundle this draft — its
 * authored files at the opening, never play state or sessions — and upload it
 * into the owner's own space on the connected remote. The same draft uploads
 * again as a new revision of the same remote draft.
 */
function RemoteUpload({ worldPath }: { worldPath: string }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const upload = async () => {
    setBusy(true);
    setMessage(null);
    setSignedOut(false);
    try {
      const done = await airpGateway.pushToRemote(worldPath);
      const lines = [t('Uploaded as revision {revision} of your remote draft ({size}, {files} files).', { revision: done.revision, size: formatSize(done.bytes), files: done.files })];
      if (done.renamed) lines.push(t('The remote gave it the id {id}.', { id: done.id }));
      if (done.skipped.length) lines.push(t('Left out (file type not allowed): {list}', { list: done.skipped.join(', ') }));
      const near = quotaNoticeText(done.quota);
      if (near) lines.push(near);
      setMessage(lines.join(' '));
    } catch (error) {
      const out = ['not_connected', 'signed_out'].includes(remoteErrorCode(error) ?? '');
      setSignedOut(out);
      setMessage(out
        ? t('Not signed in. Sign in with your account, then upload again.')
        : remoteErrorText(error, t('That did not work. Try again.')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="workshop-art__section workshop-art__remote">
      <h3>{t('Remote')}</h3>
      <p className="workshop-art__when">{t('Upload this draft to your own space on the connected remote. Only the authored world travels: no play traces, sessions or memory. 「Publish」 on the world’s launcher brick uploads and makes it public in one step.')}</p>
      <div className="workshop-art__actions">
        <button type="button" data-testid="workshop-remote-upload" disabled={busy} onClick={() => void upload()}>{busy ? t('Packing and uploading…') : t('Upload to my remote drafts')}</button>
      </div>
      {message && <p className="workshop-art__message" role="status">{message}</p>}
      {signedOut && <div className="workshop-art__actions"><OpenAccountButton cloud /></div>}
    </section>
  );
}

const KIND_LABEL: Record<WorkshopArtSlot['kind'], string> = { scene: 'Scene picture', map: 'Map', portrait: 'Portrait', cg: 'CG', item: 'Item' };

function SlotEditor({ slot, canPaint, onSlot }: { slot: WorkshopArtSlot; canPaint: boolean; onSlot: PanelProps['onSlot'] }) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(slot.prompt);
  const [busy, setBusy] = useState<'save' | 'paint' | 'upload' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cutout, setCutout] = useState(slot.cutout === true);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(slot.prompt); }, [slot.id, slot.prompt]);
  const preview = artPreview(slot);
  const dirty = promptDirty(slot, draft);

  const run = async (kind: 'save' | 'paint' | 'upload', job: () => Promise<{ slot: WorkshopArtSlot | null }>, landed: boolean) => {
    setBusy(kind);
    setMessage(null);
    try {
      const result = await job();
      onSlot(result.slot, landed);
      setMessage(kind === 'save' ? t('Saved') : null);
    } catch (error) {
      const payload = (error as { payload?: { error?: unknown } } | null)?.payload;
      if (kind === 'paint') track('image_failed', { reason: 'workshop_art' });
      setMessage(typeof payload?.error === 'string' ? payload.error : t('That did not work. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const onFile = (picked: File | undefined) => {
    if (!picked) return;
    const problem = uploadProblem(picked);
    if (problem) { setMessage(problem === 'type' ? t('The picture must be a PNG, JPEG or WebP.') : t('The picture must be 8 MB or smaller.')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const data = base64OfDataUrl(String(reader.result ?? ''));
      void run('upload', () => airpGateway.uploadArt(slot.id, picked.type, data, cutout), true);
    };
    reader.readAsDataURL(picked);
  };

  return (
    <div className="workshop-art__editor" data-kind={slot.kind}>
      <label className="workshop-art__prompt">
        <span>{t('Prompt')}</span>
        <textarea
          value={draft}
          rows={4}
          maxLength={4000}
          placeholder={t('Write the prompt for this picture…')}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <div className="workshop-art__preview" data-state={preview.state}>
        {preview.state === 'missing' ? (
          <div className="workshop-art__placeholder">
            <strong>{t('No picture yet')}</strong>
            <span>{slot.prompt || t('Write the prompt for this picture…')}</span>
          </div>
        ) : (
          <img src={preview.url} alt={slot.label} loading="lazy" />
        )}
        {preview.state === 'in-use' && <span className="workshop-art__badge">{t('Showing the old picture until this one is painted')}</span>}
      </div>
      <code className="workshop-art__path">{slot.path}</code>
      {slot.when && <p className="workshop-art__when">{slot.when}</p>}
      {slot.kind === 'portrait' && (
        <label className="workshop-art__cutout">
          <input type="checkbox" checked={cutout} onChange={(event) => setCutout(event.target.checked)} />
          {t('Cut out the background later')}
        </label>
      )}
      <div className="workshop-art__actions">
        <button type="button" disabled={busy !== null || !canPaint || !draft.trim()} title={canPaint ? undefined : t('No image model is configured: upload a picture instead.')} onClick={() => void run('paint', () => airpGateway.generateArt(slot.id, draft.trim(), cutout), true)}>
          {busy === 'paint' ? t('Painting…') : t('Generate')}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => file.current?.click()}>
          {busy === 'upload' ? t('Uploading…') : t('Upload')}
        </button>
        <button type="button" disabled={busy !== null || !dirty || !draft.trim()} onClick={() => void run('save', () => airpGateway.saveArtPrompt(slot.id, draft.trim()), false)}>
          {t('Save prompt')}
        </button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
      {message && <p className="workshop-art__message" role="status">{message}</p>}
    </div>
  );
}
