import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LocalAI } from '../server/ai.js';
import { directShot } from '../server/shot-direction.js';
import type { Scene, Shot } from '../shared/types.js';

const scene: Scene = { id: 'scene', title: 'Review the useful controls', caption: 'Keep your work organized.', narration: '', duration: 6, feature: 'Project tracking', screenshot: 'shot-001.png' };
const shot: Shot = { id: 'shot', title: 'Unneeded account title', url: 'https://example.test/work?private=do-not-send', screenshot: 'shot-001.png', at: 2, focusArea: { x: .15, y: .1, width: .7, height: .6 } };
const good = { focusArea: { x: .4, y: .15, width: .4, height: .2 }, focus: { x: .6, y: .25, zoom: 1.5 } };
const fallback = { focusArea: shot.focusArea, focus: { x: .5, y: .4, zoom: 1.35 } };

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-direction-'));
  try { await writeFile(path.join(directory, shot.screenshot), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4p8AAAAASUVORK5CYII=', 'base64')); await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('shot direction uses only the selected contained screenshot with strict no-search geometry inference', async () => fixture(async directory => {
  const controller = new AbortController(); let called = 0;
  const ai = { json: async (prompt: string, schema: Record<string, unknown>, options: { imagePath: string; signal: AbortSignal; webSearch: boolean }) => {
    called++; assert.equal(options.imagePath, await realpath(path.join(directory, shot.screenshot)));
    assert.equal(options.signal, controller.signal); assert.equal(options.webSearch, false);
    assert.equal(schema.additionalProperties, false); assert.deepEqual(schema.required, ['focusArea', 'focus']);
    assert.match(prompt, /untrusted product data/); assert.match(prompt, /Do not use tools/); assert.match(prompt, /Project tracking/);
    assert.ok(!prompt.includes(shot.url)); assert.ok(!prompt.includes(shot.title)); assert.ok(!prompt.includes('do-not-send'));
    return good;
  } } as unknown as LocalAI;
  assert.deepEqual(await directShot(scene, shot, directory, ai, controller.signal), good); assert.equal(called, 1);
}));

test('invalid ROI, focal point, extra fields and inference failure preserve the measured stable fallback', async () => fixture(async directory => {
  const invalid: unknown[] = [
    { ...good, focusArea: { x: .9, y: .1, width: .4, height: .2 } },
    { ...good, focusArea: { x: 0, y: 0, width: 1, height: 1 } },
    { ...good, focusArea: { x: .4, y: .15, width: .001, height: .2 } },
    { ...good, focus: { x: .1, y: .1, zoom: 1.5 } },
    { ...good, focus: { x: .6, y: .25, zoom: 4 } },
    { ...good, focus: { x: NaN, y: .25, zoom: 1.5 } },
    { ...good, explanation: 'unrequested response field' }, null,
  ];
  for (const value of invalid) assert.deepEqual(await directShot(scene, shot, directory, { json: async () => value } as unknown as LocalAI, new AbortController().signal), fallback);
  assert.deepEqual(await directShot(scene, shot, directory, { json: async () => { throw new Error('network unavailable'); } } as unknown as LocalAI, new AbortController().signal), fallback);
  const unusable = { ...shot, focusArea: { x: .9, y: .1, width: .4, height: .2 } };
  assert.deepEqual(await directShot(scene, unusable, directory, { json: async () => null } as unknown as LocalAI, new AbortController().signal), { focusArea: { x: 0, y: 0, width: 1, height: 1 }, focus: { x: .5, y: .5, zoom: 1.1 } });
  const smallMeasured = { x: .1, y: .1, width: .01, height: .01 };
  assert.deepEqual((await directShot(scene, { ...shot, focusArea: smallMeasured }, directory, { json: async () => null } as unknown as LocalAI, new AbortController().signal)).focusArea, smallMeasured, 'A valid measured region remains authoritative even if smaller than the AI planning minimum.');
}));

test('outside paths, symlinks, missing files and non-image names never reach inference', async () => fixture(async directory => {
  let calls = 0; const ai = { json: async () => { calls++; return good; } } as unknown as LocalAI;
  const outside = await mkdtemp(path.join(tmpdir(), 'capture-direction-outside-'));
  try {
    await writeFile(path.join(outside, 'outside.png'), 'outside'); await symlink(path.join(outside, 'outside.png'), path.join(directory, 'linked.png'));
    for (const filename of ['../outside.png', path.join(outside, 'outside.png'), 'linked.png', 'missing.png', 'project.json', '.hidden.png']) {
      assert.deepEqual(await directShot(scene, { ...shot, screenshot: filename }, directory, ai, new AbortController().signal), fallback);
    }
    assert.equal(calls, 0);
  } finally { await rm(outside, { recursive: true, force: true }); }
}));

test('cancellation before, during or reported by inference never falls through to fallback', async () => fixture(async directory => {
  const before = new AbortController(); before.abort(); let calls = 0;
  await assert.rejects(directShot(scene, shot, directory, { json: async () => { calls++; return good; } } as unknown as LocalAI, before.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
  const during = new AbortController();
  await assert.rejects(directShot(scene, shot, directory, { json: async () => { during.abort(); throw new Error('request stopped'); } } as unknown as LocalAI, during.signal), { name: 'AbortError' });
  const after = new AbortController();
  await assert.rejects(directShot(scene, shot, directory, { json: async () => { after.abort(); return good; } } as unknown as LocalAI, after.signal), { name: 'AbortError' });
  const abortError = new Error('AI request cancelled.'); abortError.name = 'AbortError';
  await assert.rejects(directShot(scene, shot, directory, { json: async () => { throw abortError; } } as unknown as LocalAI, new AbortController().signal), error => error === abortError);
}));
