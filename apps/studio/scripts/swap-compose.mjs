#!/usr/bin/env node
// Composite a person-swap result onto the original footage (matting + interpolation + optional AI upscale).
// Usage: node scripts/swap-compose.mjs <swap video> <source video> --out <dir> [--start 0] [--seconds N] [--fps N]
//        [--upscale blend|full|off] [--split] [--no-audio] [--grain 2.6] [--relight]
//   swap video  = the output of wan2.2-animate-mix (15 fps); source video = the clip it was made from
//   --start     = where the swapped clip begins inside <source video> (seconds)
//   --split     = also write split.mp4 (left: original, right: result)
import path from 'node:path';
import { DATA_DIR } from '../lib/env.mjs';
import { UPSCALE_MODES, composeSwap } from '../lib/swap-compose.mjs';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); if (i < 0) return null; const [, v] = args.splice(i, 2); return v; };
const bool = name => { const i = args.indexOf(`--${name}`); if (i < 0) return false; args.splice(i, 1); return true; };
const num = v => (v == null ? undefined : Number(v));
const out = flag('out'), start = num(flag('start')) ?? 0, seconds = num(flag('seconds')), fps = num(flag('fps'));
const relight = bool('relight');
const upscale = flag('upscale') || 'blend', grain = num(flag('grain')) ?? 2.6, split = bool('split'), audio = !bool('no-audio');
const [swap, source] = args;
if (!swap || !source) { console.log('用法：node scripts/swap-compose.mjs <换人视频> <原片> --out <目录> [--start 秒] [--seconds 秒] [--upscale blend|full|off] [--split]'); process.exit(2); }
if (!UPSCALE_MODES.includes(upscale)) { console.log(`--upscale 只能是 ${UPSCALE_MODES.join(' / ')}`); process.exit(2); }
try {
  const r = await composeSwap({ swap, source, outDir: out || path.join(DATA_DIR, 'compose', path.basename(swap, path.extname(swap))), start, seconds, fps, upscale, grain, relight, split, audio });
  console.log(`✔ ${r.frames} 帧 · ${r.fps} 帧/秒 · ${r.size.join('×')} → ${r.final}${r.split ? `\n  分屏 → ${r.split}` : ''}`);
} catch (e) { console.log(`✖ ${e.message}`); process.exit(1); }
