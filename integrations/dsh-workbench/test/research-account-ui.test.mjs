import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mountResearchDesk,accountStudyPayload,parseStudySource,renderResearchResult,researchMarkdown} from '../src/research-ui.mjs';
const {parseHTML}=createRequire(import.meta.url)(process.env.DOM_TEST_MODULE||'linkedom');
const clone=v=>structuredClone(v),tick=()=>new Promise(r=>setImmediate(r));
const settle=async()=>{for(let i=0;i<8;i++)await tick();};
const until=async fn=>{for(let i=0;i<250;i++){if(fn())return;await new Promise(r=>setTimeout(r,1));}assert(fn(),'Expected asynchronous UI condition');};
const sample=(id='video_one')=>({recordId:id,result:{status:'completed',titleZh:'商品细节与生活场景',summaryZh:'用细节开场，再进入使用场景。',tagsZh:['细节开场','生活感'],evidenceRef:{sourceUrl:'https://www.instagram.com/reel/SYNTHETIC/',analysisId:id},evidence:{status:'available',frames:[{timeSec:1.2,url:'/api/derek-video-replicate/research/evidence?jobId=research_one&recordId='+id+'&asset=frame-00.jpg'}],videoUrl:'/api/derek-video-replicate/research/evidence?jobId=research_one&recordId='+id+'&asset=video'},visual:{summaryZh:'产品近景过渡至人物使用',observations:[{startSec:0,endSec:3,descriptionZh:'展示细节'}]},rhythm:{modelInference:{summaryZh:'开头较慢，后段加快'},measurements:{durationSec:12,candidateCutsSec:[3,6,9]}},audio:{hasAudio:true,hasSpeech:true,text:'合成人声转写'},recommendations:[{nameZh:'细节开场形式',status:'conditional',reasonZh:'需要清晰商品素材',keepZh:['开头节奏'],adaptationsZh:['换成自己的商品'],requiredMaterials:[{descriptionZh:'产品正面照',availableStatus:'missing',required:true,alternativeZh:'先补拍'}]}],recreationPackage:{schemaVersion:1,status:'needs-input',goalPlanZh:'以自己的产品重建细节开场',assetBindings:[{token:'@Video1',labelZh:'参考视频',status:'reference-linked',instructionZh:'仅参考节奏'},{token:'@Image2',labelZh:'自己的商品',status:'missing',instructionZh:'上传商品正面照'}],shots:[{id:'shot_1',startSec:0,endSec:3,descriptionZh:'产品特写',cameraZh:'缓慢推进',actionZh:'展示细节',promptEn:'Slow push-in on @Image2.'}],segments:[{id:'segment_1',startSec:0,endSec:12,summaryZh:'从细节走向场景',promptEn:'Reference @Video1 pacing; show @Image2.',negativeEn:'No copied branding.'}],fullPromptText:'Reference @Video1 pacing; use @Image2.\nNegative: No copied branding.',markdown:'# 合成完整方案\n\n尚未生成或验证。',missingInputs:[{key:'product',labelZh:'商品素材',instructionZh:'请提供正面与侧面照片'}],issuesZh:[],validationStatus:'not-generated-not-tested'}}});
function harness(t,opts={}){
 const {document,window}=parseHTML('<main id="root"></main>'),root=document.querySelector('#root'),calls=[],copied=[],downloads=[],memory=opts.storageMap||new Map();
 let visible=true,phase='completed',styles=[],entry=sample(),job={jobId:'research_one',planRevision:1,phase:'completed',createdAt:'2026-10-10T10:00:00Z',plan:{executionMode:'account-study',userIntent:'合成账号研究',selectionPolicy:{mode:'balanced',count:4}},results:[entry],styleCandidates:[{candidateId:'candidate_one',recordIds:['video_one'],nameZh:'细节开场形式'}],events:[]};
 const context=()=>({plans:[{planId:'old_plan',planRevision:1,userIntent:'旧的私有研究',status:'awaiting_confirmation'}],topics:[{id:'topic_one',title:'合成专题'}],styles:clone(styles),jobs:visible?[{...clone(job),phase,results:[clone(entry)]}]:[]});
 const request=async(path,body)=>{calls.push({path,...(body?{body:clone(body)}:{})});if(opts.request)return opts.request(path,body,{context,job,entry});if(path==='/context')return context();if(path==='/start')return {jobId:'research_one',duplicate:calls.filter(c=>c.path==='/start').length>1};if(path.startsWith('/jobs?')){if(!visible)throw Object.assign(Error('研究已隐藏'),{code:'RESEARCH_HIDDEN'});return {...clone(job),phase,results:[clone(entry)]};}if(path.startsWith('/result?')){if(!visible)throw Error('记录已隐藏');return {jobId:'research_one',results:[clone(entry)],styleCandidates:clone(job.styleCandidates),confirmedStyles:clone(styles),accountSummary:{tagsZh:['生活感'],styleGroups:[{nameZh:'细节开场',recordIds:['video_one']}],sampleCount:1,noteZh:'仅基于本次成功分析的一条。'}};}if(path==='/styles/confirm'){const style={styleVersionId:'style_one',candidateId:'candidate_one',sourceJobId:'research_one',nameZh:'细节开场形式',version:1};styles.push(style);return {style};}if(path==='/cancel'){phase='cancelled';return{};}throw Error(path);};
 const storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
 const dispose=mountResearchDesk(root,{request,storage,initialUrl:opts.initialUrl,initialJobId:opts.initialJobId,mediaStatus:opts.mediaStatus,copyText:async text=>copied.push(text),downloadMarkdown:async value=>downloads.push(value)});t.after(dispose);
 return {root,window,calls,copied,downloads,dispose,memory,setVisible:v=>visible=v,setPhase:v=>phase=v,setEntry:v=>entry=v,async click(selector){const node=root.querySelector(selector);assert(node,'Missing '+selector);node.dispatchEvent(new window.Event('click',{bubbles:true}));await settle();},set(field,value){const node=root.querySelector(`[data-study-field="${field}"]`);assert(node);if(node.tagName==='SELECT'){for(const option of node.querySelectorAll('option'))option.removeAttribute('selected');const choice=[...node.querySelectorAll('option')].find(o=>o.value===String(value));assert(choice,'Missing select '+value);choice.setAttribute('selected','');}else node.value=value;node.dispatchEvent(new window.Event('input',{bubbles:true}));}};
}
test('new desk starts empty, defaults to six recent videos and never auto-opens an old plan or example',async t=>{const app=harness(t);await settle();assert.equal(app.root.querySelector('[data-study-field="count"]').value,'6');assert.equal(app.root.querySelector('[data-study-field="intent"]').value,'');assert(!app.root.querySelector('[data-record]'));assert(!app.root.querySelector('[data-rr="confirm"]'));assert.equal(app.calls.filter(c=>c.path.startsWith('/jobs')).length,0);assert(app.root.textContent.includes('画面分析最多 6 次'));assert(!app.root.querySelector('[data-legacy-mount]'));});
test('paste plus a single start sends exactly one account-study command without chat confirmation',async t=>{const app=harness(t,{initialUrl:'https://www.instagram.com/synthetic_brand/?tracking=synthetic'});await settle();await app.click('[data-study-action="start"]');await until(()=>app.calls.some(c=>c.path==='/start'));const posted=app.calls.find(c=>c.path==='/start').body;assert.deepEqual(posted.source,{kind:'account',url:'https://www.instagram.com/synthetic_brand/'});assert.deepEqual(posted.selectionPolicy,{mode:'balanced',count:6,windowDays:30});assert.equal(posted.executionMode,'account-study');assert.equal(posted.userIntent,'');assert.match(posted.requestId,/^request_/);assert(!Object.hasOwn(posted,'styleVersionId'));assert.equal(app.calls.filter(c=>['/confirm','/plans','/select'].includes(c.path)).length,0);await until(()=>app.root.querySelector('[data-record]'));assert.match(app.root.querySelector('[data-report-heading]').textContent,/本次 1 条参考/);assert.match(app.root.querySelector('[data-report-heading]').textContent,/1 条已有画面拆解/);});
test('source classification is local, preserves Douyin case and refuses unavailable platforms and video-as-account',()=>{assert.deepEqual(parseStudySource('分享给你 https://v.douyin.com/SYNTHETIC_Aa1/ 看一看'),{kind:'douyin-share',url:'https://v.douyin.com/SYNTHETIC_Aa1/'});const url='https://www.douyin.com/user/MS4wLjABAAAA_SYNTHETIC_Case_0123456789';assert.equal(parseStudySource(url).url,url);assert.throws(()=>parseStudySource('https://www.youtube.com/@synthetic'),/尚未接通/);assert.throws(()=>parseStudySource('https://www.douyin.com/video/7000000000000000001'),/账号主页/);assert.throws(()=>parseStudySource('https://www.instagram.com/a/ https://www.instagram.com/b/'),/一个/);assert.throws(()=>parseStudySource('https://secret@example.com/'),/账号密码/);assert.equal(accountStudyPayload({url:'https://www.instagram.com/a/',count:'6',mode:'top-in-page',materialState:'none',materialDescription:'暂无'}).materialStatus.state,'none');});
test('pending start disables the real button and double-click cannot create a second request',async t=>{let release;const app=harness(t,{initialUrl:'https://www.instagram.com/synthetic/',request:async(path,body,{context,job,entry})=>{if(path==='/context')return context();if(path==='/start')return new Promise(r=>release=r);if(path.startsWith('/jobs'))return job;if(path.startsWith('/result'))return {results:[entry]};throw Error(path);}});await settle();const button=app.root.querySelector('[data-study-action="start"]');button.dispatchEvent(new app.window.Event('click',{bubbles:true}));assert.equal(button.disabled,true);button.dispatchEvent(new app.window.Event('click',{bubbles:true}));await until(()=>release);assert.equal(app.calls.filter(c=>c.path==='/start').length,1);release({jobId:'research_one'});await settle();assert.equal(button.disabled,false);});
test('failed submission preserves requestId for manual retry; semantic change creates a new ID',async t=>{let attempts=0;const app=harness(t,{initialUrl:'https://www.instagram.com/synthetic/',request:async(path,body,{context,job,entry})=>{if(path==='/context')return context();if(path==='/start'){if(++attempts===1)throw Error('网络中断，提交状态未知');return {jobId:'research_one',duplicate:attempts===2};}if(path.startsWith('/jobs'))return job;if(path.startsWith('/result'))return {results:[entry]};throw Error(path);}});await settle();await app.click('[data-study-action="start"]');await until(()=>attempts===1);assert(app.root.textContent.includes('提交状态未知'));assert.equal(app.calls.filter(c=>c.path==='/start').length,1);await app.click('[data-study-action="start"]');await until(()=>attempts===2);const first=app.calls.filter(c=>c.path==='/start');assert.equal(first[0].body.requestId,first[1].body.requestId);app.set('intent','这次着重分析字幕');await app.click('[data-study-action="start"]');await until(()=>attempts===3);assert.notEqual(app.calls.filter(c=>c.path==='/start')[2].body.requestId,first[0].body.requestId);});
test('request identity survives remount without storing source text or preferences',async t=>{const map=new Map(),first=harness(t,{storageMap:map,initialUrl:'https://www.instagram.com/synthetic/'});await settle();await first.click('[data-study-action="start"]');await until(()=>first.calls.some(c=>c.path==='/start'));const original=first.calls.find(c=>c.path==='/start').body.requestId;first.dispose();const second=harness(t,{storageMap:map,initialUrl:'https://www.instagram.com/synthetic/'});await settle();await second.click('[data-study-action="start"]');await until(()=>second.calls.some(c=>c.path==='/start'));assert.equal(second.calls.find(c=>c.path==='/start').body.requestId,original);assert(![...map.values()].join('').includes('instagram'));});
test('dialog details use controlled evidence, seek the card player and copy original full or segmented prompts',async t=>{
 const app=harness(t,{initialJobId:'research_one'});await settle();const card=app.root.querySelector('[data-record]');assert(card);
 const video=card.querySelector('video');assert(video.getAttribute('src').startsWith('/api/derek-video-replicate/research/evidence?'));
 await app.click('[data-rr="open-breakdown"]');await app.click('[data-rr="detail-tab"][data-view="analysis"]');
 const dialog=card.querySelector('dialog[data-video-panel]');assert.equal(dialog.querySelectorAll('.rr-frames img').length,1);
 assert.equal(dialog.querySelectorAll('.rr-cut-strip button').length,4);assert(dialog.textContent.includes('中位段长约 3.0 秒'));
 await app.click('[data-rr="seek-frame"]');assert.equal(video.currentTime,1.2);assert(!dialog.hasAttribute('open'));
 await app.click('[data-rr="open-breakdown"]');await app.click('[data-rr="copy-package"]');
 assert.equal(app.copied[0],sample().result.recreationPackage.fullPromptText);
 await app.click('[data-rr="copy-segment"]');assert(app.copied[1].includes('No copied branding.'));
 await app.click('[data-rr="download-package"]');assert(app.downloads[0].text.includes('# 合成完整方案'));assert(app.downloads[0].name.endsWith('.md'));
 assert(dialog.textContent.includes('补齐素材后可尝试'));assert(dialog.textContent.includes('尚未生成视频或验证成片'));
 assert.equal(card.querySelectorAll('video').length,1);assert.equal(app.calls.filter(c=>c.body).length,0);
});

