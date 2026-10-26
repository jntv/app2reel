import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
import {chromium} from 'playwright';
import {cameraAt, cameraForFrame, cameraKeys, cameraTiming, demoLayout, transitionFilter, transitionSchedule} from '../server/demo-motion.js';
import {renderTimeline, renderVideos} from '../server/render.js';
import {narrationFingerprint, readPreparedNarration} from '../server/narration-cache.js';
import {subtitleCues, subtitleSrt} from '../server/subtitles.js';
import type {FilmState} from '../server/film-state.js';
import type {EditTransition, Project, Scene} from '../shared/types.js';

const execute=promisify(execFile);
const available=Boolean(ffmpeg&&existsSync(chromium.executablePath()));
const run=async(args:string[])=>execute(ffmpeg!,['-hide_banner','-v','error','-nostdin','-y',...args],{maxBuffer:8*1024*1024});
const scene=(id:string,duration:number):Scene=>({id,title:`Chapter ${id}`,caption:'Observed workflow.',narration:'Keep work clear.',duration,recordingStart:0,recordingEnd:1.2,focus:{x:.5,y:.5,zoom:1}});

test('reviewed films retain independently authored lengths and reject oversized timelines',()=>{
  for(const [count,duration,total] of [[10,11,110],[6,30,180],[9,5,45]]){
    const timeline=renderTimeline(Array.from({length:count},(_,i)=>scene(String(i),duration)));
    assert.equal(timeline.length,count);
    assert.equal(timeline.reduce((sum,item)=>sum+item.frames,0),total*30);
  }
  assert.throws(()=>renderTimeline([]),/storyboard/);
  assert.throws(()=>renderTimeline(Array.from({length:21},(_,i)=>scene(String(i),1))),/20/);
  assert.throws(()=>renderTimeline([scene('long',30.1)]),/30 seconds/);
  assert.throws(()=>renderTimeline(Array.from({length:7},(_,i)=>scene(String(i),30))),/180 seconds/);
});

const cameraState:FilmState={name:'Product',title:'View',caption:'',feature:'Observed',url:'example.test',scene:1,scenes:3,time:0,totalProgress:0,progress:0,duration:10,focus:{x:.7,y:.3,zoom:1.8},focusArea:{x:.6,y:.2,width:.2,height:.2},focusRevealAt:3,camera:{contextHold:2,moveDuration:2,releaseDuration:2}};
test('authored camera waits for observed settling, holds detail, then smoothly returns to context',()=>{
  const timing=cameraTiming(cameraState);
  assert.deepEqual([timing.start,timing.move,timing.releaseStart,timing.release],[3,2,8,2]);
  const keys=cameraKeys(cameraState,301,demoLayout(1920,1080));
  for(const second of [0,1,2,3])assert.equal(cameraForFrame(keys,second*30).zoom,1);
  const detail=cameraForFrame(keys,150);
  assert.ok(detail.zoom>1.7);
  assert.deepEqual(detail,cameraForFrame(keys,240));
  const returning=cameraForFrame(keys,270);
  assert.ok(returning.zoom>1&&returning.zoom<detail.zoom);
  assert.deepEqual(cameraForFrame(keys,300),{x:.5,y:.5,zoom:1});
  const held={...cameraState,camera:{...cameraState.camera!,releaseDuration:0},progress:1};
  assert.ok(cameraAt(held).zoom>1.7,'A zero release holds the detail through the boundary.');
  const bounded=cameraTiming({...cameraState,duration:4,camera:{contextHold:3,moveDuration:9,releaseDuration:9}});
  assert.equal(bounded.start+bounded.move+bounded.release,4);
  assert.ok(cameraTiming({...cameraState,focusRevealAt:9.7}).targetZoom===1,'Do not force a rushed closeup after a late result.');
});

test('outgoing transitions use whole centered frames and preserve the narration clock',()=>{
  const scenes=[{frames:90},{frames:60,transition:{type:'cut' as const,duration:0}},{frames:45,transition:{type:'slide' as const,duration:.77}},{frames:60}];
  const schedule=transitionSchedule(scenes,30);
  assert.deepEqual(schedule[0],{type:'dissolve',duration:.6,half:.3});
  assert.deepEqual(schedule[1],{type:'cut',duration:0,half:0});
  assert.equal(Math.round(schedule[2].duration*30)%2,0);
  assert.ok(schedule[2].duration<=45/30/2);
  const filter=transitionFilter(scenes,30).filters.join(';');
  assert.match(filter,/offset=2\.70000000/);
  assert.match(filter,/concat=n=2:v=1:a=0/);
  assert.match(filter,/transition=smoothleft/);
  assert.throws(()=>transitionSchedule([{frames:30,transition:{type:'fade',duration:2}},{frames:30}],30),/Invalid reviewed/);
});

