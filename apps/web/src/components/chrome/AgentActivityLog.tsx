import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  activityAriaText,
  activityLabel,
  SOURCE_NAME_KEYS,
  type ActivityLogQuery,
  type AgentActivityLogTurn,
  type TFn,
} from '../../lib/agent-activity.js';
import { useLocale } from '../../lib/i18n.js';
import type { FocusCoordinator, FocusSurfaceLease } from '../../lib/focus-coordinator.js';
import { useAgentActivityLog } from '../../state/useAgentActivity.js';

export interface AgentActivityLogProps {
  query: ActivityLogQuery;
  sessionLabel?: string;
  className?: string;
  focus?: FocusCoordinator;
}

function turnKey(turn: AgentActivityLogTurn): string {
  return `${turn.source}\u0000${turn.agentId}\u0000${turn.turnId}`;
}

function statusLabel(turn: AgentActivityLogTurn, t: TFn): string {
  if (turn.state === 'running') return t('In progress');
  if (turn.entries.some((entry) => entry.errorKind === 'cancelled')) return t('Stopped');
  if (turn.entries.some((entry) => entry.errorKind === 'timeout')) return t('Took too long');
  return turn.state === 'error' ? t('Not completed') : t('Completed');
}

export const AgentActivityLog: React.FC<AgentActivityLogProps> = ({ query, sessionLabel, className, focus }) => {
  const { turns, entryCount, aria } = useAgentActivityLog(query);
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  const wasOpenRef = useRef(false);
  const setOpenState = useCallback((next: boolean): void => {
    setOpen(next);
  }, []);
  const requestClose = useCallback((): void => {
    const lease = leaseRef.current;
    if (lease && !lease.markClosing()) return;
    setOpenState(false);
  }, [setOpenState]);
  useEffect(() => {
    if (!open || !focus) return;
    let previous: HTMLElement | null = null;
    let restored = false;
    const lease = focus.registerSurface({
      key: `activity-details:${query.agentId ?? query.surface ?? 'default'}`,
      owner: 'workspace',
      priority: 330,
      root: panelRef.current,
      close: () => setOpenState(false),
      returnFocus: {
        capture: () => {
          if (previous) return;
          const active = document.activeElement;
          if (active instanceof HTMLElement && active !== document.body) previous = active;
        },
        restore: () => {
          if (restored) return false;
          restored = true;
          if (previous && document.contains(previous)) {
            previous.focus();
            return true;
          }
          return false;
        },
      },
    });
    leaseRef.current = lease;
    return () => {
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.unregister();
      window.requestAnimationFrame(() => {
        if (!restored && previous && document.contains(previous)) {
          restored = true;
          previous.focus();
        }
      });
    };
  }, [focus, open, query.agentId, query.surface, setOpenState]);
  useEffect(() => {
    if (open) {
      // Move focus into the detail surface after it has mounted so keyboard
      // users can reach the close control without traversing the canvas chrome.
      panelRef.current?.focus();
    } else if (wasOpenRef.current) {
      // Closing by the explicit close control returns to the disclosure.
      toggleRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);
  useEffect(() => {
    if (entryCount === 0 && open) setOpenState(false);
  }, [entryCount, open, setOpenState]);

  if (entryCount === 0) return null;

  const toggleOpen = () => {
    if (!open) {
      const first = turns[0];
      setExpanded(first ? new Set([turnKey(first)]) : new Set());
    }
    setOpenState(!open);
  };
  const toggleTurn = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const expandAll = () => setExpanded(new Set(turns.map(turnKey)));
  const collapseAll = () => setExpanded(new Set());
  return (
    <div className={`agent-activity-log${className ? ` ${className}` : ''}`} data-focus-owner={open ? 'workspace' : undefined}>
      <p className="sr-only" aria-live="off">{aria}</p>
      <button
        ref={toggleRef}
        type="button"
        className="agent-activity-log__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('Activity details')}
        onClick={toggleOpen}
      >
        <span className="agent-activity-log__toggle-mark" aria-hidden="true">≡</span>
        <span>{t('Activity details')}</span>
        <span className="agent-activity-log__count" aria-hidden="true">{entryCount}</span>
      </button>

      {open && (
        <section
          ref={panelRef}
          id={panelId}
          className="agent-activity-log__panel"
          tabIndex={-1}
          aria-label={sessionLabel ? t('Activity details for {name}', { name: sessionLabel }) : t('Activity details')}
        >
          <header className="agent-activity-log__header">
            <strong>{sessionLabel ?? t('Activity details')}</strong>
            <div className="agent-activity-log__actions">
              <button type="button" onClick={expandAll}>{t('Expand all activity turns')}</button>
              <button type="button" onClick={collapseAll}>{t('Collapse all activity turns')}</button>
              <button type="button" onClick={requestClose} aria-label={t('Close activity details')}>×</button>
            </div>
          </header>
          <ul className="agent-activity-log__turns">
            {turns.map((turn) => {
              const key = turnKey(turn);
              const isExpanded = expanded.has(key);
              const name = t(SOURCE_NAME_KEYS[turn.source]);
              const summary = t('{name} · {count} activities · {status}', {
                name,
                count: turn.entries.length,
                status: statusLabel(turn, t),
              });
              return (
                <li key={key} className="agent-activity-log__turn" data-state={turn.state}>
                  <button
                    type="button"
                    className="agent-activity-log__turn-toggle"
                    aria-expanded={isExpanded}
                    onClick={() => toggleTurn(key)}
                  >
                    <span className="agent-activity-log__chevron" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
                    <span>{summary}</span>
                  </button>
                  <ul className="agent-activity-log__entries" hidden={!isExpanded}>
                    {turn.entries.map((entry) => (
                      <li key={entry.activityId} className="agent-activity-log__entry" data-state={entry.state} aria-label={activityAriaText(entry, t)}>
                        <span className="agent-activity-log__entry-dot" aria-hidden="true" />
                        <span>{activityLabel(entry, t)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
};
