import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {
  applyModelSettings, createMacOSKeychain, createModelSettingsHandlers,
  MODEL_SETTINGS_API, validateEndpoint, WAN_ENDPOINT_TEMPLATE,
} from '../src/model-settings.mjs';
import {mountModelSettings} from '../src/model-settings-ui.mjs';

const ORIGIN = 'http://localhost:43129';
const SECRET = 'test-only-key-never-log-123456';
const config = (overrides = {}) => ({
  id: 'primary', provider: 'seedance', displayName: 'Seedance 测试配置',
  endpoint: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
  modelId: 'copied-from-console', purpose: 'generation', adapter: 'seedance-task-api', ...overrides,
});
const post = (body, headers = {}) => new Request(ORIGIN + MODEL_SETTINGS_API, {
  method: 'POST', headers: {'x-derek-workbench': '1', origin: ORIGIN, 'content-type': 'application/json', ...headers},
  body: JSON.stringify(body),
});
const get = (headers = {}) => new Request(ORIGIN + MODEL_SETTINGS_API, {headers: {'x-derek-workbench': '1', origin: ORIGIN, ...headers}});
const keyId = item => `${item.provider}:${item.id}`;

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-model-settings-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const vault = new Map();
  const writes = [];
  const keychain = {
    has: async item => vault.has(keyId(item)),
    set: async (item, value) => { writes.push(keyId(item)); vault.set(keyId(item), value); },
    ...overrides,
  };
  return {root, vault, writes, handlers: createModelSettingsHandlers({root, keychain})};
}

test('saving persists only allowlisted configuration; keys never enter responses or JSON', async t => {
  const {root, vault, handlers} = await fixture(t);
  const response = await handlers.save(post(config({apiKey: SECRET, ignoredPassword: SECRET})));
  assert.equal(response.status, 200);
  const result = await response.text();
  assert(!result.includes(SECRET));
  const saved = JSON.parse(result);
  assert.equal(saved.model.hasApiKey, true);
  assert.equal(saved.model.status, 'unverified');
  assert.equal(saved.model.executionEnabled, false);
  assert.equal(saved.model.readiness, 'configured');
  assert.equal(vault.get('seedance:primary'), SECRET);
  const disk = await readFile(path.join(root, 'model-settings.json'), 'utf8');
  assert(!disk.includes(SECRET));
  assert(!disk.includes('apiKey'));
  assert(!disk.includes('ignoredPassword'));
  assert.equal((await stat(path.join(root, 'model-settings.json'))).mode & 0o777, 0o600);
  const listed = await (await handlers.list(get())).text();
  assert(!listed.includes(SECRET));
  assert.equal(JSON.parse(listed).credentialStorage, 'macOS Keychain');
});

test('missing fields and Wan WorkspaceId remain explicit local drafts', async t => {
  const {handlers, writes} = await fixture(t);
  const draft = await (await handlers.save(post(config({endpoint: '', modelId: '', apiKey: ''})))).json();
  assert.deepEqual(draft.model.missingFields, ['endpoint', 'modelId', 'apiKey']);
  assert.equal(draft.model.readiness, 'incomplete');
  const wan = await (await handlers.save(post(config({provider: 'wan3', endpoint: WAN_ENDPOINT_TEMPLATE, modelId: 'wan3.0-video', adapter: 'wan-async'})))).json();
  assert.deepEqual(wan.model.missingFields, ['workspaceId', 'apiKey']);
  assert.equal(wan.model.endpoint, WAN_ENDPOINT_TEMPLATE);
  assert.equal(writes.length, 0);
});

test('empty key preserves existing Keychain value; providers with equal IDs stay isolated', async t => {
  const {handlers, vault, writes} = await fixture(t);
  assert.equal((await handlers.save(post(config({apiKey: SECRET})))).status, 200);
  const wanConfig = config({provider: 'wan3', endpoint: WAN_ENDPOINT_TEMPLATE, modelId: 'wan3.0-video', adapter: 'wan-async', apiKey: 'another-provider-secret'});
  assert.equal((await handlers.save(post(wanConfig))).status, 200);
  const result = await handlers.save(post(config({displayName: '改名但保留凭据', apiKey: ''})));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).model.hasApiKey, true);
  assert.deepEqual(writes, ['seedance:primary', 'wan3:primary']);
  assert.equal(vault.get('seedance:primary'), SECRET);
  assert.equal(vault.get('wan3:primary'), 'another-provider-secret');
  assert.equal((await (await handlers.list(get())).json()).models.length, 2);
});

