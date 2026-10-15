/**
 * The hosted site's sign-in, in the 「账号」 panel
 * the same Google button and email → code form as local,
 * talking to the seat gateway (lib/hosted-login.ts). The session lands in the
 * gateway's HttpOnly cookies; this page never holds a token.
 *
 * Signing in ends with ONE reload: a signed-out visitor's page is served by the
 * seatless lobby, and the gateway hands out a seat only to a page load. The
 * world picked before signing in waits in sessionStorage (lib/play-gate.ts)
 * and is entered as the page comes back.
 */
import { useEffect, useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { announceAccountChanged } from '../../lib/account-open.js';
import {
  gatewayBase, hostedFailure, hostedGoogleUrl, hostedMailMode, returnPathFrom, startHostedEmail, verifyHostedCode, type HostedMailMode,
} from '../../lib/hosted-login.js';

export function useHostedSignIn({ enabled }: { enabled: boolean }) {
  const { t } = useLocale();
  const [mode, setMode] = useState<HostedMailMode>('code');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [mailSent, setMailSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void hostedMailMode().then((next) => { if (alive) setMode(next); });
    return () => { alive = false; };
  }, [enabled]);

  const failureText = (failure: unknown): string => {
    switch (hostedFailure(failure)) {
      case 'invalid_code': return t('That code is wrong or expired.');
      case 'invalid_email': return t('Enter a valid email address.');
      case 'send_failed': return t('Could not send the sign-in email. Try again.');
      case 'unreachable': return t('The sign-in service is unreachable. Try again shortly.');
      case 'account_refused': return t('This account cannot sign in here.');
      default: return t('That did not work. Try again.');
    }
  };

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage('');
    setError(false);
    try { setMessage(await work()); } catch (failure) { setError(true); setMessage(failureText(failure)); } finally { setBusy(false); }
  };

  // OAuth needs the whole tab; the gateway brings it back to this page.
  const google = () => {
    setBusy(true);
    window.location.assign(hostedGoogleUrl(returnPathFrom(window.location.pathname, gatewayBase())));
  };
  const sendMail = () => run(async () => {
    const sent = await startHostedEmail(email);
    setMode(sent);
    setMailSent(true);
    return sent === 'code'
      ? t('Check your inbox and type the code from the email below.')
      : t('Check your inbox and open the sign-in link in this browser.');
  });
  const verify = () => run(async () => {
    await verifyHostedCode(email, code);
    announceAccountChanged();
    window.location.reload();
    return t('Signed in. Taking a seat…');
  });

  return { mode, email, setEmail, code, setCode, mailSent, busy, message, error, google, sendMail, verify };
}

export type HostedSignIn = ReturnType<typeof useHostedSignIn>;
