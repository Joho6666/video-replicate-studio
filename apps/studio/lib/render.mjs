// Free dynamic storyboard (animatic): turns a board into a watchable video with local ffmpeg only.
// Existing clips are trimmed, stills get a camera move, anything not yet available becomes a labelled
// placeholder card so the timing can still be judged. Word-pop captions, keyword cards and the
// disclaimer are burned in with one ASS file (no drawtext, so it needs no font path).
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tools } from './env.mjs';
import { jobDir } from './jobs.mjs';
import { ffrun } from './media.mjs';

export const W = 720, H = 1280, FPS = 30;

// Camera moves cycled over consecutive stills: push in, pull out, pan right, pan left, diagonal push.
const MOVES = [
  f => `z='1+0.09*on/${f}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
  f => `z='1.10-0.09*on/${f}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
  f => `z='1.12':x='(iw-iw/zoom)*on/${f}':y='ih/2-(ih/zoom/2)'`,
  f => `z='1.12':x='(iw-iw/zoom)*(1-on/${f})':y='ih/2-(ih/zoom/2)'`,
  f => `z='1+0.12*on/${f}':x='(iw-iw/zoom)*0.7':y='(ih-ih/zoom)*0.3'`,
];

const exists = (root, rel) => !!rel && existsSync(path.join(root, rel));
const r1 = n => Math.round(n * 10) / 10;

/**
 * What each shot will be rendered from. Pure (only looks at which files exist), so it can be tested.
 * kind: 'clip' | 'still' | 'placeholder'.
 */
export function planSegments(board, root) {
  let move = 0;
  return board.shots.map(s => {
    const duration = r1(s.end - s.start);
    const base = { id: s.id, duration, overlay: s.source?.overlay || '' };
    const src = s.source || {};
    if (src.kind === 'reuse' && exists(root, src.file)) return { ...base, kind: 'clip', file: src.file, in: src.in || 0 };
    if (src.kind === 'generate' && exists(root, s.output?.file)) return { ...base, kind: 'clip', file: s.output.file, in: 0 };
    if ((src.kind === 'still' || src.kind === 'client') && exists(root, src.image)) {
      return { ...base, kind: 'still', file: src.image, move: move++ % MOVES.length, productOverlay: !!src.productOverlay };
    }
    const label = src.kind === 'client' ? '待客户提供素材' : src.kind === 'generate' ? `待生成 · ${s.generate?.provider || ''} ${s.cost?.seconds ?? ''}s` : src.kind === 'still' ? '待生成分镜图' : '缺素材';
    return { ...base, kind: 'placeholder', label };
  });
}

const ts = t => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
const YELLOW = '&H0000E0FF&', WHITE = '&H00FFFFFF&'; // ASS colours are BGR
const esc = t => String(t).replace(/[{}\\]/g, '').replace(/\r?\n/g, '\\N');

