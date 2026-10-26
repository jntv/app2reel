export interface RenderedClip {
  start:number;
  sourceDuration:number;
  playbackRate:number;
  frames:number;
  /** Exact exclusive frame interval in a recording normalized to the render fps. */
  sourceFrameRange?:{start:number;end:number};
}

/** Footage and pixel-based cursor analysis must display this identical clock. */
export function renderedClipClock(clip:RenderedClip,fps:number):{seek:string[];filter:string;usableFrames:number}{
  if(!Number.isInteger(fps)||fps<1||fps>60||!Number.isFinite(clip.start)||clip.start<0||!Number.isFinite(clip.sourceDuration)||clip.sourceDuration<=0||!Number.isFinite(clip.playbackRate)||clip.playbackRate<1||clip.playbackRate>1.12+1e-7||!Number.isInteger(clip.frames)||clip.frames<1)throw new Error('Invalid rendered clip clock.');
  let prefix='',seek=['-ss',String(clip.start),'-t',String(clip.sourceDuration)];
  if(clip.sourceFrameRange){
    const {start,end}=clip.sourceFrameRange;
    if(!Number.isInteger(start)||start<0||!Number.isInteger(end)||end<=start)throw new Error('Invalid normalized source frame interval.');
    // Matroska rounds PTS to milliseconds: a timestamp seek can skip the first
    // retained frame and admit the next scene. Decode and select exact indices.
    const last=Math.min(end,start+Math.max(1,Math.ceil(clip.sourceDuration*fps-1e-7)));
    prefix=`trim=start_frame=${start}:end_frame=${last},`;
    seek=[];
  }
  const usableFrames=Math.min(clip.frames,Math.max(1,Math.round(clip.sourceDuration/clip.playbackRate*fps)));
  const retime=`setpts=(PTS-STARTPTS)/${clip.playbackRate.toFixed(8)},fps=${fps}`;
  // Native recordings can have a fractional first presentation timestamp. Keep
  // their verified display/hold schedule; exact frame bounds apply to normalized edits.
  const filter=clip.sourceFrameRange
    ?`${prefix}${retime},trim=end_frame=${usableFrames},tpad=stop_mode=clone:stop_duration=${clip.frames/fps},trim=end_frame=${clip.frames},setpts=N/(${fps}*TB)`
    :`${retime},tpad=stop_mode=clone:stop_duration=${clip.frames/fps},trim=duration=${clip.frames/fps}`;
  return {seek,filter,usableFrames};
}
