import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-auto-'));
process.env.STUDIO_DATA_DIR = tmp;
const api = await import('../lib/board-api.mjs');
const { loadBoard, saveBoard } = await import('../lib/board.mjs');
const { yieldStats } = await import('../lib/qc.mjs');
const { jobDir } = await import('../lib/jobs.mjs');
test.after(() => rm(tmp, { recursive: true, force: true }));

const still = (id, start, prompt, extra = {}) => ({ id, start, end: start + 4, text: `line ${id}`, prompt, source: { kind: 'still', ...extra } });
async function makeJob(shots, extra = {}) {
  const job = await api.createScriptJob({ text: 'a\nb', title: 'Auto' });
  await saveBoard(job, { version: 1, shots, ...extra });
  return job;
}
const fakeGen = calls => async ({ prompt, out }) => { calls.push(prompt); await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, `img${calls.length}`); };
// verdict script per shot: the verdict of its 1st, 2nd, 3rd picture
const fakeCheck = script => async (job, { ids }) => {
  const checked = [];
  for (const id of ids) {
    const v = script[id].shift() || 'PASS';
    checked.push({ id, verdict: v });
    const b = await loadBoard(job);
    const s = b.shots.find(x => x.id === id);
    s.qc = { verdict: v, subject: 'image', checks: [], issues: [], asset: `${id}:${Math.random()}`, at: 'now' };
    s.qcLog = [...(s.qcLog || []), { verdict: v, subject: 'image', asset: s.qc.asset, at: 'now' }];
    await saveBoard(job, b, { trustQc: true });
  }
  return { checked, skipped: [] };
};

test('auto run: only failed pictures are redone, retry prompts lose their negations, the image cap holds, and a stubborn one is reported', async () => {
  const job = await makeJob([still('S01', 0, 'a mug, no phone'), still('S02', 4, 'a pour, no electronic devices'), still('S03', 8, 'a window, nothing else on the table')]);
  const calls = [];
  const verdicts = { S01: ['PASS'], S02: ['FAIL', 'PASS'], S03: ['FAIL', 'FAIL', 'FAIL'] };
  const plan = await api.autoStillsPlan(job);
  assert.deepEqual([plan.shots, plan.max], [3, 9]);
  await assert.rejects(() => api.autoStillsJob(job, { expect: { shots: 3, max: 6 }, gen: fakeGen(calls), check: fakeCheck(verdicts) }), /最多生成 9 张.*最多 6 张/);
  assert.equal(calls.length, 0, 'nothing generated on a stale confirmation');
  const r = await api.autoStillsJob(job, { expect: { shots: plan.shots, max: plan.max }, gen: fakeGen(calls), check: fakeCheck(verdicts) });
  assert.equal(r.images, 3 + 2 + 1, 'round 0: 3 pictures; round 1: S02 and S03; round 2: S03 only');
  assert.deepEqual(r.passed.sort(), ['S01', 'S02']);
  assert.deepEqual(r.stillFailing, ['S03']);
  assert.ok(r.images <= plan.max);
  assert.equal(calls[0], 'a mug, no phone', 'the first attempt uses the prompt as written');
  const retried = calls.slice(3);
  assert.ok(retried.every(p => !/\bno\b|nothing/.test(p)), `retry prompts: ${retried.join(' | ')}`);
  assert.match(retried.at(-1), /still life composition/, 'the second retry adds a positive composition hint');
  const board = await loadBoard(job);
  assert.doesNotMatch(board.shots[1].prompt, /electronic/);
  assert.deepEqual(yieldStats(board).image, { checked: 6, usable: 2, rate: 0.33 });
});

