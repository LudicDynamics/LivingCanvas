/**
 * Account → 设置 「改进产品：发送匿名使用数据」 (lib/analytics.ts). Default on, off by default when the
 * browser sends Do Not Track / Global Privacy Control; the player's choice is kept on this browser
 * (localStorage `airp.analytics`). The 「发送哪些内容」 fold is the data-handling notice (also the 外部送信規律 disclosure).
 */
import { useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import { analyticsEnabled, setAnalyticsEnabled } from '../../lib/analytics.js';

export function UsageDataToggle() {
  const { t } = useLocale();
  const [on, setOn] = useState(() => analyticsEnabled());
  return (
    <fieldset className="usage-data-toggle" data-testid="usage-data-toggle">
      <legend>{t('Improve the product: send anonymous usage data')}</legend>
      <label><input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setAnalyticsEnabled(e.target.checked); }} /> {t('Improve the product: send anonymous usage data')}</label>
      <p>{t('Which screens were opened and how far play got, plus error reports — never story text, chats, prompts, names or emails. It helps us fix bugs and improve LivingCanvas.')}</p>
      {!on && <p role="status">{t('Off: nothing is sent from this browser.')}</p>}
      <details>
        <summary>{t('What is sent')}</summary>
        <p>{t('Recipient: chronicle.worldlines.gg, run by Ludic Dynamics itself — no third-party trackers, pixels or ads. Items: event names from a fixed list (such as world entered, tutorial step, ending reached), the world id, small counts, a random id for this tab, the app version, the interface language, the channel link you arrived from, and phone / tablet / desktop. Error reports keep only a cleaned-up message and file:line. When you are signed in, events are linked to your account for return-visit counts; nothing is shown per person. Kept for 180 days. If your browser sends Do Not Track, this starts switched off. Purpose: fixing bugs and improving the product. This is also our disclosure under Japan’s Telecommunications Business Act rules on sending user information.')}</p>
      </details>
    </fieldset>
  );
}
