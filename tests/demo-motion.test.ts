import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { attentionBounds, cameraAt, cameraFilter, cameraForFrame, cameraKeys, cameraProjection, cameraTiming, clipTiming, demoLayout, ease, projectCursor, sourceTime, transitionFilter } from '../server/demo-motion.js';
import { cursorAt, detectOrangeCursor } from '../server/cursor-detection.js';
import type { FilmState } from '../server/film-state.js';

const state: FilmState = { name: 'Product', title: 'Workspace', caption: 'A recorded workflow', feature: 'Overview', url: 'example.test', scene: 0, scenes: 1, progress: 0, totalProgress: 0, time: 0, focus: { x: 0.6, y: 0.4, zoom: 1.65 } };

test('camera starts with the entire source and preserves aspect within the canvas', () => {
  const layout = demoLayout(1920, 1080);
  assert.ok(layout.width / 1920 > 0.93);
  for (const x of [0, 1]) for (const y of [0, 1]) assert.equal(projectCursor({ x, y }, { x: 0.5, y: 0.5, zoom: 1 }, layout).visible, true);
  for (const x of [0, 0.1, 0.5, 0.9, 1]) for (const y of [0, 0.5, 1]) for (const zoom of [1, 1.4, 2.4]) {
    const p = cameraProjection({ x, y, zoom }, layout);
    assert.ok(p.x >= -1e-8 && p.y >= -1e-8);
    assert.ok(p.x + 1 / p.zoom <= 1 + 1e-8);
    assert.ok(p.y + 1 / p.zoom <= 1 + 1e-8);
    // Original x/y dimensions project at the same scale: no anisotropic stretch.
    assert.ok(Math.abs(p.sourceWidth * layout.width / (p.sourceHeight * layout.height) - 16 / 9) < 1e-8);
  }
});

test('zoom is visibly dynamic while subtle motion remains bounded', () => {
  const start = cameraAt(state);
  const middle = cameraAt({ ...state, progress: 0.6 });
  assert.ok(middle.zoom - start.zoom > 0.3);
  assert.ok(cameraAt({ ...state, motion: 'subtle', progress: 0.6 }).zoom <= 1.47);
  assert.equal(cameraAt({ ...state, progress: 1, focus: { x: -5, y: 4, zoom: 99 } }).x, 0);
});

test('camera holds a settled closeup without a repeated six-second release', () => {
  const layout = demoLayout(1920, 1080);
  const keys = cameraKeys(state, 181, layout);
  assert.deepEqual(cameraForFrame(keys, 0), { x: 0.5, y: 0.5, zoom: 1 });
  assert.ok(cameraForFrame(keys, 180).zoom > 1.5);
  assert.deepEqual(cameraForFrame(keys, 150), cameraForFrame(keys, 180));
  assert.deepEqual(cameraForFrame(keys, 100), cameraForFrame(keys, 130));
  assert.deepEqual(cameraAt({ ...state, progress: 0.6, cursor: { x: 0, y: 0 } }), cameraAt({ ...state, progress: 0.6, cursor: { x: 1, y: 1 } }));
  const zooms = Array.from({ length: 181 }, (_, i) => cameraForFrame(keys, i).zoom);
  assert.ok(zooms.slice(0, 79).every((z, i, values) => i === 0 || z >= values[i - 1]));
  assert.ok(zooms.every((z, i, values) => i === 0 || z >= values[i - 1]));
});

test('whole feature regions and real cursor evidence remain in frame during a push', () => {
  const layout = demoLayout(1920, 1080);
  for (const area of [{ x: 0.15, y: 0.08, width: 0.8, height: 0.16 }, { x: 0.2, y: 0.08, width: 0.6, height: 0.83 }]) {
    const cursors = [{ x: 0.02, y: 0.4 }, { x: 0.92, y: 0.2 }];
    const bounds = attentionBounds(area, cursors);
    const keys = cameraKeys({ ...state, focusArea: area }, 181, layout, bounds);
    for (let frame = 0; frame < 181; frame += 1) {
      const camera = cameraForFrame(keys, frame);
      for (const point of [...cursors, { x: area.x, y: area.y }, { x: area.x + area.width, y: area.y + area.height }]) assert.equal(projectCursor(point, camera, layout).visible, true, `Lost a feature or cursor in frame ${frame}`);
    }
  }
});

test('short clips play at normal speed then hold; long clips never exceed 1.12x', () => {
  const short = clipTiming(6.5, 8.8, 6);
  assert.equal(short.playbackRate, 1);
  assert.equal(sourceTime(short, 5), 8.8);
  const long = clipTiming(10, 25, 6);
  assert.ok(long.playbackRate <= 1.12);
  assert.ok(Math.abs(sourceTime(long, 6) - (10 + 6 * 1.12)) < 1e-9);
});

