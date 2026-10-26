import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { promoTemplate } from '../server/promo-template.js';
import type { FilmState } from '../server/film-state.js';

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const state: FilmState = {
  name: 'SmartSevak', title: 'Keep every lead moving', caption: 'Bring enquiries into one connected flow.',
  feature: 'Leads and enquiries', url: 'https://dashboard.smartsevak.com', scene: 1, scenes: 7,
  progress: .5, totalProgress: .22, time: 7.5,
  subtitle: 'Bring every enquiry into the flow of your work.', subtitleWord: 2,
};
const setState = (page: import('playwright').Page, value: FilmState) => page.evaluate(
  s => (window as unknown as { setFilmState(s: FilmState): Promise<void> }).setFilmState(s), value,
);

test('promo is screenshot-free, offline and treats product copy as text', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.setContent(promoTemplate(1280, 720, '#b09aff'));
  await setState(page, { ...state, title: '<img src=x onerror=alert(1)>', name: '<script>window.injected=true</script>' });
  assert.equal(await page.locator('img, video, iframe, audio, source, object, embed').count(), 0);
  assert.equal(await page.locator('#title').textContent(), '<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('#brand').textContent(), '<script>window.injected=true</script>');
  assert.equal(await page.locator('.sub-word.active').textContent(), 'enquiry');
  assert.deepEqual(requests.filter(url => !url.startsWith('data:')), []);
  await page.close();
});

test('motion changes with the supplied clock and repeating a frame is deterministic', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(promoTemplate(1280, 720, '#b09aff'));
  await setState(page, state);
  const first = await page.screenshot();
  await setState(page, { ...state, time: state.time + 1 });
  const moved = await page.screenshot();
  assert.notDeepEqual(first, moved, 'artwork must move even between entrance and exit');
  await setState(page, state);
  assert.deepEqual(first, await page.screenshot(), 'seeking back must reproduce the same frame');
  await page.close();
});

test('feature, caption, title, subtitles and CTA stay inside both export sizes', async () => {
  for (const [width, height] of [[1280, 720], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(promoTemplate(width, height, '#b09aff'));
    for (const [scene, feature] of ['Introduction', 'Leads', 'Bookings and scheduling', 'Follow-ups', 'Analytics', 'Engagement', 'Explore'].entries()) {
      await setState(page, { ...state, scene, feature, name: 'SmartSevak', title: 'A connected workspace for the work that matters', caption: 'Keep your team connected as your work moves from one stage to the next.', progress: .55 });
      const clipped = await page.locator('.header,.copy,.subtitle,.footer').evaluateAll(elements => elements.filter(element => {
        const r = element.getBoundingClientRect();
        return r.x < 0 || r.y < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
      }).map(element => element.className));
      assert.deepEqual(clipped, [], `clipped copy at ${width} scene ${scene}`);
    }
    assert.equal(await page.locator('#cta-url').textContent(), 'dashboard.smartsevak.com');
    await page.close();
  }
});
