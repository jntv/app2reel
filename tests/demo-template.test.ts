import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { demoTemplate } from '../server/demo-template.js';

test('demo artwork visibly renders a contrast pointer, real-region outline and active lyric word', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.route('**/*', route => route.abort());
    await page.setContent(demoTemplate(1280, 720, { accent: '#078ac7', background: '#f3f6fa', surface: '#ffffff', text: '#172b43', mutedText: '#617389', border: '#d8e2eb', fontFamily: 'Arial,sans-serif', radius: 8, sourceUrl: 'https://example.test', extractedAt: '', source: 'computed' }));
    await page.evaluate(() => {
      (window as unknown as { setDemoState: (payload: unknown) => void }).setDemoState({
        film: { name: 'Product', title: 'Search and review', caption: 'A genuine workflow', feature: 'Search', url: 'example.test', scene: 0, scenes: 2, progress: 0.6, totalProgress: 0.3, time: 2, subtitle: 'Search your workspace', subtitleWord: 1 },
        cursor: { x: 650, y: 220, visible: true }, attention: { x: 400, y: 170, width: 440, height: 120, visible: true }, cursorHighlights: true,
      });
    });
    const actual = await page.evaluate(() => {
      const pointer = document.querySelector('#pointer')!;
      const path = pointer.querySelector('path')!;
      const outline = document.querySelector('#outline')!;
      return {
        pointerDisplay: getComputedStyle(pointer).display, pointerWidth: pointer.getBoundingClientRect().width,
        fill: getComputedStyle(path).fill, stroke: getComputedStyle(path).stroke,
        outlineOpacity: getComputedStyle(outline).opacity, outlineX: outline.getAttribute('x'), outlineWidth: outline.getAttribute('width'),
        active: document.querySelector('.word.active')?.textContent,
        ripple: getComputedStyle(document.querySelector('#ripple')!).display,
      };
    });
    assert.equal(actual.pointerDisplay, 'block');
    assert.ok(actual.pointerWidth >= 24, 'The pointer must be legible at720p.');
    assert.equal(actual.fill, 'rgb(255, 255, 255)');
    assert.equal(actual.stroke, 'rgb(17, 28, 42)');
    assert.equal(actual.outlineOpacity, '1');
    assert.equal(actual.outlineX, '400');
    assert.equal(actual.outlineWidth, '440');
    assert.equal(actual.active, 'your');
    assert.equal(actual.ripple, 'none', 'No click ripple without a recorded click.');
    const hidden = await page.evaluate(() => {
      (window as unknown as { setDemoState: (payload: unknown) => void }).setDemoState({
        film: { name: 'Product', title: 'Search and review', caption: '', feature: 'Search', url: '', scene: 0, scenes: 2, progress: 0.6, totalProgress: 0.3, time: 2 },
        cursor: { x: 650, y: 220, visible: true }, click: { x: 650, y: 220, age: 0.1 }, attention: { x: 400, y: 170, width: 440, height: 120, visible: true }, cursorHighlights: false,
      });
      return Object.fromEntries(['pointer', 'cursor-halo', 'ripple', 'focus-label', 'outline', 'outline-shadow', 'spotlight', 'focus-connector'].map(id => {
        const style = getComputedStyle(document.getElementById(id)!);
        return [id, style.display === 'none' || style.opacity === '0'];
      }));
    });
    for (const [element, isHidden] of Object.entries(hidden)) assert.equal(isHidden, true, `${element} must be hidden when pointer and feature outlines are disabled.`);
  } finally { await browser.close(); }
});
