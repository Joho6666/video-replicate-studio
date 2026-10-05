// Hook variants: alternative opening lines for one board, so a batch of cuts really differs where it
// matters most (the first seconds). The LLM decides WHAT to say; this module decides everything else —
// how long a hook may be, which hooks are compliant and different enough, which picture carries it,
// and whether anything is paid. A lip-synced talking clip is never reused under a different line.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadBoard, saveBoard } from './board.mjs';
import { checkLine, whitelistFrom } from './compliance.mjs';
import { config } from './env.mjs';
import { chat, scanBanned } from './copywriter.mjs';
import { jobDir } from './jobs.mjs';
import { mediaInfo } from './media.mjs';
import { billedChars, speak } from './moss.mjs';
import { EXPERT_RE, speechSeconds } from './script.mjs';

export const ANGLES = ['question', 'pain', 'contrast', 'curiosity', 'story'];
export const MAX_HOOKS_PER_CALL = 10;
export const SIMILARITY_LIMIT = 0.6;
const SLOT_SLACK = 0.5; // seconds a hook may run over the slot

const httpError = (status, message) => Object.assign(new Error(message), { status });
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const isCjk = t => (String(t).match(/[㐀-鿿]/g) || []).length > String(t).length * 0.3;
export const languageOf = text => (isCjk(text) ? 'Chinese' : 'English');

/**
 * A shot whose mouth movement is tied to its own voice. Generated shots count as talking unless marked
 * `source.lipsync: false` (b-roll); reused clips only when marked `lipsync: true`.
 */
export const isLipSynced = shot => (typeof shot?.source?.lipsync === 'boolean' ? shot.source.lipsync : shot?.source?.kind === 'generate');

/** The shot a hook replaces: `board.hookShot`, else the first shot. */
export function hookSlot(board) {
  const shot = (board.hookShot && board.shots.find(s => s.id === board.hookShot)) || board.shots[0];
  if (!shot) throw httpError(400, '镜头表是空的');
  return { shot, seconds: Math.round((shot.end - shot.start) * 100) / 100, language: languageOf(shot.text || board.shots.map(s => s.text).join(' ')) };
}

/* ───────── checking (pure) ───────── */

