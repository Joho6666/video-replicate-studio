import {mkdir,readFile,writeFile,rename,unlink,realpath,stat,link} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const queues=new Map();
const MAX_BYTES=32*1024*1024;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function researchProblem(code,message,status=400){return Object.assign(new Error(message),{code,status,safeStatus:status});}
export const validResearchId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
const empty=()=>({schemaVersion:1,revision:0,plans:[],jobs:[],styles:[]});
function validate(value){
 if(!value||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||!['plans','jobs','styles'].every(k=>Array.isArray(value[k])))throw researchProblem('RESEARCH_STORE','研究记录损坏；原记录保留，已停止写入。',409);
 for(const [key,id] of [['plans','planId'],['jobs','jobId'],['styles','styleVersionId']]){const seen=new Set();for(const item of value[key]){if(!item||!validResearchId(item[id])||seen.has(item[id]))throw researchProblem('RESEARCH_STORE','研究记录标识损坏；已停止写入。',409);seen.add(item[id]);}}
 return value;
}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return null;try{process.kill(pid,0);return true;}catch(error){return error.code==='ESRCH'?false:true;}}
/** One private atomic store. Metadata and results stay outside the distributable package. */
export function createResearchStore({root,now=()=>new Date().toISOString()}={}){
 if(typeof root!=='string'||!root)throw new TypeError('A research data root is required');
 const rootPath=path.resolve(root),folder=path.join(rootPath,'research'),stateFile=path.join(folder,'state.json');
 async function ensure(){await mkdir(folder,{recursive:true,mode:0o700});const [base,actual]=await Promise.all([realpath(rootPath),realpath(folder)]);if(actual!==path.join(base,'research'))throw researchProblem('RESEARCH_PATH','研究目录路径不安全。',409);}
 async function readJson(file,optional=false){try{const actual=await realpath(file),base=await realpath(folder);if(path.dirname(actual)!==base)throw researchProblem('RESEARCH_PATH','研究文件路径不安全。',409);const info=await stat(actual);if(!info.isFile()||info.size>MAX_BYTES)throw researchProblem('RESEARCH_STORE','研究文件过大或格式无效。',409);return JSON.parse(await readFile(actual,'utf8'));}catch(error){if(optional&&error.code==='ENOENT')return null;if(error.code?.startsWith('RESEARCH_'))throw error;throw researchProblem('RESEARCH_STORE','研究记录无法读取；为避免重复调用，已停止。',409);}}
 async function load(){await ensure();return validate(await readJson(stateFile,true)||empty());}
 async function publishLock(file,value){const temporary=file+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});await link(temporary,file);}finally{await unlink(temporary).catch(()=>{});}}
 async function acquire(name,{waitMs=6000}={}){
  await ensure();const file=path.join(folder,name),recovery=file+'.recovery',token=randomUUID(),started=Date.now();
  while(true){try{await publishLock(file,{pid:process.pid,token,createdAt:now()});return async()=>{const current=await readJson(file,true).catch(()=>null);if(current?.token===token)await unlink(file).catch(()=>{});};}catch(error){if(error.code!=='EEXIST')throw error;
   const owner=await readJson(file,true);if(owner&&alive(owner.pid)===null)throw researchProblem('RESEARCH_LOCK','研究锁记录损坏；为避免重复调用，已停止执行。',409);if(owner&&alive(owner.pid)===false){let acquired=false;try{await writeFile(recovery,token,{mode:0o600,flag:'wx'});acquired=true;const current=await readJson(file,true);if(current?.token===owner.token&&alive(current.pid)===false){await unlink(file);continue;}}catch(error){if(error.code!=='EEXIST'&&error.code!=='ENOENT')throw error;}finally{if(acquired)await unlink(recovery).catch(()=>{});}}
   if(Date.now()-started>=waitMs)return null;await wait(25);
  }}
 }
 return {
  root:rootPath,
  read:load,
  async transaction(callback){const before=queues.get(rootPath)||Promise.resolve();const task=before.catch(()=>{}).then(async()=>{const release=await acquire('.state-lock');if(!release)throw researchProblem('RESEARCH_BUSY','研究记录正在更新，请稍后重试。',409);try{const state=await load(),result=await callback(state);state.revision++;validate(state);const raw=JSON.stringify(state,null,2)+'\n';if(Buffer.byteLength(raw)>MAX_BYTES)throw researchProblem('RESEARCH_STORE','研究记录已达到存储上限；原记录未覆盖。',409);const temporary=path.join(folder,`.state-${randomUUID()}.tmp`);try{await writeFile(temporary,raw,{mode:0o600,flag:'wx'});await rename(temporary,stateFile);}finally{await unlink(temporary).catch(()=>{});}return structuredClone(result);}finally{await release();}});queues.set(rootPath,task);try{return await task;}finally{if(queues.get(rootPath)===task)queues.delete(rootPath);}},
  async acquireExecutor(){return acquire('.executor-lock',{waitMs:0});},
  async executorActive(){await ensure();const owner=await readJson(path.join(folder,'.executor-lock'),true);if(owner&&alive(owner.pid)===null)throw researchProblem('RESEARCH_LOCK','研究锁记录损坏；为避免重复调用，已停止执行。',409);return Boolean(owner&&alive(owner.pid));}
 };
}
