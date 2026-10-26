import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildStoryboard, chronologicalPlan, sceneDurations, shotInterval, storyboardEvidence, StoryboardPacingError, type PlannedScene } from '../server/storyboard.js';
import { clipTiming, sourceTime } from '../server/demo-motion.js';
import { Pipeline } from '../server/pipeline.js';
import { Store, briefSchema } from '../server/store.js';
import { fixtureHTML } from '../server/fixture.js';
import type { LocalAI } from '../server/ai.js';
import type { Finding, Shot } from '../shared/types.js';

const planned = (shotIndex: number, duration = 6, narration = 'Review your workspace.'): PlannedScene => ({ shotIndex, duration, narration, title: `Moment ${shotIndex}`, caption: 'An observed view.', feature: 'Overview' });
const shots: Shot[] = Array.from({ length: 4 }, (_, index) => ({ id: `shot-${index}`, title: `View ${index}`, screenshot: `shot-${index}.png`, url: 'https://example.test/work?private=omitted', at: index * 20 + 3,
  entryStart: index ? index * 20 : undefined, entrySettled: index ? index * 20 + 1.5 : undefined,
  actionStart: (index + 1) * 20, actionEnd: (index + 1) * 20 + 1.5 }));
const findings: Finding[] = [{ feature: 'Overview', status: 'observed', evidence: 'The overview is visible.', screenshot: shots[0].screenshot }, { feature: 'Reports', status: 'not-observed', evidence: 'Not available.' }];

test('storyboard sorts and deduplicates valid captured indices while keeping first intent and exact observed feature evidence', () => {
  const first = { ...planned(2), title: 'First version' };
  const input = [first, planned(0), { ...planned(2), title: 'Duplicate' }, planned(-1), planned(9), planned(1)];
  assert.deepEqual(chronologicalPlan(input, shots).map(scene => [scene.shotIndex, scene.title]), [[0, 'Moment 0'], [1, 'Moment 1'], [2, 'First version']]);
  const result = buildStoryboard([planned(2), planned(0), { ...planned(1), feature: 'Reports' }], shots, findings, 30, 90);
  assert.deepEqual(result.shotIndices, [0, 1, 2]);
  assert.deepEqual(result.scenes.map(scene => scene.feature), ['Overview', '', ''], 'Neither unobserved features nor a different shot’s evidence can label the scene.');
  assert.equal(input[0].title, 'First version');
  assert.throws(() => buildStoryboard([planned(99)], shots, findings, 30, 90), /did not reference/);
});

test('requested variable durations normalize to exact30fps time while preserving speech floors and redistributing both bounds', () => {
  const durations = sceneDurations([planned(0, 3), planned(1, 6), planned(2, 9)], 30);
  assert.deepEqual(durations, [5, 10, 15]);
  const longScript = Array.from({ length: 60 }, () => 'word').join(' ');
  const skewed = sceneDurations([planned(0, 30, 'One.'), planned(1, 1, 'Two.'), planned(2, 1, longScript)], 70);
  assert.equal(skewed.reduce((sum, seconds) => sum + Math.round(seconds * 30), 0), 70 * 30, 'Simultaneous upper/lower constraints must not lose or invent time.');
  assert.equal(skewed[0], 30); assert.ok(skewed[2] >= 60 / 2.6 + .65); assert.ok(skewed.every(value => value >= 1 && value <= 30));
  const fractional = sceneDurations([planned(0, 1), planned(1, 2), planned(2, 4)], 31);
  assert.equal(fractional.reduce((sum, seconds) => sum + Math.round(seconds * 30), 0), 31 * 30);
  assert.ok(fractional.every(seconds => Math.abs(seconds * 30 - Math.round(seconds * 30)) < 1e-8));
  assert.throws(() => sceneDurations([planned(0, 6, Array(30).fill('word').join(' '))], 10), StoryboardPacingError);
  assert.throws(() => sceneDurations([planned(0), planned(1)], 90), StoryboardPacingError);
});

