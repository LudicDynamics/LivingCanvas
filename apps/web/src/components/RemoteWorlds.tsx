/**
 * 「远端」 on the world shelf: what the hosted
 * AIRP holds for this computer's owner — their own remote drafts and every
 * public world — each with 「下载到本地」. A draft comes down as a local draft
 * the owner keeps building; a public world is installed and plays as a fresh
 * copy like any published world. Talks only to THIS computer's server, which
 * holds the token; on a hosted seat the routes answer 403 and this shows a
 * one-line note instead.
 */
import { useEffect, useState } from 'react';
import { airpGateway, type RemoteWorld, type RemoteWorldList } from '../lib/airp-gateway.js';
import { useLocale } from '../lib/i18n.js';
import { formatSize, remoteErrorCode, remoteErrorText } from '../lib/remote-sync.js';
import { ACCOUNT_CHANGED_EVENT } from '../lib/account-open.js';
import { OpenAccountButton } from './chrome/AccountPanel.js';

export function RemoteWorlds({ onChanged, disabled }: { onChanged: () => Promise<void>; disabled?: boolean }) {
  const { t, locale } = useLocale();
  const [list, setList] = useState<RemoteWorldList | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'not_connected' | 'local_only' | 'failed'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  // 强制撤回 (admins): which public world is asking for confirmation, and the optional reason.
  const [takedown, setTakedown] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const reload = async () => {
    setState('loading');
    try {
      setList(await airpGateway.remoteWorlds());
      setState('ready');
    } catch (error) {
      const code = remoteErrorCode(error);
      const signedOut = code === 'not_connected' || code === 'signed_out';
      setState(signedOut ? 'not_connected' : code === 'local_only' ? 'local_only' : 'failed');
      if (!signedOut && code !== 'local_only') setMessage(remoteErrorText(error, t('The remote could not be reached.')));
    }
  };
  useEffect(() => {
    void reload();
    // Signed in or out from the account panel: show the new list without a manual refresh.
    const onChanged = () => { void reload(); };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, onChanged);
  }, []);

  const pull = async (world: RemoteWorld, from: 'tenant' | 'public', replace: boolean) => {
    const key = `${from}:${world.id}`;
    setBusy(key);
    setMessage('');
    try {
      const done = await airpGateway.pullFromRemote(world.id, from, replace);
      setConfirm(null);
      setMessage(from === 'tenant'
        ? t('Downloaded “{name}” as a local draft (revision {revision}).', { name: world.name, revision: done.revision })
        : t('Installed “{name}” on this computer. Start it from the launcher.', { name: world.name }));
      await onChanged();
      await reload();
    } catch (error) {
      if (remoteErrorCode(error) === 'exists_local') setConfirm(key);
      else setMessage(remoteErrorText(error, t('That did not work. Try again.')));
    } finally {
      setBusy(null);
    }
  };
  const publish = async (world: RemoteWorld) => {
    setBusy(`publish:${world.id}`);
    setMessage('');
    try {
      await airpGateway.publishOnRemote(world.id);
      setMessage(world.official
        ? t('“{name}” is republished: the lobby shows this revision now.', { name: world.name })
        : t('“{name}” is public on the remote now. Your remote space keeps only unpublished drafts.', { name: world.name }));
      await reload();
    } catch (error) {
      setMessage(remoteErrorCode(error) === 'busy'
        ? t('Another submission for this world is still running. Try again when it has finished.')
        : remoteErrorText(error, t('That did not work. Try again.')));
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async (world: RemoteWorld) => {
    setBusy(`unpublish:${world.id}`);
    setMessage('');
    try {
      await airpGateway.unpublishOnRemote({ id: world.id });
      setMessage(t('“{name}” is withdrawn: it is back in your remote drafts and no longer public.', { name: world.name }));
      await reload();
    } catch (error) {
      setMessage(remoteErrorCode(error) === 'busy'
        ? t('Another submission for this world is still running. Try again when it has finished.')
        : remoteErrorText(error, t('That did not work. Try again.')));
    } finally {
      setBusy(null);
    }
  };

  const forceUnpublish = async (world: RemoteWorld) => {
    setBusy(`takedown:${world.id}`);
    setMessage('');
    try {
      await airpGateway.forceUnpublishOnRemote(world.id, reason.trim() || undefined);
      setTakedown(null);
      setReason('');
      setMessage(t('“{name}” was taken down. It is back in its author’s remote drafts, with a note that an admin took it down.', { name: world.name }));
      await reload();
    } catch (error) {
      setMessage(remoteErrorCode(error) === 'busy'
        ? t('Another submission for this world is still running. Try again when it has finished.')
        : remoteErrorText(error, t('That did not work. Try again.')));
    } finally {
      setBusy(null);
    }
  };

  if (state === 'local_only') return <p>{t('Remote sync is set up from the AIRP on your own computer.')}</p>;
  if (state === 'not_connected') return (
    <div className="remote-worlds remote-worlds--signed-out">
      <p>{t('Not signed in. Sign in with your account to see your remote drafts and download worlds.')}</p>
      <OpenAccountButton cloud />
    </div>
  );

  const row = (world: RemoteWorld, from: 'tenant' | 'public') => {
    const key = `${from}:${world.id}`;
    const locked = disabled || busy !== null;
    return (
      <article className={`world-save-row${world.coverUrl ? ' has-cover' : ''}`} key={key}>
        {/* The cover comes through this computer's server with a content hash, so it is downloaded once. */}
        {world.coverUrl && <img className="remote-worlds-cover" src={world.coverUrl} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.hidden = true; }} />}
        <div className="world-save-open" aria-disabled="true">
          <b>{world.name}</b>
          <span>
            {new Date(world.updatedAt).toLocaleString(locale)} · {formatSize(world.size)}
            {world.revision ? ` · ${t('revision {revision}', { revision: world.revision })}` : ''}
            {from === 'public' ? ` · ${world.mine ? t('yours') : world.owner.slice(0, 8)}` : ''}
            {world.official ? ` · ${t('official · yours')}` : ''}
            {world.local ? ` · ${t('on this computer (revision {revision})', { revision: world.local.revision })}` : ''}
          </span>
          {world.takenDown && (
            <span className="remote-worlds-takedown" role="note">
              {t('An admin took this world down on {date}.', { date: new Date(world.takenDown.at).toLocaleString(locale) })}
              {world.takenDown.reason ? ` ${t('Reason: {reason}', { reason: world.takenDown.reason })}` : ''}
            </span>
          )}
        </div>
        <button type="button" disabled={locked} onClick={() => void pull(world, from, from === 'public')}>
          {busy === key ? t('Downloading…') : world.local ? t('Update local copy') : world.official ? t('Download to edit') : t('Download to this computer')}
        </button>
        {from === 'tenant' && (
          <button type="button" disabled={locked} onClick={() => void publish(world)}>
            {busy === `publish:${world.id}` ? t('Working…') : world.official && world.status === 'published' ? t('Republish on the remote') : t('Publish on the remote')}
          </button>
        )}
        {from === 'public' && world.mine && (
          <button type="button" disabled={locked} data-testid="remote-unpublish" onClick={() => void unpublish(world)}>
            {busy === `unpublish:${world.id}` ? t('Working…') : t('Unpublish')}
          </button>
        )}
        {from === 'public' && !world.mine && list?.admin && (
          <button type="button" disabled={locked} data-testid="remote-force-unpublish" onClick={() => { setTakedown(world.id); setReason(''); }}>
            {t('Take down')}
          </button>
        )}
        {from === 'public' && takedown === world.id && (
          <div className="world-save-confirm">
            <p>{t('Take “{name}” out of the public area? It goes back to its author’s remote drafts; nothing is deleted.', { name: world.name })}</p>
            <input
              type="text"
              maxLength={500}
              value={reason}
              placeholder={t('Reason (optional, shown to the author)')}
              aria-label={t('Reason (optional, shown to the author)')}
              onChange={(e) => setReason(e.target.value)}
            />
            <button type="button" disabled={busy !== null} onClick={() => void forceUnpublish(world)}>
              {busy === `takedown:${world.id}` ? t('Working…') : t('Take down')}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => setTakedown(null)}>{t('Cancel')}</button>
          </div>
        )}
        {confirm === key && (
          <div className="world-save-confirm">
            <p>{t('This draft is already on this computer. Replace the local copy with the remote one? The local copy is moved to trash, not deleted.')}</p>
            <button type="button" disabled={busy !== null} onClick={() => void pull(world, from, true)}>{t('Replace local copy')}</button>
            <button type="button" disabled={busy !== null} onClick={() => setConfirm(null)}>{t('Cancel')}</button>
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="remote-worlds" aria-busy={state === 'loading'}>
      {list && <p>{t('Connected to {url} as {uid}.', { url: list.url, uid: list.email ?? list.uid ?? '?' })}</p>}
      <button type="button" disabled={state === 'loading' || busy !== null} onClick={() => void reload()}>{state === 'loading' ? t('Loading…') : t('Refresh')}</button>
      <h3>{t('My remote drafts')}</h3>
      {list && !list.drafts.length && <p>{t('No drafts in your remote space. Upload one from a draft’s Setup tab.')}</p>}
      {list?.drafts.map((world) => row(world, 'tenant'))}
      <h3>{t('Public worlds')}</h3>
      {list && !list.public.length && <p>{t('Nothing is public on the remote yet.')}</p>}
      {list?.public.map((world) => row(world, 'public'))}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