const tokens = t => {
  const s = String(t).toLowerCase();
  if (isCjk(s)) { const c = [...s.replace(/[^\p{L}\p{N}]/gu, '')]; return new Set(c.slice(0, -1).map((x, i) => x + c[i + 1])); }
  return new Set(s.split(/[^\p{L}\p{N}']+/u).filter(Boolean));
};
export function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Keeps the hooks that can ship. Rejected ones carry a reason so the page can show it.
 * ctx = { slotSeconds, whitelist, original, count }
 */
export function checkHooks(list, { slotSeconds, whitelist = [], original = '', count = 5 }) {
  const kept = [], rejected = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const text = clip(raw?.text, 400);
    const reject = reason => rejected.push({ text, reason });
    if (!text) { reject('空文本'); continue; }
    if (speechSeconds(text) > slotSeconds + SLOT_SLACK) { reject(`太长：念完约 ${speechSeconds(text)}s，钩子位只有 ${slotSeconds}s`); continue; }
    const bad = checkLine(text, { whitelist });
    if (bad.length) { reject(`合规：${bad.join('、')}`); continue; }
    const ad = scanBanned(text);
    if (ad.length) { reject(`广告法敏感词：${ad.join('、')}`); continue; }
    if (EXPERT_RE.test(text)) { reject('涉及专家 / 医生形象，不用 AI 编造'); continue; }
    if (original && similarity(text, original) >= SIMILARITY_LIMIT) { reject('和原钩子太像'); continue; }
    if (kept.some(k => similarity(text, k.text) >= SIMILARITY_LIMIT)) { reject('和另一条钩子太像'); continue; }
    if (kept.length >= count) { reject('超过需要的数量'); continue; }
    kept.push({ text, angle: ANGLES.includes(raw?.angle) ? raw.angle : 'curiosity' });
  }
  return { kept, rejected };
}

/* ───────── LLM ───────── */

const SYSTEM = `你是短视频投放文案专家，只负责写"开头钩子"：视频前几秒的第一句口播。
给你完整口播脚本、原钩子和时长限制，写出若干条风格不同的备选钩子。
规则：
1. 语言必须和原脚本一致。
2. 每条念完不能超过给定秒数；越短越有力。
3. 只能使用"商品说明"和脚本里已经出现的事实；不要编造数据、功效、认证、用户评价，不要出现新的数字。
4. 不要出现专家、医生、科学家等权威形象，不要用"最"、"第一"、"全网"之类的极限词。
5. 每条换一个角度（angle 只能是 ${ANGLES.join(' / ')}），彼此和原钩子都要明显不同，不要只换几个词。
只输出 JSON：{"hooks":[{"angle":"question","text":"…"}]}`;

/** One DeepSeek call (+ one repair round with the rejection reasons) → checked hooks. */
export async function runHookWriter(job, board, { count = 5, ask = chat } = {}) {
  if (!config.deepseek.key && ask === chat) throw httpError(400, 'DeepSeek API Key 未配置');
  if (!Number.isInteger(count) || count < 1 || count > MAX_HOOKS_PER_CALL) throw httpError(400, `一次写 1–${MAX_HOOKS_PER_CALL} 条`);
  const slot = hookSlot(board);
  const whitelist = whitelistFrom(job);
  const b = job.brief || {};
  const user = [
    b.product && `商品：${b.product}`, b.notes && `商品说明：${b.notes}`,
    `原钩子：${slot.shot.text || '（无）'}`,
    `每条念完不能超过 ${slot.seconds} 秒（${slot.language === 'Chinese' ? '约 ' + Math.floor(slot.seconds * 4.5) + ' 个字' : '约 ' + Math.floor(slot.seconds * 2.6) + ' 个英文单词'}）`,
    `请写 ${count + 2} 条（多写几条备选，会被过滤）。`, '', '完整脚本：', ...board.shots.map((s, i) => `${i + 1}. ${s.text || ''}`),
  ].filter(x => x !== undefined && x !== false).join('\n');
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
  const ctx = { slotSeconds: slot.seconds, whitelist, original: slot.shot.text || '', count };
  let reply = await ask(messages), parsed;
  const parse = () => { try { parsed = JSON.parse(reply.text); return Array.isArray(parsed?.hooks); } catch { return false; } };
  if (!parse()) { messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: '不是要求的 JSON。只输出 {"hooks":[{"angle":"…","text":"…"}]}。' }); reply = await ask(messages); if (!parse()) throw new Error('钩子两次都没有返回合法 JSON'); }
  let { kept, rejected } = checkHooks(parsed.hooks, ctx);
  if (kept.length < count) { // one repair round: tell the model why the others were dropped and ask for the missing ones
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `这些被过滤了：\n- ${rejected.slice(0, 8).map(r => `${r.text.slice(0, 50)}（${r.reason}）`).join('\n- ')}\n请再写 ${count - kept.length + 2} 条合格的、且不同于已保留的钩子，只输出 JSON。` });
    try {
      reply = await ask(messages);
      if (parse()) { const second = checkHooks([...kept, ...parsed.hooks], ctx); kept = second.kept; rejected = [...rejected, ...second.rejected.filter(r => !kept.some(k => k.text === r.text))]; }
    } catch { /* keep what we have */ }
  }
  return { hooks: kept.map((h, i) => ({ id: `H${i + 1}`, ...h })), rejected, slot: { shot: slot.shot.id, seconds: slot.seconds }, usage: reply.usage, model: reply.model };
}

/* ───────── picture for a hook (pure) ───────── */