test('stable background refresh preserves the player, play position and open dialog',async t=>{
 let poll;const mock=t.mock.method(globalThis,'setInterval',fn=>{poll=fn;return {unref(){}};});
 const app=harness(t,{initialJobId:'research_one'});mock.mock.restore();await settle();
 const article=app.root.querySelector('[data-record]'),video=article.querySelector('video'),dialog=article.querySelector('dialog[data-video-panel]');
 assert(dialog);await app.click('[data-rr="open-breakdown"]');assert(dialog.hasAttribute('open'));video.currentTime=4.2;
 poll();await settle();
 assert.equal(app.root.querySelector('[data-record]'),article);assert.equal(app.root.querySelector('video'),video);
 assert.equal(video.currentTime,4.2);assert.equal(app.root.querySelector('[data-video-panel]'),dialog);assert(dialog.hasAttribute('open'));
 assert.equal(app.calls.filter(c=>c.body).length,0);
});

test('background privacy refresh clears a hidden or trashed study with an open dialog',async t=>{
 let poll;const mock=t.mock.method(globalThis,'setInterval',fn=>{poll=fn;return {unref(){}};});
 const app=harness(t,{initialJobId:'research_one'});mock.mock.restore();await settle();
 await app.click('[data-rr="open-breakdown"]');assert(app.root.querySelector('dialog[data-video-panel]').hasAttribute('open'));
 const video=app.root.querySelector('video');let paused=0;video.pause=()=>paused++;
 app.setVisible(false);poll();await settle();
 assert.equal(app.root.querySelector('[data-record]'),null);assert.equal(app.root.querySelector('[data-video-panel]'),null);
 assert(!app.root.textContent.includes('Reference @Video1 pacing; use @Image2.'));assert(paused>0);
 assert(app.root.textContent.includes('屏幕内容已清除'));assert.equal(app.calls.filter(c=>c.body).length,0);
});

