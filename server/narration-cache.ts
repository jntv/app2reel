import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, open, realpath, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Scene} from '../shared/types.js';
import type {NarrationOptions, NarrationTrack} from './narration.js';
import {subtitleCues, type SubtitleCue} from './subtitles.js';
import {naturalVoiceIdentity} from './local-voice.js';

const VERSION = 1;
const RATE = 48000;
const EPSILON = 0.00001;
type SpeechScene = Pick<Scene, 'narration'|'caption'|'duration'>;
const speechText = (scene: SpeechScene): string => (scene.narration.trim() || scene.caption.trim()).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 2000);
function identity(options: NarrationOptions) {
  const engine = options.engine || 'natural';
  const voice=engine==='system'?process.platform==='darwin'?'Samantha':'en-us':options.voice||'melo_india';
  return {engine,voice,...(engine==='system'?{provider:process.platform==='darwin'?'macOS':'eSpeak'}:naturalVoiceIdentity(voice))};
}
function speechScenes(scenes: readonly SpeechScene[]) {
  if (!scenes.length || scenes.length > 20) throw new Error('Invalid narration scene count.');
  const normalized = scenes.map(scene => {
    if (!Number.isFinite(scene.duration) || scene.duration <= 0 || typeof scene.narration !== 'string' || typeof scene.caption !== 'string') throw new Error('Invalid narration scene.');
    return {text: speechText(scene), frames: Math.max(1, Math.round(scene.duration * 30))};
  });
  if (normalized.reduce((sum, scene) => sum + scene.frames, 0) > 5400) throw new Error('Narration exceeds the supported timeline.');
  return normalized;
}

/** The exact spoken input and 30 fps scene clock, independent of visual edits. */
export function narrationFingerprint(scenes: readonly SpeechScene[], options: NarrationOptions = {}): string {
  return createHash('sha256').update(JSON.stringify({version: VERSION, ...identity(options), scenes: speechScenes(scenes)})).digest('hex');
}

async function boundedFile(directory: string, name: string, limit: number): Promise<Buffer | undefined> {
  // Fixed basenames plus O_NOFOLLOW avoid traversing or following project assets.
  const file = path.join(directory, name);
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit) return undefined;
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== before.size || info.size > limit) return undefined;
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const {bytesRead} = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) return undefined;
      offset += bytesRead;
    }
    if ((await handle.stat()).size !== bytes.length) return undefined;
    return bytes;
  } finally { await handle.close(); }
}

function wavPcm(bytes: Buffer): {duration:number;start:number;length:number} | undefined {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) return undefined;
  let offset = 12, validFormat = false, data: {start:number;length:number} | undefined;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return undefined;
    const name = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), begin = offset + 8;
    if (begin + length > bytes.length) return undefined;
    if (name === 'fmt ') {
      if (validFormat || length < 16 || bytes.readUInt16LE(begin) !== 1 || bytes.readUInt16LE(begin + 2) !== 1 || bytes.readUInt32LE(begin + 4) !== RATE || bytes.readUInt32LE(begin + 8) !== RATE * 2 || bytes.readUInt16LE(begin + 12) !== 2 || bytes.readUInt16LE(begin + 14) !== 16) return undefined;
      validFormat = true;
    }
    if (name === 'data') {
      if (data !== undefined || !length || length % 2) return undefined;
      data = {start:begin,length};
    }
    offset = begin + length + (length % 2);
  }
  return offset === bytes.length && validFormat && data !== undefined ? {...data,duration:data.length / (RATE * 2)} : undefined;
}

function pcmWave(pcm: Buffer): Buffer {
  const bytes=Buffer.alloc(44+pcm.length);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVE',8);
  bytes.write('fmt ',12);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(RATE,24);bytes.writeUInt32LE(RATE*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(pcm.length,40);pcm.copy(bytes,44);return bytes;
}

function coherentCues(value: unknown, scenes: ReturnType<typeof speechScenes>): SubtitleCue[] | undefined {
  if (!Array.isArray(value) || value.length > 10000) return undefined;
  const cues: SubtitleCue[] = [];
  let previous = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object' || !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end <= item.start || item.start < previous - EPSILON || typeof item.text !== 'string' || item.text.length > 256 || !Array.isArray(item.words) || item.words.length < 1 || item.words.length > 7 || item.words.some((word: unknown) => typeof word !== 'string' || !word || /\s/u.test(word) || [...word].length > 32) || item.words.join(' ') !== item.text || !Array.isArray(item.wordStarts) || item.wordStarts.length !== item.words.length) return undefined;
    if (Math.abs(item.wordStarts[0] - item.start) > EPSILON || item.wordStarts.some((at: unknown, index: number) => typeof at !== 'number' || !Number.isFinite(at) || at < item.start - EPSILON || at >= item.end || (index > 0 && at <= item.wordStarts[index - 1]))) return undefined;
    const cue: SubtitleCue = {start:item.start, end:item.end, text:item.text, words:[...item.words], wordStarts:[...item.wordStarts]};
    cues.push(cue); previous = cue.end;
  }
  let elapsed = 0, cursor = 0;
  for (const scene of scenes) {
    const end = elapsed + scene.frames / 30;
    const words: string[] = [];
    while (cursor < cues.length && cues[cursor].start < end - EPSILON) {
      const cue = cues[cursor++];
      if (cue.start < elapsed - EPSILON || cue.end > end + EPSILON) return undefined;
      words.push(...cue.words);
    }
    const expected = subtitleCues([{narration:scene.text, caption:'', duration:scene.frames / 30}]).flatMap(cue => cue.words);
    if (words.length !== expected.length || words.some((word, index) => word !== expected[index])) return undefined;
    elapsed = end;
  }
  return cursor === cues.length ? cues : undefined;
}

