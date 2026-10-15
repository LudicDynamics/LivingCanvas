import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripBlankOptionals, withoutBlankOptionals } from '../extensions/toolkit/blank-optionals.ts';

const schema = { type: 'object', required: ['content'], properties: { content: {}, path: {}, append_to: {}, link_to: {} } };

test('blank optional arguments are dropped; required ones are kept verbatim', () => {
  assert.deepEqual(
    stripBlankOptionals(schema, { content: 'x', path: 'world/a.md', append_to: '', link_to: '   ' }),
    { content: 'x', path: 'world/a.md' },
  );
  assert.deepEqual(stripBlankOptionals(schema, { content: '', path: null }), { content: '' });
  assert.deepEqual(stripBlankOptionals(undefined, { a: '', b: 1 }), { b: 1 });
});

test('the wrapped tool executes with normalised params and keeps its identity', async () => {
  const seen = [];
  const tool = {
    name: 'chalk', label: 'Chalk', description: 'd', parameters: schema,
    execute: async (_id, params) => { seen.push(params); return { content: [], details: params }; },
  };
  const wrapped = withoutBlankOptionals(tool);
  assert.equal(wrapped.name, 'chalk');
  assert.equal(wrapped.parameters, schema);
  await wrapped.execute('c1', { content: 'hello', path: 'world/inn/02.md', append_to: '' }, undefined, undefined, {});
  assert.deepEqual(seen, [{ content: 'hello', path: 'world/inn/02.md' }]);
});
