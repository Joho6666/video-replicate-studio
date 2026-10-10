import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHistoryStore} from '../src/history-store.mjs';
import {createResearchService,selectResearchSamples} from '../src/research-service.mjs';

const now=()=> '2026-10-10T10:00:00.000Z';
const account={username:'account_study_synthetic',url:'https://www.instagram.com/account_study_synthetic/'};
const input=(extra={})=>({requestId:'request_synthetic',source:{kind:'account',url:account.url},...extra});
const rows=(length=12)=>Array.from({length},(_,i)=>({url:`https://www.instagram.com/reel/STUDY_${i}/`,title:`合成样本 ${i}`,publishedAt:`2026-10-${String(9-i%9).padStart(2,'0')}T00:00:00Z`,duration:i%3===0?10:i%3===1?25:45,likes:1000-i,views:2000-i,ownerVerified:true}));
const packageFor=id=>({schemaVersion:1,status:'needs-input',fullPromptText:`SYNTHETIC prompt for ${id}`,markdown:`# 合成导演方案 ${id}`,shots:[],segments:[],missingInputs:[{key:'product',labelZh:'商品素材'}],validationStatus:'not-generated-not-tested'});
const resultFor=record=>({status:'completed',steps:{vl:{status:'completed'},asr:{status:'completed'}},visual:{observations:[{startSec:0,endSec:1,descriptionZh:'合成视觉证据'}]},titleZh:'本次合成拆解',tagsZh:['本次画面标签'],recommendations:[{nameZh:'相同类型',reasonZh:'合成建议',status:'conditional'}],recreationPackage:packageFor(record.id)});
async function setup(options={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'dsh-account-study-')),history=createHistoryStore({root});let collections=0,analyses=0,inflight=0,maxInflight=0;const seenPlans=[];
 const service=createResearchService({root,history,now,collectAccount:async args=>{collections++;assert.equal(args.consent,true);return{account,samples:rows(),provider:'synthetic',collectedAt:now(),hasMore:true};},analyzeVideo:async({record,plan,onStage})=>{analyses++;seenPlans.push(structuredClone(plan));inflight++;maxInflight=Math.max(maxInflight,inflight);await onStage('resolving_media',{step:'resolve',status:'requesting'});await onStage('analyzing',{step:'vl',status:'requesting'});await new Promise(r=>setTimeout(r,1));inflight--;return resultFor(record);},...options});
 return{root,history,service,seenPlans,collections:()=>collections,analyses:()=>analyses,maxInflight:()=>maxInflight};
}
const request=(body,{origin='http://127.0.0.1:43129',header=true}={})=>new Request('http://127.0.0.1:43129/research/start',{method:'POST',headers:{origin,'content-type':'application/json',...(header?{'x-derek-workbench':'1'}:{})},body:JSON.stringify(body)});

test('one click atomically creates a versioned account plan; concurrent double-clicks call one page and four analyses',async()=>{
 const {service,collections,analyses,maxInflight}=await setup();
 const responses=await Promise.all([service.handlers.start(request(input())),service.handlers.start(request(input())),service.handlers.start(request(input()))]);
 assert.ok(responses.every(r=>r.status===200));const replies=await Promise.all(responses.map(r=>r.json()));assert.equal(new Set(replies.map(r=>r.jobId)).size,1);assert.equal(replies.filter(r=>!r.duplicate).length,1);
 const job=await service.waitForIdle(replies[0].jobId);assert.equal(job.phase,'completed');assert.equal(job.plan.executionMode,'account-study');assert.equal(job.planRevision,1);assert.equal(job.plan.selectionPolicy.count,4);assert.equal(job.plan.selectionPolicy.mode,'balanced');assert.match(job.plan.userIntent,/本次账号/);assert.equal(job.confirmedBy,'user-ui');assert.equal(job.startedVia,'user-ui-start');assert.equal(collections(),1);assert.equal(analyses(),4);assert.equal(maxInflight(),1);assert.equal((await service.listPlans()).plans.length,1);
 assert.deepEqual(job.actualUsage.providerCalls,{tikhub:5,accountList:1,mediaResolution:4,vl:4,asr:0});
});

