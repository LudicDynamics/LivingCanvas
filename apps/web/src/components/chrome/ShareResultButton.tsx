/**
 * 「分享结果」 on the ending / 复盘: draws the RESULT card (lib/share-card.ts renderResultCard) — world, ending,
 * playtime, turns, secrets x/y, this run's CG — with the player's invite code + QR in the corner, so sharing a
 * result also invites. Signed out (no invite code) → nothing. The debrief page (feat/debrief-v2) can reuse this,
 * or call `resultCardInput(run)` + ShareCardDialog itself.
 */
import { useEffect, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { accountData, type InviteInfo } from '../../lib/account-data.js';
import { airpGateway } from '../../lib/airp-gateway.js';
import { minutesBetween, type ClosedRunState } from '../../lib/closed-run.js';
import { shareWorld } from '../../lib/share-art.js';
import { ShareCardDialog, type ShareArtChoice } from './ShareCardDialog.js';

/** The first sentence of the ending (≤ 80 chars) — the card's quote. */
export function endingQuote(body: string | null | undefined): string | null {
  const text = (body ?? '').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const m = /^(.{6,80}?[。！？.!?」”])(\s|$)/u.exec(text);
  const line = m ? m[1] : text.slice(0, 80);
  return line.length < text.length && !m ? `${line}…` : line;
}

/** What the result card shows for this run (the numbers the settlement already has). */
export function resultCardInput(run: ClosedRunState) {
  const s = run.summary;
  const result = run.debrief?.result ?? null;
  return {
    endingTitle: run.ending?.title ?? null,
    quote: endingQuote(run.ending?.body),
    result: {
      playtimeMinutes: s ? minutesBetween(s.startedAt, s.endedAt) : null,
      turns: s?.steps ? s.steps.used : null,
      secrets: result && result.total > 0 ? { found: result.unlocked, total: result.total } : null,
    },
    art: [
      ...(run.ending?.bg ? [{ id: `ending:${run.ending.bg}`, label: run.ending.title, src: airpGateway.assetUrl(run.ending.bg, undefined, 'image') }] : []),
      ...[...(run.cgs ?? [])].reverse().map((cg) => ({ id: `cg:${cg.path}`, label: cg.caption || 'CG', src: airpGateway.assetUrl(cg.path, undefined, 'image'), caption: cg.caption ?? null })),
    ] as ShareArtChoice[],
  };
}

export function ShareResultButton({ run, className }: { run: ClosedRunState; className?: string }) {
  const { t } = useLocale();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void accountData()?.invite().then((i) => { if (live) setInfo(i); });
    return () => { live = false; };
  }, []);
  if (!info || !run.ending) return null;
  const input = resultCardInput(run);
  return (
    <>
      <button type="button" className={className} data-testid="share-result" onClick={() => setOpen(true)}>{t('Share result')}</button>
      {open && (
        <ShareCardDialog
          kind="result"
          code={info.code}
          url={info.shareUrl}
          credits={info.inviteeCredits}
          extraArt={input.art}
          worldTitle={shareWorld()?.title ?? null}
          endingTitle={input.endingTitle}
          quote={input.quote}
          result={input.result}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
