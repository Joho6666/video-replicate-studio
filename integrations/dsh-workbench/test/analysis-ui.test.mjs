import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {renderAnalysis,analysisStatus} from '../src/analysis-ui.mjs';
const require=createRequire(import.meta.url),{parseHTML}=require(process.env.DOM_TEST_MODULE||'linkedom');
const render=payload=>parseHTML('<main>'+renderAnalysis(payload)+'</main>').document.querySelector('main');
test('completed analysis separates model observation, machine rhythm, inference and ASR',()=>{
 const page=render({status:'completed',provider:'mosi',cached:true,intent:'只研究剪辑节奏，不参考文案',steps:{vl:{model:'synthetic-vl',status:'completed',usage:{input_tokens:123}},asr:{model:'synthetic-asr',status:'completed',usage:{duration_seconds:5}}},result:{titleZh:'产品开场',summaryZh:'合成摘要',tagsZh:['开头'],visual:{summaryZh:'合成观测',observations:[{startSec:0,endSec:1,descriptionZh:'画面中的产品'}],structure:[{rangeZh:'0–1秒',purposeZh:'开头展示'}]},rhythm:{measurements:{durationSec:5,medianShotSec:1.2,candidateCutsSec:[1,2]},modelInference:{summaryZh:'节奏推断'}},audio:{hasAudio:true,hasSpeech:true,text:'合成对白',segments:[{start:0,end:1,text:'合成对白',speaker:'speaker_0'}]},styleSuggestions:[{nameZh:'候选开场',reasonZh:'合成依据',rulesZh:['规则'],caveatZh:'待验证'}]}});
 assert(page.textContent.includes('模型观察 · 待核对'));assert(page.textContent.includes('本机机器测量'));assert(page.textContent.includes('模型推断 · 不属于机器测量'));assert(page.textContent.includes('ASR 识别'));assert(page.textContent.includes('只研究剪辑节奏，不参考文案'));assert(page.textContent.includes('synthetic-vl'));assert(page.textContent.includes('input_tokens'));assert(page.textContent.includes('读取本机缓存'));assert.equal(page.querySelectorAll('details[open]').length,0);assert(page.textContent.includes('模型推断候选'));
});
test('ASR absence and interrupted states are explicit, not fabricated transcripts',()=>{
 assert(render({status:'completed',result:{audio:{hasAudio:false}}}).textContent.includes('没有音轨'));assert(render({status:'completed',result:{audio:{hasAudio:true,hasSpeech:false}}}).textContent.includes('没有识别到可用语音'));assert(render({status:'failed',error:{message:'已停止'}}).textContent.includes('已停止'));assert(render({status:'running'}).textContent.includes('不会重复提交分析'));assert.equal(analysisStatus({status:'existing'}),'completed');assert.equal(analysisStatus({status:'notstarted'}),'not-started');
});
test('all source and model text is escaped, including mismatched intent warning',()=>{
 const page=render({status:'completed',intent:'<script>intent()</script>',intentMismatch:true,requiresExplicitReanalysis:true,noteZh:'已有结果基于另一个分析重点；本次未重新调用。',steps:{vl:{model:'<img src=x>',usage:{raw:'<svg/onload=bad()>'}}},result:{titleZh:'<img onerror=bad()>',summaryZh:'<script>bad()</script>',tagsZh:['<iframe>'],visual:{observations:[{descriptionZh:'<svg/onload=bad()>'}]},audio:{text:'<a href="javascript:bad()">字幕</a>'}}});
 assert.equal(page.querySelectorAll('script,img,svg,iframe,a').length,0);assert(page.textContent.includes('本次未重新调用'));assert(page.textContent.includes('<script>intent()</script>'));
});
