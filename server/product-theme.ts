import { chromium, type Page } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import path from 'node:path';
import type { ProductTheme, ProductVisualModel, Project, PrivacyMask, Shot } from '../shared/types.js';

type Swatch = { color: string; weight: number };
interface ThemeEvidence {
  sourceUrl: string;
  accent: Swatch[]; background: Swatch[]; surface: Swatch[]; text: Swatch[]; mutedText: Swatch[]; border: Swatch[]; secondary: Swatch[];
  fonts: { family: string; weight: number }[];
  radii: { radius: number; weight: number }[];
  headings: string[];
  labels: string[];
  focusArea?: PrivacyMask;
  structure: { table: boolean; calendar: boolean; form: boolean; chart: boolean; cards: number };
}

function cleanURL(value: string) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.origin + url.pathname : ''; } catch { return ''; } }
const hexColor = /^#[a-f\d]{6}$/i;
function rgb(color: string) { return [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16)); }
function saturation(color: string) { const channels = rgb(color); return (Math.max(...channels) - Math.min(...channels)) / Math.max(1, ...channels); }
function brightness(color: string) { const [r, g, b] = rgb(color); return (r * .2126 + g * .7152 + b * .0722) / 255; }
function chooseColor(swatches: Swatch[], fallback: string, filter: (color: string) => boolean = () => true) {
  const scores = new Map<string, number>();
  for (const item of swatches) if (hexColor.test(item.color) && Number.isFinite(item.weight) && item.weight > 0 && filter(item.color)) scores.set(item.color.toLowerCase(), (scores.get(item.color.toLowerCase()) || 0) + item.weight);
  return [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || fallback;
}

/** Computed font names are data, never CSS declarations or font downloads. */
export function sanitizeFontFamily(value: string) {
  const first = value.split(',')[0]?.trim().replace(/^["']|["']$/g, '') || '';
  return /^[\p{L}\p{N} _-]{1,64}$/u.test(first) ? first : 'system-ui';
}

/**
 * Labels deliberately use a closed UI vocabulary plus the user's feature words.
 * This excludes arbitrary card, row, profile and customer text from visual models.
 */
export function safeVisualLabel(value: string, features: string[] = []) {
  const label = value.replace(/[^\p{L}\p{N}\s&/+-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!label || label.length > 64 || /[\d@]|https?:|www\./i.test(value)) return undefined;
  const vocabulary = new Set(('dashboard overview highlights performance leads lead bookings booking appointments appointment reminders reminder analytics analysis reports reporting report calendar schedule scheduling team teams projects project users user doctors doctor patients patient engagement workflows workflow settings integrations forms form campaigns campaign messages message conversations conversation tasks task activities activity contacts contact details summary insights statistics metrics workspace home navigation search filter filters sort view more all active archived list grid board date range branch branches select open close next previous today week month year this last new add create edit manage export import download upload received resolved resolution response rate delivery progress completion total pending upcoming completed notifications notification help support billing account profile organization organisation general channels channel email sms whatsapp marketing automation automations calls call events event clinic clinics services service locations location resource resources staff resources settings preferences appointment reminder service management assistant inbox templates template assets files file documents document data records record contact center centre control panel audit logs log security access roles role permissions permission status latest recent history options actions action cancel save done apply back continue confirm from to by and or of the a an your my for in on & / + -').split(/\s+/));
  for (const feature of features) for (const word of feature.toLowerCase().match(/[\p{L}]+/gu) || []) vocabulary.add(word);
  const words = label.toLowerCase().split(/\s+/);
  if (!words.every(word => vocabulary.has(word))) return undefined;
  return label;
}

function visualModel(evidence: ThemeEvidence, features: string[], accent: string): ProductVisualModel {
  const labels = [...new Set(evidence.labels.map(label => safeVisualLabel(label, features)).filter((label): label is string => !!label))].slice(0, 12);
  const heading = evidence.headings.map(label => safeVisualLabel(label, features)).find(Boolean);
  const context = `${heading || ''} ${labels.slice(0, 4).join(' ')}`;
  const layout: ProductVisualModel['layout'] = evidence.structure.calendar || /calendar|schedule|booking|appointment/i.test(heading || '') ? 'calendar'
    : evidence.structure.chart || /analytic|report|performance/i.test(heading || '') ? 'analytics'
      : evidence.structure.table ? 'table' : evidence.structure.form ? 'form' : evidence.structure.cards >= 3 || /dashboard|overview/i.test(context) ? 'dashboard' : 'workspace';
  return { ...(heading ? { heading } : {}), labels, layout, accent };
}

/** Read only rendered CSS and safe navigation/control labels from the current product page. */
export async function extractProductDesign(page: Page, features: string[] = []): Promise<{ theme: ProductTheme; visualModel: ProductVisualModel; focusArea?: PrivacyMask }> {
  const evidence = await page.evaluate((): ThemeEvidence => {
    const result: ThemeEvidence = { sourceUrl: location.origin + location.pathname, accent: [], background: [], surface: [], text: [], mutedText: [], border: [], secondary: [], fonts: [], radii: [], headings: [], labels: [], structure: { table: false, calendar: false, form: false, chart: false, cards: 0 } };
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    // Object methods retain their native names when serialized by Playwright.
    const helpers = { color(value: string) {
      if (!context || !value || !CSS.supports('color', value)) return undefined;
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return a >= 220 ? '#' + [r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('') : undefined;
    }, swatch(bucket: Swatch[], value: string, weight: number) { const normalized = helpers.color(value); if (normalized) bucket.push({ color: normalized, weight }); }, visible(element: HTMLElement) {
      const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return box.width > 3 && box.height > 3 && box.top < innerHeight && box.bottom > 0 && box.left < innerWidth && box.right > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > .05;
    } };
    const roots = [document.documentElement, document.body, ...Array.from(document.querySelectorAll<HTMLElement>('main,[role=main],#root,#app'))];
    roots.forEach((element, index) => {
      if (!element) return; const style = getComputedStyle(element);
      helpers.swatch(result.background, style.backgroundColor, index === 1 ? 100 : 60);
      helpers.swatch(result.text, style.color, index === 1 ? 100 : 20);
      result.fonts.push({ family: style.fontFamily, weight: index === 1 ? 100 : 20 });
      for (const name of ['--primary', '--primary-color', '--brand', '--brand-color', '--accent', '--accent-color', '--color-primary', '--bs-primary']) {
        const value = style.getPropertyValue(name).trim();
        helpers.swatch(result.accent, CSS.supports('color', value) ? value : `hsl(${value})`, /primary|brand/.test(name) ? 150 : 70);
      }
    });
    const elements = Array.from(document.querySelectorAll<HTMLElement>('body *')).slice(0, 8000).filter(element => !element.closest('#capture-cursor,script,style,canvas,svg,img,video,iframe')).filter(helpers.visible).slice(0, 1800);
    for (const element of elements) {
      const style = getComputedStyle(element), box = element.getBoundingClientRect();
      const area = Math.min(box.width, innerWidth) * Math.min(box.height, innerHeight) / (innerWidth * innerHeight);
      const control = element.matches('button,[role=button],[role=tab],a');
      const selected = element.matches('[aria-selected=true],[aria-current],.active,.selected,[data-state=active]');
      if (control || selected) {
        helpers.swatch(result.accent, style.backgroundColor, selected ? 25 : 12);
        helpers.swatch(result.accent, style.color, selected ? 12 : 4);
        helpers.swatch(result.accent, style.borderColor, selected ? 8 : 2);
      }
      if (area > .012 && area < .8) helpers.swatch(result.surface, style.backgroundColor, Math.sqrt(area) * 30);
      if (element.matches('nav,aside,[role=navigation],header')) helpers.swatch(result.secondary, style.backgroundColor, 40 + area * 10);
      if (element.matches('p,span,label,small,h1,h2,h3,h4,td,th,button,a') && element.children.length < 4) {
        helpers.swatch(result.text, style.color, 1);
        if (element.matches('small,label,[class*=muted],[class*=secondary],[class*=subtitle],[class*=description]')) helpers.swatch(result.mutedText, style.color, 4);
        else helpers.swatch(result.mutedText, style.color, .3);
        result.fonts.push({ family: style.fontFamily, weight: 1 });
      }
      if (parseFloat(style.borderTopWidth) > 0) helpers.swatch(result.border, style.borderTopColor, Math.max(1, area * 10));
      const radius = parseFloat(style.borderTopLeftRadius);
      if (radius > 0 && radius <= 40 && (area > .01 || control)) result.radii.push({ radius, weight: area > .01 ? 3 : 1 });
      if (area > .025 && area < .3 && radius > 0 && helpers.color(style.backgroundColor)) result.structure.cards++;
      if (element.matches('h1,h2,[role=heading]')) result.headings.push(element.innerText.trim().slice(0, 100));
      if (element.matches('button,[role=button],[role=tab],nav a,aside a,[role=navigation] a')) result.labels.push((element.getAttribute('aria-label') || element.innerText || '').trim().slice(0, 100));
      if (element.matches('table,[role=table],[role=grid]')) result.structure.table = true;
      if (element.matches('[class*=calendar],[role=grid][aria-label*=calendar i]')) result.structure.calendar = true;
      if (element.matches('form') && element.querySelectorAll('input:not([type=hidden]),select,textarea').length >= 3) result.structure.form = true;
      if (element.matches('[class*=chart],[class*=recharts],[aria-label*=chart i]')) result.structure.chart = true;
    }
    // Use the measured dialog/drawer, or a real semantic main region. No guessed rectangle.
    const focus = elements.filter(element => element.matches('[role=dialog],dialog[open],[aria-modal=true],[class*=MuiDrawer-paper]'))
      .sort((a, b) => { const first = a.getBoundingClientRect(), second = b.getBoundingClientRect(); return second.width * second.height - first.width * first.height; })[0]
      || elements.find(element => element.matches('main,[role=main]') && element.getBoundingClientRect().width > innerWidth * .4);
    if (focus) {
      const box = focus.getBoundingClientRect(), x = Math.max(0, box.left) / innerWidth, y = Math.max(0, box.top) / innerHeight;
      const width = (Math.min(innerWidth, box.right) - Math.max(0, box.left)) / innerWidth, height = (Math.min(innerHeight, box.bottom) - Math.max(0, box.top)) / innerHeight;
      if (width > .05 && height > .08) result.focusArea = { x, y, width, height };
    }
    return result;
  });
  const background = chooseColor(evidence.background, '#f6f7f9');
  const text = chooseColor(evidence.text, brightness(background) > .5 ? '#172033' : '#f7f9fc', color => Math.abs(brightness(color) - brightness(background)) > .35);
  const accent = chooseColor(evidence.accent, text, color => saturation(color) > .28 && brightness(color) > .12 && brightness(color) < .85);
  const surface = chooseColor(evidence.surface, background);
  const mutedText = chooseColor(evidence.mutedText, text, color => saturation(color) < .6 && Math.abs(brightness(color) - brightness(background)) > .15 && color !== text);
  const border = chooseColor(evidence.border, brightness(background) > .5 ? '#dce1e7' : '#344052', color => saturation(color) < .4 && Math.abs(brightness(color) - brightness(background)) < .4);
  const secondary = chooseColor(evidence.secondary, text, color => color !== background && color !== surface && color !== accent);
  const fontScores = new Map<string, number>();
  for (const candidate of evidence.fonts) { const font = sanitizeFontFamily(candidate.family); fontScores.set(font, (fontScores.get(font) || 0) + candidate.weight); }
  const fontFamily = [...fontScores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'system-ui';
  const radiusScores = new Map<number, number>();
  for (const candidate of evidence.radii) { const radius = Math.min(32, Math.round(candidate.radius)); radiusScores.set(radius, (radiusScores.get(radius) || 0) + candidate.weight); }
  const radius = [...radiusScores].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 12;
  const theme: ProductTheme = { accent, secondary, background, surface, text, mutedText, border, fontFamily, radius, sourceUrl: cleanURL(evidence.sourceUrl), extractedAt: new Date().toISOString(), source: 'computed' };
  return { theme, visualModel: visualModel(evidence, features, accent), ...(evidence.focusArea ? { focusArea: evidence.focusArea } : {}) };
}

interface FontSource { url: string; score: number; stylesheet?: string; }
const MAX_FONT_BYTES = 2 * 1024 * 1024;

/** Linked font CSS commonly declares a different HTTPS CDN, e.g. Google Fonts. */
export function isSupportedFontSource(value: string, stylesheetURL: string, loaded: string[] = []) {
  try {
    const url = new URL(value), stylesheet = new URL(stylesheetURL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    if (url.origin === stylesheet.origin || loaded.includes(url.href)) return true;
    // Third-party copies must use public HTTPS. Local HTTP fixture/product fonts
    // are supported only on their own stylesheet origin or when already loaded.
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && stylesheet.protocol === 'https:' && host.includes('.') && !/^[\d.]+$|:/.test(host) && !/(?:^|\.)(?:localhost|local|internal|test)$/.test(host);
  } catch { return false; }
}

/** The streaming cap applies even when a server omits or lies about Content-Length. */
async function boundedPublicGet(url: string, limit: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 12_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error', credentials: 'omit', headers: { Accept: '*/*' } });
    if (!response.ok || !response.body || Number(response.headers.get('content-length') || 0) > limit) throw new Error('Unsupported product asset');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) { controller.abort(); throw new Error('Product asset exceeds its local size limit'); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); controller.abort(); }
}

function fontExtension(bytes: Buffer) {
  if (bytes.length < 48 || bytes.length > MAX_FONT_BYTES) return undefined;
  const magic = bytes.subarray(0, 4).toString('latin1');
  return magic === 'wOF2' ? 'woff2' : magic === 'wOFF' ? 'woff' : magic === 'OTTO' ? 'otf' : bytes.readUInt32BE(0) === 0x00010000 ? 'ttf' : undefined;
}

/** Store only a bounded real font used by the product's computed body family. No cookies are copied. */
export async function captureProductFont(page: Page, directory: string, fontFamily: string, signal?: AbortSignal): Promise<string | undefined> {
  const family = sanitizeFontFamily(fontFamily).toLowerCase();
  if (['system-ui', 'sans-serif', 'serif', 'monospace', 'arial', 'helvetica', '-apple-system', 'blinkmacsystemfont'].includes(family)) return undefined;
  const evidence = await page.evaluate((wantedFamily: string) => {
    const sources: FontSource[] = [], inaccessible: string[] = [];
    for (const sheet of Array.from(document.styleSheets).slice(0, 24)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (!(rule instanceof CSSFontFaceRule) || rule.style.fontFamily.replace(/["']/g, '').trim().toLowerCase() !== wantedFamily) continue;
          const score = (/normal|^$/.test(rule.style.fontStyle) ? 4 : 0) + (/400|normal/.test(rule.style.fontWeight) ? 3 : 0) + (/u\+0{1,4}-00ff/i.test(rule.style.getPropertyValue('unicode-range')) ? 10 : 0);
          for (const match of rule.style.getPropertyValue('src').matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
            try { const url = new URL(match[1], sheet.href || location.href); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) sources.push({ url: url.href, score, stylesheet: sheet.href || location.href }); } catch { /* Invalid CSS source. */ }
          }
        }
      } catch { if (sheet.href) inaccessible.push(sheet.href); }
    }
    const loaded = performance.getEntriesByType('resource').map(entry => entry.name).filter(url => /\.(woff2?|ttf|otf)(?:\?|$)/i.test(url));
    return { sources, inaccessible, loaded, origin: location.origin };
  }, family);
  const candidates = evidence.sources.filter(source => isSupportedFontSource(source.url, source.stylesheet || evidence.origin, evidence.loaded));
  const fontSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000);
  // Cross-origin CSSOM is inaccessible. Read up to three actual linked stylesheets,
  // including their declared public HTTPS font CDN sources.
  for (const sheetURL of evidence.inaccessible.slice(0, candidates.length ? 0 : 3)) {
    if (signal?.aborted) throw new Error('Run cancelled');
    try {
      const sheet = new URL(sheetURL);
      if (!['http:', 'https:'].includes(sheet.protocol) || sheet.username || sheet.password) continue;
      const css = (await boundedPublicGet(sheet.href, 256 * 1024, fontSignal)).toString('utf8');
      for (const rule of css.match(/@font-face\s*\{[^{}]{0,12000}\}/gi) || []) {
        const declared = rule.match(/font-family\s*:\s*([^;]+);/i)?.[1]?.replace(/["']/g, '').trim().toLowerCase();
        if (declared !== family) continue;
        const score = (/font-style\s*:\s*normal/i.test(rule) ? 4 : 0) + (/font-weight\s*:\s*(400|normal)/i.test(rule) ? 3 : 0) + (/u\+0{1,4}-00ff/i.test(rule) ? 10 : 0);
        for (const match of rule.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
          const url = new URL(match[1], sheet.href);
          if (isSupportedFontSource(url.href, sheet.href, evidence.loaded)) candidates.push({ url: url.href, score, stylesheet: sheet.href });
        }
      }
    } catch { if (signal?.aborted) throw new Error('Run cancelled'); }
  }
  const loaded = new Set(evidence.loaded);
  candidates.sort((a, b) => b.score - a.score || Number(loaded.has(b.url)) - Number(loaded.has(a.url)) || a.url.localeCompare(b.url));
  for (const candidate of [...new Map(candidates.map(item => [item.url, item])).values()].slice(0, 4)) {
    if (signal?.aborted) throw new Error('Run cancelled');
    try {
      const bytes = await boundedPublicGet(candidate.url, MAX_FONT_BYTES, fontSignal), extension = fontExtension(bytes);
      if (!extension) continue;
      const filename = `product-font-${createHash('sha256').update(bytes).digest('hex').slice(0, 20)}.${extension}`;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(directory, filename), bytes, { mode: 0o600 });
      return filename;
    } catch { if (signal?.aborted) throw new Error('Run cancelled'); }
  }
  return undefined;
}

/** Refresh styling through the app's own unrecorded, read-only public product browser. */
export async function refreshProductDesign(project: Pick<Project, 'brief'>, directory: string, signal?: AbortSignal): Promise<{ theme: ProductTheme; visualModel: ProductVisualModel; focusArea?: PrivacyMask }> {
  const browser = await chromium.launch({ headless: true });
  const cancel = () => { void browser.close().catch(() => {}); };
  if (signal?.aborted) { await browser.close(); throw new Error('Run cancelled'); }
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const origins = new Set([new URL(project.brief.url).origin, ...project.brief.allowedOrigins.map(value => new URL(value).origin)]);
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, acceptDownloads: false, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const request = route.request();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.abort('blockedbyclient');
      if (request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame() && !origins.has(new URL(request.url()).origin)) return route.abort('blockedbyclient');
      return route.continue();
    });
    const page = await context.newPage();
    page.on('dialog', dialog => void dialog.dismiss()); page.on('download', download => void download.cancel());
    context.on('page', popup => { if (popup !== page) void popup.close(); });
    await page.goto(project.brief.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(900);
    if (signal?.aborted) throw new Error('Run cancelled');
    const design = await extractProductDesign(page, project.brief.features);
    const fontAsset = await captureProductFont(page, directory, design.theme.fontFamily, signal);
    if (fontAsset) design.theme.fontAsset = fontAsset;
    return design;
  } finally { signal?.removeEventListener('abort', cancel); await browser.close().catch(() => {}); }
}

async function screenshotPalette(filename: string, signal?: AbortSignal) {
  if (!ffmpegPath || (await stat(filename)).size > 15 * 1024 * 1024) throw new Error('Unsupported local screenshot');
  const width = 640, height = 360, maxBytes = width * height * 3;
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpegPath!, ['-v', 'error', '-i', filename, '-vf', `scale=${width}:${height}:flags=neighbor`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'], signal });
    const chunks: Buffer[] = []; let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.stdout!.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) { child.kill('SIGKILL'); reject(new Error('Unsupported screenshot dimensions')); } else chunks.push(chunk); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code === 0 && size === maxBytes) resolve(Buffer.concat(chunks)); else reject(new Error('Local screenshot decoding failed')); });
  });
  const histogram = new Map<string, number>(); let light = 0, dark = 0;
  for (let at = 0; at < bytes.length; at += 3) {
    const color = '#' + bytes.subarray(at, at + 3).toString('hex'), count = histogram.get(color) || 0;
    histogram.set(color, count + 1);
    const luma = brightness(color); if (luma > .88 && saturation(color) < .15) light++; if (luma < .18) dark++;
  }
  const colors = [...histogram].sort((a, b) => b[1] - a[1]).slice(0, 220).map(([color, weight]) => ({ color, weight }));
  const dominant = colors[0]?.color || '#ffffff';
  // A large flat mid-gray field is normally a dimmed modal backdrop, not product branding.
  const dimmed = brightness(dominant) > .25 && brightness(dominant) < .7 && saturation(dominant) < .1 && light > width * height * .03;
  return { colors, quality: dimmed ? 0 : (light + dark * .3) / (width * height), pixels: width * height };
}

/**
 * Reuse already-recorded authenticated evidence when a public refresh lands on sign-in.
 * Only local RGB histograms leave the decoder; no OCR, account text or model requests.
 * Computed typography/fontAsset and corner treatment are retained from the product.
 */
export async function refineThemeFromScreenshots(directory: string, shots: Pick<Shot, 'screenshot'|'url'>[], theme: ProductTheme, signal?: AbortSignal): Promise<ProductTheme> {
  const candidates = shots.filter(shot => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.png$/i.test(shot.screenshot) && path.basename(shot.screenshot) === shot.screenshot);
  const indices = [...new Set(Array.from({ length: Math.min(6, candidates.length) }, (_, index) => Math.round(index * (candidates.length - 1) / Math.max(1, Math.min(6, candidates.length) - 1))))];
  const palettes: Awaited<ReturnType<typeof screenshotPalette>>[] = [];
  for (const index of indices) {
    if (signal?.aborted) throw new Error('Run cancelled');
    try { palettes.push(await screenshotPalette(path.join(directory, candidates[index].screenshot), signal)); } catch { if (signal?.aborted) throw new Error('Run cancelled'); }
  }
  if (!palettes.length) return theme;
  const bestQuality = Math.max(...palettes.map(palette => palette.quality));
  const selected = palettes.filter(palette => palette.quality > 0 && palette.quality >= bestQuality * .8);
  if (!selected.length) return theme;
  const colors = selected.flatMap(palette => palette.colors), total = selected.reduce((sum, palette) => sum + palette.pixels, 0);
  const dark = chooseColor(colors, theme.secondary || theme.text, color => brightness(color) < .28 && saturation(color) < .7);
  const dominant = chooseColor(colors, theme.background, color => saturation(color) < .18);
  const lightProduct = brightness(dominant) > .6;
  const background = chooseColor(colors, theme.background, color => saturation(color) < .1 && (lightProduct ? brightness(color) > .88 && color !== '#ffffff' : brightness(color) < .23));
  const surface = chooseColor(colors, theme.surface, color => saturation(color) < .13 && color !== background && (lightProduct ? brightness(color) > .94 : brightness(color) > brightness(background) + .025 && brightness(color) < .35));
  const secondary = lightProduct ? dark : theme.secondary || theme.text;
  const accentColors = colors.map(item => {
    const distance = Math.sqrt(rgb(item.color).reduce((sum, value, channel) => sum + (value - rgb(theme.accent)[channel]) ** 2, 0)) / 441.7;
    return { color: item.color, weight: item.weight * (1 + 2 * Math.max(0, 1 - distance * 2)) };
  });
  const accent = chooseColor(accentColors, theme.accent, color => color !== secondary && saturation(color) > .45 && brightness(color) > .24 && brightness(color) < .78);
  const text = chooseColor(colors, theme.text, color => color !== secondary && saturation(color) < .65 && (lightProduct ? brightness(color) < .15 : brightness(color) > .83));
  const mutedText = chooseColor(colors, theme.mutedText, color => saturation(color) < .4 && brightness(color) > .26 && brightness(color) < .57 && color !== secondary && color !== text);
  const border = chooseColor(colors, theme.border, color => saturation(color) < .15 && Math.abs(brightness(color) - brightness(background)) > .025 && Math.abs(brightness(color) - brightness(background)) < .25);
  // A font hint or antialiased edge cannot win a palette without visible area support.
  const support = (color: string) => colors.reduce((sum, item) => sum + (item.color === color ? item.weight : 0), 0);
  return { ...theme, background, surface, secondary, accent: support(accent) >= total * .0001 ? accent : theme.accent, text, mutedText, border, source: 'screenshots', sourceUrl: cleanURL(candidates[0]?.url || theme.sourceUrl), extractedAt: new Date().toISOString() };
}
