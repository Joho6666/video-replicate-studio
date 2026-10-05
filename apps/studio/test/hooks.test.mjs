import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-hooks-'));
process.env.STUDIO_DATA_DIR = tmp;
const hk = await import('../lib/hooks.mjs');
const ex = await import('../lib/export-factory.mjs');
const api = await import('../lib/board-api.mjs');
const { loadBoard, saveBoard } = await import('../lib/board.mjs');
const { jobDir } = await import('../lib/jobs.mjs');
test.after(() => rm(tmp, { recursive: true, force: true }));

const ctx = (extra = {}) => ({ slotSeconds: 6, whitelist: ['60'], original: 'At forty I realized it is not the old days anymore', count: 3, ...extra });

test('checkHooks keeps only compliant, short, different hooks and says why the rest were dropped', () => {
  const { kept, rejected } = hk.checkHooks([
    { angle: 'question', text: 'Ever wonder why the scale stopped moving?' },
    { angle: 'pain', text: 'Ever wonder why the scale stopped moving today?' }, // near-duplicate of the first
    { angle: 'story', text: 'Lose weight with no effort at all in a very short time, honestly, really, because every single thing about it is easy and simple' }, // too long + number
    { angle: 'contrast', text: 'Save 20 percent today' },
    { angle: 'curiosity', text: 'A doctor in a lab coat explains it' },
    { angle: 'pain', text: 'At forty I realized it is not the old days anymore' }, // same as the original
    { angle: 'weird', text: 'Mornings used to feel lighter' }, // unknown angle falls back
    { text: '' },
    { angle: 'story', text: 'What changed after I stopped dieting' },
    { angle: 'story', text: 'One more good hook here' }, // over count
  ], ctx());
  assert.deepEqual(kept.map(k => k.text), ['Ever wonder why the scale stopped moving?', 'Mornings used to feel lighter', 'What changed after I stopped dieting']);
  assert.equal(kept[1].angle, 'curiosity');
  const why = Object.fromEntries(rejected.map(r => [r.text.slice(0, 10), r.reason]));
  assert.match(why['Ever wonde'], /太像/);
  assert.match(why['Lose weigh'], /太长/);
  assert.match(why['Save 20 pe'], /数字 20/);
  assert.match(why['A doctor i'], /专家/);
  assert.match(why['At forty I'], /原钩子/);
  assert.match(why['One more g'], /数量/);
  // Chinese: extreme claims and ad-law words are dropped
  const zh = hk.checkHooks([{ text: '全网最好的方法' }, { text: '为什么你总是瘦不下来' }], ctx({ original: '', slotSeconds: 5 }));
  assert.deepEqual(zh.kept.map(k => k.text), ['为什么你总是瘦不下来']);
});

test('similarity works for English words and Chinese bigrams', () => {
  assert.ok(hk.similarity('the scale did not move', 'the scale did not move today') > 0.7);
  assert.ok(hk.similarity('为什么你总是瘦不下来', '为什么你总是瘦不下来呢') > 0.7);
  assert.ok(hk.similarity('completely different words', 'nothing shared at all') < 0.2);
  assert.equal(hk.similarity('', 'x'), 0);
});

const lipsynced = (id, start, end) => ({ id, start, end, text: `talk ${id}`, prompt: 'p', source: { kind: 'generate' }, generate: { provider: 'h3', resolution: '768P', group: id } });
const still = (id, start, end, extra = {}) => ({ id, start, end, text: `still ${id.replace(/\d/g, c => 'abcdefghij'[c])}`, prompt: 'p', source: { kind: 'still', image: `board/${id}.jpg`, ...extra } });

test('isLipSynced and hookSlot', () => {
  assert.equal(hk.isLipSynced(lipsynced('S01', 0, 5)), true);
  assert.equal(hk.isLipSynced({ source: { kind: 'reuse', lipsync: true } }), true);
  assert.equal(hk.isLipSynced(still('S02', 5, 8)), false);
  assert.equal(hk.isLipSynced({ source: { kind: 'generate', lipsync: false } }), false, 'generated b-roll can carry a different line');
  assert.equal(hk.isLipSynced({ source: { kind: 'reuse', lipsync: false } }), false);
  const board = { shots: [lipsynced('S01', 0, 6.6), still('S02', 6.6, 9)] };
  assert.deepEqual(hk.hookSlot(board), { shot: board.shots[0], seconds: 6.6, language: 'English' });
  assert.equal(hk.hookSlot({ ...board, hookShot: 'S02' }).shot.id, 'S02');
  assert.throws(() => hk.hookSlot({ shots: [] }), /空/);
});

