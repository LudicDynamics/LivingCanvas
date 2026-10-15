import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
test('bag items have a read action and an explicit return action', async () => {
  const app = await fs.readFile('apps/web/src/App.tsx', 'utf8');
  const dialog = await fs.readFile('apps/web/src/components/BagItemDialog.tsx', 'utf8');
  assert.match(app, /onClick=\{\(\) => setSelectedBagPath\(item.path\)\}/);
  assert.match(dialog, /MarkdownText text=\{item.body\}/);
  assert.match(dialog, /renderFrontmatterWidgets/);
  assert.match(dialog, /if \(await onPlace\(item\.path\)\) requestClose\(\)/);
});