test('CSRF headers and exact origins are checked before reading or mutating configuration', async t => {
  const {handlers, root, writes} = await fixture(t);
  for (const headers of [
    {'x-derek-workbench': ''}, {origin: 'https://attacker.invalid'}, {origin: 'null'},
    {origin: 'http://localhost:43130'}, {'sec-fetch-site': 'cross-site'}, {'sec-fetch-site': 'same-site'},
  ]) {
    assert.equal((await handlers.save(post(config({apiKey: SECRET}), headers))).status, 403);
    assert.equal((await handlers.list(get(headers))).status, 403);
  }
  assert.equal(writes.length, 0);
  assert.deepEqual(await readdir(root), []);
  // Embedded local hosts can omit Origin; a private custom header is still mandatory.
  const local = new Request(ORIGIN + MODEL_SETTINGS_API, {headers: {'x-derek-workbench': '1'}});
  assert.equal((await handlers.list(local)).status, 200);
});

test('URL validation rejects embedded secrets, private addresses, local hosts, and unsafe protocols', () => {
  for (const endpoint of [
    'http://api.example.com/v1', 'https://user:password@api.example.com/v1',
    'https://api.example.com/v1?api_key=secret', 'https://api.example.com/v1?x=1',
    'https://api.example.com/v1#secret', 'https://127.0.0.1/v1', 'https://10.2.3.4/v1',
    'https://169.254.169.254/v1', 'https://0x7f000001/v1', 'https://2130706433/v1',
    'https://[::1]/v1', 'https://[fc00::1]/v1', 'https://localhost/v1',
    'https://service.local/v1', 'https://service.internal/v1', 'https://service.lan/v1', 'https://router.home.arpa/v1',
    'https://127.0.0.1.nip.io/v1', 'https://localtest.me/v1', 'https://host/v1',
    'file:///tmp/key', 'javascript:alert(1)', 'https://{other}.api.example.com/v1',
  ]) assert.throws(() => validateEndpoint(endpoint, 'custom'), undefined, endpoint);
  assert.equal(validateEndpoint('https://models.example.com/v1', 'custom').endpoint, 'https://models.example.com/v1');
  assert.equal(validateEndpoint(WAN_ENDPOINT_TEMPLATE, 'wan3').incomplete, true);
  assert.throws(() => validateEndpoint(WAN_ENDPOINT_TEMPLATE, 'custom'));
});

test('invalid IDs, adapters, request shape and secret delimiters cannot touch Keychain', async t => {
  const {handlers, writes, root} = await fixture(t);
  const invalid = [null, [], config({id: '../escape'}), config({id: 'UPPERCASE'}), config({id: 'id\nnext'}),
    config({provider: 'unknown'}), config({provider: ['seedance']}), config({adapter: 'run-shell'}), config({purpose: 'anything'}),
    config({apiKey: SECRET + '\nadd-generic-password'}), config({apiKey: {value: SECRET}}),
    config({apiKey: 'a'.repeat(4097)}), config({endpoint: 'https://api.example.com/?token=' + SECRET})];
  for (const body of invalid) {
    const response = await handlers.save(post(body));
    assert.equal(response.status, 400);
    assert(!(await response.text()).includes(SECRET));
  }
  assert.equal(writes.length, 0);
  assert.deepEqual(await readdir(root), []);
});

test('body size is bounded in bytes, including absent or inaccurate content-length', async t => {
  const {handlers, root} = await fixture(t);
  const oversized = config({ignored: '中'.repeat(6000)});
  assert.equal((await handlers.save(post(oversized))).status, 413);
  assert.equal((await handlers.save(post(oversized, {'content-length': '1'}))).status, 413);
  assert.equal((await handlers.save(post(config(), {'content-length': '20000'}))).status, 413);
  assert.equal((await handlers.save(post(config(), {'content-type': 'text/plain'}))).status, 415);
  assert.deepEqual(await readdir(root), []);
});

test('Keychain failures never expose diagnostics and never leave credential-bearing files', async t => {
  const {handlers, root} = await fixture(t, {set: async () => { throw new Error(SECRET); }});
  const response = await handlers.save(post(config({apiKey: SECRET})));
  assert.equal(response.status, 503);
  assert(!(await response.text()).includes(SECRET));
  assert.deepEqual(await readdir(root), []);
  assert.equal((await handlers.save(post(config()))).status, 200);
});

test('a simultaneous save is refused and the gate releases on completion', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const {handlers} = await fixture(t, {set: async () => pending, has: async () => true});
  const first = handlers.save(post(config({apiKey: SECRET})));
  assert.equal((await handlers.save(post(config({id: 'second'})))).status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await handlers.save(post(config({id: 'second'})))).status, 200);
});