/** Reuse one verified project narration without synthesizing a second voice take. */
export async function readPreparedNarration(scenes: readonly SpeechScene[], options: NarrationOptions, directory: string, temporary: string,kind?:'demo'|'promo'): Promise<NarrationTrack | undefined> {
  const created: string[] = [];
  try {
    const [sourceInfo, targetInfo] = await Promise.all([lstat(directory), lstat(temporary)]);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink() || !targetInfo.isDirectory() || targetInfo.isSymbolicLink()) return undefined;
    const [source, target] = await Promise.all([realpath(directory), realpath(temporary)]);
    if (source === target) return undefined;
    const prefix=kind?`${kind}-`:'';
    const [timingBytes, wav] = await Promise.all([boundedFile(source, `${prefix}narration-timing.json`, 1024 * 1024), boundedFile(source, `${prefix}narration.wav`, 180 * RATE * 2 + 65536)]);
    if (!timingBytes || !wav) return undefined;
    const metadata = JSON.parse(timingBytes.toString('utf8'));
    const expected = identity(options), normalized = speechScenes(scenes);
    if (!metadata || metadata.fingerprint !== narrationFingerprint(scenes, options) || metadata.voice !== expected.voice || metadata.provider !== expected.provider) return undefined;
    const duration = wavPcm(wav)?.duration, seconds = normalized.reduce((sum, scene) => sum + scene.frames / 30, 0);
    if (duration === undefined || Math.abs(duration - seconds) > .001) return undefined;
    const cues = coherentCues(metadata.cues, normalized);
    if (!cues) return undefined;
    // Exclusive creation cannot follow a planted destination symlink. On failure
    // remove only files created by this call; published project assets stay intact.
    for (const [name, bytes] of [['narration.wav', wav], ['narration-timing.json', timingBytes]] as const) {
      const file = path.join(target, name);
      await writeFile(file, bytes, {flag:'wx', mode:0o600}); created.push(file);
    }
    return {file:path.join(target, 'narration.wav'), cues, voice:metadata.voice};
  } catch {
    await Promise.all(created.map(file => rm(file, {force:true}).catch(() => {})));
    return undefined;
  }
}

/**
 * Re-pad reviewed, already normalized takes on an explicitly reviewed new clock.
 * The only discarded samples are exterior digital silence. Speech samples,
 * speed, voice identity and word timing within each take remain unchanged.
 * This is deliberately explicit: ordinary cache reads never infer an old clock.
 */
