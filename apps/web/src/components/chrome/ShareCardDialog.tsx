/**
 * 「生成分享图」: pick a picture (the CGs this browser has seen — latest first —, the world cover, painted art),
 * portrait or landscape, then download it, hand it to the system share sheet (Web Share with a file, where
 * supported) or copy the link. The PNG is drawn here (lib/share-card.ts); nothing is uploaded.
 *
 * `kind: 'result'` draws the ending / 复盘 result card instead (ClosedRun passes the numbers); both carry the
 * invite code + QR.
 */
import { track } from '../../lib/analytics.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '../../lib/i18n.js';
import { withLang } from '../../lib/canvas-link.js';
import { listShareArt, savedCgs, shareWorld, type SavedCg, type ShareArtEntry } from '../../lib/share-art.js';
import { cardToBlob, inviteLine, loadCardArt, pageCardFonts, renderInviteCard, renderResultCard, type CardArt, type CardFormat, type ResultCardInput } from '../../lib/share-card.js';
import { shareCards } from '../../lib/share-card-store.js';
import { useAccountLayer } from '../account/account-layer.js';
import './invite.css';

export interface ShareArtChoice {
  id: string; label: string; src: string | Blob; caption?: string | null; worldTitle?: string | null;
  /** The CG this picture is (world key + world-relative path): kept with each card made from it (「我的分享卡」). */
  worldKey?: string | null; cgPath?: string | null;
}
export interface ShareCardDialogProps {
  kind: 'invite' | 'result';
  code: string;
  url: string;
  credits: number;
  /** Extra pictures offered first (e.g. this ending's picture and the run's CGs, as same-origin URLs). */
  extraArt?: ShareArtChoice[];
  worldTitle?: string | null;
  endingTitle?: string | null;
  quote?: string | null;
  result?: Pick<ResultCardInput, 'playtimeMinutes' | 'turns' | 'secrets'>;
  /** Start on this picture (an `extraArt` / CG id) instead of the latest CG. */
  initialPick?: string | null;
  onClose(): void;
}

const PAINTED = '__painted__';

