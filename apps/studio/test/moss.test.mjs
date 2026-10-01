import assert from 'node:assert/strict';
import test from 'node:test';
import { billedChars, transcriptLines } from '../lib/moss.mjs';

const transcript = { segments: [
  { start: 1.06, end: 2.11, speaker: 'S01', text: 'Goodbye, Mom.' },
  { start: 8.85, end: 13.01, speaker: 'S02', text: "Oh, sorry. I'm so sorry." },
  { start: 13.49, end: 14.55, speaker: 'S02', text: 'You think this is funny?' },
] };

test('transcriptLines lists every line with absolute times', () => {
  assert.deepEqual(transcriptLines(transcript), [
    '[1.06-2.11s] S01: Goodbye, Mom.',
    "[8.85-13.01s] S02: Oh, sorry. I'm so sorry.",
    '[13.49-14.55s] S02: You think this is funny?',
  ]);
});

test('transcriptLines clips to a segment window and makes times relative', () => {
  assert.deepEqual(transcriptLines(transcript, 13.47, 15.63), ['[0.02-1.08s] S02: You think this is funny?']);
  assert.deepEqual(transcriptLines(transcript, 3, 8), []);
  assert.deepEqual(transcriptLines(null), []);
});

test('billedChars ignores pause tags and whitespace', () => {
  assert.equal(billedChars('轻盈保暖，[pause 0.3s]出门 就穿'), 9);
  assert.equal(billedChars(''), 0);
});
