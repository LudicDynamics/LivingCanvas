import { z } from 'zod';
import { appearanceCapabilitiesOf, appearancePresetOf } from '../components/appearance-registry.js';

export const APPEARANCE_SCHEMA_VERSION = 1 as const;
export const APPEARANCE_DIMENSIONS = ['font', 'surface', 'accent', 'ornament', 'motion'] as const;
export type AppearanceDimension = (typeof APPEARANCE_DIMENSIONS)[number];
export type AppearanceId = string & { readonly __appearanceId: unique symbol };
const id = (value: string): AppearanceId => value as AppearanceId;

export const APPEARANCE_AXIS_VALUES: Readonly<Record<AppearanceDimension, readonly AppearanceId[]>> = {
  font: [id('serif'), id('hand'), id('mono')],
  surface: [id('none'), id('paper'), id('parchment'), id('iron'), id('scroll'), id('panel'), id('board')],
  accent: [id('ink'), id('rust'), id('blue'), id('sage')],
  ornament: [id('none'), id('underline'), id('seal'), id('ribbon'), id('etched'), id('route-marks'), id('rules'), id('ticks'), id('grid')],
  motion: [id('still'), id('calm')],
};

const appearanceIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).transform(id);
export const AppearanceIdSchema: z.ZodType<AppearanceId> = appearanceIdSchema as unknown as z.ZodType<AppearanceId>;
export const AppearanceInputSchema = z.object({
  preset: AppearanceIdSchema.optional(), font: AppearanceIdSchema.optional(), surface: AppearanceIdSchema.optional(),
  accent: AppearanceIdSchema.optional(), ornament: AppearanceIdSchema.optional(), motion: AppearanceIdSchema.optional(),
}).strict();
export type AppearanceInput = z.infer<typeof AppearanceInputSchema>;

export interface AppearanceAxes { font: AppearanceId; surface: AppearanceId; accent: AppearanceId; ornament: AppearanceId; motion: AppearanceId; }
export type AppearanceDiagnosticCode =
  | 'invalid-shape' | 'unknown-key' | 'invalid-id' | 'unknown-preset' | 'unsupported-preset' | 'unknown-material'
  | 'unknown-dimension-value' | 'unsupported-dimension' | 'conflicting-combination' | 'legacy-collision'
  | 'registry-invalid' | 'token-missing' | 'component-view-missing';
export interface AppearanceDiagnostic {
  code: AppearanceDiagnosticCode; path: string; input?: AppearanceId | string;
  fallback: AppearanceId | 'ignored' | 'kind-default'; message: string;
}
export type AppearanceValueSource = 'base' | 'kind' | 'context-preset' | 'explicit-preset' | 'explicit' | 'legacy' | 'fallback';
export interface AppearanceResolution {
  schemaVersion: typeof APPEARANCE_SCHEMA_VERSION; kind: string; values: AppearanceAxes; warnings: AppearanceDiagnostic[];
  details: {
    preset: { requested?: AppearanceId; applied?: AppearanceId; source: 'none' | 'context' | 'explicit' };
    dimensions: Record<AppearanceDimension, { value: AppearanceId; source: AppearanceValueSource }>;
    fallbackCount: number;
  };
}
export type AppearanceValidation =
  | { ok: true; value: AppearanceInput; issues: [] }
  | { ok: false; value: null; issues: AppearanceDiagnostic[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const issue = (code: AppearanceDiagnosticCode, path: string, fallback: AppearanceDiagnostic['fallback'], input?: string): AppearanceDiagnostic => ({
  code, path, ...(input === undefined ? {} : { input }), fallback, message: `${code} at ${path}`,
});

/** Strict write-time validation for the appearance namespace. */
export function validateAppearanceInput(raw: unknown, kind: string): AppearanceValidation {
  if (!isRecord(raw)) return { ok: false, value: null, issues: [issue('invalid-shape', 'appearance', 'kind-default')] };
  const issues: AppearanceDiagnostic[] = [];
  const accepted = new Set<string>(['preset', ...APPEARANCE_DIMENSIONS]);
  for (const key of Object.keys(raw)) if (!accepted.has(key)) issues.push(issue('unknown-key', `appearance.${key}`, 'ignored', key));
  const parsed: Partial<Record<'preset' | AppearanceDimension, AppearanceId>> = {};
  for (const key of accepted) {
    if (!(key in raw)) continue;
    const rawValue = raw[key]; const result = AppearanceIdSchema.safeParse(rawValue);
    if (!result.success) issues.push(issue('invalid-id', `appearance.${key}`, key === 'preset' ? 'ignored' : 'kind-default', typeof rawValue === 'string' ? rawValue : undefined));
    else parsed[key as 'preset' | AppearanceDimension] = result.data;
  }
  const capabilities = appearanceCapabilitiesOf(kind);
  if (!capabilities) issues.push(issue('registry-invalid', 'kind', 'kind-default', kind));
  else {
    if (parsed.preset) {
      const preset = appearancePresetOf(parsed.preset);
      if (!preset) issues.push(issue('unknown-preset', 'appearance.preset', 'ignored', parsed.preset));
      else if (preset.kinds !== 'all' && !preset.kinds.includes(kind)) issues.push(issue('unsupported-preset', 'appearance.preset', 'ignored', parsed.preset));
    }
    for (const dimension of APPEARANCE_DIMENSIONS) {
      const value = parsed[dimension]; if (!value) continue;
      if (!APPEARANCE_AXIS_VALUES[dimension].includes(value)) issues.push(issue('unknown-dimension-value', `appearance.${dimension}`, 'kind-default', value));
      else if (!capabilities.allowed[dimension].includes(value)) issues.push(issue('unsupported-dimension', `appearance.${dimension}`, 'kind-default', value));
    }
  }
  return issues.length ? { ok: false, value: null, issues } : { ok: true, value: parsed as AppearanceInput, issues: [] };
}
