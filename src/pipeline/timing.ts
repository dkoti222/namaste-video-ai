import {FPS,cueOffset,type Alignment,type Speech,type Plan,type Timeline,type Caption} from '../contracts';
export function validateAlignment(a:Alignment,duration:number){
  if(!Number.isFinite(duration)||duration<=0)throw new Error('Invalid audio duration');
  const n=a.characters?.length;
  if(!n||n!==a.character_start_times_seconds?.length||n!==a.character_end_times_seconds?.length)throw new Error('Alignment arrays must be nonempty and equal length');
  let last=-1;
  for(let i=0;i<n;i++){
    const start=a.character_start_times_seconds[i],end=a.character_end_times_seconds[i];
    if(typeof a.characters[i]!=='string'||!a.characters[i].length||!Number.isFinite(start)||!Number.isFinite(end)||start<0||start<last||end<start||end>duration+0.15)throw new Error(`Invalid alignment at character ${i}`);
    last=start;
  }
}
export function makeCaptions(a:Alignment):Caption[]{
  const text=a.characters.join('');
  // Map UTF-16 string offsets to provider alignment indices (provider may use code points).
  const offsets:number[]=[];let offset=0;
  a.characters.forEach((c,i)=>{for(let n=0;n<c.length;n++)offsets[offset++]=i;});
  const words=[...text.matchAll(/\S+/g)].map(m=>({text:m[0],start:a.character_start_times_seconds[offsets[m.index!]],end:a.character_end_times_seconds[offsets[m.index!+m[0].length-1]]}));
  const result:Caption[]=[];let group:typeof words=[];
  const flush=()=>{if(group.length){result.push({text:group.map(w=>w.text).join(' '),start:Math.floor(group[0].start*FPS),end:Math.max(Math.floor(group[0].start*FPS)+1,Math.ceil(group.at(-1)!.end*FPS))});group=[];}};
  for(const w of words){
    if(w.text.length>30)throw new Error('Caption contains an unsupported long token');
    if(group.length&&(group.map(x=>x.text).join(' ').length+w.text.length+1>54||w.end-group[0].start>3.4))flush();
    group.push(w);if(/[.!?;]$/.test(w.text))flush();
  }
  flush();
  for(let i=0;i<result.length-1;i++)result[i].end=Math.min(result[i].end,result[i+1].start);
  return result;
}
export function compile(plan:Plan,speech:Record<string,Speech>,fixture:boolean):Timeline{
  let frame=0;
  const scenes=plan.scenes.map(scene=>{
    const s=speech[scene.id];if(!s)throw new Error(`Missing speech: ${scene.id}`);
    if(s.fixture!==fixture)throw new Error('Cannot mix fixture and live speech');
    validateAlignment(s.alignment,s.duration);
    const text=s.alignment.characters.join('');
    // Fail closed until an explicitly tested normalization mapper is available.
    if(text!==scene.narration)throw new Error(`Alignment text differs from approved narration in ${scene.id}; normalization mapping requires review`);
    const charOffset=cueOffset(text,scene.cue,scene.occurrence);
    let utf16=0,index=0;
    while(utf16<charOffset){utf16+=s.alignment.characters[index++].length;}
    let decisionFrame:number|undefined;
    if(scene.search?.decisionCue){
      const offset=cueOffset(text,scene.search.decisionCue,scene.search.decisionOccurrence);
      let pos=0,idx=0;while(pos<offset)pos+=s.alignment.characters[idx++].length;
      decisionFrame=Math.floor(s.alignment.character_start_times_seconds[idx]*FPS);
    }
    const frames=Math.ceil((s.duration+0.3)*FPS);
    const result={...scene,start:frame,frames,cueFrame:Math.floor(s.alignment.character_start_times_seconds[index]*FPS),decisionFrame,captions:makeCaptions(s.alignment),audioFile:s.audioFile};
    frame+=frames;return result;
  });
  if(frame<1800||frame>2700)throw new Error(`Duration ${(frame/FPS).toFixed(1)}s is outside 60–90s; revise and reapprove narration`);
  return {title:plan.title,fixture,fps:FPS,frames:frame,scenes};
}
export function syntheticSpeech(text:string,duration=9.7):Speech{
  const characters=Array.from(text),step=(duration-0.4)/characters.length;
  return {duration,fixture:true,fingerprint:'synthetic',alignment:{characters,character_start_times_seconds:characters.map((_,i)=>0.2+i*step),character_end_times_seconds:characters.map((_,i)=>0.2+(i+1)*step)}};
}
