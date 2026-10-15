import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayItemOf } from '../dist/index.js';

const HTML = '<head><title>Page</title><meta name="description" content="Desc"></head><body>x</body>';
const MD = '---\ntitle: Note\n---\nprose body';

test('a .html item gets the virtual frontmatter and an EMPTY body', () => {
  const item = displayItemOf('world/a/page.html', HTML);
  assert.deepEqual(item.frontmatter, {
    type: 'html',
    title: 'Page',
    preview: 'Desc',
    design: 'desktop',
  });
  // The whole reason this function exists: page source must never reach a
  // renderer as prose. An empty body is the mechanism, not a nicety.
  assert.equal(item.body, '');
});

test('a .md item is byte-identical to parseFrontmatter', () => {
  const item = displayItemOf('world/a/note.md', MD);
  assert.deepEqual(item.frontmatter, { title: 'Note' });
  assert.equal(item.body, 'prose body');
});

test('a .md with no frontmatter block still round-trips its body', () => {
  const item = displayItemOf('world/a/note.md', 'just prose');
  assert.equal(item.frontmatter, null);
  assert.equal(item.body, 'just prose');
});

test('the extension decides, not the parse result', () => {
  // An author may legally write a `---` block inside an HTML page. Routing on
  // `parseFrontmatter`'s output would classify this as markdown and leak the
  // whole page as the body.
  const item = displayItemOf('world/a/page.html', `---\ntype: chalk\n---\n${HTML}`);
  assert.equal(item.frontmatter.type, 'html');
  assert.equal(item.body, '');
});

test('the extension test is case-insensitive', () => {
  const item = displayItemOf('world/a/PAGE.HTML', HTML);
  assert.equal(item.frontmatter.type, 'html');
  assert.equal(item.body, '');
});

test('the item carries exactly the two keys the contract froze', () => {
  assert.deepEqual(Object.keys(displayItemOf('a.html', HTML)).sort(), ['body', 'frontmatter']);
  assert.deepEqual(Object.keys(displayItemOf('a.md', MD)).sort(), ['body', 'frontmatter']);
});
