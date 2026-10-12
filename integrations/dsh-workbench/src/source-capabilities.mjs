import {parseInstagram} from './account-core.mjs';
import {parseDouyin} from './douyin-source.mjs';
import {parseDouyinShare} from './douyin-share.mjs';
const fail=message=>{throw Object.assign(new Error(message),{code:'RESEARCH_SOURCE',status:400,safeStatus:400});};
/** Planning may retain any safe public HTTPS source; collecting requires a connected adapter. */
export function canonicalPlanningUrl(value,{video=false}={}){
 let u;try{u=new URL(String(value).trim());}catch{fail('请提供完整 HTTPS 来源链接。');}
 const host=u.hostname.toLowerCase();if(u.protocol!=='https:'||u.username||u.password||u.port||!host.includes('.')||host.includes(':')||/^\d+(?:\.\d+){3}$/.test(host)||/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host))fail('来源需要公开 HTTPS 页面链接，不能含凭据、本机或内网地址。');
 const ig=parseInstagram(u.href),dy=parseDouyin(u.href);if(ig)return ig.url;if(dy)return dy.url;
 u.hash='';const videoId=video&&/^(?:www\.)?youtube\.com$/.test(host)?u.searchParams.get('v'):null;u.search='';if(videoId)u.searchParams.set('v',videoId);return u.href;
}
function platformOf(url){const host=new URL(url).hostname.toLowerCase();for(const [pattern,name]of [[/(^|\.)instagram\.com$/,'Instagram'],[/(^|\.)douyin\.com$/,'Douyin'],[/(^|\.)tiktok\.com$/,'TikTok'],[/(^|\.)(youtube\.com|youtu\.be)$/,'YouTube'],[/(^|\.)(xiaohongshu\.com|xhslink\.com)$/,'小红书'],[/(^|\.)(bilibili\.com|b23\.tv)$/,'哔哩哔哩'],[/(^|\.)(kuaishou\.com|gifshow\.com)$/,'快手'],[/(^|\.)(x\.com|twitter\.com)$/,'X']])if(pattern.test(host))return name;return'其他平台';}
export function normalizeResearchSource(value){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('请提供品牌账号或视频链接。');
 const raw=Array.isArray(value.urls)?value.urls:[value.url];
 // A copied Douyin share sentence can be stored without opening it or making a request.
 const shortLinks=raw.map(v=>parseDouyinShare(v)).filter(Boolean);
 if(value.kind==='douyin-share'||shortLinks.length){if(raw.length!==1||shortLinks.length!==1)fail('一次规划请提供一条抖音分享短链，或展开为完整主页／视频链接。');return shortLinks[0];}
 if(value.kind==='account'){const url=canonicalPlanningUrl(value.url),known=parseInstagram(url)||parseDouyin(url);if(known?.kind==='account')return{kind:'account',url:known.url,username:known.username,...(known.platform==='Douyin'?{platform:'Douyin',secUid:known.secUid}:{})};return{kind:'account',platform:platformOf(url),url};}
 if(value.kind==='videos'||value.kind==='video'){if(!raw.length||raw.length>2)fail('一次深拆最多提供两条视频；账号候选模式可先列八条。');const urls=[...new Set(raw.map(url=>canonicalPlanningUrl(url,{video:true})))];return{kind:'videos',urls};}
 fail('来源类型需要选择账号、视频或抖音分享链接。');
}
export function sourceCapability(source){
 if(source.kind==='douyin-share')return{available:true,platform:'Douyin',reasonZh:'可在用户确认后安全展开抖音分享链接；展开前不会猜测它是账号还是视频。'};
 const urls=source.kind==='videos'?source.urls:[source.url],platforms=[...new Set(urls.map(platformOf))],expected=source.kind==='videos'?'video':'account';
 const available=urls.every(url=>parseInstagram(url)?.kind===expected||parseDouyin(url)?.kind===expected),platform=platforms.join('、');
 return{available,platform,reasonZh:available?'本机已接通此来源的 TikHub 采集与研究适配；凭据仍由现有钥匙串管理。':`${platform} 可以保存需求和理解卡，现有 TikHub 授权不会改变；本机工作台尚未接通该来源的采集适配。选择“仅保存理解卡”可完成规划，自动采集会保持关闭。`};
}
