import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { detectOrangeCursor, extractRecordedCursorTrack, extractRenderedCursorFrames } from '../server/cursor-detection.js';

test('legacy cursor timing uses decoded presentation timestamps rather than resampling-bin starts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-cursor-time-'));
  try {
    const makeFrame = async (file: string, center: number) => {
      const width = 1920, height = 1080, pixels = Buffer.alloc(width * height * 3, 244);
      for (let y = 389; y <= 411; y += 1) for (let x = center - 11; x <= center + 11; x += 1) {
        const distance = Math.hypot(x - center, y - 400);
        if (distance >= 9 && distance <= 11) pixels.set([251, 107, 56], (y * width + x) * 3);
      }
      await writeFile(path.join(directory, file), Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
    };
    await makeFrame('before.ppm', 200); await makeFrame('after.ppm', 1000);
    await writeFile(path.join(directory, 'frames.txt'), "file 'before.ppm'\nduration 0.28\nfile 'after.ppm'\nduration 0.72\nfile 'after.ppm'\n");
    const source = path.join(directory, 'source.mp4');
    const encoded = spawnSync(process.env.FFMPEG_PATH || ffmpeg || 'ffmpeg', ['-v', 'error', '-f', 'concat', '-safe', '1', '-i', path.join(directory, 'frames.txt'), '-r', '25', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-y', source]);
    assert.equal(encoded.status, 0, encoded.stderr.toString());
    const start = 0.02;
    const track = await extractRecordedCursorTrack(source, [{ start, end: 1 }]);
    assert.ok(track.length >= 3, `Detected track: ${JSON.stringify(track)}`);
    assert.ok(Math.abs(track[0].at - start) < 1e-7, 'Match the render reset to the first decoded frame after a fractional input seek.');
    const raw = spawnSync(process.env.FFMPEG_PATH || ffmpeg || 'ffmpeg', ['-v', 'error', '-ss', String(start), '-i', source, '-vf', 'scale=960:540:flags=bilinear', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 50 * 1024 * 1024 });
    assert.equal(raw.status, 0, raw.stderr.toString());
    const bytes = 960 * 540 * 3;
    for (const point of track) {
      const frame = Math.round((point.at - start) * 25);
      const observed = detectOrangeCursor(raw.stdout.subarray(frame * bytes, (frame + 1) * bytes), 960, 540);
      assert.ok(observed, `Missing decoded cursor at frame ${frame}`);
      assert.ok(Math.abs(observed.x - point.x) < 0.003, `Tracked pointer leads or trails the decoded source at ${point.at}: ${point.x} vs ${observed.x}`);
    }
    assert.ok(track.some(point => point.x > 0.4));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('legacy pointer follows every displayed 30fps frame of fast 25fps footage after fractional seek, retiming and hold', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-cursor-render-'));
  try {
    const width = 960, height = 540, bytes = width * height * 3;
    const frames = Array.from({ length: 25 }, (_, index) => {
      const pixels = Buffer.alloc(bytes, 244), cx = 70 + (index % 10) * 85, cy = 150 + (index % 3) * 55;
      for (let y = cy - 6; y <= cy + 6; y += 1) for (let x = cx - 6; x <= cx + 6; x += 1) {
        const radius = Math.hypot(x - cx, y - cy);
        if (radius >= 4 && radius <= 6) pixels.set([251, 107, 56], (y * width + x) * 3);
      }
      return pixels;
    });
    const source = path.join(directory, 'fast-25fps.mp4');
    const encoded = spawnSync(process.env.FFMPEG_PATH || ffmpeg || 'ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-framerate', '25', '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', '-y', source], { input: Buffer.concat(frames), maxBuffer: 1024 * 1024 });
    assert.equal(encoded.status, 0, encoded.stderr.toString());
    const fps = 30;
    const clips = [
      { start: 0.02, sourceDuration: 0.73, playbackRate: 1, frames: 36 },
      { start: 0.06, sourceDuration: 0.672, playbackRate: 1.12, frames: 18 },
    ];
    const sampled = await extractRenderedCursorFrames(source, clips, fps);
    for (const [index, clip] of clips.entries()) {
      const duration = clip.frames / fps;
      // Independently decode the exact display schedule and measure the orange ring's
      // pixel centroid, rather than consulting the track/interpolation implementation.
      const raw = spawnSync(process.env.FFMPEG_PATH || ffmpeg || 'ffmpeg', ['-v', 'error', '-ss', String(clip.start), '-t', String(clip.sourceDuration), '-i', source, '-vf', `setpts=(PTS-STARTPTS)/${clip.playbackRate.toFixed(8)},fps=${fps},tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration}`, '-frames:v', String(clip.frames), '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: bytes * (clip.frames + 1) });
      assert.equal(raw.status, 0, raw.stderr.toString());
      assert.equal(raw.stdout.length, bytes * clip.frames);
      assert.equal(sampled[index].length, clip.frames);
      const positions: number[] = [];
      for (let frame = 0; frame < clip.frames; frame += 1) {
        const pixels = raw.stdout.subarray(frame * bytes, (frame + 1) * bytes);
        let sx = 0, sy = 0, count = 0;
        for (let position = 0; position < width * height; position += 1) {
          const r = pixels[position * 3], g = pixels[position * 3 + 1], b = pixels[position * 3 + 2];
          if (r > 180 && g > 55 && g < 160 && b < 115 && r - g > 70) { sx += position % width; sy += Math.floor(position / width); count += 1; }
        }
        assert.ok(count > 12, `No orange ring in output frame ${frame}.`);
        const point = sampled[index][frame];
        assert.ok(point, `No pointer for displayed output frame ${frame}.`);
        assert.equal(point.kind, 'move', 'Legacy analysis must never invent a click.');
        assert.ok(Math.hypot(point.x * width - sx / count, point.y * height - sy / count) < 2.5, `Pointer detached from rendered frame ${frame} at playback rate ${clip.playbackRate}: sampled ${point.x * width},${point.y * height}; observed ${sx / count},${sy / count}.`);
        positions.push(point.x);
      }
      assert.ok(positions.some((x, i) => i > 0 && Math.abs(x - positions[i - 1]) > 0.07), 'Fixture must include fast travel.');
      if (clip.playbackRate === 1) assert.equal(positions.at(-1), positions.at(-5), 'The held footage must retain its actual last pointer.');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
