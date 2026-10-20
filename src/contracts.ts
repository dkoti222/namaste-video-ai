import {z} from 'zod';
import {binaryTrace} from './pipeline/search';
export const FPS=30;
export const voiceSchema=z.enum(['daniel-test','indian-english-male','indian-english-female']);
export type VoicePreset=z.infer<typeof voiceSchema>;
export const sceneSchema=z.object({
  id:z.string().regex(/^[a-z][a-z0-9-]{0,49}$/),
  title:z.string().min(1).max(65),
  kicker:z.string().min(1).max(35),
  narration:z.string().min(20).max(1400),
  type:z.enum(['overview','evaporation','condensation','rain','collection','flow','comparison','binary-search']),
  labels:z.array(z.string().min(1).max(30)).min(1).max(4),
  cue:z.string().min(1).max(150),
  occurrence:z.number().int().min(1).max(20).default(1),
  search:z.object({
    values:z.array(z.number().int().min(0).max(99)).min(3).max(9),
    target:z.number().int().min(0).max(99),
    step:z.number().int().min(0).max(8),
    mode:z.enum(['setup','compare','result']),
    decisionCue:z.string().min(1).max(150).optional(),
    decisionOccurrence:z.number().int().min(1).max(20).default(1),
  }).optional(),
  comparison:z.object({
    left:z.object({heading:z.string().min(1).max(18),points:z.array(z.string().min(1).max(26)).min(1).max(3)}),
    right:z.object({heading:z.string().min(1).max(18),points:z.array(z.string().min(1).max(26)).min(1).max(3)}),
  }).optional(),
});
export const planSchema=z.object({
  schemaVersion:z.literal(1),
  title:z.string().min(1).max(100),
  audience:z.string().min(1).max(200),
  voicePreset:voiceSchema,
  scenes:z.array(sceneSchema).min(3).max(10),
});
export type Plan=z.infer<typeof planSchema>;
export type Scene=z.infer<typeof sceneSchema>;
export type Alignment={characters:string[];character_start_times_seconds:number[];character_end_times_seconds:number[]};
export type Speech={alignment:Alignment;duration:number;audioFile?:string;fingerprint:string;fixture:boolean};
export type Caption={text:string;start:number;end:number};
export type TimedScene=Scene & {start:number;frames:number;cueFrame:number;decisionFrame?:number;captions:Caption[];audioFile?:string};
export type Timeline={title:string;fixture:boolean;fps:number;frames:number;scenes:TimedScene[]};
export function cueOffset(text:string,phrase:string,occurrence:number):number{
  let start=-1;
  for(let n=0;n<occurrence;n++){
    start=text.indexOf(phrase,start+1);
    if(start<0) throw new Error(`Cue not found: ${phrase} (occurrence ${occurrence})`);
  }
  return start;
}
export function validatePlan(input:unknown):Plan{
  const p=planSchema.parse(input);
  if(new Set(p.scenes.map(s=>s.id)).size!==p.scenes.length)throw new Error('Scene IDs must be unique');
  for(const s of p.scenes){
    cueOffset(s.narration,s.cue,s.occurrence);
    if(s.type==='binary-search'){
      if(!s.search)throw new Error('Binary-search scene requires search data');
      const steps=binaryTrace(s.search.values,s.search.target);
      if(s.search.mode==='setup'&&s.search.step!==0)throw new Error('Search setup must start at step zero');
      if(s.search.step>=steps.length)throw new Error('Search step is outside the computed trace');
      if(s.search.mode==='result'&&s.search.step!==steps.length-1)throw new Error('Search result must use the final trace step');
      if(s.search.mode==='compare'){
        if(!s.search.decisionCue)throw new Error('Search comparison requires a decision cue');
        const check=cueOffset(s.narration,s.cue,s.occurrence);
        const decision=cueOffset(s.narration,s.search.decisionCue,s.search.decisionOccurrence);
        if(decision<check)throw new Error('Search decision must follow the midpoint cue');
      }
    }
    if(s.type==='comparison'&&!s.comparison)throw new Error('Comparison scenes require two populated panels');
    if(s.type==='flow'&&s.labels.length<2)throw new Error('Flow scenes require at least two steps');
  }
  return p;
}
