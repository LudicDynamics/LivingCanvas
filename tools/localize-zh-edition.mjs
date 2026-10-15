#!/usr/bin/env node
// Chinese (zh-CN) editions. The English edition is the executable contract: the
// Chinese edition is rebuilt from it, replacing ONLY the human-text units that
// `mapText` recognises, so ids, paths, conditions and assets stay byte-for-byte.
// The aligned Japanese text is extracted as translation reference.
//
//   node tools/localize-zh-edition.mjs extract [base…]   → .artifacts/zh-edition/<base>/source.json
//   (translators write .artifacts/zh-edition/<base>/zh/*.json : { "<key>": "中文…" })
//   node tools/localize-zh-edition.mjs check   [base…]   → missing / protected-token / kana report
//   node tools/localize-zh-edition.mjs build   [base…]   → templates/<id>-zh
//   node tools/localize-zh-edition.mjs status            → progress per world
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, WorldManifestSchema } from '../packages/shared/dist/index.js';
import { md } from './experiences/common.mjs';
import { editionFamilies, editionId } from './world-editions.mjs';
import { filesUnder, mapText, protect } from './localize-world-editions.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(repo, '.artifacts/zh-edition');
const ZH = 'zh-CN';
const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const han = /\p{Script=Han}/u;
const isText = f => /\.(md|json)$/.test(f) && !(f.startsWith('assets/') && f.endsWith('.json'));
const translatable = t => t.trim() !== '' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t);
const json = async f => JSON.parse(await fs.readFile(f, 'utf8'));
const exists = f => fs.access(f).then(() => true, () => false);
const saveJson = async (f, v) => { await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, JSON.stringify(v, null, 2) + '\n'); };
const readDocument = (f, raw) => {
  if (f.endsWith('.json')) return JSON.parse(raw);
  const p = parseFrontmatter(raw);
  if (p.errors.length) throw new Error(`${f}: ${p.errors}`);
  return { fm: p.frontmatter ?? {}, body: p.body };
};
const renderDocument = (f, doc) => f.endsWith('.json') ? JSON.stringify(doc, null, 2) + '\n' : Object.keys(doc.fm).length ? md(doc.fm, doc.body) : doc.body;

/** Skill directories follow the edition id: `<id>-play`. */
const skillOf = (family, locale) => `${editionId(family, locale)}-play`;
const localFile = (family, locale, f) => f.replace(/^skills\/[^/]+/, `skills/${skillOf(family, locale)}`);

/**
 * Visit every human-text unit in a fixed order. Frontmatter / JSON strings use
 * `mapText`'s field rules; an md body is ONE unit (paragraph counts differ
 * between languages, so bodies cannot be aligned paragraph by paragraph).
 */
function mapUnits(f, doc, fn) {
  if (!f.endsWith('.md')) return mapText(doc, fn);
  const fm = mapText({ fm: doc.fm }, fn).fm;
  return { fm, body: doc.body.trim() ? fn(doc.body) : doc.body };
}

function familiesFrom(args) {
  const wanted = args.filter(a => !a.startsWith('--'));
  const out = wanted.length ? editionFamilies.filter(f => wanted.includes(f.base)) : editionFamilies;
  if (wanted.length && out.length !== wanted.length) throw new Error(`Unknown world: ${wanted.join(', ')}`);
  return out;
}

async function extract(families) {
  for (const family of families) {
    const en = path.join(repo, 'templates', editionId(family, 'en'));
    const ja = path.join(repo, 'templates', editionId(family, 'ja'));
    const entries = [];
    for (const f of (await filesUnder(en)).filter(isText)) {
      const enUnits = [];
      mapUnits(f, readDocument(f, await fs.readFile(path.join(en, f), 'utf8')), t => { enUnits.push(t); return t; });
      const jaFile = path.join(ja, localFile(family, 'ja', f));
      const jaUnits = [];
      if (await exists(jaFile)) mapUnits(f, readDocument(f, await fs.readFile(jaFile, 'utf8')), t => { jaUnits.push(t); return t; });
      const aligned = jaUnits.length === enUnits.length;
      enUnits.forEach((text, i) => {
        if (!translatable(text)) return;
        entries.push({ key: `${f}#${i}`, file: f, en: text, ...(aligned ? { ja: jaUnits[i] } : {}) });
      });
    }
    await saveJson(path.join(work, family.base, 'source.json'), {
      world: family.base, en: editionId(family, 'en'), ja: editionId(family, 'ja'), zh: editionId(family, ZH),
      names: { en: family.en, ja: family.ja, zh: family.zh }, entries,
    });
    console.log(`${family.base}: ${entries.length} units, ${entries.reduce((n, e) => n + e.en.length, 0)} chars → ${path.relative(repo, path.join(work, family.base, 'source.json'))}`);
  }
}

async function translationsOf(family) {
  const dir = path.join(work, family.base, 'zh');
  const merged = {};
  if (!await exists(dir)) return merged;
  for (const f of (await fs.readdir(dir)).filter(n => n.endsWith('.json')).sort()) Object.assign(merged, await json(path.join(dir, f)));
  return merged;
}

/**
 * Protected literals of the English unit must survive (as a multiset) in
 * Chinese. `protect` swallows a sentence-final "." into a path (`world/a.`), so
 * a trailing dot is not part of the literal: Chinese ends that sentence with "。".
 */
