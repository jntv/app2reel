import test from 'node:test';
import assert from 'node:assert/strict';
import {demoArtworkTiming,focusLabelAnchor} from '../server/demo-artwork.js';
import {demoLayout} from '../server/demo-motion.js';
import {subtitleOpacityAt} from '../server/subtitles.js';

test('detail artwork settles gently and is gone before the next page, with no wide-shot flash',()=>{
  const move={start:1,move:2.6,duration:9,targetZoom:2,release:1.8,releaseStart:6.7,releaseEnd:8.5,exitHold:.5};
  const values=Array.from({length:270},(_,frame)=>demoArtworkTiming(frame/30,9,move).attentionOpacity);
  assert.equal(values[0],0);assert.ok(values[150]>.99);assert.equal(values[240],0);
  assert.ok(Math.max(...values.slice(1).map((value,index)=>Math.abs(value-values[index])))<.11,'A box must fade over many frames, not disappear in three.');
  assert.equal(demoArtworkTiming(8,9,{...move,targetZoom:1}).attentionOpacity,0,'An overview must not flash a box just before a context/detail cut.');
  assert.ok(demoArtworkTiming(1,9,move,true).openingOpacity>.99);
  assert.ok(demoArtworkTiming(8.7,9,move,false,true).closingOpacity>.99);
});

test('a toolbar label stays below throughout a move instead of flipping across the outlined controls',()=>{
  const layout=demoLayout(1920,1080),areas=[{x:1100,y:90,width:600,height:160,visible:true},{x:950,y:42,width:850,height:230,visible:true}];
  assert.equal(focusLabelAnchor(areas,layout,1),'below');
});

test('subtitle panels fade at phrase edges while word highlighting leaves their envelope unchanged',()=>{
  const cues=[{start:1,end:3,text:'Find your next conversation',words:['Find','your','next','conversation'],wordStarts:[1,1.4,1.9,2.4]}];
  assert.equal(subtitleOpacityAt(cues,.9),0);assert.equal(subtitleOpacityAt(cues,1),0);
  assert.ok(subtitleOpacityAt(cues,1.05)>0&&subtitleOpacityAt(cues,1.05)<1);
  for(const word of cues[0].wordStarts.slice(1))assert.equal(subtitleOpacityAt(cues,word),1);
  assert.ok(subtitleOpacityAt(cues,2.95)>0&&subtitleOpacityAt(cues,2.95)<1);
  assert.equal(subtitleOpacityAt(cues,3),0);
});
