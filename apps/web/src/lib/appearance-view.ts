import type { CSSProperties } from 'react';
import {
  appearanceTokenSetOf,
  type AppearanceTokenSet,
} from '@airp/shared/appearance-registry';
import type { AppearanceDimension, AppearanceResolution } from '@airp/shared/appearance-schema';
/**
 * The ONE frontend adapter from a verified `AppearanceResolution` (the design notes,
 * produced server-side by the shared resolver) to trusted DOM attributes and CSS custom
 * properties.
 *
 * It does NOT parse frontmatter and does NOT re-implement the resolver: every value it
 * consumes is an already-verified ID, and every token it emits is looked up from the shared
 * `APPEARANCE_REGISTRY` via `appearanceTokenSetOf`. Registry metadata values are controlled
 * token IDs (`font-hand`, `ink-rust`, `surface-parchment`, …) — NOT raw CSS — so this adapter
 * emits `var(--<id>)` references only. The concrete paint for those IDs lives in ONE place:
 * the `--font-* / --ink-* / --surface-* …` block in `index.css` (04 owns the CSS). There is no
 * second ID→token table here, and no frontmatter string can ever reach a CSS declaration.
 */

/** The controlled CSS custom properties this layer is allowed to write (04 §:33-38). */
export type AppearanceStyleVar =
  | '--appearance-font-family'
  | '--appearance-ink'
  | '--appearance-muted'
  | '--appearance-surface'
  | '--appearance-border'
  | '--appearance-shadow'
  | '--appearance-radius'
  | '--appearance-ornament'
  | '--appearance-motion-duration'
  | '--appearance-contrast-on';

export interface AppearanceView {
  resolution: AppearanceResolution;
  attrs: {
    'data-appearance-preset'?: string;
    'data-appearance-font': string;
    'data-appearance-surface': string;
    'data-appearance-accent': string;
    'data-appearance-ornament': string;
    'data-appearance-motion': string;
    'data-appearance-warning'?: string;
    'data-appearance-fallback-count'?: string;
  };
  style: CSSProperties & Record<AppearanceStyleVar, string>;
}

/**
 * Kind-safe static values for a token the registry does not supply. These are NOT a token
 * table — they are the documented degradation (04 §"回退矩阵": `token-missing` → 静态 base、
 * 纯色或 transparent). Each consuming CSS rule keeps its own legacy default, so a card whose
 * resolution never sets a var still paints exactly like the pre-appearance build.
 */
const SAFE_DEFAULTS: Record<AppearanceStyleVar, string> = {
  '--appearance-font-family': 'inherit',
  '--appearance-ink': 'currentColor',
  '--appearance-muted': 'currentColor',
  '--appearance-surface': 'transparent',
  '--appearance-border': 'transparent',
  '--appearance-shadow': 'none',
  '--appearance-radius': '0',
  '--appearance-ornament': 'none',
  '--appearance-motion-duration': '0s',
  '--appearance-contrast-on': 'currentColor',
};

/** A token ID is lexical by registry invariant; re-checked so an id can never inject CSS. */
const TOKEN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `prefers-reduced-motion` sits at the very top of the frozen motion precedence
 *  (04 §实现阶段核对项 5: 系统 prefers-reduced-motion > 世界/全局演出限制 > appearance `motion`). */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// The preference can flip while the app is open; a listener bumps an epoch so the
// per-resolution memo below never serves a stale motion duration.
let motionEpoch = 0;
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const bump = () => {
    motionEpoch += 1;
  };
  if (typeof query.addEventListener === 'function') query.addEventListener('change', bump);
  else if (typeof query.addListener === 'function') query.addListener(bump);
}

// resolution→token mapping is memoised by resolution identity (04 §:97,146): one entity's
// re-render must not rebuild the token set, and 100 cards must not re-resolve anything.
const cache = new WeakMap<AppearanceResolution, { epoch: number; view: AppearanceView }>();

/** Safe, total token read: an unknown dimension/value yields `null`, never a throw. */
function tokenSetOf(dimension: AppearanceDimension, value: string): AppearanceTokenSet | null {
  try {
    return appearanceTokenSetOf(dimension, value) ?? null;
  } catch {
    return null;
  }
}

