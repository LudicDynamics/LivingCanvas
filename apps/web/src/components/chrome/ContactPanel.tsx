/**
 * ContactPanel — the community channels, led by the list that matches the
 * language the player chose.
 *
 * The sheet starts with 「报告问题 / 卡住了」: the in-app way to tell us, before the
 * channels.
 *
 * Two entries mount this: the world header's top-right chrome (icon only, so it
 * does not crowd the play chrome) and the world launcher's top bar (a labelled
 * pill beside the language buttons). Both render the SAME panel, so a channel
 * added to the table shows up in both places without a second edit.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle } from 'lucide-react';
import { useLocale } from '../../lib/i18n.js';
import { withBase } from '../../lib/base-path.js';
import type { FocusCoordinator, FocusSurfaceLease } from '../../lib/focus-coordinator.js';
import {
  COMMUNITY_CHANNELS,
  REGION_LABELS,
  otherRegions,
  channelHref,
  readStoredRegion,
  regionForLocale,
  writeRegion,
  type CommunityChannel,
  type CommunityRegion,
} from '../../lib/community.js';
import { openReportIssue } from '../../lib/report-issue.js';
import './contact-panel.css';

/** How long the copy button says "copied" before returning to its label. */
const COPIED_MS = 1600;

export function ChannelRow({ channel }: { channel: CommunityChannel }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const href = channelHref(channel);
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(channel.value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => {
        /* Denied clipboard: the value is selectable text right below, which is
           the fallback that always works. */
      },
    );
  }, [channel.value]);

  return (
    <li className={`contact-panel__channel contact-panel__channel--${channel.kind}${channel.todo ? ' is-pending' : ''}`}>
      <div className="contact-panel__channel-head">
        <span className="contact-panel__channel-label">{t(channel.label)}</span>
        {channel.todo && <span className="contact-panel__pending">{t('Coming soon')}</span>}
      </div>
      {/* The QR is an enhancement, never the only way in: the id sits under it
          as selectable text, so a missing image still leaves a joinable channel. */}
      {channel.qr && !channel.todo && (
        <img className="contact-panel__qr" src={withBase(channel.qr)} alt={t('{channel} QR code', { channel: t(channel.label) })} width={132} height={132} />
      )}
      <div className="contact-panel__channel-value">
        {href
          ? <a href={href} target="_blank" rel="noreferrer noopener">{channel.value}</a>
          // A scan-only channel carries no id to show
          // so the QR above IS the instruction.
          : <code>{channel.todo ? t('Not published yet') : channel.value || t('Scan to join')}</code>}
        {!channel.todo && channel.value && (
          <button type="button" onClick={copy} aria-label={t('Copy {channel}', { channel: t(channel.label) })}>
            {copied ? t('Copied') : t('Copy')}
          </button>
        )}
      </div>
      {/* A WeChat group QR dies on its own — after a week, and again once the
          group fills. Saying so turns a dead code into "use the one below"
          instead of "this project is abandoned". */}
      {channel.expires && !channel.todo && (
        <p className="contact-panel__expires">{t('This code expires — if it no longer works, use another channel below.')}</p>
      )}
    </li>
  );
}

export function ContactPanel({ focus, variant = 'header' }: {
  focus?: FocusCoordinator;
  /** Which chrome hosts the trigger; only the button's skin differs. */
  variant?: 'header' | 'launcher';
}) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  // `null` = the player never picked a region, so the language decides and
  // keeps deciding: switching to 日本語 moves the default list with it. An
  // explicit choice outranks the language and survives the switch.
  const [chosen, setChosen] = useState<CommunityRegion | null>(() => readStoredRegion());
  const region = chosen ?? regionForLocale(locale);
  const panelRef = useRef<HTMLElement | null>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);

  // Re-read on open: a player who switched region in another tab should see it.
  useEffect(() => {
    if (open) setChosen(readStoredRegion());
  }, [open]);

  useEffect(() => {
    if (!open || !focus) return;
    let previous: HTMLElement | null = null;
    let restored = false;
    const lease = focus.registerSurface({
      key: 'contact-panel',
      owner: 'workspace',
      priority: 330,
      root: panelRef.current,
      close: () => setOpen(false),
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
  }, [focus, open]);

  // Pressing outside closes it — the same capture-phase pointer rule the dock
  // and the declared-action dialog use, so the three cannot disagree about what
  // "clicking away" means.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const root = panelRef.current;
      const target = event.target as Node | null;
      if (!root || !target) return;
      if (!root.contains(target) && !(target instanceof Element && target.closest('.contact-panel__trigger'))) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const choose = (next: CommunityRegion): void => {
    setChosen(next);
    writeRegion(next);
  };

  const channels = COMMUNITY_CHANNELS[region] ?? [];
  const label = t('Contact us');

  // In the launcher the top bar sits under the lobby wall's own stacking
  // contexts, so the sheet is portaled to <body> and pinned under the trigger
  //. The world header keeps the
  // in-place sheet its scene-shell rules position.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<CSSProperties | null>(null);
  const portaled = variant === 'launcher';
  useLayoutEffect(() => {
    if (!open || !portaled) return;
    const place = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({ position: 'fixed', top: rect.bottom + 10, right: Math.max(16, window.innerWidth - rect.right), left: 'auto' });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, portaled]);

  return (
    <div className="contact-panel" data-variant={variant}>
      <button
        ref={triggerRef}
        type="button"
        className={`contact-panel__trigger ${variant === 'launcher' ? 'world-launcher__pill' : 'contact-panel__icon'}`}
        aria-expanded={open}
        // The header shows the icon alone, so the name has to reach assistive
        // tech (and the tooltip) some other way.
        aria-label={variant === 'launcher' ? undefined : label}
        title={variant === 'launcher' ? undefined : label}
        onClick={() => setOpen(value => !value)}
      >
        {variant === 'launcher' ? label : <MessageCircle aria-hidden="true" />}
      </button>
      {open && (() => {
        const sheet = (
        <section ref={panelRef} className={`contact-panel__sheet${portaled ? ' contact-panel__sheet--portaled' : ''}`} style={portaled ? anchor ?? { visibility: 'hidden' } : undefined} aria-label={t('Community and contact')}>
          {/* 「报告问题 / 卡住了」: the same sheet as the world header's button, reachable from the lobby too. */}
          <button type="button" className="contact-panel__report" data-testid="contact-report-issue" onClick={() => { setOpen(false); openReportIssue(); }}>
            {t('Report a problem / I’m stuck')}
          </button>
          <h2>{t('Find us')}</h2>
          <p className="contact-panel__region" role="status">{t(REGION_LABELS[region])}</p>
          <ul className="contact-panel__channels">
            {channels.map(channel => <ChannelRow key={`${channel.kind}:${channel.value}`} channel={channel} />)}
          </ul>
          <div className="contact-panel__switch">
            <span>{t('Somewhere else?')}</span>
            {otherRegions(region).map(other => (
              <button type="button" key={other} onClick={() => choose(other)}>{t(REGION_LABELS[other])}</button>
            ))}
          </div>
        </section>
        );
        return portaled ? createPortal(sheet, document.body) : sheet;
      })()}
    </div>
  );
}
