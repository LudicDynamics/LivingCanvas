// Must run before any module that builds `/api` or `/ws` URLs.
import './lib/base-path.js';
// ?perf=1: load / play timings (no-op otherwise); first, so its marks start with the bundle.
import { perfMark } from './lib/perf.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { PerceptionRoot } from './components/canvas/PerceptionRoot.js';
import { unlockOnFirstInteraction } from './lib/audio.js';
import { startAccountData } from './lib/account-data-app.js';
import { captureInviteParam } from './lib/invite.js';
import { captureAttribution } from './lib/attribution.js';
import { InviteAutoRedeem } from './components/chrome/InviteAutoRedeem.js';
import { AppErrorBoundary } from './components/AppErrorBoundary.js';
import { appVersionOf, reportError, startAnalytics } from './lib/analytics.js';
import { bootFailure, OutdatedBrowserError } from './lib/browser-support.js';
import { buildMode } from './lib/build-mode.js';
import { accountData } from './lib/account-data.js';
import { analyticsSrc } from './lib/attribution.js';
import { currentLocale } from './lib/i18n.js';
import { bootScreenHtml, bootText } from './lib/boot-copy.js';
import { browserDeployment, browserModeRequested, retireRuntimeServiceWorker, startBrowserMode } from './lib/browser-mode.js';
import { dropLangParam, setLocale } from './lib/i18n.js';
import { rememberInAppContinue, shouldShowInAppGuide } from './lib/inapp-browser.js';
import { InAppGuide } from './components/chrome/InAppGuide.js';
import './index.css';
import './prototype.css';
import './scene-shell.css';
import './browser-boot.css';
import './decoration.css';
import './keyboard-lift.css';
import { installKeyboardLift } from './lib/keyboard-lift.js';

// Autoplay policy: resume audio on the first gesture anywhere, not only on the
// canvas — otherwise theme/BGM stay silent after clicking chrome controls.
unlockOnFirstInteraction();

// Server-side Playwright captures load `/?airpPerception=1&layer=…&snapshotId=…`
//: a read-only perception page sharing the Canvas tree,
// never the full interactive app. The split happens here, before `App` mounts
// any hook or socket.
const perceptionParams = new URLSearchParams(window.location.search);
const perceptionRoot =
  perceptionParams.get('airpPerception') === '1' ? (
    <PerceptionRoot
      layer={perceptionParams.get('layer') ?? 'map'}
      snapshotId={perceptionParams.get('snapshotId') ?? ''}
    />
  ) : null;

// 邀请好友: `?invite=WL-XXXXXX` is remembered now (before any sign-in redirect) and redeemed after the first
// sign-in (InviteAutoRedeem, lib/invite.ts).
// 渠道 / 来源: `?src=` / utm_* / `ref=` are remembered the same way and go with the sign-in that creates the account
// (lib/attribution.ts).
const session = (() => { try { return sessionStorage; } catch { return null; } })();
// WeChat / QQ / LINE / Instagram … in-app browsers: guide to Safari / the system browser before booting
// (lib/inapp-browser.ts). The address bar keeps `?src=` / `?invite=` / `?lang=` until "try anyway", so "open in
// Safari" and the copied link both carry them.
const inApp = perceptionRoot ? null : shouldShowInAppGuide(navigator.userAgent, location.search, session, navigator.maxTouchPoints ?? 0);

if (!perceptionRoot) {
  if (!inApp) {
    dropLangParam();
    captureAttribution();
    captureInviteParam();
  }
  // 改进产品：匿名使用数据 + 前端错误 (lib/analytics.ts; Account → 设置 switches it off; DNT = off by default).
  // VITE_AIRP_CHRONICLE_BASE=off (login off, lib/build-mode.ts) = never started, nothing is collected.
  if (browserDeployment.chronicle !== 'off') startAnalytics({
    chronicleBase: browserDeployment.chronicle,
    // Signed out, only the hosted (remote) build reports straight to chronicle; a local build only once signed in.
    staticSite: browserDeployment.staticSite && buildMode()?.deploy === 'remote',
    appVersion: appVersionOf(import.meta.env as Record<string, string | undefined>),
    signedIn: () => accountData()?.getState().sync === 'synced',
    locale: () => currentLocale().split('-')[0].toLowerCase(),
    src: () => analyticsSrc(), // first touch; kept (keyword only) after sign-in
  });
}

const render = () => {
  perfMark('appRender');
  if (!perceptionRoot) installKeyboardLift();
  // Settings, favorites, ratings and save summaries that follow the account (lib/account-data.ts).
  if (!perceptionRoot) startAccountData();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {perceptionRoot ?? <AppErrorBoundary><App /><InviteAutoRedeem /></AppErrorBoundary>}
    </React.StrictMode>,
  );
};

// Browser mode (experimental, default off): show a designed boot surface while
// the in-tab runtime starts, then render the unchanged app on top of it.
const boot = () => {
  if (browserModeRequested()) {
    const root = document.getElementById('root')!;
    const bootLocale = currentLocale();
    // index.html already drew this screen in the same language (first paint, before this bundle): keep it, so its
    // animations do not restart. Anything else (a dev build, ?mode=browser, another language) is drawn now.
    if (root.querySelector('.browser-boot')?.getAttribute('data-boot-locale') !== bootLocale) root.innerHTML = bootScreenHtml(bootLocale, browserDeployment.always);
    const statusNode = root.querySelector<HTMLElement>('[data-boot-status]')!;
    const note = (s: string, failed = false) => {
      statusNode.textContent = s;
      root.querySelector('.browser-boot')?.classList.toggle('is-error', failed);
      root.querySelector('.browser-boot')?.setAttribute('aria-busy', String(!failed));
      if (failed) statusNode.setAttribute('role', 'alert');
    };
    startBrowserMode({ onStatus: note }).then((info) => {
      console.info('[browser-mode] ready', info);
      (window as Window & { __airpBrowserMode?: typeof info }).__airpBrowserMode = info;
      root.textContent = '';
      render();
    }, (e) => {
      // Never only the raw message, never a dead end (lib/browser-support.ts): too old → 「请更新」; else 「重新加载」.
      const f = bootFailure(e, bootLocale);
      if (e instanceof OutdatedBrowserError) reportError({ kind: 'error', message: e.message, route: location.pathname });
      note(f.title, true);
      const card = root.querySelector('.browser-boot__card');
      if (!card) return;
      const help = document.createElement('div');
      help.className = 'browser-boot__failure';
      help.dataset.bootFailure = f.outdated ? 'outdated' : 'failed';
      const hint = document.createElement('p');
      hint.textContent = f.hint;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = bootText(bootLocale, 'reload');
      retry.addEventListener('click', () => location.reload());
      const detail = document.createElement('small');
      detail.textContent = f.detail;
      help.append(hint, retry, detail);
      card.querySelector('.browser-boot__footer')?.before(help);
    });
  } else {
    retireRuntimeServiceWorker();
    render();
  }
};

if (inApp) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const guide = ReactDOM.createRoot(host);
  guide.render(
    <InAppGuide
      inApp={inApp}
      href={location.href}
      initialLocale={currentLocale()}
      onContinue={(picked) => {
        rememberInAppContinue(session);
        // A language picked on the guide is the player's pick.
        if (picked !== currentLocale()) setLocale(picked);
        guide.unmount();
        host.remove();
        dropLangParam();
        captureAttribution();
        captureInviteParam();
        boot();
      }}
    />,
  );
} else {
  boot();
}
