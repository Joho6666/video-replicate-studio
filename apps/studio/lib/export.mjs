import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { jobDir } from './jobs.mjs';
import { cutClip } from './media.mjs';
import { copyMarkdown } from './copywriter.mjs';
import { refMap } from './refs.mjs';

const tc = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** LibTV's Chinese UI names uploads @图片1; the English form suits Seedance/Dreamina; Wan uses "Image 1". */
export const REF_STYLES = {
  en: { label: '@Image1', fmt: (kind, n) => `@${kind === 'v' ? 'Video' : 'Image'}${n}` },
  zh: { label: '@图片1', fmt: (kind, n) => `@${kind === 'v' ? '视频' : '图片'}${n}` },
  plain: { label: 'Image 1', fmt: (kind, n) => `${kind === 'v' ? 'Video' : 'Image'} ${n}` },
};
export const refToken = (token, style = 'en') => {
  const m = String(token).match(/^@(Video|Image)(\d+)$/);
  return m ? (REF_STYLES[style] || REF_STYLES.en).fmt(m[1] === 'Video' ? 'v' : 'i', m[2]) : token;
};
export const applyRefs = (text, style = 'en') => String(text || '').replace(/@(?:Video|Image)\d+/g, m => refToken(m, style));

const ROLE_NAME = { model: '模特', product: '衣服商品', style: '效果参考' };
const assetName = (r, style) => `${refToken(r.token, style).replace(/[@\s]/g, '')}_${ROLE_NAME[r.role]}${path.extname(r.file || '.jpg')}`;

const segPrompt = s => s.prompt_en ?? s.prompt ?? '';

export function libtvMarkdown(job, style = 'en') {
  const d = job.director;
  const R = k => refToken(k, style);
  const refs = d.refs || refMap(job.assets);
  const lines = [
    `# LibTV 复刻提示词 · ${job.meta.title?.split('\n')[0]?.slice(0, 40) || job.id}`,
    '',
    `来源：${job.meta.platformLabel || ''} ${job.source.url || ''}`,
    `分析窗口：前 ${job.media.analyzedSec?.toFixed(1)}s · ${job.shots.length} 个镜头 · ${d.segments.length} 段生成（每段 ≤15s）`,
    `导演规则：${d.version || 'studio-director'}`,
    '',
    '## 素材上传对照',
    '',
    '| 编号 | 上传文件 |',
    '| :--- | :--- |',
    `| ${R('@Video1')} | \`参考片段/\` 里对应段的 mp4（每段单独上传，只作运镜与节奏参考） |`,
    ...refs.map(r => `| ${R(r.token)} | ${r.label}${r.file ? `：\`替换素材/${path.basename(assetName(r, style))}\`` : '（未上传）'} |`),
    '',
    ...(d.goal ? ['## 想要的效果', '', d.goal, ''] : []),
    ...(d.analysis?.goal_plan ? ['## 实现方案', '', d.analysis.goal_plan, ''] : []),
  ];
  for (const s of d.segments) {
    lines.push(`## 第 ${s.index} 段 · ${tc(s.start)}–${tc(s.end)}（${s.duration}s）`, '');
    if (s.note_zh) lines.push(`> ${s.note_zh}`, '');
    lines.push(`上传 ${R('@Video1')}：\`参考片段/段${s.index}_${s.duration}s.mp4\``, '', '**Prompt**', '', '```', applyRefs(segPrompt(s), style), '```', '');
    if (s.negative_en) lines.push('**Negative**', '', '```', applyRefs(s.negative_en, style), '```', '');
  }
  if (d.negative) lines.push('## 负面约束', '', '```', d.negative, '```', '');
  return lines.join('\n');
}

export function shotTableMarkdown(job, style = 'en') {
  const d = job.director;
  const a = d.analysis;
  const lines = [
    '# 爆款拆解', '',
    `- **钩子**：${a.hook}`, `- **结构**：${a.structure}`, `- **风格**：${a.visual_style}`, `- **节奏**：${a.rhythm}`,
    `- **声音**：${a.audio_guess || '不确定'}`,
    ...(a.why_it_works || []).map(x => `- **爆点**：${x}`),
    '', '# 分镜表', '',
    '| # | 时间 | 景别 | 运镜 | 画面 | 替换 | Prompt |', '| :-: | :-- | :-- | :-- | :-- | :-- | :-- |',
  ];
  job.shots.forEach((shot, i) => {
    const s = d.shots[i] || {};
    const cell = v => String(v ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
    lines.push(`| ${shot.index} | ${tc(shot.start)}–${tc(shot.end)} | ${cell(s.shot_size)} | ${cell(s.camera)} | ${cell(`${s.subject || ''}，${s.action || ''}`)} | ${cell(s.replace_note)} | ${cell(applyRefs(s.prompt_en ?? s.prompt, style))} |`);
  });
  return lines.join('\n');
}

export async function buildExport(job, style = 'en') {
  if (!job.director) throw new Error('提示词还没生成');
  const root = jobDir(job.id);
  const out = path.join(root, 'export');
  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, '参考片段'), { recursive: true });
  for (const s of job.director.segments) {
    await cutClip(path.join(root, job.media.video), s.start, s.duration, path.join(out, '参考片段', `段${s.index}_${s.duration}s.mp4`));
  }
  const refs = (job.director.refs || refMap(job.assets)).filter(r => r.file);
  if (refs.length) {
    await mkdir(path.join(out, '替换素材'), { recursive: true });
    for (const r of refs) await copyFile(path.join(root, r.file), path.join(out, '替换素材', assetName(r, style)));
  }
  await writeFile(path.join(out, 'LibTV提示词.md'), libtvMarkdown(job, style));
  await writeFile(path.join(out, '分镜拆解.md'), shotTableMarkdown(job, style));
  if (job.copy) await writeFile(path.join(out, '带货文案.md'), copyMarkdown(job));
  await writeFile(path.join(out, 'director.json'), JSON.stringify({ source: job.source, meta: job.meta, media: job.media, shots: job.shots, director: job.director }, null, 2));
  return out;
}
