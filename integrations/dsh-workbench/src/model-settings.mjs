import {sameOrigin} from './request-origin.mjs';
import {spawn} from 'node:child_process';
import {mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const MODEL_SETTINGS_API = '/api/derek-video-replicate/models';
export const WAN_ENDPOINT_TEMPLATE = 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
export const MODEL_PROVIDERS = Object.freeze({
  seedance: {adapter: 'seedance-task-api'},
  wan3: {adapter: 'wan-async'},
  gemini: {adapter: 'gemini-generate-content'},
  custom: {adapter: 'custom-draft'},
});
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_STORE_BYTES = 256 * 1024;
const MAX_MODELS = 50;
const SAFE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const STORAGE_FILE = 'model-settings.json';
const reply = (body, status = 200) => Response.json(body, {
  status, headers: {'cache-control': 'no-store', 'x-content-type-options': 'nosniff'},
});
const problem = (status, message) => Object.assign(new Error(message), {safeStatus: status});
export const defaultModelSettingsRoot = () => path.join(os.homedir(), 'Documents', 'DSH-Workbenches', 'data');

function textField(value, maxLength, message, {empty = false} = {}) {
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) throw problem(400, message);
  const result = value.trim();
  if (!empty && !result) throw problem(400, message);
  return result;
}

export function validateEndpoint(value, provider) {
  const endpoint = textField(value, 2048, 'Endpoint 格式不正确。', {empty: true});
  if (!endpoint) return {endpoint: '', incomplete: true};
  if (provider === 'wan3' && endpoint === WAN_ENDPOINT_TEMPLATE) return {endpoint, incomplete: true};
  let url;
  try { url = new URL(endpoint); } catch { throw problem(400, 'Endpoint 需要完整的 HTTPS 地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || /[?#{}\\\s]/.test(endpoint)) {
    throw problem(400, 'Endpoint 仅接受 HTTPS，不能包含凭据、查询参数、片段或模板占位符。');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const labels = hostname.split('.');
  // No DNS lookup or endpoint request occurs. Block all numeric IP literals, local
  // names, and reserved local suffixes before a configuration can be stored.
  if (isIP(hostname) || hostname.startsWith('[') || labels.length < 2 ||
      !labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|localdomain|test|invalid|home\.arpa)$/.test(hostname) ||
      /(?:^|\.)(?:nip\.io|sslip\.io|lvh\.me|localtest\.me)$/.test(hostname)) {
    throw problem(400, 'Endpoint 必须使用公网服务域名，不能使用本机、私有地址或 IP 地址。');
  }
  return {endpoint: url.href, incomplete: false};
}

export function validateModelConfig(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw problem(400, '配置格式不正确。');
  if (typeof body.id !== 'string' || !SAFE_ID.test(body.id)) throw problem(400, '配置 ID 只能包含小写字母、数字和短横线，且须以字母开头。');
  if (typeof body.provider !== 'string' || !Object.hasOwn(MODEL_PROVIDERS, body.provider)) throw problem(400, '请选择支持的服务类型。');
  const displayName = textField(body.displayName, 80, '显示名称需要 1–80 个字符。');
  const modelId = textField(body.modelId, 200, 'Model ID 格式不正确。', {empty: true});
  if (modelId && !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(modelId)) throw problem(400, 'Model ID 只能包含字母、数字和常见模型标识符。');
  if (!['analysis', 'generation'].includes(body.purpose)) throw problem(400, '用途只能选择分析或生成。');
  if (body.adapter !== MODEL_PROVIDERS[body.provider].adapter) throw problem(400, '协议适配器与服务类型不匹配。');
  const checked = validateEndpoint(body.endpoint, body.provider);
  const missingFields = [];
  if (!checked.endpoint) missingFields.push('endpoint');
  else if (checked.incomplete) missingFields.push('workspaceId');
  if (!modelId) missingFields.push('modelId');
  // Only this allowlist reaches disk or responses; never spread the request body.
  return {
    id: body.id, provider: body.provider, displayName, endpoint: checked.endpoint,
    modelId, purpose: body.purpose, adapter: body.adapter,
    status: 'unverified', executionEnabled: false, missingFields,
  };
}

function validateSecret(value) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 4096 || !/^[\x21-\x7e]+$/.test(value)) throw problem(400, 'API Key 格式不正确，请只粘贴密钥本身。');
  return value;
}

function checkRequestSource(request) {
  if (request.headers.get('x-derek-workbench') !== '1') throw problem(403, '请求来源校验失败。');
  if (!sameOrigin(request)) throw problem(403, '不允许跨站配置请求。');
  const site = request.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) throw problem(403, '不允许跨站配置请求。');
}

async function readBody(request) {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) throw problem(413, '配置请求过大。');
  const contentType = request.headers.get('content-type') || '';
  if (!/^application\/json(?:;|$)/i.test(contentType)) throw problem(415, '配置请求需要 JSON 格式。');
  const reader = request.body?.getReader();
  if (!reader) throw problem(400, '配置请求为空。');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw problem(413, '配置请求过大。'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error.safeStatus) throw error;
    throw problem(400, '配置 JSON 格式不正确。');
  } finally { reader.releaseLock(); }
}