test('request keys bind source, options, product, and trusted scope; same key cannot create another charge',async()=>{
 const {service,collections,analyses}=await setup(),scope={sessionId:'synthetic_session',workbenchId:'joho6666/video-replicate-studio'};
 const started=await service.startResearch(input(),scope);await service.waitForIdle();
 for(const change of [{product:'新商品'},{selectionPolicy:{mode:'latest',count:6}},{source:{kind:'account',url:'https://www.instagram.com/another_synthetic/'}}])await assert.rejects(service.startResearch(input(change),scope),{code:'RESEARCH_START_CONFLICT'});
 await assert.rejects(service.startResearch(input(),{...scope,sessionId:'other_session'}),{code:'RESEARCH_START_CONFLICT'});
 assert.equal((await service.startResearch(input(),scope)).jobId,started.jobId);assert.equal(collections(),1);assert.equal(analyses(),4);
});

test('start only permits same-origin UI and the account-study execution mode',async()=>{
 const {service,collections,analyses}=await setup();assert.equal((await service.handlers.start(request(input(),{origin:'https://foreign.test'}))).status,403);assert.equal((await service.handlers.start(request(input(),{header:false}))).status,403);
 for(const body of [input({requestId:''}),input({executionMode:'research'}),input({planId:'old_plan'}),input({source:{kind:'videos',urls:['https://www.instagram.com/reel/SINGLE_SYNTHETIC/']}})])assert.ok((await service.handlers.start(request(body))).status>=400);
 assert.equal(collections(),0);assert.equal(analyses(),0);assert.equal((await service.listPlans()).plans.length,0);
});

test('four through six are the only account-study counts; old plans stay at two and 2500 output tokens',async()=>{
 const {service,collections}=await setup();
 for(const count of [4,5,6]){const {plan}=await service.preparePlan({...input(),executionMode:'account-study',selectionPolicy:{mode:'latest',count}});assert.equal(plan.budgetScope.maxVideos,count);assert.equal(plan.budgetScope.maxAccountPages,1);assert.equal(plan.budgetScope.maxMetadataCandidates,12);assert.equal(plan.budgetScope.maxVlCalls,count);assert.equal(plan.budgetScope.maxAsrCalls,count);assert.equal(plan.budgetScope.maxResolveCalls,count);assert.equal(plan.budgetScope.vlMaxOutputTokens,8000);assert.equal(plan.pricingEstimate.asr.maxDurationSec,count*600);assert.equal(plan.pricingEstimate.tikhub.maxCalls,count+1);}
 for(const count of [0,1,2,3,7,12,4.5,'4'])await assert.rejects(service.preparePlan({...input(),executionMode:'account-study',selectionPolicy:{mode:'balanced',count}}),{code:'RESEARCH_SELECTION'});
 const old=await service.preparePlan({...input(),userIntent:'旧模式保持两条',executionMode:'research'});assert.equal(old.plan.budgetScope.maxVideos,2);assert.equal(old.plan.budgetScope.vlMaxOutputTokens,2500);
 await assert.rejects(service.preparePlan({...input(),userIntent:'不允许旧模式扩大',selectionPolicy:{mode:'latest',count:4}}),{code:'RESEARCH_SELECTION'});assert.equal(collections(),0);
});

