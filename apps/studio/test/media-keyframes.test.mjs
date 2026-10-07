import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractKeyframes, ffrun, probe } from '../lib/media.mjs';
import { tools } from '../lib/env.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-kf-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

test('keyframes and strips are made even for a last shot that ends at the very end of the file (newer ffmpeg fails on a seek past the last frame)', async () => {
  const video = path.join(tmp, 'v.mp4');
  // the audio is longer than the picture (common in reels): the container says 3 s, the last video frame is at 2.5 s
  await ffrun(tools.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=2.5', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]);
  const { duration } = await probe(video);
  const shots = await extractKeyframes(video, [{ index: 1, start: 0, end: 1.5, duration: 1.5 }, { index: 2, start: 1.5, end: duration, duration: duration - 1.5 }], path.join(tmp, 'shots'));
  assert.equal(shots.length, 2);
  for (const n of ['01', '02']) { assert.ok(existsSync(path.join(tmp, 'shots', `shot-${n}.jpg`))); assert.ok(existsSync(path.join(tmp, 'shots', `strip-${n}.jpg`))); }
  const strip = await probe(path.join(tmp, 'shots', 'strip-02.jpg'));
  assert.ok(strip.width > strip.height * 3);
});
