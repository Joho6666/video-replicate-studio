import {createHash} from 'node:crypto';
import {mkdir,realpath,lstat,readFile,writeFile,open,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {sameOrigin} from './request-origin.mjs';
import {MEDIA_LIMITS} from './research-media.mjs';

const run=promisify(execFile);
const digest=(jobId,recordId)=>createHash('sha256').update(jobId+'\0'+recordId).digest('hex');
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(v);
const endpoint='/api/derek-video-replicate/research/evidence';
const url=(jobId,recordId,asset)=>endpoint+'?'+new URLSearchParams({jobId,recordId,asset});
const problem=()=>Object.assign(new Error('画面证据暂不可读；没有重新采集或调用模型。'),{status:404});
async function confined(base,relative,{directory=false}={}){
 const baseReal=await realpath(base),target=path.join(baseReal,relative);let current=baseReal;
 for(const part of relative.split(path.sep)){if(!part||part==='.'||part==='..')throw problem();current=path.join(current,part);if((await lstat(current)).isSymbolicLink())throw problem();}
 const actual=await realpath(target),info=await lstat(actual);
 if(actual!==target||!(directory?info.isDirectory():info.isFile()))throw problem();return actual;
}
async function ffmpeg(){for(const p of ['/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg','/usr/bin/ffmpeg']){try{await access(p,constants.X_OK);return p;}catch{}}throw problem();}
export function evidenceTimes(measurements){
 const duration=measurements?.durationSec;if(!Number.isFinite(duration)||duration<=0||duration>MEDIA_LIMITS.durationSec)throw problem();
 const bounds=[0,...(measurements.candidateCutsSec||[]).filter(v=>Number.isFinite(v)&&v>0&&v<duration),duration].sort((a,b)=>a-b);
 const mids=bounds.slice(0,-1).map((v,i)=>(v+bounds[i+1])/2);const points=mids.length>1?mids:[duration*.1,duration*.5,duration*.9];
 return [...new Set((points.length<=12?points:Array.from({length:12},(_,i)=>points[Math.round(i*(points.length-1)/11)])).map(t=>Number(t.toFixed(3))))];
}
/** Extract small durable evidence frames; the original stays in its bounded temporary cache. */
export function createEvidenceCapture({root,runTool=run}={}){
 return async({filePath,directory,measurements,jobId,recordId})=>{
  if(!valid(jobId)||!valid(recordId))throw problem();const key=digest(jobId,recordId);
  const expected=await confined(root,path.join('research-analysis',key),{directory:true});
  if(await realpath(directory)!==expected)throw problem();
  const source=await confined(root,path.join('research-media-cache','media-'+key,'source.mp4'));
  if(await realpath(filePath)!==source)throw problem();
  const folder=path.join(expected,'evidence');await mkdir(folder,{recursive:true,mode:0o700});await confined(expected,'evidence',{directory:true});
  const binary=await ffmpeg(),frames=[];let failed=0;
  for(const [i,timeSec] of evidenceTimes(measurements).entries()){
   const asset=`frame-${String(i).padStart(2,'0')}.jpg`,target=path.join(folder,asset);
   try{try{await lstat(target);throw problem();}catch(e){if(e.code!=='ENOENT')throw e;}
    await runTool(binary,['-hide_banner','-nostdin','-v','error','-n','-threads','1','-ss',String(timeSec),'-protocol_whitelist','file,pipe','-f','mov','-i',source,'-an','-sn','-frames:v','1','-vf','scale=480:-2','-q:v','4',target],{timeout:20000,maxBuffer:1024*1024});
    const file=await confined(folder,asset),info=await lstat(file);if(info.size<=0||info.size>1024*1024)throw problem();
    frames.push({timeSec,url:url(jobId,recordId,asset)});
   }catch{failed++;}
  }
  const evidence={status:frames.length&&!failed?'available':'partial',frames,videoUrl:url(jobId,recordId,'video'),noteZh:'关键帧为原片抽样画面，按候选镜头选取，不是生成分镜。原片播放使用临时缓存；过期后不自动付费刷新。'};
  await writeFile(path.join(folder,'manifest.json'),JSON.stringify({jobId,recordId,frames}),{mode:0o600,flag:'wx'});
  return evidence;
 };
}
function rangeOf(value,size){
 if(!value)return {start:0,end:size-1,partial:false};const match=/^bytes=(\d*)-(\d*)$/.exec(value);if(!match||!match[1]&&!match[2])throw Object.assign(problem(),{status:416});
 let start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2])),end=match[1]?(match[2]?Math.min(Number(match[2]),size-1):size-1):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw Object.assign(problem(),{status:416});return {start,end,partial:true};
}
/** IDs only: never accepts a local path or an external URL. Every request rechecks visibility. */
export function createEvidenceHandler({root,research,now=()=>Date.now(),isAllowed=sameOrigin}={}){
 return async request=>{
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'};
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers});
  if(!isAllowed(request)||request.headers.get('sec-fetch-site')==='cross-site')return new Response(null,{status:403,headers});
  let handle;
  try{
   const params=new URL(request.url).searchParams,jobId=params.get('jobId'),recordId=params.get('recordId'),asset=params.get('asset');
   if(!valid(jobId)||!valid(recordId)||!(/^(?:frame-\d{2}\.jpg|video)$/.test(asset||'')))throw problem();
   const job=await research.getJob({jobId});if(!job.selectedRecordIds.includes(recordId))throw problem();
   const key=digest(jobId,recordId);let file;
   if(asset==='video'){
    const folder=await confined(root,path.join('research-media-cache','media-'+key),{directory:true});
    const manifest=JSON.parse(await readFile(await confined(folder,'cache.json'),'utf8'));
    if(manifest.owner!=='dsh-research-v1'||manifest.status==='pending'||!Number.isFinite(manifest.createdAt)||now()-manifest.createdAt>=MEDIA_LIMITS.ttlMs)throw Object.assign(problem(),{status:410});
    file=await confined(folder,'source.mp4');
   }else{
    const folder=await confined(root,path.join('research-analysis',key,'evidence'),{directory:true});
    const manifest=JSON.parse(await readFile(await confined(folder,'manifest.json'),'utf8'));
    if(manifest.jobId!==jobId||manifest.recordId!==recordId||!manifest.frames.some(f=>f.url===url(jobId,recordId,asset)))throw problem();
    file=await confined(folder,asset);
   }
   handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat(),max=asset==='video'?MEDIA_LIMITS.bytes:1024*1024;
   if(!stat.isFile()||stat.size<1||stat.size>max)throw problem();const range=rangeOf(request.headers.get('range'),stat.size);
   Object.assign(headers,{'content-type':asset==='video'?'video/mp4':'image/jpeg','accept-ranges':'bytes','content-length':String(range.end-range.start+1)});
   if(range.partial)headers['content-range']=`bytes ${range.start}-${range.end}/${stat.size}`;
   if(request.method==='HEAD'){await handle.close();handle=null;return new Response(null,{status:range.partial?206:200,headers});}
   const fileHandle=handle;handle=null;let offset=range.start,closed=false,controller;
   const close=async()=>{if(closed)return;closed=true;request.signal?.removeEventListener('abort',abort);await fileHandle.close().catch(()=>{});};
   const abort=()=>{if(closed)return;controller?.error(new Error('播放已取消'));void close();};
   const stream=new ReadableStream({
    start(value){controller=value;if(request.signal?.aborted)abort();else request.signal?.addEventListener('abort',abort,{once:true});},
    async pull(value){if(closed)return;try{const chunk=Buffer.alloc(Math.min(64*1024,range.end-offset+1));const {bytesRead}=await fileHandle.read(chunk,0,chunk.length,offset);if(closed)return;if(!bytesRead)throw problem();offset+=bytesRead;value.enqueue(new Uint8Array(chunk.buffer,chunk.byteOffset,bytesRead));if(offset>range.end){await close();value.close();}}catch(error){await close();value.error(error);}},
    async cancel(){await close();}
   });
   return new Response(stream,{status:range.partial?206:200,headers});
  }catch(error){await handle?.close().catch(()=>{});return Response.json({error:error.status===410?'原片临时缓存已过期，拆解和关键帧仍保留；未自动重新抓取。':'画面证据不可见或暂不可读。'},{status:[403,409,410,416].includes(error.status)?error.status:404,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'}});}
 };
}
