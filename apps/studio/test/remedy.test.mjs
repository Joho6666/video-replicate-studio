import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { animateMix } from '../lib/animate-mix.mjs';
import { config } from '../lib/env.mjs';
import { loadLedger, patchWindows, planRemedy, runRemedy } from '../lib/remedy.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-remedy-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

test('bad windows are padded, lifted to the model minimum of 2 s, clamped to the video and merged', () => {
  assert.deepEqual(patchWindows([{ start: 8.3, end: 8.9 }], { duration: 12.4 }), [{ start: 7.6, end: 9.6 }]);
  assert.deepEqual(patchWindows([{ start: 0.1, end: 0.4 }], { duration: 12 }), [{ start: 0, end: 2 }]);          // clamped at the start
  assert.deepEqual(patchWindows([{ start: 12.0, end: 12.3 }], { duration: 12.4 }), [{ start: 10.4, end: 12.4 }]); // clamped at the end
  assert.deepEqual(patchWindows([{ start: 3, end: 3.5 }, { start: 4, end: 4.5 }], { duration: 12 }), [{ start: 2.25, end: 5.25 }]);
  assert.throws(() => patchWindows([{ start: 0, end: 1 }], { duration: 1.5 }), /最短/);
});

test('the quote prices each window by mode and adds it up', () => {
  const p = planRemedy({ bad: [{ start: 8.3, end: 8.9 }, { start: 10.7, end: 11.4 }], duration: 12.4, mode: 'wan-pro' });
  assert.equal(p.pending.length, 2);
  assert.equal(p.windows[0].cost, 1.8);
  assert.equal(p.total, 3.6);
  assert.equal(planRemedy({ bad: [{ start: 8.3, end: 8.9 }], duration: 12.4, mode: 'wan-std' }).total, 1.2);
});

test('the hard cap blocks the window that would exceed it', () => {
  const p = planRemedy({ bad: [{ start: 2, end: 2.5 }, { start: 8, end: 8.5 }], duration: 12.4, cap: 2.5 });
  assert.equal(p.pending.length, 1);
  assert.match(p.blocked[0].blocked, /费用上限/);
});

test('nothing is sent without confirm or when the confirmed quote differs from the current one', async () => {
  const plan = planRemedy({ bad: [{ start: 8.3, end: 8.9 }], duration: 12.4 });
  let calls = 0;
  const redo = async () => { calls++; return { file: 'x.mp4', usage: {} }; };
  const ledgerFile = path.join(tmp, 'l1.json');
  await assert.rejects(runRemedy({ plan, confirm: false, expect: { windows: 1, total: 1.8 }, redo, ledgerFile }), /确认/);
  await assert.rejects(runRemedy({ plan, confirm: true, expect: { windows: 1, total: 0.9 }, redo, ledgerFile }), /报价已变化/);
  await assert.rejects(runRemedy({ plan, confirm: true, expect: { windows: 2, total: 1.8 }, redo, ledgerFile }), /报价已变化/);
  assert.equal(calls, 0);
});

test('the ledger entry exists before the paid call, and a finished window is recorded', async () => {
  const plan = planRemedy({ bad: [{ start: 8.3, end: 8.9 }], duration: 12.4 });
  const ledgerFile = path.join(tmp, 'l2.json');
  let seenBefore;
  const r = await runRemedy({ plan, confirm: true, expect: { windows: 1, total: 1.8 }, ledgerFile, redo: async (w, { onSubmitted }) => {
    seenBefore = JSON.parse(await readFile(ledgerFile, 'utf8')).attempts[0].state;
    onSubmitted('task-1');
    return { file: 'patch.mp4', usage: { video_duration: 2 } };
  } });
  assert.equal(seenBefore, 'submitting');
  assert.equal(r.spent, 1.8);
  const l = loadLedger(ledgerFile);
  assert.equal(l.attempts[0].state, 'succeeded');
  assert.equal(l.attempts[0].taskId, 'task-1');
});

test('a task that was submitted but never answered is unknown and is not re-submitted', async () => {
  const bad = [{ start: 8.3, end: 8.9 }];
  const ledgerFile = path.join(tmp, 'l3.json');
  const plan = planRemedy({ bad, duration: 12.4 });
  const r = await runRemedy({ plan, confirm: true, expect: { windows: 1, total: 1.8 }, ledgerFile, redo: async (w, { onSubmitted }) => { onSubmitted('task-9'); throw new Error('轮询超时'); } });
  assert.equal(r.failed[0].state, 'unknown');
  const again = planRemedy({ bad, duration: 12.4, ledger: loadLedger(ledgerFile) });
  assert.equal(again.pending.length, 0);
  assert.match(again.blocked[0].blocked, /还没有结果/);
});

