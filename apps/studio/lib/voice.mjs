// Voice-over (MOSI TTS, one clip per generation segment fitted to its length) and the final cut:
// H3 takes trimmed to the reference timing, concatenated, with the voice-over laid on top.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { jobDir, log, saveJob } from './jobs.mjs';
import { compareClip, ffrun, mediaInfo } from './media.mjs';
import { billedChars, speak } from './moss.mjs';
import { tools } from './env.mjs';

const VOICE_MARGIN = 0.3; // seconds of air left at the end of each segment
const BED_VOLUME = 0.22;  // the H3 soundtrack under a voice-over
const rel = (job, file) => path.relative(jobDir(job.id), file).split(path.sep).join('/');
const busy = new Set();

/** Characters that one full voice-over run bills, for the page's cost line. */
export const voiceChars = job => (job.copy?.voiceover || []).reduce((n, v) => n + billedChars(v.text), 0);

export async function generateVoice(job, { voiceId, voiceName = '' }) {
  if (!job.copy?.voiceover?.length) throw Object.assign(new Error('先在「带货文案」生成口播脚本'), { status: 400 });
  if (!voiceId) throw Object.assign(new Error('先选一个音色'), { status: 400 });
  if (busy.has(job.id)) throw Object.assign(new Error('配音正在生成'), { status: 409 });
  busy.add(job.id);
  try {
    const language = job.copy.target === 'tiktok' ? 'English' : 'Chinese';
    const dir = path.join(jobDir(job.id), 'voice');
    await mkdir(dir, { recursive: true });
    log(job, `MOSI 配音：${job.copy.voiceover.length} 段 · ${voiceChars(job)} 字 · 音色 ${voiceName || voiceId}`);
    const items = [];
    for (const v of job.copy.voiceover) {
      if (!v.text?.trim()) continue;
      const target = Math.max(1, Math.round((v.duration - VOICE_MARGIN) * 100) / 100);
      const out = await speak({ text: v.text, voiceId, seconds: target, language, out: path.join(dir, `seg-${v.segment}.mp3`) });
      const { duration } = await mediaInfo(out);
      items.push({ segment: v.segment, start: v.start, duration: v.duration, target, actual: Math.round(duration * 100) / 100, text: v.text, file: rel(job, out) });
    }
    job.voice = { voiceId, voiceName, language, chars: voiceChars(job), items, copyAt: job.copy.generatedAt, generatedAt: new Date().toISOString() };
    const over = items.filter(i => i.actual > i.duration);
    log(job, `配音完成${over.length ? `；第 ${over.map(i => i.segment).join('、')} 段比画面长，合成时会被截断` : ''}`, over.length ? 'warn' : 'info');
    await saveJob(job);
    return job.voice;
  } finally {
    busy.delete(job.id);
  }
}

const srtTime = t => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/**
 * Final cut from every segment's H3 take, trimmed to the reference timing. With a voice-over the H3
 * soundtrack becomes a quiet bed under it; captions from the copy are exported as an .srt beside it.
 */
export async function buildFinal(job, { withVoice = true } = {}) {
  const segs = job.director?.segments || [];
  const missing = segs.filter(s => job.h3?.[s.index]?.state !== 'succeeded').map(s => s.index);
  if (!segs.length || missing.length) throw Object.assign(new Error(`还有第 ${missing.join('、')} 段没有 H3 成片`), { status: 400 });
  if (busy.has(job.id)) throw Object.assign(new Error('正在合成'), { status: 409 });
  busy.add(job.id);
  try {
    const root = jobDir(job.id);
    const dir = path.join(root, 'final');
    await mkdir(dir, { recursive: true });
    const voice = withVoice && job.voice?.items?.length ? job.voice.items : [];
    const args = [];
    const parts = [];
    for (const [i, s] of segs.entries()) {
      const file = path.join(root, job.h3[s.index].video);
      const { hasAudio } = await mediaInfo(file);
      args.push('-i', file);
      const d = s.duration.toFixed(3);
      parts.push(`[${i}:v]trim=0:${d},setpts=PTS-STARTPTS,fps=24,format=yuv420p,setsar=1[v${i}]`);
      parts.push(hasAudio ? `[${i}:a]atrim=0:${d},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo[a${i}]` : `anullsrc=r=44100:cl=stereo,atrim=0:${d}[a${i}]`);
    }
    const n = segs.length;
    parts.push(`${segs.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${n}:v=1:a=1[v][bed]`);
    let audioOut = '[bed]';
    if (voice.length) {
      voice.forEach((v, j) => {
        const seg = segs.find(s => s.index === v.segment);
        args.push('-i', path.join(root, v.file));
        const delay = Math.round((seg.start - segs[0].start) * 1000);
        parts.push(`[${n + j}:a]atrim=0:${seg.duration.toFixed(3)},aresample=44100,aformat=channel_layouts=stereo,adelay=${delay}|${delay}[vo${j}]`);
      });
      parts.push(`[bed]volume=${BED_VOLUME}[bedq]`);
      parts.push(`[bedq]${voice.map((_, j) => `[vo${j}]`).join('')}amix=inputs=${voice.length + 1}:duration=first:normalize=0[mix]`);
      audioOut = '[mix]';
    }
    const video = path.join(dir, voice.length ? 'final_voiced.mp4' : 'final.mp4');
    await ffrun(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args, '-filter_complex', parts.join(';'), '-map', '[v]', '-map', audioOut,
      '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', video]);
    const total = segs.reduce((t, s) => t + s.duration, 0);
    const compare = await compareClip(path.join(root, job.media.video), segs[0].start, total, video, path.join(dir, 'compare.mp4'));
    let srt = null;
    if (job.copy?.captions?.length) {
      srt = path.join(dir, 'captions.srt');
      const offset = segs[0].start;
      await writeFile(srt, job.copy.captions.map((c, i) => `${i + 1}\n${srtTime(c.start - offset)} --> ${srtTime(c.end - offset)}\n${c.text}\n`).join('\n'));
    }
    job.final = { video: rel(job, video), compare: rel(job, compare), srt: srt && rel(job, srt), voiced: Boolean(voice.length), voiceName: voice.length ? job.voice.voiceName : null, duration: Math.round(total * 100) / 100, builtAt: new Date().toISOString() };
    log(job, `完整成片已合成（${job.final.duration}s${voice.length ? ' · 含配音' : ''}）`);
    await saveJob(job);
    return job.final;
  } finally {
    busy.delete(job.id);
  }
}
