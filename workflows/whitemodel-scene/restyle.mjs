// 用法: node restyle.mjs S1   把 shots/S1.png 的白膜改成写实首帧 → shots/S1_real.png（qwen-image-edit-plus，约 ¥0.2/张）
import { readFile, writeFile } from 'node:fs/promises';
const { config } = await import('../../apps/studio/lib/env.mjs');
const shot=process.argv[2], extra=process.argv[3]||'';
const STYLE='Turn this grey 3D blockout render into a photorealistic cinematic photograph. Keep the exact composition, camera angle, geometry, perspective and the position of every building, column, step, gate and figure unchanged. Materials: weathered sand-coloured limestone walls with arched wooden-shuttered windows, worn stone paving, carved stone columns, real people in simple linen clothing replacing the capsule figures. Lighting: warm golden-hour dusk sunlight, long soft shadows, hazy atmosphere, deep blue-orange sky. Ultra detailed, 35mm film look, no text.'+extra;
const b64=(await readFile(`shots/${shot}.png`)).toString('base64');
const r=await (await fetch(config.wan.base+'/api/v1/services/aigc/multimodal-generation/generation',{method:'POST',headers:{Authorization:'Bearer '+config.wan.key,'Content-Type':'application/json'},body:JSON.stringify({model:'qwen-image-edit-plus',input:{messages:[{role:'user',content:[{image:'data:image/png;base64,'+b64},{text:STYLE}]}]},parameters:{n:1,watermark:false,prompt_extend:false}})})).json();
const url=r.output?.choices?.[0]?.message?.content?.find(c=>c.image)?.image;
if(!url){console.log('FAIL',JSON.stringify(r).slice(0,300));process.exit(1);}
await writeFile(`shots/${shot}_real.png`,Buffer.from(await (await fetch(url)).arrayBuffer())); console.log('ok',shot,JSON.stringify(r.usage));
