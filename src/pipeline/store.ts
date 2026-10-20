import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
export const ROOT=path.resolve('runs');
export const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const fileHash=async(file:string)=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
export function runDir(id:string){if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/.test(id))throw new Error('Invalid run ID');return path.join(ROOT,id);}
export async function read<T>(file:string):Promise<T>{return JSON.parse(await fs.readFile(file,'utf8'));}
export async function write(file:string,value:unknown){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2));await fs.rename(temp,file);}
export async function exists(file:string){try{await fs.access(file);return true;}catch{return false;}}
export async function locked<T>(dir:string,fn:()=>Promise<T>):Promise<T>{
  const lock=path.join(dir,'.lock');await fs.mkdir(dir,{recursive:true});
  let handle;try{handle=await fs.open(lock,'wx');}catch{throw new Error('Run is already locked. If a previous process crashed, verify it stopped before removing .lock.');}
  await handle.writeFile(String(process.pid));
  try{return await fn();}finally{await handle.close();await fs.unlink(lock);}
}
