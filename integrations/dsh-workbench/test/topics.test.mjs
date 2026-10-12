import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHistoryStore} from '../src/history-store.mjs';
import {createHistoryHandlers} from '../src/history-service.mjs';

const sample=(code,title=`Original caption ${code}`)=>({url:`https://www.instagram.com/reel/${code}/`,title});
const payload=(samples,username='examplebrand')=>({account:username?{username}:null,samples,collectedAt:'2026-10-01T00:00:00Z',provider:'synthetic-only'});
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'topics-synthetic-'));t.after(()=>rm(root,{recursive:true,force:true}));return{root,store:createHistoryStore({root})};}
const metadata=(id,extra={})=>({displayTitleZh:'透明手机壳的耐摔展示',summaryZh:'以连续落地画面展示手机壳的保护表现。',autoTagsZh:['产品演示','产品演示','耐摔'],analysisRef:{recordId:id,analysisId:'synthetic_analysis',provider:'mosi',model:'synthetic-only',completedAt:'2026-10-10T00:00:00Z'},...extra});

test('old state upgrades into account groups once and persists original titles',async t=>{
 const{root,store}=await fixture(t);await store.ingest(payload([sample('BrandA')]));await store.ingest(payload([sample('BrandB')],'secondbrand'));await store.ingest(payload([sample('Loose')],null));
 const file=path.join(root,'library/state.json'),old=JSON.parse(await readFile(file,'utf8'));
 delete old.topics;for(const record of old.records)delete record.originalTitle;delete old.records.find(r=>r.id==='ig_Loose').account;await writeFile(file,JSON.stringify(old));
 const upgraded=await createHistoryStore({root}).snapshot();
 assert.equal(upgraded.revision,old.revision+1);assert.equal(upgraded.records.length,3);
 assert.deepEqual(upgraded.topics.map(t=>[t.title,t.kind,t.automatic]).sort(),[['examplebrand','brand',true],['secondbrand','brand',true],['未分组参考','topic',true]].sort());
 assert.deepEqual(upgraded.records.map(r=>[r.title,r.originalTitle]),upgraded.records.map(r=>[r.title,r.title]));
 const persisted=JSON.parse(await readFile(file,'utf8'));assert.equal(persisted.topics.length,3);assert.equal(persisted.records.find(r=>r.id==='ig_Loose').account,null);
 assert.equal((await createHistoryStore({root}).snapshot()).revision,upgraded.revision);
});

test('duplicate URLs stay one record and do not manufacture analysis or topic memberships',async t=>{
 const{store}=await fixture(t);const input=sample('Repeat');await store.ingest(payload([input,{...input,url:'https://www.instagram.com/p/Repeat/?tracking=1',displayTitleZh:'伪造翻译',analysisRef:{provider:'forged'},topicIds:['fake']}]));await store.ingest(payload([input]));
 const snap=await store.snapshot();assert.equal(snap.records.length,1);assert.equal(snap.batches.length,1);assert.equal(snap.topics.length,1);assert.deepEqual(snap.topics[0].recordIds,['ig_Repeat']);assert.equal(snap.records[0].analysisRef,undefined);assert.equal(snap.records[0].displayTitleZh,undefined);
});

test('manual topics support rename, many-to-many links, and moves that survive reimport',async t=>{
 const{root,store}=await fixture(t);await store.ingest(payload([sample('First'),sample('Second')]));
 const first=(await store.mutate({action:'create-topic',title:'展示手法',ids:['ig_First','ig_First']})).topic;
 const second=(await store.mutate({action:'create-topic',title:'包装细节',kind:'brand'})).topic;
 await store.mutate({action:'rename-topic',topicId:second.id,title:'开箱参考'});await store.mutate({action:'link-topic',topicId:second.id,ids:['ig_First']});
 let snap=await store.snapshot();assert.equal(snap.records.length,2);assert.equal(snap.topics.filter(t=>t.recordIds.includes('ig_First')).length,3);
 await store.mutate({action:'move-topic',topicId:second.id,ids:['ig_First']});await store.ingest(payload([sample('First')]));snap=await createHistoryStore({root}).snapshot();
 assert.equal(snap.topics.filter(t=>t.recordIds.includes('ig_First')).length,1);assert.deepEqual(snap.topics.find(t=>t.id===second.id).recordIds,['ig_First']);assert.equal(snap.topics.find(t=>t.id===second.id).title,'开箱参考');assert.deepEqual(snap.topics.find(t=>t.id===first.id).recordIds,[]);
 assert.deepEqual(snap.topics.find(t=>t.automatic).recordIds,['ig_Second']);
});

