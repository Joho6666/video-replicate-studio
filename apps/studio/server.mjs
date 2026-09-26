import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm, stat, unlink } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config, env, STUDIO_DIR, tools } from './lib/env.mjs';
import { copyMarkdown, runCopywriter, TARGETS, TONES } from './lib/copywriter.mjs';
import { buildExport, libtvMarkdown, REF_STYLES } from './lib/export.mjs';
import { createJob, jobDir, listJobs, loadJob, log, saveJob } from './lib/jobs.mjs';
import { isRunning, runPipeline } from './lib/pipeline.mjs';
import { detectPlatform, extractUrl, PLATFORMS } from './lib/sources.mjs';

const PUBLIC = path.join(STUDIO_DIR, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.md': 'text/markdown; charset=utf-8' };

const send = (res, status, body, headers = {}) => {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
};

async function readJson(req, limit = 1_000_000) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('请求过大'), { status: 413 }); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function serveFile(req, res, file) {
  let info;
  try { info = await stat(file); } catch { return send(res, 404, 'not found'); }
  if (!info.isFile()) return send(res, 404, 'not found');
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(info.size - Number(range[2]), 0);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start >= info.size || start > end) return send(res, 416, '', { 'Content-Range': `bytes */${info.size}` });
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(res);
}

const within = (base, rel) => {
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw Object.assign(new Error('路径越界'), { status: 400 });
  return full;
};

function summary(job) {
  return {
    id: job.id, createdAt: job.createdAt, status: job.status, platform: job.source.platform, platformLabel: PLATFORMS[job.source.platform]?.label,
    title: job.meta.title, author: job.meta.author, likes: job.meta.metrics?.likes, cover: job.media.cover || job.shots[0]?.keyframe, duration: job.media.duration,
    shots: job.shots.length, hasPrompts: Boolean(job.director), running: isRunning(job.id),
  };
}

async function health() {
  return {
    engines: {
      mediacrawler: { ok: Boolean(tools.crawlerPython), label: 'MediaCrawler', note: tools.crawlerPython ? '抖音 · B站' : '未安装 .venv' },
      tikhub: { ok: Boolean(config.tikhub.key), label: 'TikHub', note: config.tikhub.key ? 'TikTok · IG · 抖音备用' : '未配置 Key' },
      deepseek: { ok: Boolean(config.deepseek.key), label: 'DeepSeek', note: config.deepseek.key ? config.deepseek.model : '未配置 Key' },
      ffmpeg: { ok: Boolean(tools.ffmpeg && tools.ffprobe), label: 'FFmpeg', note: tools.ffmpeg ? '镜头切分' : '未找到' },
    },
    analyzeMaxSec: config.analyzeMaxSec,
  };
}

