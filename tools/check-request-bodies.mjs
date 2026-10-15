#!/usr/bin/env node
/**
 * check-request-bodies.mjs — mechanical gate for the HTTP request-body keys the
 * browser sends to the AIRP action routes.
 *
 * The WS gate (`check-ws-contract.mjs`) catches frame-name drift between the
 * two ends. Request bodies have no such net: they are plain `JSON.stringify`
 * literals on the frontend and destructured fields on the server, with no
 * shared type to make the compiler complain when one side renames a key. That
 * is exactly how `/api/dice` shipped broken — `DiceRoller.tsx` posted
 * `{ filePath, rollType, expect }` while `routes/world.ts` read `body.path`,
 * so every player-initiated roll returned 400 (fixed in the wiring A batch).
 *
 * This gate pins the frozen bodies to the call sites, so a
 * rename on either end fails loudly instead of silently 400ing at runtime.
 *
 * Run:  node tools/check-request-bodies.mjs          (0 = clean, 1 = findings)
 *       node tools/check-request-bodies.mjs --json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const JSON_OUT = process.argv.includes('--json');

/**
 * The frozen request bodies. Each entry names
 * the frontend file that posts the body, the route literal to locate the call,
 * and the exact key set that MUST appear in `JSON.stringify({...})`.
 *
 * Convention: entries are keyed by route and matched on the `fetch('<route>', …)`
 * text. A read-only GET (e.g. `GET /api/live/config`, `GET /api/tts/config`) has
 * no body to pin, so it is NOT registered — the gate's whole premise is a frozen
 * request-body key set, and a bodyless route has none.
 */
