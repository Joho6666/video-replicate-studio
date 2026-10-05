// Unified shot list ("board") shared by every entry point: reference-video replication, script-to-video
// and manual editing. One board = one video. Each shot says what the picture is made from
// (reuse / still / generate / client) and what that costs, so approval and spend are decided here
// and the render/generation back ends only read it.
//
// LLM decides WHAT (shot split, prompts); this module decides HOW MUCH (validation, pricing,
// duration limits). Prices and limits are kept in one place and never taken from the client.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { jobDir, saveJob } from './jobs.mjs';

export const BOARD_VERSION = 1;
export const KINDS = ['reuse', 'still', 'generate', 'client'];
export const MAX_HOOKS = 12;
export const STATUSES = ['draft', 'approved', 'queued', 'done', 'failed'];

// CNY per generated second. null = unknown price: the estimate refuses instead of guessing.
export const PRICES = {
  h3: { '768P': 0.5, '2K': null },
  wan3: { '480P': 0.3, '720P': 0.6, '1080P': 1.2 },
};
export const LIMITS = { h3: { min: 4, max: 15 }, wan3: { min: 5, max: 15 } };

const round2 = n => Math.round(n * 100) / 100;
const num = v => typeof v === 'number' && Number.isFinite(v);
const text = v => (typeof v === 'string' ? v : '');

/** Billable seconds for one provider call that covers `sum` seconds of picture. */
export function billableSeconds(provider, sum) {
  const lim = LIMITS[provider];
  if (!lim) return NaN;
  return Math.min(lim.max, Math.max(lim.min, Math.ceil(sum - 0.05)));
}

/** Shots that share a `generate.group` are one provider call (e.g. an H3 segment); others are alone. */
export function generateGroups(board) {
  const groups = new Map();
  for (const shot of board.shots || []) {
    if (shot.source?.kind !== 'generate' || !shot.generate) continue;
    const g = shot.generate;
    const key = `${g.provider}|${g.resolution}|${g.group ?? shot.id}`;
    const entry = groups.get(key) || { provider: g.provider, resolution: g.resolution, shots: [], sum: 0 };
    entry.shots.push(shot.id);
    entry.sum += Math.max(0, (shot.end ?? 0) - (shot.start ?? 0));
    groups.set(key, entry);
  }
  return [...groups.values()];
}

/**
 * Total and per-shot estimate, recomputed from the board alone. Unknown prices are reported in
 * `unknown` and contribute nothing, so the caller can refuse to submit instead of under-quoting.
 */
export function estimateCost(board) {
  const byShot = {};
  const unknown = [];
  let total = 0;
  for (const grp of generateGroups(board)) {
    const unit = PRICES[grp.provider]?.[grp.resolution];
    const seconds = billableSeconds(grp.provider, grp.sum);
    if (!num(unit)) { unknown.push(...grp.shots); continue; }
    const cost = round2(seconds * unit);
    total += cost;
    for (const id of grp.shots) {
      const own = board.shots.find(s => s.id === id);
      const share = grp.sum > 0 ? Math.max(0, own.end - own.start) / grp.sum : 1 / grp.shots.length;
      byShot[id] = { seconds: round2(seconds * share), unitPrice: unit, estimate: round2(cost * share) };
    }
  }
  return { total: round2(total), byShot, unknown, calls: generateGroups(board).map(g => ({ provider: g.provider, resolution: g.resolution, shots: g.shots, seconds: billableSeconds(g.provider, g.sum) })) };
}