/**
 * Picks the clip(s) that carry hook number `k` (0-based) over a voice of `seconds`. Only shots that are not
 * lip-synced are eligible; the slot shot itself is used when it qualifies. Each picked clip must be long
 * enough for its share of the voice (the factory pins one clip per share). Returns items or null.
 * `items` = exportable items [{ shot, dur }]; `maxShare` caps how many clips one hook may use.
 */
export function pickHookVisuals(items, slotShotId, seconds, k, { maxShare = 4, margin = 0.7 } = {}) {
  const eligible = items.filter(it => !isLipSynced(it.shot));
  if (!eligible.length) return null;
  const own = eligible.find(it => it.shot.id === slotShotId);
  const order = own ? [own, ...eligible.filter(it => it !== own)] : eligible;
  for (let n = 1; n <= Math.min(maxShare, order.length * 2); n++) {
    const picks = Array.from({ length: n }, (_, i) => order[(k + i) % order.length]);
    if (picks.every(p => p.dur >= seconds / n + margin)) return picks;
  }
  return null;
}

/* ───────── voices (paid, small) ───────── */

const voicing = new Set(); // one voice run per job at a time: every character is billed

export const hookVoiceId = (job, board) => board.voice?.id || job.voice?.voiceId || null;

/** Hooks that still need a voice (or all with `again`). Pure. */
export function pendingHookVoices(board, { ids = null, again = false } = {}) {
  return (board.hooks || []).filter(h => (!ids || ids.includes(h.id)) && (again || !h.voice));
}

export const hookChars = hooks => hooks.reduce((n, h) => n + billedChars(h.text), 0);

/**
 * Voices the pending hooks one by one (never in parallel, never retried). The caller echoes how many
 * it expects, so a stale page cannot trigger a bigger bill.
 */
export async function generateHookVoices(job, { ids = null, again = false, expect, say = speak, duration = async f => (await mediaInfo(f)).duration } = {}) {
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  const voiceId = hookVoiceId(job, board);
  if (!voiceId) throw httpError(400, '先给这张镜头表选一个音色（钩子要用同一个音色，否则前后声音对不上）');
  const todo = pendingHookVoices(board, { ids, again });
  if (!todo.length) return { generated: [], failed: [], chars: 0 };
  if (!Number.isInteger(expect) || expect !== todo.length) throw httpError(409, `需要配音 ${todo.length} 条，页面上确认的是 ${expect ?? '未确认'} 条，请刷新后重试`);
  if (todo.length > MAX_HOOKS_PER_CALL) throw httpError(400, `一次最多配 ${MAX_HOOKS_PER_CALL} 条`);
  if (voicing.has(job.id)) throw httpError(409, '这个任务正在生成钩子配音');
  voicing.add(job.id);
  const slot = hookSlot(board);
  const dir = path.join(jobDir(job.id), 'voice');
  await mkdir(dir, { recursive: true });
  const generated = [], failed = [];
  try {
    for (const h of todo) {
      const rel = `voice/hook-${h.id}.mp3`;
      try {
        const out = await say({ text: h.text, voiceId, seconds: Math.max(1, slot.seconds - 0.3), language: slot.language, out: path.join(jobDir(job.id), rel) });
        const actual = Math.round((await duration(out)) * 100) / 100;
        const current = (await loadBoard(job)) || board; // re-read: earlier iterations already saved
        const target = current.hooks.find(x => x.id === h.id);
        if (!target || target.text !== h.text) continue; // edited while we were speaking: the voice would be stale
        target.voice = { file: rel, seconds: actual, voiceId, chars: billedChars(h.text), at: new Date().toISOString() };
        await saveBoard(job, current, { trustHooks: true });
        generated.push(h.id);
      } catch (e) { failed.push({ id: h.id, error: e.message }); }
    }
  } finally { voicing.delete(job.id); }
  return { generated, failed, chars: hookChars(todo.filter(h => generated.includes(h.id))) };
}
