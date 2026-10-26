import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { NarrationStatus } from '../shared/types.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const qwenRecipe=JSON.parse(readFileSync(path.join(root,'assets/voices/qwen-recipes.json'),'utf8')) as {version:number;model:{repository:string;revision:string;directory:string;assets:{name:string}[]};generation:Record<string,unknown>;voices:Record<string,{reference:string;sha256:string;transcript:string}>};
const isQwen=(voice:string):boolean=>voice==='qwen_indian_male'||voice==='qwen_indian_female';
const qwenSupported=():boolean=>process.platform==='darwin'&&process.arch==='arm64'&&Number(release().split('.')[0])>=23;
const qwenPlatformError='Designed voices require an Apple Silicon Mac with macOS 14 or newer. Choose another local voice on this computer.';
export const NATURAL_VOICES=[{id:'melo_india',label:'Indian English · female'},{id:'af_heart',label:'Heart · female US English'},{id:'am_michael',label:'Michael · male US English'},{id:'qwen_indian_male',label:'Designed Indian English · adult male'},{id:'qwen_indian_female',label:'Designed Indian English · adult woman'}];
/** Stable synthesis identity; legacy providers intentionally keep their old shape. */
export function naturalVoiceIdentity(voice:string):{provider:string;recipe?:string}{
  if(!isQwen(voice))return {provider:voice==='melo_india'?'MeloTTS ONNX':'Kokoro ONNX'};
  const reference=qwenRecipe.voices[voice];
  const recipe=createHash('sha256').update(JSON.stringify({version:qwenRecipe.version,model:qwenRecipe.model.repository,revision:qwenRecipe.model.revision,reference:reference.sha256,transcript:reference.transcript,generation:qwenRecipe.generation})).digest('hex');
  return {provider:'Qwen3-TTS MLX',recipe};
}
export function voiceDirectory():string{return path.resolve(process.env.CAPTURE_VOICE_DIR||path.join(process.env.DATA_DIR||path.join(root,'.capture'),'voice-runtime'));}
export function voicePython(directory=voiceDirectory(),voice='melo_india'):string{return path.join(directory,isQwen(voice)?'qwen-venv':'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');}
export function naturalVoiceReady(voice='melo_india'):boolean{
  if(!NATURAL_VOICES.some(item=>item.id===voice))return false;
  const directory=voiceDirectory();
  if(isQwen(voice)){
    if(!qwenSupported())return false;
    try{
      const marker=JSON.parse(readFileSync(path.join(directory,'.qwen-installed.json'),'utf8'));
      const reference=qwenRecipe.voices[voice],bytes=readFileSync(path.join(root,'assets/voices',reference.reference));
      return marker.modelRevision===qwenRecipe.model.revision&&createHash('sha256').update(bytes).digest('hex')===reference.sha256&&qwenRecipe.model.assets.every(asset=>existsSync(path.join(directory,'models',qwenRecipe.model.directory,asset.name)))&&existsSync(voicePython(directory,voice));
    }catch{return false;}
  }
  const files=voice==='melo_india'?['.melo-installed.json','models/melo-en/model.onnx','models/melo-en/tokens.txt','models/melo-en/lexicon.txt']:['.installed.json','models/kokoro-v1.0.onnx','models/voices-v1.0.bin'];
  return files.every(file=>existsSync(path.join(directory,file)))&&existsSync(voicePython(directory));
}
let installer:ChildProcess|undefined;
let installation:{state:'missing'|'installing'|'ready'|'failed';message:string;progress?:number}={state:'missing',message:'Natural voices need a one-time local download.'};
export function localVoiceStatus(systemReady:boolean):NarrationStatus{
  const voices=NATURAL_VOICES.map(voice=>({...voice,ready:naturalVoiceReady(voice.id)}));
  const naturalReady=voices.some(voice=>voice.ready);
  return {naturalReady,systemReady,voices,...(installer||installation.state==='failed'?installation:naturalReady?{state:'ready' as const,message:'Local voices are ready. Speech is generated on this laptop.'}:installation)};
}
export function startVoiceSetup(systemReady:boolean,voice='melo_india'):NarrationStatus{
  if(!NATURAL_VOICES.some(item=>item.id===voice))throw new Error('Choose a supported natural voice.');
  if(isQwen(voice)&&!qwenSupported())throw new Error(qwenPlatformError);
  if(installer||naturalVoiceReady(voice))return localVoiceStatus(systemReady);
  installation={state:'installing',message:'Preparing the selected natural voice.',progress:0};
  const child=spawn(process.execPath,[path.join(root,'scripts/setup-voice.mjs'),'--dir',voiceDirectory(),'--voice',voice],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env}});installer=child;
  let lines='',setupError='';
  child.stdout!.on('data',(chunk:Buffer)=>{
    lines=(lines+chunk.toString()).slice(-16000);const parts=lines.split('\n');lines=parts.pop()||'';
    for(const line of parts)try{const event=JSON.parse(line);if(typeof event.message==='string'){installation.message=event.message.slice(0,500);if(event.stage==='error')setupError=installation.message;}if(Number.isFinite(event.progress))installation.progress=Math.max(0,Math.min(100,event.progress));}catch{/* pip output is not an instruction or a status event. */}
  });
  // Dependency-manager output can contain host configuration; do not publish it.
  child.stderr!.resume();
  const finish=(ok:boolean)=>{if(installer!==child)return;installer=undefined;installation=ok&&naturalVoiceReady(voice)?{state:'ready',message:'Natural voices are ready.',progress:100}:{state:'failed',message:setupError||'Natural voice setup failed. Run pnpm setup:voice in the project terminal for details.'};};
  child.once('error',()=>finish(false));child.once('close',code=>finish(code===0));
  return localVoiceStatus(systemReady);
}
export function stopVoiceSetup():void{installer?.kill('SIGTERM');installer=undefined;}

