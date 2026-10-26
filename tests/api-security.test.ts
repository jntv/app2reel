import test from 'node:test';
import assert from 'node:assert/strict';
import { briefSchema, renderSettingsSchema, sceneSchema } from '../server/store';
import { allowedURL, cleanURL, riskyAction } from '../server/browser';
import { Pipeline } from '../server/pipeline';
import type { LocalAI } from '../server/ai';
import type { Store } from '../server/store';
import type { Project } from '../shared/types';

const brief = {
  name: 'Fixture product', url: 'https://app.example.com/workspace',
  description: 'A fixture product for policy verification.', purpose: 'Verify safe exploration.',
  actors: 'Fixture users', features: ['Overview'],
};

function project(id: string): Project {
  return { id, brief: briefSchema.parse(brief), createdAt: '', updatedAt: '', stage: 'draft',
    progress: 0, message: 'Draft', logs: [], sources: [], findings: [], shots: [], scenes: [], outputs: [] };
}

test('project URLs reject embedded credentials and executable protocols', () => {
  for (const url of ['https://alice:fixture-password@app.example.com', 'https://alice@app.example.com',
    'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,fixture'])
    assert.equal(briefSchema.safeParse({ ...brief, url }).success, false);
  assert.equal(briefSchema.safeParse({ ...brief, allowedOrigins: ['https://alice:fixture-password@login.example.com'] }).success, false);
  assert.equal(briefSchema.safeParse({ ...brief, allowedOrigins: ['https://login.example.com'] }).success, true);
});

test('film format and feature reveal timing are bounded before rendering',()=>{
  const settings={motion:'cinematic',subtitles:true,cursorHighlights:true,promoAspect:'portrait'};
  assert.equal(renderSettingsSchema.safeParse(settings).success,true);
  assert.equal(renderSettingsSchema.safeParse({...settings,promoAspect:'square'}).success,false);
  const scene={id:'s',title:'Open a view',caption:'',narration:'',duration:3,focusRevealAt:1.2};
  assert.equal(sceneSchema.safeParse(scene).success,true);
  assert.equal(sceneSchema.safeParse({...scene,focusRevealAt:3.1}).success,false);
});

test('browser scope requires an exact allowed HTTP origin', () => {
  const p = project('scope');
  p.brief.allowedOrigins = ['https://login.example.com'];
  for (const url of ['https://app.example.com/projects?page=2', 'https://login.example.com/sign-in'])
    assert.equal(allowedURL(url, p), true);
  for (const url of ['https://app.example.com.attacker.test/', 'http://app.example.com/',
    'https://app.example.com:8443/', 'https://app.example.com@attacker.test/',
    'https://alice:fixture-password@app.example.com/', 'javascript:alert(1)', 'file:///etc/passwd'])
    assert.equal(allowedURL(url, p), false);
});

test('URL evidence removes usernames, passwords, query strings and fragments', () => {
  assert.equal(cleanURL('https://alice:fixture-password@app.example.com/reset?token=fixture-token#secret'), 'https://app.example.com/reset');
  assert.equal(cleanURL('not a URL'), '');
});

test('explicitly destructive and external-communication controls are excluded', () => {
  for (const label of ['Delete account', 'Send message', 'Purchase', 'Invite members', 'Publish changes', 'Transfer funds', 'Log out'])
    assert.equal(riskyAction.test(label), true);
  assert.equal(riskyAction.test('Project overview'), false);
});

test('a job reserves the pipeline before awaiting persistence or mutating another project', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let firstLog = true;
  const store = { log: async () => { if (firstLog) { firstLog = false; await gate; } } } as unknown as Store;
  const ai = { status: async () => ({ connected: false, message: 'Fixture inference is disabled.' }) } as unknown as LocalAI;
  const pipeline = new Pipeline(store, ai);
  const first = project('first');
  const second = project('second');
  await pipeline.explore(first);
  assert.equal(pipeline.isBusy(), true);
  try {
    await assert.rejects(pipeline.explore(second), { status: 409 });
    assert.equal(second.stage, 'draft');
    assert.equal(second.message, 'Draft');
  } finally {
    pipeline.cancel(first.id);
    release();
    const deadline = Date.now() + 1_000;
    while (pipeline.isBusy() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(pipeline.isBusy(), false);
  assert.equal(first.stage, 'cancelled');
});
