import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Edition IDs are packaging only; scene, item and character paths never change.
export const editionFamilies = [
  // 2026-10-02: the family now ships 雾坞镇·潮前 — the closed tide-clock TRPG first
  // written in Chinese as templates/wuwu-tide. The semi-open Fogwharf is kept only in
  // version control history (last commit before feat/worlds-v2).
  { base: 'wuwu', source: 'wuwu-zh', en: 'Fogwharf: Before the Tide', ja: '霧埠の町・潮の前', zh: '雾坞镇·潮前', ko: '안개부두 마을: 밀물 전', sourceLocale: 'zh-CN' },
  { base: 'whitechapel', source: 'whitechapel-playtest', en: 'Holmes: The Fourth Case', ja: 'ホームズ：四つ目の事件', zh: '福尔摩斯：第四件案子', ko: '홈즈: 네 번째 사건' },
  { base: 'divergence', source: 'divergence-playtest', en: 'Divergence', ja: '分岐線', zh: '分歧线', ko: '분기선' },
  { base: 'firstsnow', source: 'first-snow-jp-playtest', en: 'First Snow Radio', ja: '初雪ラジオ', zh: '初雪电台', ko: '첫눈 라디오' },
  { base: 'magic-academy', source: 'magic-academy-playtest', en: 'Magic Academy', ja: '魔法学院', zh: '魔法学院', ko: '마법 학원' },
  { base: 'unwritten-door', source: 'unwritten-door-playtest', en: 'The Unwritten Door', ja: '未書の扉', zh: '未写之门', ko: '쓰이지 않은 문' },
  { base: 'moonlit-contract', source: 'moonlit-contract', en: 'The Moonlit Pact', ja: '月下の誓い', zh: '月下之誓', ko: '달빛 아래의 맹세' },
  // Chinese-first TRPG worlds (2026-10-02). `sourceLocale: 'zh-CN'` marks a family
  // written in Chinese: tools/localize-from-zh.mjs builds its en and ja editions from
  // templates/<base>-zh. The English edition is still the executable contract.
  { base: 'last-train', source: 'last-train-zh', en: 'The Last Train', ja: '終電', zh: '末班车', ko: '막차', sourceLocale: 'zh-CN' },
  { base: 'guixiang', source: 'guixiang-zh', en: 'Homecoming', ja: '帰郷', zh: '归乡', ko: '귀향', sourceLocale: 'zh-CN' },
  // 赝作师 (2026-10-08): written in Chinese; the four editions are generated from one
  // structure, so ids, dice, bands and commands are identical by construction.
  { base: 'forger', source: 'forger-zh', en: 'The Forger', ja: '贋作師', zh: '赝作师', ko: '위작 화가', sourceLocale: 'zh-CN' },
  // The first living world (2026-10-08, the design notes): time passes and the
  // islanders keep their own days. Chinese-first; `intro.experimental` until its art lands.
  { base: 'islet', source: 'islet-zh', en: 'Shiomi Isle', ja: '潮見島', zh: '潮见岛', ko: '시오미 섬', sourceLocale: 'zh-CN' },
  // 2026-10-08: 最后的证人 — a closed snowbound-manor interrogation whose culprit is drawn
  // per run (world.json `variants`, the design notes). Written in Chinese.
  { base: 'last-witness', source: 'last-witness-zh', en: 'The Last Witness', ja: '最後の証人', zh: '最后的证人', ko: '마지막 증인', sourceLocale: 'zh-CN' },
  // 2026-10-10: 末班车 · 序章 — the first-run prologue. A separate family so the
  // full last-train is untouched; the art is the same files (same sha256). `publish: false`: the storage
  // migration (tools/migrate-worlds-to-storage.mjs, `release.sh worlds`) skips it — it ships with the site
  // as a guest-trial world when the build turns the first-run experience on, never in the public catalog.
  { base: 'last-train-prologue', source: 'last-train-prologue-zh', en: 'The Last Train · Prologue', ja: '終電・序章', zh: '末班车 · 序章', ko: '막차 · 서장', sourceLocale: 'zh-CN', publish: false },
];
/** Families the storage migration publishes (`publish: false` keeps one out of `release.sh worlds`). */
export const publishedFamilies = () => editionFamilies.filter((family) => family.publish !== false);
// `ko` titles (2026-10-03) are a first hand-made pass, to review with the
// glossaries (tools/world-glossaries/*.json `ko`).

/** Every edition locale the tools know. English is the executable contract; the others are localized copies. */
export const allEditionLocales = ['en', 'ja', 'zh-CN', 'ko'];
/**
 * Locales whose editions may not exist yet: until ANY edition of such a locale
 * is in templates/, the gates and the storage migration ignore it; as soon as
 * one exists, every family must have one (check:worlds asserts exactly one
 * edition per family and locale). Korean was provisional until its nine
 * editions landed (2026-10-03, tools/korean-overnight.sh); it is required since.
 */
export const provisionalEditionLocales = [];
const SUFFIX = { en: '', ja: '-jp', 'zh-CN': '-zh', ko: '-ko' };
// First Snow ships as `first-snow` (the family key stays `firstsnow`).
export const editionId = (family, locale) => (family.base === 'firstsnow' ? 'first-snow' : family.base) + SUFFIX[locale];
const templatesDir = fileURLToPath(new URL('../templates/', import.meta.url));
/** Is any edition of `locale` present in `templates/` (a directory with a world.json)? */
export const hasAnyEdition = (locale, root = templatesDir) =>
  editionFamilies.some((family) => fs.existsSync(path.join(root, editionId(family, locale), 'world.json')));
/**
 * The families this copy carries: at least one edition in `root`. The registry above keeps every family;
 * the open-source copy ships only some worlds, so the gates and the tests that walk
 * "every family" walk this list. In the full repository it is every family.
 */
export const shippedFamilies = (root = templatesDir) =>
  editionFamilies.filter((family) => allEditionLocales.some((locale) => fs.existsSync(path.join(root, editionId(family, locale), 'world.json'))));
/** Published locales: the settled ones, plus a provisional one once its editions exist. */
export const editionLocales = allEditionLocales.filter((l) => !provisionalEditionLocales.includes(l) || hasAnyEdition(l));
export const templateArchive = 'archive/templates/pre-bilingual-2026-09-14';

/**
 * Experimental sandboxes (`world.json` `exp: true`) are not shipped editions.
 *
 * `templates/fpal` is a deliberate, permanent exception: it exists so a
 * character can be carried onto the canvas with their own pi-memory DB, and it
 * is NOT one of the 21 canonical bilingual editions. Every gate that enumerates
 * `templates/*` as "the edition set" must skip it — otherwise the sandbox can
 * only exist by deleting it.
 *
 * This is a DIRECTORY-NAME-INDEPENDENT check on purpose: the marker lives in the
 * manifest, so an experiment never has to be named a special way to be ignored,
 * and `world-editions.mjs` stays the one place that knows the rule.
 *
 * Fail-soft: an unreadable/malformed manifest is NOT experimental (a gate should
 * still see a broken world and complain about it).
 */
export function isExperimentalWorld(tier, world) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(tier, world, 'world.json'), 'utf8'));
    return manifest.exp === true;
  } catch {
    return false;
  }
}
