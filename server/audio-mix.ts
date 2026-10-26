import path from 'node:path';
import type {OutputKind,RenderSettings} from '../shared/types.js';
import {DEFAULT_RENDER_SETTINGS} from '../shared/types.js';
import {writeBrandMusic} from './brand-music.js';

type RunEncoder=(args:string[],signal?:AbortSignal)=>Promise<void>;
export interface FilmAudioOptions {
  video:string; output:string; temporary:string; duration:number; kind:OutputKind;
  settings:Pick<RenderSettings,'backgroundMusic'|'musicVolume'>;
  narration?:string; runEncoder:RunEncoder; signal?:AbortSignal;
}

/** Original speech is the sidechain key; only music is attenuated by speech. */
export function filmAudioFilter(duration:number,volume:number,narrated:boolean,music:boolean):string {
  if(!Number.isFinite(duration)||duration<=0||duration>180||!Number.isFinite(volume)||volume<0||volume>.5)throw new Error('Invalid film audio settings.');
  const finish=`alimiter=limit=0.94:level=0:latency=1,atrim=duration=${duration},asetpts=PTS-STARTPTS[audio]`;
  if(narrated&&music)return [
    `[1:a]aresample=48000,apad,atrim=duration=${duration},asetpts=PTS-STARTPTS,asplit=2[speech][key]`,
    '[speech]pan=stereo|c0=0.70710678*c0|c1=0.70710678*c0[voice]',
    `[2:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${volume}[music]`,
    '[music][key]sidechaincompress=threshold=0.12:ratio=2.5:attack=40:release=650:knee=2.828:makeup=1:detection=rms[bed]',
    `[voice][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,${finish}`,
  ].join(';');
  if(narrated)return `[1:a]aresample=48000,apad,atrim=duration=${duration},pan=stereo|c0=0.70710678*c0|c1=0.70710678*c0,${finish}`;
  return `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${music?volume:0},${finish}`;
}

/** Replaces audio while copying every encoded picture packet unchanged. */
export async function mixFilmAudio(options:FilmAudioOptions):Promise<void> {
  const {video,output,temporary,duration,kind,narration,runEncoder,signal}=options;
  if(signal?.aborted)throw new Error('Audio update cancelled.');
  const volume=options.settings.musicVolume??DEFAULT_RENDER_SETTINGS.musicVolume!;
  const music=options.settings.backgroundMusic!==false&&volume>0;
  const filter=filmAudioFilter(duration,volume,!!narration,music);
  const args=['-i',video];
  if(narration)args.push('-i',narration);
  if(music){
    const score=path.join(temporary,`${kind}-music.wav`);
    await writeBrandMusic(score,duration,kind,{signal});
    args.push('-i',score);
  }else if(!narration)args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
  await runEncoder([...args,'-filter_complex',filter,'-map','0:v:0','-map','[audio]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t',String(duration),'-movflags','+faststart',output],signal);
}
