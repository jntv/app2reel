import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium, type Browser } from 'playwright';
import { promoTemplate } from '../server/promo-template.js';
import type { FilmState } from '../server/film-state.js';
import type { ProductTheme } from '../shared/types.js';

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const state: FilmState = {
  name: 'SmartSevak', title: 'Keep every lead moving', caption: 'Bring enquiries into one connected flow.',
  feature: 'Leads and enquiries', url: 'https://dashboard.smartsevak.com', scene: 1, scenes: 7,
  progress: .5, totalProgress: .22, time: 7.5,
  subtitle: 'Bring every enquiry into the flow of your work.', subtitleWord: 2,
};
const productTheme: ProductTheme = {
  accent: '#0099dc', secondary: '#1e2b3e', background: '#f8f9fa', surface: '#ffffff',
  text: '#172235', mutedText: '#748095', border: '#dce2e8', fontFamily: 'Arial, sans-serif', radius: 11,
  source: 'screenshots', sourceUrl: 'https://dashboard.smartsevak.com', extractedAt: '2026-10-27T00:00:00.000Z',
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

test('semantic motion follows scene progress and seeking reproduces the frame', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(promoTemplate(1280, 720, '#b09aff'));
  await setState(page, state);
  const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  const first = digest(await page.screenshot());
  const geometry = await page.locator('#stage').evaluate(el => el.outerHTML);
  await setState(page, { ...state, progress: .83, time: state.time + 2 });
  const moved = digest(await page.screenshot());
  assert.notDeepEqual(first, moved, 'the interface must develop during the product beat');
  await setState(page, state);
  assert.equal(geometry, await page.locator('#stage').evaluate(el => el.outerHTML), 'seeking back must reproduce the same geometry, copy and UI state');
  await page.close();
});

test('feature, caption, title, subtitles and CTA stay inside both export sizes', async () => {
  for (const [width, height] of [[1280, 720], [1920, 1080], [720, 1280], [1080, 1920]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(promoTemplate(width, height, '#b09aff'));
    for (const [scene, feature] of ['Introduction', 'Leads', 'Bookings and scheduling', 'Follow-ups', 'Analytics', 'Engagement', 'Explore'].entries()) {
      await setState(page, { ...state, scene, feature, name: 'SmartSevak', title: 'A connected workspace for the work that matters', caption: 'Keep your team connected as your work moves from one stage to the next.', progress: .55 });
      const clipped = await page.locator('.copy,.editorial-copy,.brand-screen,.subtitle').evaluateAll(elements => elements.filter(element => {
        if (!element.checkVisibility()) return false;
        const r = element.getBoundingClientRect();
        return r.x < 0 || r.y < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
      }).map(element => element.className));
      assert.deepEqual(clipped, [], `clipped copy at ${width} scene ${scene}`);
    }
    assert.equal(await page.locator('#cta-url').textContent(), 'dashboard.smartsevak.com');
    await page.close();
  }
});

test('promo inherits product palette, component geometry and observed model labels', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(promoTemplate(1280, 720, productTheme));
  await setState(page, { ...state, visualModel: { heading: 'Lead Management', labels: ['LEAD NAME', 'PHONE', 'BRANCH', 'LEAD STAGE', 'Open', 'Closed', 'All'], layout: 'table' } });
  assert.equal(await page.locator('.model-heading').textContent(), 'Lead Management');
  assert.deepEqual(await page.locator('.table-head span').allTextContents(), ['LEAD NAME', 'PHONE', 'BRANCH', 'LEAD STAGE']);
  assert.equal(await page.locator('.model').evaluate(el => getComputedStyle(el).borderRadius), '11px');
  assert.equal(await page.locator('.stage').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(248, 249, 250)');
  assert.equal(await page.locator('.search-button').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 153, 220)');
  assert.equal(await page.locator('.brand-mark,.torus,img,video').count(), 0);
  await page.close();
});

test('analytics schematic preserves an empty workspace and observed controls', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(promoTemplate(1280, 720, productTheme));
  await setState(page, { ...state, feature: 'Growth and reporting', title: 'Choose your reporting view', visualModel: { heading: 'Analytics and Insights', labels: ['Date Range', 'Date Field', 'Dashboard'], layout: 'analytics' } });
  assert.equal(await page.locator('.analytics-model').count(), 1);
  assert.equal(await page.locator('.analytics-model .graph').count(), 0, 'an empty captured reporting view must not acquire a populated chart');
  assert.deepEqual(await page.locator('.analytics-model .filter-field small').allTextContents(), ['Date Range', 'Date Field', 'Dashboard']);
  assert.match(await page.locator('.workspace-blank').textContent() || '', /Choose a dashboard/);
  await page.close();
});

