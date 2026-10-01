// Storyboard stills with MiniMax image-01 (pay-as-you-go key, same account as H3). A character shot
// passes the presenter photo as a subject reference so the same person appears in every still.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './env.mjs';

const mime = f => ({ '.png': 'image/png', '.webp': 'image/webp' }[path.extname(f).toLowerCase()] || 'image/jpeg');
const SAME_PERSON = ' She is the same person as in the reference photo: same face, hair and age.';

/** One 9:16 image. Returns { file }. Throws a readable error; never retries (each call is billed). */
export async function generateStill({ prompt, referenceFile = null, character = false, out }) {
  if (!config.minimax.key) throw new Error('MINIMAX_API_KEY 未配置（写入 apps/studio/.env.local）');
  const body = { model: 'image-01', prompt: String(prompt).slice(0, 1400) + (character && referenceFile ? SAME_PERSON : ''), aspect_ratio: '9:16', response_format: 'url', n: 1, prompt_optimizer: false };
  if (character && referenceFile) body.subject_reference = [{ type: 'character', image_file: `data:${mime(referenceFile)};base64,${(await readFile(referenceFile)).toString('base64')}` }];
  const res = await fetch(`${config.minimax.base}/v1/image_generation`, {
    method: 'POST', headers: { Authorization: `Bearer ${config.minimax.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
  });
  const json = await res.json().catch(() => ({}));
  const url = json.data?.image_urls?.[0];
  if (!url) throw new Error(`image-01 没有返回图片：${json.base_resp?.status_msg || `HTTP ${res.status}`}`);
  const img = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!img.ok) throw new Error(`下载分镜图失败 HTTP ${img.status}`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(await img.arrayBuffer()));
  return { file: out };
}
