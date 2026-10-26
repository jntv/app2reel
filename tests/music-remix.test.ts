import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { remixSoundtracks } from '../server/render.js';
import { narrationFingerprint, readPreparedNarration } from '../server/narration-cache.js';
import type { Project, Scene } from '../shared/types.js';

const execute = promisify(execFile);
const available = Boolean(ffmpeg && existsSync(ffmpeg));
const run = (args: string[]) => execute(ffmpeg!, ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args], { maxBuffer: 4 * 1024 * 1024 });
const pictureHash = async (file: string) => (await run(['-i', file, '-map', '0:v:0', '-c:v', 'copy', '-an', '-f', 'hash', '-hash', 'sha256', 'pipe:1'])).stdout.trim();

async function fixture(directory: string): Promise<{ project: Project; originals: Map<string, Buffer> }> {
  const scenes = (kind: 'demo' | 'promo', duration: number): Scene[] => [{ id: kind, title: 'Workspace', caption: '', narration: 'Hello.', duration }];
  const demo = scenes('demo', 1.2), promo = scenes('promo', 1.8);
  const project: Project = {
    id: 'music-fixture', brief: { name: 'Fixture', url: 'https://example.com', description: '', purpose: '', actors: '', features: ['Workspace'],
      brandColor: '#408be8', duration: 10, resolution: '720p', maxSteps: 3, allowedOrigins: [], allowWrites: false, sample: true },
    createdAt: '', updatedAt: '', stage: 'complete', progress: 100, message: '', logs: [], sources: [], findings: [], shots: [], scenes: demo,
    filmPlans: { demo: { scenes: demo, targetDuration: 1.2 }, promo: { scenes: promo, targetDuration: 1.8 } },
    renderSettings: { motion: 'cinematic', subtitles: true, cursorHighlights: true, narration: false, narrationEngine: 'natural', narrationVoice: 'melo_india' },
    outputs: ['demo', 'promo'].map((kind, index) => ({ kind: kind as 'demo' | 'promo', file: `${kind}.mp4`, poster: `${kind}-poster.jpg`, width: 160, height: 90,
      fps: 30, duration: index === 0 ? 1.2 : 1.8, narrated: false, revision: `original-${kind}`, backgroundMusic: false, musicVolume: 0 })),
  };
  const originals = new Map<string, Buffer>();
  for (const output of project.outputs) {
    await run(['-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30', '-f', 'lavfi', '-i', 'sine=frequency=137:sample_rate=48000', '-t', String(output.duration),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(directory, output.file)]);
    originals.set(output.file, await readFile(path.join(directory, output.file)));
    for (const name of [output.poster!, `${output.kind}-captions.srt`, `${output.kind}-captions.vtt`, `${output.kind}-narration.wav`, `${output.kind}-narration-timing.json`]) {
      const bytes = Buffer.from(`Previously reviewed ${name}\n`);
      await writeFile(path.join(directory, name), bytes); originals.set(name, bytes);
    }
  }
  return { project, originals };
}

async function unchanged(directory: string, originals: Map<string, Buffer>, includeFilms = true) {
  for (const [name, bytes] of originals) {
    if (!includeFilms && name.endsWith('.mp4')) continue;
    assert.deepEqual(await readFile(path.join(directory, name)), bytes, `${name} must retain its exact prior bytes.`);
  }
  assert.ok(!(await readdir(directory)).some(name => name.startsWith('.audio-')), 'All staging audio is cleaned up.');
}

function voiceWav(seconds: number): Buffer {
  const frames = Math.round(seconds * 48000), bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / 48000;
    if (time > 0.15 && time < 0.9) bytes.writeInt16LE(Math.round(Math.sin(time * 2 * Math.PI * 431) * 5500), 44 + frame * 2);
  }
  return bytes;
}

async function cache(directory: string, scenes: Scene[], prefix = '') {
  const wav = voiceWav(scenes.reduce((sum, scene) => sum + scene.duration, 0));
  const timing = Buffer.from(JSON.stringify({ fingerprint: narrationFingerprint(scenes, { engine: 'natural', voice: 'melo_india' }), voice: 'melo_india', provider: 'MeloTTS ONNX',
    cues: [{ start: 0.15, end: 0.9, text: 'Hello.', words: ['Hello.'], wordStarts: [0.15] }] }));
  await writeFile(path.join(directory, `${prefix}narration.wav`), wav);
  await writeFile(path.join(directory, `${prefix}narration-timing.json`), timing);
  return new Map([[`${prefix}narration.wav`, wav], [`${prefix}narration-timing.json`, timing]]);
}