const literalKey = l => l.replace(/\.+$/, '');
/** A bare root folder (`player/`) followed by "。" is invisible to `protect`; count it too. */
const BARE_ROOT = /(?:world|player|characters|skills|assets)\/(?![A-Za-z0-9_./*{}-])/g;
function lostLiterals(en, zh) {
  const want = new Map();
  for (const l of protect(en).literals.map(literalKey)) want.set(l, (want.get(l) ?? 0) + 1);
  const have = new Map();
  for (const l of [...protect(zh).literals.map(literalKey), ...(zh.match(BARE_ROOT) ?? [])]) have.set(l, (have.get(l) ?? 0) + 1);
  return [...want].filter(([l, n]) => (have.get(l) ?? 0) < n).map(([l]) => l);
}

/** A path / file name that closes a Chinese sentence takes "。", not an ASCII ". ". */
const PATH_THEN_DOT = /((?:world|player|characters|skills|assets)\/(?:[A-Za-z0-9_./*{}-]*[A-Za-z0-9_/*{}-])?|\b[A-Za-z0-9_-]+\.(?:md|json|webp|png|webm|mp3))\.(?=[ \n]|$)/g;
function chinesePunctuation(text) {
  return text.replace(PATH_THEN_DOT, '$1。').replace(/。 (?=[\p{Script=Han}（「“])/gu, '。');
}

async function check(families, { quiet = false } = {}) {
  let failures = 0;
  for (const family of families) {
    const { entries } = await json(path.join(work, family.base, 'source.json'));
    const zh = await translationsOf(family);
    const problems = [];
    for (const e of entries) {
      const t = zh[e.key];
      if (typeof t !== 'string' || !t.trim()) { problems.push(`MISSING  ${e.key}`); continue; }
      const lost = lostLiterals(e.en, t);
      if (lost.length) problems.push(`TOKENS   ${e.key}: lost ${lost.map(l => JSON.stringify(l)).join(', ')}`);
      if (kana.test(t)) problems.push(`KANA     ${e.key}: ${t.slice(0, 60)}`);
      if (!han.test(t) && /[A-Za-z]{3,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(e.en)) problems.push(`ENGLISH? ${e.key}: ${t.slice(0, 60)}`);
      if (/\bEnglish\b/.test(e.en) && /英语|英文/.test(t) && /speak|narrat|language|output|write/i.test(e.en)) problems.push(`LANGUAGE ${e.key}: adapt the language directive to Chinese`);
    }
    const extra = Object.keys(zh).filter(k => !entries.some(e => e.key === k));
    for (const k of extra) problems.push(`EXTRA    ${k}`);
    failures += problems.length;
    console.log(`${family.base}: ${entries.length - problems.filter(p => p.startsWith('MISSING')).length}/${entries.length} translated, ${problems.length} problem(s)`);
    if (!quiet) for (const p of problems) console.log(`  ${p}`);
  }
  return failures;
}

async function build(families) {
  for (const family of families) {
    if (await check([family], { quiet: true })) throw new Error(`${family.base}: run check and fix every problem before build`);
    const zh = await translationsOf(family);
    const enId = editionId(family, 'en'), zhId = editionId(family, ZH);
    const en = path.join(repo, 'templates', enId);
    const staging = path.join(work, family.base, 'edition');
    await fs.rm(staging, { recursive: true, force: true });
    const enSkill = skillOf(family, 'en'), zhSkill = skillOf(family, ZH);
    for (const f of await filesUnder(en)) {
      const outFile = localFile(family, ZH, f);
      const out = path.join(staging, outFile);
      await fs.mkdir(path.dirname(out), { recursive: true });
      if (!isText(f)) { await fs.copyFile(path.join(en, f), out); continue; }
      let i = 0;
      const doc = mapUnits(f, readDocument(f, await fs.readFile(path.join(en, f), 'utf8')), text => {
        const key = `${f}#${i++}`;
        if (!translatable(text)) return text;
        // A world skill names its own directory; follow the edition's rename.
        return chinesePunctuation(zh[key].replaceAll(`skills/${enSkill}`, `skills/${zhSkill}`));
      });
      if (f === 'world.json') {
        doc.id = zhId; doc.locale = ZH; doc.name = `${family.zh} · 中文`;
        doc.tags = ['短篇故事', '生成世界'];
        WorldManifestSchema.parse(doc);
      }
      if (f.endsWith('/preset.json')) {
        if (typeof doc.id === 'string') doc.id = doc.id.replace(enId, zhId);
        for (const block of doc.items ?? []) {
          if (block.kind === 'block' && block.id === 'world-language') {
            block.content = '说中文。' + block.content.replace(/^(?:(?:请)?(?:说|讲|使用)(?:中文|汉语|普通话|英语|英文)[。.，,]?\s*)+/u, '');
          }
        }
      }
      if (f.endsWith('/SKILL.md')) doc.fm.name = zhSkill;
      await fs.writeFile(out, renderDocument(f, doc));
    }
    const target = path.join(repo, 'templates', zhId);
    if (!zhId.endsWith('-zh')) throw new Error(`Refusing to replace a non-Chinese template: ${zhId}`);
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(staging, target, { recursive: true });
    console.log(`Built templates/${zhId}: ${(await filesUnder(target)).length} files`);
  }
}

async function status() {
  for (const family of editionFamilies) {
    const src = path.join(work, family.base, 'source.json');
    if (!await exists(src)) { console.log(`${family.base}: not extracted`); continue; }
    const { entries } = await json(src);
    const zh = await translationsOf(family);
    console.log(`${family.base}: ${entries.filter(e => typeof zh[e.key] === 'string' && zh[e.key].trim()).length}/${entries.length}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const families = command === 'status' ? [] : familiesFrom(args);
  if (command === 'extract') await extract(families);
  else if (command === 'check') process.exitCode = (await check(families)) ? 1 : 0;
  else if (command === 'build') await build(families);
  else if (command === 'status') await status();
  else throw new Error('Use extract | check | build | status [base…]');
}
