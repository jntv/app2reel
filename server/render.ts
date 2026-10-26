import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { chromium, type Browser, type Page } from 'playwright';
import type { OutputKind, Project, Scene, VideoOutput } from '../shared/types.js';
import { demoAperture, filmTemplate, type FilmState } from './film-template.js';

const FPS = 30;
const MAX_SECONDS = 90;
const MAX_SCENES = 20;
const activeDirectories = new Set<string>();
type RenderOptions = { signal?: AbortSignal; onProgress?: (progress: number, message: string) => void };
type TimedScene = Scene & { duration: number; frames: number };

function executable(): string {
  return process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
}

export function ffmpegAvailable(): boolean {
  const result = spawnSync(executable(), ['-version'], { stdio: 'ignore', timeout: 5_000 });
  return !result.error && result.status === 0;
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Video rendering cancelled.');
}

function safeText(value: unknown, length: number): string {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, length);
}

async function containedFile(directory: string, relative: string): Promise<string> {
  if (!relative || path.isAbsolute(relative)) throw new Error('Render assets must use project-relative paths.');
  const root = await realpath(directory);
  const resolved = await realpath(path.resolve(directory, relative));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('A render asset is outside the project directory.');
  if (!(await stat(resolved)).isFile()) throw new Error('A render asset is not a file.');
  return resolved;
}