export async function retimePreparedNarration(previousScenes:readonly SpeechScene[],nextScenes:readonly SpeechScene[],options:NarrationOptions,directory:string,temporary:string,kind?:'demo'|'promo'):Promise<NarrationTrack>{
  const created:string[]=[];
  try{
    const previous=speechScenes(previousScenes),next=speechScenes(nextScenes);
    if(previous.length!==next.length||previous.some((scene,index)=>scene.text!==next[index].text))throw new Error('Approved narration retiming requires the same reviewed words in the same scene order.');
    const [sourceInfo,targetInfo]=await Promise.all([lstat(directory),lstat(temporary)]);
    if(!sourceInfo.isDirectory()||sourceInfo.isSymbolicLink()||!targetInfo.isDirectory()||targetInfo.isSymbolicLink())throw new Error('Narration retiming needs separate local source and staging directories.');
    const [source,target]=await Promise.all([realpath(directory),realpath(temporary)]);
    if(source===target)throw new Error('Narration retiming must be staged separately from approved assets.');
    const prefix=kind?`${kind}-`:'';
    const [timingBytes,wav]=await Promise.all([boundedFile(source,`${prefix}narration-timing.json`,1024*1024),boundedFile(source,`${prefix}narration.wav`,180*RATE*2+65536)]);
    if(!timingBytes||!wav)throw new Error('The approved narration files are unavailable.');
    const metadata=JSON.parse(timingBytes.toString('utf8')),expected=identity(options),sourceFingerprint=narrationFingerprint(previousScenes,options);
    if(!metadata||metadata.fingerprint!==sourceFingerprint||metadata.voice!==expected.voice||metadata.provider!==expected.provider)throw new Error('Approved narration does not match the reviewed source clock and voice.');
    const format=wavPcm(wav),sourceCues=coherentCues(metadata.cues,previous),oldSamples=previous.reduce((sum,scene)=>sum+scene.frames*RATE/30,0);
    if(!format||format.length!==oldSamples*2||!sourceCues)throw new Error('The approved narration waveform or word clock is invalid.');
    const alignments=metadata.alignments;
    if(!Array.isArray(alignments)||alignments.length!==previous.filter(scene=>scene.text).length)throw new Error('Approved narration is missing its measured take bounds.');
    const pcm=wav.subarray(format.start,format.start+format.length),output=Buffer.alloc(next.reduce((sum,scene)=>sum+scene.frames*RATE/30,0)*2);
    const cues:SubtitleCue[]=[],nextAlignments:Record<string,unknown>[]=[],takes:{scene:number;sourceStartSample:number;sourceEndSample:number;targetStartSample:number;targetEndSample:number}[]=[];
    let oldOffset=0,newOffset=0,cursor=0;
    for(let index=0;index<previous.length;index++){
      const oldScene=previous[index],newScene=next[index],oldLength=oldScene.frames*RATE/30,newLength=newScene.frames*RATE/30;
      const sceneCues:SubtitleCue[]=[];
      while(cursor<sourceCues.length&&sourceCues[cursor].start<(oldOffset+oldLength)/RATE-EPSILON)sceneCues.push(sourceCues[cursor++]);
      if(!oldScene.text){
        for(let sample=oldOffset;sample<oldOffset+oldLength;sample++)if(pcm.readInt16LE(sample*2)!==0)throw new Error('A silent narration scene contains unreviewed audio.');
      }else{
        const matches=alignments.filter(item=>item&&typeof item==='object'&&item.scene===index+1),take=matches[0];
        if(matches.length!==1||!Number.isFinite(take.rawDuration)||take.rawDuration<.05||!Number.isFinite(take.tempo)||take.tempo<1||take.tempo>1.38||!Number.isFinite(take.lead)||take.lead<0||take.lead>.3+EPSILON)throw new Error('Approved narration take bounds are invalid.');
        // adelay is encoded on a millisecond clock in the original assembly.
        const rawStart=Math.round(take.lead*1000)*RATE/1000,rawLength=Math.ceil(take.rawDuration/take.tempo*RATE);
        let begin=rawStart,end=rawStart+rawLength;
        if(end>oldLength||sceneCues.some(cue=>cue.start*RATE<oldOffset+begin-1||cue.end*RATE>oldOffset+end+1))throw new Error('Approved narration take bounds do not contain its reviewed words.');
        // Retain even a one-sample quiet consonant or resampler tail outside the
        // declared take. Only verified zero-valued exterior padding is removed.
        for(let sample=0;sample<oldLength;sample++)if(pcm.readInt16LE((oldOffset+sample)*2)!==0){begin=Math.min(begin,sample);end=Math.max(end,sample+1);}
        const lead=Math.round(Math.min(.3,newLength/RATE*.08)*1000)*RATE/1000,tail=Math.min(.35,newLength/RATE*.08);
        if(lead+end-begin>newLength-Math.round(tail*RATE))throw new Error(`Scene ${index+1} is too short to retain its approved narration and breathing room.`);
        const sourceStart=oldOffset+begin,targetStart=newOffset+lead,shift=(targetStart-sourceStart)/RATE;
        pcm.copy(output,targetStart*2,sourceStart*2,(oldOffset+end)*2);
        cues.push(...sceneCues.map(cue=>({...cue,start:cue.start+shift,end:cue.end+shift,words:[...cue.words],wordStarts:cue.wordStarts!.map(at=>at+shift)})));
        nextAlignments.push({...take,lead:(lead+rawStart-begin)/RATE});
        takes.push({scene:index+1,sourceStartSample:sourceStart,sourceEndSample:oldOffset+end,targetStartSample:targetStart,targetEndSample:targetStart+end-begin});
      }
      oldOffset+=oldLength;newOffset+=newLength;
    }
    if(cursor!==sourceCues.length||!coherentCues(cues,next))throw new Error('Retimed narration would cross a scene boundary.');
    const nextMetadata={...metadata,fingerprint:narrationFingerprint(nextScenes,options),alignments:nextAlignments,cues,clock:next,assembly:{version:1,method:'approved-takes',sampleRate:RATE,sourceFingerprint,sourceClock:previous,clock:next,takes}};
    for(const [name,bytes]of [['narration.wav',pcmWave(output)],['narration-timing.json',Buffer.from(JSON.stringify(nextMetadata,null,2))]]as const){
      const file=path.join(target,name);await writeFile(file,bytes,{flag:'wx',mode:0o600});created.push(file);
    }
    return{file:path.join(target,'narration.wav'),cues,voice:metadata.voice};
  }catch(error){
    await Promise.all(created.map(file=>rm(file,{force:true}).catch(()=>{})));throw error;
  }
}
