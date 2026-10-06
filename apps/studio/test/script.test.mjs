import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBoardFromPlan, checkPlan, layoutUntimed, parseClock, parseTimedScript, scriptLines, speechSeconds } from '../lib/script.mjs';
import { validateBoard } from '../lib/board.mjs';

test('parseClock reads mm:ss, mm:ss.s and h:mm:ss', () => {
  assert.equal(parseClock('0:06'), 6);
  assert.equal(parseClock('00:14.5'), 14.5);
  assert.equal(parseClock('1:02:03'), 3723);
  assert.equal(parseClock('00:06,6'), 6.6);
});

test('parseTimedScript handles ranges, start-only lines and wrapped text', () => {
  const lines = parseTimedScript('[00:00-00:06.6] At 48, nothing works.\n00:06.6 – 00:14 When I saw\nthe scale not move.\n0:14 I breathed wrong.', 17);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map(l => [l.start, l.end]), [[0, 6.6], [6.6, 14], [14, 17]]);
  assert.equal(lines[1].text, 'When I saw the scale not move.');
});

test('parseTimedScript returns null for prose or a single timed line', () => {
  assert.equal(parseTimedScript('Just a sentence.\nAnother sentence about 90 days.'), null);
  assert.equal(parseTimedScript('0:00 only one'), null);
  assert.equal(parseTimedScript('0:10-0:05 backwards\n0:20 next'), null);
});

test('speechSeconds uses character pace for Chinese and word pace for English, min 2 s', () => {
  assert.equal(speechSeconds('今天给大家推荐一款真的很好用的东西哦'), 4);
  assert.equal(speechSeconds('hi'), 2);
  assert.equal(speechSeconds('one two three four five six seven eight nine ten'), 3.8);
});

test('layoutUntimed spreads sentences back to back by speaking length', () => {
  const lines = layoutUntimed('Hello there and welcome back to my channel today.\n\nSecond one.');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].start, 0);
  assert.equal(lines[1].start, lines[0].end);
  assert.deepEqual(scriptLines('Hello there and welcome back to my channel today.\nSecond one.').map(l => l.text), lines.map(l => l.text));
});

const plan = kinds => ({ shots: kinds.map((kind, i) => ({ line: i + 1, kind, visual: `画面${i + 1}`, prompt_en: `Photorealistic vertical phone photo, scene number ${i + 1} in soft light`, character: kind !== 'graphic', overlay: kind === 'graphic' ? 'AMPK' : '' })) });
const lines = [
  { start: 0, end: 6.6, text: 'hook' }, { start: 6.6, end: 9.6, text: 'scale' }, { start: 9.6, end: 12.6, text: 'meet the expert' },
  { start: 12.6, end: 17, text: 'graphic' }, { start: 17, end: 22, text: 'talk again' }, { start: 22, end: 26, text: 'product' },
];

test('checkPlan requires one valid shot per line', () => {
  assert.deepEqual(checkPlan(plan(['talk', 'broll']), 2).hard, []);
  assert.match(checkPlan(plan(['talk']), 2).hard.join('|'), /数量/);
  assert.match(checkPlan({ shots: [{ kind: 'wat', visual: 'x', prompt_en: 'long enough prompt text' }] }, 1).hard.join('|'), /kind 无效/);
  assert.match(checkPlan({ shots: [{ kind: 'talk', visual: 'x', prompt_en: 'short' }] }, 1).hard.join('|'), /prompt_en/);
  assert.match(checkPlan({}, 1).hard.join('|'), /shots/);
});

test('buildBoardFromPlan decides paid shots in code: talk only, within the generate cap', () => {
  const board = buildBoardFromPlan(lines, plan(['talk', 'broll', 'expert', 'graphic', 'talk', 'product']), { maxGenerateSeconds: 10 });
  const kinds = board.shots.map(s => s.source.kind);
  // hook talk (6.6 s → 7 s) fits the 10 s cap; the second talk (5 s) would exceed it → still
  assert.deepEqual(kinds, ['generate', 'still', 'client', 'still', 'still', 'still']);
  assert.equal(board.shots[0].generate.provider, 'h3');
  assert.equal(board.shots[4].source.character, true);
  assert.equal(board.shots[3].source.overlay, 'AMPK');
  assert.equal(board.shots[5].source.productOverlay, true);
  assert.equal(board.shots[2].prompt, ''); // expert shots are never invented
  assert.equal(board.estimate.total, 3.5);
  assert.equal(validateBoard(board).ok, true);
});

test('a talk shot longer than the provider limit is never sent to generation', () => {
  const long = [{ start: 0, end: 20, text: 'long monologue' }, { start: 20, end: 24, text: 'next' }];
  const board = buildBoardFromPlan(long, plan(['talk', 'broll']), { maxGenerateSeconds: 100 });
  assert.equal(board.shots[0].source.kind, 'still');
  assert.equal(board.estimate.total, 0);
});

test('a shot that shows a scientist or doctor is never AI-generated, even if the model called it b-roll', () => {
  const two = [{ start: 0, end: 4, text: 'a' }, { start: 4, end: 8, text: 'b' }, { start: 8, end: 12, text: 'c' }];
  const p = { shots: [
    { line: 1, kind: 'broll', visual: '女性与穿白大褂的科学家交谈', prompt_en: 'Photorealistic vertical phone photo, a woman talking with a scientist in a lab coat in a bright office', character: true },
    { line: 2, kind: 'graphic', visual: '细胞动画', prompt_en: 'Photorealistic vertical phone photo, 3D render of a cell, glowing particles, no people at all', character: false },
    { line: 3, kind: 'broll', visual: '厨房', prompt_en: 'Photorealistic vertical phone photo, a woman in a bright kitchen drinking water', character: true },
  ] };
  const board = buildBoardFromPlan(two, p);
  assert.deepEqual(board.shots.map(s => s.source.kind), ['client', 'still', 'still']);
  assert.equal(board.shots[0].prompt, '');
  assert.match(board.shots[0].source.reason, /客户提供真人素材/);
  assert.equal(validateBoard(board).ok, true);
});

test('checkPlan rejects prompts that name unwanted things (the model draws what you name), but allows "no text"', () => {
  const ok = { shots: [{ kind: 'broll', visual: 'x', prompt_en: 'Photorealistic vertical photo of a mug on a table, no text, no watermark' }] };
  assert.deepEqual(checkPlan(ok, 1).hard, []);
  const bad = { shots: [{ kind: 'broll', visual: 'x', prompt_en: 'Photorealistic vertical photo of a mug on a table, no phone in the frame' }] };
  assert.match(checkPlan(bad, 1).hard.join('|'), /否定句「no phone/);
});

test('product shots use the real product photo when the board has one, and the AI overlay hack otherwise', () => {
  const lines = [{ start: 0, end: 4, text: 'a' }, { start: 4, end: 8, text: 'b' }];
  const plan = { shots: [{ kind: 'product', visual: 'v', prompt_en: 'Photorealistic product close-up photo', character: false }, { kind: 'product', visual: 'v', prompt_en: 'Photorealistic product close-up photo', character: false }] };
  const withPhoto = buildBoardFromPlan(lines, plan, { product: { image: 'assets/p.jpg' } });
  assert.equal(withPhoto.shots[0].source.useProductImage, true);
  assert.equal(withPhoto.shots[0].source.productOverlay, false);
  const without = buildBoardFromPlan(lines, plan, {});
  assert.equal(without.shots[0].source.useProductImage, undefined);
  assert.equal(without.shots[0].source.productOverlay, true);
});