test('source intervals include the actual entry and result hold while excluding model wait and outgoing clicks', () => {
  const shot = { ...shots[1], at: 22, entryStart: 20, entrySettled: 21.5, actionStart: 80 };
  const interval = shotInterval(shot, 6, 100);
  assert.equal(interval.recordingStart, 19.75); assert.equal(interval.recordingEnd, 22.6);
  assert.ok(interval.recordingEnd! < shot.actionStart, 'The later AI wait and outgoing action cannot enter this clip.');
  const timing = clipTiming(interval.recordingStart!, interval.recordingEnd!, 6);
  assert.ok(sourceTime(timing, interval.focusRevealAt!) >= shot.entrySettled, 'Screenshot highlights cannot precede the visible state they describe.');
  const quick = shotInterval({ ...shot, at: 21.6, actionStart: 21.7 }, 6, 100);
  assert.equal(quick.recordingEnd, 21.7);
  const accelerated = shotInterval({ ...shot, at: 20.6, entrySettled: 20.5, actionStart: 20.9 }, 1, 100);
  const fast = clipTiming(accelerated.recordingStart!, accelerated.recordingEnd!, 1);
  assert.ok(Math.abs(fast.playbackRate - 1.12) < 1e-8);
  assert.ok(sourceTime(fast, accelerated.focusRevealAt!) >= 20.5);
});

test('long loading intervals and legacy shots show the observed result without fabricated actions or out-of-file times', () => {
  const interval = shotInterval({ ...shots[1], entryStart: 1, entrySettled: 30, at: 31, actionStart: 90 }, 4, 100);
  assert.equal(interval.recordingStart, 30.85); assert.equal(interval.recordingEnd, 31.8);
  const legacy = shotInterval({ ...shots[0], at: 5, actionStart: undefined, actionEnd: undefined }, 4, 10);
  assert.equal(legacy.recordingStart, 4.85); assert.equal(legacy.recordingEnd, 5.8);
  const tail = shotInterval({ ...shots[0], at: 12, actionStart: undefined }, 4, 10);
  assert.ok(tail.recordingStart! >= 0 && tail.recordingEnd! <= 10 && tail.recordingEnd! > tail.recordingStart!);
  assert.ok(tail.focusRevealAt! >= 0 && tail.focusRevealAt! <= 4);
  assert.throws(() => shotInterval(shots[0], 4, 0), /usable recorded/);
});

test('planner evidence distinguishes incoming completed actions, current observations and later outgoing intentions', () => {
  const evidence = storyboardEvidence([{ ...shots[0], action: 'Open the next view.' }, { ...shots[1], action: 'Inspect the reporting tab.' }, { ...shots[2], entryStart: 20, entrySettled: 21.5 }], findings);
  assert.deepEqual(evidence[1].incoming, { fromShotIndex: 0, start: 20, settled: 21.5, explorerIntent: 'Open the next view.', completed: true });
  assert.equal(evidence[1].outgoing.explorerIntent, 'Inspect the reporting tab.');
  assert.equal(evidence[0].incoming, null);
  assert.equal(evidence[2].incoming?.fromShotIndex, 0, 'An intervening wait must not relabel the earlier actual entry action.');
  assert.equal(evidence[0].current.observedFeatures[0].feature, 'Overview');
  assert.equal(evidence[1].current.observedFeatures.length, 0);
  assert.ok(!JSON.stringify(evidence).includes('private=omitted'));
});

