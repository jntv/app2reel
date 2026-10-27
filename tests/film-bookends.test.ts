import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { bookendClosingColor, filmBookendState } from '../server/film-bookends.js';
import { demoTemplate } from '../server/demo-template.js';
import { promoTemplate } from '../server/promo-template.js';
import type { FilmState } from '../server/film-state.js';
import type { ProductTheme } from '../shared/types.js';

test('a pale secondary becomes a readable closing base while the approved navy stays intact', () => {
  assert.equal(bookendClosingColor('#1e293b'), '#1e293b');
  for (const source of ['#e8f4fc', '#ffffff', '#faff00', '#00ffff']) {
    const target = bookendClosingColor(source), rgb = [1, 3, 5].map(i => Number.parseInt(target.slice(i, i + 2), 16) / 255);
    const luminance = rgb.reduce((sum, channel, i) => sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i], 0);
    assert.ok(luminance <= .055, `${source} leaves insufficient contrast headroom for the accent glow`);
    const original = [1, 3, 5].map(i => Number.parseInt(source.slice(i, i + 2), 16));
    const ratios = original.flatMap((channel, i) => channel ? [rgb[i] * 255 / channel] : []);
    assert.ok(Math.max(...ratios) - Math.min(...ratios) < .01, 'darkening must preserve the relative channel proportions');
  }
});

test('bookends keep the reviewed voice clock and leave room for the product', () => {
  assert.deepEqual(filmBookendState(0, 8.033333333, true, false, 'demo'), { kind: 'intro', opacity: 1, reveal: 0 });
  assert.equal(filmBookendState(3, 8.033333333, true, false, 'demo').opacity, 1);
  const dissolve = filmBookendState(4.825, 8.033333333, true, false, 'demo');
  assert.ok(Math.abs(dissolve.opacity - .5) < .00001);
  assert.equal(filmBookendState(5.2, 8.033333333, true, false, 'demo').kind, 'none');
  assert.equal(filmBookendState(4.9, 6.866666667, true, false, 'promo').kind, 'none');
  assert.equal(filmBookendState(2.19, 10.8, false, true, 'demo').kind, 'none');
  assert.ok(filmBookendState(2.6, 10.8, false, true, 'demo').opacity > .45);
  assert.deepEqual(filmBookendState(10.8, 10.8, false, true, 'demo'), { kind: 'outro', opacity: 1, reveal: 1 });
  for (const duration of [0, 1, 2, 3, 5, 10, 30]) {
    let productFrames = 0;
    for (let frame = 0; frame < duration * 30; frame++) {
      const state = filmBookendState(frame / 30, duration, true, true, 'promo');
      assert.ok(Number.isFinite(state.opacity) && state.opacity >= 0 && state.opacity <= 1);
      assert.ok(Number.isFinite(state.reveal) && state.reveal >= 0 && state.reveal <= 1);
      if (state.kind === 'none') productFrames++;
    }
    assert.ok(productFrames >= Math.min(duration * 30, 59), `a ${duration}s single scene must retain its product beat`);
  }
  assert.deepEqual(filmBookendState(Number.NaN, Number.NaN, true, true, 'demo'), { kind: 'none', opacity: 0, reveal: 0 });
});

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const theme: ProductTheme = { accent: '#0a8fdc', secondary: '#1e293b', background: '#fafafa', surface: '#ffffff', text: '#111827', mutedText: '#647080', border: '#e0e0e0', radius: 8, fontFamily: 'Arial,sans-serif', source: 'computed', sourceUrl: 'https://product.test', extractedAt: '' };
const base: FilmState = { name: 'SmartSevak', title: 'A clearer clinic day', caption: 'Leads, bookings, and follow-ups in one shared workspace.', feature: 'Dashboard', url: 'https://dashboard.smartsevak.com/signin?secret=never-display#token', scene: 0, scenes: 3, duration: 8, progress: .3, totalProgress: .1, time: 2.4, subtitle: 'A shared workspace for your clinic.', subtitleWord: 2, externalTransitions: true };
const set = (page: Page, kind: 'demo' | 'promo', value: FilmState) => page.evaluate(({ kind, value }) => {
  const api = window as unknown as { setDemoState(p: unknown): void; setFilmState(s: FilmState): void };
  return kind === 'demo' ? api.setDemoState({ film: value, openingOpacity: 1, closingOpacity: 1, cursorHighlights: true }) : api.setFilmState(value);
}, { kind, value });