/** Strict validation. Returns { ok, errors }; never mutates the board. */
export function validateBoard(board) {
  const errors = [];
  const err = (id, msg) => errors.push(id ? `${id}: ${msg}` : msg);
  if (!board || typeof board !== 'object') return { ok: false, errors: ['镜头表不是对象'] };
  if (board.version !== BOARD_VERSION) err('', `版本必须是 ${BOARD_VERSION}`);
  if (!Array.isArray(board.shots) || !board.shots.length) return { ok: false, errors: [...errors, '镜头表没有镜头'] };
  const seen = new Set();
  let prevStart = -1;
  for (const s of board.shots) {
    const id = text(s?.id);
    if (!id) { err('', '有镜头缺少 id'); continue; }
    if (seen.has(id)) err(id, 'id 重复');
    seen.add(id);
    if (!num(s.start) || !num(s.end) || s.start < 0 || s.end <= s.start) err(id, '时间无效（需要 0 ≤ start < end）');
    else { if (s.start < prevStart) err(id, '镜头必须按开始时间排序'); prevStart = s.start; }
    const kind = s.source?.kind;
    if (!KINDS.includes(kind)) { err(id, `来源必须是 ${KINDS.join(' / ')}`); continue; }
    if (s.status !== undefined && !STATUSES.includes(s.status)) err(id, '状态无效');
    if (kind === 'reuse' && !text(s.source.file)) err(id, '复用镜头需要 source.file');
    if (kind === 'still' && !text(s.source.image) && !text(s.prompt)) err(id, '分镜图镜头需要图片或提示词');
    if (kind === 'client' && s.generate) err(id, '客户提供的素材不能同时标记为付费生成');
    if (kind === 'generate') {
      const g = s.generate;
      if (!g || !PRICES[g.provider]) { err(id, `付费生成需要 provider（${Object.keys(PRICES).join(' / ')}）`); continue; }
      if (!(g.resolution in PRICES[g.provider])) err(id, `${g.provider} 不支持分辨率 ${g.resolution}`);
      if (!text(s.prompt)) err(id, '付费生成需要提示词');
    }
  }
  // group-level duration limits (a provider call is one group, not one shot)
  for (const grp of generateGroups(board)) {
    const lim = LIMITS[grp.provider];
    if (!lim) continue;
    const raw = Math.ceil(grp.sum - 0.05);
    if (raw > lim.max) errors.push(`${grp.shots.join('+')}: 一次生成 ${raw}s，超过 ${grp.provider} 上限 ${lim.max}s，请拆成多次`);
  }
  if (board.hooks !== undefined) {
    if (!Array.isArray(board.hooks) || board.hooks.length > MAX_HOOKS) errors.push(`钩子最多 ${MAX_HOOKS} 条`);
    else board.hooks.forEach((h, i) => { if (!text(h?.id) || !text(h?.text).trim() || text(h.text).length > 400) errors.push(`第 ${i + 1} 条钩子需要 id 和 400 字以内的文本`); });
  }
  if (board.budget?.limit !== undefined && !(num(board.budget.limit) && board.budget.limit >= 0)) errors.push('预算上限必须是非负数');
  return { ok: errors.length === 0, errors };
}

/**
 * Fills every derived field (cost, totals, status) from the authoritative parts of the board. Call it
 * after any edit; whatever cost/total the client sent is discarded.
 */
export function normalizeBoard(input) {
  const board = JSON.parse(JSON.stringify(input));
  board.version = BOARD_VERSION;
  board.aspect = board.aspect || '9:16';
  board.shots = (board.shots || []).map(s => ({ ...s, status: STATUSES.includes(s.status) ? s.status : 'draft' }));
  board.total = board.shots.length ? Math.max(...board.shots.map(s => s.end || 0)) : 0;
  const est = estimateCost(board);
  board.shots.forEach(s => { s.cost = est.byShot[s.id] || { seconds: 0, unitPrice: 0, estimate: 0 }; });
  board.estimate = { total: est.total, unknown: est.unknown, calls: est.calls };
  const limit = board.budget?.limit;
  board.overBudget = num(limit) ? est.total > limit : false;
  return board;
}

/* ───────── adapters: every entry point produces the same board ───────── */

