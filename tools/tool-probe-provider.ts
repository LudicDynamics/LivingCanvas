/**
 * Deterministic provider for the engine-spawn tool-face probe (`tools/probe-tools-engine.mjs`).
 *
 * Lives in `tools/` on purpose — `presets.ts::extensionArgs` only scans `extensions/`
 * and `<world>/extensions/`, so this file can never be loaded by a production run.
 *
 * It scripted-streams two turns: a `chalk` AIRP tool call (registered by
 * `extensions/tools.ts`), then a plain "done". The event shapes mirror
 * `tools/probe-provider.ts` exactly — each partial event MUST carry `partial`.
 */
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';

const PROVIDER_ID = 'airp-tool-probe';
const MODEL_ID = 'deterministic';

const CHALK_PATH = 'world/baker-street/tool-probe-chalk.md';

let turn = 0;

function usage(): Record<string, unknown> {
  return {
    input: 10,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 30,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantMessage(model: any, content: unknown[], stopReason: string): Record<string, unknown> {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: usage(),
    stopReason,
    timestamp: Date.now(),
  };
}

function streamScript(stream: any, message: any): void {
  stream.push({ type: 'start', partial: { ...message, content: [], stopReason: 'pending' } });
  message.content.forEach((block: any, i: number) => {
    if (block.type === 'text') {
      stream.push({ type: 'text_start', contentIndex: i, partial: message });
      stream.push({ type: 'text_delta', contentIndex: i, delta: block.text, partial: message });
      stream.push({ type: 'text_end', contentIndex: i, content: block.text, partial: message });
    } else if (block.type === 'toolCall') {
      stream.push({ type: 'toolcall_start', contentIndex: i, partial: message });
      stream.push({
        type: 'toolcall_delta',
        contentIndex: i,
        delta: JSON.stringify(block.arguments),
        partial: message,
      });
      stream.push({ type: 'toolcall_end', contentIndex: i, toolCall: block, partial: message });
    }
  });
  stream.push({ type: 'done', reason: message.stopReason, message });
  stream.end(message);
}

export default function toolProbeProvider(pi: any): void {
  pi.registerProvider(PROVIDER_ID, {
    name: 'AIRP Tool Probe (deterministic)',
    baseUrl: 'http://127.0.0.1:0',
    apiKey: 'probe-key',
    api: 'openai-completions',
    models: [
      {
        id: MODEL_ID,
        name: 'Deterministic tool-probe model',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
    streamSimple: (model: any) => {
      const stream = createAssistantMessageEventStream();
      turn = (turn % 2) + 1;
      const message =
        turn === 1
          ? assistantMessage(
              model,
              [
                {
                  type: 'toolCall',
                  id: `tool_probe_${turn}`,
                  // The AIRP tool name — registered by extensions/tools.ts.
                  // `chalk` takes `content` only; the frontmatter skeleton is the tool's job.
                  name: 'chalk',
                  arguments: {
                    path: CHALK_PATH,
                    content: '# Tool Probe\n\nThe tool face is alive: ink meets paper.',
                  },
                },
              ],
              'toolUse'
            )
          : assistantMessage(model, [{ type: 'text', text: 'done' }], 'stop');
      queueMicrotask(() => streamScript(stream, message));
      return stream;
    },
  });
}
