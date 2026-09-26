import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './env.mjs';

export const JOBS_DIR = path.join(DATA_DIR, 'jobs');
export const jobDir = id => {
  if (!/^[a-z0-9-]{8,40}$/.test(id)) throw new Error('非法任务 ID');
  return path.join(JOBS_DIR, id);
};

export const STAGES = [
  { id: 'fetch', label: '抓取原片' },
  { id: 'probe', label: '解析媒体' },
  { id: 'shots', label: '镜头切分' },
  { id: 'director', label: '导演拆解' },
];

const cache = new Map();

export async function createJob(input) {
  const id = `${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8)}`;
  const job = {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'running',
    source: input.source,
    stages: Object.fromEntries(STAGES.map(s => [s.id, { status: 'pending' }])),
    logs: [],
    meta: {},
    media: {},
    shots: [],
    director: null,
    brief: input.brief || {},
    assets: [],
  };
  await mkdir(jobDir(id), { recursive: true });
  await saveJob(job);
  return job;
}

export async function saveJob(job) {
  job.updatedAt = new Date().toISOString();
  cache.set(job.id, job);
  const file = path.join(jobDir(job.id), 'job.json');
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(job, null, 2));
  await rename(tmp, file);
  return job;
}

export async function loadJob(id) {
  if (cache.has(id)) return cache.get(id);
  const job = JSON.parse(await readFile(path.join(jobDir(id), 'job.json'), 'utf8'));
  // A server restart interrupts whatever was running; never resume silently.
  if (job.status === 'running') {
    job.status = 'failed';
    for (const stage of Object.values(job.stages)) if (stage.status === 'running') { stage.status = 'failed'; stage.error = '服务重启，任务中断'; }
    await saveJob(job);
  }
  cache.set(id, job);
  return job;
}

export async function listJobs() {
  await mkdir(JOBS_DIR, { recursive: true });
  const ids = (await readdir(JOBS_DIR, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name);
  const jobs = [];
  for (const id of ids) {
    try { jobs.push(await loadJob(id)); } catch { /* skip broken */ }
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function log(job, message, level = 'info') {
  job.logs.push({ at: new Date().toISOString(), level, message: String(message).slice(0, 600) });
  if (job.logs.length > 300) job.logs.splice(0, job.logs.length - 300);
}

export async function setStage(job, stage, status, extra = {}) {
  job.stages[stage] = { ...job.stages[stage], status, ...extra, [`${status}At`]: new Date().toISOString() };
  await saveJob(job);
}
