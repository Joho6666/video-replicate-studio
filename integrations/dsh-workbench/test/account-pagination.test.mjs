import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAccountSamples,fetchAccountSamples} from '../src/account-fetch.mjs';
import {normalizeDouyinAccountSamples,fetchDouyinAccountSamples,parseDouyin} from '../src/douyin-source.mjs';
const account={kind:'account',username:'synthetic_paging',url:'https://www.instagram.com/synthetic_paging/'};
const dy=parseDouyin('https://www.douyin.com/user/MS4wLjAB_SYNTHETIC_Pagination_123456789');
const key='synthetic-key-not-real';

test('Instagram returns only its official opaque end_cursor and requests after only when explicitly supplied',async()=>{
 const raw={data:{edges:[],page_info:{has_next_page:true,end_cursor:'opaque_SYNTHETIC_next=='}}};const normalized=normalizeAccountSamples(raw,account);assert.equal(normalized.nextCursor,'opaque_SYNTHETIC_next==');let request,calls=0;await fetchAccountSamples({url:account.url,consent:true,cursor:normalized.nextCursor},{key,fetchImpl:async endpoint=>{calls++;request=new URL(endpoint);return Response.json(raw);}});assert.equal(calls,1);assert.equal(request.searchParams.get('after'),normalized.nextCursor);assert.equal(request.searchParams.get('first'),'12');assert.equal(request.searchParams.has('before'),false);
});

test('Instagram does not fabricate a missing or invalid cursor and refuses malformed caller cursors before API',async()=>{
 for(const cursor of [undefined,'','bad\nvalue',999,'a'.repeat(2049)]){const normalized=normalizeAccountSamples({data:{edges:[],page_info:{has_next_page:true,end_cursor:cursor}}},account);assert.equal(normalized.nextCursor,null);}
 let calls=0;await assert.rejects(fetchAccountSamples({url:account.url,consent:true,cursor:'bad\nvalue'},{key,fetchImpl:async()=>{calls++;}}),/游标/);assert.equal(calls,0);assert.equal(normalizeAccountSamples({data:{edges:[],page_info:{has_next_page:false,end_cursor:'unused'}}},account).nextCursor,null);
});

test('Douyin cursors preserve exact numeric strings without changing pagination or requesting extra pages',async()=>{
 const raw={data:{aweme_list:[],has_more:1,max_cursor:'1791504000000'}};const normalized=normalizeDouyinAccountSamples(raw,dy);assert.equal(normalized.nextCursor,'1791504000000');let request,calls=0;await fetchDouyinAccountSamples({url:dy.url,consent:true,cursor:normalized.nextCursor},{key,fetchImpl:async endpoint=>{calls++;request=new URL(endpoint);return Response.json(raw);}});assert.equal(calls,1);assert.equal(request.searchParams.get('max_cursor'),'1791504000000');assert.equal(request.searchParams.get('count'),'12');assert.equal(request.searchParams.get('channel'),'normal');
});

test('Douyin unsafe integers, object cursors and zero pagination cursor never become guessed next pages',async()=>{
 for(const cursor of [undefined,0,'0',Number.MAX_SAFE_INTEGER+1,{},'-1','not-a-cursor'])assert.equal(normalizeDouyinAccountSamples({data:{aweme_list:[],has_more:1,max_cursor:cursor}},dy).nextCursor,null);
 let calls=0;for(const cursor of [{},'-1',Number.MAX_SAFE_INTEGER+1])await assert.rejects(fetchDouyinAccountSamples({url:dy.url,consent:true,cursor},{key,fetchImpl:async()=>{calls++;}}),{code:'DOUYIN_CURSOR'});assert.equal(calls,0);
});
