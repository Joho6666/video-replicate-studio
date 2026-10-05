import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-gen-'));
process.env.STUDIO_DATA_DIR = tmp;
process.env.MINIMAX_API_KEY = 'test-key';
delete process.env.GENERATE_MAX_CNY;
const gen = await import('../lib/generate.mjs');
const api = await import('../lib/board-api.mjs');
const { loadBoard, saveBoard } = await import('../lib/board.mjs');
const { jobDir } = await import('../lib/jobs.mjs');
test.after(() => rm(tmp, { recursive: true, force: true }));

const shot = (id, start, end, extra = {}) => ({ id, start, end, text: `line ${id}`, prompt: `prompt ${id}`, source: { kind: 'generate' }, generate: { provider: 'h3', resolution: '768P', group: id, ...extra.generate }, ...extra.shot });
async function makeJob(shots, extra = {}) {
  const job = await api.createScriptJob({ text: 'a\nb', title: 'Gen' });
  await saveBoard(job, { version: 1, shots, ...extra });
  return job;
}
const okFetch = (log = []) => async (url, init) => { log.push({ url, body: init?.body ? JSON.parse(init.body) : null }); return { ok: true, status: 200, json: async () => ({ task_id: `T${log.length}` }) }; };
const noWatch = () => {};

test('planGenerate: one call per group, priced by seconds, blocked reasons are explicit', async () => {
  const job = await makeJob([
    shot('S01', 0, 4), shot('S02', 4, 11),
    shot('S03', 11, 15, { generate: { provider: 'wan3', resolution: '480P', group: 'S03' } }),
    shot('S04', 15, 19, { shot: { source: { kind: 'generate', clip: { file: 'clips/x.mp4' } } } }),
    { id: 'S05', start: 19, end: 22, text: 'x', prompt: 'p', source: { kind: 'still', image: 'board/S05.jpg' } },
    shot('S06', 22, 24), shot('S07', 24, 27, { generate: { group: 'S06' } }),
  ]);
  const p = gen.planGenerate(await loadBoard(job));
  assert.deepEqual(p.pending.map(c => [c.shots.join('+'), c.seconds, c.cost]), [['S01', 4, 2], ['S02', 7, 3.5], ['S06+S07', 5, 2.5]]);
  assert.equal(p.total, 8);
  const why = Object.fromEntries(p.blocked.map(c => [c.shots.join('+'), c.blocked]));
  assert.match(why.S03, /wan3 还没有接入/);
  assert.match(why.S04, /已经有视频片段/);
  assert.deepEqual(gen.planGenerate(await loadBoard(job), { ids: ['S02'] }).pending.map(c => c.shots[0]), ['S02']);
});

test('submit: needs the exact confirmed calls and total, respects the cap and the board budget', async () => {
  const job = await makeJob([shot('S01', 0, 4), shot('S02', 4, 8)]);
  const log = [];
  await assert.rejects(() => gen.submitGenerate(job, { expect: { calls: 1, total: 2 }, fetchImpl: okFetch(log), watch: noWatch }), /现在要提交 2 次、共 ¥4\.00/);
  await assert.rejects(() => gen.submitGenerate(job, { fetchImpl: okFetch(log), watch: noWatch }), /未确认/);
  assert.equal(log.length, 0, 'nothing sent on a stale confirmation');
  const big = await makeJob([shot('S01', 0, 15), shot('S02', 15, 30), shot('S03', 30, 45)]);
  await assert.rejects(() => gen.submitGenerate(big, { expect: { calls: 3, total: 22.5 }, fetchImpl: okFetch(log), watch: noWatch }), /超过上限 ¥10\.00/);
  const budget = await makeJob([shot('S01', 0, 4), shot('S02', 4, 8)], { budget: { limit: 3, currency: 'CNY' } });
  await assert.rejects(() => gen.submitGenerate(budget, { expect: { calls: 2, total: 4 }, fetchImpl: okFetch(log), watch: noWatch }), /超过上限 ¥3\.00/);
  assert.equal(log.length, 0);
});

