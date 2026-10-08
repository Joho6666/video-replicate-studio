// The fixed composite step after a person swap (wan2.2-animate-mix): the model's 15 fps output is interpolated to the
// source frame rate, the swapped person is cut out with a video-matting model (RVM), and pasted onto the ORIGINAL
// frames — every pixel outside the (new ∪ old person) area is the original's own pixel, so the background keeps the
// camera's sharpness and stability. Optional AI upscaling (blended with a plain upscale) and grain finish it.
// This replaces the earlier "difference mask" approach, which dragged the model's re-drawn sky and buildings into the result.
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffrun, probe } from './media.mjs';
import { tools } from './env.mjs';

const PY_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'py', 'person_swap.py');

export const UPSCALE_MODES = ['off', 'blend', 'full'];

export const frameCount = (seconds, fps) => Math.max(1, Math.round(seconds * fps));

/** Which external pieces does this run need, and which are missing? (used for a clear error before any work starts) */
export function missingTools({ upscale = 'blend', needInterpolation = true } = {}, t = tools) {
  const out = [];
  if (!t.ffmpeg) out.push('FFmpeg');
  if (!t.python) out.push('Python（装好 opencv-python numpy onnxruntime，或在 .env.local 设 PYTHON_PATH）');
  if (!t.rvmModel) out.push('RVM 抠图模型（.env.local 设 RVM_MODEL=…rvm_mobilenetv3_fp32.onnx）');
  if (needInterpolation && !t.rife) out.push('RIFE 补帧（.env.local 设 RIFE_PATH=…rife-ncnn-vulkan.exe）');
  if (upscale !== 'off' && !t.realesrgan) out.push('Real-ESRGAN 放大（.env.local 设 REALESRGAN_PATH=…realesrgan-ncnn-vulkan.exe，或用 --upscale off）');
  return out;
}

const py = (args, t = tools) => ffrun(t.python, [PY_SCRIPT, ...args], { timeoutMs: 60 * 60_000 });
const count = async dir => (await readdir(dir)).filter(f => f.endsWith('.png')).length;
const fresh = async dir => { await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true }); };

/** Default stage implementations; every one can be replaced through `impl` (tests use stubs for the ML tools). */
export const defaultImpl = {
  /** RIFE: `n` frames from the frames in inDir (frame i of the result is at time (i-1)/(n-1) of the input). */
  async interpolate({ inDir, outDir, n }, t = tools) {
    await ffrun(t.rife, ['-i', inDir, '-o', outDir, '-m', path.join(path.dirname(t.rife), 'rife-v4.6'), '-n', String(n), '-f', '%04d.png'], { timeoutMs: 30 * 60_000 });
  },
  async matte({ framesDir, pattern, n, outDir }, t = tools) {
    await py(['matte', framesDir, pattern, String(n), outDir, '--model', t.rvmModel], t);
  },
  async upscale({ inDir, outDir }, t = tools) {
    await ffrun(t.realesrgan, ['-i', inDir, '-o', outDir, '-m', path.join(path.dirname(t.realesrgan), 'models'), '-n', 'realesr-animevideov3', '-s', '2', '-f', 'png', '-j', '2:2:2'], { timeoutMs: 60 * 60_000 });
  },
};

/**
 * swap: the model's output video; source: the clip it was made from (same start). Returns { final, split, frames, dir }.
 * start/seconds select the window of `source` that `swap` covers; fps defaults to the source's.
 */
