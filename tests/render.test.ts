import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import ffmpeg from 'ffmpeg-static';
import { renderVideos } from '../server/render.js';
import type { Project } from '../shared/types.js';

const available = Boolean(ffmpeg && existsSync(chromium.executablePath()));
function fixture(): Project {
  return { id:'fixture', brief:{name:'Fixture',url:'https://example.com',description:'A graphic product story',purpose:'Explain the product',actors:'Owners',features:['Overview'],brandColor:'#a78bfa',duration:10,resolution:'720p',maxSteps:3,allowedOrigins:[],allowWrites:false,sample:true},
    createdAt:'',updatedAt:'',stage:'review',progress:0,message:'',logs:[],sources:[],findings:[],shots:[],outputs:[],
    scenes:[{id:'scene',title:'Ideas in motion',caption:'A connected workspace',narration:'Bring your work into focus.',duration:1.2,screenshot:'does-not-exist.png'}] };
}

test('graphics promo renders without screenshots and exports the same burned subtitle timeline', {skip:!available}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'capture-graphics-'));
  try {
    const [output] = await renderVideos(fixture(),directory,['promo']);
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
