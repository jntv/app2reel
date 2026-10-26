import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {chromium} from 'playwright';
import {demoEditPlan, prepareDemoEdit, remapDemoCursor} from '../server/demo-edit.js';
import {extractRenderedCursorFrames, type CursorPoint} from '../server/cursor-detection.js';
import {clipTiming, demoLayout, projectCursor} from '../server/demo-motion.js';
import {renderVideos} from '../server/render.js';
import type {Project, Scene} from '../shared/types.js';

const scene:Scene & {frames:number}={id:'one',title:'A real action',caption:'',narration:'',duration:1.2,frames:36,recordingStart:0,recordingEnd:2,recordingRanges:[{start:0,end:.6},{start:1.4,end:2}]};
const track:CursorPoint[]=[{at:0,x:.1,y:.2,kind:'move'},{at:.2,x:.2,y:.2,kind:'click'},{at:.8,x:.5,y:.5,kind:'click'},{at:1.4,x:.8,y:.2,kind:'move'},{at:1.6,x:.9,y:.2,kind:'click'}];

test('cuts allocate exact cumulative frame intervals while preserving film settings',()=>{
  const second={...scene,id:'two',recordingStart:1.4,recordingEnd:2,recordingRanges:undefined,focus:{x:.4,y:.3,zoom:1.5},focusRevealAt:.2};
  const plan=demoEditPlan([scene,second],30)!;
  assert.deepEqual(plan.cuts.map(cut=>[cut.start,cut.end,cut.at,cut.frames]),[[0,.6,0,18],[1.4,2,.6,18],[1.4,2,1.2,18]]);
  assert.deepEqual(plan.scenes.map(value=>[value.recordingStart,value.recordingEnd]),[[0,1.2],[1.2,1.8]]);
  assert.equal(plan.scenes[0].frames,36);assert.equal(plan.scenes[0].duration,1.2);
  assert.deepEqual(plan.scenes[1].focus,second.focus);assert.equal(plan.scenes[1].focusRevealAt,.2);
  assert.equal(plan.scenes[0].recordingRanges,undefined);
  assert.deepEqual(scene.recordingRanges,[{start:0,end:.6},{start:1.4,end:2}],'Never mutate the reviewed project.');
  assert.equal(demoEditPlan([{...scene,recordingRanges:undefined}],30),undefined);
});

test('invalid, overlapping, out-of-envelope or subframe cuts are rejected',()=>{
  for(const ranges of [[],[{start:-1,end:.5}],[{start:0,end:2.1}],[{start:.2,end:.1}],[{start:0,end:1},{start:.5,end:1.2}],[{start:0,end:.001}],Array.from({length:7},(_,index)=>({start:index/10,end:(index+1)/10}))])assert.throws(()=>demoEditPlan([{...scene,recordingRanges:ranges}],30),/cuts|cut/);
  assert.throws(()=>demoEditPlan([scene],0),/frame rate/);
});

test('cursor events are remapped across cuts without carrying clicks from removed waits',()=>{
  const plan=demoEditPlan([scene],30)!;
  const mapped=remapDemoCursor(track,plan.cuts,30);
  const clicks=mapped.filter(point=>point.kind==='click');
  assert.equal(clicks.length,2);
  assert.ok(Math.abs(clicks[0].at-.2)<1e-7);assert.ok(Math.abs(clicks[1].at-.8)<1e-7);
  assert.deepEqual(clicks.map(point=>point.x),[.2,.9]);
  assert.ok(mapped.some(point=>point.kind==='move'&&point.at===.6&&point.x===.8),'The new interval gets its own stationary boundary seed.');
  assert.ok(mapped.every((point,index)=>point.at>=0&&point.at<1.2&&(!index||point.at>=mapped[index-1].at)));
  assert.deepEqual(remapDemoCursor([],plan.cuts,30),[],'Pixel detection must not invent telemetry clicks.');
});

test('no cuts avoid encoding, and cancellation removes only edit-owned partial files',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-edit-abort-'));
  try{
    const plain=[{...scene,recordingRanges:undefined}];
    const untouched=await prepareDemoEdit('/original.webm',plain,track,directory,30,async()=>{throw new Error('Should not encode.');});
    assert.equal(untouched.recording,'/original.webm');assert.deepEqual(untouched.track,track);
    await writeFile(path.join(directory,'narration.wav'),'keep');
    const controller=new AbortController();let calls=0;
    await assert.rejects(prepareDemoEdit('/original.webm',[scene],track,directory,30,async(args,signal)=>{
      assert.equal(signal,controller.signal);calls++;
      await writeFile(args.at(-1)!,'partial');controller.abort();
    },controller.signal),/cancelled/);
    assert.equal(calls,1);
    assert.deepEqual(await readdir(directory),['narration.wav']);
    await assert.rejects(prepareDemoEdit('/original.webm',[scene],track,directory,30,async()=>{throw new Error('encoder failed');}),/encoder failed/);
    assert.deepEqual(await readdir(directory),['narration.wav']);
  }finally{await rm(directory,{recursive:true,force:true});}
});

const available=Boolean(ffmpeg&&existsSync(chromium.executablePath()));
const execute=promisify(execFile);
const runEncoder=async(args:string[],signal?:AbortSignal)=>{await execute(ffmpeg!,['-hide_banner','-v','error','-nostdin','-y',...args],{signal,maxBuffer:4*1024*1024});};