test('first and final chapters contain distinct editorial beats instead of equal floating cards', async () => {
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  await page.setContent(promoTemplate(720, 1280, productTheme));
  const phases: string[] = [];
  for (const progress of [.12, .28, .45, .8]) {
    await setState(page, { ...state, scene: 0, scenes: 5, progress, caption: 'Your clinic. Connected.' });
    phases.push(await page.locator('#stage').getAttribute('data-phase') || '');
    if (progress === .28) assert.equal(await page.locator('#hook-controls').isVisible(), false, 'promise card must have a clean typography-only reset');
  }
  assert.deepEqual(phases, ['hook', 'promise', 'brand', 'product']);
  for (const [progress, phase] of [[.2, 'product'], [.45, 'list'], [.85, 'close']] as const) {
    await setState(page, { ...state, scene: 4, scenes: 5, progress, feature: 'Reporting', visualModel: { heading: 'Analytics and Insights', labels: ['Date Range', 'Date Field', 'Dashboard'], layout: 'analytics' } });
    assert.equal(await page.locator('#stage').getAttribute('data-phase'), phase);
  }
  assert.equal(await page.locator('#closing-name').textContent(), 'SmartSevak');
  assert.equal(await page.locator('.footer,.timeline,.float-card').count(), 0);
  await page.close();
});

test('native vector interfaces change state without manufacturing bookings or analytics results', async () => {
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  await page.setContent(promoTemplate(720, 1280, productTheme));
  const lead = { ...state, visualModel: { heading: 'Lead Management', labels: ['Phone', 'Search', 'Open', 'All'], layout: 'table' as const } };
  await setState(page, { ...lead, progress: .1 });
  assert.equal(await page.locator('.search-value').textContent(), 'Enter phone number');
  await setState(page, { ...lead, progress: .6 });
  assert.equal(await page.locator('.search-value').textContent(), '••••••');
  const reminder = { ...state, feature: 'Reminders', visualModel: { heading: 'Reminders', labels: ['All', 'Leads', 'Bookings'], layout: 'calendar' as const } };
  await setState(page, { ...reminder, progress: .2 });
  assert.equal(await page.locator('.reminder-tab.selected').textContent(), 'All');
  await setState(page, { ...reminder, progress: .55 });
  assert.equal(await page.locator('.reminder-tab.selected').textContent(), 'Leads');
  const booking = { ...state, feature: 'Bookings', visualModel: { heading: 'Bookings', labels: ['Summary', 'Calendar', 'Branch'], layout: 'calendar' as const } };
  await setState(page, { ...booking, progress: .1 });
  assert.equal(await page.locator('.booking-dialog').evaluate(el => getComputedStyle(el).opacity), '0');
  await setState(page, { ...booking, progress: .8 });
  assert.equal(await page.locator('.booking-dialog').evaluate(el => getComputedStyle(el).opacity), '1');
  assert.equal(await page.locator('.branch-actions .disabled').textContent(), 'Confirm selection');
  assert.equal(await page.locator('.branch-item.selected').count(), 0, 'source only demonstrates branch controls, not a confirmed branch/booking');
  assert.doesNotMatch(await page.locator('.booking-model').textContent() || '', /confirmed|successful|₹|revenue/i);
  await page.close();
});

test('portrait is separately composed and its important native controls remain within frame', async () => {
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  await page.setContent(promoTemplate(720, 1280, productTheme));
  for (const feature of ['Leads', 'Reminders', 'Bookings', 'Analytics']) {
    await setState(page, { ...state, feature, progress: .65 });
    const copy = await page.locator('#copy').boundingBox();
    const art = await page.locator('.model').boundingBox();
    assert.ok(copy && art && art.y > copy.y + copy.height + 10, feature + ' must stack product beneath editorial copy');
    const clipped = await page.locator('.search-button,.reminder-action,.branch-actions,.filter-row').evaluateAll(elements => elements.filter(el => {
      const r = el.getBoundingClientRect();
      return r.x < 0 || r.y < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight - 80;
    }).map(el => el.className));
    assert.deepEqual(clipped, [], feature + ' important controls clipped');
  }
  await page.close();
});

test('headlines and model entrances complete in actual seconds across chapter durations', async () => {
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  await page.setContent(promoTemplate(720, 1280, productTheme));
  for (const duration of [5.5, 7, 10]) {
    await setState(page, { ...state, title: 'Bring bookings into focus.', duration, progress: .5 / duration });
    const hiddenWords = await page.locator('#title .word-inner').evaluateAll(elements => elements.filter(el => getComputedStyle(el).opacity !== '1').length);
    assert.equal(hiddenWords, 0, `headline is still masked after 0.5s in a ${duration}s chapter`);
    assert.equal(await page.locator('#art').evaluate(el => getComputedStyle(el).opacity), '1');
  }
  await page.close();
});

