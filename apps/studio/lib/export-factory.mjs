// Board → short-video-factory project. The factory's own batch.py writes copy for one specific mall
// project, so this bridge skips it and feeds the factory's render / qc / run_batch directly:
//   素材索引.json  one entry per usable shot (video window or still image turned into a clip)
//   脚本/bNNN.json one script per variant, every line pinned to its own clip (`shots: [[key, ss]]`)
// Always writes to a NEW folder (marked with .studio-export.json); an existing project is never touched.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_DIR, tools } from './env.mjs';
import { jobDir } from './jobs.mjs';
import { ffrun } from './media.mjs';
import { DEFAULT_BANNED, BANNED_EXCEPTIONS, checkLine, plain, whitelistFrom } from './compliance.mjs';
import { hookSlot, pickHookVisuals } from './hooks.mjs';
import { resolveShotClip } from './qc.mjs';

export { BANNED_EXCEPTIONS, DEFAULT_BANNED, checkLine, whitelistFrom };

export const MARKER = '.studio-export.json';
export const MAX_VARIANTS = 20;
export const FACTORY_DIR = process.env.FACTORY_DIR || 'E:/short-video-factory';
export const defaultExportRoot = () => process.env.FACTORY_EXPORT_DIR || path.resolve(REPO_DIR, '..', 'factory-projects');

const TRANSITIONS = ['cut', 'push_left', 'flash_zoomblur', 'whip_left', 'zoom_blur'];
const httpError = (status, message) => Object.assign(new Error(message), { status });
const fwd = p => p.replace(/\\/g, '/');
const round2 = n => Math.round(n * 100) / 100;

/** Mulberry32: tiny seeded RNG so a variant is reproducible from its number. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const CAPTION_CHARS = 11; // the factory template's caption width (templates/B_信息种草.json max_chars)

/**
 * The factory splits a caption sentence by trying every combination of cut points, which never finishes on a
 * long sentence without punctuation (measured: a 100-character English line hung a render for 15+ minutes).
 * Anything between two commas that is over three caption widths is therefore broken up here: English at word
 * boundaries (about 27 characters a piece), Chinese every two caption widths. Short text is returned unchanged.
 */
export function captionSafe(text, width = CAPTION_CHARS) {
  const limit = width * 3;
  const chunk = Math.floor(width * 2.5); // leave the final split into caption widths to the factory: it balances better
  return String(text || '').split(/([,，。!！?？、:：])/).map(piece => {
    if (piece.length <= limit || /^[,，。!！?？、:：]$/.test(piece)) return piece;
    if (/[㐀-鿿]/.test(piece)) return piece.replace(new RegExp(`(.{${width * 2}})(?=.)`, 'gu'), '$1，');
    const lead = piece.match(/^\s*/)[0];
    const out = [];
    let cur = '';
    for (const w of piece.trim().split(/\s+/)) {
      if (cur && cur.length + 1 + w.length > chunk) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) out.push(cur);
    return lead + out.join(', ');
  }).join('');
}

/** The factory's big card is one short line; anything longer or multi-line would crash its renderer. */
export function bigCard(overlay, whitelist = []) {
  const t = String(overlay || '').replace(/\s+/g, ' ').trim();
  return t && t.length <= 12 && !checkLine(t, { whitelist }).length ? t : undefined;
}

/* ───────── what can be exported ───────── */

/**
 * Splits the board into usable items and skipped shots with a reason. Reads the disk only to see whether
 * a file exists. A shot is usable when it has a line of text, passes QC and has a video window or a still.
 */
export function planExport(job, board, { whitelist = [] } = {}) {
  const root = jobDir(job.id);
  const items = [], skipped = [];
  for (const shot of board.shots) {
    const skip = reason => skipped.push({ id: shot.id, reason });
    if (shot.qc?.verdict === 'FAIL') { skip('质检未通过（FAIL）'); continue; }
    if (!String(shot.text || '').trim()) { skip('没有台词，剪辑端按台词定时长'); continue; }
    const bad = checkLine(shot.text, { whitelist });
    if (bad.length) { skip(`合规检查没过：${bad.join('、')}`); continue; }
    const clip = resolveShotClip(job, shot);
    if (clip && existsSync(clip.file)) { items.push({ shot, kind: 'video', file: clip.file, in: clip.in }); continue; }
    const img = shot.source?.image && !path.isAbsolute(shot.source.image) ? path.join(root, shot.source.image) : null;
    if (img && existsSync(img) && shot.source.kind !== 'client') { items.push({ shot, kind: 'still', file: img, in: 0 }); continue; }
    skip(shot.source?.kind === 'client' ? '客户素材还没提供' : shot.source?.kind === 'generate' ? '还没有生成出视频片段' : shot.source?.kind === 'still' ? '分镜图还没生成' : '找不到素材文件');
  }
  return { items, skipped };
}