test('fast music update retains both picture streams, independent clocks and all reviewed sidecars', { skip: !available }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-remix-success-'));
  try {
    const { project, originals } = await fixture(directory);
    const before = structuredClone(project.outputs);
    const hashes = await Promise.all(project.outputs.map(output => pictureHash(path.join(directory, output.file))));
    const updated = await remixSoundtracks(project, directory, { enabled: true, volume: 0.24 });
    assert.deepEqual(project.outputs, before, 'The caller publishes metadata after the media job succeeds.');
    assert.deepEqual(updated.map(output => output.duration), [1.2, 1.8]);
    for (const [index, output] of updated.entries()) {
      assert.equal(output.backgroundMusic, true); assert.equal(output.musicVolume, 0.24);
      assert.notEqual(output.revision, before[index].revision);
      assert.deepEqual({ ...output, backgroundMusic: false, musicVolume: 0, revision: before[index].revision }, before[index]);
      assert.equal(await pictureHash(path.join(directory, output.file)), hashes[index], 'Encoded video packets are copied exactly.');
      assert.notDeepEqual(await readFile(path.join(directory, output.file)), originals.get(output.file), 'Audio is actually replaced.');
      const frames = (await run(['-i', path.join(directory, output.file), '-an', '-f', 'framemd5', 'pipe:1'])).stdout.split('\n').filter(line => /^0,/.test(line));
      assert.equal(frames.length, Math.round(output.duration * 30));
      await run(['-i', path.join(directory, output.file), '-map', '0:a:0', '-f', 'null', '-']);
    }
    await unchanged(directory, originals, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cancelling the second remix preserves both completed films and every sidecar', { skip: !available }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-remix-cancel-'));
  try {
    const { project, originals } = await fixture(directory);
    const controller = new AbortController(), progress: number[] = [];
    await assert.rejects(remixSoundtracks(project, directory, { enabled: true, volume: 0.24 }, {
      signal: controller.signal, onProgress: value => { progress.push(value); if (value === 45) controller.abort(); },
    }), /cancelled/i);
    assert.deepEqual(progress, [0, 45], 'First film finishes staging before the second film is cancelled.');
    await unchanged(directory, originals);
    assert.deepEqual(project.outputs.map(output => output.revision), ['original-demo', 'original-promo']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('missing independent voice cache rejects before mixing even when a valid shared cache exists', { skip: !available }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-remix-missing-voice-'));
  try {
    const { project, originals } = await fixture(directory);
    project.renderSettings!.narration = true;
    project.outputs.forEach(output => { output.narrated = true; });
    // The old shared take is valid for the demo but must never be substituted
    // for an independent film's missing reviewed voice.
    const shared = await cache(directory, project.filmPlans!.demo!.scenes);
    for (const [name, bytes] of shared) originals.set(name, bytes);
    for (const kind of ['demo', 'promo']) for (const suffix of ['narration.wav', 'narration-timing.json']) {
      const name = `${kind}-${suffix}`; await rm(path.join(directory, name)); originals.delete(name);
    }
    const check = path.join(directory, 'verify-shared'); await mkdir(check);
    assert.ok(await readPreparedNarration(project.filmPlans!.demo!.scenes, { engine: 'natural', voice: 'melo_india' }, directory, check));
    await rm(check, { recursive: true });
    const filesBefore = (await readdir(directory)).sort(), messages: string[] = [];
    await assert.rejects(remixSoundtracks(project, directory, { enabled: true, volume: 0.24 }, {
      onProgress: (_value, message) => messages.push(message),
    }), /reviewed voice track is missing or changed/i);
    assert.deepEqual(messages, [], 'No encoder or voice synthesis starts without the exact reviewed take.');
    await unchanged(directory, originals);
    assert.deepEqual((await readdir(directory)).sort(), filesBefore, 'No replacement voice or captions are synthesized.');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('valid independent narration caches are reused byte-for-byte while music is updated', { skip: !available }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-remix-voice-'));
  try {
    const { project, originals } = await fixture(directory);
    project.renderSettings!.narration = true;
    for (const output of project.outputs) {
      output.narrated = true;
      const saved = await cache(directory, project.filmPlans![output.kind]!.scenes, `${output.kind}-`);
      for (const [name, bytes] of saved) originals.set(name, bytes);
    }
    const updated = await remixSoundtracks(project, directory, { enabled: true, volume: 0.24 });
    assert.deepEqual(updated.map(output => [output.duration, output.narrated, output.backgroundMusic]), [[1.2, true, true], [1.8, true, true]]);
    await unchanged(directory, originals, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
