import {parseInstagram} from './account-core.mjs';
const validCursor=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&!/[\u0000-\u001f\u007f]/.test(value);

export function normalizeAccountSamples(raw,account,collectedAt=new Date().toISOString()) {
  if(raw?.code!==undefined&&Number(raw.code)!==200)throw new Error('TikHub 返回业务错误，未把失败视作空账号。');
  if(!Array.isArray(raw?.data?.edges))throw new Error('TikHub Reels 响应结构不符，无法确认账号样本。');
  const samples=[],seen=new Set();let excludedOtherOwners=0,recognized=0;
  const numeric=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
  for(const edge of raw.data.edges){
    const m=edge?.node?.media??edge?.node;if(!m||!(m.media_type===2||m.is_video===true||Array.isArray(m.video_versions)&&m.video_versions.length))continue;recognized++;
    const owner=m.user?.username??m.owner?.username;
    if(owner&&owner.toLowerCase()!==account.username){excludedOtherOwners++;continue;}
    if(typeof m.code!=='string'||! /^[\w-]{1,80}$/.test(m.code)||seen.has(m.code))continue;seen.add(m.code);
    const epoch=numeric(m.taken_at);
    samples.push({url:`https://www.instagram.com/reel/${m.code}/`,title:String(m.caption?.text||m.caption_text||'').slice(0,1000),duration:numeric(m.video_duration),likes:numeric(m.like_count),views:numeric(m.play_count??m.view_count),publishedAt:epoch&&epoch<253402300799?new Date(epoch*1000).toISOString():null,collectedAt,sourceAccount:account.url,ownerVerified:Boolean(owner),status:'metadata-only'});
    if(samples.length===12)break;
  }
  if(raw.data.edges.length&&!recognized)throw new Error('TikHub 返回非空列表但无法识别视频字段，未将格式变化视作空账号。');
  return {account,samples,collectedAt,excludedOtherOwners,provider:'TikHub',status:'metadata-only',hasMore:raw.data.page_info?.has_next_page===true,nextCursor:raw.data.page_info?.has_next_page===true&&validCursor(raw.data.page_info?.end_cursor)?raw.data.page_info.end_cursor:null};
}

// One bounded page per call. The confirmed research budget controls whether a cursor may be requested.
export async function fetchAccountSamples({url,consent,cursor=null},{key,base='https://api.tikhub.io',fetchImpl=fetch}={}) {
  const account=parseInstagram(url);
  if(cursor!==null&&cursor!==undefined&&!validCursor(cursor))throw Object.assign(new Error('Instagram 分页游标无效；未发起请求。'),{status:400});
  if(account?.kind!=='account')throw Object.assign(new Error('需要 Instagram 品牌账号主页，不能填单条视频。'),{status:400});
  if(consent!==true)throw Object.assign(new Error('读取前请确认一次 TikHub 接口调用及可能的费用。'),{status:400});
  if(!key)throw Object.assign(new Error('TikHub 尚未配置；请使用已有的服务端密钥配置，勿将密钥填入账号地址。'),{status:503});
  const endpoint=new URL('/api/v1/instagram/v3/get_user_reels',base);
  if(endpoint.protocol!=='https:'||endpoint.hostname!=='api.tikhub.io'||endpoint.port||endpoint.username||endpoint.password)throw Object.assign(new Error('账号采集仅允许官方 TikHub HTTPS 端点。'),{status:400});
  endpoint.searchParams.set('username',account.username);endpoint.searchParams.set('first','12');if(cursor)endpoint.searchParams.set('after',cursor);
  const res=await fetchImpl(endpoint,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!res.ok)throw Object.assign(new Error(`TikHub HTTP ${res.status}；样本未更新。`),{status:502});
  const raw=await res.json();return normalizeAccountSamples(raw,account);
}
