/**
 * ActivityRail.tsx — the one chip rail, shared by both surfaces
 *. `surface="rail"` renders under the scene
 * shell and carries the writer + functional chips; `surface="character-modal"`
 * renders above the character's paper and carries only `character:<id>`.
 *
 * It is a status region, not a control: no button, no `tabIndex`, and
 * `pointer-events: none` in CSS, so it can never intercept a canvas drag or a
 * click on the paper. `activityId` never reaches the DOM — React keys stay
 * local (§3.2).
 */

import React from 'react';
import { activityAriaText, activityLabel, type ActivitySurface } from '../../lib/agent-activity.js';
import { useAgentActivity } from '../../state/useAgentActivity.js';
import { useLocale } from '../../lib/i18n.js';

export interface ActivityRailProps {
  surface: ActivitySurface;
  /** character-modal passes `character:<id>`; the global rail leaves it unset. */
  agentId?: string;
  className?: string;
}

export const ActivityRail: React.FC<ActivityRailProps> = ({ surface, agentId, className }) => {
  const { items, aria } = useAgentActivity(surface, agentId);
  const { t } = useLocale();

  // Empty → null: no placeholder, no empty live region, nothing in the a11y tree.
  if (items.length === 0) return null;

  return (
    <div
      className={`activity-rail activity-rail--${surface}${className ? ` ${className}` : ''}`}
      data-surface={surface}
      data-count={items.length}
      role="status"
      aria-live="polite"
      aria-relevant="text"
      aria-atomic="false"
    >
      <p className="sr-only">{aria}</p>
      <ul className="activity-rail__list">
        {items.map((act) => (
          <li
            key={act.activityId}
            className="activity-rail__item"
            data-state={act.state}
            aria-label={activityAriaText(act, t)}
          >
            <span className="activity-rail__dot" aria-hidden="true" />
            <span className="activity-rail__text">{activityLabel(act, t)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
