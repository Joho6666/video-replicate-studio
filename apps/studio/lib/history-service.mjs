import {sameOrigin} from './request-origin.mjs';

const installed=new WeakMap();
const response=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const methodError=()=>response({error:'此接口不支持该请求方式。'},405);
async function limitedJson(request){
 const limit=64*1024;let raw='';
 if(request.body){const reader=request.body.getReader(),decoder=new TextDecoder();let bytes=0;try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit){await reader.cancel();throw Object.assign(new Error('请求内容超过 64 KB。'),{status:413});}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}}
 try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch(error){if(error.status)throw error;throw Object.assign(new Error('请求 JSON 格式无效。'),{status:400});}
}
function safeError(error){const status=[400,403,404,409,413].includes(error?.status)?error.status:500;return response({error:status===500?'历史资料操作失败；原记录未被清空，请稍后重试。':error.message,code:typeof error?.code==='string'&&error.code.startsWith('HISTORY_')?error.code:undefined},status);}

export function createHistoryHandlers({store,isAllowed=sameOrigin}={}){
 if(!store)throw new TypeError('createHistoryHandlers requires a store');
 async function post(request,callback){if(request.method!=='POST')return methodError();if(request.headers.get('x-derek-workbench')!=='1'||!await isAllowed(request))return response({error:'请求来源校验失败。'},403);try{return response(await callback(await limitedJson(request)));}catch(error){return safeError(error);}}
 async function get(request,callback){if(request.method!=='GET')return methodError();try{return response(await callback(new URL(request.url)));}catch(error){return safeError(error);}}
 return {
  snapshot:request=>get(request,u=>store.snapshot({view:u.searchParams.get('view')||'active',query:u.searchParams.get('q')||u.searchParams.get('query')||''})),
  mutate:request=>post(request,body=>store.mutate(body)),
  importLegacy:request=>post(request,body=>store.importLegacy({account:body.account,samples:body.samples,collectedAt:body.collectedAt,report:body.report,goal:body.goal,assets:body.assets})),
  review:request=>get(request,u=>store.readReview(u.searchParams.get('id'))),
  importedReport:request=>get(request,u=>store.readImportedReport(u.searchParams.get('id')))
 };
}
export function applyHistoryService(ctx,{store,prefix='/api/derek-video-replicate/history',isAllowed}={}){
 let prefixes=installed.get(ctx);if(!prefixes){prefixes=new Set();installed.set(ctx,prefixes);}if(prefixes.has(prefix))return;
 const h=createHistoryHandlers({store,isAllowed});
 for(const [route,methods,fetch] of [
  ['', ['GET','POST'], request=>request.method==='GET'?h.snapshot(request):h.mutate(request)],
  ['/import',['POST'],h.importLegacy],
  ['/review',['GET'],h.review],
  ['/imported-report',['GET'],h.importedReport]
 ])ctx.connection.fetch.register({path:prefix+route,methods,requestBody:'buffered',fetch});
 prefixes.add(prefix);
}