test('detail framing waits for the observed incoming view and permits stronger small-control closeups', () => {
  const layout = demoLayout(1920, 1080);
  const detail = { ...state, duration: 7, focusRevealAt: 2.4, focus: { x: 0.8, y: 0.15, zoom: 2.15 }, focusArea: { x: 0.72, y: 0.10, width: 0.16, height: 0.10 } };
  const keys = cameraKeys(detail, 210, layout);
  for (let frame = 0; frame <= 72; frame += 1) assert.deepEqual(cameraForFrame(keys, frame), { x: 0.5, y: 0.5, zoom: 1 });
  assert.ok(cameraForFrame(keys, 180).zoom > 2.1);
  const late = cameraKeys({ ...detail, focusRevealAt: 6.8 }, 210, layout);
  assert.equal(cameraForFrame(late, 209).zoom, 1, 'Do not rush a closeup when the view has barely settled.');
});

test('camera interpolation and projected pointer are continuous and correctly registered', () => {
  const keys = [{ frame: 0, x: 0.25, y: 0.3, zoom: 1.1 }, { frame: 60, x: 0.7, y: 0.5, zoom: 1.8 }];
  const center = cameraForFrame(keys, 30);
  assert.ok(Math.abs(center.x - 0.475) < 1e-9);
  const layout = demoLayout(1280, 720);
  const pointer = projectCursor({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5, zoom: 1.5 }, layout);
  assert.equal(pointer.visible, true);
  assert.ok(Math.abs(pointer.x - (layout.x + layout.width / 2)) < 1e-7);
  assert.ok(Math.abs(pointer.y - (layout.y + layout.height / 2)) < 1e-7);
});

test('edge detail pushes interpolate the complete affine transform without a clamp kink', () => {
  const layout = demoLayout(1920, 1080);
  const shot = { ...state, duration: 10, focus: { x: 0.89, y: 0.12, zoom: 2.1 }, focusArea: { x: 0.78, y: 0.04, width: 0.21, height: 0.16 }, camera: { contextHold: 1, moveDuration: 3, releaseDuration: 2 } };
  const keys = cameraKeys(shot, 301, layout);
  const point = { x: 0.87, y: 0.12 };
  const start = projectCursor(point, cameraForFrame(keys, 30), layout);
  const end = projectCursor(point, cameraForFrame(keys, 120), layout);
  for (let frame = 30; frame <= 120; frame++) {
    const progress = ease((frame - 30) / 90);
    const camera = cameraForFrame(keys, frame);
    const actual = projectCursor(point, camera, layout);
    assert.ok(Math.abs(actual.x - (start.x + (end.x - start.x) * progress)) < 1e-6, `Horizontal pan changed velocity at frame ${frame}`);
    assert.ok(Math.abs(actual.y - (start.y + (end.y - start.y) * progress)) < 1e-6, `Vertical pan changed velocity at frame ${frame}`);
    const projection = cameraProjection(camera, layout);
    assert.ok(projection.x >= 0 && projection.y >= 0);
    assert.ok(projection.x + 1 / projection.zoom <= 1 + 1e-8 && projection.y + 1 / projection.zoom <= 1 + 1e-8);
  }
  const moving = projectCursor(point, cameraForFrame(keys, 31), layout);
  assert.ok(Math.hypot(moving.x - start.x, moving.y - start.y) < 0.02, 'The move must depart from rest.');
  const landing = projectCursor(point, cameraForFrame(keys, 119), layout);
  assert.ok(Math.hypot(landing.x - end.x, landing.y - end.y) < 0.02, 'The move must arrive at rest.');
  assert.ok(cameraTiming({ ...shot, camera: undefined }).move > 2.5, 'Automatic strong pushes need a readable movement duration.');
});

test('outgoing page dissolves begin after the camera has landed in context', () => {
  const shot = { ...state, scene: 0, scenes: 2, duration: 9, focus: { x: 0.8, y: 0.15, zoom: 2 }, camera: { contextHold: 1, moveDuration: 2.5, releaseDuration: 2 }, transition: { type: 'dissolve' as const, duration: 0.8 }, externalTransitions: true };
  const timing = cameraTiming(shot);
  assert.equal(timing.releaseEnd, 8.4);
  assert.equal(timing.releaseStart, 6.4);
  const keys = cameraKeys(shot, 271, demoLayout(1920, 1080));
  for (let frame = 252; frame <= 270; frame++) assert.deepEqual(cameraForFrame(keys, frame), { x: 0.5, y: 0.5, zoom: 1 });
  assert.equal(cameraTiming({ ...shot, transition: { type: 'cut', duration: 0 } }).exitHold, 0, 'An explicit cut retains its reviewed camera end.');
  assert.equal(cameraTiming({ ...shot, camera: { ...shot.camera, releaseDuration: 0 } }).exitHold, 0, 'A held detail does not acquire an unrequested pullback.');
});