const BODIES = [
  {
    route: '/api/material-review',
    // Moved by the design notes P2: the card panel and the left rail share ONE choice
    // implementation, so the request lives in the hook, not in either caller.
    file: 'apps/web/src/lib/use-declared-choice.tsx',
    keys: ['world', 'path', 'choice', 'revision', 'selections'],
    doc: 'docs/gameplay/多槽材料与统一行动入口.md',
  },
  {
    route: '/api/dice',
    file: 'apps/web/src/components/narrative/DiceRoller.tsx',
    keys: ['path'],
    doc: 'docs/wiring/00-共同上下文.md §6',
  },
  {
    route: '/api/skill-check',
    // The player uses a skill from their character sheet; the server frames a check card.
    file: 'apps/web/src/components/chrome/CharacterSheet.tsx',
    keys: ['skill', 'intent'],
    doc: 'docs/gameplay/角色技能与判定.md §3.2',
  },
  {
    route: '/api/tts',
    // The network half moved out of CharacterModal on 2026-09-21 so the
    // companion dock speaks through the SAME call instead of a second one.
    file: 'apps/web/src/lib/tts-request.ts',
    keys: ['text', 'voice', 'language', 'characterId', 'emotion', 'savePath'],
    doc: 'docs/wiring/00-共同上下文.md §6',
  },
  // The gateway (`airp-gateway.ts`) wraps bodies in `json('POST', {...})` rather
  // than an inline `fetch(... JSON.stringify({...}))` — so `bodyKeysFor` MUST also
  // read that shape, or a rename here sails through unseen. This is exactly how
  // `/api/god-action` shipped posting `filePath` against the server's `path`
  // (2026-09-13 merge): the gate's scan missed the wrapper entirely.
  {
    route: '/api/god-action',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['action', 'path', 'content', 'mode'],
    doc: 'docs/wiring/00-共同上下文.md §6',
  },
  {
    route: '/api/use-item',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['item', 'target'],
    doc: 'docs/tools/12-工具注册与路由统一.md §6',
  },
  // The player's sticky notes + clue board:
  // one `op` per request; unused keys are sent as undefined (dropped by JSON).
  {
    route: '/api/player-note',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['op', 'layer', 'path', 'text', 'color', 'size', 'x', 'y'],
    doc: 'docs/gameplay/玩家便签与线索板.md §3',
  },
  {
    route: '/api/player-board',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['op', 'from', 'to', 'label', 'id', 'path', 'tag'],
    doc: 'docs/gameplay/玩家便签与线索板.md §3',
  },
  // The player's beat and the character tick: the page sends the
  // layer it shows, so "only on this page" is the page the player is looking at.
  {
    route: '/api/turn-end',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['layer'],
    doc: 'docs/gameplay/角色回合.md §1.1',
  },
  {
    route: '/api/tick/seen',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['id'],
    doc: 'docs/gameplay/角色回合.md §1.2',
  },
  {
    route: '/api/tick/guard',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['id', 'layer'],
    doc: 'docs/gameplay/角色回合.md §4.2',
  },
  {
    // v2: a beat has started — the server sends the next beat's model call beside the writer.
    route: '/api/tick/prefetch',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['layer'],
    doc: 'docs/gameplay/角色回合-v2.md §9.2',
  },
  {
    route: '/api/move',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['from', 'to'],
    doc: 'docs/tools/12-工具注册与路由统一.md §6',
  },
  // The 复盘 / debrief after an ending: mystery id → option id.
  {
    route: '/api/world/debrief',
    file: 'apps/web/src/lib/closed-run.ts',
    keys: ['answers'],
    doc: 'docs/gameplay/终局问答.md §4',
  },
  // NPC cards: one player line → one reply in the NPC's voice.
  {
    route: '/api/npc/talk',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['path', 'message'],
    doc: 'docs/gameplay/NPC物件.md §3',
  },
  {
    route: '/api/choice',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['path', 'choice'],
    doc: 'docs/tools/12-工具注册与路由统一.md §6',
  },
  {
    route: '/api/card/position',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['path', 'x', 'y'],
    doc: 'docs/tools/12-工具注册与路由统一.md §6',
  },
  // The workshop: making a world, and flipping
  // its published state. `cover` is a tagged object (generate | upload); the
  // gate pins the top-level keys, the server validates the shape.
  {
    route: '/api/worlds/create',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['name', 'description', 'locale', 'playerName', 'cover', 'theme', 'location'],
    doc: 'docs/worlds/创作与发布.md §2',
  },
  {
    route: '/api/worlds/create/suggest',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['locale', 'name', 'description', 'playerName', 'coverPrompt', 'theme'],
    doc: 'docs/worlds/创作与发布.md §2',
  },
  // Loading a world; `fresh` starts a new game of the author's own draft
  // (the in-world 「重新开始这个世界」, the design notes).
  {
    route: '/api/worlds/load',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['worldPath', 'fresh'],
    doc: 'docs/worlds/创作与发布.md §2',
  },
  {
    route: '/api/worlds/publish',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['worldPath'],
    doc: 'docs/worlds/创作与发布.md §2',
  },
  {
    route: '/api/worlds/unpublish',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['worldPath'],
    doc: 'docs/worlds/创作与发布.md §2',
  },
  // Local ↔ remote: the local proxy routes.
  // `POST /api/remote/test` and `/api/remote/logout` are bodyless; the
  // implicit-flow callback POST is sent by the server's own callback page
  // (routes/remote.ts), and the machine-to-machine `/api/sync/*` upload is a
  // gzipped tar sent by the local SERVER (apps/server/src/sync/remote-client.ts),
  // never by the app, so neither has a key set to pin here.
  {
    route: '/api/remote/settings',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['url'],
    doc: 'docs/gameplay/远端与租户.md',
  },
  {
    route: '/api/remote/login',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['method', 'email', 'origin', 'device'],
    doc: 'docs/gameplay/远端与租户.md',
  },
  {
    route: '/api/remote/guest',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['device'],
    doc: 'docs/accounts/游客试玩.md',
  },
  {
    route: '/api/remote/login/verify',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['email', 'code'],
    doc: 'docs/gameplay/远端与租户.md',
  },
  {
    route: '/api/remote/push',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['worldPath'],
    doc: 'docs/gameplay/远端与租户.md',
  },
  {
    route: '/api/remote/sync',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['worldPath'],
    doc: 'docs/worlds/本机与云端.md §5',
  },
  {
    route: '/api/remote/sync/cloud',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['worldPath'],
    doc: 'docs/worlds/本机与云端.md §4',
  },
  {
    route: '/api/remote/sync/keep-both',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['worldPath'],
    doc: 'docs/worlds/本机与云端.md §5.2',
  },
  {
    route: '/api/remote/pull',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['id', 'from', 'replace'],
    doc: 'docs/gameplay/远端与租户.md',
  },
  {
    route: '/api/remote/publish',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['id'],
    doc: 'docs/gameplay/远端与租户.md',
  },
  {
    route: '/api/remote/unpublish',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['id', 'worldPath'],
    doc: 'docs/gameplay/远端与租户.md',
  },
  {
    route: '/api/remote/force-unpublish',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['id', 'reason'],
    doc: 'docs/gameplay/远端与租户.md §6.3',
  },
  // The first-entry intro of a workshop world: three setup answers, saved to
  // player/README.md; the suggest route fills the blanks with the same keys.
  {
    route: '/api/world-intro',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['identity', 'goal', 'first'],
    doc: 'docs/gameplay/主题.md §4',
  },
  {
    route: '/api/world-intro/suggest',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['identity', 'goal', 'first'],
    doc: 'docs/gameplay/主题.md §4',
  },
  // 「再生成一批」: a fresh batch of lines to say to one character or NPC card.
  {
    route: '/api/replies/suggest',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['character', 'npc', 'layer', 'recent'],
    doc: 'docs/ux/27-选项分流与提示.md §8.1',
  },
  // Creation-mode art: the 素材 panel's writes.
  // `GET /api/workshop/art` is bodyless and not registered.
  {
    route: '/api/workshop/art/prompt',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['slot', 'prompt'],
    doc: 'docs/gameplay/创作素材.md §3',
  },
  {
    route: '/api/workshop/art/generate',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['slot', 'prompt', 'cutout'],
    doc: 'docs/gameplay/创作素材.md §3',
  },
  {
    route: '/api/workshop/art/upload',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['slot', 'mimeType', 'dataB64', 'cutout'],
    doc: 'docs/gameplay/创作素材.md §3',
  },
  // Creation-mode 设定: the draft's world type / rules / structure, edited
  // again after creation. `GET /api/workshop/theme` is bodyless.
  {
    route: '/api/workshop/theme',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['theme', 'confirmReset'],
    doc: 'docs/gameplay/主题.md §2.2',
  },
  // The 设定 tab's music picker (`GET /api/workshop/music` is bodyless).
  {
    route: '/api/workshop/music',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['layer', 'track', 'ambient'],
    doc: 'docs/audio/音乐目录.md',
  },
  // Character sheets in the draft (`GET /api/workshop/sheets` is bodyless).
  {
    route: '/api/workshop/sheet',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['target', 'sheet'],
    doc: 'docs/gameplay/角色技能与判定.md §7',
  },
  {
    route: '/api/opening',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['shown'],
    doc: 'docs/ux/22-三栏陪伴布局（niko 版）.md §4',
  },
  {
    route: '/api/following',
    file: 'apps/web/src/lib/airp-gateway.ts',
    keys: ['character', 'following'],
    doc: 'docs/presence/00-共同上下文.md §3.3',
  },
  // the design notes freezes all three Live POST bodies;
  // `GET /api/live/config` is bodyless and deliberately not registered.
  {
    route: '/api/live/session',
    file: 'apps/web/src/lib/live-call-store.ts',
    keys: ['character', 'sdp', 'language', 'savePath'],
    doc: 'docs/live-voice/00-共同上下文.md §2.2',
  },
  {
    route: '/api/live/close',
    file: 'apps/web/src/lib/live-call-store.ts',
    keys: ['character', 'savePath'],
    doc: 'docs/live-voice/00-共同上下文.md §2.2',
  },
  {
    route: '/api/live/voice-live/ticket',
    file: 'apps/web/src/lib/voice-live-call.ts',
    keys: ['characterId', 'savePath'],
    doc: 'docs/live-voice/00-共同上下文.md §2.2',
  },
];