const timingSchema=z.object({phoneme:z.string().max(200),start:z.number().finite().nonnegative(),end:z.number().finite().nonnegative()});
const resultSchema=z.object({results:z.array(z.object({file:z.string(),sampleRate:z.number().min(8000).max(96000),duration:z.number().positive().max(300),phonemes:z.array(timingSchema).max(30000),wordPhonemes:z.array(z.string().max(4000)).max(2000),spokenStart:z.number().finite().nonnegative().optional(),spokenEnd:z.number().finite().nonnegative().optional()})).max(20)});
export type NaturalVoiceResult=z.infer<typeof resultSchema>['results'][number];

/** Local stdin/stdout bridge. Text never becomes a shell argument or leaves the device. */
export async function synthesizeNaturalVoice(items:{text:string;file:string}[],voice:string,signal?:AbortSignal):Promise<NaturalVoiceResult[]>{
  if(signal?.aborted)throw new Error('Video rendering cancelled.');
  if(!NATURAL_VOICES.some(item=>item.id===voice))throw new Error('Choose a supported natural voice.');
  if(isQwen(voice)&&!qwenSupported())throw new Error(qwenPlatformError);
  if(!naturalVoiceReady(voice))throw new Error('Set up the selected natural voice in Film style, or run pnpm setup:voice. Choose System explicitly to use the device voice instead.');
  if(!items.length||items.length>20||items.some(item=>item.text.length>2000||!path.isAbsolute(item.file)))throw new Error('Invalid natural narration batch.');
  const child=spawn(voicePython(voiceDirectory(),voice),[path.join(root,'scripts/local-voice.py'),'--runtime-dir',voiceDirectory()],{cwd:root,stdio:['pipe','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
  let output='',overflow=false,killer:NodeJS.Timeout|undefined;
  const stop=()=>{child.kill('SIGTERM');killer=setTimeout(()=>child.kill('SIGKILL'),2000);killer.unref();};
  child.stdout.on('data',(chunk:Buffer)=>{if(output.length+chunk.length>20_000_000){overflow=true;stop();}else output+=chunk.toString();});child.stderr.resume();child.stdin.on('error',()=>{});
  const timeout=setTimeout(stop,isQwen(voice)?600000:180000);timeout.unref();signal?.addEventListener('abort',stop,{once:true});
  try{
    const done=new Promise<void>((resolve,reject)=>{child.once('error',()=>reject(new Error('Could not start the local natural voice runtime. Run pnpm setup:voice.')));child.once('close',code=>code===0?resolve():reject(new Error(signal?.aborted?'Video rendering cancelled.':'Natural narration failed. Check the local voice setup.')));});
    child.stdin.end(JSON.stringify({voice,items}));await done;
    if(signal?.aborted)throw new Error('Video rendering cancelled.');if(overflow)throw new Error('Natural voice response exceeded its size limit.');
    const result=resultSchema.parse(JSON.parse(output));
    if(result.results.length!==items.length||result.results.some((item,i)=>path.resolve(item.file)!==items[i].file))throw new Error('Natural narration returned unexpected files.');
    return result.results;
  }finally{clearTimeout(timeout);if(killer)clearTimeout(killer);signal?.removeEventListener('abort',stop);}
}