test('one page is hard-clamped to twelve metadata rows, no expansion or replacement after a failure',async()=>{
 let collections=0,analyses=0;const {service,history}=await setup({collectAccount:async()=>{collections++;return{account,samples:rows(30).map((s,i)=>({...s,likes:i<12?s.likes:999999})),hasMore:true,collectedAt:now()};},analyzeVideo:async({record})=>{analyses++;if(analyses===2)throw Object.assign(Error('synthetic failure'),{code:'MOSI_TIMEOUT'});return resultFor(record);}});
 const started=await service.startResearch(input({selectionPolicy:{mode:'top-in-page',count:6}})),job=await service.waitForIdle(started.jobId);
 assert.equal(job.phase,'partial');assert.equal(collections,1);assert.equal(analyses,6);assert.equal(job.selectedRecordIds.length,6);assert.equal(job.results.length,5);assert.equal(job.coverage.candidateCount,12);assert.equal(job.coverage.maxMetadataCandidates,12);assert.equal(job.coverage.metadataTruncated,true);assert.equal(job.coverage.pagesFetched,1);assert.equal(job.coverage.completeAccountCoverage,false);assert.equal((await history.snapshot()).records.length,12);assert.ok(job.selectedRecordIds.every(id=>Number(id.split('_').at(-1))<12));
 await service.startResearch(input({selectionPolicy:{mode:'top-in-page',count:6}}));assert.equal(analyses,6);
});

test('balanced ranking covers metadata buckets while never calling them visual styles',()=>{
 const samples=rows(6).map((s,i)=>({...s,duration:i<3?10:i===3?25:45,likes:100-i,publishedAt:i===5?'2026-08-01T00:00:00Z':s.publishedAt}));samples.push({...rows(1)[0],url:'https://www.instagram.com/reel/UNKNOWN_METRIC/',likes:null});
 const balanced=selectResearchSamples(samples,{mode:'balanced',count:4,metric:'likes'},{now:now(),hasMore:true}),top=selectResearchSamples(samples,{mode:'top-in-page',count:4,metric:'likes'},{now:now()});
 assert.deepEqual(balanced.selected.map(s=>s.id),['ig_STUDY_0','ig_STUDY_3','ig_STUDY_4','ig_STUDY_5']);assert.deepEqual(top.selected.map(s=>s.id),['ig_STUDY_0','ig_STUDY_1','ig_STUDY_2','ig_STUDY_3']);assert.equal(balanced.coverage.visualDiversityVerified,false);assert.equal(balanced.coverage.selectionBasis,'metadata-only');assert.match(balanced.coverage.noteZh,/不代表视觉/);assert.equal(balanced.coverage.missingMetricCount,1);
});

test('all six results retain independent full packages even when their style names match',async()=>{
 const {service}=await setup(),started=await service.startResearch(input({selectionPolicy:{mode:'balanced',count:6}}));await service.waitForIdle();const report=await service.readResult(started);
 assert.equal(report.results.length,6);assert.equal(report.styleCandidates.length,6);assert.equal(report.accountSummary.sampleCount,6);assert.equal(report.accountSummary.styleGroups.length,1);assert.equal(report.accountSummary.styleGroups[0].recordIds.length,6);assert.deepEqual(report.accountSummary.tagsZh,['本次画面标签']);assert.equal(report.confirmedStyles.length,0);
 const chosen=report.styleCandidates[3],adopted=await service.confirmStyle({jobId:report.jobId,candidateId:chosen.candidateId});assert.deepEqual(adopted.style.recreationPackage,packageFor(chosen.recordIds[0]));assert.equal(adopted.style.immutable,true);assert.equal(adopted.style.evidenceStatus,'user-adopted-not-outcome-verified');
 chosen.recreationPackage.fullPromptText='CLIENT MUTATION';assert.notEqual((await service.confirmStyle({jobId:report.jobId,candidateId:chosen.candidateId})).style.recreationPackage.fullPromptText,'CLIENT MUTATION');assert.equal((await service.readResult(started)).confirmedStyles.length,1);
});

test('new request means independent output and no old intent, product, audience, tags or adopted style',async()=>{
 const {service,seenPlans}=await setup();const first=await service.startResearch(input({product:'旧商品',audience:'旧受众',userIntent:'旧想法'}));await service.waitForIdle();const firstReport=await service.readResult(first),adopted=await service.confirmStyle({jobId:first.jobId,candidateId:firstReport.styleCandidates[0].candidateId});
 const second=await service.startResearch(input({requestId:'new_request'}));await service.waitForIdle();assert.notEqual(second.planId,first.planId);assert.notEqual(second.jobId,first.jobId);const fresh=seenPlans.at(-1);assert.equal(fresh.product,'');assert.equal(fresh.audience,'');assert.equal(fresh.styleVersionId,null);assert.equal(fresh.styleVersionSnapshot,null);assert.notEqual(fresh.userIntent,'旧想法');const report=await service.readResult(second);assert.equal(report.results.length,4);assert.equal(report.confirmedStyles.length,0);assert.ok(report.styleCandidates.every(c=>c.sourceJobId===second.jobId));
 const explicit=await service.preparePlan({...input(),executionMode:'account-study',styleVersionId:adopted.style.styleVersionId,topicId:firstReport.topicId});assert.equal(explicit.plan.styleVersionSnapshot.recreationPackage.fullPromptText,adopted.style.recreationPackage.fullPromptText);
});

