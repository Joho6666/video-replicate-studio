import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ffrun, probe } from '../lib/media.mjs';
import { tools } from '../lib/env.mjs';
import { composeSwap, frameCount, missingTools } from '../lib/swap-compose.mjs';

const PY = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'scripts', 'py', 'person_swap.py');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-compose-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const hasPython = await ffrun(tools.python || 'python', ['-c', 'import cv2, numpy']).then(() => true, () => false);
const ff = a => ffrun(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const W = 144, H = 256;
const BOX_NEW = 'drawbox=x=40:y=80:w=60:h=120:color=white:t=fill', BOX_OLD = 'drawbox=x=30:y=70:w=60:h=120:color=white:t=fill';

test('frame counts and the list of missing tools are explicit', () => {
  assert.equal(frameCount(5.72, 25), 143);
  assert.equal(frameCount(0, 25), 1);
  assert.deepEqual(missingTools({ upscale: 'off' }, { ffmpeg: 'f', python: 'p', rvmModel: 'm', rife: 'r' }), []);
  const m = missingTools({ upscale: 'blend' }, { ffmpeg: 'f' });
  assert.equal(m.length, 4);
  assert.ok(m.some(x => /RVM/.test(x)) && m.some(x => /RIFE/.test(x)) && m.some(x => /ESRGAN/.test(x)));
  assert.ok(!missingTools({ upscale: 'off', needInterpolation: false }, { ffmpeg: 'f', python: 'p', rvmModel: 'm' }).length);
});

test('compose: outside the people the result is the original pixel for pixel; inside, the swapped person; no ghost of the old one', { skip: !hasPython && 'python + opencv not available' }, async () => {
  const d = n => path.join(tmp, 'c', n);
  for (const n of ['orig', 'swap', 'm_new', 'm_old', 'out']) await mkdir(d(n), { recursive: true });
  await ff(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=1`, '-frames:v', '3', path.join(d('orig'), '%04d.png')]);
  // the swapped frame: slightly brighter background (a tone shift), a red person where the new person stands
  await ff(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=1,eq=brightness=0.08,drawbox=x=40:y=80:w=60:h=120:color=red:t=fill`, '-frames:v', '3', path.join(d('swap'), '%04d.png')]);
  await ff(['-f', 'lavfi', '-i', `color=black:s=${W}x${H}:r=1,${BOX_NEW}`, '-frames:v', '3', path.join(d('m_new'), '%05d.png')]);
  await ff(['-f', 'lavfi', '-i', `color=black:s=${W}x${H}:r=1,${BOX_OLD}`, '-frames:v', '3', path.join(d('m_old'), '%05d.png')]);
  await ffrun(tools.python, [PY, 'compose', d('orig'), d('swap'), d('m_new'), d('m_old'), d('out'), '3']);
  assert.equal((await readdir(d('out'))).length, 3);
  const check = `
import cv2, numpy as np
o = cv2.imread(r'${d('orig')}/0001.png'); r = cv2.imread(r'${d('out')}/00001.png')
u = np.zeros(o.shape[:2], np.uint8); u[70:200, 30:100] = 255                       # union of the two boxes
far = cv2.dilate(u, np.ones((61, 61), np.uint8)) == 0
print('far_max_diff', int(np.abs(o.astype(int) - r.astype(int))[far].max()))
c = r[140, 70]                                                                      # inside the new box
print('centre_is_red', bool(c[2] > 150 and c[1] < 90 and c[0] < 90))
g = r[190, 35]                                                                      # in the OLD person's box but outside the new one: must not be a leftover, just picture
print('old_only_pixel_ok', bool(np.abs(r[190, 35].astype(int) - o[190, 35].astype(int)).max() < 90))`;
  const { stdout } = await ffrun(tools.python, ['-c', check]);
  assert.match(stdout, /far_max_diff 0/);
  assert.match(stdout, /centre_is_red True/);
  assert.match(stdout, /old_only_pixel_ok True/);
});


test('relight: the new person takes over the light and shadow side of the original person, only inside the new person; it is off by default (flat)', { skip: !hasPython && 'python + opencv not available' }, async () => {
  const d = n => path.join(tmp, 'rl', n);
  for (const n of ['orig', 'swap', 'm_new', 'm_old', 'on', 'off']) await mkdir(d(n), { recursive: true });
  // the original: a mid-grey scene whose "person" box is dark on the left and bright on the right (light from the right)
  await ff(['-f', 'lavfi', '-i', `color=0x808080:s=${W}x${H}:r=1,format=rgb24,geq=r='if(between(X,40,100)*between(Y,80,200),40+200*(X-40)/60,128)':g='if(between(X,40,100)*between(Y,80,200),40+200*(X-40)/60,128)':b='if(between(X,40,100)*between(Y,80,200),40+200*(X-40)/60,128)'`, '-frames:v', '2', path.join(d('orig'), '%04d.png')]);
  await ff(['-f', 'lavfi', '-i', `color=0x808080:s=${W}x${H}:r=1,drawbox=x=40:y=80:w=60:h=120:color=0xb4aa96:t=fill`, '-frames:v', '2', path.join(d('swap'), '%04d.png')]);
  await ff(['-f', 'lavfi', '-i', `color=black:s=${W}x${H}:r=1,${BOX_NEW}`, '-frames:v', '2', path.join(d('m_new'), '%05d.png')]);
  await ff(['-f', 'lavfi', '-i', `color=black:s=${W}x${H}:r=1,${BOX_NEW}`, '-frames:v', '2', path.join(d('m_old'), '%05d.png')]);
  for (const [name, extra] of [['on', ['--relight']], ['off', []]]) await ffrun(tools.python, [PY, 'compose', d('orig'), d('swap'), d('m_new'), d('m_old'), d(name), '2', ...extra]);
  const probeCode = dir => `
import cv2, numpy as np
r = cv2.imread(r'${dir}/00001.png', 0).astype(float)
print(int(r[110:170, 46:62].mean()), int(r[110:170, 78:94].mean()), int(r[10:40, 5:30].mean()))`;
  const [onL, onR, onBg] = (await ffrun(tools.python, ['-c', probeCode(d('on'))])).stdout.trim().split(/\s+/).map(Number);
  const [offL, offR, offBg] = (await ffrun(tools.python, ['-c', probeCode(d('off'))])).stdout.trim().split(/\s+/).map(Number);
  assert.ok(Math.abs(offL - offR) < 12, `flat without relight: ${offL} vs ${offR}`);
  assert.ok(onR - onL > 30, `the light side is brighter with relight: ${onL} vs ${onR}`);
  assert.equal(onBg, offBg);                                  // the background is not touched either way
});

