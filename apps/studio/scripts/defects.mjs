#!/usr/bin/env node
// Defect library + detector scoring + repeat finder + review sheet for AI-generated video.
//   add   <image> --part hand --label bad|good [--kind extra_digit] [--note …]
//   list  [--part hand]
//   eval  <detector> [--part hand]        detector: vlm (DeepSeek vision, finger count)  |  path to a module whose default export is async (file, sample) => boolean
//   recur <source video> --bad 8.3-8.9[,10.7-11.4] [--threshold 0.6] [--crop x,y,w,h]   other moments that likely need the same fix
//   sheet <output video> <source video> --windows 8.0-9.0,10.2-11.6 [--offset 0] [--out dir] [--roi x,y,w,h]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PARTS, addSample, evaluateDetector, listSamples, summary, trustGate } from '../lib/defects.mjs';
import { config, DATA_DIR } from '../lib/env.mjs';
import { findRecurrences, frameDescriptors, propagateRisk } from '../lib/recurrence.mjs';
import { buildReviewSheet } from '../lib/review.mjs';

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = name => { const i = args.indexOf(`--${name}`); if (i < 0) return null; const [, v] = args.splice(i, 2); return v; };
const ranges = s => String(s || '').split(',').filter(Boolean).map(r => { const [a, b] = r.split('-').map(Number); return { start: a, end: b }; });
const quad = s => { if (!s) return null; const [a, b, c, d] = s.split(',').map(Number); return { x: a, y: b, w: c, h: d }; };

async function vlmDetector() {
  const Q = 'This is a frame from an AI-generated video of a person. Look ONLY at the hands. Count the fingers on each visible hand including the thumb and say whether the anatomy is normal (exactly 5 digits, none fused, none extra). Reply JSON: {"any_anomaly":true|false}';
  return async file => {
    const b64 = readFileSync(file).toString('base64');
    const res = await fetch(`${config.deepseek.base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${config.deepseek.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.deepseek.model, stream: false, max_tokens: 300, temperature: 0.1, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: [{ type: 'text', text: Q }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }] }] }), signal: AbortSignal.timeout(120_000) });
    const body = await res.json();
    return JSON.parse(body.choices[0].message.content).any_anomaly === true;
  };
}

try {
  if (cmd === 'add') {
    const part = flag('part'), label = flag('label'), kind = flag('kind') || 'other', note = flag('note') || '';
    const [image] = args;
    const s = addSample({ image, part, label, kind, note });
    console.log(`✔ ${s.id} ${s.part} ${s.label}${s.label === 'bad' ? ` (${s.kind})` : ''}`);
  } else if (cmd === 'list') {
    const part = flag('part');
    console.log(JSON.stringify(summary(), null, 1));
    for (const s of listSamples({ part })) console.log(`${s.id}  ${s.part.padEnd(5)} ${s.label.padEnd(4)} ${s.kind.padEnd(12)} ${s.note}`);
  } else if (cmd === 'eval') {
    const [which] = args, part = flag('part') || undefined;
    const detect = which === 'vlm' ? await vlmDetector() : (await import(pathToFileURL(path.resolve(which)).href)).default;
    const ev = await evaluateDetector(detect, { part });
    const pct = v => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);
    console.log(`样本 ${ev.samples}（坏 ${ev.bad} / 好 ${ev.good}，弃权 ${ev.abstained}）  召回 ${pct(ev.recall)}  特异度 ${pct(ev.specificity)}  精确率 ${pct(ev.precision)}  准确率 ${pct(ev.accuracy)}`);
    if (ev.misses.length) console.log('判错：', ev.misses.join(' '));
    const g = trustGate(ev);
    console.log(g.trusted ? '✔ 可信，允许参与判定' : `✖ 不可信，不允许参与判定：${g.reason}`);
    process.exit(g.trusted ? 0 : 3);
  } else if (cmd === 'recur') {
    const [source] = args, bad = ranges(flag('bad')), threshold = Number(flag('threshold') || 0.6), crop = quad(flag('crop'));
    if (!source || !bad.length) throw new Error('用法见文件头：recur <原片> --bad 8.3-8.9');
    const desc = await frameDescriptors(source, { crop, workDir: path.join(DATA_DIR, 'tmp', 'recur') });
    for (const w of bad) console.log(`${w.start}-${w.end}s 还会出现在：`, findRecurrences(desc, { ...w, threshold }).map(m => `${m.start.toFixed(2)}-${m.end.toFixed(2)}s (${m.score})`).join('  ') || '没有找到');
    console.log('合并后需要一并检查：', propagateRisk(desc, bad, { threshold }).map(m => `${m.start.toFixed(2)}-${m.end.toFixed(2)}s`).join('  ') || '无');
  } else if (cmd === 'sheet') {
    const [output, source] = args, windows = ranges(flag('windows')), outDir = flag('out') || path.join(DATA_DIR, 'review', path.basename(output, path.extname(output)));
    const roi = quad(flag('roi'));
    if (!output || !source || !windows.length) throw new Error('用法见文件头：sheet <生成视频> <原片> --windows 8.0-9.0');
    const r = await buildReviewSheet({ output, source, windows, outDir, sourceOffset: Number(flag('offset') || 0), ...(roi ? { roi } : {}) });
    console.log(`✔ ${r.count} 张 → ${r.page}`);
  } else {
    console.log(`用法：node scripts/defects.mjs <add|list|eval|recur|sheet> …（部位：${PARTS.join(' / ')}）`);
    process.exit(2);
  }
} catch (e) { console.log(`✖ ${e.message}`); process.exit(1); }
