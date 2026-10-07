import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tools } from './env.mjs';

function run(bin, args, { timeoutMs = 10 * 60_000 } = {}) {
  if (!bin) return Promise.reject(new Error('未找到 FFmpeg / FFprobe（在 apps/studio/.env.local 设置 FFMPEG_PATH / FFPROBE_PATH）'));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(bin)} 超时`)); }, timeoutMs);
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(bin)} 失败（${code}）：${stderr.trim().split(/\r?\n/).slice(-2).join(' ')}`));
    });
  });
}

export async function probe(file) {
  const { stdout } = await run(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate:stream_tags=rotate', '-of', 'json', file]);
  const data = JSON.parse(stdout);
  const v = data.streams.find(s => s.codec_type === 'video');
  if (!v) throw new Error('文件里没有视频轨');
  const a = data.streams.find(s => s.codec_type === 'audio');
  const [n, d] = String(v.r_frame_rate || '30/1').split('/').map(Number);
  let { width, height } = v;
  if ([90, 270].includes(Math.abs(Number(v.tags?.rotate || 0)))) [width, height] = [height, width];
  return {
    duration: Number(data.format.duration),
    size: Number(data.format.size),
    width, height,
    fps: d ? Math.round((n / d) * 100) / 100 : 30,
    videoCodec: v.codec_name,
    audioCodec: a?.codec_name || null,
    orientation: width > height ? 'landscape' : width < height ? 'portrait' : 'square',
  };
}

/** Duration in seconds and whether an audio stream exists; works for audio-only files too. */
export async function mediaInfo(file) {
  const { stdout } = await run(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file]);
  const data = JSON.parse(stdout);
  return { duration: Number(data.format?.duration || 0), hasAudio: (data.streams || []).some(s => s.codec_type === 'audio') };
}

export { run as ffrun };

/**
 * Hard cuts via FFmpeg scene score, then shaped for replication:
 * - cuts closer than MIN_SHOT are merged,
 * - long takes are split into ≤MAX_BEAT beats so every prompt stays specific,
 * - at most MAX_SHOTS shots (the shortest neighbours merge first).
 * Measured on a 57s cinematic reel: real cuts scored 0.19–0.57 at 320px, so 0.3 dropped one, and
 * the old 18-shot cap merged away several more (the director now works per ≤15s segment, so a
 * high cap no longer overflows one DeepSeek reply). Low-contrast cuts (~0.1) are indistinguishable
 * from in-shot flashes by score; the director's start/mid/end strip is what catches those.
 */
export async function detectShots(file, windowSec, { threshold = 0.16, MIN_SHOT = 0.4, MAX_BEAT = 5, MAX_SHOTS = 60 } = {}) {
  const { stderr } = await run(tools.ffmpeg, ['-hide_banner', '-t', String(windowSec), '-i', file, '-an', '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-']);
  const cuts = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1])).filter(t => t > 0.2 && t < windowSec - 0.2);
  const bounds = [0];
  for (const t of cuts) if (t - bounds[bounds.length - 1] >= MIN_SHOT) bounds.push(t);
  if (windowSec - bounds[bounds.length - 1] < MIN_SHOT && bounds.length > 1) bounds.pop();
  bounds.push(windowSec);

  let shots = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const [start, end] = [bounds[i], bounds[i + 1]];
    const pieces = Math.max(1, Math.ceil((end - start) / MAX_BEAT));
    for (let p = 0; p < pieces; p++) shots.push({ start: start + ((end - start) * p) / pieces, end: start + ((end - start) * (p + 1)) / pieces, cut: p === 0 ? 'hard' : 'beat' });
  }
  while (shots.length > MAX_SHOTS) {
    let idx = 0;
    for (let i = 1; i < shots.length - 1; i++) if (shots[i].end - shots[i].start < shots[idx].end - shots[idx].start) idx = i;
    const target = idx === 0 ? 1 : (idx === shots.length - 1 ? idx - 1 : ((shots[idx - 1].end - shots[idx - 1].start) < (shots[idx + 1].end - shots[idx + 1].start) ? idx - 1 : idx + 1));
    const [a, b] = [Math.min(idx, target), Math.max(idx, target)];
    shots.splice(a, 2, { start: shots[a].start, end: shots[b].end, cut: shots[a].cut });
  }
  const round = t => Math.round(t * 100) / 100;
  return shots.map((s, i) => ({ index: i + 1, start: round(s.start), end: round(s.end), duration: round(s.end - s.start), cut: s.cut }));
}

/** Start / middle / end sample times inside a shot, kept clear of the cut frames on either side. */
export function stripTimes(shot) {
  const pad = Math.min(0.12, shot.duration / 6);
  const round = t => Math.round(t * 100) / 100;
  return [shot.start + pad, shot.start + shot.duration / 2, shot.end - pad].map(round);
}

