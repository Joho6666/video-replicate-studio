// Finishing layer for a rendered cut: colour grade + vignette + grain on the picture, and a rebuilt sound
// mix — clean voice track, whoosh on real transitions, a low impact on title / big-card lines, an optional
// music bed that ducks under the voice, then loudness normalisation. Local ffmpeg only, free.
// The factory writes `成片/<name>.用量.json` (shot starts, per-line voice files and lengths), which is all
// we need to rebuild the voice track and place the effects; without it only grade + loudness are applied.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tools } from './env.mjs';
import { ffrun, probe } from './media.mjs';

/** Looks are data: filter fragments plus a few numbers. Add a style by adding an entry. */
export const STYLES = {
  clean: { label: '干净', eq: 'contrast=1.04:saturation=1.06', balance: null, vignette: null, grain: 2, sfx: 0.4, impact: 0.5, loudness: -14 },
  cinematic: { label: '电影感', eq: 'contrast=1.10:saturation=0.96:gamma=0.98', balance: 'rs=-0.03:bs=0.05:rh=0.05:bh=-0.04', vignette: 'PI/5', grain: 4, sfx: 0.45, impact: 0.7, loudness: -14 },
  warm: { label: '暖调', eq: 'contrast=1.06:saturation=1.12', balance: 'rs=0.04:bs=-0.04', vignette: 'PI/7', grain: 3, sfx: 0.4, impact: 0.55, loudness: -14 },
};
export const DEFAULT_STYLE = 'cinematic';
const WHOOSH_LEAD = 0.12; // seconds before the cut
const httpError = (status, message) => Object.assign(new Error(message), { status });
const num = (n, d = 3) => Number(n.toFixed(d));

/** Video filter chain for a style. Pure. */
export function videoFilter(style) {
  const s = STYLES[style];
  if (!s) throw httpError(400, `未知风格 ${style}（可用：${Object.keys(STYLES).join(' / ')}）`);
  return [`eq=${s.eq}`, s.balance && `colorbalance=${s.balance}`, s.vignette && `vignette=${s.vignette}`, s.grain && `noise=alls=${s.grain}:allf=t`, 'format=yuv420p'].filter(Boolean).join(',');
}

/**
 * Where the effects go, from the factory usage file and its script. Pure.
 * whoosh: start of every shot that begins with a real transition; impact: start of every line with a title or big card.
 */
export function effectTimes(usage, script) {
  const shots = usage?.镜头详情 || [];
  const whoosh = shots.filter((s, i) => i > 0 && s.tin && s.tin !== 'cut').map(s => num(Math.max(0, s.start - WHOOSH_LEAD)));
  const impact = [];
  let t = 0;
  (usage?.旁白 || []).forEach((line, i) => {
    const l = script?.lines?.[i];
    if (l && (l.big || l.title)) impact.push(num(t));
    t += line.d;
  });
  return { whoosh, impact };
}

