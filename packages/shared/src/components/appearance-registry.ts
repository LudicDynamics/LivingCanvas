import { COMPONENT_KINDS } from '../schemas/components.js';
import type { AppearanceAxes, AppearanceDimension, AppearanceId } from '../schemas/appearance.js';
const APPEARANCE_DIMENSIONS = ['font', 'surface', 'accent', 'ornament', 'motion'] as const;
const APPEARANCE_AXIS_VALUES: Readonly<Record<AppearanceDimension, readonly AppearanceId[]>> = {
  font: ['serif', 'hand', 'mono'].map((value) => value as AppearanceId),
  surface: ['none', 'paper', 'parchment', 'iron', 'scroll', 'panel', 'board'].map((value) => value as AppearanceId),
  accent: ['ink', 'rust', 'blue', 'sage'].map((value) => value as AppearanceId),
  ornament: ['none', 'underline', 'seal', 'ribbon', 'etched', 'route-marks', 'rules', 'ticks', 'grid'].map((value) => value as AppearanceId),
  motion: ['still', 'calm'].map((value) => value as AppearanceId),
};

export interface AppearanceKindCapabilities {
  kind: string;
  defaults: AppearanceAxes;
  allowed: Readonly<Record<AppearanceDimension, readonly AppearanceId[]>>;
  conflicts: readonly AppearanceConflict[];
}
export interface AppearanceTokenSet {
  fontFamily: string;
  ink: string;
  muted: string;
  surface: string;
  border: string;
  shadow: string;
  radius: string;
  ornament: string;
  motionDuration: string;
  contrastOn: string;
}
export interface AppearanceConflict {
  dimensions: readonly [
    { dimension: AppearanceDimension; value: AppearanceId },
    { dimension: AppearanceDimension; value: AppearanceId },
  ];
  fallback: 'kind-default';
  reason: string;
}
export interface AppearancePresetDefinition { id: AppearanceId; values: Partial<AppearanceAxes>; kinds: readonly string[] | 'all'; }
export interface AppearanceRegistry {
  schemaVersion: 1;
  kinds: Readonly<Record<string, AppearanceKindCapabilities>>;
  presets: Readonly<Record<string, AppearancePresetDefinition>>;
  tokens: Readonly<Record<AppearanceDimension, Readonly<Record<string, AppearanceTokenSet>>>>;
  materialPresets: Readonly<Record<string, AppearanceId>>;
}

const id = (value: string): AppearanceId => value as AppearanceId;
const axis = <D extends AppearanceDimension>(dimension: D, values: readonly string[]): readonly AppearanceId[] =>
  values.map(id).filter((value) => APPEARANCE_AXIS_VALUES[dimension].includes(value));
const axes = (font: readonly string[], surface: readonly string[], accent = ['ink', 'rust', 'blue', 'sage'], ornament: readonly string[] = ['none'], motion: readonly string[] = ['still', 'calm']): Readonly<Record<AppearanceDimension, readonly AppearanceId[]>> => ({
  font: axis('font', font), surface: axis('surface', surface), accent: axis('accent', accent), ornament: axis('ornament', ornament), motion: axis('motion', motion),
});
const defaults = (font: string, surface: string, accent: string, ornament: string, motion: string): AppearanceAxes => ({ font: id(font), surface: id(surface), accent: id(accent), ornament: id(ornament), motion: id(motion) });
const capability = (kind: string, values: Readonly<Record<AppearanceDimension, readonly AppearanceId[]>>, base: AppearanceAxes): AppearanceKindCapabilities => ({ kind, defaults: base, allowed: values, conflicts: [] });
const allKinds = [...COMPONENT_KINDS] as string[];
const objectKinds = ['lock', 'container', 'trap', 'mechanism', 'anchor'];
const textKinds = ['book', 'ledger', 'photo', 'cipher', 'diary', 'thread'];
const allAccents = ['ink', 'rust', 'blue', 'sage'];

