import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInstagram,validateAccountReport} from '../public/account-core.js';
import {fetchAccountSamples,normalizeAccountSamples} from '../lib/account-benchmark.mjs';
const account=parseInstagram('https://instagram.com/brand/');
const response=()=>({code:200,data:{edges:[{node:{media:{code:'abc',media_type:2,caption:{text:'caption'},user:{username:'brand'},like_count:0,video_duration:8}}}],page_info:{has_next_page:true}}});
test('profile parser separates videos and rejects deceptive URLs',()=>{assert.equal(parseInstagram('https://instagram.com/Brand/reels/?x=1').url,account.url);assert.equal(parseInstagram('https://instagram.com/reel/abc/').kind,'video');for(const u of ['http://instagram.com/brand/','https://instagram.com.evil/brand/','https://instagram.com@evil/brand/','https://instagram.com/accounts/login/'])assert.equal(parseInstagram(u),null);});
test('samples have bounded metadata, zero is not unknown, no invented analysis',()=>{const raw=response();raw.data.edges.push(...Array.from({length:30},(_,i)=>({node:{media:{code:`v${i}`,media_type:2}}})));const r=normalizeAccountSamples(raw,account);assert.equal(r.samples.length,12);assert.equal(r.samples[0].likes,0);assert.equal(r.samples[0].views,null);assert.equal(r.status,'metadata-only');assert(!r.samples[0].tone);assert.equal(r.hasMore,true);});
test('business errors and malformed data do not become successful empty accounts',()=>{assert.throws(()=>normalizeAccountSamples({code:429,data:{edges:[]}},account));assert.throws(()=>normalizeAccountSamples({code:200,data:{}},account));assert.equal(normalizeAccountSamples({data:{edges:[]}},account).samples.length,0);});
test('excludes photos, duplicate and mismatched-owner records',()=>{const raw=response();raw.data.edges.push(raw.data.edges[0],{node:{media:{code:'pic',media_type:1}}},{node:{media:{code:'other',media_type:2,user:{username:'someone_else'}}}});assert.equal(normalizeAccountSamples(raw,account).samples.length,1);});
test('fetch requires account, explicit consent and a server credential before network access',async()=>{let calls=0;const opts={key:'test-only',fetchImpl:async()=>{calls++;throw new Error('unexpected');}};await assert.rejects(fetchAccountSamples({url:account.url},opts));await assert.rejects(fetchAccountSamples({url:'https://instagram.com/reel/abc/',consent:true},opts));await assert.rejects(fetchAccountSamples({url:account.url,consent:true},{...opts,key:''}));await assert.rejects(fetchAccountSamples({url:account.url,consent:true},{...opts,base:'https://evil.test'}));assert.equal(calls,0);});
test('one request only, bounded page size, no redirects and no credential in output',async()=>{let calls=0;const r=await fetchAccountSamples({url:account.url,consent:true},{key:'test-only',fetchImpl:async(url,opt)=>{calls++;assert.equal(url.hostname,'api.tikhub.io');assert.equal(url.searchParams.get('username'),'brand');assert.equal(url.searchParams.get('first'),'12');assert.equal(opt.redirect,'error');return {ok:true,json:async()=>response()};}});assert.equal(calls,1);assert(!JSON.stringify(r).includes('test-only'));});
test('HTTP failures do not expose the upstream body or credential',async()=>{await assert.rejects(fetchAccountSamples({url:account.url,consent:true},{key:'test-only',fetchImpl:async()=>({ok:false,status:401,json:async()=>({secret:'test-only'})})}),/HTTP 401/);});
test('unsubstantiated recommendations are rejected',()=>{assert.throws(()=>validateAccountReport({schemaVersion:1,accountUrl:account.url,source:'test',analyzedAt:'2026-10-10T00:00:00Z',types:[]},account));});

