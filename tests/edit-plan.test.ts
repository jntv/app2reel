import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFilmEdit,draftFilmEdits,syncReviewedSources} from '../server/edit-plan.js';
import {StoryboardPacingError} from '../server/storyboard.js';
import {clipTiming,sourceTime} from '../server/demo-motion.js';
import {filmPlanSchema,briefSchema,sceneSchema} from '../server/store.js';
import type {LocalAI} from '../server/ai.js';
import type {Project,Scene} from '../shared/types.js';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../server/store.js';
import {Pipeline} from '../server/pipeline.js';

const sources:Scene[]=[{id:'source-1',title:'Leads',caption:'Review leads',narration:'Find leads with the phone search and status filters.',duration:6,screenshot:'shot-001.png',recordingStart:8,recordingEnd:15,recordingRanges:[{start:8,end:9},{start:12,end:15}],focusRevealAt:1.2,focus:{x:.4,y:.2,zoom:1.8},focusArea:{x:.1,y:.1,width:.6,height:.2},redactions:[{x:.1,y:.6,width:.8,height:.3}],visualModel:{layout:'table',labels:['Phone','Open','Closed']}},
{id:'source-2',title:'Bookings',caption:'Review bookings',narration:'Review appointments and branch options.',duration:6,screenshot:'shot-002.png',recordingStart:30,recordingEnd:36,focusRevealAt:.4,focus:{x:.5,y:.5,zoom:1.6}}];
const edit=(sourceIndex=0,framing='detail')=>({sourceIndex,framing,title:'Review this view',caption:'Your workspace',narration:'Review the visible controls in your workspace.',duration:6,camera:{contextHold:1.5,moveDuration:1.6,releaseDuration:.8},transition:{type:'dissolve',duration:.7}});

test('model edits compile independent exact clocks while retaining reviewed cuts, masks and real source bindings',()=>{
  const demo=compileFilmEdit({rationale:'Teach the controls.',scenes:[edit(0,'context'),edit(0),edit(1)]},sources,90,'demo');
  const promo=compileFilmEdit({rationale:'A concise benefit story.',scenes:[{...edit(1),narration:'Keep your day in view.'},edit(0)]},sources,45,'promo');
  assert.equal(demo.scenes.reduce((sum,s)=>sum+Math.round(s.duration*30),0),2700);
  assert.equal(promo.scenes.reduce((sum,s)=>sum+Math.round(s.duration*30),0),1350);
  assert.equal(demo.scenes[0].focus!.zoom,1);assert.equal(demo.scenes[1].focus!.zoom,1.8);
  assert.equal(demo.scenes[0].sourceRole,'primary');assert.equal(demo.scenes[1].sourceRole,'detail');
  assert.deepEqual(demo.scenes[0].recordingRanges,sources[0].recordingRanges);
  assert.deepEqual(demo.scenes[1].recordingRanges,[{start:13.8,end:15}],'The adjoining detail continues on the settled result without replaying navigation.');
  assert.equal(demo.scenes[1].sourceId,'source-1');assert.equal(demo.scenes[1].focusRevealAt,0);
  assert.deepEqual(demo.scenes[0].redactions,sources[0].redactions);
  demo.scenes[0].redactions![0].x=.2;assert.equal(sources[0].redactions![0].x,.1,'The source catalog remains immutable.');
  assert.notDeepEqual(demo.scenes.map(s=>s.narration),promo.scenes.map(s=>s.narration));
  assert.equal(filmPlanSchema.safeParse(demo).success,true);assert.equal(filmPlanSchema.safeParse(promo).success,true);
});