test('adopting a style shows saved state and never silently selects it for a new request',async t=>{const app=harness(t,{initialJobId:'research_one',initialUrl:'https://www.instagram.com/synthetic/'});await settle();await app.click('[data-rr="adopt"]');assert(app.root.querySelector('[data-rr="adopt"]').disabled);assert(app.root.querySelector('[data-rr="adopt"]').textContent.includes('已保留'));assert.equal(app.root.querySelector('[data-study-field="styleVersionId"]').value,'');await app.click('[data-study-action="start"]');await until(()=>app.calls.some(c=>c.path==='/start'));assert(!Object.hasOwn(app.calls.find(c=>c.path==='/start').body,'styleVersionId'));app.set('styleVersionId','style_one');await app.click('[data-study-action="start"]');await until(()=>app.calls.filter(c=>c.path==='/start').length===2);assert.equal(app.calls.filter(c=>c.path==='/start')[1].body.styleVersionId,'style_one');});
test('unsupported platform blocks local submission while allowing the explicit advanced option',async t=>{const app=harness(t,{initialUrl:'https://www.youtube.com/@synthetic'});await settle();await app.click('[data-study-action="start"]');assert(app.root.textContent.includes('适配尚未接通'));assert.equal(app.calls.filter(c=>c.body).length,0);assert(app.root.querySelector('[data-study-action="advanced"]'));});
test('untrusted prompts escape markup, unapproved media URLs stay out, incomplete output is labeled',()=>{const entry=sample();entry.result.recreationPackage.status='incomplete';entry.result.recreationPackage.fullPromptText='<script>unsafe()</script>';entry.result.evidence.videoUrl='https://cdn.example.com/raw.mp4';entry.result.evidence.frames[0].url='javascript:alert(1)';const {document}=parseHTML('<div id="r"></div>'),root=document.querySelector('#r');root.innerHTML=renderResearchResult({results:[entry]});assert.equal(root.querySelectorAll('script,video,img').length,0);assert(root.textContent.includes('<script>unsafe()</script>'));assert(root.textContent.includes('方案未完整'));assert(researchMarkdown(entry).includes('合成完整方案'));});


