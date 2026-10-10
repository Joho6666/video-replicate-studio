import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {parseHTML}=require(process.env.DOM_TEST_MODULE||'linkedom');
test('packaged UI mounts account/model panels and sends required local auth header',async()=>{
 const {document,window}=parseHTML('<html><body><div id="root"></div></body></html>');const root=document.querySelector('#root');let cleanup;const requests=[];
 const React={useRef:value=>({current:value??root}),useState:value=>[value,()=>{}],useEffect:f=>{cleanup=f()},createElement:()=>null};
 const ctx={effect:f=>f(),desktopWorkbenches:{register:(_meta,Panel)=>{Panel({});return()=>{}}}};
 const sandbox={window:{__ModuleLoader__:{load:({factory})=>factory(()=>React).apply(ctx)}},document,localStorage:{getItem:()=>null,setItem:()=>{}},setTimeout,clearTimeout,setInterval,clearInterval,URL,URLSearchParams,structuredClone,Blob,Response,fetch:async(url,init)=>{requests.push({url,init});return Response.json(url.includes('/history')?{records:[],batches:[],reviews:[],counts:{active:0,hidden:0,trash:0}}:{models:[],executionEnabled:false})}};
 vm.runInNewContext(await readFile(new URL('../workbenches/replicate/lib/client.js',import.meta.url),'utf8'),sandbox);
 try{assert(root.querySelector('[data-research-root]'));root.querySelector('[data-tab="history"]').dispatchEvent(new window.Event('click',{bubbles:true}));assert(root.querySelector('[data-history-root]'));await new Promise(resolve=>setImmediate(resolve));assert(root.textContent.includes('还没有'));requests.length=0;root.querySelector('[data-tab="models"]').dispatchEvent(new window.Event('click',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));assert(root.querySelector('[data-ms-form]'));const modelRequest=requests.find(r=>r.url==='/api/derek-video-replicate/models');assert(modelRequest);assert.equal(modelRequest.init?.headers?.['x-derek-workbench'],'1');assert(requests.some(r=>r.url==='/api/derek-video-replicate/analysis/status'));assert(!requests.some(r=>r.init?.method==='POST'));assert(root.textContent.includes('模思智能'));}finally{cleanup();}
});
