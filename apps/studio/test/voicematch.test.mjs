import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-vm-'));
process.env.STUDIO_DATA_DIR = tmp;
const vm = await import('../lib/voicematch.mjs');
const api = await import('../lib/board-api.mjs');
const { loadBoard, saveBoard } = await import('../lib/board.mjs');
const { jobDir } = await import('../lib/jobs.mjs');
const { ffrun } = await import('../lib/media.mjs');
const { billedChars } = await import('../lib/moss.mjs');
const SAMPLE_CHARS = billedChars(vm.SAMPLE.Chinese);
const { tools } = await import('../lib/env.mjs');
test.after(() => rm(tmp, { recursive: true, force: true }));

// a voiced signal: a few harmonics at f0 with a syllable-like on/off envelope
const voice = (f0, seconds = 2, sr = 16000, harmonics = 4) => {
  const out = new Float32Array(sr * seconds);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const env = (Math.sin(2 * Math.PI * 2.5 * t) > -0.3 ? 1 : 0.02) * 0.5;
    let v = 0;
    for (let h = 1; h <= harmonics; h++) v += Math.sin(2 * Math.PI * f0 * h * t) / h;
    out[i] = env * v * 0.5;
  }
  return out;
};

test('f0Median recovers the pitch of voiced audio and refuses silence', () => {
  for (const f0 of [110, 140, 200, 240]) assert.ok(Math.abs(vm.f0Median(voice(f0)) - f0) <= f0 * 0.04, `f0 ${f0}`);
  assert.equal(vm.f0Median(new Float32Array(16000)), null);
  assert.equal(vm.f0Median(new Float32Array(16000).map(() => (Math.random() - 0.5) * 0.001)), null, 'near-silent noise');
});

test('brightness is higher for an airy signal than a warm one', () => {
  const warm = voice(120, 1, 16000, 2);
  const airy = voice(120, 1, 16000, 14).map((v, i) => v + 0.2 * Math.sin(i * 1.9));
  assert.ok(vm.brightness(airy) > vm.brightness(warm));
});

test('genderOf: low = male, high = female, the overlap is "unsure"', () => {
  assert.deepEqual([110, 149, 165, 186, 230].map(vm.genderOf), ['male', 'male', 'unsure', 'female', 'female']);
  assert.equal(vm.genderOf(null), null);
});

test('cleanTarget keeps only valid enum values and falls back to neutral defaults', () => {
  assert.deepEqual(vm.cleanTarget({ gender: 'female', pitch: 'low', pace: 'slow', warmth: 'warm', why: 'quiet luxury' }), { gender: 'female', pitch: 'low', pace: 'slow', warmth: 'warm', why: 'quiet luxury' });
  const bad = vm.cleanTarget({ gender: 'robot', pitch: 'LOW', pace: 5 });
  assert.deepEqual([bad.gender, bad.pitch, bad.pace, bad.warmth], ['any', 'mid', 'normal', 'neutral']);
});

const m = (f0, pace, bright = 0.1, extra = {}) => ({ duration: 6, f0, bright, pace, voiced: 0.8, peak: 0.5, ...extra });

test('scoreVoice / rankVoices: the voice that matches the target profile wins, and unusable ones are rejected', () => {
  const target = { gender: 'female', pitch: 'low', pace: 'slow', warmth: 'warm' };
  const auditions = [
    { id: 'calm-female', m: m(178, 3.2, 0.05) },
    { id: 'bright-fast-female', m: m(250, 5.6, 0.3) },
    { id: 'deep-male', m: m(105, 3.1, 0.06) },
    { id: 'silent', m: m(null, 3, 0.1) },
    { id: 'broken', m: null },
  ];
  const ranked = vm.rankVoices(auditions, target, 'Chinese');
  assert.deepEqual(ranked.map(r => r.id).slice(0, 3), ['calm-female', 'bright-fast-female', 'deep-male'].sort((a, b) => ranked.findIndex(r => r.id === a) - ranked.findIndex(r => r.id === b)));
  assert.equal(ranked[0].id, 'calm-female');
  assert.ok(ranked[0].score > ranked.find(r => r.id === 'deep-male').score, 'a male voice loses against a female target');
  assert.match(ranked.find(r => r.id === 'silent').reject, /不可用/);
  assert.match(ranked.find(r => r.id === 'broken').reject, /不可用/);
  // a male, low, slow target picks the other voice
  assert.equal(vm.rankVoices(auditions, { gender: 'male', pitch: 'low', pace: 'slow', warmth: 'warm' }, 'Chinese')[0].id, 'deep-male');
  // "any" gender judges by pitch and pace only
  assert.ok(vm.scoreVoice(m(120, 4.3, 0.5), { gender: 'any', pitch: 'mid', pace: 'normal', warmth: 'neutral' }, 'Chinese').score >= 80);
});

test('candidatePool leaves out voice clones unless asked, always adds the chosen voice, and caps the list', () => {
  const voices = [{ id: 'a', name: 'Generated Voice a' }, { id: 'b', name: 'Voice Clone 2026' }, { id: 'c', name: 'Generated Voice c' }];
  assert.deepEqual(vm.candidatePool(voices).map(v => v.id), ['a', 'c']);
  assert.deepEqual(vm.candidatePool(voices, { includeClones: true }).map(v => v.id), ['a', 'b', 'c']);
  assert.deepEqual(vm.candidatePool(voices, { extraIds: ['zzz', 'a'] }).map(v => v.id), ['a', 'c', 'zzz']);
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `v${i}`, name: 'Generated Voice' }));
  assert.equal(vm.candidatePool(many).length, vm.MAX_CANDIDATES);
});

