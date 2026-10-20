import test from 'node:test';
import assert from 'node:assert/strict';
import {interactionText,voiceId} from '../src/providers';
import {validatePlan} from '../src/contracts';
import fixture from '../fixtures/water-cycle.json';

test('Gemini parser selects only completed model text, excluding reasoning and tool output',()=>{
 const data={status:'completed',steps:[{type:'thought',content:[{type:'text',text:'private reasoning'}]},{type:'tool_result',content:[{type:'text',text:'not the plan'}]},{type:'model_output',content:[{type:'text',text:'{"ok":'},{type:'text',text:'true}'}]}]};
 assert.equal(interactionText(data),'{"ok":true}');
 assert.throws(()=>interactionText({...data,status:'failed'}),/did not complete/);
 assert.throws(()=>interactionText({status:'completed',steps:[]}),/did not return/);
});
test('Daniel test preset does not depend on or overwrite either Indian voice setting',()=>{
 const male=process.env.ELEVENLABS_VOICE_ID_INDIAN_MALE,female=process.env.ELEVENLABS_VOICE_ID_INDIAN_FEMALE;
 assert.equal(voiceId('daniel-test'),'onwK4e9ZLuTAKqWW03F9');
 assert.equal(process.env.ELEVENLABS_VOICE_ID_INDIAN_MALE,male);
 assert.equal(process.env.ELEVENLABS_VOICE_ID_INDIAN_FEMALE,female);
 assert.equal(validatePlan({...fixture,voicePreset:'daniel-test'}).voicePreset,'daniel-test');
});

test('general topic planning restricts the visual catalog and rejects incompatible output',async(t)=>{
 const {planVideo}=await import('../src/providers');
 const original=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-only-key';
 let request:any;
 t.mock.method(globalThis,'fetch',async(_url:any,options:any)=>{
  request=JSON.parse(options.body);
  return new Response(JSON.stringify({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(fixture)}]}]}),{status:200});
 });
 try{
  await assert.rejects(planVideo('Explain RAM versus storage','daniel-test'),/incompatible visual/);
  assert.deepEqual(request.response_format.schema.properties.scenes.items.properties.type.enum,['flow','comparison']);
  assert.equal(request.store,false);
 }finally{if(original===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=original;}
});