async function imageData(directory: string, relative?: string): Promise<string | undefined> {
  if (!relative) return undefined;
  const file = await containedFile(directory, relative);
  const info = await stat(file);
  if (info.size > 20 * 1024 * 1024) throw new Error('A screenshot exceeds the 20 MB render limit.');
  const bytes = await readFile(file);
  const extension = path.extname(file).toLowerCase();
  const mime = extension === '.png' ? 'image/png' : ['.jpg', '.jpeg'].includes(extension) ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : undefined;
  if (!mime) throw new Error('Screenshots must be PNG, JPEG, or WebP images.');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function timeline(scenes: Scene[]): TimedScene[] {
  if (!scenes.length) throw new Error('Create and review a storyboard before rendering videos.');
  const bounded: TimedScene[] = [];
  let remaining = MAX_SECONDS * FPS;
  for (const scene of scenes.slice(0, MAX_SCENES)) {
    const seconds = Number(scene.duration);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Every storyboard scene needs a positive duration.');
    const frames = Math.min(remaining, Math.max(1, Math.round(seconds * FPS)));
    if (!frames) break;
    bounded.push({ ...scene, duration: frames / FPS, frames });
    remaining -= frames;
  }
  return bounded;
}

function humanUrl(value: string): string {
  try { const url = new URL(value); return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`; }
  catch { return ''; }
}

async function setFrame(page: Page, state: FilmState): Promise<void> {
  await page.evaluate(async payload => {
    const target = window as unknown as { setFilmState: (value: FilmState) => Promise<void> };
    await target.setFilmState(payload);
  }, state);
}

function encoder(args: string[], signal?: AbortSignal): { process: ChildProcess; done: Promise<void>; stop: () => void } {
  aborted(signal);
  const child = spawn(executable(), ['-hide_banner', '-nostdin', '-y', ...args], { stdio: ['pipe', 'ignore', 'pipe'] });
  let errors = '';
  let timer: NodeJS.Timeout | undefined;
  child.stderr?.on('data', (chunk: Buffer) => { errors = `${errors}${chunk.toString()}`.slice(-12_000); });
  // Pipe errors are handled through process completion; an early ffmpeg failure must not crash Node.
  child.stdin?.on('error', () => {});
  const stop = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
    timer.unref();
  };
  signal?.addEventListener('abort', stop, { once: true });
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      signal?.removeEventListener('abort', stop);
      if (timer) clearTimeout(timer);
      if (signal?.aborted) reject(new Error('Video rendering cancelled.'));
      else if (code === 0) resolve();
      else reject(new Error(`FFmpeg could not encode the video: ${errors.slice(-2500) || `exit ${code}`}`));
    });
  });
  // A completion failure may arrive while a browser frame is being captured.
  void done.catch(() => {});
  return { process: child, done, stop };
}

async function runEncoder(args: string[], signal?: AbortSignal): Promise<void> {
  const job = encoder(args, signal);
  job.process.stdin?.end();
  await job.done;
}

function encodingOptions(): string[] {
  return ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart'];
}

/** A quiet original synthesized sound bed; no copyrighted or network-fetched audio. */
function soundtrack(duration: number): string {
  return `aevalsrc=0.025*(sin(2*PI*130.8128*t)+0.5*sin(2*PI*196*t)+0.35*sin(2*PI*261.6256*t))*(0.75+0.25*sin(2*PI*0.125*t)):s=48000:d=${duration}`;
}

function subtitleTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3_600_000)).padStart(2, '0')}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

async function writeNarration(directory: string, scenes: TimedScene[]): Promise<void> {
  let elapsed = 0;
  const subtitles = scenes.map((scene, index) => {
    const start = elapsed;
    elapsed += scene.duration;
    return `${index + 1}\n${subtitleTime(start)} --> ${subtitleTime(elapsed)}\n${safeText(scene.narration || scene.caption, 1200).replace(/\r/g, '')}\n`;
  }).join('\n');
  await writeFile(path.join(directory, 'narration.srt'), subtitles, 'utf8');
  await writeFile(path.join(directory, 'narration.txt'), scenes.map(scene => `${safeText(scene.title, 160)}\n${safeText(scene.narration || scene.caption, 1500)}`).join('\n\n'), 'utf8');
}

async function renderDemo(
  project: Project, directory: string, temporary: string, scenes: TimedScene[], states: FilmState[], page: Page,
  width: number, height: number, update: (progress: number, message: string) => void, signal?: AbortSignal,
): Promise<string> {
  if (!project.recording) throw new Error('A live browser recording is required for the demo video.');
  const recording = await containedFile(directory, project.recording);
  for (const scene of scenes) {
    if (!Number.isFinite(scene.recordingStart) || !Number.isFinite(scene.recordingEnd) || scene.recordingStart! < 0 || scene.recordingEnd! <= scene.recordingStart!) {
      throw new Error(`The scene “${safeText(scene.title, 80)}” needs a safe recorded clip before the demo can render.`);
    }
  }
  await page.setContent(filmTemplate('demo', width, height, project.brief.brandColor));
  const aperture = demoAperture(width, height);
  const segments: string[] = [];
  for (let index = 0; index < scenes.length; index += 1) {
    aborted(signal);
    const scene = scenes[index];
    update(index / scenes.length * 0.9, `Editing live demo scene ${index + 1} of ${scenes.length}`);
    await setFrame(page, { ...states[index], screenshot: undefined, progress: 0.5 });
    // The empty aperture is completely covered by the live clip below.
    const frame = path.join(temporary, `demo-art-${index}.png`);
    await page.screenshot({ path: frame, type: 'png', animations: 'disabled' });
    const segment = path.join(temporary, `demo-scene-${index}.mp4`);
    const recordedDuration = scene.recordingEnd! - scene.recordingStart!;
    const speed = scene.duration / recordedDuration;
    const filter = [
      `[1:v]setpts=(PTS-STARTPTS)*${speed.toFixed(8)},fps=${FPS},scale=${aperture.width}:${aperture.height}:force_original_aspect_ratio=decrease,pad=${aperture.width}:${aperture.height}:(ow-iw)/2:(oh-ih)/2:color=0x0b0e19,setsar=1,tpad=stop_mode=clone:stop_duration=${scene.duration}[live]`,
      `[0:v][live]overlay=${aperture.x}:${aperture.y}:shortest=1,trim=duration=${scene.duration},fade=t=in:d=0.18,fade=t=out:st=${Math.max(0, scene.duration - 0.18).toFixed(4)}:d=0.18[out]`,
    ].join(';');
    await runEncoder([
      '-loop', '1', '-framerate', String(FPS), '-i', frame,
      '-ss', String(scene.recordingStart), '-t', String(recordedDuration), '-i', recording,
      '-filter_complex', filter, '-map', '[out]', '-an', '-t', String(scene.duration), ...encodingOptions(), segment,
    ], signal);
    segments.push(segment);
  }
  aborted(signal);
  update(0.94, 'Finishing demo soundtrack and MP4');
  const list = path.join(temporary, 'demo-segments.txt');
  // These names are generated internally, so user paths never enter concat syntax.
  await writeFile(list, segments.map((_, index) => `file 'demo-scene-${index}.mp4'`).join('\n'), 'utf8');
  const duration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  const output = path.join(temporary, 'demo.mp4');
  await runEncoder([
    '-f', 'concat', '-safe', '1', '-i', list, '-f', 'lavfi', '-i', soundtrack(duration),
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-af', `afade=t=in:d=1,afade=t=out:st=${Math.max(0, duration - 1.5)}:d=1.5`,
    '-t', String(duration), '-movflags', '+faststart', output,
  ], signal);
  return output;
}

async function renderPromo(
  project: Project, temporary: string, scenes: TimedScene[], states: FilmState[], page: Page,
  width: number, height: number, update: (progress: number, message: string) => void, signal?: AbortSignal,
): Promise<string> {
  await page.setContent(filmTemplate('promo', width, height, project.brief.brandColor));
  const output = path.join(temporary, 'promo.mp4');
  const totalFrames = scenes.reduce((sum, scene) => sum + scene.frames, 0);
  const duration = totalFrames / FPS;
  const job = encoder([
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
    '-f', 'lavfi', '-i', soundtrack(duration), '-map', '0:v:0', '-map', '1:a:0',
    ...encodingOptions(), '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-af', `afade=t=in:d=1,afade=t=out:st=${Math.max(0, duration - 1.5)}:d=1.5`,
    '-t', String(duration), output,
  ], signal);
  let rendered = 0;
  try {
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      for (let frame = 0; frame < scene.frames; frame += 1) {
        aborted(signal);
        if (job.process.exitCode !== null || job.process.signalCode !== null) { await job.done; throw new Error('Video encoder stopped.'); }
        await setFrame(page, {
          ...states[index], progress: (frame + 0.5) / scene.frames,
          totalProgress: rendered / Math.max(1, totalFrames - 1), time: rendered / FPS,
        });
        const pixels = await page.screenshot({ type: 'jpeg', quality: 94, animations: 'disabled' });
        const input = job.process.stdin;
        if (!input || input.destroyed) { await job.done; throw new Error('Video encoder input closed.'); }
        if (!input.write(pixels)) {
          await Promise.race([once(input, 'drain'), job.done.then(() => { throw new Error('Video encoder closed before receiving all frames.'); })]);
        }
        rendered += 1;
        if (rendered % 15 === 0 || rendered === totalFrames) update(rendered / totalFrames, `Animating promo scene ${index + 1} of ${scenes.length} (${Math.round(rendered / totalFrames * 100)}%)`);
      }
    }
    job.process.stdin?.end();
    await job.done;
  } catch (error) {
    job.stop();
    await job.done.catch(() => {});
    throw error;
  }
  return output;
}

/** Render real local MP4s. Assets never leave the user's machine. */
export async function renderVideos(project: Project, directory: string, kinds: OutputKind[], options: RenderOptions = {}): Promise<VideoOutput[]> {
  const selected = [...new Set(kinds)];
  if (!selected.length || selected.some(kind => kind !== 'demo' && kind !== 'promo')) throw new Error('Select demo, promo, or both video outputs.');
  aborted(options.signal);
  if (!ffmpegAvailable()) throw new Error('FFmpeg is unavailable. Install dependencies or set FFMPEG_PATH to a local executable.');
  const scenes = timeline(project.scenes);
  const width = project.brief.resolution === '1080p' ? 1920 : 1280;
  const height = project.brief.resolution === '1080p' ? 1080 : 720;
  const duration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const renderDirectory = await realpath(directory);
  if (activeDirectories.has(renderDirectory)) throw new Error('This project is already rendering videos.');
  activeDirectories.add(renderDirectory);
  const temporary = await mkdtemp(path.join(directory, '.render-')).catch(error => {
    activeDirectories.delete(renderDirectory);
    throw error;
  });
  let browser: Browser | undefined;
  let abortBrowser: (() => void) | undefined;
  try {
    options.onProgress?.(0, 'Preparing local video assets');
    const cache = new Map<string, string | undefined>();
    const screenshots: (string | undefined)[] = [];
    for (const scene of scenes) {
      const screenshot = scene.screenshot || project.shots.find(shot => shot.screenshot)?.screenshot;
      if (screenshot && !cache.has(screenshot)) cache.set(screenshot, await imageData(directory, screenshot));
      screenshots.push(screenshot ? cache.get(screenshot) : undefined);
    }
    let elapsed = 0;
    const states: FilmState[] = scenes.map((scene, index) => {
      const state: FilmState = {
        name: safeText(project.brief.name, 80), title: safeText(scene.title, 90), caption: safeText(scene.caption, 260),
        feature: safeText(scene.feature || `Chapter ${String(index + 1).padStart(2, '0')}`, 70), url: humanUrl(project.brief.url),
        screenshot: screenshots[index], nextScreenshot: screenshots[(index + 1) % scenes.length], scene: index, scenes: scenes.length,
        progress: 0, totalProgress: elapsed / duration, time: elapsed,
      };
      elapsed += scene.duration;
      return state;
    });
    browser = await chromium.launch({ headless: true });
    abortBrowser = () => { void browser?.close().catch(() => {}); };
    options.signal?.addEventListener('abort', abortBrowser, { once: true });
    aborted(options.signal);
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    // Rendering is offline: the template may only read inlined screenshot data.
    await page.route('**/*', route => route.abort());
    const outputs: VideoOutput[] = [];
    const finished: { temporary: string; output: string }[] = [];
    for (let index = 0; index < selected.length; index += 1) {
      const kind = selected[index];
      const update = (progress: number, message: string) => options.onProgress?.(Math.min(99, Math.round((index + progress) / selected.length * 99)), message);
      const file = kind === 'demo'
        ? await renderDemo(project, directory, temporary, scenes, states, page, width, height, update, options.signal)
        : await renderPromo(project, temporary, scenes, states, page, width, height, update, options.signal);
      aborted(options.signal);
      const relative = `${kind}.mp4`;
      const poster = `${kind}-poster.jpg`;
      const posterFile = path.join(temporary, poster);
      await runEncoder([
        '-ss', String(Math.min(3, duration / 2)), '-i', file,
        '-frames:v', '1', '-q:v', '2', posterFile,
      ], options.signal);
      aborted(options.signal);
      finished.push({ temporary: file, output: path.join(directory, relative) });
      finished.push({ temporary: posterFile, output: path.join(directory, poster) });
      outputs.push({ kind, file: relative, poster, width, height, fps: FPS, duration });
    }
    // Publish only after every requested encode succeeds, preserving previous outputs on failure.
    await writeNarration(temporary, scenes);
    finished.push(...['narration.srt', 'narration.txt'].map(file => ({ temporary: path.join(temporary, file), output: path.join(directory, file) })));
    for (const item of finished) await rename(item.temporary, item.output);
    options.onProgress?.(100, 'Videos ready');
    return outputs;
  } catch (error) {
    if (options.signal?.aborted) throw new Error('Video rendering cancelled.');
    throw error;
  } finally {
    if (abortBrowser) options.signal?.removeEventListener('abort', abortBrowser);
    await browser?.close().catch(() => {});
    activeDirectories.delete(renderDirectory);
    await rm(temporary, { recursive: true, force: true });
  }
}
