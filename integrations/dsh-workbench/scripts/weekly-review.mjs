#!/usr/bin/env node
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createHistoryStore} from '../src/history-store.mjs';

const DAY=86400000,CHINA_OFFSET=8*3600000;
const validDate=value=>{const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error('时间格式无效，请使用 ISO 日期时间。');return date;};
export const defaultWeeklyDataRoot=()=>path.join(os.homedir(),'Documents','DSH-Workbenches','data');
export function previousCompleteWeek(value=new Date()){
 const actual=validDate(value),shifted=new Date(actual.getTime()+CHINA_OFFSET);
 const monday=Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate())-((shifted.getUTCDay()+6)%7)*DAY-CHINA_OFFSET;
 return{periodStart:new Date(monday-7*DAY).toISOString(),periodEnd:new Date(monday).toISOString(),timezone:'Asia/Shanghai'};
}
export function lastSevenDays(value=new Date()){const end=validDate(value);return{periodStart:new Date(end.getTime()-7*DAY).toISOString(),periodEnd:end.toISOString(),timezone:'Asia/Shanghai'};}
const chinaDay=value=>new Date(new Date(value).getTime()+CHINA_OFFSET).toISOString().slice(0,10);
const compactDate=value=>chinaDay(value).replaceAll('-','');
const escapeMarkdown=value=>String(value??'').replace(/[\r\n]+/g,' ').replace(/([\\`*_{}\[\]<>#|])/g,'\\$1');
const sourceCounts=source=>({records:source.records.length,feedback:source.feedbackIds.length,reportedSuccesses:source.records.flatMap(r=>r.feedback).filter(f=>f.outcome==='success').length,verifiedSuccesses:0});

function sourceSnapshot(source,generatedAt){
 return{schemaVersion:1,generatedAt,timezone:'Asia/Shanghai',revision:source.revision,periodStart:source.periodStart,periodEnd:source.periodEnd,scope:source.scope,generationEnabled:false,evidencePolicy:source.evidencePolicy,feedbackIds:source.feedbackIds,records:source.records.map(r=>({id:r.id,url:r.url,account:r.account,title:r.title,notes:r.notes,tags:r.tags,reviewed:r.reviewed,favorite:r.favorite,collectedAt:r.collectedAt,updatedAt:r.updatedAt,status:r.status,mediaAvailable:r.mediaAvailable,views:r.views,likes:r.likes,duration:r.duration,reportRefs:r.reportRefs,importedReportIds:r.importedReportIds||[],styleRefs:r.styleRefs||[],feedback:r.feedback.map(f=>({attemptId:f.attemptId,createdAt:f.createdAt,outcome:f.outcome,note:f.note,evidence:f.evidence,evidenceStatus:'user-reported-unverified',styleId:f.styleId,correctionOf:f.correctionOf,correctionReason:f.correctionReason}))}))};
}
function validateSource(source){
 if(source?.schemaVersion!==1||source.scope!=='active-not-hidden-not-trashed'||source.generationEnabled!==false||!Number.isSafeInteger(source.revision)||source.revision<0||!Array.isArray(source.records)||!Array.isArray(source.feedbackIds))throw new Error('复盘来源快照格式无效。');
 const start=validDate(source.periodStart),end=validDate(source.periodEnd);if(start>=end)throw new Error('复盘来源时间范围无效。');
 if(source.records.some(r=>typeof r?.id!=='string'||!Array.isArray(r.feedback))||source.feedbackIds.some(id=>typeof id!=='string'))throw new Error('复盘来源记录结构无效。');return source;
}
async function readLimited(file,maxBytes){const meta=await stat(file);if(!meta.isFile()||meta.size>maxBytes)throw new Error('复盘输入文件不可读取或过大。');return readFile(file,'utf8');}

export async function prepareReview({dataRoot=defaultWeeklyDataRoot(),now=new Date()}={}){
 const current=validDate(now),period=previousCompleteWeek(current),store=createHistoryStore({root:dataRoot});
 const source=sourceSnapshot(await store.exportReviewSource(period),current.toISOString());
 const folder=path.join(dataRoot,'library','review-drafts');await mkdir(folder,{recursive:true,mode:0o700});
 const sourcePath=path.join(folder,`source-${compactDate(period.periodStart)}-${compactDate(period.periodEnd)}-r${source.revision}-${randomUUID().slice(0,8)}.json`);
 await writeFile(sourcePath,JSON.stringify(source,null,2)+'\n',{flag:'wx',mode:0o600});
 return{action:'prepare',sourcePath,periodStart:period.periodStart,periodEnd:period.periodEnd,timezone:period.timezone,sourceRevision:source.revision,counts:sourceCounts(source),networkRequests:0,modelCalls:0};
}
export async function savePreparedReview({dataRoot=defaultWeeklyDataRoot(),sourcePath,markdownPath}={}){
 if(!sourcePath||!markdownPath)throw new Error('save 需要 --source 和 --markdown。');let source;try{source=validateSource(JSON.parse(await readLimited(sourcePath,16*1024*1024)));}catch(error){if(error.code==='ENOENT')throw new Error('复盘来源文件不存在。');throw error;}
 const markdown=await readLimited(markdownPath,400000),store=createHistoryStore({root:dataRoot});
 const result=await store.saveReview({periodStart:source.periodStart,periodEnd:source.periodEnd,markdown,sourceRevision:source.revision,recordIds:source.records.map(r=>r.id),feedbackIds:source.feedbackIds,kind:'codex-weekly'});
 return{action:'save',reviewId:result.review.id,revision:result.revision,counts:sourceCounts(source),status:'saved-local',networkRequests:0,modelCalls:0};
}
export function renderLocalSummary(source){
 const counts=sourceCounts(source),feedback=source.records.flatMap(record=>record.feedback.map(item=>({record,item})));
 const starts=chinaDay(source.periodStart),ends=chinaDay(source.periodEnd);
 const lines=[`# 最近七天资料复盘 · ${starts} 至 ${ends}`, '', '这是本机记录的确定性摘要，没有调用分析模型，也没有生成或复刻视频。', '', `- 可见参考视频：${counts.records} 条；已隐藏和回收站记录未纳入。`, `- 本期人工反馈：${counts.feedback} 条，其中自报成功 ${counts.reportedSuccesses} 条。`, '- 已独立验证的复刻成功：0 条。当前流程没有成片核验环节。', ''];
 if(!feedback.length)lines.push('## 本期结论','','目前没有复刻结果反馈，尚不能归纳“成功最佳实践”。可以先用现有拆解结果挑选参考形式，后续完成复刻后再登记具体改善和成片证据。','');
 else{lines.push('## 人工反馈 · 待核验','');for(const {record,item} of feedback){const label={success:'自报成功', 'needs-improvement':'需要改进','not-tried':'尚未尝试'}[item.outcome]||'待核验';lines.push(`- ${escapeMarkdown(record.title||record.url)}：${label}。${escapeMarkdown(item.note||'未填写观察。')}${item.evidence?' 已提供证据说明或链接，尚未核验。':' 尚未提供成片证据。'}`);}lines.push('','以上是人工登记，不等于平台数据验证或质量评估。对已纠正的旧反馈不重复计数。','');}
 lines.push('## 下一次复盘所需证据','','记录尝试使用的参考形式、完成结果、具体改善或失败点，以及可回看的成片链接或证据说明；在证据充分前，将结论保留为候选做法。','');
 const available=source.records.filter(r=>r.status?.analysis==='available').length,imported=source.records.filter(r=>r.status?.analysis==='imported-unverified').length;
 lines.push('## 当前资料状态','',`已有本机拆解引用 ${available} 条；外部导入待核验 ${imported} 条。播放量、点赞量和候选剪辑形式用于筛选参考，不能证明我们已成功复刻。`);
 return lines.join('\n');
}
export async function previewReview({dataRoot=defaultWeeklyDataRoot(),now=new Date()}={}){
 const current=validDate(now),store=createHistoryStore({root:dataRoot}),source=sourceSnapshot(await store.exportReviewSource(lastSevenDays(current)),current.toISOString());
 const result=await store.saveReview({periodStart:source.periodStart,periodEnd:source.periodEnd,markdown:renderLocalSummary(source),sourceRevision:source.revision,recordIds:source.records.map(r=>r.id),feedbackIds:source.feedbackIds,kind:'local-summary'});
 return{action:'preview',reviewId:result.review.id,revision:result.revision,periodStart:source.periodStart,periodEnd:source.periodEnd,timezone:'Asia/Shanghai',counts:sourceCounts(source),status:'saved-local-summary',networkRequests:0,modelCalls:0};
}
export async function weeklyReviewMain(args=process.argv.slice(2)){
 const [action,...flags]=args;if(!['prepare','save','preview'].includes(action))throw new Error('用法：weekly-review.mjs prepare|save|preview [--data-root 路径] [--now ISO]；save 另需 --source 路径 --markdown 路径。');
 const options={};for(let i=0;i<flags.length;i+=2){const name=flags[i],value=flags[i+1];if(!['--data-root','--now','--source','--markdown'].includes(name)||!value||value.startsWith('--'))throw new Error('复盘命令参数不完整或不支持。');if(options[name]!==undefined)throw new Error('复盘命令参数重复。');options[name]=value;}
 const values={dataRoot:options['--data-root']?path.resolve(options['--data-root']):defaultWeeklyDataRoot(),now:options['--now']||new Date(),sourcePath:options['--source'],markdownPath:options['--markdown']};
 if(action==='prepare')return prepareReview(values);if(action==='save')return savePreparedReview(values);return previewReview(values);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){weeklyReviewMain().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.code==='HISTORY_STALE'?'复盘期间本机记录已变化，请重新 prepare 后再保存。':error.message);process.exitCode=1;});}
