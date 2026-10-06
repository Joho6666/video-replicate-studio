// Job-level operations on a board, kept out of server.mjs so they can be tested without HTTP.
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fromDirector, loadBoard, saveBoard } from './board.mjs';
import { defaultExportRoot, exportToFactory } from './export-factory.mjs';
import { planGenerate, submitGenerate } from './generate.mjs';
import { generateHookVoices, runHookWriter } from './hooks.mjs';
import { generateStill } from './images.mjs';
import { createJob, jobDir, saveJob } from './jobs.mjs';
import { runQc, yieldStats } from './qc.mjs';
import { lintPrompt, retryPrompt } from './promptlint.mjs';
import { tools } from './env.mjs';
import { ffrun } from './media.mjs';
import { renderAnimatic } from './render.mjs';
import { generateVoiceover, loadVoiceManifest, planVoiceover, voiceIdOf } from './voiceover.mjs';
import { matchPlan, matchVoice } from './voicematch.mjs';
import { runScriptSplit } from './script.mjs';

export const MAX_STILLS_PER_CALL = 12;
const filling = new Set(); // one still-generation run per job at a time: every image is billed

const httpError = (status, message) => Object.assign(new Error(message), { status });

export async function createScriptJob({ text, title = '', brief = {} }) {
  const body = String(text || '').trim();
  if (!body) throw httpError(400, '请粘贴脚本');
  if (body.length > 20_000) throw httpError(413, '脚本过长（上限 20000 字）');
  const job = await createJob({ source: { platform: 'script', url: null, input: String(title).slice(0, 120) }, brief });
  job.status = 'draft';
  job.script = { text: body, title: String(title).slice(0, 120) };
  job.meta = { title: String(title).slice(0, 120) || body.split(/\r?\n/)[0].slice(0, 40), platformLabel: '脚本', engine: '脚本' };
  await saveJob(job);
  return job;
}

/** The presenter / product reference photos are the job's `model` / first `product` assets. */
export function referencesOf(job) {
  return {
    presenter: job.assets?.find(a => a.role === 'model')?.file || null,
    product: job.assets?.find(a => a.role === 'product')?.file || null,
  };
}

export async function splitJob(job, { split = runScriptSplit } = {}) {
  if (!job.script?.text) throw httpError(400, '这不是脚本任务');
  const refs = referencesOf(job);
  const { board, notes, usage } = await split(job, { presenter: refs.presenter ? { image: refs.presenter } : null, product: refs.product ? { image: refs.product } : null });
  const saved = await saveBoard(job, board);
  return { board: saved, notes, usage };
}

export async function boardFromDirectorJob(job) {
  const refs = referencesOf(job);
  const board = fromDirector(job);
  if (refs.presenter) board.presenter = { image: refs.presenter };
  if (refs.product) board.product = { image: refs.product };
  return saveBoard(job, board);
}

/** Shots that are stills, have a prompt and no image on disk yet (or all with `again`). Pure. */
export function pendingStills(board, root, { ids = null, again = false } = {}) {
  return board.shots.filter(s => s.source?.kind === 'still' && !s.source.useProductImage && s.prompt && (!ids || ids.includes(s.id))
    && (again || !s.source.image || !existsSync(path.join(root, s.source.image))));
}

/**
 * Generates the missing stills one by one (never in parallel, never retried). The caller must echo
 * how many images it expects to be generated, so a stale page cannot trigger a larger bill.
 */
export async function fillStills(job, { ids = null, again = false, expect, gen = generateStill } = {}) {
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  const root = jobDir(job.id);
  const todo = pendingStills(board, root, { ids, again });
  if (!todo.length) return { generated: [], failed: [], remaining: 0 };
  if (!Number.isInteger(expect) || expect !== todo.length) throw httpError(409, `需要生成 ${todo.length} 张，页面上确认的是 ${expect ?? '未确认'} 张，请刷新后重试`);
  if (todo.length > MAX_STILLS_PER_CALL) throw httpError(400, `一次最多生成 ${MAX_STILLS_PER_CALL} 张，请分批`);
  if (filling.has(job.id)) throw httpError(409, '这个任务正在生成分镜图');
  filling.add(job.id);
  const generated = [], failed = [];
  try {
    const ref = board.presenter?.image && existsSync(path.join(root, board.presenter.image)) ? path.join(root, board.presenter.image) : null;
    for (const shot of todo) {
      const rel = `board/${shot.id}.jpg`;
      try {
        await gen({ prompt: shot.prompt, referenceFile: ref, character: !!shot.source.character, out: path.join(root, rel) });
        const current = (await loadBoard(job)) || board; // re-read: earlier iterations already saved
        const target = current.shots.find(s => s.id === shot.id);
        target.source.image = rel;
        delete target.qc; // a new picture has not been checked yet
        if (target.status === 'failed') target.status = 'draft';
        await saveBoard(job, current, { trustQc: true });
        generated.push(shot.id);
      } catch (e) { failed.push({ id: shot.id, error: e.message }); }
    }
  } finally { filling.delete(job.id); }
  return { generated, failed, remaining: failed.length };
}

