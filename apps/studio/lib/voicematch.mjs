// Smart voice matching. MOSI only lists the account's own voices — ids and generated names, no gender, age
// or style — so a voice cannot be chosen by its label. Instead every candidate speaks the same sample line,
// the audio is measured (pitch, natural pace, brightness, level), and the measurements are scored against a
// target profile. The LLM only describes WHAT voice the brief calls for; code decides which voice fits.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadBoard, saveBoard } from './board.mjs';
import { tools } from './env.mjs';
import { chat } from './copywriter.mjs';
import { languageOf } from './hooks.mjs';
import { jobDir } from './jobs.mjs';
import { mediaInfo } from './media.mjs';
import { billedChars, listVoices, speak } from './moss.mjs';

export const MAX_CANDIDATES = 24;
export const SAMPLE = {
  Chinese: '好大衣，先是一种触感。走在光里，它不出声，却有重量。',
  English: 'A good coat begins as a feeling. It walks through the light without a sound, and still it has weight.',
};
const httpError = (status, message) => Object.assign(new Error(message), { status });
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/* ───────── audio measurements ───────── */

/** Median fundamental frequency of the voiced frames (autocorrelation), or null. Pure. */
export function f0Median(samples, sr = 16000) {
  const frame = Math.round(sr * 0.04), hop = Math.round(sr * 0.02);
  const minLag = Math.floor(sr / 400), maxLag = Math.ceil(sr / 70);
  let peak = 0;
  for (let i = 0; i < samples.length; i += 7) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 1e-4) return null;
  const freqs = [];
  for (let start = 0; start + frame + maxLag < samples.length; start += hop) {
    let energy = 0;
    for (let i = 0; i < frame; i++) energy += samples[start + i] ** 2;
    if (Math.sqrt(energy / frame) < peak * 0.06) continue; // silence / breath
    const corr = [];
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0, e2 = 0;
      for (let i = 0; i < frame; i++) { sum += samples[start + i] * samples[start + i + lag]; e2 += samples[start + i + lag] ** 2; }
      const r = sum / Math.sqrt(energy * e2 + 1e-12);
      corr.push(r);
      if (r > best) best = r;
    }
    // the smallest lag that is almost as good as the best one: multiples of the period correlate just as well
    let bestLag = 0;
    for (let k = 1; k < corr.length - 1; k++) if (corr[k] >= best * 0.92 && corr[k] >= corr[k - 1] && corr[k] >= corr[k + 1]) { bestLag = minLag + k; break; }
    if (best > 0.45 && bestLag) freqs.push(sr / bestLag);
  }
  if (freqs.length < 8) return null;
  freqs.sort((a, b) => a - b);
  return Math.round(freqs[Math.floor(freqs.length / 2)] * 10) / 10;
}

/** Zero-crossing rate over voiced frames: a cheap brightness proxy (higher = brighter / airier). Pure. */
export function brightness(samples) {
  let crossings = 0, n = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 7) peak = Math.max(peak, Math.abs(samples[i]));
  for (let i = 1; i < samples.length; i++) {
    if (Math.abs(samples[i]) < peak * 0.04) continue;
    n++;
    if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) crossings++;
  }
  return n ? Math.round((crossings / n) * 1000) / 1000 : 0;
}

function decode(file, sr = 16000) {
  return new Promise((resolve, reject) => {
    const child = spawn(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { windowsHide: true });
    const chunks = [];
    child.stdout.on('data', d => chunks.push(d));
    child.on('error', reject);
    child.on('close', code => { if (code !== 0) return reject(new Error('无法解码试听音频')); const b = Buffer.concat(chunks); resolve(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4))); });
  });
}

/** Measurements of one audition: pitch, natural pace (characters or words per second), brightness, voiced share. */
export async function analyzeAudition(file, text, language) {
  const samples = await decode(file);
  const { duration } = await mediaInfo(file);
  let voiced = 0, total = 0;
  const win = 640;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 7) peak = Math.max(peak, Math.abs(samples[i]));
  for (let i = 0; i + win < samples.length; i += win) { total++; let e = 0; for (let j = 0; j < win; j++) e += samples[i + j] ** 2; if (Math.sqrt(e / win) > peak * 0.06) voiced++; }
  const units = language === 'Chinese' ? String(text).replace(/[\s，。！？、,.!?]/g, '').length : String(text).trim().split(/\s+/).length;
  return { duration: Math.round(duration * 100) / 100, f0: f0Median(samples), bright: brightness(samples), pace: Math.round((units / Math.max(0.1, duration)) * 100) / 100, voiced: total ? Math.round((voiced / total) * 100) / 100 : 0, peak: Math.round(peak * 1000) / 1000 };
}

