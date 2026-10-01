import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSegment, planSegments } from '../lib/director.mjs';
import { compileH3, h3Duration, h3Time } from '../lib/h3.mjs';
import { stripTimes } from '../lib/media.mjs';

const shot = (index, start, end, cut = 'hard') => ({ index, start, end, duration: Math.round((end - start) * 100) / 100, cut });

test('h3Time pads minutes and milliseconds', () => {
  assert.equal(h3Time(0), '00:00.000');
  assert.equal(h3Time(2.17), '00:02.170');
  assert.equal(h3Time(71.5), '01:11.500');
});

test('h3Duration rounds up into the 4–15 s integer band', () => {
  assert.equal(h3Duration(14.63), 15);
  assert.equal(h3Duration(15.02), 15);
  assert.equal(h3Duration(2.1), 4);
  assert.equal(h3Duration(9.3), 10);
  assert.equal(h3Duration(9.02), 9); // float noise from rounding must not add a paid second
});

test('stripTimes samples start, middle and end inside the shot', () => {
  const [a, b, c] = stripTimes(shot(1, 2.17, 2.92));
  assert.ok(a > 2.17 && a < b && b < c && c < 2.92);
  assert.equal(b, 2.55);
});

test('planSegments never exceeds 15 s and cuts only on shot bounds', () => {
  const shots = [shot(1, 0, 6), shot(2, 6, 12), shot(3, 12, 16), shot(4, 16, 20)];
  const segs = planSegments(shots);
  assert.deepEqual(segs.map(s => s.shots), [[1, 2], [3, 4]]);
  assert.ok(segs.every(s => s.duration <= 15));
});

function jobWith(records, shots) {
  const segments = planSegments(shots);
  return { shots, director: { shots: records, segments } };
}

test('compileH3 numbers real cuts, continues beats and splits hidden cuts', () => {
  const shots = [shot(1, 0, 0.71), shot(2, 0.71, 2.17), shot(3, 2.17, 7), shot(4, 7, 11, 'beat')];
  const records = [
    { h3_en: 'A white rabbit darts into a hole.' },
    { h3_en: 'A view from inside the hole looking up at her face.' },
    { h3_en: 'Her hand grips a root', h3_after_cut_en: 'She falls through a blue shaft.', hidden_cut_at: 2.92 },
    { h3_en: 'She keeps falling past floating cards.' },
  ];
  const [seg] = compileH3(jobWith(records, shots));
  assert.equal(seg.target, 11);
  assert.equal(seg.shots, 4);
  assert.match(seg.text, /^integrated_multimodal_description: \[Shot 1\] A white rabbit/);
  assert.match(seg.text, /\[Shot 2\] At 00:00\.710, cut to a view from inside/);
  assert.match(seg.text, /\[Shot 3\] At 00:02\.170, cut to her hand grips a root\. \[Shot 4\] At 00:02\.920, cut to she falls/);
  assert.match(seg.text, /At 00:07\.000, the same shot continues: she keeps falling/);
  assert.match(seg.text, /overall_soundscape: N\/A\n\nnon_diegetic_music: N\/A$/);
});

test('compileH3 restarts shot numbers and times in every segment', () => {
  const shots = [shot(1, 0, 8), shot(2, 8, 14), shot(3, 14, 20)];
  const segs = compileH3(jobWith([{ h3_en: 'First shot text here.' }, { h3_en: 'Second shot text here.' }, { h3_en: 'Third shot text here.' }], shots));
  assert.equal(segs.length, 2);
  assert.match(segs[1].text, /^integrated_multimodal_description: \[Shot 1\] Third shot/);
  assert.equal(segs[1].target, 6);
});

const goodSegment = seg => ({
  shots: [{ index: 1, prompt_en: 'Medium shot of @Image1 wearing @Image2 turning left.', h3_en: 'A woman in a pale pink dress kneels at the base of a huge tree.', end_state: 'settled', action_phases: ['跪下'], hidden_cut_at: null }],
  segment: { prompt_en: `Follow @Video1.\n0.0-${seg.duration}s: @Image1 wearing @Image2 kneels.`, negative_en: 'face drift' },
});

test('checkSegment accepts a well-formed segment', () => {
  const segShots = [shot(1, 0, 3)];
  const [seg] = planSegments(segShots);
  assert.deepEqual(checkSegment(goodSegment(seg), segShots, seg).hard, []);
});

test('checkSegment rejects tokens in h3_en, bad end states and a hidden cut outside the shot', () => {
  const segShots = [shot(1, 0, 3)];
  const [seg] = planSegments(segShots);
  const raw = goodSegment(seg);
  raw.shots[0].h3_en = '@Image1 kneels at the base of a huge old tree in soft light.';
  raw.shots[0].end_state = 'done';
  raw.shots[0].hidden_cut_at = 2.95;
  const { hard } = checkSegment(raw, segShots, seg);
  assert.ok(hard.some(h => h.includes('not with @tokens')));
  assert.ok(hard.some(h => h.includes('end_state')));
  assert.ok(hard.some(h => h.includes('hidden_cut_at')));
});

test('checkSegment only warns when a hidden cut is flagged but h3_en is not split', () => {
  const segShots = [shot(1, 0, 3)];
  const [seg] = planSegments(segShots);
  const raw = goodSegment(seg);
  raw.shots[0].hidden_cut_at = 1.5;
  const { hard, soft } = checkSegment(raw, segShots, seg);
  assert.deepEqual(hard, []);
  assert.ok(soft.some(w => w.includes('1.50s')));
});

test('checkSegment requires contiguous beats that end at the segment duration', () => {
  const segShots = [shot(1, 0, 6)];
  const [seg] = planSegments(segShots);
  const raw = goodSegment(seg);
  raw.segment.prompt_en = 'global\n0.0-2.0s: @Image1 a\n2.5-5.0s: @Image1 b';
  const { hard } = checkSegment(raw, segShots, seg);
  assert.ok(hard.some(h => h.includes('must start at 2s')));
  assert.ok(hard.some(h => h.includes('lasts 6s')));
});
