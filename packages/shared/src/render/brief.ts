/**
 * Initialiser briefs — the task text handed to a scene/nook initialiser agent
 *.
 *
 * Pure, synchronous, no I/O: the caller (the `airp-init` command, or the server)
 * gathers world facts and passes them in. These build the *dynamic* half of
 * initialisation; the *static* half is the preset + the `scene-init-instruction`
 * / `nook-init-instruction` slots.
 *
 * Lives in `packages/shared` (not `apps/server/.../engine`) because the
 * `airp-init` extension command runs under jiti in the agent process and may
 * only import `@airp/shared`.
 */
import type { WorldManifest } from '../schemas/world.js';

export interface SceneInitContext {
  /** World-root-relative directory, e.g. `world/baker-street/crime-scene`. */
  targetPath: string;
  /** Layer identity; `map` is virtual and maps to targetPath `world`. */
  layerId: string;
  manifest: WorldManifest;
  /** Parent layer's display name (`map` has none). */
  parentLayerName?: string;
  /** Parent layer directory (`world` or `world/a/b`) — makes "stay consistent with the parent" actionable. */
  parentLayerPath?: string;
  /** The player's one-line request, if any. */
  userPrompt?: string;
  /** Facts the writer wants this scene to pay off (defaults to none). */
  knownClues?: string[];
}

export function buildSceneInitBrief(ctx: SceneInitContext): string {
  const lines = [
    `[Task] Instantiate a scene layer`,
    `[Layer ID] ${ctx.layerId}`,
    `[Target Path] ${ctx.targetPath}`,
    `[World] ${ctx.manifest.name} (genre: ${ctx.manifest.genre}; description: ${ctx.manifest.description}; default material: ${ctx.manifest.material})`,
  ];

  if (ctx.parentLayerName) {
    lines.push(`[Parent Layer] ${ctx.parentLayerName}`);
  }
  if (ctx.parentLayerPath) {
    lines.push(`[Parent Path] ${ctx.parentLayerPath}`);
  }

  if (ctx.userPrompt) {
    lines.push(`[Player Request] ${ctx.userPrompt}`);
  }

  if (ctx.knownClues && ctx.knownClues.length > 0) {
    lines.push(`[Known Clues] ${ctx.knownClues.join(' / ')}`);
  }

  lines.push(
    `[Constraints]`,
    `- Do not presuppose a final answer or impose a definitive conclusion`,
    `- Focus on the scene's atmosphere, object staging, and sensory detail (sight, sound, touch, smell)`,
    `- Give only the "first sight", leaving blank space for the player to explore and interact with`,
    `[Deliverables]`,
    `1. README.md: scene title, furnishing overview, and background material declaration`,
    `2. 1–3 object markdown files (props or letters the player can pick up or investigate)`,
    `3. 1–2 opening narrations (new authored files use NN-opening.md: 01-opening.md, optionally 02-opening.md; opening.md is only the old W2 fallback and evening.md is legacy; each has type: chalk and <=200 words)`,
    `[Report]`,
    `Report in exactly the three lines the system prompt defines`
  );

  return lines.join('\n');
}

export interface NookInitContext {
  /** Directory name = character id (drives `[Target Path]`). */
  characterId: string;
  /** Display name from the character README (falls back to `characterId`). */
  displayName: string;
  /** One-line role description; omitted from the brief when absent. */
  roleDesc?: string;
  /** Where this character lives (manifest `characters[].home`) — their "provenance". */
  home?: string;
  /** `companion` | `npc` (manifest `characters[].role`). */
  role?: string;
  manifest: WorldManifest;
  /**
   * Files the character's `preset.json` references but that are not on disk yet
   * (file slots only, bare filenames). Empty/absent ⇒ the line is not emitted.
   */
  missingFiles?: string[];
}

export function buildNookInitBrief(ctx: NookInitContext): string {
  const lines: (string | null)[] = [
    `[Task] Instantiate a character nook`,
    `[Target Path] characters/${ctx.characterId}`,
    ctx.roleDesc
      ? `[Character] ${ctx.displayName} (${ctx.roleDesc})`
      : `[Character] ${ctx.displayName}`,
    `[World] ${ctx.manifest.name} (genre: ${ctx.manifest.genre})`,
    ctx.home
      ? ctx.role
        ? `[Home] ${ctx.home} (role: ${ctx.role})`
        : `[Home] ${ctx.home}`
      : null,
    `[Request] Generate the initial furnishings of this character's private domain, bearing traces of their life, unsent letters, or intimate keepsakes.`,
    `[Constraints] Authentic and believable, full of emotional weight; do not write in a "showroom" voice.`,
    `[Deliverables] 2–4 markdown files representing their past story (letters, diaries, signature props).`,
  ];

  if (ctx.missingFiles && ctx.missingFiles.length > 0) {
    lines.push(`[Missing Files] ${ctx.missingFiles.join(', ')}`);
  }

  lines.push(`[Report] Report in exactly the three lines the system prompt defines`);

  return lines.filter((l): l is string => l !== null).join('\n');
}