export async function composeSwap({ swap, source, outDir, start = 0, seconds, fps, upscale = 'blend', mix = 0.6, grain = 2.6, relight = false, width, height, audio = true, split = false, impl = {}, t = tools }) {
  if (!UPSCALE_MODES.includes(upscale)) throw new Error(`upscale 只能是 ${UPSCALE_MODES.join(' / ')}`);
  const stages = { ...defaultImpl, ...impl };
  const stubbed = key => Boolean(impl[key]);
  const need = missingTools({ upscale: stubbed('upscale') ? 'off' : upscale, needInterpolation: !stubbed('interpolate') }, t);
  if (!stubbed('matte') && !t.rvmModel) need.push('RVM 抠图模型');
  if (need.length) throw new Error(`缺少：${[...new Set(need)].join('；')}`);

  const [swapInfo, srcInfo] = [await probe(swap), await probe(source)];
  const hasAudio = Boolean(srcInfo.audioCodec);
  const rate = fps || Math.round(srcInfo.fps || 25);
  const dur = seconds ?? Math.min(swapInfo.duration, srcInfo.duration - start);
  const n = frameCount(dur, rate);
  const d = name => path.join(outDir, name);
  for (const name of ['orig', 'swap_raw', 'swap', 'm_new', 'm_old', 'composed', 'up', 'final']) await fresh(d(name));

  const f = a => ffrun(t.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
  await f(['-ss', String(start), '-i', source, '-vf', `fps=${rate}`, '-frames:v', String(n), path.join(d('orig'), '%04d.png')]);
  const swapFps = Math.round(swapInfo.fps || 15);
  await f(['-i', swap, '-vf', `fps=${swapFps >= rate ? rate : swapFps}`, '-frames:v', String(n), path.join(d('swap_raw'), '%04d.png')]);   // a faster model output is simply resampled
  const rawCount = await count(d('swap_raw'));
  let swapDir = d('swap_raw');                               // already at the source rate: nothing to interpolate
  if (rawCount !== n) { swapDir = d('swap'); await stages.interpolate({ inDir: d('swap_raw'), outDir: swapDir, n }, t); }
  const got = await count(swapDir);
  if (got < n) throw new Error(`补帧只得到 ${got} 帧，需要 ${n} 帧`);

  await stages.matte({ framesDir: swapDir, pattern: '%04d.png', n, outDir: d('m_new') }, t);
  await stages.matte({ framesDir: d('orig'), pattern: '%04d.png', n, outDir: d('m_old') }, t);
  await py(['compose', d('orig'), swapDir, d('m_new'), d('m_old'), d('composed'), String(n), ...(relight ? ['--relight'] : [])], t);

  const { width: ow, height: oh } = await probe(path.join(d('composed'), '00001.png'));
  let finalFrames = d('composed'), upDir = '-';
  const targetW = width || (upscale === 'off' ? ow : Math.round((ow * 1.5) / 2) * 2), targetH = height || (upscale === 'off' ? oh : Math.round((oh * 1.5) / 2) * 2);
  if (upscale !== 'off') { await stages.upscale({ inDir: d('composed'), outDir: d('up') }, t); upDir = d('up'); }
  if (upscale !== 'off' || targetW !== ow || grain > 0) {
    await py(['finish', d('composed'), upDir, d('final'), String(n), '--width', String(targetW), '--height', String(targetH), '--mix', String(upscale === 'full' ? 1 : mix), '--grain', String(grain)], t);
    finalFrames = d('final');
  }

  const final = d('final.mp4');
  const audioArgs = audio && hasAudio ? ['-ss', String(start), '-t', String(dur), '-i', source, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-an'];
  await f(['-framerate', String(rate), '-i', path.join(finalFrames, '%05d.png'), ...audioArgs, '-vf', 'format=yuv420p', '-c:v', 'libx264', '-crf', '15', '-preset', 'slow', '-r', String(rate), final]);

  let splitFile = null;
  if (split) {
    splitFile = d('split.mp4');
    await f(['-ss', String(start), '-t', String(dur), '-i', source, '-framerate', String(rate), '-i', path.join(finalFrames, '%05d.png'),
      ...(audio && hasAudio ? ['-ss', String(start), '-t', String(dur), '-i', source] : []),
      '-filter_complex', `[0:v]fps=${rate},scale=${targetW}:${targetH}:flags=lanczos,setsar=1[l];[1:v]setsar=1[r];[l][r]hstack=inputs=2,format=yuv420p[v]`,
      '-map', '[v]', ...(audio && hasAudio ? ['-map', '2:a', '-c:a', 'aac', '-b:a', '192k'] : ['-an']), '-c:v', 'libx264', '-crf', '15', '-preset', 'slow', '-r', String(rate), '-shortest', splitFile]);
  }
  return { final, split: splitFile, frames: n, fps: rate, size: [targetW, targetH], dir: outDir };
}
