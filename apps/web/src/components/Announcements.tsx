import React, { useEffect, useState } from 'react';
import { announcements, localized, topBanner, unread, useAnnouncements, type Announcement } from '../lib/announcements.js';
import { linkOf } from '../lib/board.js';
import { useLocale } from '../lib/i18n.js';
import { CommunityBoard } from './CommunityBoard.js';

const LEVEL: Record<Announcement['level'], string> = { info: 'Notice', maintenance: 'Maintenance', important: 'Important' };

/**
 * 公告 in the launcher (lib/announcements.ts): the first unread banner (pinned first, then newest) as a slim
 * line under the top bar, and everything — banners, 日志 and the community feed — behind the 「公告 / 社区」
 * pill (components/CommunityBoard.tsx). Clicking the line follows its link (world:<id> opens that world, https a
 * new tab); without a link it opens the board. Nothing of this shows over a world.
 */
export function LauncherNotices({ onOpenWorld = () => false, worldName = () => null }: { onOpenWorld?: (worldId: string) => boolean; worldName?: (worldId: string) => string | null }) {
  const { t, locale } = useLocale();
  const state = useAnnouncements();
  const [openRequest, setOpenRequest] = useState(0);
  useEffect(() => { void announcements()?.load(); }, []);
  const banner = topBanner(unread(state));
  const link = banner ? linkOf(banner.linkUrl) : null;
  const title = banner ? localized(banner.title, locale) : '';
  return (
    <>
      <CommunityBoard onOpenWorld={onOpenWorld} worldName={worldName} openRequest={openRequest} />
      {banner && (
        <div className={`launcher-notices__banner is-${banner.level}`} role="status">
          <span className="launcher-notices__level">{t(LEVEL[banner.level])}</span>
          {link && 'href' in link
            ? <a className="launcher-notices__title" href={link.href} target="_blank" rel="noopener noreferrer">{title}</a>
            : <button type="button" className="launcher-notices__title" onClick={() => { if (!(link && 'world' in link && onOpenWorld(link.world))) setOpenRequest(n => n + 1); }}>{title}</button>}
          <button type="button" aria-label={t('Close')} onClick={() => announcements()?.dismiss(banner.id)}>✕</button>
        </div>
      )}
    </>
  );
}

/** The dot on the in-world 「World launcher」 button while an announcement is unread. */
export function NoticeDot() {
  const { t } = useLocale();
  const n = unread(useAnnouncements()).length;
  return n ? <span className="launcher-notices__dot" aria-label={t('{count} unread', { count: n })} /> : null;
}
