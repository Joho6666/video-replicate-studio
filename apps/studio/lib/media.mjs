import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
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

/**
 * Hard cuts via FFmpeg scene score, then shaped for replication:
 * - cuts closer than MIN_SHOT are merged,
 * - long takes are split into ≤MAX_BEAT beats so every prompt stays specific,
 * - at most MAX_SHOTS shots (the shortest neighbours merge first).
 */
export async function detectShots(file, windowSec, { threshold = 0.3, MIN_SHOT = 0.7, MAX_BEAT = 5, MAX_SHOTS = 18 } = {}) {
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

export async function extractKeyframes(file, shots, outDir) {
  await mkdir(outDir, { recursive: true });
  for (const shot of shots) {
    const t = shot.start + Math.min(shot.duration * 0.5, Math.max(shot.duration - 0.1, 0));
    const name = `shot-${String(shot.index).padStart(2, '0')}.jpg`;
    await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', "scale='if(gt(iw,ih),640,-2)':'if(gt(iw,ih),-2,640)'", '-q:v', '3', path.join(outDir, name)]);
    shot.keyframe = `shots/${name}`;
    shot.keyframeAt = Math.round(t * 100) / 100;
  }
  return shots;
}

/** Reference clip for one LibTV generation (Seedance takes ≤15s per run). */
export async function cutClip(file, start, duration, out) {
  await mkdir(path.dirname(out), { recursive: true });
  await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', start.toFixed(2), '-i', file, '-t', duration.toFixed(2), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
  return out;
}
