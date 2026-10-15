import {
  APPEARANCE_AXIS_VALUES,
  APPEARANCE_DIMENSIONS,
  AppearanceIdSchema,
  APPEARANCE_SCHEMA_VERSION,
  type AppearanceAxes,
  type AppearanceDiagnostic,
  type AppearanceDimension,
  type AppearanceId,
  type AppearanceResolution,
  type AppearanceValueSource,
} from '../schemas/appearance.js';
import {
  APPEARANCE_REGISTRY,
  appearanceCapabilitiesOf,
  appearancePresetOf,
  appearanceTokenSetOf,
  type AppearanceKindCapabilities,
} from '../components/appearance-registry.js';

export interface AppearanceResolveInput {
  kind: string;
  entityPath: string;
  frontmatter: Record<string, unknown> | null;
  context: {
    worldId: string;
    layerId: string;
    worldMaterial: string | null | undefined;
    layerMaterial: string | null | undefined;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const id = (value: string): AppearanceId => value as AppearanceId;
const sourceOrder: AppearanceDimension[] = ['font', 'surface', 'accent', 'ornament', 'motion'];

export function resolveAppearance(input: AppearanceResolveInput): AppearanceResolution {
  const warnings: AppearanceDiagnostic[] = [];
  let fallbackCount = 0;
  const capabilities = appearanceCapabilitiesOf(input.kind);
  const base: AppearanceAxes = { font: id('serif'), surface: id('none'), accent: id('ink'), ornament: id('none'), motion: id('calm') };
  const safeCapabilities: AppearanceKindCapabilities = capabilities ?? {
    kind: input.kind,
    defaults: base,
    allowed: APPEARANCE_AXIS_VALUES,
    conflicts: [],
  };
  if (!capabilities) warnings.push({ code: 'registry-invalid', path: 'kind', input: input.kind, fallback: 'kind-default', message: `registry-invalid at kind` });
  const values: AppearanceAxes = { ...base, ...safeCapabilities.defaults };
  const dimensions = Object.fromEntries(sourceOrder.map((dimension) => [dimension, { value: values[dimension], source: capabilities ? 'kind' : 'base' as AppearanceValueSource }])) as Record<AppearanceDimension, { value: AppearanceId; source: AppearanceValueSource }>;
  const appearanceRaw = isRecord(input.frontmatter) && Object.prototype.hasOwnProperty.call(input.frontmatter, 'appearance') ? input.frontmatter.appearance : undefined;
  const hasAppearanceNamespace = Object.prototype.hasOwnProperty.call(input.frontmatter ?? {}, 'appearance');
  const namespace = isRecord(appearanceRaw) ? appearanceRaw : null;

  const add = (code: AppearanceDiagnostic['code'], path: string, fallback: AppearanceDiagnostic['fallback'], value?: unknown): void => {
    const short = typeof value === 'string' ? value : undefined;
    warnings.push({ code, path, ...(short === undefined ? {} : { input: short }), fallback, message: `${code} at ${path}` });
    if (fallback !== 'ignored' || code === 'invalid-id' || code === 'unknown-preset' || code === 'unsupported-preset') fallbackCount += 1;
  };
  const resetDimension = (dimension: AppearanceDimension): void => {
    values[dimension] = safeCapabilities.defaults[dimension];
    dimensions[dimension] = { value: values[dimension], source: 'fallback' };
  };


  if (hasAppearanceNamespace && !namespace) {
    add('invalid-shape', 'appearance', 'kind-default');
  }
  const legacyKeys = ['font', 'color', 'tone', 'card', 'chrome'];
  if (hasAppearanceNamespace && isRecord(input.frontmatter)) {
    for (const key of legacyKeys) if (key in input.frontmatter) add('legacy-collision', key, 'ignored', input.frontmatter[key]);
  }

  let presetRequested: AppearanceId | undefined;
  let presetApplied: AppearanceId | undefined;
  let presetSource: 'none' | 'context' | 'explicit' = 'none';
  const applyPreset = (presetId: AppearanceId, source: 'context-preset' | 'explicit-preset'): boolean => {
    const definition = appearancePresetOf(presetId);
    const path = source === 'context-preset' ? 'context.material' : 'appearance.preset';
    if (!definition) { add('unknown-preset', path, 'ignored', presetId); return false; }
    if (definition.kinds !== 'all' && !definition.kinds.includes(input.kind)) { add('unsupported-preset', path, 'ignored', presetId); return false; }
    for (const dimension of sourceOrder) {
      const value = definition.values[dimension];
      if (value === undefined) continue;
      if (!safeCapabilities.allowed[dimension].includes(value)) { resetDimension(dimension); add('unsupported-dimension', `${path}.${dimension}`, 'kind-default', value); continue; }
      values[dimension] = value;
      dimensions[dimension] = { value, source };
    }
    presetApplied = presetId;
    presetSource = source === 'context-preset' ? 'context' : 'explicit';
    return true;
  };

  // Context is intentionally gated on an explicit namespace; old entities stay on base/kind defaults.
  if (namespace) {
    const materials = [input.context.layerMaterial, input.context.worldMaterial];
    let contextApplied = false;
    for (const material of materials) {
      if (material === null || material === undefined || material === '') continue;
      const contextPreset = APPEARANCE_REGISTRY.materialPresets[material];
      if (!contextPreset) { add('unknown-material', 'context.material', 'kind-default', material); continue; }
      if (!contextApplied && applyPreset(contextPreset, 'context-preset')) contextApplied = true;
    }
    const explicitPresetRaw = namespace.preset;
    if (explicitPresetRaw !== undefined) {
      const parsed = AppearanceIdSchema.safeParse(explicitPresetRaw);
      if (!parsed.success) add('invalid-id', 'appearance.preset', 'ignored', typeof explicitPresetRaw === 'string' ? explicitPresetRaw : undefined);
      else {
        presetRequested = parsed.data;
        applyPreset(parsed.data, 'explicit-preset');
      }
    }
    const accepted = new Set<string>(['preset', ...sourceOrder]);
    for (const key of Object.keys(namespace)) if (!accepted.has(key)) add('unknown-key', `appearance.${key}`, 'ignored', key);
    for (const dimension of sourceOrder) {
      if (!(dimension in namespace)) continue;
      const rawValue = namespace[dimension];
      const parsed = AppearanceIdSchema.safeParse(rawValue);
      if (!parsed.success) { resetDimension(dimension); add('invalid-id', `appearance.${dimension}`, 'kind-default', typeof rawValue === 'string' ? rawValue : undefined); continue; }
      const value = parsed.data;
      if (!APPEARANCE_AXIS_VALUES[dimension].includes(value)) { resetDimension(dimension); add('unknown-dimension-value', `appearance.${dimension}`, 'kind-default', value); continue; }
      if (!safeCapabilities.allowed[dimension].includes(value)) { resetDimension(dimension); add('unsupported-dimension', `appearance.${dimension}`, 'kind-default', value); continue; }
      values[dimension] = value;
      dimensions[dimension] = { value, source: 'explicit' };
    }
  } else if (input.kind === 'chalk' && isRecord(input.frontmatter)) {
    // Legacy Chalk remains readable, but its layout/age fields never enter appearance.
    const legacyFont = input.frontmatter.font;
    if (legacyFont === 'hand') { values.font = id('hand'); dimensions.font = { value: values.font, source: 'legacy' }; }
    const legacyTone = input.frontmatter.color ?? input.frontmatter.tone;
    if (typeof legacyTone === 'string' && APPEARANCE_AXIS_VALUES.accent.includes(id(legacyTone)) && safeCapabilities.allowed.accent.includes(id(legacyTone))) {
      values.accent = id(legacyTone); dimensions.accent = { value: values.accent, source: 'legacy' };
    }
    if (input.frontmatter.card === true || input.frontmatter.chrome === 'paper') {
      values.surface = id('paper'); dimensions.surface = { value: values.surface, source: 'legacy' };
    }
  }

  for (const conflict of safeCapabilities.conflicts) {
    const [first, second] = conflict.dimensions;
    if (values[first.dimension] !== first.value || values[second.dimension] !== second.value) continue;
    values[second.dimension] = safeCapabilities.defaults[second.dimension];
    dimensions[second.dimension] = { value: values[second.dimension], source: 'fallback' };
    add('conflicting-combination', `appearance.${second.dimension}`, 'kind-default', second.value);
  }
  for (const dimension of sourceOrder) {
    if (appearanceTokenSetOf(dimension, values[dimension])) continue;
    const fallback = safeCapabilities.defaults[dimension];
    values[dimension] = fallback;
    dimensions[dimension] = { value: fallback, source: 'fallback' };
    add('token-missing', `appearance.${dimension}`, 'kind-default', values[dimension]);
  }

  return {
    schemaVersion: APPEARANCE_SCHEMA_VERSION,
    kind: input.kind,
    values,
    warnings,
    details: { preset: { ...(presetRequested === undefined ? {} : { requested: presetRequested }), ...(presetApplied === undefined ? {} : { applied: presetApplied }), source: presetSource }, dimensions, fallbackCount },
  };
}
