#!/usr/bin/env node
// The fixed steps after a person-swap (wan2.2-animate-mix):
//   review <swapped video> <source video> [--bad 8.3-8.9,10.7-11.4] [--offset 0] [--crop x,y,w,h] [--roi x,y,w,h] [--out dir]
//        overview sheet of the whole clip + dense sheets for the bad windows and for every similar moment in the source
//   quote  <swapped video> --bad 8.3-8.9 [--mode wan-pro] [--ledger file] [--cap 10]
//        which windows would be redone and what it costs (nothing is sent)
//   patch  <swapped video> <source video> <model image> --bad … --ledger file --out dir --confirm --expect-windows N --expect-total X [--mode wan-pro] [--offset 0]
//        redoes exactly the quoted windows; refuses if the quote changed. Output: <dir>/patch_<start>-<end>.mp4 (15 fps, person swapped).
//        Then: RIFE to 30 fps and paste the person back onto the source (see the repo notes) and run `review` again.
import path from 'node:path';
import { animateMix, cutWindow } from '../lib/animate-mix.mjs';
import { DATA_DIR } from '../lib/env.mjs';
import { probe } from '../lib/media.mjs';
import { RATES, loadLedger, planRemedy, runRemedy } from '../lib/remedy.mjs';
import { reviewSwap } from '../lib/swap-review.mjs';

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = name => { const i = args.indexOf(`--${name}`); if (i < 0) return null; const [, v] = args.splice(i, 2); return v; };
const bool = name => { const i = args.indexOf(`--${name}`); if (i < 0) return false; args.splice(i, 1); return true; };
const ranges = s => String(s || '').split(',').filter(Boolean).map(r => { const [a, b] = r.split('-').map(Number); return { start: a, end: b }; });
const quad = s => { if (!s) return null; const [a, b, c, d] = s.split(',').map(Number); return { x: a, y: b, w: c, h: d }; };
const show = plan => {
  for (const w of plan.windows) console.log(`  ${w.start.toFixed(2)}–${w.end.toFixed(2)} s  ${w.seconds} s  ¥${w.cost}  第 ${w.attempt} 次${w.blocked ? `  ✖ ${w.blocked}` : ''}`);
  console.log(`共 ${plan.pending.length} 段，¥${plan.total}（${plan.mode}，¥${plan.rate}/秒）`);
};

try {
  if (cmd === 'review') {
    const [output, source] = args;
    const outDir = flag('out') || path.join(DATA_DIR, 'review', path.basename(output, path.extname(output)));
    const r = await reviewSwap({ output, source, bad: ranges(flag('bad')), sourceOffset: Number(flag('offset') || 0), crop: quad(flag('crop')), roi: quad(flag('roi')), outDir });
    console.log(`✔ 总览 ${r.overview.count} 张${r.focus ? `，重点 ${r.focus.count} 张` : ''} → ${r.page}`);
    console.log(r.candidates.length ? `相似动作候选（只是候选，请看过再定）：${r.candidates.map(c => `${c.start.toFixed(2)}–${c.end.toFixed(2)}s`).join('  ')}` : '没有相似动作候选');
  } else if (cmd === 'quote' || cmd === 'patch') {
    const output = args.shift();
    const mode = flag('mode') || 'wan-pro', ledgerFile = flag('ledger') || path.join(DATA_DIR, 'remedy.json'), cap = Number(flag('cap') || 10);
    if (!RATES[mode]) throw new Error(`模式必须是 ${Object.keys(RATES).join(' / ')}`);
    const bad = ranges(flag('bad'));
    if (!bad.length) throw new Error('需要 --bad 8.3-8.9 这样的问题窗口');
    const { duration } = await probe(output);
    const ledger = loadLedger(ledgerFile);
    const spent = ledger.attempts.filter(a => a.state === 'succeeded').reduce((s, a) => s + a.cost, 0);
    const plan = planRemedy({ bad, duration, mode, ledger, cap, spent });
    show(plan);
    if (cmd === 'patch') {
      const [source, image] = args;
      const out = flag('out') || path.join(DATA_DIR, 'remedy'), offset = Number(flag('offset') || 0);
      const expect = { windows: Number(flag('expect-windows')), total: Number(flag('expect-total')) };
      const res = await runRemedy({ plan, confirm: bool('confirm'), expect, ledgerFile, redo: async (w, { mode: m, onSubmitted }) => {
        const tag = `${w.start.toFixed(2)}-${w.end.toFixed(2)}`;
        const clip = await cutWindow(source, { start: w.start + offset, end: w.end + offset }, path.join(out, `src_${tag}.mp4`));
        return animateMix({ clip, image, mode: m, outFile: path.join(out, `patch_${tag}.mp4`), onSubmitted });
      } });
      for (const d of res.done) console.log(`✔ ${d.window} → ${d.file}`);
      for (const f of res.failed) console.log(`✖ ${f.window} ${f.state}：${f.error}`);
      console.log(`已花 ¥${res.spent}`);
      process.exit(res.failed.length ? 1 : 0);
    }
  } else {
    console.log('用法：node scripts/swap-review.mjs <review|quote|patch> …（详见文件头）');
    process.exit(2);
  }
} catch (e) { console.log(`✖ ${e.message}`); process.exit(1); }