test('submit writes the ledger BEFORE the request, then records the task id; a second submit is refused', async () => {
  const job = await makeJob([shot('S01', 0, 4)]);
  let stateDuringRequest = null;
  const fetchImpl = async (url, init) => {
    stateDuringRequest = (await loadBoard(job)).shots[0].generate.task?.state;
    assert.equal(JSON.parse(init.body).duration, 4);
    assert.equal(JSON.parse(init.body).ratio, '9:16');
    return { ok: true, status: 200, json: async () => ({ task_id: 'TASK-1' }) };
  };
  const watched = [];
  const r = await gen.submitGenerate(job, { expect: { calls: 1, total: 2 }, fetchImpl, watch: (j, id) => watched.push(id) });
  assert.equal(stateDuringRequest, 'submitting', 'the ledger is written before the paid call');
  assert.deepEqual(r.submitted.map(s => s.taskId), ['TASK-1']);
  assert.equal(r.spent, 2);
  assert.deepEqual(watched, ['S01']);
  const task = (await loadBoard(job)).shots[0].generate.task;
  assert.equal(task.state, 'submitted');
  assert.equal(task.taskId, 'TASK-1');
  await assert.rejects(() => gen.submitGenerate(job, { expect: { calls: 0, total: 0 }, fetchImpl: okFetch(), watch: noWatch }), /已提交、还在生成，不会重复提交/);
  // a client cannot forge or erase the ledger through a normal board save
  const board = await loadBoard(job);
  board.shots[0].generate.task = { state: 'failed' };
  await saveBoard(job, board);
  assert.equal((await loadBoard(job)).shots[0].generate.task.state, 'submitted');
  const b2 = await loadBoard(job);
  delete b2.shots[0].generate.task;
  await saveBoard(job, b2);
  assert.equal((await loadBoard(job)).shots[0].generate.task.taskId, 'TASK-1');
});

test('a lost response becomes "unknown", stops the run, and is never resubmitted', async () => {
  const job = await makeJob([shot('S01', 0, 4), shot('S02', 4, 8)]);
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('socket hang up'); };
  const r = await gen.submitGenerate(job, { expect: { calls: 2, total: 4 }, fetchImpl, watch: noWatch });
  assert.equal(calls, 1, 'no second call after an unknown outcome');
  assert.match(r.failed[0].error, /结果不明/);
  const board = await loadBoard(job);
  assert.equal(board.shots[0].generate.task.state, 'unknown');
  assert.equal(board.shots[1].generate.task, undefined, 'the second call was never started');
  const p = gen.planGenerate(board);
  assert.deepEqual(p.pending.map(c => c.shots[0]), ['S02']);
  assert.match(p.blocked[0].blocked, /不会重复提交/);
});

test('a refusal (4xx, no task) is recorded as rejected and the run continues; rejected can be retried', async () => {
  const job = await makeJob([shot('S01', 0, 4), shot('S02', 4, 8)]);
  let n = 0;
  const fetchImpl = async () => (++n === 1
    ? { ok: false, status: 402, json: async () => ({ base_resp: { status_msg: 'insufficient balance' } }) }
    : { ok: true, status: 200, json: async () => ({ task_id: 'TASK-2' }) });
  const r = await gen.submitGenerate(job, { expect: { calls: 2, total: 4 }, fetchImpl, watch: noWatch });
  assert.equal(n, 2);
  assert.match(r.failed[0].error, /402.*余额不足/);
  assert.equal(r.submitted.length, 1);
  const board = await loadBoard(job);
  assert.equal(board.shots[0].generate.task.state, 'rejected');
  assert.deepEqual(gen.planGenerate(board).pending.map(c => c.shots[0]), ['S01'], 'a refused call may be retried, the submitted one may not');
});

