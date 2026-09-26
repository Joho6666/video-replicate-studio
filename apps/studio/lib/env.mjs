import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STUDIO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = path.resolve(STUDIO_DIR, '..', '..');
export const CRAWLER_DIR = path.join(REPO_DIR, 'apps', 'media-crawler');
export const DATA_DIR = process.env.STUDIO_DATA_DIR || path.join(STUDIO_DIR, 'data');

function parseEnvFile(file) {
  if (!file || !existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** process.env > apps/studio/.env.local > AVD_ENV_FILE (only non-empty values count). */
export function loadEnv() {
  const local = parseEnvFile(path.join(STUDIO_DIR, '.env.local'));
  const linked = parseEnvFile(process.env.AVD_ENV_FILE || local.AVD_ENV_FILE);
  const env = {};
  for (const source of [linked, local, process.env]) {
    for (const [k, v] of Object.entries(source)) if (v !== undefined && v !== '') env[k] = v;
  }
  return env;
}

export const env = loadEnv();

function which(names) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) for (const name of names) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export const tools = {
  ffmpeg: env.FFMPEG_PATH || which(['ffmpeg.exe', 'ffmpeg']),
  ffprobe: env.FFPROBE_PATH || which(['ffprobe.exe', 'ffprobe']),
  crawlerPython: [path.join(CRAWLER_DIR, '.venv', 'Scripts', 'python.exe'), path.join(CRAWLER_DIR, '.venv', 'bin', 'python')].find(existsSync) || null,
};

export const config = {
  port: Number(env.STUDIO_PORT || 3300),
  analyzeMaxSec: Math.min(Math.max(Number(env.ANALYZE_MAX_SEC || 60), 10), 180),
  deepseek: { key: env.DEEPSEEK_API_KEY || '', base: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''), model: env.DEEPSEEK_MODEL || 'deepseek-flash' },
  tikhub: { key: env.TIKHUB_API_KEY || '', base: (env.TIKHUB_BASE_URL || 'https://api.tikhub.io').replace(/\/$/, '') },
};
