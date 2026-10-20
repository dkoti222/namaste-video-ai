import path from 'node:path';
import fs from 'node:fs/promises';
import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import type {Timeline} from '../contracts';
import {probe} from './media';
import {write} from './store';
export async function renderVideo(timeline:Timeline,dir:string,stillsOnly=false){
 const serveUrl=await bundle({entryPoint:path.resolve('src/video/index.tsx'),publicDir:path.resolve('public')});
 const browserExecutable=process.env.BROWSER_EXECUTABLE||undefined;
 const inputProps={timeline};
 const composition=await selectComposition({serveUrl,id:'Explainer',inputProps,browserExecutable});
 await fs.mkdir(path.join(dir,'preview-frames'),{recursive:true});
 for(let i=0;i<timeline.scenes.length;i++){
  const scene=timeline.scenes[i];
  await renderStill({serveUrl,composition,inputProps,browserExecutable,frame:scene.start+Math.min(scene.frames-1,scene.cueFrame+35),output:path.join(dir,'preview-frames',`${scene.id}.png`)});
 }
 if(stillsOnly)return;
 let bucket=-1;
 const temp=path.join(dir,'output.partial.mp4');
 await renderMedia({serveUrl,composition,inputProps,browserExecutable,codec:'h264',audioCodec:'aac',outputLocation:temp,concurrency:2,crf:23,onProgress:({progress})=>{const n=Math.floor(progress*10);if(n!==bucket){bucket=n;console.log(`Rendering ${n*10}%`);}}});
 await validateOutput(timeline,dir);
}
export async function validateOutput(timeline:Timeline,dir:string){
 const temp=path.join(dir,'output.partial.mp4');
 const metadata=await probe(temp),video=metadata.streams.find(s=>s.codec_type==='video');
 const duration=Number(metadata.format.duration);
 const audio=metadata.streams.some(s=>s.codec_type==='audio');
 const checks={dimensions:video?.width===1080&&video.height===1920,duration:duration>=60&&duration<=90,frameRate:video?.avg_frame_rate==='30/1',videoCodec:video?.codec_name==='h264',audio:timeline.fixture||audio};
 const passed=Object.values(checks).every(Boolean);
 await write(path.join(dir,'qa.json'),{fixture:timeline.fixture,passed,checks,duration,metadata,humanReview:'pending',voiceAndSyncEvaluation:timeline.fixture?'not tested: silent synthetic fixture':'pending human review'});
 if(!passed)throw new Error('Media checks failed; see qa.json');
 await fs.rename(temp,path.join(dir,'output.mp4'));
}
