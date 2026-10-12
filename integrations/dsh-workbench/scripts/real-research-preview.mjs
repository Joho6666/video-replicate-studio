/** Local reader for the same private research service; no collection, model or generation clients. */
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHistoryStore} from '../src/history-store.mjs';
import {createResearchService} from '../src/research-service.mjs';
import {createEvidenceHandler} from '../src/research-evidence.mjs';
const dataRoot=path.resolve(process.argv[2]||path.join(import.meta.dirname,'../data'));
const port=Number(process.argv[3]||43219),origin='http://127.0.0.1:'+port;
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Invalid local port');
const history=createHistoryStore({root:dataRoot}),research=createResearchService({root:dataRoot,history});
const evidence=createEvidenceHandler({root:dataRoot,research});
const page=job=>`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>复刻研究室 · 本机真实拆解</title><style>body{margin:0;background:#f5f6f1;font-family:-apple-system,'PingFang SC',sans-serif;color:#293e31}.localbar{background:#e8eddf;padding:10px 28px;font-size:12px;display:flex;justify-content:space-between}[data-study-action="start-new"],[data-study-action="compile-evidence"],[data-study-action="retry-comparison"]{display:none}main{max-width:1220px;margin:auto;padding:12px 28px}</style><div class="localbar"><b>复刻研究室 · 真实本机记录</b><span>读取已有拆解 · 新研究请使用 DSH · 暂不生成视频</span></div><main id="app"></main><script type="module">import {mountResearchDesk} from '/research-ui.mjs';mountResearchDesk(document.querySelector('#app'),{initialJobId:${JSON.stringify(job?.jobId||'')},initialUrl:${JSON.stringify(job?.plan?.source?.url||'')},request:async(suffix,body)=>{const r=await fetch('/api/derek-video-replicate/research'+suffix,{...(body?{method:'POST',headers:{'content-type':'application/json','x-derek-workbench':'1'},body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Object.assign(new Error(d.error||'本机记录暂不可读'),{code:d.code});return d;}});const form=document.querySelector('[data-study-form]');if(form)form.hidden=true;const advanced=document.querySelector('[data-study-action="advanced"]');if(advanced)advanced.hidden=true;</script></html>`;
const allowed=new Map([['/context','context'],['/jobs','job'],['/result','result'],['/styles/confirm','confirmStyle']]);
http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!=='127.0.0.1:'+port||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);return res.end('Local origin only');}
  const url=new URL(req.url,origin);res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
  if(req.method==='GET'&&url.pathname==='/'){const context=await research.topicContext({}),job=[...context.jobs].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).find(j=>j.plan?.executionMode==='account-study'&&j.plan?.source?.kind==='douyin-share');res.setHeader('content-type','text/html;charset=utf-8');return res.end(page(job));}
  if(req.method==='GET'&&url.pathname==='/research-ui.mjs'){res.setHeader('content-type','text/javascript');return res.end(await readFile(path.join(import.meta.dirname,'../src/research-ui.mjs')));}
  const prefix='/api/derek-video-replicate/research';let response;
  if(url.pathname===prefix+'/evidence'&&['GET','HEAD'].includes(req.method))response=await evidence(new Request(url,{method:req.method,headers:req.headers}));
  else{
   const suffix=url.pathname.slice(prefix.length),route=url.pathname.startsWith(prefix)?allowed.get(suffix):null;
   if(!route||req.method!==(suffix==='/styles/confirm'?'POST':'GET')){res.writeHead(405,{'content-type':'application/json'});return res.end(JSON.stringify({error:'此页面只读取本机真实记录和保留方案；新研究与收费处理请使用 DSH 的账号研究入口。'}));}
   let body='';if(req.method==='POST')for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536)throw Error('Body too large');}
   response=await research.handlers[route](new Request(url,{method:req.method,headers:req.headers,...(body?{body}:{})}));
  }
  res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)for await(const chunk of response.body)res.write(Buffer.from(chunk));res.end();
 }catch{if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'本机记录读取未完成；没有调用采集、分析或生成服务。'}));}
}).listen(port,'127.0.0.1',()=>console.log('Real private research reader '+origin));
