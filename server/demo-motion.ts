import type { EditTransition, PrivacyMask } from '../shared/types.js';
import type { FilmState } from './film-state.js';

export interface DemoCamera {
  x: number; y: number; zoom: number;
  /** Generated moves carry their already-projected viewport to avoid edge-clamp kinks. */
  viewport?: { x: number; y: number };
}
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
  return { x: even(width * 0.025), y: even(height * 0.03), width: even(width * 0.95), height: even(height * 0.94) };
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

export interface CameraTiming { start: number; move: number; duration: number; targetZoom: number; release: number; releaseStart: number; releaseEnd: number; exitHold: number }

/** A held context followed by one settled, sustained detail shot, paced in seconds. */
export function cameraTiming(state: FilmState, layout = demoLayout(1920, 1080), bounds?: PrivacyMask): CameraTiming {
  const duration = Math.max(0.03, state.duration || 6);
  const subtle = state.motion === 'subtle';
  const area = bounds || state.focusArea;
  const authored = state.focus || { x: 0.5, y: 0.5, zoom: 1.65 };
  const coverage = area ? area.width * area.height : 0.16;
  const overview = coverage > 0.3 || Boolean(area && area.width > 0.78 && area.height > 0.48);
  const detail = coverage < 0.13;
  const fit = cameraProjection({ x: 0.5, y: 0.5, zoom: 1 }, layout);
  const limit = area ? Math.min(0.94 / Math.max(0.001, area.width * fit.sourceWidth), 0.88 / Math.max(0.001, area.height * fit.sourceHeight)) : 1.85;
  let targetZoom = Math.max(1, Math.min(clamp(authored.zoom, 1, 2.4), subtle ? 1.24 : overview ? 1.25 : detail ? 2.2 : 1.85, limit));
  const ready = Math.max(0, Math.min(duration, state.focusRevealAt ?? Math.min(0.72, duration * 0.14)));
  const start = state.camera ? Math.min(duration,Math.max(ready,clamp(state.camera.contextHold,0,duration))) : Math.min(duration, ready + (ready > 0 ? 0.08 : 0.22));
  // A centered page edit starts before the scene's nominal end. Land the
  // outgoing camera first, so a dissolve blends matching context frames rather
  // than a moving closeup with an incoming full page.
  const transition = state.transition ?? { type: 'dissolve', duration: 0.6 };
  const exitHold = state.externalTransitions && state.scene < state.scenes - 1 && state.camera?.releaseDuration && transition.type !== 'cut'
    ? Math.min(duration - start, transition.duration / 2 + 0.2) : 0;
  const available = duration - start - exitHold;
  // Strong detail pushes need more time than overviews. A fixed one-second
  // automatic push made a 2.2x closeup accelerate far faster than a gentle crop.
  const comfortableMove = overview ? 1.8 : 1.45 + (targetZoom - 1) * 1.1;
  const move = state.camera ? Math.min(available,clamp(state.camera.moveDuration,.2,10)) : Math.min(comfortableMove, Math.max(0.45, available * 0.55));
  const release=state.camera?Math.min(clamp(state.camera.releaseDuration,0,10),Math.max(0,available-move)):0;
  if (available < 0.7) targetZoom = 1;
  const releaseEnd = duration - exitHold;
  return { start, move, duration, targetZoom, release, releaseStart:releaseEnd-release, releaseEnd, exitHold };
}

/** Pointer movement cannot perturb this editorial camera. */
export function cameraAt(state: FilmState, layout = demoLayout(1920, 1080), bounds?: PrivacyMask): DemoCamera {
  const authored = state.focus || { x: 0.5, y: 0.5, zoom: 1.65 };
  const area = bounds || state.focusArea;
  const subject = area ? { x: area.x + area.width / 2, y: area.y + area.height / 2 } : authored;
  const timing = cameraTiming(state, layout, bounds);
  const time=clamp(state.progress)*timing.duration;
  const amount = ease((time-timing.start)/Math.max(.001,timing.move))*(timing.release?1-ease((time-timing.releaseStart)/timing.release):1);
  const context = { x: 0.5, y: 0.5, zoom: 1 };
  const target = { x: clamp(subject.x), y: clamp(subject.y), zoom: timing.targetZoom };
  return interpolateCamera(context, target, amount, cameraProjection(context, layout), cameraProjection(target, layout));
}

export function cameraKeys(state: FilmState, frames: number, layout: DemoLayout, bounds?: PrivacyMask): CameraKey[] {
  const timing = cameraTiming(state, layout, bounds);
  const keys = new Map<number, CameraKey>();
  for (const time of [0, timing.start, Math.min(timing.duration, timing.start + timing.move),timing.releaseStart, timing.releaseEnd, timing.duration]) {
    const progress = clamp(time / timing.duration);
    const frame = Math.round(progress * Math.max(0, frames - 1));
    const camera = cameraAt({ ...state, progress }, layout, bounds);
    const projection = cameraProjection(camera, layout);
    keys.set(frame, { frame, ...camera, viewport: { x: projection.x, y: projection.y } });
  }
  return [...keys.values()];
}

/** Even frame counts keep both centered transition handles on exact frames. */
export function transitionSchedule(scenes:readonly {frames:number;transition?:EditTransition}[],fps:number):{type:EditTransition['type'];duration:number;half:number}[]{
  if(!Number.isInteger(fps)||fps<1||fps>60)throw new Error('Invalid film transition frame rate.');
  return scenes.slice(0,-1).map((scene,index)=>{
    const authored=scene.transition??{type:'dissolve' as const,duration:.6};
    if(!['cut','dissolve','fade','slide'].includes(authored.type)||!Number.isFinite(authored.duration)||authored.duration<0||authored.duration>1.2)throw new Error('Invalid reviewed film transition.');
    const maximum=2*Math.floor(Math.min(scene.frames,scenes[index+1].frames)/4);
    const frames=authored.type==='cut'||!authored.duration?0:Math.min(maximum,Math.max(2,2*Math.round(authored.duration*fps/2)));
    return {type:frames?authored.type:'cut',duration:frames/fps,half:frames/fps/2};
  });
}

