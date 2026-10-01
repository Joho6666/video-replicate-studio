import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CRAWLER_DIR, config, tools } from './env.mjs';

export const PLATFORMS = {
  douyin: { label: '抖音', crawler: 'dy' },
  bilibili: { label: 'B站', crawler: 'bili' },
  tiktok: { label: 'TikTok' },
  instagram: { label: 'Instagram' },
  local: { label: '本地上传' },
  script: { label: '脚本' },
};

/** Share text often wraps the link in prose ("7.9 复制打开抖音… https://v.douyin.com/x/ …"). */
export function extractUrl(text) {
  const match = String(text || '').match(/https?:\/\/[^\s<>"'，。！]+/i);
  return match ? match[0].replace(/[)\]}>,.;]+$/, '') : null;
}

export function detectPlatform(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const is = d => host === d || host.endsWith(`.${d}`);
  if (is('douyin.com') || is('iesdouyin.com')) return 'douyin';
  if (is('bilibili.com') || is('b23.tv')) return 'bilibili';
  if (is('tiktok.com')) return 'tiktok';
  if (is('instagram.com')) return 'instagram';
  return null;
}

async function findFiles(dir, predicate, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await findFiles(full, predicate, out);
    else if (predicate(e.name, full)) out.push(full);
  }
  return out;
}

const num = v => (v === undefined || v === null || v === '' || v === 'None' || Number.isNaN(Number(v)) ? undefined : Number(v));

function crawlerMeta(platform, row) {
  if (!row) return {};
  if (platform === 'douyin') return {
    id: row.aweme_id, title: row.title || row.desc, author: row.nickname, url: row.aweme_url,
    publishedAt: num(row.create_time) ? new Date(num(row.create_time) * 1000).toISOString() : undefined,
    metrics: { likes: num(row.liked_count), comments: num(row.comment_count), shares: num(row.share_count), favorites: num(row.collected_count) },
  };
  return {
    id: row.video_id, title: row.title, description: row.desc, author: row.nickname, url: row.video_url,
    publishedAt: num(row.create_time) ? new Date(num(row.create_time) * 1000).toISOString() : undefined,
    metrics: { views: num(row.video_play_count), likes: num(row.liked_count), comments: num(row.video_comment), shares: num(row.video_share_count), favorites: num(row.video_favorite_count) },
  };
}

let crawlerBusy = Promise.resolve();

/** MediaCrawler writes into a per-job folder; the saved login lives in apps/media-crawler/browser_data. */
export function crawlWithMediaCrawler({ platform, url, workDir, onLog }) {
  const run = async () => {
    if (!tools.crawlerPython) throw new Error('MediaCrawler 的 Python 环境未安装（apps/media-crawler/.venv）');
    const out = path.join(workDir, 'crawl');
    await mkdir(out, { recursive: true });
    const args = ['main.py', '--platform', PLATFORMS[platform].crawler, '--lt', 'qrcode', '--type', 'detail', '--specified_id', url, '--get_media', 'yes', '--get_comment', 'no', '--save_data_option', 'jsonl', '--save_data_path', out];
    const pathExtra = [tools.ffmpeg && path.dirname(tools.ffmpeg)].filter(Boolean);
    await new Promise((resolve, reject) => {
      const child = spawn(tools.crawlerPython, args, {
        cwd: CRAWLER_DIR,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PATH: [...pathExtra, process.env.PATH].join(path.delimiter) },
        windowsHide: false,
      });
      const timer = setTimeout(() => { child.kill(); reject(new Error('抓取超时（10 分钟）。若弹出登录页，请先扫码登录。')); }, 10 * 60_000);
      let tail = '';
      const onData = chunk => {
        const text = chunk.toString('utf8');
        tail = (tail + text).slice(-4000);
        for (const line of text.split(/\r?\n/)) {
          const clean = line.replace(/^\S+ \S+ MediaCrawler\S* \w+ \([^)]*\) - /, '').trim();
          if (clean && /下载完成|扫码|登录|qrcode|Crawler finished|Error|失败|超时/i.test(clean)) onLog(clean.slice(0, 240));
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', err => { clearTimeout(timer); reject(err); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve(); else reject(new Error(`MediaCrawler 退出码 ${code}：${tail.split(/\r?\n/).filter(Boolean).slice(-2).join(' ')}`));
      });
    });
    const videos = await findFiles(out, name => /^video\.(mp4|mov|flv)$/i.test(name));
    if (!videos.length) throw new Error('MediaCrawler 未下载到视频（链接可能是图文、已删除，或需要登录）');
    const video = videos[0];
    const cover = (await findFiles(path.dirname(video), name => /^cover\./i.test(name)))[0];
    const jsonl = await findFiles(out, name => name.endsWith('.jsonl') && name.includes('contents'));
    let row;
    for (const file of jsonl) {
      const lines = (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean);
      if (lines.length) { row = JSON.parse(lines[lines.length - 1]); break; }
    }
    return { video, cover, meta: { ...crawlerMeta(platform, row), engine: 'MediaCrawler' } };
  };
  const next = crawlerBusy.then(run, run);
  crawlerBusy = next.catch(() => {});
  return next;
}

