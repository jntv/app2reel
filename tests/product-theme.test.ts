import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { captureProductFont, extractProductDesign, refreshProductDesign, refineThemeFromScreenshots, safeVisualLabel, sanitizeFontFamily, isSupportedFontSource } from '../server/product-theme.js';
import { briefSchema } from '../server/store.js';

test('visual model labels exclude customer content and font tokens cannot carry CSS', () => {
  assert.equal(safeVisualLabel('John Smith'), undefined);
  assert.equal(safeVisualLabel('Call +91 9876543210'), undefined);
  assert.equal(safeVisualLabel('admin@example.test'), undefined);
  assert.equal(safeVisualLabel('Dashboard Highlights'), 'Dashboard Highlights');
  assert.equal(safeVisualLabel('◈  Care pathways', ['Care pathways']), 'Care pathways');
  assert.equal(safeVisualLabel('Sensitive person Care pathways', ['Care pathways']), undefined);
  assert.equal(sanitizeFontFamily('"Product Sans", Arial, sans-serif'), 'Product Sans');
  assert.equal(sanitizeFontFamily('Inter; background:url(https://example.test)'), 'system-ui');
  assert.equal(sanitizeFontFamily('"font);color:red"'), 'system-ui');
});

test('declared font CDN URLs support Google Fonts without requiring a previously loaded font resource', () => {
  assert.equal(isSupportedFontSource('https://fonts.gstatic.com/s/poppins/v24/regular.ttf', 'https://fonts.googleapis.com/css2?family=Poppins'), true);
  assert.equal(isSupportedFontSource('https://cdn.example.com/product.woff2', 'https://product.example.com/styles.css'), true);
  assert.equal(isSupportedFontSource('http://127.0.0.1:4310/font.woff2', 'http://127.0.0.1:4310/styles.css'), true);
  assert.equal(isSupportedFontSource('http://127.0.0.1:9999/font.woff2', 'https://product.example.com/styles.css'), false);
  assert.equal(isSupportedFontSource('https://192.168.1.1/font.woff2', 'https://product.example.com/styles.css'), false);
  assert.equal(isSupportedFontSource('https://router.local/font.woff2', 'https://product.example.com/styles.css'), false);
  assert.equal(isSupportedFontSource('file:///tmp/font.woff2', 'https://product.example.com/styles.css'), false);
  assert.equal(isSupportedFontSource('https://user:secret@fonts.gstatic.com/font.ttf', 'https://fonts.googleapis.com/css2?family=Poppins'), false);
});