test('pickHookVisuals never uses a lip-synced shot, covers the voice with long-enough clips, rotates per hook', () => {
  const it = (id, dur, lip = false) => ({ shot: lip ? lipsynced(id, 0, 1) : still(id, 0, 1), dur, key: `k_${id}` });
  const items = [it('S01', 7.4, true), it('S02', 3.8), it('S03', 4.2), it('S04', 3.9)];
  const p0 = hk.pickHookVisuals(items, 'S01', 6.6, 0);
  assert.deepEqual(p0.map(p => p.shot.id), ['S02', 'S03', 'S04']); // two clips would need 4.0 s each (S02 is 3.8), so three
  assert.deepEqual(hk.pickHookVisuals(items, 'S01', 6.6, 1).map(p => p.shot.id), ['S03', 'S04', 'S02']);
  assert.deepEqual(hk.pickHookVisuals(items, 'S01', 3, 0).map(p => p.shot.id), ['S02'], 'a short hook needs just one clip');
  assert.ok(p0.every(p => !hk.isLipSynced(p.shot)));
  assert.deepEqual(hk.pickHookVisuals(items, 'S01', 6.6, 0), p0, 'deterministic');
  assert.equal(hk.pickHookVisuals([it('S01', 9, true)], 'S01', 4, 0), null, 'only a talking clip: nothing to show');
  assert.equal(hk.pickHookVisuals([it('S02', 1.5)], 'S01', 6, 0), null, 'clips too short for any split');
  // when the slot shot itself is a still it is used first
  assert.equal(hk.pickHookVisuals([it('S02', 6), it('S05', 6)], 'S05', 4, 0)[0].shot.id, 'S05');
});

test('runHookWriter: repairs once with the rejection reasons, rejects bad JSON twice', async () => {
  const job = { brief: { product: 'Brand 60', notes: 'capsules' } };
  const board = { shots: [lipsynced('S01', 0, 6), still('S02', 6, 9)] };
  board.shots[0].text = 'Original hook line about the scale';
  const seen = [];
  const replies = [
    JSON.stringify({ hooks: [{ angle: 'question', text: 'Why did the scale stop moving?' }, { angle: 'pain', text: 'Save 99 percent' }, { angle: 'story', text: 'A doctor says so' }] }),
    JSON.stringify({ hooks: [{ angle: 'contrast', text: 'Same habits, different mornings' }, { angle: 'story', text: 'What I changed last spring' }] }),
  ];
  const r = await hk.runHookWriter(job, board, { count: 3, ask: async m => { seen.push(m.length); return { text: replies.shift(), model: 'm' }; } });
  assert.deepEqual(seen, [2, 4], 'second call is the repair round');
  assert.deepEqual(r.hooks.map(h => [h.id, h.text]), [['H1', 'Why did the scale stop moving?'], ['H2', 'Same habits, different mornings'], ['H3', 'What I changed last spring']]);
  assert.ok(r.rejected.some(x => /数字 99/.test(x.reason)));
  assert.deepEqual(r.slot, { shot: 'S01', seconds: 6 });
  await assert.rejects(() => hk.runHookWriter(job, board, { count: 3, ask: async () => ({ text: 'nope' }) }), /两次/);
  await assert.rejects(() => hk.runHookWriter(job, board, { count: 99, ask: async () => ({ text: '{}' }) }), /一次写/);
});

