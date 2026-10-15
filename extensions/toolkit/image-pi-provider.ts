/**
 * The pi-rp-backed image-generation port (doc-tools/11 §4.3.4).
 *
 * Why this lives in `extensions/` and not in `packages/shared`: the action layer
 * must stay dependency-free (`packages/shared/package.json` has only zod, and
 * `apps/web` bundles it too), so it only knows the `ImageProvider` interface.
 * Extensions run TS through jiti and can therefore import the vendored pi-ai
 * catalogue (doc-tools/11 §4.3.2).
 *
 * "No model configured" is a NORMAL state of this repo, not an exception:
 * `createPiImageProvider` returns null and the action fails loud with
 * `unsupported` — it never fakes a placeholder image (doc-tools/11 §4.3.5).
 */
// `getImageModel` is re-exported by the pi-ai compat entry (aliased for
// extensions), NOT by `providers/all` — doc-tools/11 §4.3.4 names the latter for
// it, but only `builtinImagesModels` lives there (verified against
// vendor/pi-rp/packages/ai/dist/providers/all.d.ts).
import { builtinImagesModels } from '@earendil-works/pi-ai/providers/all';
import { getImageModel } from '@earendil-works/pi-ai';
import { createOpenAIImageProvider } from './image-openai-provider.js';
import { resolveImageModelId } from '../../packages/shared/dist/index.js';
import type { ImageProvider } from '../../packages/shared/dist/index.js';


/** Content-block shape the OpenRouter API hands back (types.ts `ImageContent`). */
interface AssistantImageBlock {
  type?: string;
  data?: unknown;
  mimeType?: unknown;
}

/** Also matched against non-image output blocks: they carry text, not data. */
function imageBlockOf(blocks: readonly unknown[]): { data: string; mimeType: string } | null {
  for (const block of blocks) {
    const candidate = block as AssistantImageBlock;
    if (candidate?.type !== 'image') continue;
    if (typeof candidate.data !== 'string' || candidate.data === '') continue;
    return { data: candidate.data, mimeType: typeof candidate.mimeType === 'string' ? candidate.mimeType : 'image/png' };
  }
  return null;
}

/**
 * Content moderation and provider faults are indistinguishable at the HTTP
 * layer; the message wording is the only signal (doc-tools/11 §4.3.4, flagged
 * there as a heuristic).
 */
function failureReasonFor(message: string): 'policy' | 'provider_error' {
  return /content[\s_-]?policy|safety|moderation|flagged/i.test(message) ? 'policy' : 'provider_error';
}

/** The image block for a `reference` asset, in pi-ai's input shape. */
function referenceBlock(reference: { dataB64: string; mimeType: string }) {
  return { type: 'image' as const, mimeType: reference.mimeType, data: reference.dataB64 };
}

export function createPiImageProvider(env: NodeJS.ProcessEnv = process.env): ImageProvider | null {
  // AIRP_IMAGE_MODEL, else gpt-image-1 when OpenAI is reachable, else the OpenRouter default (doc-tools/11 §4.3.3)
  const raw = resolveImageModelId(env);
  const [providerId, ...rest] = raw.split('/');
  const modelId = rest.join('/');
  if (providerId === 'openai' && modelId) {
    return createOpenAIImageProvider(modelId, env);
  }
  // OpenRouter is today's only built-in image provider (doc-tools/11 §4.3.1).
  if (providerId !== 'openrouter' || modelId === '') return null;
  const model = getImageModel('openrouter', modelId as never);
  if (!model) return null;

  return {
    id: 'openrouter',
    model: modelId,
    supportsReference: model.input.includes('image'),
    async generate(req, opts) {
      if (!env.OPENROUTER_API_KEY) {
        return {
          ok: false,
          reason: 'no_credentials',
          message: 'OPENROUTER_API_KEY is not set in the agent process',
        };
      }
      const models = builtinImagesModels();
      // `generateImages` never rejects: every failure comes back as a stopReason
      // (images-models.ts:213-223), so checking it is the only honest read.
      const result = await models.generateImages(
        model,
        {
          input: [
            { type: 'text', text: req.prompt },
            ...(req.reference ? [referenceBlock(req.reference)] : []),
          ],
        },
        { signal: opts.signal, timeoutMs: opts.timeoutMs }
      );

      if (result.stopReason === 'aborted') {
        return { ok: false, reason: 'aborted', message: 'generation was cancelled' };
      }
      if (result.stopReason === 'error') {
        const message = result.errorMessage ?? 'unknown provider error';
        return { ok: false, reason: failureReasonFor(message), message };
      }
      const image = imageBlockOf(result.output);
      if (!image) {
        return {
          ok: false,
          reason: 'no_image',
          message: 'the model returned no image block',
        };
      }
      return { ok: true, mimeType: image.mimeType, dataB64: image.data };
    },
  };
}