/**
 * Per shot: the middle keyframe (UI thumbnail) and a start|middle|end strip for the director, so it
 * sees how an action begins and where it ends instead of guessing from one frame.
 */
export async function extractKeyframes(file, shots, outDir) {
  await mkdir(outDir, { recursive: true });
  // A seek within ~0.1s of the end of the file can decode no frame at all; step back until one lands.
  const grab = async (t, out, vf, floor) => {
    await rm(out, { force: true });
    for (let at = t; ; at = Math.max(floor, at - 0.2)) {
      // newer ffmpeg exits non-zero ("received no packets") when the seek lands past the last frame; older ones exit 0 with no file
      try { await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at.toFixed(2), '-i', file, '-frames:v', '1', '-vf', vf, '-q:v', '3', out]); } catch (error) { if (at <= floor) throw error; }
      if (existsSync(out)) return;
      if (at <= floor) throw new Error(`第 ${path.basename(out)} 帧截取失败`);
    }
  };
  for (const shot of shots) {
    const n = String(shot.index).padStart(2, '0');
    const times = stripTimes(shot);
    const name = `shot-${n}.jpg`;
    await grab(times[1], path.join(outDir, name), "scale='if(gt(iw,ih),640,-2)':'if(gt(iw,ih),-2,640)'", shot.start);
    const parts = times.map((_, i) => path.join(outDir, `.part-${n}-${i}.jpg`));
    for (let i = 0; i < 3; i++) await grab(times[i], parts[i], 'scale=-2:480', shot.start);
    await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...parts.flatMap(p => ['-i', p]), '-filter_complex', '[0][1][2]hstack=inputs=3,format=yuvj420p', '-q:v', '3', path.join(outDir, `strip-${n}.jpg`)]);
    for (const p of parts) await rm(p, { force: true });
    shot.keyframe = `shots/${name}`;
    shot.keyframeAt = times[1];
    shot.strip = `shots/strip-${n}.jpg`;
    shot.stripAt = times;
  }
  return shots;
}

async function ssim(a, b) {
  const { stderr } = await run(tools.ffmpeg, ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-']);
  const m = stderr.match(/All:([\d.]+)/);
  if (!m) throw new Error('SSIM 计算失败');
  return Number(m[1]);
}

/**
 * Pins a cut the director saw in the evidence strip (panels differ) but the scene score missed:
 * bisects [lo, hi] by asking whether each probe frame looks more like the frame at lo or at hi.
 * Scene scores cannot do this — a low-contrast cut can score below an in-shot light flash.
 * The bracket is the pair of neighbouring strip panels that differ most. Returns the first time
 * after the cut, to one frame.
 */
export async function refineCut(file, panelTimes, fps, workDir) {
  await mkdir(workDir, { recursive: true });
  const frame = async (t, name) => {
    const out = path.join(workDir, name);
    await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=160:-2', out]);
    return out;
  };
  const step = 1 / (fps || 24);
  try {
    const panels = [];
    for (const [i, t] of panelTimes.entries()) panels.push(await frame(t, `p${i}.png`));
    const [first, second] = [await ssim(panels[0], panels[1]), await ssim(panels[1], panels[2])];
    const k = first <= second ? 0 : 1;
    let [lo, hi] = [panelTimes[k], panelTimes[k + 1]];
    const [a, b] = [panels[k], panels[k + 1]];
    while (hi - lo > step * 1.5) {
      const mid = (lo + hi) / 2;
      const probe = await frame(mid, 'mid.png');
      if (await ssim(probe, b) > await ssim(probe, a)) hi = mid; else lo = mid;
    }
    return Math.round(hi * 100) / 100;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Original segment (left) against a generated take (right), both at 540px wide, generated audio kept. */
export async function compareClip(source, start, duration, generated, out) {
  await mkdir(path.dirname(out), { recursive: true });
  const label = (text, extra = '') => `drawtext=text='${text}':x=14:y=14:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.55${extra}`;
  const graph = [
    `[0:v]scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2,setsar=1,${label('ORIGINAL')},drawtext=text='%{pts\\:hms}':x=14:y=h-44:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.55[a]`,
    `[1:v]scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2,setsar=1,${label('GENERATED')}[b]`,
    '[a][b]hstack=inputs=2,fps=24[v]',
  ].join(';');
  await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', start.toFixed(2), '-t', duration.toFixed(2), '-i', source, '-i', generated,
    '-filter_complex', graph, '-map', '[v]', '-map', '1:a?', '-t', duration.toFixed(2), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out]);
  return out;
}

/** Reference clip for one LibTV generation (Seedance takes ≤15s per run). */
export async function cutClip(file, start, duration, out) {
  await mkdir(path.dirname(out), { recursive: true });
  await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', start.toFixed(2), '-i', file, '-t', duration.toFixed(2), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
  return out;
}
