import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { privacyFilters } from '../server/demo-privacy.js';
import { cameraFilter, cameraForFrame, demoLayout, projectCursor } from '../server/demo-motion.js';

test('privacy masks accept valid full-frame bounds and fail closed on invalid geometry', () => {
  assert.equal(privacyFilters(), '');
  assert.ok(privacyFilters([{ x: 0, y: 0, width: 1, height: 1 }]).includes('color=0xe3e6eb:t=fill'));
  for (const rectangle of [
    { x: -0.1, y: 0, width: 0.5, height: 0.5 },
    { x: 0.8, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0, width: 0, height: 0.5 },
    { x: 0, y: NaN, width: 0.5, height: 0.5 },
  ]) assert.throws(() => privacyFilters([rectangle]), /privacy mask/);
});

test('opaque source masks survive camera zoom and pan on every rendered frame', () => {
  const layout = demoLayout(320, 180);
  const keys = [{ frame: 0, x: 0.45, y: 0.45, zoom: 1.1 }, { frame: 11, x: 0.56, y: 0.54, zoom: 1.8 }];
  const filter = `${privacyFilters([{ x: 0.35, y: 0.3, width: 0.3, height: 0.4 }])},${cameraFilter(keys, layout, 12)}`;
  const result = spawnSync(process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=12:duration=1', '-vf', filter, '-frames:v', '12', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  const bytesPerFrame = layout.width * layout.height * 3;
  assert.equal(result.stdout.length, bytesPerFrame * 12);
  for (let frame = 0; frame < 12; frame += 1) {
    const point = projectCursor({ x: 0.5, y: 0.5 }, cameraForFrame(keys, frame), layout);
    assert.equal(point.visible, true);
    const x = Math.round(point.x - layout.x), y = Math.round(point.y - layout.y);
    const at = frame * bytesPerFrame + (y * layout.width + x) * 3;
    const pixel = [...result.stdout.subarray(at, at + 3)];
    assert.ok(pixel.every((channel, index) => Math.abs(channel - [227, 230, 235][index]) <= 3), `Mask exposed source pixels in frame ${frame}: ${pixel}`);
  }
});
