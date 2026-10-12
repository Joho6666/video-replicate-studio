import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createBenchmarkRouter} from '../lib/benchmark-router.mjs';
import {createHistoryStore} from '../lib/history-store.mjs';
import {Readable} from 'node:stream';
import {toWebRequest} from '../lib/benchmark-http.mjs';
const account={username:'examplebrand',url:'https://www.instagram.com/examplebrand/'};
const sample={url:'https://www.instagram.com/reel/EXAMPLE_A/?utm_source=synthetic',title:'Synthetic product motion',likes:0,views:42,duration:8,collectedAt:'2026-10-10T00:00:00Z'};
const payload=()=>({account,samples:[{...sample}],collectedAt:'2026-10-10T00:00:00Z',provider:'synthetic',status:'metadata-only'});
const report=()=>({schemaVersion:1,accountUrl:account.url,source:'offline synthetic fixture',analyzedAt:'2026-10-10T00:00:00Z',types:[{type:'Sample form',tone:'unverified',rhythm:'unverified',hook:'sample hook',subtitles:'unknown',reason:'synthetic reason',editPlan:'sample edit',replicaPlan:'sample plan',requiredAssets:['product closeup'],evidence:[{url:'https://www.instagram.com/reel/EXAMPLE_A/',start:0,end:2,observation:'synthetic'},{url:'https://www.instagram.com/reel/EXAMPLE_B/',start:0,end:2,observation:'synthetic'}]}]});
async function setup(t){const root=await mkdtemp(path.join(os.tmpdir(),'studio-benchmark-test-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
const request=(route,body,headers={})=>new Request('http://127.0.0.1:3219/api/benchmark/'+route,{method:body===undefined?'GET':'POST',headers:body===undefined?headers:{'content-type':'application/json','x-studio':'1',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});

test('archive survives restart and duplicate collection preserves organization choices',async t=>{
 const root=await setup(t),first=createHistoryStore({root});await first.ingest(payload());
 const id=(await first.snapshot()).records[0].id;
 await first.mutate({action:'edit',ids:[id],title:'My saved title',notes:'Reusable cue',tags:['reference']});
 await first.mutate({action:'reviewed',ids:[id],value:true});
 await first.mutate({action:'favorite',ids:[id],value:true});
 await first.ingest({...payload(),samples:[{...sample,url:'https://instagram.com/p/EXAMPLE_A/'}]});
 const saved=await createHistoryStore({root}).snapshot();assert.equal(saved.records.length,1);assert.equal(saved.records[0].title,'My saved title');assert.equal(saved.records[0].reviewed,true);assert.equal(saved.records[0].favorite,true);
 assert(!JSON.stringify(saved).includes('utm_source'));
});

test('HTTP hide, trash and restore preserve visibility and filter account cache',async t=>{
 const root=await setup(t),router=createBenchmarkRouter({root});await router.store.ingest(payload());const id=(await router.store.snapshot()).records[0].id;
 assert.equal((await router.fetch(request('history',{action:'hide',ids:[id]}))).status,200);
 const cached=await (await router.fetch(request('samples',{url:account.url}))).json();assert.equal(cached.fromCache,true);assert.equal(cached.samples.length,0);
 assert.equal((await (await router.fetch(request('history?view=active'))).json()).records.length,0);
 assert.equal((await (await router.fetch(request('history?view=hidden'))).json()).records.length,1);
 await router.fetch(request('history',{action:'trash',ids:[id]}));assert.equal((await router.store.snapshot({view:'trash'})).records.length,1);
 await router.fetch(request('history',{action:'restore',ids:[id]}));assert.equal((await router.store.snapshot()).records.length,0);assert.equal((await router.store.snapshot({view:'hidden'})).records.length,1);
 await router.fetch(request('history',{action:'unhide',ids:[id]}));assert.equal((await router.store.snapshot()).records.length,1);
});

test('service rejects missing headers and cross-origin writes before changing history',async t=>{
 const root=await setup(t),router=createBenchmarkRouter({root});await router.store.ingest(payload());const id=(await router.store.snapshot()).records[0].id;
 const unauthorized=new Request('http://127.0.0.1:3219/api/benchmark/history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'trash',ids:[id]})});
 assert.equal((await router.fetch(unauthorized)).status,403);
 assert.equal((await router.fetch(request('history',{action:'trash',ids:[id]},{origin:'https://external.invalid'}))).status,403);
 assert.equal((await router.store.snapshot()).records.length,1);
});

test('old external reports persist as unverified, with hidden references withheld',async t=>{
 const root=await setup(t),router=createBenchmarkRouter({root});const saved=await router.fetch(request('history/import-legacy',{...payload(),report:report(),goal:'sample target'}));assert.equal(saved.status,200);
 const records=(await router.store.snapshot()).records;assert.equal(records.length,2);const importedId=records[0].importedReportIds[0];
 const reader=createBenchmarkRouter({root});let result=await reader.fetch(request('history/imported-report?id='+importedId));assert.equal(result.status,200);assert.equal((await result.json()).status,'imported-unverified');
 assert.equal((await reader.store.findAccountCache(account.username)).report.source,'offline synthetic fixture');
 await reader.store.mutate({action:'hide',ids:[records[0].id]});result=await reader.fetch(request('history/imported-report?id='+importedId));assert.equal(result.status,409);assert.equal((await reader.store.findAccountCache(account.username)).report,null);
});

test('feedback stays user-reported and weekly review provenance survives restart',async t=>{
 const root=await setup(t),store=createHistoryStore({root});await store.ingest(payload());const id=(await store.snapshot()).records[0].id;
 await store.mutate({action:'feedback',ids:[id],outcome:'success',note:'I like the pacing',evidence:'Manual observation, no independent validation'});
 const periodStart=new Date(Date.now()-86400000).toISOString(),periodEnd=new Date(Date.now()+86400000).toISOString();
 const source=await store.exportReviewSource({periodStart,periodEnd});assert.equal(source.generationEnabled,false);assert.equal(source.records[0].feedback[0].evidenceStatus,'user-reported-unverified');
 const saved=await store.saveReview({periodStart,periodEnd,kind:'local-summary',sourceRevision:source.revision,recordIds:[id],feedbackIds:source.feedbackIds,markdown:'Synthetic weekly review. No independently verified best practice.'});
 const reopened=createHistoryStore({root});assert.match((await reopened.readReview(saved.review.id)).markdown,/No independently verified/);
 await reopened.mutate({action:'hide',ids:[id]});await assert.rejects(reopened.readReview(saved.review.id),e=>e.status===409);
 assert.equal((await reopened.exportReviewSource({periodStart,periodEnd})).records.length,0);
});

test('corrupt state stops writes and leaves source bytes untouched',async t=>{
 const root=await setup(t),folder=path.join(root,'library');await mkdir(folder);const target=path.join(folder,'state.json');await writeFile(target,'{broken');
 await assert.rejects(createHistoryStore({root}).ingest(payload()),/损坏/);assert.equal(await readFile(target,'utf8'),'{broken');
});

test('Node adapter limits body size and carries trusted same-origin mutation header',async()=>{
 const req=Readable.from([Buffer.from('{}')]);req.url='/api/benchmark/history';req.method='POST';req.headers={host:'127.0.0.1:3219','x-studio':'1','content-type':'application/json'};
 const web=await toWebRequest(req);assert.equal(web.headers.get('x-derek-workbench'),'1');assert.equal(await web.text(),'{}');
 const large=Readable.from([Buffer.alloc(20)]);large.url='/api/benchmark/history';large.method='POST';large.headers={host:'127.0.0.1:3219'};await assert.rejects(toWebRequest(large,{limit:10}),e=>e.status===413);
});

test('actual loopback HTTP route persists metadata without loading Studio env or external APIs',async t=>{
 const {createServer}=await import('node:http'),root=await setup(t),router=createBenchmarkRouter({root});
 const server=createServer((req,res)=>router.route(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}}).catch(error=>{res.writeHead(error.status||500);res.end('test route failed');}));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port+'/api/benchmark';
 let response=await fetch(base+'/history/import-legacy',{method:'POST',headers:{'content-type':'application/json','x-studio':'1',origin:'http://127.0.0.1:'+server.address().port},body:JSON.stringify(payload())});
 assert.equal(response.status,200);
 response=await fetch(base+'/history');assert.equal(response.status,200);assert.equal((await response.json()).records.length,1);
 response=await fetch(base+'/samples',{method:'POST',headers:{'content-type':'application/json','x-studio':'1'},body:JSON.stringify({url:account.url})});assert.equal(response.status,200);assert.equal((await response.json()).fromCache,true);
});