test('hidden and trashed records are excluded before selection and cannot leak through duplicate start or saved packages',async()=>{
 const {service,history}=await setup();await history.ingest({account,samples:rows(),collectedAt:now()});await history.mutate({action:'hide',ids:['ig_STUDY_0']});await history.mutate({action:'trash',ids:['ig_STUDY_1']});
 const started=await service.startResearch(input({selectionPolicy:{mode:'top-in-page',count:4}})),job=await service.waitForIdle(started.jobId);assert.ok(!job.selectedRecordIds.includes('ig_STUDY_0'));assert.ok(!job.selectedRecordIds.includes('ig_STUDY_1'));const old=(await history.snapshot({view:'all'})).records;assert.equal(old.find(r=>r.id==='ig_STUDY_0').hidden,true);assert.ok(old.find(r=>r.id==='ig_STUDY_1').trashedAt);
 await history.mutate({action:'hide',ids:[job.selectedRecordIds[0]]});await assert.rejects(service.startResearch(input({selectionPolicy:{mode:'top-in-page',count:4}})),{code:'RESEARCH_HIDDEN'});await assert.rejects(service.readResult(started),{code:'RESEARCH_HIDDEN'});assert.equal((await service.listPlans()).jobs.length,0);
});

test('only successful visual evidence contributes to account summary or per-video plans',async()=>{
 let n=0;const {service}=await setup({analyzeVideo:async({record})=>{n++;if(n===1)return{status:'partial',steps:{vl:{status:'failed'}},titleZh:'旧标题不得计入',tagsZh:['错误标签'],recommendations:[{nameZh:'错误分组'}]};return{...resultFor(record),status:n===2?'partial':'completed'};}});const started=await service.startResearch(input());await service.waitForIdle();const report=await service.readResult(started);assert.equal(report.status,'partial');assert.equal(report.accountSummary.sampleCount,3);assert.equal(report.styleCandidates.length,3);assert.ok(!JSON.stringify(report.accountSummary).includes('错误'));assert.equal(report.results.length,4);
});

test('durable start idempotency survives service restart and never reruns a completed request',async()=>{
 const {root,service}=await setup(),started=await service.startResearch(input());await service.waitForIdle();const restored=await mkdtemp(path.join(os.tmpdir(),'dsh-study-restored-'));await cp(root,restored,{recursive:true});let calls=0;
 const fresh=createResearchService({root:restored,history:createHistoryStore({root:restored}),now,collectAccount:async()=>{calls++;throw Error();},analyzeVideo:async()=>{calls++;throw Error();}});const duplicate=await fresh.startResearch(input());assert.equal(duplicate.jobId,started.jobId);assert.equal(duplicate.duplicate,true);await fresh.waitForIdle();assert.equal(calls,0);
});

test('share links remain pure until user start; single-video redirect cannot expand into an account study',async()=>{
 let resolved=0,paid=0;const {service}=await setup({resolveSource:async()=>{resolved++;return{kind:'video',url:'https://www.douyin.com/video/7372484719365098803'};},collectAccount:async()=>{paid++;},analyzeVideo:async()=>{paid++;}});const payload=input({source:{kind:'douyin-share',url:'https://v.douyin.com/SYNTHETIC/'},executionMode:'account-study'});await service.preparePlan(payload);assert.equal(resolved,0);assert.equal(paid,0);const started=await service.startResearch(payload),job=await service.waitForIdle(started.jobId);assert.equal(resolved,1);assert.equal(job.phase,'failed');assert.equal(job.error.code,'RESEARCH_SOURCE_KIND');assert.equal(paid,0);
});