/* ───────── target profile ───────── */

export const TARGET_FIELDS = { gender: ['female', 'male', 'any'], pitch: ['low', 'mid', 'high'], pace: ['slow', 'normal', 'fast'], warmth: ['warm', 'neutral', 'bright'] };
export const DEFAULT_TARGET = { gender: 'any', pitch: 'mid', pace: 'normal', warmth: 'neutral', why: '没有足够信息，用中性默认值' };

/** Keeps only valid enum values from a model reply. Pure. */
export function cleanTarget(raw) {
  const out = { why: String(raw?.why || '').slice(0, 200) };
  for (const [k, allowed] of Object.entries(TARGET_FIELDS)) out[k] = allowed.includes(raw?.[k]) ? raw[k] : DEFAULT_TARGET[k];
  return out;
}

const TARGET_SYSTEM = `你是配音导演。根据品牌简介、风格和台词，描述这条旁白最合适的声音。只输出 JSON：
{"gender":"female|male|any","pitch":"low|mid|high","pace":"slow|normal|fast","warmth":"warm|neutral|bright","why":"一句话理由"}
gender 只在内容明显偏向时才选，否则 any；高级、安静、克制的内容通常 pitch=low 或 mid、pace=slow；促销、活力的内容 pace=fast、warmth=bright。`;

/** Describes the wanted voice from the board (one LLM call; code validates every field). */
export async function pickTarget(job, board, { ask = chat } = {}) {
  const b = job.brief || {};
  const lines = board.shots.map(s => s.text).filter(Boolean).join(' / ');
  const user = [b.product && `品牌/商品：${b.product}`, b.notes && `说明：${b.notes}`, board.title && `标题：${board.title}`, lines && `台词：${lines}`].filter(Boolean).join('\n');
  try {
    const reply = await ask([{ role: 'system', content: TARGET_SYSTEM }, { role: 'user', content: user || '（没有更多信息）' }]);
    return cleanTarget(JSON.parse(reply.text));
  } catch { return { ...DEFAULT_TARGET }; }
}

/* ───────── scoring ───────── */

const F0_TARGET = { female: { low: 170, mid: 210, high: 250 }, male: { low: 95, mid: 120, high: 150 } };
const PACE_TARGET = { Chinese: { slow: 3.1, normal: 4.3, fast: 5.4 }, English: { slow: 1.9, normal: 2.5, fast: 3.1 } };

/** Gender estimate from pitch: below 150 Hz male, above 185 Hz female, in between unsure. Pure. */
export const genderOf = f0 => (f0 === null ? null : f0 < 150 ? 'male' : f0 > 185 ? 'female' : 'unsure');

/**
 * Scores one audition against the target (lower penalty = better fit). `brightRank` is the voice's rank among
 * the candidates, 0 (darkest) … 1 (brightest). Returns { score 0–100, parts, reject }.
 */
export function scoreVoice(m, target, language, brightRank = 0.5) {
  if (!m || m.f0 === null || m.voiced < 0.3 || m.duration < 1 || m.peak < 0.02) return { score: 0, parts: {}, reject: '试听音频不可用（没声音、太短或测不出音高）' };
  const g = genderOf(m.f0);
  const parts = {};
  if (target.gender === 'any') parts.gender = 0;
  else parts.gender = g === target.gender ? 0 : g === 'unsure' ? 12 : 40;
  const gf = target.gender === 'any' ? (g === 'male' ? 'male' : 'female') : target.gender;
  parts.pitch = Math.min(40, Math.abs(Math.log(m.f0 / F0_TARGET[gf][target.pitch])) * 90);
  const paceT = PACE_TARGET[language][target.pace];
  parts.pace = Math.min(30, Math.abs(m.pace - paceT) / paceT * 60);
  const warmWanted = { warm: 0.15, neutral: 0.5, bright: 0.85 }[target.warmth];
  parts.warmth = Math.abs(brightRank - warmWanted) * 20;
  const penalty = Object.values(parts).reduce((a, b) => a + b, 0);
  return { score: Math.round(clamp(100 - penalty, 0, 100)), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v)])), reject: null };
}

