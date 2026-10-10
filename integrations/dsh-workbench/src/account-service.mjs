import {createResearchComparison} from './research-comparison.mjs';
import {createEvidenceCapture,createEvidenceHandler} from './research-evidence.mjs';
import path from 'node:path';
import {createResearchService,applyResearchService} from './research-service.mjs';
import {createMediaResolver} from './research-media.mjs';
import {resolveDouyinShare} from './douyin-share.mjs';
import {createResearchAnalyzer} from './research-analyzer.mjs';
import {applyResearchAgent} from './research-agent.mjs';
import {sameOrigin} from './request-origin.mjs';
import {applyAnalysisService} from './analysis-service.mjs';
import {applyModelSettings} from './model-settings.mjs';
import {createHistoryStore} from './history-store.mjs';
import {applyHistoryService} from './history-service.mjs';
import {parseInstagram} from './account-core.mjs';
import {defaultDataRoot,applyPreproductionStore} from './preproduction-store.mjs';
import {spawn} from 'node:child_process';
import {fetchAccountSamples} from './account-fetch.mjs';
import {parseDouyin,isDouyinShortLink,fetchDouyinAccountSamples} from './douyin-source.mjs';
export function parseSupportedAccount(url){return parseInstagram(url)||parseDouyin(url);}
export function fetchSupportedAccountSamples(input,options){return parseDouyin(input.url)?.kind==='account'?fetchDouyinAccountSamples(input,options):fetchAccountSamples(input,options);}
const cacheIdentity=account=>account.platform==='Douyin'?account:account.username;
const SERVICE='derek.dsh-workbenches.tikhub';
const ACCOUNT='dsh-workbench';
const API='/api/derek-video-replicate/account';
// No secrets in process arguments, files, responses or log messages.
export function runPrivateProcess(executable,args,input='',timeout=40000,maxBytes=4000000){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{stdio:['pipe','pipe','pipe']});const chunks=[];let size=0,settled=false;
    const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('本机连接命令超时。'));},timeout);
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){child.kill();finish(new Error('接口响应过大。'));}else chunks.push(chunk);});
    child.stderr.resume(); // Never relay subprocess diagnostics containing request details.
    child.on('error',()=>finish(new Error('本机连接组件不可用。')));
    child.on('close',code=>code===0?finish(null,Buffer.concat(chunks).toString('utf8')):finish(new Error('本机连接命令失败。')));
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
export async function readTikHubKey(run=runPrivateProcess){
  let value;try{value=await run('/usr/bin/security',['find-generic-password','-a',ACCOUNT,'-s',SERVICE,'-w'],'',10000,2048);}catch{throw Object.assign(new Error('TikHub 密钥尚未配置或钥匙串暂不可用。'),{status:503});}
  const key=value.trim();if(!/^[A-Za-z0-9+/_=-]{10,512}$/.test(key))throw Object.assign(new Error('TikHub 凭据格式无效。'),{status:503});return key;
}
export async function privateTikHubFetch(url,options,run=runPrivateProcess){
  const target=new URL(url);if(target.origin!=='https://api.tikhub.io')throw new Error('不支持的采集地址。');
  const auth=options.headers.Authorization;
  if(!/^Bearer [A-Za-z0-9+/_=-]{10,512}$/.test(auth))throw new Error('凭据格式错误。');
  const config=`url = "${target.href}"\nheader = "Authorization: ${auth}"\nheader = "Accept: application/json"\nuser-agent = "DSH-Workbench/0.4.3"\n`;
  const output=await run('/usr/bin/curl',['--silent','--show-error','--max-time','35','--max-filesize','4000000','--write-out','\n%{http_code}','--config','-'],config);
  const split=output.lastIndexOf('\n');const code=Number(output.slice(split+1));
  if(!Number.isInteger(code)||code<100||code>599)throw new Error('采集连接未返回有效状态。');
  return new Response(output.slice(0,split),{status:code,headers:{'content-type':'application/json'}});
}
export function createAccountHandlers({getKey=readTikHubKey,fetchImpl=privateTikHubFetch,checkKey,store}={}){
  let inflight=false;
  const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
  return {
    async status(){let configured=false;try{if(checkKey)configured=await checkKey();else {await getKey();configured=true;}}catch{}return reply({provider:'TikHub',configured,storage:'macOS Keychain',sampleLimit:12,analysisConnected:false});},
    async samples(request){
      if(request.headers.get('x-derek-workbench')!=='1')return reply({error:'请求来源校验失败。'},403);
      if(!sameOrigin(request))return reply({error:'不允许跨站采集请求。'},403);
      if(inflight)return reply({error:'已有采集请求正在运行，请稍后再试。'},409);
      let body;try{const text=await request.text();if(text.length>4096)return reply({error:'请求内容过大。'},413);body=JSON.parse(text);}catch{return reply({error:'请求格式错误。'},400);}
      if(!body||typeof body!=='object')return reply({error:'请求格式错误。'},400);
      if(isDouyinShortLink(body.url))return reply({error:'请先在浏览器展开抖音分享短链，提供完整的 www.douyin.com/user/… 主页链接；未调用解析接口。'},400);
      const account=parseSupportedAccount(body.url);if(account?.kind!=='account')return reply({error:'请输入 Instagram 主页或完整抖音 user/… 主页链接。'},400);
      if(store&&body.refresh!==true){try{const cached=await store.findAccountCache(cacheIdentity(account));return cached?reply(cached):reply({error:'没有已保存样本，请主动刷新采集。'},428);}catch{return reply({error:'本机历史暂不可用，未发起采集。'},503);}}
      if(body.consent!==true)return reply({error:'请先确认单次采集调用。'},400);
      inflight=true;
      try{const result=await fetchSupportedAccountSamples(body,{key:await getKey(),fetchImpl});
        if(!store)return reply({...result,cached:false,persisted:false});
        try{await store.ingest(result);}catch{return reply({error:'已获取元数据，但本机归档失败。请检查本机存储；再次刷新会重新调用接口。'},507);}
        let visible;try{visible=await store.findAccountCache(cacheIdentity(account));}catch{}
        if(!Array.isArray(visible?.samples))return reply({error:'新样本已归档，但可见记录暂时无法读取。请先读取已保存样本，避免重复刷新收费。'},503);
        return reply({...visible,cached:false,persisted:true});
      }
      catch(error){
        const messages={401:'TikHub 凭据未通过验证。',402:'TikHub 余额不足，此接口不接受免费额度。未读取视频或开始分析。',403:'TikHub 拒绝了访问，请检查接口权限或访问通道。',429:'TikHub 请求受到限流，请稍后手动重试。'};
        const upstream=Number(error.message?.match(/TikHub HTTP (\d+)/)?.[1]);
        return reply({error:messages[upstream]||(['400','503'].includes(String(error.status))?error.message:'账号采集失败；未更新样本，请检查连接后手动重试。'),providerStatus:upstream||null},error.status||502);
      }finally{inflight=false;}
    }
  };
}
export function applyAccountService(ctx,{root=defaultDataRoot()}={}){
  const store=createHistoryStore({root});
  applyHistoryService(ctx,{store});
  applyPreproductionStore(ctx,{root,history:store});
  applyModelSettings(ctx,{root});
  applyAnalysisService(ctx,{root,history:store});
  const research=createResearchService({root,history:store,resolveSource:resolveDouyinShare,
    collectAccount:async input=>fetchSupportedAccountSamples(input,{key:await readTikHubKey(),fetchImpl:privateTikHubFetch}),
    compareVideos:createResearchComparison({root,ctx,isActive:async(jobId,recordIds)=>{try{const job=await research.getJob({jobId});const records=(await store.snapshot({view:'active'})).records;return !job.cancelRequested&&recordIds.every(id=>records.some(r=>r.id===id));}catch{return false;}}}),
    analyzeVideo:createResearchAnalyzer({root,captureEvidence:createEvidenceCapture({root}),resolveMedia:createMediaResolver({root,getKey:readTikHubKey,fetchImpl:privateTikHubFetch}),isActive:async id=>(await store.snapshot({view:'active'})).records.some(r=>r.id===id)})
  });
  applyResearchService(ctx,{service:research});
  ctx.connection.fetch.register({path:'/api/derek-video-replicate/research/evidence',methods:['GET','HEAD'],requestBody:'buffered',fetch:createEvidenceHandler({root,research})});
  applyResearchAgent(ctx,{service:research});
  ctx.connection.fetch.register({path:'/api/derek-video-replicate/research/workspace',methods:['GET'],requestBody:'buffered',fetch:request=>sameOrigin(request)?Response.json({folder:path.dirname(root)},{headers:{'cache-control':'no-store'}}):Response.json({error:'请求来源校验失败。'},{status:403})});
  const handlers=createAccountHandlers({store});
  ctx.connection.fetch.register({path:API+'/status',methods:['GET'],requestBody:'buffered',fetch:()=>handlers.status()});
  ctx.connection.fetch.register({path:API+'/samples',methods:['POST'],requestBody:'buffered',fetch:request=>handlers.samples(request)});
}
