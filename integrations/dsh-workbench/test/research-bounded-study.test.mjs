import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,cp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createResearchService,selectResearchSamples,validateComparison} from '../src/research-service.mjs';
import {createHistoryStore} from '../src/history-store.mjs';

const anchor='2026-10-10T10:00:00.000Z',now=()=>anchor;
const account={username:'bounded_synthetic',url:'https://www.instagram.com/bounded_synthetic/'};
const row=(i,date='2026-10-09T10:00:00.000Z')=>({url:`https://www.instagram.com/reel/BOUND_${i}/`,title:'合成研究',publishedAt:date,duration:10,likes:100-i,views:200-i});
const rows=(n=6,start=0)=>Array.from({length:n},(_,i)=>row(start+i));
const payload=(extra={})=>({requestId:'bounded_request',source:{kind:'account',url:account.url},...extra});
const result=record=>({status:'completed',titleZh:'合成画面分析',tagsZh:['合成'],steps:{vl:{status:'completed'}},visual:{observations:[{startSec:0,endSec:10,descriptionZh:'有时间证据的合成画面'}]},rhythm:{measurements:{durationSec:10}},recommendations:[{nameZh:'合成风格',status:'conditional',reasonZh:'合成建议'}],recreationPackage:{status:'incomplete',fullPromptText:''}});
const compared=records=>({status:'completed',summaryZh:'本次合成比较结果',recommendations:records.slice(0,3).map(r=>({recordId:r.recordId,reasonZh:'基于本次视觉证据',formZh:'合成细节展示',materialThresholdZh:'需要商品素材',evidence:[{startSec:0,endSec:2}],recreationPackage:{schemaVersion:1,status:'needs-input',fullPromptText:'SYNTHETIC FINAL '+r.recordId}})),excluded:records.slice(3).map(r=>({recordId:r.recordId,reasonZh:'同类方案优先级较低'})),providerCalls:{comparison:1,compilation:1},usage:{comparison:{total_tokens:30},compilation:{total_tokens:60}},promptStatus:'completed'});
async function setup(options={}){const root=await mkdtemp(path.join(os.tmpdir(),'dsh-bounded-study-')),history=createHistoryStore({root});let collections=0,analyses=0,comparisons=0;const args=[];const service=createResearchService({root,history,now,collectAccount:async input=>{collections++;args.push(input);return{account,samples:rows(),hasMore:true,nextCursor:'next_page',collectedAt:anchor};},analyzeVideo:async({record})=>{analyses++;return result(record);},compareVideos:async input=>{comparisons++;return compared(input.records);},...options});return{root,history,service,args,collections:()=>collections,analyses:()=>analyses,comparisons:()=>comparisons};}

test('new default is six, strict thirty-day window frozen at creation, and the request stays idempotent as time advances',async()=>{
 let clock=anchor;const {service,collections}=await setup({now:()=>clock});const first=await service.startResearch(payload());await service.waitForIdle();const job=await service.getJob(first);assert.equal(job.plan.selectionPolicy.count,6);assert.equal(job.plan.selectionPolicy.windowDays,30);assert.equal(job.plan.selectionPolicy.windowEnd,job.plan.createdAt);assert.equal(job.plan.selectionPolicy.windowStart,'2026-09-10T10:00:00.000Z');assert.equal(job.plan.budgetScope.maxAccountPages,2);assert.equal(job.plan.budgetScope.maxMetadataCandidates,24);assert.equal(job.plan.budgetScope.vlMaxOutputTokens,5000);assert.equal(job.plan.modelPolicy.compilePromptsWithText,true);assert.equal(job.plan.budgetScope.maxComparisonCalls,1);assert.equal(job.plan.budgetScope.maxPromptCompileCalls,1);assert.equal(job.plan.budgetScope.firstVideoGate,true);clock='2026-10-12T10:00:00.000Z';const duplicate=await service.startResearch(payload());assert.equal(duplicate.jobId,first.jobId);assert.equal(duplicate.duplicate,true);assert.equal(collections(),1);
 const unchanged=await service.preparePlan({...payload(),executionMode:'account-study',planId:job.planId,expectedRevision:1});assert.equal(unchanged.planRevision,1);assert.equal(unchanged.plan.selectionPolicy.windowEnd,anchor);
 await assert.rejects(service.startResearch(payload({requestId:'bad_window',selectionPolicy:{mode:'balanced',count:6,windowDays:90}})),{code:'RESEARCH_WINDOW'});
});

