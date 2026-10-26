import type { PrivacyMask } from '../shared/types.js';
import type { FilmState } from './film-state.js';

export interface DemoCamera { x: number; y: number; zoom: number }
export interface CameraKey extends DemoCamera { frame: number }
export interface DemoLayout { x: number; y: number; width: number; height: number }
export interface ProjectedArea extends DemoLayout { visible: boolean }
export interface ClipTiming { start: number; sourceDuration: number; playbackRate: number; outputDuration: number }

export const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
/** Quintic easing has zero velocity and acceleration at both ends of a camera move. */
export const ease = (value: number): number => { const t = clamp(value); return t * t * t * (t * (t * 6 - 15) + 10); };

/** A large canvas, with an uncropped 16:9 context view and room for readable words. */
export function demoLayout(width: number, height: number): DemoLayout {
  const even = (n: number) => Math.round(n / 2) * 2;
  return { x: even(width * 0.03), y: even(height * 0.125), width: even(width * 0.94), height: even(height * 0.77) };
}

/** Play interactions close to real time; hold a short clip rather than slowing its cursor. */
export function clipTiming(start: number, end: number, outputDuration: number): ClipTiming {
  const available = Math.max(0.001, end - start);
  const sourceDuration = Math.min(available, outputDuration * 1.12);
  const playbackRate = sourceDuration > outputDuration ? sourceDuration / outputDuration : 1;
  return { start, sourceDuration, playbackRate, outputDuration };
}

export function sourceTime(timing: ClipTiming, outputTime: number): number {
  return timing.start + Math.min(timing.sourceDuration, Math.max(0, outputTime) * timing.playbackRate);
}

/** Include pointer evidence once when framing a shot, never by chasing it frame by frame. */
export function attentionBounds(area: PrivacyMask, cursors: { x: number; y: number }[] = []): PrivacyMask {
  let left = area.x, top = area.y, right = area.x + area.width, bottom = area.y + area.height;
  for (const cursor of cursors) {
    if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) continue;
    left = Math.min(left, clamp(cursor.x) - 0.025); right = Math.max(right, clamp(cursor.x) + 0.035);
    top = Math.min(top, clamp(cursor.y) - 0.025); bottom = Math.max(bottom, clamp(cursor.y) + 0.055);
  }
  left = clamp(left); top = clamp(top); right = clamp(right); bottom = clamp(bottom);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** One deliberate context → push → hold → release. Cursor movement cannot perturb it. */
export function cameraAt(state: FilmState, layout = demoLayout(1920, 1080), bounds?: PrivacyMask): DemoCamera {
  const p = clamp(state.progress);
  const subtle = state.motion === 'subtle';
  const authored = state.focus || { x: 0.5, y: 0.5, zoom: 1.4 };
  const area = bounds || state.focusArea;
  const subject = area ? { x: area.x + area.width / 2, y: area.y + area.height / 2 } : authored;
  const fit = cameraProjection({ x: 0.5, y: 0.5, zoom: 1 }, layout);
  const regionLimit = area ? Math.min(0.92 / Math.max(0.001, area.width * fit.sourceWidth), 0.88 / Math.max(0.001, area.height * fit.sourceHeight)) : 1.5;
  const zoom = Math.max(1, Math.min(clamp(authored.zoom, 1, 2.4), subtle ? 1.18 : 1.5, regionLimit));
  const amount = p < 0.14 ? 0 : p < 0.44 ? ease((p - 0.14) / 0.3) : p < 0.8 ? 1 : p < 0.98 ? 1 - ease((p - 0.8) / 0.18) : 0;
  return { x: 0.5 + (clamp(subject.x) - 0.5) * amount, y: 0.5 + (clamp(subject.y) - 0.5) * amount, zoom: 1 + (zoom - 1) * amount };
}

export function cameraKeys(state: FilmState, frames: number, layout: DemoLayout, bounds?: PrivacyMask): CameraKey[] {
  const keys = new Map<number, CameraKey>();
  for (const progress of [0, 0.14, 0.44, 0.8, 0.98, 1]) {
    const frame = Math.round(progress * Math.max(0, frames - 1));
    keys.set(frame, { frame, ...cameraAt({ ...state, progress }, layout, bounds) });
  }
  return [...keys.values()];
}

export function cameraForFrame(keys: CameraKey[], frame: number): DemoCamera {
  if (!keys.length) return { x: 0.5, y: 0.5, zoom: 1 };
  let before = keys[0];
  for (const after of keys.slice(1)) {
    if (frame <= after.frame) {
      const t = ease((frame - before.frame) / Math.max(1, after.frame - before.frame));
      return { x: before.x + (after.x - before.x) * t, y: before.y + (after.y - before.y) * t, zoom: before.zoom + (after.zoom - before.zoom) * t };
    }
    before = after;
  }
  return { x: before.x, y: before.y, zoom: before.zoom };
}

