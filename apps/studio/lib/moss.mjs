// MOSI / Moss API (api.mosi.cn): soundtrack transcription and timed voice-over.
// Verified on 2026-09-29:
//   GET  /v1/audio/voices → { data: [{ id, name, created_at }] } (the account's own voices)
//   POST /v1/audio/transcriptions (multipart, moss-transcribe-diarize-pro, diarized_json)
//        → { duration, text, segments: [{ start, end, text, speaker }] }
//   POST /v1/audio/speech { model: moss-tts-1.5-flash, input, voice_id, expected_duration_sec } → audio/mpeg;
//        asked 5 s, got 5.06 s.
// Pricing (platform page, same date): speech ¥2 / 10k chars, diarized transcription ¥2 / hour.
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config, tools } from './env.mjs';

const auth = () => {
  if (!config.moss.key) throw Object.assign(new Error('MOSI API Key 未配置（在 apps/studio/.env.local 写 MOSS_API_KEY=）'), { status: 400 });
  return { Authorization: `Bearer ${config.moss.key}` };
};

async function failure(res, what) {
  const body = await res.json().catch(() => ({}));
  const msg = body?.error?.message || body?.error?.code || body?.message || '';
  return new Error(`MOSI ${what} HTTP ${res.status}${msg ? `：${msg}` : ''}`);
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg 失败：${err.trim().split(/\r?\n/).pop()}`))));
  });
}

export async function listVoices() {
  const res = await fetch(`${config.moss.base}/v1/audio/voices`, { headers: auth(), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw await failure(res, '音色列表');
  const body = await res.json();
  return (body.data || []).map(v => ({ id: v.id, name: v.name || v.id, createdAt: v.created_at }));
}

/**
 * Speech-to-text of the video's soundtrack with speaker turns. The audio is re-encoded to 16 kHz mono
 * first so uploads stay small (the API accepts up to 512 MB, video containers included).
 */
export async function transcribe(videoFile, workDir) {
  const headers = auth();
  await mkdir(workDir, { recursive: true });
  const audio = path.join(workDir, 'soundtrack.mp3');
  await ffmpeg(['-i', videoFile, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audio]);
  const form = new FormData();
  form.append('model', 'moss-transcribe-diarize-pro');
  form.append('diarize', 'true');
  form.append('response_format', 'diarized_json');
  form.append('file', new Blob([await readFile(audio)], { type: 'audio/mpeg' }), 'soundtrack.mp3');
  try {
    const res = await fetch(`${config.moss.base}/v1/audio/transcriptions`, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw await failure(res, '转写');
    const body = await res.json();
    const round = t => Math.round(Number(t) * 100) / 100;
    return {
      model: 'moss-transcribe-diarize-pro',
      duration: round(body.duration || 0),
      text: String(body.text || '').trim(),
      segments: (body.segments || []).map(s => ({ start: round(s.start), end: round(s.end), speaker: s.speaker || '', text: String(s.text || '').trim() })).filter(s => s.text),
      transcribedAt: new Date().toISOString(),
    };
  } finally {
    await rm(audio, { force: true });
  }
}

/** Transcript lines as prompt evidence, optionally limited to a time window and made relative to it. */
export function transcriptLines(transcript, from = 0, to = Infinity) {
  if (!transcript?.segments?.length) return [];
  return transcript.segments
    .filter(s => s.end > from && s.start < to)
    .map(s => `[${Math.max(0, s.start - from).toFixed(2)}-${(Math.min(s.end, to) - from).toFixed(2)}s] ${s.speaker || 'speaker'}: ${s.text}`);
}

/** Visible characters the speech API bills for (pause tags excluded). */
export const billedChars = text => String(text || '').replace(/\[pause [\d.]+s\]/g, '').replace(/\s/g, '').length;

/** One voice-over clip fitted to `seconds` (omit it for the voice's natural pace); returns the saved mp3 path. */
export async function speak({ text, voiceId, seconds, language, out }) {
  const res = await fetch(`${config.moss.base}/v1/audio/speech`, {
    method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.moss.ttsModel, input: text, voice_id: voiceId, language, ...(seconds ? { expected_duration_sec: Math.max(0.5, Math.round(seconds * 100) / 100) } : {}), response_format: 'mp3' }), // no `seconds` = the voice's natural pace
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw await failure(res, '配音');
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('audio')) throw new Error(`MOSI 配音返回的不是音频（${type}）`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  return out;
}
