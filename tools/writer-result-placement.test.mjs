import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('writer status appears only once in the App dock', () => {
  const app = fs.readFileSync(new URL('../apps/web/src/App.tsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../apps/web/src/prototype.css', import.meta.url), 'utf8');
  const component = fs.readFileSync(new URL('../apps/web/src/components/WriterResult.tsx', import.meta.url), 'utf8');

  // WriterResult and the old world-meta surface must not be mounted alongside
  // the dock: duplicate receipts make one writer turn appear twice and put its
  // status outside the shared writer lane.
  assert.equal((app.match(/<WriterResult\b/g) ?? []).length, 0);
  assert.doesNotMatch(app, /WriterResult|prototype-world-meta/);

  const dockStart = app.indexOf('<div className="prototype-dock prototype-chrome">');
  const dockEnd = app.indexOf('\n          {attention ===', dockStart);
  assert.ok(dockStart >= 0 && dockEnd > dockStart, 'App must retain a bounded writer dock');
  const dock = app.slice(dockStart, dockEnd);
  // The dock is the sole status authority; keeping the marker inside this
  // region prevents a detached or duplicate writer status from regressing.
  assert.equal((app.match(/className="prototype-dock-status"/g) ?? []).length, 1);
  assert.match(dock, /<span className="prototype-dock-status" data-state=\{writerStatusKind\} aria-live="polite">\{writerStatusText\}<\/span>/);

  const rule = css.match(/\.prototype-dock-status\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /overflow:\s*hidden/);
  assert.match(rule, /text-overflow:\s*ellipsis/);
  assert.match(rule, /white-space:\s*nowrap/);
  // Keep the receipt component's source guard: if it is reused later, it must
  // still avoid copying an arbitrary 240-character slice of writer content.
  assert.doesNotMatch(component, /text\.slice\(0, 240\)/);
});
