// Paid video generation straight from a board (MiniMax H3), with a submit-once ledger.
// The board is the contract: the server recomputes what is pending and what it costs, the caller must echo
// that exact number of calls and total, and nothing is sent unless it fits the budget and the hard cap.
// The ledger (`shot.generate.task`) is written BEFORE the request, so a crash or a lost response can only
// ever lead to polling or to a manual check — never to a second paid submission of the same group.
//   POST /v2/video_generation  { model, content:[{type:'text',text}], duration, resolution, ratio } → { task_id }
//   GET  /v2/query/video_generation/:id → { task: { status, content: { url } } }
import { createWriteStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PRICES, billableSeconds, generateGroups, loadBoard, saveBoard } from './board.mjs';
import { config, env } from './env.mjs';
import { cutWindow, uploadTemp } from './animate-mix.mjs';
import { jobDir, listJobs, loadJob } from './jobs.mjs';

export const MAX_CALLS_PER_REQUEST = 6;
export const maxRequestCny = () => Number(env.GENERATE_MAX_CNY) || 10; // hard cap per request, whatever the board says
const BLOCKING = { submitting: '正在提交', submitted: '已提交、还在生成', unknown: '提交结果不明（请到服务商控制台核对）', succeeded: '已经生成完成' };
const REDO_OK = new Set(['failed', 'rejected', 'succeeded']); // states a deliberate `again` may replace
const POLL_MS = 10_000;
const POLL_LIMIT_MS = 30 * 60_000;
const httpError = (status, message) => Object.assign(new Error(message), { status });
const round2 = n => Math.round(n * 100) / 100;
const safe = s => String(s).replace(/[^\w-]/g, '_');

/* ───────── plan (pure) ───────── */

/**
 * What a submit would send right now: one entry per provider call (a group of shots), with its length,
 * price and block reason if any. H3 and Wan 3.0 can be submitted here.
 */
export function planGenerate(board, { ids = null, again = false } = {}) {
  const calls = [];
  for (const grp of generateGroups(board)) {
    const shots = grp.shots.map(id => board.shots.find(s => s.id === id));
    if (ids && !shots.some(s => ids.includes(s.id))) continue;
    const task = shots[0].generate?.task;
    const seconds = billableSeconds(grp.provider, grp.sum);
    const unit = PRICES[grp.provider]?.[grp.resolution];
    const call = { provider: grp.provider, resolution: grp.resolution, shots: grp.shots, seconds, cost: Number.isFinite(unit) ? round2(seconds * unit) : null, blocked: null };
    if (!PROVIDERS[grp.provider]) call.blocked = `${grp.provider} 还没有接入`;
    else if (!PROVIDERS[grp.provider].key()) call.blocked = `${PROVIDERS[grp.provider].keyHint}`;
    else if (call.cost === null) call.blocked = `${grp.provider} ${grp.resolution} 的单价未知`;
    else if (task && BLOCKING[task.state] && !(again && REDO_OK.has(task.state))) call.blocked = `${BLOCKING[task.state]}，不会重复提交`;
    else if (!again && shots.some(s => s.source?.clip?.file)) call.blocked = '已经有视频片段';
    else if (shots.every(s => !String(s.prompt || '').trim())) call.blocked = '没有提示词';
    else if (refsOf(board, shots).some(r => !r.rel)) call.blocked = `缺少${refsOf(board, shots).find(r => !r.rel).kind === 'presenter' ? '主播 / 模特' : '产品'}参考图`;
    else if (again && !task && !shots.some(s => s.qc?.verdict === 'FAIL')) call.blocked = '没有失败记录，不需要重跑';
    calls.push(call);
  }
  const pending = calls.filter(c => !c.blocked);
  return { pending, blocked: calls.filter(c => c.blocked), total: round2(pending.reduce((n, c) => n + c.cost, 0)) };
}

export const REF_KINDS = ['presenter', 'product'];
export const MAX_REFS = 2;
const mimeOf = f => ({ '.png': 'image/png', '.webp': 'image/webp' }[path.extname(f).toLowerCase()] || 'image/jpeg');