test('old pinned videos do not terminate collection; a second cursor page completes the recent sample',async()=>{
 const pages=[{samples:[row('old','2020-01-01T00:00:00Z'),...rows(3)],nextCursor:'page_two',hasMore:true},{samples:rows(5,3),nextCursor:'page_three',hasMore:true}];let calls=0;const {service,args}=await setup({collectAccount:async input=>{args.push(input);return{account,...pages[calls++],collectedAt:anchor};}});
 const start=await service.startResearch(payload()),job=await service.waitForIdle(start.jobId);assert.equal(calls,2);assert.equal(args[0].cursor,undefined);assert.equal(args[1].cursor,'page_two');assert.equal(job.selectedRecordIds.length,6);assert.ok(!job.selectedRecordIds.includes('ig_BOUND_old'));assert.equal(job.coverage.olderThanWindowCount,1);assert.equal(job.coverage.pagesFetched,2);assert.equal(job.coverage.collectionStopReason,'enough-eligible');assert.equal(job.actualUsage.providerCalls.accountList,2);assert.equal(job.comparison.status,'completed');assert.equal(job.comparison.recommendations.length,3);
});

test('enough eligible first-page videos stop before a second paid page',async()=>{const {service,collections,analyses}=await setup();const started=await service.startResearch(payload({selectionPolicy:{mode:'balanced',count:5,windowDays:30}})),job=await service.waitForIdle(started.jobId);assert.equal(collections(),1);assert.equal(analyses(),5);assert.equal(job.coverage.collectionStopReason,'enough-eligible');assert.equal(job.coverage.pagesFetched,1);});

test('two-page boundary is hard even when only five valid recent videos exist; no old, unknown or future padding',async()=>{
 let calls=0;const {service,analyses}=await setup({collectAccount:async()=>{calls++;return{account,samples:calls===1?[...rows(3),...Array.from({length:9},(_,i)=>row('old'+i,'2020-01-01T00:00:00Z'))]:[...rows(2,3),row('unknown',null),row('future','2027-01-01T00:00:00Z'),...Array.from({length:20},(_,i)=>row('ancient'+i,'2020-01-01T00:00:00Z'))],hasMore:true,nextCursor:'page_'+calls};}});const started=await service.startResearch(payload()),job=await service.waitForIdle(started.jobId);assert.equal(calls,2);assert.equal(analyses(),5);assert.equal(job.phase,'partial');assert.equal(job.coverage.candidateCount,24);assert.equal(job.coverage.unknownTimestampCount,1);assert.equal(job.coverage.futureTimestampCount,1);assert.equal(job.coverage.olderThanWindowCount,17);assert.equal(job.coverage.collectionStopReason,'page-limit');assert.equal(job.coverage.metadataTruncated,true);assert.ok(job.selectedRecordIds.every(id=>/^ig_BOUND_[0-4]$/.test(id)));
});

test('exact 30-day boundary is included; one millisecond older, unknown and frozen-window future are excluded',()=>{
 const selected=selectResearchSamples([row(1,'2026-09-10T10:00:00.000Z'),row(2,'2026-09-10T09:59:59.999Z'),row(3,null),row(4,'2026-10-10T10:00:00.001Z')],{mode:'latest',count:6,windowDays:30,windowStart:'2026-09-10T10:00:00.000Z',windowEnd:anchor},{now:'2026-10-15T10:00:00Z'});assert.deepEqual(selected.selected.map(r=>r.id),['ig_BOUND_1']);assert.equal(selected.coverage.olderThanWindowCount,1);assert.equal(selected.coverage.futureTimestampCount,1);assert.equal(selected.coverage.unknownTimestampCount,1);
});

test('missing cursors and repeated cursor responses stop without probing more pages',async()=>{
 for(const nextCursor of [null,'']){let calls=0;const {service}=await setup({collectAccount:async()=>{calls++;return{account,samples:rows(2),hasMore:true,nextCursor};}});const started=await service.startResearch(payload()),job=await service.waitForIdle(started.jobId);assert.equal(calls,1);assert.equal(job.coverage.collectionStopReason,'missing-cursor');assert.equal(job.selectedRecordIds.length,2);}
});

