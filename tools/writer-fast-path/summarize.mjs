#!/usr/bin/env node
/**
 * Writer fast path — summarise one or more replay result files side by side with
 * the original agent turns.
 *
 *   node tools/writer-fast-path/summarize.mjs <results-a.json> [<results-b.json> …]
 *
 * 首字 = beat start → first chalk character on the chalk lane (pack build included);
 * 完成 = beat start → the fast path returned (call + validation + ops + repair).
 */
import fs from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: summarize.mjs <results.json>…'); process.exit(2); }
const q = (xs, p) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const sec = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(1));

for (const file of files) {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`\n## ${file}  (${rows.length} turns)\n`);
  console.log('| # | 请求 | 原：首块 chalk / 整轮 / 步数 | 快：首字 / 完成 / 输出tok / 缓存命中 | 操作 合法/总数 | 备注 |');
  console.log('|---|---|---|---|---|---|');
  let opsTotal = 0, opsOk = 0, repairs = 0, fixes = 0, fallbacks = 0;
  for (const r of rows) {
    const o = r.original;
    opsTotal += r.legal?.total ?? 0; opsOk += r.legal?.ok ?? 0;
    if (r.repair) repairs++;
    if (!r.handled) fallbacks++;
    fixes += (r.fixes ?? []).length;
    const req = r.request.replace(/\[Current Layer\] \S+ \/ /, '').replace(/\|/g, '/').slice(0, 34);
    const note = [r.handled ? '' : `降级:${r.fallback}`, r.repair ? '修正' : '', r.rebind ? `骰 ${r.rebind.score}→${r.rebind.grade} 发:${r.rebind.created.map((p) => p.split('/').pop()).join('+') || '无'}` : ''].filter(Boolean).join(' ');
    console.log(`| ${r.index} | ${req} | ${sec(o.firstChalkMs)} / ${sec(o.durationMs)} / ${o.steps} | ${sec(r.firstInkMs)} / ${sec(r.beatMs)} / ${r.usage?.completion_tokens ?? '—'} / ${r.usage?.prompt_cache_hit_tokens ?? 0}/${r.usage?.prompt_tokens ?? 0} | ${r.legal ? `${r.legal.ok}/${r.legal.total}` : '—'} | ${note} |`);
  }
  const fast = { first: rows.map((r) => r.firstInkMs), done: rows.map((r) => r.beatMs), out: rows.map((r) => r.usage?.completion_tokens), inp: rows.map((r) => r.usage?.prompt_tokens), hit: rows.map((r) => r.usage?.prompt_cache_hit_tokens) };
  const orig = { first: rows.map((r) => r.original.firstChalkMs), done: rows.map((r) => r.original.durationMs) };
  console.log(`\n| 指标 | 原 agent 中位 | 原 p90 | 快路径 中位 | 快路径 p90 | 快路径 最慢 |`);
  console.log('|---|---|---|---|---|---|');
  console.log(`| 首字 / 首块 chalk 上屏 (s) | ${sec(q(orig.first, 0.5))} | ${sec(q(orig.first, 0.9))} | ${sec(q(fast.first, 0.5))} | ${sec(q(fast.first, 0.9))} | ${sec(q(fast.first, 1))} |`);
  console.log(`| 整轮完成 (s) | ${sec(q(orig.done, 0.5))} | ${sec(q(orig.done, 0.9))} | ${sec(q(fast.done, 0.5))} | ${sec(q(fast.done, 0.9))} | ${sec(q(fast.done, 1))} |`);
  console.log(`\n快路径输入 token 中位 ${q(fast.inp, 0.5)}（缓存命中中位 ${q(fast.hit, 0.5)}），输出中位 ${q(fast.out, 0.5)}；操作 ${opsOk}/${opsTotal} 由引擎执行成功；修正 ${repairs} 拍；降级到 agent ${fallbacks} 拍；chalk 就地修正 ${fixes} 处。`);
  const rolls = rows.filter((r) => r.rebind);
  if (rolls.length) {
    console.log('\n掷骰拍（引擎绑定 spot 后按档发放）：');
    for (const r of rolls) console.log(`- #${r.index} ${r.rebind.score} → ${r.rebind.grade}，spot=${r.rebind.spot ?? '无'}，引擎落卡：${r.rebind.created.join('、') || '无'}${r.rebind.removedAgentCopies.length ? `（移除原 agent 手写的同路径卡 ${r.rebind.removedAgentCopies.join('、')}）` : ''}`);
  }
}
