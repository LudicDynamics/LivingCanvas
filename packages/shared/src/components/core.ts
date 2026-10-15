import { stringifyFrontmatter } from '../schemas/frontmatter.js';
import { validateAppearanceInput } from '../schemas/appearance.js';
import { ActionError } from '../actions/errors.js';
import type { ComponentDef, EntityRef, UseItemOnHandler } from './types.js';

/** Item tags a lock/container treats as "the right thing". */
const KEY_TAGS = ['key', 'key-like', 'crowbar'];

/** Read `status.data` off a parsed frontmatter without assuming its shape. */
function statusData(fm: Record<string, unknown>): Record<string, unknown> {
  const status = fm.status;
  if (!status || typeof status !== 'object') return {};
  const data = (status as Record<string, unknown>).data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

/** The item's matching tokens: its component/type plus its frontmatter tags. */
function itemTokens(item: EntityRef): string[] {
  const fm = item.frontmatter;
  const tokens: string[] = [];
  if (typeof fm.component === 'string') tokens.push(fm.component);
  if (typeof fm.type === 'string') tokens.push(fm.type);
  const tags = fm.tags;
  if (Array.isArray(tags)) for (const t of tags) if (typeof t === 'string') tokens.push(t);
  return tokens;
}

/**
 * Rewrite ONLY the target's own frontmatter (doc 08 §3.4 discipline 5). The
 * file's markdown body is passed through untouched.
 */
async function rewriteTarget(
  store: { writeFileAtomic(path: string, content: string): Promise<void> },
  target: EntityRef,
  kind: string,
  fm: Record<string, unknown>,
  body: string
): Promise<void> {
  if (Object.prototype.hasOwnProperty.call(fm, 'appearance')) {
    const appearance = validateAppearanceInput(fm.appearance, kind);
    if (!appearance.ok) {
      const issue = appearance.issues[0];
      throw new ActionError({
        code: 'invalid_argument',
        message: issue?.message ?? `Invalid appearance for component kind "${kind}".`,
        details: { issues: appearance.issues },
      });
    }
  }
  await store.writeFileAtomic(target.path, stringifyFrontmatter(fm, body));
}

/**
 * Lock handler (doc 10 §15.3): a key-like item flips `status.data.locked` to
 * false and records `opened_by`. Idempotent — a second application reports
 * `already_open` rather than re-opening (doc 08 §4.3).
 */
export const lockHandler: UseItemOnHandler = async ({ item, target, store }) => {
  const fm = target.frontmatter;
  const data = statusData(fm);
  if (data.locked !== true) return { handled: false, reason: 'already_open' };
  const keys = itemTokens(item);
  if (!keys.some((t) => KEY_TAGS.includes(t))) return { handled: false, reason: 'wrong_item' };
  const next = { ...data, locked: false, opened_by: item.path };
  fm.status = { ...(typeof fm.status === 'object' && fm.status ? fm.status : {}), data: next };
  await rewriteTarget(store, target, 'lock', fm, target.body ?? '');
  return { handled: true, summary: `${item.name} opens ${target.name}.`, details: { unlocked: true } };
};

/**
 * Container handler (review M-6): the iron chest must show an immediate change
 * when the copper key lands on it — no waiting for the writer's next turn.
 * Same shape as `lockHandler`, keyed on `status.data.opened`.
 */
export const containerHandler: UseItemOnHandler = async ({ item, target, store }) => {
  const fm = target.frontmatter;
  const data = statusData(fm);
  if (data.opened === true) return { handled: false, reason: 'already_open' };
  const keys = itemTokens(item);
  if (!keys.some((t) => KEY_TAGS.includes(t))) return { handled: false, reason: 'wrong_item' };
  const next = { ...data, opened: true, opened_by: item.path };
  fm.status = { ...(typeof fm.status === 'object' && fm.status ? fm.status : {}), data: next };
  await rewriteTarget(store, target, 'container', fm, target.body ?? '');
  return {
    handled: true,
    summary: `${item.name} opens ${target.name}.`,
    details: { opened: true },
  };
};

/** Core pack — the two kinds every world has (doc 10 §14.4). */
export const CORE_PACK: ComponentDef[] = [
  {
    kind: 'note',
    pack: 'core',
    label: 'Note',
    purpose: 'A sticky sheet or object card; keys, tickets, scraps.',
    // A bare markdown file is a note (the forms.ts fallback), so `type` may be
    // absent; `type: note` is the historical spelling (doc 10 E1).
    match: (fm) =>
      fm.type === 'note' ||
      (fm.type === 'component' && fm.component === 'note') ||
      (fm.type === undefined && fm.component === undefined),
    fields: [
      { name: 'title', type: 'string', required: false, desc: 'Card-face title.', example: 'Copper Key' },
      { name: 'preview', type: 'string', required: false, desc: 'One-line card-face teaser.' },
      { name: 'tags', type: 'array', required: false, desc: 'Free tags; `key` makes a note usable as a key.', example: '[key]' },
      { name: 'icon', type: 'string', required: false, desc: 'Glyph drawn on the card face.' },
    ],
    click: 'read',
    channels: { status: true, choice: true, rollDice: true },
    movable: true,
    secondLayer: 'read',
    example: `---
type: note
title: Copper Key
tags: [key]
---
A small copper key, worn smooth at the bow.`,
  },
  {
    kind: 'letter',
    pack: 'core',
    label: 'Letter',
    purpose: 'A sealed letter; opens into title / preview / body / sign.',
    match: (fm) => fm.component === 'letter' || fm.type === 'letter',
    fields: [
      { name: 'title', type: 'string', required: true, desc: 'Card-face title.', example: 'A Letter from Watson' },
      { name: 'preview', type: 'string', required: false, desc: 'One-line card-face teaser.' },
      { name: 'body', type: 'string', required: false, desc: 'Full text for the second layer; the md body also works.' },
      { name: 'sign', type: 'string', required: false, desc: 'Signature line.', example: 'J.W.' },
      { name: 'seal', type: 'string', required: false, desc: 'Wax seal style.', example: 'wax-red' },
      { name: 'addressed_to', type: 'string', required: false, desc: 'Recipient id.', example: 'holmes' },
    ],
    click: 'read',
    channels: { status: true, choice: true, rollDice: true, useItemTarget: true },
    movable: true,
    secondLayer: 'read',
    // doc 10 §14.4: a letter may be a use_item_on target (delivered / shown).
    accepts: { itemKinds: [], itemTags: [], any: true, hint: 'Deliver or show this letter' },
    example: `---
type: component
component: letter
title: A Letter from Watson
preview: The envelope is damp; the ink has run at one corner.
sign: J.W.
seal: wax-red
---
I would not trouble you if I could see another way.`,
  },
];
