import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Store, briefSchema, briefPatchSchema, sceneSchema, filmPlansSchema, renderSettingsSchema, productThemeSchema } from './store.js';
import { LocalAI } from './ai.js';
import { Pipeline } from './pipeline.js';
import { browserAvailable, clearSessions, completeLogin, discardSession, loginStatus, openLogin } from './browser.js';
import { ffmpegAvailable } from './render.js';
import { fixtureHTML } from './fixture.js';
import { narrationEngine } from './narration.js';
import { naturalVoiceReady } from './local-voice.js';
import { registerNarrationRoutes } from './narration-api.js';
import {syncReviewedSources} from './edit-plan.js';

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

app.get('/api/health',asyncRoute(async(_req,res)=>res.json({ai:await ai.status(),browser:await browserAvailable(),ffmpeg:await ffmpegAvailable(),narration:naturalVoiceReady()||!!narrationEngine(),version:'0.1.0'})));
const closeNarration=registerNarrationRoutes(app,store.root,()=>pipeline.assertIdle());
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
app.post('/api/projects/:id/design',asyncRoute(async(req,res)=>{
  z.object({}).strict().parse(req.body);res.json(await pipeline.refreshDesign(store.get(String(req.params.id))));
}));
app.post('/api/projects/:id/plan',asyncRoute(async(req,res)=>{
  const body=z.object({demoDuration:z.number().int().min(10).max(180).default(90),promoDuration:z.number().int().min(10).max(90).default(45),notes:z.string().trim().max(2000).default('')}).strict().parse(req.body);
  const p=store.get(String(req.params.id));await pipeline.plan(p,{demo:body.demoDuration,promo:body.promoDuration},body.notes);res.status(202).json(p);
}));
app.put('/api/projects/:id',asyncRoute(async(req,res)=>{
  pipeline.assertIdle();const p=store.get(String(req.params.id));
  const patch=z.object({brief:briefPatchSchema.optional(),scenes:z.array(sceneSchema).min(1).max(20).optional(),filmPlans:filmPlansSchema.optional(),renderSettings:renderSettingsSchema.optional(),productTheme:productThemeSchema.optional()}).strict().parse(req.body);
  if(patch.scenes&&patch.filmPlans)throw new Error('Save either the shared storyboard or the independent film plans in one request.');
  if(patch.productTheme&&new URL(patch.productTheme.sourceUrl).origin!==new URL(patch.brief?.url||p.brief.url).origin)throw new Error('The product theme must come from this product URL.');
  if(patch.brief){
    if(patch.brief.sample!==undefined&&patch.brief.sample!==p.brief.sample)throw new Error('Sample mode cannot be changed.');
    if(p.brief.sample&&patch.brief.url&&patch.brief.url!==p.brief.url)throw new Error('Create a new project to explore another URL.');
    const captureBrief=({duration:_,promoDuration:__,resolution:___,brandColor:____,...capture}:typeof p.brief)=>capture;
    const previous=JSON.stringify(captureBrief(p.brief)),previousRender=JSON.stringify([p.brief.resolution,p.brief.brandColor]);p.brief=briefSchema.parse({...p.brief,...patch.brief});
    if(previous!==JSON.stringify(captureBrief(p.brief))){await discardSession(p.id);p.stage='draft';p.error=undefined;p.scenes=[];p.filmPlans=undefined;p.editSources=undefined;p.shots=[];p.findings=[];p.sources=[];p.outputs=[];p.recording=undefined;p.cursorTrack=undefined;p.productTheme=undefined;p.message='Brief updated. Explore again to record the updated product.';}
    else if(previousRender!==JSON.stringify([p.brief.resolution,p.brief.brandColor])){p.outputs=[];p.error=undefined;if(p.scenes.length)p.stage='review';p.message='Output settings saved. Render again to apply the resolution and color.';}
  }
  const validateAssets=(scenes:typeof p.scenes)=>{
    if(scenes.reduce((a,s)=>a+Math.round(s.duration*30),0)>180*30)throw new Error('A film can be at most 180 seconds.');
    const permitted=new Set(p.shots.map(s=>s.screenshot));
    for(const s of scenes){if(s.screenshot&&!permitted.has(s.screenshot))throw new Error('Storyboard can only use captured screenshots.');if(s.recordingStart!==undefined&&s.recordingEnd!==undefined&&s.recordingEnd<=s.recordingStart)throw new Error('Clip end must be after its start.');}
  };
  if(patch.scenes){
    validateAssets(patch.scenes);
    if(p.editSources?.length)p.editSources=syncReviewedSources(p.editSources,p.scenes,patch.scenes);
    const promoStory=(scenes:typeof p.scenes)=>JSON.stringify(scenes.map(s=>[s.title,s.caption,s.narration,s.duration,s.feature||'',s.visualModel]));
    const samePromo=promoStory(p.scenes)===promoStory(patch.scenes);
    p.scenes=patch.scenes;
    if(p.filmPlans?.demo){p.filmPlans.demo={...p.filmPlans.demo,scenes:patch.scenes,targetDuration:patch.scenes.reduce((sum,s)=>sum+s.duration,0)};p.outputs=p.outputs.filter(output=>output.kind==='promo');}
    else p.outputs=samePromo?p.outputs.filter(output=>output.kind==='promo'):[];
    p.stage='review';
  }
  if(patch.filmPlans){
    for(const [kind,plan] of Object.entries(patch.filmPlans))if(plan){validateAssets(plan.scenes);if(JSON.stringify(p.filmPlans?.[kind as 'demo'|'promo'])!==JSON.stringify(plan))p.outputs=p.outputs.filter(output=>output.kind!==kind);}
    if(!p.editSources?.length)p.editSources=structuredClone(p.scenes);
    // Migrating a legacy shared clock requires fresh per-film sidecars for both outputs.
    if(!p.filmPlans){const targetDuration=p.scenes.reduce((sum,scene)=>sum+Math.round(scene.duration*30),0)/30;p.filmPlans={demo:{scenes:structuredClone(p.scenes),targetDuration},promo:{scenes:structuredClone(p.scenes),targetDuration}};p.outputs=[];}
    for(const [kind,plan] of Object.entries(patch.filmPlans))if(plan)p.editSources=syncReviewedSources(p.editSources,p.filmPlans?.[kind as 'demo'|'promo']?.scenes||[],plan.scenes);
    p.filmPlans={...p.filmPlans,...patch.filmPlans};if(p.filmPlans.demo)p.scenes=p.filmPlans.demo.scenes;p.stage='review';p.error=undefined;
  }
  if(patch.renderSettings){
    p.renderSettings=patch.renderSettings;p.outputs=[];p.error=undefined;
    if(p.scenes.length)p.stage='review';
    p.message='Film style saved. Render the films to apply your changes.';
  }
  if(patch.productTheme){
    p.productTheme=patch.productTheme;p.outputs=[];p.error=undefined;if(p.scenes.length)p.stage='review';p.message='Product design saved. Render the films to apply it.';
  }
  if(p.scenes.length&&(patch.scenes||patch.filmPlans||patch.renderSettings||patch.productTheme))await pipeline.exportPlan(p);
  await store.save(p);res.json(p);
}));
app.post('/api/projects/:id/explore',asyncRoute(async(req,res)=>{
  const body=z.object({credentials:z.object({username:z.string().min(1).max(500),password:z.string().min(1).max(1000),loginUrl:z.string().url().optional(),attemptCaptcha:z.boolean().optional()}).strict().optional()}).strict().parse(req.body);
  const p=store.get(String(req.params.id));await pipeline.explore(p,body.credentials);res.status(202).json(p);
}));
app.post('/api/projects/:id/login',asyncRoute(async(req,res)=>{
  pipeline.assertIdle();const body=z.object({loginUrl:z.string().url().optional(),credentials:z.object({username:z.string().min(1).max(500),password:z.string().min(1).max(1000)}).strict().optional()}).strict().parse(req.body);
  await openLogin(store.get(String(req.params.id)),body.loginUrl,body.credentials);res.json({message:body.credentials?'Credentials filled in the unrecorded browser. Complete the CAPTCHA and sign in; App2Reel will save the session automatically.':'Sign in in the unrecorded browser. App2Reel will save the session automatically.'});
}));
app.get('/api/projects/:id/login/status',asyncRoute(async(req,res)=>{const p=store.get(String(req.params.id));res.json(loginStatus(p.id));}));
app.post('/api/projects/:id/login/complete',asyncRoute(async(req,res)=>{
  await completeLogin(store.get(String(req.params.id)).id);res.json({message:'Signed-in session is ready for exploration. It stays in memory for up to eight hours.'});
}));
app.post('/api/projects/:id/render',asyncRoute(async(req,res)=>{
  const {kinds}=z.object({kinds:z.array(z.enum(['demo','promo'])).min(1).max(2)}).strict().parse(req.body);
  const p=store.get(String(req.params.id));await pipeline.render(p,[...new Set(kinds)]);res.status(202).json(p);
}));
app.post('/api/projects/:id/music',asyncRoute(async(req,res)=>{
  const body=z.object({enabled:z.boolean(),volume:z.number().min(0).max(.5)}).strict().parse(req.body);
  const p=store.get(String(req.params.id));await pipeline.music(p,body);res.status(202).json(p);
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
    if(!/^[a-zA-Z0-9._-]+\.(png|jpg|mp4|webm|wav|json|txt|srt|vtt)$/.test(filename)||filename==='project.json')return res.status(404).end();
    const perFilm=Object.keys(p.filmPlans||{}).flatMap(kind=>[
      `${kind}-narration.txt`,`${kind}-narration.srt`,`${kind}-captions.srt`,`${kind}-captions.vtt`,
      ...(p.outputs.some(output=>output.kind===kind&&output.narrated)?[`${kind}-narration.wav`,`${kind}-narration-timing.json`]:[])
    ]);
    const shared=!p.filmPlans?[...(p.scenes.length?['narration.txt','narration.srt','captions.srt','captions.vtt']:[]),...(p.outputs.some(output=>output.narrated)?['narration.wav','narration-timing.json']:[])]:[];
    const available=new Set([...p.shots.map(s=>s.screenshot),...p.outputs.flatMap(o=>o.poster?[o.file,o.poster]:[o.file]),...(p.recording?[p.recording]:[]),...(p.scenes.length?['storyboard.json','research.json']:[]),...shared,...perFilm]);
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

const server=createServer(app);
let vite:Awaited<ReturnType<typeof createViteServer>>|undefined;
if(existsSync(path.join(root,'dist/index.html'))&&(process.env.NODE_ENV==='production'||process.argv.includes('--production'))){
  app.use(express.static(path.join(root,'dist')));app.get('/{*path}',(_req,res)=>res.sendFile(path.join(root,'dist/index.html')));
}else{
  vite=await createViteServer({root,server:{middlewareMode:true,hmr:{server}},appType:'spa'});
  app.use(vite.middlewares);
}
server.listen(port,'127.0.0.1',()=>console.log(`App2Reel is ready at http://127.0.0.1:${port}`));
async function shutdown(){await closeNarration();await clearSessions();await vite?.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
