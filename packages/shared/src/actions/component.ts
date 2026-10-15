import { fail } from './errors.js';
import { registerAction } from './service.js';
import type { ActionContext, ActionResult } from './types.js';
import {
  COMPONENT_REGISTRY,
  componentDocOf,
  listComponents,
  type ComponentDoc,
} from '../components/registry.js';
import {
  APPEARANCE_DIMENSIONS,
  APPEARANCE_SCHEMA_VERSION,
  type AppearanceDimension,
} from '../schemas/appearance.js';
import { componentAppearanceDocOf } from '../components/appearance-registry.js';
import type { FieldDoc } from '../components/types.js';

/** Input shape of `get_component` (doc 10 §2.1). */
export interface GetComponentInput {
  component?: string | string[];
}
export interface AppearanceComponentDetails {
  kind: string;
  defaults: Record<AppearanceDimension, string>;
  allowed: Readonly<Record<AppearanceDimension, readonly string[]>>;
  presets: readonly string[];
  labels: {
    kind: string;
    dimensions: Record<AppearanceDimension, string>;
    values: Record<string, string>;
    presets: Record<string, string>;
  };
}

export interface AppearanceQueryDetails {
  schemaVersion: typeof APPEARANCE_SCHEMA_VERSION;
  dimensions: readonly { id: AppearanceDimension; label: string }[];
  components: AppearanceComponentDetails[];
}

export interface GetComponentDetails {
  mode: 'index' | 'full';
  components: ComponentDoc[];
  /** Appearance is a query surface; ComponentDoc remains semantic-only. */
  appearance?: AppearanceQueryDetails;
}


/** Total registered kinds — used in the error copy. */
const KIND_COUNT = Object.keys(COMPONENT_REGISTRY).length;

/** A path-looking argument is a call error of its own kind (doc 10 §7 E3). */
function looksLikePath(value: string): boolean {
  return value.includes('/') || value.endsWith('.md');
}

function isOneOf(input: string): boolean {
  return Object.prototype.hasOwnProperty.call(COMPONENT_REGISTRY, input);
}
/** Index line: `note      core      A sticky sheet… [use_item_on target]`. */
// Two fixed columns, padded so the longest kind (`instrument`) still leaves a
// gap — a kind id is followed by at least one space before its pack.
function indexLine(doc: ComponentDoc): string {
  const marker = doc.channels.useItemTarget ? ' [use_item_on target]' : '';
  return `${doc.kind.padEnd(12)}${doc.pack.padEnd(10)}${doc.purpose}${marker}`;
}

function channelsOf(doc: ComponentDoc): string {
  const c = doc.channels;
  const names: string[] = [];
  if (c.choice) names.push('choice');
  if (c.status) names.push('status');
  if (c.rollDice) names.push('roll_dice');
  if (c.useItemTarget) names.push('use_item_on-target');
  return names.length ? names.join(', ') : 'none';
}

function fieldLine(field: FieldDoc): string {
  const example = field.example ? `  e.g. ${field.example}` : '';
  return `  ${field.name.padEnd(16)}${field.type.padEnd(9)}${field.required ? 'required' : 'optional'}   ${field.desc}${example}`;
}
function displayLabel(value: string): string {
  return value
    .split('-')
    .map((word) => word ? word[0].toUpperCase() + word.slice(1) : word)
    .join(' ');
}

function appearanceDetailsOf(kind: string): AppearanceComponentDetails | null {
  const doc = componentAppearanceDocOf(kind);
  if (!doc) return null;
  const dimensions = Object.fromEntries(
    APPEARANCE_DIMENSIONS.map((dimension) => [dimension, displayLabel(dimension)])
  ) as Record<AppearanceDimension, string>;
  const values: Record<string, string> = {};
  for (const dimension of APPEARANCE_DIMENSIONS) {
    for (const value of doc.allowed[dimension]) values[`${dimension}:${value}`] = displayLabel(value);
  }
  const presets = Object.fromEntries(doc.presets.map((preset) => [preset, displayLabel(preset)]));
  return {
    kind: doc.kind,
    defaults: doc.defaults,
    allowed: doc.allowed,
    presets: doc.presets,
    labels: { kind: displayLabel(kind), dimensions, values, presets },
  };
}

function appearanceQueryOf(docs: ComponentDoc[], additionalKinds: string[] = []): AppearanceQueryDetails {
  return {
    schemaVersion: APPEARANCE_SCHEMA_VERSION,
    dimensions: APPEARANCE_DIMENSIONS.map((id) => ({ id, label: displayLabel(id) })),
    components: [...docs.map((doc) => doc.kind), ...additionalKinds]
      .map((kind) => appearanceDetailsOf(kind))
      .filter((entry): entry is AppearanceComponentDetails => entry !== null),
  };
}