test('re-edited settle timing uses the old and new playback clocks and never reveals an unreachable result',()=>{
  const slow:Scene={...sources[1],duration:4,recordingStart:0,recordingEnd:8,focusRevealAt:3};
  const extended=compileFilmEdit({rationale:'Give the result breathing room.',scenes:[edit(0)]},[slow],10,'demo').scenes[0];
  assert.ok(Math.abs(extended.focusRevealAt!-3.36)<1e-9,'Removing the original 1.12x speedup must delay the focus to the same real source point.');
  const source=sourceTime(clipTiming(0,8,slow.duration),slow.focusRevealAt!);
  assert.ok(Math.abs(source-sourceTime(clipTiming(0,8,extended.duration),extended.focusRevealAt!))<1e-9);
  const compressed=compileFilmEdit({rationale:'Retain the result.',scenes:[{...edit(0),narration:'',caption:''}]},[slow],3.1,'demo').scenes[0];
  assert.ok(Math.abs(compressed.focusRevealAt!-3)<1e-9,'A result near the end must retain its true readiness, not duration minus 0.7.');
  const unreachable:Scene={...slow,duration:5,recordingEnd:5,focusRevealAt:4.5};
  assert.throws(()=>compileFilmEdit({rationale:'Too short.',scenes:[{...edit(0),narration:'',caption:''}]},[unreachable],2,'demo'),error=>error instanceof StoryboardPacingError&&/cannot reach its observed result/.test(error.message));
  const promo=compileFilmEdit({rationale:'Rebuilt graphics already show the settled view.',scenes:[{...edit(0),narration:'',caption:''}]},[unreachable],2,'promo');
  assert.equal(promo.scenes[0].focusRevealAt,0,'The graphics camera is governed by its own authored context hold.');
});

test('reviewed primary cuts, ROI and reveal survive replanning while derived tails never replace the full source',()=>{
  const original=structuredClone(sources),previous=compileFilmEdit({rationale:'Context then detail.',scenes:[edit(0,'context'),edit(0)]},original,20,'demo').scenes;
  const unchanged=syncReviewedSources(original,previous,structuredClone(previous));
  assert.deepEqual(unchanged[0].focus,original[0].focus,'Generated context framing is not a user edit to the source focus.');
  assert.deepEqual(unchanged[0].recordingRanges,original[0].recordingRanges);
  const next=structuredClone(previous);
  next[0].recordingEnd=14.6;next[0].recordingRanges=[{start:8,end:8.8},{start:12.4,end:14.6}];
  next[0].focus={x:.4,y:.16,zoom:1.45};next[0].focusArea={x:.2,y:.1,width:.4,height:.12};next[0].focusRevealAt=1.1;
  next[1].recordingStart=14.4;next[1].recordingEnd=14.6;next[1].recordingRanges=[{start:14.4,end:14.6}];
  next[1].focus={x:.9,y:.9,zoom:2.2};next[1].focusArea={x:.85,y:.85,width:.1,height:.1};next[1].focusRevealAt=.1;
  const detailMask={x:.02,y:.02,width:.04,height:.04};next[1].redactions!.push(detailMask);
  const updated=syncReviewedSources(original,previous,next);
  assert.deepEqual(updated[0].recordingRanges,next[0].recordingRanges);assert.equal(updated[0].recordingEnd,14.6);
  assert.deepEqual(updated[0].focus,next[0].focus);assert.deepEqual(updated[0].focusArea,next[0].focusArea);
  assert.equal(updated[0].focusRevealAt,1.1);assert.equal(updated[0].duration,next[0].duration);
  assert.ok(updated[0].redactions!.some(mask=>JSON.stringify(mask)===JSON.stringify(detailMask)));
  const replanned=compileFilmEdit({rationale:'Keep the reviewed cuts.',scenes:[edit(0,'context'),edit(0)]},updated,30,'demo').scenes;
  assert.deepEqual(replanned[0].recordingRanges,next[0].recordingRanges);assert.deepEqual(replanned[0].focusArea,next[0].focusArea);
  assert.equal(replanned[0].focusRevealAt,1.1);assert.equal(replanned[1].focus!.zoom,1.45);
  assert.ok(Math.abs(replanned[1].recordingStart!-13.4)<1e-8,'Derived detail comes from the corrected full source tail.');
  assert.deepEqual(sources,original,'Synchronization must not mutate any input.');
});

