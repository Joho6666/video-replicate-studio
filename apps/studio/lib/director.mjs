import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './env.mjs';
import { refMap } from './refs.mjs';
import { transcriptLines } from './moss.mjs';

export const SEGMENT_MAX_SEC = 15; // Seedance 2.0 (LibTV) and MiniMax H3 both generate at most 15s per run
export const DIRECTOR_VERSION = 'studio-director-0.3 (ai-commercial-video-director · RECREATE · evidence strips)';
export const END_STATES = ['settled', 'ongoing', 'cutoff', 'unknown'];

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

// Observation rules adapted from gnipbao/minimax-h3-video-reverse-skill (video-observation,
// historical-lessons). On 2026-09-29 a hand review with these rules recovered 9/9 shots of the
// first 14.6s of a reel where the one-keyframe director got 2/9 right.
const EVIDENCE = `EVIDENCE
- Each shot arrives as one image made of three panels: LEFT = just after the shot starts, MIDDLE = its midpoint, RIGHT = just before it ends (times are given). Read the action as a change from left to right; never describe only the middle panel.
- Describe only what the panels show. Anything not visible is unknown; never invent focal lengths, camera heights or exact timing beyond the given timecodes.
- Sound: a speech-to-text transcript with speaker turns may be given; it is the only evidence of what is said and when. Never invent speech, music or sound effects beyond it.
- Split an action into the phases that are actually visible (prepare → approach → contact → release/slip → second action → reaction → end state). Touching, letting go and touching again are separate events. A hand that reaches is not a hand that catches.
- An object that is covered is not gone; a subject that leaves frame has not landed. Do not complete an action the panels do not complete.
- end_state is exactly one of settled (motion finished), ongoing (still moving at the cut), cutoff (interrupted mid-action), unknown.
- If the three panels cannot belong to one continuous camera setup (different place, subject or framing that no camera move explains), the shot contains a hidden hard cut: set hidden_cut_at to your best estimate in seconds (absolute video time, strictly inside the shot), let h3_en cover only what happens BEFORE the cut, and put what happens AFTER the cut in h3_after_cut_en. h3_en must then end at the cut: no "then the shot widens / cuts / changes to" and nothing that is only visible after it. Otherwise hidden_cut_at and h3_after_cut_en are null.
- Product claims (material, function, price) may come only from the user's product notes.`;

const ROLES = `REFERENCE ROLES (fixed tokens, use exactly as written)
- @Video1 = the reference clip of this segment. Use it ONLY for camera path, shot order, composition, action timing and pacing.
- @Image1 = target model (identity, face, hair, body). @Image2 = target garment/product; further product images are extra angles of the SAME item and must be cited where their detail matters (back, texture, label side).
- Style reference images (listed with their @ImageN token) supply ONLY lighting, colour grade, scene mood, set dressing or wardrobe styling direction. Never copy their people, faces, logos or products.
- The user's desired effect overrides the reference's look where they conflict, but the reference still drives camera path, shot order and pacing.
- Never keep the original person, original product, logos or on-screen text. Replacement holds from the first frame to the last, including after cuts, profile/back views, occlusion and mirror reflections.
- Garment products are WORN by @Image1 the whole time. Handheld products state how they are held and shown.`;

const OVERVIEW_SYSTEM = `You are the AI Commercial Video Director (RECREATE mode) for an e-commerce team.
Input: one keyframe per shot of a reference video (with timecodes), its caption, the user's desired effect and optionally numbered images (target model, target garment/product angles, style references).
Task: explain in Chinese why the reference works and how to reach the user's desired effect. Describe only what the frames show. When a soundtrack transcript is given, use it for what is said, by whom and when; otherwise sound is unknown.
Output JSON only.`;

const OVERVIEW_CONTRACT = `Return JSON exactly in this shape:
{
  "analysis": {
    "hook": "中文：前 3 秒钩子做了什么",
    "structure": "中文：叙事结构（如 痛点→展示→对比→促单）",
    "visual_style": "中文：画面风格、色调、质感",
    "rhythm": "中文：剪辑节奏与时长分配",
    "audio_guess": "中文：有转写时写清口播/对白内容、谁在说、在第几秒，以及它在叙事里的作用；没有转写时写 不确定",
    "why_it_works": ["中文爆点 1", "中文爆点 2", "中文爆点 3"],
    "goal_plan": "中文：用户想要的效果如何落到这条片子上（保留什么、改什么、哪几段是重点）；用户没填写就根据素材给出建议",
    "asset_notes": [{ "token": "@ImageN", "seen": "中文：图里能看到的关键外观（颜色、版型、材质观感、构图、光线）", "usage": "中文：在复刻中怎么用、注意什么风险" }]
  }
}
asset_notes has one item per uploaded image (empty array when none).`;