test('current flat reels response is recognized; owner mismatch and zero views remain explicit',()=>{
  const flat={data:{edges:[{node:{code:'flat',is_video:true,owner:{username:'brand'},caption_text:'flat caption',view_count:0}},{node:{code:'excluded',is_video:true,owner:{username:'other'}}}]}};
  const result=normalizeAccountSamples(flat,account);
  assert.equal(result.samples.length,1);assert.equal(result.samples[0].views,0);assert.equal(result.excludedOtherOwners,1);
  assert.throws(()=>normalizeAccountSamples({data:{edges:[{node:{unknown:true}}]}},account),/无法识别/);
});

test('default local archive read needs no API key or paid request',async()=>{
  const {getAccountSamples}=await import('../lib/account-benchmark.mjs');let calls=0;
  const cached={account,samples:[],collectedAt:'2026-10-01T00:00:00Z'};
  const result=await getAccountSamples({url:account.url},{store:{findAccountCache:async()=>cached},fetchImpl:async()=>{calls++;throw Error('no network');}});
  assert.equal(result.fromCache,true);assert.equal(result.collectedAt,cached.collectedAt);assert.equal(calls,0);
});

test('explicit refresh alone can bypass local cache and successful results are archived',async()=>{
  const {getAccountSamples}=await import('../lib/account-benchmark.mjs');let reads=0,calls=0;const archived=[];
  const store={findAccountCache:async()=>{reads++;return {...archived.at(-1),cached:true};},ingest:async result=>archived.push(result)};
  const result=await getAccountSamples({url:account.url,refresh:true,consent:true},{store,key:'synthetic',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>response()};}});
  assert.equal(result.fromCache,false);assert.equal(result.refreshed,true);assert.equal(result.cached,false);assert.equal(reads,1);assert.equal(calls,1);assert.equal(archived.length,1);
});

test('failed refresh never replaces or clears saved history',async()=>{
  const {getAccountSamples}=await import('../lib/account-benchmark.mjs');let writes=0;
  const store={findAccountCache:async()=>null,ingest:async()=>{writes++;}};
  await assert.rejects(getAccountSamples({url:account.url,refresh:true,consent:true},{store,key:'synthetic',fetchImpl:async()=>({ok:false,status:503})}),/HTTP 503/);
  assert.equal(writes,0);
});

test('local cache miss is explicit and never silently becomes a paid request',async()=>{
 const {getAccountSamples}=await import('../lib/account-benchmark.mjs');let calls=0;
 await assert.rejects(getAccountSamples({url:account.url,consent:true},{store:{findAccountCache:async()=>null},key:'synthetic',fetchImpl:async()=>{calls++;throw Error('must not request');}}),e=>e.status===428);
 assert.equal(calls,0);
});

test('refresh response contains only saved visible samples and retains saved external report',async()=>{
 const {getAccountSamples}=await import('../lib/account-benchmark.mjs');let saved=false;
 const visible={account,samples:[],cached:true,hiddenCount:1,trashedCount:1,report:{status:'imported-unverified'}};
 const store={ingest:async()=>{saved=true;},findAccountCache:async()=>{assert(saved);return visible;}};
 const result=await getAccountSamples({url:account.url,refresh:true,consent:true},{store,key:'synthetic',fetchImpl:async()=>({ok:true,json:async()=>response()})});
 assert.deepEqual(result.samples,[]);assert.equal(result.hiddenCount,1);assert.equal(result.trashedCount,1);assert.equal(result.report.status,'imported-unverified');assert.equal(result.cached,false);assert.equal(result.refreshed,true);
});

test('post-refresh archive read failure never falls back to unfiltered provider data',async()=>{
 const {getAccountSamples}=await import('../lib/account-benchmark.mjs');
 for(const read of [async()=>null,async()=>{throw Error('synthetic disk failure');}]){
  await assert.rejects(getAccountSamples({url:account.url,refresh:true,consent:true},{store:{ingest:async()=>{},findAccountCache:read},key:'synthetic',fetchImpl:async()=>({ok:true,json:async()=>response()})}),e=>e.status===503);
 }
});
