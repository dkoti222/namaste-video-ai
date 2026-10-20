import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {hash,fileHash,read,write,runDir,exists} from '../src/pipeline/store';
import {validatePlan} from '../src/contracts';
const exec=promisify(execFile);
const source=runDir('ram-storage-daniel-reviewed'),id='ram-storage-recovery',dest=runDir(id);
if(await exists(path.join(dest,'manifest.json')))throw Error('Recovery run already exists; inspect its report instead of overwriting it');
const original=await fileHash(path.join(source,'output.mp4'));
const plan=validatePlan(await read(path.join(source,'plan.json')));
plan.scenes[0].title='RAM works. Storage remembers.';
await fs.mkdir(dest,{recursive:true});await write(path.join(dest,'edited-plan.json'),plan);
async function cli(args:string[],browser?:string){
 // Any unexpected provider request fails the check. Real keys are not passed to the child.
 const code=`globalThis.fetch=async()=>{throw new Error('UNEXPECTED_PROVIDER_REQUEST')};process.argv=['node','src/cli.ts',...${JSON.stringify(args)}];await import('./src/cli.ts');`;
 const env={...process.env,ELEVENLABS_API_KEY:'test-no-network',GEMINI_API_KEY:'test-no-network',BROWSER_EXECUTABLE:browser||''};
 return exec(process.execPath,['--import','tsx','--input-type=module','-e',code],{env,maxBuffer:2*1024*1024});
}
await cli(['edit-plan','--from','ram-storage-daniel-reviewed','--run',id,'--plan-file',path.join(dest,'edited-plan.json')]);
await cli(['approve','--run',id,'--plan-hash',hash(plan)]);
let failure='';
try{await cli(['generate','--run',id],path.join(dest,'intentionally-missing-browser'));throw Error('Expected renderer failure did not occur');}
catch(e:any){failure=String(e.stderr||e.message);if(failure.includes('UNEXPECTED_PROVIDER_REQUEST'))throw e;}
const failed=await read<any>(path.join(dest,'manifest.json'));
assert.equal(failed.state,'failed');assert.equal(failed.stage,'render');
assert.deepEqual(failed.speechCache,{reused:plan.scenes.length,generated:0});
assert.equal(await exists(path.join(dest,'.lock')),false);
console.log('Injected render failure recorded; all narration reused; lock released. Resuming real render.');
await cli(['resume','--run',id]);
const complete=await read<any>(path.join(dest,'manifest.json'));
assert.equal(complete.state,'ready-for-review');assert.deepEqual(complete.speechCache,{reused:plan.scenes.length,generated:0});
assert.equal(await fileHash(path.join(source,'output.mp4')),original);
assert.equal(await exists(path.join(dest,'.lock')),false);
const qa=await read<any>(path.join(dest,'qa.json'));assert.equal(qa.passed,true);
await write(path.join(dest,'recovery-report.json'),{passed:true,source:'ram-storage-daniel-reviewed',revision:'First scene title only',failureInjected:'Missing local browser executable',failedStateRecorded:true,lockReleased:true,resumedTo:'ready-for-review',speechReused:plan.scenes.length,speechGenerated:0,providerCalls:0,sourceExportUnchanged:true,outputChecks:qa.checks});
console.log('Recovery and visual-only revision checks passed. Report: '+path.join(dest,'recovery-report.json'));
