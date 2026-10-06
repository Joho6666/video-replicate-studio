import assert from 'node:assert/strict';
import test from 'node:test';
import { POSITIVE_FALLBACK, lintPrompt, negations, retryPrompt, stripNegations } from '../lib/promptlint.mjs';

test('negations: unwanted objects are found, safe overlay negations are not', () => {
  assert.deepEqual(negations('a mug on a table, no phone, no electronic devices').map(n => n.object), ['phone', 'electronic devices']);
  assert.deepEqual(negations('nothing else on the table, without any people').map(n => n.object), ['else on', 'people']);
  assert.deepEqual(negations('a calm kitchen, no text, no watermark, no logo'), []);
  assert.deepEqual(negations('桌上一个杯子，不要手机，没有人').map(n => n.object), ['手机', '人']);
  assert.deepEqual(negations('画面干净，不要文字，无水印'), []);
  assert.deepEqual(negations('a cream mug on a wooden table at sunrise'), []);
});

test('lintPrompt gives a page-ready warning per negation', () => {
  const ok = lintPrompt('a cream mug on a table');
  assert.equal(ok.ok, true);
  const bad = lintPrompt('a mug, no phone');
  assert.equal(bad.ok, false);
  assert.equal(bad.warnings[0].code, 'negation');
  assert.match(bad.warnings[0].advice, /phone/);
});

test('stripNegations drops only the clauses that name unwanted things', () => {
  assert.equal(stripNegations('a cream mug on a wooden table, no phone, no electronic devices, no text'), 'a cream mug on a wooden table, no text');
  assert.equal(stripNegations('photo of a mug, golden light'), 'photo of a mug, golden light');
  assert.equal(stripNegations('桌上一个杯子，不要手机，晨光'), '桌上一个杯子, 晨光');
  assert.equal(stripNegations('no phone'), 'no phone', 'never returns an empty prompt');
  assert.equal(stripNegations(''), '');
});

test('retryPrompt: attempt 1 removes negations, attempt 2 also adds a positive composition hint (once)', () => {
  assert.equal(retryPrompt('a mug, no phone', 1), 'a mug');
  assert.equal(retryPrompt('a mug, no phone', 2), `a mug, ${POSITIVE_FALLBACK}`);
  assert.equal(retryPrompt(`a mug, ${POSITIVE_FALLBACK}`, 2), `a mug, ${POSITIVE_FALLBACK}`);
  assert.doesNotMatch(retryPrompt('a mug, no phone', 2), /\bno\b/);
});
