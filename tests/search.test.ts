import test from 'node:test';
import assert from 'node:assert/strict';
import {binaryTrace} from '../src/pipeline/search';
import {validatePlan} from '../src/contracts';
import {compile,syntheticSpeech} from '../src/pipeline/timing';
import fixture from '../fixtures/water-cycle.json';

test('binary search eliminates the checked midpoint and finds ten in three comparisons',()=>{
 const trace=binaryTrace([2,4,6,8,10,12,14],10);
 assert.deepEqual(trace.map(s=>s.mid),[3,5,4]);
 assert.deepEqual(trace.map(s=>[s.nextLow,s.nextHigh]),[[4,6],[4,4],[4,4]]);
 assert.equal(trace.at(-1)?.outcome,'found');
});
test('absent targets terminate with an empty candidate interval, including outside bounds',()=>{
 for(const target of [0,3,11,99]){const t=binaryTrace([2,4,6,8,10,12,14],target);assert.ok(t.at(-1)!.nextLow>t.at(-1)!.nextHigh);assert.ok(t.length<=3);}
});
test('first and last values and even-length lower midpoint are correct',()=>{
 for(const target of [2,8]){const t=binaryTrace([2,4,6,8],target);assert.equal(t[0].mid,1);assert.equal([2,4,6,8][t.at(-1)!.mid],target);}
});
test('unsorted, repeated and unreadable inputs are rejected',()=>{
 for(const values of [[4,2,6],[2,2,4],[0,1,100],[1,2]])assert.throws(()=>binaryTrace(values,2));
});
function searchPlan(){const p=structuredClone(fixture) as any;p.scenes[0]={...p.scenes[0],type:'binary-search',narration:'Check eight in the middle. Then keep the larger values.',cue:'eight',search:{values:[2,4,6,8,10,12,14],target:10,step:0,mode:'compare',decisionCue:'keep the larger values'}};return p;}
test('algorithm step and ordered narration decision cues are validated',()=>{
 const p=searchPlan();validatePlan(p);
 p.scenes[0].search.step=4;assert.throws(()=>validatePlan(p),/outside/);
 p.scenes[0].search.step=0;p.scenes[0].search.decisionCue='Check';assert.throws(()=>validatePlan(p),/follow/);
 p.scenes[0].search.mode='result';assert.throws(()=>validatePlan(p),/final/);
});
test('midpoint and elimination receive distinct frame timings from actual alignment positions',()=>{
 const p=validatePlan(searchPlan());const speech=Object.fromEntries(p.scenes.map(s=>[s.id,syntheticSpeech(s.narration)]));
 const t=compile(p,speech,true);assert.ok(t.scenes[0].decisionFrame!>t.scenes[0].cueFrame);
 assert.ok(t.scenes[0].decisionFrame!<t.scenes[0].frames);
});