const ALLOWED_IMAGE = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const mutating = req.method !== 'GET' && req.method !== 'HEAD';
  if (mutating && req.headers['x-studio'] !== '1') return send(res, 403, { error: 'forbidden' });

  if (parts[0] === 'api') {
    if (parts[1] === 'health') return send(res, 200, await health());

    if (parts[1] === 'jobs' && parts.length === 2) {
      if (req.method === 'GET') return send(res, 200, (await listJobs()).map(summary));
      if (req.method === 'POST') {
        const body = await readJson(req);
        const link = extractUrl(body.text);
        if (!link) return send(res, 400, { error: '没有识别到链接，请粘贴分享文案或视频地址' });
        const platform = detectPlatform(link);
        if (!platform) return send(res, 400, { error: '暂只支持 抖音 / B站 / TikTok / Instagram 链接' });
        const job = await createJob({ source: { platform, url: link, input: String(body.text).slice(0, 1000) }, brief: body.brief });
        runPipeline(job).catch(() => {});
        return send(res, 201, summary(job));
      }
    }

    if (parts[1] === 'upload' && req.method === 'POST') {
      const name = (url.searchParams.get('name') || 'upload.mp4').slice(0, 120);
      const job = await createJob({ source: { platform: 'local', url: null, input: name } });
      const root = jobDir(job.id);
      await mkdir(path.join(root, 'source'), { recursive: true });
      let size = 0;
      req.on('data', c => { size += c.length; if (size > 800 * 1024 * 1024) req.destroy(new Error('文件超过 800 MB')); });
      await pipeline(req, createWriteStream(path.join(root, 'source', 'video.mp4')));
      job.media.video = 'source/video.mp4';
      job.meta = { title: name.replace(/\.[^.]+$/, ''), platformLabel: '本地上传', engine: '本地文件' };
      job.stages.fetch = { status: 'done', doneAt: new Date().toISOString() };
      log(job, `已上传 ${name}（${(size / 1048576).toFixed(1)} MB）`);
      await saveJob(job);
      runPipeline(job, { from: 'probe' }).catch(() => {});
      return send(res, 201, summary(job));
    }

    if (parts[1] === 'jobs' && parts[2]) {
      const job = await loadJob(parts[2]).catch(() => null);
      if (!job) return send(res, 404, { error: '任务不存在' });
      const root = jobDir(job.id);
      const action = parts[3];

      if (!action && req.method === 'GET') return send(res, 200, { ...job, running: isRunning(job.id) });
      if (!action && req.method === 'DELETE') {
        if (isRunning(job.id)) return send(res, 409, { error: '任务运行中，稍后再删' });
        await rm(root, { recursive: true, force: true });
        return send(res, 200, { ok: true });
      }
      if (action === 'brief' && req.method === 'POST') {
        const b = await readJson(req);
        job.brief = Object.fromEntries(['product', 'notes', 'model', 'style'].map(k => [k, String(b[k] || '').slice(0, 1500)]));
        await saveJob(job);
        return send(res, 200, job.brief);
      }
      if (action === 'assets' && req.method === 'POST') {
        const role = url.searchParams.get('role');
        const ext = ALLOWED_IMAGE[String(req.headers['content-type']).split(';')[0]];
        if (!['model', 'product'].includes(role) || !ext) return send(res, 400, { error: '只支持 JPG / PNG / WebP 的模特或商品图' });
        await mkdir(path.join(root, 'assets'), { recursive: true });
        const rel = `assets/${role}-${Date.now()}${ext}`;
        let size = 0;
        req.on('data', c => { size += c.length; if (size > 20 * 1024 * 1024) req.destroy(new Error('图片超过 20 MB')); });
        await pipeline(req, createWriteStream(path.join(root, rel)));
        for (const old of job.assets.filter(a => a.role === role)) await unlink(path.join(root, old.file)).catch(() => {});
        job.assets = [...job.assets.filter(a => a.role !== role), { role, file: rel }];
        await saveJob(job);
        return send(res, 200, job.assets);
      }
      if (action === 'assets' && req.method === 'DELETE') {
        const role = parts[4];
        for (const old of job.assets.filter(a => a.role === role)) await unlink(path.join(root, old.file)).catch(() => {});
        job.assets = job.assets.filter(a => a.role !== role);
        await saveJob(job);
        return send(res, 200, job.assets);
      }
      if (action === 'rerun' && req.method === 'POST') {
        const { from = 'director' } = await readJson(req);
        if (!['fetch', 'probe', 'shots', 'director'].includes(from)) return send(res, 400, { error: 'bad stage' });
        if (from === 'fetch' && job.source.platform === 'local') return send(res, 400, { error: '本地文件无需重新抓取' });
        if (isRunning(job.id)) return send(res, 409, { error: '任务正在运行' });
        runPipeline(job, { from }).catch(() => {});
        return send(res, 202, { ok: true });
      }
      if (action === 'export' && req.method === 'POST') {
        const { style = 'en' } = await readJson(req);
        const out = await buildExport(job, REF_STYLES[style] ? style : 'en');
        job.exportedAt = new Date().toISOString();
        await saveJob(job);
        return send(res, 200, { path: out });
      }
      if (action === 'open' && req.method === 'POST') {
        const target = existsSync(path.join(root, 'export')) ? path.join(root, 'export') : root;
        spawn(process.platform === 'win32' ? 'explorer.exe' : 'open', [target], { detached: true, stdio: 'ignore' }).unref();
        return send(res, 200, { path: target });
      }
      if (action === 'copy' && req.method === 'POST') {
        const { tone = 'seed', target = 'douyin' } = await readJson(req);
        if (!TONES[tone] || !TARGETS[target]) return send(res, 400, { error: '未知的文案风格或平台' });
        if (job.copyRunning) return send(res, 409, { error: '文案正在生成' });
        job.copyRunning = true;
        try {
          log(job, `DeepSeek 写${TARGETS[target]}${TONES[tone]}文案`);
          job.copy = await runCopywriter(job, { tone, target });
          log(job, `文案完成（${job.copy.titles.length} 条标题 · ${job.copy.voiceover.length} 段口播 · ${job.copy.captions.length} 条字幕）`);
        } catch (error) {
          log(job, `文案失败：${error.message}`, 'error');
          throw error;
        } finally {
          job.copyRunning = false;
          await saveJob(job);
        }
        return send(res, 200, job.copy);
      }
      if (action === 'copy.md' && req.method === 'GET') {
        if (!job.copy) return send(res, 404, { error: '还没有文案' });
        return send(res, 200, copyMarkdown(job), { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`带货文案-${job.id}.md`)}` });
      }
      if (action === 'libtv.md' && req.method === 'GET') {
        if (!job.director) return send(res, 404, { error: '提示词还没生成' });
        const style = REF_STYLES[url.searchParams.get('style')] ? url.searchParams.get('style') : 'en';
        return send(res, 200, libtvMarkdown(job, style), { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`LibTV提示词-${job.id}.md`)}` });
      }
    }
    return send(res, 404, { error: 'not found' });
  }

  if (parts[0] === 'files' && parts[1]) {
    const root = jobDir(parts[1]);
    return serveFile(req, res, within(root, parts.slice(2).join('/')));
  }

  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = within(PUBLIC, rel);
  if (existsSync(file)) return serveFile(req, res, file);
  return serveFile(req, res, path.join(PUBLIC, 'index.html'));
}