export async function renderJob(job) {
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  const result = await renderAnimatic(job, board);
  board.render = { ...result, at: new Date().toISOString() };
  await saveBoard(job, board);
  return result;
}

/** Shot-level QC. Free ffmpeg checks plus one cheap vision call per shot; never submits anything paid. */
export async function qcJob(job, { ids = null, again = false } = {}) {
  return runQc(job, { ids, again });
}

/**
 * Export to a NEW short-video-factory project folder under the export root. The caller names the folder,
 * not a path, so the HTTP API can never write outside it or into an existing project.
 */
export async function exportJob(job, { name, variants = 6, allowNumbers = [], music = [], hookVariants = true } = {}) {
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  const folder = String(name || `ai_${job.id}`).trim();
  if (!/^[\w一-龥-]{1,60}$/.test(folder)) throw httpError(400, '目录名只能用字母、数字、中文、下划线和连字符');
  if (!Array.isArray(music) || music.length > 5) throw httpError(400, '配乐最多 5 个文件');
  const nums = (Array.isArray(allowNumbers) ? allowNumbers : []).map(String).filter(x => /^\d{1,6}$/.test(x)).slice(0, 30);
  return exportToFactory(job, board, { outDir: path.join(defaultExportRoot(), folder), variants: Number(variants), allowNumbers: nums, music: music.map(String), hookVariants });
}

/**
 * Hook variants. `write` asks DeepSeek for alternative opening lines (replaces the current set);
 * `voice` voices the pending ones with MOSI (billed per character, so it needs `confirm` and an exact `count`).
 */
export async function hooksJob(job, { action, count, confirm, ids, again, replace, write = runHookWriter, voice = generateHookVoices } = {}) {
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  if (action === 'write') {
    if ((board.hooks || []).some(h => h.voice) && replace !== true) throw httpError(409, '已有配好音的钩子，重写会替换它们（已花的配音费不会退）。确认后再试');
    const r = await write(job, board, { count: Number(count) || 5 });
    board.hooks = r.hooks;
    await saveBoard(job, board, { trustHooks: true });
    return { hooks: r.hooks, rejected: r.rejected, slot: r.slot, usage: r.usage };
  }
  if (action === 'voice') {
    if (confirm !== true) throw httpError(400, '需要先在页面上确认条数和字数');
    return voice(job, { ids: Array.isArray(ids) ? ids.map(String) : null, again: Boolean(again), expect: count });
  }
  throw httpError(400, 'action 只能是 write 或 voice');
}

/**
 * Paid generation from the board. `plan` is free and returns what a submit would send and cost;
 * `submit` needs `confirm` and the exact `expect` ({ calls, total }) the page showed.
 */
export async function generateJob(job, { action, ids, again, confirm, expect, submit = submitGenerate } = {}) {
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  const list = Array.isArray(ids) ? ids.map(String) : null;
  if (action === 'plan') { const p = planGenerate(board, { ids: list, again: Boolean(again) }); return { calls: p.pending.length, total: p.total, pending: p.pending, blocked: p.blocked }; }
  if (action === 'submit') {
    if (confirm !== true) throw httpError(400, '需要先在页面上确认次数和费用');
    return submit(job, { ids: list, again: Boolean(again), expect });
  }
  throw httpError(400, 'action 只能是 plan 或 submit');
}

/**
 * Whole-script voice-over. `plan` is free and says how many lines / characters would be billed;
 * `generate` needs `confirm` and the exact `expect` ({ lines, chars }) the page showed.
 */
