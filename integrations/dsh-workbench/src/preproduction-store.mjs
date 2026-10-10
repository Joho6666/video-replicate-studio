import {sameOrigin} from './request-origin.mjs';
import {readFile,realpath,mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
const BASE='/api/derek-video-replicate/preproduction';
export const defaultDataRoot=()=>path.join(os.homedir(),'Documents','DSH-Workbenches','data');
const json=(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
const safeId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,90}$/.test(v);
const validUsername=v=>typeof v==='string'&&/^[a-zA-Z0-9_][a-zA-Z0-9_.]{0,29}$/.test(v);
const fail=(message,status=404)=>{throw Object.assign(new Error(message),{status});};
export function createPreproductionHandlers({root=defaultDataRoot(),history}={}){
 async function runFile(run,file){
  if(!safeId(run))fail('报告标识无效',400);
  const rootReal=await realpath(root),base=await realpath(path.join(rootReal,run));
  if(!base.startsWith(rootReal+path.sep))fail('报告目录不可用');
  const target=await realpath(path.join(base,file));
  if(!target.startsWith(base+path.sep))fail('证据文件不可用');return target;
 }
 async function rawReport(run){const report=JSON.parse(await readFile(await runFile(run,'report.json'),'utf8'));if(report.runId&&report.runId!==run)fail('报告标识不匹配',409);return {...report,runId:run};}
 async function visibility(run,includeHidden){
  if(!history)return null;
  const snapshot=await history.snapshot({view:'all'});
  if(!Array.isArray(snapshot?.records))fail('历史状态不可读取',503);
  const refs=new Map();for(const record of snapshot.records){for(const ref of record.reportRefs||[]){if(ref.runId!==run)continue;const existing=refs.get(ref.videoId);const state={hidden:record.hidden===true,trashed:!!record.trashedAt};refs.set(ref.videoId,existing?{hidden:existing.hidden||state.hidden,trashed:existing.trashed||state.trashed}:state);}}
  return {allowed:videoId=>{const state=refs.get(videoId);return !!state&&!state.trashed&&(includeHidden||!state.hidden);},refs};
 }
 async function visibleReport(run,includeHidden=false){
  const report=await rawReport(run),visibilityState=await visibility(run,includeHidden);
  if(!visibilityState)return {...report,includeHidden:false};
  const all=Array.isArray(report.videos)?report.videos:[],videos=all.filter(v=>visibilityState.allowed(v.id));
  if(!videos.length)fail('这份报告没有当前可展示的记录；隐藏内容可在已隐藏列表查看，回收站记录需先还原。');
  const excluded=all.length-videos.length;
  if(!excluded)return {...report,includeHidden};
  // Aggregate prose and style recommendations can cite any sample. Suppress the
  // entire aggregate when one sample is unavailable instead of leaking its title.
  return {schemaVersion:report.schemaVersion||1,runId:run,account:report.account,title:'已归档拆解 · 当前可见记录',summary:'部分参考已收起。这里只展示当前可见的视频；整组总结和风格推荐暂不显示，恢复相关记录后可再查看。',methodLabel:'本机已保存的逐条证据；未重新采集、分析或生成。',createdAt:report.createdAt,totalDuration:videos.reduce((sum,v)=>sum+(Number(v.duration)||0),0),spentEstimateUSD:null,videos,styles:[],includeHidden,visibility:{restricted:true,excludedCount:excluded},limitations:['部分参考已隐藏、移入回收站或无法关联历史记录，整组结论与风格推荐已收起。','当前视图仅展示可见记录，测量时长按可见视频重新汇总。'],execution:'not-started'};
 }
 async function localFile(run,file,includeHidden){
  if(typeof file!=='string'||!/^([a-zA-Z0-9_-]{1,90})\/(source\.mp4|(?:thumbnails|contact-sheets)\/[\w-]+\.(?:jpg|jpeg|png))$/.test(file))fail('证据路径无效');
  const videoId=file.split('/')[0],state=await visibility(run,includeHidden);if(state&&!state.allowed(videoId))fail('证据已收起或不属于可见历史记录');
  return runFile(run,file);
 }
 return {
  async report(request){try{
   const params=new URL(request.url).searchParams,username=params.get('username'),explicitRun=params.get('run');
   if(username&&!validUsername(username))return json({error:'账号格式不正确'},400);
   if(explicitRun&&!safeId(explicitRun))return json({error:'报告标识无效'},400);
   if(!username&&!explicitRun)return json({error:'请提供账号或报告标识'},400);
   let run=explicitRun;if(!run){const index=JSON.parse(await readFile(path.join(root,'index.json'),'utf8'));run=index.accounts?.[username.toLowerCase()];if(!safeId(run))return json({error:'此账号还没有本机拆解报告'},404);}
   const report=await visibleReport(run,params.get('includeHidden')==='1');
   if(username&&report.account?.username?.toLowerCase()!==username.toLowerCase())return json({error:'报告账号不匹配'},409);return json(report);
  }catch(err){return json({error:err.status?err.message:'尚无可读取的本机报告'},err.status||404);}},
  async evidence(request){try{
   const u=new URL(request.url),run=u.searchParams.get('run'),file=u.searchParams.get('file');
   const target=await localFile(run,file,u.searchParams.get('includeHidden')==='1');const buffer=await readFile(target);const type=file.endsWith('.mp4')?'video/mp4':file.endsWith('.png')?'image/png':'image/jpeg';
   const headers={'content-type':type,'cache-control':'no-store','accept-ranges':'bytes','x-content-type-options':'nosniff'};const range=request.headers.get('range');
   if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m)return new Response(null,{status:416,headers:{...headers,'content-range':`bytes */${buffer.length}`}});const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),buffer.length-1):buffer.length-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=buffer.length)return new Response(null,{status:416,headers:{...headers,'content-range':`bytes */${buffer.length}`}});return new Response(buffer.subarray(start,end+1),{status:206,headers:{...headers,'content-range':`bytes ${start}-${end}/${buffer.length}`,'content-length':String(end-start+1)}});}
   return new Response(buffer,{headers:{...headers,'content-length':String(buffer.length)}});
  }catch{return json({error:'证据文件不可用'},404);}},
  async saveStyle(request){
   if(request.headers.get('x-derek-workbench')!=='1')return json({error:'请求来源校验失败'},403);
   if(!sameOrigin(request))return json({error:'不允许跨站请求'},403);
   try{const text=await request.text();if(text.length>2048)return json({error:'请求过大'},413);const {runId,styleId}=JSON.parse(text);if(!safeId(runId)||!safeId(styleId))return json({error:'风格标识无效'},400);
    const report=await visibleReport(runId);const style=report.styles?.find(x=>x.id===styleId);if(!style)return json({error:'风格不存在或参考已收起；请先恢复相关记录后收藏。'},404);
    const saved={schemaVersion:1,templateId:`${runId}-${styleId}`,version:1,status:'draft-unconfirmed',savedAt:new Date().toISOString(),sourceReport:runId,account:report.account,style,execution:'not-started'};
    const folder=path.join(root,'style-library');await mkdir(folder,{recursive:true});const target=path.join(folder,saved.templateId+'.json');try{const existing=JSON.parse(await readFile(target,'utf8'));return json({saved:true,templateId:existing.templateId,status:existing.status,existing:true});}catch(e){if(e.code!=='ENOENT')throw e;}
    const temporary=target+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(saved,null,2),{mode:0o600});await rename(temporary,target);return json({saved:true,templateId:saved.templateId,status:saved.status});
   }catch(err){return json({error:err.status?err.message:'风格草稿保存失败'},err.status||500);}
  }
 };
}
export function applyPreproductionStore(ctx,options={}){const h=createPreproductionHandlers(options);for(const [route,method,handler] of [['report','GET',h.report],['evidence','GET',h.evidence],['style','POST',h.saveStyle]])ctx.connection.fetch.register({path:BASE+'/'+route,methods:[method],requestBody:'buffered',fetch:handler});}
