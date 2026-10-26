import type express from 'express';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { z } from 'zod';
import { localVoiceStatus, startVoiceSetup, stopVoiceSetup } from './local-voice.js';
import { narrationEngine, prepareNarration } from './narration.js';

export const voicePreviewSchema=z.object({engine:z.enum(['natural','system']),voice:z.enum(['melo_india','af_heart','am_michael']).optional(),text:z.string().trim().min(1).max(200).optional()}).strict();
const previewText='Start with a clearer view. Bring your team, your work, and your next steps together.';

/** Preview files are ephemeral and accessible only by server-issued identifiers. */
export function registerNarrationRoutes(app:express.Express,dataDirectory:string,assertIdle:()=>void):()=>Promise<void>{
  const directory=path.join(dataDirectory,'.voice-previews');
  const previews=new Map<string,string>();
  let active:AbortController|undefined;
  const wrap=(fn:(req:express.Request,res:express.Response)=>Promise<unknown>)=>(req:express.Request,res:express.Response,next:express.NextFunction)=>{void fn(req,res).catch(next);};
  app.get('/api/narration/status',(_req,res)=>res.json(localVoiceStatus(!!narrationEngine())));
  app.post('/api/narration/setup',wrap(async(req,res)=>{
    const body=z.object({voice:z.enum(['melo_india','af_heart','am_michael']).optional()}).strict().parse(req.body);assertIdle();
    res.status(202).json(startVoiceSetup(!!narrationEngine(),body.voice));
  }));
  app.post('/api/narration/preview',wrap(async(req,res)=>{
    const body=voicePreviewSchema.parse(req.body);assertIdle();
    if(active)throw Object.assign(new Error('A voice preview is already being prepared.'),{status:409});
    const controller=new AbortController();active=controller;
    let temporary:string|undefined;
    const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnected);
    const run=async(args:string[])=>{
      const executable=process.env.FFMPEG_PATH||ffmpeg||'ffmpeg';
      if(controller.signal.aborted)throw new Error('Voice preview cancelled.');
      const child=spawn(executable,['-hide_banner','-nostdin','-y',...args],{stdio:'ignore'});
      const stop=()=>child.kill('SIGKILL');controller.signal.addEventListener('abort',stop,{once:true});
      const timer=setTimeout(stop,60000);timer.unref();
      try{await new Promise<void>((resolve,reject)=>{child.once('error',()=>reject(new Error('Could not start the audio encoder.')));child.once('close',code=>code===0?resolve():reject(new Error('Voice preview audio preparation failed.')));});}
      finally{clearTimeout(timer);controller.signal.removeEventListener('abort',stop);}
    };
    try{
      await mkdir(directory,{recursive:true,mode:0o700});temporary=await mkdtemp(path.join(directory,'work-'));
      const track=await prepareNarration([{id:'preview',title:'Voice preview',caption:'',narration:body.text||previewText,duration:30}],temporary,run,controller.signal,body);
      const file=randomUUID()+'.wav',target=path.join(directory,file),audio=path.join(temporary,'preview.wav');
      const duration=Math.min(30,(track.cues.at(-1)?.end||1)+.35);
      await run(['-i',track.file,'-t',duration.toFixed(4),'-ar','48000','-ac','1','-c:a','pcm_s16le',audio]);
      if(controller.signal.aborted)throw new Error('Voice preview cancelled.');
      await rename(audio,target);previews.set(file,target);
      while(previews.size>4){const oldest=previews.keys().next().value!;const old=previews.get(oldest)!;previews.delete(oldest);await rm(old,{force:true});}
      res.json({url:`/api/narration/previews/${file}`,voice:track.voice,label:body.engine==='system'?'System voice':track.voice==='melo_india'?'Indian English':track.voice==='am_michael'?'Michael':'Heart'});
    }finally{res.removeListener('close',disconnected);if(temporary)await rm(temporary,{recursive:true,force:true});if(active===controller)active=undefined;}
  }));
  app.get('/api/narration/previews/:file',(req,res,next)=>{
    const file=previews.get(String(req.params.file));if(!file)return res.status(404).end();
    res.setHeader('Cache-Control','no-store');res.sendFile(file,{dotfiles:'allow'},error=>{if(error&&!res.headersSent&&!res.destroyed)next(error);});
  });
  return async()=>{active?.abort();stopVoiceSetup();await rm(directory,{recursive:true,force:true});};
}