/** Projection is a fit, not a fill: context zoom 1 shows every source pixel. */
export function cameraProjection(camera: DemoCamera, layout: DemoLayout, sourceAspect = 16 / 9): { zoom: number; sourceX: number; sourceY: number; sourceWidth: number; sourceHeight: number; x: number; y: number } {
  const aspect = layout.width / layout.height;
  const sourceWidth = Math.min(1, sourceAspect / aspect);
  const sourceHeight = Math.min(1, aspect / sourceAspect);
  const sourceX = (1 - sourceWidth) / 2;
  const sourceY = (1 - sourceHeight) / 2;
  const zoom = clamp(camera.zoom, 1, 2.5);
  const view = 1 / zoom;
  const x = view >= sourceWidth ? (1 - view) / 2 : clamp(sourceX + clamp(camera.x) * sourceWidth - view / 2, sourceX, sourceX + sourceWidth - view);
  const y = view >= sourceHeight ? (1 - view) / 2 : clamp(sourceY + clamp(camera.y) * sourceHeight - view / 2, sourceY, sourceY + sourceHeight - view);
  return { zoom, sourceX, sourceY, sourceWidth, sourceHeight, x, y };
}

export function projectCursor(cursor: { x: number; y: number }, camera: DemoCamera, layout: DemoLayout): { x: number; y: number; visible: boolean } {
  const projection = cameraProjection(camera, layout);
  const x = (projection.sourceX + cursor.x * projection.sourceWidth - projection.x) * projection.zoom;
  const y = (projection.sourceY + cursor.y * projection.sourceHeight - projection.y) * projection.zoom;
  return { x: layout.x + x * layout.width, y: layout.y + y * layout.height, visible: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}

export function projectArea(area: PrivacyMask, camera: DemoCamera, layout: DemoLayout): ProjectedArea {
  const start = projectCursor({ x: area.x, y: area.y }, camera, layout);
  const end = projectCursor({ x: area.x + area.width, y: area.y + area.height }, camera, layout);
  const x = clamp(start.x, layout.x, layout.x + layout.width), y = clamp(start.y, layout.y, layout.y + layout.height);
  const right = clamp(end.x, layout.x, layout.x + layout.width), bottom = clamp(end.y, layout.y, layout.y + layout.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y), visible: right > x && bottom > y };
}

function expression(keys: CameraKey[], property: 'x' | 'y' | 'zoom'): string {
  let result = String(keys.at(-1)?.[property].toFixed(7) || 0);
  for (let i = keys.length - 2; i >= 0; i -= 1) {
    const a = keys[i]; const b = keys[i + 1];
    const t = `clip((on-${a.frame})/${Math.max(1, b.frame - a.frame)},0,1)`;
    const smooth = `(${t}*${t}*${t}*(${t}*(${t}*6-15)+10))`;
    const tween = `(${a[property].toFixed(7)}+${(b[property] - a[property]).toFixed(7)}*${smooth})`;
    result = `if(lte(on,${b.frame}),${tween},${result})`;
  }
  return result;
}

/** FFmpeg and graphics share the same camera; supersampling keeps pans subpixel smooth. */
export function cameraFilter(keys: CameraKey[], layout: DemoLayout, fps: number, surface = '#f4f6f9'): string {
  const p = cameraProjection({ x: 0.5, y: 0.5, zoom: 1 }, layout);
  const workWidth = layout.width * 2, workHeight = layout.height * 2;
  const color = /^#[\da-f]{6}$/i.test(surface) ? `0x${surface.slice(1)}` : '0xf4f6f9';
  const zoom = expression(keys, 'zoom');
  const x = `if(gte(iw/zoom,iw*${p.sourceWidth.toFixed(7)}),(iw-iw/zoom)/2,clip(iw*(${p.sourceX.toFixed(7)}+(${expression(keys, 'x')})*${p.sourceWidth.toFixed(7)})-iw/zoom/2,iw*${p.sourceX.toFixed(7)},iw*${(p.sourceX + p.sourceWidth).toFixed(7)}-iw/zoom))`;
  const y = `if(gte(ih/zoom,ih*${p.sourceHeight.toFixed(7)}),(ih-ih/zoom)/2,clip(ih*(${p.sourceY.toFixed(7)}+(${expression(keys, 'y')})*${p.sourceHeight.toFixed(7)})-ih/zoom/2,ih*${p.sourceY.toFixed(7)},ih*${(p.sourceY + p.sourceHeight).toFixed(7)}-ih/zoom))`;
  return `scale=${workWidth}:${workHeight}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${workWidth}:${workHeight}:(ow-iw)/2:(oh-ih)/2:color=${color},setsar=1,zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${layout.width}x${layout.height}:fps=${fps}`;
}
