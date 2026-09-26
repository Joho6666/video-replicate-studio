import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './env.mjs';

export const SEGMENT_MAX_SEC = 15; // Seedance 2.0 / LibTV generates at most 15s per run
export const DIRECTOR_VERSION = 'studio-director-0.2 (ai-commercial-video-director · RECREATE)';

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
  return segments.map(s => ({ ...s, duration: Math.round((s.end - s.start) * 10) / 10 }));
}

// Rules distilled from skills/ai-commercial-video-director (prompt-compiler, human-performance,
// motion-continuity) and the workbench director-0.1.1 replacement rules.
const SYSTEM = `You are the AI Commercial Video Director working in RECREATE mode for an e-commerce team.
Input: one reference video, split into shots with one keyframe per shot (with timecodes), its caption, generation segments (each ≤${SEGMENT_MAX_SEC}s), and optionally a target model image, target product image and user product notes.
Goal: explain in Chinese why the reference works, then compile English Seedance 2.0 prompts (used inside LibTV) that recreate its structure with the TARGET model and TARGET product.

EVIDENCE
- Describe only what the keyframes show. Anything not visible is unknown; never invent focal lengths, camera heights or exact timing beyond the given timecodes.
- Keyframes are samples: do not claim unsampled actions, the full edit, or the audio track. Audio is not analysed.
- Product claims (material, function, price) may come only from the user's product notes.

REFERENCE ROLES (fixed tokens, use exactly as written)
- @Video1 = the reference clip of this segment. Use it ONLY for camera path, shot order, composition, action timing and pacing.
- @Image1 = target model (identity, face, hair, body). @Image2 = target product.
- Never keep the original person, original product, logos or on-screen text. Replacement holds from the first frame to the last, including after cuts, profile/back views, occlusion and mirror reflections.
- Garment products are WORN by @Image1 the whole time (the product takes priority over the model image's own outerwear). Handheld products state how they are held and shown.

SEGMENT PROMPT FORMAT (prompt_en, English only, no Chinese characters)
Line 1: global constraint — replacement roles above, commercial objective, scene, look/lighting, one coherent camera behaviour.
Then one line per time beat, strictly "0.0-2.0s: ..." — starts at 0.0, contiguous, no gaps/overlaps, ends exactly at the segment duration.
Every beat line names @Image1 (if a person is on screen) and @Image2 explicitly — never just "she" or "the product" — and states: framing, camera move, the action with start→end state, product visibility.
Performance is change over time, never bare "natural/confident/smiling": gaze leads, then head, shoulders, torso; weight shift and support leg; one asymmetry; clothing/hair/prop inertia that lags, overshoots slightly and settles.
Continuity: each beat starts from the previous end state or states the cut explicitly. 2-4 beats per 5-8 seconds; one main visual task per short shot.
Describe on-screen captions generically (e.g. "bold yellow caption bar in the lower third") — never copy the original text.
No negative terms inside prompt_en; put them in negative_en.

negative_en: concise, only risks this segment actually has (e.g. original face reappearing, product colour drift, foot sliding, simultaneous eye-head-body rotation, weightless fabric, sudden camera acceleration).
Output JSON only.`;

const CONTRACT = `Return JSON exactly in this shape:
{
  "analysis": {
    "hook": "中文：前 3 秒钩子做了什么",
    "structure": "中文：叙事结构（如 痛点→展示→对比→促单）",
    "visual_style": "中文：画面风格、色调、质感",
    "rhythm": "中文：剪辑节奏与时长分配",
    "audio_guess": "中文：从画面推测的声音/口播形式，无法确认写 不确定",
    "why_it_works": ["中文爆点 1", "中文爆点 2", "中文爆点 3"]
  },
  "shots": [
    { "index": 1, "shot_size": "中文景别", "camera": "中文运镜", "subject": "中文主体", "action": "中文动作", "scene": "中文场景", "lighting": "中文光线", "on_screen_text": "中文画面文字，没有写 无", "transition": "中文转场", "prompt_en": "English single-shot prompt with @Image1/@Image2 and performance timing", "replace_note": "中文：复刻时替换/保留什么" }
  ],
  "segments": [
    { "index": 1, "note_zh": "中文一句话：这一段拍什么", "prompt_en": "global line\\n0.0-2.5s: ...\\n2.5-5.0s: ...", "negative_en": "..." }
  ]
}
shots must match the input shots one-to-one (same count and index). segments must match the input segments one-to-one.`;