function comparisonHarness(t,{status='completed',recommendations,mediaStatus,entries:providedEntries}={}){
 const entries=providedEntries||Array.from({length:6},(_,i)=>sample('video_'+(i+1))),comparison={status,summaryZh:status==='completed'?'三种有画面依据的形式各选一条。':'横向比较尚未完成。',recommendations:recommendations||[{recordId:'video_3',reasonZh:'第三条结果对比清楚',formZh:'结果对比',materialThresholdZh:'同场景前后画面'},{recordId:'video_1',reasonZh:'第一条动作结构简单',formZh:'动作演示',materialThresholdZh:'产品与双手'},{recordId:'video_5',reasonZh:'第五条补充生活方式',formZh:'生活方式',materialThresholdZh:'真实生活空间'}],excluded:[{recordId:'video_2',reasonZh:'形式重复'},{recordId:'video_4',reasonZh:'素材门槛高'},{recordId:'video_6',reasonZh:'证据不足'}]};
 const job={jobId:'research_preview',phase:'completed',plan:{executionMode:'account-study',selectionPolicy:{count:6,windowDays:30}},results:entries,comparison,candidates:entries.map(e=>({recordId:e.recordId,publishedAt:'2026-10-07T00:00:00Z',url:e.result.evidenceRef.sourceUrl}))};
 const app=harness(t,{initialJobId:job.jobId,mediaStatus,request:async path=>{if(path==='/context')return{topics:[],styles:[],plans:[],jobs:[job]};if(path.startsWith('/jobs'))return clone(job);if(path.startsWith('/result'))return clone({...job,styleCandidates:[]});throw Error(path);}});
 return {...app,job,comparison,entries};
}
test('six compact cards keep valid recommendations first and show one direct player each',async t=>{
 const app=comparisonHarness(t);await settle();const cards=[...app.root.querySelectorAll('[data-primary-results]>[data-record]')];
 assert.deepEqual(cards.map(c=>c.dataset.record),['video_3','video_1','video_5','video_2','video_4','video_6']);
 assert.equal(app.root.querySelectorAll('[data-record]').length,6);
 assert.deepEqual(cards.filter(c=>c.dataset.recommended==='true').map(c=>c.dataset.record),['video_3','video_1','video_5']);
 assert.equal(app.root.querySelectorAll('[data-candidate-results]>[data-record]').length,0);assert(app.root.querySelector('[data-candidate-report]').hidden);
 for(const [i,card] of cards.entries()){
  const video=card.querySelector('video'),dialog=card.querySelector('dialog[data-video-panel]');assert(video);assert(dialog);
  assert.equal(card.querySelectorAll('video').length,1);assert.equal(video.closest('details,dialog'),null);
  assert(video.getAttribute('poster')?.startsWith('/api/derek-video-replicate/research/evidence?'));
  assert(card.querySelector('.rr-source-link')?.getAttribute('href')?.startsWith('https://'));
  assert.equal(card.querySelector('.rr-preview-reason,.rr-preview-advice,.rr-preview-materials'),null);
  assert.equal(dialog.querySelectorAll('video').length,0);assert(!dialog.hasAttribute('open'));
  assert.equal(/推荐/.test(card.querySelector('.rr-preview-top').textContent),i<3);
  assert.equal(card.querySelector('[data-rr="open-breakdown"]').textContent,'复刻提示词');
 }
 await app.click('[data-rr="open-breakdown"]');assert(cards[0].querySelector('dialog').hasAttribute('open'));
 assert(cards[0].querySelector('dialog').textContent.includes('Reference @Video1 pacing; use @Image2.'));
 assert.equal(app.calls.filter(c=>c.body).length,0);
});

test('pending and failed comparisons show all six playable analyses without recommendation badges',async t=>{
 for(const status of ['pending','failed']){
  const app=comparisonHarness(t,{status});await settle();const cards=[...app.root.querySelectorAll('[data-primary-results]>[data-record]')];
  assert.equal(cards.length,6);assert(cards.every(c=>c.querySelector('.rr-preview-top').textContent.includes('提示词已就绪')));
  assert(cards.every(c=>c.dataset.recommended!=='true'));assert(cards.every(c=>!c.querySelector('.rr-preview-top').textContent.includes('推荐')));
  assert(cards.every(c=>c.querySelector('video').closest('details,dialog')===null));
  assert(app.root.querySelector('[data-candidate-report]').hidden);assert.equal(app.calls.filter(c=>c.body).length,0);app.dispose();
 }
});

test('partial visual success sorts all six cards with completed analyses first',async t=>{
 for(const status of ['pending','failed']){
  const entries=Array.from({length:6},(_,i)=>sample('video_'+(i+1)));
  for(const i of [1,3,4]){entries[i].result.steps={vl:{status:i===4?'failed':'received'}};entries[i].result.error={code:i===4?'MOSI_FAILED':'RESEARCH_OUTPUT'};}
  const app=comparisonHarness(t,{status,entries});await settle();const cards=[...app.root.querySelectorAll('[data-primary-results]>[data-record]')];
  assert.deepEqual(cards.map(c=>c.dataset.record),['video_1','video_3','video_6','video_2','video_4','video_5']);
  assert(cards.every(c=>c.querySelector('video')?.closest('details,dialog')===null));
  assert(cards.slice(0,3).every(c=>c.querySelector('.rr-preview-top').textContent.includes('提示词已就绪')));
  assert(cards.slice(3).every(c=>c.querySelector('.rr-preview-top').textContent.includes('未完成')));
  assert(cards.every(c=>c.dataset.recommended!=='true'));assert.equal(app.root.querySelectorAll('[data-candidate-results]>[data-record]').length,0);
  assert.equal(app.calls.filter(c=>c.body).length,0);app.dispose();
 }
});

test('gallery sorts playable stage records before unplayable failures without folding any rows',async t=>{
 const entries=Array.from({length:6},(_,i)=>sample('video_'+(i+1)));
 for(const entry of entries.slice(0,5)){entry.result.steps={vl:{status:'failed'}};entry.result.visual={observations:[]};}
 for(const i of [0,2,3])entries[i].result.evidence={status:'unavailable',frames:[]};
 const app=comparisonHarness(t,{status:'failed',entries});await settle();const cards=[...app.root.querySelectorAll('[data-primary-results]>[data-record]')];
 assert.deepEqual(cards.map(c=>c.dataset.record),['video_6','video_2','video_5','video_1','video_3','video_4']);
 assert(cards.slice(0,3).every(c=>c.querySelector('video')));assert(cards.slice(3).every(c=>!c.querySelector('video')));
 assert(cards[0].querySelector('.rr-preview-top').textContent.includes('提示词已就绪'));
 assert(cards.slice(1,3).every(c=>c.querySelector('.rr-preview-top').textContent.includes('未完成')));
 assert(cards.slice(3).every(c=>c.querySelector('.rr-preview-top').textContent.includes('未完成')));
 assert(cards.every(c=>c.dataset.recommended!=='true'));assert.equal(app.root.querySelectorAll('[data-record]').length,6);
});

