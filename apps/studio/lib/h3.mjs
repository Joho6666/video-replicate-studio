// MiniMax H3 (Video Generation V2): prompt compilation, a submit-once ledger and background polling.
// Protocol as verified on 2026-09-29 against api.minimaxi.com with a pay-as-you-go key:
//   POST /v2/video_generation  { model: "MiniMax-H3", content: [{ type: "text", text }], duration, resolution, ratio } → { task_id }
//   GET  /v2/query/video_generation/:id → { task: { status: running|succeeded|failed, content: { url } } }
// Plan-type keys (sk-cp-…) are rejected with 402 / 1008 "insufficient balance" even after a top-up.
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './env.mjs';
import { jobDir, listJobs, loadJob, log, saveJob } from './jobs.mjs';
import { compareClip } from './media.mjs';
import { refMap } from './refs.mjs';

export const H3_MIN_SEC = 4;
export const H3_MAX_SEC = 15;
export const H3_RESOLUTIONS = ['768P', '2K'];
const POLL_MS = 15_000;
const POLL_LIMIT_MS = 60 * 60_000;

/** "00:03.500" — the time format the H3 prompt guide uses for cut moments. */
export const h3Time = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(3).padStart(6, '0')}`;
// "A view…" / "Her hand…" read on after "cut to"; acronyms such as "POV" keep their case.
const lcFirst = s => s.replace(/^([A-Z])(?=[a-z]|\s)/, c => c.toLowerCase());
const sentence = s => (/[.!?]["')\]]?$/.test(s) ? s : `${s}.`);
export const h3Duration = seconds => Math.min(H3_MAX_SEC, Math.max(H3_MIN_SEC, Math.ceil(seconds - 0.05)));

/**
 * One H3 T2VA prompt per generation segment, compiled deterministically from the director's
 * per-shot h3_en records: every real cut (detected or found in the evidence strip) becomes a
 * numbered [Shot n] at its segment-relative time; long-take beats continue the same shot.
 */
export function compileH3(job) {
  const d = job.director;
  if (!d?.shots?.length) return [];
  const byIndex = new Map(job.shots.map((s, i) => [s.index, { shot: s, rec: d.shots[i] || {} }]));
  return d.segments.map(seg => {
    let n = 0;
    const parts = [];
    for (const idx of seg.shots) {
      const { shot, rec } = byIndex.get(idx) || {};
      if (!shot) continue;
      // h3_after_cut_en is the current field; a " || " split inside h3_en is the 0.3 draft format.
      const [first, inline] = String(rec.h3_en || '').split('||').map(x => x.trim());
      const before = sentence(first);
      const after = typeof rec.h3_after_cut_en === 'string' && rec.h3_after_cut_en.trim() ? sentence(rec.h3_after_cut_en.trim()) : inline ? sentence(inline) : '';
      const rel = shot.start - seg.start;
      if (!parts.length) parts.push(`[Shot ${++n}] ${before}`);
      else if (shot.cut === 'beat') parts.push(`At ${h3Time(rel)}, the same shot continues: ${lcFirst(before)}`);
      else parts.push(`[Shot ${++n}] At ${h3Time(rel)}, cut to ${lcFirst(before)}`);
      if (after && typeof rec.hidden_cut_at === 'number') parts.push(`[Shot ${++n}] At ${h3Time(rec.hidden_cut_at - seg.start)}, cut to ${lcFirst(after)}`);
    }
    const text = `integrated_multimodal_description: ${parts.join(' ')}\n\noverall_soundscape: N/A\n\nnon_diegetic_music: N/A`;
    return { index: seg.index, start: seg.start, end: seg.end, duration: seg.duration, shots: n, target: h3Duration(seg.duration), text };
  });
}

export function h3Markdown(job) {
  const list = compileH3(job);
  const lines = [
    `# MiniMax H3 提示词 · ${job.meta.title?.split('\n')[0]?.slice(0, 40) || job.id}`, '',
    `来源：${job.meta.platformLabel || ''} ${job.source.url || ''}`,
    `模型：MiniMax-H3 文生视频（T2VA）· 每段 ≤${H3_MAX_SEC}s，单次时长只能是 ${H3_MIN_SEC}–${H3_MAX_SEC} 的整数秒`,
    '',
    '> `N/A` 表示声音没有核听，不代表静音；H3 会自己生成一条音轨。商用请换成有授权的配乐，不要用原片音乐。',
    '',
  ];
  for (const s of list) {
    lines.push(`## 第 ${s.index} 段 · 原片 ${h3Time(s.start)}–${h3Time(s.end)}（${s.duration}s → 生成 ${s.target}s · ${s.shots} 个镜头）`, '', '```text', s.text, '```', '');
  }
  return lines.join('\n');
}

