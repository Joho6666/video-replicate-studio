import { config } from './env.mjs';
import { transcriptLines } from './moss.mjs';

export const TONES = { seed: '种草', review: '测评', promo: '促销', story: '剧情' };
export const TARGETS = { douyin: '抖音', xhs: '小红书', channels: '视频号', tiktok: 'TikTok' };
export const CHARS_PER_SEC = 4.5; // comfortable Chinese voice-over pace
export const CAPTION_MAX = 14;

// 《广告法》第九条常见绝对化用语 + 医疗化/虚假承诺；命中只提示，不擅自改写用户卖点。
const BANNED = ['最', '第一', '顶级', '极致', '首选', '唯一', '国家级', '全网', '万能', '100%', '百分百', '永久', '根治', '治愈', '零风险', '史上', '独家', '绝无仅有'];

const SYSTEM = `你是国内一线电商短视频文案策划，擅长把爆款视频的结构迁移到新商品上。
写的是真实可用的带货文案：口语化、有画面感、短句，不堆砌形容词，不写"家人们谁懂啊""绝绝子"这类烂梗，不用 emoji 堆砌。

硬性规则：
1. 商品卖点只能来自用户提供的"商品说明"。说明里没有的功效、材质、价格、销量、认证一律不写；缺信息时写体验和场景，不编数据。
2. 遵守《广告法》：不用"最、第一、顶级、极致、唯一、全网、100%、永久"等绝对化用语，不写医疗功效。
3. 口播脚本严格按给定的每段时长控制字数（每秒约 ${CHARS_PER_SEC} 个字），念不完就删。
4. 画面字幕每条 ≤${CAPTION_MAX} 个字，与该镜头画面对应，是口播的提炼而不是复述。
5. 结构沿用参考视频的钩子与节奏（见拆解）；有原片口播转写时，参照它的话术结构、句子长短和说话时机来写，但内容全部换成新商品，不照抄原句。
6. 平台为 TikTok 时全部用英文，其余平台用简体中文。
只输出 JSON。`;

const CONTRACT = `输出 JSON：
{
  "titles": ["5 条视频标题，各 ≤30 字，风格互不相同"],
  "hooks": ["3 句开头 3 秒钩子，可直接口播"],
  "voiceover": [{ "segment": 1, "text": "该段口播" }],
  "captions": [{ "shot": 1, "text": "≤${CAPTION_MAX}字字幕" }],
  "description": "发布正文（2-4 句，含行动号召，不含话题）",
  "hashtags": ["5-8 个话题，不带 #"],
  "pinned_comment": "置顶评论，引导互动或下单",
  "notes": ["给剪辑/运营的 1-3 条提醒，例如哪些卖点需要补充资料"]
}
voiceover 必须与输入分段一一对应；captions 必须与输入镜头一一对应。`;

/** Models return captions/voice-over as strings or as objects with varying keys. */
export const textOf = v => typeof v === 'string' ? v : String(v?.text ?? v?.caption ?? v?.content ?? v?.subtitle ?? v?.line ?? '').trim();

export function scanBanned(text) {
  const hits = new Set();
  for (const w of BANNED) if (String(text || '').includes(w)) hits.add(w);
  // "最" alone is too noisy inside words like 最近/最后; only flag it before adjectives-ish contexts.
  // 第一件事 / 第一次 / 第一集 are ordinals, not superlative claims.
  if (hits.has('第一') && !/第一(?![件次个步天眼章段集季期周时回句位条款口遍])/.test(text)) hits.delete('第一');
  if (hits.has('最') && !/最(好|佳|强|优|低|高|大|美|火|热|值|划算|便宜|舒服|轻|暖|薄)/.test(text)) hits.delete('最');
  return [...hits];
}

export function checkCopy(raw, job) {
  const hard = [], soft = [];
  const segs = job.director.segments, shots = job.shots;
  if (!raw || typeof raw !== 'object') return { hard: ['不是 JSON 对象'], soft };
  if (!Array.isArray(raw.titles) || raw.titles.length < 3) hard.push('titles 至少 3 条');
  if (!Array.isArray(raw.voiceover) || raw.voiceover.length !== segs.length) hard.push(`voiceover 必须恰好 ${segs.length} 段`);
  else raw.voiceover.forEach((v, i) => {
    const limit = Math.round(segs[i].duration * CHARS_PER_SEC * 1.15);
    const len = textOf(v).replace(/\s/g, '').length;
    if (!len) hard.push(`voiceover[${i}] 为空`);
    else if (len > limit) hard.push(`voiceover[${i}] ${len} 字，超过该段 ${segs[i].duration}s 可念完的 ${limit} 字`);
  });
  if (!Array.isArray(raw.captions) || raw.captions.length !== shots.length) hard.push(`captions 必须恰好 ${shots.length} 条`);
  else raw.captions.forEach((c, i) => {
    const len = [...textOf(c)].length;
    if (!len) hard.push(`captions[${i}] 为空（每条写成 {"shot": n, "text": "字幕"}）`);
    else if (len > CAPTION_MAX + 2) hard.push(`captions[${i}] ${len} 字，超过 ${CAPTION_MAX} 字`);
  });
  const texts = [...(raw.titles || []), ...(raw.hooks || []), ...(raw.voiceover || []).map(textOf), ...(raw.captions || []).map(textOf), raw.description, raw.pinned_comment].filter(Boolean).map(String);
  for (const t of texts) {
    const hits = scanBanned(t);
    if (hits.length) soft.push(`广告法敏感词「${hits.join('、')}」：${t.length > 28 ? `${t.slice(0, 28)}…` : t}`);
  }
  return { hard, soft };
}