const b64 = async file => `data:image/jpeg;base64,${(await readFile(file)).toString('base64')}`;
const tc = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const CJK = /[㐀-鿿]/;
const BEAT = /^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*s\s*:/;

/** Hard issues trigger one repair round; soft issues are shown to the user. */
export function checkDirector(raw, shots, segments) {
  const hard = [], soft = [];
  if (!raw || typeof raw !== 'object') return { hard: ['top level is not a JSON object'], soft };
  const a = raw.analysis;
  if (!a || typeof a !== 'object') hard.push('missing analysis');
  else for (const k of ['hook', 'structure', 'visual_style', 'rhythm']) if (typeof a[k] !== 'string' || !a[k].trim()) hard.push(`analysis.${k} must be a non-empty string`);
  if (!Array.isArray(raw.shots) || raw.shots.length !== shots.length) hard.push(`shots must have exactly ${shots.length} items`);
  else raw.shots.forEach((s, i) => {
    if (Number(s?.index) !== i + 1) hard.push(`shots[${i}].index must be ${i + 1}`);
    if (typeof s?.prompt_en !== 'string' || s.prompt_en.trim().length < 20) hard.push(`shots[${i}].prompt_en is missing or too short`);
    else if (CJK.test(s.prompt_en)) hard.push(`shots[${i}].prompt_en must be English only (no Chinese characters)`);
  });
  if (!Array.isArray(raw.segments) || raw.segments.length !== segments.length) { hard.push(`segments must have exactly ${segments.length} items`); return { hard, soft }; }
  raw.segments.forEach((s, i) => {
    const seg = segments[i];
    const p = String(s?.prompt_en || '');
    if (!p.includes('@Video1')) hard.push(`segments[${i}].prompt_en must reference @Video1`);
    if (CJK.test(p)) hard.push(`segments[${i}].prompt_en must be English only (no Chinese characters)`);
    const beats = p.split(/\r?\n/).map(line => ({ line, m: line.match(BEAT) })).filter(x => x.m);
    if (beats.length < 2) { hard.push(`segments[${i}].prompt_en needs one "0.0-2.0s: ..." line per beat`); return; }
    let prev = 0;
    beats.forEach(({ m }, j) => {
      const [start, end] = [Number(m[1]), Number(m[2])];
      if (Math.abs(start - prev) > 0.15) hard.push(`segments[${i}] beat ${j + 1} starts at ${start}s but must start at ${prev}s (contiguous from 0.0)`);
      if (end <= start) hard.push(`segments[${i}] beat ${j + 1} ends before it starts`);
      prev = end;
    });
    if (Math.abs(prev - seg.duration) > 0.35) hard.push(`segments[${i}] beats end at ${prev}s but the segment lasts ${seg.duration}s`);
    const unbound = beats.filter(({ line }) => !/@Image[12]/.test(line)).length;
    if (unbound) soft.push(`第 ${i + 1} 段有 ${unbound} 个时间段没有点名 @Image1/@Image2`);
    if (typeof s?.negative_en !== 'string' || !s.negative_en.trim()) soft.push(`第 ${i + 1} 段缺少负面约束`);
  });
  return { hard, soft };
}