const SEGMENT_SYSTEM = `You are the AI Commercial Video Director working in RECREATE mode for an e-commerce team.
You receive ONE generation segment (≤${SEGMENT_MAX_SEC}s) of a reference video: its shots as start|middle|end evidence strips with timecodes, the user's brief and optionally numbered target images.
Write, for every shot, a faithful shot record, plus the segment's English Seedance 2.0 prompt (used inside LibTV) that recreates it with the TARGET model and TARGET product.

${EVIDENCE}

${ROLES}

h3_en (per shot, English only, no @tokens, 1-3 sentences, present tense): a self-contained description of what this shot must show in the NEW video — framing and camera behaviour, the action from its first visible state to its end state, and the end state stated plainly. Describe people and products as they should appear in the new video: when a target model or product image is provided, describe their visible appearance in words (hair, garment colour and cut, product shape and colour) instead of the original's; otherwise describe what the panels show. It is compiled verbatim into a MiniMax H3 prompt, so it must read on its own.

SEGMENT PROMPT FORMAT (prompt_en, English only, no Chinese characters)
Line 1: global constraint — replacement roles above, commercial objective, scene, look/lighting, one coherent camera behaviour.
Then one line per time beat, strictly "0.0-2.0s: ..." — starts at 0.0, contiguous, no gaps/overlaps, ends exactly at the segment duration. Follow the real cut points.
Every beat line names @Image1 (if a person is on screen) and @Image2 explicitly — never just "she" or "the product" — and states: framing, camera move, the action with start→end state, product visibility.
Performance is change over time, never bare "natural/confident/smiling": gaze leads, then head, shoulders, torso; weight shift; clothing/hair/prop inertia that lags, overshoots slightly and settles.
Describe on-screen captions generically — never copy the original text. No negative terms inside prompt_en; put them in negative_en.
negative_en: concise, only risks this segment actually has.
Output JSON only.`;

const segmentContract = (segShots, seg) => `Return JSON exactly in this shape:
{
  "shots": [
    { "index": ${segShots[0].index}, "shot_size": "中文景别", "camera": "中文运镜", "subject": "中文主体", "action": "中文动作", "action_phases": ["中文：只写看得到的阶段，如 伸手接近", "手指碰到怀表"], "end_state": "settled|ongoing|cutoff|unknown", "hidden_cut_at": null, "scene": "中文场景", "lighting": "中文光线", "on_screen_text": "中文画面文字，没有写 无", "transition": "中文转场", "prompt_en": "English single-shot prompt with @Image1/@Image2 and performance timing", "h3_en": "English faithful description, no tokens", "h3_after_cut_en": null, "replace_note": "中文：复刻时替换/保留什么" }
  ],
  "segment": { "note_zh": "中文一句话：这一段拍什么", "prompt_en": "global line\\n0.0-2.5s: ...\\n2.5-${seg.duration}s: ...", "negative_en": "..." }
}
shots must be exactly shots ${segShots.map(s => s.index).join(', ')} in that order, with those index values.`;

const b64 = async file => `data:image/jpeg;base64,${(await readFile(file)).toString('base64')}`;
const tc = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const CJK = /[㐀-鿿]/;
const BEAT = /^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*s\s*:/;
const str = v => typeof v === 'string' && v.trim().length > 0;

export function checkOverview(raw) {
  const hard = [];
  const a = raw?.analysis;
  if (!a || typeof a !== 'object') return { hard: ['missing analysis'], soft: [] };
  for (const k of ['hook', 'structure', 'visual_style', 'rhythm']) if (!str(a[k])) hard.push(`analysis.${k} must be a non-empty string`);
  return { hard, soft: [] };
}

