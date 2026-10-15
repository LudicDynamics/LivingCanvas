/**
 * 账号 tab of the account popup (components/account/AccountDialog.tsx) — THE one place to sign in
 * and out, plus the plan, balance and 今日额度 (PlansEntry → UsageSummary → DailyClaim),
 * 兑换码 and 卡面角色 (PlansEntry), 邀请好友 and the community channels.
 *   - hosted deploy: the seat gateway in front of it owns the session
 *     (deploy/vps/seat-gateway.mjs: auth/email/*, login/google, /logout, /auth/me):
 *       signed in → who (email / provider) + 退出登录; guest → the same
 * 「登录 / 注册」 form as local (useHostedSignIn).
 *       The gateway's own /login page stays as the no-script fallback.
 *   - local `pnpm dev`: no gateway, but this computer can sign in to the same
 *     Worldlines account to sync worlds with the remote (useRemoteAccount):
 *       signed out → 用账号登录 (Google, or email → code); signed in → 已登录为 + 退出登录
 *     An old local server without the remote routes → 本地模式, nothing to sign in to.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { worldSync, type WorldSync } from '../../lib/world-sync.js';
import { useLocale } from '../../lib/i18n.js';
import { withBase } from '../../lib/base-path.js';
import { localAccountState, type AccountReason } from '../../lib/account-open.js';
import { isGuestReason } from '../../lib/guest-trial.js';
import { COMMUNITY_CHANNELS, readStoredRegion, regionForLocale } from '../../lib/community.js';
import { useRemoteAccount, type RemoteAccount } from '../chrome/useRemoteAccount.js';
import { useHostedSignIn, type HostedSignIn } from '../chrome/useHostedSignIn.js';
import { PlansEntry } from '../chrome/PlansPreview.js';
import { UsageSummary } from '../chrome/UsageSummary.js';
import { NicknameField } from '../chrome/NicknameField.js';
import { ApiKeys } from '../chrome/ApiKeys.js';
import { InviteFriends } from '../chrome/InviteFriends.js';
import { ChannelRow } from '../chrome/ContactPanel.js';

export type Who =
  | { kind: 'checking' }
  | { kind: 'local' }
  | { kind: 'guest' }
  | { kind: 'signed-in'; email: string | null; uid: string; provider: string | null };

/** Ask the gateway who this is. No gateway (local dev) answers HTML or 404 → local. */
export async function whoAmI(): Promise<Who> {
  try {
    const res = await fetch(withBase('auth/me'), { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return { kind: 'local' };
    const body = (await res.json()) as { signedIn?: boolean; uid?: string; email?: string | null; provider?: string | null };
    if (body.signedIn && body.uid) return { kind: 'signed-in', uid: body.uid, email: body.email ?? null, provider: body.provider ?? null };
    return { kind: 'guest' };
  } catch {
    return { kind: 'local' };
  }
}

/** Who is this (gateway session / local / guest), asked once per mount. */
export function useWho(): Who {
  const [who, setWho] = useState<Who>({ kind: 'checking' });
  useEffect(() => {
    let live = true;
    void whoAmI().then((next) => { if (live) setWho(next); });
    return () => { live = false; };
  }, []);
  return who;
}

/** The one line above the sign-in, by why the panel was opened. */
export function reasonLine(reason: NonNullable<AccountReason>, t: (key: string) => string): string {
  switch (reason) {
    case 'play': return t('Sign in or sign up to play. You will go straight into the world afterwards.');
    case 'publish': return t('Sign in or sign up to publish. Publishing continues afterwards.');
    case 'trial': return t('The free trial is over for now. Sign in to keep playing.');
    case 'trial-low': return t('Your trial credits are nearly used up.');
    case 'unlock': return t('Sign in to unlock every world.');
    case 'cloud': return t('Sign in to save to the cloud.');
    case 'ending': return t('You reached an ending! Sign in to keep this run.');
  }
}

export function AccountTab({ who, reason }: { who: Who; reason: AccountReason }) {
  const { t, locale } = useLocale();
  // Local mode only: this computer's sign-in to the Worldlines account.
  const account = useRemoteAccount({ enabled: who.kind === 'local' });
  // Hosted guest: sign in to the gateway from this same tab.
  const hosted = useHostedSignIn({ enabled: who.kind === 'guest' });
  const providerName = who.kind === 'signed-in' && who.provider
    ? ({ google: 'Google', apple: 'Apple', discord: 'Discord', worldlines: 'Worldlines', email: t('Email') } as Record<string, string>)[who.provider] ?? who.provider
    : null;
  const region = readStoredRegion() ?? regionForLocale(locale);
  const channels = COMMUNITY_CHANNELS[region].filter((c) => !c.todo);
  return (
    <div className="account-tab account-panel__sheet" data-testid="account-tab">
      {reason && !(who.kind === 'signed-in') && (
        <p className="account-panel__reason" role="status">
          {reasonLine(reason, t)}
          {/* The guest trial: every prompt names the newcomer gift and that nothing is lost. */}
          {isGuestReason(reason) && <span className="account-panel__gift" data-testid="guest-gift-line">{t('Sign in for a 500-credit newcomer gift. Your progress is kept.')}</span>}
        </p>
      )}
      <section className="account-tab__block" data-testid="account-signin">
        {who.kind === 'checking' && <p className="account-panel__line">{t('Checking…')}</p>}
        {who.kind === 'local' && <LocalAccount account={account} />}
        {who.kind === 'guest' && <HostedAccount hosted={hosted} />}
        {who.kind === 'signed-in' && (
          <>
            <p className="account-panel__line">{who.email ?? t('Signed in')}</p>
            <p className="account-panel__note">
              {providerName ? t('Signed in with {provider}', { provider: providerName }) : t('Signed in')}
              {' · '}
              <code title={who.uid}>{who.uid.slice(0, 8)}</code>
            </p>
            <a className="account-panel__action" href={withBase('logout')}>{t('Sign out')}</a>
          </>
        )}
      </section>
      {/* 云端同步: this device's 云端 worlds and their last sync. */}
      {who.kind === 'local' && <WorldSyncBlock />}
      {/* 方案 · 余额 · 今日额度 · 兑换码 · 卡面角色 */}
      {who.kind !== 'checking' && <section className="account-tab__block"><PlansEntry /></section>}
      {/* 邀请好友: the account's invite code + share image (renders nothing when signed out / no billing). */}
      {who.kind !== 'checking' && <InviteFriends />}
      {channels.length > 0 && (
        <section className="account-tab__block account-tab__community contact-panel" aria-label={t('Community and contact')} data-testid="account-community">
          <h3 className="invite-friends__title">{t('Community and contact')}</h3>
          <ul className="contact-panel__channels">{channels.map((c) => <ChannelRow key={`${c.kind}-${c.value}`} channel={c} />)}</ul>
        </section>
      )}
    </div>
  );
}

/** Local mode: sign this computer in to the Worldlines account, or out of it. */
function LocalAccount({ account }: { account: RemoteAccount }) {
  const { t } = useLocale();
  if (!account.loaded) return <p className="account-panel__line">{t('Checking…')}</p>;
  const state = localAccountState(account.settings);
  const status = account.message
    ? <p className={`account-panel__status${account.error ? ' account-panel__status--error' : ''}`} role={account.error ? 'alert' : 'status'}>{account.message}</p>
    : null;

  if (state.kind === 'unavailable') return (
    <>
      <p className="account-panel__line">{t('Local mode — no sign-in here.')}</p>
      <p className="account-panel__note">{t('Your saves stay on this computer. Accounts exist on the hosted version.')}</p>
    </>
  );

  if (state.kind === 'signed-in') return (
    <>
      <p className="account-panel__line">{t('Signed in as {email}.', { email: state.who })}</p>
      <p className="account-panel__note">{t('This computer can sync worlds with your account. The sign-in stays on this computer, outside every world.')}</p>
      {account.settings?.app && <p className="account-panel__note">{t('Signed in as the app {app}, allowed: {scopes}.', { app: account.settings.app.clientId, scopes: account.settings.app.scopes.join(', ') })}</p>}
      <UsageSummary />
      <NicknameField />
      <button type="button" className="account-panel__action" disabled={account.busy} onClick={() => void account.logout()}>{t('Sign out')}</button>
      {status}
      <ApiKeys />
    </>
  );

  return <>
    <SignInForm form={account} codeStep={account.mailSent} onGoogle={() => void account.google()} />
    <DeviceSignIn account={account} />
  </>;
}

/** No browser on this computer (SSH, a headless box): approve the sign-in on another device with a code. */
function DeviceSignIn({ account }: { account: RemoteAccount }) {
  const { t } = useLocale();
  const code = account.device;
  return (
    <div className="account-panel__form">
      <button type="button" className="account-panel__secondary" disabled={account.busy} onClick={() => void account.deviceLogin()}>{t('Sign in on another device (code)')}</button>
      {code && <>
        <p className="account-panel__line" data-testid="device-code" style={{ fontFamily: 'monospace', fontSize: 20, letterSpacing: 2 }}>{code.userCode}</p>
        <p className="account-panel__note"><a href={code.verificationUriComplete ?? code.verificationUri} target="_blank" rel="noreferrer">{code.verificationUri}</a></p>
      </>}
    </div>
  );
}

/** Hosted guest: the same form, against the seat gateway (useHostedSignIn). */
function HostedAccount({ hosted }: { hosted: HostedSignIn }) {
  const { t } = useLocale();
  return (
    <>
      <p className="account-panel__note">{t('Browsing as a guest.')}</p>
      <SignInForm form={hosted} codeStep={hosted.mailSent && hosted.mode === 'code'} onGoogle={hosted.google} />
    </>
  );
}

type SignInState = Pick<RemoteAccount, 'busy' | 'message' | 'error' | 'email' | 'setEmail' | 'code' | 'setCode'> & {
  sendMail: () => unknown;
  verify: () => unknown;
};

/**
 * 「登录 / 注册」: Google, or email → code. ONE look for local (this computer's
 * sign-in) and hosted (the gateway's session).
 */
function SignInForm({ form, codeStep, onGoogle }: { form: SignInState; codeStep: boolean; onGoogle: () => void }) {
  const { t } = useLocale();
  return (
    <>
      <p className="account-panel__line">{t('Sign in / Sign up')}</p>
      <p className="account-panel__note">{t('New here? Your first sign-in with Google or an email code creates your account. Signed in, you can play, publish and sync your worlds.')}</p>
      <fieldset className="account-panel__form" disabled={form.busy} aria-busy={form.busy}>
        <button type="button" className="account-panel__action" onClick={onGoogle}>{t('Sign in with account (Google)')}</button>
        <label className="account-panel__field">{t('Or sign in by email')}
          <input type="email" aria-label={t('Email')} autoComplete="email" placeholder="you@example.com" value={form.email} onChange={(e) => form.setEmail(e.target.value)} />
        </label>
        <button type="button" className="account-panel__secondary" disabled={!form.email.trim()} onClick={() => void form.sendMail()}>{t('Send sign-in email')}</button>
        {codeStep && <>
          <label className="account-panel__field">{t('Code from the email')}
            <input inputMode="numeric" autoComplete="one-time-code" aria-label={t('Code from the email')} value={form.code} onChange={(e) => form.setCode(e.target.value)} />
          </label>
          <button type="button" className="account-panel__action" disabled={!form.code.trim()} onClick={() => void form.verify()}>{t('Sign in with code')}</button>
        </>}
      </fieldset>
      {form.busy && !form.message && <p className="account-panel__status" role="status">{t('Working…')}</p>}
      {form.message && <p className={`account-panel__status${form.error ? ' account-panel__status--error' : ''}`} role={form.error ? 'alert' : 'status'}>{form.message}</p>}
    </>
  );
}

const NO_SYNC: WorldSync['getStatus'] = () => null;
const noSubscribe = () => () => {};

/**
 * 「云端同步」: when the 云端 worlds last synced, what is in conflict, and 「立即同步」.
 * Renders nothing where this server keeps no sync (a hosted seat, an old server).
 */
export function WorldSyncBlock({ sync = worldSync() }: { sync?: WorldSync | null }) {
  const { t, locale } = useLocale();
  const status = useSyncExternalStore(sync?.subscribe ?? noSubscribe, sync?.getStatus ?? NO_SYNC, sync?.getStatus ?? NO_SYNC);
  useEffect(() => { void sync?.refresh(); }, [sync]);
  if (!sync || !status) return null;
  const conflicts = status.worlds.filter((w) => w.state === 'conflict');
  const at = status.lastRunAt ? new Date(status.lastRunAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <section className="account-tab__block account-sync" data-testid="account-sync" aria-label={t('Cloud sync')}>
      <h3 className="invite-friends__title">{t('Cloud sync')}</h3>
      {!status.signedIn ? (
        <p className="account-panel__note">{t('Worlds are kept only on this device. Sign in and the worlds you keep in the cloud sync on their own.')}</p>
      ) : (
        <>
          <p className="account-panel__line" role="status">
            {status.running ? t('Syncing…') : at ? t('Last synced at {time}', { time: at }) : t('Not synced yet')}
          </p>
          <p className="account-panel__note">{t('You play and build on this device. Cloud worlds sync when you leave them, every few minutes, and when you press Sync now.')}</p>
          {conflicts.map((w) => (
            <p key={w.path} className="account-panel__status account-panel__status--error">{t('Conflict: {name}. Open it from the lobby and choose Keep both.', { name: w.name })}</p>
          ))}
          {status.lastError && <p className="account-panel__status account-panel__status--error" role="alert">{status.lastError}</p>}
          <button type="button" className="account-panel__secondary" disabled={status.running} onClick={() => void sync.run('manual')}>{t('Sync now')}</button>
        </>
      )}
    </section>
  );
}
