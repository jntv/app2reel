import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalAI } from '../server/ai';

const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };

async function fixture(mode: 'ok' | 'api' | 'incomplete' | 'wait') {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-ai-test-'));
  const executable = path.join(directory, 'fake-codex');
  const record = path.join(directory, 'record.json');
  await writeFile(executable, `#!${process.execPath}\n` + `
const fs = require('node:fs');
const args = process.argv.slice(2);
const mode = ${JSON.stringify(mode)};
if (args[0] === '--version') { console.log('codex-cli test'); process.exit(0); }
if (args[0] === 'login') { console.log(mode === 'api' ? 'Logged in using an API key' : 'Logged in using ChatGPT'); process.exit(0); }
if (args.includes('--help')) { console.log('--ignore-user-config --ignore-rules --ephemeral --output-schema'); process.exit(0); }
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({args,cwd:process.cwd(),hasKey:!!process.env.OPENAI_API_KEY}));
if (mode === 'wait') { setInterval(() => {}, 1000); }
else {
 fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ok:true}));
 console.log(JSON.stringify({type:mode === 'incomplete' ? 'turn.started' : 'turn.completed'}));
}
`, { mode: 0o700 });
  const previousBinary = process.env.CODEX_BIN;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.CODEX_BIN = executable;
  process.env.OPENAI_API_KEY = 'test-key-must-not-be-inherited';
  return { ai: new LocalAI(), record, cleanup: async () => {
    if (previousBinary === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = previousBinary;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    await rm(directory, { recursive: true, force: true });
  } };
}

test('AI bridge isolates model calls, excludes API credentials and removes request files', { skip: process.platform === 'win32' }, async () => {
  const current = await fixture('ok');
  try {
    assert.deepEqual(await current.ai.json('Return ok.', schema), { ok: true });
    const invocation = JSON.parse(await readFile(current.record, 'utf8'));
    assert.equal(invocation.hasKey, false);
    assert.ok(invocation.args.includes('--ignore-user-config'));
    assert.ok(invocation.args.includes('--ephemeral'));
    assert.equal(invocation.args[invocation.args.indexOf('--sandbox') + 1], 'read-only');
    assert.ok(invocation.args.includes('approval_policy="never"'));
    assert.ok(invocation.args.includes('features.shell_tool=false'));
    assert.ok(invocation.args.includes('features.apps=false'));
    await assert.rejects(stat(invocation.cwd), { code: 'ENOENT' });
  } finally { await current.cleanup(); }
});

test('API-key sessions are rejected before any model request', { skip: process.platform === 'win32' }, async () => {
  const current = await fixture('api');
  try {
    assert.equal((await current.ai.status()).connected, false);
    await assert.rejects(current.ai.json('Return ok.', schema), /API key/);
    assert.equal((await current.ai.login()).started, false);
    await assert.rejects(stat(current.record), { code: 'ENOENT' });
  } finally { await current.cleanup(); }
});

test('a JSON file without completed inference is not accepted', { skip: process.platform === 'win32' }, async () => {
  const current = await fixture('incomplete');
  try { await assert.rejects(current.ai.json('Return ok.', schema), /before completing/); }
  finally { await current.cleanup(); }
});

test('cancelling kills the inference and cleans its scratch directory', { skip: process.platform === 'win32' }, async () => {
  const current = await fixture('wait');
  const controller = new AbortController();
  try {
    const request = current.ai.json('Return ok.', schema, { signal: controller.signal });
    const rejection = assert.rejects(request, { name: 'AbortError' });
    let invocation: { cwd: string } | undefined;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !invocation) {
      try { invocation = JSON.parse(await readFile(current.record, 'utf8')); }
      catch { await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    controller.abort();
    await rejection;
    assert.ok(invocation, 'fake inference should have started');
    await assert.rejects(stat(invocation.cwd), { code: 'ENOENT' });
  } finally { controller.abort(); await current.cleanup(); }
});
