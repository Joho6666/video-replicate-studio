// Finds moments of a source video that come back later (the same gesture twice). A defect the swap model makes
// on one occurrence is likely on the others, and a human reviewing "the" bad frame misses the repeat.
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ffrun } from './media.mjs';
import { tools } from './env.mjs';

export const DESC_W = 48, DESC_H = 40;

/** Small zero-mean unit-norm grayscale descriptors, one per frame. `crop` = { x, y, w, h } in pixels of the source. */
export async function frameDescriptors(file, { fps = 30, crop = null, workDir }) {
  await mkdir(workDir, { recursive: true });
  const raw = path.join(workDir, 'desc.gray');
  await rm(raw, { force: true });
  const vf = [`fps=${fps}`, crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}` : null, `scale=${DESC_W}:${DESC_H}`, 'format=gray'].filter(Boolean).join(',');
  await ffrun(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vf', vf, '-f', 'rawvideo', raw]);
  return normalize(new Uint8Array(await readFile(raw)), DESC_W * DESC_H);
}

export function normalize(bytes, size) {
  const n = Math.floor(bytes.length / size);
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(size);
    let mean = 0;
    for (let k = 0; k < size; k++) { v[k] = bytes[i * size + k]; mean += v[k]; }
    mean /= size;
    let norm = 0;
    for (let k = 0; k < size; k++) { v[k] -= mean; norm += v[k] * v[k]; }
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < size; k++) v[k] /= norm;
    out.push(v);
  }
  return out;
}

const dot = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };

/** Mean frame-by-frame similarity of the window starting at `a` and the one starting at `b` (both in frames). */
export function windowScore(desc, a, b, len) {
  let s = 0;
  for (let i = 0; i < len; i++) s += dot(desc[a + i], desc[b + i]);
  return s / len;
}

/**
 * Where does the window [start, end) (seconds) come back? Returns up to `top` non-overlapping matches, best first,
 * each { start, end, score }. Matches closer than `minGap` seconds to the query, or below `threshold`, are ignored.
 */
export function findRecurrences(desc, { start, end, fps = 30, minGap = 1, threshold = 0.6, top = 3, step = 0 }) {
  const len = Math.max(2, Math.round((end - start) * fps));
  const q = Math.round(start * fps);
  if (q + len > desc.length) return [];
  const stepF = step > 0 ? Math.max(1, Math.round(step * fps)) : 1;   // every frame by default: a misaligned window scores much lower
  const cands = [];
  for (let s = 0; s + len <= desc.length; s += stepF) {
    if (Math.abs(s - q) < minGap * fps || Math.abs(s - q) < len) continue;
    const score = windowScore(desc, q, s, len);
    if (score >= threshold) cands.push({ start: s / fps, end: (s + len) / fps, score: Math.round(score * 1000) / 1000 });
  }
  cands.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= top) break;
    if (picked.every(p => Math.abs(p.start - c.start) >= (end - start))) picked.push(c);
  }
  return picked;
}

/**
 * Takes the windows already known to be bad and returns the other moments that probably need the same fix,
 * merged and flagged with the window they were inferred from.
 */
export function propagateRisk(desc, bad, opts = {}) {
  const found = [];
  for (const w of bad) {
    for (const m of findRecurrences(desc, { ...opts, start: w.start, end: w.end })) {
      if (bad.some(b => m.start < b.end && m.end > b.start)) continue;
      found.push({ ...m, from: w });
    }
  }
  found.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const f of found) {
    const last = merged.at(-1);
    if (last && f.start <= last.end) { last.end = Math.max(last.end, f.end); last.score = Math.max(last.score, f.score); } else merged.push({ ...f });
  }
  return merged;
}
