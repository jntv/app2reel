import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { chromium, type Browser, type Page } from 'playwright';
import { DEFAULT_RENDER_SETTINGS, type OutputKind, type Project, type Scene, type VideoOutput } from '../shared/types.js';
import type { FilmState } from './film-state.js';
import { promoTemplate } from './promo-template.js';
import { renderDynamicDemo } from './demo-renderer.js';
import { subtitleAt, subtitleCues, subtitleSrt, subtitleVtt } from './subtitles.js';
import { prepareNarration } from './narration.js';
import { productFontCss, resolveFilmTheme } from './film-theme.js';

const FPS = 30;
const MAX_SECONDS = 90;
const MAX_SCENES = 20;
const activeDirectories = new Set<string>();
type RenderOptions = { signal?: AbortSignal; onProgress?: (progress: number, message: string) => void };
type TimedScene = Scene & { duration: number; frames: number };

/** Compose each format natively; the screen walkthrough always stays landscape. */
export function outputDimensions(project: Pick<Project, 'brief'|'renderSettings'>, kind: OutputKind): {width:number;height:number} {
  const width=project.brief.resolution==='1080p'?1920:1280;
  const height=project.brief.resolution==='1080p'?1080:720;
  return kind==='promo'&&project.renderSettings?.promoAspect==='portrait'?{width:height,height:width}:{width,height};
}

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

/** Original 120 BPM ambient pulse, synthesized offline without fetched audio. */
function soundtrack(duration: number): string {
  const pad='0.022*(sin(2*PI*130.8128*t)+0.5*sin(2*PI*196*t)+0.35*sin(2*PI*261.6256*t))*(0.7+0.3*sin(2*PI*0.125*t))';
  const kick='0.075*sin(2*PI*(52*t+3*(1-exp(-28*mod(t,0.5)))))*exp(-22*mod(t,0.5))';
  const bass='0.028*sin(2*PI*65.4064*t)*exp(-5*mod(t,0.5))';
  const hats='0.007*sin(2*PI*6301*t)*sin(2*PI*8111*t)*exp(-100*mod(t,0.25))';
  return `aevalsrc='${pad}+${kick}+${bass}+${hats}':s=48000:d=${duration}`;
}

async function writeNarration(directory: string, scenes: TimedScene[], cues=subtitleCues(scenes)): Promise<void> {
  await Promise.all([
    writeFile(path.join(directory, 'narration.srt'), subtitleSrt(cues), 'utf8'),
    writeFile(path.join(directory, 'captions.srt'), subtitleSrt(cues), 'utf8'),
    writeFile(path.join(directory, 'captions.vtt'), subtitleVtt(cues), 'utf8'),
    writeFile(path.join(directory, 'narration.txt'), scenes.map(scene => `${safeText(scene.title, 160)}\n${safeText(scene.narration || scene.caption, 1500)}`).join('\n\n'), 'utf8'),
  ]);
}

