import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APPEARANCE_REGISTRY,
  APPEARANCE_AXIS_VALUES,
  componentAppearanceDocOf,
  resolveAppearance,
  validateAppearanceInput,
} from '../dist/index.js';

const context = {
  worldId: 'test-world',
  layerId: 'world/harbor-chart',
  worldMaterial: 'parchment',
  layerMaterial: 'kraft',
};

test('appearance registry exposes every controlled axis and core kind', () => {
  assert.deepEqual(Object.keys(APPEARANCE_AXIS_VALUES), ['font', 'surface', 'accent', 'ornament', 'motion']);
  assert.ok(APPEARANCE_REGISTRY.kinds.chalk);
  assert.ok(APPEARANCE_REGISTRY.kinds.letter);
  assert.ok(componentAppearanceDocOf('chalk'));
  assert.ok(componentAppearanceDocOf('letter')?.presets.includes('parchment-letter'));
});

test('missing appearance preserves kind defaults and does not inherit context', () => {
  const resolution = resolveAppearance({
    kind: 'letter',
    entityPath: 'world/letter.md',
    frontmatter: { type: 'component', component: 'letter' },
    context,
  });
  assert.equal(resolution.values.surface, 'paper');
  assert.equal(resolution.values.accent, 'ink');
  assert.equal(resolution.details.preset.source, 'none');
  assert.equal(resolution.warnings.length, 0);
});

test('explicit empty appearance opts into layer context, then explicit axes win', () => {
  const resolution = resolveAppearance({
    kind: 'letter',
    entityPath: 'world/letter.md',
    frontmatter: { type: 'component', component: 'letter', appearance: { accent: 'sage' } },
    context,
  });
  assert.equal(resolution.values.font, 'hand');
  assert.equal(resolution.values.surface, 'paper');
  assert.equal(resolution.values.accent, 'sage');
  assert.equal(resolution.values.ornament, 'ribbon');
  assert.equal(resolution.details.preset.applied, 'letter-kraft');
  assert.equal(resolution.details.dimensions.accent.source, 'explicit');
});

test('invalid input is rejected for writes without sanitising unknown keys', () => {
  const invalid = validateAppearanceInput({ surface: 'paper', css: 'body { color: red }' }, 'letter');
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.ok(invalid.issues.some((issue) => issue.code === 'unknown-key'));
    assert.ok(invalid.issues.every((issue) => !issue.message.includes('body')));
  }
});

test('unknown preset and axis produce observable fallback diagnostics', () => {
  const resolution = resolveAppearance({
    kind: 'chalk',
    entityPath: 'world/opening.md',
    frontmatter: { type: 'chalk', appearance: { preset: 'missing-theme', ornament: 'seal' } },
    context: { ...context, layerMaterial: null },
  });
  assert.equal(resolution.values.ornament, 'none');
  assert.ok(resolution.warnings.some((warning) => warning.code === 'unknown-preset'));
  assert.ok(resolution.warnings.some((warning) => warning.code === 'unsupported-dimension'));
  assert.ok(resolution.details.fallbackCount >= 2);
});
