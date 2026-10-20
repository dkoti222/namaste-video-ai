import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const exec=promisify(execFile);
export function probePath(){return path.resolve(`node_modules/@remotion/compositor-${process.platform}-${process.arch}/ffprobe`);}
export async function probe(file:string){
 const {stdout}=await exec(probePath(),['-v','error','-show_streams','-show_format','-of','json',path.resolve(file)],{cwd:path.dirname(probePath())});
 return JSON.parse(stdout) as {format:{duration:string};streams:Array<{codec_type:string;codec_name:string;width?:number;height?:number;avg_frame_rate?:string}>};
}
