import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
import {filmAudioFilter, mixFilmAudio} from '../server/audio-mix.js';

const execute=promisify(execFile);
const available=Boolean(ffmpeg&&existsSync(ffmpeg));
const RATE=48000;
const DURATION=6.4;
const run=async(args:string[],signal?:AbortSignal)=>execute(ffmpeg!,['-hide_banner','-v','error','-nostdin','-y',...args],{maxBuffer:16*1024*1024,signal});
const runEncoder=async(args:string[],signal?:AbortSignal)=>{await run(args,signal);};

/** A changing harmonic carrier with syllable envelopes and silent editing handles. */
function speechFixture(seconds:number):{file:Buffer;samples:Float64Array} {
  const frames=Math.round(seconds*RATE),file=Buffer.alloc(44+frames*2),samples=new Float64Array(frames);
  file.write('RIFF');file.writeUInt32LE(file.length-8,4);file.write('WAVEfmt ',8);file.writeUInt32LE(16,16);
  file.writeUInt16LE(1,20);file.writeUInt16LE(1,22);file.writeUInt32LE(RATE,24);file.writeUInt32LE(RATE*2,28);
  file.writeUInt16LE(2,32);file.writeUInt16LE(16,34);file.write('data',36);file.writeUInt32LE(frames*2,40);
  for(let frame=0;frame<frames;frame++){
    const t=frame/RATE,local=t>=.65&&t<2.25?t-.65:t>=3.5&&t<5.1?t-3.5:-1;
    const edge=local<0?0:Math.min(1,local/.035,(1.6-local)/.035);
    const envelope=Math.max(0,edge)*(.66+.34*Math.sin(2*Math.PI*3.7*Math.max(0,local))**2);
    const phase=2*Math.PI*(613*t+12*t*t+.37*Math.sin(2*Math.PI*.71*t));
    const value=.31*envelope*(Math.sin(phase)+.3*Math.sin(phase*2)+.12*Math.sin(phase*3));
    const pcm=Math.round(value*32767);file.writeInt16LE(pcm,44+frame*2);samples[frame]=pcm/32768;
  }
  return {file,samples};
}