test('actual affine camera pixels stay registered with the projected pointer on every frame', { skip: !ffmpeg }, () => {
  const layout = demoLayout(640, 360), fps = 30, frames = 121;
  const shot = { ...state, duration: 4, focus: { x: 0.89, y: 0.12, zoom: 2.1 }, focusArea: { x: 0.78, y: 0.04, width: 0.21, height: 0.16 }, camera: { contextHold: 0.3, moveDuration: 2.4, releaseDuration: 0.8 } };
  const keys = cameraKeys(shot, frames, layout);
  const result = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=960x540:r=30,drawbox=x=830:y=62:w=9:h=9:color=red:t=fill', '-vf', cameraFilter(keys, layout, fps), '-frames:v', String(frames), '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 100 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  const stride = layout.width * layout.height * 3;
  assert.equal(result.stdout.length, stride * frames);
  for (let frame = 0; frame < frames; frame++) {
    let sumX = 0, sumY = 0, pixels = 0;
    for (let y = 0; y < layout.height; y++) for (let x = 0; x < layout.width; x++) {
      const offset = frame * stride + (y * layout.width + x) * 3;
      if (result.stdout[offset] > 180 && result.stdout[offset + 1] < 50 && result.stdout[offset + 2] < 50) { sumX += x; sumY += y; pixels++; }
    }
    assert.ok(pixels > 5, `Marker disappeared in frame ${frame}`);
    const point = projectCursor({ x: 834.5 / 960, y: 66.5 / 540 }, cameraForFrame(keys, frame), layout);
    assert.ok(Math.abs(sumX / pixels - (point.x - layout.x)) < 2 && Math.abs(sumY / pixels - (point.y - layout.y)) < 2, `Pointer and transformed pixels diverged in frame ${frame}`);
  }
});

test('dissolve opacity eases at both ends while keeping exact centered frames', { skip: !ffmpeg }, () => {
  const scenes = [{ frames: 90, transition: { type: 'dissolve' as const, duration: 0.8 } }, { frames: 90 }];
  const { filters, label } = transitionFilter(scenes, 30);
  const result = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-filter_complex_threads', '1', '-f', 'lavfi', '-i', 'color=red:s=32x18:r=30:d=3', '-f', 'lavfi', '-i', 'color=blue:s=32x18:r=30:d=3', '-filter_complex', filters.join(';'), '-map', `[${label}]`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  const stride = 32 * 18 * 3;
  assert.equal(result.stdout.length, stride * 180);
  const color = (frame: number) => [...result.stdout.subarray(frame * stride, frame * stride + 3)];
  assert.ok(color(81)[0] > 245 && color(81)[2] < 10, 'The dissolve should depart gently from the outgoing page.');
  assert.ok(color(90)[0] > 115 && color(90)[0] < 140 && color(90)[2] > 115 && color(90)[2] < 140, 'The scene boundary remains the midpoint.');
  assert.ok(color(99)[0] < 10 && color(99)[2] > 245, 'The dissolve should arrive gently at the incoming page.');
});

function cursorFrame(filled: boolean): Uint8Array {
  const width = 960, height = 540;
  const pixels = new Uint8Array(width * height * 3).fill(244);
  for (let y = 150; y <= 170; y += 1) for (let x = 270; x <= 290; x += 1) {
    const radius = Math.hypot(x - 280, y - 160);
    if (filled ? radius < 6 : radius > 4 && radius < 6) pixels.set([251, 107, 56], (y * width + x) * 3);
  }
  return pixels;
}

test('recorded cursor detector identifies an orange ring and rejects filled orange UI', () => {
  const point = detectOrangeCursor(cursorFrame(false), 960, 540);
  assert.ok(point);
  assert.ok(Math.abs(point.x - 280 / 960) < 0.003);
  assert.ok(Math.abs(point.y - 160 / 540) < 0.003);
  assert.equal(detectOrangeCursor(cursorFrame(true), 960, 540), undefined);
});

test('cursor interpolation does not invent clicks or bridge missing footage evidence', () => {
  const moves = [{ at: 1, x: 0.2, y: 0.3, kind: 'move' as const }, { at: 1.2, x: 0.6, y: 0.7, kind: 'move' as const }];
  const middle = cursorAt(moves, 1.1)!;
  assert.ok(Math.abs(middle.x - 0.4) < 1e-8);
  assert.equal(middle.click, false);
  assert.equal(cursorAt(moves, 2), undefined);
  assert.equal(cursorAt([{ at: 1, x: 0.2, y: 0.3, kind: 'click' }], 1.05)?.click, true);
  assert.equal(cursorAt([{ at: 1, x: 0.2, y: 0.3, kind: 'click' }], 1.2)?.click, false);
});
