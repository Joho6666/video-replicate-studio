// Script entry: a pasted script (optionally with time codes) → a shot list (board).
// The LLM decides WHAT (what each line looks like); this module decides HOW (timing, which shots are
// paid generation vs. still images, how much on-camera generation is allowed, validation).
import { chat } from './copywriter.mjs';
import { config } from './env.mjs';
import { BOARD_VERSION, normalizeBoard, validateBoard } from './board.mjs';
import { negations } from './promptlint.mjs';

export const KINDS = ['talk', 'broll', 'product', 'graphic', 'expert'];
export const MAX_GENERATE_SECONDS = 10; // default cap on paid on-camera seconds per video

// A shot that shows a doctor / scientist / expert is never AI-generated: a made-up authority figure is a
// fake endorsement. The model may mislabel such a shot as b-roll, so the text is checked here as well.
export const EXPERT_RE = /(scientist|doctor|physician|nutritionist|dietitian|lab coat|laboratory coat|expert|professor|researcher|科学家|医生|医师|专家|营养师|白大褂|博士|研究员)/i;

const pad = n => String(n).padStart(2, '0');
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** "0:06.6", "00:14", "1:02:03" → seconds. */
export function parseClock(raw) {
  const parts = String(raw).replace(',', '.').split(':').map(Number);
  if (parts.some(n => !Number.isFinite(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const TIME = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?`;
const LINE_RE = new RegExp(String.raw`^\s*[\[(]?\s*(${TIME})\s*(?:[-–—~→]+\s*(${TIME}))?\s*[\])]?\s*[:：\-–—]?\s*(.*\S)\s*$`);

/**
 * Lines that start with a time code ("0:06-0:14 text", "[00:06.6–00:14.0] text", "0:30 text").
 * Returns null unless at least two lines carry a time, so ordinary prose is never half-parsed.
 * A line with only a start time ends where the next one starts; the last one ends at `fallbackEnd`.
 */
export function parseTimedScript(source, fallbackEnd) {
  const rows = [];
  for (const raw of String(source || '').split(/\r?\n/)) {
    const m = LINE_RE.exec(raw);
    if (m) rows.push({ start: parseClock(m[1]), end: m[2] ? parseClock(m[2]) : null, text: m[3].trim() });
    else if (raw.trim() && rows.length) rows[rows.length - 1].text += ` ${raw.trim()}`; // wrapped continuation
  }
  if (rows.length < 2) return null;
  rows.forEach((r, i) => { if (r.end == null) r.end = i + 1 < rows.length ? rows[i + 1].start : fallbackEnd ?? r.start + speechSeconds(r.text); });
  if (rows.some(r => !(r.start >= 0) || !(r.end > r.start))) return null;
  return rows.map(r => ({ start: r.start, end: r.end, text: clip(r.text, 600) }));
}

/** Comfortable read-aloud length: ~4.5 CJK characters or ~2.6 words per second, never under 2 s. */
export function speechSeconds(text) {
  const t = String(text || '');
  const cjk = (t.match(/[㐀-鿿]/g) || []).length;
  const secs = cjk > t.length * 0.3 ? cjk / 4.5 : t.trim().split(/\s+/).filter(Boolean).length / 2.6;
  return Math.max(2, Math.round(secs * 10) / 10);
}

/** Untimed scripts: one paragraph/sentence group per line, timed by speaking length. */
export function layoutUntimed(source) {
  const sentences = String(source || '').split(/\r?\n+/).map(s => s.trim()).filter(Boolean);
  let t = 0;
  return sentences.map(text => { const start = t; t += speechSeconds(text); return { start: Math.round(start * 10) / 10, end: Math.round(t * 10) / 10, text: clip(text, 600) }; });
}

export const scriptLines = source => parseTimedScript(source) || layoutUntimed(source);

/* ───────── LLM planning ───────── */

const SYSTEM = `你是短视频分镜导演，擅长把口播脚本拆成能直接出图的镜头。
给你若干条带编号的口播句子。为每一句设计一个镜头：画面是什么、怎么拍、用哪类素材。

规则：
1. 每句对应一个镜头，输出 shots 数组，长度必须等于句子数，line 字段是句子编号。
2. kind 只能是：
   - talk：主角出镜对着镜头口播（只给最关键的 1–3 句，通常是开场钩子和结尾）；
   - broll：生活场景、动作、情绪镜头；
   - product：产品特写或摆拍（产品会用客户提供的真实产品图，不要描述瓶身上的字）；
   - graphic：抽象概念、信息图、动画示意，不出现真人脸；
   - expert：需要"专家/医生/创始人"出镜的句子。这类镜头必须由客户提供真人素材，不要编造。
3. prompt_en：英文图像提示词，写成"Photorealistic vertical phone photo, …"，一句话，包含景别、主体、动作、光线；不要出现任何文字、商标、品牌名；不要出现真实名人或第三方影视动漫角色；**不要写任何否定句**（no / without / not / 不要…）——点名不想要的东西，模型反而会把它画出来，只描述想要的画面；尽量让画面里不出现人手和人脸特写（手最容易画坏），除非这一镜必须有。
4. character：画面里出现主角（同一个人）时为 true。
5. overlay：可选，画面上要弹出的关键词，≤4 个词，没有就留空字符串。
6. visual：一句中文，说明这一镜给人看的画面。
只输出 JSON：{"shots":[{"line":1,"kind":"talk","visual":"","prompt_en":"","character":true,"overlay":""}],"notes":[]}`;

export function checkPlan(plan, count) {
  const hard = [];
  const shots = plan?.shots;
  if (!Array.isArray(shots)) return { hard: ['缺少 shots 数组'] };
  if (shots.length !== count) hard.push(`shots 数量必须是 ${count}，实际 ${shots.length}`);
  shots.forEach((s, i) => {
    if (!KINDS.includes(s?.kind)) hard.push(`第 ${i + 1} 镜 kind 无效`);
    if (typeof s?.prompt_en !== 'string' || s.prompt_en.trim().length < 12) hard.push(`第 ${i + 1} 镜缺少 prompt_en`);
    if (typeof s?.visual !== 'string' || !s.visual.trim()) hard.push(`第 ${i + 1} 镜缺少 visual`);
    const neg = negations(s?.prompt_en);
    if (neg.length) hard.push(`第 ${i + 1} 镜 prompt_en 含否定句「${neg[0].phrase}」，请改成只描述想要的画面`);
  });
  return { hard };
}

/**
 * Turns the plan into a board. Pure and deterministic: which shots become paid generation is decided
 * here (talk shots only, shorter than the provider limit, within `maxGenerateSeconds`), never by the model.
 */
export function buildBoardFromPlan(lines, plan, opts = {}) {
  const { maxGenerateSeconds = MAX_GENERATE_SECONDS, provider = 'h3', resolution = '768P', title = '', voice = null, presenter = null, product = null, budget = null } = opts;
  let spent = 0;
  const shots = lines.map((line, i) => {
    const p = plan.shots[i];
    const id = `S${pad(i + 1)}`;
    const dur = line.end - line.start;
    const base = { id, start: line.start, end: line.end, line: i + 1, text: line.text, visual: clip(p.visual, 160), prompt: clip(p.prompt_en, 900), status: 'draft' };
    if (p.kind === 'expert' || (p.kind !== 'graphic' && EXPERT_RE.test(`${p.prompt_en} ${p.visual}`))) {
      return { ...base, prompt: '', source: { kind: 'client', reason: '涉及专家 / 医生形象，必须由客户提供真人素材，不用 AI 编造' } };
    }
    if (p.kind === 'talk' && dur <= 15 && spent + Math.max(4, Math.ceil(dur)) <= maxGenerateSeconds) {
      spent += Math.max(4, Math.ceil(dur));
      return { ...base, source: { kind: 'generate' }, generate: { provider, resolution, group: id } };
    }
    const realProduct = p.kind === 'product' && !!product?.image; // a real photo of the product beats any AI drawing of its label
    return { ...base, source: { kind: 'still', character: !!p.character || p.kind === 'talk', productOverlay: p.kind === 'product' && !realProduct, ...(realProduct ? { useProductImage: true } : {}), overlay: clip(p.overlay, 40) || undefined } };
  });
  const board = normalizeBoard({ version: BOARD_VERSION, title, from: { kind: 'script' }, voice, presenter, product, ...(budget ? { budget } : {}), shots });
  const { ok, errors } = validateBoard(board);
  if (!ok) throw new Error(`脚本拆出的镜头表没通过校验：${errors.slice(0, 3).join('；')}`);
  return board;
}

/** One DeepSeek call (+ one repair round) → board. Needs job.script.text; brief/presenter/product optional. */
export async function runScriptSplit(job, opts = {}) {
  if (!config.deepseek.key) throw new Error('DeepSeek API Key 未配置');
  const source = job.script?.text;
  if (!source?.trim()) throw new Error('任务里没有脚本文本');
  const lines = scriptLines(source);
  if (!lines.length) throw new Error('脚本为空');
  if (lines.length > 40) throw new Error('一次最多 40 句，请分段');
  const b = job.brief || {};
  const context = [b.product && `商品：${b.product}`, b.notes && `商品说明：${b.notes}`, b.model && `主角：${b.model}`, b.style && `风格：${b.style}`].filter(Boolean);
  const user = [...context, ...(context.length ? [''] : []), '口播句子：', ...lines.map((l, i) => `${i + 1}. [${l.start.toFixed(1)}–${l.end.toFixed(1)}s] ${l.text}`)].join('\n');
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
  let reply = await chat(messages), plan, check;
  const parse = () => { try { plan = JSON.parse(reply.text); check = checkPlan(plan, lines.length); } catch { check = { hard: ['不是合法 JSON'] }; } };
  parse();
  if (check.hard.length) {
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `上面的 JSON 有问题：\n- ${check.hard.slice(0, 20).join('\n- ')}\n请输出修正后的完整 JSON，只改这些问题。` });
    reply = await chat(messages); parse();
    if (check.hard.length) throw new Error(`脚本拆镜两次都未通过检查：${check.hard.slice(0, 3).join('；')}`);
  }
  return { board: buildBoardFromPlan(lines, plan, { title: opts.title || job.script.title || '', ...opts }), notes: plan.notes || [], usage: reply.usage, model: reply.model };
}