test('ten-second sample pipeline still reaches review with a natural short script and zero model calls', { skip: !existsSync(chromium.executablePath()), timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-sample-plan-'));
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end(fixtureHTML()); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const store = new Store(directory); await store.init(); let calls = 0;
  const ai = { status: async () => { calls++; throw new Error('Sample cannot call AI.'); }, json: async () => { calls++; throw new Error('Sample cannot call AI.'); } } as unknown as LocalAI;
  const pipeline = new Pipeline(store, ai);
  const project = await store.create(briefSchema.parse({ name: 'Orbit', url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, description: 'A local sample product.', purpose: 'Show a coherent sample.', actors: 'Teams', features: ['Overview', 'Projects', 'Analytics', 'Team'], sample: true, duration: 10 }));
  try {
    await pipeline.explore(project);
    const deadline = Date.now() + 25000;
    while (pipeline.isBusy() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(pipeline.isBusy(), false); assert.equal(project.stage, 'review', project.error);
    assert.equal(calls, 0); assert.equal(project.scenes.length, 4);
    assert.equal(project.scenes.reduce((sum, scene) => sum + Math.round(scene.duration * 30), 0), 300);
    assert.ok(project.scenes.every(scene => scene.focusRevealAt! <= scene.duration && scene.recordingEnd! > scene.recordingStart!));
    assert.equal(JSON.parse(await readFile(path.join(store.dir(project.id), 'storyboard.json'), 'utf8')).scenes.length, 4);
  } finally {
    pipeline.cancel(project.id);
    while (pipeline.isBusy()) await new Promise(resolve => setTimeout(resolve, 30));
    await rm(directory, { recursive: true, force: true }); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('a verbose model plan gets exactly one bounded correction attempt before review or a clear failure', { skip: !existsSync(chromium.executablePath()), timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'capture-plan-retry-'));
  const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end(fixtureHTML()); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const store = new Store(directory); await store.init();
  const projects: { pipeline: Pipeline; id: string }[] = [];
  try {
    for (const retrySucceeds of [true, false]) {
      let plans = 0, directed = 0;
      const ai = { status: async () => ({ connected: true }), json: async (prompt: string) => {
        if (prompt.startsWith('Research this product')) return { sources: [] };
        if (prompt.startsWith('You are the browser exploration planner')) return { action: 'done', elementId: -1, text: '', url: '', reason: 'Overview is visible.', observedFeature: 'Overview', evidence: 'The workspace overview is visible.' };
        if (prompt.startsWith('Direct one coherent')) {
          plans++; assert.match(prompt, /INCOMING/); assert.match(prompt, /OUTGOING/); assert.match(prompt, /22 spoken words total/);
          if (plans === 2) assert.match(prompt, /previous draft did not fit/);
          return { scenes: [planned(0, 10, plans === 2 && retrySucceeds ? 'See your workspace.' : Array(30).fill('word').join(' '))] };
        }
        if (prompt.startsWith('You are directing a smooth product demonstration')) { directed++; return { focusArea: { x: .3, y: .2, width: .4, height: .3 }, focus: { x: .5, y: .35, zoom: 1.4 } }; }
        if (prompt.startsWith('You are the editor of two different product films')) {
          const edit={sourceIndex:0,framing:'detail',title:'Review the workspace',caption:'Your workspace',narration:'See your workspace.',duration:10,camera:{contextHold:1,moveDuration:1.5,releaseDuration:0},transition:{type:'cut',duration:0}};
          return {demo:{rationale:'Teach the view.',scenes:[edit]},promo:{rationale:'Introduce the product.',scenes:[{...edit,narration:'Meet your workspace.'}]}};
        }
        throw new Error('Unexpected inference request.');
      } } as unknown as LocalAI;
      const pipeline = new Pipeline(store, ai);
      const project = await store.create(briefSchema.parse({ name: 'Fixture', url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, description: 'A local planning fixture.', purpose: 'Review your workspace.', actors: 'Teams', features: ['Overview'], duration: 10, maxSteps: 3 }));
      projects.push({ pipeline, id: project.id });
      await pipeline.explore(project);
      const deadline = Date.now() + 12000;
      while (pipeline.isBusy() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(pipeline.isBusy(), false); assert.equal(plans, 2);
      assert.equal(project.stage, retrySucceeds ? 'review' : 'failed', project.error);
      assert.equal(directed, retrySucceeds ? 1 : 0);
      if (!retrySucceeds) assert.match(project.error || '', /22-word budget/);
    }
  } finally {
    for (const { pipeline, id } of projects) { pipeline.cancel(id); while (pipeline.isBusy()) await new Promise(resolve => setTimeout(resolve, 30)); }
    await rm(directory, { recursive: true, force: true }); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
