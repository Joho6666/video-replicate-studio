#!/usr/bin/env node
// One-command regression check of the whole free pipeline, on synthetic fixtures (no client content,
// no network, nothing paid):
//   board → shot QC → hook variants (fake writer + fake voice) → export → factory batch render → output checks
// Usage:  npm run smoke              full run incl. the factory render (~4 min)
//         npm run smoke -- --no-render   everything except the factory render (seconds)
//         npm run smoke -- --keep        keep the temp folder for inspection
// Exit code 0 = every check passed. The report is also written to data/smoke/last.json.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-smoke-'));
process.env.STUDIO_DATA_DIR = path.join(tmp, 'data');
process.env.FACTORY_EXPORT_DIR = path.join(tmp, 'factory-projects');
const L = file => import(new URL(`../lib/${file}`, import.meta.url));
const { ffrun, probe } = await L('media.mjs');
const { tools, STUDIO_DIR } = await L('env.mjs');
const { createScriptJob, exportJob, hooksJob, voiceoverJob } = await L('board-api.mjs');
const { loadBoard, saveBoard } = await L('board.mjs');
const { runQc } = await L('qc.mjs');
const { FACTORY_DIR } = await L('export-factory.mjs');
const { jobDir } = await L('jobs.mjs');

const results = [];
let failed = false;
const t0 = Date.now();
async function step(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, seconds: Math.round((Date.now() - t) / 100) / 10, detail: detail || '' });
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    failed = true;
    results.push({ name, ok: false, seconds: Math.round((Date.now() - t) / 100) / 10, detail: e.message });
    console.log(`  ✖ ${name} — ${e.message}`);
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const ff = a => ffrun(tools.ffmpeg, ['-hide_banner', '-y', ...a]);

console.log(`smoke test · temp ${tmp}`);
if (!tools.ffmpeg) { console.log('FFmpeg not found'); process.exit(2); }