async function chat(messages) {
  const res = await fetch(`${config.deepseek.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.deepseek.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.deepseek.model, stream: false, max_tokens: 16000, temperature: 0.35, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, messages }),
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

const stripLabel = v => typeof v === 'string' ? v.replace(/^\s*中文\s*[:：]\s*/, '') : Array.isArray(v) ? v.map(stripLabel) : v;
const clean = obj => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, /_en$/.test(k) ? v : stripLabel(v)]));

const addUsage = (a, b) => (!a ? b : !b ? a : { prompt_tokens: a.prompt_tokens + b.prompt_tokens, completion_tokens: a.completion_tokens + b.completion_tokens });

export async function runDirector({ job, root, onLog }) {
  if (!config.deepseek.key) throw new Error('DeepSeek API Key 未配置（apps/studio/.env.local 的 DEEPSEEK_API_KEY）');
  const { shots, meta, media, brief } = job;
  const segments = planSegments(shots);
  const hasModel = job.assets.some(a => a.role === 'model') || Boolean(brief.model);
  const hasProduct = job.assets.some(a => a.role === 'product') || Boolean(brief.product);
  const content = [{
    type: 'text',
    text: [
      `Platform: ${meta.platformLabel || ''}. Caption: ${(meta.title || '').slice(0, 400)}`,
      `Reference length ${media.duration?.toFixed(1)}s, analysed first ${media.analyzedSec?.toFixed(1)}s, frame ${media.width}x${media.height} (${media.orientation}).`,
      `${shots.length} shots. Generation segments (each ≤${SEGMENT_MAX_SEC}s):`,
      ...segments.map(s => `  segment ${s.index}: ${tc(s.start)}-${tc(s.end)} = ${s.duration}s, shots ${s.shots.join(', ')}`),
      `Target product (@Image2): ${brief.product || (hasProduct ? 'see image' : 'not provided yet — still write @Image2 as the product placeholder')}`,
      brief.notes ? `Product notes from the user (the ONLY allowed source of product claims): ${brief.notes}` : 'Product notes: none — make no product claims.',
      `Target model (@Image1): ${brief.model || (hasModel ? 'see image' : 'not provided yet — still write @Image1 for any person on screen')}`,
      brief.style ? `Extra style request: ${brief.style}` : '',
    ].filter(Boolean).join('\n'),
  }];
  for (const shot of shots) {
    content.push({ type: 'text', text: `Shot ${shot.index} | ${tc(shot.start)}-${tc(shot.end)} (${shot.duration}s, ${shot.cut === 'hard' ? 'new shot after a hard cut' : 'same continuous shot as the previous keyframe'})` });
    content.push({ type: 'image_url', image_url: { url: await b64(path.join(root, shot.keyframe)), detail: 'low' } });
  }
  for (const asset of job.assets || []) {
    content.push({ type: 'text', text: `${asset.role === 'model' ? '@Image1 target model' : '@Image2 target product'} — describe only what is visible.` });
    content.push({ type: 'image_url', image_url: { url: await b64(path.join(root, asset.file)), detail: 'low' } });
  }
  content.push({ type: 'text', text: CONTRACT });

  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content }];
  onLog(`DeepSeek 看 ${shots.length} 张关键帧，编译 ${segments.length} 段英文提示词`);
  let reply = await chat(messages);
  let usage = reply.usage;
  let parsed, check;
  // The model reliably forgets the @Video1 role line; adding it is deterministic, so don't pay for a re-ask.
  const ensureVideoRef = p => { for (const s of p?.segments || []) if (typeof s?.prompt_en === 'string' && !s.prompt_en.includes('@Video1')) s.prompt_en = `Follow @Video1 only for camera path, shot order, composition and pacing.
${s.prompt_en}`; return p; };
  try { parsed = ensureVideoRef(JSON.parse(reply.text)); check = checkDirector(parsed, shots, segments); } catch { check = { hard: ['response is not valid JSON'], soft: [] }; }
  let repaired = false;
  if (check.hard.length) {
    onLog(`提示词未过格式检查（${check.hard.slice(0, 2).join('；')}），带着问题清单重出一次`, 'warn');
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `The JSON above fails these checks:\n- ${check.hard.slice(0, 20).join('\n- ')}\nReturn the complete corrected JSON. Fix only these issues and keep everything else.` });
    reply = await chat(messages);
    usage = addUsage(usage, reply.usage);
    try { parsed = ensureVideoRef(JSON.parse(reply.text)); check = checkDirector(parsed, shots, segments); } catch { check = { hard: ['response is not valid JSON'], soft: [] }; }
    if (check.hard.length) throw new Error(`DeepSeek 两次输出都未通过检查：${check.hard.slice(0, 3).join('；')}`);
    repaired = true;
  }
  return {
    version: DIRECTOR_VERSION,
    analysis: clean(parsed.analysis),
    shots: parsed.shots.map(clean),
    segments: segments.map((s, i) => ({ ...s, note_zh: stripLabel(parsed.segments[i].note_zh || ''), prompt_en: parsed.segments[i].prompt_en.trim(), negative_en: (parsed.segments[i].negative_en || '').trim() })),
    warnings: check.soft,
    model: reply.model,
    usage,
    repaired,
    generatedAt: new Date().toISOString(),
  };
}
