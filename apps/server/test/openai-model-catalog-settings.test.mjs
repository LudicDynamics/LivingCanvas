import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveConnectionSettings, migrateLegacyOpenAI, isOfficialOpenAIBaseUrl } from '../dist/routes/connection-settings.js';

const pendingNames = [
  'AIRP_CUSTOM_OPENAI_PENDING_BASE_URL',
  'AIRP_CUSTOM_OPENAI_PENDING_API_KEY',
  'AIRP_CUSTOM_OPENAI_PENDING_GENERATION',
  'AIRP_CUSTOM_OPENAI_BASE_URL',
  'AIRP_CUSTOM_OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
];

async function withConfigEnv(callback) {
  const prior = Object.fromEntries(pendingNames.map(name => [name, process.env[name]]));
  for (const name of pendingNames) delete process.env[name];
  try { await callback(); }
  finally {
    for (const name of pendingNames) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  }
}

test('saving custom OpenAI credentials writes a paired pending config without activating it', async () => {
  await withConfigEnv(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-openai-pending-'));
    const secret = 'custom-test-secret';
    try {
      delete process.env.AIRP_CUSTOM_OPENAI_BASE_URL;
      delete process.env.AIRP_CUSTOM_OPENAI_API_KEY;
      saveConnectionSettings(root, {
        AIRP_CUSTOM_OPENAI_PENDING_BASE_URL: 'http://127.0.0.1:1234/v1',
        AIRP_CUSTOM_OPENAI_PENDING_API_KEY: secret,
      });
      const file = await fs.readFile(path.join(root, '.env.local'), 'utf8');
      assert.match(file, /AIRP_CUSTOM_OPENAI_PENDING_BASE_URL=/);
      assert.match(file, /AIRP_CUSTOM_OPENAI_PENDING_API_KEY="custom-test-secret"/);
      assert.ok(Number(process.env.AIRP_CUSTOM_OPENAI_PENDING_GENERATION) > 0);
      assert.equal(process.env.AIRP_CUSTOM_OPENAI_API_KEY, undefined);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});

test('custom OpenAI settings reject URL-only or key-only writes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-openai-pair-'));
  try {
    assert.throws(() => saveConnectionSettings(root, { AIRP_CUSTOM_OPENAI_PENDING_BASE_URL: 'https://example.test/v1' }), /pair/);
    assert.throws(() => saveConnectionSettings(root, { AIRP_CUSTOM_OPENAI_PENDING_API_KEY: 'secret' }), /pair/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('legacy non-default OpenAI URL and key migrate together and stop being official credentials', async () => {
  await withConfigEnv(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-openai-legacy-'));
    const secret = 'legacy-custom-secret';
    try {
      await fs.writeFile(path.join(root, '.env.local'), `OPENAI_BASE_URL="http://127.0.0.1:4321/v1"\nOPENAI_API_KEY="${secret}"\n`, { mode: 0o600 });
      process.env.OPENAI_BASE_URL = 'http://127.0.0.1:4321/v1';
      process.env.OPENAI_API_KEY = secret;
      migrateLegacyOpenAI(root);
      const file = await fs.readFile(path.join(root, '.env.local'), 'utf8');
      assert.match(file, /AIRP_CUSTOM_OPENAI_PENDING_BASE_URL="http:\/\/127\.0\.0\.1:4321\/v1"/);
      assert.match(file, /AIRP_CUSTOM_OPENAI_PENDING_API_KEY="legacy-custom-secret"/);
      assert.doesNotMatch(file, /^OPENAI_(?:BASE_URL|API_KEY)=/m);
      assert.equal(process.env.OPENAI_API_KEY, undefined);
      assert.ok(Number(process.env.AIRP_CUSTOM_OPENAI_PENDING_GENERATION) > 0);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
test('canonical official OpenAI URL with trailing slash keeps its key official', async () => {
  await withConfigEnv(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-openai-default-'));
    try {
      await fs.writeFile(path.join(root, '.env.local'), 'OPENAI_BASE_URL="https://api.openai.com/v1/"\nOPENAI_API_KEY="official-key"\n');
      process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1/';
      process.env.OPENAI_API_KEY = 'official-key';
      assert.equal(isOfficialOpenAIBaseUrl(process.env.OPENAI_BASE_URL), true);
      migrateLegacyOpenAI(root);
      assert.equal(process.env.OPENAI_API_KEY, 'official-key');
      assert.equal(process.env.AIRP_CUSTOM_OPENAI_PENDING_API_KEY, undefined);
      assert.match(await fs.readFile(path.join(root, '.env.local'), 'utf8'), /OPENAI_API_KEY="official-key"/);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});

test('legacy migration preserves env credentials for incomplete, invalid, or already-overridden pairs', async () => {
  await withConfigEnv(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-openai-invalid-'));
    try {
      process.env.OPENAI_BASE_URL = 'https://endpoint.example/v1';
      process.env.OPENAI_API_KEY = 'legacy-key';
      await fs.writeFile(path.join(root, '.env.local'), 'OPENAI_BASE_URL="https://endpoint.example/v1"\n');
      migrateLegacyOpenAI(root);
      assert.equal(process.env.OPENAI_API_KEY, 'legacy-key');
      assert.equal(process.env.OPENAI_BASE_URL, 'https://endpoint.example/v1');

      await fs.writeFile(path.join(root, '.env.local'), 'OPENAI_BASE_URL="ftp://endpoint.example/v1"\nOPENAI_API_KEY="legacy-key"\n');
      process.env.OPENAI_BASE_URL = 'ftp://endpoint.example/v1';
      migrateLegacyOpenAI(root);
      assert.equal(process.env.OPENAI_API_KEY, 'legacy-key');
      assert.equal(process.env.OPENAI_BASE_URL, 'ftp://endpoint.example/v1');

      await fs.writeFile(path.join(root, '.env.local'), 'OPENAI_BASE_URL="https://endpoint.example/v1"\nOPENAI_API_KEY="legacy-key"\nAIRP_CUSTOM_OPENAI_PENDING_BASE_URL="https://new.example/v1"\nAIRP_CUSTOM_OPENAI_PENDING_API_KEY="new-key"\n');
      process.env.OPENAI_BASE_URL = 'https://endpoint.example/v1';
      migrateLegacyOpenAI(root);
      assert.equal(process.env.OPENAI_API_KEY, 'legacy-key');
      assert.equal(process.env.OPENAI_BASE_URL, 'https://endpoint.example/v1');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});

test('legacy migration preserves old env values when durable pair write fails', async () => {
  await withConfigEnv(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airp-openai-write-failure-'));
    try {
      await fs.writeFile(path.join(root, '.env.local'), 'OPENAI_BASE_URL="http://127.0.0.1:8765/v1"\nOPENAI_API_KEY="legacy-key"\n');
      process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8765/v1';
      process.env.OPENAI_API_KEY = 'legacy-key';
      assert.throws(() => migrateLegacyOpenAI(root, () => { throw new Error('persistence-failed'); }), /persistence-failed/);
      assert.equal(process.env.OPENAI_API_KEY, 'legacy-key');
      assert.equal(process.env.OPENAI_BASE_URL, 'http://127.0.0.1:8765/v1');
      assert.match(await fs.readFile(path.join(root, '.env.local'), 'utf8'), /OPENAI_API_KEY="legacy-key"/);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