async function makeSfx(dir, ffmpeg) {
  await mkdir(dir, { recursive: true });
  const whoosh = path.join(dir, 'whoosh.wav'), impact = path.join(dir, 'impact.wav');
  await ffmpeg(['-hide_banner', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=0.45:c=pink:a=0.5', '-af', 'highpass=f=500,lowpass=f=6000,afade=t=in:d=0.25,afade=t=out:st=0.2:d=0.25,volume=0.9', '-ar', '44100', '-ac', '1', whoosh]);
  await ffmpeg(['-hide_banner', '-y', '-f', 'lavfi', '-i', 'sine=frequency=52:duration=0.6', '-af', 'afade=t=in:d=0.01,afade=t=out:st=0.05:d=0.55,volume=1.4', '-ar', '44100', '-ac', '1', impact]);
  return { whoosh, impact };
}

/**
 * Finishes one rendered video of a factory project.
 * `music` overrides the script's own music file; `ffmpeg` is injectable for tests.
 */
export async function finishVideo({ project, name, style = DEFAULT_STYLE, music = null, output = null, ffmpeg = args => ffrun(tools.ffmpeg, args) }) {
  const vf = videoFilter(style);
  const s = STYLES[style];
  const input = path.join(project, '成片', `${name}.mp4`);
  if (!existsSync(input)) throw httpError(404, `找不到 ${input}`);
  const out = output || path.join(project, '成片', `${name}_finish.mp4`);
  const info = await probe(input);
  const T = info.duration;
  const usageFile = path.join(project, '成片', `${name}.用量.json`);
  const usage = existsSync(usageFile) ? JSON.parse(await readFile(usageFile, 'utf8')) : null;
  const script = usage && existsSync(path.join(project, '脚本', `${name}.json`)) ? JSON.parse(await readFile(path.join(project, '脚本', `${name}.json`), 'utf8')) : null;
  const voiceFiles = (usage?.旁白 || []).map(l => l.wav).filter(w => w && existsSync(w));
  const rebuilt = usage && voiceFiles.length === (usage.旁白 || []).length && voiceFiles.length > 0;
  const bed = music || script?.music_file || null;
  if (bed && !existsSync(bed)) throw httpError(400, `找不到配乐文件：${bed}`);
  const fx = rebuilt ? effectTimes(usage, script) : { whoosh: [], impact: [] };
  const work = path.join(project, '成片', `_finish_${name}`);
  await rm(work, { recursive: true, force: true });
  const sfx = rebuilt && (fx.whoosh.length || fx.impact.length) ? await makeSfx(work, ffmpeg) : null;

  const inputs = ['-i', input];
  const g = [];
  let nextIn = 1;
  if (rebuilt) {
    const voiceIdx = [];
    for (const [i, line] of usage.旁白.entries()) { inputs.push('-i', line.wav); voiceIdx.push(nextIn++); g.push(`[${voiceIdx[i]}:a]aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur=${line.d.toFixed(3)},atrim=0:${line.d.toFixed(3)},asetpts=PTS-STARTPTS[v${i}]`); }
    g.push(`${voiceIdx.map((_, i) => `[v${i}]`).join('')}concat=n=${voiceIdx.length}:v=0:a=1,apad=whole_dur=${T.toFixed(3)},atrim=0:${T.toFixed(3)}[voice]`);
    const mixIn = ['[vo]'];
    if (bed) g.push('[voice]asplit=2[vo][vokey]'); else g.push('[voice]anull[vo]');
    if (sfx && fx.whoosh.length) {
      inputs.push('-i', sfx.whoosh); const wi = nextIn++;
      g.push(`[${wi}:a]asplit=${fx.whoosh.length}${fx.whoosh.map((_, i) => `[ws${i}]`).join('')}`);
      fx.whoosh.forEach((t, i) => { g.push(`[ws${i}]adelay=${Math.round(t * 1000)}:all=1,volume=${s.sfx},aformat=channel_layouts=stereo[w${i}]`); mixIn.push(`[w${i}]`); });
    }
    if (sfx && fx.impact.length) {
      inputs.push('-i', sfx.impact); const ii = nextIn++;
      g.push(`[${ii}:a]asplit=${fx.impact.length}${fx.impact.map((_, i) => `[is${i}]`).join('')}`);
      fx.impact.forEach((t, i) => { g.push(`[is${i}]adelay=${Math.round(t * 1000)}:all=1,volume=${s.impact},aformat=channel_layouts=stereo[i${i}]`); mixIn.push(`[i${i}]`); });
    }
    if (bed) {
      inputs.push('-stream_loop', '-1', '-i', bed); const mi = nextIn++;
      g.push(`[${mi}:a]atrim=0:${T.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, T - 2).toFixed(2)}:d=2,volume=0.5,aformat=channel_layouts=stereo[mus]`);
      g.push('[mus][vokey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350[duck]');
      mixIn.push('[duck]');
    }
    g.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0:duration=first,loudnorm=I=${s.loudness}:TP=-1.5:LRA=11,alimiter=limit=0.95,atrim=0:${T.toFixed(3)}[a]`);
  } else {
    g.push(`[0:a]loudnorm=I=${s.loudness}:TP=-1.5:LRA=11,alimiter=limit=0.95[a]`);
  }
  g.push(`[0:v]${vf}[v]`);
  await ffmpeg(['-hide_banner', '-y', ...inputs, '-filter_complex', g.join(';'), '-map', '[v]', '-map', '[a]', '-t', T.toFixed(3), '-c:v', 'libx264', '-crf', '21', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
  await rm(work, { recursive: true, force: true });
  return { output: out, style, audio: rebuilt ? 'rebuilt' : 'kept', whoosh: fx.whoosh.length, impact: fx.impact.length, music: bed, seconds: num(T, 2) };
}