/** Reference photos a call asks for (`generate.refs`, in order): the presenter and / or the product image of the board. */
export function refsOf(board, shots) {
  const wanted = [...new Set(shots.flatMap(s => s.generate?.refs || []))].filter(r => REF_KINDS.includes(r)).slice(0, MAX_REFS);
  return wanted.map(kind => ({ kind, rel: board[kind]?.image || null }));
}

/** data-URI reference images; throws a 400 naming what is missing, before anything is billed. */
export async function refImages(job, refs) {
  const root = jobDir(job.id);
  const out = [];
  for (const r of refs) {
    const file = r.rel && !path.isAbsolute(r.rel) ? path.join(root, r.rel) : null;
    if (!file || !existsSync(file)) throw httpError(400, `缺少${r.kind === 'presenter' ? '主播 / 模特' : '产品'}参考图，先把图放进镜头表`);
    out.push({ kind: r.kind, url: `data:${mimeOf(file)};base64,${(await readFile(file)).toString('base64')}` });
  }
  return out;
}

const promptOf = shots => (shots.length === 1 ? String(shots[0].prompt).trim() : shots.map((s, i) => `Shot ${i + 1}: ${String(s.prompt).trim()}`).join(' ')).slice(0, 2000);

/* ───────── providers: how to ask, how to read the answer ───────── */

