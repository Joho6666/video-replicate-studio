import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-qc-'));
process.env.STUDIO_DATA_DIR = tmp;
process.env.DEEPSEEK_API_KEY = 'test-key'; // vision calls are always injected in tests
const qc = await import('../lib/qc.mjs');
const { loadBoard, saveBoard } = await import('../lib/board.mjs');
const { createScriptJob } = await import('../lib/board-api.mjs');
const { jobDir } = await import('../lib/jobs.mjs');
const { ffrun } = await import('../lib/media.mjs');
const { tools } = await import('../lib/env.mjs');
test.after(() => rm(tmp, { recursive: true, force: true }));

const ok = { info: { width: 720, height: 1280, duration: 6, audioCodec: 'aac' }, decodeError: null, black: [], freeze: [], freezeOpen: false, meanVolume: -20 };

test('parseDetectors reads black, freeze and volume facts', () => {
  const d = qc.parseDetectors('[blackdetect @ 0x1] black_start:1.5 black_end:2.5 black_duration:1\n[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 3\n[freezedetect @ 0x2] lavfi.freezedetect.freeze_duration: 2.4\n[Parsed_volumedetect_0 @ 0x3] mean_volume: -23.4 dB');
  assert.deepEqual(d.black, [{ start: 1.5, end: 2.5, duration: 1 }]);
  assert.deepEqual(d.freeze, [2.4]);
  assert.equal(d.meanVolume, -23.4);
  assert.equal(qc.parseDetectors('mean_volume: -inf dB').meanVolume, -Infinity);
});

test('objectiveChecks: a clean clip passes, every hard problem fails', () => {
  const level = (m, o) => qc.decide(qc.objectiveChecks({ ...ok, ...m }, o), []);
  assert.equal(level({}, { need: 5, speech: true }), 'PASS');
  assert.equal(level({ decodeError: 'boom' }), 'FAIL');
  assert.equal(level({ info: { ...ok.info, width: 1280, height: 720 } }), 'FAIL');
  assert.equal(level({}, { need: 9 }), 'FAIL'); // clip shorter than the shot needs
  assert.equal(level({ black: [{ start: 0, end: 1, duration: 1 }] }), 'FAIL');
  assert.equal(level({ meanVolume: -Infinity }, { speech: true }), 'FAIL');
  assert.equal(level({ meanVolume: -Infinity }, { speech: false }), 'PASS'); // silence is fine without a spoken line
  assert.equal(level({ freeze: [2] }), 'WARN'); // short freeze is a warning, long one fails
  assert.equal(level({ freeze: [3.5] }), 'FAIL');
});