test('stills that already failed QC are picked up with a cleaned prompt; the auto run also fills product-photo stills for free', async () => {
  const job = await makeJob([still('S01', 0, 'a mug, no phone', { image: 'board/S01.jpg' }), still('S02', 4, 'ignored', { useProductImage: true })], { product: { image: 'assets/product.jpg' } });
  const root = jobDir(job.id);
  await mkdir(path.join(root, 'board'), { recursive: true });
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'board/S01.jpg'), 'old');
  await writeFile(path.join(root, 'assets/product.jpg'), 'product');
  const b = await loadBoard(job);
  b.shots[0].qc = { verdict: 'FAIL' };
  await saveBoard(job, b, { trustQc: true });
  const plan = await api.autoStillsPlan(job);
  assert.deepEqual([plan.ids, plan.productStills], [['S01'], 1]);
  const calls = [];
  const make = async (src, out) => { await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, 'product still'); };
  const r = await api.autoStillsJob(job, { expect: { shots: 1, max: 3 }, gen: fakeGen(calls), check: fakeCheck({ S01: ['PASS'] }), make });
  assert.deepEqual(r.passed, ['S01']);
  assert.deepEqual(calls, ['a mug'], 'the earlier failure means the negation is already gone on the first new attempt');
  assert.deepEqual(r.productStills, ['S02']);
  // nothing left to do: no confirmation needed
  const idle = await api.autoStillsJob(job, {});
  assert.equal(idle.images, 0);
  await assert.rejects(() => api.autoStillsJob(job, { maxRetries: 5 }), /重试最多/);
});

test('fillProductStills uses the product photo (free), and refuses when the board has none', async () => {
  const job = await makeJob([still('S01', 0, 'x', { useProductImage: true }), still('S02', 4, 'x', { useProductImage: true })], { product: { image: 'assets/product.jpg' } });
  const root = jobDir(job.id);
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'assets/product.jpg'), 'p');
  const seen = [];
  const ids = await api.fillProductStills(job, { make: async (src, out) => { seen.push(path.basename(src)); await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, 'made'); } });
  assert.deepEqual(ids, ['S01', 'S02']);
  assert.deepEqual(seen, ['product.jpg', 'product.jpg']);
  const board = await loadBoard(job);
  assert.equal(board.shots[0].source.image, 'board/S01.jpg');
  assert.deepEqual(await api.fillProductStills(job, { make: async () => { throw new Error('must not run again'); } }), []);
  assert.equal(api.pendingStills(board, root).length, 0, 'product stills are never "pending AI images"');
  const none = await makeJob([still('S01', 0, 'x', { useProductImage: true })]);
  await assert.rejects(() => api.fillProductStills(none), /没有产品图/);
});

test('yieldStats: pass rates per kind and the real cost of a usable second', () => {
  const board = { shots: [
    { id: 'S01', start: 0, end: 4, qcLog: [{ subject: 'clip', verdict: 'PASS' }], qc: { verdict: 'PASS' }, generate: { task: { state: 'succeeded', taskId: 'A', cost: 2 } } },
    { id: 'S02', start: 4, end: 8, qcLog: [{ subject: 'clip', verdict: 'FAIL' }], qc: { verdict: 'FAIL' }, generate: { task: { state: 'succeeded', taskId: 'B', cost: 2, history: [{ state: 'failed', cost: 2 }, { state: 'rejected', cost: 2 }] } } },
    { id: 'S03', start: 8, end: 12, qcLog: [{ subject: 'image', verdict: 'WARN' }, { subject: 'image', verdict: 'FAIL' }] },
  ] };
  const y = yieldStats(board);
  assert.deepEqual(y.clip, { checked: 2, usable: 1, rate: 0.5 });
  assert.deepEqual(y.image, { checked: 2, usable: 1, rate: 0.5 });
  assert.equal(y.spent, 6, 'two takes plus one earlier failed take; the refused one cost nothing');
  assert.equal(y.usableSeconds, 4);
  assert.equal(y.costPerUsableSecond, 1.5);
  assert.deepEqual(yieldStats({ shots: [] }), { clip: { checked: 0, usable: 0, rate: null }, image: { checked: 0, usable: 0, rate: null }, spent: 0, usableSeconds: 0, costPerUsableSecond: null });
});

test('makeProductStill makes a real 9:16 picture from a product photo with ffmpeg (blurred background, photo kept whole)', async () => {
  const { ffrun, probe } = await import('../lib/media.mjs');
  const { tools } = await import('../lib/env.mjs');
  const src = path.join(tmp, 'bottle.png');
  await ffrun(tools.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=600x400', '-frames:v', '1', src]); // a wide product photo
  const out = path.join(tmp, 'out', 'S01.jpg');
  await api.makeProductStill(src, out);
  const info = await probe(out);
  assert.deepEqual([info.width, info.height], [1080, 1920]);
});
