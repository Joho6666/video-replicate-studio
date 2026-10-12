import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink,realpath,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import {validateAccountReport} from './account-core.mjs';

const SCHEMA=1, queues=new Map();
const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const now=()=>new Date().toISOString();
const copy=v=>structuredClone(v);
const hash=v=>createHash('sha256').update(v).digest('hex').slice(0,24);
const text=(v,max=1000)=>typeof v==='string'?v.trim().slice(0,max):'';
const numeric=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const timestamp=v=>typeof v==='string'&&!Number.isNaN(Date.parse(v))?new Date(v).toISOString():null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fail(message,status=400,code='HISTORY_INVALID'){throw Object.assign(new Error(message),{status,code});}
function accountValue(value){
 if(value?.platform==='Douyin'){
  const secUid=typeof value.secUid==='string'?value.secUid.trim():typeof value.username==='string'?value.username.trim():'';
  // secUid is case-sensitive and longer than an Instagram username. Validate
  // before normalizing; truncation would merge unrelated source accounts.
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(secUid))fail('抖音账号 secUid 无效，请提供完整主页链接。');
  if(value.url){let u;try{u=new URL(value.url);}catch{fail('抖音账号主页链接无效。');}if(u.protocol!=='https:'||u.username||u.password||u.port||!['www.douyin.com','douyin.com'].includes(u.hostname)||u.pathname.replace(/\/$/,'')!==`/user/${secUid}`)fail('抖音账号主页与 secUid 不一致，请提供完整主页链接。');}
  const displayName=text(value.displayName,120);
  return {platform:'Douyin',secUid,username:secUid,...(displayName?{displayName}:{}),url:`https://www.douyin.com/user/${secUid}`};
 }
 if(value?.platform!==undefined&&value.platform!=='Instagram')fail('账号平台暂不支持。');
 const username=text(value?.username,30).toLowerCase();
 if(!/^[A-Za-z0-9_][A-Za-z0-9_.]{0,29}$/.test(username))fail('账号标识格式无效。');
 return {username,url:`https://www.instagram.com/${username}/`};
}
// Keep every existing Instagram cache key unchanged. Only the added platform
// uses a prefix; do not migrate old state or re-key old batches and topics.
const accountCacheKey=account=>account?.platform==='Douyin'?`douyin:${account.secUid}`:account?.username||'';
export function canonicalHistoryUrl(value){
 let u;try{u=new URL(value);}catch{fail('视频来源链接无效。');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^(localhost|127\.|0\.|\[|10\.|192\.168\.)/.test(u.hostname))fail('视频来源必须是公开 HTTPS 页面链接。');
 const hostname=u.hostname.toLowerCase().replace(/^www\./,'');
 if(hostname==='instagram.com'||hostname==='m.instagram.com'){
  const match=/^\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{1,80})\/?$/.exec(u.pathname);
  if(!match)fail('需要单条 Instagram 视频链接。');
  return {url:`https://www.instagram.com/reel/${match[1]}/`,key:`instagram:${match[1]}`,id:`ig_${match[1]}`};
 }
 // Retain known semantic IDs; never persist tracking or signed-media query strings.
 if(/(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/.test(hostname))fail('请保存来源页面，而不是临时媒体下载地址。');
 const query=(hostname==='youtube.com'&&u.searchParams.get('v'))?'?v='+encodeURIComponent(u.searchParams.get('v')):'';
 const canonical=`https://${hostname}${u.pathname.replace(/\/+$/,'')||'/'}${query}`;
 return {url:canonical,key:canonical,id:'url_'+hash(canonical)};
}
function cleanSample(sample,account,collectedAt){
 if(!isObject(sample))fail('视频元数据格式无效。');
 const canonical=canonicalHistoryUrl(sample.url??sample.sourceUrl);
 return {id:canonical.id,url:canonical.url,title:text(sample.title,1000),duration:numeric(sample.duration),likes:numeric(sample.likes),views:numeric(sample.views),publishedAt:timestamp(sample.publishedAt),collectedAt,sourceAccount:account?.url||null,ownerVerified:sample.ownerVerified===true,status:'metadata-only'};
}
function emptyState(){return{schemaVersion:SCHEMA,revision:0,records:[],topics:[],batches:[],reviews:[],caches:{},legacyRuns:[],styleRefs:[],importedReports:[],accountStates:{}};}
function defaultTopic(state,record){
 const douyin=record.account?.platform==='Douyin',username=douyin?accountCacheKey(record.account):text(record.account?.username,30).toLowerCase(),id=username?'brand_'+hash(username):'topic_unassigned';
 let topic=state.topics.find(t=>t.id===id);
 if(!topic){const title=douyin?(text(record.account.displayName,120)||`抖音账号 ${record.account.secUid.slice(0,12)}${record.account.secUid.length>12?'…':''}`):username||'未分组参考';topic={id,title,kind:username?'brand':'topic',automatic:true,recordIds:[],createdAt:now(),updatedAt:now()};state.topics.push(topic);}
 if(!topic.recordIds.includes(record.id)){topic.recordIds.push(record.id);topic.updatedAt=now();}
}
function upgradeTopics(state){
 let changed=false;
 // Only a state without topics needs automatic grouping. Later moves must survive reloads and reimports.
 if(state.topics===undefined){state.topics=[];for(const record of state.records)defaultTopic(state,record);changed=true;}
 for(const record of state.records){
  if(record.account===undefined){record.account=null;changed=true;}
  if(record.originalTitle===undefined){record.originalTitle=text(record.title,1000);changed=true;}
 }
 return changed;
}
function topicForView(topic,records){
 const members=records.filter(r=>topic.recordIds.includes(r.id));
 return {...topic,recordIds:members.map(r=>r.id),recordCount:members.length,counts:{total:members.length,reviewed:members.filter(r=>r.reviewed).length,favorite:members.filter(r=>r.favorite).length}};
}
function topicTitle(value){if(typeof value!=='string'||!value.trim()||value.length>120)fail('专题名称需要 1–120 个字符。');return value.trim();}
function validateState(v){
 if(!isObject(v)||v.schemaVersion!==SCHEMA||!Number.isSafeInteger(v.revision)||v.revision<0||!Array.isArray(v.records)||!Array.isArray(v.batches)||!Array.isArray(v.reviews)||!isObject(v.caches)||!Array.isArray(v.legacyRuns)||!Array.isArray(v.styleRefs))fail('历史状态文件损坏；已停止写入并保留原文件。',409,'HISTORY_CORRUPT');
 if(v.importedReports===undefined)v.importedReports=[];if(v.accountStates===undefined)v.accountStates={};
 if(!Array.isArray(v.importedReports)||!isObject(v.accountStates))fail('导入历史结构损坏；已停止写入。',409,'HISTORY_CORRUPT');
 const ids=new Set();
 for(const r of v.records){
  if(!isObject(r)||typeof r.id!=='string'||ids.has(r.id)||typeof r.url!=='string'||r.account!=null&&!isObject(r.account)||!Array.isArray(r.reportRefs)||!Array.isArray(r.feedback)||!Array.isArray(r.tags)||typeof r.hidden!=='boolean'||typeof r.reviewed!=='boolean'||typeof r.favorite!=='boolean')fail('历史记录结构损坏；已停止写入并保留原文件。',409,'HISTORY_CORRUPT');
  try{if(canonicalHistoryUrl(r.url).id!==r.id)throw Error();}catch{fail('历史来源标识损坏；已停止写入。',409,'HISTORY_CORRUPT');}ids.add(r.id);
 }
 if(v.topics!==undefined){
  if(!Array.isArray(v.topics))fail('专题结构损坏；已停止写入。',409,'HISTORY_CORRUPT');
  const topicIds=new Set();for(const t of v.topics){
   if(!isObject(t)||!safeId(t.id)||topicIds.has(t.id)||typeof t.title!=='string'||!t.title.trim()||t.title.length>120||!['brand','topic'].includes(t.kind)||typeof t.automatic!=='boolean'||!Array.isArray(t.recordIds)||new Set(t.recordIds).size!==t.recordIds.length||t.recordIds.some(id=>!ids.has(id)))fail('专题引用损坏；已停止写入。',409,'HISTORY_CORRUPT');
   topicIds.add(t.id);
  }
 }
 return v;
}
function countsOf(records){const active=records.filter(r=>!r.hidden&&!r.trashedAt);return{total:records.length,active:active.length,hidden:records.filter(r=>r.hidden&&!r.trashedAt).length,trash:records.filter(r=>r.trashedAt).length,reviewed:active.filter(r=>r.reviewed).length,favorite:active.filter(r=>r.favorite).length};}
function isActive(r){return !r.hidden&&!r.trashedAt;}
function reviewSummary(review,state){return{id:review.id,periodStart:review.periodStart,periodEnd:review.periodEnd,createdAt:review.createdAt,kind:review.kind,recordCount:review.recordIds.length,feedbackCount:review.feedbackIds.length,sourceRevision:review.sourceRevision,restricted:review.recordIds.some(id=>!state.records.some(r=>r.id===id&&isActive(r)))};}

export function createHistoryStore({root}={}){
 if(typeof root!=='string'||!root)throw new TypeError('createHistoryStore requires a data root');
 const rootPath=path.resolve(root),folder=path.join(rootPath,'library'),stateFile=path.join(folder,'state.json'),lockFile=path.join(folder,'.state-lock');
 let initialized=false;
 async function ensureFolder(){await mkdir(folder,{recursive:true,mode:0o700});const [base,actual]=await Promise.all([realpath(rootPath),realpath(folder)]);if(!actual.startsWith(base+path.sep))fail('历史目录不在数据目录内。',409,'HISTORY_UNSAFE_PATH');}
 async function safeRead(target,{optional=false}={}){
  try{const [base,actual]=await Promise.all([realpath(rootPath),realpath(target)]);if(!actual.startsWith(base+path.sep))fail('本机数据路径不安全。',409,'HISTORY_UNSAFE_PATH');const s=await stat(actual);if(!s.isFile()||s.size>16*1024*1024)fail('本机数据文件过大或格式无效。',409);return await readFile(actual,'utf8');}catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
 }
 async function readJson(target,{optional=false,kind='历史'}={}){const raw=await safeRead(target,{optional});if(raw===null)return null;try{return JSON.parse(raw);}catch{fail(`${kind}文件损坏；原文件保持不变。`,409,'HISTORY_CORRUPT');}}
 async function load(){const value=await readJson(stateFile,{optional:true});return value===null?emptyState():validateState(value);}
 async function lock(){
  const token=randomUUID(),started=Date.now();
  while(true){try{await writeFile(lockFile,JSON.stringify({pid:process.pid,token,createdAt:now()}),{flag:'wx',mode:0o600});return async()=>{try{const current=JSON.parse(await readFile(lockFile,'utf8'));if(current.token===token)await unlink(lockFile);}catch{}};}catch(error){if(error.code!=='EEXIST')throw error;
    // Recover only a provably dead process lock; live writers are never pre-empted.
    try{const owner=JSON.parse(await readFile(lockFile,'utf8'));if(Number.isSafeInteger(owner.pid)&&owner.pid>0){try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH'){
     // A separate recovery lock prevents two stale-lock recoverers removing a new live lock.
     const recovery=lockFile+'.recovery';let acquired=false,recovered=false;try{await writeFile(recovery,token,{flag:'wx',mode:0o600});acquired=true;const current=JSON.parse(await readFile(lockFile,'utf8'));if(current.token===owner.token){try{process.kill(current.pid,0);}catch(dead){if(dead.code==='ESRCH'){await unlink(lockFile);recovered=true;}}}}catch{}finally{if(acquired)await unlink(recovery).catch(()=>{});}if(recovered)continue;
    }}}}catch{}
    if(Date.now()-started>6000)fail('历史资料正在由另一个进程更新，请稍后重试。',409,'HISTORY_BUSY');await sleep(30);
   }}
 }
 async function write(state){validateState(state);const temporary=path.join(folder,`.state-${randomUUID()}.tmp`);try{await writeFile(temporary,JSON.stringify(state,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,stateFile);}finally{await unlink(temporary).catch(()=>{});}}
 async function serial(fn){
  const previous=queues.get(rootPath)||Promise.resolve();const task=previous.catch(()=>{}).then(async()=>{await ensureFolder();const release=await lock();try{return await fn();}finally{await release();}});queues.set(rootPath,task);try{return await task;}finally{if(queues.get(rootPath)===task)queues.delete(rootPath);}
 }
 async function mediaExists(runId,file){
  if(!safeId(runId)||typeof file!=='string'||!/^[A-Za-z0-9_-]{1,90}\/source\.(?:mp4|mov|webm)$/.test(file))return false;
  try{const base=await realpath(path.join(rootPath,runId)),actual=await realpath(path.join(rootPath,runId,file));const rootReal=await realpath(rootPath);return base.startsWith(rootReal+path.sep)&&actual.startsWith(base+path.sep)&&(await stat(actual)).isFile();}catch{return false;}
 }
 async function reportEntries(runId,expectedAccount){
  if(expectedAccount.platform==='Douyin')fail('旧版本地拆解报告关联仅支持 Instagram；抖音研究结果请由当前研究流程保存。');
  if(!safeId(runId))fail('拆解报告标识无效。');const report=await readJson(path.join(rootPath,runId,'report.json'),{optional:true,kind:'旧版报告'});if(!report)return[];
  if(report.account?.username?.toLowerCase()!==expectedAccount.username)fail('拆解报告账号与历史批次不一致。',409);
  const out=[];for(const video of Array.isArray(report.videos)?report.videos:[]){try{const c=canonicalHistoryUrl(video.sourceUrl);if(!safeId(video.id))continue;out.push({id:c.id,url:c.url,videoId:video.id,runId,title:text(video.title),duration:numeric(video.duration),mediaAvailable:await mediaExists(runId,video.file)});}catch(error){if(error.code==='HISTORY_INVALID')continue;throw error;}}
  return out;
 }
 function addRecords(state,payload,options,reportRows=[]){
  const account=payload.account==null?null:accountValue(payload.account),collectedAt=timestamp(payload.collectedAt)||now(),provider=text(payload.provider,80)||'local',kind=options.kind||'collection';
  if(!['collection','legacy','metadata-import','report'].includes(kind))fail('历史批次类型不支持。');
  if(!Array.isArray(payload.samples)||payload.samples.length>1000)fail('采集样本列表无效或过大。');
  if(payload.status==='failed'||payload.error||payload.success===false)fail('失败的采集不能覆盖成功缓存。',409);
  const byId=new Map();for(const sample of payload.samples){const normalized=cleanSample(sample,account,collectedAt);if(!byId.has(normalized.id))byId.set(normalized.id,normalized);}const normalized=[...byId.values()];
  const reportById=new Map(reportRows.map(x=>[x.id,x]));let addedCount=0;
  for(const sample of normalized){
   let record=state.records.find(r=>r.id===sample.id);const existing=Boolean(record);
   if(!record){record={id:sample.id,url:sample.url,account,title:sample.title,originalTitle:sample.title,notes:'',tags:[],reviewed:false,favorite:false,hidden:false,trashedAt:null,createdAt:now(),updatedAt:now(),collectedAt,reportRefs:[],importedReportIds:[],mediaAvailable:false,views:null,likes:null,duration:null,publishedAt:null,feedback:[],status:{metadata:'collected',download:'missing',analysis:'pending'}};state.records.push(record);defaultTopic(state,record);addedCount++;}
   // Metadata refresh does not undo user edits or organization choices.
   if(!existing||!record.title)record.title=sample.title;
   if(!record.originalTitle&&sample.title)record.originalTitle=sample.title;
   for(const field of ['views','likes','duration','publishedAt'])if(sample[field]!==null)record[field]=sample[field];
   record.collectedAt=collectedAt;record.updatedAt=now();
   const report=reportById.get(sample.id);if(report){if(!record.reportRefs.some(r=>r.runId===report.runId&&r.videoId===report.videoId))record.reportRefs.push({runId:report.runId,videoId:report.videoId});record.mediaAvailable=record.mediaAvailable||report.mediaAvailable;record.status.analysis='available';if(record.duration===null&&report.duration!==null)record.duration=report.duration;}
   record.status.download=record.mediaAvailable?'available':'missing';
  }
  const recordIds=normalized.map(s=>s.id);const accountKey=accountCacheKey(account),signature=hash(JSON.stringify([kind,accountKey||null,collectedAt,options.runId||null,recordIds]));
  let batch=state.batches.find(b=>b.signature===signature);
  if(!batch){batch={id:'batch_'+randomUUID(),signature,account,provider,collectedAt,createdAt:now(),kind,runId:options.runId||null,recordIds,addedCount,duplicateCount:recordIds.length-addedCount,status:'complete',cached:false};state.batches.push(batch);}
  if(account&&['collection','legacy'].includes(kind)&&payload.cached!==true){const old=state.caches[accountKey];if(!old||collectedAt>=old.collectedAt)state.caches[accountKey]={account,samples:normalized.map(({id,...s})=>s),collectedAt,provider,status:'metadata-only',hasMore:payload.hasMore===true,excludedOtherOwners:numeric(payload.excludedOtherOwners)||0,batchId:batch.id};}
  return {batchId:batch.id,addedCount,duplicateCount:recordIds.length-addedCount,records:state.records.filter(r=>recordIds.includes(r.id)),cached:payload.cached===true};
 }
 async function migrate(state){
  let changed=upgradeTopics(state);const index=await readJson(path.join(rootPath,'index.json'),{optional:true,kind:'旧版索引'});
  for(const [username,runId] of Object.entries(isObject(index?.accounts)?index.accounts:{})){
   if(!safeId(runId)||state.legacyRuns.includes(runId))continue;let account;try{account=accountValue({username});}catch{continue;}
   const reportRows=await reportEntries(runId,account);const saved=await readJson(path.join(rootPath,runId,'samples.json'),{optional:true,kind:'旧版样本'});
   const savedSamples=Array.isArray(saved)?saved:Array.isArray(saved?.samples)?saved.samples:[];
   const seen=new Set();const samples=[];
   for(const row of [...savedSamples,...reportRows.map(v=>({url:v.url,title:v.title,duration:v.duration}))]){try{const c=canonicalHistoryUrl(row.url??row.sourceUrl);if(seen.has(c.id))continue;seen.add(c.id);samples.push({...row,url:c.url});}catch{}}
   if(!samples.length&&!saved&&!reportRows.length)continue;
   addRecords(state,{account,samples,collectedAt:saved?.collectedAt||now(),provider:saved?.provider||'local-legacy',hasMore:saved?.hasMore,excludedOtherOwners:saved?.excludedOtherOwners},{kind:'legacy',runId},reportRows);
   state.legacyRuns.push(runId);changed=true;
  }
  const stylesFolder=path.join(rootPath,'style-library');let files=[];try{files=await readdir(stylesFolder);}catch(e){if(e.code!=='ENOENT')throw e;}
  const styleRefs=[];for(const file of files){if(!/^[A-Za-z0-9_-]{1,200}\.json$/.test(file))continue;const style=await readJson(path.join(stylesFolder,file),{optional:true,kind:'风格草稿'});if(style&&safeId(style.sourceReport)&&typeof style.templateId==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(style.templateId)){styleRefs.push({templateId:style.templateId,runId:style.sourceReport,status:text(style.status,60)||'draft-unconfirmed',name:text(style.style?.name,120)});}}
  if(JSON.stringify(styleRefs)!==JSON.stringify(state.styleRefs)){state.styleRefs=styleRefs;changed=true;}return changed;
 }
 async function initialize(){if(initialized)return;await serial(async()=>{if(initialized)return;const state=await load();if(await migrate(state)){state.revision++;await write(state);}initialized=true;});}
 async function transact(fn){await initialize();return serial(async()=>{const state=await load();const result=await fn(state);state.revision++;await write(state);return copy({...result,revision:state.revision});});}
 function recordForView(record,state){const styleRefs=state.styleRefs.filter(s=>record.reportRefs.some(r=>r.runId===s.runId));return{...record,styleRefs};}
 return {
  async refreshLegacy(){await initialize();return serial(async()=>{const state=await load();if(await migrate(state)){state.revision++;await write(state);}return{revision:state.revision};});},
  async snapshot({view='active',query='',q}={}){await initialize();if(!['active','hidden','trash','all'].includes(view))fail('历史筛选范围无效。');const state=await load(),needle=text(q??query,200).toLowerCase();const records=state.records.filter(r=>view==='all'||view==='active'&&isActive(r)||view==='hidden'&&r.hidden&&!r.trashedAt||view==='trash'&&r.trashedAt).filter(r=>!needle||[r.displayTitleZh,r.summaryZh,r.title,r.originalTitle,r.notes,r.account?.username,r.account?.displayName,r.account?.platform,r.url,...r.tags,...(r.autoTagsZh||[])].join('\n').toLowerCase().includes(needle)).sort((a,b)=>b.collectedAt.localeCompare(a.collectedAt));const visibleIds=new Set(records.map(r=>r.id));
   return copy({schemaVersion:SCHEMA,revision:state.revision,records:records.map(r=>recordForView(r,state)),topics:state.topics.map(t=>topicForView(t,records)).filter(t=>!t.automatic||t.recordCount),batches:state.batches.map(b=>({...b,recordIds:b.recordIds.filter(id=>visibleIds.has(id)),hiddenRecordCount:b.recordIds.filter(id=>!visibleIds.has(id)).length})).filter(b=>b.recordIds.length),reviews:state.reviews.map(r=>reviewSummary(r,state)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),counts:countsOf(state.records)});
  },
  async ingest(payload,options={}){if(!isObject(payload))fail('采集结果格式无效。');const account=payload.account==null?null:accountValue(payload.account);let reports=[];if(options.runId){if(!account)fail('关联旧版拆解报告需要来源账号。');reports=await reportEntries(options.runId,account);}return transact(state=>addRecords(state,payload,options,reports));},
  async importLegacy(payload){
   if(!isObject(payload))fail('旧版本地状态格式无效。');const account=accountValue(payload.account),accountKey=accountCacheKey(account);let report=null;
   if(payload.report&&account.platform==='Douyin')fail('旧版外部账号报告仅支持 Instagram；抖音元数据可以单独导入。');
   if(payload.report){try{report=validateAccountReport(payload.report,account);}catch(error){fail(error.message||'导入报告格式无效。');}}
   const existingSamples=Array.isArray(payload.samples)?payload.samples:[];if(existingSamples.length>1000)fail('导入样本过多。');
   const evidence=report?report.types.flatMap(t=>t.evidence.map(e=>({url:e.url,title:'外部分析报告引用'}))):[];
   const collectedAt=timestamp(payload.collectedAt)||timestamp(existingSamples[0]?.collectedAt)||timestamp(report?.analyzedAt)||now();
   return transact(state=>{
    const result=addRecords(state,{account,samples:[...existingSamples,...evidence],collectedAt,provider:'local-browser-import'},{kind:'metadata-import'});
    const prior=state.accountStates[accountKey]||{};let importedReportId=prior.importedReportId||null;
    if(report){const id='imported_'+hash(JSON.stringify(report));let saved=state.importedReports.find(r=>r.id===id);
     if(!saved){const recordIds=[...new Set(evidence.map(e=>canonicalHistoryUrl(e.url).id))];saved={id,account,createdAt:now(),status:'imported-unverified',report,recordIds};state.importedReports.push(saved);}
     importedReportId=id;for(const record of state.records.filter(r=>saved.recordIds.includes(r.id))){record.importedReportIds??=[];if(!record.importedReportIds.includes(id))record.importedReportIds.push(id);if(record.status.analysis!=='available')record.status.analysis='imported-unverified';}
    }
    state.accountStates[accountKey]={account,goal:payload.goal===undefined?prior.goal||'':text(payload.goal,5000),assets:payload.assets===undefined?prior.assets||'':text(payload.assets,5000),importedReportId,recordIds:[...new Set([...(prior.recordIds||[]),...result.records.map(r=>r.id)])],collectedAt,updatedAt:now()};
    return{...result,importedReportId,reportStatus:report?'imported-unverified':null};
   });
  },
  async findAccountCache(input){
   await initialize();const account=accountValue(typeof input==='string'?{username:input}:input),accountKey=accountCacheKey(account),state=await load(),legacy=state.accountStates[accountKey];let cached=state.caches[accountKey];
   if(!cached&&legacy)cached={account,samples:state.records.filter(r=>legacy.recordIds.includes(r.id)).map(r=>({url:r.url,title:r.title,views:r.views,likes:r.likes,duration:r.duration,publishedAt:r.publishedAt,collectedAt:r.collectedAt,sourceAccount:account.url,status:'metadata-only'})),collectedAt:legacy.collectedAt,provider:'local-browser-import',status:'metadata-only'};
   if(!cached)return null;let hiddenCount=0,trashedCount=0;const samples=cached.samples.filter(s=>{const id=canonicalHistoryUrl(s.url).id,r=state.records.find(r=>r.id===id);if(r?.trashedAt){trashedCount++;return false;}if(r?.hidden){hiddenCount++;return false;}return Boolean(r);});
   const imported=state.importedReports.find(r=>r.id===legacy?.importedReportId);const report=imported&&imported.recordIds.every(id=>state.records.some(r=>r.id===id&&isActive(r)))?imported.report:null;
   return copy({...cached,samples,cached:true,hiddenCount,trashedCount,report,goal:legacy?.goal||'',assets:legacy?.assets||''});
  },
  async readImportedReport(id){await initialize();const state=await load(),saved=state.importedReports.find(r=>r.id===id);if(!saved)fail('导入报告不存在。',404);if(saved.recordIds.some(id=>!state.records.some(r=>r.id===id&&isActive(r))))fail('此报告引用了已隐藏或回收站记录。',409,'HISTORY_REPORT_HIDDEN');return copy(saved);},
  // Internal service API only. Client mutate requests cannot attach trusted analysis provenance.
  async attachAnalysisMetadata(recordId,validated){
   if(!safeId(recordId)||!isObject(validated)||!isObject(validated.analysisRef))fail('分析元数据格式无效。');
   const ref=validated.analysisRef;
   if(!safeId(ref.analysisId)||ref.recordId!==undefined&&ref.recordId!==recordId||typeof ref.provider!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(ref.provider)||!timestamp(ref.completedAt)||ref.model!==undefined&&(typeof ref.model!=='string'||!/^[A-Za-z0-9._:/-]{1,160}$/.test(ref.model)))fail('分析来源引用格式无效。');
   for(const [field,max] of [['displayTitleZh',1000],['summaryZh',5000]])if(validated[field]!==undefined&&(typeof validated[field]!=='string'||validated[field].length>max))fail('分析中文信息过长或格式无效。');
   if(validated.autoTagsZh!==undefined&&(!Array.isArray(validated.autoTagsZh)||validated.autoTagsZh.length>30||validated.autoTagsZh.some(t=>typeof t!=='string'||t.length>60)))fail('分析标签格式无效。');
   return transact(state=>{
    const record=state.records.find(r=>r.id===recordId);if(!record)fail('历史记录不存在。',404);
    if(validated.displayTitleZh!==undefined&&record.displayTitleSource!=='user'){record.displayTitleZh=validated.displayTitleZh.trim();record.displayTitleSource='analysis';}
    if(validated.summaryZh!==undefined)record.summaryZh=validated.summaryZh.trim();
    if(validated.autoTagsZh!==undefined)record.autoTagsZh=[...new Set(validated.autoTagsZh.map(t=>t.trim()).filter(Boolean))];
    record.analysisRef={recordId,analysisId:ref.analysisId,provider:ref.provider,completedAt:timestamp(ref.completedAt),...(ref.model?{model:ref.model}:{})};
    record.status.analysis='available';record.updatedAt=now();return{record:recordForView(record,state)};
   });
  },
  async mutate(input){if(!isObject(input))fail('历史操作格式无效。');const {action}=input;
   if(['create-topic','rename-topic','link-topic','move-topic'].includes(action))return transact(state=>{
    const requestedIds=input.ids===undefined&&['create-topic','rename-topic'].includes(action)?[]:input.ids;
    if(!Array.isArray(requestedIds)||requestedIds.length>500||requestedIds.some(id=>typeof id!=='string')||['link-topic','move-topic'].includes(action)&&!requestedIds.length)fail('请选择有效的历史记录。');
    const ids=[...new Set(requestedIds)],records=ids.map(id=>{const record=state.records.find(r=>r.id===id);if(!record)fail('历史记录不存在。',404);return record;});
    let topic;
    if(action==='create-topic'){
     const kind=input.kind??'topic';if(!['brand','topic'].includes(kind))fail('专题类型无效。');
     topic={id:'topic_'+randomUUID(),title:topicTitle(input.title),kind,automatic:false,recordIds:ids,createdAt:now(),updatedAt:now()};state.topics.push(topic);
    }else{
     topic=state.topics.find(t=>t.id===input.topicId);if(!topic)fail('专题不存在。',404);
     if(action==='rename-topic')topic.title=topicTitle(input.title);
     if(action==='move-topic')for(const other of state.topics){if(other.id!==topic.id&&other.recordIds.some(id=>ids.includes(id))){other.recordIds=other.recordIds.filter(id=>!ids.includes(id));other.updatedAt=now();}}
     if(['link-topic','move-topic'].includes(action))topic.recordIds=[...new Set([...topic.recordIds,...ids])];
     topic.updatedAt=now();
    }
    return{topic:topicForView(topic,state.records.filter(isActive)),records:records.map(r=>recordForView(r,state))};
   });
   if(!['reviewed','favorite','hide','unhide','trash','restore','edit','feedback'].includes(action))fail('不支持的历史操作。');if(!Array.isArray(input.ids))fail('请选择有效的历史记录。');const ids=[...new Set(input.ids)];if(!ids.length||ids.length>500||ids.some(id=>typeof id!=='string'))fail('请选择有效的历史记录。');
   return transact(state=>{const records=ids.map(id=>{const r=state.records.find(r=>r.id===id);if(!r)fail('历史记录不存在。',404);return r;});
    if(action==='edit'&&ids.length!==1)fail('名称和备注一次只能编辑一条。');if(action==='feedback'&&ids.length!==1)fail('复刻反馈一次只能登记一条。');
    for(const record of records){
     if(action==='reviewed'||action==='favorite')record[action]=typeof input.value==='boolean'?input.value:!record[action];
     if(action==='hide')record.hidden=typeof input.value==='boolean'?input.value:true;if(action==='unhide')record.hidden=false;
     if(action==='trash')record.trashedAt=record.trashedAt||now();if(action==='restore')record.trashedAt=null;
     if(action==='edit'){if(input.title!==undefined){if(typeof input.title!=='string'||input.title.length>1000)fail('名称过长或格式无效。');record.title=input.title.trim();if(input.displayTitleZh===undefined)record.displayTitleZh=record.title;record.displayTitleSource='user';}if(input.displayTitleZh!==undefined){if(typeof input.displayTitleZh!=='string'||input.displayTitleZh.length>1000)fail('中文名称过长或格式无效。');record.displayTitleZh=input.displayTitleZh.trim();record.displayTitleSource='user';}if(input.notes!==undefined){if(typeof input.notes!=='string'||input.notes.length>5000)fail('备注最多 5000 字符。');record.notes=input.notes.trim();}if(input.tags!==undefined){if(!Array.isArray(input.tags)||input.tags.length>30||input.tags.some(t=>typeof t!=='string'||t.length>60))fail('标签格式无效，每条最多 30 个标签。');record.tags=[...new Set(input.tags.map(t=>t.trim()).filter(Boolean))];}}
     if(action==='feedback'){
      if(record.trashedAt)fail('请恢复记录后再登记反馈。',409);
      if(!['success','needs-improvement','not-tried'].includes(input.outcome))fail('反馈结果无效。');const note=text(input.note,5000);if(input.outcome==='success'&&!note)fail('请填写成功表现；人工反馈仍需证据核验。');let evidence=null;
      if(typeof input.evidence==='string'&&input.evidence.trim()){const value=input.evidence.trim();if(/^https:\/\//.test(value)){try{const u=new URL(value);if(u.username||u.password)throw Error();u.hash='';u.search='';evidence={url:u.href};}catch{fail('证据链接格式无效。');}}else if(/^(?:\/|[A-Za-z]:[\\/]|file:)/.test(value))fail('证据请填写说明或公开链接，不保存本机绝对路径。');else evidence={description:value.slice(0,2000)};}
      else if(isObject(input.evidence)){if(input.evidence.url){let u;try{u=new URL(input.evidence.url);}catch{fail('证据链接格式无效。');}if(u.protocol!=='https:'||u.username||u.password)fail('证据链接必须为 HTTPS。');u.hash='';u.search='';evidence={url:u.href};}if(input.evidence.description)evidence={...evidence,description:text(input.evidence.description,2000)};}
      if(input.styleId!==undefined&&input.styleId!==''&&!/^[A-Za-z0-9_-]{1,200}$/.test(input.styleId))fail('风格标识无效。');
      const attempt={attemptId:'attempt_'+randomUUID(),createdAt:now(),outcome:input.outcome,note,evidence,evidenceStatus:'user-reported-unverified',styleId:input.styleId||null};
      if(input.correctionOf){const old=record.feedback.find(f=>f.attemptId===input.correctionOf);if(!old)fail('待纠正的反馈不存在。',404);if(old.supersededBy)fail('此反馈已有纠正，请选择最新反馈。',409);const reason=text(input.correctionReason||note,2000);if(!reason)fail('请说明本次纠正原因。');attempt.correctionOf=old.attemptId;attempt.correctionReason=reason;old.supersededBy=attempt.attemptId;}
      record.feedback.push(attempt);
     }
     record.updatedAt=now();
    }return{records:records.map(r=>recordForView(r,state))};
   });
  },
  async exportReviewSource({periodStart,periodEnd}={}){await initialize();const start=timestamp(periodStart),end=timestamp(periodEnd);if(!start||!end||start>=end)fail('复盘时间范围无效。');const state=await load();const records=state.records.filter(isActive).map(r=>({...recordForView(r,state),feedback:r.feedback.filter(f=>!f.supersededBy&&f.createdAt>=start&&f.createdAt<end)}));return copy({revision:state.revision,periodStart:start,periodEnd:end,records,feedbackIds:records.flatMap(r=>r.feedback.map(f=>f.attemptId)),evidencePolicy:'人工成功反馈未经独立核验；无成片证据不作为已验证最佳实践。',scope:'active-not-hidden-not-trashed',generationEnabled:false});},
  async saveReview(input){if(!isObject(input))fail('复盘内容格式无效。');const periodStart=timestamp(input.periodStart),periodEnd=timestamp(input.periodEnd);if(!periodStart||!periodEnd||periodStart>=periodEnd)fail('复盘时间范围无效。');if(!['codex-weekly','local-summary'].includes(input.kind))fail('复盘类型无效。');if(typeof input.markdown!=='string'||!input.markdown.trim()||input.markdown.length>100000)fail('复盘正文为空或过长。');
   return transact(state=>{if(input.sourceRevision!==undefined&&input.sourceRevision!==state.revision)fail('复盘期间资料已变化，请重新读取后保存。',409,'HISTORY_STALE');if(input.recordIds!==undefined&&!Array.isArray(input.recordIds)||input.feedbackIds!==undefined&&!Array.isArray(input.feedbackIds))fail('复盘引用列表格式无效。');const recordIds=[...new Set(input.recordIds||state.records.filter(isActive).map(r=>r.id))],feedbackIds=[...new Set(input.feedbackIds||[])];if(recordIds.some(id=>!state.records.some(r=>r.id===id&&isActive(r))))fail('复盘引用了不可见或不存在的记录。',409);if(feedbackIds.some(id=>!state.records.some(r=>isActive(r)&&recordIds.includes(r.id)&&r.feedback.some(f=>f.attemptId===id&&!f.supersededBy))))fail('复盘反馈引用已失效。',409);const review={id:'review_'+randomUUID(),periodStart,periodEnd,createdAt:now(),kind:input.kind,markdown:input.markdown,sourceRevision:state.revision,recordIds,feedbackIds,evidencePolicy:'user-reported-feedback-is-unverified'};state.reviews.push(review);return{review:reviewSummary(review,state)};});
  },
  async readReview(id){await initialize();const state=await load(),review=state.reviews.find(r=>r.id===id);if(!review)fail('复盘记录不存在。',404);if(reviewSummary(review,state).restricted)fail('此复盘引用了已隐藏或回收站记录，请先恢复记录或重新生成复盘。',409,'HISTORY_REVIEW_HIDDEN');return copy(review);}
 };
}