test('updated analysis refreshes the retained player label without resetting playback',async t=>{
 let entry=sample();entry.result.titleZh='画面分析尚未完成';entry.result.steps={vl:{status:'received'}};
 const app=harness(t,{initialJobId:'research_one',request:async(path,body,{job})=>{const current={...job,phase:'partial',results:[clone(entry)]};if(path==='/context')return{topics:[],styles:[],plans:[],jobs:[current]};if(path.startsWith('/jobs'))return current;if(path.startsWith('/result'))return{results:[clone(entry)]};throw Error(path);}});
 await settle();const video=app.root.querySelector('[data-primary-results] video');assert.equal(video.getAttribute('aria-label'),'参考视频 01参考视频预览');assert.match(video.closest('[data-record]').querySelector('.rr-preview-top').textContent,/未完成/);assert.equal(video.closest('[data-record]').querySelector('[data-rr="open-breakdown"]').textContent,'查看已有记录');video.currentTime=4.2;
 entry=sample();entry.result.titleZh='细节开场与生活场景';entry.result.steps={vl:{status:'completed'}};
 await app.click('[data-study-action="refresh"]');
 assert.equal(app.root.querySelector('[data-primary-results] video'),video);assert.equal(video.currentTime,4.2);
 assert.equal(video.getAttribute('aria-label'),'细节开场与生活场景参考视频预览');assert(!video.getAttribute('aria-label').includes('未完成'));
});
test('comparison filters unknown, repeated and incomplete records and caps valid recommendations at three',async t=>{
 const entries=Array.from({length:6},(_,i)=>sample('video_'+(i+1)));entries[0].result.steps={vl:{status:'failed'}};
 const recommendations=[{recordId:'missing'},{recordId:'video_1'},{recordId:'video_2'},{recordId:'video_2'},{recordId:'video_3'},{recordId:'video_4'},{recordId:'video_5'}].map(r=>({...r,reasonZh:'比较返回的候选'}));
 const app=comparisonHarness(t,{entries,recommendations});await settle();const cards=[...app.root.querySelectorAll('[data-primary-results]>[data-record]')];
 assert.deepEqual(cards.map(c=>c.dataset.record),['video_2','video_3','video_4','video_5','video_6','video_1']);
 assert.deepEqual(cards.filter(c=>c.dataset.recommended==='true').map(c=>c.dataset.record),['video_2','video_3','video_4']);
 assert(cards.slice(3).every(c=>!c.querySelector('.rr-preview-top').textContent.includes('推荐')));
 assert.match(cards[5].querySelector('.rr-preview-top').textContent,/未完成/);
 assert.equal(app.root.querySelectorAll('[data-candidate-results]>[data-record]').length,0);
});

test('completed comparison without a suitable recommendation keeps all six cards without recommendation badges',async t=>{
 const app=comparisonHarness(t,{recommendations:[]});await settle();const cards=[...app.root.querySelectorAll('[data-primary-results]>[data-record]')];
 assert.equal(cards.length,6);assert(cards.every(c=>c.dataset.recommended!=='true'));
 assert(cards.every(c=>!c.querySelector('.rr-preview-top').textContent.includes('推荐')));
 assert.equal(app.root.querySelectorAll('[data-candidate-results]>[data-record]').length,0);assert(app.root.querySelector('[data-candidate-report]').hidden);
 assert.match(app.root.querySelector('[data-report-heading]').textContent,/暂无可靠优选结论/);
});

test('media expiry is checked once using local evidence only and does not create a paid request',async t=>{const checked=[],app=comparisonHarness(t,{mediaStatus:async url=>{checked.push(url);return 410;}});await settle();const video=app.root.querySelector('[data-primary-results] video');video.dispatchEvent(new app.window.Event('error',{bubbles:true}));await settle();const message=video.closest('[data-record]').querySelector('[data-media-error]');assert.equal(message.hidden,false);assert.match(message.textContent,/缓存已过期/);assert.match(message.textContent,/不会自动重新抓取或收费刷新/);video.dispatchEvent(new app.window.Event('error',{bubbles:true}));await settle();assert.equal(checked.length,1);assert(checked[0].startsWith('/api/derek-video-replicate/research/evidence?'));assert.equal(app.calls.filter(c=>c.body).length,0);});
test('playing one of six visible reference videos pauses the other five without autoplay or opening dialogs',async t=>{
 const app=comparisonHarness(t);await settle();const videos=[...app.root.querySelectorAll('[data-primary-results] [data-research-video]')],paused=[];
 assert.equal(videos.length,6);videos.forEach((v,i)=>v.pause=()=>paused.push(i));videos[4].dispatchEvent(new app.window.Event('play',{bubbles:true}));
 assert.deepEqual(paused,[0,1,2,3,5]);assert(videos.every(v=>!v.hasAttribute('autoplay')));
 assert([...app.root.querySelectorAll('dialog[data-video-panel]')].every(d=>!d.hasAttribute('open')));
 assert.equal(app.calls.filter(c=>c.body).length,0);
});

test('new study policy is bounded to five or six videos in thirty days and only two clear preferences',()=>{const payload=accountStudyPayload({url:'https://www.instagram.com/synthetic/'});assert.deepEqual(payload.selectionPolicy,{mode:'balanced',count:6,windowDays:30});assert.throws(()=>accountStudyPayload({url:'https://www.instagram.com/synthetic/',count:4}),/5 或 6/);assert.throws(()=>accountStudyPayload({url:'https://www.instagram.com/synthetic/',mode:'latest'}),/选片方式/);assert.equal(accountStudyPayload({url:'https://www.instagram.com/synthetic/',count:5,mode:'top-in-page'}).selectionPolicy.count,5);});

