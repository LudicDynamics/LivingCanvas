import type { Locale } from './translate.js';

/**
 * The browser-mode boot screen and its status lines (lib/browser-mode.ts). They show before React and
 * messages.json are up, so they carry their own small table, in the interface language (?lang= → stored pick →
 * English, lib/i18n.ts). Every visitor to canvas.worldlines.gg sees this screen first: it used to be Chinese only.
 *
 * First paint: index.html's first inline script picks the language and its body script draws
 * this screen into #root BEFORE the bundle runs — vite.config.ts writes `bootScreenHtml` for each language into
 * the page at build time, so the static copy and this table never drift. main.tsx keeps the drawn screen.
 */
export type BootLine = 'title' | 'description' | 'connecting' | 'registering' | 'preparing' | 'starting' | 'failed' | 'swControl'
  | 'outdated' | 'outdatedHint' | 'notStarted' | 'retryHint' | 'reload';

const BOOT_COPY: Record<Locale, Record<BootLine, string>> = {
  en: {
    title: 'Opening your<br />world',
    description: 'The story begins in a moment.',
    connecting: 'Connecting to the story engine…',
    registering: 'Setting up offline support…',
    preparing: 'Preparing the story engine…',
    starting: 'Starting the story engine…',
    failed: 'Could not start',
    swControl: 'The page could not finish setting up. Reload it once more (a normal reload, not a hard reload).',
    outdated: 'Your browser is too old — please update Safari or Chrome',
    outdatedHint: 'Needs {min} or newer. iPhone / iPad: Settings → General → Software Update.',
    notStarted: 'The story engine did not start',
    retryHint: 'Press "Reload" to try again. If it still fails, update your browser or use the latest Safari or Chrome.',
    reload: 'Reload',
  },
  'zh-CN': {
    title: '正在为你<br />打开世界',
    description: '故事马上开始，请稍候片刻。',
    connecting: '正在连接运行环境…',
    registering: '注册 Service Worker…',
    preparing: '准备运行环境…',
    starting: '启动本地服务器…',
    failed: '启动失败',
    swControl: 'Service Worker 没能接管页面，请再刷新一次（不要用强制刷新）',
    outdated: '你的浏览器版本太旧，请更新 Safari / Chrome',
    outdatedHint: '需要 {min} 或更新版本。iPhone / iPad：设置 → 通用 → 软件更新。',
    notStarted: '本地运行环境没有启动起来',
    retryHint: '请点「重新加载」再试一次；还是不行，请更新浏览器或换用最新的 Safari / Chrome。',
    reload: '重新加载',
  },
  ja: {
    title: 'ワールドを<br />開いています',
    description: 'まもなく物語が始まります。',
    connecting: '実行環境に接続しています…',
    registering: 'Service Worker を登録しています…',
    preparing: '実行環境を準備しています…',
    starting: 'ローカルサーバーを起動しています…',
    failed: '起動に失敗しました',
    swControl: 'ページの準備が完了しませんでした。もう一度（通常の）再読み込みをしてください。',
    outdated: 'ブラウザが古すぎます。Safari / Chrome を更新してください',
    outdatedHint: '{min} 以降が必要です。iPhone / iPad：設定 → 一般 → ソフトウェアアップデート。',
    notStarted: '実行環境が起動しませんでした',
    retryHint: '「再読み込み」を押してもう一度お試しください。それでも駄目なら、ブラウザを更新するか最新の Safari / Chrome をお使いください。',
    reload: '再読み込み',
  },
  ko: {
    title: '세계를<br />여는 중',
    description: '곧 이야기가 시작됩니다.',
    connecting: '실행 환경에 연결하는 중…',
    registering: 'Service Worker 등록 중…',
    preparing: '실행 환경 준비 중…',
    starting: '로컬 서버 시작 중…',
    failed: '시작하지 못했습니다',
    swControl: '페이지 준비를 마치지 못했습니다. 한 번 더 (일반) 새로고침해 주세요.',
    outdated: '브라우저가 너무 오래되었습니다. Safari / Chrome을 업데이트해 주세요',
    outdatedHint: '{min} 이상이 필요합니다. iPhone / iPad: 설정 → 일반 → 소프트웨어 업데이트.',
    notStarted: '실행 환경이 시작되지 않았습니다',
    retryHint: "'새로고침'을 눌러 다시 시도해 주세요. 그래도 안 되면 브라우저를 업데이트하거나 최신 Safari / Chrome을 사용해 주세요.",
    reload: '새로고침',
  },
};

export function bootText(locale: Locale, line: BootLine): string {
  return (BOOT_COPY[locale] ?? BOOT_COPY.en)[line];
}

/** Escape for the HTML below (the copy is ours, but the title keeps its one `<br />`). */
const text = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The boot screen (`<main class="browser-boot">`, styles in browser-boot.css) in one language. */
export function bootScreenHtml(locale: Locale, always: boolean): string {
  const say = (line: BootLine) => text(bootText(locale, line));
  const title = bootText(locale, 'title').split('<br />').map(text).join('<br />');
  return `<main class="browser-boot" aria-live="polite" aria-busy="true" lang="${locale}" data-boot-locale="${locale}">
      <div class="browser-boot__grain" aria-hidden="true"></div>
      <header class="browser-boot__header">
        <span class="browser-boot__mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="browser-boot__brand">WORLDLINES</span>
        <span class="browser-boot__edition">INFINITE CANVAS</span>
      </header>
      <section class="browser-boot__card">
        <div class="browser-boot__art" aria-hidden="true">
          <span class="browser-boot__orbit browser-boot__orbit--outer"></span>
          <span class="browser-boot__orbit browser-boot__orbit--inner"></span>
          <span class="browser-boot__star browser-boot__star--one"></span>
          <span class="browser-boot__star browser-boot__star--two"></span>
          <span class="browser-boot__planet"></span>
          <span class="browser-boot__art-label">A WORLD<br />UNFOLDING</span>
        </div>
        <div class="browser-boot__eyebrow"><span></span> YOUR CANVAS IS NEAR</div>
        <h1>${title}</h1>
        <p class="browser-boot__description">${say('description')}</p>
        <div class="browser-boot__progress" aria-hidden="true"><span></span></div>
        <div class="browser-boot__status">
          <span class="browser-boot__pulse" aria-hidden="true"></span>
          <span data-boot-status>${say('connecting')}</span>
        </div>
        <div class="browser-boot__footer">
          <span>${always ? 'WORLDLINES CANVAS' : 'BROWSER MODE · EXPERIMENTAL'}</span>
          <span>LOCAL &amp; PRIVATE</span>
        </div>
      </section>
      <footer class="browser-boot__bottom">A place for stories to take shape.</footer>
    </main>`;
}

/** Every language's boot screen, for index.html (vite.config.ts): `{ en: '<main…>', ja: …, … }`. */
export function bootScreens(always: boolean): Record<Locale, string> {
  return Object.fromEntries((Object.keys(BOOT_COPY) as Locale[]).map((l) => [l, bootScreenHtml(l, always)])) as Record<Locale, string>;
}

/** Where index.html's first-paint script takes the screens (vite.config.ts `airp-boot-screens`). */
export const BOOT_SCREENS_MARKER = '/*airp:boot-screens*/null';
/** index.html with every language's boot screen in place of the marker (a JS object literal, `<` escaped). */
export function injectBootScreens(html: string): string {
  return html.replace(BOOT_SCREENS_MARKER, JSON.stringify(bootScreens(true)).replace(/</g, '\\u003c'));
}
