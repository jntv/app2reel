import { once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import type { PrivacyMask, ProductTheme, Project, Scene } from '../shared/types.js';
import type { FilmState } from './film-state.js';
import { demoTemplate } from './demo-template.js';
import { attentionBounds, cameraKeys, cameraTiming, cameraFilter, cameraForFrame, clipTiming, demoLayout, ease, projectArea, projectCursor, sourceTime, transitionFilter } from './demo-motion.js';
import { cursorAt, extractRenderedCursorFrames, type CursorPoint } from './cursor-detection.js';
import { privacyFilters, type PrivacyRectangle } from './demo-privacy.js';
import {prepareDemoEdit} from './demo-edit.js';
import {renderedClipClock} from './clip-clock.js';

type Encoder = { process: ChildProcess; done: Promise<void>; stop: () => void };
export interface DynamicDemoOptions {
  project: Project;
  directory: string;
  temporary: string;
  scenes: (Scene & { frames: number })[];
  page: Page;
  width: number;
  height: number;
  fps: number;
  recording: string;
  update: (progress: number, message: string) => void;
  signal?: AbortSignal;
  stateAt: (index: number, progress: number, totalFrame: number) => FilmState;
  encoder: (args: string[], signal?: AbortSignal) => Encoder;
  runEncoder: (args: string[], signal?: AbortSignal) => Promise<void>;
  encodingOptions: () => string[];
  soundtrack?: (duration: number) => string;
  theme?: ProductTheme;
  fontCss?: string;
}

function check(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('Video rendering cancelled.'); }

/** A local edit of live footage with frame-accurate camera and motion artwork. */
export async function renderDynamicDemo(options: DynamicDemoOptions): Promise<string> {
  const { project, temporary, scenes:reviewedScenes, page, width, height, fps, recording:originalRecording, update, signal, stateAt, encoder, runEncoder, encodingOptions } = options;
  for (const scene of reviewedScenes) {
    if (!Number.isFinite(scene.recordingStart) || !Number.isFinite(scene.recordingEnd) || scene.recordingStart! < 0 || scene.recordingEnd! <= scene.recordingStart!) throw new Error('Every demo scene requires a reviewed recording interval.');
  }
  check(signal);
  if(reviewedScenes.some(scene=>scene.recordingRanges))update(0,'Removing reviewed waiting time from the demo');
  const {recording,scenes,track,normalized}=await prepareDemoEdit(originalRecording,reviewedScenes,project.cursorTrack||[],temporary,fps,runEncoder,signal);
  const settings = (project as Project & { renderSettings?: { cursorHighlights?: boolean } }).renderSettings;
  const timings = scenes.map(scene => ({...clipTiming(scene.recordingStart!, scene.recordingEnd!, scene.frames / fps),...(normalized?{sourceFrameRange:{start:Math.round(scene.recordingStart!*fps),end:Math.round(scene.recordingEnd!*fps)}}:{})}));
  let cursorFrames: (CursorPoint | undefined)[][] | undefined;
  const hasTelemetry = track.length > 0;
  if (settings?.cursorHighlights !== false) {
    update(0, 'Locating the cursor in the original recording');
    try {
      cursorFrames = await extractRenderedCursorFrames(recording, timings.map((timing, index) => ({ ...timing, frames: scenes[index].frames })), fps, signal);
      await writeFile(path.join(temporary, 'detected-cursor-track.json'), JSON.stringify({ source: 'recorded-orange-ring-output-frames', fps, scenes: cursorFrames, track: cursorFrames.flat().filter(Boolean) }), 'utf8');
    } catch (error) {
      check(signal);
      // Camera focus remains useful when a legacy recording has no recognizable pointer.
      update(0.025, 'Using the reviewed camera focus for this recording');
    }
  }
  const layout = demoLayout(width, height);
  const theme = options.theme || project.productTheme;
  await page.setContent(demoTemplate(width, height, theme || project.brief.brandColor));
  if (options.fontCss) await page.addStyleTag({ content: options.fontCss });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const totalFrames = scenes.reduce((sum, scene) => sum + scene.frames, 0);
  let rendered = 0;
  const segments: string[] = [];
  for (let index = 0; index < scenes.length; index += 1) {
    check(signal);
    const scene = scenes[index];
    const timing = timings[index];
    const outputDuration = scene.frames / fps;
    const sceneOffset = rendered;
    const frameState = (frame: number): FilmState => {
      const progress = (frame + 0.5) / scene.frames;
      const state = stateAt(index, progress, sceneOffset + frame);
      const observed = cursorFrames?.[index]?.[frame];
      const telemetry = hasTelemetry ? cursorAt(track, sourceTime(timing, frame / fps), Infinity) : undefined;
      // Pixels supply the actual displayed position; only trusted telemetry can
      // supply click events. Telemetry position is an approximation fallback.
      const detected = observed ? { ...observed, click: telemetry?.click } : telemetry;
      return { ...state, duration: outputDuration, focusRevealAt: scene.focusRevealAt, cursor: settings?.cursorHighlights === false ? undefined : detected || state.cursor };
    };
    const focus = scene.focus || { x: 0.5, y: 0.5, zoom: 1.4 };
    const area: PrivacyMask = scene.focusArea || { x: Math.max(0, Math.min(0.52, focus.x - 0.24)), y: Math.max(0, Math.min(0.72, focus.y - 0.14)), width: 0.48, height: 0.28 };
    const points = settings?.cursorHighlights === false ? [] : Array.from({ length: Math.max(2, Math.ceil(outputDuration * 5)) }, (_, i) => i / 5 < outputDuration * 0.4 || i / 5 > outputDuration * 0.84 ? undefined : cursorFrames?.[index]?.[Math.min(scene.frames - 1, Math.round(i / 5 * fps))] || (hasTelemetry ? cursorAt(track, sourceTime(timing, i / 5), Infinity) : undefined)).filter((point): point is { x: number; y: number; click?: boolean } => Boolean(point && point.x >= area.x - 0.08 && point.x <= area.x + area.width + 0.08 && point.y >= area.y - 0.08 && point.y <= area.y + area.height + 0.08));
    const bounds = attentionBounds(area, points);
    // A single shot plan includes pointer evidence without chasing its motion.
    const cameraPlan = cameraKeys({ ...frameState(0), focusArea: area }, scene.frames, layout, bounds);
    const move = cameraTiming({ ...frameState(0), focusArea: area }, layout, bounds);
    const privacy = privacyFilters((scene as Scene & { redactions?: PrivacyRectangle[] }).redactions);
    const clock=renderedClipClock({...timing,frames:scene.frames},fps);
    const filter = [
      `[0:v]${privacy ? `${privacy},` : ''}${clock.filter},${cameraFilter(cameraPlan, layout, fps, theme?.surface)},pad=${width}:${height}:${layout.x}:${layout.y}:color=0xf4f6f9[live]`,
      '[live][1:v]overlay=0:0:format=auto:shortest=1,format=yuv420p[out]',
    ].join(';');
    const segment = path.join(temporary, `demo-scene-${index}.mp4`);
    const job = encoder([
      ...clock.seek, '-i', recording,
      '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(fps), '-i', 'pipe:0',
      '-filter_complex', filter, '-map', '[out]', '-an', '-t', String(outputDuration), ...encodingOptions(), segment,
    ], signal);
    let lastClick: { sourceX: number; sourceY: number; at: number } | undefined;
    let clicking = false;
    try {
      for (let frame = 0; frame < scene.frames; frame += 1) {
        check(signal);
        if (job.process.exitCode !== null || job.process.signalCode !== null) { await job.done; throw new Error('Demo encoder stopped.'); }
        const film = frameState(frame);
        const camera = cameraForFrame(cameraPlan, frame);
        const pointer = film.cursor ? projectCursor(film.cursor, camera, layout) : undefined;
        const attention = projectArea(area, camera, layout);
        if (film.cursor?.click && !clicking) lastClick = { sourceX: film.cursor.x, sourceY: film.cursor.y, at: frame / fps };
        clicking = Boolean(film.cursor?.click);
        const clickPoint = lastClick ? projectCursor({ x: lastClick.sourceX, y: lastClick.sourceY }, camera, layout) : undefined;
        const click = lastClick && clickPoint?.visible ? { ...clickPoint, age: frame / fps - lastClick.at } : undefined;
        await page.evaluate(async payload => {
          const target = window as unknown as { setDemoState: (value: unknown) => Promise<void> };
          await target.setDemoState(payload);
        }, { film, cursor: pointer, click, attention, openingOpacity: index === 0 ? ease(frame / fps / 0.15) * (1 - ease((frame / fps - 0.55) / 0.2)) : 0, closingOpacity: index === scenes.length - 1 ? ease((frame / fps - (outputDuration - 0.85)) / 0.25) : 0, attentionOpacity: ease((frame / fps - move.start - move.move * 0.55) / 0.4) * Math.max(0, Math.min(1, (scene.frames - 1 - frame) / (fps * 0.12))), captionOpacity: Math.max(0, Math.min(1, frame / (fps * 0.12), (scene.frames - 1 - frame) / (fps * 0.12))), cursorHighlights: settings?.cursorHighlights !== false });
        const pixels = await page.screenshot({ type: 'png', omitBackground: true, animations: 'disabled' });
        const input = job.process.stdin;
        if (!input || input.destroyed) { await job.done; throw new Error('Demo encoder input closed.'); }
        if (!input.write(pixels)) await Promise.race([once(input, 'drain'), job.done.then(() => { throw new Error('Demo encoder closed before receiving all frames.'); })]);
        rendered += 1;
        if (rendered % 15 === 0 || rendered === totalFrames) update(0.04 + rendered / totalFrames * 0.89, `Compositing cinematic demo ${Math.round(rendered / totalFrames * 100)}% · scene ${index + 1} of ${scenes.length}`);
      }
      job.process.stdin?.end();
      await job.done;
    } catch (error) {
      job.stop(); await job.done.catch(() => {}); throw error;
    }
    segments.push(segment);
  }
  check(signal);
  update(0.95, 'Finishing the cinematic demo master');
  const list = path.join(temporary, 'demo-segments.txt');
  await writeFile(list, segments.map((_, i) => `file 'demo-scene-${i}.mp4'`).join('\n'), 'utf8');
  const duration = totalFrames / fps;
  const output = path.join(temporary, 'demo.mp4');
  // Original quiet pulse and harmonics. No fetched or licensed third-party media.
  const sound = options.soundtrack?.(duration) || `aevalsrc='(0.021*sin(2*PI*130.8128*t)+0.012*sin(2*PI*196*t)+0.009*sin(2*PI*261.6256*t))*(0.78+0.22*sin(2*PI*.125*t))+0.018*sin(2*PI*55*t)*exp(-22*mod(t,.5))':s=48000:d=${duration}`;
  if (segments.length === 1) {
    await runEncoder([
      '-f', 'concat', '-safe', '1', '-i', list, '-f', 'lavfi', '-i', sound,
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
      '-af', `afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, duration - 1.5)}:d=1.5`, '-t', String(duration), '-movflags', '+faststart', output,
    ], signal);
  } else {
    // Extend only the boundary stills, then overlap them. Original scene/narration
    // clocks remain unchanged: no 0.2-second shortening at every edit.
    const {filters,label}=transitionFilter(scenes,fps);
    await runEncoder([
      '-filter_complex_threads', '2', ...segments.flatMap(file => ['-i', file]), '-f', 'lavfi', '-i', sound,
      '-filter_complex', filters.join(';'), '-map', `[${label}]`, '-map', `${segments.length}:a:0`, ...encodingOptions(),
      '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-af', `afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, duration - 1.5)}:d=1.5`, '-t', String(duration), output,
    ], signal);
  }
  return output;
}
