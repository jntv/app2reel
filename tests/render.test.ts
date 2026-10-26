import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import ffmpeg from 'ffmpeg-static';
import { outputDimensions, renderVideos } from '../server/render.js';
import type { Project } from '../shared/types.js';
import { narrationEngine } from '../server/narration.js';

const available = Boolean(ffmpeg && existsSync(chromium.executablePath()));
function fixture(): Project {
  return { id:'fixture', brief:{name:'Fixture',url:'https://example.com',description:'A graphic product story',purpose:'Explain the product',actors:'Owners',features:['Overview'],brandColor:'#a78bfa',duration:10,resolution:'720p',maxSteps:3,allowedOrigins:[],allowWrites:false,sample:true},
    createdAt:'',updatedAt:'',stage:'review',progress:0,message:'',logs:[],sources:[],findings:[],shots:[],outputs:[],renderSettings:{motion:'cinematic',subtitles:true,cursorHighlights:true,narration:false},
    scenes:[{id:'scene',title:'Ideas in motion',caption:'A connected workspace',narration:'Bring your work into focus.',duration:1.2,screenshot:'does-not-exist.png'}] };
}

test('graphics promo renders without screenshots and exports the same burned subtitle timeline', {skip:!available}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'capture-graphics-'));
  try {
    const project=fixture();project.renderSettings!.promoAspect='portrait';
    const [output] = await renderVideos(project,directory,['promo']);
    assert.deepEqual([output.width,output.height],[720,1280]);
    assert.match(output.revision||'',/^[a-f\d-]{36}$/,'Each successful export needs a fresh browser cache identity.');
    assert.equal(output.duration,1.2);
    assert.ok(output.poster);
    const srt = await readFile(path.join(directory,'captions.srt'),'utf8');
    assert.match(srt,/00:00:00,000 --> 00:00:01,200/);
    assert.equal(srt,await readFile(path.join(directory,'narration.srt'),'utf8'));
    assert.match(await readFile(path.join(directory,'captions.vtt'),'utf8'),/^WEBVTT/);
    const frames = spawnSync(ffmpeg!,['-v','error','-i',path.join(directory,output.file),'-an','-f','framemd5','-'],{encoding:'utf8'});
    assert.equal(frames.status,0,frames.stderr);
    const hashes=frames.stdout.split('\n').filter(line=>/^0,/.test(line)).map(line=>line.split(',').at(-1)!.trim());
    assert.equal(hashes.length,36);
    assert.ok(new Set(hashes).size>30,'The promo must contain real frame-to-frame motion.');
    const poster=spawnSync(ffmpeg!,['-v','error','-i',path.join(directory,output.poster!),'-f','null','-'],{encoding:'utf8'});
    assert.equal(poster.status,0,poster.stderr);
    assert.ok(!(await readdir(directory)).some(file=>file.startsWith('.render-')));
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('portrait composition is specific to the promo and old projects stay landscape',()=>{
  const project=fixture();
  assert.deepEqual(outputDimensions(project,'promo'),{width:1280,height:720});
  project.renderSettings!.promoAspect='portrait';project.brief.resolution='1080p';
  assert.deepEqual(outputDimensions(project,'promo'),{width:1080,height:1920});
  assert.deepEqual(outputDimensions(project,'demo'),{width:1920,height:1080});
});

test('cancelled dynamic rendering preserves previous completed media and removes temporary output', {skip:!available}, async () => {
  const directory=await mkdtemp(path.join(tmpdir(),'capture-render-abort-'));
  try {
    await writeFile(path.join(directory,'promo.mp4'),'previous completed output');
    const controller=new AbortController();
    await assert.rejects(renderVideos(fixture(),directory,['promo'],{signal:controller.signal,onProgress:progress=>{if(progress>10)controller.abort();}}),/cancelled/i);
    assert.equal(await readFile(path.join(directory,'promo.mp4'),'utf8'),'previous completed output');
    assert.ok(!(await readdir(directory)).some(file=>file.startsWith('.render-')));
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('narrated film contains a real spoken track and exports its audible timing',{skip:!available||!narrationEngine()},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-spoken-film-'));
  try{
    const project=fixture();project.scenes=[{...project.scenes[0],narration:'Meet your workspace.',duration:2}];project.renderSettings!.narration=true;project.renderSettings!.narrationEngine='system';
    const [output]=await renderVideos(project,directory,['promo']);assert.equal(output.narrated,true);assert.equal(output.duration,2);
    const timing=JSON.parse(await readFile(path.join(directory,'narration-timing.json'),'utf8'));
    assert.ok(timing.cues[0].start>0);assert.ok(timing.cues.at(-1).end<2);
    assert.ok((await readFile(path.join(directory,'narration.wav'))).length>10000);
    const audio=spawnSync(ffmpeg!,['-v','error','-i',path.join(directory,'promo.mp4'),'-vn','-ar','16000','-ac','1','-f','s16le','pipe:1']);
    assert.equal(audio.status,0,audio.stderr.toString());let energy=0;for(let i=0;i<audio.stdout.length;i+=2)energy+=(audio.stdout.readInt16LE(i)/32768)**2;
    assert.ok(Math.sqrt(energy/(audio.stdout.length/2))>.025,'The exported film must contain audible narration, not only the quiet music bed.');
    const voice=await readFile(path.join(directory,'narration.wav')),metadata=await readFile(path.join(directory,'narration-timing.json')),captions=await readFile(path.join(directory,'captions.srt'));
    // A second completed film shares this exact take; visual-only rerenders must
    // reuse it instead of creating a new stochastic voice/caption clock.
    project.outputs=[{...output,kind:'demo'}];project.scenes[0].focus={x:.4,y:.3,zoom:1.5};
    const messages:string[]=[];
    await renderVideos(project,directory,['promo'],{onProgress:(_p,message)=>messages.push(message)});
    assert.ok(messages.some(message=>message.includes('Reusing the reviewed narration')));
    assert.deepEqual(await readFile(path.join(directory,'narration.wav')),voice);
    assert.deepEqual(await readFile(path.join(directory,'narration-timing.json')),metadata);
    assert.deepEqual(await readFile(path.join(directory,'captions.srt')),captions);
    project.scenes[0].duration=2.1;
    await assert.rejects(renderVideos(project,directory,['promo']),/Render both films/);
    assert.deepEqual(await readFile(path.join(directory,'narration.wav')),voice);
    assert.deepEqual(await readFile(path.join(directory,'captions.srt')),captions);
  }finally{await rm(directory,{recursive:true,force:true});}
});
