import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './env.mjs';

export const SEGMENT_MAX_SEC = 15; // Seedance 2.0 / LibTV generates at most 15s per run

/** Groups consecutive shots into ≤15s generation segments, cutting only on shot boundaries. */
export function planSegments(shots, maxSec = SEGMENT_MAX_SEC) {
  const segments = [];
  let current = null;
  for (const shot of shots) {
    if (current && shot.end - current.start > maxSec) { segments.push(current); current = null; }
    if (!current) current = { index: segments.length + 1, start: shot.start, end: shot.end, shots: [] };
    current.end = shot.end;
    current.shots.push(shot.index);
  }
  if (current) segments.push(current);
  return segments.map(s => ({ ...s, duration: Math.round((s.end - s.start) * 100) / 100 }));
}

const SYSTEM = `你是短视频爆款复刻导演，服务电商带货团队。输入是一条参考视频：按镜头切分后每个镜头一张关键帧（带时间码），以及标题等元数据；可能还有要替换进去的模特图、商品图和商品说明。

你的任务：拆解它为什么能火，并写出能在 LibTV（底层 Seedance 2.0）里复刻的中文提示词。

硬性规则：
1. 只描述关键帧里看得到的内容；看不清就写"不确定"，不要编造。
2. 不得凭空捏造商品材质、功效、价格等卖点；商品信息只能来自用户提供的说明。
3. 复刻的是结构、节奏、镜头语言和情绪，不是照抄原博主的人脸与品牌。
4. LibTV 素材编号固定：@视频1 = 该段对应的参考片段；@图片1 = 替换模特；@图片2 = 替换商品。没有提供的素材也保留编号，由用户上传。
5. 段落提示词写成：第一行整体说明；之后按秒的镜头清单，每个时间段单独一行（如 "0-2秒：……"），时间从该段 0 秒起算，写清景别、运镜、动作和转场；最后一行写素材引用要求。
6. 提示词面向视频模型，不要出现"节拍""关键帧""镜头 N""硬切进入"这类内部标注词。
7. 只输出 JSON，不要 Markdown。`;

const CONTRACT = `输出 JSON 结构（字段名必须一致）：
{
  "analysis": {
    "hook": "前 3 秒钩子做了什么",
    "structure": "整体叙事结构（如 痛点→展示→对比→促单）",
    "visual_style": "画面风格、色调、质感",
    "rhythm": "剪辑节奏与时长分配",
    "audio_guess": "从画面推测的声音/口播形式（无法确认写 不确定）",
    "why_it_works": ["爆点 1", "爆点 2", "爆点 3"]
  },
  "shots": [
    { "index": 1, "shot_size": "远景|全景|中景|近景|特写|大特写", "camera": "运镜", "subject": "主体", "action": "动作", "scene": "场景", "lighting": "光线", "on_screen_text": "画面文字（没有写 无）", "transition": "到下一镜的转场", "prompt": "单镜头生成提示词", "replace_note": "复刻时此镜头要替换/保留什么" }
  ],
  "segments": [
    { "index": 1, "prompt": "该段 LibTV 提示词，引用 @视频1 @图片1 @图片2" }
  ],
  "negative": "通用负面约束"
}
shots 必须与输入镜头一一对应（数量、index 一致）；segments 必须与输入分段一一对应。`;

const b64 = async file => `data:image/jpeg;base64,${(await readFile(file)).toString('base64')}`;
const tc = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function validate(raw, shots, segments) {
  const issues = [];
  if (!raw || typeof raw !== 'object') return ['顶层不是 JSON 对象'];
  const a = raw.analysis;
  if (!a || typeof a !== 'object') issues.push('缺少 analysis');
  else for (const k of ['hook', 'structure', 'visual_style', 'rhythm']) if (typeof a[k] !== 'string' || !a[k].trim()) issues.push(`analysis.${k} 必须是非空字符串`);
  if (!Array.isArray(raw.shots) || raw.shots.length !== shots.length) issues.push(`shots 必须恰好 ${shots.length} 项`);
  else raw.shots.forEach((s, i) => {
    if (Number(s?.index) !== i + 1) issues.push(`shots[${i}].index 应为 ${i + 1}`);
    if (typeof s?.prompt !== 'string' || s.prompt.trim().length < 8) issues.push(`shots[${i}].prompt 过短`);
  });
  if (!Array.isArray(raw.segments) || raw.segments.length !== segments.length) issues.push(`segments 必须恰好 ${segments.length} 项`);
  else raw.segments.forEach((s, i) => {
    if (typeof s?.prompt !== 'string' || !s.prompt.includes('@视频1')) issues.push(`segments[${i}].prompt 必须引用 @视频1`);
  });
  return issues;
}

