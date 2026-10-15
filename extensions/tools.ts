/**
 * AIRP tool registration — the ONE registerTool entry point.
 *
 * `extensionArgs` (apps/server/src/engine/presets.ts) only scans TOP-LEVEL
 * `.ts`/`.js` files under `extensions/`, so everything in `toolkit/` is a plain
 * module (never loaded as an extension) — that is exactly why the implementations
 * live in the subdirectory.
 *
 * This file contains NO business logic: it imports each tool's `ToolDefinition`
 * and registers it. Tool semantics live in `packages/shared/src/actions/*`
 * (caller-independent) and their thin shells in `toolkit/*`.
 *
 * Extensions run TS directly via jiti — no build step. Shared code is imported
 * by RELATIVE path (`../packages/shared/dist/index.js`); the package name
 * `@airp/shared` does NOT resolve here, because `extensions/` is outside the
 * pnpm workspace.
 */
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';

// ——— tool shells (each exports a `ToolDefinition` constant) ———
import { chalkTool } from './toolkit/chalk.js';                    // doc-tools/02
import { lookAtTool, viewCanvasTool } from './toolkit/look-at.js'; // doc-tools/03
import { screenshotCanvasTool } from './toolkit/screenshot-canvas.js'; // the design notes
import { arrangeCanvasTool } from './toolkit/arrange-canvas.js'; // the design notes (agent-initiated, fence-free)
import { moveTool } from './toolkit/move.js';                      // doc-tools/04
import { deleteTool } from './toolkit/delete.js';                  // doc-tools/04
import { moveToTool } from './toolkit/move-to.js';                 // doc-tools/05
import { setFollowingTool } from './toolkit/following.js';         // doc-tools/05
import { chooseTool } from './toolkit/choose.js';                  // doc-tools/06
import { rollDiceTool } from './toolkit/roll-dice.js';             // doc-tools/07
import { searchTool } from './toolkit/search.js';                  // the design notes
import { skillCheckTool } from './toolkit/skill-check.js';         // the design notes
import { diceConsequenceTool } from './toolkit/dice-consequence.js'; // the design notes
import { triggerKeywordTool } from './toolkit/trigger-keyword.js'; // the design notes
import { useItemOnTool } from './toolkit/use-item.js';             // doc-tools/08
import { linkTool } from './toolkit/link.js';                      // doc-tools/09
import { arrangeTool } from './toolkit/arrange.js';                // doc-tools/09
import { getComponentTool } from './toolkit/component.js';         // doc-tools/10
import { showTool } from './toolkit/show.js';                      // doc-tools/10
import { generateImageTool } from './toolkit/generate-image.js';   // doc-tools/11
import { createCharTool } from './toolkit/create-char.js';      // create-char
import { editCharacterConfigTool } from './toolkit/edit-character-config.js'; // nook configuration gate
import { setMusicTool } from './toolkit/music.js';                 // the design notes
import { readConversationTool } from './toolkit/read-conversation.js'; // the design notes (writer only)
import { registerTurnTracking } from './toolkit/turn.js';          // doc-tools/12
import { registerInitCommand } from './toolkit/init-command.js';   // the design notes
import { registerWriterToolCallGuard } from './toolkit/writer-beat-guard.js'; // the design notes
import { withoutBlankOptionals } from './toolkit/blank-optionals.js';
import { registerActionErrorFlag } from './toolkit/error-flag.js';
import { registerReadFence } from './toolkit/read-fence.js';
import { agentActor } from './toolkit/actor.js';
/**
 * The complete AIRP tool face, in registration order.
 *
 * Exported so the probe can ASSERT the face is non-empty (a `ToolDefinition`
 * export that is not a function makes jiti silently skip the file — see
 * vendor/pi-rp/packages/coding-agent/src/core/extensions/loader.ts:511-515 —
 * and `pnpm probe`'s warning check cannot see that).
 *
 * Names MUST match the design notes / the design notes verbatim; a synonym
 * (`write_world_file` for `write`) is forbidden.
 */
