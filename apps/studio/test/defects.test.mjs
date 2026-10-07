import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addSample, evaluateDetector, listSamples, summary, trustGate } from '../lib/defects.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-defects-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const dir = path.join(tmp, 'lib');
const img = async name => { const f = path.join(tmp, name); await writeFile(f, name); return f; };

test('samples are stored with a part, a label and (for bad ones) a kind; the library summarises per part', async () => {
  const a = addSample({ image: await img('a.jpg'), part: 'hand', label: 'bad', kind: 'extra_digit', note: '左手 6 指' }, dir);
  const b = addSample({ image: await img('b.jpg'), part: 'hand', label: 'good' }, dir);
  addSample({ image: await img('c.jpg'), part: 'leg', label: 'bad', kind: 'distorted' }, dir);
  assert.deepEqual([a.id, b.id], ['d0001', 'd0002']);
  assert.equal(b.kind, 'none');
  assert.deepEqual(summary(dir), { hand: { bad: 1, good: 1 }, leg: { bad: 1, good: 0 } });
  assert.equal(listSamples({ part: 'leg' }, dir).length, 1);
  assert.equal(listSamples({ label: 'bad' }, dir).length, 2);
});

test('bad input is refused', async () => {
  const f = await img('x.jpg');
  assert.throws(() => addSample({ image: f, part: 'elbow', label: 'bad' }, dir), /部位/);
  assert.throws(() => addSample({ image: f, part: 'hand', label: 'maybe' }, dir), /标签/);
  assert.throws(() => addSample({ image: f, part: 'hand', label: 'bad', kind: 'weird' }, dir), /问题类型/);
  assert.throws(() => addSample({ image: path.join(tmp, 'nope.jpg'), part: 'hand', label: 'bad' }, dir), /不存在/);
});

let libCount = 0;
async function bigLib() {
  const d = path.join(tmp, `big${libCount++}`);
  for (let i = 0; i < 6; i++) addSample({ image: await img(`bad${i}.jpg`), part: 'hand', label: 'bad', kind: 'extra_digit', note: `bad${i}` }, d);
  for (let i = 0; i < 6; i++) addSample({ image: await img(`good${i}.jpg`), part: 'hand', label: 'good', note: `good${i}` }, d);
  return d;
}

test('a detector that always says anomaly, or always says fine, is caught and must not be trusted', async () => {
  const d = await bigLib();
  const always = await evaluateDetector(async () => true, { dir: d });
  assert.equal(always.recall, 1);
  assert.equal(always.specificity, 0);
  assert.equal(trustGate(always).trusted, false);
  assert.match(trustGate(always).reason, /误报/);
  const never = await evaluateDetector(async () => false, { dir: d });
  assert.equal(never.recall, 0);
  assert.match(trustGate(never).reason, /漏报/);
});

test('a detector that really separates the samples passes; abstentions are not verdicts', async () => {
  const d = await bigLib();
  const good = await evaluateDetector(async (file, s) => s.note.startsWith('bad'), { dir: d });
  assert.equal(good.accuracy, 1);
  assert.deepEqual(trustGate(good), { trusted: true, reason: '通过' });
  const flaky = await evaluateDetector(async (file, s) => { if (s.note === 'bad0') throw new Error('timeout'); return s.note.startsWith('bad'); }, { dir: d });
  assert.equal(flaky.abstained, 1);
  assert.equal(flaky.scored, 11);
  assert.equal(flaky.bad, 5);
});

test('too few samples: no detector is trusted yet', async () => {
  const ev = await evaluateDetector(async () => true, { dir });
  assert.match(trustGate(ev).reason, /样本不够/);
});
