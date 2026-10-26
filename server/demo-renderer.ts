import { once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import type { Project, Scene } from '../shared/types.js';
import type { FilmState } from './film-state.js';
import { demoTemplate } from './demo-template.js';
import { cameraAt, cameraFilter, cameraForFrame, demoLayout, projectCursor, type CameraKey } from './demo-motion.js';
import { cursorAt, extractRecordedCursorTrack, type CursorPoint } from './cursor-detection.js';
import { privacyFilters, type PrivacyRectangle } from './demo-privacy.js';

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
}

function check(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('Video rendering cancelled.'); }

/** A local edit of live footage with frame-accurate camera and motion artwork. */
export async function renderDynamicDemo(options: DynamicDemoOptions): Promise<string> {
  const { project, temporary, scenes, page, width, height, fps, recording, update, signal, stateAt, encoder, runEncoder, encodingOptions } = options;
  for (const scene of scenes) {
    if (!Number.isFinite(scene.recordingStart) || !Number.isFinite(scene.recordingEnd) || scene.recordingStart! < 0 || scene.recordingEnd! <= scene.recordingStart!) throw new Error('Every demo scene requires a reviewed recording interval.');
  }
  check(signal);
  const settings = (project as Project & { renderSettings?: { cursorHighlights?: boolean } }).renderSettings;
  let track: CursorPoint[] = (project as Project & { cursorTrack?: CursorPoint[] }).cursorTrack || [];
  if (settings?.cursorHighlights !== false && !track.length) {
    update(0, 'Locating the cursor in the original recording');
    try {
      track = await extractRecordedCursorTrack(recording, scenes.map(s => ({ start: s.recordingStart!, end: s.recordingEnd! })), signal);
      await writeFile(path.join(temporary, 'detected-cursor-track.json'), JSON.stringify({ source: 'recorded-orange-ring', track }), 'utf8');
    } catch (error) {
      check(signal);
      // Camera focus remains useful when a legacy recording has no recognizable pointer.
      update(0.025, 'Using the reviewed camera focus for this recording');
    }
  }
  const layout = demoLayout(width, height);
  await page.setContent(demoTemplate(width, height, project.brief.brandColor));
  const totalFrames = scenes.reduce((sum, scene) => sum + scene.frames, 0);
  let rendered = 0;
  const segments: string[] = [];
  for (let index = 0; index < scenes.length; index += 1) {
    check(signal);
    const scene = scenes[index];
    const rawDuration = scene.recordingEnd! - scene.recordingStart!;
    const outputDuration = scene.frames / fps;
    const sceneOffset = rendered;
    const frameState = (frame: number): FilmState => {
      const progress = (frame + 0.5) / scene.frames;
      const state = stateAt(index, progress, sceneOffset + frame);
      const detected = cursorAt(track, scene.recordingStart! + progress * rawDuration);
      return { ...state, cursor: settings?.cursorHighlights === false ? undefined : detected || state.cursor };
    };
    // Shared keyframes make the FFmpeg camera and the HTML pointer overlay agree.
    const keyFrames = [...new Set(Array.from({ length: 10 }, (_, i) => Math.round(i / 9 * Math.max(0, scene.frames - 1))))];
    const cameraKeys: CameraKey[] = keyFrames.map(frame => ({ frame, ...cameraAt(frameState(frame)) }));
    const privacy = privacyFilters((scene as Scene & { redactions?: PrivacyRectangle[] }).redactions);
    const filter = [
      `[0:v]${privacy ? `${privacy},` : ''}setpts=(PTS-STARTPTS)*${(outputDuration / rawDuration).toFixed(8)},fps=${fps},${cameraFilter(cameraKeys, layout, fps)},tpad=stop_mode=clone:stop_duration=${outputDuration},trim=duration=${outputDuration},pad=${width}:${height}:${layout.x}:${layout.y}:color=0x101319[live]`,
      '[live][1:v]overlay=0:0:format=auto:shortest=1,format=yuv420p[out]',
    ].join(';');
    const segment = path.join(temporary, `demo-scene-${index}.mp4`);
    const job = encoder([
      '-ss', String(scene.recordingStart), '-t', String(rawDuration), '-i', recording,
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
        const camera = cameraForFrame(cameraKeys, frame);
        const pointer = film.cursor ? projectCursor(film.cursor, camera, layout) : undefined;
        if (film.cursor?.click && !clicking) lastClick = { sourceX: film.cursor.x, sourceY: film.cursor.y, at: frame / fps };
        clicking = Boolean(film.cursor?.click);
        const clickPoint = lastClick ? projectCursor({ x: lastClick.sourceX, y: lastClick.sourceY }, camera, layout) : undefined;
        const click = lastClick && clickPoint?.visible ? { ...clickPoint, age: frame / fps - lastClick.at } : undefined;
        await page.evaluate(async payload => {
          const target = window as unknown as { setDemoState: (value: unknown) => Promise<void> };
          await target.setDemoState(payload);
        }, { film, cursor: pointer, click, cursorHighlights: settings?.cursorHighlights !== false });
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
  await runEncoder([
    '-f', 'concat', '-safe', '1', '-i', list, '-f', 'lavfi', '-i', sound,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    '-af', `afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, duration - 1.5)}:d=1.5`, '-t', String(duration), '-movflags', '+faststart', output,
  ], signal);
  return output;
}
