/**
 * IME candidate confirmation is not an application shortcut.
 * WebKit can clear isComposing before the confirming Enter; keyCode 229 covers it.
 */
export interface ImeKeyEvent {
  key: string;
  nativeEvent: { isComposing?: boolean; keyCode?: number };
  preventDefault(): void;
  stopPropagation(): void;
}

export interface ImeGuard {
  onCompositionStart(): void;
  onCompositionEnd(): void;
  guardKey(event: ImeKeyEvent): boolean;
}

/** Stateless fallback for existing key handlers. Use createImeGuard when the
 * input can receive compositionstart/compositionend callbacks. */
export function guardImeKey(event: ImeKeyEvent, composing = false): boolean {
  const native = event.nativeEvent;
  const composingNow = composing || native.isComposing === true || native.keyCode === 229;
  if (!composingNow) return false;
  if (event.key === 'Enter') event.preventDefault();
  event.stopPropagation();
  return true;
}

/** Track composition boundaries for an individual text entry without using a
 * global flag shared by unrelated inputs. */
export function createImeGuard(): ImeGuard {
  let composing = false;
  return {
    onCompositionStart(): void {
      composing = true;
    },
    onCompositionEnd(): void {
      composing = false;
    },
    guardKey(event: ImeKeyEvent): boolean {
      return guardImeKey(event, composing);
    },
  };
}