test('source synchronization ignores newly invented identities and keeps geometry-only edits on the original settle clock',()=>{
  const previous=compileFilmEdit({rationale:'A slower explanation.',scenes:[edit(0)]},sources,10,'demo').scenes;
  const next=structuredClone(previous);next[0].focusArea={x:.2,y:.2,width:.2,height:.2};
  const synced=syncReviewedSources(sources,previous,next);
  assert.equal(synced[0].duration,sources[0].duration);assert.equal(synced[0].focusRevealAt,sources[0].focusRevealAt);
  const invented={...next[0],id:'not-an-existing-scene',recordingRanges:[{start:14,end:15}]};
  assert.deepEqual(syncReviewedSources(sources,previous,[invented])[0].recordingRanges,sources[0].recordingRanges);
  const relabeled={...next[0],sourceId:'source-2'};
  assert.deepEqual(syncReviewedSources(sources,previous,[relabeled])[1].focusArea,sources[1].focusArea);
});

test('a too-short edit receives the bounded pacing correction instead of moving focus before the result',async()=>{
  const slow:Scene={...sources[0],duration:20,recordingStart:0,recordingEnd:20,recordingRanges:undefined,focusRevealAt:15};
  let calls=0;
  const ai={json:async(prompt:string)=>{
    calls++;if(calls===2)assert.match(prompt,/cannot reach its observed result/);
    return {demo:{rationale:'A reachable moment.',scenes:[edit(calls===1?0:1)]},promo:{rationale:'A rebuilt graphic.',scenes:[edit(0)]}};
  }} as unknown as LocalAI;
  const plans=await draftFilmEdits({brief:{name:'Fixture',purpose:'Explain',actors:'Teams'}} as Project,[slow,sources[1]],{demo:10,promo:10},'',ai,new AbortController().signal);
  assert.equal(calls,2);assert.equal(plans.demo.scenes[0].sourceId,sources[1].id);
});

test('edit language rejects unknown footage, retrograde walkthrough, arbitrary paths and inconsistent transitions',()=>{
  const film=(scenes:unknown[])=>({rationale:'Test.',scenes});
  assert.throws(()=>compileFilmEdit(film([edit(99)]),sources,10,'demo'),/unknown captured/);
  assert.throws(()=>compileFilmEdit(film([edit(1),edit(0)]),sources,10,'demo'),/order/);
  assert.throws(()=>compileFilmEdit(film([{...edit(),screenshot:'other.png'}]),sources,10,'demo'));
  assert.throws(()=>compileFilmEdit(film([{...edit(),redactions:[]}]),sources,10,'demo'));
  assert.throws(()=>compileFilmEdit(film([{...edit(),transition:{type:'cut',duration:.5}}]),sources,10,'demo'));
  assert.equal(sceneSchema.safeParse({...sources[0],transition:{type:'dissolve',duration:0}}).success,false);
  assert.equal(filmPlanSchema.safeParse({rationale:'Wrong clock.',targetDuration:12,scenes:sources}).success,true);
  assert.equal(filmPlanSchema.safeParse({targetDuration:13,scenes:sources}).success,false);
  assert.equal(briefSchema.shape.duration.parse(undefined),90);assert.equal(briefSchema.shape.duration.safeParse(181).success,false);
});