export async function voiceoverJob(job, { action, ids, again, confirm, expect, generate = generateVoiceover } = {}) {
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  const list = Array.isArray(ids) ? ids.map(String) : null;
  if (action === 'plan') {
    const voiceId = voiceIdOf(job, board);
    const p = planVoiceover(board, await loadVoiceManifest(job), { voiceId, ids: list, again: Boolean(again) });
    return { voiceId, total: p.total, lines: p.lines.length, chars: p.chars, language: p.language, pending: p.lines.map(s => s.id) };
  }
  if (action === 'generate') {
    if (confirm !== true) throw httpError(400, '需要先在页面上确认句数和字数');
    return generate(job, { ids: list, again: Boolean(again), expect });
  }
  throw httpError(400, 'action 只能是 plan 或 generate');
}

/* ───────── real product photo as a still (free, no AI) ───────── */

/** 9:16 still from the product photo: blurred copy as background, the photo itself centred and uncropped. */
export async function makeProductStill(productFile, out, ffmpeg = a => ffrun(tools.ffmpeg, a)) {
  await mkdir(path.dirname(out), { recursive: true });
  await ffmpeg(['-hide_banner', '-y', '-i', productFile, '-filter_complex',
    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:10,eq=brightness=-0.06[bg];[0:v]scale=960:1500:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2',
    '-frames:v', '1', '-q:v', '3', out]);
  return out;
}

/** Fills every shot marked `useProductImage` from the board's product photo. Free; returns the shot ids it made. */
export async function fillProductStills(job, { make = makeProductStill } = {}) {
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  const root = jobDir(job.id);
  const todo = board.shots.filter(s => s.source?.useProductImage && !(s.source.image && existsSync(path.join(root, s.source.image))));
  if (!todo.length) return [];
  const productRel = board.product?.image;
  if (!productRel || !existsSync(path.join(root, productRel))) throw httpError(400, '这张镜头表没有产品图，先上传产品图');
  const made = [];
  for (const shot of todo) {
    const rel = `board/${shot.id}.jpg`;
    await make(path.join(root, productRel), path.join(root, rel));
    const current = await loadBoard(job);
    const target = current.shots.find(s => s.id === shot.id);
    target.source.image = rel;
    delete target.qc;
    await saveBoard(job, current, { trustQc: true });
    made.push(shot.id);
  }
  return made;
}

/* ───────── pictures that fix themselves (cheap: a few cents per image) ───────── */

export const MAX_AUTO_RETRIES = 2;
export const MAX_AUTO_IMAGES = 24; // hard cap on images one auto run may generate, whatever the board says
const AUTO_BUSY = new Set();

/** Stills that need a picture, plus (with `fixFailed`) stills whose picture failed QC. Pure. */
export function autoTargets(board, root, { ids = null, fixFailed = true } = {}) {
  const missing = pendingStills(board, root, { ids });
  const failed = fixFailed ? board.shots.filter(s => s.source?.kind === 'still' && !s.source.useProductImage && s.prompt && s.qc?.verdict === 'FAIL' && (!ids || ids.includes(s.id)) && !missing.includes(s)) : [];
  return [...missing, ...failed];
}

/**
 * Generate → check → regenerate only what failed, at most `maxRetries` more times (retry prompts drop negations
 * and add a positive composition hint). The caller echoes { shots, max }: how many pictures need work and the most
 * images this run may produce — both recomputed here, so a stale page cannot trigger a larger bill.
 */