test('both film formats have full-screen, readable brand bookends above the product and below captions', async () => {
  for (const [kind, width, height] of [['demo', 1280, 720], ['demo', 1920, 1080], ['promo', 720, 1280], ['promo', 1080, 1920]] as const) {
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      const requests: string[] = [];
      page.on('request', r => requests.push(r.url()));
      await page.setContent(kind === 'demo' ? demoTemplate(width, height, theme) : promoTemplate(width, height, theme));
      for (const bookend of [{ kind: 'intro' as const, opacity: 1, reveal: 1 }, { kind: 'outro' as const, opacity: 1, reveal: 1 }]) {
        await set(page, kind, { ...base, bookend });
        const geometry = await page.evaluate(() => {
          const layer = document.getElementById('film-bookend')!, r = layer.getBoundingClientRect();
          const subtitle = document.querySelector('.subtitles,.subtitle-safe')!;
          const clips = Array.from(layer.querySelectorAll('.bookend-name,.bookend-tagline,.bookend-url')).filter(e => {
            if (!e.checkVisibility()) return false;
            const box = e.getBoundingClientRect();
            return box.left < 0 || box.top < 0 || box.right > innerWidth + 1 || box.bottom > innerHeight - 80 * innerWidth / 1280;
          }).map(e => e.className);
          return { box: [r.left, r.top, r.width, r.height], layerZ: Number(getComputedStyle(layer).zIndex), subtitleZ: Number(getComputedStyle(subtitle).zIndex), clips, opacity: getComputedStyle(layer).opacity };
        });
        assert.deepEqual(geometry.box, [0, 0, width, height]);
        assert.equal(geometry.opacity, '1');
        assert.ok(geometry.subtitleZ > geometry.layerZ, 'narration captions must remain visible over the brand card');
        assert.deepEqual(geometry.clips, [], `${kind} ${width} ${bookend.kind} copy clips`);
        assert.equal(await page.locator('#bookend-name').textContent(), 'SmartSevak');
        assert.equal(await page.locator('#bookend-eyebrow').textContent(), bookend.kind === 'intro' ? 'Introducing' : 'Explore');
        assert.equal(await page.locator('#bookend-url').textContent(), 'dashboard.smartsevak.com', 'CTA displays a clean domain without login path or query data');
        if (kind === 'demo') assert.equal(await page.locator('.identity:visible').count(), 0, 'old identity chips must not duplicate the full brand card');
        if (kind === 'promo') assert.equal(await page.locator('#stage').getAttribute('data-phase'), 'product', 'new bookends replace the old embedded brand phases');
      }
      assert.deepEqual(requests.filter(url => !url.startsWith('data:')), [], 'brand layers render without network assets');
      await set(page, kind, { ...base, bookend: { kind: 'none', opacity: 0, reveal: 0 } });
      assert.equal(await page.locator('#film-bookend').isVisible(), false);
      if (kind === 'demo') assert.equal(await page.locator('.identity:visible').count(), 0);
    } finally { await page.close(); }
  }
});

test('bookend seeking is deterministic and long or hostile copy stays plain text', async () => {
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  try {
    await page.setContent(promoTemplate(720, 1280, theme));
    const state: FilmState = { ...base, name: '<img src=x onerror=alert(1)>', bookend: { kind: 'intro', opacity: .7, reveal: .8, tagline: 'A useful product story '.repeat(16).slice(0, 360) } };
    await set(page, 'promo', state);
    const first = await page.locator('#film-bookend').evaluate(e => e.outerHTML);
    assert.equal(await page.locator('#film-bookend img, #film-bookend script').count(), 0);
    assert.equal(await page.locator('#bookend-name').textContent(), state.name);
    const clipped = await page.locator('#bookend-name,#bookend-tagline').evaluateAll(nodes => nodes.filter(e => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().bottom > innerHeight - 120).length);
    assert.equal(clipped, 0);
    await set(page, 'promo', { ...state, bookend: { kind: 'outro', opacity: 1, reveal: 1 } });
    await set(page, 'promo', state);
    assert.equal(await page.locator('#film-bookend').evaluate(e => e.outerHTML), first);
  } finally { await page.close(); }
});

test('maximum product and value copy keep their domain clear of the subtitle safe zone', async () => {
  for (const [kind, width, height] of [['demo', 1280, 720], ['promo', 720, 1280]] as const) {
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      await page.setContent(kind === 'demo' ? demoTemplate(width, height, theme) : promoTemplate(width, height, theme));
      for (const type of ['intro', 'outro'] as const) {
        await set(page, kind, { ...base, name: 'ConnectedProductWorkspace'.repeat(4).slice(0, 80), bookend: { kind: type, opacity: 1, reveal: 1, tagline: 'Manage the work that matters in your connected product workspace. '.repeat(6).slice(0, 360) } });
        const collisions = await page.evaluate(() => {
          const subtitle = document.querySelector('.subtitles,.subtitle-safe')!.getBoundingClientRect();
          return Array.from(document.querySelectorAll('#bookend-eyebrow,#bookend-name,#bookend-tagline,.bookend-url')).filter(e => {
            if (!e.checkVisibility()) return false;
            const r = e.getBoundingClientRect();
            return r.top < 25 || r.bottom > subtitle.top - 20 || r.left < 24 || r.right > innerWidth - 24;
          }).map(e => e.id || e.className);
        });
        assert.deepEqual(collisions, [], `${kind} maximum ${type} copy intrudes on the subtitle or canvas margin`);
      }
    } finally { await page.close(); }
  }
});