/* ───────── ledger ───────── */

const segDir = (job, index) => path.join(jobDir(job.id), 'h3', `seg-${index}`);
const ledgerFile = (job, index) => path.join(segDir(job, index), 'task.json');
const rel = (job, file) => path.relative(jobDir(job.id), file).split(path.sep).join('/');

async function record(job, index, patch) {
  const file = ledgerFile(job, index);
  await mkdir(path.dirname(file), { recursive: true });
  const prev = job.h3?.[index] || {};
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2));
  await rename(tmp, file);
  job.h3 = { ...(job.h3 || {}), [index]: next };
  await saveJob(job);
  return next;
}

const BLOCKING = { submitting: '正在提交', submitted: '已提交、正在生成', unknown: '提交结果不明（可能已扣费）' };
const mime = f => ({ '.png': 'image/png', '.webp': 'image/webp' }[path.extname(f).toLowerCase()] || 'image/jpeg');
const apiError = body => body?.error?.message || body?.base_resp?.status_msg || '';

/**
 * Submits one paid H3 generation for a segment. Never resubmits a segment whose previous submission
 * is pending or of unknown outcome; a finished take is replaced only with `again`.
 */
export async function submitH3(job, index, { resolution = '768P', withRefs = false, again = false, expectSeconds } = {}) {
  if (!config.minimax.key) throw Object.assign(new Error('MiniMax API Key 未配置（在 apps/studio/.env.local 写 MINIMAX_API_KEY=，需按量付费的 Key）'), { status: 400 });
  if (!H3_RESOLUTIONS.includes(resolution)) throw Object.assign(new Error('分辨率只能是 768P 或 2K'), { status: 400 });
  const seg = compileH3(job).find(s => s.index === index);
  if (!seg) throw Object.assign(new Error('没有这一段，或导演提示词还没生成'), { status: 400 });
  if (expectSeconds !== undefined && expectSeconds !== seg.target) throw Object.assign(new Error('确认之后提示词已重新编译，时长变了，请刷新后重新确认'), { status: 409 });
  const prev = job.h3?.[index];
  if (prev && BLOCKING[prev.state]) throw Object.assign(new Error(`第 ${index} 段${BLOCKING[prev.state]}（任务号 ${prev.taskId || '无'}），不会重复提交`), { status: 409 });
  if (prev && ['succeeded', 'failed'].includes(prev.state) && !again) throw Object.assign(new Error(`第 ${index} 段已有结果，如需重新生成请确认再来一次`), { status: 409 });

  const content = [{ type: 'text', text: seg.text }];
  const refs = withRefs ? refMap(job.assets).filter(r => r.file && ['@Image1', '@Image2'].includes(r.token)) : [];
  for (const r of refs) {
    const data = await readFile(path.join(jobDir(job.id), r.file));
    content.push({ type: 'image_url', image_url: { url: `data:${mime(r.file)};base64,${data.toString('base64')}` }, role: 'reference_image' });
  }
  const body = { model: config.minimax.model, content, duration: seg.target, resolution, ratio: job.media.orientation === 'landscape' ? '16:9' : job.media.orientation === 'square' ? '1:1' : '9:16' };
  const history = prev ? [...(prev.history || []), { ...prev, history: undefined }] : [];
  // The ledger is written before the request so a crash mid-call can never lead to a silent resubmit.
  await record(job, index, { state: 'submitting', taskId: null, error: null, video: null, compare: null, submittedAt: new Date().toISOString(),
    request: { duration: seg.target, resolution, ratio: body.ratio, refs: refs.map(r => r.token), prompt: seg.text }, history });
  log(job, `MiniMax H3 提交第 ${index} 段（${seg.target}s · ${resolution}${refs.length ? ` · 附 ${refs.map(r => r.token).join('/')}` : ''}）`);

  let res, json;
  try {
    res = await fetch(`${config.minimax.base}/v2/video_generation`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.minimax.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
    });
    json = await res.json().catch(() => ({}));
  } catch (error) {
    await record(job, index, { state: 'unknown', error: `提交请求没有拿到响应（${error.message}），可能已创建任务，请到 MiniMax 控制台核对` });
    log(job, `第 ${index} 段提交结果不明：${error.message}`, 'error');
    throw Object.assign(new Error('提交结果不明，已停止，不会自动重试；请到 MiniMax 控制台核对是否已生成'), { status: 502 });
  }
  const taskId = json.task_id || json.id;
  if (res.ok && taskId) {
    const entry = await record(job, index, { state: 'submitted', taskId: String(taskId) });
    log(job, `第 ${index} 段已提交，任务号 ${taskId}，后台生成中`);
    watch(job.id, index);
    return entry;
  }
  // A 4xx without a task id means MiniMax refused the request: nothing was created, retry is safe.
  const refused = res.status >= 400 && res.status < 500 && !taskId;
  const message = `MiniMax HTTP ${res.status}：${apiError(json) || '无任务号'}${res.status === 402 ? '（余额不足；套餐类 sk-cp Key 不能用于 H3，需要按量付费的 Key）' : ''}`;
  await record(job, index, { state: refused ? 'rejected' : 'unknown', error: message });
  log(job, `第 ${index} 段提交失败：${message}`, 'error');
  throw Object.assign(new Error(message), { status: refused ? 400 : 502 });
}