/** Center each outgoing edit on its original boundary, with no narration drift. */
export function transitionFilter(scenes:readonly {frames:number;transition?:EditTransition}[],fps:number):{filters:string[];label:string}{
  const transitions=transitionSchedule(scenes,fps);
  const filters=scenes.map((_,index)=>`[${index}:v]fps=${fps},settb=AVTB,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=${transitions[index-1]?.half||0}:stop_mode=clone:stop_duration=${transitions[index]?.half||0}[clip${index}]`);
  let label='clip0',elapsed=scenes[0].frames/fps;
  for(let index=1;index<scenes.length;index++){
    const transition=transitions[index-1],next=`join${index}`;
    // xfade can emit an inclusive terminal frame. Bound every join so that
    // rounding cannot accumulate into later editorial boundaries.
    const frames=Math.round((elapsed+scenes[index].frames/fps+(transitions[index]?.half||0))*fps);
    const finish=`trim=end_frame=${frames},setpts=PTS-STARTPTS[${next}]`;
    if(transition.type==='cut')filters.push(`[${label}][clip${index}]concat=n=2:v=1:a=0,settb=AVTB,${finish}`);
    else {
      // Quintic opacity gives a dissolve the same gentle departure/arrival as
      // the camera, instead of suddenly changing opacity at constant speed.
      const eased = '(P*P*P*(P*(P*6-15)+10))';
      const effect = transition.type === 'dissolve' ? `custom:expr='A*${eased}+B*(1-${eased})'` : transition.type === 'fade' ? 'fadeblack' : 'smoothleft';
      filters.push(`[${label}][clip${index}]xfade=transition=${effect}:duration=${transition.duration}:offset=${(elapsed-transition.half).toFixed(8)},${finish}`);
    }
    label=next;elapsed+=scenes[index].frames/fps;
  }
  return {filters,label};
}

export function cameraForFrame(keys: CameraKey[], frame: number): DemoCamera {
  if (!keys.length) return { x: 0.5, y: 0.5, zoom: 1 };
  let before = keys[0];
  for (const after of keys.slice(1)) {
    if (frame <= after.frame) {
      const t = ease((frame - before.frame) / Math.max(1, after.frame - before.frame));
      return interpolateCamera(before, after, t, before.viewport, after.viewport);
    }
    before = after;
  }
  return { x: before.x, y: before.y, zoom: before.zoom };
}

/**
 * Interpolate the complete source-to-screen affine transform. Interpolating a
 * focus point and clamping the crop on every frame causes a visible pan kink
 * when a top/right detail reaches an edge. Endpoint crop validation happens
 * once; the convex affine path stays inside the fitted source canvas.
 */
function interpolateCamera(a: DemoCamera, b: DemoCamera, amount: number, from?: { x: number; y: number }, to?: { x: number; y: number }): DemoCamera {
  const t = clamp(amount);
  const camera = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, zoom: a.zoom + (b.zoom - a.zoom) * t };
  if (!from || !to || t === 0 || t === 1 || (a.zoom === b.zoom && from.x === to.x && from.y === to.y)) return camera;
  return { ...camera, viewport: {
    x: (from.x * a.zoom + (to.x * b.zoom - from.x * a.zoom) * t) / camera.zoom,
    y: (from.y * a.zoom + (to.y * b.zoom - from.y * a.zoom) * t) / camera.zoom,
  } };
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
  const x = camera.viewport ? clamp(camera.viewport.x, 0, 1 - view) : view >= sourceWidth ? (1 - view) / 2 : clamp(sourceX + clamp(camera.x) * sourceWidth - view / 2, sourceX, sourceX + sourceWidth - view);
  const y = camera.viewport ? clamp(camera.viewport.y, 0, 1 - view) : view >= sourceHeight ? (1 - view) / 2 : clamp(sourceY + clamp(camera.y) * sourceHeight - view / 2, sourceY, sourceY + sourceHeight - view);
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
  const affineKeys = keys.every(key => key.viewport) ? keys.map(key => ({ ...key, x: key.viewport!.x * key.zoom, y: key.viewport!.y * key.zoom })) : undefined;
  const x = affineKeys ? `iw*(${expression(affineKeys, 'x')})/zoom` : `if(gte(iw/zoom,iw*${p.sourceWidth.toFixed(7)}),(iw-iw/zoom)/2,clip(iw*(${p.sourceX.toFixed(7)}+(${expression(keys, 'x')})*${p.sourceWidth.toFixed(7)})-iw/zoom/2,iw*${p.sourceX.toFixed(7)},iw*${(p.sourceX + p.sourceWidth).toFixed(7)}-iw/zoom))`;
  const y = affineKeys ? `ih*(${expression(affineKeys, 'y')})/zoom` : `if(gte(ih/zoom,ih*${p.sourceHeight.toFixed(7)}),(ih-ih/zoom)/2,clip(ih*(${p.sourceY.toFixed(7)}+(${expression(keys, 'y')})*${p.sourceHeight.toFixed(7)})-ih/zoom/2,ih*${p.sourceY.toFixed(7)},ih*${(p.sourceY + p.sourceHeight).toFixed(7)}-ih/zoom))`;
  return `scale=${workWidth}:${workHeight}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${workWidth}:${workHeight}:(ow-iw)/2:(oh-ih)/2:color=${color},setsar=1,zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${layout.width}x${layout.height}:fps=${fps}`;
}