export const AIRP_TOOLS: ReadonlyArray<{ name: string; tool: ToolDefinition }> = [
  { name: 'look_at', tool: lookAtTool },
  { name: 'view_canvas', tool: viewCanvasTool },
  { name: 'screenshot_canvas', tool: screenshotCanvasTool },
  { name: 'arrange_canvas', tool: arrangeCanvasTool },
  { name: 'chalk', tool: chalkTool },
  { name: 'move_to', tool: moveToTool },
  { name: 'move', tool: moveTool },
  { name: 'choose', tool: chooseTool },
  { name: 'roll_dice', tool: rollDiceTool },
  { name: 'search', tool: searchTool },
  { name: 'skill_check', tool: skillCheckTool },
  { name: 'dice_consequence', tool: diceConsequenceTool },
  { name: 'trigger_keyword', tool: triggerKeywordTool },
  { name: 'use_item_on', tool: useItemOnTool },
  { name: 'set_following', tool: setFollowingTool },
  { name: 'link', tool: linkTool },
  { name: 'arrange', tool: arrangeTool },
  { name: 'delete', tool: deleteTool },
  { name: 'get_component', tool: getComponentTool },
  { name: 'show', tool: showTool },
  { name: 'create_char', tool: createCharTool },
  { name: 'edit_character_config', tool: editCharacterConfigTool },
  { name: 'generate_image', tool: generateImageTool },
  { name: 'set_music', tool: setMusicTool },
  { name: 'read_conversation', tool: readConversationTool },
];

/** The names alone, in registration order — what the model sees and what `tools.allow` filters on. */
export const AIRP_TOOL_NAMES: readonly string[] = AIRP_TOOLS.map((entry) => entry.name);

/**
 * Tools that must never fold behind pi-rp's `tool_search` (pi-rp 36330ab:
 * extension tools default to `deferrable: true` and fold once tool definitions
 * pass 10% of the context window). These are the play loop the instructions
 * tell the writer to reach for unprompted — above all `search` (a search is
 * a dice chalk first, never a written item) and `trigger_keyword` (turning
 * points by meaning). A folded one is only found if the model thinks to look,
 * which is exactly when the rules would be skipped. Everything else (canvas
 * housekeeping, deletes, image generation…) stays foldable, keeping the lean
 * tool list the fold exists for.
 */
export const AIRP_EAGER_TOOLS: ReadonlySet<string> = new Set([
  'look_at', 'view_canvas', 'chalk', 'move_to', 'move', 'choose', 'roll_dice',
  'search', 'skill_check', 'dice_consequence', 'trigger_keyword', 'use_item_on', 'set_following', 'create_char',
]);
/**
 * Tools only the writer process gets at all:
 * a character must never read another character's private chat, so the tool is
 * not even registered there — whatever a world's own character preset denies.
 */
export const AIRP_WRITER_ONLY_TOOLS: ReadonlySet<string> = new Set(['read_conversation']);

export default function registerAirpTools(pi: ExtensionAPI): void {
  // Runtime total-call safety for only the top-level Writer.
  // This remains outside AIRP_TOOLS so it never changes the model tool face.
  registerWriterToolCallGuard(pi);

  // A returned `isError: true` is dropped by the vendored pi-rp; this hook
  // re-raises the ActionError shape as a real failure (toolkit/error-flag.ts).
  registerActionErrorFlag(pi);

  // read / grep / find / ls may only look inside the world and the shared
  // skills: the repository's `.local.env` is two directories above every
  // world (toolkit/read-fence.ts, security audit 2026-09-25).
  registerReadFence(pi);

  // Turn anchor for the A entry. Registered BEFORE the tools
  // so the very first tool call of the first turn already has an anchor.
  registerTurnTracking(pi);

  // Initialization execution kernel. Registered here — the
  // same `initialize` as the tools — so presets and command share one entry point.
  registerInitCommand(pi);


  const writer = agentActor().type === 'writer';
  for (const { name, tool } of AIRP_TOOLS) {
    if (!writer && AIRP_WRITER_ONLY_TOOLS.has(name)) continue;
    // Guard against a copy/paste slip between AIRP_TOOLS and the definition:
    // pi-rp keys its registry by `definition.name`, so a mismatch would make
    // `AIRP_TOOLS` lie to the probe.
    if (tool.name !== name) {
      throw new Error(`tools.ts: AIRP_TOOLS entry "${name}" carries a definition named "${tool.name}"`);
    }
    // `append_to: ""` / `near: ""` from an over-eager model mean "omitted"
    // (toolkit/blank-optionals.ts); the shells keep their strict contracts.
    const definition = withoutBlankOptionals(tool);
    pi.registerTool(AIRP_EAGER_TOOLS.has(name) ? { ...definition, deferrable: false } : definition);
  }
}