/* ───────── writing the project ───────── */

async function assertSafeOutDir(outDir) {
  if (existsSync(outDir)) {
    const entries = await readdir(outDir);
    if (entries.length && !entries.includes(MARKER)) throw httpError(400, `${outDir} 已经有别的内容，不会写进去。请换一个新目录（导出永远只写新项目，不动已有客户项目）`);
  }
}

const previewArgs = (item, dur) => {
  const vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=60,tpad=stop_mode=clone:stop_duration=1,setsar=1,format=yuv420p`;
  const src = item.kind === 'still' ? ['-loop', '1', '-framerate', '60', '-t', String(dur), '-i', item.file] : ['-ss', String(item.in), '-t', String(dur), '-i', item.file];
  return ['-hide_banner', '-y', ...src, '-an', '-vf', vf, '-t', String(dur), '-r', '60', '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'];
};

async function sliceVoice(ffmpeg, voiceFile, shot, out) {
  await ffmpeg(['-hide_banner', '-y', '-ss', String(shot.start), '-t', String(round2(shot.end - shot.start)), '-i', voiceFile, '-vn', '-ac', '1', '-ar', '44100', out]);
}

export const MAX_CUT_RUN = 8; // seconds of picture the factory may join with hard cuts

/**
 * One transition per line, given each line's length in seconds. The first line cuts. A hard cut joins a line
 * to the previous run, and the factory joins a run with `-c copy`. Measured on its renderer: runs of ~10 s or
 * more (3 short shots, or two long ones) fail in the final filter graph ("Invalid data found"), 8 s and
 * under render fine — so a cut is only allowed while the run stays within MAX_CUT_RUN.
 * Variant 0 is the calm one (cut whenever allowed); the others draw from the whole set.
 */
export function pickTransitions(durations, r, variant = 0) {
  const out = [];
  let run = 0;
  durations.forEach((d, i) => {
    const len = d + 0.12;
    const canCut = i === 0 || run + len <= MAX_CUT_RUN;
    let t;
    if (i === 0) t = 'cut';
    else if (variant === 0) t = canCut ? 'cut' : 'push_left';
    else { const pool = canCut ? TRANSITIONS : TRANSITIONS.filter(x => x !== 'cut'); t = pool[Math.floor(r() * pool.length)]; }
    run = t === 'cut' ? run + len : len;
    out.push(t);
  });
  return out;
}

/** One script: same lines and clips as its siblings, but its own seed, transitions and clip windows. */
export function buildScript(lines, { name, variant, jobId, music = [] }) {
  const r = rng(7919 * (variant + 1));
  const transitions = pickTransitions(lines.map(l => l.seconds ?? 4), r, variant);
  return {
    name,
    template: 'B_信息种草',
    batch: `studio_${jobId}`,
    seed: 1000 + variant,
    风格: 'Studio 导入',
    speed: 1.0,
    gap: 0.12,
    ...(music.length ? { music_file: music[variant % music.length], music_vol: 0.22 } : {}),
    lines: lines.map((l, i) => ({
      text: captionSafe(l.text),
      ...(l.wav ? { wav: l.wav } : {}),
      ...(l.big ? { big: l.big } : {}),
      shots: (l.keys || [l.key]).map(k => [k, round2(0.05 + r() * 0.25)]),
      tin: transitions[i],
    })),
  };
}

/** One script per variant of the original cut. */
export function buildScripts(lines, { variants, jobId, music = [] }) {
  return Array.from({ length: variants }, (_, v) => buildScript(lines, { name: `b${String(v + 1).padStart(3, '0')}`, variant: v, jobId, music }));
}

export function reportMarkdown({ job, outDir, items, skipped, scripts, voiced, whitelist, music, hooks = { used: [], skipped: [] } }) {
  const names = scripts.map(s => s.name);
  const L = [
    `# 导出报告：${job.meta?.title || job.id}`, '',
    `- 来源任务：${job.id}`, `- 导出目录：${fwd(outDir)}`,
    `- 可用镜头：${items.length}，跳过：${skipped.length}，变体：${scripts.length} 条`,
    `- 配音：${voiced ? '使用任务里已有的配音（按镜头时间切片）' : '**没有找到 voice/full.wav**，剪辑端会用它自带的中文语音合成；英文脚本请先在 Studio 里生成配音再导出'}`,
    `- 配乐：${music.length ? music.map(fwd).join('、') : '无（可在导出时指定）'}`,
    `- 数字白名单：${whitelist.length ? whitelist.join('、') : '空（脚本里出现的任何数字都会被拦下）'}`, '',
    '## 变体说明', `b 开头的变体：同一份文案和镜头，变化的是转场、素材取景起点和（有配乐时的）配乐。h 开头的变体：换了开头钩子（见下），其余部分与原版相同；原版的口播钩子镜头嘴型绑定原台词，所以不出现在 h 变体里。`, '',
  ];
  if (hooks.used.length) L.push('## 钩子变体', ...hooks.used.map(h => `- ${h.name}：「${h.text}」（${h.seconds}s，配画面 ${h.visuals.join(' + ')}，这些画面在后面的镜头里还会再出现一次）`), '');
  if (hooks.skipped.length) L.push('## 没导出的钩子', ...hooks.skipped.map(h => `- ${h.id}：${h.reason}`), '');
  if (skipped.length) L.push('## 跳过的镜头', ...skipped.map(s => `- ${s.id}：${s.reason}`), '');
  L.push('## 合规提醒',
    '- 这些素材含 AI 生成内容，已在素材索引里标记「AI生成」；发布到抖音 / TikTok 等平台时请打开平台的「AI 生成内容」标识。',
    '- 剪辑端不会自动烧录水印；涉及真人形象的镜头需有授权。', '',
    '## 运行', '在剪辑仓库目录执行（Windows PowerShell）：', '```',
    `$env:SVF_PROJECT = "${fwd(outDir)}"`,
    `${fwd(path.join(FACTORY_DIR, '.venv/Scripts/python.exe'))} ${fwd(path.join(FACTORY_DIR, 'svf/run_batch.py'))} -j 2 ${names.join(' ')}`,
    `${fwd(path.join(FACTORY_DIR, '.venv/Scripts/python.exe'))} ${fwd(path.join(FACTORY_DIR, 'svf/qc.py'))} ${names.join(' ')}`,
    '```', '');
  return L.join('\n');
}