/** Hard issues trigger one repair round; soft issues are shown to the user. */
export function checkSegment(raw, segShots, seg) {
  const hard = [], soft = [];
  if (!raw || typeof raw !== 'object') return { hard: ['top level is not a JSON object'], soft };
  if (!Array.isArray(raw.shots) || raw.shots.length !== segShots.length) hard.push(`shots must have exactly ${segShots.length} items`);
  else raw.shots.forEach((s, i) => {
    const shot = segShots[i];
    const at = `shots[${i}]`;
    if (Number(s?.index) !== shot.index) hard.push(`${at}.index must be ${shot.index}`);
    if (!str(s?.prompt_en) || s.prompt_en.trim().length < 20) hard.push(`${at}.prompt_en is missing or too short`);
    else if (CJK.test(s.prompt_en)) hard.push(`${at}.prompt_en must be English only (no Chinese characters)`);
    if (!str(s?.h3_en) || s.h3_en.trim().length < 30) hard.push(`${at}.h3_en is missing or too short`);
    else if (CJK.test(s.h3_en)) hard.push(`${at}.h3_en must be English only`);
    else if (/@(?:Video|Image)\d+/.test(s.h3_en)) hard.push(`${at}.h3_en must describe the people/products in words, not with @tokens`);
    if (!END_STATES.includes(s?.end_state)) hard.push(`${at}.end_state must be one of ${END_STATES.join('|')}`);
    if (!Array.isArray(s?.action_phases) || !s.action_phases.length) hard.push(`${at}.action_phases must list the visible phases`);
    const cut = s?.hidden_cut_at;
    if (cut !== null && cut !== undefined) {
      if (typeof cut !== 'number' || cut <= shot.start + 0.2 || cut >= shot.end - 0.2) hard.push(`${at}.hidden_cut_at must be null or a number strictly between ${(shot.start + 0.2).toFixed(2)} and ${(shot.end - 0.2).toFixed(2)}`);
      // Observed with an inline "||" separator: the model flagged the cut but kept one sentence even
      // after a repair round. The flag is still useful evidence; without the after-cut text the H3
      // compile simply cannot place that cut, so this only warns.
      else if (!str(s.h3_after_cut_en) && !String(s.h3_en || '').includes('||')) soft.push(`镜头 ${shot.index} 在 ${cut.toFixed(2)}s 处发现漏检切点，但没有写切点之后的画面，H3 提示词里不会插入这个切点`);
    }
  });
  const g = raw.segment;
  const p = String(g?.prompt_en || '');
  if (CJK.test(p)) hard.push('segment.prompt_en must be English only (no Chinese characters)');
  const beats = p.split(/\r?\n/).map(line => ({ line, m: line.match(BEAT) })).filter(x => x.m);
  if (beats.length < 1) hard.push(`segment.prompt_en needs "0.0-${seg.duration}s: ..." timed beat lines (one line per beat, even if there is only one)`);
  else {
    let prev = 0;
    beats.forEach(({ m }, j) => {
      const [start, end] = [Number(m[1]), Number(m[2])];
      if (Math.abs(start - prev) > 0.15) hard.push(`segment beat ${j + 1} starts at ${start}s but must start at ${prev}s (contiguous from 0.0)`);
      if (end <= start) hard.push(`segment beat ${j + 1} ends before it starts`);
      prev = end;
    });
    if (Math.abs(prev - seg.duration) > 0.35) hard.push(`segment beats end at ${prev}s but the segment lasts ${seg.duration}s`);
    const unbound = beats.filter(({ line }) => !/@Image\d+/.test(line)).length;
    if (unbound) soft.push(`第 ${seg.index} 段有 ${unbound} 个时间段没有点名 @Image1/@Image2`);
  }
  if (!str(g?.negative_en)) soft.push(`第 ${seg.index} 段缺少负面约束`);
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
  if (choice?.finish_reason === 'length') throw new Error('DeepSeek 输出被截断，请缩短分析窗口');
  const text = choice?.message?.content || '';
  if (!text.trim()) throw new Error('DeepSeek 返回为空');
  return { text, usage: body.usage, model: body.model };
}

const addUsage = (a, b) => (!a ? b : !b ? a : { prompt_tokens: a.prompt_tokens + b.prompt_tokens, completion_tokens: a.completion_tokens + b.completion_tokens });

