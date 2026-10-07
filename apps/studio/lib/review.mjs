// Human review sheet: for each suspicious moment, the generated crop beside the source crop, plus an HTML page
// listing them with times. Automatic detectors are not trusted yet (see defects.mjs), so the person is the judge —
// this makes the judging take a minute instead of a scrub through the whole video.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ffrun } from './media.mjs';
import { tools } from './env.mjs';

/** Sample times inside the given windows, `every` seconds apart (windows = [{ start, end, why }]). */
export function sampleTimes(windows, every = 0.2) {
  const out = [];
  for (const w of windows) {
    for (let t = w.start; t < w.end - 1e-6; t = Math.round((t + every) * 1000) / 1000) out.push({ t, why: w.why || '' });
  }
  return out;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * output/source: video files. sourceOffset: seconds to add to a time to find the same moment in the source.
 * roi: { x, y, w, h } as 0–1 fractions of the frame (default: the middle of the frame, where hands usually are).
 */
export async function buildReviewSheet({ output, source, windows, outDir, sourceOffset = 0, roi = { x: 0, y: 0.45, w: 1, h: 0.3 }, every = 0.2, width = 480 }) {
  await mkdir(outDir, { recursive: true });
  const crop = `crop=iw*${roi.w}:ih*${roi.h}:iw*${roi.x}:ih*${roi.y},scale=${width}:-2,format=yuvj420p`;
  const items = sampleTimes(windows, every);
  for (const [i, it] of items.entries()) {
    const file = `r${String(i + 1).padStart(3, '0')}.jpg`;
    await ffrun(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', it.t.toFixed(3), '-i', output, '-ss', (it.t + sourceOffset).toFixed(3), '-i', source,
      '-filter_complex', `[0:v]${crop}[a];[1:v]${crop}[b];[a][b]hstack=inputs=2,format=yuvj420p`, '-frames:v', '1', '-q:v', '3', path.join(outDir, file)]);
    it.file = file;
  }
  const html = `<!doctype html><meta charset="utf-8"><title>手部 / 肢体复核</title><body style="background:#111;color:#eee;font:14px sans-serif;margin:16px">
<h2>复核表：左 = 生成结果，右 = 原片</h2><p>逐张看：手指数量、腿的方向和长度、有没有粘连或多出来的东西。发现问题记下时间，之后用 <code>node scripts/defects.mjs add</code> 入库。</p>
${items.map(it => `<figure style="display:inline-block;margin:6px"><img src="${it.file}" width="${width * 2 / 2}"><figcaption>${it.t.toFixed(2)} s ${esc(it.why)}</figcaption></figure>`).join('\n')}`;
  await writeFile(path.join(outDir, 'index.html'), html);
  return { count: items.length, dir: outDir, page: path.join(outDir, 'index.html'), items };
}
