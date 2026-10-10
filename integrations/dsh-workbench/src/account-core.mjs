// Account links are not video links. Never infer content from a username.
export function parseInstagram(raw) {
  let u; try {u=new URL(String(raw).trim());}catch{return null;}
  if(u.protocol!=='https:' || u.username || u.password || u.port || !['instagram.com','www.instagram.com','m.instagram.com'].includes(u.hostname.toLowerCase()))return null;
  const parts=u.pathname.split('/').filter(Boolean);
  if(parts.length===2&&['reel','reels','p','tv'].includes(parts[0])&&/^[\w-]{1,80}$/.test(parts[1])) return {kind:'video',platform:'Instagram',url:`https://www.instagram.com/${parts[0]==='reels'?'reel':parts[0]}/${parts[1]}/`};
  const reserved=['reel','reels','p','tv','explore','accounts','direct','stories','about','legal','developer','privacy','share','directory'];
  if((parts.length===1 || parts.length===2&&parts[1]==='reels')&&/^[a-zA-Z0-9_][a-zA-Z0-9_.]{0,29}$/.test(parts[0])&&!reserved.includes(parts[0].toLowerCase())){
    const username=parts[0].toLowerCase();return {kind:'account',platform:'Instagram',username,url:`https://www.instagram.com/${username}/`};
  }
  return null;
}
export function accountBrief(account,goal='',assets='') {
  if(parseInstagram(account?.url)?.kind!=='account')throw new Error('请填写 Instagram 账号主页。');
  return `对标账号：${account.url}\n目标产品与受众：${goal||'待补充'}\n现有素材（用户自述，未核验）：${assets||'待补充'}\n\n先获取有限数量的公开视频样本，保留采集时间和来源。基于实际画面与音频，分析开头钩子、叙事、镜头时长、色彩调性、字幕和音乐；每条判断引用视频 URL 及时间段。只读取元数据时不得声称已分析画面。\n将视频按表达类型归类，推荐 1–2 类，每类说明适配理由、代表视频、混剪方案、复刻方案、所需素材及待核对项。未核对素材不能写成确定缺口。\n样本不足时不给确定的账号结论；读取/分析失败要明确报告。不自动启动付费生成或成片渲染。`;
}
const accountText=(v,name,max=5000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(`${name}格式不正确`);return v.trim();};
export function validateAccountReport(raw,account) {
  if(raw?.schemaVersion!==1)throw new Error('分析报告版本应为 1。');
  const owner=parseInstagram(raw.accountUrl);
  if(owner?.kind!=='account'||owner.url!==account?.url)throw new Error('报告账号与当前对标账号不一致。');
  const source=accountText(raw.source,'报告来源',200), analyzedAt=accountText(raw.analyzedAt,'分析时间',80);
  if(!Number.isFinite(Date.parse(analyzedAt)))throw new Error('分析时间格式不正确。');
  if(!Array.isArray(raw.types)||raw.types.length<1||raw.types.length>2)throw new Error('报告须推荐 1–2 个视频类型。');
  const names=new Set();
  const types=raw.types.map(t=>{
    const type=accountText(t.type,'类型名称',200);if(names.has(type))throw new Error('请合并相同的视频类型。');names.add(type);
    if(!Array.isArray(t.evidence)||!t.evidence.length||t.evidence.length>12)throw new Error('每类推荐都需要代表视频和时间段证据。');
    const evidence=t.evidence.map(e=>{
      const video=parseInstagram(e.url);
      if(video?.kind!=='video'||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end<=e.start||e.end>3600)throw new Error('证据须为有效 Instagram 视频与起止秒数。');
      return {url:video.url,start:e.start,end:e.end,observation:accountText(e.observation,'画面观察',2000)};
    });
    if(!Array.isArray(t.requiredAssets)||!t.requiredAssets.length||t.requiredAssets.length>30)throw new Error('请提供所需素材列表。');
    return {type,evidence,tone:accountText(t.tone,'调性'),rhythm:accountText(t.rhythm,'节奏'),hook:accountText(t.hook,'开头'),subtitles:accountText(t.subtitles,'字幕'),reason:accountText(t.reason,'推荐理由'),editPlan:accountText(t.editPlan,'混剪方案'),replicaPlan:accountText(t.replicaPlan,'复刻方案'),requiredAssets:t.requiredAssets.map(a=>accountText(a,'素材要求',500))};
  });
  const evidenceVideos=new Set(types.flatMap(t=>t.evidence.map(e=>e.url))).size;
  if(evidenceVideos<2)throw new Error('至少需要两条不同视频的证据；单条视频不足以形成账号对标建议。');
  return {schemaVersion:1,accountUrl:owner.url,source,analyzedAt,types,evidenceVideos,status:'imported-unverified'};
}
export function accountTypeDraft(account,type,goal,assets,mode) {
  return {title:`${account.username} · ${type.type} · ${mode==='factory'?'混剪':'复刻'}`,note:`${accountBrief(account,goal,assets)}\n\n导入报告推荐类型（待核验）：${type.type}\n理由：${type.reason}\n调性：${type.tone}\n节奏：${type.rhythm}\n开头：${type.hook}\n字幕：${type.subtitles}\n\n${mode==='factory'?type.editPlan:type.replicaPlan}\n\n所需素材（均待核对）：\n${type.requiredAssets.map(x=>'• '+x).join('\n')}\n\n报告引用：\n${type.evidence.map(e=>`${e.url} ${e.start}–${e.end}s：${e.observation}`).join('\n')}`,links:[...new Set(type.evidence.map(e=>e.url))],status:'draft'};
}