const kinds: Record<string, AppearanceKindCapabilities> = {
  chalk: capability('chalk', axes(['serif', 'hand', 'mono'], ['none', 'paper'], allAccents, ['none', 'underline'], ['still', 'calm']), defaults('serif', 'none', 'ink', 'none', 'calm')),
  note: capability('note', axes(['serif', 'hand'], ['paper'], allAccents, ['none', 'underline']), defaults('serif', 'paper', 'ink', 'none', 'calm')),
  letter: capability('letter', axes(['serif', 'hand'], ['paper', 'parchment'], allAccents, ['none', 'seal', 'ribbon']), defaults('serif', 'paper', 'ink', 'none', 'calm')),
  map: capability('map', axes(['serif', 'hand'], ['scroll'], allAccents, ['none', 'route-marks']), defaults('serif', 'scroll', 'ink', 'none', 'calm')),
  ...Object.fromEntries(objectKinds.map((kind) => [kind, capability(kind, axes(['serif', 'mono'], ['iron'], allAccents, ['none', 'etched']), defaults('serif', 'iron', 'ink', 'none', 'calm'))])),
  ...Object.fromEntries(textKinds.map((kind) => [kind, capability(kind, axes(['serif', 'mono'], ['paper'], allAccents, ['none', 'rules']), defaults('serif', 'paper', 'ink', 'none', 'calm'))])),
  clock: capability('clock', axes(['mono', 'serif'], ['panel'], allAccents, ['none', 'ticks']), defaults('mono', 'panel', 'ink', 'none', 'still')),
  tape: capability('tape', axes(['mono', 'serif'], ['panel'], allAccents, ['none', 'ticks']), defaults('mono', 'panel', 'ink', 'none', 'still')),
  instrument: capability('instrument', axes(['mono', 'serif'], ['board'], allAccents, ['none', 'grid']), defaults('mono', 'board', 'ink', 'none', 'calm')),
  board: capability('board', axes(['mono', 'serif'], ['board'], allAccents, ['none', 'grid']), defaults('mono', 'board', 'ink', 'none', 'calm')),
  portrait: capability('portrait', axes(['serif'], ['none'], allAccents, ['none']), defaults('serif', 'none', 'ink', 'none', 'still')),
};

const preset = (name: string, values: Partial<AppearanceAxes>, presetKinds: readonly string[] | 'all'): AppearancePresetDefinition => ({ id: id(name), values, kinds: presetKinds });
const presets: Record<string, AppearancePresetDefinition> = {
  'chalk-signal': preset('chalk-signal', { font: id('hand'), surface: id('none'), accent: id('rust'), ornament: id('underline'), motion: id('calm') }, ['chalk']),
  'parchment-letter': preset('parchment-letter', { font: id('serif'), surface: id('parchment'), accent: id('rust'), ornament: id('seal'), motion: id('calm') }, ['letter']),
  'letter-kraft': preset('letter-kraft', { font: id('hand'), surface: id('paper'), accent: id('sage'), ornament: id('ribbon'), motion: id('calm') }, ['letter']),
  'iron-archive': preset('iron-archive', { font: id('mono'), surface: id('iron'), accent: id('ink'), ornament: id('etched'), motion: id('still') }, objectKinds),
};

const tokenSet = (dimension: AppearanceDimension, value: AppearanceId): AppearanceTokenSet => ({
  fontFamily: `font-${dimension === 'font' ? value : 'serif'}`,
  ink: `ink-${dimension === 'accent' ? value : 'ink'}`,
  muted: `muted-${dimension === 'accent' ? value : 'ink'}`,
  surface: `surface-${dimension === 'surface' ? value : 'none'}`,
  border: `border-${dimension === 'surface' ? value : 'ink'}`,
  shadow: `shadow-${dimension === 'surface' && value !== id('none') ? value : 'none'}`,
  radius: 'radius-card',
  ornament: `ornament-${dimension === 'ornament' ? value : 'none'}`,
  motionDuration: `motion-${dimension === 'motion' ? value : 'calm'}`,
  contrastOn: 'contrast-readable',
});
const tokens = Object.fromEntries(APPEARANCE_DIMENSIONS.map((dimension) => [
  dimension,
  Object.fromEntries(APPEARANCE_AXIS_VALUES[dimension].map((value) => [value, tokenSet(dimension, value)])),
])) as Readonly<Record<AppearanceDimension, Readonly<Record<string, AppearanceTokenSet>>>>;

export const APPEARANCE_REGISTRY: AppearanceRegistry = {
  schemaVersion: 1,
  kinds,
  presets,
  tokens,
  materialPresets: {
    parchment: id('parchment-letter'), warm: id('parchment-letter'), kraft: id('letter-kraft'), stub: id('chalk-signal'),
  },
};

