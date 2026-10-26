import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {narrationFingerprint, readPreparedNarration} from '../server/narration-cache.js';

const scenes = [{narration:'Hello, team.',caption:'Ignored',duration:1},{narration:'Keep work clear.',caption:'',duration:1}];
const cues = [
  {start:.1,end:.8,text:'Hello, team.',words:['Hello,','team.'],wordStarts:[.1,.4]},
  {start:1.1,end:1.9,text:'Keep work clear.',words:['Keep','work','clear.'],wordStarts:[1.1,1.3,1.6]},
];
function wave(seconds = 2): Buffer {
  const size = Math.round(seconds * 48000) * 2, bytes = Buffer.alloc(44 + size);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length - 8,4);bytes.write('WAVE',8);
  bytes.write('fmt ',12);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(size,40);
  for (let i=44;i<bytes.length;i+=2) bytes.writeInt16LE(Math.round(Math.sin(i / 20) * 4000),i);
  return bytes;
}
async function fixture(run:(source:string,target:string,metadata:Record<string,any>)=>Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(),'capture-narration-cache-'));
  const source = path.join(root,'project'), target = path.join(source,'.render-test');
  await mkdir(target,{recursive:true});
  const metadata = {fingerprint:narrationFingerprint(scenes,{}),voice:'melo_india',provider:'MeloTTS ONNX',cues:structuredClone(cues)};
  await writeFile(path.join(source,'narration.wav'),wave());
  await writeFile(path.join(source,'narration-timing.json'),JSON.stringify(metadata));
  try { await run(source,target,metadata); } finally { await rm(root,{recursive:true,force:true}); }
}

test('narration fingerprint binds spoken text, frame durations and effective voice, not camera edits',()=>{
  const fingerprint=narrationFingerprint(scenes,{});
  assert.match(fingerprint,/^[a-f0-9]{64}$/);
  assert.equal(fingerprint,narrationFingerprint(scenes,{engine:'natural',voice:'melo_india'}));
  assert.equal(fingerprint,narrationFingerprint(scenes.map(scene=>({...scene,title:'A visual edit',focus:{x:.2,y:.3,zoom:2},duration:scene.duration+.001})),{}));
  assert.notEqual(fingerprint,narrationFingerprint([{...scenes[0],narration:'Changed speech.'},scenes[1]],{}));
  assert.notEqual(fingerprint,narrationFingerprint([{...scenes[0],duration:1.1},scenes[1]],{}));
  assert.notEqual(fingerprint,narrationFingerprint(scenes,{voice:'af_heart'}));
  assert.notEqual(fingerprint,narrationFingerprint(scenes,{engine:'system'}));
  assert.equal(narrationFingerprint(scenes,{engine:'system',voice:'af_heart'}),narrationFingerprint(scenes,{engine:'system',voice:'melo_india'}));
  assert.equal(narrationFingerprint([{narration:'',caption:'Hello\nteam',duration:1}],{}),narrationFingerprint([{narration:'Hello team',caption:'',duration:1}],{}));
});

test('a valid local narration is copied byte-for-byte into the existing render directory',async()=>{
  await fixture(async(source,target,metadata)=>{
    const track=await readPreparedNarration(scenes,{},source,target);
    assert.ok(track);assert.equal(track.voice,'melo_india');assert.deepEqual(track.cues,cues);
    assert.equal(track.file,path.join(await realpath(target),'narration.wav'));
    assert.deepEqual(await readFile(track.file),wave());
    assert.deepEqual(JSON.parse(await readFile(path.join(target,'narration-timing.json'),'utf8')),metadata);
    assert.deepEqual(await readFile(path.join(source,'narration.wav')),wave());
  });
});

