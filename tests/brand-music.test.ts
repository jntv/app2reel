import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeBrandMusic } from '../server/brand-music.js';

const RATE = 48000;
function measure(bytes: Buffer, start = 0, end = (bytes.length - 44) / 4) {
  let sum = 0, peak = 0, difference = 0, change = 0, previous = 0;
  for (let frame = start; frame < end; frame += 1) {
    const left = bytes.readInt16LE(44 + frame * 4) / 32768;
    const right = bytes.readInt16LE(46 + frame * 4) / 32768;
    sum += left * left + right * right;
    difference += (left - right) ** 2;
    peak = Math.max(peak, Math.abs(left), Math.abs(right));
    if (frame > start) change += (left - previous) ** 2;
    previous = left;
  }
  return { rms: Math.sqrt(sum / ((end - start) * 2)), peak,
    width: Math.sqrt(difference / (end - start)), highFrequencyRatio: change / Math.max(sum / 2, 1e-12) };
}

test('original brand scores are exact stereo PCM with restrained level, width and smooth bookends', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-brand-music-'));
  try {
    for (const kind of ['demo', 'promo'] as const) {
      const duration = 18.375;
      const info = await writeBrandMusic(path.join(directory, `${kind}.wav`), duration, kind);
      const bytes = await readFile(info.file);
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 16), 'WAVEfmt ');
      assert.equal(bytes.readUInt16LE(20), 1, 'Uncompressed integer PCM, no extra decoder dependency.');
      assert.equal(bytes.readUInt16LE(22), 2);
      assert.equal(bytes.readUInt32LE(24), RATE);
      assert.equal(bytes.readUInt16LE(34), 16);
      assert.equal(bytes.length, 44 + Math.round(duration * RATE) * 4);
      assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
      assert.equal(info.duration, duration);
      const full = measure(bytes);
      assert.ok(full.rms > 0.08 && full.rms < 0.12, `Music is audible at a low subsequent mix gain: RMS ${full.rms}.`);
      assert.ok(full.peak < 0.721 && full.peak > 0.15, `Headroom for narration: peak ${full.peak}.`);
      assert.ok(Math.abs(info.rms - full.rms) < 1e-10);
      assert.equal(info.peak, full.peak);
      assert.ok(full.width > full.rms * 0.15, 'Stereo contains different musical information, not a duplicated mono pulse.');
      assert.ok(full.highFrequencyRatio < 0.03, 'Rounded keys and pads avoid a piercing high-frequency rhythm.');
      const opening = measure(bytes, 0, RATE / 10);
      const ending = measure(bytes, info.frames - RATE / 10, info.frames);
      assert.ok(opening.rms < full.rms / 20);
      assert.ok(ending.rms < full.rms / 20);
      assert.equal(bytes.readInt16LE(44), 0);
      assert.equal(bytes.readInt16LE(bytes.length - 2), 0);
      assert.ok(measure(bytes, RATE * 5, RATE * 6).rms > 0.015);
      assert.ok(measure(bytes, RATE * 11, RATE * 12).rms > 0.015, 'The score continues through the middle of a film.');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('scores are reproducible and demo/promo have separate arrangements', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-brand-repeat-'));
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  try {
    const first = await writeBrandMusic(path.join(directory, 'first.wav'), 5.17, 'demo');
    const again = await writeBrandMusic(path.join(directory, 'again.wav'), 5.17, 'demo');
    const promo = await writeBrandMusic(path.join(directory, 'promo.wav'), 5.17, 'promo');
    assert.equal(hash(await readFile(first.file)), hash(await readFile(again.file)));
    assert.notEqual(hash(await readFile(first.file)), hash(await readFile(promo.file)));
    assert.ok(promo.bpm > first.bpm, 'Promo moves gently forward while the walkthrough is calmer.');
    assert.equal(first.frames, Math.round(5.17 * RATE));
    assert.ok((await readdir(directory)).every(name => name.endsWith('.wav')), 'Scratch files are removed after publication.');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('invalid duration and cancellation preserve the prior track and clean temporary audio', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-brand-cancel-'));
  const file = path.join(directory, 'previous.wav');
  try {
    await writeFile(file, 'previous published audio');
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 180.01]) {
      await assert.rejects(writeBrandMusic(file, duration, 'demo'), /duration/);
    }
    const controller = new AbortController();
    const rendering = writeBrandMusic(file, 180, 'promo', { signal: controller.signal });
    setImmediate(() => controller.abort());
    await assert.rejects(rendering, /cancelled/);
    assert.equal(await readFile(file, 'utf8'), 'previous published audio');
    assert.deepEqual(await readdir(directory), ['previous.wav']);
    const alreadyAborted = new AbortController(); alreadyAborted.abort();
    await assert.rejects(writeBrandMusic(file, 2, 'demo', { signal: alreadyAborted.signal }), /cancelled/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