export const PROVIDERS = {
  h3: {
    label: 'MiniMax H3',
    key: () => config.minimax.key,
    keyHint: 'MiniMax API Key 未配置（apps/studio/.env.local 的 MINIMAX_API_KEY，需按量付费的 Key）',
    request: ({ board, call, shots, images }) => ({
      url: `${config.minimax.base}/v2/video_generation`,
      headers: { Authorization: `Bearer ${config.minimax.key}`, 'Content-Type': 'application/json' },
      body: { model: config.minimax.model, content: [{ type: 'text', text: promptOf(shots) }, ...images.map(i => ({ type: 'image_url', image_url: { url: i.url }, role: 'reference_image' }))], duration: call.seconds, resolution: call.resolution, ratio: board.aspect || '9:16' },
    }),
    taskId: json => json.task_id || json.id,
    error: (res, json) => `MiniMax HTTP ${res.status}：${json?.error?.message || json?.base_resp?.status_msg || '无任务号'}${res.status === 402 ? '（余额不足；套餐类 sk-cp Key 不能用于 H3）' : ''}`,
    query: task => ({ url: `${config.minimax.base}/v2/query/video_generation/${encodeURIComponent(task.taskId)}`, headers: { Authorization: `Bearer ${config.minimax.key}` } }),
    parse: (res, json) => {
      const t = json.task || json, status = String(t.status || '');
      if (/succe/i.test(status)) return { state: 'succeeded', url: t.content?.url || t.content?.video_url, usage: t.usage || null };
      if (/fail|cancel|error/i.test(status) || (res.status >= 400 && res.status < 500)) return { state: 'failed', error: `MiniMax 任务失败：${json?.error?.message || json?.base_resp?.status_msg || t.error_message || status || `HTTP ${res.status}`}` };
      return { state: 'running' };
    },
  },
  /**
   * wan2.7-videoedit: edits the ORIGINAL video of the job (its window = the group's shots) with an instruction and up to
   * 4 reference images — e.g. "replace the woman in the video with the woman in image 1". Unlike Wan Animate it does not
   * need a frontal face, so back views, close-ups and rapid cuts work. 2–10 s per call; billed on input + output seconds.
   */
  wan27edit: {
    label: 'Wan 2.7 视频编辑',
    key: () => config.wan.key,
    keyHint: 'Wan API Key 未配置（apps/studio/.env.local 的 WAN_API_KEY，DashScope 的 Key）',
    /** Cuts the shots' window out of the job's source video and uploads it (before anything is billed or written to the ledger). */
    async prepare({ job, shots }) {
      const start = Math.min(...shots.map(s => s.start)), end = Math.max(...shots.map(s => s.end));
      if (!job.media?.video) throw httpError(400, '这个任务没有原片，视频编辑需要原片');
      const source = path.join(jobDir(job.id), job.media.video);
      if (!existsSync(source)) throw httpError(400, '原片文件不见了');
      const out = path.join(jobDir(job.id), 'edit-src', `${shots.map(s => s.id).join('+')}.mp4`);
      await cutWindow(source, { start, end }, out, { vf: 'scale=trunc(iw/2)*2:trunc(ih/2)*2' });
      return { videoUrl: await uploadTemp(out, `${job.id}-${shots[0].id}.mp4`, { model: 'wan2.7-videoedit' }), start, end };
    },
    request: ({ call, shots, images, prep }) => ({
      url: `${config.wan.base}/api/v1/services/aigc/video-generation/video-synthesis`,
      headers: { Authorization: `Bearer ${config.wan.key}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable', 'X-DashScope-OssResourceResolve': 'enable' },
      body: { model: 'wan2.7-videoedit', input: { prompt: promptOf(shots), media: [{ type: 'video', url: prep.videoUrl }, ...images.slice(0, 4).map(i => ({ type: 'reference_image', url: i.url }))] }, parameters: { resolution: call.resolution, prompt_extend: false, watermark: false, audio_setting: 'origin' } },
    }),
    taskId: json => json.output?.task_id,
    error: (res, json) => `Wan HTTP ${res.status}：${json?.message || json?.code || '无任务号'}${json?.code ? `（${json.code}）` : ''}`,
    query: task => ({ url: `${config.wan.base}/api/v1/tasks/${encodeURIComponent(task.taskId)}`, headers: { Authorization: `Bearer ${config.wan.key}` } }),
    parse: (res, json) => {
      const o = json.output || {}, status = String(o.task_status || '');
      if (status === 'SUCCEEDED') return { state: 'succeeded', url: o.video_url, usage: json.usage || null };
      if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(status) || (res.status >= 400 && res.status < 500)) return { state: 'failed', error: `Wan 任务失败：${o.message || o.code || json?.message || status || `HTTP ${res.status}`}${o.code ? `（${o.code}）` : ''}` };
      return { state: 'running' };
    },
  },
  wan3: {
    label: 'Wan 3.0',
    key: () => config.wan.key,
    keyHint: 'Wan API Key 未配置（apps/studio/.env.local 的 WAN_API_KEY，DashScope 的 Key）',
    request: ({ board, call, shots, images }) => ({
      url: `${config.wan.base}/api/v1/services/aigc/video-generation/video-synthesis`,
      headers: { Authorization: `Bearer ${config.wan.key}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
      body: { model: config.wan.model, input: { prompt: promptOf(shots), ...(images.length ? { media: images.map(i => ({ type: 'reference_image', url: i.url })) } : {}) }, parameters: { resolution: call.resolution, ratio: board.aspect || '9:16', duration: call.seconds, audio: false, prompt_extend: false, watermark: false } },
    }),
    taskId: json => json.output?.task_id,
    error: (res, json) => `Wan HTTP ${res.status}：${json?.message || json?.code || '无任务号'}${json?.code ? `（${json.code}）` : ''}`,
    query: task => ({ url: `${config.wan.base}/api/v1/tasks/${encodeURIComponent(task.taskId)}`, headers: { Authorization: `Bearer ${config.wan.key}` } }),
    parse: (res, json) => {
      const o = json.output || {}, status = String(o.task_status || '');
      if (status === 'SUCCEEDED') return { state: 'succeeded', url: o.video_url, usage: json.usage || null };
      if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(status) || (res.status >= 400 && res.status < 500)) return { state: 'failed', error: `Wan 任务失败：${o.message || o.code || json?.message || status || `HTTP ${res.status}`}${o.code ? `（${o.code}）` : ''}` };
      return { state: 'running' };
    },
  },
};

/* ───────── ledger ───────── */