/** Word-pop captions: three words at a time, the one being spoken highlighted; timed by word length. */
export function captionEvents(text, start, end) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const span = Math.max(0.4, end - start - 0.12);
  const weights = words.map(w => Math.max(2, w.replace(/[^\p{L}\p{N}']/gu, '').length + 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = start;
  const times = weights.map(w => { const s = t; t += (span * w) / sum; return s; });
  times.push(start + span);
  const chunks = []; let cur = [];
  words.forEach((w, i) => { cur.push(i); if (cur.length >= 3 || /[.,?!。，？！]$/.test(w)) { chunks.push(cur); cur = []; } });
  if (cur.length) chunks.push(cur);
  const out = [];
  for (const chunk of chunks) for (const i of chunk) {
    const line = chunk.map(j => `{\\c${j === i ? YELLOW : WHITE}}${esc(words[j]).toUpperCase()}`).join(' ');
    out.push(`Dialogue: 0,${ts(times[i])},${ts(times[i + 1] + (i === chunk[chunk.length - 1] ? 0.05 : 0))},Pop,,0,0,0,,{\\fscx88\\fscy88\\t(0,90,\\fscx100\\fscy100)}${line}`);
  }
  return out;
}

/** One ASS file for the whole video: captions, keyword cards, placeholder labels, disclaimer. */
export function buildAss(board, plan) {
  const ev = [];
  board.shots.forEach((s, i) => {
    ev.push(...captionEvents(s.text, s.start, s.end));
    if (s.source?.overlay) ev.push(`Dialogue: 2,${ts(s.start)},${ts(s.end)},Hook,,0,0,0,,{\\fad(60,120)\\fscx70\\fscy70\\t(0,140,\\fscx100\\fscy100)}${esc(s.source.overlay)}`);
    if (plan?.[i]?.kind === 'placeholder') ev.push(`Dialogue: 1,${ts(s.start)},${ts(s.end)},Card,,0,0,0,,${esc(plan[i].label)}`);
  });
  if (board.disclaimer) ev.push(`Dialogue: 1,${ts(board.disclaimer_from ?? 0)},${ts(board.total)},Small,,0,0,0,,${esc(board.disclaimer)}`);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Pop,Arial Black,60,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,7,3,2,40,40,320,1
Style: Hook,Impact,92,&H0000E0FF,&H000000FF,&H00000000,&H90000000,0,0,0,0,100,100,2,0,1,8,4,8,40,40,140,1
Style: Card,Arial,44,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,0,0,0,0,100,100,0,0,1,2,1,5,40,40,40,1
Style: Small,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,40,40,34,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${ev.join('\n')}
`;
}

const filterPath = p => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

/** Renders final/animatic.mp4 for a job. Local ffmpeg only; never calls a paid API. */
export async function renderAnimatic(job, board, { voiceFile = 'voice/full.wav', productImage = board.product?.image } = {}) {
  const root = jobDir(job.id);
  const work = path.join(root, 'final', 'anim');
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const plan = planSegments(board, root);
  const enc = ['-an', '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS)];
  const parts = [];
  for (const seg of plan) {
    const out = path.join(work, `${seg.id}.mp4`);
    const frames = Math.max(1, Math.round(seg.duration * FPS));
    if (seg.kind === 'clip') {
      await ffrun(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(seg.in), '-t', String(seg.duration), '-i', path.join(root, seg.file),
        '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS}`, ...enc, out]);
    } else if (seg.kind === 'still') {
      const motion = MOVES[seg.move](frames);
      const zoom = `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=${motion}:d=1:s=${W}x${H}:fps=${FPS}`;
      const withProduct = seg.productOverlay && exists(root, productImage);
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-framerate', String(FPS), '-t', String(seg.duration), '-i', path.join(root, seg.file)];
      if (withProduct) args.push('-i', path.join(root, productImage));
      args.push('-filter_complex', withProduct ? `[0]${zoom}[b];[1]scale=300:-1[p];[b][p]overlay=(W-w)/2:(H-h)/2-40` : `[0]${zoom}`, '-t', String(seg.duration), ...enc, out);
      await ffrun(tools.ffmpeg, args);
    } else {
      await ffrun(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-t', String(seg.duration), '-i', `color=c=0x17171a:s=${W}x${H}:r=${FPS}`, ...enc, out]);
    }
    parts.push(out);
  }
  const list = path.join(work, 'list.txt');
  await writeFile(list, parts.map(p => `file '${path.basename(p)}'`).join('\n'));
  const video = path.join(work, 'video.mp4');
  await ffrun(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);

  const ass = path.join(work, 'captions.ass');
  await writeFile(ass, buildAss(board, plan));
  const final = path.join(root, 'final', 'animatic.mp4');
  const haveVoice = exists(root, voiceFile);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', video];
  if (haveVoice) args.push('-i', path.join(root, voiceFile)); else args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono');
  args.push('-vf', `eq=contrast=1.05:saturation=1.08,subtitles='${filterPath(ass)}'`, '-map', '0:v', '-map', '1:a', '-t', String(board.total),
    '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', final);
  await ffrun(tools.ffmpeg, args);
  return { file: path.relative(root, final).split(path.sep).join('/'), segments: plan.length, placeholders: plan.filter(p => p.kind === 'placeholder').length, voice: haveVoice };
}
