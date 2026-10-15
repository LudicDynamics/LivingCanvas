import { useLocale } from './i18n.js';
import React, { useState } from 'react';
import { Activity, AlertTriangle, ChevronDown, ChevronRight, CornerDownRight, ListChecks } from 'lucide-react';
import { DiceRoller } from '../components/narrative/DiceRoller.js';
import { buildInteractiveFields, visibleChoiceOptions, type NormalizedOption } from '@airp/shared/frontmatter';
import { declaredStateIds, mappedStates, type MappedState } from '@airp/shared/states';
import { parseCommandError, parseCommandLog, type CommandErrorView, type CommandLogView } from './world-command.js';

/**
 * Shared frontmatter widgets for every Markdown entity (doc-20 §2).
 * Renders the choice / status / roll_dice trio below the chalk body:
 *   - status  → collapsible key-value table; EVERY key is shown (unknown keys
 *     are never dropped); hover peeks it open, click pins it open.
 *   - choice  → action card group; clicking sends the option as the player's
 *     next input; hovering inverts to ink-on-paper (v2 ink-reverse).
 *   - roll_dice → delegated to the existing DiceRoller component.
 * Any structural doubt in the widget data (broken/unknown shapes) degrades the
 * WHOLE block to `null` so the card falls back to plain text — never a
 * half-rendered widget.
 */
export interface FrontmatterWidgetOptions {
  reveal?: boolean;
  filePath?: string;
  onChoice?: (choice: string) => void;
  onDiceRolled?: (result: number, passed: boolean) => void;
  /**
   * `companion` moves the options into the left rail, so the
   * card renders everything EXCEPT them. Status, dice and the command receipt
   * stay: they are the card's own reading, not a thing to pick.
   */
  hideChoices?: boolean;
}

export function renderFrontmatterWidgets(
  frontmatter: Record<string, any> | null | undefined,
  opts: FrontmatterWidgetOptions = {},
): React.ReactElement | null {
  try {
    if (!frontmatter || typeof frontmatter !== 'object') return null;
    const interactive = buildInteractiveFields(frontmatter);
    // Declared states are never printed raw: their
    // values leave the status table and come back as the author's prose bands
    // (hidden ones not at all) — a hidden hp must never show up as a number.
    const declared = declaredStateIds(frontmatter);
    const rawStatus = interactive.status?.data ?? null;
    const statusData = rawStatus && declared.size > 0
      ? Object.fromEntries(Object.entries(rawStatus).filter(([key]) => !declared.has(key)))
      : rawStatus;
    const statusKeys = statusData ? Object.keys(statusData).length : 0;
    const states = mappedStates(frontmatter);

    const choices = interactive.choice && !opts.hideChoices ? visibleChoiceOptions(interactive.choice) : [];
    const dice = interactive.roll_dice;

    // The persistent command receipt. Read from the
    // raw keys — they are not "interactive fields" and `05` owns their shape, so
    // a malformed one degrades to "absent", never to a half-rendered block.
    const commandError = parseCommandError(frontmatter.command_error);
    const commandLog = parseCommandLog(frontmatter.command_log);

    if (statusKeys === 0 && states.length === 0 && choices.length === 0 && !dice && commandError === null && commandLog.length === 0) {
      return null;
    }
    if (statusKeys === 0 && choices.length === 0 && !dice && commandError === null && commandLog.length === 0) {
      return <StateProse states={states} />;
    }

    return (
      <>
      {states.length > 0 && <StateProse states={states} />}
      <FrontmatterWidgets
        statusData={statusData}
        statusLabel={interactive.status?.label}
        reveal={opts.reveal}
        choices={choices}
        dice={dice}
        skillCheck={frontmatter.skill_check}
        commandError={commandError}
        commandLog={commandLog}
        filePath={opts.filePath}
        onChoice={opts.onChoice}
        onDiceRolled={opts.onDiceRolled}
      />
      </>
    );
  } catch {
    // Broken widget data → card falls back to plain text.
    return null;
  }
}

/** Read-only mapped states: the author's prose, one line each, never a number of theirs. */
const StateProse: React.FC<{ states: MappedState[] }> = ({ states }) => (
  <ul className="fm-states mt-3 space-y-0.5 text-xs text-ink/70 italic" data-testid="mapped-states">
    {states.map((s) => (
      <li key={s.id} title={s.label}>{s.text}</li>
    ))}
  </ul>
);

