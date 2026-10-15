/**
 * Deterministic provider for the AIRP gate probe (T0.4).
 *
 * Lives in `tools/` on purpose — `presets.ts::extensionArgs` only scans
 * `extensions/` and `<world>/extensions/`, so this file can never be loaded by
 * a production run. The probe passes it explicitly with `--extension`.
 *
 * It scripted-streams two turns: a `chalk` tool call that lands a `type: chalk`
 * markdown file, then a plain "done". No network, no credentials — which is what
 * makes `pnpm probe` a reproducible gate (set `AIRP_PROBE_REAL=1` to run a real
 * provider instead).
 */

import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';

const PROVIDER_ID = 'airp-probe';
const MODEL_ID = 'deterministic';

const PROBE_CHALK_PATH = 'world/baker-street/probe-chalk.md';
const PROBE_CHALK_CONTENT = [
  'The fog parts for a moment and the gaslight catches the wet cobbles.',
  '',
].join('\n');

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

/** Streams one complete assistant message as start → per-block deltas → done. */
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

export default function probeProvider(pi: any): void {
  pi.registerProvider(PROVIDER_ID, {
    name: 'AIRP Probe (deterministic)',
    baseUrl: 'http://127.0.0.1:0',
    apiKey: 'probe-key',
    api: 'openai-completions',
    models: [
      {
        id: MODEL_ID,
        name: 'Deterministic probe model',
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
                  id: `probe_call_${turn}`,
                  name: 'chalk',
                  arguments: { path: PROBE_CHALK_PATH, content: PROBE_CHALK_CONTENT },
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
