/**
 * W2 fallback templates — the zero-AI safety net.
 *
 * When the initialiser times out, fails, or the model is unavailable, the engine
 * still drops a placeholder so the layer stops being a stub and the player sees
 * *something* (a scene that says "this has not taken shape yet" beats a scene
 * that never materialises and re-triggers forever). Pure constants: no store, no
 * AI, unit-testable.
 *
 * `material: stub` here is deliberate — it is the "not written yet" skin
 * (`MATERIAL_SKINS`, schemas/forms.ts:193-198). This is NOT in tension with the
 * "README takes the brief's default material" rule for *successful* products
 *: that rule governs the initialiser's own output, this one
 * governs the engine's fallback.
 */

/** The two files W2 writes for a stub scene layer, keyed by their filenames. */
export interface W2SceneFiles {
  /** Overwrites the stub placeholder README. */
  'README.md': string;
  /** The empty opening narration (a `type: chalk` file). */
  'opening.md': string;
}

/**
 * W2 fallback for a scene layer. `dirName` is the last path segment (the layer's
 * display name), e.g. `crime-scene`.
 */
export function w2SceneTemplate(dirName: string): W2SceneFiles {
  return {
    'README.md':
      `---\ntype: readme\nname: ${dirName}\nmaterial: stub\n---\n\n# ${dirName}\n\n(This place has not taken shape yet.)`,
    'opening.md': `---\ntype: chalk\n---\n\n(You stand here. Nothing is clear yet.)`,
  };
}
