import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Project } from '../shared/types.js';

export type SavedLogin = {
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>;
  sessionStorage: Array<{ origin: string; entries: [string, string][] }>;
};
type Options = { headless?: boolean; pollMs?: number; pendingMs?: number; savedMs?: number; launch?: typeof chromium.launch };
type Pending = { browser: Browser; context: BrowserContext; origins: Set<string>; expires: number;
  poll: ReturnType<typeof setInterval>; timer: ReturnType<typeof setTimeout>; checking?: Promise<boolean>; formURL?: string };
type Ready = { saved: SavedLogin; expires: number; timer: ReturnType<typeof setTimeout> };
const waiting = 'Finish signing in in the unrecorded browser. Your session will be saved automatically.';
const missing = 'Open the unrecorded sign-in browser and sign in before exploring.';
const signedOut = 'Sign-in is not complete. Finish signing in in the unrecorded browser; it remains open.';
function allowed(value: string, origins: Set<string>) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && origins.has(u.origin); }
  catch { return false; }
}
async function authenticated(page: Page, entry: Pending) {
  if (page.isClosed() || !allowed(page.url(), entry.origins)) return false;
  const current = new URL(page.url());
  for (const frame of page.frames()) {
    let ancestor = frame, visible = true;
    while (ancestor.parentFrame()) {
      if (!await (await ancestor.frameElement()).isVisible()) { visible = false; break; }
      ancestor = ancestor.parentFrame()!;
    }
    if (visible && await frame.locator('input[type="password"]:visible,input[autocomplete="username"]:visible,input[autocomplete="one-time-code"]:visible,input[name*="otp" i]:visible').count()) {
      entry.formURL ||= current.origin + current.pathname; return false;
    }
  }
  if (/(?:^|\/)(?:sign[ -]?in|log[ -]?in|login|auth|authentication|oauth|authorize|callback|mfa|two-factor|forgot-password|reset-password)(?:\/|$)/i.test(current.pathname)) return false;
  if (await page.getByRole('button', { name: /^(sign[ -]?in|log[ -]?in|login)$/i }).first().isVisible()) return false;
  if (await page.getByRole('button', { name: /log[ -]?out|sign[ -]?out/i }).first().isVisible() ||
    await page.getByRole('link', { name: /log[ -]?out|sign[ -]?out/i }).first().isVisible()) return true;
  const transitioned = Boolean(entry.formURL && entry.formURL !== current.origin + current.pathname);
  const internalLinks = await page.locator('a[href]:visible').evaluateAll(links => links.filter(link => {
    try { return new URL((link as HTMLAnchorElement).href).origin === location.origin; } catch { return false; }
  }).length);
  const navigation = await page.locator('nav:visible,aside:visible,[role="navigation"]:visible').count() > 0 || (transitioned && internalLinks >= 3);
  return navigation && await page.getByRole('heading', { name: /dashboard|overview|workspace|appointments|patients|analytics|projects/i }).first().isVisible();
}

/** Restore only the origin that owns each sessionStorage snapshot, before product scripts run. */
export async function applySavedLogin(context: BrowserContext, saved: SavedLogin): Promise<void> {
  await context.addInitScript((snapshots: SavedLogin['sessionStorage']) => {
    const snapshot = snapshots.find(value => value.origin === location.origin);
    if (snapshot) for (const [key, value] of snapshot.entries) sessionStorage.setItem(key, value);
  }, saved.sessionStorage);
}

/** Login windows and saved credentials stay exclusively in process memory, without recording. */
export class LoginSessions {
  private pending = new Map<string, Pending>();
  private ready = new Map<string, Ready>();
  private operations = new Map<string, Promise<void>>();
  constructor(private options: Options = {}) {}