test('an explicit failure is final but counts as an attempt; after two attempts the window is no longer retried automatically', async () => {
  const bad = [{ start: 8.3, end: 8.9 }];
  const ledgerFile = path.join(tmp, 'l4.json');
  const fail = async (w, { onSubmitted }) => { onSubmitted('t'); throw Object.assign(new Error('InvalidVideo.FullFace'), { final: true }); };
  for (let i = 0; i < 2; i++) {
    const plan = planRemedy({ bad, duration: 12.4, ledger: loadLedger(ledgerFile) });
    assert.equal(plan.pending.length, 1);
    assert.equal(plan.windows[0].attempt, i + 1);
    const r = await runRemedy({ plan, confirm: true, expect: { windows: 1, total: 1.8 }, ledgerFile, redo: fail });
    assert.equal(r.failed[0].state, 'failed');
  }
  const third = planRemedy({ bad, duration: 12.4, ledger: loadLedger(ledgerFile) });
  assert.equal(third.pending.length, 0);
  assert.match(third.blocked[0].blocked, /已重试 2 次/);
});

test('animateMix: uploads both files, creates the task, reports the task id at once, polls and saves the video', async () => {
  const img = path.join(tmp, 'm.jpg'), clip = path.join(tmp, 'c.mp4'), out = path.join(tmp, 'out', 'p.mp4');
  await writeFile(img, 'IMG'); await writeFile(clip, 'CLIP');
  config.wan.key = 'sk-test';
  const seen = [];
  let polls = 0;
  const fetchImpl = async (url, opts = {}) => {
    seen.push(`${opts.method || 'GET'} ${String(url).replace(config.wan.base, '').split('?')[0]}`);
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (String(url).includes('/uploads')) return json({ data: { upload_dir: 'dir', upload_host: 'https://oss.test/up', oss_access_key_id: 'k', signature: 's', policy: 'p', x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true' } });
    if (url === 'https://oss.test/up') return { ok: true, status: 200 };
    if (String(url).endsWith('/video-synthesis')) { const b = JSON.parse(opts.body); assert.equal(b.parameters.mode, 'wan-pro'); assert.match(b.input.image_url, /^oss:\/\/dir\/model\.jpg$/); assert.equal(opts.headers['X-DashScope-OssResourceResolve'], 'enable'); return json({ output: { task_id: 'T1', task_status: 'PENDING' } }); }
    if (String(url).includes('/tasks/T1')) return json(++polls < 2 ? { output: { task_status: 'RUNNING' } } : { output: { task_status: 'SUCCEEDED', results: { video_url: 'https://cdn.test/v.mp4' } }, usage: { video_duration: 2 } });
    if (url === 'https://cdn.test/v.mp4') return { ok: true, arrayBuffer: async () => new TextEncoder().encode('VIDEO').buffer };
    throw new Error(`unexpected ${url}`);
  };
  let submittedId = null;
  const r = await animateMix({ clip, image: img, mode: 'wan-pro', outFile: out, fetchImpl, pollMs: 1, onSubmitted: id => { submittedId = id; assert.equal(polls, 0); } });
  assert.equal(submittedId, 'T1');
  assert.equal(await readFile(out, 'utf8'), 'VIDEO');
  assert.deepEqual(r.usage, { video_duration: 2 });
  assert.equal(seen.filter(s => s.includes('video-synthesis')).length, 1);
});

test('animateMix: a FAILED task is a final error carrying the API code', async () => {
  const img = path.join(tmp, 'm2.jpg'), clip = path.join(tmp, 'c2.mp4');
  await writeFile(img, 'IMG'); await writeFile(clip, 'CLIP');
  config.wan.key = 'sk-test';
  const fetchImpl = async (url, opts = {}) => {
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (String(url).includes('/uploads')) return json({ data: { upload_dir: 'd', upload_host: 'https://oss.test/up', oss_access_key_id: 'k', signature: 's', policy: 'p', x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true' } });
    if (url === 'https://oss.test/up') return { ok: true, status: 200 };
    if (String(url).endsWith('/video-synthesis')) return json({ output: { task_id: 'T2' } });
    return json({ output: { task_status: 'FAILED', code: 'InvalidVideo.FullFace', message: 'face' } });
  };
  await assert.rejects(animateMix({ clip, image: img, outFile: path.join(tmp, 'o2.mp4'), fetchImpl, pollMs: 1 }), e => e.final === true && /FullFace/.test(e.message));
});