async function tikhub(pathname, params) {
  if (!config.tikhub.key) throw new Error('TikHub API Key 未配置（apps/studio/.env.local 的 TIKHUB_API_KEY）');
  const url = new URL(config.tikhub.base + pathname);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${config.tikhub.key}` }, signal: AbortSignal.timeout(30_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`TikHub HTTP ${res.status}：${body?.detail?.message || body?.message || ''}`.trim());
  return body;
}

const first = (...v) => v.find(x => x !== undefined && x !== null && x !== '');

function normalizeTikHub(raw, platform) {
  const envelope = raw?.data && typeof raw.data === 'object' ? raw.data : raw || {};
  const data = envelope.aweme_detail || envelope.item_info?.item_list?.[0] || envelope.items?.[0] || envelope;
  const author = first(data.author, data.user, data.owner) || {};
  const stats = first(data.statistics, data.stats) || {};
  const video = data.video || {};
  const videoUrl = first(
    video.play_addr?.url_list?.[0], video.download_addr?.url_list?.[0], video.bit_rate?.[0]?.play_addr?.url_list?.[0],
    data.video_versions?.[0]?.url, data.video_url, data.play_url,
  );
  const cover = first(video.cover?.url_list?.[0], video.origin_cover?.url_list?.[0], data.image_versions2?.candidates?.[0]?.url, data.thumbnail_url, data.display_url);
  const caption = first(data.desc, typeof data.caption === 'object' ? data.caption?.text : data.caption, data.title);
  return {
    videoUrl, cover,
    meta: {
      id: String(first(data.aweme_id, data.id, data.pk, data.code, '')),
      title: caption,
      author: first(author.nickname, author.full_name, author.username, author.unique_id),
      metrics: {
        views: num(first(stats.play_count, data.play_count, data.view_count)),
        likes: num(first(stats.digg_count, data.like_count)),
        comments: num(first(stats.comment_count, data.comment_count)),
        shares: num(first(stats.share_count, data.share_count)),
      },
      engine: 'TikHub',
    },
  };
}

async function download(url, file, referer) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36', ...(referer ? { Referer: referer } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`);
  const size = Number(res.headers.get('content-length') || 0);
  if (size > 500 * 1024 * 1024) throw new Error('视频超过 500 MB');
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  if ((await stat(file)).size < 10_000) throw new Error('下载的文件过小，可能不是视频');
  return file;
}

export async function fetchWithTikHub({ platform, url, workDir, onLog }) {
  const endpoint = {
    douyin: ['/api/v1/douyin/app/v3/fetch_one_video_by_share_url', { share_url: url }],
    tiktok: ['/api/v1/tiktok/app/v3/fetch_one_video_by_share_url', { share_url: url }],
    instagram: ['/api/v1/instagram/v3/get_post_info', { url }],
  }[platform];
  if (!endpoint) throw new Error(`${PLATFORMS[platform]?.label || platform} 暂不支持 TikHub 抓取`);
  onLog(`TikHub 解析 ${PLATFORMS[platform].label} 链接`);
  const parsed = normalizeTikHub(await tikhub(...endpoint), platform);
  if (!parsed.videoUrl) throw new Error('TikHub 未返回视频地址（可能是图文帖或私密内容）');
  const dir = path.join(workDir, 'source');
  await mkdir(dir, { recursive: true });
  onLog('下载原片');
  const video = await download(parsed.videoUrl, path.join(dir, 'video.mp4'), platform === 'douyin' ? 'https://www.douyin.com/' : undefined);
  let cover;
  if (parsed.cover) cover = await download(parsed.cover, path.join(dir, 'cover.jpg')).catch(() => undefined);
  return { video, cover, meta: { ...parsed.meta, url } };
}

/** Copies the fetched files into the job's canonical layout. */
export async function adopt(result, workDir) {
  const dir = path.join(workDir, 'source');
  await mkdir(dir, { recursive: true });
  const video = path.join(dir, 'video.mp4');
  if (path.resolve(result.video) !== path.resolve(video)) await copyFile(result.video, video);
  let cover;
  if (result.cover) {
    cover = path.join(dir, `cover${path.extname(result.cover) || '.jpg'}`);
    if (path.resolve(result.cover) !== path.resolve(cover)) await copyFile(result.cover, cover);
  }
  return { video: 'source/video.mp4', cover: cover ? `source/${path.basename(cover)}` : undefined };
}
