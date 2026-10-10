import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountHandlers, privateTikHubFetch, readTikHubKey} from '../src/account-service.mjs';
const key='test-secret-not-real-12345';
const input={url:'https://www.instagram.com/casekooofficial/',consent:true};
const req=(body=input,headers={})=>new Request('http://localhost:43129/api/derek-video-replicate/account/samples',{method:'POST',headers:{'x-derek-workbench':'1',...headers},body:JSON.stringify(body)});
test('status reports configuration without returning credentials or claiming analysis',async()=>{
 const handlers=createAccountHandlers({getKey:async()=>key});
 const response=await handlers.status();const text=await response.text();assert(!text.includes(key));
 assert.deepEqual(JSON.parse(text),{provider:'TikHub',configured:true,storage:'macOS Keychain',sampleLimit:12,analysisConnected:false});
 assert.equal((await (await createAccountHandlers({getKey:async()=>{throw Error(key)}}).status()).json()).configured,false);
});
test('invalid origins, missing header, consent, null and oversized input cannot call provider',async()=>{
 let calls=0;const h=createAccountHandlers({getKey:async()=>{calls++;return key},fetchImpl:async()=>{calls++;}});
 for(const [request,status] of [[req(input,{'x-derek-workbench':''}),403],[req(input,{origin:'https://elsewhere.test'}),403],[req({url:input.url}),400],[req(null),400],[req({...input,extra:'x'.repeat(4100)}),413]])assert.equal((await h.samples(request)).status,status);
 assert.equal(calls,0);
});
test('402 is actionable, has no samples or secrets and does not retry',async()=>{
 let calls=0;const h=createAccountHandlers({getKey:async()=>key,fetchImpl:async()=>{calls++;return new Response(key,{status:402})}});
 const r=await h.samples(req());assert.equal(r.status,502);const body=await r.json();assert.equal(body.providerStatus,402);assert.match(body.error,/余额不足/);assert(!JSON.stringify(body).includes(key));assert(!body.samples);assert.equal(calls,1);
});
test('single in-flight request gate releases after success',async()=>{
 let finish;const pending=new Promise(r=>finish=r);const h=createAccountHandlers({getKey:async()=>key,fetchImpl:async()=>{await pending;return Response.json({code:200,data:{edges:[]}})}});
 const first=h.samples(req());await new Promise(r=>setTimeout(r,0));assert.equal((await h.samples(req())).status,409);finish();assert.equal((await first).status,200);assert.equal((await h.samples(req())).status,200);
});
test('private transport passes credentials via stdin only and does not follow redirects',async()=>{
 let seen;const response=await privateTikHubFetch('https://api.tikhub.io/api/v1/test',{headers:{Authorization:`Bearer ${key}`}},async(...args)=>{seen=args;return '{}\n402'});
 assert.equal(response.status,402);assert(!seen[1].join(' ').includes(key));assert(seen[2].includes(key));assert(!seen[1].includes('-L'));assert(!seen[1].includes('--location'));
 await assert.rejects(privateTikHubFetch('https://evil.test/',{headers:{Authorization:`Bearer ${key}`}}),/不支持/);
});
test('keychain errors never expose subprocess diagnostics',async()=>{
 await assert.rejects(readTikHubKey(async()=>{throw Error(key)}),e=>e.status===503&&!e.message.includes(key));
 assert.equal(await readTikHubKey(async()=>key+'\n'),key);
});

test('full backend uses one registration per exact DSH route',async()=>{
 const {applyAccountService}=await import('../src/account-service.mjs');const paths=new Set();const routes=[];
 applyAccountService({on:()=>()=>{},tools:{register:()=>{}},desktopWorkbenchOwnership:{read:()=>({sessionBindings:{}})},effect:f=>f(),connection:{fetch:{register:route=>{assert(!paths.has(route.path),'duplicate path rejected by DSH');paths.add(route.path);routes.push(route);}}}});
 for(const suffix of ['/analysis','/analysis/status','/analysis/result'])assert(paths.has('/api/derek-video-replicate'+suffix));assert.deepEqual(routes.find(r=>r.path.endsWith('/models')).methods,['GET','POST']);
});

test('history reads never call credentials/provider; refresh alone needs consent',async()=>{
 let calls=0,ingested=0;const store={findAccountCache:async()=>({samples:[],cached:true}),ingest:async()=>{ingested++}};
 const h=createAccountHandlers({store,getKey:async()=>{calls++;return key},fetchImpl:async()=>{calls++;return Response.json({code:200,data:{edges:[]}})}});
 assert.equal((await h.samples(req({url:input.url}))).status,200);assert.equal(calls,0);
 assert.equal((await h.samples(req({url:input.url,refresh:true}))).status,400);assert.equal(calls,0);
 assert.equal((await h.samples(req({...input,refresh:true}))).status,200);assert.equal(calls,2);assert.equal(ingested,1);
 store.findAccountCache=async()=>null;assert.equal((await h.samples(req({url:input.url}))).status,428);assert.equal(calls,2);
});