test('new thirty-day study is explicit and gets a fresh request identity while ordinary repeat remains idempotent',async t=>{
 const digest=crypto.subtle.digest.bind(crypto.subtle);
 // WebCrypto can finish after several event-loop turns under the full suite's load.
 t.mock.method(crypto.subtle,'digest',async(...args)=>{await new Promise(r=>setTimeout(r,10));return digest(...args);});
 const app=harness(t,{initialUrl:'https://www.instagram.com/synthetic/'}),requests=()=>app.calls.filter(c=>c.path==='/start');
 const submit=async(action,count)=>{await app.click(`[data-study-action="${action}"]`);await until(()=>requests().length===count&&!app.root.querySelector('[data-study-action="start"]').disabled);return requests()[count-1].body;};
 await settle();assert.equal(app.root.querySelector('[data-study-action="start-new"]'),null);
 const first=await submit('start',1);
 assert.match(app.root.querySelector('[data-study-action="start-new"]').textContent,/重新计费/);
 assert.equal((await submit('start',2)).requestId,first.requestId);
 const third=await submit('start-new',3);
 assert.notEqual(third.requestId,first.requestId);assert.deepEqual(third.selectionPolicy,{mode:'balanced',count:6,windowDays:30});assert(!Object.hasOwn(third,'styleVersionId'));
 assert.equal((await submit('start',4)).requestId,third.requestId);
});
test('active research never exposes a fresh-charge button, and blocked samples are labeled not started',async t=>{const app=harness(t,{initialJobId:'research_one',request:async(path,body,{job})=>{const current={...job,phase:'analyzing',videos:[{recordId:'video_one',status:'failed',stage:'analyzing'},{recordId:'video_two',status:'blocked',stage:'not-started'}]};if(path==='/context')return{plans:[],topics:[],styles:[],jobs:[current]};if(path.startsWith('/jobs'))return current;if(path.startsWith('/result'))return{results:[]};throw Error(path);}});await settle();assert.equal(app.root.querySelector('[data-study-action="start-new"]'),null);assert(app.root.textContent.includes('1 条尚未开始'));assert(app.root.textContent.includes('未开始 · 前一条验证未通过'));});

test('explicit new study from history can reuse only the source while prior business assumptions stay out',async t=>{const source={kind:'account',url:'https://www.instagram.com/old_source_only/'},old={jobId:'research_old',phase:'completed',plan:{executionMode:'account-study',source,userIntent:'旧案例的要求',product:'旧产品',audience:'旧受众',styleVersionId:'old_style',selectionPolicy:{count:4}},results:[sample()]};const app=harness(t,{initialJobId:old.jobId,request:async(path,body)=>{if(path==='/context')return{topics:[],styles:[],plans:[],jobs:[old]};if(path==='/start')return{jobId:old.jobId};if(path.startsWith('/jobs'))return old;if(path.startsWith('/result'))return{results:old.results};throw Error(path);}});await settle();assert.equal(app.root.querySelector('[data-study-field="url"]').value,'');await app.click('[data-study-action="start-new"]');await until(()=>app.calls.some(c=>c.path==='/start'));const posted=app.calls.find(c=>c.path==='/start').body;assert.deepEqual(posted.source,source);assert.equal(posted.userIntent,'');assert(!Object.hasOwn(posted,'product'));assert(!Object.hasOwn(posted,'audience'));assert(!Object.hasOwn(posted,'styleVersionId'));assert.equal(posted.selectionPolicy.count,6);});

test('an externally resumed partial job restarts local result polling and reaches completed UI',async t=>{let background,nextPoll,phase='partial';const intervalMock=t.mock.method(globalThis,'setInterval',fn=>{background=fn;return{unref(){}};});const app=harness(t,{initialJobId:'research_one',request:async(path,body,{job,entry})=>{const current={...clone(job),phase};if(path==='/context')return{plans:[],topics:[],styles:[],jobs:[current]};if(path.startsWith('/jobs'))return current;if(path.startsWith('/result'))return{results:[entry]};throw Error(path);}});intervalMock.mock.restore();await settle();const timer=globalThis.setTimeout;const timerMock=t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>ms===2400?(nextPoll=fn,{unref(){}}):timer(fn,ms,...args));const before=app.calls.filter(c=>c.path.startsWith('/jobs')).length;phase='analyzing';background();await settle();assert.equal(app.calls.filter(c=>c.path.startsWith('/jobs')).length,before+1);assert.equal(typeof nextPoll,'function');phase='completed';nextPoll();await settle();assert(app.root.querySelector('[data-study-status]').textContent.includes('研究记录已保存'));assert(!app.root.querySelector('[data-study-status]').textContent.includes('分析画面与声音'));timerMock.mock.restore();});
test('failed VL with a readable video remains incomplete and offers existing records instead of a ready prompt',async t=>{
 const entry=sample();entry.result.status='partial';entry.result.steps={vl:{status:'failed'}};
 const app=harness(t,{initialJobId:'research_one',request:async(path,body,{job})=>{const current={...job,phase:'partial',results:[entry]};if(path==='/context')return{plans:[],topics:[],styles:[],jobs:[current]};if(path.startsWith('/jobs'))return current;if(path.startsWith('/result'))return{results:[entry],comparison:{status:'pending',summaryZh:'尚未比较'}};throw Error(path);}});
 await settle();assert.match(app.root.querySelector('.rr-preview-top').textContent,/未完成/);
 assert(!app.root.querySelector('.rr-preview-top').textContent.includes('已就绪'));assert.match(app.root.querySelector('[data-report-heading]').textContent,/0 条已有画面拆解/);
 assert.equal(app.root.querySelector('.rr-preview-reason'),null);assert.notEqual(app.root.querySelector('[data-record]').dataset.recommended,'true');
 assert.equal(app.root.querySelector('video').closest('details,dialog'),null);assert.equal(app.root.querySelector('[data-rr="open-breakdown"]').textContent,'查看已有记录');
 await app.click('[data-rr="open-breakdown"]');assert.match(app.root.querySelector('[data-detail-view="plan"]').textContent,/尚未完成/);
 assert.equal(app.root.querySelector('[data-rr="copy-full-package"]'),null);assert.equal(app.calls.filter(c=>c.body).length,0);
});

