import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { exploreBrowser } from '../server/browser.js';
import { fixtureHTML } from '../server/fixture.js';
import type { LocalAI } from '../server/ai.js';
import type { Project, Shot } from '../shared/types.js';

test('recorded exploration captures actual pointer clicks and normalized movement without model calls', {skip:!existsSync(chromium.executablePath())}, async () => {
  const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(fixtureHTML());});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const directory=await mkdtemp(path.join(tmpdir(),'capture-pointer-'));
  try {
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const project:Project={id:'fixture',brief:{name:'Orbit',url,description:'A local sample',purpose:'Verify real cursor capture',actors:'Teams',features:['Overview','Projects','Analytics','Team'],brandColor:'#95b978',duration:15,resolution:'720p',maxSteps:4,allowedOrigins:[],allowWrites:false,sample:true},createdAt:'',updatedAt:'',stage:'draft',progress:0,message:'',logs:[],sources:[],findings:[],shots:[],scenes:[],outputs:[]};
    const shots:Shot[]=[];
    const ai={json:()=>{throw new Error('Sample must never call AI.');}} as unknown as LocalAI;
    const result=await exploreBrowser(project,directory,ai,new AbortController().signal,async shot=>{shots.push(shot);},async()=>{});
    assert.equal(shots.length,4);
    assert.equal(result.recording,'capture.webm');
    assert.ok((await stat(path.join(directory,result.recording!))).size>1000);
    assert.ok(result.cursorTrack.filter(point=>point.kind==='click').length>=3,'Trusted pointerdown events must be captured.');
    for(const point of result.cursorTrack){assert.ok(point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1);assert.ok(point.at>=0&&point.at<=result.duration);assert.deepEqual(Object.keys(point).sort(),['at','kind','x','y']);}
    assert.ok(shots.every((shot,i)=>shot.at<result.duration&&(!i||shot.at>shots[i-1].at)));
  } finally { await rm(directory,{recursive:true,force:true});await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
