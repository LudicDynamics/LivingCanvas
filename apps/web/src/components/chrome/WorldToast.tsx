import React, { useState } from 'react';
import { useLocale } from '../../lib/i18n.js';
import {
  useWorldToasts,
  worldEventToastStore,
  type WorldToastEntry,
} from '../../lib/world-event-toast.js';
import './world-toast.css';

export interface WorldToastRegionProps {
  /** Entries selected from the world-event projection; this component reads no transport state. */
  entries: readonly WorldToastEntry[];
  /** Optional dismissal seam for hosts that own the chrome. */
  onDismiss?: (key: string) => void;
  className?: string;
}

function renderMessage(entry: WorldToastEntry, t: (key: string, values?: Record<string, string | number>) => string): string {
  if (!entry.messageKey) return entry.message;
  return t(entry.messageKey, entry.messageValues ? { ...entry.messageValues } : undefined);
}

export const WorldToastRegion: React.FC<WorldToastRegionProps> = ({ entries, onDismiss, className }) => {
  const { t } = useLocale();
  const dismiss = onDismiss ?? worldEventToastStore.dismiss;
  const [expanded, setExpanded] = useState<string | null>(null);

  if (entries.length === 0) return null;

  return (
    <section
      className={`world-toast-region${className ? ` ${className}` : ''}`}
      data-depth-surface="ui"
      aria-live="polite"
      aria-relevant="additions text"
      aria-atomic="false"
      aria-label={t('World changes')}
    >
      <ul className="world-toast-region__list">
        {entries.map((entry) => {
          const isExpanded = expanded === entry.key;
          const detailId = `world-toast-detail-${entry.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
          return (
            <li
              className="world-toast"
              data-status={entry.status}
              data-type={entry.type}
              key={entry.key}
              role={entry.status === 'failed' ? 'alert' : 'status'}
            >
              <div className="world-toast__body">
                <span className="world-toast__message">{renderMessage(entry, t)}</span>
                {entry.detail && (
                  <>
                    <button
                      type="button"
                      className="world-toast__details-toggle"
                      aria-expanded={isExpanded}
                      aria-controls={detailId}
                      onClick={() => setExpanded(isExpanded ? null : entry.key)}
                    >
                      {t(isExpanded ? 'Hide event details' : 'Show event details')}
                    </button>
                    {isExpanded && <p id={detailId} className="world-toast__detail">{entry.detail}</p>}
                  </>
                )}
              </div>
              <button
                type="button"
                className="world-toast__dismiss"
                aria-label={t('Dismiss world change')}
                onClick={() => {
                  dismiss(entry.key);
                  if (isExpanded) setExpanded(null);
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

/** Convenience host for the singleton selector; App may instead pass an explicit projection. */
export const ConnectedWorldToastRegion: React.FC<Omit<WorldToastRegionProps, 'entries'>> = (props) => (
  <WorldToastRegion {...props} entries={useWorldToasts()} />
);
