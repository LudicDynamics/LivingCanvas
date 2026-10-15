/**
 * Phones: keep the focused text field above the on-screen keyboard.
 *
 * Android Chrome resizes the layout viewport itself (index.html `interactive-widget=resizes-content`), so nothing
 * moves here. iOS Safari (and in-app web views) only shrink the VISUAL viewport: fixed bottom bars — the character
 * dock's input, the writer bar, the nook composer — stay under the keyboard. On focus, the nearest fixed (or
 * bottom-anchored absolute) box around the field is lifted by exactly the covered amount (`translate`, which
 * composes with any existing `transform`), and follows `visualViewport` resize/scroll until blur.
 */

/** How far to lift so the field's bottom (+ margin) sits inside the visible viewport. `bottom` includes `current`. */
export function liftFor(bottom: number, current: number, vvTop: number, vvHeight: number, margin = 8): number {
  const unlifted = bottom + current;
  return Math.max(0, Math.round(unlifted + margin - (vvTop + vvHeight)));
}

const TEXT_INPUT = /^(text|search|email|url|tel|password|number)$/;
export function isTextField(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT.test(el.type || 'text');
  return (el as HTMLElement).isContentEditable === true;
}

/** The box to move: the nearest fixed ancestor, or a bottom-anchored absolute one shorter than 60% of the screen. */
export function liftTarget(field: HTMLElement, win: Window = window): HTMLElement | null {
  for (let n: HTMLElement | null = field; n && n !== win.document.body; n = n.parentElement) {
    const s = win.getComputedStyle(n);
    if (s.position === 'fixed') return n.getBoundingClientRect().height < win.innerHeight * 0.85 ? n : null;
    if (s.position === 'absolute' && s.bottom !== 'auto' && n.getBoundingClientRect().height < win.innerHeight * 0.6) return n;
  }
  return null;
}

export function installKeyboardLift(win: Window = window): () => void {
  const vv = win.visualViewport;
  if (!vv) return () => {};
  const doc = win.document;
  let target: HTMLElement | null = null;
  let field: HTMLElement | null = null;
  let lift = 0;

  const apply = (next: number) => {
    if (!target) return;
    lift = next;
    if (next > 0) {
      target.setAttribute('data-kb-lift', '');
      target.style.setProperty('--kb-lift', `${next}px`);
    } else {
      target.removeAttribute('data-kb-lift');
      target.style.removeProperty('--kb-lift');
    }
  };
  const update = () => {
    if (!target || !field) return;
    const keyboard = Math.max(0, win.innerHeight - vv.height);
    doc.documentElement.toggleAttribute('data-keyboard', keyboard > 80);
    apply(liftFor(field.getBoundingClientRect().bottom, lift, vv.offsetTop, vv.height));
  };
  const reset = () => {
    apply(0);
    target = null;
    field = null;
    doc.documentElement.removeAttribute('data-keyboard');
  };
  const onFocusIn = (e: FocusEvent) => {
    const el = e.target as Element | null;
    if (!isTextField(el)) return;
    if (target) apply(0);
    field = el;
    target = liftTarget(el, win);
    lift = 0;
    update();
  };
  const onFocusOut = () => {
    // The next focusin (field → field) re-targets; a real blur resets after the keyboard starts closing.
    win.setTimeout(() => { if (!isTextField(doc.activeElement)) reset(); }, 50);
  };
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('focusout', onFocusOut);
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  return () => {
    reset();
    doc.removeEventListener('focusin', onFocusIn);
    doc.removeEventListener('focusout', onFocusOut);
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
  };
}
