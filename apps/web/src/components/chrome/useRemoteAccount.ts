/**
 * This computer's sign-in to the Worldlines account,
 * shared by the 「账号」 panel (sign in / out) and 「语音与连接 → 远端」 (the
 * remote address). The local server runs the sign-in (Google, or an email
 * link/code) and keeps the session in a file outside every world; the page only
 * ever learns "signed in as <email>". On a hosted seat the routes answer 403 and
 * `settings` stays null.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { airpGateway, type DeviceLoginCode, type RemoteSettings } from '../../lib/airp-gateway.js';
import { useLocale } from '../../lib/i18n.js';
import { remoteErrorText } from '../../lib/remote-sync.js';
import { ACCOUNT_CHANGED_EVENT, announceAccountChanged } from '../../lib/account-open.js';

/** How long to watch for the sign-in tab (or the mail's link) to finish. */
const WATCH_MS = 10 * 60_000;

export function useRemoteAccount({ enabled = true }: { enabled?: boolean } = {}) {
  const { t } = useLocale();
  const [settings, setSettings] = useState<RemoteSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [mailSent, setMailSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [device, setDevice] = useState<DeviceLoginCode | null>(null);
  const watch = useRef<number | null>(null);

  const stopWatching = () => { if (watch.current !== null) { window.clearInterval(watch.current); watch.current = null; } };

  const reload = useCallback(async () => {
    try { setSettings(await airpGateway.remoteSettings()); } catch { setSettings(null); } finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    airpGateway.remoteSettings()
      .then((next) => { if (alive) setSettings(next); })
      .catch(() => { if (alive) setSettings(null); })
      .finally(() => { if (alive) setLoaded(true); });
    // Another view signed in or out: follow it.
    const onChanged = () => { if (alive) void reload(); };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, onChanged);
    return () => { alive = false; stopWatching(); window.removeEventListener(ACCOUNT_CHANGED_EVENT, onChanged); };
  }, [enabled, reload]);

  const signedInLine = (next: RemoteSettings) => t('Signed in as {email}.', { email: next.email ?? next.uid ?? '' });

  /** The sign-in finishes in another tab (or the mail's link): poll until the server has a session. */
  const watchForSignIn = () => {
    stopWatching();
    const until = Date.now() + WATCH_MS;
    watch.current = window.setInterval(() => {
      if (Date.now() > until) { stopWatching(); return; }
      void airpGateway.remoteSettings().then((next) => {
        if (next.device?.status === 'failed') {
          stopWatching();
          setDevice(null);
          setError(true);
          setMessage(t('Signing in with the code did not finish. Try again.'));
          return;
        }
        if (!next.signedIn) return;
        stopWatching();
        setSettings(next);
        setDevice(null);
        setMailSent(false);
        setCode('');
        setError(false);
        setMessage(signedInLine(next));
        announceAccountChanged();
      }).catch(() => {});
    }, 2000);
  };

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage('');
    setError(false);
    try { setMessage(await work()); } catch (failure) { setError(true); setMessage(remoteErrorText(failure, t('That did not work. Try again.'))); } finally { setBusy(false); }
  };

  const google = () => {
    // Opened before the request resolves, so the browser treats it as the click's own window.
    const tab = window.open('about:blank', '_blank');
    return run(async () => {
      try {
        const started = await airpGateway.startRemoteLogin('google', '', window.location.origin);
        if (!started.authorizeUrl) throw new Error('no url');
        if (tab) tab.location.href = started.authorizeUrl; else window.location.href = started.authorizeUrl;
      } catch (failure) {
        tab?.close();
        throw failure;
      }
      watchForSignIn();
      return t('Finish signing in in the new tab. This panel updates by itself.');
    });
  };
  /** No browser on this computer: show a code to enter on any device (device flow). */
  const deviceLogin = () => run(async () => {
    const started = await airpGateway.startDeviceLogin();
    setDevice(started);
    watchForSignIn();
    return t('On any device, open the address below and enter the code. This panel updates by itself.');
  });
  const sendMail = () => run(async () => {
    await airpGateway.startRemoteLogin('email', email.trim(), window.location.origin);
    setMailSent(true);
    watchForSignIn();
    return t('Check your inbox: open the sign-in link on this computer, or type the code from the email below.');
  });
  const verify = () => run(async () => {
    const next = await airpGateway.verifyRemoteLoginCode(email.trim(), code.trim());
    stopWatching();
    setSettings(next);
    setMailSent(false);
    setCode('');
    announceAccountChanged();
    return signedInLine(next);
  });
  const logout = () => run(async () => {
    stopWatching();
    const next = await airpGateway.logoutRemote();
    setSettings(next);
    setMailSent(false);
    announceAccountChanged();
    return t('Signed out. The session was removed from this computer.');
  });
  const test = () => run(async () => {
    const who = await airpGateway.testRemote();
    return t('Connected as {uid}.', { uid: who.email ?? who.uid });
  });
  const saveUrl = (url: string) => run(async () => {
    const next = await airpGateway.saveRemoteUrl(url);
    setSettings(next);
    announceAccountChanged();
    return next.signedIn ? t('Saved.') : t('Saved. Sign in again for this remote.');
  });

  return {
    settings, loaded, busy, message, error,
    email, setEmail, code, setCode, mailSent, device,
    google, deviceLogin, sendMail, verify, logout, test, saveUrl,
  };
}

export type RemoteAccount = ReturnType<typeof useRemoteAccount>;
