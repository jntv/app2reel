import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
import {chromium} from 'playwright';
import {renderedClipClock} from '../server/clip-clock.js';
import {detectOrangeCursor,extractRenderedCursorFrames} from '../server/cursor-detection.js';
import {renderVideos} from '../server/render.js';
import type {Project,Scene} from '../shared/types.js';

const execute=promisify(execFile);
const width=960,height=540,bytes=width*height*3;
const framesBefore=41,retained=26,after=30;
const clip={start:framesBefore/30,sourceDuration:retained/30,playbackRate:1,frames:36,sourceFrameRange:{start:framesBefore,end:framesBefore+retained}};

test('a normalized clip selects an exclusive source frame range and caps real frames before holding',()=>{
  const clock=renderedClipClock(clip,30);
  assert.deepEqual(clock.seek,[]);assert.equal(clock.usableFrames,26);
  assert.match(clock.filter,/^trim=start_frame=41:end_frame=67,setpts=/);
  assert.match(clock.filter,/fps=30,trim=end_frame=26,tpad=.*trim=end_frame=36/);
  assert.deepEqual(renderedClipClock({...clip,sourceFrameRange:undefined},30).seek,['-ss',String(clip.start),'-t',String(clip.sourceDuration)]);
  for(const range of [{start:-1,end:2},{start:0,end:0},{start:.5,end:2}])assert.throws(()=>renderedClipClock({...clip,sourceFrameRange:range},30),/source frame interval/);
});

async function fixture(file:string,codec:'ffv1'|'libx264'){
  const child=spawn(ffmpeg!,['-v','error','-nostdin','-y','-f','rawvideo','-pix_fmt','rgb24','-s',`${width}x${height}`,'-framerate','30','-i','pipe:0','-an','-c:v',codec,...(codec==='libx264'?['-preset','ultrafast','-crf','10']:[]),'-pix_fmt','yuv420p',file],{stdio:['pipe','ignore','pipe']});
  let error='';child.stderr.on('data',chunk=>error+=chunk);
  const done=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(error)));});
  for(let frame=0;frame<framesBefore+retained+after;frame++){
    const middle=frame>=framesBefore&&frame<framesBefore+retained,color=frame<framesBefore?[180,20,20]:middle?[20,170,20]:[20,20,180],pixels=Buffer.alloc(bytes);
    for(let offset=0;offset<bytes;offset+=3)pixels.set(color,offset);
    const x=middle?Math.round((.2+(frame-framesBefore)*.018)*width):Math.round(.85*width),y=middle?216:378;
    for(let py=y-6;py<=y+6;py++)for(let px=x-6;px<=x+6;px++){const radius=Math.hypot(px-x,py-y);if(radius>=4&&radius<=6)pixels.set([251,107,56],(py*width+px)*3);}
    if(!child.stdin.write(pixels))await new Promise<void>(resolve=>child.stdin.once('drain',resolve));
  }
  child.stdin.end();await done;
}

