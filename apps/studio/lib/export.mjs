import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { jobDir } from './jobs.mjs';
import { cutClip } from './media.mjs';

const tc = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export function libtvMarkdown(job) {
  const d = job.director;
  const lines = [
    `# LibTV 复刻提示词 · ${job.meta.title?.split('\n')[0]?.slice(0, 40) || job.id}`,
    '',
    `来源：${job.meta.platformLabel || ''} ${job.source.url || ''}`,
    `分析窗口：前 ${job.media.analyzedSec?.toFixed(1)}s · ${job.shots.length} 个镜头 · ${d.segments.length} 段生成（每段 ≤15s）`,
    '',
    '## 素材上传对照',
    '',
    '| 编号 | 上传文件 |',
    '| :--- | :--- |',
    '| @视频1 | `参考片段/` 里对应段的 mp4（每段单独上传） |',
    '| @图片1 | 替换模特图 |',
    '| @图片2 | 替换商品图 |',
    '',
  ];
  for (const s of d.segments) {
    lines.push(`## 第 ${s.index} 段 · ${tc(s.start)}–${tc(s.end)}（${s.duration}s）`, '', `上传 @视频1：\`参考片段/段${s.index}_${s.duration}s.mp4\``, '', '```', s.prompt, '```', '');
  }
  if (d.negative) lines.push('## 负面约束', '', '```', d.negative, '```', '');
  return lines.join('\n');
}

export function shotTableMarkdown(job) {
  const d = job.director;
  const a = d.analysis;
  const lines = [
    '# 爆款拆解', '',
    `- **钩子**：${a.hook}`, `- **结构**：${a.structure}`, `- **风格**：${a.visual_style}`, `- **节奏**：${a.rhythm}`,
    `- **声音**：${a.audio_guess || '不确定'}`,
    ...(a.why_it_works || []).map(x => `- **爆点**：${x}`),
    '', '# 分镜表', '',
    '| # | 时间 | 景别 | 运镜 | 画面 | 文字 | 提示词 |', '| :-: | :-- | :-- | :-- | :-- | :-- | :-- |',
  ];
  job.shots.forEach((shot, i) => {
    const s = d.shots[i] || {};
    const cell = v => String(v ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
    lines.push(`| ${shot.index} | ${tc(shot.start)}–${tc(shot.end)} | ${cell(s.shot_size)} | ${cell(s.camera)} | ${cell(`${s.subject || ''}，${s.action || ''}`)} | ${cell(s.on_screen_text)} | ${cell(s.prompt)} |`);
  });
  return lines.join('\n');
}

export async function buildExport(job) {
  if (!job.director) throw new Error('提示词还没生成');
  const root = jobDir(job.id);
  const out = path.join(root, 'export');
  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, '参考片段'), { recursive: true });
  for (const s of job.director.segments) {
    await cutClip(path.join(root, job.media.video), s.start, s.duration, path.join(out, '参考片段', `段${s.index}_${s.duration}s.mp4`));
  }
  if (job.assets?.length) {
    await mkdir(path.join(out, '替换素材'), { recursive: true });
    for (const asset of job.assets) {
      await copyFile(path.join(root, asset.file), path.join(out, '替换素材', `${asset.role === 'model' ? '图片1_模特' : '图片2_商品'}${path.extname(asset.file)}`));
    }
  }
  await writeFile(path.join(out, 'LibTV提示词.md'), libtvMarkdown(job));
  await writeFile(path.join(out, '分镜拆解.md'), shotTableMarkdown(job));
  await writeFile(path.join(out, 'director.json'), JSON.stringify({ source: job.source, meta: job.meta, media: job.media, shots: job.shots, director: job.director }, null, 2));
  return out;
}
