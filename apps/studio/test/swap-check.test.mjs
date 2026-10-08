import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ffrun } from '../lib/media.mjs';
import { tools } from '../lib/env.mjs';
import { backgroundDrift, driftVerdict } from '../lib/swap-check.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-drift-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const make = (name, src) => ffrun(tools.ffmpeg, ['-y', '-f', 'lavfi', '-i', `${src}=size=360x640:rate=15:duration=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(tmp, name)]).then(() => path.join(tmp, name));

test('a swap that kept the scene has a tiny drift; one that redrew the scene is flagged', async () => {
  const source = await make('src.mp4', 'testsrc2');
  const same = await make('same.mp4', 'testsrc2');
  const other = await make('other.mp4', 'smptebars');
  const ok = driftVerdict(await backgroundDrift({ output: same, source, workDir: path.join(tmp, 'w1') }));
  assert.equal(ok.verdict, 'ok');
  assert.ok(ok.median < 1);
  const bad = driftVerdict(await backgroundDrift({ output: other, source, workDir: path.join(tmp, 'w2') }));
  assert.equal(bad.verdict, 'fail');
  assert.ok(bad.median >= 10);
  assert.ok(bad.windows.length >= 1);
});

test('driftVerdict: median decides warn / fail, short spikes alone do not raise a window', () => {
  const s = (vals, dt = 0.1) => vals.map((drift, i) => ({ t: i * dt, drift }));
  assert.equal(driftVerdict(s([1, 1, 40, 1, 1, 1, 1, 1])).verdict, 'ok');                 // a spike (an arm crossing the strip)
  assert.equal(driftVerdict(s([1, 1, 1, 8, 8, 8, 8, 1, 1])).verdict, 'warn');              // a 0.4 s stretch
  assert.deepEqual(driftVerdict(s([1, 1, 1, 8, 8, 8, 8, 1, 1])).windows, [{ start: 0.3, end: 0.6 }]);
  assert.equal(driftVerdict(s([12, 11, 14, 13])).verdict, 'fail');
});