/**
 * One script per voiced hook: [hook line over non-lip-synced pictures] + every original line except the
 * hook shot (its mouth movement belongs to its own voice). Hooks that cannot ship are listed with a reason.
 */
async function buildHookScripts({ job, board, lines, items, target, whitelist, music, ffmpeg }) {
  const out = { scripts: [], used: [], skipped: [] };
  if (!board.hooks?.length) return out;
  const slot = hookSlot(board);
  const visuals = lines.map((l, i) => ({ shot: items[i].shot, dur: l.dur, key: l.key }));
  for (const [k, h] of board.hooks.entries()) {
    const skip = reason => out.skipped.push({ id: h.id, reason });
    const voiceFile = h.voice?.file && !path.isAbsolute(h.voice.file) ? path.join(jobDir(job.id), h.voice.file) : null;
    if (!voiceFile || !existsSync(voiceFile)) { skip('还没有配音'); continue; }
    const bad = checkLine(h.text, { whitelist });
    if (bad.length) { skip(`合规检查没过：${bad.join('、')}`); continue; }
    const picks = pickHookVisuals(visuals, slot.shot.id, h.voice.seconds, k);
    if (!picks) { skip('没有足够长的非口播画面可配（口播镜头嘴型不能换台词）'); continue; }
    const wav = path.join(target, '数据', 'tts_cache', `hook_${h.id}.wav`);
    await ffmpeg(['-hide_banner', '-y', '-i', voiceFile, '-vn', '-ac', '1', '-ar', '44100', wav]);
    const body = lines.filter(l => l.shotId !== slot.shot.id);
    const name = `h${String(k + 1).padStart(2, '0')}`;
    out.scripts.push(buildScript([{ keys: picks.map(p => p.key), text: h.text, wav: fwd(wav), seconds: h.voice.seconds }, ...body], { name, variant: 1 + k, jobId: job.id, music }));
    out.used.push({ name, id: h.id, text: h.text, seconds: h.voice.seconds, visuals: picks.map(p => p.shot.id) });
  }
  return out;
}

/**
 * Exports the board to a fresh factory project. Never calls a paid API; ffmpeg only.
 * `ffmpeg` is injectable for tests.
 */
