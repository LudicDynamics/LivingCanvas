import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import {
  registerImageProviderFactory,
  type GenerateImageDetails,
} from '../../packages/shared/dist/index.js';
import { getActionService } from './deps.js';
import { ok } from './result.js';
import { createPiImageProvider } from './image-pi-provider.js';

/**
 * `generate_image` — a prompt becomes a binary asset under `.airpworld/assets/gen/`
 * (doc-tools/11 §2.3).
 *
 * The action lives in `packages/shared/src/actions/generate-image.ts` and knows
 * only the `ImageProvider` port; this shell supplies the pi-rp-backed
 * implementation. Registration is module-level and once (doc-tools/11 §11
 * conflict 7): `ActionContext` is frozen and may not gain a provider field, so a
 * process-level factory is the smallest alternative. With no factory —
 * or one that cannot build a provider — the action fails loud with
 * `unsupported` instead of pretending a picture exists.
 */
registerImageProviderFactory(() => createPiImageProvider());

/** Heartbeat cadence for the progress channel (doc-tools/11 §6.2). */
const HEARTBEAT_MS = 10_000;

export const generateImageTool = defineTool({
  name: 'generate_image',
  label: 'Generate Image',
  description:
    "Generate an image from a text prompt and save it into this world's asset directory. " +
    'Use it for art the world does not have yet: a scene backdrop, a portrait, a hand-drawn clue, ' +
    "a wanted poster. It returns the asset path — point a layer README's `bg:` field at that path " +
    '(with edit) so the scene shows it. ' +
    'Do NOT use it for text content (use chalk) or to restyle something that already exists. ' +
    'If no image model is configured this tool fails loudly and tells you so; do not retry.',
  parameters: Type.Object(
    {
      prompt: Type.String({ description: 'What the image should depict.' }),
      style: Type.Optional(
        Type.String({ description: 'Style words appended to the prompt, e.g. "sepia ink sketch".' })
      ),
      width: Type.Optional(
        Type.Integer({ minimum: 256, maximum: 4096, description: 'Width in pixels. Default 1024.' })
      ),
      height: Type.Optional(
        Type.Integer({ minimum: 256, maximum: 4096, description: 'Height in pixels. Default 1024.' })
      ),
      reference: Type.Optional(
        Type.String({
          description: 'World-relative path of an existing asset to use as a source image.',
        })
      ),
      path: Type.Optional(
        Type.String({
          description:
            'Optional world-relative .md path this image is meant to be attached to.',
        })
      ),
    },
    { additionalProperties: false }
  ),
  promptSnippet:
    'generate_image(prompt) — generate an image asset for the world; then point a layer README `bg:` at it',
  promptGuidelines: [
    'Use generate_image when a scene needs a picture that does not exist yet; then edit the layer README `bg:` field to point at the returned asset path.',
    'Do not repeat the same prompt, style and size — the second call reuses the first file and still costs a turn.',
  ],
  async execute(_toolCallId, params, _signal, onUpdate, ctx) {
    // Progress tiers the shell can honestly observe: 'resolving' before the call,
    // then a heartbeat so a slow model does not look like a frozen UI
    // (doc-tools/11 §6.2 — "画面不动是正常的，不是卡住了"). The doc also specifies a
    // 'generating' and a 'saving' tier emitted from *inside* the action; the
    // action layer exposes no step hook and its ActionContext is frozen (01 §2.2),
    // so those two cannot be emitted without inventing progress it never saw.
    // _signal is unused for the same reason: no abort channel crosses that boundary.
    const size = { width: params.width ?? 1024, height: params.height ?? 1024 };
    onUpdate?.({
      content: [{ type: 'text', text: 'Generating image\u2026' }],
      details: { stage: 'resolving', ...size },
    });
    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      onUpdate?.({
        content: [
          {
            type: 'text',
            text: `Still drawing\u2026 ${Math.round((Date.now() - startedAt) / 1000)}s elapsed.`,
          },
        ],
        details: { stage: 'generating', elapsedMs: Date.now() - startedAt, ...size },
      });
    }, HEARTBEAT_MS);
    heartbeat.unref();

    try {
      const result = await getActionService(ctx).generateImage({
        prompt: params.prompt,
        style: params.style,
        width: params.width,
        height: params.height,
        reference: params.reference,
        path: params.path,
      });
      return ok(result as { text: string; details: GenerateImageDetails });
    } finally {
      // Let failures throw: the engine marks resolved tool results as successful,
      // even when a returned object contains isError: true.
      clearInterval(heartbeat);
    }
  },
});