/** Wrap a checked token ID as a CSS var reference; an unknown/empty id yields `null`. */
function tokenVar(id: string | undefined): string | null {
  return typeof id === 'string' && TOKEN_ID.test(id) ? `var(--${id})` : null;
}

function buildView(resolution: AppearanceResolution): AppearanceView {
  const { values } = resolution;
  const dimensions = resolution.details?.dimensions;
  const font = tokenSetOf('font', values.font);
  const surface = tokenSetOf('surface', values.surface);
  const accent = tokenSetOf('accent', values.accent);
  const ornament = tokenSetOf('ornament', values.ornament);
  const motion = tokenSetOf('motion', values.motion);

  // Zero-regression hinge: an axis the resolver filled from `base`/`kind` is the entity's
  // legacy default, so we emit NO var for it and the existing kind CSS paints as before.
  // Only an axis the author (or context/legacy bridge) actually chose gets a declaration.
  const style: Partial<Record<AppearanceStyleVar, string>> = {};
  let tokenMissing = 0;
  const chosen = (dimension: AppearanceDimension): boolean => {
    const source = dimensions?.[dimension]?.source;
    return source !== undefined && source !== 'base' && source !== 'kind' && source !== 'fallback';
  };
  const set = (key: AppearanceStyleVar, value: string | null, emit: boolean) => {
    if (!emit) return;
    if (value !== null) style[key] = value;
    else {
      style[key] = SAFE_DEFAULTS[key];
      tokenMissing += 1;
    }
  };

  // Which axis feeds which var is frozen in 01 §2.4 + 04 §"DOM/CSS 映射". `surface: none` is
  // the controlled "no surface" value: a literal transparent, never an omitted declaration.
  set('--appearance-font-family', tokenVar(font?.fontFamily), chosen('font'));
  set('--appearance-surface', values.surface === 'none' ? 'transparent' : tokenVar(surface?.surface), chosen('surface'));
  set('--appearance-shadow', tokenVar(surface?.shadow), chosen('surface'));
  set('--appearance-radius', tokenVar(surface?.radius), chosen('surface'));
  set('--appearance-ink', tokenVar(accent?.ink), chosen('accent'));
  set('--appearance-muted', tokenVar(accent?.muted), chosen('accent'));
  set('--appearance-border', tokenVar(accent?.border ?? surface?.border), chosen('accent') || chosen('surface'));
  set('--appearance-contrast-on', tokenVar(accent?.contrastOn), chosen('accent'));
  set('--appearance-ornament', values.ornament === 'none' ? 'none' : tokenVar(ornament?.ornament), chosen('ornament'));
  // `motion: still` and the OS preference both collapse the duration to zero (04 §:185).
  const still = values.motion === 'still' || prefersReducedMotion();
  set('--appearance-motion-duration', still ? '0s' : tokenVar(motion?.motionDuration), chosen('motion') || prefersReducedMotion());

  const attrs: AppearanceView['attrs'] = {
    'data-appearance-font': values.font,
    'data-appearance-surface': values.surface,
    'data-appearance-accent': values.accent,
    'data-appearance-ornament': values.ornament,
    'data-appearance-motion': values.motion,
  };
  const preset = resolution.details?.preset;
  const presetId = preset?.applied ?? preset?.requested;
  if (presetId) attrs['data-appearance-preset'] = presetId;

  // Development/test-only diagnostics: stable codes and a count, never raw YAML or paths.
  const codes = [...resolution.warnings.map((w) => w.code)];
  if (tokenMissing > 0) codes.push('token-missing');
  if (codes.length > 0) attrs['data-appearance-warning'] = [...new Set(codes)].join(' ');

  const fallbackCount = resolution.details?.fallbackCount ?? 0;
  if (fallbackCount > 0) attrs['data-appearance-fallback-count'] = String(fallbackCount);

  return { resolution, attrs, style: style as AppearanceView['style'] };
}

export function appearanceViewOf(resolution: AppearanceResolution): AppearanceView {
  const epoch = motionEpoch;
  const hit = cache.get(resolution);
  if (hit && hit.epoch === epoch) return hit.view;
  const view = buildView(resolution);
  cache.set(resolution, { epoch, view });
  return view;
}
