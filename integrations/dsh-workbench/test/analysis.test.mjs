import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createMosiClient,MOSI_BASE_URL,MOSI_VISION_MODEL,MOSI_AUDIO_MODEL} from '../src/mosi-client.mjs';
import {createAnalysisService,applyAnalysisService,extractAnalysisAudio,ANALYSIS_API} from '../src/analysis-service.mjs';
import {createAnalysisStore} from '../src/analysis-store.mjs';
const recordId='ig_SYNTHETIC';
const json=value=>Response.json(value);
const request=(url,body,headers={})=>new Request('http://localhost'+url,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json','x-derek-workbench':'1'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
function vision(extra={}){return {status:'completed',model:'moss-vl-1.0-2026-07-08',usage:{input_tokens:12,output_tokens:23,total_tokens:35},output:[{content:[{type:'output_text',text:JSON.stringify({titleZh:'合成视频中文标题',summaryZh:'仅用于测试的画面摘要',tagsZh:['商品特写','快速切换'],visual:{summaryZh:'合成画面',observations:[{startSec:0,endSec:3,descriptionZh:'商品居中'}],structure:[{rangeZh:'0–3 秒',purposeZh:'开场展示'}]},rhythm:{modelInference:{summaryZh:'模型推断的节奏变化'}},styleSuggestions:[{nameZh:'特写展示',reasonZh:'画面证据',rulesZh:['固定构图'],caveatZh:'素材需核对'}]})}]}],...extra};}
async function fixture(t,{hasAudio=true,client:customClient,extract:customExtract}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'dsh-analysis-test-'));t.after(()=>rm(root,{recursive:true,force:true}));const run='synthetic-run',videoId='v1';await mkdir(path.join(root,run,videoId),{recursive:true});await writeFile(path.join(root,run,videoId,'source.mp4'),'synthetic video bytes');
 const report={runId:run,videos:[{id:videoId,file:'v1/source.mp4',title:'Original English title',duration:10,shots:[{start:0,end:3},{start:3,end:10}],medianShotSec:5,observation:'旧人工观察不能进入prompt'}]};await writeFile(path.join(root,run,'report.json'),JSON.stringify(report));
 const measure={measurement_kind:'local_machine_measurement_no_model_inference',media:{duration_seconds:10,has_audio:hasAudio,input_path:'/private/never-send-this-local-path'},shots:{intervals:[{start_seconds:0,end_seconds:3},{start_seconds:3,end_seconds:10}],statistics:{median_duration_seconds:5}},audio:{present:hasAudio,silence_ratio:0.25}};await writeFile(path.join(root,run,videoId,'measure.json'),JSON.stringify(measure));
 const record={id:recordId,hidden:false,trashedAt:null,reportRefs:[{runId:run,videoId}]},calls=[],attached=[];const history={snapshot:async({view})=>{assert.equal(view,'active');return {records:record.hidden||record.trashedAt?[]:[record]};},attachAnalysisMetadata:async(id,value)=>attached.push({id,value})};
 const client=customClient||{configured:async()=>true,transcribe:async()=>{calls.push('asr');return {model:MOSI_AUDIO_MODEL,text:'测试语音',segments:[{start:0,end:1,text:'测试语音',speaker:'speaker_0'}],usage:{duration_seconds:10}};},uploadVideo:async()=>{calls.push('upload');return {fileId:'file-test'};},analyzeVideo:async args=>{calls.push({vl:args});return vision();}};
 const extractAudio=customExtract||(async({directory,hasAudio:present})=>{calls.push('extract');if(present===false)return {hasAudio:false};const filePath=path.join(directory,'synthetic-audio.flac');await writeFile(filePath,'synthetic audio');return {hasAudio:true,filePath};});
 const service=createAnalysisService({root,history,client,extractAudio});return {root,run,videoId,record,report,measure,history,client,extractAudio,service,calls,attached};
}