test('editing an executing study invalidates remaining work without silently starting a replacement',async()=>{
 let entered,release;const begun=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let calls=0;const {service}=await setup({analyzeVideo:async({record})=>{calls++;entered();await gate;return resultFor(record);}});const started=await service.startResearch(input());await begun;
 await service.preparePlan({...input(),executionMode:'account-study',planId:started.planId,expectedRevision:started.planRevision,userIntent:'改为新的研究方向'});release();const job=await service.waitForIdle(started.jobId);assert.equal(job.phase,'cancelled');assert.equal(calls,1);assert.equal((await service.getPlan(started)).planRevision,2);assert.equal((await service.startResearch(input())).duplicate,true);assert.equal(calls,1);
});

test('two processes starting the same request share one durable account-list and video-work claim',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'dsh-study-processes-'));const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{readFile}=await import('node:fs/promises');const run=promisify(execFile);
 const serviceUrl=new URL('../src/research-service.mjs',import.meta.url).href,historyUrl=new URL('../src/history-store.mjs',import.meta.url).href;
 const script=`import {appendFile} from 'node:fs/promises';import {createHistoryStore} from ${JSON.stringify(historyUrl)};import {createResearchService} from ${JSON.stringify(serviceUrl)};const root=process.argv[1];const mark=async text=>appendFile(root+'/calls',text+'\\n');const service=createResearchService({root,history:createHistoryStore({root}),now:()=>${JSON.stringify(now())},collectAccount:async()=>{await mark('account');return {account:${JSON.stringify(account)},samples:${JSON.stringify(rows())}};},analyzeVideo:async({record})=>{await mark(record.id);return {status:'partial',steps:{vl:{status:'failed'}},tagsZh:[]};}});const started=await service.startResearch(${JSON.stringify(input())});await service.waitForIdle();process.stdout.write(started.jobId);`;
 const results=await Promise.all([run(process.execPath,['--input-type=module','-e',script,root]),run(process.execPath,['--input-type=module','-e',script,root])]);assert.equal(results[0].stdout,results[1].stdout);const calls=(await readFile(path.join(root,'calls'),'utf8')).trim().split('\n');assert.equal(calls.filter(c=>c==='account').length,1);assert.equal(calls.length,5);assert.equal(new Set(calls).size,5);
});

test('client-supplied budgets and prior plan fields cannot expand account-study scope or supported providers',async()=>{
 const {service,collections,analyses}=await setup();const payload={...input(),executionMode:'account-study',selectionPolicy:{mode:'latest',count:6},budgetScope:{maxVideos:999,maxAccountPages:100,vlMaxOutputTokens:99999,providers:['other']},styleVersionSnapshot:{nameZh:'伪造旧风格'},sourceCapability:{available:true}};
 const prepared=await service.preparePlan(payload);assert.equal(prepared.plan.budgetScope.maxVideos,6);assert.equal(prepared.plan.budgetScope.maxAccountPages,1);assert.equal(prepared.plan.budgetScope.vlMaxOutputTokens,8000);assert.deepEqual(prepared.plan.budgetScope.providers,['tikhub','mosi']);assert.equal(prepared.plan.styleVersionSnapshot,null);
 await assert.rejects(service.startResearch({...payload,source:{kind:'account',url:'https://example.com/unsupported'}}),{code:'RESEARCH_CAPABILITY'});assert.equal(collections(),0);assert.equal(analyses(),0);
 const changed=await service.preparePlan({...payload,planId:prepared.planId,expectedRevision:1,selectionPolicy:{mode:'latest',count:4}});assert.equal(changed.planRevision,2);assert.notEqual(changed.plan.planHash,prepared.plan.planHash);assert.equal(prepared.plan.budgetScope.maxVideos,6);assert.equal(changed.plan.budgetScope.maxVideos,4);
});
