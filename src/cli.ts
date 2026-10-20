import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {validatePlan,voiceSchema,type Plan,type Speech,type Timeline} from './contracts';
import {compile,syntheticSpeech} from './pipeline/timing';
import {exists,hash,fileHash,read,write,runDir,locked} from './pipeline/store';
import {planVideo,synthesize,voiceId,required} from './providers';
import {probe,probePath} from './pipeline/media';
import {renderVideo} from './pipeline/render';
const {values,positionals}=parseArgs({args:process.argv.slice(2),allowPositionals:true,options:{run:{type:'string'},voice:{type:'string'},'topic-file':{type:'string'},'plan-file':{type:'string'},'plan-hash':{type:'string'},'instruction-file':{type:'string'},'stills-only':{type:'boolean'},'audio-only':{type:'boolean'},'from':{type:'string'}}});
const command=positionals[0]||'help';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
async function savePlan(dir:string,plan:Plan,fixture:boolean,parent?:string,authored=false){
 await write(path.join(dir,'plan.json'),plan);
 await write(path.join(dir,'manifest.json'),{schemaVersion:1,fixture,parent,state:'awaiting-approval',planHash:hash(plan),createdAt:new Date().toISOString()});
 await fs.writeFile(path.join(dir,'plan-review.html'),`<!doctype html><meta charset="utf-8"><title>NamasteVideo · Storyboard</title><style>body{max-width:850px;margin:60px auto;padding:24px;background:#f5f3ec;color:#153c3a;font:18px/1.6 system-ui}article{padding:28px;border:1px solid #ccd8d1;border-radius:20px;margin:20px 0;background:white}small{color:#168779}code{word-break:break-all}h1{line-height:1.1}aside{background:#e5ecdc;padding:20px;border-radius:14px}</style><small>NAMASTEVIDEO / STORYBOARD REVIEW</small><h1>${escape(plan.title)}</h1><aside>${fixture?'Authored fixture. Silent render; synthetic timing. Not live AI output.':authored?'Authored storyboard with live AI narration. Review factual content and supported visual choices before approval.':'AI draft. Review factual content and supported visual choices before approval.'}</aside><p>Voice: ${escape(plan.voicePreset)}</p>${plan.scenes.map((s,i)=>`<article><small>SCENE ${i+1} · ${escape(s.type)}</small><h2>${escape(s.title)}</h2><p>${escape(s.narration)}</p><p><b>Visual labels:</b> ${s.labels.map(escape).join(' → ')}</p>${s.comparison?`<p><b>${escape(s.comparison.left.heading)}:</b> ${s.comparison.left.points.map(escape).join(' · ')}</p><p><b>${escape(s.comparison.right.heading)}:</b> ${s.comparison.right.points.map(escape).join(' · ')}</p>`:''}${s.search?`<p><b>Search:</b> [${s.search.values.join(', ')}], target ${s.search.target}, step ${s.search.step+1}, ${escape(s.search.mode)}. Decision cue: ${escape(s.search.decisionCue||'none')}</p>`:''}<p><b>Animation cue:</b> ${escape(s.cue)}</p></article>`).join('')}<p>Approve this exact plan hash:</p><code>${hash(plan)}</code>`);
 console.log(`Review ${path.join(dir,'plan-review.html')}\nPlan hash: ${hash(plan)}`);
}
async function generate(dir:string,manifest:any){
 const plan=validatePlan(await read(path.join(dir,'plan.json')));
 const approval=await read<{planHash:string}>(path.join(dir,'approval.json'));
 if(approval.planHash!==hash(plan))throw new Error('Plan changed after approval; review and approve its current hash');
 if(!manifest.fixture){required('ELEVENLABS_API_KEY');manifest.narrator={preset:plan.voicePreset,voiceId:voiceId(plan.voicePreset),model:process.env.ELEVENLABS_MODEL||'eleven_multilingual_v2'};await write(path.join(dir,'manifest.json'),manifest);}
 const speech:Record<string,Speech>={};
 manifest.speechCache={reused:0,generated:0};
 for(const scene of plan.scenes){
  const fingerprint=hash({text:scene.narration,voice:manifest.fixture?'fixture':voiceId(plan.voicePreset),model:process.env.ELEVENLABS_MODEL||'eleven_multilingual_v2',settings:{stability:0.5,similarity_boost:0.75}});
  const cacheFile=path.join(dir,'speech',scene.id+'.json'),audio=path.join(dir,'audio',scene.id+'.mp3');
  if(await exists(cacheFile)){
   const cached=await read<Speech & {audioHash?:string}>(cacheFile);
   if(cached.fingerprint===fingerprint&&cached.fixture===manifest.fixture&&(manifest.fixture||(await exists(audio)&&cached.audioHash===await fileHash(audio)))){speech[scene.id]=cached;manifest.speechCache.reused++;}
  }
  if(!speech[scene.id]){
   manifest.speechCache.generated++;
   console.log(`Speech: ${scene.id} (${manifest.fixture?'synthetic silent fixture':'ElevenLabs'})`);
   if(manifest.fixture)speech[scene.id]={...syntheticSpeech(scene.narration),fingerprint};
   else{
    const result=await synthesize(scene.narration,plan.voicePreset);await fs.mkdir(path.dirname(audio),{recursive:true});await fs.writeFile(audio,result.audio);
    const metadata=await probe(audio);const duration=Number(metadata.format.duration);
    speech[scene.id]={alignment:result.alignment,duration,fixture:false,fingerprint,audioFile:`runs/${path.basename(dir)}/${scene.id}.mp3`};
   }
   await write(cacheFile,{...speech[scene.id],audioHash:manifest.fixture?undefined:await fileHash(audio)});
  }
  if(!manifest.fixture){speech[scene.id].audioFile=`runs/${path.basename(dir)}/${scene.id}.mp3`;const dest=path.join('public','runs',path.basename(dir),scene.id+'.mp3');await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(audio,dest);}
 }
 console.log(`Speech cache: ${manifest.speechCache.reused} reused, ${manifest.speechCache.generated} generated`);
 await write(path.join(dir,'manifest.json'),manifest);
 if(values['audio-only']){manifest.state='audio-ready';manifest.stage='speech';await write(path.join(dir,'manifest.json'),manifest);console.log(`Audio ready: ${path.join(dir,'audio')}`);return;}
 const timeline=compile(plan,speech,manifest.fixture);await write(path.join(dir,'timeline.json'),timeline);
 manifest.stage='render';await write(path.join(dir,'manifest.json'),manifest);
 await renderVideo(timeline,dir,values['stills-only']);
 manifest.state=values['stills-only']?'stills-ready':'ready-for-review';manifest.stage='complete';await write(path.join(dir,'manifest.json'),manifest);
 console.log(`Ready: ${dir}`);
}
async function main(){
 if(command==='preflight'){
  console.log(`Node ${process.version}; media probe: ${await exists(probePath())?'installed':'missing'}`);
  for(const name of ['GEMINI_API_KEY','ELEVENLABS_API_KEY','ELEVENLABS_VOICE_ID_INDIAN_MALE','ELEVENLABS_VOICE_ID_INDIAN_FEMALE'])console.log(`${name}: ${process.env[name]?.trim()?'configured (not verified)':'missing'}`);
  console.log('No network request or paid generation performed. Fixture mode needs no credentials.');return;
 }
 if(command==='help'){console.log('Commands: preflight | fixture --run ID | import-plan --run ID --plan-file FILE [--voice PRESET] | plan --run ID --topic-file FILE [--voice PRESET] | approve --run ID --plan-hash HASH | generate/resume --run ID [--stills-only] | revise --from ID --run NEW --instruction-file FILE | edit-plan --from ID --run NEW --plan-file FILE | change-voice --from ID --run NEW --voice PRESET');return;}
 if(!values.run)throw new Error('--run is required');
 const dir=runDir(values.run);
 await locked(dir,async()=>{
  if(command==='fixture'||command==='plan'||command==='import-plan'){
   if(await exists(path.join(dir,'manifest.json')))throw new Error('Run already exists; choose a new ID');
   const preset=voiceSchema.parse(values.voice||'daniel-test');
   const plan=command==='import-plan'?validatePlan({...await read<object>(values['plan-file']||''),voicePreset:preset}):command==='fixture'?validatePlan({...await read<object>('fixtures/water-cycle.json'),voicePreset:preset}):await planVideo(await fs.readFile(values['topic-file']||'','utf8'),preset);
   await savePlan(dir,plan,command==='fixture',undefined,command==='import-plan');
   if(command==='plan'){const m=await read<any>(path.join(dir,'manifest.json'));await write(path.join(dir,'manifest.json'),{...m,storyboardSource:'Gemini',plannerModel:process.env.GEMINI_MODEL||'gemini-3.5-flash'});}
   if(command==='import-plan'){const m=await read<any>(path.join(dir,'manifest.json'));await write(path.join(dir,'manifest.json'),{...m,storyboardSource:'authored-import',speechSource:'ElevenLabs'});}
   return;
  }
  if(command==='revise'||command==='change-voice'||command==='edit-plan'){
   if(!values.from)throw new Error('--from required');
   if(values.from===values.run)throw new Error('Revision must have a new run ID');
   if(await exists(path.join(dir,'manifest.json')))throw new Error('Destination exists');
   const source=runDir(values.from),old=validatePlan(await read(path.join(source,'plan.json'))),oldManifest=await read<any>(path.join(source,'manifest.json'));
   const plan=command==='edit-plan'?validatePlan(await read(values['plan-file']||'')):command==='change-voice'?validatePlan({...old,voicePreset:voiceSchema.parse(values.voice)}):await planVideo(await fs.readFile(values['instruction-file']||'','utf8'),old.voicePreset,old);
   // Copy only cache candidates. Fingerprints and audio hashes are rechecked before reuse.
   for(const folder of ['speech','audio'])if(await exists(path.join(source,folder)))await fs.cp(path.join(source,folder),path.join(dir,folder),{recursive:true});
   await savePlan(dir,plan,oldManifest.fixture,values.from,command==='edit-plan');
   const next=await read<any>(path.join(dir,'manifest.json'));await write(path.join(dir,'manifest.json'),{...next,storyboardSource:command==='revise'?'Gemini':command==='edit-plan'?'operator-revision':oldManifest.storyboardSource,plannerModel:command==='revise'?(process.env.GEMINI_MODEL||'gemini-3.5-flash'):oldManifest.plannerModel});return;
  }
  const manifest=await read<any>(path.join(dir,'manifest.json'));
  if(command==='approve'){
   const plan=validatePlan(await read(path.join(dir,'plan.json')));
   if(values['plan-hash']!==hash(plan))throw new Error('Approval hash does not match current plan');
   await write(path.join(dir,'approval.json'),{planHash:hash(plan),at:new Date().toISOString(),actor:'local-operator'});
   await write(path.join(dir,'manifest.json'),{...manifest,state:'approved',planHash:hash(plan)});console.log('Approved exact plan version.');return;
  }
  if(command==='generate'||command==='resume'){
   try{delete manifest.error;manifest.state='running';manifest.stage='speech';await write(path.join(dir,'manifest.json'),manifest);await generate(dir,manifest);}
   catch(e){manifest.state='failed';manifest.error=e instanceof Error?e.message:'Unknown error';await write(path.join(dir,'manifest.json'),manifest);throw e;}
   return;
  }
  throw new Error(`Unknown command ${command}`);
 });
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exit(1);});