test('topic references and counts are restricted to each view and search result',async t=>{
 const{store}=await fixture(t);await store.ingest(payload([sample('Active'),sample('Hidden'),sample('Trash')]));
 const topic=(await store.mutate({action:'create-topic',title:'混合专题',ids:['ig_Active','ig_Hidden','ig_Trash']})).topic;
 await store.mutate({action:'favorite',ids:['ig_Hidden'],value:true});await store.mutate({action:'reviewed',ids:['ig_Trash'],value:true});await store.mutate({action:'hide',ids:['ig_Hidden']});await store.mutate({action:'trash',ids:['ig_Trash']});
 for(const [view,id,reviewed,favorite] of [['active','ig_Active',0,0],['hidden','ig_Hidden',0,1],['trash','ig_Trash',1,0]]){
  const snap=await store.snapshot({view}),current=snap.topics.find(t=>t.id===topic.id);
  assert.deepEqual(current.recordIds,[id]);assert.deepEqual(current.counts,{total:1,reviewed,favorite});assert.equal(current.recordCount,1);
  for(const item of snap.topics)assert(item.recordIds.every(recordId=>snap.records.some(r=>r.id===recordId)));
 }
 const search=await store.snapshot({q:'nonmatching'});assert.equal(search.records.length,0);assert.equal(search.topics.length,1);assert.deepEqual(search.topics[0].counts,{total:0,reviewed:0,favorite:0});
});

test('fully hidden or trashed automatic groups disappear while empty manual topics remain',async t=>{
 const{store}=await fixture(t);await store.ingest(payload([sample('PrivateBrand')],'privatebrand'));await store.ingest(payload([sample('PublicBrand')],'publicbrand'));
 const manual=(await store.mutate({action:'create-topic',title:'待补充参考'})).topic;await store.mutate({action:'hide',ids:['ig_PrivateBrand']});await store.mutate({action:'trash',ids:['ig_PublicBrand']});
 const active=await store.snapshot();assert.equal(active.topics.length,1);assert.equal(active.topics[0].id,manual.id);assert.deepEqual(active.topics[0].recordIds,[]);assert(!JSON.stringify(active.topics).includes('privatebrand'));assert(!JSON.stringify(active.topics).includes('publicbrand'));
 assert.equal((await store.snapshot({view:'hidden'})).topics.find(t=>t.automatic).title,'privatebrand');assert.equal((await store.snapshot({view:'trash'})).topics.find(t=>t.automatic).title,'publicbrand');
 await store.ingest(payload([sample('PrivateBrand')],'privatebrand'));assert.equal((await store.snapshot()).records.length,0);assert.equal((await store.findAccountCache('privatebrand')).samples.length,0);
});

test('service analysis metadata preserves source caption and is searchable independently',async t=>{
 const{root,store}=await fixture(t);await store.ingest(payload([sample('Analyzed','Unchanged English caption')],null));await store.attachAnalysisMetadata('ig_Analyzed',metadata('ig_Analyzed'));
 const record=(await createHistoryStore({root}).snapshot()).records[0];assert.equal(record.title,'Unchanged English caption');assert.equal(record.originalTitle,'Unchanged English caption');assert.equal(record.displayTitleZh,'透明手机壳的耐摔展示');assert.deepEqual(record.autoTagsZh,['产品演示','耐摔']);assert.equal(record.status.analysis,'available');assert.equal(record.analysisRef.provider,'mosi');assert.equal(record.displayTitleSource,'analysis');
 assert.equal((await store.snapshot({q:'耐摔'})).records.length,1);assert.equal((await store.snapshot({q:'Unchanged English'})).records.length,1);
});