async function fixture(directory:string){
  const video=path.join(directory,'original.mp4'),voice=path.join(directory,'voice.wav'),speech=speechFixture(DURATION);
  await writeFile(voice,speech.file);
  // Existing audio is intentionally loud and unrelated: every new mix must replace it.
  await run(['-f','lavfi','-i','testsrc2=s=160x90:r=30','-f','lavfi','-i',`aevalsrc=0.35*sin(2*PI*109*t):s=${RATE}:d=${DURATION}`,
    '-t',String(DURATION),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',video]);
  return {video,voice,speech};
}

async function decoded(file:string):Promise<Float64Array>{
  const result=await execute(ffmpeg!,['-v','error','-i',file,'-map','0:a:0','-ar',String(RATE),'-ac','2','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:16*1024*1024});
  const samples=new Float64Array(result.stdout.length/8);
  // Equal-power stereo fold restores the original centered mono speech amplitude.
  for(let frame=0;frame<samples.length;frame++)samples[frame]=(result.stdout.readFloatLE(frame*8)+result.stdout.readFloatLE(frame*8+4))*Math.SQRT1_2;
  return samples;
}

function rms(samples:ArrayLike<number>,start=0,end=samples.length):number{
  let sum=0;for(let i=start;i<end;i++)sum+=samples[i]**2;return Math.sqrt(sum/Math.max(1,end-start));
}
function correlationLag(expected:Float64Array,actual:Float64Array,start:number,end:number):number{
  let best=-Infinity,lag=0;
  for(let offset=-240;offset<=240;offset++){
    let score=0;for(let frame=start;frame<end;frame++)score+=expected[frame]*actual[frame+offset];
    if(score>best){best=score;lag=offset;}
  }
  return lag;
}
async function pictureHash(file:string):Promise<string>{
  const result=await run(['-i',file,'-map','0:v:0','-c:v','copy','-f','streamhash','-hash','sha256','-']);
  return result.stdout.trim();
}
async function mix(directory:string,name:string,video:string,voice:string|undefined,settings:{backgroundMusic?:boolean;musicVolume?:number}){
  const temporary=path.join(directory,name);await mkdir(temporary);
  const output=path.join(temporary,'film.mp4');
  await mixFilmAudio({video,output,temporary,duration:DURATION,kind:'promo',settings,narration:voice,runEncoder});
  return output;
}

test('audio mixing rejects invalid duration and volume before encoding',()=>{
  for(const duration of [0,-1,NaN,Infinity,180.01])assert.throws(()=>filmAudioFilter(duration,.24,true,true),/audio settings/);
  for(const volume of [-.01,.501,NaN,Infinity])assert.throws(()=>filmAudioFilter(DURATION,volume,true,true),/audio settings/);
});

test('actual music mix preserves every picture packet, foreground speech and its original clock',{skip:!available,timeout:60000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-audio-mix-'));
  try{
    const {video,voice,speech}=await fixture(directory),voiceBefore=await readFile(voice);
    const output=await mix(directory,'narrated',video,voice,{backgroundMusic:true,musicVolume:.24});
    const musicOnly=await mix(directory,'music-only',video,undefined,{backgroundMusic:true,musicVolume:.24});
    assert.equal(await pictureHash(output),await pictureHash(video),'An audio update must copy the encoded picture stream unchanged.');
    const frames=await run(['-i',output,'-map','0:v:0','-f','framemd5','-']);
    assert.equal(frames.stdout.split('\n').filter(line=>/^0,/.test(line)).length,DURATION*30,'Mixing must retain the complete film frame clock.');
    const pcm=await decoded(output),bed=await decoded(musicOnly),expected=Math.round(DURATION*RATE);
    assert.ok(pcm.length>=expected&&pcm.length<expected+2048,'AAC may pad a codec frame but must retain every original speech sample.');
    assert.ok(Math.abs(correlationLag(speech.samples,pcm,Math.round(.9*RATE),Math.round(1.8*RATE)))<=1,'Limiter lookahead must not shift narration or captions.');
    const first=Math.round(3.8*RATE),last=Math.round(4.8*RATE),residual=new Float64Array(last-first);
    for(let frame=first;frame<last;frame++)residual[frame-first]=pcm[frame]-speech.samples[frame];
    assert.ok(rms(speech.samples,first,last)>rms(residual)*6,'Speech must remain at least15.5dB above its ducked music bed.');
    assert.ok(rms(residual)<rms(bed,first,last)*.82,'The same musical passage must duck while the original speech key is active.');
    assert.ok(rms(pcm,Math.round(2.5*RATE),Math.round(3.1*RATE))>.002,'Subtle music remains audible in the narration gap.');
    assert.ok(rms(bed,0,Math.round(.04*RATE))<rms(bed,Math.round(1.2*RATE),Math.round(1.8*RATE))*.15,'Music must fade into the opening.');
    assert.ok(rms(bed,expected-Math.round(.04*RATE),expected)<rms(bed,Math.round(4.3*RATE),Math.round(4.9*RATE))*.15,'Music must resolve softly before the film ends.');
    const peak=await execute(ffmpeg!,['-v','error','-i',output,'-map','0:a:0','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:16*1024*1024});
    let clipped=0;for(let i=0;i<peak.stdout.length;i+=4)if(Math.abs(peak.stdout.readFloatLE(i))>=1)clipped++;
    assert.equal(clipped,0,'Neither AAC channel may clip.');
    assert.deepEqual(await readFile(voice),voiceBefore,'The original voice cache must remain byte-for-byte unchanged.');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('music off and zero volume preserve speech, while disabling both audio layers removes old input audio',{skip:!available,timeout:60000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-audio-toggle-'));
  try{
    const {video,voice,speech}=await fixture(directory);
    const off=await mix(directory,'music-off',video,voice,{backgroundMusic:false,musicVolume:.24});
    const zero=await mix(directory,'zero-volume',video,voice,{backgroundMusic:true,musicVolume:0});
    const silent=await mix(directory,'silent',video,undefined,{backgroundMusic:false,musicVolume:.24});
    const a=await decoded(off),b=await decoded(zero),silence=await decoded(silent);
    assert.deepEqual(a,b,'Music off and zero volume must produce exactly the same untouched speech mix.');
    assert.ok(Math.abs(correlationLag(speech.samples,a,Math.round(.9*RATE),Math.round(1.8*RATE)))<=1);
    assert.ok(rms(silence)<1e-8,'Turning both layers off must not expose the completed input movie’s old audio.');
    assert.equal(await pictureHash(silent),await pictureHash(video));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('remixing from an already mixed film replaces its audio rather than stacking the previous bed',{skip:!available,timeout:60000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-audio-replace-'));
  try{
    const {video,voice}=await fixture(directory),voiceHash=createHash('sha256').update(await readFile(voice)).digest('hex');
    const first=await mix(directory,'first',video,voice,{backgroundMusic:true,musicVolume:.24});
    const second=await mix(directory,'second',first,voice,{backgroundMusic:true,musicVolume:.24});
    assert.deepEqual(await decoded(second),await decoded(first),'Reusing the original speech and score must be independent of the input movie’s audio.');
    assert.equal(await pictureHash(first),await pictureHash(second));
    assert.equal(createHash('sha256').update(await readFile(voice)).digest('hex'),voiceHash);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('pre-cancelled audio work never starts an encoder and encoder failure is propagated',{skip:!available},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-audio-errors-'));
  try{
    const controller=new AbortController();controller.abort();let calls=0;
    const options={video:path.join(directory,'source.mp4'),output:path.join(directory,'staged.mp4'),temporary:directory,duration:1,kind:'demo' as const,settings:{backgroundMusic:false,musicVolume:0}};
    await assert.rejects(mixFilmAudio({...options,signal:controller.signal,runEncoder:async()=>{calls++;}}),/cancelled/i);
    assert.equal(calls,0,'A cancelled job must not reach FFmpeg.');
    await assert.rejects(mixFilmAudio({...options,runEncoder:async()=>{throw new Error('fixture encoder failure');}}),/fixture encoder failure/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