test('actual cut media removes the blue wait, retains exact cursor frames and renders masked 36-frame film',{skip:!available},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-edit-media-'));
  try{
    const width=960,height=540,bytes=width*height*3;
    const source=path.join(directory,'capture.mp4');
    const child=spawn(ffmpeg!,['-hide_banner','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',`${width}x${height}`,'-framerate','25','-i','pipe:0','-c:v','libx264','-preset','ultrafast','-crf','10','-pix_fmt','yuv420p',source],{stdio:['pipe','ignore','pipe']});
    let errors='';child.stderr.on('data',chunk=>errors+=chunk);
    const encoded=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(errors)));});
    for(let index=0;index<50;index++){
      const pixels=Buffer.alloc(bytes,240),color=index<15?[205,20,20]:index<35?[20,20,205]:[20,205,20];
      for(let y=240;y<400;y++)for(let x=350;x<600;x++)pixels.set(color,(y*width+x)*3);
      // A private yellow source block is covered before camera transforms.
      for(let y=30;y<130;y++)for(let x=50;x<240;x++)pixels.set([245,240,15],(y*width+x)*3);
      const cx=70+(index%10)*85,cy=200;
      for(let y=cy-6;y<=cy+6;y++)for(let x=cx-6;x<=cx+6;x++){const radius=Math.hypot(x-cx,y-cy);if(radius>=4&&radius<=6)pixels.set([251,107,56],(y*width+x)*3);}
      if(!child.stdin.write(pixels))await new Promise<void>(resolve=>child.stdin.once('drain',resolve));
    }
    child.stdin.end();await encoded;
    const originalHash=createHash('sha256').update(await readFile(source)).digest('hex');
    const edited=await prepareDemoEdit(source,[scene],track,directory,30,runEncoder);
    const decoded=await execute(ffmpeg!,['-v','error','-i',edited.recording,'-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:bytes*40});
    assert.equal(decoded.stdout.length,bytes*36,'The cut source has exactly 36 whole frames.');
    const sampled=await extractRenderedCursorFrames(edited.recording,[{...clipTiming(0,1.2,1.2),frames:36}],30);
    for(let frame=0;frame<36;frame++){
      const pixels=decoded.stdout.subarray(frame*bytes,(frame+1)*bytes),center=(270*width+480)*3;
      const [r,g,b]=pixels.subarray(center,center+3);
      assert.ok(frame<18?r>g*3&&r>b*3:g>r*3&&g>b*3,`Removed blue wait leaked into frame ${frame}: ${r},${g},${b}.`);
      let sx=0,sy=0,count=0;
      for(let at=0;at<width*height;at++){const r=pixels[at*3],g=pixels[at*3+1],b=pixels[at*3+2];if(r>180&&g>55&&g<160&&b<115&&r-g>70){sx+=at%width;sy+=Math.floor(at/width);count++;}}
      const point=sampled[0][frame];assert.ok(point&&count>12);
      assert.ok(Math.hypot(point.x*width-sx/count,point.y*height-sy/count)<2.5,`Cursor detached at edited frame ${frame}: tracked ${point.x*width},${point.y*height}; actual ${sx/count},${sy/count} (${count}px).`);
    }
    const project:Project={id:'edit-fixture',brief:{name:'Local fixture',url:'https://example.com',description:'A local fixture',purpose:'Show reviewed cuts',actors:'Owner',features:['Overview'],brandColor:'#0a8fdc',duration:10,resolution:'720p',maxSteps:3,allowedOrigins:[],allowWrites:false,sample:true},createdAt:'',updatedAt:'',stage:'review',progress:0,message:'',logs:[],sources:[],findings:[],shots:[],outputs:[],recording:'capture.mp4',cursorTrack:track,renderSettings:{motion:'subtle',subtitles:false,cursorHighlights:true,narration:false},scenes:[{...scene,focus:{x:.5,y:.5,zoom:1},redactions:[{x:.05,y:.05,width:.2,height:.2}]}]};
    const [output]=await renderVideos(project,directory,['demo']);
    const full=await execute(ffmpeg!,['-v','error','-i',path.join(directory,output.file),'-an','-f','framemd5','-']);
    assert.equal(full.stdout.split('\n').filter(line=>/^0,/.test(line)).length,36);
    for(const [frame,red] of [[5,true],[25,false]] as const){
      const image=await execute(ffmpeg!,['-v','error','-i',path.join(directory,output.file),'-vf',`select=eq(n\\,${frame})`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:1280*720*3+1024});
      const center=(360*1280+640)*3,[r,g,b]=image.stdout.subarray(center,center+3);
      assert.ok(red?r>g*3&&r>b*3:g>r*3&&g>b*3,'Full renderer must use the edited recording.');
      const masked=projectCursor({x:100/960,y:80/540},{x:.5,y:.5,zoom:1},demoLayout(1280,720));
      const at=(Math.round(masked.y)*1280+Math.round(masked.x))*3;
      const [mr,mg,mb]=image.stdout.subarray(at,at+3);
      assert.ok(!(mr>200&&mg>200&&mb<80),'A privacy mask must cover the yellow source block through the cut.');
    }
    assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),originalHash);
    assert.ok(!(await readdir(directory)).some(file=>file.startsWith('.render-')));
  }finally{await rm(directory,{recursive:true,force:true});}
});