test('security writes secrets only through interactive stdin, with separate provider services', async () => {
  const calls = [];
  const keychain = createMacOSKeychain({run: async (...args) => { calls.push(args); return {code: 0}; }});
  const quoted = 'token-with-quote"and-backslash\\end';
  assert.equal(await keychain.set({id: 'primary', provider: 'seedance'}, quoted), undefined);
  await keychain.set({id: 'primary', provider: 'wan3'}, SECRET);
  assert.equal(await keychain.has({id: 'primary', provider: 'seedance'}), true);
  assert.deepEqual(calls[0].slice(0, 2), ['/usr/bin/security', ['-i']]);
  assert(!JSON.stringify(calls.map(call => call.slice(0, 2))).includes(SECRET));
  assert(!JSON.stringify(calls.map(call => call.slice(0, 2))).includes(quoted));
  assert(calls[0][2].includes('token-with-quote\\"and-backslash\\\\end'));
  assert(calls[0][2].includes('models.seedance'));
  assert(calls[1][2].includes('models.wan3'));
  assert(!calls[2][1].includes('-w'));
  const missing = createMacOSKeychain({run: async () => ({code: 44})});
  assert.equal(await missing.has({id: 'primary', provider: 'seedance'}), false);
});

test('security wrapper errors are sanitized and unsafe stdin keys fail before a command runs', async () => {
  let calls = 0;
  const keychain = createMacOSKeychain({run: async () => { calls++; throw new Error(SECRET); }});
  await assert.rejects(keychain.has({id: 'primary', provider: 'seedance'}), error => !error.message.includes(SECRET));
  await assert.rejects(keychain.set({id: 'primary', provider: 'seedance'}, SECRET), error => !error.message.includes(SECRET));
  await assert.rejects(keychain.set({id: 'primary', provider: 'seedance'}, SECRET + '\nquit'), error => !error.message.includes(SECRET));
  assert.equal(calls, 2);
});

test('applyModelSettings registers GET and POST under one exact host path', async t => {
  const {root} = await fixture(t);
  const registrations = [];
  applyModelSettings({connection: {fetch: {register: route => registrations.push(route)}}}, {
    root, keychain: {has: async () => false, set: async () => { throw new Error('should not run'); }},
  });
  assert.equal(registrations.length, 1);
  assert.deepEqual(registrations.map(route => [route.path, route.methods]), [[MODEL_SETTINGS_API, ['GET', 'POST']]]);
  assert.equal((await registrations[0].fetch(get())).status, 200);
});

const require = createRequire(import.meta.url);
let parseHTML;
try { ({parseHTML} = require(process.env.DOM_TEST_MODULE || 'linkedom')); } catch {}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('UI saves only through injected local service, clears password, and renders no execution button', {skip: !parseHTML}, async () => {
  const {document, window} = parseHTML('<html><body><div id="root"></div></body></html>');
  const root = document.querySelector('#root');
  let captured;
  const dispose = mountModelSettings(root, {
    load: async () => ({models: []}),
    save: async payload => {
      captured = {...payload};
      return {saved: true, model: {...config(payload), apiKey: SECRET, hasApiKey: true, missingFields: []}};
    },
  });
  await tick();
  const password = root.querySelector('[data-ms-field="apiKey"]');
  assert.equal(password.getAttribute('type'), 'password');
  password.value = SECRET;
  root.querySelector('[data-ms-field="modelId"]').value = 'my-console-model';
  root.querySelector('[data-ms-form]').dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
  await tick();
  assert.equal(captured.apiKey, SECRET);
  assert.equal(captured.modelId, 'my-console-model');
  assert.equal(root.querySelector('[data-ms-field="apiKey"]').value, '');
  assert(!root.innerHTML.includes(SECRET));
  assert(root.textContent.includes('执行未启用'));
  assert(![...root.querySelectorAll('button')].some(button => /开始生成|测试连接|立即生成/.test(button.textContent)));
  dispose();
  assert.equal(root.innerHTML, '');
});

test('UI errors and malicious loader fields cannot echo a saved key', {skip: !parseHTML}, async () => {
  const {document, window} = parseHTML('<html><body><div id="root"></div></body></html>');
  const root = document.querySelector('#root');
  const dispose = mountModelSettings(root, {
    load: async () => ({models: [{...config(), apiKey: SECRET, hasApiKey: true}]}),
    save: async () => { throw new Error(SECRET); },
  });
  await tick();
  assert(!root.innerHTML.includes(SECRET));
  assert.equal(root.querySelector('[data-ms-field="apiKey"]').value, '');
  root.querySelector('[data-ms-form]').dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
  await tick();
  assert(!root.innerHTML.includes(SECRET));
  assert(root.textContent.includes('未保存成功'));
  dispose();
});
