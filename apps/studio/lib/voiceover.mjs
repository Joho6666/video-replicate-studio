// Whole-script voice-over for a board: one MOSI clip per shot line, each fitted to its shot, mixed at the shot
// start times into voice/full.wav (the file the animatic and the factory export already read).
// Billed per character, so — like stills and hook voices — the caller must echo the exact number of lines and
// characters the server computed; lines whose text and voice have not changed are never re-billed.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadBoard } from './board.mjs';
import { tools } from './env.mjs';
import { languageOf } from './hooks.mjs';
import { jobDir } from './jobs.mjs';
import { ffrun, mediaInfo } from './media.mjs';
import { billedChars, speak } from './moss.mjs';

export const MAX_VOICE_LINES = 40;
const MARGIN = 0.3; // seconds of air left at the end of each shot
const httpError = (status, message) => Object.assign(new Error(message), { status });
const round2 = n => Math.round(n * 100) / 100;
const manifestFile = job => path.join(jobDir(job.id), 'voice', 'manifest.json');

/** What was voiced so far (server-written, never taken from a client). */
export async function loadVoiceManifest(job) {
  try { return JSON.parse(await readFile(manifestFile(job), 'utf8')); } catch { return { lines: {} }; }
}

async function saveManifest(job, manifest) {
  const file = manifestFile(job);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(manifest, null, 2));
  await rename(tmp, file);
}

export const voiceIdOf = (job, board) => board.voice?.id || job.voice?.voiceId || null;

/** Lines that still need a voice (new, edited, other voice, or all with `again`). Pure. */
export function planVoiceover(board, manifest, { voiceId, ids = null, again = false }) {
  const withText = board.shots.filter(s => String(s.text || '').trim());
  const todo = withText.filter(s => (!ids || ids.includes(s.id)) && (again || manifest.lines?.[s.id]?.text !== s.text.trim() || manifest.lines?.[s.id]?.voiceId !== voiceId));
  return { total: withText.length, lines: todo, chars: todo.reduce((n, s) => n + billedChars(s.text), 0), language: languageOf(withText.map(s => s.text).join(' ')) };
}

/** Mixes every voiced line into one track at its shot start, each trimmed to its shot. Free (ffmpeg only). */
export async function mixVoiceover(job, board, manifest, { ffmpeg = args => ffrun(tools.ffmpeg, args) } = {}) {
  const root = jobDir(job.id);
  const lines = board.shots.filter(s => manifest.lines[s.id] && existsSync(path.join(root, manifest.lines[s.id].file)));
  if (!lines.length) return null;
  const inputs = [], filters = [];
  lines.forEach((s, i) => {
    inputs.push('-i', path.join(root, manifest.lines[s.id].file));
    filters.push(`[${i}:a]aresample=44100,aformat=channel_layouts=mono,atrim=0:${round2(s.end - s.start)},asetpts=PTS-STARTPTS,adelay=${Math.round(s.start * 1000)}:all=1[a${i}]`);
  });
  const mix = `${lines.map((_, i) => `[a${i}]`).join('')}amix=inputs=${lines.length}:normalize=0:duration=longest,apad=whole_dur=${board.total}[o]`;
  const out = path.join(root, 'voice', 'full.wav');
  await ffmpeg(['-hide_banner', '-y', ...inputs, '-filter_complex', [...filters, mix].join(';'), '-map', '[o]', '-t', String(board.total), '-ar', '44100', '-ac', '1', out]);
  return 'voice/full.wav';
}

const running = new Set(); // one voice run per job at a time: every character is billed

/**
 * Voices the pending lines one by one (never in parallel, never retried), then mixes voice/full.wav.
 * `expect` = { lines, chars } is what the page showed in its confirmation.
 */
export async function generateVoiceover(job, { ids = null, again = false, expect, say = speak, duration = async f => (await mediaInfo(f)).duration, mix = mixVoiceover } = {}) {
  const board = await loadBoard(job);
  if (!board) throw httpError(404, '这个任务还没有镜头表');
  const voiceId = voiceIdOf(job, board);
  if (!voiceId) throw httpError(400, '先给这张镜头表选一个音色');
  const manifest = await loadVoiceManifest(job);
  const plan = planVoiceover(board, manifest, { voiceId, ids, again });
  if (!plan.total) throw httpError(400, '镜头表里没有台词');
  if (plan.lines.length && (!expect || expect.lines !== plan.lines.length || expect.chars !== plan.chars)) throw httpError(409, `需要配音 ${plan.lines.length} 句、约 ${plan.chars} 字，页面上确认的是 ${expect ? `${expect.lines} 句、${expect.chars} 字` : '未确认'}，请刷新后重新确认`);
  if (plan.lines.length > MAX_VOICE_LINES) throw httpError(400, `一次最多配 ${MAX_VOICE_LINES} 句`);
  if (running.has(job.id)) throw httpError(409, '这个任务正在生成配音');
  running.add(job.id);
  const generated = [], failed = [], warnings = [];
  try {
    const root = jobDir(job.id);
    await mkdir(path.join(root, 'voice'), { recursive: true });
    Object.assign(manifest, { voiceId, language: plan.language });
    manifest.lines ||= {};
    for (const s of plan.lines) {
      const rel = `voice/line-${s.id}.mp3`;
      try {
        const slot = round2(s.end - s.start);
        await say({ text: s.text.trim(), voiceId, seconds: Math.max(1, slot - MARGIN), language: plan.language, out: path.join(root, rel) });
        const actual = round2(await duration(path.join(root, rel)));
        manifest.lines[s.id] = { text: s.text.trim(), voiceId, file: rel, seconds: actual, chars: billedChars(s.text), at: new Date().toISOString() };
        await saveManifest(job, manifest); // keep progress even if a later line fails
        generated.push(s.id);
        if (actual > slot + 0.05) warnings.push(`${s.id}：配音 ${actual}s 比镜头 ${slot}s 长，混音时会被截断，请缩短台词或拉长镜头`);
      } catch (e) { failed.push({ id: s.id, error: e.message }); }
    }
    const missing = board.shots.filter(s => String(s.text || '').trim() && !manifest.lines[s.id]);
    manifest.file = await mix(job, board, manifest);
    manifest.mixedAt = new Date().toISOString();
    manifest.warnings = warnings;
    await saveManifest(job, manifest);
    return { generated, failed, warnings, missing: missing.map(s => s.id), chars: plan.lines.filter(s => generated.includes(s.id)).reduce((n, s) => n + billedChars(s.text), 0), file: manifest.file };
  } finally { running.delete(job.id); }
}