async function makeJob(shots, { hooks = [], voice = { provider: 'moss', id: 'voice-1' }, files = [] } = {}) {
  const job = await api.createScriptJob({ text: 'x\ny', title: 'Hooks', brief: { product: 'Brand 60', notes: 'Capsules' } });
  const root = jobDir(job.id);
  for (const d of ['board', 'clips', 'voice']) await mkdir(path.join(root, d), { recursive: true });
  for (const f of ['clips/a.mp4', 'board/S02.jpg', 'board/S03.jpg', 'board/S04.jpg', ...files]) await writeFile(path.join(root, f), 'x');
  await saveBoard(job, { version: 1, shots, hooks, ...(voice ? { voice } : {}) }, { trustHooks: true });
  return job;
}
const talk = (id, start, end, text) => ({ ...lipsynced(id, start, end), text, source: { kind: 'generate', clip: { file: 'clips/a.mp4' } } });
const hook = (id, text, voice) => ({ id, text, angle: 'question', ...(voice ? { voice } : {}) });

test('a client cannot forge a hook voice, and editing the text drops the voice', async () => {
  const job = await makeJob([talk('S01', 0, 6, 'Original hook line here'), still('S02', 6, 10)], { hooks: [hook('H1', 'First hook text')] });
  let board = await loadBoard(job);
  board.hooks[0].voice = { file: 'voice/hook-H1.mp3', seconds: 5 };
  await saveBoard(job, board);
  assert.equal((await loadBoard(job)).hooks[0].voice, undefined, 'forged voice is discarded');
  board = await loadBoard(job);
  board.hooks[0].voice = { file: 'voice/hook-H1.mp3', seconds: 5 };
  await saveBoard(job, board, { trustHooks: true });
  board = await loadBoard(job);
  delete board.hooks[0].voice;
  await saveBoard(job, board);
  assert.ok((await loadBoard(job)).hooks[0].voice, 'a client cannot clear it either');
  board = await loadBoard(job);
  board.hooks[0].text = 'Edited hook text';
  await saveBoard(job, board);
  assert.equal((await loadBoard(job)).hooks[0].voice, undefined, 'a changed text no longer matches its voice');
  board.hooks = Array.from({ length: 13 }, (_, i) => hook(`H${i}`, 'x y z'));
  await assert.rejects(() => saveBoard(job, board), /钩子最多/);
});

test('generateHookVoices: needs a voice, an exact confirmed count, runs once, never retries, skips already-voiced', async () => {
  const job = await makeJob([talk('S01', 0, 6, 'Original hook line here'), still('S02', 6, 10)], { hooks: [hook('H1', 'First hook text'), hook('H2', 'Second hook text'), hook('H3', 'Third hook text')] });
  const calls = [];
  const say = async ({ text, voiceId, seconds, language, out }) => { calls.push({ text, voiceId, seconds, language }); if (text.startsWith('Second')) throw new Error('boom'); await writeFile(out, 'mp3'); return out; };
  const duration = async () => 5.43;
  await assert.rejects(() => hk.generateHookVoices(job, { expect: 2, say, duration }), /3 条.*2 条/);
  assert.equal(calls.length, 0, 'nothing billed on a stale confirmation');
  const r = await hk.generateHookVoices(job, { expect: 3, say, duration });
  assert.deepEqual(r.generated, ['H1', 'H3']);
  assert.equal(r.failed[0].id, 'H2');
  assert.equal(r.chars, 'Firsthooktext'.length + 'Thirdhooktext'.length);
  assert.deepEqual(calls.map(c => [c.voiceId, c.seconds, c.language]), [['voice-1', 5.7, 'English'], ['voice-1', 5.7, 'English'], ['voice-1', 5.7, 'English']]);
  const board = await loadBoard(job);
  assert.equal(board.hooks[0].voice.seconds, 5.43);
  assert.equal(board.hooks[1].voice, undefined);
  // the failed one is the only one left: it is retried only when the caller asks again, with the exact count
  const again = await hk.generateHookVoices(job, { expect: 1, say: async ({ out }) => { await writeFile(out, 'mp3'); return out; }, duration });
  assert.deepEqual(again.generated, ['H2']);
  assert.deepEqual(await hk.generateHookVoices(job, { expect: 0, say, duration }), { generated: [], failed: [], chars: 0 });
  const noVoice = await makeJob([talk('S01', 0, 6, 'Original hook line here')], { hooks: [hook('H1', 'First hook text')], voice: null });
  await assert.rejects(() => hk.generateHookVoices(noVoice, { expect: 1, say, duration }), /选一个音色/);
});

