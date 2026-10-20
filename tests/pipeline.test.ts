import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fixture from '../fixtures/water-cycle.json';
import {validatePlan,cueOffset} from '../src/contracts';
import {compile,syntheticSpeech,validateAlignment,makeCaptions} from '../src/pipeline/timing';
import {hash,locked,runDir} from '../src/pipeline/store';
const plan=validatePlan(fixture);
const speeches=()=>Object.fromEntries(plan.scenes.map(s=>[s.id,syntheticSpeech(s.narration)]));
test('fixture compiles to contiguous 70-second timeline with bounded captions and semantic cues',()=>{
 const t=compile(plan,speeches(),true);assert.equal(t.frames,2100);assert.equal(t.fixture,true);
 let end=0;for(const s of t.scenes){assert.equal(s.start,end);end+=s.frames;assert.ok(s.cueFrame<s.frames);for(const c of s.captions){assert.ok(c.start>=0&&c.end<=s.frames);assert.ok(c.end>c.start);assert.ok(c.text.length<=54);}}
});
test('rejects duplicate scene IDs',()=>{const p=structuredClone(fixture);p.scenes[1].id=p.scenes[0].id;assert.throws(()=>validatePlan(p),/unique/);});
test('resolves explicit repeated cue occurrence and rejects missing occurrence',()=>{assert.equal(cueOffset('rain then rain','rain',2),10);assert.throws(()=>cueOffset('rain','rain',2),/not found/);});
test('rejects unsupported scene components',()=>{assert.throws(()=>validatePlan({...fixture,scenes:fixture.scenes.map(s=>({...s,type:'run-script'}))}));});
test('rejects nonmonotonic, nonfinite and unequal alignment data',()=>{
 for(const mutate of [(a:any)=>a.character_start_times_seconds.pop(),(a:any)=>a.character_start_times_seconds[2]=-1,(a:any)=>a.character_end_times_seconds[1]=NaN]){const a=syntheticSpeech('hello world').alignment;mutate(a);assert.throws(()=>validateAlignment(a,9.7),/alignment|Alignment/);}
});
test('does not pretend normalization mismatches have accurate timings',()=>{const s=speeches();s[plan.scenes[0].id].alignment.characters[0]='X';assert.throws(()=>compile(plan,s,true),/differs/);});
test('rejects missing speech and mixed fixture/live input',()=>{const s=speeches();delete s[plan.scenes[0].id];assert.throws(()=>compile(plan,s,true),/Missing/);const other=speeches();other[plan.scenes[0].id].fixture=false;assert.throws(()=>compile(plan,other,true),/mix/);});
test('rejects out of range output instead of padding with filler',()=>{const s=Object.fromEntries(plan.scenes.map(x=>[x.id,syntheticSpeech(x.narration,3)]));assert.throws(()=>compile(plan,s,true),/outside/);});
test('Unicode caption indices and punctuation preserve approved text',()=>{const a=syntheticSpeech('Rain 🌧 falls. It’s water.').alignment;const c=makeCaptions(a);assert.equal(c.map(x=>x.text).join(' '),'Rain 🌧 falls. It’s water.');assert.ok(c[1].start>=c[0].end);});
test('approval hash changes when narration, voice, or layout changes',()=>{for(const p of [{...plan,voicePreset:'indian-english-male'},{...plan,title:'New title'}])assert.notEqual(hash(p),hash(plan));});
test('run paths reject traversal',()=>{for(const id of ['../secrets','a/b','','..'])assert.throws(()=>runDir(id),/Invalid/);});
test('exclusive writer lock rejects overlap and releases after failures',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'namaste-test-'));
 try{await locked(dir,async()=>{await assert.rejects(locked(dir,async()=>{}),/locked/);});await assert.rejects(locked(dir,async()=>{throw new Error('intentional');}),/intentional/);await locked(dir,async()=>{});}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('comparison panels accept bounded data and reject overflowing labels',()=>{
 const p=structuredClone(fixture) as any;
 p.scenes[0].type='comparison';
 p.scenes[0].comparison={left:{heading:'RAM',points:['Active work','Temporary']},right:{heading:'Storage',points:['Saved files','Persistent']}};
 assert.equal(validatePlan(p).scenes[0].comparison?.left.heading,'RAM');
 p.scenes[0].comparison.left.points[0]='A'.repeat(27);
 assert.throws(()=>validatePlan(p));
});

test('rejects incomplete comparison and flow diagrams before spending on narration',()=>{
 const p=structuredClone(fixture);p.scenes[0].type='comparison';
 assert.throws(()=>validatePlan(p),/two populated panels/);
 p.scenes[0].type='flow';p.scenes[0].labels=['Only one step'];
 assert.throws(()=>validatePlan(p),/at least two steps/);
});
