import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {mountWorkbench} from '../src/ui.mjs';
const require=createRequire(import.meta.url);
const {parseHTML}=require(process.env.DOM_TEST_MODULE||'linkedom');
const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
const storage=new Map();
globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
function setup(mode){const {document,window}=parseHTML('<html><body><div id="root"></div></body></html>');globalThis.document=document;const root=document.querySelector('#root');const dispose=mountWorkbench(root,mode,css);const click=selector=>{const el=root.querySelector(selector);assert(el,`Missing ${selector}`);el.dispatchEvent(new window.Event('click',{bubbles:true}));};return{root,window,dispose,click};}
test('factory renders every page and manual gaps never start jobs',()=>{
 storage.clear();const {root,dispose,click}=setup('factory');
 assert.equal(root.querySelector('h1').textContent,'让手里的素材，成为一条好视频。');
 click('[data-action="toggle-demo"]');
 for(const tab of ['assets','match','gaps','jobs','output']){click(`[data-tab="${tab}"]`);assert(root.querySelector('h2'));}
 click('[data-tab="gaps"]');assert.equal(root.querySelectorAll('.dv-match-row').length,5);assert(root.textContent.includes('待检查'));
 click('[data-action="missing:hook"]');assert(root.textContent.includes('已确认缺口'));
 assert(!root.textContent.includes('已完成分析'));dispose();
});
test('replicate parses user links, deduplicates, and persists priority without claiming fetched',()=>{
 storage.clear();const {root,window,dispose,click}=setup('replicate');
 click('[data-tab="links"]');root.querySelector('textarea').value='分享 https://v.douyin.com/abc/ https://v.douyin.com/abc/ https://www.tiktok.com/@food/video/123';
 click('[data-action="parse-links"]');assert.equal(root.querySelectorAll('.dv-link-row').length,2);
 const box=root.querySelector('[data-select-link="0"]');box.checked=true;box.dispatchEvent(new window.Event('change',{bubbles:true}));
 assert(root.textContent.includes('已加入优先列表'));assert(root.textContent.includes('尚未读取视频与热度数据'));
 const state=JSON.parse(storage.get('derek-video-workbench:replicate:v1')).state;assert.equal(state.links.length,2);assert.equal(state.links[0].selected,true);assert(state.links.every(l=>l.status==='待读取'));dispose();
});
test('task intentions remain drafts and survive a remount on same origin',()=>{
 storage.clear();let app=setup('factory');app.click('[data-tab="jobs"]');app.click('[data-action="new-draft"]');
 app.root.querySelector('[data-draft="title"]').value='餐饮第一版';app.root.querySelector('[data-draft="note"]').value='先核对上桌动作，再混剪。';app.click('[data-action="save-draft"]');
 assert(app.root.textContent.includes('草稿 · 未执行'));app.dispose();app=setup('factory');app.click('[data-tab="jobs"]');assert(app.root.textContent.includes('餐饮第一版'));app.dispose();
});
test('separate workbenches never show one another\'s drafts',()=>{
 const {root,dispose,click}=setup('replicate');click('[data-tab="jobs"]');assert(!root.textContent.includes('餐饮第一版'));dispose();
});
test('reference edit is human-labeled and markup stays text',()=>{
 storage.clear();const {root,dispose,click}=setup('factory');click('[data-action="toggle-demo"]');click('[data-action="edit:hook"]');
 root.querySelector('[data-edit="title"]').value='<img src=x onerror=alert(1)>';
 click('[data-action="save-requirement"]');assert.equal(root.querySelectorAll('img').length,0);assert(root.textContent.includes('<img src=x onerror=alert(1)>'));dispose();
});
test('all replica navigation and demo details are available before any session',()=>{
 storage.clear();const {root,dispose,click}=setup('replicate');for(const tab of ['discover','links','library','analysis','jobs']){click(`[data-tab="${tab}"]`);assert(root.querySelector('h2'));}
 click('[data-tab="discover"]');click('[data-action="candidate:demo-1"]');assert(root.querySelector('[role="dialog"]'));assert(root.textContent.includes('非真实采集'));click('[data-action="close-dialog"]');assert(!root.querySelector('[role="dialog"]'));dispose();
});
test('Instagram profile in link list enters a clean account study without adding a fake video or calling providers',()=>{
 storage.clear();storage.set('derek-account-benchmark:v1',JSON.stringify({product:'OLD CASE MUST NOT CARRY'}));const {root,dispose,click}=setup('replicate');click('[data-tab="links"]');root.querySelector('textarea').value='https://www.instagram.com/syntheticbrand?xtok=test';click('[data-action="parse-links"]');assert(root.querySelector('[data-research-root]'));assert.equal(root.querySelector('[data-study-field="url"]').value,'https://www.instagram.com/syntheticbrand/');assert.equal(JSON.parse(storage.get('derek-video-workbench:replicate:v1')).state.links.length,0);assert.equal(root.querySelector('[data-study-field="product"]').value,'');assert.equal(root.querySelector('[data-study-field="intent"]').value,'');assert(!root.textContent.includes('OLD CASE MUST NOT CARRY'));assert(root.querySelector('[data-study-action="start"]'));dispose();
});
test('account sample cache is free by default and refresh requires explicit confirmation',async()=>{
 storage.clear();const {document,window}=parseHTML('<html><body><div id="root"></div></body></html>');globalThis.document=document;globalThis.window=window;let confirmations=0;window.confirm=()=>{confirmations++;return false};const calls=[];const {mountAccountBenchmark}=await import('../src/account-ui.mjs');
 const root=document.querySelector('#root');const stop=mountAccountBenchmark(root,{initialUrl:'https://instagram.com/testbrand/',loadSamples:async(url,options)=>{calls.push(options);return{samples:[],cached:true}}});const click=act=>root.querySelector(`[data-act="${act}"]`).dispatchEvent(new window.Event('click',{bubbles:true}));
 click('collect');await new Promise(r=>setImmediate(r));assert.deepEqual(calls,[{refresh:false}]);assert.equal(confirmations,0);assert(root.textContent.includes('没有调用 TikHub'));
 click('refresh');await new Promise(r=>setImmediate(r));assert.equal(confirmations,1);assert.equal(calls.length,1);window.confirm=()=>true;click('refresh');await new Promise(r=>setImmediate(r));assert.deepEqual(calls[1],{refresh:true});stop();
});