/**
 * Split an object literal's inner text on TOP-LEVEL commas, ignoring commas
 * nested inside (), [], {}, strings and template literals. Returns the raw
 * property chunks so each can be inspected for its key.
 */
function splitTopLevel(inner) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') { cur += inner[++i] ?? ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/**
 * Extract the body key set for `route`, from whichever call shape carries it:
 *   1. inline `fetch('<route>', { … body: JSON.stringify({...}) })`;
 *   2. the gateway wrapper `request('<route>', json('POST', {...}))`.
 *
 * Handles both `name: value` and shorthand `name` properties — the shorthand
 * form is common and MUST not be read as an empty key set (that would make the
 * gate fire on already-correct code).
 *
 * Pure — takes file text, returns `{ keys, line } | null`. `null` means neither
 * shape could be found (itself a finding).
 */
export function bodyKeysFor(text, route) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // The route as a quoted literal, so `/api/worlds/create` does not also
    // claim `/api/worlds/create/suggest` (both are pinned, with different keys).
    if (!lines[i].includes(`'${route}'`) && !lines[i].includes(`"${route}"`)) continue;
    // A comment that merely MENTIONS the route (e.g. a doc note `fetch('/api/tts'`
    // in a JSDoc block) must not be taken for the call: it has no balanced body,
    // so the scan would stop there and report a false "call site moved". Skip
    // comment-only lines and take the first real call.
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (lines[i].includes('fetch(')) {
      // Gather the fetch call's text until parens balance (bounded window).
      let depth = 0;
      let chunk = '';
      let sawParen = false;
      for (let j = i; j < Math.min(lines.length, i + 15); j++) {
        chunk += lines[j] + '\n';
        depth += (lines[j].match(/\(/g) ?? []).length - (lines[j].match(/\)/g) ?? []).length;
        if (lines[j].includes('(')) sawParen = true;
        if (sawParen && depth <= 0) break;
      }
      const s = chunk.match(/JSON\.stringify\(\s*\{([\s\S]*?)\}\s*\)/);
      if (s) return { keys: keysOfObjectLiteral(s[1]), line: i + 1 };
      return null;
    }
    // Shape 2: gateway `json('POST', {...})`. The route and the body may be on
    // adjacent lines, so scan the call until parens balance.
    if (lines[i].includes('json(')) {
      let depth = 0;
      let chunk = '';
      let sawParen = false;
      for (let j = i; j < Math.min(lines.length, i + 15); j++) {
        chunk += lines[j] + '\n';
        depth += (lines[j].match(/\(/g) ?? []).length - (lines[j].match(/\)/g) ?? []).length;
        if (lines[j].includes('(')) sawParen = true;
        if (sawParen && depth <= 0) break;
      }
      const s = chunk.match(/json\(\s*['"][A-Z]+['"]\s*,\s*\{([\s\S]*?)\}\s*\)/);
      if (s) return { keys: keysOfObjectLiteral(s[1]), line: i + 1 };
      return null;
    }
  }
  return null;
}

/** Property keys of an object literal's inner text (`name:` / shorthand `name`). */
function keysOfObjectLiteral(inner) {
  const keys = [];
  for (const part of splitTopLevel(inner)) {
    // `name:` (explicit) or `name` (shorthand); a `...spread` contributes none.
    const m = part.match(/^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*(?::|$)/);
    if (m && !part.trim().startsWith('...')) keys.push(m[1]);
  }
  return keys;
}

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf-8');

/**
 * Pure comparison, exported so `check-request-bodies.test.mjs` can drive it
 * with synthetic input (the gate stays non-empty by construction).
 *
 * `found` = `{ keys, line } | null` from `bodyKeysFor`.
 */
export function compare({ bodies, found }) {
  const out = [];
  for (const b of bodies) {
    const f = found.get(b.route);
    if (!f) {
      out.push({
        check: 'missing-call',
        file: b.file,
        line: 0,
        message: `no \`fetch('${b.route}', … JSON.stringify({...}))\` call found`,
        fix: 'the call site moved or was renamed; update BODIES in tools/check-request-bodies.mjs',
        doc: b.doc,
      });
      continue;
    }
    const want = [...b.keys].sort();
    const got = [...f.keys].sort();
    if (want.join(',') !== got.join(',')) {
      out.push({
        check: 'key-drift',
        file: b.file,
        line: f.line,
        message: `POST ${b.route} body keys = [${got.join(', ')}], contract says [${want.join(', ')}]`,
        fix: `post exactly ${JSON.stringify(want)} (frozen in ${b.doc})`,
        doc: b.doc,
      });
    }
  }
  return out;
}

function main() {
  const found = new Map();
  for (const b of BODIES) found.set(b.route, bodyKeysFor(read(b.file), b.route));

  const findings = compare({ bodies: BODIES, found });

  if (JSON_OUT) {
    console.log(JSON.stringify({ findings, summary: { routes: BODIES.length, findings: findings.length } }, null, 2));
  } else if (!findings.length) {
    console.log(`check-request-bodies: clean (${BODIES.length} route(s) pinned)`);
  } else {
    for (const f of findings) {
      console.log(`${f.check.toUpperCase().padEnd(12)} ${f.file}:${f.line}`);
      console.log(`             ${f.message}`);
      console.log(`             fix: ${f.fix}`);
    }
    console.log(`\ncheck-request-bodies: ${findings.length} finding(s)`);
  }
  return findings.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main() ? 1 : 0);
}
