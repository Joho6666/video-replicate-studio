import {getAccountSamples} from './account-benchmark.mjs';
import {createHistoryStore} from './history-store.mjs';
import {createHistoryHandlers} from './history-service.mjs';
import {createPreproductionHandlers} from './preproduction-store.mjs';
import {toWebRequest,sendWebResponse} from './benchmark-http.mjs';

// Standalone adapter, with no Studio env reads or producer/generation imports.
export function createBenchmarkRouter({root,tikhub={}}){
  const store=createHistoryStore({root});
  const history=createHistoryHandlers({store});
  const reports=createPreproductionHandlers({root,history:store});
  async function fetch(request){
    const url=new URL(request.url),route=url.pathname.replace(/^\/api\/benchmark\/?/,'');
    if(!url.pathname.startsWith('/api/benchmark/'))return null;
    if(!['GET','HEAD'].includes(request.method)&&request.headers.get('x-studio')!=='1')return Response.json({error:'forbidden'},{status:403});
    if(request.method!=='GET'&&request.method!=='HEAD'){
      const origin=request.headers.get('origin');
      if(origin&&origin!==url.origin)return Response.json({error:'不允许跨站请求'},{status:403});
    }
    try{
      if(request.headers.get('x-studio')==='1'&&request.headers.get('x-derek-workbench')!=='1'){const headers=new Headers(request.headers);headers.set('x-derek-workbench','1');request=new Request(request,{headers});}
      if(route==='samples'&&request.method==='POST')return Response.json(await getAccountSamples(await request.json(),{store,...tikhub}),{headers:{'cache-control':'no-store'}});
      const handler=route==='history'?(request.method==='GET'?history.snapshot:request.method==='POST'?history.mutate:null)
        :route==='history/import-legacy'?history.importLegacy
        :route==='history/review'?history.review
        :route==='history/imported-report'?history.importedReport
        :route==='preproduction/report'&&request.method==='GET'?reports.report
        :route==='preproduction/evidence'&&request.method==='GET'?reports.evidence
        :route==='preproduction/style'&&request.method==='POST'?reports.saveStyle:null;
      if(!handler)return Response.json({error:'请求方法或路径不支持'},{status:405});
      return await handler(request);
    }catch(error){return Response.json({error:error.message||'账号资料处理失败'},{status:error.status||500,headers:{'cache-control':'no-store'}});}
  }
  return {store,fetch,async route(req,res){if(!new URL(req.url,'http://localhost').pathname.startsWith('/api/benchmark/'))return false;const response=await fetch(await toWebRequest(req));await sendWebResponse(res,response);return true;}};
}
