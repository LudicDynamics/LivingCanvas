import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderFrontmatterWidgets } from '../../lib/fm.js';
import { useLocale } from '../../lib/i18n.js';
import type { FocusCoordinator, FocusSurfaceLease } from '../../lib/focus-coordinator.js';
export type DeclaredItem = {
  path: string;
  declaredPath: string;
  revision: string;
  title: string;
  body: string;
  frontmatter: Record<string, any> | null;
};

export type MaterialSlot = {
  id: string;
  title: string;
  required: boolean;
  paths: string[];
  /** Server default is the slot's path count; one evidence slot may take several files. */
  maxItems?: number;
};

/** `search` opens the dice chalk the search just spawned. */
export type DeclaredActionKind = 'read' | 'take' | 'stage' | 'enter' | 'character' | 'reply' | 'writer' | 'search' | 'talk';

/** The server's validated action detail. This is a read-only snapshot. */
export type DeclaredResponse = {
  kind: DeclaredActionKind;
  /** Active world root stamped by the choice route; the review route rejects a stale one. */
  world?: string;
  source: string;
  choice: string | number;
  revision: string;
  items: DeclaredItem[];
  missing: string[];
  slots?: MaterialSlot[];
  target?: string;
  character?: string;
  text?: string;
  prompt?: string;
  /** `search`: the spawned dice chalk's path. */
  chalk?: string;
  /** `talk`: the NPC card to open a conversation with, and its frontmatter. */
  npc?: string;
  frontmatter?: Record<string, unknown> | null;
};

export type MaterialSelection = { slot: string; path: string; revision: string };

/** Adds `path` to `slot`, moving it out of any other slot; a file is used once. */
export function replaceMaterialSelection(
  selected: Record<string, string[]>,
  slot: string,
  path: string,
): Record<string, string[]> {
  const others = Object.fromEntries(Object.entries(selected).map(([id, paths]) => [id, paths.filter(p => p !== path)]));
  return { ...others, [slot]: [...(others[slot] ?? []), path] };
}

export function slotCapacity(slot: MaterialSlot): number {
  return slot.maxItems ?? slot.paths.length;
}

export function materialSelectionReady(slots: MaterialSlot[], selected: Record<string, string[]>): boolean {
  return slots.length > 0
    && Object.values(selected).some(paths => paths.length > 0)
    && slots.every(slot => !slot.required || (selected[slot.id]?.length ?? 0) > 0);
}

function copy(locale: string, en: string, ja: string, zh: string, ko: string): string {
  return locale === 'ja' ? ja : locale === 'zh-CN' ? zh : locale === 'ko' ? ko : en;
}

function isSelectable(item: DeclaredItem, slot: MaterialSlot): boolean {
  return slot.paths.includes(item.declaredPath) || slot.paths.includes(item.path);
}

