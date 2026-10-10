/** A local compiler for the single VL response; this module never calls a model. */
export const RECREATION_SCHEMA_VERSION=1;
export const RECREATION_SEGMENT_MAX_SEC=15;
const text=(value,max=4000)=>typeof value==='string'?value.trim().slice(0,max):'';
const zh=value=>/[\u3400-\u9fff]/u.test(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const round=value=>Math.round(value*1000)/1000;
const sec=value=>finite(value)?String(round(value)):'?';
const unknown=/^(未知|不确定|待确认|待分析|看不清|unknown|uncertain|n\/?a)[。.!]?$/i;
const english=value=>Boolean(value)&&!zh(value)&&/[A-Za-z]{3}/.test(value);
const words=value=>(value.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)||[]).length;
const roles=[
 {token:'@Video1',role:'reference-video',labelZh:'参考视频',instructionZh:'使用本条参考视频的对应秒段，仅参考运镜、顺序、构图和节奏；尚未导出分段视频。'},
 {token:'@Image1',role:'person',labelZh:'替换人物',instructionZh:'补充有权使用的人物正面及必要侧面参考图；每个镜头保持同一人物。'},
 {token:'@Image2',role:'product',labelZh:'替换商品',instructionZh:'补充自己商品的清晰正面、细节和需要展示的角度；以真实产品说明为准。'},
];
const referenceRule='Use @Video1 only for camera path, shot order, composition, visible action timing and pacing.';
const negativeRule='Do not copy the original identities, products, logos or captions. Do not invent product claims, dialogue, music, BPM or sound effects. Do not change replacement identities across cuts, occlusions or reflections.';
export function emptyRecreationPackage(reasonZh='这份分析没有完整导演方案，尚不能导出完整复刻提示词。'){
 return {schemaVersion:RECREATION_SCHEMA_VERSION,status:'incomplete',goalPlanZh:'',assetBindings:[],shots:[],segments:[],globalPromptEn:'',globalNegativeEn:'',fullPromptText:'',markdown:'',missingInputs:[],issuesZh:[reasonZh],timingPolicy:'approximate-visual-evidence',validationStatus:'not-generated-not-tested'};
}
/** Model contract deliberately omits duplicate segment/full prompt output. */
export function recreationPackagePrompt(){return `本次还要为这条视频写可保留复用的导演方案和完整英文提示词，但不生成视频。增加 recreationPackage 字段，只输出下列紧凑结构，不要输出 segments 或 fullPromptText 字段，它们将由本机按实际时间编译。
{"goalPlanZh":"中文：保留什么、针对用户目标改什么、为什么；不要照搬商标/原人物/未核实功效","globalPromptEn":"English: specific scene, lighting, look and continuity constraints for this video; retain @Video1 for shot order, camera path and pacing. Use @Image1 only if a person is visible and @Image2 for the target product when relevant.","globalNegativeEn":"English: specific continuity and replacement risks, no original identities/logos/copied captions or invented product claims","assetBindings":[{"token":"@Image1","required":true},{"token":"@Image2","required":true}],"shots":[{"id":"shot-1","startSec":0,"endSec":2,"descriptionZh":"只写看得到的主体和场景","framingZh":"可判断的景别","cameraZh":"可观察运镜或固定镜头，不编造焦距","actionZh":"可观察的起始→过程动作","endStateZh":"结束时真正可见的状态，不把未完成动作补完","promptEn":"Framing: specific English framing and composition. Camera: the visible camera path or locked camera. Action: specific visible start state and motion using @Image1 and/or @Image2 where needed. End state: the visible final state; do not complete an interrupted action."}],"missingInputs":[{"key":"short-key","labelZh":"待补充事项","instructionZh":"具体需要补什么"}]}。
可校验的最低输出要求：goalPlanZh 至少 10 个汉字（只计中文汉字，不计英文、数字或标点）；globalPromptEn 至少 20 个英文词；globalNegativeEn 至少 6 个英文词；每条 shots[].promptEn 至少 28 个英文词，并严格按 Framing:、Camera:、Action:、End state: 的顺序写四段，每段正文至少 4 个英文词。英文词按连续英文字母识别，词内连字符或英文撇号仍属于一个词；不要用重复词凑数，要提供具体内容。
shots 是带证据的可视分镜，完整连续覆盖 0 到本机 durationSec，不重叠、不留白、不越界。第一条 startSec 必须为 0；每条 startSec 等于上一条 endSec；最后一条 endSec 必须等于给定 measurements.durationSec 的原始数值，保留全部小数，不四舍五入或自行改写片长。无法看清或无法完成全片覆盖则如实写未知，不杜撰；系统会标为不完整。时间是视觉模型估计，不冒称精确切镜。镜头内静止也描述起止状态。每条 promptEn 必须为完整英文，用 Framing/Camera/Action/End state 四段写出具体内容，不能只说 cinematic/high quality。中文说明不能塞入英文字段，品牌名称可保留。每次人物/商品出现均用固定 @Image1/@Image2 替换，参考片始终为 @Video1；没有人物或商品时不要强加。不要假称已有替换素材。全局/分镜提示词只写画面和动作；声音是否存在以给定音轨/ASR为准，音乐、BPM、音效未知时保留未知。连续镜头超过15秒时，系统可按原片时间拆成多个操作片段，不将拆段冒称切镜。`;}
function timelineIssues(items,duration,label){
 const issues=[];if(!items.length)return [`${label}为空。`];let previous=0;
 for(const item of items){if(!item||typeof item!=='object'){issues.push(`${label}包含无效条目。`);continue;}if(!finite(item.startSec)||!finite(item.endSec)||item.endSec<=item.startSec||item.endSec>duration+0.001){issues.push(`${label}包含越界或无效时间。`);continue;}if(Math.abs(item.startSec-previous)>0.001)issues.push(`${label}存在空白、重叠或顺序不连续。`);previous=item.endSec;}
 if(Math.abs(previous-duration)>0.001)issues.push(`${label}未完整覆盖原片时长。`);return [...new Set(issues)];
}
function specificShotPrompt(value){
 if(!english(value)||words(value)<28||!/^Framing\s*:/i.test(value))return false;
 const match=/^Framing\s*:\s*([\s\S]+?)\s+Camera\s*:\s*([\s\S]+?)\s+Action\s*:\s*([\s\S]+?)\s+End state\s*:\s*([\s\S]+)$/i.exec(value);
 return Boolean(match&&match.slice(1).every(part=>words(part)>=4&&!/^(cinematic|high quality|beautiful|natural|unknown|uncertain)\b[.!\s]*$/i.test(part.trim())));
}
function makeSegments(shots){
 const groups=[];let current=null;
 const flush=()=>{if(current){groups.push(current);current=null;}};
 for(const shot of shots){let at=shot.startSec;
  if(current&&shot.endSec-current.startSec>RECREATION_SEGMENT_MAX_SEC+0.001)flush();
  while(at<shot.endSec-0.0001){if(!current)current={startSec:at,endSec:at,pieces:[]};const end=Math.min(shot.endSec,current.startSec+RECREATION_SEGMENT_MAX_SEC);current.pieces.push({shot,startSec:at,endSec:end,partial:at!==shot.startSec||end!==shot.endSec});current.endSec=end;at=end;if(current.endSec-current.startSec>=RECREATION_SEGMENT_MAX_SEC-0.001)flush();}
 }flush();return groups;
}
function compileSegments(shots,globalPromptEn,globalNegativeEn){return makeSegments(shots).map((group,index)=>{
 const shotIds=[...new Set(group.pieces.map(piece=>piece.shot.id))];
 const promptLines=group.pieces.map(piece=>`${sec(piece.startSec-group.startSec)}-${sec(piece.endSec-group.startSec)}s: ${piece.partial?`Continue only the reference interval ${sec(piece.startSec)}-${sec(piece.endSec)}s within ${piece.shot.id}; this segment boundary is not an observed cut. Do not restart or complete actions outside this interval. Full-shot context: `:''}${piece.shot.promptEn}`);
 return {id:`segment-${index+1}`,startSec:group.startSec,endSec:group.endSec,summaryZh:group.pieces.map(piece=>piece.shot.descriptionZh).join('；'),promptEn:[globalPromptEn,...promptLines].join('\n'),negativeEn:globalNegativeEn,shotIds};
});}
const markdownCell=value=>String(value).replace(/\|/g,'／').replace(/[\r\n]+/g,' ');
function markdownDocument(pack,sourceUrl){
 const lines=['# 复刻导演方案','',`状态：${pack.status==='ready'?'方案完整':pack.status==='needs-input'?'方案完整，待补素材／信息':'方案不完整'}`,`来源：${sourceUrl||'当前参考视频'}`,'','> 这是未生成、未试拍的方案；视觉时间为模型估计，不能当作机器精确切镜。','', '## 目标与改法','',pack.goalPlanZh,'','## 素材对应','',...pack.assetBindings.map(asset=>`- ${asset.token} · ${asset.labelZh}：${asset.instructionZh}${asset.status==='missing'?'（待提供）':''}`),'','## 可视分镜','', '| 时间 | 景别／运镜 | 画面与动作 | 结束状态 |','| --- | --- | --- | --- |',...pack.shots.map(shot=>`| ${sec(shot.startSec)}–${sec(shot.endSec)} 秒 | ${markdownCell(shot.framingZh+'／'+shot.cameraZh)} | ${markdownCell(shot.descriptionZh+'；'+shot.actionZh)} | ${markdownCell(shot.endStateZh)} |`)];
 if(pack.missingInputs.length)lines.push('','## 待补充','',...pack.missingInputs.map(input=>`- ${input.labelZh}：${input.instructionZh}`));
 if(pack.issuesZh.length)lines.push('','## 尚未完成','',...pack.issuesZh.map(issue=>`- ${issue}`));
 for(const segment of pack.segments)lines.push('',`## 第 ${segment.id.split('-')[1]} 段 · ${sec(segment.startSec)}–${sec(segment.endSec)} 秒`,'',segment.summaryZh,'','```text',segment.promptEn.replace(/```/g,"'''"),'```','','负面约束：','','```text',segment.negativeEn.replace(/```/g,"'''"),'```');return lines.join('\n');
}
export function normalizeRecreationPackage(raw,{measurements={},audio={},plan={},sourceUrl=''}={}){
 const pack=emptyRecreationPackage();if(!raw||typeof raw!=='object'||Array.isArray(raw))return pack;
 const issues=[],duration=measurements.durationSec;pack.issuesZh=issues;pack.goalPlanZh=text(raw.goalPlanZh,3000);
 if(!zh(pack.goalPlanZh)||(pack.goalPlanZh.match(/[\u3400-\u9fff]/gu)||[]).length<10)issues.push('目标与改法缺少具体中文说明。');
 if(!finite(duration)||duration<=0){issues.push('缺少可核验的原片时长。');return pack;}
 const rawShots=Array.isArray(raw.shots)?raw.shots:[];if(rawShots.length>80)issues.push('分镜超过当前结构容量，未截断后冒称完整。');
 const seen=new Set();pack.shots=rawShots.slice(0,80).map((item,index)=>{
  const id=text(item?.id,60)||`shot-${index+1}`;if(!/^[A-Za-z0-9_-]{1,60}$/.test(id)||seen.has(id))issues.push('分镜编号重复或无效。');seen.add(id);
  const shot={id,startSec:finite(item?.startSec)?item.startSec:null,endSec:finite(item?.endSec)?item.endSec:null,descriptionZh:text(item?.descriptionZh,1000),framingZh:text(item?.framingZh,300),cameraZh:text(item?.cameraZh,500),actionZh:text(item?.actionZh,800),endStateZh:text(item?.endStateZh,500),promptEn:text(item?.promptEn,3500),evidenceLevel:'model-inference'};
  for(const key of ['descriptionZh','framingZh','cameraZh','actionZh','endStateZh'])if(!zh(shot[key])||unknown.test(shot[key]))issues.push(`分镜 ${index+1} 的画面、动作或结束状态不充分。`);
  if(!specificShotPrompt(shot.promptEn))issues.push(`分镜 ${index+1} 缺少具体完整英文提示词。`);
  return shot;
 });
 issues.push(...timelineIssues(pack.shots,duration,'分镜时间线'));
 const global=text(raw.globalPromptEn,5000),negative=text(raw.globalNegativeEn,2000);
 if(!english(global)||words(global)<20)issues.push('全局英文方案缺少具体场景、风格或连续性约束。');
 if(!english(negative)||words(negative)<6)issues.push('缺少英文负面约束。');
 const allPrompts=[global,...pack.shots.map(shot=>shot.promptEn)].join('\n');
 if(/\b(?:music|soundtrack|bpm|dialogue|voice-?over|sound effects)\b/i.test(allPrompts))issues.push('画面提示词混入声音指令；声音部分需独立核验，未冒称已经识别。');
 if((allPrompts.match(/@(?:Image|Video)\d+/g)||[]).some(token=>!roles.some(role=>role.token===token)))issues.push('提示词使用了尚未定义的素材编号。');
 pack.assetBindings=roles.map(role=>{const required=role.token==='@Video1'||allPrompts.includes(role.token)||(Array.isArray(raw.assetBindings)?raw.assetBindings:[]).some(asset=>asset?.token===role.token&&asset.required===true);return{...role,required,status:role.token==='@Video1'?'reference-linked':required?'missing':'not-required'};});
 for(const asset of pack.assetBindings.filter(asset=>asset.status==='missing')){if(!pack.shots.some(shot=>shot.promptEn.includes(asset.token)))issues.push('必需替换素材没有对应到具体分镜提示词。');}
 for(const asset of pack.assetBindings.filter(asset=>asset.status==='missing'))pack.missingInputs.push({key:asset.role,labelZh:asset.labelZh,instructionZh:asset.instructionZh});
 if(!text(plan.product)&&pack.assetBindings.some(asset=>asset.token==='@Image2'&&asset.required))pack.missingInputs.push({key:'product-brief',labelZh:'商品信息',instructionZh:'补充真实品类、可见特征和已核实卖点，避免沿用参考品牌的产品事实。'});
 if(!text(plan.audience))pack.missingInputs.push({key:'audience',labelZh:'目标受众',instructionZh:'确认要让哪些人看懂什么，再复核这套表达是否适配。'});
 if(audio.status==='failed'||audio.status==='unknown')pack.missingInputs.push({key:'audio-evidence',labelZh:'声音信息',instructionZh:'人声识别尚未完成；当前只提供画面方案，不推断音乐、BPM 或对白。'});
 if(Array.isArray(raw.missingInputs))for(const item of raw.missingInputs.slice(0,10)){const labelZh=text(item?.labelZh,150),instructionZh=text(item?.instructionZh,800);if(zh(labelZh)&&zh(instructionZh)&&!pack.missingInputs.some(existing=>existing.labelZh===labelZh))pack.missingInputs.push({key:`model-${pack.missingInputs.length+1}`,labelZh,instructionZh});}
 // A provider may return segments despite the compact contract. Validate instead
 // of silently repairing a broken explicit timeline or treating it as complete.
 if(raw.segments!==undefined){if(!Array.isArray(raw.segments))issues.push('模型分段格式无效。');else{issues.push(...timelineIssues(raw.segments,duration,'模型分段'));for(const segment of raw.segments){if(!segment||typeof segment!=='object'){issues.push('模型分段包含无效条目。');continue;}if(segment.endSec-segment.startSec>15.001||!english(text(segment.promptEn))||!english(text(segment.negativeEn))||!Array.isArray(segment.shotIds)||!segment.shotIds.length||segment.shotIds.some(id=>!seen.has(id)))issues.push('模型分段超过15秒或缺少有效提示词／分镜对应。');}}}
 pack.globalPromptEn=english(global)?[referenceRule,global,'Audio: the visual plan does not specify dialogue, music, BPM or sound effects; supply separately verified audio instructions.'].join('\n'):'';
 pack.globalNegativeEn=english(negative)?[negative,negativeRule].join('\n'):'';
 pack.issuesZh=[...new Set(issues)];
 if(!pack.issuesZh.length){pack.segments=compileSegments(pack.shots,pack.globalPromptEn,pack.globalNegativeEn);pack.status=pack.missingInputs.length?'needs-input':'ready';pack.fullPromptText=pack.segments.map(segment=>`SEGMENT ${segment.id}: source ${sec(segment.startSec)}-${sec(segment.endSec)}s\n${segment.promptEn}\nNEGATIVE: ${segment.negativeEn}`).join('\n\n');}
 pack.markdown=markdownDocument(pack,sourceUrl);return pack;
}