async function renderPromo(
  project: Project, temporary: string, scenes: TimedScene[], stateAt: (index: number, progress: number, totalFrame: number) => FilmState, page: Page,
  width: number, height: number, update: (progress: number, message: string) => void, signal?: AbortSignal, fontCss='',
): Promise<string> {
  await page.setContent(promoTemplate(width, height, resolveFilmTheme(project)));
  if(fontCss)await page.addStyleTag({content:fontCss});
  await page.evaluate(()=>document.fonts.ready.then(()=>{}));
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
        await setFrame(page, stateAt(index, (frame + 0.5) / scene.frames, rendered));
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
  const initialSize = outputDimensions(project, selected[0]);
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
    const settings = { ...DEFAULT_RENDER_SETTINGS, ...project.renderSettings };
    const totalFrames = scenes.reduce((sum, scene) => sum + scene.frames, 0);
    const narration=settings.narration!==false?await prepareNarration(scenes,temporary,runEncoder,options.signal,{engine:settings.narrationEngine,voice:settings.narrationVoice}):undefined;
    const cues = narration?.cues||subtitleCues(scenes);
    const stateAt = (index: number, progress: number, totalFrame: number): FilmState => {
      const scene = scenes[index];
      const time = (totalFrame + 0.5) / FPS;
      return {
        name: safeText(project.brief.name, 80), title: safeText(scene.title, 160), caption: safeText(scene.caption, 360),
        feature: safeText(scene.feature || `Chapter ${String(index + 1).padStart(2, '0')}`, 100), url: humanUrl(project.brief.url),
        scene: index, scenes: scenes.length, progress, totalProgress: (totalFrame + 0.5) / totalFrames, time, duration:scene.duration,
        motion: settings.motion, focus: scene.focus, focusArea: scene.focusArea, focusRevealAt:scene.focusRevealAt, visualModel: scene.visualModel,
        ...(settings.subtitles ? subtitleAt(cues, time) : { subtitle: '', subtitleWord: -1 }),
      };
    };
    browser = await chromium.launch({ headless: true });
    abortBrowser = () => { void browser?.close().catch(() => {}); };
    options.signal?.addEventListener('abort', abortBrowser, { once: true });
    aborted(options.signal);
    const context = await browser.newContext({ viewport: initialSize, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    // Rendering is offline; neither film can fetch network assets.
    await page.route('**/*', route => route.abort());
    const fontCss=await productFontCss(directory,resolveFilmTheme(project));
    const outputs: VideoOutput[] = [];
    const finished: { temporary: string; output: string }[] = [];
    for (let index = 0; index < selected.length; index += 1) {
      const kind = selected[index];
      const {width,height}=outputDimensions(project,kind);
      await page.setViewportSize({width,height});
      const update = (progress: number, message: string) => options.onProgress?.(Math.min(99, Math.round((index + progress) / selected.length * 99)), message);
      let file = kind === 'demo'
        ? await renderDynamicDemo({ project, directory, temporary, scenes, page, width, height, fps: FPS,
          recording: await containedFile(directory, project.recording || ''), update, signal: options.signal, stateAt,
          encoder, runEncoder, encodingOptions, soundtrack, theme:resolveFilmTheme(project),fontCss })
        : await renderPromo(project, temporary, scenes, stateAt, page, width, height, update, options.signal,fontCss);
      aborted(options.signal);
      if(narration){
        const narrated=path.join(temporary,`${kind}-narrated.mp4`);
        await runEncoder(['-i',file,'-i',narration.file,'-f','lavfi','-i',soundtrack(duration),'-filter_complex',`[2:a]volume=0.18,afade=t=in:d=0.7,afade=t=out:st=${Math.max(0,duration-1)}:d=1[music];[1:a][music]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[audio]`,'-map','0:v:0','-map','[audio]','-c:v','copy','-c:a','aac','-b:a','192k','-ac','2','-t',String(duration),'-movflags','+faststart',narrated],options.signal);
        file=narrated;
      }
      const relative = `${kind}.mp4`;
      const poster = `${kind}-poster.jpg`;
      const posterFile = path.join(temporary, poster);
      const posterTime = kind==='promo'&&scenes.length>1 ? scenes[0].duration+scenes[1].duration/2 : Math.min(3,duration/2);
      await runEncoder([
        '-ss', String(posterTime), '-i', file,
        '-frames:v', '1', '-q:v', '2', posterFile,
      ], options.signal);
      aborted(options.signal);
      finished.push({ temporary: file, output: path.join(directory, relative) });
      finished.push({ temporary: posterFile, output: path.join(directory, poster) });
      outputs.push({ kind, file: relative, poster, width, height, fps: FPS, duration, narrated:!!narration, revision:randomUUID() });
    }
    // Publish only after every requested encode succeeds, preserving previous outputs on failure.
    await writeNarration(temporary, scenes,cues);
    finished.push(...['narration.srt', 'narration.txt', 'captions.srt', 'captions.vtt'].map(file => ({ temporary: path.join(temporary, file), output: path.join(directory, file) })));
    if(narration)finished.push(...['narration.wav','narration-timing.json'].map(file=>({temporary:path.join(temporary,file),output:path.join(directory,file)})));
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
