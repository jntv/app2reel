import {rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Scene} from '../shared/types.js';
import {cursorAt, type CursorPoint} from './cursor-detection.js';

export interface DemoEditCut {start:number;end:number;at:number;frames:number;scene:number;}
export interface DemoEditPlan<T extends Scene> {scenes:T[];cuts:DemoEditCut[];}
type RunEncoder=(args:string[],signal?:AbortSignal)=>Promise<void>;
const check=(signal?:AbortSignal)=>{if(signal?.aborted)throw new Error('Video rendering cancelled.');};

/** Whole-frame source schedule. Reviewed cuts never change the film/voice clock. */
export function demoEditPlan<T extends Scene>(scenes:readonly T[],fps:number):DemoEditPlan<T>|undefined {
  if(!Number.isInteger(fps)||fps<1||fps>60)throw new Error('Invalid demo edit frame rate.');
  if(!scenes.some(scene=>scene.recordingRanges!==undefined))return undefined;
  const cuts:DemoEditCut[]=[];let frame=0;
  const edited=scenes.map((scene,index)=>{
    const start=scene.recordingStart,end=scene.recordingEnd;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start!<0||end!<=start!)throw new Error('Every edited demo scene needs a reviewed source interval.');
    const ranges=scene.recordingRanges??[{start:start!,end:end!}];
    if(!ranges.length||ranges.length>6)throw new Error('A demo scene needs between one and six reviewed cuts.');
    const first=frame;
    let previous=start!;
    for(const range of ranges){
      if(!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<previous||range.start<start!||range.end>end!||range.end<=range.start)throw new Error('Reviewed demo cuts must be ordered and stay inside the source interval.');
      const frames=Math.round((range.end-range.start)*fps);
      if(frames<1)throw new Error('Each reviewed demo cut must contain at least one frame.');
      cuts.push({...range,at:frame/fps,frames,scene:index});frame+=frames;previous=range.end;
    }
    const {recordingRanges:_,...rest}=scene;
    return {...rest,recordingStart:first/fps,recordingEnd:frame/fps} as T;
  });
  return {scenes:edited,cuts};
}

/** Keep real events only, and prevent interpolation across removed source time. */
export function remapDemoCursor(track:readonly CursorPoint[],cuts:readonly DemoEditCut[],fps:number):CursorPoint[] {
  const original=track.filter(point=>Number.isFinite(point.at)&&Number.isFinite(point.x)&&Number.isFinite(point.y)).map(point=>({...point})).sort((a,b)=>a.at-b.at);
  if(!original.length)return [];
  const mapped:CursorPoint[]=[];
  for(const cut of cuts){
    const duration=cut.frames/fps;
    const first=cursorAt(original,cut.start,Infinity);
    if(first)mapped.push({at:cut.at,x:first.x,y:first.y,kind:'move'});
    for(const point of original){
      if(point.at<cut.start)continue;
      if(point.at>=cut.end||point.at-cut.start>=duration)break;
      mapped.push({...point,at:cut.at+point.at-cut.start});
    }
    const last=cursorAt(original,Math.min(cut.end,cut.start+duration)-1e-7,Infinity);
    if(last)mapped.push({at:cut.at+duration-1e-7,x:last.x,y:last.y,kind:'move'});
  }
  return mapped.sort((a,b)=>a.at-b.at);
}

/**
 * Build one render-private lossless recording when reviewed cuts remove waits.
 * Both footage and orange-ring analysis consume this exact 30fps source. Source
 * filenames come only from the renderer; API-provided cuts contain times only.
 */
export async function prepareDemoEdit<T extends Scene>(recording:string,scenes:readonly T[],track:readonly CursorPoint[],temporary:string,fps:number,runEncoder:RunEncoder,signal?:AbortSignal):Promise<{recording:string;scenes:T[];track:CursorPoint[];normalized:boolean}> {
  check(signal);
  const plan=demoEditPlan(scenes,fps);
  if(!plan)return {recording,scenes:[...scenes],track:[...track],normalized:false};
  if(!path.isAbsolute(recording)||!path.isAbsolute(temporary))throw new Error('Demo edits require local recording and temporary paths.');
  const files=plan.cuts.map((_,index)=>path.join(temporary,`demo-cut-${index}.mkv`));
  const list=path.join(temporary,'demo-edits.txt'),edited=path.join(temporary,'demo-edited.mkv');
  let complete=false;
  try{
    for(let index=0;index<plan.cuts.length;index++){
      check(signal);const cut=plan.cuts[index],duration=cut.frames/fps;
      // Normalize after the same accurate input seek used by the renderer. Pad
      // only fractional-frame tails, then trim by frame count, not timestamps.
      await runEncoder(['-ss',String(cut.start),'-t',String(cut.end-cut.start),'-i',recording,'-map','0:v:0','-an','-vf',`setpts=PTS-STARTPTS,fps=${fps}:start_time=0,tpad=stop_mode=clone:stop_duration=${duration},trim=end_frame=${cut.frames},setpts=N/(${fps}*TB)`, '-frames:v',String(cut.frames),'-c:v','ffv1','-level','3','-g','1','-pix_fmt','yuv420p','-r',String(fps),files[index]],signal);
    }
    check(signal);
    await writeFile(list,files.map((_,index)=>`file 'demo-cut-${index}.mkv'`).join('\n'),'utf8');
    await runEncoder(['-f','concat','-safe','1','-i',list,'-map','0:v:0','-an','-c:v','copy',edited],signal);
    check(signal);complete=true;
    return {recording:edited,scenes:plan.scenes,track:remapDemoCursor(track,plan.cuts,fps),normalized:true};
  }finally{
    await Promise.all([...files,list,...(complete?[]:[edited])].map(file=>rm(file,{force:true})));
  }
}