/* ───────── fixtures ───────── */
const job = await createScriptJob({ text: 'smoke\ntest', title: 'Smoke', brief: { product: 'Demo Brand', notes: 'A demo product for the smoke test' } });
const root = jobDir(job.id);
const TEXT = {
  S01: 'Here is the original talking hook',
  S02: 'A still picture for the second line',
  S03: 'And this is another talking part with a little more to say',
  S04: 'Another still picture here',
  S05: 'This one is a long sentence with no punctuation at all that keeps going and going so that the caption splitter has to cope with it properly',
  S06: 'This shot is a broken clip and must be rejected',
  S07: 'Closing still number one',
  S08: 'Closing still number two which is a blank picture',
};
await step('fixtures: synthetic clips, stills and voice', async () => {
  for (const d of ['clips', 'board', 'voice']) await mkdir(path.join(root, d), { recursive: true });
  for (const n of [1, 2]) await ff(['-f', 'lavfi', '-i', `testsrc2=size=432x768:rate=24:duration=7,hue=h=${n * 70}`, '-f', 'lavfi', '-i', `sine=frequency=${200 + n * 60}:duration=7`, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(root, `clips/talk${n}.mp4`)]);
  await ff(['-f', 'lavfi', '-i', 'color=c=black:size=432x768:rate=24:duration=7', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=7', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(root, 'clips/broken.mp4')]);
  for (const [i, id] of ['S02', 'S04', 'S05', 'S07'].entries()) await ff(['-f', 'lavfi', '-i', `testsrc2=size=720x1280:rate=1,hue=h=${i * 55}`, '-frames:v', '1', path.join(root, `board/${id}.jpg`)]);
  await ff(['-f', 'lavfi', '-i', 'color=c=white:size=720x1280', '-frames:v', '1', path.join(root, 'board/S08.jpg')]); // a blank picture: must fail QC
  const talk = (id, start, end, clipFile) => ({ id, start, end, text: TEXT[id], prompt: 'p', source: { kind: 'reuse', file: clipFile, in: 0, lipsync: true } });
  const still = (id, start, end, extra = {}) => ({ id, start, end, text: TEXT[id], prompt: 'p', source: { kind: 'still', image: `board/${id}.jpg`, ...extra } });
  await saveBoard(job, {
    version: 1, title: 'Smoke', voice: { provider: 'moss', id: 'smoke-voice' }, budget: { limit: 0, currency: 'CNY' },
    shots: [talk('S01', 0, 6, path.join(root, 'clips/talk1.mp4')), still('S02', 6, 10), talk('S03', 10, 16, path.join(root, 'clips/talk2.mp4')), still('S04', 16, 20), still('S05', 20, 26, { overlay: 'NEW' }), talk('S06', 26, 30, path.join(root, 'clips/broken.mp4')), still('S07', 30, 34), still('S08', 34, 38)],
  }, { trustHooks: true });
  return '8 shots';
});

/* ───────── shot QC (offline: objective checks only) ───────── */
await step('shot QC: good clips and stills pass; the black clip and the blank still fail', async () => {
  const r = await runQc(job, { useVision: false });
  const v = Object.fromEntries(r.checked.map(c => [c.id, c.verdict]));
  must(v.S01 === 'PASS' && v.S03 === 'PASS', `good clips should PASS, got ${JSON.stringify(v)}`);
  must(v.S06 === 'FAIL', `black clip should FAIL, got ${v.S06}`);
  must(v.S08 === 'FAIL', `blank still should FAIL, got ${v.S08}`);
  must(['S02', 'S04', 'S05', 'S07'].every(id => v[id] === 'PASS'), `stills should PASS, got ${JSON.stringify(v)}`);
  must(!r.skipped.length, `nothing should be skipped, got ${JSON.stringify(r.skipped)}`);
  return `${JSON.stringify(v)}`;
});

/* ───────── whole-script voice-over (fake voice: nothing paid) ───────── */
await step('voice-over: plan, voice every line (fake), mix, free re-run', async () => {
  const { generateVoiceover } = await L('voiceover.mjs');
  const say = async ({ out, seconds }) => { await ff(['-f', 'lavfi', '-i', `sine=frequency=210:duration=${seconds}`, '-ar', '44100', '-ac', '1', '-f', 'wav', out]); return out; };
  const plan = await voiceoverJob(job, { action: 'plan' });
  must(plan.lines === 8, `expected 8 lines to voice, got ${plan.lines}`);
  const r = await generateVoiceover(job, { expect: { lines: plan.lines, chars: plan.chars }, say });
  must(r.generated.length === 8 && !r.failed.length, `voicing failed: ${JSON.stringify(r.failed)}`);
  const info = await probe2(path.join(root, 'voice/full.wav'));
  must(Math.abs(info - 38) < 0.3, `full.wav is ${info}s, expected 38`);
  const again = await generateVoiceover(job, { say: async () => { throw new Error('a finished voice-over must not be billed again'); } });
  must(!again.generated.length, 'second run should voice nothing');
  return `8 lines, ${plan.chars} characters, full.wav ${info.toFixed(1)}s`;
});

/* ───────── hook variants (fake writer + fake voice: nothing paid) ───────── */
await step('hooks: filter, voice (fake), keep voice only for unchanged text', async () => {
  const write = async () => ({
    hooks: [{ id: 'H1', text: 'Why does the day feel so long', angle: 'question' }, { id: 'H2', text: 'Small change big difference', angle: 'contrast' }, { id: 'H3', text: 'A third different opening line', angle: 'story' }],
    rejected: [], slot: { shot: 'S01', seconds: 6 },
  });
  const w = await hooksJob(job, { action: 'write', count: 3, write });
  must(w.hooks.length === 3, 'expected 3 hooks');
  const say = async ({ out, seconds }) => { await ff(['-f', 'lavfi', '-i', `sine=frequency=240:duration=${seconds}`, '-ar', '44100', '-ac', '1', out]); return out; };
  const v = await hooksJob(job, { action: 'voice', confirm: true, count: 3, ids: ['H1', 'H2', 'H3'], voice: (j, o) => import(new URL('../lib/hooks.mjs', import.meta.url)).then(m => m.generateHookVoices(j, { ...o, say })) });
  must(v.generated.length === 3 && !v.failed.length, `voicing failed: ${JSON.stringify(v.failed)}`);
  const board = await loadBoard(job);
  board.hooks[2].text = 'Edited after the voice was made';
  await saveBoard(job, board);
  const after = await loadBoard(job);
  must(after.hooks[0].voice && after.hooks[1].voice && !after.hooks[2].voice, 'an edited hook must lose its voice, the others keep it');
  return '3 hooks, 2 voiced (1 edited → voice dropped)';
});

/* ───────── export ───────── */
let exported;
await step('export: project folder, index, scripts, hook variants', async () => {
  exported = await exportJob(job, { name: 'smoke', variants: 2 });
  const dir = exported.outDir;
  must(exported.clips === 6, `expected 6 usable shots (8 minus the failed clip and the blank still), got ${exported.clips}`);
  must(['S06', 'S08'].every(id => exported.skipped.some(s => s.id === id && /质检/.test(s.reason))), 'the failed shots must be reported as skipped');
  must(exported.hookVariants.length === 2, `expected 2 hook variants, got ${exported.hookVariants.length}`);
  const index = JSON.parse(await readFile(path.join(dir, '数据/素材索引.json'), 'utf8'));
  for (const name of exported.variants) {
    const s = JSON.parse(await readFile(path.join(dir, `脚本/${name}.json`), 'utf8'));
    for (const line of s.lines) {
      for (const [k] of line.shots) must(index[k], `${name}: pinned clip ${k} missing from the index`);
      must(!line.text.split(/[,，]/).some(p => p.length > 33), `${name}: caption piece too long for the factory`);
      if (line.wav) must(existsSync(line.wav), `${name}: voice file missing`);
    }
  }
  return `${exported.variants.join(' ')} · ${Object.keys(index).length} clips`;
});

/* ───────── factory render ───────── */
const python = path.join(FACTORY_DIR, '.venv/Scripts/python.exe');
const batchPy = path.join(FACTORY_DIR, 'svf/run_batch.py');
if (args.has('--no-render')) console.log('  - factory render skipped (--no-render)');
else if (!existsSync(python) || !existsSync(batchPy)) console.log(`  - factory render skipped (no factory at ${FACTORY_DIR}; set FACTORY_DIR)`);
else {
  await step('factory batch render (all variants)', async () => {
    const names = exported.variants;
    const code = await new Promise(resolve => {
      const child = spawn(python, [batchPy, '-j', '2', ...names], { env: { ...process.env, SVF_PROJECT: exported.outDir, PYTHONIOENCODING: 'utf-8' }, windowsHide: true, stdio: 'ignore' });
      child.on('close', resolve);
    });
    const log = await readFile(path.join(exported.outDir, '成片/batch.log'), 'utf8').catch(() => '');
    const ok = new Set([...log.matchAll(/^OK (\S+)/gm)].map(m => m[1]));
    const bad = names.filter(n => !ok.has(n));
    must(code === 0 && !bad.length, `render failed for: ${bad.join(', ') || '(exit ' + code + ')'}\n${log.split('\n').filter(l => /^FAIL/.test(l)).slice(0, 3).join('\n')}`);
    return `${names.length} videos`;
  });
  await step('rendered videos: decode, 9:16, duration, loudness', async () => {
    const lines = [];
    for (const name of exported.variants) {
      const file = path.join(exported.outDir, `成片/${name}.mp4`);
      must(existsSync(file), `${name}.mp4 missing`);
      const info = await probe(file);
      must(info.height > info.width && info.width === 1080, `${name}: expected 1080x1920, got ${info.width}x${info.height}`);
      const script = JSON.parse(await readFile(path.join(exported.outDir, `脚本/${name}.json`), 'utf8'));
      const dur = (await Promise.all(script.lines.map(l => probe2(l.wav)))).reduce((a, b) => a + b + 0.12, 0);
      must(Math.abs(info.duration - dur) < 2, `${name}: ${info.duration.toFixed(1)} s vs ${dur.toFixed(1)} s of voice`);
      const { stderr } = await ffrun(tools.ffmpeg, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
      const mean = Number(/mean_volume:\s*(-?[\d.]+)/.exec(stderr)?.[1]);
      must(mean > -35, `${name}: nearly silent (${mean} dB)`);
      await ffrun(tools.ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-']);
      lines.push(`${name} ${info.duration.toFixed(1)}s ${mean.toFixed(0)}dB`);
    }
    return lines.join(' · ');
  });
}
async function probe2(file) { const { mediaInfo } = await L('media.mjs'); return (await mediaInfo(file)).duration; }

/* ───────── report ───────── */
const total = Math.round((Date.now() - t0) / 1000);
const report = { at: new Date().toISOString(), seconds: total, ok: !failed, results, tmp: args.has('--keep') ? tmp : null };
await mkdir(path.join(STUDIO_DIR, 'data', 'smoke'), { recursive: true });
await writeFile(path.join(STUDIO_DIR, 'data', 'smoke', 'last.json'), JSON.stringify(report, null, 2));
console.log(`\n${failed ? 'FAILED' : 'PASSED'} · ${results.filter(r => r.ok).length}/${results.length} steps · ${total}s`);
if (args.has('--keep')) console.log(`kept ${tmp}`); else await rm(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