test('sanitizeIssues drops claims that cannot be checked against a frame', () => {
  const { kept, dropped } = qc.sanitizeIssues([
    { code: 'text_or_logo', severity: 'high', frame: 2, evidence: 'a logo on the bottle' },
    { code: 'text_or_logo', severity: 'high', evidence: 'no frame given' },
    { code: 'made_up_code', severity: 'high', frame: 1, evidence: 'whatever it says' },
    { code: 'body_merge', severity: 'low', frame: 1, evidence: 'severity not allowed' },
    { code: 'body_merge', severity: 'medium', frame: 9, evidence: 'frame out of range' },
    { code: 'body_merge', severity: 'medium', frame: 1, evidence: '' },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 5);
  assert.deepEqual(qc.sanitizeIssues('nope'), { kept: [], dropped: [] });
});

test('decide: high issue fails, medium warns, objective failure beats a clean model', () => {
  const pass = [{ id: 'x', ok: true, level: 'PASS' }];
  assert.equal(qc.decide(pass, []), 'PASS');
  assert.equal(qc.decide(pass, [{ severity: 'medium' }]), 'WARN');
  assert.equal(qc.decide(pass, [{ severity: 'high' }]), 'FAIL');
  assert.equal(qc.decide([{ level: 'FAIL' }], []), 'FAIL');
});

test('visionCheck sends the frames, repairs bad JSON once, then gives up', async () => {
  const frames = ['a', 'b'].map(x => path.join(tmp, `${x}.jpg`));
  const { writeFile } = await import('node:fs/promises');
  await Promise.all(frames.map(f => writeFile(f, 'jpg')));
  const seen = [];
  const replies = ['not json', JSON.stringify({ issues: [{ code: 'body_merge', severity: 'high', frame: 2, evidence: 'arm melts into the cup' }, { code: 'text_or_logo', severity: 'high', evidence: 'x' }], summary: 's' })];
  const r = await qc.visionCheck({ frames, prompt: 'p', chat: async m => { seen.push(m.length); return { text: replies.shift(), model: 'm' }; } });
  assert.deepEqual(seen, [2, 4]);
  assert.equal(r.issues.length, 1);
  assert.equal(r.dropped, 1);
  await assert.rejects(() => qc.visionCheck({ frames, prompt: 'p', chat: async () => ({ text: 'still not json' }) }), /两次/);
});

test('measureClip + objectiveChecks work on real ffmpeg output (black clip fails, colourful clip passes)', async () => {
  const dir = path.join(tmp, 'media');
  await mkdir(dir, { recursive: true });
  const make = (name, src) => ffrun(tools.ffmpeg, ['-y', '-f', 'lavfi', '-i', `${src},format=yuv420p`, '-t', '3', '-c:v', 'libx264', '-r', '25', path.join(dir, name)]).then(() => path.join(dir, name));
  const moving = await make('moving.mp4', 'testsrc2=size=360x640:rate=25');
  const black = await make('black.mp4', 'color=c=black:size=360x640:rate=25');
  const good = qc.objectiveChecks(await qc.measureClip(moving, { start: 0, duration: 2 }), { need: 2 });
  assert.equal(qc.decide(good, []), 'PASS');
  const bad = qc.objectiveChecks(await qc.measureClip(black, { start: 0, duration: 2 }), { need: 2 });
  assert.equal(qc.decide(bad, []), 'FAIL');
  assert.ok(bad.find(c => c.id === 'black' && !c.ok));
});

async function jobWithClips(shots) {
  const job = await createScriptJob({ text: 'a\nb\nc' });
  await saveBoard(job, { version: 1, shots });
  return job;
}
const gen = (id, start, end, extra = {}) => ({ id, start, end, prompt: `prompt ${id}`, text: '', source: { kind: 'generate', ...extra.source }, generate: { provider: 'h3', resolution: '768P', group: id, ...extra.generate } });

test('runQc stores verdicts, marks FAIL shots failed, plans only their paid re-run, and skips shots without a clip', async () => {
  const job = await jobWithClips([
    gen('S01', 0, 5, { source: { clip: { file: 'clips/a.mp4' } } }),
    gen('S02', 5, 10, { source: { clip: { file: 'clips/b.mp4' } } }),
    gen('S03', 10, 15),
    { id: 'S04', start: 15, end: 18, prompt: 'x', source: { kind: 'still' } },
  ]);
  await mkdir(path.join(jobDir(job.id), 'clips'), { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(jobDir(job.id), 'clips', 'a.mp4'), 'x');
  await writeFile(path.join(jobDir(job.id), 'clips', 'b.mp4'), 'x');
  const measure = async file => (file.endsWith('b.mp4') ? { ...ok, black: [{ start: 0, end: 2, duration: 2 }] } : ok);
  const res = await qc.runQc(job, { measure, useVision: false });
  assert.deepEqual(res.checked, [{ id: 'S01', verdict: 'PASS' }, { id: 'S02', verdict: 'FAIL' }]);
  assert.deepEqual(res.skipped.map(s => s.id), ['S03', 'S04']);
  const board = await loadBoard(job);
  assert.equal(board.shots[1].status, 'failed');
  assert.equal(board.shots[0].qc.verdict, 'PASS');
  assert.deepEqual(res.plan.shots, ['S02']);
  assert.equal(res.plan.total, 2.5); // 5 s × ¥0.5, only the failed shot
  assert.deepEqual(qc.qcSummary(board), { PASS: 1, WARN: 0, FAIL: 1, none: 2 });

  // already-checked shots are not re-checked unless `again`
  const again = await qc.runQc(job, { measure: async () => { throw new Error('should not run'); }, useVision: false, ids: ['S01'] });
  assert.deepEqual(again.checked, []);
});

test('a client cannot forge or clear a verdict through a normal board save', async () => {
  const job = await jobWithClips([gen('S01', 0, 5, { source: { clip: { file: 'clips/a.mp4' } } })]);
  const board = await loadBoard(job);
  board.shots[0].qc = { verdict: 'FAIL' };
  await saveBoard(job, board);
  assert.equal((await loadBoard(job)).shots[0].qc, undefined, 'forged verdict is discarded');
  const b = await loadBoard(job);
  b.shots[0].qc = { verdict: 'PASS', checks: [], issues: [] };
  await saveBoard(job, b, { trustQc: true });
  const c = await loadBoard(job);
  delete c.shots[0].qc;
  await saveBoard(job, c);
  assert.equal((await loadBoard(job)).shots[0].qc.verdict, 'PASS', 'a client cannot clear it either');
});

test('resolveShotClip follows an explicit clip, a reused file, or a finished H3 segment', () => {
  const job = { id: 'fakejob-0001', h3: { 2: { state: 'succeeded', video: 'h3/seg2/h3.mp4' }, 3: { state: 'submitted', video: null } }, director: { segments: [{ index: 2, start: 10 }, { index: 3, start: 20 }] } };
  const root = jobDir('fakejob-0001');
  assert.equal(qc.resolveShotClip(job, { source: { kind: 'generate', clip: { file: 'c.mp4', in: 1 } } }).in, 1);
  assert.equal(qc.resolveShotClip(job, { source: { kind: 'reuse', file: 'r.mp4', in: 2 } }).file, path.join(root, 'r.mp4'));
  const seg = qc.resolveShotClip(job, { start: 12, end: 15, source: { kind: 'generate' }, generate: { group: 2 } });
  assert.deepEqual({ file: seg.file, in: seg.in }, { file: path.join(root, 'h3/seg2/h3.mp4'), in: 2 });
  assert.equal(qc.resolveShotClip(job, { start: 22, end: 25, source: { kind: 'generate' }, generate: { group: 3 } }), null);
  assert.equal(qc.resolveShotClip(job, { source: { kind: 'reuse', file: '../../escape.mp4' } }), null, 'paths cannot leave the job folder');
});

test('stills are checked too: objective facts + a cited vision verdict, and regenerating the picture clears the old verdict', async () => {
  const job = await jobWithClips([
    { id: 'S01', start: 0, end: 3, prompt: 'a mug on a table', text: 'x', source: { kind: 'still', image: 'board/S01.jpg' } },
    { id: 'S02', start: 3, end: 6, prompt: 'a mug', text: 'y', source: { kind: 'still', image: 'board/S02.jpg' } },
    { id: 'S03', start: 6, end: 9, prompt: 'a mug', text: 'z', source: { kind: 'still', image: 'board/S03.jpg' } },
    { id: 'S04', start: 9, end: 12, prompt: 'a mug', text: 'w', source: { kind: 'still', image: 'board/S04.jpg' } },
  ]);
  const { writeFile } = await import('node:fs/promises');
  await mkdir(path.join(jobDir(job.id), 'board'), { recursive: true });
  for (const n of [1, 2, 3]) await writeFile(path.join(jobDir(job.id), `board/S0${n}.jpg`), 'x'); // S04 has no file yet
  const good = { info: { width: 720, height: 1280, duration: 0 }, decodeError: null, black: [], freeze: [], freezeOpen: false, meanVolume: null };
  const measureStill = async f => (f.endsWith('S02.jpg') ? { ...good, blank: true } : f.endsWith('S03.jpg') ? { ...good, info: { ...good.info, width: 1280, height: 720 } } : good);
  const seen = [];
  const vision = async ({ frames, prompt }) => { seen.push({ frames, prompt }); return { issues: [{ code: 'unexpected_object', severity: 'high', frame: 1, evidence: 'a phone lies next to the mug' }], dropped: 0, summary: 's', model: 'm' }; };
  const r = await qc.runQc(job, { measureStill, vision });
  assert.deepEqual(r.checked, [{ id: 'S01', verdict: 'FAIL' }, { id: 'S02', verdict: 'FAIL' }, { id: 'S03', verdict: 'FAIL' }]);
  assert.deepEqual(r.skipped.map(x => x.id), ['S04']);
  assert.equal(seen[0].frames.length, 1, 'a still is sent as one image');
  assert.equal(seen[0].prompt, 'a mug on a table');
  const board = await loadBoard(job);
  assert.equal(board.shots[0].qc.subject, 'image');
  assert.equal(board.shots[0].qc.issues[0].code, 'unexpected_object');
  assert.ok(board.shots[1].qc.checks.some(c => c.id === 'blank' && !c.ok), 'a blank picture fails without any model');
  assert.ok(board.shots[2].qc.checks.some(c => c.id === 'orientation' && !c.ok), 'a landscape still fails in a 9:16 board');
  assert.equal(board.shots[0].status, 'failed');
  // regenerating the picture clears its verdict and the failed status
  const api = await import('../lib/board-api.mjs');
  const res = await api.fillStills(job, { ids: ['S01'], again: true, expect: 1, gen: async ({ out }) => writeFile(out, 'new') });
  assert.deepEqual(res.generated, ['S01']);
  const after = await loadBoard(job);
  assert.equal(after.shots[0].qc, undefined);
  assert.equal(after.shots[0].status, 'draft');
  assert.equal(after.shots[1].qc.verdict, 'FAIL', 'other shots keep their verdict');
  // a real, flat image is detected as blank by ffmpeg itself
  const flat = path.join(tmp, 'flat.png');
  await ffrun(tools.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=white:size=360x640', '-frames:v', '1', flat]);
  const m = await qc.measureImage(flat);
  assert.equal(m.blank, true);
  assert.equal(m.info.height, 640);
  const busy = path.join(tmp, 'busy.png');
  await ffrun(tools.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640', '-frames:v', '1', busy]);
  assert.equal((await qc.measureImage(busy)).blank, false);
});