test('product CSS produces real normalized theme tokens and a safe structural model', { skip: !existsSync(chromium.executablePath()) }, async () => {
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end(`<!doctype html><html style="--primary: 9 126 237"><head><style>
  *{box-sizing:border-box}body{margin:0;font:16px 'Product Sans',sans-serif;color:#142133;background:#f7f8fa}aside{position:fixed;inset:0 auto 0 0;width:180px;background:#1d2b3e;padding:20px}aside button{display:block;margin:8px;background:#097eed;color:white;border:0;border-radius:8px;padding:12px}
  main{margin-left:180px;padding:30px}h1{margin-top:0}small{color:#6c7788}.cards{display:flex;gap:12px}.card{width:26%;height:160px;background:#fff;border:1px solid #d9dee6;border-radius:10px;padding:20px}.panel{height:300px;background:white;border:1px solid #d9dee6;border-radius:10px;padding:20px}
  .hidden{display:none}#capture-cursor{position:fixed;left:50%;top:50%;background:#ff5c33;border-radius:50%;width:25px;height:25px}
  </style></head><body><aside><button>Overview</button><button>Leads</button><button>John Smith</button><button>9876543210</button><button class="hidden" style="background:#ff0000">Export</button></aside><main><h1>Dashboard</h1><small>Performance</small><div class="cards"><div class="card">John Smith</div><div class="card">9876543210</div><div class="card">admin@example.test</div></div><div class="panel"><h2>John Smith</h2><table><tr><th>Patient</th><td>Private Patient</td></tr></table><input value="private input"><button>Add patient</button></div></main><div id="capture-cursor"></div></body></html>`); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/dashboard?private=secret#session`;
    await page.goto(url);
    const design = await extractProductDesign(page, ['Lead management']);
    assert.equal(design.theme.accent, '#097eed');
    assert.equal(design.theme.secondary, '#1d2b3e');
    assert.equal(design.theme.background, '#f7f8fa');
    assert.equal(design.theme.surface, '#ffffff');
    assert.equal(design.theme.text, '#142133');
    assert.equal(design.theme.mutedText, '#6c7788');
    assert.equal(design.theme.border, '#d9dee6');
    assert.equal(design.theme.fontFamily, 'Product Sans');
    assert.equal(design.theme.radius, 10);
    assert.equal(design.theme.sourceUrl, new URL('/dashboard', url).href);
    assert.equal(design.theme.source, 'computed');
    assert.ok(!Number.isNaN(Date.parse(design.theme.extractedAt)));
    assert.deepEqual(design.visualModel, { heading: 'Dashboard', labels: ['Overview', 'Leads', 'Add patient'], layout: 'table', accent: '#097eed' });
    assert.ok(!JSON.stringify(design).includes('private'));
    assert.ok(!JSON.stringify(design).includes('John'));
    assert.ok(!JSON.stringify(design).includes('9876543210'));
    const main = await page.locator('main').boundingBox(); assert.ok(main);
    assert.deepEqual(design.focusArea, { x: main.x / 1280, y: main.y / 720, width: main.width / 1280, height: main.height / 720 });
    await page.evaluate(() => { const drawer = document.createElement('div'); drawer.setAttribute('role', 'dialog'); drawer.style.cssText = 'position:fixed;left:880px;top:60px;width:360px;height:600px;background:white'; document.body.append(drawer); });
    const dialog = await extractProductDesign(page);
    assert.deepEqual(dialog.focusArea, { x: 880 / 1280, y: 60 / 720, width: 360 / 1280, height: 600 / 720 });
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('public design refresh is unrecorded, stores a validated local font, and bounded font copies omit cookies', { skip: !existsSync(chromium.executablePath()) }, async () => {
  const font = Buffer.alloc(128); font.write('wOF2');
  const fontCookies: string[] = []; let writes = 0;
  const server = createServer((request, response) => {
    if (request.method === 'POST') { writes++; response.end(); return; }
    if (request.url === '/font.woff2') { fontCookies.push(request.headers.cookie || ''); response.setHeader('content-type', 'font/woff2'); response.end(font); return; }
    if (request.url === '/huge.woff2') { response.setHeader('content-type', 'font/woff2'); response.write(Buffer.alloc(1024 * 1024, 'w')); response.end(Buffer.alloc(1024 * 1024 + 1, 'w')); return; }
    if (request.url === '/invalid.woff2') { response.setHeader('content-type', 'font/woff2'); response.end('<!doctype html><html>Not a font, regardless of MIME type.</html>'); return; }
    response.setHeader('content-type', 'text/html'); response.setHeader('set-cookie', 'product-session=not-for-font-copy; Path=/');
    response.end('<style>@font-face{font-family:FixtureFont;src:url(/font.woff2);font-weight:400;font-style:normal}body{font-family:FixtureFont,sans-serif;background:#fafafa;color:#111827}button{background:#0a8fdc;color:white}</style><main><h1>Dashboard</h1><button>Leads</button><script>fetch("/write",{method:"POST"})</script></main>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-font-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/?private=secret`;
    const project = { brief: briefSchema.parse({ name: 'Theme fixture', url, description: 'A local theme fixture', purpose: 'Verify public design extraction', actors: 'Test user', features: ['Leads'] }) };
    const design = await refreshProductDesign(project, directory);
    assert.equal(design.theme.source, 'computed'); assert.equal(design.theme.fontFamily, 'FixtureFont');
    assert.match(design.theme.fontAsset || '', /^product-font-[a-f\d]{20}\.woff2$/);
    assert.deepEqual(await readFile(path.join(directory, design.theme.fontAsset!)), font);
    assert.equal(writes, 0, 'The app refresh must block product writes.');
    assert.equal(fontCookies.at(-1), '', 'The local font copy must not forward browser cookies.');
    assert.ok((await readdir(directory)).every(filename => /^product-font-/.test(filename)), 'Refresh must not create screen/video files.');
    const page = await browser.newPage(); await page.goto(url);
    await page.evaluate(() => { document.querySelector('style')!.textContent = '@font-face{font-family:OversizedFont;src:url(/huge.woff2)}body{font-family:OversizedFont}'; });
    assert.equal(await captureProductFont(page, directory, 'OversizedFont'), undefined, 'Chunked oversized assets are rejected.');
    await page.evaluate(() => { document.querySelector('style')!.textContent = '@font-face{font-family:InvalidFont;src:url(/invalid.woff2)}body{font-family:InvalidFont}'; });
    assert.equal(await captureProductFont(page, directory, 'InvalidFont'), undefined, 'Font MIME type alone is insufficient.');
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('stored screenshot palette restores dashboard colors while retaining the real font and rejecting dimmed modal palettes', { skip: !existsSync(chromium.executablePath()) }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-theme-pixels-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent('<style>body{margin:0;background:#fafafa;font:24px Arial;color:#111827}aside{position:absolute;inset:0 auto 0 0;width:80px;background:#1e293b}main{margin:35px 35px 0 115px;background:white;border:2px solid #e0e0e0;border-radius:12px;height:450px;padding:25px}button{background:#0a8fdc;color:white;border:0;padding:20px 45px;font:inherit}small{color:#64748b}</style><aside></aside><main><h1>Dashboard</h1><small>Performance and insights</small><p><button>Leads</button></p></main>');
    await page.screenshot({ path: path.join(directory, 'shot-001.png') });
    await page.evaluate(() => { const dimmer = document.createElement('div'); dimmer.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5)'; document.body.append(dimmer); const drawer = document.createElement('div'); drawer.style.cssText = 'position:fixed;right:0;top:0;width:22%;height:100%;background:white'; document.body.append(drawer); });
    await page.screenshot({ path: path.join(directory, 'shot-002.png') });
    const theme = { accent: '#0a8fdc', secondary: '#000000', background: '#ffffff', surface: '#f3f4f6', text: '#000000', mutedText: '#777777', border: '#aaaaaa', fontFamily: 'Actual Product Font', fontAsset: 'product-font-fixture.woff2', radius: 12, sourceUrl: 'https://example.test/signin', extractedAt: '', source: 'computed' as const };
    const result = await refineThemeFromScreenshots(directory, [{ screenshot: 'shot-001.png', url: 'https://example.test/dashboard?private=secret' }, { screenshot: 'shot-002.png', url: 'https://example.test/reminders' }], theme);
    assert.equal(result.source, 'screenshots'); assert.equal(result.sourceUrl, 'https://example.test/dashboard');
    assert.equal(result.background, '#fafafa'); assert.equal(result.surface, '#ffffff'); assert.equal(result.accent, '#0a8fdc'); assert.equal(result.secondary, '#1e293b');
    assert.equal(result.fontAsset, theme.fontAsset); assert.equal(result.fontFamily, theme.fontFamily); assert.equal(result.radius, theme.radius);
    assert.notEqual(result.background, '#7f7f7f', 'Backdrop dimming must not become branding.');
    assert.equal(await refineThemeFromScreenshots(directory, [{ screenshot: '../shot-001.png', url: 'https://example.test' }], theme), theme);
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});