test('second-page errors retain first-page metadata and analyze only the already eligible rows without retry',async()=>{
 let calls=0;const {service,analyses}=await setup({collectAccount:async()=>{calls++;if(calls===2)throw Object.assign(Error('private remote diagnostic'),{code:'TIKHUB_TIMEOUT'});return{account,samples:rows(3),hasMore:true,nextCursor:'second'};}});const started=await service.startResearch(payload()),job=await service.waitForIdle(started.jobId);assert.equal(calls,2);assert.equal(analyses(),3);assert.equal(job.phase,'partial');assert.equal(job.collectionPages.length,1);assert.equal(job.collectionPages[0].samples.length,3);assert.equal(job.coverage.collectionStopReason,'page-failed');assert.ok(job.collectionError);assert.doesNotMatch(JSON.stringify(job),/private remote diagnostic/);
});

test('first-video missing visual evidence blocks the other five and never invokes comparison',async()=>{
 for(const throwing of [false,true]){let calls=0,compare=0;const {service}=await setup({analyzeVideo:async()=>{calls++;if(throwing)throw Object.assign(Error('synthetic media failure'),{code:'MEDIA_URL'});return{status:'partial',steps:{vl:{status:'failed'}},recommendations:[]};},compareVideos:async()=>{compare++;throw Error();}});const started=await service.startResearch(payload()),job=await service.waitForIdle(started.jobId);assert.equal(job.phase,'partial');assert.equal(job.analysisGate.status,'blocked');assert.equal(job.videos.filter(v=>v.status==='blocked').length,5);assert.equal(calls,1);assert.equal(compare,0);assert.equal(job.comparison.status,'pending');await service.startResearch(payload());assert.equal(calls,1);}
});

test('successful first visual result unlocks the batch even when its audio is partial',async()=>{let calls=0;const {service}=await setup({analyzeVideo:async({record})=>{calls++;return{...result(record),status:calls===1?'partial':'completed'};}});const started=await service.startResearch(payload()),job=await service.waitForIdle(started.jobId);assert.equal(calls,6);assert.equal(job.analysisGate.status,'passed');assert.equal(job.phase,'partial');assert.equal(job.comparison.status,'completed');});

test('comparison uses only this job and persists valid three-of-six ranking, usage and final compiled packages',async()=>{
 let seen,calls=0;const {service}=await setup({compareVideos:async input=>{calls++;seen=structuredClone(input);return compared(input.records);}});const started=await service.startResearch(payload());await service.waitForIdle();const report=await service.readResult(started);assert.equal(seen.records.length,6);assert.ok(seen.records.every(r=>r.recordId&&r.metadata.duration===10&&r.result.visual));assert.equal(seen.plan.planId,started.planId);assert.equal(report.comparison.status,'completed');assert.equal(report.comparison.recommendations.length,3);assert.equal(report.comparison.excluded.length,3);assert.equal(report.comparison.promptStatus,'completed');assert.equal(report.actualUsage.providerCalls.deepseek,2);assert.equal(report.actualUsage.comparison.compilation.total_tokens,60);
 const recommended=report.comparison.recommendations[0],note=report.results.find(r=>r.recordId===recommended.recordId);assert.equal(note.result.recreationPackage.fullPromptText,recommended.recreationPackage.fullPromptText);assert.equal(note.result.recreationPackageSource,'deepseek-comparison');const candidate=report.styleCandidates.find(c=>c.recordIds.includes(recommended.recordId)),saved=await service.confirmStyle({jobId:started.jobId,candidateId:candidate.candidateId});assert.equal(saved.style.recreationPackage.fullPromptText,recommended.recreationPackage.fullPromptText);assert.equal(saved.style.comparisonRecommendation.recordId,recommended.recordId);await service.startResearch(payload());assert.equal(calls,1);
});