test('refresh keeps hidden and trashed videos out of account results after real archive ingestion',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {createHistoryStore}=await import('../src/history-store.mjs');
 const root=await mkdtemp(path.join(os.tmpdir(),'dsh-refresh-visibility-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const account={username:'examplebrand',url:'https://www.instagram.com/examplebrand/'};
 const codes=['SYNTH_HIDDEN','SYNTH_TRASH','SYNTH_VISIBLE'];
 const samples=codes.map(code=>({url:`https://www.instagram.com/reel/${code}/`,title:code}));
 const store=createHistoryStore({root});await store.ingest({account,samples,collectedAt:new Date().toISOString()});
 await store.mutate({action:'hide',ids:['ig_SYNTH_HIDDEN']});await store.mutate({action:'trash',ids:['ig_SYNTH_TRASH']});
 let calls=0;const h=createAccountHandlers({store,getKey:async()=>key,fetchImpl:async()=>{calls++;return Response.json({data:{edges:codes.map(code=>({node:{code,is_video:true,owner:{username:'examplebrand'},caption_text:code}}))}});}});
 const response=await h.samples(req({url:account.url,refresh:true,consent:true}));assert.equal(response.status,200);const body=await response.json();
 assert.deepEqual(body.samples.map(s=>s.title),['SYNTH_VISIBLE']);assert.equal(body.cached,false);assert.equal(body.persisted,true);assert.equal(body.hiddenCount,1);assert.equal(body.trashedCount,1);assert.equal(calls,1);
 assert.equal((await store.snapshot({view:'hidden'})).records.length,1);assert.equal((await store.snapshot({view:'trash'})).records.length,1);
});

test('post-refresh history failure never returns unfiltered provider samples',async()=>{
 for(const read of [async()=>null,async()=>{throw Error('synthetic disk failure');}]){
  const h=createAccountHandlers({store:{ingest:async()=>{},findAccountCache:read},getKey:async()=>key,fetchImpl:async()=>Response.json({data:{edges:[{node:{code:'DO_NOT_REVEAL',is_video:true,caption_text:'unfiltered sample'}}]}})});
  const response=await h.samples(req({...input,refresh:true}));assert.equal(response.status,503);const body=await response.json();assert(!body.samples);assert(!JSON.stringify(body).includes('unfiltered sample'));
 }
});

test('Douyin account reads use platform identity and refresh makes one AppV3 list request',async t=>{const {mkdtemp,rm}=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{createHistoryStore}=await import('../src/history-store.mjs');const root=await mkdtemp(path.join(os.tmpdir(),'dsh-douyin-account-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=createHistoryStore({root}),secUid='MS4wLjAB_SYNTHETIC_Douyin_Account_123456789',url='https://www.douyin.com/user/'+secUid;let credentialReads=0,calls=0;const h=createAccountHandlers({store,getKey:async()=>{credentialReads++;return key;},fetchImpl:async endpoint=>{calls++;assert.equal(new URL(endpoint).pathname,'/api/v1/douyin/app/v3/fetch_user_post_videos');return Response.json({data:{aweme_list:[{aweme_id:'7372484719365098803',aweme_type:0,desc:'合成抖音标题',author:{sec_uid:secUid,nickname:'合成品牌'},video:{duration:10500},create_time:1791504000,statistics:{digg_count:10}}],has_more:1}});}});assert.equal((await h.samples(req({url}))).status,428);assert.equal(credentialReads,0);assert.equal((await h.samples(req({url,refresh:true}))).status,400);assert.equal(calls,0);const fresh=await h.samples(req({url,refresh:true,consent:true}));assert.equal(fresh.status,200);const body=await fresh.json();assert.equal(body.account.platform,'Douyin');assert.equal(body.account.secUid,secUid);assert.equal(body.samples.length,1);assert.equal(calls,1);const read=await h.samples(req({url}));assert.equal(read.status,200);assert.equal(calls,1);assert.equal(credentialReads,1);const id=(await store.snapshot()).records[0].id;await store.mutate({action:'hide',ids:[id]});assert.equal((await (await h.samples(req({url}))).json()).samples.length,0);assert.equal(calls,1);});
test('Douyin short share links are rejected without reading credentials or resolving externally',async()=>{let calls=0;const h=createAccountHandlers({getKey:async()=>{calls++;return key;},fetchImpl:async()=>{calls++;}});const response=await h.samples(req({url:'https://v.douyin.com/SYNTHETIC/',refresh:true,consent:true}));assert.equal(response.status,400);assert.match((await response.json()).error,/完整/);assert.equal(calls,0);});