test('a held 26-frame Matroska scene never clones the following modal and its cursor uses the same exact frames',{skip:!ffmpeg},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-clip-clock-'));
  try{
    const source=path.join(directory,'normalized.mkv');await fixture(source,'ffv1');
    const clock=renderedClipClock(clip,30);
    const decoded=await execute(ffmpeg!,['-v','error',...clock.seek,'-i',source,'-vf',`${clock.filter},scale=${width}:${height}`,'-frames:v','36','-fps_mode','passthrough','-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:bytes*40});
    assert.equal(decoded.stdout.length,36*bytes);
    const cursors=await extractRenderedCursorFrames(source,[clip],30);
    for(let frame=0;frame<36;frame++){
      const pixels=decoded.stdout.subarray(frame*bytes,(frame+1)*bytes),middle=(100*width+480)*3;
      const [red,green,blue]=pixels.subarray(middle,middle+3);
      assert.ok(green>red*3&&green>blue*3,`The following blue modal leaked into held frame${frame}.`);
      const actual=detectOrangeCursor(pixels,width,height),observed=cursors[0][frame];
      assert.ok(actual&&observed,`Missing actual pointer in frame${frame}.`);
      assert.ok(Math.hypot(actual.x-observed.x,actual.y-observed.y)*width<1.5);
      assert.ok(Math.abs(observed.x-(.2+Math.min(frame,25)*.018))*width<2.5,`Wrong source pointer in frame${frame}.`);
    }
    assert.deepEqual(cursors[0][35]&&{x:cursors[0][35]!.x,y:cursors[0][35]!.y},cursors[0][25]&&{x:cursors[0][25]!.x,y:cursors[0][25]!.y},'Hold the final retained pointer, never the next scene pointer.');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('the full demo renderer preserves a short middle view through its hold and changes only on the next reviewed cut',{skip:!ffmpeg||!existsSync(chromium.executablePath()),timeout:60000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-clip-render-'));
  try{
    await fixture(path.join(directory,'capture.mp4'),'libx264');
    const boundaries=[0,framesBefore/30,(framesBefore+retained)/30,(framesBefore+retained+after)/30];
    const scenes:Scene[]=Array.from({length:3},(_,index)=>({id:`scene-${index}`,title:'Observed view',caption:'',narration:'',duration:1.2,recordingStart:boundaries[index],recordingEnd:boundaries[index+1],recordingRanges:[{start:boundaries[index],end:boundaries[index+1]}],focus:{x:.5,y:.5,zoom:1},transition:{type:'cut',duration:0}}));
    const project:Project={id:'clip-fixture',brief:{name:'Fixture',url:'https://example.test',description:'Recorded views',purpose:'Verify source cuts',actors:'Teams',features:['Observed'],brandColor:'#00a0d0',duration:10,resolution:'720p',maxSteps:3,allowedOrigins:[],allowWrites:false,sample:true},createdAt:'',updatedAt:'',stage:'review',progress:0,message:'',logs:[],sources:[],findings:[],shots:[],scenes,outputs:[],recording:'capture.mp4',renderSettings:{motion:'cinematic',subtitles:false,cursorHighlights:true,narration:false}};
    const [output]=await renderVideos(project,directory,['demo']);assert.equal(output.duration,3.6);
    const decoded=await execute(ffmpeg!,['-v','error','-i',path.join(directory,'demo.mp4'),'-vf','scale=160:90','-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:160*90*3*110});
    const pixelsPerFrame=160*90*3;assert.equal(decoded.stdout.length,pixelsPerFrame*108);
    for(let frame=36;frame<72;frame++){
      const offset=frame*pixelsPerFrame+(45*160+80)*3,[red,green,blue]=decoded.stdout.subarray(offset,offset+3);
      assert.ok(green>red*3&&green>blue*3,`The following view leaked into actual encoded film frame${frame}.`);
    }
    const offset=72*pixelsPerFrame+(45*160+80)*3;assert.ok(decoded.stdout[offset+2]>decoded.stdout[offset+1]*3,'The modal begins exactly on the next reviewed cut.');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('an opaque branded intro becoming transparent cannot restart the source cut clock',{skip:!ffmpeg||!existsSync(chromium.executablePath()),timeout:60000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'capture-intro-source-clock-'));
  try{
    await fixture(path.join(directory,'capture.mkv'),'ffv1');
    const retainedSeconds=12/30;
    const starts=[framesBefore/30,(framesBefore+retained)/30];
    const scenes:Scene[]=starts.map((start,index)=>({id:`scene-${index}`,title:'Observed view',caption:'',narration:'',duration:index===0?4:1.2,recordingStart:start,recordingEnd:start+retainedSeconds,recordingRanges:[{start,end:start+retainedSeconds}],focus:{x:.5,y:.5,zoom:1},transition:{type:'cut',duration:0}}));
    const project:Project={id:'intro-clock-fixture',brief:{name:'Fixture',url:'https://example.test',description:'Recorded views',purpose:'Verify source cuts',actors:'Teams',features:['Observed'],brandColor:'#00a0d0',duration:10,resolution:'720p',maxSteps:3,allowedOrigins:[],allowWrites:false,sample:true},createdAt:'',updatedAt:'',stage:'review',progress:0,message:'',logs:[],sources:[],findings:[],shots:[],scenes,outputs:[],recording:'capture.mkv',renderSettings:{motion:'cinematic',subtitles:false,cursorHighlights:false,narration:false,backgroundMusic:false,bookends:true}};
    const [output]=await renderVideos(project,directory,['demo']);
    assert.equal(output.duration,5.2);
    const decoded=await execute(ffmpeg!,['-v','error','-i',path.join(directory,output.file),'-vf','scale=160:90','-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:160*90*3*160});
    const pixelsPerFrame=160*90*3;
    assert.equal(decoded.stdout.length,pixelsPerFrame*156,'The branded intro must not change the reviewed film clock.');
    // The intro is fully opaque before dissolving away at two seconds. Those
    // screenshots have different alpha needs, but must stay one encoder format.
    const first=decoded.stdout.subarray((45*160+80)*3,(45*160+80)*3+3);
    assert.ok(!(first[1]>first[0]*3&&first[1]>first[2]*3),'The opening should cover the product before its reveal.');
    for(let frame=66;frame<156;frame++){
      const offset=frame*pixelsPerFrame+(45*160+80)*3,[red,green,blue]=decoded.stdout.subarray(offset,offset+3);
      if(frame<120)assert.ok(green>red*3&&green>blue*3,`The blue next scene leaked into held green frame${frame} after the intro dissolved.`);
      else assert.ok(blue>red*3&&blue>green*3,`The blue scene must begin on reviewed frame120, not drift at frame${frame}.`);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
