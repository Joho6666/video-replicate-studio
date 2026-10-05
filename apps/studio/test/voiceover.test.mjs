import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-voice-'));
process.env.STUDIO_DATA_DIR = tmp;
const vo = await import('../lib/voiceover.mjs');
const api = await import('../lib/board-api.mjs');
const { loadBoard, saveBoard } = await import('../lib/board.mjs');
const { jobDir } = await import('../lib/jobs.mjs');
const { ffrun, mediaInfo } = await import('../lib/media.mjs');
const { tools } = await import('../lib/env.mjs');
test.after(() => rm(tmp, { recursive: true, force: true }));

// fake MOSI: a sine tone as long as asked (or as long as `lengths[text]`)
const sineSay = (calls, lengths = {}) => async ({ text, voiceId, seconds, language, out }) => {
  calls.push({ text, voiceId, seconds, language });
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(out), { recursive: true });
  await ffrun(tools.ffmpeg, ['-y', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${lengths[text] ?? seconds}`, '-ar', '44100', '-ac', '1', out.replace(/\.mp3$/, '.wav')]);
  const { rename } = await import('node:fs/promises');
  await rename(out.replace(/\.mp3$/, '.wav'), out); // the content is wav; the name is what the manifest points at
  return out;
};
const shot = (id, start, end, text) => ({ id, start, end, text, prompt: 'p', source: { kind: 'still', image: `board/${id}.jpg` } });
async function makeJob(shots, voice = { provider: 'moss', id: 'v-1' }) {
  const job = await api.createScriptJob({ text: 'a\nb', title: 'Voice' });
  await saveBoard(job, { version: 1, shots, ...(voice ? { voice } : {}) });
  return job;
}

test('planVoiceover counts only new / edited / re-voiced lines and the characters they bill', () => {
  const board = { shots: [shot('S01', 0, 4, 'Hello there'), shot('S02', 4, 8, ''), shot('S03', 8, 12, 'Third line [pause 0.5s] here')] };
  const none = { lines: {} };
  const p = vo.planVoiceover(board, none, { voiceId: 'v-1' });
  assert.equal(p.total, 2);
  assert.deepEqual(p.lines.map(s => s.id), ['S01', 'S03']);
  assert.equal(p.chars, 'Hellothere'.length + 'Thirdlinehere'.length, 'pause tags and spaces are not billed');
  assert.equal(p.language, 'English');
  const done = { lines: { S01: { text: 'Hello there', voiceId: 'v-1' }, S03: { text: 'Third line [pause 0.5s] here', voiceId: 'v-1' } } };
  assert.equal(vo.planVoiceover(board, done, { voiceId: 'v-1' }).lines.length, 0);
  assert.deepEqual(vo.planVoiceover(board, done, { voiceId: 'v-2' }).lines.length, 2, 'another voice means redo');
  assert.deepEqual(vo.planVoiceover(board, done, { voiceId: 'v-1', again: true, ids: ['S03'] }).lines.map(s => s.id), ['S03']);
  board.shots[0].text = 'Hello again';
  assert.deepEqual(vo.planVoiceover(board, done, { voiceId: 'v-1' }).lines.map(s => s.id), ['S01']);
  assert.equal(vo.planVoiceover({ shots: [shot('S01', 0, 4, '你好，这是一个测试')] }, none, { voiceId: 'v' }).language, 'Chinese');
});

test('generate: needs a voice and the exact confirmed numbers; voices each line, mixes full.wav at the shot times', async () => {
  const job = await makeJob([shot('S01', 0, 4, 'First line of the script'), shot('S02', 4, 8, 'Second line'), shot('S03', 8, 12, '')]);
  const calls = [];
  await assert.rejects(() => vo.generateVoiceover(job, { expect: { lines: 1, chars: 5 }, say: sineSay(calls) }), /2 句.*1 句/);
  await assert.rejects(() => vo.generateVoiceover(job, { say: sineSay(calls) }), /未确认/);
  assert.equal(calls.length, 0, 'nothing billed on a stale confirmation');
  const chars = 'Firstlineofthescript'.length + 'Secondline'.length;
  const r = await vo.generateVoiceover(job, { expect: { lines: 2, chars }, say: sineSay(calls) });
  assert.deepEqual(r.generated, ['S01', 'S02']);
  assert.equal(r.chars, chars);
  assert.deepEqual(calls.map(c => [c.voiceId, c.seconds, c.language]), [['v-1', 3.7, 'English'], ['v-1', 3.7, 'English']]);
  const full = path.join(jobDir(job.id), 'voice/full.wav');
  const info = await mediaInfo(full);
  assert.ok(Math.abs(info.duration - 12) < 0.2, `full.wav is ${info.duration}s, the board is 12 s`);
  const manifest = await vo.loadVoiceManifest(job);
  assert.equal(manifest.lines.S01.text, 'First line of the script');
  assert.equal(manifest.file, 'voice/full.wav');
  // second run: nothing pending, nothing billed, just a free re-mix
  const again = await vo.generateVoiceover(job, { say: async () => { throw new Error('must not be called'); } });
  assert.deepEqual(again.generated, []);
  // edit one line: only that line is voiced again
  const board = await loadBoard(job);
  board.shots[1].text = 'Second line, edited';
  await saveBoard(job, board);
  const calls2 = [];
  const r3 = await vo.generateVoiceover(job, { expect: { lines: 1, chars: 'Secondline,edited'.length }, say: sineSay(calls2) });
  assert.deepEqual(r3.generated, ['S02']);
  assert.equal(calls2.length, 1);
  assert.equal(calls2[0].text, 'Second line, edited');
});

test('a line that runs over its shot is trimmed in the mix and reported; a failed line does not stop the others and is not retried', async () => {
  const job = await makeJob([shot('S01', 0, 4, 'Too long for its shot'), shot('S02', 4, 8, 'Fails here'), shot('S03', 8, 12, 'Fine line')]);
  const calls = [];
  const say = async o => { if (o.text === 'Fails here') { calls.push(o.text); throw new Error('boom'); } return sineSay(calls, { 'Too long for its shot': 6 })(o); };
  const chars = 'Toolongforitsshot'.length + 'Failshere'.length + 'Fineline'.length;
  const r = await vo.generateVoiceover(job, { expect: { lines: 3, chars }, say });
  assert.deepEqual(r.generated, ['S01', 'S03']);
  assert.equal(r.failed[0].id, 'S02');
  assert.deepEqual(r.missing, ['S02']);
  assert.match(r.warnings[0], /S01.*比镜头 4s 长/);
  assert.equal(calls.filter(c => c === 'Fails here').length, 1, 'no retry');
  const info = await mediaInfo(path.join(jobDir(job.id), 'voice/full.wav'));
  assert.ok(Math.abs(info.duration - 12) < 0.2, 'the overrun did not stretch the track');
  // only the failed line is pending next time
  const next = await api.voiceoverJob(job, { action: 'plan' });
  assert.deepEqual([next.lines, next.pending], [1, ['S02']]);
});

test('voiceoverJob: plan is free, generate needs confirm, a board without a voice id is refused', async () => {
  const job = await makeJob([shot('S01', 0, 4, 'Hello there')]);
  const p = await api.voiceoverJob(job, { action: 'plan' });
  assert.deepEqual([p.voiceId, p.total, p.lines, p.chars], ['v-1', 1, 1, 10]);
  await assert.rejects(() => api.voiceoverJob(job, { action: 'generate', expect: { lines: 1, chars: 10 } }), /确认/);
  const r = await api.voiceoverJob(job, { action: 'generate', confirm: true, expect: { lines: 1, chars: 10 }, generate: async (j, o) => ({ called: o.expect }) });
  assert.deepEqual(r.called, { lines: 1, chars: 10 });
  await assert.rejects(() => api.voiceoverJob(job, { action: 'x' }), /action/);
  const none = await makeJob([shot('S01', 0, 4, 'Hello there')], null);
  await assert.rejects(() => vo.generateVoiceover(none, { expect: { lines: 1, chars: 10 }, say: sineSay([]) }), /选一个音色/);
  assert.ok(!existsSync(path.join(jobDir(none.id), 'voice', 'full.wav')));
});
