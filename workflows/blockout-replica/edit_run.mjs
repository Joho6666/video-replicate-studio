// Grey-box (白模) window -> wan2.7-videoedit: render it as live action with the given reference images.
// Ledger is written BEFORE the request; a saved taskId is resumed, never resubmitted; a cost above the confirmed one is refused.
// usage: node edit_run.mjs <tag> <input.mp4> <start> <end> <confirmedCny> <prompt.txt> <ref1> [ref2..4]
// Billing (measured): (input seconds + output seconds) × ¥0.6 at 720P, i.e. ≈ ¥1.2 per second of window. Windows 2–10 s.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const LIB = new URL('../../apps/studio/lib/', import.meta.url).href;
const { config } = await import(LIB + 'env.mjs');
const { cutWindow, uploadTemp } = await import(LIB + 'animate-mix.mjs');
const { probe } = await import(LIB + 'media.mjs');

const [tag, input, start, end, expect, promptFile, ...refs] = process.argv.slice(2);
const D = path.dirname(path.resolve(input)), LEDGER = path.join(D, `${tag}_ledger.json`), MODEL = 'wan2.7-videoedit';
const wait = ms => new Promise(r => setTimeout(r, ms));
const A = { Authorization: `Bearer ${config.wan.key}` };
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
const save = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));

if (!ledger.taskId) {
  if (ledger.state === 'submitting') throw new Error('上次提交状态未知，不自动重提；请先查账本');
  const { width, height } = await probe(input);
  const clip = await cutWindow(input, { start: +start, end: +end }, path.join(D, `${tag}_input.mp4`), { vf: `fps=30,scale=${width}:${height}` });
  const cost = Math.round(Math.ceil((await probe(clip)).duration - 0.01) * 1.2 * 100) / 100;
  if (cost > +expect + 0.01) throw new Error(`费用 ¥${cost} 超过确认的 ¥${expect}`);
  const media = [{ type: 'video', url: await uploadTemp(clip, `${tag}_input.mp4`, { model: MODEL }) }];
  for (const [i, f] of refs.entries()) media.push({ type: 'reference_image', url: await uploadTemp(f, `${tag}_ref${i}${path.extname(f)}`, { model: MODEL }) });
  const prompt = readFileSync(promptFile, 'utf8').trim();
  ledger.state = 'submitting'; ledger.cost = cost; ledger.at = new Date().toISOString(); ledger.window = [+start, +end]; save();
  const res = await fetch(`${config.wan.base}/api/v1/services/aigc/video-generation/video-synthesis`, {
    method: 'POST', headers: { ...A, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable', 'X-DashScope-OssResourceResolve': 'enable' },
    body: JSON.stringify({ model: MODEL, input: { prompt, media }, parameters: { resolution: '720P', prompt_extend: false, watermark: false } }),
  });
  const j = await res.json();
  if (!j.output?.task_id) { ledger.state = 'rejected'; ledger.error = JSON.stringify(j).slice(0, 400); save(); throw new Error(ledger.error); }
  ledger.taskId = j.output.task_id; ledger.state = 'submitted'; save();
  console.log(tag, 'submitted', ledger.taskId, `¥${cost}`);
}
for (let i = 0; i < 160 && ledger.state !== 'succeeded'; i++) {
  const q = await (await fetch(`${config.wan.base}/api/v1/tasks/${ledger.taskId}`, { headers: A })).json();
  const st = q.output?.task_status;
  if (st === 'SUCCEEDED') {
    const url = q.output.video_url || q.output.results?.video_url;
    for (let k = 0; k < 4; k++) { try { writeFileSync(path.join(D, `${tag}_out.mp4`), Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(60000) })).arrayBuffer())); break; } catch { await wait(3000); } }
    ledger.state = 'succeeded'; ledger.usage = q.usage; save(); console.log(tag, 'done', JSON.stringify(q.usage)); break;
  }
  if (st === 'FAILED' || st === 'UNKNOWN') { ledger.state = 'failed'; ledger.error = JSON.stringify(q.output).slice(0, 400); save(); console.log(tag, 'failed', ledger.error); break; }
  await wait(15000);
}