test('pollGenerate: success downloads the clip and points every shot of the group at its slice; failure is recorded; again re-runs with history', async () => {
  const job = await makeJob([shot('S01', 0, 4, { generate: { group: 'G' } }), shot('S02', 4, 9, { generate: { group: 'G' } }), shot('S03', 9, 13)]);
  await gen.submitGenerate(job, { expect: { calls: 2, total: 6.5 }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ task_id: `T-${Math.random().toString(36).slice(2, 8)}` }) }), watch: noWatch });
  let board = await loadBoard(job);
  board.shots[0].qc = { verdict: 'FAIL' }; // would be cleared by a new take (set through the trusted path)
  await saveBoard(job, board, { trustQc: true, trustGenerate: true });
  const fetchImpl = async () => ({ status: 200, json: async () => ({ task: { status: 'succeeded', content: { url: 'https://x/y.mp4' } } }) });
  const fetched = [];
  const fetchFile = async (url, out) => { fetched.push(url); await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, 'mp4'); };
  assert.equal(await gen.pollGenerate(job, 'S01', { fetchImpl, fetchFile }), true);
  board = await loadBoard(job);
  assert.deepEqual(fetched, ['https://x/y.mp4']);
  assert.equal(board.shots[0].generate.task.state, 'succeeded');
  assert.equal(board.shots[1].generate.task.state, 'succeeded');
  assert.equal(board.shots[0].source.clip.in, 0);
  assert.equal(board.shots[1].source.clip.in, 4, 'second shot starts 4 s into the take');
  assert.equal(board.shots[0].source.clip.file, board.shots[1].source.clip.file);
  assert.ok(existsSync(path.join(jobDir(job.id), board.shots[0].source.clip.file)));
  assert.equal(board.shots[0].qc, undefined, 'a new take is unchecked');
  assert.equal(board.shots[2].generate.task.state, 'submitted', 'the other group is untouched');
  // failure of the other group
  const failFetch = async () => ({ status: 200, json: async () => ({ task: { status: 'failed' }, base_resp: { status_msg: 'content policy' } }) });
  await gen.pollGenerate(job, 'S03', { fetchImpl: failFetch, fetchFile });
  board = await loadBoard(job);
  assert.equal(board.shots[2].generate.task.state, 'failed');
  assert.match(board.shots[2].generate.task.error, /content policy/);
  // a deliberate re-run of the failed call keeps the old record as history
  const p = gen.planGenerate(board, { again: true, ids: ['S03'] });
  assert.equal(p.pending.length, 1);
  await gen.submitGenerate(job, { ids: ['S03'], again: true, expect: { calls: 1, total: 2 }, fetchImpl: okFetch(), watch: noWatch });
  board = await loadBoard(job);
  assert.equal(board.shots[2].generate.task.state, 'submitted');
  assert.equal(board.shots[2].generate.task.history.length, 1);
  assert.equal(gen.planGenerate(board).pending.length, 0, 'finished and in-flight calls are never offered again without `again`');
  assert.equal(await gen.pollGenerate(job, 'S01', { fetchImpl, fetchFile }), true, 'polling something already done is a no-op');
});

test('generateJob: plan is free, submit needs confirm', async () => {
  const job = await makeJob([shot('S01', 0, 4)]);
  const plan = await api.generateJob(job, { action: 'plan' });
  assert.deepEqual([plan.calls, plan.total], [1, 2]);
  await assert.rejects(() => api.generateJob(job, { action: 'submit', expect: { calls: 1, total: 2 } }), /确认/);
  const r = await api.generateJob(job, { action: 'submit', confirm: true, expect: { calls: 1, total: 2 }, submit: async (j, o) => ({ called: o.expect }) });
  assert.deepEqual(r.called, { calls: 1, total: 2 });
  await assert.rejects(() => api.generateJob(job, { action: 'x' }), /action/);
});
