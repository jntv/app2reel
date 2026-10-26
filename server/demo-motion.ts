import type { FilmState } from './film-state.js';

export interface DemoCamera { x: number; y: number; zoom: number }
export interface CameraKey extends DemoCamera { frame: number }
export interface DemoLayout { x: number; y: number; width: number; height: number }

export const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
export const ease = (value: number): number => { const t = clamp(value); return t * t * (3 - 2 * t); };

/** A broad, editorial canvas: product footage uses 93% of the frame width. */
export function demoLayout(width: number, height: number): DemoLayout {
  const even = (n: number) => Math.round(n / 2) * 2;
  return { x: even(width * 0.035), y: even(height * 0.142), width: even(width * 0.93), height: even(height * 0.716) };
}

/** All coordinates stay in the original recording's normalized coordinate space. */
export function cameraAt(state: FilmState): DemoCamera {
  const p = clamp(state.progress);
  const subtle = state.motion === 'subtle';
  const focus = state.focus || { x: 0.5, y: 0.5, zoom: 1.6 };
  const cursor = state.cursor;
  // A cursor guides attention without throwing the camera across the product.
  const follow = cursor ? (subtle ? 0.12 : 0.24) : 0;
  let x = clamp(focus.x) * (1 - follow) + clamp(cursor?.x ?? focus.x) * follow;
  let y = clamp(focus.y) * (1 - follow) + clamp(cursor?.y ?? focus.y) * follow;
  const settle = ease(p / 0.24);
  const release = ease((p - 0.87) / 0.13);
  const targetZoom = clamp(focus.zoom, 1, subtle ? 1.45 : 2.4);
  const push = subtle ? 0.012 : 0.035;
  const zoom = 1 + (targetZoom - 1) * (0.42 + 0.58 * settle) + push * p - release * (targetZoom - 1) * 0.12;
  if (cursor) {
    // Keep the recorded pointer in the editorial safe area even at stronger zooms.
    // The source's full width is visible at zoom 1; height is cropped by the wide aperture.
    x = clamp(x, Math.max(0, cursor.x - 0.44 / zoom), Math.min(1, cursor.x + 0.44 / zoom));
    y = clamp(y, Math.max(0, cursor.y - 0.31 / zoom), Math.min(1, cursor.y + 0.31 / zoom));
  }
  return { x, y, zoom };
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

/** FFmpeg and the graphics overlay share this projection, avoiding drifting highlights. */
export function cameraProjection(camera: DemoCamera, layout: DemoLayout, sourceAspect = 16 / 9): { zoom: number; sourceX: number; sourceY: number; sourceWidth: number; sourceHeight: number; x: number; y: number } {
  const aspect = layout.width / layout.height;
  const sourceWidth = Math.min(1, sourceAspect / aspect);
  const sourceHeight = Math.min(1, aspect / sourceAspect);
  const sourceX = (1 - sourceWidth) / 2;
  const sourceY = (1 - sourceHeight) / 2;
  const base = Math.max(1 / sourceWidth, 1 / sourceHeight);
  const zoom = base * clamp(camera.zoom, 1, 2.5);
  const view = 1 / zoom;
  const x = clamp(sourceX + clamp(camera.x) * sourceWidth - view / 2, sourceX, sourceX + sourceWidth - view);
  const y = clamp(sourceY + clamp(camera.y) * sourceHeight - view / 2, sourceY, sourceY + sourceHeight - view);
  return { zoom, sourceX, sourceY, sourceWidth, sourceHeight, x, y };
}

export function projectCursor(cursor: { x: number; y: number }, camera: DemoCamera, layout: DemoLayout): { x: number; y: number; visible: boolean } {
  const projection = cameraProjection(camera, layout);
  const x = (projection.sourceX + cursor.x * projection.sourceWidth - projection.x) * projection.zoom;
  const y = (projection.sourceY + cursor.y * projection.sourceHeight - projection.y) * projection.zoom;
  return { x: layout.x + x * layout.width, y: layout.y + y * layout.height, visible: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}

function expression(keys: CameraKey[], property: 'x' | 'y' | 'zoom'): string {
  let result = String(keys.at(-1)?.[property].toFixed(7) || 0);
  for (let i = keys.length - 2; i >= 0; i -= 1) {
    const a = keys[i]; const b = keys[i + 1];
    const t = `clip((on-${a.frame})/${Math.max(1, b.frame - a.frame)},0,1)`;
    const tween = `(${a[property].toFixed(7)}+${(b[property] - a[property]).toFixed(7)}*${t}*${t}*(3-2*${t}))`;
    result = `if(lte(on,${b.frame}),${tween},${result})`;
  }
  return result;
}

/** Input is fitted into an aspect-matched pad before zooming; no product pixels are stretched. */
export function cameraFilter(keys: CameraKey[], layout: DemoLayout, fps: number): string {
  const p = cameraProjection({ x: 0.5, y: 0.5, zoom: 1 }, layout);
  // Supersampling avoids the one-pixel crop jitter of zoompan at delivery resolution.
  const workWidth = layout.width * 2;
  const workHeight = layout.height * 2;
  const zoom = `(${Math.max(1 / p.sourceWidth, 1 / p.sourceHeight).toFixed(7)}*(${expression(keys, 'zoom')}))`;
  const x = `clip(iw*(${p.sourceX.toFixed(7)}+(${expression(keys, 'x')})*${p.sourceWidth.toFixed(7)})-iw/zoom/2,iw*${p.sourceX.toFixed(7)},iw*${(p.sourceX + p.sourceWidth).toFixed(7)}-iw/zoom)`;
  const y = `clip(ih*(${p.sourceY.toFixed(7)}+(${expression(keys, 'y')})*${p.sourceHeight.toFixed(7)})-ih/zoom/2,ih*${p.sourceY.toFixed(7)},ih*${(p.sourceY + p.sourceHeight).toFixed(7)}-ih/zoom)`;
  return `scale=${workWidth}:${workHeight}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${workWidth}:${workHeight}:(ow-iw)/2:(oh-ih)/2:color=0x101319,setsar=1,zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${layout.width}x${layout.height}:fps=${fps}`;
}
