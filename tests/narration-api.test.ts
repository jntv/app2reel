import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { z } from 'zod';
import ffmpeg from 'ffmpeg-static';
import { registerNarrationRoutes } from '../server/narration-api.js';
import { narrationEngine } from '../server/narration.js';

async function fixture(t: TestContext, assertIdle: () => void = () => {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-voice-api-'));
  const app = express();
  app.use(express.json());
  const closeRoutes = registerNarrationRoutes(app, directory, assertIdle);
  // Match the application's error boundary without importing/starting its server.
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof z.ZodError ? 400 : (error as { status?: number }).status || 400;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Request failed' });
  });
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    try { await closeRoutes(); }
    finally {
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      try { await closed; } finally { await rm(directory, { recursive: true, force: true }); }
    }
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (endpoint: string, body: unknown) => fetch(`${base}/api/narration/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { base, directory, post };
}

test('narration status exposes readiness and supported voices without requiring idle or starting setup', async t => {
  let idleChecks = 0;
  const api = await fixture(t, () => { idleChecks += 1; throw Object.assign(new Error('Busy'), { status: 409 }); });
  const response = await fetch(`${api.base}/api/narration/status`);
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(typeof status.naturalReady, 'boolean');
  assert.equal(typeof status.systemReady, 'boolean');
  assert.ok(['missing', 'installing', 'ready', 'failed'].includes(status.state));
  assert.equal(typeof status.message, 'string');
  assert.deepEqual(status.voices.map((voice: { id: string }) => voice.id), ['melo_india', 'af_heart', 'am_michael', 'qwen_indian_male', 'qwen_indian_female']);
  assert.equal(idleChecks, 0);
  assert.deepEqual(await readdir(api.directory), [], 'Reading readiness must not create preview or setup artifacts.');
});

test('narration requests strictly reject invalid engines, voices, oversized text and supplied paths before idle or synthesis', async t => {
  let idleChecks = 0;
  const api = await fixture(t, () => { idleChecks += 1; });
  const invalid = [
    {}, { engine: 'remote' }, { engine: 'https://example.test/voice' },
    { engine: 'natural', voice: 'Samantha' }, { engine: 'natural', voice: '../../private.wav' },
    { engine: 'natural', voice: 'file:///etc/passwd' }, { engine: 'system', text: 'x'.repeat(201) },
    { engine: 'system', text: '   ' }, { engine: 'system', text: 12 },
    { engine: 'system', file: '/tmp/unsafe.wav' }, { engine: 'system', path: '../../private.wav' },
    { engine: 'system', url: 'https://example.test/audio.wav' }, { engine: 'system', modelDir: '/tmp/models' },
  ];
  for (const body of invalid) {
    const response = await api.post('preview', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof (await response.json()).error, 'string');
  }
  // Never submit a valid setup body: this test must not install/download anything.
  for (const body of [{ directory: '/tmp/unsafe-runtime' }, { url: 'https://example.test/model.onnx' }, []]) {
    assert.equal((await api.post('setup', body)).status, 400);
  }
  assert.equal(idleChecks, 0, 'Schema rejection must precede any work reservation.');
  assert.deepEqual(await readdir(api.directory), []);
});

test('busy narration setup and preview return409 before creating files or starting downloads', async t => {
  let idleChecks = 0;
  const api = await fixture(t, () => { idleChecks += 1; throw Object.assign(new Error('Another job is running.'), { status: 409 }); });
  for (const [endpoint, body] of [['setup', {}], ['setup',{voice:'qwen_indian_female'}],['preview',{engine:'natural',voice:'qwen_indian_male'}],['preview', { engine: 'system', text: 'A short local sample.' }]] as const) {
    const response = await api.post(endpoint, body);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /Another job/);
  }
  assert.equal(idleChecks, 4);
  assert.deepEqual(await readdir(api.directory), []);
});

test('preview retrieval accepts only server-issued identifiers and rejects unknown paths or URLs', async t => {
  const api = await fixture(t);
  for (const file of ['00000000-0000-0000-0000-000000000000.wav', 'unknown.wav', '../../etc/passwd', '/tmp/private.wav', 'file:///etc/passwd', 'https://example.test/audio.wav']) {
    const response = await fetch(`${api.base}/api/narration/previews/${encodeURIComponent(file)}`);
    assert.equal(response.status, 404, file);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});

const systemAvailable = Boolean(narrationEngine() && ffmpeg && spawnSync(ffmpeg, ['-version'], { stdio: 'ignore', timeout: 5000 }).status === 0);

test('system voice preview produces a short audible local WAV at its issued URL', { skip: !systemAvailable, timeout: 30000 }, async t => {
  const api = await fixture(t);
  const preview = await api.post('preview', { engine: 'system', text: 'A clear voice for your product.' });
  assert.equal(preview.status, 200, await preview.clone().text());
  const metadata = await preview.json();
  assert.match(metadata.url, /^\/api\/narration\/previews\/[a-f0-9-]{36}\.wav$/);
  assert.equal(metadata.label, 'System voice');
  assert.equal(typeof metadata.voice, 'string');
  const response = await fetch(`${api.base}${metadata.url}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const audio = Buffer.from(await response.arrayBuffer());
  assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
  assert.equal(audio.toString('ascii', 8, 12), 'WAVE');
  let byteRate = 0, data: Buffer | undefined;
  for (let position = 12; position + 8 <= audio.length;) {
    const kind = audio.toString('ascii', position, position + 4), size = audio.readUInt32LE(position + 4);
    if (kind === 'fmt ') {
      assert.equal(audio.readUInt16LE(position + 8), 1, 'Preview uses uncompressed PCM.');
      assert.equal(audio.readUInt16LE(position + 10), 1, 'Preview is mono.');
      assert.equal(audio.readUInt32LE(position + 12), 48000);
      byteRate = audio.readUInt32LE(position + 16);
    }
    if (kind === 'data') data = audio.subarray(position + 8, position + 8 + size);
    position += 8 + size + size % 2;
  }
  assert.ok(data && data.length > 0 && byteRate > 0);
  const duration = data.length / byteRate;
  assert.ok(duration > 0.5 && duration < 10, `A short preview should contain speech, not a 30-second padded scene (${duration}s).`);
  let peak = 0;
  for (let index = 0; index + 1 < data.length; index += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(index)));
  assert.ok(peak > 100, 'The generated preview must contain audible samples.');
  const entries = await readdir(path.join(api.directory, '.voice-previews'));
  assert.deepEqual(entries, [path.basename(metadata.url)], 'Temporary synthesis files must be removed after publication.');
});
