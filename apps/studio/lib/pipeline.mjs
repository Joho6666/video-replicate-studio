import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './env.mjs';
import { jobDir, log, saveJob, setStage } from './jobs.mjs';
import { detectShots, extractKeyframes, probe } from './media.mjs';
import { adopt, crawlWithMediaCrawler, fetchWithTikHub, PLATFORMS } from './sources.mjs';
import { runDirector } from './director.mjs';

const running = new Set();
export const isRunning = id => running.has(id);

async function stage(job, id, fn) {
  await setStage(job, id, 'running');
  try {
    const result = await fn();
    await setStage(job, id, 'done');
    return result;
  } catch (error) {
    log(job, error.message || String(error), 'error');
    await setStage(job, id, 'failed', { error: error.message || String(error) });
    throw error;
  }
}

async function fetchSource(job, root) {
  const { platform, url } = job.source;
  const onLog = message => { log(job, message); saveJob(job).catch(() => {}); };
  if (platform === 'local') return;
  let result;
  if (PLATFORMS[platform]?.crawler) {
    try {
      onLog(`MediaCrawler 抓取 ${PLATFORMS[platform].label}（首次需在弹出的浏览器里扫码登录）`);
      result = await crawlWithMediaCrawler({ platform, url, workDir: root, onLog });
    } catch (error) {
      if (platform !== 'douyin' || !config.tikhub.key) throw error;
      onLog(`MediaCrawler 失败：${error.message}；改用 TikHub`, 'warn');
      result = await fetchWithTikHub({ platform, url, workDir: root, onLog });
    }
  } else {
    result = await fetchWithTikHub({ platform, url, workDir: root, onLog });
  }
  job.media = { ...job.media, ...(await adopt(result, root)) };
  job.meta = { ...job.meta, ...result.meta, platformLabel: PLATFORMS[platform].label };
  onLog(`原片已保存（${result.meta.engine}）`);
}

export async function runPipeline(job, { from = 'fetch' } = {}) {
  if (running.has(job.id)) throw new Error('任务正在运行');
  running.add(job.id);
  const root = jobDir(job.id);
  const order = ['fetch', 'probe', 'shots', 'director'];
  const skip = id => order.indexOf(id) < order.indexOf(from);
  job.status = 'running';
  for (const id of order) if (!skip(id)) job.stages[id] = { status: 'pending' };
  await saveJob(job);
  try {
    if (!skip('fetch')) await stage(job, 'fetch', () => fetchSource(job, root));
    if (!skip('probe')) await stage(job, 'probe', async () => {
      const info = await probe(path.join(root, job.media.video));
      job.media = { ...job.media, ...info, analyzedSec: Math.min(info.duration, config.analyzeMaxSec) };
      log(job, `${info.width}×${info.height} · ${info.fps}fps · ${info.duration.toFixed(1)}s${info.duration > config.analyzeMaxSec ? `（长视频，只拆前 ${config.analyzeMaxSec}s）` : ''}`);
    });
    if (!skip('shots')) await stage(job, 'shots', async () => {
      const shots = await detectShots(path.join(root, job.media.video), job.media.analyzedSec);
      await extractKeyframes(path.join(root, job.media.video), shots, path.join(root, 'shots'));
      job.shots = shots;
      job.director = null;
      log(job, `切出 ${shots.length} 个镜头（${shots.filter(s => s.cut === 'hard').length} 个硬切）`);
    });
    if (!skip('director')) await stage(job, 'director', async () => {
      job.director = await runDirector({ job, root, onLog: (m, l) => { log(job, m, l); saveJob(job).catch(() => {}); } });
      await writeFile(path.join(root, 'director.json'), JSON.stringify(job.director, null, 2));
      const u = job.director.usage;
      log(job, `提示词完成${u ? `（${u.prompt_tokens} + ${u.completion_tokens} tokens）` : ''}`);
    });
    job.status = 'done';
  } catch {
    job.status = 'failed';
  } finally {
    running.delete(job.id);
    await saveJob(job);
  }
}