/* ───────── polling ───────── */

const watching = new Set();

async function download(url, out) {
  const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok || !res.body) throw new Error(`下载成片 HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
}

async function pollOnce(job, index) {
  const entry = job.h3?.[index];
  if (entry?.state !== 'submitted') return true;
  const res = await fetch(`${config.minimax.base}/v2/query/video_generation/${encodeURIComponent(entry.taskId)}`, {
    headers: { Authorization: `Bearer ${config.minimax.key}` }, signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => ({}));
  const task = json.task || json;
  const status = String(task.status || '');
  if (/succe/i.test(status)) {
    const url = task.content?.url || task.content?.video_url;
    if (!url) throw new Error('任务成功但没有返回视频地址');
    const dir = segDir(job, index);
    const video = path.join(dir, 'h3.mp4');
    await download(url, video);
    const seg = job.director.segments.find(s => s.index === index);
    let compare = null;
    try { compare = rel(job, await compareClip(path.join(jobDir(job.id), job.media.video), seg.start, seg.duration, video, path.join(dir, 'compare.mp4'))); }
    catch (error) { log(job, `对照视频生成失败：${error.message}`, 'warn'); }
    await record(job, index, { state: 'succeeded', video: rel(job, video), compare, finishedAt: new Date().toISOString(), usage: task.usage || null });
    log(job, `第 ${index} 段 H3 成片已下载${compare ? '，对照视频已生成' : ''}`);
    return true;
  }
  if (/fail|cancel|error/i.test(status) || (res.status >= 400 && res.status < 500)) {
    await record(job, index, { state: 'failed', error: `MiniMax 任务失败：${apiError(json) || task.error_message || status || `HTTP ${res.status}`}`, finishedAt: new Date().toISOString() });
    log(job, `第 ${index} 段 H3 生成失败`, 'error');
    return true;
  }
  return false;
}

/** Background poll loop for one submitted segment; querying is free, so transient errors just wait. */
export function watch(jobId, index) {
  const key = `${jobId}#${index}`;
  if (watching.has(key)) return;
  watching.add(key);
  const started = Date.now();
  const tick = async () => {
    try {
      const job = await loadJob(jobId);
      if (await pollOnce(job, index)) return void watching.delete(key);
    } catch (error) {
      if (!/ENOENT/.test(error.message)) console.warn(`H3 轮询 ${key}：${error.message}`);
      else return void watching.delete(key);
    }
    if (Date.now() - started > POLL_LIMIT_MS) return void watching.delete(key); // resumes on next restart
    setTimeout(tick, POLL_MS).unref();
  };
  setTimeout(tick, 5_000).unref();
}

/** On start-up: keep polling submitted takes, and mark a submit interrupted by a crash as unknown. */
export async function resumeH3() {
  for (const job of await listJobs()) {
    for (const [index, entry] of Object.entries(job.h3 || {})) {
      if (entry.state === 'submitted' && config.minimax.key) watch(job.id, Number(index));
      if (entry.state === 'submitting') await record(job, Number(index), { state: 'unknown', error: '提交过程中服务中断，可能已创建任务，请到 MiniMax 控制台核对' });
    }
  }
}
