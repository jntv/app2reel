import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

export type BrandMusicKind = 'demo' | 'promo';
export interface BrandMusicInfo {
  file: string;
  duration: number;
  frames: number;
  sampleRate: 48000;
  channels: 2;
  bitsPerSample: 16;
  bpm: number;
  /** Linear full-scale measurements of the written stereo PCM. */
  rms: number;
  peak: number;
}

const RATE = 48000;
const CHUNK = 8192;
const TAU = 2 * Math.PI;
type Instrument = 'keys' | 'pad' | 'bass' | 'pluck';
interface Note {
  start: number; end: number; attack: number; release: number; decay: number;
  frequency: number; amplitude: number; pan: number; phase: number; instrument: Instrument;
}
interface Voice extends Note {
  sine: number; cosine: number; stepSine: number; stepCosine: number;
  left: number; right: number; decayLevel: number; decayStep: number;
}

// An original D-major progression, with close upper voices and moving bass.
// Extended voicings leave space around speech; neither arrangement uses drums.
const CHORDS = [
  { bass: 38, keys: [57, 61, 64, 66] }, // Dmaj9
  { bass: 37, keys: [57, 59, 64, 69] }, // Aadd9 / C#
  { bass: 35, keys: [57, 61, 62, 66] }, // Bm9
  { bass: 31, keys: [54, 57, 59, 62] }, // Gmaj9
  { bass: 30, keys: [57, 62, 64, 69] }, // Dadd9 / F#
  { bass: 40, keys: [55, 59, 62, 66] }, // Em9
  { bass: 31, keys: [54, 57, 59, 62] }, // Gmaj9
  { bass: 33, keys: [57, 59, 64, 69] }, // Asus2
];

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Video rendering cancelled.');
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function score(duration: number, kind: BrandMusicKind): { notes: Note[]; bpm: number } {
  const bpm = kind === 'demo' ? 84 : 96;
  const beat = 60 / bpm;
  const phrase = beat * 8;
  const rand = random(kind === 'demo' ? 0x42616c6d : 0x466c6f77);
  const notes: Note[] = [];
  const outro = Math.max(duration * 0.55, duration - 3.3);
  const add = (at: number, midi: number, length: number, amplitude: number, pan: number, instrument: Instrument, detune = 0) => {
    if (at >= duration) return;
    const attack = instrument === 'pad' ? 0.9 : instrument === 'bass' ? 0.13 : instrument === 'keys' ? 0.014 : 0.024;
    const release = instrument === 'pad' ? 1.15 : instrument === 'bass' ? 0.48 : 0.22;
    const decay = instrument === 'pad' ? 0 : instrument === 'bass' ? 0.12 : instrument === 'keys' ? 0.62 : 1.65;
    notes.push({ start: Math.round(Math.max(0, at) * RATE), end: Math.min(Math.round((at + length) * RATE), Math.round(duration * RATE)),
      attack: attack * RATE, release: release * RATE, decay,
      frequency: 440 * 2 ** ((midi - 69 + detune / 100) / 12), amplitude, pan,
      phase: instrument === 'pad' ? rand() * TAU : 0, instrument });
  };
  for (let section = 0; section * phrase < outro; section += 1) {
    const at = section * phrase;
    const chord = CHORDS[section % CHORDS.length];
    const length = Math.min(phrase + 0.9, outro - at + 0.7);
    // Independently detuned, spread pad voices give width without a phase trick.
    chord.keys.forEach((midi, index) => {
      const pan = -0.62 + index * 0.41;
      add(at, midi, length, 0.032, pan, 'pad', index % 2 ? 2.6 : -2.9);
      add(at + 0.018, midi, length, 0.018, -pan, 'pad', index % 2 ? -3.1 : 2.3);
    });
    add(at + 0.035, chord.bass, Math.min(phrase - 0.15, length), 0.14, 0, 'bass');
    // Human-spaced chord attacks; the second inversion is quieter and higher.
    chord.keys.forEach((midi, index) => add(at + 0.08 + index * 0.018 + rand() * 0.009, midi,
      Math.min(3.8, length), 0.11 - index * 0.009, -0.28 + index * 0.18, 'keys'));
    if (at + beat * 4.5 < outro) chord.keys.forEach((midi, index) => add(at + beat * 4.5 + index * 0.021,
      midi + (index === 0 ? 12 : 0), Math.min(2.5, outro - at - beat * 4.5 + 0.5), 0.048, 0.3 - index * 0.18, 'keys'));
    const pattern = kind === 'demo' ? [1.5, 4.75, 6.5] : [0.75, 2.5, 3.75, 5.5, 6.75];
    pattern.forEach((offset, index) => {
      const when = at + beat * offset;
      if (when >= outro - 0.2 || (kind === 'demo' && section % 3 === 1 && index === 1)) return;
      const pitch = chord.keys[(index + section) % chord.keys.length] + (index % 3 === 0 ? 12 : 0);
      add(when + (rand() - 0.5) * 0.018, pitch, 1.7, kind === 'demo' ? 0.045 : 0.059,
        index % 2 ? 0.38 : -0.38, 'pluck');
    });
  }
  // Resolve into a soft tonic rather than cutting a loop halfway through a chord.
  CHORDS[0].keys.forEach((midi, index) => {
    add(outro + index * 0.055, midi, duration - outro, 0.07, -0.3 + index * 0.2, 'keys');
    add(outro, midi, duration - outro, 0.025, 0.45 - index * 0.3, 'pad', index % 2 ? 2 : -2);
  });
  add(outro, CHORDS[0].bass, duration - outro, 0.1, 0, 'bass');
  return { notes: notes.sort((a, b) => a.start - b.start), bpm };
}

