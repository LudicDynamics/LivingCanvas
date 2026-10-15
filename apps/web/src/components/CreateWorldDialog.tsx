/**
 * CreateWorldDialog — the workshop's front door.
 *
 * Opened from the launcher's first brick. It asks for exactly what the shelf
 * needs to show a world — a name, a line, a language and a cover — and nothing
 * about the story: the story is what the author tells the writer once inside.
 * The cover is mandatory and comes one of two ways, painted from a prompt by
 * the server's image model or brought as a picture; the tab remembers which,
 * and a failed painting offers the upload path instead of a dead end.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AirpRequestError, airpGateway, type CreateWorldRequest } from '../lib/airp-gateway.js';
import { LOCALES, LOCALE_NAMES, useLocale, type Locale } from '../lib/i18n.js';
import type { FocusCoordinator, FocusSurfaceLease } from '../lib/focus-coordinator.js';
import { DEFAULT_WORLD_TYPE, suggestedViewOf, themeDraftFor, themeRequestOf, type ThemeDraft } from '../lib/world-theme.js';
import { ThemePicker } from './ThemePicker.js';
import './create-world.css';

const LANGUAGES: readonly [Locale, string][] = LOCALES.map(code => [code, LOCALE_NAMES[code]]);
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];
/** Mirrors the server's decoded ceiling; refusing here saves a 12 MB round trip. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

type CoverMode = 'generate' | 'upload';

/** Read a picked file as the base64 the create body carries. Rejects on a read failure. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function CreateWorldDialog({ onCreated, onClose, focus }: {
  /** The world exists; the caller loads it and enters. */
  onCreated: (worldPath: string) => void;
  onClose: () => void;
  focus?: FocusCoordinator;
}) {
  const { t, locale: uiLocale } = useLocale();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [locale, setLocale] = useState<Locale>(uiLocale);
  const [mode, setMode] = useState<CoverMode>('generate');
  const [canPaint, setCanPaint] = useState<boolean | null>(null);
  const [canSuggest, setCanSuggest] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [promptTouched, setPromptTouched] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the world IS: a type presets rules and
  // structure flags; every part stays editable here.
  const [theme, setTheme] = useState<ThemeDraft>(() => themeDraftFor(DEFAULT_WORLD_TYPE));
  // Which view the world opens in (map-first TRPG worlds). It
  // follows the theme — a world with endings opens on the map — until the
  // author picks one themselves.
  const [viewPicked, setViewPicked] = useState<'canvas' | 'map' | null>(null);
  const view = viewPicked ?? suggestedViewOf(theme);
  // 本机 / 云端: 云端 by default when signed in, 本机 when not. null = this
  // server keeps no account (a hosted seat / an old server): the choice is not shown and nothing is sent.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [locationPicked, setLocationPicked] = useState<'cloud' | 'local' | null>(null);
  const location = locationPicked ?? (signedIn ? 'cloud' : 'local');
  useEffect(() => {
    let alive = true;
    airpGateway.remoteSettings().then(r => { if (alive) setSignedIn(Boolean(r.signedIn)); }).catch(() => { if (alive) setSignedIn(null); });
    return () => { alive = false; };
  }, []);
  const setView = (value: 'canvas' | 'map') => setViewPicked(value);
  const root = useRef<HTMLDivElement>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;

  // Whether this deployment can paint at all decides the default tab: a seat
  // without an image model opens straight on upload rather than on a form
  // that can only fail.
  useEffect(() => {
    let alive = true;
    airpGateway.createWorldConfig()
      .then(config => { if (alive) { setCanPaint(config.canPaint); setCanSuggest(config.canSuggest); if (!config.canPaint) setMode('upload'); } })
      .catch(() => { if (alive) setCanPaint(false); });
    return () => { alive = false; };
  }, []);

  // The cover prompt starts as the description so one sentence does double
  // duty; once the author edits the prompt it is theirs and stops following.
  useEffect(() => {
    if (!promptTouched) setPrompt(description);
  }, [description, promptTouched]);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const requestClose = () => {
    if (busy) return;
    const lease = leaseRef.current;
    if (lease && !lease.markClosing()) return;
    closeHandler.current();
  };

  useEffect(() => {
    if (!focus) return;
    let opener: HTMLElement | null = null;
    let restored = false;
    const lease = focus.registerSurface({
      key: 'create-world',
      owner: 'workspace',
      priority: 410,
      root: root.current,
      close: () => { if (!busy) closeHandler.current(); },
      returnFocus: {
        capture: () => {
          if (opener) return;
          const active = document.activeElement;
          if (active instanceof HTMLElement && active !== document.body) opener = active;
        },
        restore: () => {
          if (restored) return false;
          restored = true;
          if (opener && document.contains(opener)) { opener.focus(); return true; }
          return false;
        },
      },
    });
    leaseRef.current = lease;
    return () => {
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.unregister();
    };
  }, [focus, busy]);

  const pickFile = (picked: File | null) => {
    setError(null);
    if (!picked) { setFile(null); return; }
    if (!ACCEPT.includes(picked.type)) { setError(t('The cover must be a PNG, JPEG or WebP picture.')); return; }
    if (picked.size > MAX_UPLOAD_BYTES) { setError(t('The cover must be 8 MB or smaller.')); return; }
    setFile(picked);
  };

  const ready = name.trim() !== '' && description.trim() !== '' && (mode === 'generate' ? prompt.trim() !== '' : file !== null);

  // 一键补完: whatever is typed stays; the blanks are filled the way the
  // world-workshop skill expects them. The cover prompt counts as blank until
  // the author has edited it themselves.
  const suggest = async () => {
    if (suggesting || busy) return;
    setSuggesting(true);
    setError(null);
    try {
      const filled = await airpGateway.suggestWorld({
        locale,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(playerName.trim() ? { playerName: playerName.trim() } : {}),
        ...(promptTouched && prompt.trim() ? { coverPrompt: prompt.trim() } : {}),
        theme: themeRequestOf(theme),
      });
      setName(filled.name);
      setDescription(filled.description);
      setPlayerName(filled.playerName);
      setPromptTouched(true);
      setPrompt(filled.coverPrompt);
    } catch (caught) {
      const detail = caught instanceof AirpRequestError && typeof caught.payload?.error === 'string' ? caught.payload.error : caught instanceof Error ? caught.message : String(caught);
      setError(`${t('Could not fill in the form.')} (${detail})`);
    } finally {
      setSuggesting(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const cover: CreateWorldRequest['cover'] = mode === 'generate'
        ? { kind: 'generate', prompt: prompt.trim() }
        : { kind: 'upload', mimeType: file!.type, dataB64: await readAsBase64(file!) };
      const result = await airpGateway.createWorld({
        name: name.trim(),
        description: description.trim(),
        locale,
        ...(playerName.trim() ? { playerName: playerName.trim() } : {}),
        cover,
        theme: themeRequestOf(theme),
        view,
        ...(signedIn !== null ? { location } : {}),
      });
      onCreated(result.worldPath);
    } catch (caught) {
      const code = caught instanceof AirpRequestError && typeof caught.payload?.code === 'string' ? caught.payload.code : '';
      const detail = caught instanceof AirpRequestError && typeof caught.payload?.error === 'string' ? caught.payload.error : caught instanceof Error ? caught.message : String(caught);
      if (code === 'cover_failed' || code === 'no_image_model') {
        // The painting failed, not the world: keep everything typed and point
        // at the other way of getting a cover.
        setError(`${t('The cover could not be painted. Upload a picture instead, or try another prompt.')} (${detail})`);
      } else {
        setError(detail);
      }
      setBusy(false);
    }
  };

  const painting = busy && mode === 'generate';
  return (
    <div ref={root} className="create-world" role="dialog" aria-modal="true" aria-labelledby="create-world-title" onPointerDown={event => { if (event.target === event.currentTarget) requestClose(); }}>
      <form className="create-world__panel" onSubmit={submit} aria-busy={busy}>
        <header className="create-world__header">
          <span>{t('WORKSHOP')}</span>
          <button type="button" onClick={requestClose} disabled={busy} aria-label={t('Close')}>×</button>
        </header>
        <h2 id="create-world-title">{t('Make a world')}</h2>
        <p className="create-world__lede">{t('Give it a name, a line and a cover. Inside, you will tell the writer what the world is, and it will build the rest.')}</p>
        {canSuggest && (
          <button type="button" className="create-world__suggest" disabled={busy || suggesting} onClick={() => void suggest()}>
            {suggesting ? t('Filling in…') : t('✦ Fill it in for me')}
          </button>
        )}

        <label className="create-world__field">
          <span>{t('World name')}</span>
          <input value={name} maxLength={60} autoFocus disabled={busy} onChange={event => setName(event.target.value)} placeholder={t('e.g. The Lighthouse That Forgot')} />
        </label>
        <label className="create-world__field">
          <span>{t('One line about it')}</span>
          <textarea value={description} maxLength={400} rows={2} disabled={busy} onChange={event => setDescription(event.target.value)} placeholder={t('What kind of place, and what is at stake there.')} />
        </label>
        <div className="create-world__row">
          <label className="create-world__field">
            <span>{t('Your name in the world')}</span>
            <input value={playerName} maxLength={60} disabled={busy} onChange={event => setPlayerName(event.target.value)} placeholder={t('Traveller')} />
          </label>
          <div className="create-world__field">
            <span>{t('World language')}</span>
            <div className="create-world__langs" role="group" aria-label={t('World language')}>
              {LANGUAGES.map(([code, label]) => (
                <button key={code} type="button" aria-pressed={locale === code} disabled={busy} onClick={() => setLocale(code)}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        <ThemePicker theme={theme} onChange={setTheme} disabled={busy} note={t('Every choice here stays editable before you publish.')} />

        <div className="create-world__field">
          <span>{t('Opens in')}</span>
          <div className="create-world__langs create-world__view" role="group" aria-label={t('Opens in')}>
            {(['map', 'canvas'] as const).map(value => (
              <button key={value} type="button" aria-pressed={view === value} disabled={busy} onClick={() => setView(value)}>{value === 'map' ? t('Map') : t('Canvas')}</button>
            ))}
          </div>
          <small>{view === 'map' ? t('Players start on the map of each place; they can switch to the canvas.') : t('Players start on the canvas; they can switch to the map.')}</small>
        </div>

        {signedIn !== null && (
          <div className="create-world__field" data-field="location">
            <span>{t('Keep it')}</span>
            <div className="create-world__langs create-world__view" role="group" aria-label={t('Keep it')}>
              {(['cloud', 'local'] as const).map(value => (
                <button key={value} type="button" aria-pressed={location === value} disabled={busy} onClick={() => setLocationPicked(value)}>{value === 'cloud' ? t('Cloud') : t('On this device')}</button>
              ))}
            </div>
            <small>{location === 'cloud'
              ? (signedIn ? t('You play and build it here; it syncs to your account, so your other devices have it too.') : t('You play and build it here; it uploads to your account once you sign in.'))
              : t('Only on this device. Nothing is uploaded; you can upload it to the cloud later.')}</small>
          </div>
        )}

        <div className="create-world__cover">
          <div className="create-world__tabs" role="tablist" aria-label={t('Cover')}>
            <button type="button" role="tab" aria-selected={mode === 'generate'} disabled={busy || canPaint === false} title={canPaint === false ? t('No image model is configured here.') : undefined} onClick={() => setMode('generate')}>{t('Paint the cover')}</button>
            <button type="button" role="tab" aria-selected={mode === 'upload'} disabled={busy} onClick={() => setMode('upload')}>{t('Upload a picture')}</button>
          </div>
          {mode === 'generate' ? (
            <label className="create-world__field">
              <span>{t('Describe the picture')}</span>
              <textarea value={prompt} maxLength={2000} rows={3} disabled={busy} onChange={event => { setPromptTouched(true); setPrompt(event.target.value); }} placeholder={t('A harbour town at dusk, fog rolling in, one lit window…')} />
              <small>{t('One picture, about half a minute. It becomes the cover and the first scene’s backdrop.')}</small>
            </label>
          ) : (
            <label className={`create-world__drop${preview ? ' has-picture' : ''}`}>
              {preview ? <img src={preview} alt="" /> : <span>{t('Choose a PNG, JPEG or WebP, up to 8 MB. A wide picture fits best.')}</span>}
              <input type="file" accept={ACCEPT.join(',')} disabled={busy} onChange={event => pickFile(event.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>

        {error && <p className="create-world__error" role="alert">{error}</p>}
        <footer className="create-world__actions">
          <button type="button" className="create-world__ghost" onClick={requestClose} disabled={busy}>{t('Cancel')}</button>
          <button type="submit" className="create-world__go" disabled={!ready || busy}>
            {painting ? t('Painting the cover…') : busy ? t('Making the world…') : t('Make it')}
          </button>
        </footer>
      </form>
    </div>
  );
}
