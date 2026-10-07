import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ffrun, probe } from '../lib/media.mjs';
import { tools } from '../lib/env.mjs';
import { findRecurrences, frameDescriptors, normalize, propagateRisk } from '../lib/recurrence.mjs';
import { buildReviewSheet, sampleTimes } from '../lib/review.mjs';

const SIZE = 16;
// deterministic pseudo-random frames; each [from, to, len] copies `len` frames so a moment comes back later
function synthetic(frames, repeats) {
  const bytes = new Uint8Array(frames * SIZE);
  let seed = 7;
  for (let i = 0; i < bytes.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; bytes[i] = seed % 256; }
  for (const [from, to, len] of repeats) for (let i = 0; i < len * SIZE; i++) bytes[(to * SIZE) + i] = bytes[(from * SIZE) + i];
  return normalize(bytes, SIZE);
}

test('a moment that comes back later is found, a unique one is not', () => {
  const desc = synthetic(300, [[60, 220, 15]]);               // frames 60–75 (2.0–2.5 s) return at frame 220 (7.33 s)
  const hit = findRecurrences(desc, { start: 2, end: 2.5, threshold: 0.9 });
  assert.equal(hit.length, 1);
  assert.ok(Math.abs(hit[0].start - 220 / 30) < 0.01);
  assert.ok(hit[0].score > 0.99);
  assert.deepEqual(findRecurrences(desc, { start: 4, end: 4.5, threshold: 0.9 }), []);
});

test('the query window and its immediate neighbours never count as a recurrence', () => {
  const desc = synthetic(120, []);
  const near = findRecurrences(desc, { start: 1, end: 1.5, threshold: -1, minGap: 1, top: 50 }).filter(m => Math.abs(m.start - 1) < 1);
  assert.deepEqual(near, []);
});

test('propagateRisk returns the other occurrences of every known-bad window, tagged with their origin', () => {
  const desc = synthetic(400, [[60, 220, 15]]);
  const out = propagateRisk(desc, [{ start: 2, end: 2.5 }], { threshold: 0.9 });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].from, { start: 2, end: 2.5 });
  // a recurrence that already lies inside a known-bad window is not reported again
  assert.deepEqual(propagateRisk(desc, [{ start: 2, end: 2.5 }, { start: 7.2, end: 8 }], { threshold: 0.9 }).filter(m => m.start > 7), []);
});

test('frame descriptors: one unit-length vector per frame of the video', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-desc-'));
  try {
    const v = path.join(tmp, 'v.mp4');
    await ffrun(tools.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', v]);
    const d = await frameDescriptors(v, { fps: 30, workDir: path.join(tmp, 'w') });
    assert.ok(Math.abs(d.length - 30) <= 1);
    assert.ok(Math.abs(Math.hypot(...d[5]) - 1) < 1e-3);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('review sheet: sample times, one side-by-side crop per sample, and an index page with the times', async () => {
  assert.deepEqual(sampleTimes([{ start: 1, end: 1.5, why: 'a' }], 0.25).map(i => i.t), [1, 1.25]);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-rev-'));
  try {
    const a = path.join(tmp, 'a.mp4'), b = path.join(tmp, 'b.mp4');
    for (const [f, src] of [[a, 'testsrc2'], [b, 'testsrc']]) await ffrun(tools.ffmpeg, ['-y', '-f', 'lavfi', '-i', `${src}=size=320x480:rate=30:duration=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]);
    const r = await buildReviewSheet({ output: a, source: b, windows: [{ start: 0.2, end: 0.8, why: '摊手' }], outDir: path.join(tmp, 'sheet'), every: 0.2, width: 200 });
    assert.equal(r.count, 3);
    assert.equal((await probe(path.join(tmp, 'sheet', 'r001.jpg'))).width, 400);   // two 200-wide crops side by side
    assert.match(await readFile(r.page, 'utf8'), /0\.20 s 摊手/);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
