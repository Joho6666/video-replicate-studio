// Canonical page parsing is local. Share links expand through a separate safe resolver only after user confirmation.
export function parseDouyin(raw){
 let u;try{u=new URL(String(raw).trim());}catch{return null;}
 if(u.protocol!=='https:'||u.username||u.password||u.port||!['www.douyin.com','douyin.com'].includes(u.hostname.toLowerCase()))return null;
 const account=/^\/user\/([A-Za-z0-9_-]{10,200})\/?$/.exec(u.pathname);
 if(account)return{kind:'account',platform:'Douyin',secUid:account[1],username:account[1],url:`https://www.douyin.com/user/${account[1]}`};
 const video=/^\/video\/(\d{6,24})\/?$/.exec(u.pathname);
 if(video)return{kind:'video',platform:'Douyin',videoId:video[1],url:`https://www.douyin.com/video/${video[1]}`};
 return null;
}
export function isDouyinShortLink(raw){try{return new URL(String(raw).trim()).hostname.toLowerCase()==='v.douyin.com';}catch{return false;}}
const numeric=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const text=(v,max=1000)=>typeof v==='string'?v.trim().slice(0,max):'';
const problem=(message,status=502,code='DOUYIN_RESPONSE')=>Object.assign(new Error(message),{status,code});
/** Normalize only metadata. Never persist signed media URLs or provider raw payloads in the library. */
export function normalizeDouyinAccountSamples(raw,account,collectedAt=new Date().toISOString()){
 if(parseDouyin(account?.url)?.kind!=='account'||account.platform!=='Douyin')throw problem('抖音账号信息无效。',400,'DOUYIN_ACCOUNT');
 if(raw?.code!==undefined&&Number(raw.code)!==200)throw problem('TikHub 返回业务错误，未把失败视作空抖音账号。');
 const data=raw?.data;if(data?.status_code!==undefined&&Number(data.status_code)!==0)throw problem('抖音作品列表返回业务错误；没有自动切换接口。');
 if(!Array.isArray(data?.aweme_list))throw problem('TikHub 抖音作品响应结构不符，未将格式变化视为空账号。');
 const samples=[],seen=new Set();let excludedOtherOwners=0,excludedNonVideos=0,recognized=0,unknownOwnerCount=0,displayName='';
 for(const item of data.aweme_list){
  if(!item||typeof item!=='object')continue;
  if(Array.isArray(item.images)&&item.images.length||[2,68,150].includes(item.aweme_type)){excludedNonVideos++;continue;}
  const video=item.video;
  if(!video||typeof video!=='object'||!(item.aweme_type===0||item.aweme_type===4||item.aweme_type===51||Array.isArray(video.play_addr?.url_list)&&video.play_addr.url_list.length)){continue;}
  const awemeId=typeof item.aweme_id==='string'&&/^\d{6,24}$/.test(item.aweme_id)?item.aweme_id:null;
  if(!awemeId)continue;recognized++;
  const owner=text(item.author?.sec_uid||item.author?.sec_user_id,200);
  if(owner&&owner!==account.secUid){excludedOtherOwners++;continue;}
  if(seen.has(awemeId))continue;seen.add(awemeId);
  if(!owner)unknownOwnerCount++;if(owner&&!displayName)displayName=text(item.author?.nickname,120);
  const epoch=numeric(item.create_time),durationMs=numeric(video.duration??item.duration),statistics=item.statistics||{};
  samples.push({url:`https://www.douyin.com/video/${awemeId}`,title:text(item.desc),duration:durationMs===null?null:durationMs/1000,likes:numeric(statistics.digg_count),views:numeric(statistics.play_count),publishedAt:epoch!==null&&epoch>0&&epoch<253402300799?new Date(epoch*1000).toISOString():null,collectedAt,sourceAccount:account.url,ownerVerified:Boolean(owner),status:'metadata-only'});
  if(samples.length===12)break;
 }
 if(data.aweme_list.length&&!recognized&&!excludedNonVideos)throw problem('抖音非空作品列表缺少可识别的视频字段；没有开始分析。');
 return{account:{...account,...(displayName?{displayName}:{})},samples,collectedAt,excludedOtherOwners,excludedNonVideos,unknownOwnerCount,provider:'TikHub',status:'metadata-only',hasMore:data.has_more===true||data.has_more===1,coverage:{candidateLimit:12,pageCount:1,channel:'normal',sort:'latest',completeAccountCoverage:false,noteZh:'仅取得正常版抖音的一页候选；置顶、发布时间缺失或平台返回不完整会影响覆盖，不代表完整账号排行。'}};
}
// One paid request after explicit confirmation; no profile lookup, pagination, retry, or channel fallback.
export async function fetchDouyinAccountSamples({url,consent},{key,base='https://api.tikhub.io',fetchImpl=fetch}={}){
 if(isDouyinShortLink(url))throw problem('请先在浏览器展开抖音分享短链，提供完整的 www.douyin.com/user/… 主页链接；本次未调用解析接口。',400,'DOUYIN_SHORT_LINK');
 const account=parseDouyin(url);if(account?.kind!=='account')throw problem('需要完整抖音账号主页链接，包含 user/ 后的 sec_user_id。',400,'DOUYIN_ACCOUNT');
 if(consent!==true)throw problem('读取前请确认一次 TikHub 接口调用及可能的费用。',400,'DOUYIN_CONSENT');
 if(!key)throw problem('TikHub 尚未配置；请使用已有服务端密钥。',503,'DOUYIN_KEY');
 const endpoint=new URL('/api/v1/douyin/app/v3/fetch_user_post_videos',base);
 if(endpoint.origin!=='https://api.tikhub.io'||endpoint.username||endpoint.password)throw problem('抖音采集仅允许官方 TikHub HTTPS 端点。',400,'DOUYIN_ENDPOINT');
 endpoint.searchParams.set('sec_user_id',account.secUid);endpoint.searchParams.set('max_cursor','0');endpoint.searchParams.set('count','12');endpoint.searchParams.set('sort_type','0');endpoint.searchParams.set('channel','normal');
 const response=await fetchImpl(endpoint,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!response.ok)throw problem(`TikHub HTTP ${response.status}；抖音样本未更新。`);
 return normalizeDouyinAccountSamples(await response.json(),account);
}
