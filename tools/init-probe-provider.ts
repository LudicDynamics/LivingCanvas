/**
 * Deterministic provider for the engine-spawn INIT probe (`tools/probe-init.mjs`).
 *
 * Lives in `tools/` on purpose — `presets.ts::extensionArgs` only scans
 * `extensions/` and `<worldRoot>/extensions/`, so this file can never be loaded
 * by a production run. The probe passes it explicitly with `--extension`.
 *
 * It plays the initializer subagent: when it sees an init brief on the wire
 * (`[Task] Instantiate a scene layer` / `… a character nook`), it parses
 * `[Target Path] <dir>` out of the brief and emits `write` tool calls for that
 * directory — `README.md` plus one content file — then stops. That is exactly
 * what a real initializer does, minus the model.
 *
 * `RpcClient` runs the agent as a CHILD process, so the probe cannot read this
 * process's memory; the probe observes the filesystem and `history.db` instead.
 * The provider also appends each request's wire text to `AIRP_INIT_PROBE_OUT` so
 * the probe can assert the brief really reached the model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';

const PROVIDER_ID = 'airp-init-probe';
const MODEL_ID = 'deterministic';

const SCENE_MARK = '[Task] Instantiate a scene layer';
const NOOK_MARK = '[Task] Instantiate a character nook';

/** Minimal shapes at this boundary — the probe provider is not type-checked. */
interface ModelRef {
  api: string;
  provider: string;
  id: string;
}
interface ContentBlock {
  type: string;
  text?: string;
}
interface WireMessage {
  content?: unknown;
}
interface ProviderContext {
  messages?: WireMessage[];
}
/** The slice of the provider stream we script (pi-ai's own type is not exported here). */
interface ScriptStream {
  push(event: Record<string, unknown>): void;
  end(message: unknown): void;
}

/** One write cycle per init brief (the probe runs one init per world). */
let wroteForInit = false;
let requestCount = 0;

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: ContentBlock) => (typeof block?.text === 'string' ? block.text : ''))
    .filter((s) => s !== '')
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

function streamScript(stream: ScriptStream, message: { content: ContentBlock[]; stopReason: string }): void {
  stream.push({ type: 'start', partial: { ...message, content: [], stopReason: 'pending' } });
  message.content.forEach((block, i) => {
    if (block.type === 'text') {
      stream.push({ type: 'text_start', contentIndex: i, partial: message });
      stream.push({ type: 'text_delta', contentIndex: i, delta: block.text, partial: message });
      stream.push({ type: 'text_end', contentIndex: i, content: block.text, partial: message });
    } else if (block.type === 'toolCall') {
      stream.push({ type: 'toolcall_start', contentIndex: i, partial: message });
      stream.push({ type: 'toolcall_delta', contentIndex: i, delta: JSON.stringify(block), partial: message });
      stream.push({ type: 'toolcall_end', contentIndex: i, toolCall: block, partial: message });
    }
  });
  stream.push({ type: 'done', reason: message.stopReason, message });
  stream.end(message);
}

function record(index: number, texts: string[]): void {
  const out = process.env.AIRP_INIT_PROBE_OUT;
  if (!out) return;
  try {
    fs.appendFileSync(out, JSON.stringify({ requestIndex: index, texts }) + '\n');
  } catch {
    // The probe fails its "no requests recorded" assertion; never derail the run.
  }
}

/** The `[Target Path]` value from an init brief, or null. */
function targetPathOf(text: string): string | null {
  const m = /^\[Target Path\] (.+)$/m.exec(text);
  return m ? m[1].trim() : null;
}

/** The three-line [Report] the initializer is asked for. */
function reportText(kind: string, dir: string): string {
  return [
    `${dir}/README.md, ${dir}/01-probe.md`,
    `A deterministic ${kind} for the probe.`,
    `The detail worth noticing is that this file exists.`,
  ].join('\n');
}

export default function initProbeProvider(pi: { registerProvider(id: string, config: unknown): void }): void {
  pi.registerProvider(PROVIDER_ID, {
    name: 'AIRP Init Probe (deterministic)',
    baseUrl: 'http://127.0.0.1:0',
    apiKey: 'probe-key',
    api: 'openai-completions',
    models: [
      {
        id: MODEL_ID,
        name: 'Deterministic init-probe model',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
    streamSimple: (model: ModelRef, context: ProviderContext) => {
      const texts = (context?.messages ?? []).map((m) => textOf(m.content));
      const index = ++requestCount;
      record(index, texts);

      const joined = texts.join('\n');
      const isScene = joined.includes(SCENE_MARK);
      const isNook = joined.includes(NOOK_MARK);
      const dir = targetPathOf(joined);

      let message: ReturnType<typeof assistantMessage>;
      if ((isScene || isNook) && dir && !wroteForInit) {
        wroteForInit = true;
        const kind = isScene ? 'scene' : 'nook';
        const contentArg = isScene
          ? '---\ntype: chalk\n---\n\nA probe scene, written by the deterministic initializer.\n'
          : '---\ntype: note\ntitle: Probe note\n---\n\nA probe note.\n';
        // Scenes write their README with the native `write` tool; a nook's
        // README is a profile configuration file, which native write/edit is
        // blocked from — the initializer must go through the trusted
        // `edit_character_config` channel.
        const readmeCall = isNook
          ? {
              type: 'toolCall',
              id: `init_probe_readme_${index}`,
              name: 'edit_character_config',
              arguments: {
                characterId: path.basename(dir),
                file: 'README.md',
                content: `---\ntype: readme\nname: Probe ${kind}\nmaterial: parchment\n---\n\n# Probe ${kind}\n\nInstantiated by the init probe.\n`,
                mode: 'replace',
              },
            }
          : {
              type: 'toolCall',
              id: `init_probe_readme_${index}`,
              name: 'write',
              arguments: {
                path: `${dir}/README.md`,
                content: `---\ntype: readme\nname: Probe ${kind}\nmaterial: parchment\n---\n\n# Probe ${kind}\n\nInstantiated by the init probe.\n`,
              },
            };
        message = assistantMessage(
          model,
          [
            readmeCall,
            {
              type: 'toolCall',
              id: `init_probe_content_${index}`,
              name: 'write',
              arguments: { path: `${dir}/01-probe.md`, content: contentArg },
            },
          ],
          'toolUse'
        );
      } else if ((isScene || isNook) && dir) {
        // Second request of the init loop (tool results came back): report and stop.
        message = assistantMessage(model, [{ type: 'text', text: reportText(isScene ? 'scene' : 'nook', dir) }], 'stop');
      } else {
        // The writer's own turn (the command itself does not call the model).
        message = assistantMessage(model, [{ type: 'text', text: 'probe: writer idle' }], 'stop');
      }

      const stream = createAssistantMessageEventStream() as unknown as ScriptStream;
      queueMicrotask(() =>
        streamScript(stream, message as unknown as { content: ContentBlock[]; stopReason: string })
      );
      return stream;
    },
  });
}
