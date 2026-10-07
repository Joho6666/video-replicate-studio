// The fixed review step after a person-swap: an overview sheet of the whole clip, plus dense sheets for the windows
// marked bad AND for every other moment of the source that looks like one of them (the same gesture comes back).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { propagateRisk, frameDescriptors } from './recurrence.mjs';
import { buildReviewSheet } from './review.mjs';
import { probe } from './media.mjs';

/**
 * output = the swapped video, source = the original, sourceOffset = seconds to add to an output time to find it in the source.
 * bad = windows (output time) already known to be wrong. Returns { candidates, overview, focus, page }.
 */
export async function reviewSwap({ output, source, bad = [], sourceOffset = 0, outDir, crop = null, roi, threshold = 0.6, overviewEvery = 0.5, focusEvery = 0.2 }) {
  await mkdir(outDir, { recursive: true });
  const { duration } = await probe(output);
  let candidates = [];
  if (bad.length) {
    const desc = await frameDescriptors(source, { crop, workDir: path.join(outDir, 'desc') });
    const inSource = bad.map(w => ({ start: w.start + sourceOffset, end: w.end + sourceOffset }));
    candidates = propagateRisk(desc, inSource, { threshold }).map(m => ({ start: Math.max(0, m.start - sourceOffset), end: Math.min(duration, m.end - sourceOffset), score: m.score, from: m.from }))
      .filter(m => m.end - m.start > 0.1);
  }
  const common = { output, source, sourceOffset, ...(roi ? { roi } : {}) };
  const overview = await buildReviewSheet({ ...common, windows: [{ start: 0, end: duration, why: '总览' }], outDir: path.join(outDir, 'overview'), every: overviewEvery });
  const focusWindows = [...bad.map(w => ({ ...w, why: '已知有问题' })), ...candidates.map(c => ({ start: c.start, end: c.end, why: `相似动作（${c.score}）` }))];
  const focus = focusWindows.length ? await buildReviewSheet({ ...common, windows: focusWindows, outDir: path.join(outDir, 'focus'), every: focusEvery }) : null;
  const page = path.join(outDir, 'index.html');
  await writeFile(page, `<!doctype html><meta charset="utf-8"><title>换人复核</title><body style="background:#111;color:#eee;font:14px sans-serif;margin:16px">
<h2>换人复核</h2><ul><li><a style="color:#8cf" href="overview/index.html">总览（${overview.count} 张）</a>：整条每 ${overviewEvery} 秒一张，先扫一遍</li>
${focus ? `<li><a style="color:#8cf" href="focus/index.html">重点（${focus.count} 张）</a>：已知问题和相似动作，每 ${focusEvery} 秒一张</li>` : '<li>没有标记问题窗口，所以没有重点表。发现问题后用 --bad 重跑，会自动找出相似动作。</li>'}</ul>
<p>相似动作候选：${candidates.length ? candidates.map(c => `${c.start.toFixed(2)}–${c.end.toFixed(2)} s`).join('、') : '无'}（只是候选，要你看过才算数）</p>`);
  return { candidates, overview, focus, page, duration };
}