test('analyzeAudition measures a real audio file with ffmpeg', async () => {
  const file = path.join(tmp, 'tone.mp3');
  await ffrun(tools.ffmpeg, ['-y', '-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*200*t)*(0.5+0.5*sin(2*PI*2.5*t))':d=3:s=16000", '-ac', '1', file]);
  const a = await vm.analyzeAudition(file, '一二三四五六七八九十', 'Chinese');
  assert.ok(Math.abs(a.f0 - 200) < 12, `f0 ${a.f0}`);
  assert.ok(a.duration > 2.8 && a.duration < 3.3);
  assert.ok(a.pace > 2.5 && a.pace < 4, `pace ${a.pace}`);
  assert.ok(a.voiced > 0.4);
});

async function makeJob({ voiceId = null } = {}) {
  const job = await api.createScriptJob({ text: 'a\nb', title: 'Voice match', brief: { product: 'QUIET 静衣', notes: '安静的高级大衣' } });
  await saveBoard(job, { version: 1, shots: [{ id: 'S01', start: 0, end: 4, text: '好大衣，先是一种触感。', prompt: 'p', source: { kind: 'still', image: 'board/S01.jpg' } }], ...(voiceId ? { voice: { provider: 'moss', id: voiceId } } : {}) });
  return job;
}
const voices = [{ id: 'gen-a', name: 'Generated Voice gen-a' }, { id: 'gen-b', name: 'Generated Voice gen-b' }, { id: 'gen-c', name: 'Generated Voice gen-c' }, { id: 'clone-x', name: 'Voice Clone 2026' }];
const measures = { 'gen-a': m(250, 5.6, 0.4), 'gen-b': m(176, 3.2, 0.05), 'gen-c': m(110, 3.4, 0.1) };
const fakeSay = spoken => async ({ text, voiceId, out }) => { spoken.push(voiceId); await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, 'mp3'); void text; };
const fakeAnalyze = async file => measures[path.basename(file, '.mp3')];
const ask = async () => ({ text: JSON.stringify({ gender: 'female', pitch: 'low', pace: 'slow', warmth: 'warm', why: '安静克制的高级感' }) });

test('matchPlan prices the audition and skips clones; matchVoice needs the exact confirmed numbers', async () => {
  const job = await makeJob();
  const list = async () => voices;
  const plan = await vm.matchPlan(job, { list });
  assert.equal(plan.voices, 3);
  assert.equal(plan.language, 'Chinese');
  assert.equal(plan.skippedClones, 1);
  assert.equal(plan.chars, 3 * SAMPLE_CHARS);
  const spoken = [];
  await assert.rejects(() => vm.matchVoice(job, { expect: { voices: 2, chars: plan.chars }, say: fakeSay(spoken), analyze: fakeAnalyze, list, ask }), /3 个音色.*2 个/);
  assert.equal(spoken.length, 0, 'nothing spoken (billed) on a stale confirmation');
});

test('matchVoice auditions every non-clone voice once, picks the best fit for the brief, and writes it to the board', async () => {
  const job = await makeJob();
  const list = async () => voices;
  const plan = await vm.matchPlan(job, { list });
  const spoken = [];
  const r = await vm.matchVoice(job, { expect: { voices: plan.voices, chars: plan.chars }, say: fakeSay(spoken), analyze: fakeAnalyze, list, ask });
  assert.deepEqual(spoken.sort(), ['gen-a', 'gen-b', 'gen-c']);
  assert.ok(!spoken.includes('clone-x'), 'a voice clone is never auditioned without opting in');
  assert.equal(r.applied, 'gen-b');
  assert.equal(r.ranked[0].id, 'gen-b');
  assert.equal(r.target.pace, 'slow');
  const board = await loadBoard(job);
  assert.equal(board.voice.id, 'gen-b');
  assert.ok(board.voice.matchedAt);
  // with clones opted in they are included (and billed)
  const withClones = await vm.matchPlan(job, { list, includeClones: true });
  assert.equal(withClones.voices, 4);
  // dry run does not touch the board
  const job2 = await makeJob({ voiceId: 'keep-me' });
  await vm.matchVoice(job2, { apply: false, expect: { voices: 4, chars: 4 * SAMPLE_CHARS }, say: fakeSay([]), analyze: fakeAnalyze, list, ask });
  assert.equal((await loadBoard(job2)).voice.id, 'keep-me');
});

test('a voice that fails to speak is reported, not retried, and cannot win; an unusable model reply falls back to a neutral target', async () => {
  const job = await makeJob();
  const list = async () => voices;
  const plan = await vm.matchPlan(job, { list });
  const calls = [];
  const say = async o => { calls.push(o.voiceId); if (o.voiceId === 'gen-b') throw new Error('boom'); return fakeSay([])(o); };
  const r = await vm.matchVoice(job, { expect: { voices: plan.voices, chars: plan.chars }, say, analyze: fakeAnalyze, list, ask: async () => ({ text: 'not json' }) });
  assert.equal(calls.filter(c => c === 'gen-b').length, 1);
  assert.match(r.ranked.find(x => x.id === 'gen-b').reject, /boom/);
  assert.notEqual(r.applied, 'gen-b');
  assert.equal(r.target.gender, 'any');
});
