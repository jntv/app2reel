import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { chromium } from 'playwright';
import { automatedSignIn } from '../server/signin';
import { briefSchema } from '../server/store';
import type { Project } from '../shared/types';
import type { LocalAI } from '../server/ai';

const credentials = { username: 'fixture-user@example.test', password: 'fixture-only-password' };
const browserInstalled = existsSync(chromium.executablePath());

/** All authentication and challenge UI in these tests belongs to a local fake site. */
async function fixture(mode: 'simple' | 'captcha' | 'delayed' | 'disabled' = 'simple') {
  let submissions = 0;
  const server = createServer((request, response) => {
    const send = (html: string) => { response.setHeader('Content-Type', 'text/html'); response.end(html); };
    if (request.url === '/session' && request.method === 'POST') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        submissions++;
        const form = new URLSearchParams(body);
        assert.equal(form.get('email'), credentials.username);
        assert.equal(form.get('password'), credentials.password);
        response.writeHead(303, { Location: '/dashboard', 'Set-Cookie': 'session=fixture-session; HttpOnly; SameSite=Strict; Path=/' });
        response.end();
      });
      return;
    }
    if (request.url === '/dashboard') {
      assert.match(request.headers.cookie || '', /session=fixture-session/);
      send('<nav>Workspace</nav><main><h1>Dashboard</h1><button>Log out</button></main>');
      return;
    }
    if (request.url === '/recaptcha/api2/anchor') {
      send(`<style>body{margin:0;font:16px sans-serif;padding:12px} [role=checkbox]{display:inline-block;width:26px;height:26px;border:2px solid #555;cursor:pointer}</style>
        <span role="checkbox" id="recaptcha-anchor" aria-checked="false" aria-label="I'm not a robot"></span> I'm not a robot
        <script>document.querySelector('[role=checkbox]').onclick=()=>parent.postMessage('open-challenge','*');addEventListener('message',event=>{if(event.data==='verified')document.querySelector('[role=checkbox]').setAttribute('aria-checked','true')})</script>`);
      return;
    }
    if (request.url === '/recaptcha/api2/bframe') {
      send(`<style>body{margin:0;background:#eee;font:16px sans-serif}button{position:absolute;left:120px;top:100px;width:90px;height:50px}</style><h2>Local test challenge</h2><button onclick="parent.postMessage('verified','*')">Verify</button>`);
      return;
    }
    send(`<style>body{font:16px sans-serif;margin:40px}label{display:block;margin-bottom:20px}iframe{display:block;margin:10px 0}</style>
      <form action="/session" method="post"><label>Email<input name="email" type="email" autocomplete="username"></label>
      <label>Password<input name="password" type="password"></label>
      ${mode === 'captcha' ? '<iframe id="anchor" src="/recaptcha/api2/anchor" title="reCAPTCHA" width="302" height="78"></iframe>' : ''}
      <button id="login" ${mode !== 'simple' ? 'disabled' : ''}>Login</button></form>
      ${mode === 'captcha' ? '<iframe src="/recaptcha/api2/bframe" title="reCAPTCHA challenge" width="400" height="300" style="position:absolute;left:-10000px"></iframe>' : ''}
      <script>${mode === 'delayed' ? "setTimeout(()=>{const frame=document.createElement('iframe');frame.id='anchor';frame.src='/recaptcha/api2/anchor';frame.title='reCAPTCHA';frame.width=302;frame.height=78;document.querySelector('#login').before(frame)},1800);" : ''}addEventListener('message',event=>{if(event.data==='open-challenge'&&!document.querySelector('#challenge')){const frame=document.createElement('iframe');frame.id='challenge';frame.src='/recaptcha/api2/bframe';frame.title='reCAPTCHA challenge';frame.width=400;frame.height=300;frame.style='position:fixed;left:500px;top:100px;margin:0;border:0;z-index:99';document.body.append(frame)}if(event.data==='verified'){document.querySelector('#anchor').contentWindow.postMessage('verified','*');document.querySelector('#challenge').style.display='none';document.querySelector('#login').disabled=false}})</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/signin`;
  const project: Project = { id: 'signin-fixture', brief: briefSchema.parse({ name: 'Sign-in fixture', url,
    description: 'A local sign-in safety fixture.', purpose: 'Verify private sign-in.', actors: 'Local fixture user', features: ['Dashboard'] }),
    createdAt: '', updatedAt: '', stage: 'draft', progress: 0, message: '', logs: [], sources: [], findings: [], shots: [], scenes: [], outputs: [] };
  const browser = await chromium.launch({ headless: true });
  return { project, browser, submissions: () => submissions, cleanup: async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

function noAI(): LocalAI { return { json: async () => { throw new Error('AI must not be called.'); } } as unknown as LocalAI; }

test('private sign-in returns reusable auth state and closes its unrecorded context', { skip: !browserInstalled }, async () => {
  const current = await fixture();
  const logs: string[] = [];
  try {
    const state = await automatedSignIn(current.browser, current.project, credentials, noAI(), new AbortController().signal,
      async message => { logs.push(message); });
    assert.equal(current.submissions(), 1);
    assert.equal(state.cookies.find(cookie => cookie.name === 'session')?.value, 'fixture-session');
    assert.equal(current.browser.contexts().length, 0);
    assert.ok(logs.some(message => message.includes('completed')));
    assert.ok(!logs.join('\n').includes(credentials.username));
    assert.ok(!logs.join('\n').includes(credentials.password));
    const reused = await current.browser.newContext({ storageState: state });
    const page = await reused.newPage();
    await page.goto(new URL('/dashboard', current.project.brief.url).href);
    assert.equal(await page.getByRole('heading', { name: 'Dashboard' }).count(), 1);
    await reused.close();
  } finally { await current.cleanup(); }
});

test('a visible CAPTCHA requires run-specific opt-in before submitting credentials', { skip: !browserInstalled }, async () => {
  const current = await fixture('captcha');
  try {
    await assert.rejects(automatedSignIn(current.browser, current.project, credentials, noAI(), new AbortController().signal, async () => {}), /Enable the visible CAPTCHA attempt/);
    assert.equal(current.submissions(), 0);
    assert.equal(current.browser.contexts().length, 0);
  } finally { await current.cleanup(); }
});

test('opted-in challenges use cropped private images, no credential prompt, and validated UI clicks', { skip: !browserInstalled }, async () => {
  const current = await fixture('captcha');
  const images: string[] = [];
  const ai = { json: async (prompt: string, _schema: unknown, options: { imagePath: string }) => {
    assert.ok(!prompt.includes(credentials.username));
    assert.ok(!prompt.includes(credentials.password));
    assert.ok(!prompt.includes(current.project.brief.url));
    assert.match(prompt, /400 by 300/);
    assert.equal((await stat(options.imagePath)).mode & 0o777, 0o600);
    images.push(options.imagePath);
    return { action: 'click', x: 160, y: 125, reason: 'Select the visible verification control.' };
  } } as unknown as LocalAI;
  try {
    const state = await automatedSignIn(current.browser, current.project, { ...credentials, attemptCaptcha: true }, ai,
      new AbortController().signal, async () => {});
    assert.equal(current.submissions(), 1);
    assert.equal(state.cookies.find(cookie => cookie.name === 'session')?.value, 'fixture-session');
    assert.equal(images.length, 1);
    await assert.rejects(stat(images[0]), { code: 'ENOENT' });
    await assert.rejects(stat(new URL('.', `file://${images[0]}`).pathname), { code: 'ENOENT' });
    assert.equal(current.browser.contexts().length, 0);
  } finally { await current.cleanup(); }
});

test('out-of-frame model coordinates fail safely and clean private challenge files', { skip: !browserInstalled }, async () => {
  const current = await fixture('captcha');
  let imagePath = '';
  const ai = { json: async (_prompt: string, _schema: unknown, options: { imagePath: string }) => {
    imagePath = options.imagePath;
    return { action: 'click', x: -10, y: 20, reason: 'Invalid fixture decision.' };
  } } as unknown as LocalAI;
  try {
    await assert.rejects(automatedSignIn(current.browser, current.project, { ...credentials, attemptCaptcha: true }, ai,
      new AbortController().signal, async () => {}), /outside the visible challenge/);
    assert.equal(current.submissions(), 0);
    await assert.rejects(stat(imagePath), { code: 'ENOENT' });
    assert.equal(current.browser.contexts().length, 0);
  } finally { await current.cleanup(); }
});

test('a CAPTCHA added after the password form loads is detected while Login is disabled', { skip: !browserInstalled }, async () => {
  const current = await fixture('delayed');
  const logs: string[] = [];
  let decisions = 0;
  const ai = { json: async () => {
    decisions++;
    return { action: 'click', x: 160, y: 125, reason: 'Select the visible verification control.' };
  } } as unknown as LocalAI;
  try {
    const state = await automatedSignIn(current.browser, current.project, { ...credentials, attemptCaptcha: true }, ai,
      new AbortController().signal, async message => { logs.push(message); });
    assert.equal(current.submissions(), 1);
    assert.equal(decisions, 1);
    assert.ok(state.cookies.some(cookie => cookie.name === 'session'));
    assert.ok(logs.findIndex(message => message.includes('Attempting the visible')) < logs.findIndex(message => message.includes('Submitting')));
  } finally { await current.cleanup(); }
});

test('cancellation aborts challenge inference and removes all sign-in resources', { skip: !browserInstalled }, async () => {
  const current = await fixture('captcha');
  const controller = new AbortController();
  let imagePath = '';
  const ai = { json: async (_prompt: string, _schema: unknown, options: { imagePath: string; signal: AbortSignal }) => {
    imagePath = options.imagePath;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Private fixture error must not escape.')), { once: true });
      controller.abort();
    });
  } } as unknown as LocalAI;
  try {
    await assert.rejects(automatedSignIn(current.browser, current.project, { ...credentials, attemptCaptcha: true }, ai,
      controller.signal, async () => {}), { name: 'AbortError', message: 'Automatic sign-in cancelled.' });
    assert.ok(imagePath);
    await assert.rejects(stat(imagePath), { code: 'ENOENT' });
    assert.equal(current.browser.contexts().length, 0);
  } finally { controller.abort(); await current.cleanup(); }
});

test('a disabled Login control is not mistaken for authenticated content', { skip: !browserInstalled }, async () => {
  const current = await fixture('disabled');
  try {
    await assert.rejects(automatedSignIn(current.browser, current.project, credentials, noAI(),
      new AbortController().signal, async () => {}), /unavailable or disabled/);
    assert.equal(current.submissions(), 0);
    assert.equal(current.browser.contexts().length, 0);
  } finally { await current.cleanup(); }
});