test('a malformed model edit receives one bounded correction and uses no web or product actions',async()=>{
  let calls=0;
  const ai={json:async(prompt:string,_schema:unknown,options:{webSearch:boolean})=>{
    calls++;assert.equal(options.webSearch,false);assert.match(prompt,/90-second SCREEN WALKTHROUGH/);assert.match(prompt,/45-second MOTION PROMO/);assert.match(prompt,/never imply the replay is a new click/);
    if(calls===1)return {demo:{rationale:'Wrong source.',scenes:[edit(99)]},promo:{rationale:'Wrong.',scenes:[edit(0)]}};
    assert.match(prompt,/previous draft could not compile/);
    return {demo:{rationale:'Walkthrough.',scenes:[edit(0),edit(0),edit(1)]},promo:{rationale:'Promo.',scenes:[edit(0),edit(1)]}};
  }} as unknown as LocalAI;
  const project={brief:{name:'Fixture',purpose:'Review your work',actors:'Teams'}} as Project;
  const plans=await draftFilmEdits(project,sources,{demo:90,promo:45},'Explain the controls.',ai,new AbortController().signal);
  assert.equal(calls,2);assert.equal(plans.demo.targetDuration,90);assert.equal(plans.promo.targetDuration,45);
});

test('adult voice plans reserve speech handles and request a shorter script before rendering',async()=>{
  let calls=0;
  const ai={json:async(prompt:string)=>{
    calls++;
    if(calls===2)assert.match(prompt,/this voice and scene count allow 32/);
    const scenes=[edit(0),edit(1)].map(scene=>({...scene,narration:calls===1?Array(19).fill('word').join(' '):'Review your workspace controls.'}));
    return {demo:{rationale:'Teach the controls.',scenes},promo:{rationale:'A short introduction.',scenes:[edit(0),edit(1)]}};
  }} as unknown as LocalAI;
  const p={brief:{name:'Fixture',purpose:'Review your work',actors:'Teams'},renderSettings:{narrationVoice:'qwen_indian_male'}} as Project;
  const plans=await draftFilmEdits(p,sources,{demo:20,promo:20},'',ai,new AbortController().signal);
  assert.equal(calls,2);assert.equal(plans.demo.targetDuration,20);
});

test('re-editing retains new masks and failed planning preserves reviewed films and source evidence',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-re-edit-'));
  try{
    const store=new Store(directory);await store.init();
    const p=await store.create(briefSchema.parse({name:'Fixture',url:'https://example.com',description:'A product editing fixture',purpose:'Explain controls',actors:'Teams',features:['Leads']}));
    p.recording='capture.webm';p.scenes=structuredClone(sources);p.editSources=structuredClone(sources);
    p.filmPlans={demo:{targetDuration:12,scenes:structuredClone(sources).map((scene,index)=>({...scene,sourceId:scene.id,id:`demo-${index}`}))}};
    const newMask={x:.01,y:.01,width:.05,height:.05};p.filmPlans.demo!.scenes[0].redactions!.push(newMask);
    let fail=false,prompt='';
    const ai={status:async()=>({connected:true}),json:async(text:string)=>{prompt=text;return fail?{}:{demo:{rationale:'Teach the controls.',scenes:[edit(0),edit(1)]},promo:{rationale:'Introduce the product.',scenes:[edit(0),edit(1)]}};}} as unknown as LocalAI;
    const pipeline=new Pipeline(store,ai);
    await pipeline.plan(p,{demo:30,promo:20});
    for(let tick=0;pipeline.isBusy()&&tick<100;tick++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(p.stage,'review',p.error);assert.equal(p.filmPlans.demo!.targetDuration,30);
    assert.ok(p.filmPlans.demo!.scenes[0].redactions!.some(mask=>JSON.stringify(mask)===JSON.stringify(newMask)));
    assert.equal(p.recording,'capture.webm');assert.match(prompt,/Do not browse, run commands/);
    const original=JSON.stringify(p.filmPlans);p.outputs=[{kind:'promo',file:'promo.mp4',width:720,height:1280,fps:30,duration:20,narrated:true}];
    fail=true;await pipeline.plan(p,{demo:90,promo:45});
    for(let tick=0;pipeline.isBusy()&&tick<100;tick++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(p.stage,'failed');assert.equal(JSON.stringify(p.filmPlans),original);assert.equal(p.outputs[0].file,'promo.mp4');assert.equal(p.recording,'capture.webm');
  }finally{await rm(directory,{recursive:true,force:true});}
});