export async function chat(messages) {
  const res = await fetch(`${config.deepseek.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.deepseek.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.deepseek.model, stream: false, max_tokens: 6000, temperature: 0.8, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, messages }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}：${body?.error?.message || ''}`);
  const choice = body.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('DeepSeek 文案输出被截断');
  const text = choice?.message?.content || '';
  if (!text.trim()) throw new Error('DeepSeek 返回为空');
  return { text, usage: body.usage, model: body.model };
}

export async function runCopywriter(job, { tone = 'seed', target = 'douyin' } = {}) {
  if (!config.deepseek.key) throw new Error('DeepSeek API Key 未配置');
  if (!job.director) throw new Error('先完成导演拆解，再写文案');
  const d = job.director, b = job.brief || {};
  const user = [
    `目标平台：${TARGETS[target] || target}；文案风格：${TONES[tone] || tone}`,
    `商品：${b.product || '（未填写，用"这件/这款"指代，不要编造品名）'}`,
    `商品说明（唯一可信卖点来源）：${b.notes || '（未提供，禁止写任何具体功效/材质/数据）'}`,
    b.model ? `出镜人物：${b.model}` : '',
    b.style ? `风格补充：${b.style}` : '',
    '',
    `参考视频原文案：${(job.meta.title || '').slice(0, 300)}`,
    `参考拆解 —— 钩子：${d.analysis.hook}；结构：${d.analysis.structure}；节奏：${d.analysis.rhythm}；声音：${d.analysis.audio_guess || '不确定'}`,
    ...(job.transcript?.segments?.length ? ['原片口播 / 对白转写（秒）：', ...transcriptLines(job.transcript).map(l => `  ${l}`)] : []),
    '',
    '生成分段（口播按此计时）：',
    ...d.segments.map((s, i) => `  段${s.index}：${s.duration}s，最多 ${Math.floor(s.duration * CHARS_PER_SEC)} 字；画面：${s.note_zh || ''}`),
    '',
    '镜头（字幕逐条对应）：',
    ...job.shots.map((s, i) => { const x = d.shots[i] || {}; return `  镜头${s.index}：${s.duration}s，${x.shot_size || ''} ${x.subject || ''} ${x.action || ''}`.trim(); }),
    '',
    CONTRACT,
  ].filter(x => x !== '').join('\n');

  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
  let reply = await chat(messages);
  let usage = reply.usage;
  let parsed, check;
  try { parsed = JSON.parse(reply.text); check = checkCopy(parsed, job); } catch { check = { hard: ['不是合法 JSON'], soft: [] }; }
  let repaired = false;
  if (check.hard.length) {
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `上面的 JSON 有问题：\n- ${check.hard.slice(0, 20).join('\n- ')}\n请输出修正后的完整 JSON，只改这些问题。` });
    reply = await chat(messages);
    usage = usage && reply.usage ? { prompt_tokens: usage.prompt_tokens + reply.usage.prompt_tokens, completion_tokens: usage.completion_tokens + reply.usage.completion_tokens } : reply.usage;
    try { parsed = JSON.parse(reply.text); check = checkCopy(parsed, job); } catch { check = { hard: ['不是合法 JSON'], soft: [] }; }
    if (check.hard.length) throw new Error(`文案两次都未通过检查：${check.hard.slice(0, 3).join('；')}`);
    repaired = true;
  }
  return {
    tone, target,
    titles: parsed.titles.slice(0, 5),
    hooks: (parsed.hooks || []).slice(0, 3),
    voiceover: d.segments.map((s, i) => ({ segment: s.index, start: s.start, end: s.end, duration: s.duration, text: textOf(parsed.voiceover[i]) })),
    captions: job.shots.map((s, i) => ({ shot: s.index, start: s.start, end: s.end, text: textOf(parsed.captions[i]) })),
    description: parsed.description || '',
    hashtags: (parsed.hashtags || []).map(h => String(h).replace(/^#/, '')).slice(0, 8),
    pinned_comment: parsed.pinned_comment || '',
    notes: parsed.notes || [],
    warnings: check.soft,
    model: reply.model, usage, repaired,
    generatedAt: new Date().toISOString(),
  };
}

export function copyMarkdown(job) {
  const c = job.copy;
  const tc = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  return [
    `# 带货文案 · ${TARGETS[c.target] || c.target} · ${TONES[c.tone] || c.tone}`, '',
    ...(c.warnings.length ? [`> ⚠ ${c.warnings.join('；')}`, ''] : []),
    '## 标题候选', '', ...c.titles.map((t, i) => `${i + 1}. ${t}`), '',
    '## 开头钩子', '', ...c.hooks.map(h => `- ${h}`), '',
    '## 口播脚本', '', ...c.voiceover.map(v => `**段${v.segment} · ${tc(v.start)}–${tc(v.end)}（${v.duration}s）**\n\n${v.text}\n`),
    '## 画面字幕', '', '| 镜头 | 时间 | 字幕 |', '| :-: | :-- | :-- |', ...c.captions.map(x => `| ${x.shot} | ${tc(x.start)}–${tc(x.end)} | ${x.text} |`), '',
    '## 发布文案', '', c.description, '', c.hashtags.map(h => `#${h}`).join(' '), '',
    '## 置顶评论', '', c.pinned_comment, '',
    ...(c.notes.length ? ['## 提醒', '', ...c.notes.map(n => `- ${n}`), ''] : []),
  ].join('\n');
}
