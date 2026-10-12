import {mkdir,readFile,realpath,rename,writeFile,unlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const validAnalysisRecordId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,90}$/.test(value);
export function analysisProblem(code,message,status=400){return Object.assign(new Error(message),{code,safeStatus:status});}
const within=(base,target)=>target.startsWith(base+path.sep);
export async function confinedFile(root,file){
 const base=await realpath(root),target=await realpath(path.resolve(base,file));
 if(!within(base,target)||(await stat(target)).isDirectory())throw analysisProblem('ANALYSIS_PATH','本机证据路径无效。',404);
 return target;
}
export async function readAnalysisJson(file,maxBytes=8*1024*1024){const info=await stat(file);if(!info.isFile()||info.size>maxBytes)throw analysisProblem('ANALYSIS_STORE','本机分析记录无法读取。',409);return JSON.parse(await readFile(file,'utf8'));}
export function createAnalysisStore({root,now=()=>new Date().toISOString()}={}){
 async function directory(recordId,create=false){
  if(!validAnalysisRecordId(recordId))throw analysisProblem('ANALYSIS_ID','记录标识无效。');
  const rootReal=await realpath(root),base=path.join(rootReal,'analysis');
  if(create)await mkdir(base,{recursive:true,mode:0o700});
  const baseReal=await realpath(base);if(!within(rootReal,baseReal)||baseReal!==base)throw analysisProblem('ANALYSIS_PATH','分析存储目录无效。',409);
  const dir=path.join(baseReal,createHash('sha256').update(recordId).digest('hex').slice(0,24));
  if(create)await mkdir(dir,{recursive:true,mode:0o700});
  const dirReal=await realpath(dir);if(!within(baseReal,dirReal)||dirReal!==dir)throw analysisProblem('ANALYSIS_PATH','分析存储目录无效。',409);return dirReal;
 }
 return {
  directory,
  async read(recordId){try{const dir=await directory(recordId),file=await confinedFile(dir,'state.json'),value=await readAnalysisJson(file);if(value.recordId!==recordId||!['running','completed','failed'].includes(value.status))throw Error();return value;}catch(error){if(error.code==='ENOENT')return null;if(error.safeStatus)throw error;throw analysisProblem('ANALYSIS_STORE','分析记录无法读取；为避免重复调用，已停止。',409);}},
  async write(recordId,value){const dir=await directory(recordId,true),file=path.join(dir,'state.json'),tmp=path.join(dir,randomUUID()+'.tmp');await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});await rename(tmp,file);return value;},
  async lock(recordId){const dir=await directory(recordId,true),file=path.join(dir,'request.lock'),token=randomUUID();try{await writeFile(file,JSON.stringify({pid:process.pid,token,createdAt:now()}),{flag:'wx',mode:0o600});}catch(error){if(error.code==='EEXIST')return null;throw error;}return async()=>{try{const lock=await readAnalysisJson(await confinedFile(dir,'request.lock'),4096);if(lock.token===token)await unlink(file);}catch{}};},
  async interrupted(recordId){try{const dir=await directory(recordId),lock=await readAnalysisJson(await confinedFile(dir,'request.lock'),4096);if(!Number.isSafeInteger(lock.pid)||lock.pid<=0)return true;try{process.kill(lock.pid,0);return false;}catch(error){return error.code==='ESRCH';}}catch(error){return error.code==='ENOENT';}}
 };
}