function voice(note: Note): Voice {
  const step = TAU * note.frequency / RATE;
  const pan = (note.pan + 1) * Math.PI / 4;
  return { ...note, sine: Math.sin(note.phase), cosine: Math.cos(note.phase), stepSine: Math.sin(step), stepCosine: Math.cos(step),
    left: Math.cos(pan), right: Math.sin(pan), decayLevel: 1, decayStep: Math.exp(-note.decay / RATE) };
}

function smooth(value: number): number {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

function sample(note: Voice, frame: number): number {
  const age = frame - note.start;
  const envelope = smooth(age / note.attack) * smooth((note.end - frame - 1) / note.release) * note.decayLevel;
  const sine2 = 2 * note.sine * note.cosine;
  const sine3 = 3 * note.sine - 4 * note.sine ** 3;
  let tone: number;
  if (note.instrument === 'pad') tone = note.sine + 0.10 * sine2 + 0.035 * sine3;
  else if (note.instrument === 'bass') tone = note.sine + 0.16 * sine2;
  else if (note.instrument === 'keys') tone = note.sine + 0.25 * note.decayLevel * sine2 + 0.075 * note.decayLevel ** 2 * sine3;
  else tone = note.sine + 0.20 * sine2 + 0.055 * sine3;
  const sine = note.sine * note.stepCosine + note.cosine * note.stepSine;
  note.cosine = note.cosine * note.stepCosine - note.sine * note.stepSine;
  note.sine = sine;
  note.decayLevel *= note.decayStep;
  return tone * envelope * note.amplitude;
}

async function writeAll(file: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset);
    if (!bytesWritten) throw new Error('Could not write the local music track.');
    offset += bytesWritten;
  }
}

function wavHeader(frames: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + frames * 4, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 4, 28); header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(frames * 4, 40);
  return header;
}

/**
 * Compose an original, deterministic instrumental bed entirely offline.
 *
 * This is music-level PCM (target RMS 0.095 demo / 0.105 promo, peak <= 0.72),
 * not a finished mix. Mix at low gain and duck beneath narration. The changing
 * eight-chord score uses warm keys/pad/bass and sparse plucks, with no drums or
 * sampled material. Stereo early reflections are deliberately short and quiet.
 *
 * Audio is streamed through an adjacent temporary float file, then normalized
 * into PCM16 and atomically published. Memory stays bounded for 180-second films.
 * Cancellation/errors remove temporary files and preserve any existing output.
 */