test('invalid ranking IDs, duplicates, extra recommendations or out-of-bounds evidence are not repaired into AI recommendations',()=>{
 const records=rows().map(s=>({recordId:'ig_'+new URL(s.url).pathname.split('/')[2],metadata:{duration:10},result:result(s)}));
 const invalid=[x=>x.recommendations[0].recordId='ig_OLD_RECORD',x=>x.recommendations[1].recordId=x.recommendations[0].recordId,x=>x.recommendations.push({...x.recommendations[0]}),x=>x.recommendations[0].evidence[0].startSec=-1,x=>x.recommendations[0].evidence[0].endSec=11,x=>x.excluded[0].recordId='ig_OTHER',x=>x.excluded.pop(),x=>x.recommendations[0].evidence=[]];
 for(const change of invalid){const output=compared(records);change(output);assert.throws(()=>validateComparison(output,records),{code:'RESEARCH_COMPARISON_OUTPUT'});}
});

test('comparison output failure preserves six reports and never silently retries or fabricates a ranking',async()=>{
 let calls=0;const {service}=await setup({compareVideos:async({records})=>{calls++;const output=compared(records);output.recommendations[0].recordId='ig_FOREIGN';return output;}});const started=await service.startResearch(payload());await service.waitForIdle();const report=await service.readResult(started);assert.equal(report.results.length,6);assert.equal(report.comparison.status,'failed');assert.equal(report.status,'partial');assert.equal(report.comparison.recommendations.length,0);assert.equal(calls,1);await service.readResult(started);await service.startResearch(payload());assert.equal(calls,1);
});

test('unwired comparison stays pending without metadata heuristics posing as AI',async()=>{const {service}=await setup({compareVideos:undefined}),started=await service.startResearch(payload());await service.waitForIdle();const report=await service.readResult(started);assert.equal(report.comparison.status,'pending');assert.equal(report.status,'partial');assert.equal(report.comparison.recommendations.length,0);assert.match(report.comparison.summaryZh,/尚未接通/);assert.equal(report.actualUsage.providerCalls.comparison,undefined);});

test('trusted same-account cache injection records zero new account-list provider calls',async()=>{const {service}=await setup({collectAccount:async()=>({account,samples:rows(),hasMore:false,collectedAt:'2026-10-10T09:00:00.000Z',collectionSource:'cache'})}),started=await service.startResearch(payload()),job=await service.waitForIdle(started.jobId);assert.equal(job.actualUsage.providerCalls.accountList,0);assert.equal(job.actualUsage.providerCalls.tikhub,0);assert.equal(job.coverage.collectionSource,'cache');assert.ok(job.events.some(e=>e.detail.status==='cache-hit'));});

test('hide during comparison invalidates publication and prevents hidden notes from leaking through readers',async()=>{
 let entered,release;const began=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let ids;const {service,history}=await setup({compareVideos:async({records})=>{ids=records.map(r=>r.recordId);entered();await gate;return compared(records);}});const started=await service.startResearch(payload());await began;await history.mutate({action:'hide',ids:[ids[0]]});release();await assert.rejects(service.waitForIdle(started.jobId),{code:'RESEARCH_HIDDEN'});await assert.rejects(service.readResult(started),{code:'RESEARCH_HIDDEN'});await history.mutate({action:'unhide',ids:[ids[0]]});const job=await service.getJob(started);assert.equal(job.phase,'partial');assert.equal(job.comparison,undefined);
});

test('balanced can supplement recent unknown metrics without claiming strong performance; data-priority cannot',()=>{
 const unknowns=[{...row(3),likes:null,views:null,duration:10},{...row(4),likes:null,views:null,duration:25},{...row(5),likes:null,views:null,duration:45}],samples=[...rows(3),...unknowns,row('old','2020-01-01T00:00:00Z')];const window={windowDays:30,windowStart:'2026-09-10T10:00:00.000Z',windowEnd:anchor,count:6,metric:'likes'};
 const balanced=selectResearchSamples(samples,{...window,mode:'balanced'},{now:anchor}),top=selectResearchSamples(samples,{...window,mode:'top-in-page'},{now:anchor});assert.equal(balanced.selected.length,6);assert.deepEqual(balanced.selected.slice(0,3).map(r=>r.id),['ig_BOUND_0','ig_BOUND_1','ig_BOUND_2']);assert.equal(balanced.coverage.unknownMetricSelectedCount,3);assert.ok(balanced.selected.slice(3).every(r=>r.likes===null&&r.views===null));assert.match(balanced.coverage.noteZh,/不能称为表现好/);assert.equal(top.selected.length,3);assert.equal(top.coverage.missingMetricCount,3);
});

