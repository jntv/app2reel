import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

export interface CursorPoint { at: number; x: number; y: number; kind: 'move' | 'click' | 'type' }
interface DetectedPoint { x: number; y: number; confidence: number }

const orange = (pixels: Uint8Array, position: number): boolean => {
  const r = pixels[position * 3], g = pixels[position * 3 + 1], b = pixels[position * 3 + 2];
  return r > 108 && g >= 43 && g < 180 && b < 145 && r - g > 47 && g - b > 10 && r > g * 1.4;
};

/** Recognize Capture's recorded orange ring, rather than guessing pointer positions from UI controls. */
export function detectOrangeCursor(pixels: Uint8Array, width: number, height: number, previous?: { x: number; y: number }): DetectedPoint | undefined {
  if (pixels.length !== width * height * 3 || width < 100 || height < 100) return undefined;
  const expectedRadius = width / 1920 * 10;
  const votes = new Uint16Array(width * height);
  const candidates: DetectedPoint[] = [];
  const offsets = Array.from({ length: 24 }, (_, i) => ({ x: Math.cos(i * Math.PI / 12) * expectedRadius, y: Math.sin(i * Math.PI / 12) * expectedRadius }));
  // Hough votes survive compression that breaks a one-pixel ring into separate arcs.
  for (let position = 0; position < width * height; position += 1) {
    if (!orange(pixels, position)) continue;
    const x = position % width, y = Math.floor(position / width);
    for (const offset of offsets) {
      const cx = Math.round(x - offset.x), cy = Math.round(y - offset.y);
      if (cx >= expectedRadius + 1 && cy >= expectedRadius + 1 && cx < width - expectedRadius - 1 && cy < height - expectedRadius - 1) votes[cy * width + cx] += 1;
    }
  }
  for (let position = 0; position < votes.length; position += 1) {
    if (votes[position] < 7) continue;
    const x = position % width, y = Math.floor(position / width);
    let hits = 0, interior = 0;
    for (let sample = 0; sample < 32; sample += 1) {
      const theta = sample * Math.PI / 16;
      let match = false;
      for (const offset of [-0.8, 0, 0.8]) {
        const px = Math.round(x + Math.cos(theta) * (expectedRadius + offset)); const py = Math.round(y + Math.sin(theta) * (expectedRadius + offset));
        if (orange(pixels, py * width + px)) match = true;
      }
      if (match) hits += 1;
    }
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (orange(pixels, (y + dy) * width + x + dx)) interior += 1;
    const confidence = hits / 32 - interior / 18;
    if (confidence >= 0.53) candidates.push({ x: x / width, y: y / height, confidence });
  }
  candidates.sort((a, b) => {
    const score = (p: DetectedPoint) => p.confidence - (previous ? Math.min(0.12, Math.hypot(p.x - previous.x, p.y - previous.y) * 0.15) : 0);
    return score(b) - score(a);
  });
  return candidates[0];
}

/** Streaming local-media analysis; bounded to reviewed clip windows. It emits moves only. */
export async function extractRecordedCursorTrack(recording: string, intervals: { start: number; end: number }[], signal?: AbortSignal): Promise<CursorPoint[]> {
  const width = 960, height = 540, fps = 5, bytes = width * height * 3;
  const points: CursorPoint[] = [];
  const windows = intervals.filter(i => Number.isFinite(i.start) && Number.isFinite(i.end) && i.start >= 0 && i.end > i.start).slice(0, 20);
  for (const interval of windows) {
    if (signal?.aborted) throw new Error('Video rendering cancelled.');
    const duration = Math.min(90, interval.end - interval.start);
    const child = spawn(process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', String(interval.start), '-t', String(duration), '-i', recording, '-vf', `fps=${fps},scale=${width}:${height}:flags=bilinear`, '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '';
    child.stderr.on('data', (data: Buffer) => { error = (error + data.toString()).slice(-2000); });
    const stop = () => { child.kill('SIGTERM'); };
    signal?.addEventListener('abort', stop, { once: true });
    const done = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(signal?.aborted ? 'Video rendering cancelled.' : `Recorded cursor analysis failed: ${error || code}`)));
    });
    void done.catch(() => {});
    let pending = Buffer.alloc(0), frame = 0;
    let previous: DetectedPoint | undefined;
    try {
      for await (const data of child.stdout) {
        if (signal?.aborted) throw new Error('Video rendering cancelled.');
        pending = Buffer.concat([pending, data as Buffer]);
        while (pending.length >= bytes) {
          const found = detectOrangeCursor(pending.subarray(0, bytes), width, height, previous);
          if (found) { points.push({ at: interval.start + frame / fps, x: found.x, y: found.y, kind: 'move' }); previous = found; }
          frame += 1; pending = pending.subarray(bytes);
        }
      }
      await done;
    } catch (error) {
      stop(); await done.catch(() => {}); throw error;
    } finally { signal?.removeEventListener('abort', stop); }
  }
  return points.sort((a, b) => a.at - b.at);
}

/** Do not bridge missing detections: a stale ring must not float over another product location. */
export function cursorAt(track: CursorPoint[], at: number, maxStaleness = 0.55): { x: number; y: number; click?: boolean } | undefined {
  let position = -1;
  for (let index = 0; index < track.length; index += 1) { if (track[index].at <= at) position = index; else break; }
  const before = track[position], after = track[position + 1], previous = track[position - 1], next = track[position + 2];
  if (!before || at - before.at > maxStaleness) return undefined;
  const t = after && after.at - before.at <= 0.55 ? Math.max(0, Math.min(1, (at - before.at) / Math.max(0.001, after.at - before.at))) : 0;
  const coordinate = (key: 'x' | 'y'): number => {
    if (!after || !t) return before[key];
    const delta = (after[key] - before[key]) / Math.max(0.001, after.at - before.at);
    const harmonic = (a: number, b: number) => a * b <= 0 ? 0 : 2 * a * b / (a + b);
    const left = previous && before.at - previous.at <= 0.55 ? harmonic((before[key] - previous[key]) / Math.max(0.001, before.at - previous.at), delta) : delta;
    const right = next && next.at - after.at <= 0.55 ? harmonic(delta, (next[key] - after[key]) / Math.max(0.001, next.at - after.at)) : delta;
    const t2 = t * t, t3 = t2 * t, span = after.at - before.at;
    const value = (2 * t3 - 3 * t2 + 1) * before[key] + (t3 - 2 * t2 + t) * left * span + (-2 * t3 + 3 * t2) * after[key] + (t3 - t2) * right * span;
    return Math.max(Math.min(before[key], after[key]), Math.min(Math.max(before[key], after[key]), value));
  };
  return { x: coordinate('x'), y: coordinate('y'), click: before.kind === 'click' && at - before.at < 0.09 };
}