export async function writeBrandMusic(file: string, duration: number, kind: BrandMusicKind,
  options: { signal?: AbortSignal } = {}): Promise<BrandMusicInfo> {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 180) throw new Error('Brand music duration must be greater than zero and at most 180 seconds.');
  if (kind !== 'demo' && kind !== 'promo') throw new Error('Unknown brand music arrangement.');
  const frames = Math.round(duration * RATE);
  if (frames < 2) throw new Error('Brand music duration is too short.');
  cancelled(options.signal);
  await mkdir(path.dirname(file), { recursive: true });
  const token = randomUUID();
  const scratch = path.join(path.dirname(file), `.brand-music-${token}.f32`);
  const output = path.join(path.dirname(file), `.brand-music-${token}.wav`);
  const { notes, bpm } = score(frames / RATE, kind);
  const active: Voice[] = [];
  const echoLeft = new Float64Array(5471);
  const echoRight = new Float64Array(7907);
  let echoL = 0, echoR = 0, dampL = 0, dampR = 0, next = 0, sum = 0, peak = 0;
  let float: FileHandle | undefined;
  let wav: FileHandle | undefined;
  let input: FileHandle | undefined;
  try {
    float = await open(scratch, 'wx');
    for (let first = 0; first < frames; first += CHUNK) {
      cancelled(options.signal);
      const count = Math.min(CHUNK, frames - first);
      const bytes = Buffer.allocUnsafe(count * 8);
      for (let local = 0; local < count; local += 1) {
        const frame = first + local;
        while (next < notes.length && notes[next].start <= frame) active.push(voice(notes[next++]));
        let left = 0, right = 0;
        for (let index = active.length - 1; index >= 0; index -= 1) {
          const note = active[index];
          if (note.end <= frame) { active.splice(index, 1); continue; }
          const value = sample(note, frame);
          left += value * note.left; right += value * note.right;
        }
        const wetL = echoLeft[echoL], wetR = echoRight[echoR];
        dampL += 0.23 * (wetL - dampL); dampR += 0.23 * (wetR - dampR);
        echoLeft[echoL] = left + dampR * 0.29;
        echoRight[echoR] = right + dampL * 0.31;
        echoL = (echoL + 1) % echoLeft.length; echoR = (echoR + 1) % echoRight.length;
        const fade = smooth(frame / Math.min(RATE * 1.2, frames * 0.22)) * smooth((frames - frame - 1) / Math.min(RATE * 2.1, frames * 0.26));
        left = (left + wetL * 0.15 + wetR * 0.045) * fade;
        right = (right + wetR * 0.15 + wetL * 0.045) * fade;
        bytes.writeFloatLE(left, local * 8); bytes.writeFloatLE(right, local * 8 + 4);
        sum += left * left + right * right; peak = Math.max(peak, Math.abs(left), Math.abs(right));
      }
      await writeAll(float, bytes);
    }
    await float.close(); float = undefined;
    const rms = Math.sqrt(sum / (frames * 2));
    const gain = Math.min((kind === 'demo' ? 0.095 : 0.105) / Math.max(rms, 1e-12), 0.72 / Math.max(peak, 1e-12));
    input = await open(scratch, 'r'); wav = await open(output, 'wx');
    await writeAll(wav, wavHeader(frames));
    let writtenSum = 0, writtenPeak = 0;
    for (let first = 0; first < frames; first += CHUNK) {
      cancelled(options.signal);
      const count = Math.min(CHUNK, frames - first);
      const raw = Buffer.allocUnsafe(count * 8), pcm = Buffer.allocUnsafe(count * 4);
      let offset = 0;
      while (offset < raw.length) {
        const { bytesRead } = await input.read(raw, offset, raw.length - offset, first * 8 + offset);
        if (!bytesRead) throw new Error('Local music scratch audio is incomplete.');
        offset += bytesRead;
      }
      for (let index = 0; index < count * 2; index += 1) {
        const value = Math.max(-32767, Math.min(32767, Math.round(raw.readFloatLE(index * 4) * gain * 32767)));
        pcm.writeInt16LE(value, index * 2);
        writtenSum += (value / 32768) ** 2; writtenPeak = Math.max(writtenPeak, Math.abs(value / 32768));
      }
      await writeAll(wav, pcm);
    }
    await input.close(); input = undefined; await wav.close(); wav = undefined;
    cancelled(options.signal);
    await rename(output, file);
    return { file, duration: frames / RATE, frames, sampleRate: RATE, channels: 2, bitsPerSample: 16, bpm,
      rms: Math.sqrt(writtenSum / (frames * 2)), peak: writtenPeak };
  } finally {
    await Promise.allSettled([float?.close(), input?.close(), wav?.close()]);
    await Promise.allSettled([rm(scratch, { force: true }), rm(output, { force: true })]);
  }
}