test('a recent page with unknown metrics can complete balanced sampling without a second paid page',async()=>{
 let collections=0;const {service,analyses}=await setup({collectAccount:async()=>{collections++;return{account,samples:rows().map(r=>({...r,likes:null,views:null})),hasMore:true,nextCursor:'unused'};}});const started=await service.startResearch(payload()),job=await service.waitForIdle(started.jobId);assert.equal(collections,1);assert.equal(analyses(),6);assert.equal(job.coverage.unknownMetricSelectedCount,6);assert.equal(job.phase,'completed');assert.ok(job.selectedMetadata.every(r=>r.likes===null&&r.views===null));
});

test('cached media-resolution results do not count as new TikHub requests or erase other records paid calls',async()=>{
 let index=0;const {service}=await setup({analyzeVideo:async({record,onStage})=>{index++;if(index!==3)await onStage('resolving_media',{recordId:record.id,step:'resolve',status:'requesting'});return{...result(record),cached:index===3,steps:{vl:{status:'completed'},resolve:{status:'completed',cached:index===2||index===3}}};}});const started=await service.startResearch(payload()),job=await service.waitForIdle(started.jobId);assert.equal(job.actualUsage.providerCalls.accountList,1);assert.equal(job.actualUsage.providerCalls.mediaResolution,4);assert.equal(job.actualUsage.providerCalls.tikhub,5);assert.equal(job.actualUsage.mediaResolutionCacheHits,1);assert.equal(job.actualUsage.records.filter(r=>r.mediaResolutionCached).length,2);assert.equal(job.events.filter(e=>e.detail.step==='resolve'&&e.detail.status==='cache-hit').length,1);
});


test('overall study completes only when comparison and every recommended prompt draft are complete',async()=>{
 for(const variant of ['failed','incomplete','missing-package','empty-prompt','needs-input','all-excluded']){
  const {service}=await setup({compareVideos:async({records})=>{const output=compared(records);if(['failed','incomplete'].includes(variant))output.promptStatus=variant;if(variant==='missing-package')delete output.recommendations[0].recreationPackage;if(variant==='empty-prompt')output.recommendations[0].recreationPackage.fullPromptText='';if(variant==='all-excluded'){output.recommendations=[];output.excluded=records.map(r=>({recordId:r.recordId,reasonZh:'本次素材条件不满足'}));output.promptStatus='skipped';}return output;}});
  const started=await service.startResearch(payload()),job=await service.waitForIdle(started.jobId);assert.ok(job.videos.every(v=>v.status==='completed'));assert.equal(job.comparison.status,'completed');assert.equal(job.phase,['needs-input','all-excluded'].includes(variant)?'completed':'partial',variant);if(job.phase==='partial')assert.match(job.noteZh,/提示词/);
 }
});

test('checkpoint transaction blocks a request when cancellation or confirmed hash changes after its visibility read',async()=>{
 for(const mutation of ['edit','hash']){
  const root=await mkdtemp(path.join(os.tmpdir(),'dsh-checkpoint-race-')),base=createHistoryStore({root});let armed=false,paid=0,service,plan;
  const history={...base,snapshot:async options=>{if(armed){armed=false;if(mutation==='edit')await service.preparePlan({...payload(),executionMode:'account-study',planId:plan.planId,expectedRevision:plan.planRevision,userIntent:'确认卡已变更'});else{const file=path.join(root,'research/state.json'),state=JSON.parse(await readFile(file,'utf8'));state.plans[0].planHash='synthetic_changed_hash';await writeFile(file,JSON.stringify(state));}}return base.snapshot(options);}};
  service=createResearchService({root,history,now,collectAccount:async()=>({account,samples:rows(),collectedAt:anchor}),analyzeVideo:async args=>{plan=args.plan;armed=true;await args.onStage('analyzing',{step:'vl',status:'requesting'});paid++;return result(args.record);},compareVideos:async({records})=>compared(records)});
  const started=await service.startResearch(payload()),job=await service.waitForIdle(started.jobId);assert.equal(paid,0);assert.equal(job.events.filter(e=>e.detail?.step==='vl'&&e.detail.status==='requesting').length,0);assert.equal(job.error.code,mutation==='edit'?'RESEARCH_CANCELLED':'RESEARCH_STALE');assert.equal(job.phase,mutation==='edit'?'cancelled':'failed');
 }
});