export function ShareCardDialog(props: ShareCardDialogProps) {
  const { t, locale } = useLocale();
  // The card's link opens in the card's language (lib/canvas-link.ts).
  const link = withLang(props.url, locale);
  const [stored, setStored] = useState<ShareArtEntry[] | null>(null);
  const [saved, setSaved] = useState<SavedCg[]>([]);
  const [pick, setPick] = useState<string | null>(props.initialPick ?? null);
  const [format, setFormat] = useState<CardFormat>('portrait');
  const [png, setPng] = useState<{ url: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useAccountLayer('share-card', true, props.onClose);

  useEffect(() => {
    let live = true;
    // the CGs saves on this computer have shown (个人页面 gallery) + the ones this browser kept (and covers)
    void Promise.all([savedCgs(), listShareArt()]).then(([fromSaves, kept]) => { if (live) { setSaved(fromSaves); setStored(kept); } });
    closeRef.current?.focus();
    // Inside the account popup App's Escape router closes this dialog (a surface above the popup); its own key
    // covers every other place it opens.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { live = false; window.removeEventListener('keydown', onKey); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choices: ShareArtChoice[] = useMemo(() => {
    const list: ShareArtChoice[] = [...(props.extraArt ?? [])];
    // the current world's CGs first, then the rest, newest first
    const here = shareWorld()?.key ?? null;
    const fromSaves = [...saved].sort((a, b) => Number(b.worldKey === here) - Number(a.worldKey === here) || b.at - a.at);
    for (const c of fromSaves) list.push({ id: c.id, label: c.caption || c.worldTitle, src: c.src, caption: c.caption, worldTitle: c.worldTitle, worldKey: c.worldKey, cgPath: c.path });
    const have = new Set(saved.map((c) => `${c.worldKey}|${c.path}`));
    for (const e of stored ?? []) if (!(e.kind === 'cg' && have.has(`${e.worldKey}|${e.path}`))) list.push({ id: e.id, label: e.caption || e.worldTitle || (e.kind === 'cover' ? t('World cover') : 'CG'), src: e.blob, caption: e.caption, worldTitle: e.worldTitle, worldKey: e.worldKey, cgPath: e.kind === 'cg' ? e.path : null });
    list.push({ id: PAINTED, label: t('Painted'), src: '' });
    return list;
  }, [stored, saved, props.extraArt, t]);
  // default: the first offered picture (the latest CG of this / the last world)
  const chosen = choices.find((c) => c.id === pick) ?? (stored === null ? null : choices[0]);

  const thumbs = useMemo(() => choices.map((c) => ({ ...c, thumb: typeof c.src === 'string' ? c.src : URL.createObjectURL(c.src) })), [choices]);
  useEffect(() => () => { for (const c of thumbs) if (typeof c.src !== 'string') URL.revokeObjectURL(c.thumb); }, [thumbs]);

  useEffect(() => {
    if (!chosen) return;
    let live = true;
    setBusy(true);
    setStatus(null);
    void (async () => {
      try {
        const art: CardArt | null = chosen.id === PAINTED || !chosen.src ? null : await loadCardArt(chosen.src);
        const base = {
          locale,
          format,
          code: props.code,
          url: link,
          credits: props.credits,
          art,
          worldTitle: props.worldTitle ?? chosen.worldTitle ?? null,
          endingTitle: props.endingTitle ?? null,
          quote: props.quote ?? chosen.caption ?? null,
          fonts: pageCardFonts(),
        };
        const canvas = props.kind === 'result' ? await renderResultCard({ ...base, ...(props.result ?? {}) }) : await renderInviteCard(base);
        const blob = await cardToBlob(canvas);
        if (!live) return;
        setPng((old) => { if (old) URL.revokeObjectURL(old.url); return { url: URL.createObjectURL(blob), blob }; });
      } catch {
        if (live) setStatus({ text: t('The share image could not be drawn.'), error: true });
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => { live = false; };
  }, [chosen?.id, format, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (png) URL.revokeObjectURL(png.url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fileName = `livingcanvas-${props.kind}-${props.code}-${format}.png`;
  const file = png ? new File([png.blob], fileName, { type: 'image/png' }) : null;
  const canShareFile = !!file && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  // 「我的分享卡」: every card downloaded or shared is kept on this browser (lib/share-card-store.ts).
  const keep = () => {
    if (!png || !chosen) return;
    track('share_card', { kind: props.kind });
    void shareCards().save(png.blob, {
      kind: props.kind,
      format,
      locale,
      worldKey: chosen.worldKey ?? shareWorld()?.key ?? null,
      worldTitle: props.worldTitle ?? chosen.worldTitle ?? null,
      endingTitle: props.endingTitle ?? null,
      cgPath: chosen.id === PAINTED ? null : chosen.cgPath ?? null,
    }).catch(() => {});
  };
  const share = async () => {
    if (!file) return;
    keep();
    if (props.kind === 'invite') track('invite_share', { channel: 'share_sheet' });
    try {
      await navigator.share({ files: [file], title: 'LivingCanvas', text: `${inviteLine(locale, props.credits)} ${link}` });
    } catch {
      /* cancelled */
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      if (props.kind === 'invite') track('invite_share', { channel: 'copy_link' });
      setStatus({ text: t('Link copied.'), error: false });
    } catch {
      setStatus({ text: link, error: false });
    }
  };

  return createPortal(
    <div className="share-card" role="dialog" aria-modal="true" aria-label={props.kind === 'result' ? t('Share result') : t('Share image')} data-testid="share-card-dialog">
      <div className="share-card__sheet">
        <div className="share-card__head">
          <h2>{props.kind === 'result' ? t('Share result') : t('Share image')}</h2>
          <button ref={closeRef} type="button" className="share-card__close" onClick={props.onClose}>{t('Close')}</button>
        </div>
        <div className="share-card__body">
          <div className={`share-card__preview share-card__preview--${format}`} aria-busy={busy}>
            {png ? <img src={png.url} alt={t('Share image')} /> : <p>{t('Drawing…')}</p>}
          </div>
          <div className="share-card__side">
            <div className="share-card__formats" role="radiogroup" aria-label={t('Layout')}>
              {(['portrait', 'landscape'] as const).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={format === f} className={format === f ? 'is-on' : ''} onClick={() => setFormat(f)}>
                  {f === 'portrait' ? t('Portrait') : t('Landscape')}
                </button>
              ))}
            </div>
            <p className="share-card__label">{t('Picture')}</p>
            <div className="share-card__thumbs" role="radiogroup" aria-label={t('Picture')}>
              {thumbs.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={chosen?.id === c.id} className={chosen?.id === c.id ? 'is-on' : ''} title={c.label} onClick={() => setPick(c.id)}>
                  {c.id === PAINTED ? <span className="share-card__painted" aria-hidden="true" /> : <img src={c.thumb} alt="" />}
                  <span className="share-card__thumb-label">{c.label}</span>
                </button>
              ))}
            </div>
            <div className="share-card__actions">
              {png && <a className="account-panel__action" href={png.url} download={fileName} onClick={keep}>{t('Download')}</a>}
              {canShareFile && <button type="button" className="account-panel__secondary" onClick={() => void share()}>{t('Share…')}</button>}
              <button type="button" className="account-panel__secondary" onClick={() => void copy()}>{t('Copy link')}</button>
            </div>
            {status && <p className={`account-panel__status${status.error ? ' account-panel__status--error' : ''}`} role={status.error ? 'alert' : 'status'}>{status.text}</p>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
