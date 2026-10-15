/**
 * ReportIssue — 「报告问题 / 卡住了」.
 *
 * Two entries, one sheet: the world header's icon button (beside 联系我们) and a button inside the 联系我们 panel
 * (so the lobby reaches it too). Both fire REPORT_OPEN_EVENT; the sheet is mounted once in App and portaled to
 * <body>, above the launcher and the play chrome.
 *
 * The sheet: three chips (卡住了 / 出 bug 了 / 建议), a text box, and — visible before sending — what goes with it:
 * world, place, version, error codes. Never the conversation. Signed out with no guest-trial session: it says a
 * sign-in is needed and shows the contact channels instead of a send button that cannot work.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LifeBuoy, X } from 'lucide-react';
import { useLocale } from '../../lib/i18n.js';
import { useAccountData } from '../../lib/account-data.js';
import { openAccountPanel } from '../../lib/account-open.js';
import { recentErrorFingerprints } from '../../lib/analytics.js';
import { COMMUNITY_CHANNELS, readStoredRegion, regionForLocale } from '../../lib/community.js';
import { guestModeOf, useGuestTrial } from '../../lib/guest-trial.js';
import type { FocusCoordinator } from '../../lib/focus-coordinator.js';
import {
  REPORT_KINDS,
  REPORT_OPEN_EVENT,
  REPORT_TEXT_MAX,
  openReportIssue,
  reportBody,
  sendReport,
  type ReportContext,
  type ReportKind,
  type ReportResult,
} from '../../lib/report-issue.js';
import { ChannelRow } from './ContactPanel.js';
import './report-issue.css';

/** The world header's icon button (beside 联系我们). */
export function ReportIssueButton() {
  const { t } = useLocale();
  const label = t('Report a problem');
  return (
    <button type="button" className="report-issue__trigger contact-panel__icon" aria-label={label} title={label} data-testid="report-issue-open" onClick={() => openReportIssue()}>
      <LifeBuoy aria-hidden="true" />
    </button>
  );
}

type Phase = { step: 'edit' } | { step: 'sending' } | { step: 'done'; as: 'account' | 'guest' } | { step: 'failed'; result: Exclude<ReportResult, { status: 'sent' }> };