test('booking overview has one heading and analytics list opens only the active dashboard menu', async () => {
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  await page.setContent(promoTemplate(720, 1280, productTheme));
  await setState(page, { ...state, feature: 'Bookings', duration: 7, progress: .1, visualModel: { heading: 'Bookings', labels: ['Summary', 'Calendar', 'Branch'], layout: 'calendar' } });
  assert.equal(await page.locator('.booking-model .window-body > .model-heading').count(), 0, 'summary/dialog own their headings without a clipped base heading');
  assert.equal(await page.locator('.booking-summary .model-heading').count(), 1);
  await setState(page, { ...state, feature: 'Bookings', duration: 7, progress: .2 + .4 / 7 });
  assert.equal(await page.locator('.booking-dialog').evaluate(el => getComputedStyle(el).opacity), '1', 'branch dialog entrance should settle within 0.4 seconds after its cue');
  const analytics = { ...state, scene: 4, scenes: 5, feature: 'Reporting', duration: 6, visualModel: { heading: 'Analytics and Insights', labels: ['Date Range', 'Date Field', 'Dashboard'], layout: 'analytics' as const } };
  for (const [progress, active, opacity] of [[.37, 'Date Range', '0'], [.52, 'Date Field', '0'], [.7, 'Dashboard', '1']] as const) {
    await setState(page, { ...analytics, progress });
    assert.equal(await page.locator('.list-line.active').textContent(), active);
    assert.equal(await page.locator('.dashboard-menu').evaluate(el => getComputedStyle(el).opacity), opacity);
  }
  await page.close();
});

test('product depth is attached to its actual model and portrait detail framing uses the available reading space', async () => {
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  await page.setContent(promoTemplate(720, 1280, productTheme));
  const lead = { ...state, duration: 7, feature: 'Leads', visualModel: { heading: 'Lead Management', labels: ['Phone', 'Search', 'Open', 'Closed', 'All'], layout: 'table' as const } };
  await setState(page, { ...lead, progress: .15 });
  const context = await page.locator('.model').boundingBox();
  await setState(page, { ...lead, progress: .6 });
  const detail = await page.locator('.model').boundingBox();
  const copy = await page.locator('#copy').boundingBox();
  assert.ok(context && detail && copy);
  assert.ok(detail.width / context.width > 1.1, 'The search action must receive a meaningful closer view.');
  assert.ok(detail.y > copy.y + copy.height + 20 && detail.y < copy.y + copy.height + 150, 'Product model should sit beneath the headline without a large empty middle.');
  const material = await page.locator('.object-backplate').evaluate(el => ({ transform: getComputedStyle(el).transform, radius: getComputedStyle(el).borderRadius, width: el.clientWidth }));
  assert.match(material.transform, /matrix3d/);
  assert.ok(material.width > 600, 'The backing must fit the product, rather than becoming a decorative satellite.');
  assert.equal(await page.locator('.object-shadow').count(), 1);
  for (const progress of [.15, .35, .6, .85, .95]) {
    await setState(page, { ...lead, progress });
    const action = await page.locator('.search-button').boundingBox();
    assert.ok(action && action.x > 0 && action.y > 0 && action.x + action.width < 720 && action.y + action.height < 1160, 'Closer product framing must preserve its active search control and subtitle safe area.');
  }
  await page.close();
});

test('opening beats have reading holds and the final CTA waits until the final 1.5 seconds', async () => {
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  await page.setContent(promoTemplate(720, 1280, productTheme));
  for (const [seconds, phase] of [[1.3, 'hook'], [2.35, 'promise'], [3.4, 'brand'], [4.2, 'product']] as const) {
    await setState(page, { ...state, scene: 0, scenes: 5, duration: 7, progress: seconds / 7 });
    assert.equal(await page.locator('#stage').getAttribute('data-phase'), phase);
  }
  for (const duration of [6, 8, 10]) {
    await setState(page, { ...state, scene: 4, scenes: 5, duration, progress: (duration - 1.6) / duration });
    assert.equal(await page.locator('#stage').getAttribute('data-phase'), 'list');
    await setState(page, { ...state, scene: 4, scenes: 5, duration, progress: (duration - 1.3) / duration });
    assert.equal(await page.locator('#stage').getAttribute('data-phase'), 'close');
  }
  await page.close();
});
