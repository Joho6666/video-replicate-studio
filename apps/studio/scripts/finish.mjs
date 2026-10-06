#!/usr/bin/env node
// Finish rendered videos of a factory project: grade + sound design + loudness.
// Usage: node scripts/finish.mjs <factory project dir> [b001 h01 …] [--style cinematic|clean|warm] [--music file]
// With no names, every rendered video that has a usage file is finished. Output: 成片/<name>_finish.mp4
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_STYLE, STYLES, finishVideo } from '../lib/finish.mjs';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); if (i < 0) return null; const [, v] = args.splice(i, 2); return v; };
const style = flag('style') || DEFAULT_STYLE;
const music = flag('music');
const [project, ...names] = args;
if (!project || !existsSync(path.join(project, '成片'))) { console.log('用法：node scripts/finish.mjs <factory 项目目录> [b001 h01 …] [--style cinematic|clean|warm] [--music 配乐文件]'); process.exit(2); }
if (!STYLES[style]) { console.log(`未知风格 ${style}，可用：${Object.keys(STYLES).join(' / ')}`); process.exit(2); }
const todo = names.length ? names : readdirSync(path.join(project, '成片')).filter(f => f.endsWith('.用量.json')).map(f => f.replace('.用量.json', '')).filter(n => existsSync(path.join(project, '成片', `${n}.mp4`)));
if (!todo.length) { console.log('没有找到已渲染的视频（需要 成片/<name>.mp4 和 <name>.用量.json）'); process.exit(1); }
let failed = 0;
for (const name of todo) {
  try {
    const r = await finishVideo({ project, name, style, music });
    console.log(`✔ ${name} → ${path.basename(r.output)} · ${STYLES[style].label} · 音频${r.audio === 'rebuilt' ? '重建' : '沿用'} · 转场音效 ${r.whoosh} · 重音 ${r.impact}${r.music ? ' · 含配乐' : ''}`);
  } catch (e) { failed++; console.log(`✖ ${name}：${e.message}`); }
}
process.exit(failed ? 1 : 0);
