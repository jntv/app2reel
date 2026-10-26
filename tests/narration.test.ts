import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { narrationEngine, prepareNarration, voicedCues } from '../server/narration.js';
import { subtitleAt } from '../server/subtitles.js';

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
