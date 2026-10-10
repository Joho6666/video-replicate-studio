const API = '/api/derek-video-replicate/models';
const PRESETS = {
  seedance: {name: 'Seedance', displayName: 'Seedance 视频生成', endpoint: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks', modelId: '', purpose: 'generation', adapter: 'seedance-task-api', help: '从火山引擎控制台复制已开通的 Model ID。', docs: 'https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh'},
  wan3: {name: 'Wan 3.0', displayName: 'Wan 3.0 视频生成', endpoint: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis', modelId: 'wan3.0-video', purpose: 'generation', adapter: 'wan-async', help: '把 Endpoint 中的 {WorkspaceId} 替换为你的阿里云工作空间 ID。未替换时可保存为草稿。', docs: 'https://help.aliyun.com/zh/model-studio/wan3-video-generation-guide'},
  gemini: {name: 'Gemini 分析', displayName: 'Gemini 视频分析', endpoint: 'https://generativelanguage.googleapis.com/v1beta', modelId: 'gemini-3.8-flash', purpose: 'analysis', adapter: 'gemini-generate-content', help: '保存分析服务配置，Model ID 以你实际可用的控制台配置为准。'},
  custom: {name: '自定义服务', displayName: '自定义模型', endpoint: '', modelId: '', purpose: 'generation', adapter: 'custom-draft', help: '保存其他服务的地址与模型信息。执行前仍需适配该服务的请求、鉴权和结果协议。'},
};
const ADAPTERS = {'seedance-task-api': 'Seedance · 任务 API', 'wan-async': 'Wan · 异步任务', 'gemini-generate-content': 'Gemini · generateContent', 'custom-draft': '自定义 · 待实现适配'};
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const identity = model => `${model.provider}:${model.id}`;
const newId = provider => `${provider}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
const fresh = provider => ({...PRESETS[provider], id: newId(provider), provider});

// Even an injected loader cannot accidentally render an apiKey property.
function publicModel(value) {
  if (!value || !Object.hasOwn(PRESETS, value.provider) || !/^[a-z][a-z0-9-]{0,63}$/.test(value.id)) return null;
  const result = {};
  for (const key of ['id', 'provider', 'displayName', 'endpoint', 'modelId', 'purpose', 'adapter']) result[key] = typeof value[key] === 'string' ? value[key] : '';
  result.hasApiKey = value.hasApiKey === true;
  result.missingFields = Array.isArray(value.missingFields) ? value.missingFields.filter(field => ['endpoint', 'workspaceId', 'modelId', 'apiKey'].includes(field)) : [];
  return result;
}

async function localRequest(method, body) {
  const response = await fetch(API, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: {'x-derek-workbench': '1', ...(body ? {'content-type': 'application/json'} : {})},
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  if (!response.ok) throw new Error('本机配置请求失败。');
  return response.json();
}

export function mountModelSettings(root, {load = () => localRequest('GET'), save = body => localRequest('POST', body)} = {}) {
  let models = [], draft = fresh('seedance'), busy = false, loading = true, disposed = false, notice = '';
  const readFields = () => {
    for (const field of ['displayName', 'endpoint', 'modelId', 'purpose', 'adapter']) draft[field] = root.querySelector(`[data-ms-field="${field}"]`)?.value ?? draft[field];
  };
  const field = (name, label, placeholder, extra = '') => `<label class="ms-field"><span>${label}</span><input data-ms-field="${name}" value="${escape(draft[name])}" placeholder="${escape(placeholder)}" ${extra}></label>`;
  function render() {
    if (disposed) return;
    const preset = PRESETS[draft.provider];
    const existing = models.find(model => identity(model) === identity(draft));
    root.innerHTML = `<style>
.ms-scope{container-type:inline-size}.ms{color:#2f422e;font-family:inherit}.ms *{box-sizing:border-box}.ms h2,.ms h3,.ms p{margin:0}.ms-head{padding:26px 28px;background:linear-gradient(115deg,#ebf0e3,#f8f9f3);border:1px solid #dfe6d6;border-radius:14px;margin-bottom:20px}.ms-eyebrow{font-size:10px;letter-spacing:2.6px;color:#82916f;margin-bottom:12px}.ms h2{font-size:25px;letter-spacing:-.6px;margin-bottom:9px}.ms p{font-size:13px;color:#7c8973;line-height:1.8}.ms-badges{display:flex;gap:7px;flex-wrap:wrap;margin-top:15px}.ms-badge{font-size:11px;color:#6e805e;background:#fff9;padding:5px 9px;border:1px solid #dce5d2;border-radius:20px}.ms-grid{display:grid;grid-template-columns:230px minmax(0,1fr);gap:20px}.ms-card{padding:24px;border:1px solid #dfe5d8;border-radius:13px;background:#fff;min-width:0}.ms-card h3{font-size:16px;margin-bottom:8px}.ms-list{display:flex;flex-direction:column;gap:8px;margin:18px 0}.ms button{font:inherit;font-size:12px;cursor:pointer;padding:10px 14px;border:1px solid #d9e2d0;border-radius:8px;color:#4d6742;background:white}.ms button:disabled{opacity:.5;cursor:default}.ms .ms-primary{background:#536e47;border-color:#536e47;color:white}.ms-item{text-align:left}.ms-item.is-selected{background:#f0f5e9;border-color:#adc49a}.ms-item b{display:block;font-size:12px;margin-bottom:5px}.ms-item small{color:#88947b;font-size:10px;line-height:1.6}.ms-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.ms-field{display:flex;flex-direction:column;gap:7px;margin:16px 0 0;font-size:12px;color:#708064}.ms-field input,.ms-field select{width:100%;font:inherit;color:#344e2c;border:1px solid #dfe6d8;border-radius:8px;padding:12px;background:white;min-width:0}.ms-field input:focus,.ms-field select:focus,.ms button:focus-visible{outline:2px solid #8da777;outline-offset:2px}.ms-field small{font-size:11px;line-height:1.7;color:#8d987f}.ms-full{grid-column:1/-1}.ms-explainer{margin-top:20px;padding:13px 15px;border-radius:8px;background:#f5f7f0;font-size:12px;color:#78876b;line-height:1.8}.ms-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:23px}.ms-actions small{font-size:11px;color:#8d987f}.ms-notice{padding:12px 16px;background:#eff4e7;border:1px solid #dce6d1;border-radius:9px;margin-bottom:18px;font-size:12px;line-height:1.8}.ms a{color:#59784a}.ms-empty{padding:18px 0;color:#99a38e;font-size:12px;line-height:1.8}.ms-meta{border-top:1px solid #e9eee1;padding-top:15px;margin-top:18px}.ms [hidden]{display:none!important}@container(max-width:740px){.ms-grid{grid-template-columns:1fr}.ms-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.ms-card{padding:20px}.ms-head{padding:23px}}@container(max-width:460px){.ms-form-grid,.ms-list{grid-template-columns:1fr}.ms h2{font-size:22px}.ms-card{padding:17px}}
</style><div class="ms-scope"><section class="ms" aria-label="模型配置"><header class="ms-head"><div class="ms-eyebrow">MODEL CONNECTIONS / LOCAL SETTINGS</div><h2>把模型准备好，再开始创作。</h2><p>为分析和视频生成保存独立配置，凭据留在这台 Mac 的钥匙串中。</p><div class="ms-badges"><span class="ms-badge">本机保存</span><span class="ms-badge">配置未验证</span><span class="ms-badge">执行未启用</span></div></header><div class="ms-notice" role="status" aria-live="polite" ${notice ? '' : 'hidden'}>${escape(notice)}</div><div class="ms-grid"><aside class="ms-card"><h3>你的模型</h3><p>${loading ? '正在读取本机配置…' : `${models.length} 项已保存配置`}</p><div class="ms-list">${models.map(model => `<button type="button" class="ms-item ${identity(model) === identity(draft) ? 'is-selected' : ''}" data-ms-edit="${escape(identity(model))}" ${busy ? 'disabled' : ''}><b>${escape(model.displayName)}</b><small>${escape(PRESETS[model.provider].name)} · ${model.purpose === 'analysis' ? '分析' : '生成'}<br>${model.hasApiKey ? '密钥已存钥匙串' : '凭据待补'} · 未验证</small></button>`).join('') || '<div class="ms-empty">先保存配置草稿，稍后再补 API Key。</div>'}</div><button type="button" data-ms-action="new" ${busy ? 'disabled' : ''}>＋ 新增配置</button><p class="ms-meta">每项配置独立保存，换服务时会建立新的草稿。</p></aside><form class="ms-card" data-ms-form autocomplete="off"><h3>${existing ? '编辑模型配置' : '新增模型配置'}</h3><p>保存后可继续修改。所有配置均处于未验证状态。</p><div class="ms-form-grid"><label class="ms-field"><span>服务</span><select data-ms-field="provider" ${busy ? 'disabled' : ''}>${Object.entries(PRESETS).map(([key, value]) => `<option value="${key}" ${draft.provider === key ? 'selected' : ''}>${escape(value.name)}</option>`).join('')}</select></label>${field('displayName', '显示名称', '给这项配置起个名字', 'required maxlength="80"')}<div class="ms-full">${field('endpoint', 'Endpoint · 完整 HTTPS 地址', 'https://api.your-provider.com/path', 'maxlength="2048" spellcheck="false"')}<p style="margin-top:7px;font-size:11px">${escape(preset.help)}${preset.docs ? ` <a href="${escape(preset.docs)}" target="_blank" rel="noopener noreferrer">官方文档 ↗</a>` : ''}</p></div>${field('modelId', 'Model ID', draft.provider === 'seedance' ? '从控制台复制 Model ID' : '填写服务提供的模型标识', 'maxlength="200" spellcheck="false"')}<label class="ms-field"><span>用途</span><select data-ms-field="purpose"><option value="analysis" ${draft.purpose === 'analysis' ? 'selected' : ''}>分析</option><option value="generation" ${draft.purpose === 'generation' ? 'selected' : ''}>生成</option></select></label><label class="ms-field ms-full"><span>协议适配器</span><select data-ms-field="adapter">${Object.entries(ADAPTERS).map(([key, label]) => `<option value="${key}" ${draft.adapter === key ? 'selected' : ''} ${key !== preset.adapter ? 'disabled' : ''}>${escape(label)}</option>`).join('')}</select><small>适配器标识用于后续接入执行；当前仅保存配置。</small></label><label class="ms-field ms-full"><span>API Key <span style="color:#98a18d">· 可稍后补充</span></span><input data-ms-field="apiKey" type="password" value="" maxlength="4096" autocomplete="new-password" spellcheck="false" placeholder="${existing?.hasApiKey ? '已存入钥匙串；留空保留原密钥' : '可留空，先保存配置草稿'}"><small>密钥只提交给本机后端并保存在 macOS Keychain；页面不会回显已保存密钥。</small></label></div><div class="ms-explainer">${draft.provider === 'custom' ? '自定义服务会保存为待适配草稿。Endpoint 与 Model ID 填好后，还需完成该服务的协议接入。' : 'Endpoint、Model ID 或凭据可以稍后补齐。保存不会连接外部模型或验证可用性。'}</div><div class="ms-actions"><button class="ms-primary" type="submit" ${busy || loading ? 'disabled' : ''}>${busy ? '正在本机保存…' : '保存本机配置'}</button><small>未验证 · 执行未启用</small></div></form></div></section></div>`;
  }
  const onChange = event => {
    if (event.target?.getAttribute('data-ms-field') !== 'provider' || busy) return;
    const provider = event.target.value;
    if (!Object.hasOwn(PRESETS, provider)) return;
    draft = fresh(provider);
    notice = '已准备新的服务草稿。';
    render();
  };
  const onClick = event => {
    if (busy) return;
    const button = event.target.closest?.('button');
    if (!button || !root.contains(button)) return;
    const edit = button.getAttribute('data-ms-edit');
    if (edit) {
      const model = models.find(item => identity(item) === edit);
      if (model) { draft = {...model}; notice = ''; render(); }
    } else if (button.getAttribute('data-ms-action') === 'new') {
      draft = fresh('seedance'); notice = ''; render();
    }
  };
  const onSubmit = async event => {
    if (!event.target?.hasAttribute('data-ms-form')) return;
    event.preventDefault();
    if (busy || loading) return;
    readFields();
    const secretInput = root.querySelector('[data-ms-field="apiKey"]');
    let secret = secretInput.value;
    secretInput.value = '';
    const payload = {};
    for (const field of ['id', 'provider', 'displayName', 'endpoint', 'modelId', 'purpose', 'adapter']) payload[field] = draft[field];
    payload.apiKey = secret;
    secret = '';
    busy = true; notice = ''; render();
    try {
      const response = await save(payload);
      const model = publicModel(response?.model);
      if (!response?.saved || !model) throw new Error('保存响应无效。');
      const index = models.findIndex(item => identity(item) === identity(model));
      if (index < 0) models.push(model); else models[index] = model;
      draft = {...model};
      notice = model.missingFields.length ? '配置草稿已保存，可稍后补齐。配置未验证，执行未启用。' : '本机配置已保存。配置未验证，执行未启用。';
    } catch {
      notice = '本机配置未保存成功。请检查字段与钥匙串状态；如需更新密钥，请重新输入。';
    } finally {
      payload.apiKey = '';
      busy = false; render();
    }
  };
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  render();
  Promise.resolve().then(load).then(response => {
    if (disposed) return;
    models = Array.isArray(response?.models) ? response.models.slice(0, 50).map(publicModel).filter(Boolean) : [];
    if (models.length) draft = {...models[0]};
  }).catch(() => { if (!disposed) notice = '尚未读到本机模型配置。可填写后重新保存。'; })
    .finally(() => { if (!disposed) { loading = false; render(); } });
  return () => {
    disposed = true;
    root.removeEventListener('change', onChange);
    root.removeEventListener('click', onClick);
    root.removeEventListener('submit', onSubmit);
    const password = root.querySelector('[data-ms-field="apiKey"]');
    if (password) password.value = '';
    root.innerHTML = '';
  };
}
