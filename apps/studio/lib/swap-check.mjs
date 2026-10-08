// Free, coarse alarm for a raw person-swap output against the clip it was made from: is the background still close
// to the original? The top strip of the frame is almost always background. A large difference means the model
// re-drew the scene or shifted the whole tone; pasting the swapped person back onto the original background is
// then risky. NOT a verdict: on our runs the luma difference had median 0.3–5 for dances that worked and 10.9 for the
// street-food clip that failed, but a plain-background reference on the same shot read 8.4 although it looked
// right, and edge correlation / SSIM separated the cases no better. Treat a warning as "look at the review sheet".
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { ffrun } from './media.mjs';
import { tools } from './env.mjs';

export const DRIFT_WARN = 6, DRIFT_FAIL = 10;

const esc = p => p.replace(/\\/g, '/').replace(/:/g, '\\:');

/** Per-sample luma difference of the blurred top strip: [{ t, drift }]. `source` is aligned to `output` at `sourceOffset` seconds. */
export async function backgroundDrift({ output, source, sourceOffset = 0, strip = 0.15, fps = 10, workDir }) {
  await mkdir(workDir, { recursive: true });
  const log = path.join(workDir, 'drift.txt');
  await rm(log, { force: true });
  const prep = (i, tag) => `[${i}:v]fps=${fps},scale=360:640,crop=360:${Math.round(640 * strip)}:0:0,gblur=sigma=3,format=gray[${tag}]`;
  await ffrun(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', output, '-ss', String(sourceOffset), '-i', source,
    '-filter_complex', `${prep(0, 'a')};${prep(1, 'b')};[a][b]blend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file='${esc(log)}'`, '-f', 'null', '-']);
  const text = await readFile(log, 'utf8');
  const out = [];
  for (const m of text.matchAll(/pts_time:([\d.]+)\s*\n?lavfi\.signalstats\.YAVG=([\d.]+)/g)) out.push({ t: Number(m[1]), drift: Number(m[2]) });
  return out;
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** ok / warn / fail from the median drift, plus the stretches (>= minLen s) above the warn level. */
export function driftVerdict(series, { warn = DRIFT_WARN, fail = DRIFT_FAIL, minLen = 0.3 } = {}) {
  const med = median(series.map(s => s.drift));
  const windows = [];
  let cur = null;
  for (const s of series) {
    if (s.drift >= warn) { if (!cur) cur = { start: s.t, end: s.t }; cur.end = s.t; }
    else if (cur) { windows.push(cur); cur = null; }
  }
  if (cur) windows.push(cur);
  const r2 = x => Math.round(x * 100) / 100;
  const long = windows.filter(w => w.end - w.start >= minLen - 1e-9).map(w => ({ start: r2(w.start), end: r2(w.end) }));
  return { median: Math.round(med * 10) / 10, verdict: med >= fail ? 'fail' : med >= warn || long.length ? 'warn' : 'ok', windows: long };
}
