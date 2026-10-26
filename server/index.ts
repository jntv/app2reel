import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Store, briefSchema, sceneSchema } from './store.js';
import { LocalAI } from './ai.js';
import { Pipeline } from './pipeline.js';
import { browserAvailable, clearSessions, completeLogin, discardSession, openLogin } from './browser.js';
import { ffmpegAvailable } from './render.js';
import { fixtureHTML } from './fixture.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT||4310);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT must be an integer between 1024 and 65535.');
const store=new Store(path.resolve(process.env.DATA_DIR||path.join(root,'.capture')));await store.init();
const ai=new LocalAI();const pipeline=new Pipeline(store,ai);const app=express();
app.disable('x-powered-by');
// This is a single-user loopback application. Reject hostile cross-site requests and DNS rebinding.
app.use((req,res,next)=>{
  const host=req.headers.host;const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
  if(!host||!allowedHosts.has(host))return res.status(403).json({error:'This studio is only accessible on its local address.'});
  const origin=req.headers.origin;
  if(origin&&!new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]).has(origin))return res.status(403).json({error:'Cross-origin requests are not permitted.'});
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&!req.is('application/json'))return res.status(415).json({error:'Send application/json.'});
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"frame-ancestors 'none'");
  next();
});
app.use(express.json({limit:'100kb'}));
const asyncRoute=(fn:(req:express.Request,res:express.Response)=>Promise<unknown>)=>(req:express.Request,res:express.Response,next:express.NextFunction)=>{void fn(req,res).catch(next);};

