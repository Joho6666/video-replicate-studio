import test from 'node:test';
import assert from 'node:assert/strict';
import { applyResearchAgent, applyResearchSessionPolicy, researchHostValue, researchToolOwner, RESEARCH_TOOL_NAMES, RESEARCH_WORKBENCH_ID } from '../src/research-agent.mjs';

function fixture() {
  const registered = new Map(), calls = [], events = new Map();
  const state = { added: [RESEARCH_WORKBENCH_ID], sessionBindings: { 'session-a': RESEARCH_WORKBENCH_ID } };
  const ctx = {
    desktopWorkbenchOwnership: { async read() { return state; } },
    tools: { register(definition) { registered.set(definition.name, definition); return () => registered.delete(definition.name); } },
    on(name, callback) { events.set(name, callback); return () => events.delete(name); },
  };
  const service = Object.fromEntries(['preparePlan', 'getJob', 'readResult', 'topicContext'].map(method => [method, async (args, owner) => { calls.push({ method, args, owner }); return { ok: true, method }; }]));
  const dispose = applyResearchAgent(ctx, { service });
  return { ctx, state, registered, calls, events, service, dispose, exec: { agent: { session: { id: 'session-a' } }, signal: new AbortController().signal } };
}

const plan = { source: { kind: 'account', url: 'https://www.instagram.com/synthetic_brand/' }, userIntent: '仅测试理解卡，不采集。', selectionPolicy: { mode: 'latest', count: 2 } };

test('Host bridge declares four scoped business tools with DSH canonical output and no confirmation/execution tool', async () => {
  const f = fixture();
  assert.deepEqual([...f.registered.keys()], Object.values(RESEARCH_TOOL_NAMES));
  assert.equal([...f.registered.keys()].some(name => /confirm|select|start|retry|generate/.test(name)), false);
  const tool = f.registered.get(RESEARCH_TOOL_NAMES.prepare);
  assert.equal(tool.parameters.additionalProperties, false);
  assert.equal(tool.output.schema.type, 'object');
  const result = await tool.execute(plan, f.exec);
  assert.deepEqual(tool.output.render(plan, result), [{ type: 'text', text: JSON.stringify(result) }]);
  assert.deepEqual(f.calls[0].owner, { sessionId: 'session-a', workbenchId: RESEARCH_WORKBENCH_ID });
  f.dispose(); assert.equal(f.registered.size, 0);
});

test('unscoped, ordinary, other-workbench and removed-owner sessions fail closed', async () => {
  for (const variation of ['unscoped', 'ordinary', 'other', 'removed']) {
    const f = fixture();
    if (variation === 'unscoped') delete f.exec.agent;
    if (variation === 'ordinary') delete f.state.sessionBindings['session-a'];
    if (variation === 'other') f.state.sessionBindings['session-a'] = 'another/workbench';
    if (variation === 'removed') f.state.added = [];
    await assert.rejects(f.registered.get(RESEARCH_TOOL_NAMES.prepare).execute(plan, f.exec), /会话|发起研究/);
    assert.equal(f.calls.length, 0);
  }
});

