// wan2.2-animate-mix (DashScope): replaces the main person of a video with the person in an image, keeping the
// original motion, expressions and scene. Async: upload both files to the temporary oss:// store, create a task, poll.
// Clips must be 2–30 s. A hidden or cropped face fails fast with InvalidVideo.FullFace (and is not billed).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from './env.mjs';
import { ffrun } from './media.mjs';
import { tools } from './env.mjs';

export const MODEL = 'wan2.2-animate-mix';
const wait = ms => new Promise(r => setTimeout(r, ms));

export async function uploadTemp(file, name, { fetchImpl = fetch } = {}) {
  const { key, base } = config.wan;
  if (!key) throw new Error('缺少 WAN_API_KEY');
  const p = await (await fetchImpl(`${base}/api/v1/uploads?action=getPolicy&model=${MODEL}`, { headers: { Authorization: `Bearer ${key}` } })).json();
  const d = p.data;
  if (!d) throw new Error(`上传凭证获取失败：${JSON.stringify(p).slice(0, 200)}`);
  const objectKey = `${d.upload_dir}/${name}`;
  const form = new FormData();
  for (const [k, v] of [['OSSAccessKeyId', d.oss_access_key_id], ['Signature', d.signature], ['policy', d.policy], ['x-oss-object-acl', d.x_oss_object_acl], ['x-oss-forbid-overwrite', d.x_oss_forbid_overwrite], ['key', objectKey], ['success_action_status', '200']]) form.append(k, v);
  form.append('file', new Blob([await readFile(file)]), name);
  const r = await fetchImpl(d.upload_host, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`上传失败 HTTP ${r.status}`);
  return `oss://${objectKey}`;
}

/** Cuts [start, end) of the source into a standalone clip (re-encoded so the cut is frame-accurate). */
export async function cutWindow(source, { start, end }, out) {
  await mkdir(path.dirname(out), { recursive: true });
  await ffrun(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-t', String(end - start), '-i', source, '-an', '-vf', 'fps=30,scale=720:1280', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', out]);
  return out;
}

/**
 * Swaps the person in one clip. `onSubmitted(taskId)` is called the moment the task exists (the caller's ledger).
 * Resolves { file, usage }. Throws with the API code in the message (e.g. InvalidVideo.FullFace).
 */
export async function animateMix({ clip, image, mode = 'wan-pro', outFile, onSubmitted = () => {}, fetchImpl = fetch, pollMs = 15000, maxPolls = 120 }) {
  const { key, base } = config.wan;
  const A = { Authorization: `Bearer ${key}` };
  const [imageUrl, videoUrl] = [await uploadTemp(image, 'model.jpg', { fetchImpl }), await uploadTemp(clip, 'clip.mp4', { fetchImpl })];
  const res = await (await fetchImpl(`${base}/api/v1/services/aigc/image2video/video-synthesis`, {
    method: 'POST',
    headers: { ...A, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable', 'X-DashScope-OssResourceResolve': 'enable' },
    body: JSON.stringify({ model: MODEL, input: { image_url: imageUrl, video_url: videoUrl, watermark: false }, parameters: { mode } }),
  })).json();
  const id = res.output?.task_id;
  if (!id) throw new Error(`提交被拒：${res.code || ''} ${res.message || JSON.stringify(res).slice(0, 200)}`);
  onSubmitted(id);
  for (let i = 0; i < maxPolls; i++) {
    await wait(pollMs);
    const q = await (await fetchImpl(`${base}/api/v1/tasks/${id}`, { headers: A })).json();
    const st = q.output?.task_status;
    if (st === 'SUCCEEDED') {
      const buf = Buffer.from(await (await fetchImpl(q.output.results.video_url)).arrayBuffer());
      await mkdir(path.dirname(outFile), { recursive: true });
      await writeFile(outFile, buf);
      return { file: outFile, usage: q.usage };
    }
    if (st === 'FAILED' || st === 'CANCELED') throw Object.assign(new Error(`${q.output.code || st}：${q.output.message || ''}`), { final: true });   // answered: not billed, nothing pending
    if (st === 'UNKNOWN') throw new Error('任务状态未知（可能已过期）');
  }
  throw new Error('轮询超时，任务状态未知');
}