/** Rank the auditions. Pure given the measurements. */
export function rankVoices(auditions, target, language) {
  const bright = auditions.filter(a => a.m && a.m.f0 !== null).map(a => a.m.bright).sort((a, b) => a - b);
  const rankOf = v => (bright.length < 2 ? 0.5 : bright.indexOf(v) / (bright.length - 1));
  return auditions.map(a => ({ ...a, ...scoreVoice(a.m, target, language, a.m ? rankOf(a.m.bright) : 0.5), gender: a.m ? genderOf(a.m.f0) : null })).sort((a, b) => b.score - a.score);
}

/* ───────── candidates ───────── */

/**
 * Which of the account's voices to audition. Voices named "Voice Clone …" are clones of someone's recorded
 * voice: they are left out unless the caller opts in (consent for that person's voice is not something code can see).
 */
export function candidatePool(voices, { includeClones = false, extraIds = [] } = {}) {
  const pool = voices.filter(v => includeClones || !/clone/i.test(v.name || ''));
  const ids = new Set(pool.map(v => v.id));
  for (const id of extraIds) if (id && !ids.has(id)) pool.push({ id, name: `指定音色 ${id.slice(0, 8)}` });
  return pool.slice(0, MAX_CANDIDATES);
}

export const sampleFor = language => SAMPLE[language] || SAMPLE.Chinese;

/** Free preview: who would be auditioned and what it costs (¥2 / 10k characters). */
export async function matchPlan(job, { includeClones = false, list = listVoices } = {}) {
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  const language = languageOf(board.shots.map(s => s.text).join(' '));
  const pool = candidatePool(await list(), { includeClones, extraIds: [board.voice?.id] });
  const chars = billedChars(sampleFor(language)) * pool.length;
  return { language, voices: pool.length, chars, yuan: Math.round((chars / 10000) * 2 * 1000) / 1000, names: pool.map(v => v.name), skippedClones: includeClones ? 0 : (await list()).filter(v => /clone/i.test(v.name || '')).length };
}

const matching = new Set();

/**
 * Auditions every candidate with the same sample line, scores them against the target and (with `apply`) sets
 * the best one as the board's voice. The caller echoes { voices, chars }.
 */
export async function matchVoice(job, { includeClones = false, apply = true, expect, say = speak, analyze = analyzeAudition, list = listVoices, ask = chat } = {}) {
  const plan = await matchPlan(job, { includeClones, list });
  if (!expect || expect.voices !== plan.voices || expect.chars !== plan.chars) throw httpError(409, `需要试听 ${plan.voices} 个音色、约 ${plan.chars} 字（约 ¥${plan.yuan}），页面上确认的是 ${expect ? `${expect.voices} 个、${expect.chars} 字` : '未确认'}，请刷新后重试`);
  if (!plan.voices) throw httpError(400, '账号里没有可试听的音色');
  if (matching.has(job.id)) throw httpError(409, '正在匹配音色');
  matching.add(job.id);
  try {
    const board = await loadBoard(job);
    const target = await pickTarget(job, board, { ask });
    const pool = candidatePool(await list(), { includeClones, extraIds: [board.voice?.id] });
    const text = sampleFor(plan.language);
    const dir = path.join(jobDir(job.id), 'voice', 'audition');
    await mkdir(dir, { recursive: true });
    const auditions = [];
    for (const v of pool) { // one at a time, never retried: every character is billed
      const rel = `voice/audition/${v.id}.mp3`;
      try {
        await say({ text, voiceId: v.id, language: plan.language, out: path.join(jobDir(job.id), rel) });
        auditions.push({ id: v.id, name: v.name, file: rel, m: await analyze(path.join(jobDir(job.id), rel), text, plan.language) });
      } catch (e) { auditions.push({ id: v.id, name: v.name, file: null, m: null, error: e.message }); }
    }
    const ranked = rankVoices(auditions, target, plan.language);
    const best = ranked.find(r => !r.reject && !r.error);
    let applied = null;
    if (apply && best) {
      const current = await loadBoard(job);
      current.voice = { provider: 'moss', id: best.id, name: best.name, matchedAt: new Date().toISOString() };
      await saveBoard(job, current);
      applied = best.id;
    }
    return { target, language: plan.language, ranked: ranked.map(r => ({ id: r.id, name: r.name, score: r.score, gender: r.gender, f0: r.m?.f0 ?? null, pace: r.m?.pace ?? null, parts: r.parts, file: r.file, reject: r.error || r.reject || null })), applied, chars: plan.chars };
  } finally { matching.delete(job.id); }
}