// Deliberately discard both subprocess output streams. The secret appears only
// on stdin to security's interactive parser, never in process argv or diagnostics.
export function runSecurity(executable, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {stdio: ['pipe', 'pipe', 'pipe']});
    let settled = false;
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(problem(503, 'macOS Keychain 暂不可用。'));
      else resolve({code});
    };
    const timer = setTimeout(() => { child.kill(); finish(true); }, 10000);
    child.stdout.resume();
    child.stderr.resume();
    child.on('error', () => finish(true));
    child.on('close', code => finish(false, code));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function keyIdentity(config) {
  if (typeof config.id !== 'string' || !SAFE_ID.test(config.id) || typeof config.provider !== 'string' || !Object.hasOwn(MODEL_PROVIDERS, config.provider)) throw problem(400, '密钥关联标识无效。');
  return {account: config.id, service: `derek.dsh-workbenches.models.${config.provider}`};
}

export function createMacOSKeychain({run = runSecurity} = {}) {
  return {
    async has(config) {
      const {account, service} = keyIdentity(config);
      try {
        const result = await run('/usr/bin/security', ['find-generic-password', '-a', account, '-s', service]);
        if (result.code === 0) return true;
        if (result.code === 44) return false;
      } catch {}
      throw problem(503, '无法确认 macOS Keychain 中的密钥状态。');
    },
    async set(config, value) {
      const secret = validateSecret(value);
      if (!secret) return;
      const {account, service} = keyIdentity(config);
      const quoted = secret.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      try {
        const result = await run('/usr/bin/security', ['-i'], `add-generic-password -U -a "${account}" -s "${service}" -w "${quoted}"\n`);
        if (result.code === 0) return;
      } catch {}
      throw problem(503, 'API Key 未能保存到 macOS Keychain。');
    },
  };
}

export function createModelSettingsHandlers({root = defaultModelSettingsRoot(), keychain = createMacOSKeychain()} = {}) {
  const storePath = path.join(path.resolve(root), STORAGE_FILE);
  let saving = false;
  async function readModels() {
    try {
      if ((await stat(storePath)).size > MAX_STORE_BYTES) throw new Error('invalid store');
      const saved = JSON.parse(await readFile(storePath, 'utf8'));
      if (saved.schemaVersion !== 1 || !Array.isArray(saved.models) || saved.models.length > MAX_MODELS) throw new Error('invalid store');
      const seen = new Set();
      return saved.models.map(item => {
        const model = validateModelConfig(item);
        const identity = `${model.provider}:${model.id}`;
        if (seen.has(identity)) throw new Error('duplicate configuration');
        seen.add(identity);
        return {...model, updatedAt: typeof item.updatedAt === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(item.updatedAt) ? item.updatedAt : null};
      });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw problem(503, '本机模型配置暂不可读取。');
    }
  }
  async function publicModel(model) {
    let hasApiKey;
    try { hasApiKey = Boolean(await keychain.has({provider: model.provider, id: model.id})); }
    catch { throw problem(503, '无法确认 macOS Keychain 中的密钥状态。'); }
    const missingFields = [...model.missingFields];
    if (!hasApiKey) missingFields.push('apiKey');
    return {...model, hasApiKey, missingFields, readiness: missingFields.length ? 'incomplete' : 'configured'};
  }
  function failure(error) {
    return reply({error: error.safeStatus ? error.message : '本机配置保存失败；请检查本机存储后重试。'}, error.safeStatus || 500);
  }
  return {
    async list(request) {
      try {
        checkRequestSource(request);
        const models = [];
        for (const model of await readModels()) models.push(await publicModel(model));
        return reply({schemaVersion: 1, models, executionEnabled: false, credentialStorage: 'macOS Keychain', storageScope: 'local'});
      } catch (error) { return failure(error); }
    },
    async save(request) {
      let temporary;
      let acquired = false;
      try {
        checkRequestSource(request);
        if (saving) throw problem(409, '已有配置正在保存，请稍后重试。');
        saving = true;
        acquired = true;
        const body = await readBody(request);
        const model = {...validateModelConfig(body), updatedAt: new Date().toISOString()};
        let secret = validateSecret(body.apiKey);
        // Remove our references as early as possible; neither body nor secret is
        // attached to errors, serialized records, or public response objects.
        delete body.apiKey;
        const models = await readModels();
        const index = models.findIndex(item => item.id === model.id && item.provider === model.provider);
        if (index < 0 && models.length >= MAX_MODELS) throw problem(400, '最多保存 50 项模型配置。');
        if (index < 0) models.push(model); else models[index] = model;
        await mkdir(path.dirname(storePath), {recursive: true, mode: 0o700});
        temporary = `${storePath}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify({schemaVersion: 1, models}, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
        if (secret) {
          try { await keychain.set({provider: model.provider, id: model.id}, secret); }
          catch { throw problem(503, 'API Key 未能保存到 macOS Keychain。'); }
          finally { secret = ''; }
        }
        const view = await publicModel(model);
        await rename(temporary, storePath);
        temporary = null;
        return reply({saved: true, model: view, executionEnabled: false, credentialStorage: 'macOS Keychain', storageScope: 'local'});
      } catch (error) { return failure(error); }
      finally {
        if (temporary) { try { await rm(temporary, {force: true}); } catch {} }
        if (acquired) saving = false;
      }
    },
  };
}

export function applyModelSettings(ctx, options = {}) {
  const handlers = createModelSettingsHandlers(options);
  // DSH owns each exact path once; dispatch HTTP methods inside that route.
  ctx.connection.fetch.register({
    path: MODEL_SETTINGS_API, methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: request => request.method === 'GET' ? handlers.list(request) : handlers.save(request),
  });
}