test('hooksJob: rewriting voiced hooks needs a replace flag, voicing needs confirm', async () => {
  const job = await makeJob([talk('S01', 0, 6, 'Original hook line here'), still('S02', 6, 10)], { hooks: [hook('H1', 'Voiced hook text')] });
  const board = await loadBoard(job);
  board.hooks[0].voice = { file: 'voice/x.mp3', seconds: 5 };
  await saveBoard(job, board, { trustHooks: true });
  const write = async () => ({ hooks: [{ id: 'H1', text: 'New one', angle: 'pain' }], rejected: [], slot: { shot: 'S01', seconds: 6 } });
  await assert.rejects(() => api.hooksJob(job, { action: 'write', write }), /替换/);
  const r = await api.hooksJob(job, { action: 'write', replace: true, write });
  assert.equal(r.hooks[0].text, 'New one');
  assert.equal((await loadBoard(job)).hooks[0].voice, undefined);
  await assert.rejects(() => api.hooksJob(job, { action: 'voice', count: 1 }), /确认/);
  await assert.rejects(() => api.hooksJob(job, { action: 'other' }), /action/);
});

test('export: each voiced hook becomes its own variant — hook line over non-talking pictures, then the original lines minus the talking hook shot', async () => {
  const voiceOk = (file, seconds) => ({ file, seconds, voiceId: 'voice-1' });
  const job = await makeJob(
    [talk('S01', 0, 6.6, 'Original hook line here'), still('S02', 6.6, 10.6), still('S03', 10.6, 14.6), still('S04', 14.6, 18.6)],
    { hooks: [hook('H1', 'First hook text', voiceOk('voice/hook-H1.mp3', 5)), hook('H2', 'Second hook text'), hook('H3', 'Third hook text', voiceOk('voice/hook-H3.mp3', 40))], files: ['voice/hook-H1.mp3', 'voice/hook-H3.mp3'] });
  const calls = [];
  const fake = async args => { calls.push(args); await mkdir(path.dirname(args.at(-1)), { recursive: true }); await writeFile(args.at(-1), 'x'); };
  const outDir = path.join(tmp, 'hookout');
  const res = await ex.exportToFactory(job, await loadBoard(job), { outDir, variants: 2, ffmpeg: fake });
  assert.deepEqual(res.variants, ['b001', 'b002', 'h01', 'h03'].filter(n => n !== 'h03'));
  assert.deepEqual(res.hookVariants.map(h => [h.name, h.id, h.visuals]), [['h01', 'H1', ['S02', 'S03']]]);
  assert.deepEqual(res.hooksSkipped.map(h => [h.id, h.reason.slice(0, 6)]), [['H2', '还没有配音'], ['H3', '没有足够长的']]);
  const h01 = JSON.parse(await readFile(path.join(outDir, '脚本', 'h01.json'), 'utf8'));
  const b001 = JSON.parse(await readFile(path.join(outDir, '脚本', 'b001.json'), 'utf8'));
  assert.equal(h01.lines[0].text, 'First hook text');
  assert.match(h01.lines[0].wav, /hook_H1\.wav$/);
  assert.ok(existsSync(h01.lines[0].wav));
  assert.deepEqual(h01.lines.slice(1).map(l => l.text), b001.lines.slice(1).map(l => l.text), 'the rest of the cut is shared');
  assert.ok(!h01.lines.some(l => l.text === 'Original hook line here'), 'the talking hook shot is not in a hook variant');
  assert.ok(b001.lines.some(l => l.text === 'Original hook line here'), 'but it stays in the original');
  const index = JSON.parse(await readFile(path.join(outDir, '数据', '素材索引.json'), 'utf8'));
  for (const l of h01.lines) for (const [k] of l.shots) assert.ok(index[k], 'every pinned clip exists in the index');
  h01.lines.forEach((l, i) => { if (i > 0) assert.ok(!(l.tin === 'cut' && h01.lines[i - 1].tin === 'cut')); });
  assert.match(await readFile(res.report, 'utf8'), /## 钩子变体[\s\S]*First hook text[\s\S]*## 没导出的钩子/);
  // opt out
  const none = await ex.exportToFactory(job, await loadBoard(job), { outDir: path.join(tmp, 'hookout2'), variants: 1, hookVariants: false, ffmpeg: fake });
  assert.deepEqual(none.hookVariants, []);
});
