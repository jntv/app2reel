import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { LoginSessions, applySavedLogin } from '../server/login-sessions';
import { briefSchema } from '../server/store';
import type { Project } from '../shared/types';

const installed = existsSync(chromium.executablePath());
const credentials = { username: 'local-user@example.test', password: 'local-only-password' };
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() >= deadline) assert.fail('Local sign-in fixture did not reach its expected state.');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function fixture(options: { pollMs?: number; pendingMs?: number; savedMs?: number } = {}) {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/dashboard') {
      if (!(request.headers.cookie || '').includes('session=local-session')) {
        response.writeHead(302, { Location: '/signin' }); response.end(); return;
      }
      response.end(`<script>
        const open=indexedDB.open('local-auth',1);open.onsuccess=()=>{
          const request=open.result.transaction('tokens').objectStore('tokens').get('token');
          request.onsuccess=()=>{if(request.result==='local-indexeddb'&&localStorage.getItem('token')==='local-storage'&&sessionStorage.getItem('token')==='local-session-storage')
            document.body.innerHTML='<nav>Workspace</nav><main><h1>Dashboard</h1><button>Log out</button></main>'};
        };
        </script>`);
      return;
    }
    if (request.url === '/other') { response.end('<h1>Public page</h1>'); return; }
    if (request.url === '/workbench') { response.end('<nav>Product menu</nav><h1>Workspace</h1>'); return; }
    if (request.url === '/public-landing') {
      response.end('<nav><a href="/about">About</a><a href="/pricing">Pricing</a><a href="/contact">Contact</a></nav><h1>Welcome to our product</h1>');
      return;
    }
    if (request.url === '/link-workbench') {
      response.end('<div class="sidebar"><a href="/patients">Patients</a><a href="/appointments">Appointments</a><a href="/reports">Reports</a></div><main><h1>Dashboard Highlights</h1></main>');
      return;
    }
    if (request.url === '/embedded-otp') {
      response.end('<div class="sidebar"><a href="/patients">Patients</a><a href="/appointments">Appointments</a><a href="/reports">Reports</a></div><main><h1>Dashboard Highlights</h1><iframe src="/otp"></iframe></main>');
      return;
    }
    if (request.url === '/otp') { response.end('<input autocomplete="one-time-code">'); return; }
    response.end(`<nav>Public navigation</nav><h1>Welcome</h1><form>
      <input type="email" autocomplete="username"><input type="password"><button>Login</button></form>
      <script>document.querySelector('form').onsubmit=event=>{
        event.preventDefault();localStorage.setItem('token','local-storage');sessionStorage.setItem('token','local-session-storage');
        const open=indexedDB.open('local-auth',1);open.onupgradeneeded=()=>open.result.createObjectStore('tokens');
        open.onsuccess=()=>{const transaction=open.result.transaction('tokens','readwrite');
          transaction.objectStore('tokens').put('local-indexeddb','token');transaction.oncomplete=()=>{
            document.cookie='session=local-session; SameSite=Strict; Path=/';location.href='/dashboard';
          };
        };
      };</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/signin`;
  const project: Project = { id: 'manual-login-fixture', brief: briefSchema.parse({ name: 'Manual login fixture', url,
    description: 'Local sign-in fixture', purpose: 'Verify session handling', actors: 'Local test user', features: ['Dashboard'] }),
    createdAt: '', updatedAt: '', stage: 'draft', progress: 0, message: '', logs: [], sources: [], findings: [], shots: [], scenes: [], outputs: [] };
  const browsers: Browser[] = [];
  const sessions = new LoginSessions({ headless: true, pollMs: 20, ...options,
    launch: async launchOptions => { const browser = await chromium.launch(launchOptions); browsers.push(browser); return browser; } });
  return { sessions, project, browsers, page: () => browsers.at(-1)!.contexts()[0].pages()[0], cleanup: async () => {
    await sessions.clear(); await Promise.all(browsers.map(browser => browser.close()));
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

test('manual login autosaves, closes its unrecorded browser, and can be completed repeatedly then consumed once', { skip: !installed }, async () => {
  const current = await fixture();
  let reuse: Browser | undefined;
  try {
    await current.sessions.open(current.project, undefined, credentials);
    assert.equal(current.sessions.status(current.project.id).state, 'pending');
    assert.equal(current.browsers[0].contexts()[0].pages()[0].video(), null);
    await current.page().getByRole('button', { name: 'Login', exact: true }).click();
    await until(() => current.sessions.status(current.project.id).state === 'ready');
    await until(() => !current.browsers[0].isConnected());
    await current.sessions.complete(current.project.id);
    await current.sessions.complete(current.project.id);
    const saved = await current.sessions.take(current.project.id);
    assert.ok(saved);
    assert.equal(saved.storageState.cookies.find(cookie => cookie.name === 'session')?.value, 'local-session');
    assert.equal(saved.storageState.origins[0].localStorage[0].value, 'local-storage');
    assert.ok(JSON.stringify(saved.storageState).includes('local-indexeddb'));
    assert.deepEqual(saved.sessionStorage, [{ origin: new URL(current.project.brief.url).origin, entries: [['token', 'local-session-storage']] }]);
    assert.equal(await current.sessions.take(current.project.id), undefined);
    assert.equal(current.sessions.status(current.project.id).state, 'none');
    reuse = await chromium.launch({ headless: true });
    const context = await reuse.newContext({ storageState: saved.storageState });
    await applySavedLogin(context, saved);
    const page = await context.newPage();
    await page.goto(new URL('/dashboard', current.project.brief.url).href);
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('token')), 'local-session-storage');
    const other = await fixture();
    try {
      await page.goto(new URL('/other', other.project.brief.url).href);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('token')), null);
    } finally { await other.cleanup(); }
  } finally { await reuse?.close(); await current.cleanup(); }
});

