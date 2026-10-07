// A library of labelled "this AI frame is wrong / right" samples, and the test every detector must pass
// before its verdict is allowed to matter. Vision models are biased toward "looks normal" (measured: a
// finger-count prompt scored 7/14, i.e. chance, on swapped-person hands), so no detector is trusted until it
// has been scored on real samples from our own runs.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './env.mjs';

export const PARTS = ['hand', 'face', 'arm', 'torso', 'leg', 'foot', 'other'];
export const KINDS = ['extra_digit', 'fused', 'missing', 'distorted', 'flicker', 'identity_drift', 'physics', 'other'];
export const LABELS = ['bad', 'good'];
export const DEFAULT_DIR = path.join(DATA_DIR, 'defects');

const indexFile = dir => path.join(dir, 'index.json');

export function loadLibrary(dir = DEFAULT_DIR) {
  if (!existsSync(indexFile(dir))) return { version: 1, samples: [] };
  const lib = JSON.parse(readFileSync(indexFile(dir), 'utf8'));
  return { version: 1, samples: Array.isArray(lib.samples) ? lib.samples : [] };
}

function save(dir, lib) {
  mkdirSync(dir, { recursive: true });
  const tmp = `${indexFile(dir)}.tmp`;
  writeFileSync(tmp, JSON.stringify(lib, null, 1));
  renameSync(tmp, indexFile(dir));
}

/** Adds one labelled frame. `kind` only matters for bad samples; good samples are stored with kind 'none'. */
export function addSample({ image, part, label, kind = 'other', note = '', origin = {} }, dir = DEFAULT_DIR) {
  if (!existsSync(image)) throw new Error(`图片不存在：${image}`);
  if (!PARTS.includes(part)) throw new Error(`部位必须是 ${PARTS.join(' / ')}`);
  if (!LABELS.includes(label)) throw new Error(`标签必须是 ${LABELS.join(' / ')}`);
  if (label === 'bad' && !KINDS.includes(kind)) throw new Error(`问题类型必须是 ${KINDS.join(' / ')}`);
  const lib = loadLibrary(dir);
  const id = `d${String(lib.samples.length + 1).padStart(4, '0')}`;
  const ext = path.extname(image).toLowerCase() || '.jpg';
  mkdirSync(path.join(dir, 'img'), { recursive: true });
  copyFileSync(image, path.join(dir, 'img', `${id}${ext}`));
  const sample = { id, file: `img/${id}${ext}`, part, label, kind: label === 'bad' ? kind : 'none', note: String(note).slice(0, 300), origin, at: new Date().toISOString() };
  lib.samples.push(sample);
  save(dir, lib);
  return sample;
}

export function listSamples({ part, label } = {}, dir = DEFAULT_DIR) {
  return loadLibrary(dir).samples.filter(s => (!part || s.part === part) && (!label || s.label === label));
}

export function summary(dir = DEFAULT_DIR) {
  const out = {};
  for (const s of loadLibrary(dir).samples) {
    const p = out[s.part] ||= { bad: 0, good: 0 };
    p[s.label]++;
  }
  return out;
}

const ratio = (a, b) => (b ? a / b : null);

/**
 * Scores a detector on the library. `detect(file, sample)` resolves true when it says "anomaly".
 * A detector that throws on a sample counts as an abstention, not as a verdict.
 */
export async function evaluateDetector(detect, { part, dir = DEFAULT_DIR } = {}) {
  const samples = listSamples({ part }, dir);
  const c = { tp: 0, fp: 0, tn: 0, fn: 0, abstained: 0 };
  const misses = [];
  for (const s of samples) {
    let flagged;
    try { flagged = Boolean(await detect(path.join(dir, s.file), s)); } catch { c.abstained++; continue; }
    if (s.label === 'bad') { if (flagged) c.tp++; else { c.fn++; misses.push(s.id); } }
    else if (flagged) { c.fp++; misses.push(s.id); } else c.tn++;
  }
  const scored = c.tp + c.fp + c.tn + c.fn;
  const bad = c.tp + c.fn, good = c.tn + c.fp;
  return { ...c, samples: samples.length, scored, bad, good, recall: ratio(c.tp, bad), specificity: ratio(c.tn, good), precision: ratio(c.tp, c.tp + c.fp), accuracy: ratio(c.tp + c.tn, scored), misses };
}

/**
 * A detector may influence a verdict only if the library is big enough to judge it and it clearly beats chance.
 * Returns { trusted, reason }.
 */
export function trustGate(ev, { minBad = 5, minGood = 5, minRecall = 0.8, minSpecificity = 0.8 } = {}) {
  if (ev.bad < minBad || ev.good < minGood) return { trusted: false, reason: `样本不够：坏样本 ${ev.bad}/${minBad}，好样本 ${ev.good}/${minGood}` };
  if (ev.recall < minRecall) return { trusted: false, reason: `漏报太多：召回率 ${(ev.recall * 100).toFixed(0)}% < ${minRecall * 100}%` };
  if (ev.specificity < minSpecificity) return { trusted: false, reason: `误报太多：特异度 ${(ev.specificity * 100).toFixed(0)}% < ${minSpecificity * 100}%` };
  return { trusted: true, reason: '通过' };
}