const server = http.createServer((req, res) => {
  route(req, res).catch(error => {
    if (!res.headersSent) send(res, error.status || 500, { error: error.message || String(error) });
    else res.destroy();
  });
});

// Node's fetch ignores HTTP(S)_PROXY unless NODE_USE_ENV_PROXY is set at startup;
// TikHub / TikTok / Instagram are only reachable through the local proxy here.
const proxy = env.STUDIO_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxy && !process.env.NODE_USE_ENV_PROXY) {
  const child = spawn(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1', STUDIO_PARENT: String(process.pid), HTTPS_PROXY: proxy, HTTP_PROXY: proxy, NO_PROXY: process.env.NO_PROXY || 'localhost,127.0.0.1,::1' } });
  child.on('exit', code => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
} else {
  // Respawned child: exit when the launcher dies (Windows does not kill children).
  const parent = Number(process.env.STUDIO_PARENT);
  if (parent) setInterval(() => { try { process.kill(parent, 0); } catch { process.exit(0); } }, 2000).unref();
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`\n  复刻工作台  →  http://127.0.0.1:${config.port}${proxy ? `（外网经代理 ${proxy.replace(/\/\/[^@]*@/, '//')}）` : ''}\n`);
    health().then(h => { for (const e of Object.values(h.engines)) console.log(`  ${e.ok ? '●' : '○'} ${e.label.padEnd(13)} ${e.note}`); console.log(''); });
  });
}

