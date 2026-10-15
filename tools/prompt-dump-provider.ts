/**
 * Deterministic provider for the system-prompt probe (`tools/probe-prompt.mjs`).
 *
 * Lives in `tools/` on purpose — `presets.ts::extensionArgs` only scans
 * `extensions/` and `<worldRoot>/extensions/`, so this file can never be loaded
 * by a production run. The probe passes it explicitly with `--extension`.
 *
 * `RpcClient` runs the agent as a CHILD process, so the probe cannot read this
 * process's memory — the dump FILE is the only observation channel (same reason
 * as `inject-probe-provider.ts:8-11`).
 *
 * It records exactly the two things the design notes F1/F4 define as the wire:
 *   `context.systemPrompt` (always "") and `context.messages` (the real system
 *   text is `messages[0]`), plus each tool's `name`/`description` on
 *   `context.tools`. It scripts ONE plain-text turn — the probe only needs the
 *   first request, not a tool loop.
 */
import fs from 'node:fs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';

const PROVIDER_ID = 'airp-prompt-dump';
const MODEL_ID = 'deterministic';

// Minimal structural views of the pi-rp wire objects this file touches. The
// provider is loaded by the pi CLI through jiti (types stripped), so these
// exist to keep the boundary honest, not to be linked against pi-rp's own .d.ts.
type WireBlock = { type?: string; text?: unknown };
type WireMessage = { role?: string; content?: unknown };
type WireTool = { name?: string; description?: string };
type AgentContext = { systemPrompt?: string; messages?: WireMessage[]; tools?: WireTool[] };
type ModelRef = { api?: string; provider?: string; id?: string };
type PiLike = { registerProvider: (id: string, definition: Record<string, unknown>) => void };
type StreamLike = { push: (event: unknown) => void; end: (message: unknown) => void };

/** Flatten a wire message's content (string | block[]) to plain text. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: unknown) => {
      if (block && typeof block === 'object' && typeof (block as WireBlock).text === 'string') {
        return (block as WireBlock).text as string;
      }
      return '';
    })
    .filter((s: string) => s !== '')
    .join('\n');
}

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

function assistantMessage(model: ModelRef, content: unknown[], stopReason: string): Record<string, unknown> {
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
function streamScript(stream: StreamLike, message: { content: WireBlock[]; stopReason: string }): void {
  stream.push({ type: 'start', partial: { ...message, content: [], stopReason: 'pending' } });
  message.content.forEach((block: WireBlock, i: number) => {
    if (block.type !== 'text') return;
    stream.push({ type: 'text_start', contentIndex: i, partial: message });
    stream.push({ type: 'text_delta', contentIndex: i, delta: block.text, partial: message });
    stream.push({ type: 'text_end', contentIndex: i, content: block.text, partial: message });
  });
  stream.push({ type: 'done', reason: message.stopReason, message });
  stream.end(message);
}

export default function promptDumpProvider(pi: PiLike): void {
  pi.registerProvider(PROVIDER_ID, {
    name: 'AIRP Prompt Dump (deterministic)',
    baseUrl: 'http://127.0.0.1:0',
    apiKey: 'probe-key',
    api: 'openai-completions',
    models: [
      {
        id: MODEL_ID,
        name: 'Deterministic prompt-dump model',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
    streamSimple: (model: ModelRef, context: AgentContext) => {
      const out = process.env.AIRP_PROMPT_OUT;
      if (out) {
        try {
          fs.writeFileSync(
            out,
            JSON.stringify(
              {
                // "" in preset mode — the real system content is messages[0] (F1).
                systemPrompt: context?.systemPrompt ?? null,
                messages: (context?.messages ?? []).map((m: WireMessage) => ({
                  role: m.role,
                  text: textOf(m.content),
                })),
                tools: (context?.tools ?? []).map((t: WireTool) => ({ name: t.name, description: t.description })),
              },
              null,
              2
            )
          );
        } catch {
          // The probe fails its "no dump written" assertion; never derail the run.
        }
      }
      const stream = createAssistantMessageEventStream();
      const message = assistantMessage(model, [{ type: 'text', text: 'prompt dump turn done' }], 'stop');
      const scripted = { content: message.content as WireBlock[], stopReason: 'stop' };
      queueMicrotask(() => streamScript(stream as StreamLike, scripted));
      return stream;
    },
  });
}
