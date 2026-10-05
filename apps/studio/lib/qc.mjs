// Shot-level QC for generated / reused clips: PASS / WARN / FAIL per shot, so only the broken shots
// are regenerated. Free objective checks (ffmpeg) decide hard failures; the vision model may only
// *cite* a defect with a frame number and a short evidence text — a claim without a frame is dropped,
// and the verdict is computed here, never taken from the model or the client.
import { mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config, tools } from './env.mjs';
import { estimateCost, loadBoard, saveBoard } from './board.mjs';
import { jobDir } from './jobs.mjs';
import { ffrun, probe } from './media.mjs';

export const VERDICTS = ['PASS', 'WARN', 'FAIL'];
export const ISSUE_CODES = ['deformed_face_or_hands', 'text_or_logo', 'prompt_mismatch', 'identity_drift', 'third_party_ip', 'body_merge', 'unexpected_object'];
export const SEVERITIES = ['high', 'medium'];
export const FRAMES = 4;
export const MAX_QC_PER_CALL = 20;

const round1 = n => Math.round(n * 10) / 10;
const httpError = (status, message) => Object.assign(new Error(message), { status });
const within = (root, rel) => { const p = path.resolve(root, rel); return p.startsWith(path.resolve(root) + path.sep) ? p : null; };

/* ───────── which file is this shot? ───────── */

/**
 * The video file and in-point that stand for one shot, or null when there is none yet.
 * An explicit `source.clip` wins; otherwise a finished H3 segment (board group = segment index) or a reused file.
 */
export function resolveShotClip(job, shot) {
  const root = jobDir(job.id);
  const resolve = (file, inPoint) => {
    if (!file) return null;
    const abs = path.isAbsolute(file) ? file : within(root, file);
    return abs ? { file: abs, in: Math.max(0, Number(inPoint) || 0) } : null;
  };
  const src = shot.source || {};
  if (src.clip?.file) return resolve(src.clip.file, src.clip.in);
  if (src.kind === 'reuse') return resolve(src.file, src.in);
  if (src.kind === 'generate' && Number.isInteger(shot.generate?.group)) {
    const entry = job.h3?.[shot.generate.group];
    const seg = job.director?.segments?.find(s => s.index === shot.generate.group);
    if (entry?.state === 'succeeded' && entry.video) return resolve(entry.video, seg ? shot.start - seg.start : 0);
  }
  return null;
}

/** The image file of a still shot, or null. */
export function resolveShotImage(job, shot) {
  const rel = shot.source?.kind === 'still' ? shot.source.image : null;
  if (!rel || path.isAbsolute(rel)) return null;
  return within(jobDir(job.id), rel);
}

/* ───────── objective checks (free) ───────── */

/** Parses ffmpeg blackdetect / freezedetect / volumedetect output into plain facts. Pure. */
export function parseDetectors(stderr) {
  const text = String(stderr || '');
  const black = [...text.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)].map(m => ({ start: Number(m[1]), end: Number(m[2]), duration: Number(m[3]) }));
  const freezeDur = [...text.matchAll(/lavfi\.freezedetect\.freeze_duration:\s*([\d.]+)/g)].map(m => Number(m[1]));
  const freezeOpen = [...text.matchAll(/lavfi\.freezedetect\.freeze_start:\s*([\d.]+)/g)].length > freezeDur.length;
  const mean = text.match(/mean_volume:\s*(-?[\d.]+|-inf)\s*dB/);
  return { black, freeze: freezeDur, freezeOpen, meanVolume: mean ? (mean[1] === '-inf' ? -Infinity : Number(mean[1])) : null };
}