test('missing, malformed and mismatched provenance never produces a cache hit',async t=>{
  for (const mode of ['missing-wav','missing-json','malformed','no-fingerprint','wrong-fingerprint','wrong-voice','wrong-provider','changed-script','changed-engine']) {
    await t.test(mode,async()=>fixture(async(source,target,metadata)=>{
      if(mode==='missing-wav')await rm(path.join(source,'narration.wav'));
      if(mode==='missing-json')await rm(path.join(source,'narration-timing.json'));
      if(mode==='malformed')await writeFile(path.join(source,'narration-timing.json'),'{');
      if(mode==='no-fingerprint'){delete (metadata as any).fingerprint;await writeFile(path.join(source,'narration-timing.json'),JSON.stringify(metadata));}
      if(mode==='wrong-fingerprint')metadata.fingerprint='0'.repeat(64);
      if(mode==='wrong-voice')metadata.voice='af_heart';
      if(mode==='wrong-provider')metadata.provider='Kokoro ONNX';
      if(mode.startsWith('wrong-'))await writeFile(path.join(source,'narration-timing.json'),JSON.stringify(metadata));
      const input=mode==='changed-script'?[{...scenes[0],narration:'Different words.'},scenes[1]]:scenes;
      assert.equal(await readPreparedNarration(input,mode==='changed-engine'?{engine:'system'}:{},source,target),undefined);
      await assert.rejects(readFile(path.join(target,'narration.wav')),/ENOENT/);
    }));
  }
});

test('cue validation rejects lost words, scene crossing and incoherent word clocks',async t=>{
  const mutations:Record<string,(data:Record<string,any>)=>void>={
    'missing word':data=>{data.cues[0].words=['Hello,'];data.cues[0].text='Hello,';data.cues[0].wordStarts=[.1];},
    'changed text':data=>{data.cues[0].text='An invented caption';},
    'scene crossing':data=>{data.cues[0].end=1.2;},
    'out of order':data=>{data.cues.reverse();},
    'NaN timestamp':data=>{data.cues[0].start=null;},
    'negative timestamp':data=>{data.cues[0].start=-.1;},
    'word count mismatch':data=>{data.cues[0].wordStarts=[.1];},
    'duplicate word time':data=>{data.cues[0].wordStarts=[.1,.1];},
    'word before cue':data=>{data.cues[0].wordStarts=[.05,.4];},
    'word after cue':data=>{data.cues[0].wordStarts=[.1,.9];},
    'caption after film':data=>{data.cues.push({start:2.1,end:2.2,text:'Extra',words:['Extra'],wordStarts:[2.1]});},
  };
  for(const [name,mutate] of Object.entries(mutations))await t.test(name,async()=>fixture(async(source,target,metadata)=>{
    mutate(metadata);await writeFile(path.join(source,'narration-timing.json'),JSON.stringify(metadata));
    assert.equal(await readPreparedNarration(scenes,{},source,target),undefined);
  }));
});

test('WAV validation enforces complete 48 kHz mono PCM and the reviewed film duration',async t=>{
  const variants:Record<string,()=>Buffer>={
    'different duration':()=>wave(1),
    'truncated data':()=>wave().subarray(0,100),
    'stereo':()=>{const bytes=wave();bytes.writeUInt16LE(2,22);return bytes;},
    'wrong sample rate':()=>{const bytes=wave();bytes.writeUInt32LE(24000,24);return bytes;},
    'compressed format':()=>{const bytes=wave();bytes.writeUInt16LE(3,20);return bytes;},
    'not WAV':()=>Buffer.from('not an audio file'),
  };
  for(const [name,make] of Object.entries(variants))await t.test(name,async()=>fixture(async(source,target)=>{
    await writeFile(path.join(source,'narration.wav'),make());assert.equal(await readPreparedNarration(scenes,{},source,target),undefined);
  }));
});

test('symbolic links and preexisting render assets cannot be followed or overwritten',{skip:process.platform==='win32'},async t=>{
  for(const name of ['narration.wav','narration-timing.json'])await t.test(`source ${name}`,async()=>fixture(async(source,target)=>{
    const original=path.join(source,name), other=path.join(source,`saved-${name}`);
    await writeFile(other,await readFile(original));await rm(original);await symlink(other,original);
    assert.equal(await readPreparedNarration(scenes,{},source,target),undefined);
  }));
  for(const name of ['narration.wav','narration-timing.json'])await t.test(`destination ${name}`,async()=>fixture(async(source,target)=>{
    const sentinel=path.join(source,'sentinel');await writeFile(sentinel,'keep this');await symlink(sentinel,path.join(target,name));
    assert.equal(await readPreparedNarration(scenes,{},source,target),undefined);
    assert.equal(await readFile(sentinel,'utf8'),'keep this');
    if(name==='narration-timing.json')await assert.rejects(readFile(path.join(target,'narration.wav')),/ENOENT/);
  }));
});