test('audio failure preserves valid visual status while missing or unvalidated observations never claim readiness',()=>{
 for(const [vl,observations,ready]of [['completed',[{startSec:0,endSec:1,descriptionZh:'有效画面证据'}],true],['completed',[],false],['received',[{startSec:0,endSec:1,descriptionZh:'未校验观察'}],false]]){
  const entry=sample();entry.result.status='partial';entry.result.steps={vl:{status:vl},asr:{status:'failed'}};entry.result.visual.observations=observations;
  const {document}=parseHTML(renderResearchResult({results:[entry]},{previewFirst:true}));
  assert.match(document.querySelector('.rr-preview-top').textContent,ready?/提示词已就绪/:/未完成/);
  assert.equal(document.querySelector('[data-rr="open-breakdown"]').textContent,ready?'复刻提示词':'查看已有记录');
 }
 const entry=sample();entry.result.steps={vl:{status:'failed'}};entry.result.evidence={frames:[]};
 const {document}=parseHTML(renderResearchResult({results:[entry]},{previewFirst:true}));
 assert.match(document.querySelector('.rr-preview-top').textContent,/未完成/);assert.equal(document.querySelector('video'),null);
});

function resumableJob(){const first=sample('video_first');first.result.status='partial';first.result.steps={vl:{status:'received'},asr:{status:'completed'}};first.result.error={code:'RESEARCH_OUTPUT'};first.result.visual.observations=[];const ids=['video_first',...Array.from({length:5},(_,i)=>'video_remaining_'+i)];return{jobId:'research_resumable',planRevision:3,phase:'partial',plan:{executionMode:'account-study',selectionPolicy:{count:6},budgetScope:{firstVideoGate:true}},analysisGate:{status:'blocked',recordId:ids[0]},selectedRecordIds:ids,results:[first],videos:ids.map((recordId,i)=>({recordId,status:i?'blocked':'partial',stage:i?'not-started':'analyzing'})),events:[]};}
test('eligible cache recovery exposes a version-bound continue button and never creates a new study',async t=>{const job=resumableJob();const app=harness(t,{initialJobId:job.jobId,request:async(path,body)=>{if(path==='/context')return{plans:[],topics:[],styles:[],jobs:[job]};if(path.startsWith('/jobs'))return clone(job);if(path.startsWith('/result'))return{results:clone(job.results)};if(path==='/resume-unstarted'){job.resumeUnstarted={firstRecordId:'video_first'};job.phase='selection_confirmed';return{jobId:job.jobId,duplicate:false};}throw Error(path);}});await settle();const button=app.root.querySelector('[data-study-action="resume-unstarted"]');assert(button);assert.match(button.textContent,/继续未开始的 5 条（首条读取缓存）/);assert.match(app.root.textContent,/后续按原定范围调用与计费/);await app.click('[data-study-action="resume-unstarted"]');const writes=app.calls.filter(c=>c.body);assert.equal(writes.length,1);assert.equal(writes[0].path,'/resume-unstarted');assert.deepEqual(writes[0].body,{jobId:'research_resumable',planRevision:3});assert.equal(app.root.querySelector('[data-study-action="resume-unstarted"]'),null);assert.equal(app.calls.filter(c=>c.path==='/start').length,0);assert(app.calls.filter(c=>c.path.startsWith('/jobs')).length>=2);});
test('continue button is absent when cache recovery would risk a paid retry or duplicate work',async t=>{const changes=[j=>{j.results[0].result.steps.vl.status='failed';},j=>{j.results[0].result.error.code='MOSI_FAILED';},j=>{j.resumeUnstarted={};},j=>{j.cancelRequested=true;},j=>{j.phase='analyzing';},j=>{j.events=[{detail:{recordId:'video_remaining_0',status:'requesting'}}];},j=>{j.results.push(sample('video_remaining_1'));}];for(const change of changes){const job=resumableJob();change(job);const app=harness(t,{initialJobId:job.jobId,request:async path=>{if(path==='/context')return{plans:[],topics:[],styles:[],jobs:[job]};if(path.startsWith('/jobs'))return job;if(path.startsWith('/result'))return{results:job.results};throw Error(path);}});await settle();assert.equal(app.root.querySelector('[data-study-action="resume-unstarted"]'),null);assert.equal(app.calls.filter(c=>c.body).length,0);app.dispose();}});
test('double-click on continue while request is pending sends one resume command',async t=>{const job=resumableJob();let release;const app=harness(t,{initialJobId:job.jobId,request:async path=>{if(path==='/context')return{plans:[],topics:[],styles:[],jobs:[job]};if(path.startsWith('/jobs'))return job;if(path.startsWith('/result'))return{results:job.results};if(path==='/resume-unstarted')return new Promise(r=>release=r);throw Error(path);}});await settle();const button=app.root.querySelector('[data-study-action="resume-unstarted"]');button.dispatchEvent(new app.window.Event('click',{bubbles:true}));assert.equal(button.disabled,true);button.dispatchEvent(new app.window.Event('click',{bubbles:true}));await until(()=>release);assert.equal(app.calls.filter(c=>c.path==='/resume-unstarted').length,1);job.resumeUnstarted={};job.phase='selection_confirmed';release({jobId:job.jobId});await settle();assert.equal(app.root.querySelector('[data-study-action="resume-unstarted"]'),null);});