test('model cannot forge consent, owner, confirmation, job state or nested extra fields', async () => {
  for (const field of ['consent', 'confirmed', 'confirmedBy', 'sessionId', 'workbenchId', 'status', 'jobId', 'selectedVideoIds', 'candidateIds', 'sourceCapability']) {
    const f = fixture();
    await assert.rejects(f.registered.get(RESEARCH_TOOL_NAMES.prepare).execute({ ...plan, [field]: true }, f.exec), /不支持的字段/);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  await assert.rejects(f.registered.get(RESEARCH_TOOL_NAMES.prepare).execute({ ...plan, source: { ...plan.source, consent: true } }, f.exec), /不支持的字段/);
});

test('tool enforces max two videos and integer plan revision, update reaches service without authorization', async () => {
  const f = fixture(), tool = f.registered.get(RESEARCH_TOOL_NAMES.prepare);
  await assert.rejects(tool.execute({ ...plan, selectionPolicy: { mode: 'latest', count: 3 } }, f.exec), /不符合要求/);
  await assert.rejects(tool.execute({ ...plan, expectedRevision: '1' }, f.exec), /不符合要求/);
  await tool.execute({ ...plan, planId: 'plan_synthetic', expectedRevision: 1 }, f.exec);
  assert.equal(f.calls[0].args.expectedRevision, 1);
  assert.equal(Object.hasOwn(f.calls[0].args, 'consent'), false);
});

test('tool accepts three explicit execution modes but rejects unsupported execution claims', async () => {
  const f = fixture(), tool = f.registered.get(RESEARCH_TOOL_NAMES.prepare);
  for (const executionMode of ['research', 'planning-only', 'candidate-selection']) {
    await tool.execute({ ...plan, executionMode }, f.exec);
    assert.equal(f.calls.at(-1).args.executionMode, executionMode);
  }
  await assert.rejects(tool.execute({ ...plan, executionMode: 'confirmed-no-cost' }, f.exec), /不符合要求/);
  assert.match(tool.description, /planning-only/);
  assert.match(tool.description, /research.*UI 确认后会调用供应商/);
});

test('candidate plan separates fixed eight metadata candidates from maximum two later deep analyses', async () => {
  const f = fixture(), tool = f.registered.get(RESEARCH_TOOL_NAMES.prepare);
  const candidatePlan = { ...plan, executionMode: 'candidate-selection', candidateLimit: 8, userIntent: '先列八条元数据候选，暂不下载或深拆，再让我选两条。' };
  await tool.execute(candidatePlan, f.exec);
  assert.deepEqual(f.calls.map(call => call.method), ['preparePlan']);
  assert.equal(f.calls[0].args.candidateLimit, 8);
  assert.equal(f.calls[0].args.selectionPolicy.count, 2);
  for (const candidateLimit of [0, 2, 7, 9, 12, '8']) await assert.rejects(tool.execute({ ...candidatePlan, candidateLimit }, f.exec), /不符合要求/);
  await assert.rejects(tool.execute({ ...candidatePlan, selectionPolicy: { mode: 'latest', count: 8 } }, f.exec), /不符合要求/);
  assert.equal(f.calls.length, 1);
  assert.match(tool.description, /用户选择并再次确认深拆/);
});

test('canonical Douyin account plan preserves the supplied case-sensitive source without provider work', async () => {
  const f = fixture(), tool = f.registered.get(RESEARCH_TOOL_NAMES.prepare);
  const url = 'https://www.douyin.com/user/MS4wLjABAAAA_SYNTHETIC_Case_0123456789';
  await tool.execute({ ...plan, source: { kind: 'account', url } }, f.exec);
  assert.equal(f.calls[0].args.source.url, url);
  assert.deepEqual(f.calls.map(call => call.method), ['preparePlan']);
  assert.match(tool.description, /抖音 secUid 保留大小写/);
});

test('Douyin share URL is delegated untouched to local preparation without guessed account IDs or extra tool capabilities', async () => {
  const f = fixture(), tool = f.registered.get(RESEARCH_TOOL_NAMES.prepare);
  const source = { kind: 'douyin-share', url: 'https://v.douyin.com/SYNTHETIC_aB12/' };
  await tool.execute({ ...plan, source, executionMode: 'candidate-selection', candidateLimit: 8 }, f.exec);
  assert.deepEqual(f.calls.map(call => call.method), ['preparePlan']);
  assert.deepEqual(f.calls[0].args.source, source);
  await assert.rejects(tool.execute({ ...plan, source: { ...source, secUid: 'guessed' } }, f.exec), /不支持的字段/);
  assert.match(tool.description, /不解析或编造 ID/);
});

test('unsupported platforms can reach local planning and capability information stays visible without claiming missing authorization', async () => {
  const f = fixture(), tool = f.registered.get(RESEARCH_TOOL_NAMES.prepare);
  f.service.preparePlan = async (args, owner) => {
    f.calls.push({ method: 'preparePlan', args, owner });
    return { plan: { source: args.source, sourceCapability: { available: false, platform: 'Unknown', reasonZh: '平台适配未接通，尚未真实验证。' } } };
  };
  const source = { kind: 'account', url: 'https://www.example.test/synthetic_brand' };
  const result = await tool.execute({ ...plan, source, executionMode: 'research' }, f.exec);
  assert.deepEqual(f.calls[0].args.source, source);
  assert.equal(result.plan.sourceCapability.available, false);
  assert.match(result.plan.sourceCapability.reasonZh, /适配未接通/);
  assert.match(tool.description, /未接通不代表 TikHub 无权限/);
});

test('read tools forward the trusted session and never call write/execution methods', async () => {
  const f = fixture();
  await f.registered.get(RESEARCH_TOOL_NAMES.job).execute({ jobId: 'research_synthetic' }, f.exec);
  await f.registered.get(RESEARCH_TOOL_NAMES.result).execute({ jobId: 'research_synthetic' }, f.exec);
  await f.registered.get(RESEARCH_TOOL_NAMES.topic).execute({ topicId: 'topic_synthetic' }, f.exec);
  assert.deepEqual(f.calls.map(call => call.method), ['getJob', 'readResult', 'topicContext']);
  assert.equal(f.calls.every(call => call.owner.sessionId === 'session-a'), true);
});

test('missing registry, cancellation and ownership revocation cannot return private records', async () => {
  const f = fixture();
  await assert.rejects(researchToolOwner({}, f.exec), /无法核对/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(researchToolOwner(f.ctx, { ...f.exec, signal: controller.signal }), /已取消/);
  f.service.readResult = async () => { delete f.state.sessionBindings['session-a']; return { privateNotes: 'private' }; };
  await assert.rejects(f.registered.get(RESEARCH_TOOL_NAMES.result).execute({ jobId: 'research_synthetic' }, f.exec), /会话不属于/);
});

test('tool output omits credentials, private media and local paths without erasing canonical source or request identity', () => {
  const cleaned = researchHostValue({
    source: { url: 'https://www.instagram.com/reel/SYNTHETIC/' }, requestKey: 'sha256-hash',
    apiKey: 'private', mediaUrl: 'https://cdn.example.test/private.mp4', filePath: '/Users/test/private.mp4',
    nested: { audioPath: '/tmp/cache.wav', text: '文件 /Users/test/data/report.json Bearer abcdefghijklmnopq https://cdn.example.test/media?signature=private' },
  });
  assert.equal(cleaned.source.url, 'https://www.instagram.com/reel/SYNTHETIC/');
  assert.equal(cleaned.requestKey, 'sha256-hash');
  assert.equal(JSON.stringify(cleaned).includes('private'), false);
  assert.equal(JSON.stringify(cleaned).includes('/Users/'), false);
  assert.equal(JSON.stringify(cleaned).includes('abcdefghijklmnopq'), false);
});

test('failed registration disposes prior registrations', () => {
  const names = new Set();
  const ctx = { tools: { register(tool) { names.add(tool.name); return () => names.delete(tool.name); } } };
  assert.throws(() => applyResearchAgent(ctx, { service: { preparePlan() {} } }), /getJob/);
  assert.equal(names.size, 0);
});

test('owned research session cannot dispatch Bash, generic network, file, code or subagent tools to bypass UI consent', async () => {
  const f = fixture(), guard = f.events.get('tools/pre-execute');
  let dispatched = 0;
  const next = () => { dispatched++; return { kind: 'allow' }; };
  for (const name of ['Bash', 'bash', 'write_file', 'web_fetch', 'run_code', 'subagent', 'mcp__browser__evaluate']) {
    const result = await guard({ ...f.exec, name }, next);
    assert.equal(result.kind, 'deny');
    assert.match(result.reason, /不能使用 Bash/);
  }
  assert.equal(dispatched, 0);
  for (const name of Object.values(RESEARCH_TOOL_NAMES)) assert.equal((await guard({ ...f.exec, name }, next)).kind, 'allow');
  assert.equal(dispatched, 4);
});

test('tool dispatch gate preserves ordinary and unrelated workbench tool behavior and refreshes bindings', async () => {
  const f = fixture(), guard = f.events.get('tools/pre-execute');
  let dispatched = 0;
  const next = () => { dispatched++; return { kind: 'allow' }; };
  for (const agent of [undefined, { session: { id: 'ordinary' } }, { session: { id: 'another' } }]) {
    f.state.sessionBindings.another = 'other/workbench';
    assert.equal((await guard({ name: 'Bash', agent }, next)).kind, 'allow');
  }
  assert.equal(dispatched, 3);
  f.state.sessionBindings.ordinary = RESEARCH_WORKBENCH_ID;
  assert.equal((await guard({ name: 'Bash', agent: { session: { id: 'ordinary' } } }, next)).kind, 'deny');
  assert.equal(dispatched, 3);
});

test('advertised tools are dynamically limited to four research tools only in owned sessions', async () => {
  const f = fixture(), filter = f.events.get('system-prompt/assemble');
  const assembly = { sections: [{ name: 'original', text: '原有说明' }], contexts: [], variables: {}, tools: [...Object.values(RESEARCH_TOOL_NAMES).map(name => ({ name, parameters: {} })), { name: 'Bash' }, { name: 'run_code' }] };
  const result = await filter(assembly, { agent: f.exec.agent }, async () => assembly);
  assert.deepEqual(result.tools.map(tool => tool.name), Object.values(RESEARCH_TOOL_NAMES));
  assert.equal(result.sections.length, 2);
  assert.match(result.sections.at(-1).text, /聊天里的“确认”不能替代/);
  assert.match(result.sections.at(-1).text, /仅当用户已选择并提供真实 topicId/);
  assert.match(result.sections.at(-1).text, /不要重复询问/);
  assert.match(result.sections.at(-1).text, /executionMode='planning-only'/);
  assert.match(result.sections.at(-1).text, /暂不生成视频.*不等于仅规划/);
  assert.match(result.sections.at(-1).text, /executionMode='candidate-selection'.*candidateLimit=8/);
  assert.match(result.sections.at(-1).text, /waiting_selection.*再次确认/);
  assert.match(result.sections.at(-1).text, /元数据不足以声称识别了画面、调性或节奏/);
  assert.match(result.sections.at(-1).text, /source.kind='douyin-share'.*准备卡时零网络/);
  assert.match(result.sections.at(-1).text, /sourceCapability.available=false.*服务端拦截/);
  assert.equal((await filter(assembly, { agent: { session: { id: 'ordinary' } } }, async () => assembly)), assembly);
  assert.equal(assembly.tools.length, 6);
  f.dispose(); assert.equal(f.events.size, 0);
});

test('PTC-only or externally denied planning capability fails explicitly instead of using code execution', async () => {
  const f = fixture(), filter = f.events.get('system-prompt/assemble');
  const assembly = { tools: [{ name: 'run_code' }], sections: [] };
  await assert.rejects(filter(assembly, { agent: f.exec.agent }, async () => assembly), /原生工具模式/);
});

test('missing Host gate event API cannot silently enable a weaker research bridge', () => {
  assert.throws(() => applyResearchSessionPolicy({}), /边界接口不可用/);
});

test('account study can prepare four to six samples while Host tools cannot start it', async()=>{
 const f=fixture(),tool=f.registered.get(RESEARCH_TOOL_NAMES.prepare);
 await tool.execute({...plan,executionMode:'account-study',selectionPolicy:{mode:'balanced',count:6}},f.exec);
 assert.equal(f.calls[0].args.selectionPolicy.count,6);
 for(const count of [2,3,7])await assert.rejects(tool.execute({...plan,executionMode:'account-study',selectionPolicy:{mode:'balanced',count}},f.exec),/不符合要求/);
 assert.equal([...f.registered.keys()].some(name=>name.includes('start')),false);
});
