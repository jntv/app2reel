import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { briefSchema, briefPatchSchema } from '../server/store.js';

const requiredBrief={name:'Fixture',url:'https://example.com',description:'A product installation fixture',purpose:'Explain the product',actors:'Product teams',features:['View projects']};

test('creation applies defaults while brief patches retain only explicitly supplied fields',()=>{
  const brief=briefSchema.parse(requiredBrief);
  assert.deepEqual({brandColor:brief.brandColor,duration:brief.duration,resolution:brief.resolution,maxSteps:brief.maxSteps,allowedOrigins:brief.allowedOrigins,allowWrites:brief.allowWrites,sample:brief.sample},
    {brandColor:'#e85b32',duration:90,resolution:'1080p',maxSteps:16,allowedOrigins:[],allowWrites:false,sample:false});
  assert.deepEqual(briefPatchSchema.parse({}),{});
  assert.deepEqual(briefPatchSchema.parse({description:'Updated product description'}),{description:'Updated product description'});
  const explicit={brandColor:'#123456',duration:120,resolution:'720p',maxSteps:40,allowedOrigins:['https://help.example.com'],allowWrites:true,sample:true};
  assert.deepEqual(briefPatchSchema.parse(explicit),explicit);
});

test('brief patches keep strict fields, collection bounds and value validation',()=>{
  for(const patch of [{unknown:true},{duration:181},{promoDuration:91},{maxSteps:61},{brandColor:'red'},{resolution:'4k'},{allowedOrigins:Array(11).fill('https://example.com')},{allowedOrigins:['file:///tmp']},{features:Array(21).fill('Feature')},{features:['']}]){
    assert.equal(briefPatchSchema.safeParse(patch).success,false,JSON.stringify(patch));
  }
});

test('oversized constrained collections reject before validating their elements',()=>{
  const result=briefSchema.safeParse({...requiredBrief,features:Array(20_000).fill(0)});
  assert.equal(result.success,false);
  if(result.success)return;
  assert.equal(result.error.issues.length,1);
  assert.equal(result.error.issues[0].code,'too_big');
  assert.deepEqual(result.error.issues[0].path,['features']);
});

test('HTTP brief patches preserve custom and sample values and reject invalid changes without saving',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'app2reel-brief-patch-'));
  const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const server=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
  let logs='';server.stdout.on('data',chunk=>{logs+=chunk;});server.stderr.on('data',chunk=>{logs+=chunk;});
  t.after(async()=>{
    server.kill('SIGTERM');
    await new Promise<void>(resolve=>{if(server.exitCode!==null)return resolve();const timer=setTimeout(()=>{server.kill('SIGKILL');resolve();},3500);server.once('exit',()=>{clearTimeout(timer);resolve();});});
    await rm(directory,{recursive:true,force:true});
  });
  const base=`http://127.0.0.1:${port}`;let ready=false;
  for(let attempt=0;attempt<400;attempt++){
    try{if((await fetch(base+'/api/projects')).ok){ready=true;break;}}catch{/* Wait for the local server under parallel test load. */}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.ok(ready,logs);
  const json=(method:string,body:unknown)=>({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const custom={...requiredBrief,brandColor:'#123456',duration:120,promoDuration:35,resolution:'720p',maxSteps:40,allowedOrigins:['https://help.example.com'],allowWrites:true};
  const created=await fetch(base+'/api/projects',json('POST',custom));assert.equal(created.status,201);
  const project=await created.json();
  const changed=await fetch(`${base}/api/projects/${project.id}`,json('PUT',{brief:{description:'A revised product description'}}));
  assert.equal(changed.status,200);
  const expected={...project.brief,description:'A revised product description'};
  assert.deepEqual((await changed.json()).brief,expected);
  for(const brief of [{unknown:true},{duration:181},{features:Array(21).fill('Feature')}]){
    const invalid=await fetch(`${base}/api/projects/${project.id}`,json('PUT',{brief}));assert.equal(invalid.status,400);
    assert.deepEqual((await(await fetch(`${base}/api/projects/${project.id}`)).json()).brief,expected);
  }
  const sampleResponse=await fetch(base+'/api/sample',json('POST',{}));assert.equal(sampleResponse.status,201);
  const sample=await sampleResponse.json();
  const sampleChange=await fetch(`${base}/api/projects/${sample.id}`,json('PUT',{brief:{duration:35}}));assert.equal(sampleChange.status,200);
  assert.deepEqual((await sampleChange.json()).brief,{...sample.brief,duration:35});
  const changeSampleMode=await fetch(`${base}/api/projects/${sample.id}`,json('PUT',{brief:{sample:false}}));assert.equal(changeSampleMode.status,400);
  assert.equal((await(await fetch(`${base}/api/projects/${sample.id}`)).json()).brief.sample,true);
  const oversized=await fetch(base+'/api/projects',json('POST',{...requiredBrief,features:Array(20_000).fill(0)}));assert.equal(oversized.status,400);
  assert.ok((await oversized.json()).error.length<200,'An oversized bounded array must not accumulate per-element response errors.');
});
