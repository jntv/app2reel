import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { narrationEngine, prepareNarration, voicedCues } from '../server/narration.js';
import { subtitleAt } from '../server/subtitles.js';
import { naturalVoiceReady } from '../server/local-voice.js';

test('lyrical highlights follow the actual narration span with silence before and after',()=>{
  const cues=voicedCues({narration:'See appointments and follow-ups in one workspace.',caption:'',duration:6},.3,3.8);
  assert.equal(cues[0].start,.3);assert.ok(Math.abs(cues.at(-1)!.end-4.1)<.001);
  assert.equal(subtitleAt(cues,.1).subtitle,'');assert.equal(subtitleAt(cues,4.2).subtitle,'');
  const words=cues.flatMap(c=>c.wordStarts!);assert.ok(words.every((at,i)=>i===0||at>words[i-1]));
  for(const cue of cues)for(let i=0;i<cue.words.length;i++)assert.equal(subtitleAt(cues,cue.wordStarts![i]+.0001).subtitleWord,i);
});

test('local narration produces audible PCM, fits the scene and exports word timing',{skip:!ffmpeg||!narrationEngine()},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'capture-narrator-'));
  const run=async(args:string[])=>{const child=spawn(ffmpeg!,['-hide_banner','-nostdin','-y',...args],{stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(errors)));});};
  try{
    const narration=await prepareNarration([{id:'s1',title:'Appointments',caption:'',narration:'Keep your appointments in view.',duration:4}],dir,run);
    assert.ok((await stat(narration.file)).size>4*48000*2);
    const pcm=path.join(dir,'proof.pcm');await run(['-i',narration.file,'-f','s16le','-ar','48000','-ac','1',pcm]);
    const bytes=await readFile(pcm);assert.ok(Math.abs(bytes.length/96000-4)<.01);
    let energy=0;for(let i=0;i<bytes.length;i+=2)energy+=(bytes.readInt16LE(i)/32768)**2;
    assert.ok(Math.sqrt(energy/(bytes.length/2))>.02,'Narration must contain audible speech, not just a silent placeholder.');
    assert.ok(narration.cues[0].start>.1);assert.ok(narration.cues.at(-1)!.end<4);
    assert.match(await readFile(path.join(dir,'narration-timing.json'),'utf8'),/wordStarts/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('installed neural narration preserves phoneme timing and silence-only scenes',{skip:!ffmpeg||!naturalVoiceReady('af_heart')},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'capture-natural-narrator-'));
  const run=async(args:string[])=>{const child=spawn(ffmpeg!,['-hide_banner','-nostdin','-y',...args],{stdio:'ignore'});await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('Audio conversion failed.')));});};
  try{
    const scene={id:'natural',title:'Connected clinic',caption:'',narration:'Start with SmartSevak. Review your next steps.',duration:6};
    const track=await prepareNarration([scene],dir,run,undefined,{engine:'natural',voice:'af_heart'});
    const timing=JSON.parse(await readFile(path.join(dir,'narration-timing.json'),'utf8'));
    assert.equal(track.voice,'af_heart');assert.equal(timing.provider,'Kokoro ONNX');assert.equal(timing.alignments[0].aligned,true);
    assert.deepEqual(track.cues.flatMap(c=>c.words),scene.narration.split(' '));
    const starts=track.cues.flatMap(c=>c.wordStarts!);assert.ok(starts.every((at,i)=>at>=.3&&(i===0||at>starts[i-1])));
    assert.ok(track.cues.at(-1)!.end<scene.duration);
    assert.ok((await stat(track.file)).size>6*48000*2);
    const silent=await prepareNarration([{...scene,narration:'',duration:1}],dir,run,undefined,{engine:'natural',voice:'af_heart'});
    assert.deepEqual(silent.cues,[]);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('installed Indian English narration uses its measured speech span without speeding the voice',{skip:!ffmpeg||!naturalVoiceReady('melo_india')},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'capture-indian-narrator-'));
  const run=async(args:string[])=>{const child=spawn(ffmpeg!,['-hide_banner','-nostdin','-y',...args],{stdio:'ignore'});await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('Audio conversion failed.')));});};
  try{
    const track=await prepareNarration([{id:'indian',title:'A connected clinic',caption:'',narration:'Keep your clinic work in view.',duration:5}],dir,run,undefined,{engine:'natural',voice:'melo_india'});
    const timing=JSON.parse(await readFile(path.join(dir,'narration-timing.json'),'utf8'));
    assert.equal(track.voice,'melo_india');assert.equal(timing.provider,'MeloTTS ONNX');assert.equal(timing.alignments[0].tempo,1);
    assert.equal(timing.alignments[0].aligned,false);assert.match(timing.alignments[0].reason,/estimated word timing/);
    assert.deepEqual(track.cues.flatMap(c=>c.words),['Keep','your','clinic','work','in','view.']);
    assert.ok(track.cues[0].start>=.3);assert.ok(track.cues.at(-1)!.end<5);
    const starts=track.cues.flatMap(c=>c.wordStarts!);assert.ok(starts.every((at,i)=>i===0||at>starts[i-1]));
    assert.ok((await stat(track.file)).size>5*48000*2);
  }finally{await rm(dir,{recursive:true,force:true});}
});