test('official requests use expected multipart and one user video, secrets stay out of errors',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dsh-client-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const filePath=path.join(dir,'sample.mp4');await writeFile(filePath,'synthetic');const calls=[];
 const client=createMosiClient({keyProvider:async()=>'synthetic-test-key',keyStatusProvider:async()=>true,transport:async(url,options)=>{calls.push({url,authorization:options.headers.authorization,redirect:options.redirect,body:options.body});return json(url.endsWith('/files')?{id:'file-123',status:'processed'}:url.endsWith('/responses')?vision():{text:'',segments:[]});}});
 assert.equal(await client.configured(),true);assert.equal((await client.uploadVideo({filePath})).fileId,'file-123');await client.transcribe({filePath});await client.analyzeVideo({fileId:'file-123',prompt:'测试中文',maxOutputTokens:2500});
 assert.deepEqual(calls.map(c=>c.url),[MOSI_BASE_URL+'/files',MOSI_BASE_URL+'/audio/transcriptions',MOSI_BASE_URL+'/responses']);assert(calls.every(c=>c.redirect==='manual'));assert(calls.every(c=>c.authorization==='Bearer synthetic-test-key'));
 assert.equal(calls[0].body.get('purpose'),'video');assert.equal(await calls[0].body.get('file').text(),'synthetic');assert.equal(calls[1].body.get('model'),MOSI_AUDIO_MODEL);assert.equal(calls[1].body.get('response_format'),'diarized_json');assert.equal(calls[1].body.get('diarize'),'true');
 const payload=JSON.parse(calls[2].body);assert.equal(payload.model,MOSI_VISION_MODEL);assert.equal(payload.max_output_tokens,2500);assert.deepEqual(payload.input,[{role:'user',content:[{type:'input_text',text:'测试中文'},{type:'input_video',file_id:'file-123'}]}]);
 await assert.rejects(client.analyzeVideo({fileId:'file-123',prompt:'test',maxOutputTokens:8193}),/输入/);assert.equal(calls.length,3);
});
test('redirect, network and API errors are safe and never retried',async()=>{
 for(const mode of ['redirect','remote','network']){let count=0;const client=createMosiClient({keyProvider:async()=>'secret-never-log',transport:async()=>{count++;if(mode==='network')throw Error('secret-never-log /Users/private');return mode==='redirect'?new Response(null,{status:307,headers:{location:'https://attacker.example'}}):new Response('secret-never-log /Users/private',{status:401});}});await assert.rejects(client.analyzeVideo({fileId:'file-1',prompt:'test'}),error=>!String(error).includes('secret-never-log')&&!String(error).includes('/Users/private'));assert.equal(count,1);}
});
test('analysis persists ASR then VL, Chinese metadata, local measurement and usage',async t=>{
 const {service,root,run,calls,attached}=await fixture(t);const before=await readFile(path.join(root,run,'report.json'),'utf8');const started=await service.start({recordId,consent:true,intent:'观察开场设计'});assert.equal(started.status,'running');const state=await service.waitForIdle(recordId);
 assert.equal(state.status,'completed');assert.equal(state.cached,true);assert.equal(state.steps.asr.model,MOSI_AUDIO_MODEL);assert.equal(state.steps.vl.model,'moss-vl-1.0-2026-07-08');assert.deepEqual(state.steps.vl.usage,{input_tokens:12,output_tokens:23,total_tokens:35});assert.equal(state.result.titleZh,'合成视频中文标题');assert.equal(state.result.audio.segments[0].speaker,'speaker_0');assert.deepEqual(state.result.rhythm.measurements.candidateCutsSec,[3]);assert.equal(state.result.rhythm.measurements.medianShotSec,5);assert.equal(state.result.rhythm.modelInference.source,'mosi-vl-inference');assert.equal(state.result.styleSuggestions[0].status,'candidate-unverified');assert.equal(attached.length,1);assert.equal(attached[0].value.analysisRef.recordId,recordId);assert.equal(attached[0].value.displayTitleZh,state.result.titleZh);
 const prompt=calls.find(x=>x.vl).vl.prompt;assert(prompt.includes('观察开场设计'));assert(prompt.includes('不可信素材'));assert(!prompt.includes('旧人工观察'));assert(!prompt.includes('/private/'));assert.equal(await readFile(path.join(root,run,'report.json'),'utf8'),before);assert(!JSON.stringify(state).includes('file-test'));
});
test('double clicks and another service instance share a persistent lock; cached result does not call again',async t=>{
 const f=await fixture(t);const other=createAnalysisService({root:f.root,history:f.history,client:f.client,extractAudio:f.extractAudio});await Promise.all([f.service.start({recordId,consent:true}),other.start({recordId,consent:true}),f.service.start({recordId,consent:true})]);await f.service.waitForIdle(recordId);await other.waitForIdle(recordId);
 // Either instance can win the lock. Wait the winner before counting.
 const state=await f.service.get({recordId});assert.equal(state.status,'completed');assert.equal(f.calls.filter(x=>x==='asr').length,1);assert.equal(f.calls.filter(x=>x==='upload').length,1);assert.equal(f.calls.filter(x=>x.vl).length,1);
 const count=f.calls.length;assert.equal((await other.start({recordId,consent:true})).cached,true);assert.equal(f.calls.length,count);
 const mismatch=await f.service.start({recordId,consent:true,intent:'完全不同的重点'});assert.equal(mismatch.intentMismatch,true);assert.equal(mismatch.requiresExplicitReanalysis,true);assert.equal(mismatch.intent,'');assert.equal(f.calls.length,count);
});
test('failed VL keeps ASR result and usage and prevents all automatic repeated calls',async t=>{
 const f=await fixture(t);let count=0;f.client.analyzeVideo=async()=>{count++;throw Error('secret api key /private/path');};await f.service.start({recordId,consent:true});const failed=await f.service.waitForIdle(recordId);assert.equal(failed.status,'failed');assert.equal(failed.steps.asr.status,'completed');assert.equal(failed.steps.asr.result.text,'测试语音');assert.equal(failed.steps.vl.status,'failed');assert(!JSON.stringify(failed).includes('secret api'));await f.service.start({recordId,consent:true});await f.service.get({recordId});assert.equal(count,1);assert.equal(f.attached.length,0);
});
test('malformed or incomplete VL output retains usage without publishing metadata',async t=>{
 for(const result of [vision({status:'incomplete'}),vision({output:[{content:[{type:'output_text',text:'not json /private/leak'}]}]})]){const f=await fixture(t);f.client.analyzeVideo=async()=>result;await f.service.start({recordId,consent:true});const state=await f.service.waitForIdle(recordId);assert.equal(state.status,'failed');assert.equal(state.steps.vl.usage.total_tokens,35);assert.equal(f.attached.length,0);assert(!JSON.stringify(state).includes('/private/leak'));}
});
test('absent audio skips ASR and empty speech never becomes invented transcript',async t=>{
 for(const hasAudio of [false,true]){const f=await fixture(t,{hasAudio});let asrCalls=0;f.client.transcribe=async()=>{asrCalls++;return {text:'',segments:[]};};await f.service.start({recordId,consent:true});const state=await f.service.waitForIdle(recordId);assert.equal(state.status,'completed');assert.equal(state.result.audio.hasSpeech,false);assert.equal(state.result.audio.text,'');assert.deepEqual(state.result.audio.segments,[]);assert.equal(asrCalls,hasAudio?1:0);}
});
test('malformed ASR is failure, not a claim that video has no speech',async t=>{const f=await fixture(t);f.client.transcribe=async()=>({unexpected:'invalid'});await f.service.start({recordId,consent:true});const state=await f.service.waitForIdle(recordId);assert.equal(state.status,'failed');assert.equal(state.steps.vl.status,'pending');assert(!f.calls.includes('upload'));});
test('hidden and trashed records cannot start or disclose cached results',async t=>{
 for(const field of ['hidden','trashedAt']){const f=await fixture(t);await f.service.start({recordId,consent:true});await f.service.waitForIdle(recordId);f.record[field]=field==='hidden'?true:'2026-10-10T00:00:00Z';await assert.rejects(f.service.get({recordId}),/不可分析/);await assert.rejects(f.service.start({recordId,consent:true}),/不可分析/);}
});
test('missing local media, path traversal and symlink escape are rejected before model calls',async t=>{
 for(const scenario of ['missing','traversal','symlink','run-symlink']){const f=await fixture(t);const source=path.join(f.root,f.run,'v1/source.mp4');if(scenario==='missing')await rm(source);if(scenario==='traversal'){f.report.videos[0].file='../outside.mp4';await writeFile(path.join(f.root,f.run,'report.json'),JSON.stringify(f.report));}if(scenario==='symlink'){await rm(source);await symlink('/etc/hosts',source);}if(scenario==='run-symlink'){await rm(path.join(f.root,f.run),{recursive:true});await symlink('/etc',path.join(f.root,f.run));}await assert.rejects(f.service.start({recordId,consent:true}));assert.equal(f.calls.length,0);}
});
test('analysis-directory symlink escape is rejected and corrupt state fails closed',async t=>{
 const f=await fixture(t),outside=await mkdtemp(path.join(os.tmpdir(),'dsh-analysis-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));await symlink(outside,path.join(f.root,'analysis'));await assert.rejects(f.service.start({recordId,consent:true}),/目录/);assert.equal(f.calls.length,0);
 const clean=await fixture(t),store=createAnalysisStore({root:clean.root});const dir=await store.directory(recordId,true);await writeFile(path.join(dir,'state.json'),'broken json');await assert.rejects(clean.service.start({recordId,consent:true}),/停止/);assert.equal(clean.calls.length,0);
});
test('library metadata failure does not turn successful paid calls into repeat work',async t=>{const f=await fixture(t);f.history.attachAnalysisMetadata=async()=>{throw Error('private');};await f.service.start({recordId,consent:true});const state=await f.service.waitForIdle(recordId);assert.equal(state.status,'completed');assert.equal(state.libraryUpdated,false);const count=f.calls.length;await f.service.start({recordId,consent:true});assert.equal(f.calls.length,count);});
test('routes require consent and trusted request source, enforce size, and GET never infers',async t=>{
 const f=await fixture(t),h=f.service.handlers;let response=await h.status(request('/status'));const config=await response.json();assert.equal(config.configured,true);assert.equal(config.inferenceVerified,false);assert.equal(config.capabilities.videoGeneration,false);assert.equal(f.calls.length,0);
 assert.equal((await h.start(request('/',{recordId}))).status,400);assert.equal((await h.start(request('/',{recordId,consent:true},{origin:'https://attacker.example'}))).status,403);assert.equal((await h.start(request('/',{recordId,consent:true,intent:'x'.repeat(9000)}))).status,413);assert.equal((await h.status(request('/status?recordId='+recordId,undefined,{origin:'https://attacker.example'}))).status,403);assert.equal(f.calls.length,0);
 const bridge=new Request('http://dsh.internal/status',{headers:{host:'127.0.0.1:3210',origin:'http://127.0.0.1:3210'}});assert.equal((await h.status(bridge)).status,200);
 assert.equal((await h.start(request('/',{recordId,consent:true}))).status,202);await f.service.waitForIdle(recordId);assert.equal((await h.result(request('/result?recordId='+recordId))).status,200);
 const routes=[],ctx={connection:{fetch:{register:r=>routes.push(r)}}};applyAnalysisService(ctx,{root:f.root,history:f.history,client:f.client});applyAnalysisService(ctx,{root:f.root,history:f.history,client:f.client});assert.deepEqual(routes.map(r=>r.path),[ANALYSIS_API,ANALYSIS_API+'/status',ANALYSIS_API+'/result']);
});

test('hiding while VL is in flight prevents final metadata publication',async t=>{
 const f=await fixture(t);let finish,entered;const isRunning=new Promise(resolve=>{entered=resolve;});f.client.analyzeVideo=async()=>{entered();return new Promise(resolve=>{finish=resolve;});};await f.service.start({recordId,consent:true});await isRunning;f.record.hidden=true;finish(vision());await assert.rejects(f.service.waitForIdle(recordId),/不可分析/);const state=await createAnalysisStore({root:f.root}).read(recordId);assert.equal(state.status,'failed');assert.equal(state.steps.asr.status,'completed');assert.equal(f.attached.length,0);
});
test('interrupted durable state never initiates a new paid request',async t=>{const f=await fixture(t),store=createAnalysisStore({root:f.root});await store.write(recordId,{recordId,status:'running',provider:'mosi',steps:{asr:{status:'running'},vl:{status:'pending'}}});const state=await f.service.start({recordId,consent:true});assert.equal(state.status,'failed');assert.equal(state.error.code,'ANALYSIS_INTERRUPTED');assert.equal(f.calls.length,0);});
test('FFmpeg extracts a real synthetic local audio track and detects a trackless clip',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dsh-analysis-media-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const run=promisify(execFile),ffmpeg='/opt/homebrew/bin/ffmpeg';
 try{await run(ffmpeg,['-version']);}catch{t.skip('Synthetic media extraction requires installed FFmpeg');return;}
 const audible=path.join(dir,'with-audio.mp4'),silent=path.join(dir,'no-audio.mp4');await run(ffmpeg,['-hide_banner','-v','error','-f','lavfi','-i','color=c=black:s=32x32:d=0.3','-f','lavfi','-i','sine=frequency=440:duration=0.3','-c:v','libx264','-c:a','aac','-shortest',audible]);await run(ffmpeg,['-hide_banner','-v','error','-f','lavfi','-i','color=c=black:s=32x32:d=0.3','-c:v','libx264','-an',silent]);
 const audio=await extractAnalysisAudio({videoPath:audible,directory:dir,hasAudio:null});assert.equal(audio.hasAudio,true);assert.equal((await readFile(audio.filePath)).subarray(0,4).toString(),'fLaC');assert.deepEqual(await extractAnalysisAudio({videoPath:silent,directory:dir,hasAudio:null}),{hasAudio:false});
});