test('matte: one 8-bit alpha PNG per frame (skipped without the RVM model)', { skip: (!hasPython || !tools.rvmModel) && 'python or RVM model not available' }, async () => {
  const d = n => path.join(tmp, 'm', n);
  await mkdir(d('in'), { recursive: true });
  await ff(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=1`, '-frames:v', '3', path.join(d('in'), '%04d.png')]);
  await ffrun(tools.python, [PY, 'matte', d('in'), '%04d.png', '3', d('out'), '--model', tools.rvmModel]);
  const files = (await readdir(d('out'))).sort();
  assert.deepEqual(files, ['00001.png', '00002.png', '00003.png']);
  const info = await probe(path.join(d('out'), files[0]));
  assert.deepEqual([info.width, info.height], [W, H]);
});

test('composeSwap end to end (interpolation, matting and upscaling stubbed): original background, same duration, audio kept, split screen', { skip: !hasPython && 'python + opencv not available' }, async () => {
  const dir = path.join(tmp, 'e2e');
  await mkdir(dir, { recursive: true });
  const source = path.join(dir, 'source.mp4'), swap = path.join(dir, 'swap.mp4');
  await ff(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=25:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);
  await ff(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=15:duration=2,eq=brightness=0.08,drawbox=x=40:y=80:w=60:h=120:color=red:t=fill`, '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', swap]);
  const fakeIn = ['m_new', 'm_old'];
  const impl = {
    // nearest-frame resampling instead of RIFE
    interpolate: async ({ inDir, outDir, n }) => {
      const files = (await readdir(inDir)).sort();
      await mkdir(outDir, { recursive: true });
      for (let i = 1; i <= n; i++) await copyFile(path.join(inDir, files[Math.min(files.length - 1, Math.floor(((i - 1) * files.length) / n))]), path.join(outDir, `${String(i).padStart(4, '0')}.png`));
    },
    // known boxes instead of RVM
    matte: async ({ outDir, n }) => {
      const box = outDir.endsWith(fakeIn[0]) ? BOX_NEW : BOX_OLD;
      await mkdir(outDir, { recursive: true });
      await ff(['-f', 'lavfi', '-i', `color=black:s=${W}x${H}:r=1,${box}`, '-frames:v', String(n), path.join(outDir, '%05d.png')]);
    },
    // plain 2x resize instead of Real-ESRGAN
    upscale: async ({ inDir, outDir }) => {
      await mkdir(outDir, { recursive: true });
      await ff(['-i', path.join(inDir, '%05d.png'), '-vf', 'scale=iw*2:ih*2:flags=lanczos', path.join(outDir, '%05d.png')]);
    },
  };
  const t = { ...tools, python: tools.python, rvmModel: 'stub', rife: 'stub', realesrgan: 'stub' };
  const r = await composeSwap({ swap, source, outDir: path.join(dir, 'out'), upscale: 'blend', split: true, impl, t });
  assert.equal(r.frames, 50);
  assert.deepEqual(r.size, [W * 1.5, H * 1.5]);
  const final = await probe(r.final);
  assert.ok(Math.abs(final.duration - 2) < 0.15);
  assert.equal([final.width, final.height].join('x'), `${W * 1.5}x${H * 1.5}`);
  assert.ok(final.audioCodec, 'the original audio is kept');
  const sp = await probe(r.split);
  assert.equal(sp.width, W * 1.5 * 2);
  // background fidelity: the top strip (no person there) of the final frame matches the source's, within codec/grain tolerance
  const cmp = `
import cv2, numpy as np
cap = cv2.VideoCapture(r'${r.final}'); ok, a = cap.read()
cap2 = cv2.VideoCapture(r'${source}'); ok2, b = cap2.read()
b = cv2.resize(b, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_LANCZOS4)
print('top_diff', float(np.abs(a[:50].astype(float) - b[:50].astype(float)).mean()))`;
  const { stdout } = await ffrun(tools.python, ['-c', cmp]);
  assert.ok(Number(stdout.match(/top_diff ([\d.]+)/)[1]) < 6, stdout);
});

test('composeSwap refuses with a clear message when a needed tool is missing', async () => {
  await assert.rejects(composeSwap({ swap: 'a.mp4', source: 'b.mp4', outDir: path.join(tmp, 'x'), t: { ffmpeg: 'f' } }), /缺少.*RVM.*RIFE/s);
});
