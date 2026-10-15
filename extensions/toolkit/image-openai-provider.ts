/**
 * The OpenAI-compatible Images adapter moved into `@airp/shared`
 * (`packages/shared/src/actions/image-openai-provider.ts`) on 2026-09-26 so the
 * SERVER can paint a new world's cover with the same code the writer's
 * `generate_image` tool uses. This shim keeps the extension-side import path
 * (and `tools/image-openai-provider.test.mjs`) stable.
 */
export { createOpenAIImageProvider } from '../../packages/shared/dist/index.js';