  async open(project: Project, loginUrl = project.brief.url, credentials?: { username: string; password: string }): Promise<void> {
    return this.serialize(project.id, () => this.prepare(project, loginUrl, credentials));
  }
  private serialize(id: string, action: () => Promise<void>): Promise<void> {
    const operation = (this.operations.get(id) || Promise.resolve()).catch(() => {}).then(action);
    this.operations.set(id, operation);
    const release = () => { if (this.operations.get(id) === operation) this.operations.delete(id); };
    void operation.then(release, release);
    return operation;
  }
  private async prepare(project: Project, loginUrl: string, credentials?: { username: string; password: string }): Promise<void> {
    let origins: Set<string>;
    try { origins = new Set([project.brief.url, ...project.brief.allowedOrigins].map(value => new URL(value).origin)); }
    catch { throw new Error('Add the login URL origin to allowed origins first.'); }
    if (!allowed(loginUrl, origins)) throw new Error('Add the login URL origin to allowed origins first.');
    await this.discardNow(project.id);
    let browser: Browser | undefined;
    try {
      browser = await (this.options.launch || chromium.launch.bind(chromium))({ headless: this.options.headless ?? false });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: false });
      await context.route('**/*', route => {
        const request = route.request();
        return request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame() && !allowed(request.url(), origins)
          ? route.abort('blockedbyclient') : route.continue();
      });
      const pendingMs = this.options.pendingMs ?? 4 * 60 * 60 * 1000;
      const entry: Pending = { browser, context, origins, expires: Date.now() + pendingMs,
        poll: setInterval(() => { if (this.pending.get(project.id) === entry) void this.save(project.id).catch(() => {}); }, this.options.pollMs ?? 1000),
        timer: setTimeout(() => { if (this.pending.get(project.id) === entry) void this.discardPending(project.id); }, pendingMs) };
      entry.poll.unref(); entry.timer.unref();
      this.pending.set(project.id, entry);
      const closed = () => { if (this.pending.get(project.id) === entry) void this.discardPending(project.id); };
      browser.on('disconnected', closed); context.on('close', closed);
      context.on('page', page => {
        page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
        page.on('download', download => { void download.cancel().catch(() => {}); });
        page.on('close', () => { if (!context.pages().length) closed(); });
      });
      const page = await context.newPage();
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (credentials) {
        if (!allowed(page.url(), origins)) throw new Error();
        const password = page.locator('input[type="password"]:visible').first();
        await password.waitFor({ timeout: 10000 });
        await page.locator('input[type="email"]:visible,input[autocomplete="username"]:visible,input[name*="email" i]:visible,input[name*="user" i]:visible,input[type="text"]:visible').first().fill(credentials.username);
        await password.fill(credentials.password);
      }
      await this.save(project.id);
    } catch {
      await this.discardNow(project.id); await browser?.close().catch(() => {});
      throw new Error('The unrecorded sign-in browser could not be prepared. Check the sign-in URL or open it without automatic field filling.');
    }
  }

  private async save(id: string): Promise<boolean> {
    const entry = this.pending.get(id);
    if (!entry) return this.status(id).state === 'ready';
    if (entry.checking) return entry.checking;
    entry.checking = (async () => {
      for (const page of entry.context.pages()) {
        if (!await authenticated(page, entry)) continue;
        const storageState = await entry.context.storageState({ indexedDB: true });
        storageState.origins = storageState.origins.filter(value => entry.origins.has(value.origin));
        const hosts = [...entry.origins].map(origin => new URL(origin).hostname);
        storageState.cookies = storageState.cookies.filter(cookie => hosts.some(host => host === cookie.domain.replace(/^\./, '') || host.endsWith('.' + cookie.domain.replace(/^\./, ''))));
        const snapshots = new Map<string, [string, string][]>();
        for (const current of entry.context.pages()) for (const frame of current.frames()) {
          if (!allowed(frame.url(), entry.origins)) continue;
          const snapshot = await frame.evaluate(() => ({ origin: location.origin, entries: Object.entries(sessionStorage) }));
          snapshots.set(snapshot.origin, snapshot.entries);
        }
        if (this.pending.get(id) !== entry || Date.now() >= entry.expires || !await authenticated(page, entry)) return false;
        const saved: SavedLogin = { storageState, sessionStorage: [...snapshots].map(([origin, entries]) => ({ origin, entries })) };
        const savedMs = this.options.savedMs ?? 8 * 60 * 60 * 1000;
        const ready: Ready = { saved, expires: Date.now() + savedMs, timer: setTimeout(() => {
          if (this.ready.get(id) === ready) this.ready.delete(id);
        }, savedMs) };
        ready.timer.unref(); this.ready.set(id, ready);
        await this.discardPending(id);
        return true;
      }
      return false;
    })().finally(() => { entry.checking = undefined; });
    return entry.checking;
  }

  async complete(id: string): Promise<void> {
    if (this.status(id).state === 'ready') return;
    if (!this.pending.has(id)) throw new Error(missing);
    if (!await this.save(id).catch(() => false)) throw new Error(signedOut);
  }
  /** Return a reusable copy without extending the original saved-session expiry. */
  async take(id: string): Promise<SavedLogin | undefined> {
    if (this.pending.has(id)) await this.complete(id);
    if (this.status(id).state !== 'ready') return undefined;
    return structuredClone(this.ready.get(id)!.saved);
  }
  status(id: string): { state: 'pending' | 'ready' | 'none'; message: string } {
    const ready = this.ready.get(id);
    if (ready && ready.expires > Date.now()) return { state: 'ready', message: 'Sign-in saved in memory for exploration and retries until its original eight-hour expiry.' };
    if (ready) { clearTimeout(ready.timer); this.ready.delete(id); }
    const pending = this.pending.get(id);
    if (pending && pending.expires > Date.now() && pending.browser.isConnected()) return { state: 'pending', message: waiting };
    if (pending) void this.discardPending(id);
    return { state: 'none', message: missing };
  }
  private async discardPending(id: string): Promise<void> {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id); clearInterval(pending.poll); clearTimeout(pending.timer);
    await pending.browser.close().catch(() => {});
  }
  async discard(id: string): Promise<void> {
    return this.serialize(id, () => this.discardNow(id));
  }
  private async discardNow(id: string): Promise<void> {
    const ready = this.ready.get(id);
    if (ready) clearTimeout(ready.timer);
    this.ready.delete(id); await this.discardPending(id);
  }
  async clear(): Promise<void> {
    await Promise.all([...new Set([...this.pending.keys(), ...this.ready.keys(), ...this.operations.keys()])].map(id => this.discard(id)));
  }
}