test('explicit user title wins over later analysis and reimport preserves original caption',async t=>{
 const{store}=await fixture(t);await store.ingest(payload([sample('Named','First original caption')]));await store.mutate({action:'edit',ids:['ig_Named'],displayTitleZh:'我的中文标题'});await store.attachAnalysisMetadata('ig_Named',metadata('ig_Named'));await store.ingest(payload([sample('Named','Changed remote caption')]));
 let record=(await store.snapshot()).records[0];assert.equal(record.displayTitleZh,'我的中文标题');assert.equal(record.title,'First original caption');assert.equal(record.originalTitle,'First original caption');assert.equal(record.displayTitleSource,'user');assert.equal(record.summaryZh,metadata('ig_Named').summaryZh);
 await store.mutate({action:'edit',ids:['ig_Named'],title:'旧界面的自定名'});await store.attachAnalysisMetadata('ig_Named',metadata('ig_Named'));record=(await store.snapshot()).records[0];assert.equal(record.title,'旧界面的自定名');assert.equal(record.displayTitleZh,'旧界面的自定名');assert.equal(record.originalTitle,'First original caption');
});

test('client mutation cannot forge AI metadata or provenance, and service references are allowlisted',async t=>{
 const{store}=await fixture(t);await store.ingest(payload([sample('Trusted')]));
 await assert.rejects(store.mutate({action:'save-analysis-metadata',ids:['ig_Trusted'],...metadata('ig_Trusted')}),/不支持/);
 const handlers=createHistoryHandlers({store}),response=await handlers.mutate(new Request('http://localhost/history',{method:'POST',headers:{'x-derek-workbench':'1'},body:JSON.stringify({action:'save-analysis-metadata',ids:['ig_Trusted'],...metadata('ig_Trusted')})}));assert.equal(response.status,400);
 await store.mutate({action:'edit',ids:['ig_Trusted'],summaryZh:'伪造摘要',autoTagsZh:['伪造'],analysisRef:metadata('ig_Trusted').analysisRef,displayTitleSource:'analysis'});let record=(await store.snapshot()).records[0];assert.equal(record.summaryZh,undefined);assert.equal(record.analysisRef,undefined);
 const valid=metadata('ig_Trusted');valid.analysisRef.token='secret';valid.analysisRef.localPath='/private/secret';valid.hidden=true;await store.attachAnalysisMetadata('ig_Trusted',valid);record=(await store.snapshot()).records[0];assert.equal(record.hidden,false);assert.equal(record.analysisRef.token,undefined);assert.equal(record.analysisRef.localPath,undefined);
 await assert.rejects(store.attachAnalysisMetadata('ig_Trusted',metadata('ig_Other')),/来源引用/);
});

test('invalid topic mutations are atomic and corrupt topic references never overwrite state',async t=>{
 const{root,store}=await fixture(t);await store.ingest(payload([sample('Valid')]));const before=await store.snapshot();
 await assert.rejects(store.mutate({action:'create-topic',title:'',ids:['ig_Valid']}),/名称/);await assert.rejects(store.mutate({action:'create-topic',title:'未知引用',ids:['ig_Missing']}),/不存在/);assert.equal((await store.snapshot()).revision,before.revision);
 const file=path.join(root,'library/state.json'),state=JSON.parse(await readFile(file,'utf8'));state.topics[0].recordIds.push('ig_Missing');const broken=JSON.stringify(state);await writeFile(file,broken);
 await assert.rejects(createHistoryStore({root}).snapshot(),error=>error.code==='HISTORY_CORRUPT');assert.equal(await readFile(file,'utf8'),broken);
});