test('signed-out complete/take keep the window open and never leak supplied credentials in errors or status', { skip: !installed }, async () => {
  const current = await fixture();
  try {
    await current.sessions.open(current.project, undefined, credentials);
    const messages = [current.sessions.status(current.project.id).message];
    for (const action of [() => current.sessions.complete(current.project.id), () => current.sessions.take(current.project.id)]) {
      await assert.rejects(action, (error: Error) => { messages.push(error.message); return /Sign-in is not complete/.test(error.message); });
    }
    assert.equal(current.sessions.status(current.project.id).state, 'pending');
    assert.ok(current.browsers[0].isConnected());
    assert.ok(!messages.join().includes(credentials.username));
    assert.ok(!messages.join().includes(credentials.password));
    assert.deepEqual(current.project.logs, []);
    await current.sessions.discard(current.project.id);
    assert.equal(current.sessions.status(current.project.id).state, 'none');
    assert.ok(!current.browsers[0].isConnected());
  } finally { await current.cleanup(); }
});

test('take verifies a pending browser directly before its next polling interval', { skip: !installed }, async () => {
  const current = await fixture({ pollMs: 60_000 });
  try {
    await current.sessions.open(current.project, undefined, credentials);
    await current.page().getByRole('button', { name: 'Login', exact: true }).click();
    await current.page().getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
    assert.equal(current.sessions.status(current.project.id).state, 'pending');
    assert.ok(await current.sessions.take(current.project.id));
    assert.equal(current.sessions.status(current.project.id).state, 'none');
  } finally { await current.cleanup(); }
});

test('login paths and OTP inputs prevent false authentication even alongside dashboard navigation', { skip: !installed }, async () => {
  const current = await fixture({ pollMs: 60_000 });
  try {
    await current.sessions.open(current.project);
    await current.page().setContent('<nav>Workspace</nav><h1>Dashboard</h1><button>Log out</button>');
    await assert.rejects(current.sessions.complete(current.project.id), /Sign-in is not complete/);
    await current.page().goto(new URL('/other', current.project.brief.url).href);
    await current.page().setContent('<nav>Workspace</nav><h1>Dashboard</h1><button>Log out</button><input autocomplete="one-time-code">');
    await assert.rejects(current.sessions.complete(current.project.id), /Sign-in is not complete/);
  } finally { await current.cleanup(); }
});

test('a workspace heading plus navigation verifies the product after leaving its sign-in form', { skip: !installed }, async () => {
  const current = await fixture({ pollMs: 60_000 });
  try {
    const productURL = new URL('/workbench', current.project.brief.url).href;
    await current.sessions.open(current.project);
    await current.page().goto(productURL);
    await current.sessions.complete(current.project.id);
    assert.equal(current.sessions.status(current.project.id).state, 'ready');
  } finally { await current.cleanup(); }
});

test('a transition from sign-in to a public landing page with navigation is not authenticated', { skip: !installed }, async () => {
  const current = await fixture({ pollMs: 60_000 });
  try {
    await current.sessions.open(current.project);
    await current.page().goto(new URL('/public-landing', current.project.brief.url).href);
    assert.equal(await current.page().locator('nav:visible').count(), 1);
    assert.equal(await current.page().locator('a:visible').count(), 3);
    assert.equal(await current.page().locator('input').count(), 0);
    await assert.rejects(current.sessions.complete(current.project.id), /Sign-in is not complete/);
    await assert.rejects(current.sessions.take(current.project.id), /Sign-in is not complete/);
    assert.equal(current.sessions.status(current.project.id).state, 'pending');
    assert.equal(current.browsers[0].isConnected(), true);
  } finally { await current.cleanup(); }
});

