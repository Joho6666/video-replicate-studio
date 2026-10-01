// Job-level operations on a board, kept out of server.mjs so they can be tested without HTTP.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fromDirector, loadBoard, saveBoard } from './board.mjs';
import { generateStill } from './images.mjs';
import { createJob, jobDir, saveJob } from './jobs.mjs';
import { renderAnimatic } from './render.mjs';
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
  return board.shots.filter(s => s.source?.kind === 'still' && s.prompt && (!ids || ids.includes(s.id))
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
        await saveBoard(job, current);
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
