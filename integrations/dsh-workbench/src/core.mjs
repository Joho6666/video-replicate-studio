import {parseInstagram} from './account-core.mjs';
export const VERSION = '0.4.3';
export const STORAGE_VERSION = 1;
export const VIDEO_TYPES = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
export const IMAGE_TYPES = /\.(jpe?g|png|webp|gif|heic)$/i;
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function classifyLink(raw) {
  const ig=parseInstagram(raw); if(ig?.kind==='video')return {url:ig.url,platform:'Instagram'};
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const belongs = domain => host === domain || host.endsWith('.' + domain);
  const platform = belongs('douyin.com') ? '抖音' : belongs('tiktok.com') ? 'TikTok' : null;
  if (!platform || url.pathname === '/') return null;
  url.hash = '';
  url.search = '';
  return {url: url.href, platform};
}
export function parseLinks(text, existing = []) {
  const tokens = String(text).match(/https?:\/\/[^\s<>"，。；、）)]+/g) || [];
  const seen = new Set(existing.map(x => x.url));
  const accepted = [], rejected = [], accounts=[]; let duplicates = 0;
  for (const raw of tokens) {
    const ig=parseInstagram(raw);
    if(ig?.kind==='account'){if(seen.has(ig.url)){duplicates++;continue;}seen.add(ig.url);accounts.push(ig);continue;}
    const parsed = classifyLink(raw);
    if (!parsed) { rejected.push(raw); continue; }
    if (seen.has(parsed.url)) { duplicates++; continue; }
    seen.add(parsed.url); accepted.push({...parsed, status: '待读取', selected: false});
  }
  return {accepted, rejected, duplicates, accounts};
}
export function fileRecord(file) {
  const relative = file.webkitRelativePath || file.name;
  return {id: `${relative}:${file.size}:${file.lastModified}`, name: file.name, relative, size: file.size,
    kind: VIDEO_TYPES.test(file.name) ? '视频' : IMAGE_TYPES.test(file.name) ? '图片' : '其他',
    duration: null, width: null, height: null, role: '未标注', status: '仅识别文件', source: '本地导入'};
}
export function assessRequirements(requirements, assets) {
  return requirements.map(req => {
    const matches = assets.filter(a => a.role === req.role && a.source !== '示例');
    const unreviewed = assets.some(a => a.role === '未标注');
    const manuallyMissing = req.review === 'missing';
    return {...req, matches, state: matches.length ? '已人工匹配' : manuallyMissing ? '已确认缺口' : '待检查',
      reason: matches.length ? `${matches.length} 个素材已由你标注；连贯性与时长仍需核对` : manuallyMissing ? '你已确认现有素材无法满足这段要求' : unreviewed ? '还有未标注素材，暂不能判定缺失' : '尚未确认这段需要的素材'};
  });
}
export function exportReport(state, mode) {
  return {schemaVersion: STORAGE_VERSION, version: VERSION, workbench: mode, exportedAt: new Date().toISOString(),
    evidence: '界面原型；未调用视觉模型、采集服务或渲染服务', drafts:state.drafts||[],
    ...(mode === 'factory' ? {assets: state.assets.map(({preview, ...asset}) => asset), requirements: state.requirements, reference: state.reference ? {name:state.reference.name} : null} : {links:state.links, discovery:state.discovery})};
}
export function restoreReport(report, mode) {
  if(!report || report.schemaVersion!==1 || report.workbench!==mode) throw new Error('请选择当前工作台导出的 v1 记录。');
  const text=(v,max=2000)=>{if(typeof v!=='string'||v.length>max)throw new Error('记录字段格式不正确。');return v;};
  const list=(v,max=2000)=>{if(!Array.isArray(v)||v.length>max)throw new Error('记录列表格式不正确。');return v;};
  const drafts=list(report.drafts||[],500).map(d=>({id:text(d.id,200),title:text(d.title,200),note:text(d.note,10000),createdAt:text(d.createdAt,100),status:'draft',links:list(d.links||[],500).map(l=>text(l,2000))}));
  if(mode==='replicate'){
    const links=list(report.links||[]).map(l=>{const parsed=classifyLink(l.url);if(!parsed)throw new Error('记录包含不支持的链接。');return {...parsed,selected:l.selected===true,status:'待读取'};});
    const d=report.discovery||{};
    return {links, drafts,discovery:{industry:text(d.industry||'',200),platform:['全部平台','抖音','TikTok'].includes(d.platform)?d.platform:'全部平台',period:['最近 7 天','最近 30 天','最近 90 天'].includes(d.period)?d.period:'最近 7 天',keyword:text(d.keyword||'',500),schedule:false}};
  }
  const assets=list(report.assets||[]).map(a=>({id:text(a.id,2000),name:text(a.name,500),relative:text(a.relative||a.name,2000),kind:['视频','图片'].includes(a.kind)?a.kind:'其他',size:Number.isFinite(a.size)?Math.max(0,a.size):0,width:Number.isFinite(a.width)?a.width:null,height:Number.isFinite(a.height)?a.height:null,duration:Number.isFinite(a.duration)?a.duration:null,role:ROLES.includes(a.role)?a.role:'未标注',source:'本地导入',status:'已恢复记录 · 源文件待重选'}));
  const requirements=list(report.requirements,20).map(r=>({id:text(r.id,100),title:text(r.title,200),time:text(r.time,100),role:ROLES.includes(r.role)?r.role:'未标注',description:text(r.description,5000),review:r.review==='missing'?'missing':null}));
  if(!requirements.length)throw new Error('记录没有参考结构。');
  return {assets,requirements,drafts,reference:null};
}
export const DEFAULT_REQUIREMENTS = [
  {id:'hook',title:'开头抓住注意力',role:'开头钩子',time:'00:00—00:03',description:'用近景、动作或结果，让人愿意继续看。',review:null},
  {id:'process',title:'交代过程与变化',role:'过程展示',time:'00:03—00:12',description:'镜头之间要能交代动作与前后关系。',review:null},
  {id:'detail',title:'给出具体细节',role:'细节特写',time:'00:12—00:20',description:'用特写或证据支撑主要信息。',review:null},
  {id:'result',title:'呈现结果',role:'结果展示',time:'00:20—00:26',description:'展示使用结果、上桌效果或前后对比。',review:null},
  {id:'ending',title:'收束与行动',role:'收尾画面',time:'00:26—00:30',description:'收住叙事，并为字幕与行动引导留空间。',review:null}
];
export const ROLES = ['未标注', ...DEFAULT_REQUIREMENTS.map(r => r.role)];
