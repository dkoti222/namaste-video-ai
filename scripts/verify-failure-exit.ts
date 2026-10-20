import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import {read,write,hash,runDir,exists} from '../src/pipeline/store';
const exec=promisify(execFile),id='renderer-exit-check',dir=runDir(id);
const plan=await read<any>(path.join(runDir('ram-storage-daniel-reviewed'),'plan.json'));
const env={...process.env,ELEVENLABS_API_KEY:'test-no-network',GEMINI_API_KEY:'test-no-network',BROWSER_EXECUTABLE:path.join(dir,'intentionally-missing-browser')};
const cli=(args:string[])=>exec(process.execPath,['--import','tsx','--input-type=module','-e',`globalThis.fetch=async()=>{throw Error('UNEXPECTED_PROVIDER_REQUEST')};process.argv=['node','src/cli.ts',...${JSON.stringify(args)}];await import('./src/cli.ts');`],{env,timeout:30000,maxBuffer:1024*1024});
await cli(['change-voice','--from','ram-storage-daniel-reviewed','--run',id,'--voice','daniel-test']);
await cli(['approve','--run',id,'--plan-hash',hash(plan)]);
let code:number|undefined,stderr='';
try{await cli(['generate','--run',id]);}catch(e:any){assert.equal(e.killed,false,'CLI must exit by itself, not by timeout');code=e.code;stderr=e.stderr;}
assert.equal(code,1);assert.ok(stderr.includes("path doesn't exist"));assert.ok(!stderr.includes('UNEXPECTED_PROVIDER_REQUEST'));
const m=await read<any>(path.join(dir,'manifest.json'));assert.equal(m.state,'failed');assert.deepEqual(m.speechCache,{reused:7,generated:0});assert.equal(await exists(path.join(dir,'.lock')),false);
await write(path.join(dir,'failure-exit-report.json'),{passed:true,exitedWithoutIntervention:true,exitCode:code,lockReleased:true,speechReused:7,speechGenerated:0});console.log('Renderer failure exits without intervention; cache and lock checks passed.');
