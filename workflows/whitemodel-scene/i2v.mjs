// 用法: node i2v.mjs S1 720P "运镜与动作描述"   shots/S1_real.png 作首帧 → S1.mp4（wan2.2-i2v-flash，480P ¥0.1/秒、720P ¥0.2/秒，固定 5 秒）
// 先记账后提交：ledger.json 里已有该镜头则拒绝重复提交；被拒的请求不计费，可重试。
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
const { config } = await import('../../apps/studio/lib/env.mjs');
const base=config.wan.base, A={Authorization:'Bearer '+config.wan.key}, J={...A,'Content-Type':'application/json'};
const [shot,res,prompt]=process.argv.slice(2); const wait=ms=>new Promise(r=>setTimeout(r,ms));
const led=existsSync('ledger.json')?JSON.parse(await readFile('ledger.json','utf8')):{}; const save=()=>writeFile('ledger.json',JSON.stringify(led,null,1));
const TAG=`${shot}_${res}`; if(led[TAG]&&led[TAG].state!=='rejected') throw new Error('already submitted '+TAG);
const img='data:image/png;base64,'+(await readFile(`shots/${shot}_real.png`)).toString('base64');
led[TAG]={state:'submitting',at:new Date().toISOString()}; await save();
const r=await (await fetch(base+'/api/v1/services/aigc/video-generation/video-synthesis',{method:'POST',headers:{...J,'X-DashScope-Async':'enable'},body:JSON.stringify({model:'wan2.2-i2v-flash',input:{img_url:img,prompt},parameters:{resolution:res,prompt_extend:false,watermark:false}})})).json();
const id=r.output?.task_id; led[TAG]={state:id?'submitted':'rejected',taskId:id,resp:id?undefined:r}; await save();
if(!id){console.log('rejected',JSON.stringify(r));process.exit(1);}
for(let i=0;i<60;i++){ await wait(10000); const q=await (await fetch(base+'/api/v1/tasks/'+id,{headers:A})).json(); const st=q.output?.task_status;
  if(st==='SUCCEEDED'){ await writeFile(`${shot}.mp4`,Buffer.from(await (await fetch(q.output.video_url)).arrayBuffer())); led[TAG]={state:'succeeded',taskId:id,usage:q.usage}; await save(); console.log('ok',TAG,JSON.stringify(q.usage)); break; }
  if(['FAILED','CANCELED','UNKNOWN'].includes(st)){ led[TAG]={state:'failed',taskId:id,out:q.output}; await save(); console.log('FAILED',q.output.code,q.output.message); break; } }