export function DeclaredActionDialog({
  value,
  onClose,
  onSubmit,
  onSendReview,
  onChoose,
  focus,
}: {
  value: DeclaredResponse;
  onClose: () => void;
  onSubmit: (selections: MaterialSelection[]) => Promise<string>;
  onSendReview: (prompt: string) => void;
  onChoose?: (path: string, choice: string) => void;
  focus?: FocusCoordinator;
}) {
  const { locale } = useLocale();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [activeSlot, setActiveSlot] = useState(value.slots?.[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewPrompt, setReviewPrompt] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const leaseRef = useRef<FocusSurfaceLease | null>(null);
  /** Latest `requestClose`, for the window-level pointer listener below. */
  const requestCloseRef = useRef<() => void>(() => {});
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  const slots = value.slots ?? [];
  const items = value.items ?? [];
  // A dice check reads on the launcher's dark glass; other
  // declared actions keep the world's own paper appearance.
  const diceDialog = value.kind === 'search' || items.some(item => item.frontmatter?.roll_dice);

  const requestClose = () => {
    // Mark the surface first so Escape and a click cannot both dispatch, but
    // never let a stale or already-closing lease swallow the player's Return:
    // `onClose` is idempotent (`setDirect(null)`), and a dialog that stays
    // open with a dead button is the worse failure.
    leaseRef.current?.markClosing();
    closeHandler.current();
  };
  requestCloseRef.current = requestClose;

  useEffect(() => {
    if (!focus) return;
    const lease = focus.registerSurface({
      key: `declared:${value.source}:${String(value.choice)}:${value.revision}`,
      owner: 'workspace',
      priority: 350,
      root: dialog.current,
      close: () => closeHandler.current(),
    });
    leaseRef.current = lease;
    return () => {
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.unregister();
    };
  }, [focus, value.choice, value.revision, value.source]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => previous?.focus();
  }, []);

  // Close on the POINTER, not on `click`. In play the
  // Return button and the backdrop stopped answering clicks while Escape still
  // closed the dialog — the `click` never reached us (a captured pointer or an
  // intervening layer retargets it), while a window-level capture-phase
  // `pointerdown` always sees the original target. Same mechanism the reader
  // (BagItemDialog) uses for its outside-press.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = dialog.current;
      if (!root) return;
      const target = event.target as Node | null;
      if (!target || !root.contains(target)) requestCloseRef.current();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const place = (path: string, target?: string) => {
    if (busy) return;
    const item = items.find(candidate => candidate.path === path);
    // Clicking a material fills the active slot if it fits, else the first slot that does.
    const slot = target
      ? slots.find(candidate => candidate.id === target)
      : slots.find(candidate => candidate.id === activeSlot && !!item && isSelectable(item, candidate))
        ?? slots.find(candidate => !!item && isSelectable(item, candidate));
    if (!item || !slot || !isSelectable(item, slot)) {
      setError(copy(locale, 'This material does not fit here. Choose another slot.', 'この材料はここには置けません。別の枠を選んでください。', '这份材料不适合当前槽位，请选择其他槽位。', '이 재료는 여기에 놓을 수 없습니다. 다른 칸을 고르세요.'));
      return;
    }
    const current = selected[slot.id] ?? [];
    if (current.includes(path)) return;
    if (current.length >= slotCapacity(slot)) {
      setError(copy(locale, 'This slot is full. Remove a material before adding another.', '枠がいっぱいです。材料を戻してから追加してください。', '槽位已满，请先移除一份材料。', '칸이 가득 찼습니다. 재료를 하나 빼고 추가하세요.'));
      return;
    }
    setError('');
    setActiveSlot(slot.id);
    setSelected(previous => replaceMaterialSelection(previous, slot.id, path));
  };

  const ready = materialSelectionReady(slots, selected);
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      const prompt = await onSubmit(slots.flatMap(slot => (selected[slot.id] ?? []).map(path => ({
        slot: slot.id,
        path,
        revision: items.find(item => item.path === path)?.revision ?? '',
      }))));
      setReviewPrompt(prompt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className={`declared-action-backdrop${diceDialog ? ' declared-action-backdrop--dice' : ''}`}
      data-no-drag
      onWheel={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        if (event.target === event.currentTarget) requestClose();
      }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        event.stopPropagation();
        const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])');
        if (!nodes?.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div ref={dialog} className={`declared-action-dialog${diceDialog ? ' declared-action-dialog--dice' : ''}`} role="dialog" aria-modal="true" aria-label={copy(locale, 'Declared action', '宣言された行動', '声明动作', '선언된 행동')}>
        <button type="button" onPointerDown={event => { event.preventDefault(); requestClose(); }} onClick={requestClose}>{copy(locale, 'Return ↩', 'この場に戻る ↩', '回到场景 ↩', '장면으로 돌아가기 ↩')}</button>
        {value.kind === 'stage' && <p>{copy(locale, 'Selecting materials does not submit or execute them.', '材料を選ぶだけでは、まだ提出も実行もされません。', '选择材料不会提交或执行。', '재료를 고르기만 해서는 아직 제출되거나 실행되지 않습니다.')}</p>}

        {value.kind === 'stage' && <fieldset className="material-slots" disabled={busy}>
          {slots.map(slot => {
            const candidates = items.filter(item => isSelectable(item, slot));
            const chosen = candidates.filter(candidate => selected[slot.id]?.includes(candidate.path));
            return <section
              className={`material-slot ${activeSlot === slot.id ? 'is-active' : ''}`}
              key={slot.id}
              onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
              onDrop={event => {
                event.preventDefault();
                event.stopPropagation();
                setActiveSlot(slot.id);
                place(event.dataTransfer.getData('text/plain'), slot.id);
              }}
            >
              <button type="button" className="material-slot__target" aria-pressed={activeSlot === slot.id} onClick={() => setActiveSlot(slot.id)}>
                <small>{slot.title}{slot.required ? ' *' : ''}</small>
                <strong>{chosen.length ? `${chosen.length} / ${slotCapacity(slot)}` : copy(locale, 'Place material here', 'ここに材料を置く', '将材料放在这里', '여기에 재료 놓기')}</strong>
              </button>
              {chosen.map(item => <div key={item.path} className="material-slot__item">
                <strong>{item.title}</strong>
                <button type="button" aria-label={`${copy(locale, 'Remove', '戻す', '移除', '빼기')} ${item.title}`} onClick={() => { setSelected(current => ({ ...current, [slot.id]: (current[slot.id] ?? []).filter(path => path !== item.path) })); setError(''); }}>{copy(locale, 'Remove', '戻す', '移除', '빼기')}</button>
                <details><summary>{copy(locale, 'Read', '読む', '查看原文', '읽기')}</summary><p>{item.body}</p></details>
              </div>)}
              {!candidates.length && <small>{copy(locale, 'No material available for this slot yet.', '材料がまだありません。', '此槽位的材料尚未准备。', '이 칸에 쓸 재료가 아직 없습니다.')}</small>}
            </section>;
          })}
        </fieldset>}

        {value.kind === 'stage' && <>
          <p>{copy(locale, 'Select a slot, then click a material—or drag it into a slot.', '枠を選び、材料をクリック。または枠へドラッグ。', '先选槽位，再点击材料；也可将材料拖入槽位。', '칸을 고른 뒤 재료를 클릭하세요. 재료를 칸으로 끌어다 놓아도 됩니다.')}</p>
          <div className="material-pool">
            {items.map(item => <button
              key={item.path}
              type="button"
              draggable={!busy}
              disabled={busy}
              aria-pressed={Object.values(selected).some(paths => paths.includes(item.path))}
              onClick={() => place(item.path)}
              onDragStart={event => {
                event.stopPropagation();
                event.dataTransfer.setData('text/plain', item.path);
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <span aria-hidden="true">▤</span><strong>{item.title}</strong><small>{item.body.slice(0, 80)}</small>
            </button>)}
          </div>
          <p>{copy(locale, 'Prepare a review draft. Nothing is sent until you choose Send review.', '確認依頼の下書きを作ります。「確認依頼を送る」を選ぶまで送信されません。', '准备审核草稿；选择“发送审核”前不会发送。', '확인 요청 초안을 만듭니다. 「확인 요청 보내기」를 누르기 전에는 아무것도 보내지 않습니다.')}</p>
          <button type="button" disabled={!ready || busy} onClick={() => void submit()}>{busy ? copy(locale, 'Checking materials…', '材料を確認中…', '核对材料中…', '재료 확인 중…') : copy(locale, 'Prepare review draft', '確認依頼の下書きを作る', '准备审核草稿', '확인 요청 초안 만들기')}</button>
          {reviewPrompt && <div className="declared-review-draft">
            <label>
              <strong>{copy(locale, 'Review draft', '確認依頼の下書き', '审核草稿', '확인 요청 초안')}</strong>
              <textarea value={reviewPrompt} onChange={event => setReviewPrompt(event.target.value)} rows={8} />
            </label>
            <button type="button" disabled={busy || !reviewPrompt.trim()} onClick={() => { onSendReview(reviewPrompt); }}>{copy(locale, 'Send review', '確認依頼を送る', '发送审核', '확인 요청 보내기')}</button>
          </div>}

        </>}
        {value.text && <p className="declared-action-dialog__text">{value.text}</p>}
        {value.prompt && <p className="declared-action-dialog__text">{value.prompt}</p>}
        {value.kind !== 'stage' && items.map(item => <article key={item.path}>
          <h3>{item.title}</h3>
          <div className="declared-action-dialog__body">{item.body}</div>
          {item.frontmatter && renderFrontmatterWidgets(
            { ...item.frontmatter, ...(!item.frontmatter.choice_actions ? { choice: undefined } : {}) },
            { filePath: item.path, reveal: true, onChoice: choice => onChoose?.(item.path, choice) },
          )}
        </article>)}
        {value.missing.length > 0 && <p>{copy(locale, 'Not prepared yet: ', 'まだ用意されていない材料：', '尚未准备的材料：', '아직 준비되지 않은 재료: ')}{value.missing.join(', ')}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