const queues = new Map();
/** Serialised read-modify-write of the ledger for the shots of one call. */
function setTask(job, shotIds, patch) {
  const run = async () => {
    const board = await loadBoard(job);
    if (!board) throw new Error('镜头表不见了');
    for (const s of board.shots) if (shotIds.includes(s.id) && s.generate) s.generate.task = { ...(s.generate.task || {}), ...patch };
    return saveBoard(job, board, { trustGenerate: true });
  };
  const next = (queues.get(job.id) || Promise.resolve()).then(run, run);
  queues.set(job.id, next);
  next.finally(() => { if (queues.get(job.id) === next) queues.delete(job.id); }).catch(() => {});
  return next;
}

const submitting = new Set(); // one submit run per job at a time

/**
 * Submits the pending calls one by one. `expect` = { calls, total } is what the page showed in its
 * confirmation; any difference (stale page, edited board) aborts before anything is sent.
 */
export async function submitGenerate(job, { ids = null, again = false, expect, fetchImpl = fetch, watch: startWatch = watchGenerate } = {}) {
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  const plan = planGenerate(board, { ids, again });
  if (!plan.pending.length) throw httpError(400, plan.blocked.length ? `没有可提交的：${plan.blocked.slice(0, 3).map(c => `${c.shots.join('+')}（${c.blocked}）`).join('；')}` : '镜头表里没有付费生成的镜头');
  if (!expect || expect.calls !== plan.pending.length || expect.total !== plan.total) throw httpError(409, `现在要提交 ${plan.pending.length} 次、共 ¥${plan.total.toFixed(2)}，页面上确认的是 ${expect ? `${expect.calls} 次、¥${Number(expect.total).toFixed(2)}` : '未确认'}，请刷新后重新确认`);
  if (plan.pending.length > MAX_CALLS_PER_REQUEST) throw httpError(400, `一次最多提交 ${MAX_CALLS_PER_REQUEST} 次生成，请分批`);
  const cap = Math.min(maxRequestCny(), Number.isFinite(board.budget?.limit) && board.budget.limit > 0 ? board.budget.limit : Infinity);
  if (plan.total > cap) throw httpError(400, `预计 ¥${plan.total.toFixed(2)}，超过上限 ¥${cap.toFixed(2)}（镜头表预算或 GENERATE_MAX_CNY）`);
  for (const c of plan.pending) if (!PROVIDERS[c.provider].key()) throw httpError(400, PROVIDERS[c.provider].keyHint);
  if (submitting.has(job.id)) throw httpError(409, '这个任务正在提交生成');
  submitting.add(job.id);
  const submitted = [], failed = [];
  try {
    for (const call of plan.pending) {
      const shots = call.shots.map(id => board.shots.find(s => s.id === id));
      const provider = PROVIDERS[call.provider];
      const images = await refImages(job, refsOf(board, shots)); // may throw 400 before any ledger write
      const prep = provider.prepare ? await provider.prepare({ job, board, call, shots }) : null; // may throw 400 before any ledger write
      const req = provider.request({ board, call, shots, images, prep });
      const history = shots[0].generate?.task ? [...(shots[0].generate.task.history || []), { ...shots[0].generate.task, history: undefined }] : [];
      await setTask(job, call.shots, { state: 'submitting', taskId: null, error: null, submittedAt: new Date().toISOString(), provider: call.provider, seconds: call.seconds, cost: call.cost, history });
      let res, json;
      try {
        res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: AbortSignal.timeout(120_000) });
        json = await res.json().catch(() => ({}));
      } catch (error) {
        await setTask(job, call.shots, { state: 'unknown', error: `提交没有拿到响应（${error.message}），可能已创建任务，请到 ${provider.label} 控制台核对` });
        failed.push({ shots: call.shots, error: '提交结果不明，已停止，不会自动重试' });
        break; // never send further calls after an unknown outcome
      }
      const taskId = provider.taskId(json);
      if (res.ok && taskId) {
        await setTask(job, call.shots, { state: 'submitted', taskId: String(taskId) });
        submitted.push({ shots: call.shots, taskId: String(taskId), cost: call.cost });
        startWatch(job.id, call.shots[0]);
        continue;
      }
      const refused = res.status >= 400 && res.status < 500 && !taskId; // nothing was created: safe to retry later
      const message = provider.error(res, json);
      await setTask(job, call.shots, { state: refused ? 'rejected' : 'unknown', error: message });
      failed.push({ shots: call.shots, error: message });
      if (!refused) break;
    }
  } finally { submitting.delete(job.id); }
  return { submitted, failed, spent: round2(submitted.reduce((n, c) => n + c.cost, 0)) };
}

