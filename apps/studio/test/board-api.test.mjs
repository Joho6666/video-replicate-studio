import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-boardapi-'));
process.env.STUDIO_DATA_DIR = tmp;
const api = await import('../lib/board-api.mjs');
const { loadBoard, saveBoard } = await import('../lib/board.mjs');
const { jobDir, loadJob } = await import('../lib/jobs.mjs');
test.after(() => rm(tmp, { recursive: true, force: true }));

const stillShot = (id, start, end, extra = {}) => ({ id, start, end, prompt: `prompt ${id}`, source: { kind: 'still', ...extra } });
const fakeGen = calls => async ({ prompt, referenceFile, character, out }) => {
  calls.push({ prompt, referenceFile, character });
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, 'img');
};

test('createScriptJob needs a script and stores it on a draft job', async () => {
  await assert.rejects(() => api.createScriptJob({ text: '   ' }), /请粘贴脚本/);
  const job = await api.createScriptJob({ text: '0:00 hello\n0:04 bye', title: 'Demo' });
  assert.equal(job.status, 'draft');
  assert.equal(job.source.platform, 'script');
  assert.equal(job.meta.title, 'Demo');
  assert.equal((await loadJob(job.id)).script.text, '0:00 hello\n0:04 bye');
});

test('splitJob stores the board returned by the planner and passes the reference photos', async () => {
  const job = await api.createScriptJob({ text: 'a\nb' });
  job.assets = [{ role: 'model', file: 'assets/model.jpg' }, { role: 'product', file: 'assets/p.jpg' }];
  let seen;
  const out = await api.splitJob(job, { split: async (j, opts) => { seen = opts; return { board: { version: 1, shots: [stillShot('S01', 0, 4)], presenter: opts.presenter }, notes: ['n'], usage: null }; } });
  assert.deepEqual(seen.presenter, { image: 'assets/model.jpg' });
  assert.deepEqual(seen.product, { image: 'assets/p.jpg' });
  assert.equal(out.board.shots.length, 1);
  assert.equal((await loadBoard(job)).presenter.image, 'assets/model.jpg');
  await assert.rejects(() => api.splitJob({ id: 'x' }), /不是脚本任务/);
});

async function jobWithBoard(shots, extra = {}) {
  const job = await api.createScriptJob({ text: 'x\ny' });
  await saveBoard(job, { version: 1, shots, ...extra });
  return job;
}

test('pendingStills lists only stills with a prompt and no image on disk', async () => {
  const job = await jobWithBoard([stillShot('S01', 0, 3), stillShot('S02', 3, 6, { image: 'board/S02.jpg' }), { id: 'S03', start: 6, end: 9, source: { kind: 'client' } }]);
  const root = jobDir(job.id);
  await mkdir(path.join(root, 'board'), { recursive: true });
  await writeFile(path.join(root, 'board', 'S02.jpg'), 'x');
  const board = await loadBoard(job);
  assert.deepEqual(api.pendingStills(board, root).map(s => s.id), ['S01']);
  assert.deepEqual(api.pendingStills(board, root, { again: true }).map(s => s.id), ['S01', 'S02']);
  assert.deepEqual(api.pendingStills(board, root, { ids: ['S02'], again: true }).map(s => s.id), ['S02']);
});

test('fillStills refuses a stale confirmation and never generates anything', async () => {
  const job = await jobWithBoard([stillShot('S01', 0, 3), stillShot('S02', 3, 6)]);
  const calls = [];
  await assert.rejects(() => api.fillStills(job, { expect: 1, gen: fakeGen(calls) }), /需要生成 2 张/);
  await assert.rejects(() => api.fillStills(job, { gen: fakeGen(calls) }), /未确认/);
  assert.equal(calls.length, 0);
});

test('fillStills generates one by one, saves each image path and passes the presenter for character shots', async () => {
  const job = await jobWithBoard([stillShot('S01', 0, 3, { character: true }), stillShot('S02', 3, 6)], { presenter: { image: 'assets/model.jpg' } });
  await mkdir(path.join(jobDir(job.id), 'assets'), { recursive: true });
  await writeFile(path.join(jobDir(job.id), 'assets', 'model.jpg'), 'face');
  const calls = [];
  const res = await api.fillStills(job, { expect: 2, gen: fakeGen(calls) });
  assert.deepEqual(res, { generated: ['S01', 'S02'], failed: [], remaining: 0 });
  assert.equal(calls[0].character, true);
  assert.ok(calls[0].referenceFile.endsWith('model.jpg'));
  assert.equal(calls[1].character, false);
  const board = await loadBoard(job);
  assert.deepEqual(board.shots.map(s => s.source.image), ['board/S01.jpg', 'board/S02.jpg']);
  assert.ok(existsSync(path.join(jobDir(job.id), 'board', 'S02.jpg')));
  // a second call has nothing left to do and spends nothing
  const again = await api.fillStills(job, { gen: fakeGen(calls) });
  assert.equal(again.generated.length, 0);
  assert.equal(calls.length, 2);
});

test('fillStills keeps going after a failure, reports it and does not mark the shot as done', async () => {
  const job = await jobWithBoard([stillShot('S01', 0, 3), stillShot('S02', 3, 6)]);
  let n = 0;
  const gen = async ({ out }) => { if (++n === 1) throw new Error('boom'); await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, 'i'); };
  const res = await api.fillStills(job, { expect: 2, gen });
  assert.deepEqual(res.generated, ['S02']);
  assert.deepEqual(res.failed, [{ id: 'S01', error: 'boom' }]);
  const board = await loadBoard(job);
  assert.equal(board.shots[0].source.image, undefined);
});

test('only one still run per job: a concurrent call is rejected before spending', async () => {
  const job = await jobWithBoard([stillShot('S01', 0, 3)]);
  let release;
  const gate = new Promise(r => { release = r; });
  const slow = async ({ out }) => { await gate; await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, 'i'); };
  const first = api.fillStills(job, { expect: 1, gen: slow });
  await new Promise(r => setTimeout(r, 30));
  await assert.rejects(() => api.fillStills(job, { expect: 1, gen: slow }), /正在生成/);
  release();
  assert.deepEqual((await first).generated, ['S01']);
});

test('fillStills caps one call at the per-call limit', async () => {
  const shots = Array.from({ length: api.MAX_STILLS_PER_CALL + 1 }, (_, i) => stillShot(`S${String(i + 1).padStart(2, '0')}`, i * 2, i * 2 + 2));
  const job = await jobWithBoard(shots);
  await assert.rejects(() => api.fillStills(job, { expect: shots.length, gen: fakeGen([]) }), /一次最多/);
});