const pad = n => String(n).padStart(2, '0');
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Reference-video entry: director output → board. All shots default to H3 generation, grouped per segment. */
export function fromDirector(job, { provider = 'h3', resolution = '768P' } = {}) {
  const d = job.director;
  if (!d?.shots?.length || !job.shots?.length) throw new Error('任务还没有导演拆解结果');
  const segOf = new Map();
  for (const seg of d.segments || []) for (const idx of seg.shots) segOf.set(idx, seg.index);
  const shots = job.shots.map((s, i) => {
    const rec = d.shots[i] || {};
    return {
      id: `S${pad(s.index ?? i + 1)}`,
      start: s.start, end: s.end, line: null, text: '',
      visual: clip(`${rec.subject || ''}：${rec.action || ''}`, 160),
      prompt: clip(rec.h3_en || rec.prompt_en || '', 1200),
      source: { kind: 'generate' },
      generate: { provider, resolution, group: segOf.get(s.index) ?? null },
      status: 'draft',
    };
  });
  return normalizeBoard({ version: BOARD_VERSION, title: clip(job.meta?.title, 60) || job.id, from: { kind: 'director', job: job.id }, shots });
}

/** Imports the research `shots.json` format (reuse = existing clip, h3_new = paid, client = supplied). */
export function fromLegacyShotsJson(obj) {
  const map = s => {
    const base = { id: s.id, start: s.start, end: s.end, line: s.line ?? null, text: s.text || '', visual: s.visual || '', prompt: s.prompt || '', status: 'draft' };
    if (s.source === 'h3') return { ...base, source: { kind: 'reuse', file: s.clip, in: s.in ?? 0, lipsync: true } };
    if (s.source === 'still') return { ...base, source: { kind: 'still', image: s.image, overlay: s.overlay, productOverlay: !!s.product_overlay, character: !!s.character } };
    if (s.source === 'client') return { ...base, source: { kind: 'client', image: s.image } };
    if (s.source === 'h3_new') return { ...base, prompt: base.prompt || base.visual, source: { kind: 'generate' }, generate: { provider: 'h3', resolution: '768P', group: s.id } };
    throw new Error(`未知来源：${s.source}`);
  };
  return normalizeBoard({ version: BOARD_VERSION, title: obj.title || '', from: { kind: 'legacy' }, shots: (obj.shots || []).map(map) });
}

/* ───────── storage ───────── */

export const boardFile = job => path.join(jobDir(job.id), 'board.json');

export async function loadBoard(job) {
  try { return JSON.parse(await readFile(boardFile(job), 'utf8')); } catch { return null; }
}

/**
 * Validates, normalizes, writes atomically, and keeps a small summary on the job. Throws on invalid input.
 * `qc` verdicts (`trustQc`), hook voices (`trustHooks`) and the generation ledger (`trustGenerate`) are written only by their server-side runs; for every
 * other caller they are taken from the stored board, so a client can neither forge nor clear them.
 */
export async function saveBoard(job, input, { trustQc = false, trustHooks = false, trustGenerate = false } = {}) {
  const board = normalizeBoard(input);
  if (!trustQc || !trustHooks || !trustGenerate) {
    const stored = await loadBoard(job);
    if (!trustGenerate) {
      // the generation ledger (task state, task id) is server-made: a client can neither forge nor erase it
      const prev = new Map((stored?.shots || []).map(s => [s.id, s.generate?.task]));
      for (const s of board.shots) if (s.generate) { if (prev.get(s.id)) s.generate.task = prev.get(s.id); else delete s.generate.task; }
    }
    if (!trustQc) {
      const prev = new Map((stored?.shots || []).map(s => [s.id, s.qc]));
      for (const s of board.shots) { if (prev.get(s.id)) s.qc = prev.get(s.id); else delete s.qc; }
    }
    if (!trustHooks && Array.isArray(board.hooks)) {
      // a hook's voice file is server-made: keep it only while the text is unchanged, never accept it from the client
      const prev = new Map((stored?.hooks || []).map(h => [h.id, h]));
      board.hooks = board.hooks.map(h => {
        const old = prev.get(h.id);
        const { voice, ...rest } = h;
        return old?.voice && old.text === h.text ? { ...rest, voice: old.voice } : rest;
      });
    }
  }
  const { ok, errors } = validateBoard(board);
  if (!ok) { const e = new Error(errors.join('；')); e.errors = errors; throw e; }
  const file = boardFile(job);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(board, null, 2));
  await rename(tmp, file);
  job.board = { version: board.version, shots: board.shots.length, total: board.total, estimate: board.estimate.total, approved: board.shots.filter(s => s.status === 'approved' || s.status === 'done').length };
  await saveJob(job);
  return board;
}
