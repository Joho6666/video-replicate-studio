import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_STYLE, STYLES, effectTimes, finishVideo, videoFilter } from '../lib/finish.mjs';
import { ffrun, probe } from '../lib/media.mjs';
import { tools } from '../lib/env.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-finish-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const ff = a => ffrun(tools.ffmpeg, ['-hide_banner', '-y', ...a]);

test('every style yields a valid filter chain, and an unknown style is refused', () => {
  for (const s of Object.keys(STYLES)) assert.match(videoFilter(s), /^eq=.*format=yuv420p$/);
  assert.ok(STYLES[DEFAULT_STYLE]);
  assert.match(videoFilter('cinematic'), /vignette=.*noise=/);
  assert.doesNotMatch(videoFilter('clean'), /vignette/);
  assert.throws(() => videoFilter('nope'), /未知风格/);
});

test('effectTimes: whoosh only at real transitions, impact only at title / big-card lines', () => {
  const usage = { 镜头详情: [{ start: 0, tin: 'cut' }, { start: 2, tin: 'push_left' }, { start: 4, tin: 'cut' }, { start: 6, tin: 'whip_left' }], 旁白: [{ d: 2 }, { d: 2 }, { d: 2 }, { d: 2 }] };
  const script = { lines: [{ title: 'Brand' }, {}, { big: '3 OFF' }, {}] };
  assert.deepEqual(effectTimes(usage, script), { whoosh: [1.88, 5.88], impact: [0, 4] });
  assert.deepEqual(effectTimes(null, null), { whoosh: [], impact: [] });
});

// a tiny synthetic factory project: 6 s video, 3 voice lines of 2 s, transitions at 2 s and 4 s, a big card on line 2
async function makeProject({ silentVoice = false, withUsage = true } = {}) {
  const project = await mkdtemp(path.join(tmp, 'proj-'));
  for (const d of ['成片', '脚本', '数据/tts_cache']) await mkdir(path.join(project, d), { recursive: true });
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=24:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(project, '成片/b001.mp4')]);
  const wavs = [];
  for (let i = 0; i < 3; i++) {
    const w = path.join(project, `数据/tts_cache/l${i}.wav`);
    await ff(['-f', 'lavfi', '-i', silentVoice ? 'anullsrc=r=44100:cl=mono' : `sine=frequency=${300 + i * 40}:duration=1.9`, '-t', '1.9', '-ar', '44100', '-ac', '1', w]);
    wavs.push(w);
  }
  if (withUsage) {
    await writeFile(path.join(project, '成片/b001.用量.json'), JSON.stringify({ script: 'b001', 时长: 6, 镜头详情: [{ start: 0, tin: 'cut' }, { start: 2, tin: 'push_left' }, { start: 4, tin: 'push_left' }], 旁白: wavs.map(w => ({ wav: w, text: 'x', d: 2 })) }));
    await writeFile(path.join(project, '脚本/b001.json'), JSON.stringify({ name: 'b001', lines: [{ text: 'a' }, { text: 'b', big: 'NEW' }, { text: 'c' }] }));
  }
  return project;
}
const stats = async (file, ss = null, t = null) => {
  const { stderr } = await ffrun(tools.ffmpeg, ['-hide_banner', ...(ss === null ? [] : ['-ss', String(ss), '-t', String(t)]), '-i', file, '-af', 'volumedetect,ebur128=peak=true', '-f', 'null', '-']);
  return { mean: Number(/mean_volume:\s*(-?[\d.]+)/.exec(stderr)?.[1]), lufs: Number([...stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1]), peak: Number([...stderr.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].at(-1)?.[1]) };
};

test('finishVideo rebuilds the sound from the usage file: same length, target loudness, no clipping, effects at the right places', async () => {
  const project = await makeProject();
  const r = await finishVideo({ project, name: 'b001', style: 'cinematic' });
  assert.equal(r.audio, 'rebuilt');
  assert.deepEqual([r.whoosh, r.impact], [2, 1]);
  const info = await probe(r.output);
  assert.ok(Math.abs(info.duration - 6) < 0.15, `duration ${info.duration}`);
  assert.equal(info.width, 360);
  const s = await stats(r.output);
  assert.ok(Math.abs(s.lufs - -14) < 1.5, `loudness ${s.lufs}`);
  assert.ok(s.peak <= -0.9, `peak ${s.peak}`);
});

test('the transition whoosh and the title impact are really in the mix (silent voice, only effects audible)', async () => {
  const project = await makeProject({ silentVoice: true });
  const r = await finishVideo({ project, name: 'b001', style: 'cinematic' });
  const quiet = await stats(r.output, 0.9, 0.8); // no effect here
  const whoosh = await stats(r.output, 1.9, 0.5); // transition at 2 s (starts 0.12 before)
  const impact = await stats(r.output, 2.0, 0.5); // big card on line 2 (starts at 2 s)
  assert.ok(whoosh.mean > quiet.mean + 8, `whoosh ${whoosh.mean} vs quiet ${quiet.mean}`);
  assert.ok(impact.mean > quiet.mean + 8, `impact ${impact.mean} vs quiet ${quiet.mean}`);
});

test('without a usage file only grade + loudness are applied and the original sound is kept', async () => {
  const project = await makeProject({ withUsage: false });
  const r = await finishVideo({ project, name: 'b001', style: 'clean' });
  assert.equal(r.audio, 'kept');
  assert.deepEqual([r.whoosh, r.impact], [0, 0]);
  assert.ok(Math.abs((await probe(r.output)).duration - 6) < 0.15);
  assert.ok(Math.abs((await stats(r.output)).lufs - -14) < 1.5);
});

test('a music bed is accepted and ducked under the voice; a missing file or video is refused', async () => {
  const project = await makeProject();
  const music = path.join(project, 'bed.wav');
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=110:duration=3', '-ar', '44100', '-ac', '2', music]);
  const r = await finishVideo({ project, name: 'b001', style: 'warm', music });
  assert.equal(r.music, music);
  assert.ok(Math.abs((await probe(r.output)).duration - 6) < 0.15, 'a short bed loops, it does not shorten the video');
  await assert.rejects(() => finishVideo({ project, name: 'b001', music: path.join(project, 'nope.mp3') }), /找不到配乐/);
  await assert.rejects(() => finishVideo({ project, name: 'zzz' }), /找不到/);
});