/** Facts about a still image: size, and whether it is blank (almost no tonal range). */
export async function measureImage(file) {
  let info;
  try { info = await probe(file); } catch (e) { return { info: { width: 0, height: 0, duration: 0 }, decodeError: e.message, black: [], freeze: [], freezeOpen: false, meanVolume: null }; }
  let blank = false;
  try {
    const { stdout } = await ffrun(tools.ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vf', 'scale=96:-2,signalstats,metadata=mode=print:file=-', '-frames:v', '1', '-f', 'null', '-']);
    const num = k => Number(new RegExp(String.raw`lavfi\.signalstats\.${k}=([\d.]+)`).exec(stdout)?.[1]);
    const lo = num('YLOW'), hi = num('YHIGH');
    blank = Number.isFinite(lo) && Number.isFinite(hi) && hi - lo < 14;
  } catch { /* no extra fact */ }
  return { info: { ...info, duration: 0 }, decodeError: null, black: [], freeze: [], freezeOpen: false, meanVolume: null, blank };
}

/** Measures one clip window. Everything here is a fact, none of it a verdict. */
export async function measureClip(file, { start = 0, duration = null } = {}) {
  const info = await probe(file);
  const win = duration ? ['-ss', String(start), '-t', String(duration)] : (start ? ['-ss', String(start)] : []);
  const vf = 'blackdetect=d=0.3:pix_th=0.1,freezedetect=n=-55dB:d=1.0';
  let stderr = '';
  try { ({ stderr } = await ffrun(tools.ffmpeg, ['-hide_banner', '-nostats', ...win, '-i', file, '-vf', vf, '-an', '-f', 'null', '-'])); }
  catch (e) { return { info, decodeError: e.message, ...parseDetectors('') }; }
  const detected = parseDetectors(stderr);
  let meanVolume = null;
  if (info.audioCodec) {
    try {
      const { stderr: a } = await ffrun(tools.ffmpeg, ['-hide_banner', '-nostats', ...win, '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
      meanVolume = parseDetectors(a).meanVolume;
    } catch { /* leave null: no loudness fact */ }
  }
  return { info, decodeError: null, ...detected, meanVolume };
}

/**
 * Objective checks from measured facts. Pure. `need` = seconds of picture the shot uses,
 * `portrait` = the board is 9:16, `speech` = the shot carries a spoken line.
 */
export function objectiveChecks(m, { need = 0, portrait = true, speech = false } = {}) {
  const checks = [];
  const add = (id, ok, detail, level = 'FAIL') => checks.push({ id, ok, detail, level: ok ? 'PASS' : level });
  if (m.decodeError) { add('decode', false, `无法完整解码：${m.decodeError}`); return checks; }
  add('decode', true, '可解码');
  if (m.blank) add('blank', false, '画面几乎是一片空白');
  const { width, height, duration } = m.info;
  if (portrait) add('orientation', height > width, `${width}×${height}${height > width ? '' : '，不是竖屏'}`);
  if (need > 0) add('duration', duration + 0.05 >= need, `片段 ${round1(duration)}s，镜头需要 ${round1(need)}s`);
  const blackTotal = m.black.reduce((s, b) => s + b.duration, 0);
  add('black', blackTotal < 0.5, blackTotal ? `黑屏共 ${round1(blackTotal)}s` : '无黑屏');
  const frozen = Math.max(0, ...m.freeze, m.freezeOpen ? 1 : 0);
  add('freeze', frozen < 1.5, frozen ? `画面静止约 ${round1(frozen)}s` : '无静止帧', frozen >= 3 ? 'FAIL' : 'WARN');
  if (speech && m.meanVolume !== null) add('audio', m.meanVolume > -45, `平均音量 ${m.meanVolume === -Infinity ? '静音' : `${round1(m.meanVolume)} dB`}${m.meanVolume > -45 ? '' : '，台词镜头几乎没有声音'}`);
  return checks;
}

/* ───────── vision check (cheap) ───────── */

const visionSystem = n => `You are a strict QC reviewer for AI-generated ${n > 1 ? 'short-video clips' : 'still images'}. You see ${n > 1 ? `${n} frames from one clip (numbered 1..${n}, in time order)` : 'one image (frame 1)'} and the prompt it was generated from.
Report only defects you can point at in a specific frame. Allowed codes:
- deformed_face_or_hands: distorted face, extra/missing fingers, warped hands
- text_or_logo: readable text, watermarks, brand marks or logos appear in the picture
- prompt_mismatch: the picture clearly differs from the prompt (wrong subject, action or setting)
- identity_drift: the person differs between frames or from the reference photo (only when a reference is attached)
- third_party_ip: a recognisable celebrity, film or cartoon character, or trademark character
- body_merge: limbs, objects or clothing melt into each other
- unexpected_object: an object or person that does not belong in the described scene and is not in the prompt (for example a phone in a coffee-mug scene)
severity "high" = unusable; "medium" = visible but could ship. Do not invent problems: if the picture looks fine, return an empty list.
Return JSON only: {"issues":[{"code":"…","severity":"high|medium","frame":1,"evidence":"one short sentence"}],"summary":"one short sentence"}`;

/** Drops anything without a valid code, severity, frame number and evidence. Pure. */
export function sanitizeIssues(raw, frameCount = FRAMES) {
  const kept = [], dropped = [];
  for (const i of Array.isArray(raw) ? raw : []) {
    const ok = ISSUE_CODES.includes(i?.code) && SEVERITIES.includes(i?.severity)
      && Number.isInteger(i?.frame) && i.frame >= 1 && i.frame <= frameCount
      && typeof i?.evidence === 'string' && i.evidence.trim().length >= 6;
    (ok ? kept : dropped).push(ok ? { code: i.code, severity: i.severity, frame: i.frame, evidence: i.evidence.trim().slice(0, 200) } : i);
  }
  return { kept, dropped };
}

/** Final verdict from the objective checks and the cited issues. Pure. */
export function decide(checks, issues) {
  if (checks.some(c => c.level === 'FAIL')) return 'FAIL';
  if (issues.some(i => i.severity === 'high')) return 'FAIL';
  if (checks.some(c => c.level === 'WARN') || issues.length) return 'WARN';
  return 'PASS';
}

const dataUri = async (file, mime = 'image/jpeg') => `data:${mime};base64,${(await readFile(file)).toString('base64')}`;

async function extractFrames(clip, start, duration, dir) {
  await mkdir(dir, { recursive: true });
  const files = [];
  for (let i = 0; i < FRAMES; i++) {
    const out = path.join(dir, `f${i + 1}.jpg`);
    await ffrun(tools.ffmpeg, ['-hide_banner', '-y', '-ss', String(round1(start + (duration * (i + 0.5)) / FRAMES)), '-i', clip, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', out]);
    files.push(out);
  }
  return files;
}

async function chatVision(messages) {
  const res = await fetch(`${config.deepseek.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.deepseek.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.deepseek.model, stream: false, max_tokens: 1500, temperature: 0.1, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, messages }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}：${body?.error?.message || ''}`);
  const text = body.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new Error('DeepSeek 返回为空');
  return { text, usage: body.usage, model: body.model };
}

/** One vision call (+ one repair round if the reply is not valid JSON). Returns { issues, dropped, summary, model }. */
export async function visionCheck({ frames, prompt, reference = null, chat = chatVision }) {
  const content = [{ type: 'text', text: `Generation prompt:\n${String(prompt || '').slice(0, 900)}\n${reference ? 'The last image is the reference photo of the presenter.' : 'No reference photo.'}` }];
  for (const [i, f] of frames.entries()) content.push({ type: 'text', text: `Frame ${i + 1}:` }, { type: 'image_url', image_url: { url: await dataUri(f), detail: 'low' } });
  if (reference) content.push({ type: 'text', text: 'Reference photo:' }, { type: 'image_url', image_url: { url: await dataUri(reference.file, reference.mime), detail: 'low' } });
  const messages = [{ role: 'system', content: visionSystem(frames.length) }, { role: 'user', content }];
  let reply = await chat(messages), parsed;
  const parse = () => { try { parsed = JSON.parse(reply.text); return Array.isArray(parsed?.issues); } catch { return false; } };
  if (!parse()) {
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: 'That is not the required JSON. Return {"issues":[…],"summary":"…"} only.' });
    reply = await chat(messages);
    if (!parse()) throw new Error('视觉质检两次都没有返回合法 JSON');
  }
  const { kept, dropped } = sanitizeIssues(parsed.issues, frames.length);
  return { issues: kept, dropped: dropped.length, summary: String(parsed.summary || '').slice(0, 200), model: reply.model };
}

/* ───────── per-shot and per-job ───────── */

const mimeOf = f => ({ '.png': 'image/png', '.webp': 'image/webp' }[path.extname(f).toLowerCase()] || 'image/jpeg');

/**
 * QC for one shot: its video window, or — for a still — its image. `measure` / `measureStill` / `vision` are
 * injectable so tests never touch ffmpeg or the network. Returns null when there is nothing to check yet.
 */
export async function qcShot(job, board, shot, { measure = measureClip, measureStill = measureImage, vision = visionCheck, useVision = true } = {}) {
  const clip = resolveShotClip(job, shot);
  const hasClip = clip && existsSync(clip.file);
  const imageFile = hasClip ? null : resolveShotImage(job, shot);
  if (!hasClip && !(imageFile && existsSync(imageFile))) return null;
  const need = shot.end - shot.start;
  const m = hasClip ? await measure(clip.file, { start: clip.in, duration: need }) : await measureStill(imageFile);
  const checks = objectiveChecks(m, { need: hasClip && m.info ? need : 0, portrait: (board.aspect || '9:16') === '9:16', speech: hasClip && Boolean(shot.text) });
  let issues = [], vis = { model: null, dropped: 0, summary: '', skipped: null };
  if (useVision && !m.decodeError && config.deepseek.key) {
    const dir = path.join(jobDir(job.id), 'board', 'qc', shot.id);
    try {
      const frames = hasClip ? await extractFrames(clip.file, clip.in, need, dir) : [imageFile];
      const refRel = shot.source?.character ? board.presenter?.image : null;
      const refFile = refRel ? within(jobDir(job.id), refRel) : null;
      const r = await vision({ frames, prompt: shot.prompt || shot.visual, reference: refFile && existsSync(refFile) ? { file: refFile, mime: mimeOf(refFile) } : null });
      issues = r.issues; vis = { model: r.model, dropped: r.dropped, summary: r.summary, skipped: null };
    } catch (e) { vis.skipped = `视觉质检没跑成：${e.message}`; }
    finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  } else if (useVision) vis.skipped = m.decodeError ? '文件无法解码，已跳过视觉质检' : 'DeepSeek Key 未配置，只做了客观检查';
  return { verdict: decide(checks, issues), checks, issues, vision: vis, subject: hasClip ? 'clip' : 'image', at: new Date().toISOString() };
}

const running = new Set(); // one QC run per job at a time

/** QC every shot that has a clip (or just `ids`). Already-checked shots are skipped unless `again`. */
export async function runQc(job, opts = {}) {
  const { ids = null, again = false } = opts;
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  if (running.has(job.id)) throw httpError(409, '这个任务正在质检');
  const todo = board.shots.filter(s => (!ids || ids.includes(s.id)) && (again || !s.qc));
  if (todo.length > MAX_QC_PER_CALL) throw httpError(400, `一次最多质检 ${MAX_QC_PER_CALL} 镜，请分批`);
  running.add(job.id);
  const checked = [], skipped = [];
  try {
    for (const shot of todo) {
      let result;
      try { result = await qcShot(job, board, shot, opts); }
      catch (e) { skipped.push({ id: shot.id, reason: e.message }); continue; }
      if (!result) { skipped.push({ id: shot.id, reason: '还没有可检查的视频片段或分镜图' }); continue; }
      const current = (await loadBoard(job)) || board; // re-read: earlier iterations already saved
      const target = current.shots.find(s => s.id === shot.id);
      target.qc = result;
      if (result.verdict === 'FAIL') target.status = 'failed';
      await saveBoard(job, current, { trustQc: true });
      checked.push({ id: shot.id, verdict: result.verdict });
    }
  } finally { running.delete(job.id); }
  return { checked, skipped, plan: rerunPlan(await loadBoard(job)) };
}

/**
 * What re-running only the FAILed paid shots would cost. Read-only: the actual submission still goes
 * through the H3 ledger (one confirmed call per segment), never from here.
 */
export function rerunPlan(board) {
  const failed = (board?.shots || []).filter(s => s.qc?.verdict === 'FAIL' && s.source?.kind === 'generate' && s.generate);
  const est = estimateCost({ shots: failed });
  return { shots: failed.map(s => s.id), calls: est.calls, total: est.total, unknown: est.unknown };
}

export const qcSummary = board => {
  const c = { PASS: 0, WARN: 0, FAIL: 0, none: 0 };
  for (const s of board?.shots || []) c[s.qc?.verdict || 'none']++;
  return c;
};