async function chat(messages) {
  const res = await fetch(`${config.deepseek.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.deepseek.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.deepseek.model, stream: false, max_tokens: 12000, temperature: 0.4, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, messages }),
    signal: AbortSignal.timeout(300_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}：${body?.error?.message || ''}`);
  const choice = body.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('DeepSeek 输出被截断（镜头过多），请缩短分析窗口');
  const text = choice?.message?.content || '';
  if (!text.trim()) throw new Error('DeepSeek 返回为空');
  return { text, usage: body.usage, model: body.model };
}

export async function runDirector({ job, root, onLog }) {
  if (!config.deepseek.key) throw new Error('DeepSeek API Key 未配置（apps/studio/.env.local 的 DEEPSEEK_API_KEY）');
  const { shots, meta, media, brief } = job;
  const segments = planSegments(shots);
  const content = [{
    type: 'text',
    text: [
      `平台：${meta.platformLabel || ''}；标题/文案：${(meta.title || '').slice(0, 400)}`,
      `原片时长 ${media.duration?.toFixed(1)}s，本次分析前 ${media.analyzedSec?.toFixed(1)}s；画幅 ${media.width}×${media.height}（${media.orientation}）`,
      `镜头 ${shots.length} 个；生成分段（每段 ≤${SEGMENT_MAX_SEC}s）：`,
      ...segments.map(s => `  段${s.index}：${tc(s.start)}–${tc(s.end)}（${s.duration}s），含镜头 ${s.shots.join('、')}`),
      brief.product ? `替换商品：${brief.product}` : '替换商品：未提供（提示词里用 @图片2 指代）',
      brief.notes ? `商品说明（唯一可信卖点来源）：${brief.notes}` : '',
      brief.model ? `模特要求：${brief.model}` : '',
      brief.style ? `额外风格要求：${brief.style}` : '',
    ].filter(Boolean).join('\n'),
  }];
  for (const shot of shots) {
    content.push({ type: 'text', text: `镜头 ${shot.index}｜${tc(shot.start)}–${tc(shot.end)}（${shot.duration}s，${shot.cut === 'hard' ? '新镜头（硬切进入）' : '与上一张是同一个连续镜头'}）` });
    content.push({ type: 'image_url', image_url: { url: await b64(path.join(root, shot.keyframe)), detail: 'low' } });
  }
  for (const asset of job.assets || []) {
    content.push({ type: 'text', text: `${asset.role === 'model' ? '@图片1 替换模特' : '@图片2 替换商品'}（只描述可见外观）` });
    content.push({ type: 'image_url', image_url: { url: await b64(path.join(root, asset.file)), detail: 'low' } });
  }
  content.push({ type: 'text', text: CONTRACT });

  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content }];
  onLog(`DeepSeek 看 ${shots.length} 张关键帧，写 ${segments.length} 段提示词`);
  let reply = await chat(messages);
  let parsed, issues;
  try { parsed = JSON.parse(reply.text); issues = validate(parsed, shots, segments); } catch { issues = ['不是合法 JSON']; }
  let repaired = false;
  if (issues.length) {
    onLog(`输出不合规（${issues.slice(0, 3).join('；')}），重出一次`, 'warn');
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `上面的 JSON 有问题：\n- ${issues.slice(0, 20).join('\n- ')}\n请输出修正后的完整 JSON，只修正这些问题。` });
    reply = await chat(messages);
    try { parsed = JSON.parse(reply.text); issues = validate(parsed, shots, segments); } catch { issues = ['不是合法 JSON']; }
    if (issues.length) throw new Error(`DeepSeek 输出两次都不合规：${issues.slice(0, 3).join('；')}`);
    repaired = true;
  }
  return {
    analysis: parsed.analysis,
    shots: parsed.shots,
    segments: segments.map((s, i) => ({ ...s, prompt: parsed.segments[i].prompt })),
    negative: parsed.negative || '',
    model: reply.model,
    usage: reply.usage,
    repaired,
    generatedAt: new Date().toISOString(),
  };
}