const isTokenId = (value: string): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && !/[./:#<>()'"{}]/.test(value);
export function validateAppearanceRegistry(registry: AppearanceRegistry = APPEARANCE_REGISTRY): void {
  if (registry.schemaVersion !== 1) throw new Error('registry-invalid: schema version');
  for (const dimension of APPEARANCE_DIMENSIONS) {
    if (!registry.tokens[dimension]) throw new Error(`registry-invalid: missing token dimension ${dimension}`);
  }
  const expectedKinds = new Set<string>(['chalk', ...allKinds]);
  for (const kind of expectedKinds) if (!registry.kinds[kind]) throw new Error(`registry-invalid: missing kind ${kind}`);
  for (const kind of Object.keys(registry.kinds)) if (!expectedKinds.has(kind)) throw new Error(`registry-invalid: unknown kind ${kind}`);
  for (const [kind, entry] of Object.entries(registry.kinds)) {
    if (entry.kind !== kind) throw new Error(`registry-invalid: kind key mismatch ${kind}`);
    for (const dimension of APPEARANCE_DIMENSIONS) {
      const allowed = entry.allowed[dimension];
      if (!allowed || !allowed.length || !allowed.includes(entry.defaults[dimension])) throw new Error(`registry-invalid: ${kind}.${dimension}`);
      if (allowed.some((value) => !APPEARANCE_AXIS_VALUES[dimension].includes(value))) throw new Error(`registry-invalid: ${kind}.${dimension} value`);
    }
    for (const conflict of entry.conflicts) for (const side of conflict.dimensions) {
      if (!APPEARANCE_AXIS_VALUES[side.dimension].includes(side.value) || !entry.allowed[side.dimension].includes(side.value)) throw new Error(`registry-invalid: conflict ${kind}.${side.dimension}`);
    }
  }
  for (const [key, definition] of Object.entries(registry.presets)) {
    if (!isTokenId(key) || definition.id !== key) throw new Error(`registry-invalid: preset key ${key}`);
    if (definition.kinds !== 'all' && !Array.isArray(definition.kinds)) throw new Error(`registry-invalid: preset kinds ${key}`);
    if (definition.kinds !== 'all') for (const kind of definition.kinds) if (!registry.kinds[kind]) throw new Error(`registry-invalid: preset kind ${kind}`);
    for (const [dimensionKey, value] of Object.entries(definition.values)) {
      if (!(APPEARANCE_DIMENSIONS as readonly string[]).includes(dimensionKey)) throw new Error(`registry-invalid: preset dimension ${key}.${dimensionKey}`);
      const dimension = dimensionKey as AppearanceDimension;
      if (!APPEARANCE_AXIS_VALUES[dimension].includes(value as AppearanceId)) throw new Error(`registry-invalid: preset value ${key}.${dimension}`);
      if (definition.kinds !== 'all' && definition.kinds.some((kind) => !registry.kinds[kind].allowed[dimension].includes(value as AppearanceId))) throw new Error(`registry-invalid: preset capability ${key}.${dimension}`);
    }
  }
  for (const [dimension, values] of Object.entries(registry.tokens) as [AppearanceDimension, Readonly<Record<string, AppearanceTokenSet>>][]) {
    const fields: (keyof AppearanceTokenSet)[] = ['fontFamily', 'ink', 'muted', 'surface', 'border', 'shadow', 'radius', 'ornament', 'motionDuration', 'contrastOn'];
    for (const value of APPEARANCE_AXIS_VALUES[dimension]) {
      const set = values[value];
      if (!set || fields.some((field) => typeof set[field] !== 'string' || !isTokenId(set[field]))) throw new Error(`registry-invalid: token ${dimension}.${value}`);
    }
  }
  const knownMaterials = new Set(['parchment', 'warm', 'kraft', 'stub']);
  for (const [material, target] of Object.entries(registry.materialPresets)) if (!knownMaterials.has(material) || !registry.presets[target]) throw new Error(`registry-invalid: material ${material}`);
}
validateAppearanceRegistry();

export function appearanceCapabilitiesOf(kind: string): AppearanceKindCapabilities | null { return APPEARANCE_REGISTRY.kinds[kind] ?? null; }
export function appearancePresetOf(idValue: string): AppearancePresetDefinition | null { return APPEARANCE_REGISTRY.presets[idValue] ?? null; }
export function appearanceTokenSetOf(dimension: AppearanceDimension, value: string): AppearanceTokenSet | null { return APPEARANCE_REGISTRY.tokens[dimension]?.[value] ?? null; }
export function componentAppearanceDocOf(kind: string): { kind: string; defaults: AppearanceAxes; allowed: Readonly<Record<AppearanceDimension, readonly AppearanceId[]>>; presets: readonly AppearanceId[] } | null {
  const entry = appearanceCapabilitiesOf(kind); if (!entry) return null;
  return { kind, defaults: entry.defaults, allowed: entry.allowed, presets: Object.values(APPEARANCE_REGISTRY.presets).filter((candidate) => candidate.kinds === 'all' || candidate.kinds.includes(kind)).map((candidate) => candidate.id) };
}