interface FrontmatterWidgetsProps {
  reveal?: boolean;
  statusData: Record<string, unknown> | null;
  statusLabel?: string;
  choices: NormalizedOption[];
  dice: Record<string, any> | null;
  /** A skill check's `skill_check` block, when the card is one. */
  skillCheck?: unknown;
  /** The entity's latest failed run, if any. `null` = no failure on record. */
  commandError: CommandErrorView | null;
  /** The entity's settled runs, in file order. `[]` = nothing settled yet. */
  commandLog: CommandLogView[];
  filePath?: string;
  onChoice?: (choice: string) => void;
  onDiceRolled?: (result: number, passed: boolean) => void;
}

const FrontmatterWidgets: React.FC<FrontmatterWidgetsProps> = ({
  reveal = false,
  statusData,
  statusLabel,
  choices,
  dice,
  skillCheck,
  commandError,
  commandLog,
  filePath,
  onChoice,
  onDiceRolled,
}) => {
  const { t } = useLocale();
  // Status fold: hover peeks open, click pins, leaving collapses unless pinned.
  const [statusPinned, setStatusPinned] = useState(false);
  const [statusHover, setStatusHover] = useState(false);
  const statusOpen = statusPinned || statusHover;

  const [hoverChoice, setHoverChoice] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = pinned || hovered || focused || reveal;
  const statusKeys = statusData ? Object.keys(statusData).length : 0;

  return (
    <div className="fm-block" onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false); }}>
      <button type="button" className="fm-head" aria-expanded={open} aria-pressed={pinned} onClick={() => setPinned(value => !value)}>
        {t(pinned ? '▾ Pinned' : '▸ Interact')}{choices.length > 0 ? ` · ${t('{count} choices', { count: choices.length })}` : ''}{dice ? ` · ${t('Dice')}` : ''}{statusKeys ? ` · ${t('Status')}` : ''}
      </button>
      <div className="fm-body" hidden={!open}>
      {statusKeys > 0 && (
        <div
          className="mt-4 pt-3 border-t border-ink/10"
          onPointerEnter={() => setStatusHover(true)}
          onPointerLeave={() => setStatusHover(false)}
        >
          <button
            onClick={() => setStatusPinned((p) => !p)}
            className="flex items-center gap-1.5 text-xs text-ink/60 hover:text-ink font-mono transition-colors"
          >
            {statusOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Activity className="w-3.5 h-3.5" />
            <span>{statusLabel ?? t('Status')} ({statusKeys})</span>
            {statusOpen && statusPinned && <span className="text-ink/40">{t("· pinned")}</span>}
          </button>

          {statusOpen && (
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-mono p-2.5 rounded-xl bg-paper-wall/50 border border-ink/5">
              {Object.entries(statusData!).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-2 px-1">
                  <span className="text-ink/60">{String(k).replace(/_/g, ' ')}:</span>
                  <span className="font-medium text-ink truncate">{String(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {dice && (
        <DiceRoller
          filePath={filePath ?? ''}
          rollDice={{
            ...dice,
            desc: typeof dice.desc === 'string' ? dice.desc : 'Check',
            expect: typeof dice.expect === 'string' ? dice.expect : '',
          }}
          onRollComplete={onDiceRolled}
          skill={skillCheck ?? undefined}
        />
      )}

      {/* The command receipt: dice, then what it caused,
          then the next-step buttons — the card's reading order. A failure is
          expanded by default because a collapsed failure is the same thing as
          silence; a settled record collapses because it is a reward, and rewards
          are for the player to open. */}
      {commandError && <CommandErrorNotice error={commandError} />}
      {commandLog.length > 0 && <CommandLogNotice entries={commandLog} />}

      {choices.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-mono text-ink/40 uppercase tracking-wider mb-1">
            {t('Advance the Story')}
          </div>
          {choices.map((choice, idx) => {
            const hovered = hoverChoice === idx;
            return (
              <button
                key={idx}
                disabled={!onChoice}
                onClick={() => onChoice?.(choice.id ?? choice.label)}
                onPointerEnter={() => setHoverChoice(idx)}
                onPointerLeave={() => setHoverChoice(null)}
                // Ink-reverse hover: no `.ink-reverse` utility in CSS yet and the
                // `ink` color is not in tailwind.config, so apply the v2 token
                // pair inline (they follow TaskA's :root values automatically).
                style={hovered ? { background: 'var(--ink)', color: '#fbf8f1' } : undefined}
                className="w-full text-left px-4 py-2.5 rounded-2xl bg-paper-wall/70 border border-ink/10 text-sm font-sans text-ink transition-all flex items-center justify-between group hover:translate-x-1"
              >
                <span>{choice.index}. {choice.label}{choice.hint && <small className="block opacity-60">{choice.hint}</small>}</span>
                <CornerDownRight
                  className={`w-4 h-4 transition-colors ${
                    hovered ? 'text-[#fbf8f1]' : 'text-ink/30 group-hover:text-rust'
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
};

/**
 * The failure the world wrote onto this card (05 §2.2). Expanded by default:
 * a failure the player has to open is a failure the player never sees.
 *
 * `error.message` is deliberately NOT rendered — it is the raw
 * `ActionError.message`, which can carry file paths, line numbers and parser
 * vocabulary ("line 7, column 3: unknown top-level key \"rewardz\""). The only
 * label a player may see is `target`, and even that is optional; when it is
 * absent the copy names nothing rather than guessing from the message.
 */
const CommandErrorNotice: React.FC<{ error: CommandErrorView }> = ({ error }) => {
  const { t } = useLocale();
  const incomplete = error.pending === undefined || error.pending > 0;
  return (
    <details className="dice-outcome-letter dice-outcome-letter--error mt-4" data-no-drag open>
      <summary className="flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>{t(incomplete ? 'Only part of the automatic outcome could be written. The part that was written stays.' : 'The automatic outcome did not run — nothing was taken from you.')}</span>
      </summary>
      <div className="text-xs text-ink/70 mt-2 space-y-1">
        <div>
          {error.target === undefined
            ? t('The automatic outcome did not run — nothing was taken from you.')
            : t('Missing: {target}. The automatic outcome did not run — nothing was taken from you.', { target: error.target })}
        </div>
        {/* The command id is ASCII and untranslatable (06 §12.2 item 5); the code
            is machine vocabulary and stays inspectable as data. */}
        <div className="font-mono text-ink/40" data-command-code={error.code ?? 'internal'}>{error.command}</div>
      </div>
    </details>
  );
};

/**
 * The settled runs recorded on this card (05 §2.1). Collapsed by default, one
 * line per run, detail on open. `steps` are FLAT effect entries: a `give` of two
 * cards is two rows, not one "give".
 */
const CommandLogNotice: React.FC<{ entries: CommandLogView[] }> = ({ entries }) => {
  const { t } = useLocale();
  return (
    <details className="dice-outcome-letter dice-outcome-letter--log mt-4" data-no-drag>
      <summary className="flex items-center gap-1.5">
        <ListChecks className="w-3.5 h-3.5" />
        <span>{t('{count} outcomes were written into the world.', { count: entries.length })}</span>
      </summary>
      <div className="text-xs mt-2 space-y-2">
        {entries.map((entry) => (
          <div key={`${entry.command}:${entry.at}`} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-ink/70 font-medium">{entry.command}</span>
              <span className="text-ink/40">{entry.status === 'partial' ? t('Only part of the automatic outcome could be written. The part that was written stays.') : t('The outcome of your check is written into the world.')}</span>
              {entry.index !== undefined && (
                <span className="text-ink/40">#{entry.index + 1}</span>
              )}
            </div>
            <div className="text-ink/50 font-mono">{entry.at}</div>
            {entry.steps.length > 0 && (
              <ul className="text-ink/60 space-y-0.5">
                {entry.steps.map((step) => (
                  <li key={step.step} className="flex items-center gap-2">
                    <span>{step.action ?? t('Status')}</span>
                    {/* `link` records no event; a missing id renders nothing
                        rather than a fake handle. */}
                    {step.event && <span className="font-mono text-ink/40">{step.event}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </details>
  );
};