export async function exportToFactory(job, board, { outDir, variants = 6, allowNumbers = [], music = [], hookVariants = true, ffmpeg = args => ffrun(tools.ffmpeg, args) } = {}) {
  if (!Number.isInteger(variants) || variants < 1 || variants > MAX_VARIANTS) throw httpError(400, `变体数量需要是 1–${MAX_VARIANTS}`);
  const target = path.resolve(outDir || path.join(defaultExportRoot(), `ai_${job.id}`));
  await assertSafeOutDir(target);
  const whitelist = whitelistFrom(job, allowNumbers);
  const { items, skipped } = planExport(job, board, { whitelist });
  if (!items.length) throw httpError(400, `没有可导出的镜头：${skipped.map(s => `${s.id}（${s.reason}）`).slice(0, 5).join('；') || '镜头表是空的'}`);
  const missingMusic = music.filter(m => !existsSync(m));
  if (missingMusic.length) throw httpError(400, `找不到配乐文件：${missingMusic[0]}`);

  for (const d of ['素材/AI生成', '预览60/空镜', '数据/tts_cache', '脚本', '成片']) await mkdir(path.join(target, d), { recursive: true });
  const voiceFile = path.join(jobDir(job.id), 'voice', 'full.wav');
  const voiced = existsSync(voiceFile);
  const index = {}, lines = [];
  for (const it of items) {
    const { shot } = it;
    const key = `ai_${job.id}_${shot.id}`;
    const need = round2(shot.end - shot.start);
    const dur = round2(need + 0.8); // room for the factory's own head/tail margins
    const preview = path.join(target, '预览60', '空镜', `${key}.mp4`);
    await ffmpeg([...previewArgs(it, dur), preview]);
    const original = path.join(target, '素材', 'AI生成', `${key}${path.extname(it.file)}`);
    await copyFile(it.file, original);
    index[key] = { 文件: `AI生成/${path.basename(original)}`, 时长: dur, 类别: '空镜', 内容: key, 标记: ['AI生成'], 口播: [plain(shot.text)], 预览: fwd(preview), 来源: { job: job.id, shot: shot.id, kind: shot.source?.kind, qc: shot.qc?.verdict || null } };
    let wav = null;
    if (voiced) { wav = path.join(target, '数据', 'tts_cache', `studio_${shot.id}.wav`); await sliceVoice(ffmpeg, voiceFile, shot, wav); }
    lines.push({ key, shotId: shot.id, text: shot.text, wav: wav && fwd(wav), big: bigCard(shot.source?.overlay, whitelist), dur, seconds: need });
  }
  await writeFile(path.join(target, '数据', '素材索引.json'), JSON.stringify(index, null, 1));
  await writeFile(path.join(target, 'project.json'), JSON.stringify({
    name: `Studio 导出：${job.meta?.title || job.id}`, brand_title: job.brief?.product || job.meta?.title || '',
    number_whitelist: whitelist, banned_words: DEFAULT_BANNED, banned_exceptions: BANNED_EXCEPTIONS, spoken_numbers: [], caption_words: [],
    draft_prefix: 'studio_', asr_prompt: '以下是普通话的句子。', sources: [{ name: 'AI生成', path: fwd(path.join(target, '素材', 'AI生成')), pattern: '*.*', keep_name: true }], batch: {},
  }, null, 1));
  const musicFiles = music.map(path.resolve);
  const scripts = buildScripts(lines, { variants, jobId: job.id, music: musicFiles });
  const hooks = hookVariants ? await buildHookScripts({ job, board, lines, items, target, whitelist, music: musicFiles, ffmpeg }) : { scripts: [], used: [], skipped: [] };
  scripts.push(...hooks.scripts);
  for (const s of scripts) await writeFile(path.join(target, '脚本', `${s.name}.json`), JSON.stringify(s, null, 1));
  const report = reportMarkdown({ job, outDir: target, items, skipped, scripts, voiced, whitelist, music: musicFiles, hooks });
  await writeFile(path.join(target, '导出报告.md'), report);
  await writeFile(path.join(target, MARKER), JSON.stringify({ job: job.id, at: new Date().toISOString(), variants, clips: items.length }));
  return { outDir: fwd(target), clips: items.length, skipped, variants: scripts.map(s => s.name), hookVariants: hooks.used, hooksSkipped: hooks.skipped, voiced, whitelist, report: fwd(path.join(target, '导出报告.md')) };
}
