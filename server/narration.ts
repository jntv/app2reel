import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Scene } from '../shared/types.js';
import { subtitleCues, type SubtitleCue } from './subtitles.js';
import { synthesizeNaturalVoice } from './local-voice.js';
import { alignVoiceWords } from './voice-alignment.js';
import { narrationFingerprint } from './narration-cache.js';

export interface NarrationEngine { command: string; voice: string; provider: 'macOS'|'eSpeak'; }
export interface NarrationTrack { file: string; cues: SubtitleCue[]; voice: string; }
export interface NarrationOptions { engine?:'natural'|'system';voice?:string; }
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

/** Generate local speech once, fit each scene gently, and preserve silent editing handles. */
export async function prepareNarration(scenes:readonly Scene[],directory:string,runEncoder:RunEncoder,signal?:AbortSignal,options:NarrationOptions={}):Promise<NarrationTrack>{
  const natural=options.engine==='natural';const engine=natural?undefined:narrationEngine();
  if(!natural&&!engine)throw new Error('Spoken narration needs a local voice. Set up Natural voices, install espeak-ng, or turn off Spoken narration.');
  const texts=scenes.map(scene=>(scene.narration.trim()||scene.caption.trim()).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,2000));
  const naturalItems=texts.flatMap((text,index)=>text?[{text,file:path.join(directory,`speech-${index}.wav`)}]:[]);
  const naturalFiles=natural&&naturalItems.length?await synthesizeNaturalVoice(naturalItems,options.voice||'melo_india',signal):[];
  const alignments:{scene:number;aligned:boolean;confidence?:number;reason?:string;rawDuration?:number;tempo?:number;lead?:number}[]=[];
  const cues:SubtitleCue[]=[];const files:string[]=[];let elapsed=0;
  for(let index=0;index<scenes.length;index++){
    const scene=scenes[index],text=texts[index];
    const output=path.join(directory,`voice-${index}.wav`);files.push(output);
    if(!text){await runEncoder(['-f','lavfi','-i',`anullsrc=r=48000:cl=mono`,'-t',String(scene.duration),'-c:a','pcm_s16le',output],signal);elapsed+=scene.duration;continue;}
    const textFile=path.join(directory,`voice-${index}.txt`),speech=path.join(directory,`speech-${index}.${engine?.provider==='macOS'?'aiff':'wav'}`),pcm=path.join(directory,`speech-${index}.pcm`);
    await writeFile(textFile,text,{mode:0o600});if(engine)await speak(engine,textFile,speech,signal);
    // Neural timestamps describe the original waveform, including its natural pauses.
    // Preserve that clock; system speech retains the existing silence-trimmed path.
    await runEncoder(['-i',speech,...(natural?[]:['-af','silenceremove=start_periods=1:start_duration=0.02:start_threshold=-48dB,areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-48dB,areverse']),'-ar','48000','-ac','1','-f','s16le',pcm],signal);
    const rawDuration=(await stat(pcm)).size/96000;
    if(rawDuration<.05)throw new Error('The local narrator produced no audible speech.');
    const lead=Math.min(.3,scene.duration*.08),tail=Math.min(.35,scene.duration*.08),available=scene.duration-lead-tail;
    const tempo=Math.max(1,rawDuration/available);
    // Avoid a rushed read; changing the reviewed script or scene duration is preferable.
    if(tempo>(natural?1.12:1.38))throw new Error(`Scene ${index+1} has too much narration for ${scene.duration} seconds. Shorten the script or increase its duration.`);
    await runEncoder(['-f','s16le','-ar','48000','-ac','1','-i',pcm,'-af',`atempo=${tempo.toFixed(7)},loudnorm=I=-16:TP=-1.5:LRA=8,adelay=${Math.round(lead*1000)},apad,atrim=duration=${scene.duration}`,'-ar','48000','-ac','1','-c:a','pcm_s16le',output],signal);
    const result=naturalFiles.find(item=>item.file===speech);
    const alignment=result?alignVoiceWords(text,result.wordPhonemes,result.phonemes):undefined;
    const phrases=subtitleCues([scene]);const count=phrases.reduce((sum,cue)=>sum+cue.words.length,0);
    if(alignment?.aligned&&alignment.words.length===count&&alignment.words.every(word=>word.end<=rawDuration+.01)){
      let first=0;for(const cue of phrases){const words=alignment.words.slice(first,first+cue.words.length);cues.push({...cue,start:elapsed+lead+words[0].start/tempo,end:elapsed+lead+words.at(-1)!.end/tempo,wordStarts:words.map(word=>elapsed+lead+word.start/tempo)});first+=cue.words.length;}
      alignments.push({scene:index+1,aligned:true,confidence:alignment.confidence,rawDuration,tempo,lead});
    }else{
      const first=Math.min(rawDuration,result?.spokenStart??result?.phonemes[0]?.start??0),last=Math.max(first,Math.min(rawDuration,result?.spokenEnd??result?.phonemes.at(-1)?.end??rawDuration));
      cues.push(...voicedCues(scene,elapsed+lead+first/tempo,Math.max(.01,last-first)/tempo));
      alignments.push({scene:index+1,aligned:false,rawDuration,tempo,lead,...(alignment?{confidence:alignment.confidence,reason:alignment.reason}: {}),...(result&&!result.phonemes.length?{reason:'This voice uses estimated word timing within its measured speech span.'}:{})});
    }
    elapsed+=scene.duration;
  }
  const list=path.join(directory,'voice-scenes.txt');await writeFile(list,files.map((_,i)=>`file 'voice-${i}.wav'`).join('\n'));
  const file=path.join(directory,'narration.wav');
  await runEncoder(['-f','concat','-safe','1','-i',list,'-ar','48000','-ac','1','-c:a','pcm_s16le',file],signal);
  const voice=natural?options.voice||'melo_india':engine!.voice;
  await writeFile(path.join(directory,'narration-timing.json'),JSON.stringify({fingerprint:narrationFingerprint(scenes,{engine:natural?'natural':'system',voice:options.voice}),voice,provider:natural?voice==='melo_india'?'MeloTTS ONNX':'Kokoro ONNX':engine!.provider,alignments,cues},null,2));
  return {file,cues,voice};
}
