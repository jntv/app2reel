import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Scene } from '../shared/types.js';
import { subtitleCues, type SubtitleCue } from './subtitles.js';

export interface NarrationEngine { command: string; voice: string; provider: 'macOS'|'eSpeak'; }
export interface NarrationTrack { file: string; cues: SubtitleCue[]; voice: string; }
type RunEncoder=(args:string[],signal?:AbortSignal)=>Promise<void>;

export function narrationEngine(): NarrationEngine | undefined {
  if(process.platform==='darwin'&&existsSync('/usr/bin/say'))return {command:'/usr/bin/say',voice:'Samantha',provider:'macOS'};
  for(const command of ['espeak-ng','espeak']){
    const found=spawnSync(command,['--version'],{stdio:'ignore',timeout:3000});
    if(!found.error&&found.status===0)return {command,voice:'en-us',provider:'eSpeak'};
  }
  return undefined;
}

async function speak(engine:NarrationEngine,textFile:string,output:string,signal?:AbortSignal):Promise<void>{
  if(signal?.aborted)throw new Error('Video rendering cancelled.');
  const args=engine.provider==='macOS'?['-v',engine.voice,'-r','170','-f',textFile,'-o',output]:['-v',engine.voice,'-s','170','-f',textFile,'-w',output];
  const child=spawn(engine.command,args,{stdio:['ignore','ignore','pipe']});
  let error='';child.stderr.on('data',(chunk:Buffer)=>{error=(error+chunk.toString()).slice(-800);});
  const stop=()=>{child.kill('SIGTERM');};signal?.addEventListener('abort',stop,{once:true});
  try{await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(signal?.aborted?'Video rendering cancelled.':`Narration synthesis failed: ${error||code}`)));});}
  finally{signal?.removeEventListener('abort',stop);}
}

/** Weight long words and natural punctuation pauses for readable karaoke timing. */
export function wordWeight(word:string):number{
  const letters=word.replace(/[^\p{L}\p{N}]/gu,'').length;
  return Math.max(.65,letters/3.3)+(/[.!?]$/.test(word)?.65:/[,;:]$/.test(word)?.3:0);
}

export function voicedCues(scene:Pick<Scene,'narration'|'caption'|'duration'>,start:number,duration:number):SubtitleCue[]{
  const phrases=subtitleCues([scene]);
  const all=phrases.flatMap(cue=>cue.words);const weights=all.map(wordWeight);const total=weights.reduce((a,b)=>a+b,0);
  let used=0,index=0;
  return phrases.map(cue=>{
    const begin=used;const wordStarts=cue.words.map(()=>{const time=start+used/total*duration;used+=weights[index++];return time;});
    return {...cue,start:start+begin/total*duration,end:start+used/total*duration,wordStarts};
  });
}

/** Generate real device speech once, fit each scene gently, and preserve silent editing handles. */
export async function prepareNarration(scenes:readonly Scene[],directory:string,runEncoder:RunEncoder,signal?:AbortSignal):Promise<NarrationTrack>{
  const engine=narrationEngine();
  if(!engine)throw new Error('Spoken narration needs a local voice. On Linux install espeak-ng, or turn off Spoken narration in Film style.');
  const cues:SubtitleCue[]=[];const files:string[]=[];let elapsed=0;
  for(let index=0;index<scenes.length;index++){
    const scene=scenes[index],text=(scene.narration.trim()||scene.caption.trim()).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,2000);
    const output=path.join(directory,`voice-${index}.wav`);files.push(output);
    if(!text){await runEncoder(['-f','lavfi','-i',`anullsrc=r=48000:cl=mono`,'-t',String(scene.duration),'-c:a','pcm_s16le',output],signal);elapsed+=scene.duration;continue;}
    const textFile=path.join(directory,`voice-${index}.txt`),speech=path.join(directory,`speech-${index}.${engine.provider==='macOS'?'aiff':'wav'}`),pcm=path.join(directory,`speech-${index}.pcm`);
    await writeFile(textFile,text,{mode:0o600});await speak(engine,textFile,speech,signal);
    await runEncoder(['-i',speech,'-af','silenceremove=start_periods=1:start_duration=0.02:start_threshold=-48dB,areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-48dB,areverse','-ar','48000','-ac','1','-f','s16le',pcm],signal);
    const rawDuration=(await stat(pcm)).size/96000;
    if(rawDuration<.05)throw new Error('The local narrator produced no audible speech.');
    const lead=Math.min(.3,scene.duration*.08),tail=Math.min(.35,scene.duration*.08),available=scene.duration-lead-tail;
    const tempo=Math.max(1,rawDuration/available);
    // Avoid a rushed read; changing the reviewed script or scene duration is preferable.
    if(tempo>1.38)throw new Error(`Scene ${index+1} has too much narration for ${scene.duration} seconds. Shorten the script or increase its duration.`);
    const spokenDuration=rawDuration/tempo;
    await runEncoder(['-f','s16le','-ar','48000','-ac','1','-i',pcm,'-af',`atempo=${tempo.toFixed(7)},loudnorm=I=-16:TP=-1.5:LRA=8,adelay=${Math.round(lead*1000)},apad,atrim=duration=${scene.duration}`,'-ar','48000','-ac','1','-c:a','pcm_s16le',output],signal);
    cues.push(...voicedCues(scene,elapsed+lead,spokenDuration));elapsed+=scene.duration;
  }
  const list=path.join(directory,'voice-scenes.txt');await writeFile(list,files.map((_,i)=>`file 'voice-${i}.wav'`).join('\n'));
  const file=path.join(directory,'narration.wav');
  await runEncoder(['-f','concat','-safe','1','-i',list,'-ar','48000','-ac','1','-c:a','pcm_s16le',file],signal);
  await writeFile(path.join(directory,'narration-timing.json'),JSON.stringify({voice:engine.voice,provider:engine.provider,cues},null,2));
  return {file,cues,voice:engine.voice};
}