function appearanceOnlyBlock(kind: string): string {
  const appearance = appearanceDetailsOf(kind)!;
  return [
    `[component: ${kind}]`,
    'Appearance options (semantic ComponentDoc unavailable for this legacy kind)',
    `schemaVersion: ${APPEARANCE_SCHEMA_VERSION}`,
    `preset: ${appearance.presets.length ? appearance.presets.join(', ') : 'none'}`,
    ...APPEARANCE_DIMENSIONS.map((dimension) => `${dimension}: ${appearance.allowed[dimension].join(', ')}`),
  ].join('\n');
}
/** Full-mode block for one kind (doc 10 §2.1 template). */
function fullBlock(doc: ComponentDoc): string {
  const appearance = appearanceDetailsOf(doc.kind);
  const appearanceLines = appearance
    ? [
        '',
        'appearance options',
        `  schemaVersion: ${APPEARANCE_SCHEMA_VERSION}`,
        `  preset: ${appearance.presets.length ? appearance.presets.map((id) => `${id} (${displayLabel(id)})`).join(', ') : 'none'}`,
        ...APPEARANCE_DIMENSIONS.map(
          (dimension) =>
            `  ${dimension}: ${appearance.allowed[dimension].map((id) => `${id} (${displayLabel(id)})`).join(', ')}`
        ),
      ]
    : [];
  const lines = [
    `[component: ${doc.kind}]  pack=${doc.pack}`,
    doc.purpose,
    `Click: ${doc.click}  ·  Channels: ${channelsOf(doc)}`,
    `Movable: ${doc.movable ? 'yes' : 'no'}  ·  Second layer: ${doc.secondLayer}  ·  Form: ${doc.form.w}x${doc.form.h} ${doc.form.chrome}`,
    '',
    'frontmatter fields',
    fieldLine({ name: 'component', type: 'string', required: true, desc: `kind id, literal "${doc.kind}"` }),
    fieldLine({ name: 'title', type: 'string', required: true, desc: 'card-face title' }),
    ...doc.fields
      .filter((f) => f.name !== 'title' && f.name !== 'component')
      .map((f) => fieldLine(f)),
    ...appearanceLines,
    '',
    'minimal example',
    doc.example,
    '',
    `related: ${doc.related.join(', ')}`,
  ];
  return lines.join('\n');
}

function indexText(docs: ComponentDoc[]): string {
  const core = docs.filter((d) => d.pack === 'core').length;
  const pack = docs.length - core;
  const header = `[components] ${docs.length} registered (${core} core + ${pack} pack)`;
  const rows = docs.map(indexLine);
  const footer = 'Call get_component({ component: "lock" }) for the full frontmatter contract.';
  return [header, ...rows, footer].join('\n');
}

/**
 * `get_component` — the read-only face of the component registry (doc 10).
 * No store writes, no canvas writes, no event: it only reads its own code-level
 * registry, which is why the whole module takes no `store` call at all.
 */
export async function getComponent(
  _ctx: ActionContext,
  input: GetComponentInput
): Promise<ActionResult<GetComponentDetails>> {
  const raw = input.component;

  if (raw === undefined || raw === null) {
    const docs = listComponents();
    return {
      text: indexText(docs),
      details: { mode: 'index', components: docs, appearance: appearanceQueryOf(docs, ['chalk']) },
    };
  }

  const requested = Array.isArray(raw) ? raw : [raw];
  const pathLike = requested.filter((k) => typeof k === 'string' && looksLikePath(k));
  if (pathLike.length === 1 && requested.length === 1) {
    fail(
      'invalid_argument',
      `"${pathLike[0]}" is a path, not a component kind. Use look_at for an entity, or get_component with a kind like "note".`
    );
  }

  const seen = new Set<string>();
  const kinds: string[] = [];
  for (const k of requested) {
    if (typeof k !== 'string') {
      fail('invalid_argument', `component must be a kind id or an array of kind ids, got ${typeof k}`);
    }
    if (!seen.has(k)) {
      seen.add(k);
      kinds.push(k);
    }
  }

  const unknown = kinds.filter((k) => !isOneOf(k) && !componentAppearanceDocOf(k));
  if (unknown.length === 1 && kinds.length === 1) {
    fail(
      'not_found',
      `Unknown component "${unknown[0]}". Run get_component with no argument to list the ${KIND_COUNT} registered kinds.`
    );
  }
  if (unknown.length > 0) {
    const quoted = unknown.map((u) => `"${u}"`).join(', ');
    fail(
      'not_found',
      `Unknown component(s): ${quoted}. Run get_component with no argument to list the ${KIND_COUNT} registered kinds.`
    );
  }

  const docs = kinds.map((k) => componentDocOf(k)).filter((d): d is ComponentDoc => d !== null);
  const appearanceOnly = kinds.filter((kind) => !isOneOf(kind));
  const text = [
    ...docs.map(fullBlock),
    ...appearanceOnly.map(appearanceOnlyBlock),
  ].join('\n\n');
  return {
    text,
    details: { mode: 'full', components: docs, appearance: appearanceQueryOf(docs, appearanceOnly) },
  };
}

registerAction('getComponent', (ctx, input) => getComponent(ctx, input as unknown as GetComponentInput));
