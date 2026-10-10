import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLinks, classifyLink, fileRecord, assessRequirements, escapeHTML, exportReport, restoreReport, DEFAULT_REQUIREMENTS} from '../src/core.mjs';
test('batch links extract from share text and deduplicate tracking URLs',()=>{
 const r=parseLinks('看看 https://www.douyin.com/video/123?from=share\nhttps://www.douyin.com/video/123?foo=2\nhttps://www.tiktok.com/@a/video/456');
 assert.equal(r.accepted.length,2);assert.equal(r.duplicates,1);assert.equal(r.accepted[0].status,'待读取');
});
test('batch rejects deceptive domains, credentials, HTTP and platform homepages',()=>{
 for(const url of ['https://douyin.com.evil.com/video/1','https://evildouyin.com/video/1','https://name:secret@douyin.com/video/1','javascript:alert(1)','http://v.douyin.com/a','https://www.tiktok.com/'])assert.equal(classifyLink(url),null);
 assert.equal(classifyLink('https://v.douyin.com/Abc/').platform,'抖音');
});
test('existing links are not re-added',()=>{const r=parseLinks('https://v.douyin.com/Abc/',[{url:'https://v.douyin.com/Abc/'}]);assert.equal(r.accepted.length,0);assert.equal(r.duplicates,1);});
test('unreviewed or unavailable material is never automatically a gap',()=>{
 const rows=assessRequirements(DEFAULT_REQUIREMENTS, [{role:'未标注',source:'本地导入'}]);assert(rows.every(r=>r.state==='待检查'));
 assert(assessRequirements(DEFAULT_REQUIREMENTS,[]).every(r=>r.state==='待检查'));
});
test('only real manual assignments count; gaps require explicit review',()=>{
 const reqs=DEFAULT_REQUIREMENTS.map(x=>({...x}));reqs[1].review='missing';
 const rows=assessRequirements(reqs,[{role:'开头钩子',source:'本地导入'},{role:'细节特写',source:'示例'}]);
 assert.equal(rows[0].state,'已人工匹配');assert.equal(rows[1].state,'已确认缺口');assert.equal(rows[2].state,'待检查');
});
test('file metadata never invents semantic analysis',()=>{
 const a=fileRecord({name:'example.mp4',size:100,lastModified:2,webkitRelativePath:'素材/example.mp4'});
 assert.equal(a.role,'未标注');assert.equal(a.duration,null);assert.equal(a.source,'本地导入');assert.equal(a.kind,'视频');
});
test('user content is escaped in UI',()=>{assert.equal(escapeHTML('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');});
test('report explicitly separates prepared state from execution',()=>{
 const r=exportReport({assets:[{id:'1',preview:'blob:private'}],requirements:[],reference:null},'factory');
 assert(r.evidence.includes('未调用'));assert.equal(r.assets[0].preview,undefined);
});
test('import rejects other workbench records and forces no schedule or execution',()=>{
 assert.throws(()=>restoreReport({schemaVersion:1,workbench:'replicate'},'factory'));
 const record={schemaVersion:1,workbench:'replicate',links:[{url:'https://v.douyin.com/a',status:'已分析'}],discovery:{schedule:true},drafts:[]};
 const restored=restoreReport(record,'replicate');assert.equal(restored.discovery.schedule,false);assert.equal(restored.links[0].status,'待读取');
});