test('actual mixed cut, dissolve, fade and slide renders retain every original film frame',{skip:!ffmpeg},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-transition-'));
  try{
    const types:EditTransition['type'][]=['cut','dissolve','fade','slide'];
    const counts=[33,39,51,33,36],colors=['red','lime','blue','yellow','magenta'];
    const segments=[];
    for(let index=0;index<counts.length;index++){
      const file=path.join(directory,`${index}.mkv`);segments.push(file);
      await run(['-f','lavfi','-i',`color=${colors[index]}:s=96x54:r=30`,'-frames:v',String(counts[index]),'-c:v','ffv1',file]);
    }
    const scenes=counts.map((frames,index)=>({frames,transition:{type:types[index]||'cut',duration:types[index]==='cut'?0:.6}}));
    const {filters,label}=transitionFilter(scenes,30),output=path.join(directory,'mixed.mkv');
    await run(['-filter_complex_threads','2',...segments.flatMap(file=>['-i',file]),'-filter_complex',filters.join(';'),'-map',`[${label}]`,'-c:v','ffv1','-r','30',output]);
    const decoded=await execute(ffmpeg!,['-v','error','-i',output,'-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:8*1024*1024});
    const bytes=96*54*3,total=counts.reduce((sum,n)=>sum+n,0);
    assert.equal(decoded.stdout.length,bytes*total,'Transition padding and overlap must not add or remove film frames.');
    const rgb=(frame:number)=>[...decoded.stdout.subarray(frame*bytes+3*(27*96+48),frame*bytes+3*(27*96+48)+3)];
    assert.ok(rgb(32)[0]>240&&rgb(32)[1]<10,'Explicit cut keeps its last red frame.');
    assert.ok(rgb(33)[1]>240&&rgb(33)[0]<10,'Explicit cut starts green exactly on the scene boundary.');
    const dissolved=rgb(72);assert.ok(dissolved[1]>60&&dissolved[2]>60,'The dissolve blends the real adjacent frames.');
    assert.ok(Array.from({length:16},(_,index)=>rgb(115+index)).some(color=>color.every(channel=>channel<10)),'The fade passes through black inside its centered transition window.');
    assert.ok(rgb(156).some(channel=>channel>150),'The slide retains visible scene material.');
  }finally{await rm(directory,{recursive:true,force:true});}
});

function wave(seconds:number):Buffer{
  const bytes=Buffer.alloc(44+Math.round(seconds*48000)*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVE',8);bytes.write('fmt ',12);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  for(let offset=44;offset<bytes.length;offset+=2)bytes.writeInt16LE(Math.round(Math.sin(offset/18)*5000),offset);
  return bytes;
}
async function cache(directory:string,kind:'demo'|'promo',scenes:Scene[]){
  const seconds=scenes.reduce((sum,item)=>sum+item.duration,0),cues=subtitleCues(scenes).map(cue=>({...cue,wordStarts:cue.words.map((_,index)=>cue.start+index/cue.words.length*(cue.end-cue.start))}));
  await writeFile(path.join(directory,`${kind}-narration.wav`),wave(seconds));
  await writeFile(path.join(directory,`${kind}-narration-timing.json`),JSON.stringify({fingerprint:narrationFingerprint(scenes,{}),voice:'melo_india',provider:'MeloTTS ONNX',cues}));
  return cues;
}
function project():Project{
  return{id:'edit-fixture',brief:{name:'Workflow',url:'https://example.test',description:'Observed work',purpose:'Explain',actors:'Owners',features:['Observed'],brandColor:'#00a0d0',duration:90,promoDuration:45,resolution:'720p',maxSteps:3,allowedOrigins:[],allowWrites:false,sample:true},createdAt:'',updatedAt:'',stage:'review',progress:0,message:'',logs:[],sources:[],findings:[],shots:[],scenes:[scene('legacy',2)],outputs:[],recording:'capture.mp4',renderSettings:{motion:'cinematic',subtitles:true,cursorHighlights:false,narration:true,narrationEngine:'natural',narrationVoice:'melo_india',promoAspect:'portrait'},filmPlans:{demo:{targetDuration:2.4,scenes:[{...scene('demo',1.2),narration:'Review the leads.'},{...scene('result',1.2),narration:'Keep results clear.',transition:{type:'cut',duration:0}}]},promo:{targetDuration:1.2,scenes:[{...scene('promo',1.2),narration:'Meet your workspace.'}]}}};
}

test('independent cache namespaces support a 110-second film without using legacy narration',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-edit-cache-'));
  try{
    const scenes=Array.from({length:10},(_,index)=>scene(String(index),11));
    await cache(directory,'demo',scenes);await writeFile(path.join(directory,'narration.wav'),'legacy remains unchanged');
    const temporary=path.join(directory,'render');await mkdir(temporary);
    const prepared=await readPreparedNarration(scenes,{},directory,temporary,'demo');assert.ok(prepared);
    assert.equal((await readFile(prepared.file)).length,wave(110).length);
    assert.equal(await readFile(path.join(directory,'narration.wav'),'utf8'),'legacy remains unchanged');
    const other=path.join(directory,'other');await mkdir(other);
    assert.equal(await readPreparedNarration(scenes,{},directory,other,'promo'),undefined,'A promo cannot reuse the demo take.');
    assert.throws(()=>narrationFingerprint(Array.from({length:7},(_,index)=>scene(String(index),30))),/supported timeline/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('independent film exports use distinct clocks, voice caches and sidecars while partial rerenders preserve the other film',{skip:!available,timeout:120000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-edit-films-'));
  try{
    const fixture=project(),demo=fixture.filmPlans!.demo!.scenes,promo=fixture.filmPlans!.promo!.scenes;
    await run(['-f','lavfi','-i','testsrc2=s=320x180:r=30','-t','1.2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',path.join(directory,'capture.mp4')]);
    const demoCues=await cache(directory,'demo',demo),promoCues=await cache(directory,'promo',promo);
    await writeFile(path.join(directory,'captions.srt'),'legacy captions');
    const outputs=await renderVideos(fixture,directory,['demo','promo']);
    assert.deepEqual(outputs.map(output=>[output.kind,output.duration,output.width,output.height,output.narrated]),[['demo',2.4,1280,720,true],['promo',1.2,720,1280,true]]);
    for(const output of outputs){
      const frames=await run(['-i',path.join(directory,output.file),'-an','-f','framemd5','-']);
      assert.equal(frames.stdout.split('\n').filter(line=>/^0,/.test(line)).length,output.duration*30);
      const expected=output.kind==='demo'?demoCues:promoCues;
      assert.equal(await readFile(path.join(directory,`${output.kind}-captions.srt`),'utf8'),subtitleSrt(expected));
      assert.equal(await readFile(path.join(directory,`${output.kind}-narration.srt`),'utf8'),subtitleSrt(expected));
    }
    assert.equal(await readFile(path.join(directory,'captions.srt'),'utf8'),'legacy captions');
    assert.match(await readFile(path.join(directory,'demo-narration.txt'),'utf8'),/Review the leads/);
    assert.doesNotMatch(await readFile(path.join(directory,'promo-narration.txt'),'utf8'),/Review the leads/);
    const preservedNames=['demo.mp4','demo-poster.jpg','demo-narration.wav','demo-narration-timing.json','demo-narration.txt','demo-captions.srt','demo-captions.vtt','demo-narration.srt'];
    const preserved=await Promise.all(preservedNames.map(file=>readFile(path.join(directory,file))));
    fixture.outputs=outputs;fixture.filmPlans!.promo!.scenes[0].title='An edited visual';
    await renderVideos(fixture,directory,['promo']);
    for(let index=0;index<preservedNames.length;index++)assert.deepEqual(await readFile(path.join(directory,preservedNames[index])),preserved[index],`Partial promo render changed ${preservedNames[index]}`);
    // A later missing demo source must not publish the earlier completed promo stage.
    const savedPromo=await readFile(path.join(directory,'promo.mp4')),savedCaptions=await readFile(path.join(directory,'promo-captions.srt'));
    fixture.recording='missing.mp4';
    await assert.rejects(renderVideos(fixture,directory,['promo','demo']),/ENOENT/);
    assert.deepEqual(await readFile(path.join(directory,'promo.mp4')),savedPromo);
    assert.deepEqual(await readFile(path.join(directory,'promo-captions.srt')),savedCaptions);
    assert.ok(!(await readdir(directory)).some(file=>file.startsWith('.render-')));
  }finally{await rm(directory,{recursive:true,force:true});}
});