test('a div sidebar with visible same-origin links verifies authentication after leaving the sign-in form', { skip: !installed }, async () => {
  const current = await fixture({ pollMs: 60_000 });
  try {
    await current.sessions.open(current.project);
    await current.page().goto(new URL('/link-workbench', current.project.brief.url).href);
    assert.equal(await current.page().locator('nav,aside,[role="navigation"]').count(), 0);
    assert.equal(await current.page().locator('a:visible').count(), 3);
    await current.sessions.complete(current.project.id);
    assert.equal(current.sessions.status(current.project.id).state, 'ready');
    assert.ok(await current.sessions.take(current.project.id));
  } finally { await current.cleanup(); }
});

test('a visible iframe OTP blocks authentication while an inactive hidden iframe does not', { skip: !installed }, async () => {
  const current = await fixture({ pollMs: 60_000 });
  try {
    await current.sessions.open(current.project);
    await current.page().goto(new URL('/embedded-otp', current.project.brief.url).href);
    await current.page().frameLocator('iframe').locator('input').waitFor();
    await assert.rejects(current.sessions.complete(current.project.id), /Sign-in is not complete/);
    assert.equal(current.sessions.status(current.project.id).state, 'pending');
    assert.equal(current.browsers[0].isConnected(), true);
    await current.page().locator('iframe').evaluate(frame => { frame.style.display = 'none'; });
    await current.sessions.complete(current.project.id);
    assert.equal(current.sessions.status(current.project.id).state, 'ready');
  } finally { await current.cleanup(); }
});

test('allowed top-level origins remain enforced while local third-party challenge frames can load', { skip: !installed }, async () => {
  const current = await fixture({ pollMs: 60_000 });
  const challenge = await fixture();
  try {
    await current.sessions.open(current.project);
    await current.page().evaluate(url => { const iframe = document.createElement('iframe'); iframe.src = url; document.body.append(iframe); }, challenge.project.brief.url);
    await current.page().frameLocator('iframe').getByRole('button', { name: 'Login', exact: true }).waitFor();
    await assert.rejects(current.page().goto(challenge.project.brief.url));
    assert.equal(current.sessions.status(current.project.id).state, 'pending');
    await assert.rejects(current.sessions.complete(current.project.id), /Sign-in is not complete/);
  } finally { await current.cleanup(); await challenge.cleanup(); }
});

test('pending and saved sessions expire, and closing the browser removes stale pending status', { skip: !installed }, async () => {
  const current = await fixture({ pendingMs: 1000, savedMs: 150 });
  try {
    await current.sessions.open(current.project);
    await until(() => current.sessions.status(current.project.id).state === 'none');
    await until(() => !current.browsers[0].isConnected());
    await current.sessions.open(current.project);
    await current.page().close();
    assert.equal(current.sessions.status(current.project.id).state, 'none');
    await current.sessions.open(current.project, undefined, credentials);
    await current.page().getByRole('button', { name: 'Login', exact: true }).click();
    await until(() => current.sessions.status(current.project.id).state === 'ready');
    await until(() => current.sessions.status(current.project.id).state === 'none');
    assert.equal(await current.sessions.take(current.project.id), undefined);
  } finally { await current.cleanup(); }
});

test('clear closes all windows, removes saved sessions, and invalid origins fail with fixed safe errors', { skip: !installed }, async () => {
  const current = await fixture();
  try {
    await current.sessions.open(current.project, undefined, credentials);
    await current.page().getByRole('button', { name: 'Login', exact: true }).click();
    await until(() => current.sessions.status(current.project.id).state === 'ready');
    await current.sessions.open({ ...current.project, id: 'another-local-project' });
    await current.sessions.clear();
    assert.equal(current.sessions.status(current.project.id).state, 'none');
    assert.equal(current.sessions.status('another-local-project').state, 'none');
    assert.ok(current.browsers.every(browser => !browser.isConnected()));
    await assert.rejects(current.sessions.open(current.project, 'https://invalid.example.test/signin', credentials),
      { message: 'Add the login URL origin to allowed origins first.' });
  } finally { await current.cleanup(); }
});

test('concurrent opens replace the prior window safely and clear waits for an in-flight launch', { skip: !installed }, async () => {
  const current = await fixture({ pollMs: 60_000 });
  try {
    await Promise.all([current.sessions.open(current.project), current.sessions.open(current.project)]);
    assert.equal(current.browsers.length, 2);
    assert.equal(current.browsers[0].isConnected(), false);
    assert.equal(current.browsers[1].isConnected(), true);
    assert.equal(current.sessions.status(current.project.id).state, 'pending');
    await current.sessions.clear();
    assert.ok(current.browsers.every(browser => !browser.isConnected()));
    const opening = current.sessions.open(current.project);
    const clearing = current.sessions.clear();
    await Promise.all([opening, clearing]);
    assert.equal(current.sessions.status(current.project.id).state, 'none');
    assert.ok(current.browsers.every(browser => !browser.isConnected()));
  } finally { await current.cleanup(); }
});
