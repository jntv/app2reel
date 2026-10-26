import {ease,type CameraTiming,type DemoLayout,type ProjectedArea} from './demo-motion.js';

/** Shared, frame-driven artwork envelopes; no wall-clock CSS transitions. */
export function demoArtworkTiming(time:number,duration:number,move:CameraTiming,first=false,last=false){
  const start=move.start+move.move*.4;
  const end=Math.min(duration-.15,move.release?move.releaseStart+.4:duration-.15);
  const window=Math.max(.01,end-start),fade=Math.min(.65,window*.35);
  const attentionOpacity=move.targetZoom>1.025?ease((time-start)/fade)*ease((end-time)/fade):0;
  return {attentionOpacity,openingOpacity:first?ease(time/.45)*(1-ease((time-1.5)/.55)):0,closingOpacity:last?ease((time-(duration-2.8))/.65):0};
}

/** Pick a side once for the whole shot so a moving region never flips its label. */
export function focusLabelAnchor(areas:readonly ProjectedArea[],layout:DemoLayout,unit:number):'above'|'below'|'left'{
  const visible=areas.filter(area=>area.visible);
  if(visible.every(area=>area.y-layout.y>=48*unit))return 'above';
  if(visible.every(area=>layout.y+layout.height-area.y-area.height>=115*unit))return 'below';
  if(visible.every(area=>area.x-layout.x>=340*unit))return 'left';
  return 'below';
}