/** One DeepSeek call with one repair round, validated by `check`. */
async function ask(system, content, check, { prepare = x => x, label }) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content }];
  let reply = await chat(messages);
  let usage = reply.usage;
  const parse = text => { try { const parsed = prepare(JSON.parse(text)); return { parsed, result: check(parsed) }; } catch { return { parsed: null, result: { hard: ['response is not valid JSON'], soft: [] } }; } };
  let { parsed, result } = parse(reply.text);
  let repaired = false;
  if (result.hard.length) {
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `The JSON above fails these checks:\n- ${result.hard.slice(0, 20).join('\n- ')}\nReturn the complete corrected JSON. Fix only these issues and keep everything else.` });
    reply = await chat(messages);
    usage = addUsage(usage, reply.usage);
    ({ parsed, result } = parse(reply.text));
    if (result.hard.length) throw new Error(`${label}：DeepSeek 两次输出都未通过检查：${result.hard.slice(0, 3).join('；')}`);
    repaired = true;
  }
  return { parsed, soft: result.soft, usage, model: reply.model, repaired };
}

const stripLabel = v => typeof v === 'string' ? v.replace(/^\s*中文\s*[:：]\s*/, '') : Array.isArray(v) ? v.map(stripLabel) : v;
const clean = obj => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, /_en$/.test(k) ? v : stripLabel(v)]));

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** Evenly thins a list to at most `max` items, always keeping the first and last. */
const sample = (list, max) => list.length <= max ? list : Array.from({ length: max }, (_, i) => list[Math.round((i * (list.length - 1)) / (max - 1))]);

