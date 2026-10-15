/**
 * Teach-once cues.
 *
 * The engine only MARKS the moments a new player meets a TRPG mechanic for the
 * first time — an action's result carries `cue: <id>` — and keeps the words
 * here, in the four interface languages. Whether a cue was already taught is
 * the PAGE's business (once per player, across worlds: `apps/web/src/lib/tutorial-cues.ts`),
 * so the engine never writes bookkeeping for it and a cue costs nothing when
 * nobody shows it. The canvas shows none of this yet: the cards land after the
 * canvas / message-stream rework (feat/canvas-stream).
 *
 * Zero dependencies, browser-safe.
 */

export type TutorialCueId = 'first-inspiration' | 'first-passive' | 'first-follow' | 'first-skill';
export type CueLocale = 'en' | 'zh-CN' | 'ja' | 'ko';

export interface TutorialCue {
  id: TutorialCueId;
  /** What the engine was doing when it marked the cue (for the doc and the page). */
  when: string;
  title: Readonly<Record<CueLocale, string>>;
  body: Readonly<Record<CueLocale, string>>;
}

const W = (en: string, zh: string, ja: string, ko: string): Readonly<Record<CueLocale, string>> => ({ en, 'zh-CN': zh, ja, ko });

export const TUTORIAL_CUES: Readonly<Record<TutorialCueId, TutorialCue>> = {
  'first-inspiration': {
    id: 'first-inspiration',
    when: 'POST /api/inspiration resolved (any tier)',
    title: W('Inspiration roll', '灵感骰', 'ひらめきロール', '영감 굴림'),
    body: W(
      'Stuck? Roll for inspiration from your character sheet. The better the roll, the clearer the hint: a critical points at the next step, a failure only a vague feeling, a fumble costs a little. After a roll it needs a while before the next.',
      '卡住了？从角色卡里掷一次灵感骰。掷得越好，提示越清楚：大成功直接指明下一步，失败只有一点模糊的感觉，大失败要付一点小代价。掷过之后要过一阵才能再掷。',
      '行き詰まったら、キャラクターシートからひらめきロールを。出目が良いほどヒントははっきりする：クリティカルなら次の一手、失敗ならぼんやりした予感だけ、ファンブルは小さな代償つき。一度振ると、しばらく振れない。',
      '막혔나요? 캐릭터 시트에서 영감 굴림을 하세요. 결과가 좋을수록 힌트가 또렷합니다: 대성공은 다음 걸음을, 실패는 흐릿한 느낌만, 대실패는 작은 대가를 치릅니다. 한 번 굴리면 한동안 다시 굴릴 수 없습니다.',
    ),
  },
  'first-passive': {
    id: 'first-passive',
    when: 'a passive check succeeded (entering a place / reading a card)',
    title: W('You noticed something', '你注意到了什么', '何かに気づいた', '무언가를 알아챘다'),
    body: W(
      'Some skills work on their own: when you enter a place or look at something, your Spot Hidden, Listen or Occult is rolled quietly for you — and for a companion who is better at it. A success leaves an extra card or detail; a failure leaves nothing, and you are never told.',
      '有些技能会自己起作用：进入一个地点、看一样东西时，引擎会替你暗中掷侦查、聆听、神秘学——同行的同伴更擅长时由同伴来掷。成功会多一张卡或一句细节；失败什么也不留，也不会告诉你。',
      '一部の技能は勝手に働く：場所に入ったり何かを見たりすると、目星・聞き耳・オカルトが裏で振られる——同行者のほうが得意なら同行者が振る。成功すればカードや一言が増え、失敗なら何も残らず、知らされもしない。',
      '어떤 기능은 저절로 작동합니다: 장소에 들어서거나 무언가를 볼 때 관찰력·듣기·오컬트를 몰래 굴립니다 — 동행이 더 잘하면 동행이 굴립니다. 성공하면 카드나 한마디가 늘고, 실패하면 아무것도 남지 않으며 알려 주지도 않습니다.',
    ),
  },
  'first-follow': {
    id: 'first-follow',
    when: 'a character started following the player for the first time',
    title: W('Someone walks with you', '有人和你同行', '同行者ができた', '누군가 함께 걷는다'),
    body: W(
      'A companion who follows you goes where you go. Their skills count: when they are better at something, they roll it for you. Open their card to see what they can do.',
      '跟着你的同伴会和你一起走。他们的技能也算数：哪一项比你强，就由他们替你掷。点开他们的角色卡，看看他们会什么。',
      'ついてくる同行者は、あなたと一緒に移動する。その技能も数に入る：あなたより得意なことは代わりに振ってくれる。キャラクターカードで何ができるか確かめよう。',
      '따라오는 동행은 당신과 함께 움직입니다. 그들의 기능도 유효합니다: 당신보다 잘하는 것은 대신 굴려 줍니다. 캐릭터 카드를 열어 무엇을 할 수 있는지 보세요.',
    ),
  },
  'first-skill': {
    id: 'first-skill',
    when: 'the player framed a check from their own character sheet',
    title: W('Using a skill', '使用技能', '技能を使う', '기능 사용'),
    body: W(
      'Every use of a skill is a check: roll d100 at or under the number (or d20 + the modifier against the difficulty). The card names the skill it uses; the four tiers each change what happens.',
      '每用一次技能就是一次检定：掷 d100，小于等于技能值就成功（或 d20 + 调整值对难度）。卡上写着用的是哪项技能；四个档位各有不同的结果。',
      '技能を使うたびに判定になる：d100 で技能値以下なら成功（または d20 + 修正値 対 難易度）。カードには使う技能が書いてあり、四つの段階で結果が変わる。',
      '기능을 쓸 때마다 판정입니다: d100으로 기능 수치 이하면 성공(또는 d20 + 수정치 대 난이도). 카드에 쓰는 기능이 적혀 있고, 네 단계마다 결과가 다릅니다.',
    ),
  },
};

export const TUTORIAL_CUE_IDS = Object.keys(TUTORIAL_CUES) as TutorialCueId[];

export function isTutorialCue(raw: unknown): raw is TutorialCueId {
  return typeof raw === 'string' && Object.hasOwn(TUTORIAL_CUES, raw);
}

/** The cue's words in a language (anything unknown reads English). */
export function tutorialCueText(id: TutorialCueId, locale: unknown): { title: string; body: string } {
  const lang: CueLocale = locale === 'zh-CN' || locale === 'ja' || locale === 'ko' ? locale : 'en';
  const cue = TUTORIAL_CUES[id];
  return { title: cue.title[lang], body: cue.body[lang] };
}

/** Pure: the cue to show now, or null when the page already taught it. */
export function cueToTeach(id: unknown, taught: readonly string[]): TutorialCueId | null {
  return isTutorialCue(id) && !taught.includes(id) ? id : null;
}
