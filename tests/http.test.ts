import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { get as httpGet } from 'node:http';
import path from 'node:path';
import { Store, briefSchema } from '../server/store.js';

test('local HTTP serves referenced media in hidden storage and rejects stale media and cross-site mutations',async t=>{
  const temporary=await mkdtemp(path.join(tmpdir(),'capture-http-'));
  const data=path.join(temporary,'.capture');await mkdir(data);
  const store=new Store(data);await store.init();
  const p=await store.create(briefSchema.parse({name:'Fixture',url:'https://example.com',description:'An integration test product',purpose:'Verify media access',actors:'Test users',features:['View products']}));
  p.stage='complete';p.scenes=[{id:'scene-1',title:'A scene',caption:'A caption',narration:'Words',duration:3}];
  p.outputs=[{kind:'demo',file:'demo.mp4',width:1280,height:720,fps:30,duration:3}];await store.save(p);
  await writeFile(path.join(store.dir(p.id),'demo.mp4'),Buffer.from('0123456789'));
  await writeFile(path.join(store.dir(p.id),'stale.mp4'),Buffer.from('old export'));
  const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const server=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATA_DIR:data},stdio:['ignore','pipe','pipe']});
  let logs='';server.stdout.on('data',b=>{logs+=b;});server.stderr.on('data',b=>{logs+=b;});
  t.after(async()=>{server.kill('SIGTERM');await new Promise<void>(resolve=>{if(server.exitCode!==null)return resolve();const timer=setTimeout(()=>{server.kill('SIGKILL');resolve();},3500);server.once('exit',()=>{clearTimeout(timer);resolve();});});await rm(temporary,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;let ready=false;
  for(let i=0;i<100;i++) {try{if((await fetch(base+'/api/projects')).ok){ready=true;break;}}catch{/* wait for local server */}await new Promise(resolve=>setTimeout(resolve,50));}
  assert.ok(ready,logs);
  const media=await fetch(`${base}/artifacts/${p.id}/demo.mp4`,{headers:{range:'bytes=0-3'}});
  assert.equal(media.status,206);assert.equal(await media.text(),'0123');
  assert.equal(media.headers.get('x-frame-options'),'DENY');assert.equal(media.headers.get('content-type'),'video/mp4');
  assert.equal((await fetch(`${base}/artifacts/${p.id}/stale.mp4`)).status,404);
  assert.equal((await fetch(`${base}/artifacts/${p.id}/project.json`)).status,404);
  const cross=await fetch(base+'/api/sample',{method:'POST',headers:{'content-type':'application/json',origin:'https://hostile.example'},body:'{}'});assert.equal(cross.status,403);
  const mediaType=await fetch(base+'/api/sample',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'});assert.equal(mediaType.status,415);
  // Fetch normalizes Host on recent Node versions; use a raw HTTP request for the rebinding case.
  const wrongHost=await new Promise<number|undefined>((resolve,reject)=>{const req=httpGet(base+'/api/projects',{headers:{host:`hostile.example:${port}`}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(wrongHost,403);
  const changed=await fetch(`${base}/api/projects/${p.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({brief:{description:'Updated product description'}})});assert.equal(changed.status,200);
  assert.equal((await fetch(`${base}/artifacts/${p.id}/demo.mp4`)).status,404);
});