app.get('/api/health',asyncRoute(async(_req,res)=>res.json({ai:await ai.status(),browser:await browserAvailable(),ffmpeg:await ffmpegAvailable(),version:'0.1.0'})));
app.post('/api/auth/login',asyncRoute(async(_req,res)=>{pipeline.assertIdle();res.json(await ai.login());}));
app.get('/api/projects',(_req,res)=>res.json([...store.projects.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))));
app.post('/api/projects',asyncRoute(async(req,res)=>{
  const brief=briefSchema.parse(req.body);if(brief.sample)throw new Error('Create samples using the sample project button.');
  res.status(201).json(await store.create(brief));
}));
app.post('/api/sample',asyncRoute(async(_req,res)=>res.status(201).json(await store.create(briefSchema.parse({
  name:'Orbit',url:`http://127.0.0.1:${port}/sample-product`,description:'A calm, collaborative workspace that brings projects, team members, and performance insights into one place.',
  purpose:'Help teams move from scattered work to shared momentum.',actors:'Product leads, project managers, designers, and team members',
  features:['Workspace overview','Project tracking','Team analytics','Team directory'],brandColor:'#95b978',duration:30,resolution:'1080p',maxSteps:8,sample:true
})))));
app.get('/api/projects/:id',asyncRoute(async(req,res)=>res.json(store.get(String(req.params.id)))));
app.put('/api/projects/:id',asyncRoute(async(req,res)=>{
  pipeline.assertIdle();const p=store.get(String(req.params.id));
  const patch=z.object({brief:briefSchema.partial().optional(),scenes:z.array(sceneSchema).min(1).max(12).optional()}).strict().parse(req.body);
  if(patch.brief){
    if(patch.brief.sample!==undefined&&patch.brief.sample!==p.brief.sample)throw new Error('Sample mode cannot be changed.');
    if(p.brief.sample&&patch.brief.url&&patch.brief.url!==p.brief.url)throw new Error('Create a new project to explore another URL.');
    const previous=JSON.stringify(p.brief);p.brief=briefSchema.parse({...p.brief,...patch.brief});
    if(previous!==JSON.stringify(p.brief)){await discardSession(p.id);p.stage='draft';p.error=undefined;p.scenes=[];p.shots=[];p.findings=[];p.sources=[];p.outputs=[];p.recording=undefined;p.message='Brief updated. Explore again to record the updated product.';}
  }
  if(patch.scenes){
    if(patch.scenes.reduce((a,s)=>a+s.duration,0)>90)throw new Error('Total film duration must be 90 seconds or less.');
    const permitted=new Set(p.shots.map(s=>s.screenshot));
    for(const s of patch.scenes){if(s.screenshot&&!permitted.has(s.screenshot))throw new Error('Storyboard can only use captured screenshots.');if(s.recordingStart!==undefined&&s.recordingEnd!==undefined&&s.recordingEnd<=s.recordingStart)throw new Error('Clip end must be after its start.');}
    p.scenes=patch.scenes;p.outputs=[];p.stage='review';await pipeline.exportPlan(p);
  }
  await store.save(p);res.json(p);
}));
app.post('/api/projects/:id/explore',asyncRoute(async(req,res)=>{
  const body=z.object({credentials:z.object({username:z.string().min(1).max(500),password:z.string().min(1).max(1000),loginUrl:z.string().url().optional(),attemptCaptcha:z.boolean().optional()}).strict().optional()}).strict().parse(req.body);
  const p=store.get(String(req.params.id));await pipeline.explore(p,body.credentials);res.status(202).json(p);
}));
app.post('/api/projects/:id/login',asyncRoute(async(req,res)=>{
  pipeline.assertIdle();const body=z.object({loginUrl:z.string().url().optional(),credentials:z.object({username:z.string().min(1).max(500),password:z.string().min(1).max(1000)}).strict().optional()}).strict().parse(req.body);
  await openLogin(store.get(String(req.params.id)),body.loginUrl,body.credentials);res.json({message:body.credentials?'Credentials filled in the unrecorded browser. Complete the CAPTCHA and sign in, then choose I’ve finished signing in.':'Sign in in the browser window, then choose I’ve finished signing in. This window is not recorded.'});
}));
app.post('/api/projects/:id/login/complete',asyncRoute(async(req,res)=>{
  await completeLogin(store.get(String(req.params.id)).id);res.json({message:'Session saved in memory for the next exploration. It expires in one hour.'});
}));
app.post('/api/projects/:id/render',asyncRoute(async(req,res)=>{
  const {kinds}=z.object({kinds:z.array(z.enum(['demo','promo'])).min(1).max(2)}).strict().parse(req.body);
  const p=store.get(String(req.params.id));await pipeline.render(p,[...new Set(kinds)]);res.status(202).json(p);
}));
app.post('/api/projects/:id/cancel',asyncRoute(async(req,res)=>{const p=store.get(String(req.params.id));pipeline.cancel(p.id);res.json({message:'Cancellation requested.'});}));
app.get('/api/projects/:id/events',(req,res,next)=>{
  try{
    const id=String(req.params.id);const p=store.get(id);
    res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.flushHeaders();
    const send=(value:unknown)=>res.write(`data: ${JSON.stringify(value)}\n\n`);send(p);store.events.on(id,send);
    const timer=setInterval(()=>res.write(': keepalive\n\n'),15000);
    req.on('close',()=>{clearInterval(timer);store.events.off(id,send);});
  }catch(error){next(error);}
});
app.get('/artifacts/:id/:filename',(req,res,next)=>{
  try{
    const id=String(req.params.id),filename=String(req.params.filename);const p=store.get(id);
    if(!/^[a-zA-Z0-9._-]+\.(png|jpg|mp4|webm|json|txt|srt)$/.test(filename)||filename==='project.json')return res.status(404).end();
    const available=new Set([...p.shots.map(s=>s.screenshot),...p.outputs.map(o=>o.file),...(p.recording?[p.recording]:[]),...(p.scenes.length?['storyboard.json','research.json','narration.txt','narration.srt','captions.srt']:[])]);
    if(!available.has(filename))return res.status(404).end();
    res.setHeader('Cache-Control','no-store');res.sendFile(path.join(store.dir(id),filename),{dotfiles:'allow'},error=>{if(error&&!res.headersSent&&!res.destroyed)next(error);});
  }catch(error){next(error);}
});
app.get('/sample-product',(_req,res)=>res.type('html').send(fixtureHTML()));
app.use('/api',(_req,res)=>res.status(404).json({error:'Unknown API endpoint'}));
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(res.headersSent||res.destroyed){res.destroy();return;}
  if(error instanceof z.ZodError)return res.status(400).json({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')});
  const e=error as Error&{status?:number};return res.status(e.status||400).json({error:e.message||'Request failed'});
});

let vite:Awaited<ReturnType<typeof createViteServer>>|undefined;
if(existsSync(path.join(root,'dist/index.html'))&&(process.env.NODE_ENV==='production'||process.argv.includes('--production'))){
  app.use(express.static(path.join(root,'dist')));app.get('/{*path}',(_req,res)=>res.sendFile(path.join(root,'dist/index.html')));
}else{
  vite=await createViteServer({root,server:{middlewareMode:true,hmr:false},appType:'spa'});
  app.use(vite.middlewares);
}
const server=app.listen(port,'127.0.0.1',()=>console.log(`Capture Studio is ready at http://127.0.0.1:${port}`));
async function shutdown(){await clearSessions();await vite?.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
