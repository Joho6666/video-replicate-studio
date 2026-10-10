import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHistoryStore, canonicalHistoryUrl } from '../src/history-store.mjs';

const secUid = 'MS4wLjABAAAA_SYNTHETIC_CaseSensitive_0123456789';
const account = { platform: 'Douyin', secUid, username: secUid, displayName: '合成通勤品牌', url: `https://www.douyin.com/user/${secUid}` };
const url = 'https://www.douyin.com/video/7000000000000000001';
const sample = { url, title: '合成视频元数据', publishedAt: '2026-10-01T00:00:00Z', views: 123, likes: 4, ownerVerified: true };
const payload = (extra = {}) => ({ account, samples: [sample], collectedAt: '2026-10-10T00:00:00Z', provider: 'synthetic', ...extra });
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-douyin-history-'));
  return { root, store: createHistoryStore({ root }), raw: async () => JSON.parse(await readFile(path.join(root, 'library/state.json'), 'utf8')) };
}

test('Douyin long case-sensitive secUid persists and reads with a namespaced cache key', async () => {
  const { store, raw } = await setup();
  await store.ingest(payload());
  const cached = await store.findAccountCache(account);
  assert.equal(cached.account.secUid, secUid);
  assert.equal(cached.account.username, secUid);
  assert.equal(cached.account.platform, 'Douyin');
  assert.equal(cached.samples.length, 1);
  assert.deepEqual(Object.keys((await raw()).caches), [`douyin:${secUid}`]);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.records[0].account.displayName, '合成通勤品牌');
  assert.equal(snapshot.topics[0].title, '合成通勤品牌');
  assert.equal((await store.snapshot({ query: '合成通勤品牌' })).records.length, 1);
});

test('Douyin does not collide with an Instagram username; old Instagram cache and topic are unchanged', async () => {
  const { store, raw } = await setup(), same = 'synthetic_brand';
  const ig = { username: same, url: `https://www.instagram.com/${same}/` };
  await store.ingest(payload({ account: ig, samples: [{ ...sample, url: 'https://www.instagram.com/reel/SYNTHETIC/' }] }));
  const before = await raw(), igTopic = (await store.snapshot()).topics[0];
  await store.ingest(payload({ account: { platform: 'Douyin', secUid: same, username: same } }));
  const after = await raw();
  assert.deepEqual(after.caches[same], before.caches[same]);
  assert.equal(after.caches[`douyin:${same}`].account.platform, 'Douyin');
  assert.deepEqual((await store.snapshot()).topics.find(topic => topic.id === igTopic.id), igTopic);
  assert.equal((await store.findAccountCache(same)).account.url, ig.url);
  assert.equal((await store.findAccountCache({ platform: 'Douyin', secUid: same })).samples[0].url, canonicalHistoryUrl(url).url);
  assert.equal((await store.snapshot()).topics.length, 2);
});

test('Douyin cache keys preserve case instead of merging different secUid values', async () => {
  const { store, raw } = await setup();
  await store.ingest(payload());
  const lower = secUid.toLowerCase();
  await store.ingest(payload({ account: { platform: 'Douyin', secUid: lower }, samples: [{ ...sample, url: 'https://www.douyin.com/video/7000000000000000002' }] }));
  assert.equal(Object.keys((await raw()).caches).length, 2);
  assert.equal((await store.findAccountCache(account)).account.secUid, secUid);
  assert.equal((await store.findAccountCache({ platform: 'Douyin', secUid: lower })).account.secUid, lower);
});

test('history dedupe, hiding and recycle bin apply to Douyin cache and survive reopening', async () => {
  const { store, root } = await setup();
  const first = await store.ingest(payload());
  const repeated = await store.ingest(payload({ samples: [{ ...sample, url: url + '?tracking=synthetic' }] }));
  assert.equal(first.addedCount, 1); assert.equal(repeated.addedCount, 0); assert.equal(repeated.duplicateCount, 1);
  const id = canonicalHistoryUrl(url).id;
  await store.mutate({ action: 'hide', ids: [id] });
  let cached = await createHistoryStore({ root }).findAccountCache(account);
  assert.equal(cached.samples.length, 0); assert.equal(cached.hiddenCount, 1);
  await store.mutate({ action: 'unhide', ids: [id] });
  await store.mutate({ action: 'trash', ids: [id] });
  cached = await store.findAccountCache(account);
  assert.equal(cached.samples.length, 0); assert.equal(cached.trashedCount, 1);
  await store.mutate({ action: 'restore', ids: [id] });
  assert.equal((await store.findAccountCache(account)).samples.length, 1);
});

test('invalid, overlong, mismatched and shortlink account identities cannot corrupt Douyin cache', async () => {
  const { store, raw } = await setup();
  await store.ingest(payload()); const before = await raw();
  for (const invalid of [
    { platform: 'Douyin', secUid: 'short' },
    { platform: 'Douyin', secUid: 'A'.repeat(201) },
    { platform: 'Douyin', secUid, url: 'https://v.douyin.com/synthetic/' },
    { platform: 'Douyin', secUid, url: 'https://www.douyin.com/user/OtherSyntheticId' },
    { platform: 'Douyin', secUid: '../SyntheticId' },
    { platform: 'Unsupported', username: 'synthetic' },
  ]) await assert.rejects(store.ingest(payload({ account: invalid })), { code: 'HISTORY_INVALID' });
  assert.deepEqual(await raw(), before);
});

test('failed Douyin collection preserves the last successful cached metadata', async () => {
  const { store } = await setup(); await store.ingest(payload());
  await assert.rejects(store.ingest(payload({ status: 'failed', collectedAt: '2026-10-11T00:00:00Z', samples: [] })), /失败的采集/);
  assert.equal((await store.findAccountCache(account)).samples.length, 1);
});

test('Douyin metadata import stores its own account state without changing Instagram legacy fields', async () => {
  const { store, raw } = await setup();
  await store.importLegacy({ account: { username: 'synthetic' }, samples: [], goal: '原有 Instagram 目标', assets: '原有说明' });
  const before = await raw();
  await store.importLegacy(payload({ goal: '抖音合成目标', assets: '暂无素材' }));
  const after = await raw();
  assert.deepEqual(after.accountStates.synthetic, before.accountStates.synthetic);
  assert.equal(after.accountStates[`douyin:${secUid}`].goal, '抖音合成目标');
  assert.equal((await store.findAccountCache(account)).goal, '抖音合成目标');
});