export function ReportIssueSheet({ context, focus }: { context: ReportContext; focus?: FocusCoordinator }) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind>('stuck');
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>({ step: 'edit' });
  const rootRef = useRef<HTMLElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const titleId = useId();
  const account = useAccountData();
  const guest = useGuestTrial();
  // Signed out on this device and no guest-trial session: nothing to send with (the server would say signed_out).
  const needsSignIn = account.sync === 'local' && !(guestModeOf(guest) && guest?.active);

  useEffect(() => {
    const onOpen = (event: Event): void => {
      const wanted = (event as CustomEvent<{ kind?: ReportKind | null }>).detail?.kind;
      if (wanted && (REPORT_KINDS as readonly string[]).includes(wanted)) setKind(wanted);
      setPhase({ step: 'edit' });
      setOpen(true);
      void recentErrorFingerprints().then(setErrors, () => setErrors([]));
    };
    window.addEventListener(REPORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(REPORT_OPEN_EVENT, onOpen);
  }, []);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const close = useCallback(() => {
    setOpen(false);
    // A sent report starts fresh next time; an unsent draft is kept for this tab.
    if (phaseRef.current.step === 'done') setText('');
    setPhase({ step: 'edit' });
  }, []);

  useEffect(() => {
    if (!open || !focus) return;
    const lease = focus.registerSurface({ key: 'report-issue', owner: 'workspace', priority: 525, root: rootRef.current, close });
    return () => lease.unregister();
  }, [focus, open, close]);

  useEffect(() => {
    if (open && phase.step === 'edit') textRef.current?.focus();
  }, [open, phase.step]);

  if (!open) return null;

  const send = async (): Promise<void> => {
    setPhase({ step: 'sending' });
    const r = await sendReport(reportBody(kind, text, context, errors));
    setPhase(r.status === 'sent' ? { step: 'done', as: r.as } : { step: 'failed', result: r });
  };
  // Literal t() calls (pnpm check:i18n follows literals only).
  const kindLabel = (k: ReportKind): string => (k === 'stuck' ? t("I'm stuck") : k === 'bug' ? t('Something broke') : t('Suggestion'));
  const placeholder = kind === 'stuck' ? t('Where are you stuck, and what did you try?') : kind === 'bug' ? t('What happened, and what did you expect?') : t('What would make this better?');
  const count = [...text].length;
  const region = readStoredRegion() ?? regionForLocale(locale);
  const channels = (COMMUNITY_CHANNELS[region] ?? []).filter((c) => !c.todo);
  const where = context.place ? (context.placeTitle || context.place) : null;
  const world = context.worldId ? `${context.worldName || context.worldId}${context.edition ? ` (${context.edition})` : ''}` : t('Lobby');
  const fallback = (
    <div className="report-issue__fallback">
      <ul className="contact-panel__channels">
        {channels.map((channel) => <ChannelRow key={`${channel.kind}:${channel.value}`} channel={channel} />)}
      </ul>
    </div>
  );

  const sheet = (
    <div className="report-issue__scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section ref={rootRef} className="report-issue__sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="report-issue-sheet">
        <header className="report-issue__head">
          <h2 id={titleId}>{t('Report a problem')}</h2>
          <button type="button" className="report-issue__close" aria-label={t('Close')} onClick={close}><X aria-hidden="true" /></button>
        </header>

        {phase.step === 'done' ? (
          <div className="report-issue__done" role="status" data-testid="report-issue-thanks">
            <p className="report-issue__thanks">{t('Thank you — it reached us.')}</p>
            <p>{t('We read every report. When three or more players get stuck at the same place, fixing it is first on next week’s list; fixes are announced in the Logs.')}</p>
            <button type="button" className="report-issue__send" onClick={close}>{t('Done')}</button>
          </div>
        ) : (
          <>
            <div className="report-issue__chips" role="radiogroup" aria-label={t('What kind of report?')}>
              {REPORT_KINDS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={`report-issue__chip${kind === k ? ' is-on' : ''}`} onClick={() => setKind(k)}>
                  {kindLabel(k)}
                </button>
              ))}
            </div>
            <label className="report-issue__field">
              <span className="sr-only">{t('Your report')}</span>
              <textarea
                ref={textRef}
                value={text}
                maxLength={REPORT_TEXT_MAX * 2}
                rows={5}
                placeholder={placeholder}
                onChange={(e) => setText([...e.target.value].slice(0, REPORT_TEXT_MAX).join(''))}
              />
              <span className="report-issue__count" aria-live="polite">{count} / {REPORT_TEXT_MAX}</span>
            </label>

            <div className="report-issue__context" data-testid="report-issue-context">
              <p className="report-issue__context-title">{t('Sent with your report')}</p>
              <dl>
                <dt>{t('World')}</dt><dd>{world}</dd>
                <dt>{t('Place')}</dt><dd>{where ?? '—'}</dd>
                <dt>{t('Version')}</dt><dd>{`${context.version} · ${context.mode === 'browser' ? t('Browser') : t('Local app')}`}</dd>
                {errors.length > 0 && <><dt>{t('Error codes')}</dt><dd>{errors.map((e) => e.slice(0, 8)).join(' ')}</dd></>}
              </dl>
              <p className="report-issue__privacy">{t('Your conversation with the characters is not included.')}</p>
            </div>

            {needsSignIn ? (
              <div className="report-issue__signin" role="note">
                <p>{t('Sending a report needs a Worldlines account. Sign in, or tell us through one of these channels:')}</p>
                <button type="button" className="report-issue__send" onClick={() => { close(); openAccountPanel(); }}>{t('Sign in')}</button>
                {fallback}
              </div>
            ) : (
              <>
                {phase.step === 'failed' && (
                  <div className="report-issue__error" role="alert">
                    <p>{phase.result.status === 'signed_out'
                      ? t('Sending a report needs a Worldlines account. Sign in, or tell us through one of these channels:')
                      : phase.result.status === 'refused' && phase.result.code === 'rate_limited'
                        ? t('That is a lot of reports in a short time — please try again in a while.')
                        : t('The report could not be sent right now. Try again later, or tell us through one of these channels:')}</p>
                    {(phase.result.status !== 'refused' || phase.result.code !== 'rate_limited') && fallback}
                  </div>
                )}
                <div className="report-issue__actions">
                  <button type="button" className="report-issue__cancel" onClick={close}>{t('Cancel')}</button>
                  <button type="button" className="report-issue__send" data-testid="report-issue-send" disabled={phase.step === 'sending' || (kind !== 'stuck' && !text.trim())} onClick={() => { void send(); }}>
                    {phase.step === 'sending' ? t('Sending…') : t('Send')}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
  return createPortal(sheet, document.body);
}