export async function runDirector({ job, root, onLog }) {
  if (!config.deepseek.key) throw new Error('DeepSeek API Key 未配置（apps/studio/.env.local 的 DEEPSEEK_API_KEY）');
  const { shots, meta, media, brief } = job;
  const segments = planSegments(shots);
  const refs = refMap(job.assets);
  const uploaded = refs.filter(r => r.file);
  const hasModel = job.assets.some(a => a.role === 'model') || Boolean(brief.model);
  const hasProduct = job.assets.some(a => a.role === 'product') || Boolean(brief.product);
  const ROLE_TEXT = { model: 'target model — identity, face, hair, body', product: 'target garment/product — must appear exactly like this', style: 'STYLE REFERENCE ONLY — lighting, colour, mood, scene; do not copy its people or products' };
  const heard = transcriptLines(job.transcript);
  const soundLine = heard.length ? `Soundtrack transcript (speech-to-text with speaker turns, absolute times):\n${heard.join('\n')}`
    : job.transcript ? 'Soundtrack transcript: no recognisable speech.' : 'Soundtrack: not transcribed.';
  const briefLines = [
    `Platform: ${meta.platformLabel || ''}. Caption: ${(meta.title || '').slice(0, 400)}`,
    `Reference length ${media.duration?.toFixed(1)}s, analysed first ${media.analyzedSec?.toFixed(1)}s, frame ${media.width}x${media.height} (${media.orientation}).`,
    `Target product (@Image2): ${brief.product || (hasProduct ? 'see image' : 'not provided yet — still write @Image2 as the product placeholder')}`,
    brief.notes ? `Product notes from the user (the ONLY allowed source of product claims): ${brief.notes}` : 'Product notes: none — make no product claims.',
    `Target model (@Image1): ${brief.model || (hasModel ? 'see image' : 'not provided yet — still write @Image1 for any person on screen')}`,
    brief.style ? `Extra style request: ${brief.style}` : '',
    `User's desired effect: ${brief.goal || '(not given — propose one in goal_plan based on the reference and images)'}`,
    `Uploaded images: ${uploaded.map(r => `${r.token}=${r.label}`).join(', ') || 'none'}`,
  ].filter(Boolean).join('\n');
  const overviewBrief = `${briefLines}\n${soundLine}`;
  const refContent = async detail => {
    const out = [];
    for (const r of uploaded) {
      out.push({ type: 'text', text: `${r.token} = ${ROLE_TEXT[r.role]}. Describe only what is visible.` });
      out.push({ type: 'image_url', image_url: { url: await b64(path.join(root, r.file)), detail: detail(r) } });
    }
    return out;
  };

  onLog(`DeepSeek 先看全片 ${shots.length} 个镜头做拆解，再逐段（${segments.length} 段）看首/中/尾三帧写提示词`);
  const overviewShots = sample(shots, 24);
  const overviewContent = [{ type: 'text', text: `${overviewBrief}\n${shots.length} shots; ${overviewShots.length} keyframes shown below.` }];
  for (const shot of overviewShots) {
    overviewContent.push({ type: 'text', text: `Shot ${shot.index} | ${tc(shot.start)}-${tc(shot.end)} (${shot.duration}s)` });
    overviewContent.push({ type: 'image_url', image_url: { url: await b64(path.join(root, shot.keyframe)), detail: 'low' } });
  }
  overviewContent.push(...await refContent(r => r.role === 'style' ? 'low' : 'auto'), { type: 'text', text: OVERVIEW_CONTRACT });
  const refsLow = await refContent(() => 'low');

  const [overview, parts] = await Promise.all([
    ask(OVERVIEW_SYSTEM, overviewContent, checkOverview, { label: '全片拆解' }),
    pool(segments, 3, async seg => {
      const segShots = shots.filter(s => seg.shots.includes(s.index));
      const said = transcriptLines(job.transcript, seg.start, seg.end);
      const segSound = said.length ? `Speech in this segment (segment-relative times):\n${said.join('\n')}` : job.transcript ? 'No speech in this segment.' : '';
      const content = [{ type: 'text', text: [briefLines, `Segment ${seg.index} of ${segments.length}: ${tc(seg.start)}-${tc(seg.end)} = ${seg.duration}s, shots ${seg.shots.join(', ')}. Segment-relative beat times start at 0.0.`, segSound].filter(Boolean).join('\n') }];
      for (const shot of segShots) {
        const times = shot.stripAt ? ` panels at ${shot.stripAt.map(t => `${t.toFixed(2)}s`).join(' | ')}` : '';
        content.push({ type: 'text', text: `Shot ${shot.index} | ${tc(shot.start)}-${tc(shot.end)} (${shot.duration}s, ${shot.cut === 'hard' ? 'new shot after a hard cut' : 'same continuous shot as the previous one'})${times}` });
        content.push({ type: 'image_url', image_url: { url: await b64(path.join(root, shot.strip || shot.keyframe)), detail: 'auto' } });
      }
      content.push(...refsLow, { type: 'text', text: segmentContract(segShots, seg) });
      const got = await ask(SEGMENT_SYSTEM, content, raw => checkSegment(raw, segShots, seg), {
        label: `第 ${seg.index} 段`,
        // The model reliably forgets the @Video1 role line; adding it is deterministic, so don't pay for a re-ask.
        prepare: p => { if (typeof p?.segment?.prompt_en === 'string' && !p.segment.prompt_en.includes('@Video1')) p.segment.prompt_en = `Follow @Video1 only for camera path, shot order, composition and pacing.\n${p.segment.prompt_en}`; return p; },
      });
      onLog(`第 ${seg.index}/${segments.length} 段完成${got.repaired ? '（自动修正过一次格式）' : ''}`);
      return got;
    }),
  ]);

  const warnings = [...overview.soft, ...parts.flatMap(p => p.soft)];
  const allPrompts = parts.map(p => p.parsed.segment.prompt_en).join('\n');
  for (const r of uploaded.filter(r => r.role !== 'model' && r.token !== '@Image2')) if (!allPrompts.includes(r.token)) warnings.push(`提示词没有用到 ${r.token}（${r.label}）`);
  const hidden = parts.flatMap(p => p.parsed.shots).filter(s => typeof s.hidden_cut_at === 'number');
  if (hidden.length) onLog(`三帧对照发现 ${hidden.length} 处场景检测漏掉的切点（镜头 ${hidden.map(s => s.index).join('、')}）`);
  return {
    version: DIRECTOR_VERSION,
    refs,
    goal: brief.goal || '',
    analysis: clean(overview.parsed.analysis),
    shots: parts.flatMap(p => p.parsed.shots.map(s => ({ ...clean(s), hidden_cut_at: typeof s.hidden_cut_at === 'number' ? Math.round(s.hidden_cut_at * 100) / 100 : null }))),
    segments: segments.map((s, i) => {
      const g = parts[i].parsed.segment;
      return { ...s, note_zh: stripLabel(g.note_zh || ''), prompt_en: g.prompt_en.trim(), negative_en: (g.negative_en || '').trim() };
    }),
    warnings,
    model: overview.model,
    usage: [overview, ...parts].reduce((u, p) => addUsage(u, p.usage), null),
    repaired: [overview, ...parts].some(p => p.repaired),
    generatedAt: new Date().toISOString(),
  };
}