test('prompt dialog opens the original plan, switches detail tabs and closes without changing playback or making requests',async t=>{
 const app=harness(t,{initialJobId:'research_one'});await settle();const before=app.calls.length,card=app.root.querySelector('[data-record]'),video=card.querySelector('video');video.currentTime=5.4;
 assert.equal(card.querySelector('[data-rr="open-breakdown"]').textContent,'复刻提示词');await app.click('[data-rr="open-breakdown"]');
 const dialog=card.querySelector('dialog[data-video-panel]'),plan=dialog.querySelector('[data-detail-view="plan"]'),analysis=dialog.querySelector('[data-detail-view="analysis"]');
 assert(dialog.hasAttribute('open'));assert(dialog.querySelector('.rr-video-body'));assert.equal(plan.hidden,false);assert.equal(analysis.hidden,true);
 assert(dialog.querySelector('details[data-preserve$="-prompts"]').open);assert(dialog.querySelector('details[data-preserve$="-shots"]').open);
 await app.click('[data-rr="detail-tab"][data-view="analysis"]');assert.equal(plan.hidden,true);assert.equal(analysis.hidden,false);
 assert.equal(dialog.querySelector('[data-view="analysis"]').getAttribute('aria-pressed'),'true');assert(analysis.textContent.includes('中文拆解'));
 await app.click('[data-rr="detail-tab"][data-view="plan"]');assert.equal(plan.hidden,false);assert.equal(analysis.hidden,true);
 await app.click('[data-rr="copy-full-package"]');assert(app.copied[0].includes('# 合成完整方案'));assert(app.copied[0].includes(sample().result.recreationPackage.fullPromptText));
 await app.click('[data-rr="close-breakdown"]');assert(!dialog.hasAttribute('open'));
 assert.equal(card.querySelector('video'),video);assert.equal(video.currentTime,5.4);assert.equal(card.querySelectorAll('video').length,1);
 assert.equal(app.calls.length,before,'Opening, tab switching, copying and closing use existing local results');
});

test('a missing full prompt offers existing records and cannot be copied as a complete execution package',async t=>{
 const app=harness(t,{initialJobId:'research_one'});await settle();const entry=sample();entry.result.recreationPackage.fullPromptText='';entry.result.recreationPackage.status='incomplete';
 app.setEntry(entry);await app.click('[data-study-action="refresh"]');assert.equal(app.root.querySelector('[data-rr="open-breakdown"]').textContent,'查看已有记录');
 await app.click('[data-rr="open-breakdown"]');const copy=app.root.querySelector('[data-rr="copy-full-package"]');assert(!copy||copy.disabled);
 assert.match(app.root.querySelector('[data-detail-view="plan"]').textContent,/尚未完成/);assert.equal(app.copied.length,0);assert.equal(app.calls.filter(c=>c.body).length,0);
});

test('refresh updates an open analysis dialog while retaining its tab and the card playback node',async t=>{
 const app=comparisonHarness(t);await settle();const selector='[data-record="video_3"]';
 await app.click(selector+' [data-rr="open-breakdown"]');await app.click(selector+' [data-rr="detail-tab"][data-view="analysis"]');
 const video=app.root.querySelector(selector+' video');video.currentTime=6.7;
 app.entries[2].result.visual.summaryZh='刷新后补全的合成画面观察';await app.click('[data-study-action="refresh"]');
 const card=app.root.querySelector(selector),dialog=card.querySelector('dialog[data-video-panel]');assert(dialog.hasAttribute('open'));
 assert.equal(dialog.querySelector('[data-detail-view="analysis"]').hidden,false);assert.equal(dialog.querySelector('[data-detail-view="plan"]').hidden,true);
 assert(dialog.textContent.includes('刷新后补全的合成画面观察'));assert.equal(card.querySelector('video'),video);assert.equal(video.currentTime,6.7);
 assert.equal(app.root.querySelectorAll('[data-primary-results]>[data-record]').length,6);assert.equal(app.calls.filter(c=>c.body).length,0);
});
test('refresh removes a hidden result and its open dialog while preserving the other five playable cards',async t=>{
 const app=comparisonHarness(t);await settle();const selector='[data-record="video_3"]';await app.click(selector+' [data-rr="open-breakdown"]');
 const removedVideo=app.root.querySelector(selector+' video'),retainedVideo=app.root.querySelector('[data-record="video_1"] video');let paused=0;removedVideo.pause=()=>paused++;retainedVideo.currentTime=2.8;
 app.job.results=app.entries.filter(e=>e.recordId!=='video_3');await app.click('[data-study-action="refresh"]');
 assert.equal(app.root.querySelector(selector),null);assert.equal(app.root.querySelector('#rr-video-video_3'),null);assert(paused>0);
 assert.equal(app.root.querySelectorAll('[data-primary-results]>[data-record]').length,5);assert.equal(app.root.querySelectorAll('dialog[open]').length,0);
 assert.equal(app.root.querySelector('[data-record="video_1"] video'),retainedVideo);assert.equal(retainedVideo.currentTime,2.8);
 assert(!app.root.querySelector('[data-study-results]').innerHTML.includes('recordId=video_3'));assert.equal(app.calls.filter(c=>c.body).length,0);
});
test('repeatedly reading all six dialogs and refreshing never starts, resumes or retries paid work',async t=>{
 const app=comparisonHarness(t);await settle();
 for(const card of app.root.querySelectorAll('[data-primary-results]>[data-record]')){
  const selector='[data-record="'+card.dataset.record+'"]';await app.click(selector+' [data-rr="open-breakdown"]');
  assert.equal(app.root.querySelectorAll('dialog[open]').length,1);await app.click(selector+' [data-rr="detail-tab"][data-view="analysis"]');
  await app.click(selector+' [data-rr="detail-tab"][data-view="plan"]');await app.click(selector+' [data-rr="copy-package"]');await app.click(selector+' [data-rr="close-breakdown"]');
 }
 await app.click('[data-study-action="refresh"]');await app.click('[data-study-action="refresh"]');
 assert.equal(app.copied.length,6);assert.equal(app.calls.filter(c=>c.body).length,0);
 assert(app.calls.every(c=>c.path==='/context'||c.path.startsWith('/jobs?')||c.path.startsWith('/result?')));
 assert.equal(app.root.querySelectorAll('[data-primary-results]>[data-record]').length,6);assert.equal(app.root.querySelectorAll('dialog[open]').length,0);
});
