import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The store writes under STUDIO_DATA_DIR; point it at a throw-away directory before importing.
const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-board-'));
process.env.STUDIO_DATA_DIR = tmp;
const { billableSeconds, estimateCost, fromDirector, fromLegacyShotsJson, normalizeBoard, saveBoard, boardFile, validateBoard } = await import('../lib/board.mjs');
const { createJob } = await import('../lib/jobs.mjs');
test.after(() => rm(tmp, { recursive: true, force: true }));

const gen = (id, start, end, extra = {}) => ({ id, start, end, prompt: 'p', source: { kind: 'generate' }, generate: { provider: 'h3', resolution: '768P', ...extra } });
const still = (id, start, end) => ({ id, start, end, prompt: 'a still', source: { kind: 'still' } });
const board = shots => ({ version: 1, shots });

test('billableSeconds clamps into each provider band and ignores float noise', () => {
  assert.equal(billableSeconds('h3', 2.1), 4);
  assert.equal(billableSeconds('h3', 9.02), 9);
  assert.equal(billableSeconds('h3', 14.63), 15);
  assert.equal(billableSeconds('wan3', 2), 5);
  assert.ok(Number.isNaN(billableSeconds('nope', 5)));
});

test('estimateCost only counts generated shots and prices a shared group once', () => {
  const b = board([still('S01', 0, 6), gen('S02', 6, 9, { group: 1 }), gen('S03', 9, 12.4, { group: 1 }), gen('S04', 12.4, 18, { group: 'solo' })]);
  const est = estimateCost(b);
  // group 1 = 6.4 s → 7 billable s × 0.5; solo = 5.6 s → 6 s × 0.5
  assert.equal(est.total, 3.5 + 3);
  assert.equal(est.byShot.S01, undefined);
  assert.equal(est.calls.length, 2);
  assert.deepEqual(est.calls.map(c => c.seconds), [7, 6]);
  const parts = est.byShot.S02.estimate + est.byShot.S03.estimate;
  assert.ok(Math.abs(parts - 3.5) < 0.02);
});

test('unknown prices are reported instead of being guessed', () => {
  const b = board([gen('S01', 0, 5, { resolution: '2K' })]);
  const est = estimateCost(b);
  assert.deepEqual(est.unknown, ['S01']);
  assert.equal(est.total, 0);
});

test('validateBoard rejects bad times, sources, durations and duplicate ids', () => {
  const bad = x => validateBoard(board(x)).errors.join(' | ');
  assert.match(bad([still('S01', 3, 3)]), /时间无效/);
  assert.match(bad([still('S01', 0, 2), still('S01', 2, 4)]), /id 重复/);
  assert.match(bad([still('S01', 4, 6), still('S02', 0, 2)]), /排序/);
  assert.match(bad([{ id: 'S01', start: 0, end: 2, source: { kind: 'magic' } }]), /来源必须是/);
  assert.match(bad([{ id: 'S01', start: 0, end: 2, source: { kind: 'reuse' } }]), /source\.file/);
  assert.match(bad([{ id: 'S01', start: 0, end: 2, source: { kind: 'client' }, generate: { provider: 'h3', resolution: '768P' } }]), /客户提供/);
  assert.match(bad([gen('S01', 0, 20)]), /超过 h3 上限 15s/);
  assert.match(bad([{ ...gen('S01', 0, 5), generate: { provider: 'h3', resolution: '4K' } }]), /不支持分辨率/);
  assert.match(bad([{ ...gen('S01', 0, 5), prompt: '' }]), /提示词/);
  assert.equal(validateBoard(board([still('S01', 0, 5), gen('S02', 5, 10)])).ok, true);
});

test('normalizeBoard discards client-supplied cost and recomputes totals and budget', () => {
  const b = normalizeBoard({ version: 1, budget: { limit: 2 }, shots: [{ ...gen('S01', 0, 5), cost: { estimate: 0.01 } }] });
  assert.equal(b.shots[0].cost.estimate, 2.5);
  assert.equal(b.total, 5);
  assert.equal(b.overBudget, true);
  assert.equal(b.shots[0].status, 'draft');
});

test('fromLegacyShotsJson maps the research format', () => {
  const b = fromLegacyShotsJson({ shots: [
    { id: 'S01', start: 0, end: 6.6, line: 1, source: 'h3', clip: 'h3/a.mp4', in: 0, visual: 'talk' },
    { id: 'S02', start: 6.6, end: 9.6, source: 'still', image: 'board/S02.jpg', prompt: 'x', overlay: 'HI', character: true },
    { id: 'S03', start: 9.6, end: 12.6, source: 'client', image: 'client/t.jpg' },
    { id: 'S04', start: 12.6, end: 17.6, source: 'h3_new', visual: 'head shake' },
  ] });
  assert.deepEqual(b.shots.map(s => s.source.kind), ['reuse', 'still', 'client', 'generate']);
  assert.equal(b.shots[3].prompt, 'head shake');
  assert.equal(b.estimate.total, 2.5);
  assert.equal(validateBoard(b).ok, true);
  assert.throws(() => fromLegacyShotsJson({ shots: [{ id: 'S', start: 0, end: 1, source: 'wat' }] }), /未知来源/);
});

test('fromDirector groups shots by segment so a segment is billed once', () => {
  const job = {
    id: 'job-test-1', meta: { title: 'demo' },
    shots: [{ index: 1, start: 0, end: 4 }, { index: 2, start: 4, end: 9 }, { index: 3, start: 9, end: 12 }],
    director: { shots: [{ subject: 'a', action: 'b', h3_en: 'A man runs.' }, { h3_en: 'Cut to a cat.' }, { h3_en: 'Wide shot.' }], segments: [{ index: 1, shots: [1, 2] }, { index: 2, shots: [3] }] },
  };
  const b = fromDirector(job);
  assert.equal(b.shots.length, 3);
  assert.equal(b.shots[0].generate.group, 1);
  assert.equal(b.shots[2].generate.group, 2);
  // segment 1 = 9 s → 9 × 0.5 ; segment 2 = 3 s → clamped to 4 s × 0.5
  assert.equal(b.estimate.total, 4.5 + 2);
  assert.equal(validateBoard(b).ok, true);
  assert.throws(() => fromDirector({ id: 'x', shots: [], director: null }), /导演拆解/);
});

test('saveBoard refuses invalid boards and writes a normalized file plus a job summary', async () => {
  const job = await createJob({ source: { platform: 'script' } });
  await assert.rejects(() => saveBoard(job, board([still('S01', 3, 3)])), /时间无效/);
  const saved = await saveBoard(job, board([still('S01', 0, 4), gen('S02', 4, 9)]));
  const onDisk = JSON.parse(await readFile(boardFile(job), 'utf8'));
  assert.equal(onDisk.estimate.total, saved.estimate.total);
  assert.equal(onDisk.estimate.total, 2.5);
  assert.deepEqual({ shots: job.board.shots, estimate: job.board.estimate }, { shots: 2, estimate: 2.5 });
});
