/**
 * 托管方案, opened from the account panel: the
 * player's current plan, the three Worldlines membership tiers (pricing v3), and
 * links to the billing site. Nothing is bought here — 「查看方案并订阅」 opens
 * the billing site's /subscribe page (its final confirmation page is the legal
 * one); a paid member also gets 「管理订阅」 (/manage). A 体验会员 (redemption code, the team
 * 2026-10-03) reads 「方案：旅人 · 体验会员 · 还剩 N 天 · 到期 YYYY-MM-DD JST」 (trialNote, 2026-10-06), a canceled
 * subscription 「方案：旅人 · 将于 YYYY-MM-DD JST 结束」 (endingNote); 「输入兑换码」 is RedeemCode.tsx.
 * Each tier carries a small key visual (lib/plan-art.ts: panel crop, else the
 * square cropped to its focal point) — decorative, only inside the opened sheet.
 *
 * picks the character on those visuals — the player's choice, never inferred;
 * it follows the account and goes to billing's pages as ?look=.
 */
import { track } from '../../lib/analytics.js';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { accountData, type AccountUsage } from '../../lib/account-data.js';
import { browserDeployment } from '../../lib/browser-mode.js';
import {
  PLAN_NOTES, PLAN_PRICES, PLAN_TIERS, billingLinks, endingNote, fetchBillingConfig, fetchPlansFlag, formatPrice, planTier, trialNote,
  type BillingLinks, type PlanId,
} from '../../lib/plans.js';
import { resolvePlanArt } from '../../lib/plan-art.js';
import { PLAN_ART_FILES } from '../../lib/plan-art-files.js';
import { PLAN_LOOK_PREFS, planLookFor, planLookPref, setPlanLookPref, subscribePlanLook } from '../../lib/plan-look.js';
import type { PlanLookPref } from '../../lib/plan-art.js';
import { RedeemCode } from './RedeemCode.js';
import { useChatSourceLine } from './LocalKeySettings.js';

/** The account panel's plan line + 「查看方案」; renders nothing while the flag is off. */
export function PlansEntry() {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  /**
   * The signed-in account's usage (/api/account-data/usage): the plan as billing has it (membership — a 体验会员
   * carries trialEndsAt), else as ai names it; null = not signed in / unknown.
   */
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  /** Browser version: 「对话：Worldlines 额度」 / 「对话：本机密钥（DeepSeek）」 (LocalKeySettings.tsx). */
  const chat = useChatSourceLine();
  const load = () => accountData()?.loadUsage() ?? Promise.resolve(null);
  useEffect(() => {
    let live = true;
    void fetchPlansFlag().then((on) => { if (live) setEnabled(on); });
    void load().then((u) => { if (live) setUsage(u); });
    return () => { live = false; };
  }, []);
  if (!enabled) return null;
  const tier = planTier(usage?.membership?.plan ?? usage?.plan ?? null);
  const name = PLAN_TIERS.find((p) => p.id === tier)!.name;
  const trial = trialNote(t, usage?.membership?.trialEndsAt);
  const ending = trial ? null : endingNote(t, usage?.membership?.endsAt);
  return (
    <div className="plans-preview" data-testid="plans-entry">
      <p className="account-panel__note plans-preview__current">
        {t('Plan: {plan}', { plan: t(name) })}
        {trial && <span className="plans-preview__trial" data-testid="plan-trial">{' · '}{trial}</span>}
        {ending && <span className="plans-preview__ending" data-testid="plan-ending">{' · '}{ending}</span>}
        {chat && <span className="plans-preview__chat" data-testid="plan-chat-source">{' · '}{chat}</span>}
        {' · '}
        <button type="button" className="plans-preview__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t('Hide plans') : t('View plans')}
        </button>
      </p>
      <RedeemCode signedIn={usage !== null} onRedeemed={() => void load().then(setUsage)} />
      {open && <PlansSheet current={tier} paid={tier !== 'free'} />}
    </div>
  );
}

const LOOK_LABEL: Record<PlanLookPref, string> = { '': 'Default', m: 'Male character', f: 'Female character', r: 'Random' };

/** 「卡面角色」: four pressed-state buttons; the choice is stored (lib/plan-look.ts) and synced with the account. */
export function PlanLookSwitch({ value }: { value: PlanLookPref }) {
  const { t } = useLocale();
  return (
    <div className="plans-preview__look" role="group" aria-label={t('Card character')} data-testid="plan-look">
      <span className="plans-preview__look-label">{t('Card character')}</span>
      {PLAN_LOOK_PREFS.map((k) => (
        <button key={k || 'd'} type="button" className="plans-preview__look-option" aria-pressed={value === k} onClick={() => setPlanLookPref(k)}>
          {t(LOOK_LABEL[k])}
        </button>
      ))}
    </div>
  );
}

export function PlansSheet({ current, paid }: { current: PlanId; paid: boolean }) {
  const { t, locale } = useLocale();
  const base = browserDeployment.billing;
  const look = useSyncExternalStore(subscribePlanLook, planLookPref, () => '' as PlanLookPref);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let live = true;
    void fetchBillingConfig(base).then((c) => { if (live && c) setConfig(c); });
    return () => { live = false; };
  }, [base]);
  const links: BillingLinks = billingLinks(base, config, locale, look);
  return (
    <section className="plans-preview__sheet" aria-label={t('Worldlines membership')}>
      <h3 className="plans-preview__heading">{t('Worldlines membership')}</h3>
      <PlanLookSwitch value={look} />
      <div className="plans-preview__tiers">
        {PLAN_TIERS.map((tier) => {
          const price = tier.id === 'free' ? null : PLAN_PRICES[tier.id];
          const art = resolvePlanArt(PLAN_ART_FILES, tier.id, 'panel', planLookFor(tier.id, look));
          return (
            <div key={tier.id} className={`plans-preview__block plans-preview__block--${tier.id}`} data-current={tier.id === current || undefined}>
              {art && (
                <div className="plans-preview__art" aria-hidden="true" data-crop={art.crop} data-look={art.look || undefined}>
                  <img src={art.url} alt="" loading="lazy" decoding="async" style={{ objectPosition: art.position }} />
                </div>
              )}
              <p className="plans-preview__title">
                {t(tier.name)}
                {tier.id === current && <span className="plans-preview__badge">{t('Current')}</span>}
              </p>
              <p className="plans-preview__price">
                {price ? t('{price} / month', { price: formatPrice(price.month) }) : '¥0'}
                {price && <span className="plans-preview__yearly">{t('yearly {price}', { price: formatPrice(price.year) })}</span>}
              </p>
              <ul className="plans-preview__lines">
                {tier.lines.map((line) => <li key={line.key}>{t(line.key, line.vars)}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
      <ul className="plans-preview__notes">
        {PLAN_NOTES.map((line) => <li key={line.key}>{t(line.key, line.vars)}</li>)}
      </ul>
      <div className="plans-preview__actions">
        <a className="account-panel__action plans-preview__subscribe" href={links.subscribe} target="_blank" rel="noopener" onClick={() => track('subscribe_click')}>{t('See plans and subscribe')}</a>
        {paid && <a className="account-panel__secondary plans-preview__manage" href={links.manage} target="_blank" rel="noopener">{t('Manage subscription')}</a>}
      </div>
      <a className="plans-preview__legal" href={links.legal} target="_blank" rel="noopener">{t('Legal notice (Act on Specified Commercial Transactions)')}</a>
    </section>
  );
}
