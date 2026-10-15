/**
 * Deterministic provider for the engine-spawn injection probe (`tools/probe-inject.mjs`).
 *
 * Lives in `tools/` on purpose — `presets.ts::extensionArgs` only scans `extensions/`
 * and `<worldRoot>/extensions/`, so this file can never be loaded by a production run.
 * The probe passes it explicitly with `--extension`.
 *
 * Its ONE job beyond scripting the turns: append the FINAL wire messages of every
 * provider request to `AIRP_INJECT_PROBE_OUT` as one JSON line per request.
 * `RpcClient` runs the agent as a CHILD process, so the probe cannot read this
 * process's memory — the file is the only observation channel (06 §6.2).
 *
 * `context.messages` is post-`convertToLlm`: exactly what the model sees, which is
 * the same vantage point AUDIT S1/S2 used.
 *
 * Script (by request index, not by user turn — an in-run tool loop adds requests):
 *   request 1 → plain text
 *   request 2 → one AIRP `chalk` tool call (forces a tool loop, so one user turn
 *               produces several requests — the A4 case)
 *   request 3+ → plain text
 */
import fs from 'node:fs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';

const PROVIDER_ID = 'airp-inject-probe';
const MODEL_ID = 'deterministic';

const PROBE_CHALK_PATH = 'world/baker-street/inject-probe-chalk.md';

let requestIndex = 0;

/** Flatten a wire message's content (string | block[]) to plain text. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: any) => (block && typeof block.text === 'string' ? block.text : ''))
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

/**
 * The final wire message count our OWN `context` handler saw, i.e. BEFORE any
 * later extension appended to the array. Paired with the post-all-handlers count
 * in `record()`, it is A11's decoupled structural judge (06 §6.3): a request that
 * carries a world-state block adds exactly ONE message
 * (`messageCountOut === messageCountIn + 1`); a tool-loop continuation adds none
 * (`messageCountOut === messageCountIn`). This judge never looks at the block's
 * text, so it stays valid for payload variants that drop `[World state]`.
 *
 * It works only because this extension's handler runs FIRST — the probe lists
 * this file's `--extension` before the writer's own extensions on argv (`loader`
 * preserves that order). If it ran last it would see the already-injected array.
 */
let messageCountInHook = 0;

/** Record this request's wire view for the probe, then scripted-reply. */
function record(context: { messages?: { content: unknown }[]; tools?: { name?: string }[] } | undefined, index: number): void {
  const out = process.env.AIRP_INJECT_PROBE_OUT;
  if (!out) return;
  const messages = context?.messages ?? [];
  const line = JSON.stringify({
    requestIndex: index,
    texts: messages.map((m) => textOf(m.content)),
    // The tool face this request offered (writer-only tools must be absent for a character).
    tools: (context?.tools ?? []).map((t) => t?.name ?? ''),
    // A11: the pair, NOT the text. `Out` is what the model saw; `In` is what the
    // array held before our later siblings appended the block.
    messageCountIn: messageCountInHook,
    messageCountOut: messages.length,
  });
  try {
    fs.appendFileSync(out, line + '\n');
  } catch {
    // The probe will fail its "no requests recorded" assertion; never derail the run.
  }
}

export default function injectProbeProvider(pi: any): void {
  // Runs before `extensions/context.ts` (probe argv order) — see the note above.
  pi.on('context', (event: { messages?: unknown[] } | undefined) => {
    messageCountInHook = (event?.messages ?? []).length;
  });
  pi.registerProvider(PROVIDER_ID, {
    name: 'AIRP Inject Probe (deterministic)',
    baseUrl: 'http://127.0.0.1:0',
    apiKey: 'probe-key',
    api: 'openai-completions',
    models: [
      {
        id: MODEL_ID,
        name: 'Deterministic inject-probe model',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
    streamSimple: (model: any, context: any) => {
      const index = ++requestIndex;
      record(context, index);
      const stream = createAssistantMessageEventStream();
      // AIRP_INJECT_PROBE_TOOLCALL='{"name":…,"arguments":{…}}': the FIRST request
      // calls that tool, the next one ends the turn (agent-session-isolation.test.mjs).
      const scripted = process.env.AIRP_INJECT_PROBE_TOOLCALL;
      const message = scripted
        ? index === 1
          ? assistantMessage(model, [{ type: 'toolCall', id: `inject_probe_${index}`, ...JSON.parse(scripted) }], 'toolUse')
          : assistantMessage(model, [{ type: 'text', text: 'probe turn done' }], 'stop')
        : index === 2
          ? assistantMessage(
              model,
              [
                {
                  type: 'toolCall',
                  id: `inject_probe_${index}`,
                  // An AIRP tool registered by `extensions/tools.ts`; a plain
                  // scripted turn would leave the tool loop uncovered (A4).
                  name: 'chalk',
                  arguments: {
                    path: PROBE_CHALK_PATH,
                    content: '# Inject Probe\n\nThe tool loop is covered.',
                  },
                },
              ],
              'toolUse'
            )
          : assistantMessage(model, [{ type: 'text', text: 'probe turn done' }], 'stop');
      queueMicrotask(() => streamScript(stream, message));
      return stream;
    },
  });
}