/* ───────── polling ───────── */

async function download(url, out) {
  const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok || !res.body) throw new Error(`下载成片 HTTP ${res.status}`);
  await mkdir(path.dirname(out), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
}

/** One poll of one call; true = nothing more to do. Querying is free. */
export async function pollGenerate(job, anchorId, { fetchImpl = fetch, fetchFile = download } = {}) {
  const board = await loadBoard(job);
  const anchor = board?.shots.find(s => s.id === anchorId);
  const task = anchor?.generate?.task;
  if (task?.state !== 'submitted') return true;
  const provider = PROVIDERS[task.provider || 'h3'];
  const q = provider.query(task);
  const res = await fetchImpl(q.url, { headers: q.headers, signal: AbortSignal.timeout(60_000) });
  const json = await res.json().catch(() => ({}));
  const t = provider.parse(res, json);
  const group = board.shots.filter(s => s.generate?.task?.taskId === task.taskId);
  const ids = group.map(s => s.id);
  if (t.state === 'succeeded') {
    const url = t.url;
    if (!url) throw new Error('任务成功但没有返回视频地址');
    const rel = `clips/gen-${safe(task.taskId)}.mp4`;
    await fetchFile(url, path.join(jobDir(job.id), rel));
    const start = Math.min(...group.map(s => s.start));
    const fresh = await loadBoard(job);
    for (const s of fresh.shots) {
      if (!ids.includes(s.id)) continue;
      s.source = { ...s.source, clip: { file: rel, in: Math.max(0, Math.round((s.start - start) * 100) / 100) } };
      delete s.qc; // a new take has not been checked yet
      if (s.status === 'failed') s.status = 'draft';
    }
    await saveBoard(job, fresh, { trustGenerate: true, trustQc: true });
    await setTask(job, ids, { state: 'succeeded', finishedAt: new Date().toISOString(), usage: t.usage });
    return true;
  }
  if (t.state === 'failed') {
    await setTask(job, ids, { state: 'failed', error: t.error, finishedAt: new Date().toISOString() });
    return true;
  }
  return false;
}

const watching = new Set();

/** Background poll loop for one submitted call; transient errors just wait, a restart resumes it. */
export function watchGenerate(jobId, anchorId) {
  const key = `${jobId}#${anchorId}`;
  if (watching.has(key)) return;
  watching.add(key);
  const started = Date.now();
  const tick = async () => {
    try {
      if (await pollGenerate(await loadJob(jobId), anchorId)) return void watching.delete(key);
    } catch (error) {
      if (/ENOENT/.test(error.message)) return void watching.delete(key);
      console.warn(`生成轮询 ${key}：${error.message}`);
    }
    if (Date.now() - started > POLL_LIMIT_MS) return void watching.delete(key);
    setTimeout(tick, POLL_MS).unref();
  };
  setTimeout(tick, 5_000).unref();
}

/** On start-up: keep polling submitted calls; a submit cut off by a crash becomes `unknown` (never resubmitted). */
export async function resumeGenerate() {
  for (const job of await listJobs()) {
    const board = await loadBoard(job).catch(() => null);
    if (!board) continue;
    const seen = new Set();
    for (const s of board.shots) {
      const task = s.generate?.task;
      if (!task || seen.has(task.taskId || s.id)) continue;
      seen.add(task.taskId || s.id);
      const group = board.shots.filter(x => x.generate?.task?.state === task.state && (task.taskId ? x.generate.task.taskId === task.taskId : x.generate.group === s.generate.group)).map(x => x.id);
      if (task.state === 'submitted' && PROVIDERS[task.provider || 'h3']?.key()) watchGenerate(job.id, s.id);
      if (task.state === 'submitting') await setTask(job, group, { state: 'unknown', error: '提交过程中服务中断，可能已创建任务，请到服务商控制台核对' });
    }
  }
}
