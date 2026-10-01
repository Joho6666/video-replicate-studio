import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-render-'));
process.env.STUDIO_DATA_DIR = tmp;
const { buildAss, captionEvents, planSegments, renderAnimatic } = await import('../lib/render.mjs');
const { normalizeBoard } = await import('../lib/board.mjs');
const { createJob, jobDir } = await import('../lib/jobs.mjs');
const { ffrun, mediaInfo } = await import('../lib/media.mjs');
const { tools } = await import('../lib/env.mjs');
test.after(() => rm(tmp, { recursive: true, force: true }));

const board = normalizeBoard({
  version: 1, disclaimer: 'AI-generated.', total: 0,
  shots: [
    { id: 'S01', start: 0, end: 2, text: 'Hello there friend', source: { kind: 'reuse', file: 'clips/a.mp4' } },
    { id: 'S02', start: 2, end: 4, text: 'Second line', prompt: 'x', source: { kind: 'still', image: 'board/S02.jpg', overlay: 'KEY\nWORD' } },
    { id: 'S03', start: 4, end: 6, text: '', source: { kind: 'client' } },
    { id: 'S04', start: 6, end: 11, prompt: 'p', source: { kind: 'generate' }, generate: { provider: 'h3', resolution: '768P', group: 'S04' } },
  ],
});

test('planSegments falls back to labelled placeholders when files are missing', () => {
  const plan = planSegments(board, path.join(tmp, 'nowhere'));
  assert.deepEqual(plan.map(p => p.kind), ['placeholder', 'placeholder', 'placeholder', 'placeholder']);
  assert.equal(plan[2].label, '待客户提供素材');
  assert.match(plan[3].label, /待生成 · h3/);
  assert.equal(plan[1].duration, 2);
});

test('captionEvents highlights one word at a time and stays inside the shot', () => {
  const ev = captionEvents('one two three four', 10, 14);
  assert.equal(ev.length, 4);
  assert.match(ev[0], /Dialogue: 0,0:00:10\.00,/);
  assert.match(ev[0], /\{\\c&H0000E0FF&\}ONE/); // active word is yellow
  assert.match(ev[0], /\{\\c&H00FFFFFF&\}TWO/);
  assert.equal(captionEvents('', 0, 3).length, 0);
});

test('buildAss emits keyword cards, placeholder labels and the disclaimer', () => {
  const ass = buildAss(board, planSegments(board, path.join(tmp, 'nowhere')));
  assert.match(ass, /Hook,,0,0,0,,.*KEY\\NWORD/);
  assert.match(ass, /Card,,0,0,0,,待客户提供素材/);
  assert.match(ass, /Small,,0,0,0,,AI-generated\./);
  assert.doesNotMatch(ass, /[{}]\\N\{/); // no stray control blocks from user text
});

test('renderAnimatic renders a real video from clips, stills and placeholders', { skip: !tools.ffmpeg && 'no ffmpeg' }, async () => {
  const job = await createJob({ source: { platform: 'script' } });
  const root = jobDir(job.id);
  await mkdir(path.join(root, 'clips'), { recursive: true });
  await mkdir(path.join(root, 'board'), { recursive: true });
  await ffrun(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=360x640:r=30:d=3', '-pix_fmt', 'yuv420p', path.join(root, 'clips', 'a.mp4')]);
  await ffrun(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=360x640', '-frames:v', '1', path.join(root, 'board', 'S02.jpg')]);
  const out = await renderAnimatic(job, board);
  assert.equal(out.segments, 4);
  assert.equal(out.placeholders, 2); // client + generate not available yet
  assert.ok(existsSync(path.join(root, out.file)));
  const info = await mediaInfo(path.join(root, out.file));
  assert.ok(Math.abs(info.duration - board.total) < 0.6, `duration ${info.duration} vs ${board.total}`);
  assert.equal(info.hasAudio, true);
});