export async function autoStillsJob(job, { ids = null, maxRetries = MAX_AUTO_RETRIES, fixFailed = true, expect, gen = generateStill, check = runQc, qcOpts = {}, make = makeProductStill } = {}) {
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > MAX_AUTO_RETRIES) throw httpError(400, `重试最多 ${MAX_AUTO_RETRIES} 轮`);
  const root = jobDir(job.id);
  const targets = autoTargets(board, root, { ids, fixFailed });
  const max = targets.length * (1 + maxRetries);
  if (!targets.length) return { rounds: [], passed: [], stillFailing: [], images: 0, productStills: await fillProductStills(job, { make }) };
  if (!expect || expect.shots !== targets.length || expect.max !== max) throw httpError(409, `需要处理 ${targets.length} 张、最多生成 ${max} 张，页面上确认的是 ${expect ? `${expect.shots} 张、最多 ${expect.max} 张` : '未确认'}，请刷新后重试`);
  if (max > MAX_AUTO_IMAGES) throw httpError(400, `一次最多生成 ${MAX_AUTO_IMAGES} 张，请分批`);
  if (AUTO_BUSY.has(job.id)) throw httpError(409, '这个任务正在自动补救分镜图');
  AUTO_BUSY.add(job.id);
  const rounds = [];
  let images = 0, todo = targets.map(s => s.id);
  const passed = [];
  try {
    const productStills = await fillProductStills(job, { make });
    const failedBefore = targets.filter(s => s.qc?.verdict === 'FAIL').map(s => s.id);
    if (failedBefore.length) { // these already failed once: do not repeat the same prompt
      const current = await loadBoard(job);
      for (const s of current.shots) if (failedBefore.includes(s.id)) s.prompt = retryPrompt(s.prompt, 1);
      await saveBoard(job, current);
    }
    for (let attempt = 0; attempt <= maxRetries && todo.length; attempt++) {
      if (attempt > 0) { // retry: positive-only prompt, saved on the board so the page shows what was really used
        const current = await loadBoard(job);
        for (const s of current.shots) if (todo.includes(s.id)) s.prompt = retryPrompt(s.prompt, attempt);
        await saveBoard(job, current);
      }
      const r = await fillStills(job, { ids: todo, again: true, expect: todo.length, gen });
      images += r.generated.length;
      const verdicts = await check(job, { ids: r.generated, again: true, ...qcOpts });
      const ok = new Set(verdicts.checked.filter(c => c.verdict !== 'FAIL').map(c => c.id));
      passed.push(...[...ok]);
      rounds.push({ attempt, generated: r.generated, failedToGenerate: r.failed, passed: [...ok] });
      todo = todo.filter(id => !ok.has(id));
      if (r.failed.length && !r.generated.length) break; // the image service is failing: do not burn the rest
    }
    return { rounds, passed, stillFailing: todo, images, productStills };
  } finally { AUTO_BUSY.delete(job.id); }
}

/** Free preview for the page: what an auto run would work on and the most it could generate. */
export async function autoStillsPlan(job, { ids = null, maxRetries = MAX_AUTO_RETRIES, fixFailed = true } = {}) {
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  const targets = autoTargets(board, jobDir(job.id), { ids, fixFailed });
  return { shots: targets.length, max: targets.length * (1 + maxRetries), maxRetries, ids: targets.map(s => s.id), productStills: board.shots.filter(s => s.source?.useProductImage && !s.source.image).length };
}

export const yieldOf = async job => yieldStats(await loadBoard(job));

/** The board as the page sees it: stored data plus view-only fields (prompt warnings, yield statistics). */
export function boardView(board) {
  return { ...board, shots: board.shots.map(s => ({ ...s, lint: lintPrompt(s.prompt) })), yield: yieldStats(board) };
}

/** `plan` is free; `run` needs `confirm` and the exact { shots, max } the page showed. */
export async function autoStillsAction(job, { action, ids, maxRetries, confirm, expect, run = autoStillsJob } = {}) {
  const list = Array.isArray(ids) ? ids.map(String) : null;
  const retries = maxRetries === undefined ? MAX_AUTO_RETRIES : Number(maxRetries);
  if (action === 'plan') return autoStillsPlan(job, { ids: list, maxRetries: retries });
  if (action === 'run') {
    if (confirm !== true) throw httpError(400, '需要先在页面上确认张数');
    return run(job, { ids: list, maxRetries: retries, expect });
  }
  throw httpError(400, 'action 只能是 plan 或 run');
}

/**
 * Smart voice matching. `plan` is free (who would be auditioned, what it costs); `run` needs `confirm` and the exact
 * { voices, chars } the page showed. Voice clones are only auditioned with `includeClones`.
 */
export async function voicematchJob(job, { action, includeClones = false, apply = true, confirm, expect, run = matchVoice } = {}) {
  if (action === 'plan') return matchPlan(job, { includeClones: includeClones === true });
  if (action === 'run') {
    if (confirm !== true) throw httpError(400, '需要先在页面上确认试听的音色数和字数');
    return run(job, { includeClones: includeClones === true, apply: apply !== false, expect });
  }
  throw httpError(400, 'action 只能是 plan 或 run');
}
