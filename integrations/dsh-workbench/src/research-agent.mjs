// DSH Host-tool bridge. Model arguments can prepare a draft; only the local
// confirmation UI can authorize the separate research executor.
export const RESEARCH_WORKBENCH_ID = 'joho6666/video-replicate-studio';
export const RESEARCH_TOOL_NAMES = Object.freeze({
  prepare: 'replicate_research__prepare_research_plan',
  job: 'replicate_research__get_research_job',
  result: 'replicate_research__read_research_result',
  topic: 'replicate_research__read_topic_context',
});

const string = (maxLength = 2000) => ({ type: 'string', maxLength });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const identifier = () => ({ type: 'string', minLength: 1, maxLength: 160 });
const sourceSchema = object({
  kind: { type: 'string', enum: ['account', 'videos', 'douyin-share'] },
  url: { ...string(2000), description: '用户提供的安全 HTTPS 账号主页；抖音分享短链用 kind=douyin-share，仅提取 v.douyin.com URL，不解析或猜账号 ID。其他平台也可保存计划，由返回的 sourceCapability 判断适配状态。' },
  urls: { type: 'array', items: string(2000), minItems: 1, maxItems: 2 },
}, ['kind']);
const planProperties = {
  source: sourceSchema,
  userIntent: { type: 'string', minLength: 1, maxLength: 4000 },
  executionMode: { type: 'string', enum: ['research', 'planning-only', 'candidate-selection', 'account-study'], description: 'account-study：单账号4～6条一次研究，可直接从工作台选择+链接开始，无需聊天；research：确认后直接深拆最多两条；candidate-selection：先确认获取八条元数据候选，再由用户选最多两条并再次确认深拆；planning-only：明确仅规划，确认也不请求供应商。' },
  candidateLimit: { type: 'integer', minimum: 8, maximum: 8, description: 'candidate-selection 固定为 8；selectionPolicy.count 仍是后续深拆的上限，最多 2。' },
  product: string(1000),
  audience: string(1000),
  topicId: identifier(),
  topicTitle: string(120),
  selectionPolicy: object({
    mode: { type: 'string', enum: ['latest', 'top-in-window', 'user-picked', 'balanced', 'top-in-page'] },
    count: { type: 'integer', minimum: 1, maximum: 6 },
    metric: { type: 'string', enum: ['views', 'likes'] },
    windowStart: string(40),
    windowEnd: string(40),
  }, ['mode', 'count']),
  analysisFocus: { type: 'array', items: string(120), minItems: 1, maxItems: 12 },
  materialStatus: object({
    state: { type: 'string', enum: ['unprovided', 'none', 'provided', 'unknown'] },
    description: string(2000),
  }, ['state']),
  styleVersionId: identifier(),
  planId: identifier(),
  expectedRevision: { type: 'integer', minimum: 1 },
};
const planSchema = object(planProperties, ['source', 'userIntent']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

// Runtime validation accompanies the published JSON schema. Calling execute
// directly in a test or through a non-native presentation cannot smuggle a
// consent/status/owner field past the tool boundary.
function assertArguments(value, schema, trail = '') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT', '研究工具需要结构化参数。');
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) fail('INVALID_INPUT', '研究工具包含不支持的字段；确认和任务状态只能由工作台管理。');
      assertArguments(value[key], schema.properties[key], trail ? `${trail}.${key}` : key);
    }
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail('INVALID_INPUT', `研究参数缺少 ${trail ? `${trail}.` : ''}${key}。`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) fail('INVALID_INPUT', '研究参数的列表长度不符合要求。');
    for (const item of value) assertArguments(item, schema.items, trail);
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || (schema.enum && !schema.enum.includes(value))) fail('INVALID_INPUT', `研究参数 ${trail} 不符合要求。`);
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) fail('INVALID_INPUT', `研究参数 ${trail} 不符合要求。`);
  }
}

/** Defense in depth before business records enter a model's context. */
export function researchHostValue(value, depth = 0) {
  if (depth > 12) return '[超出展示深度]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => researchHostValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:apiKey|key|token|secret|authorization|cookie|credentials|mediaUrl|videoUrl|downloadUrl|signedUrl|filePath|sourcePath|audioPath|videoPath|cachePath|root|folder|fileId)$/i.test(key)) continue;
      output[key] = researchHostValue(item, depth + 1);
    }
    return output;
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(/\b(?:sk-|Bearer\s+)[A-Za-z0-9_./+=-]{12,}/gi, '[凭据已省略]')
    .replace(/(?:\/Users\/|\/private\/|\/tmp\/|\/var\/folders\/|file:\/\/)[^\s"<>]*/g, '[本机路径已省略]')
    .replace(/https?:\/\/[^\s"<>]+[?&](?:token|key|signature|sig|x-amz-signature|x-goog-signature)=[^\s"<>]*/gi, '[临时媒体地址已省略]')
    .slice(0, 16_000);
}

/** Read the real Desktop ownership registry for every tool invocation. */
export async function researchToolOwner(ctx, execution, workbenchId = RESEARCH_WORKBENCH_ID) {
  if (execution?.signal?.aborted) fail('CANCELLED', '这次会话调用已取消。');
  // DSH ToolRuntime supplies agent.session; none of these facts comes from args.
  const sessionId = execution?.agent?.session?.id;
  if (typeof sessionId !== 'string' || !sessionId) fail('SESSION_REQUIRED', '请从复刻研究室的原生会话发起研究。');
  const ownership = ctx?.desktopWorkbenchOwnership;
  if (typeof ownership?.read !== 'function') fail('OWNERSHIP_UNAVAILABLE', '无法核对 DSH 工作台会话归属，请重新打开工作台。');
  const snapshot = await ownership.read();
  if (execution?.signal?.aborted) fail('CANCELLED', '这次会话调用已取消。');
  if (!Array.isArray(snapshot?.added) || !snapshot.added.includes(workbenchId) || snapshot.sessionBindings?.[sessionId] !== workbenchId) {
    fail('WRONG_WORKBENCH', '这条会话不属于已启用的复刻研究室，不能读取或创建研究。');
  }
  return Object.freeze({ sessionId, workbenchId });
}

/**
 * Restrict this business conversation at Host dispatch, not just by omitting a
 * confirmation tool. Otherwise the default coding Agent could curl the local
 * confirmation endpoint with Bash. Other native sessions retain their tools.
 * This is a model-tool boundary, not OS isolation from same-user processes or
 * independently trusted Host plugins.
 */
export function applyResearchSessionPolicy(ctx, { workbenchId = RESEARCH_WORKBENCH_ID } = {}) {
  if (typeof ctx?.on !== 'function') throw new Error('DSH 会话工具边界接口不可用，研究工具未启用。');
  const allowed = new Set(Object.values(RESEARCH_TOOL_NAMES));
  const reason = '复刻研究室会话只允许准备理解卡和读取研究结果；采集、分析及风格确认由用户在工作台操作。此会话不能使用 Bash、文件写入、网页请求、代码执行或子 Agent 绕过确认。请继续对话澄清，或使用四个复刻研究工具，不要换工具重试。';
  const offs = [];
  async function isResearchSession(agent) {
    const id = agent?.session?.id;
    if (typeof id !== 'string' || !id) return false;
    if (typeof ctx?.desktopWorkbenchOwnership?.read !== 'function') throw new Error('无法核对 DSH 会话归属，工具执行暂停。');
    const snapshot = await ctx.desktopWorkbenchOwnership.read();
    return snapshot?.sessionBindings?.[id] === workbenchId && snapshot?.added?.includes(workbenchId) === true;
  }
  try {
    // Re-read persisted ownership for every invocation. Do not rely on
    // agent/created: Desktop binds ownership after the native Agent is created.
    offs.push(ctx.on('tools/pre-execute', async (execution, next) => {
      if (await isResearchSession(execution?.agent) && !allowed.has(execution.name)) return { kind: 'deny', reason };
      return next();
    }));
    // Current Host exposes assembly as an async waterfall. Filter each fresh
    // assembly, so restore/rebind does not inherit stale advertised tools.
    offs.push(ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      const assembled = await next();
      if (!await isResearchSession(context?.agent)) return assembled;
      const tools = (assembled.tools || []).filter(tool => allowed.has(tool.name));
      if (!tools.some(tool => tool.name === RESEARCH_TOOL_NAMES.prepare)) throw new Error('复刻研究室需要 DSH 原生工具模式；当前会话没有可调用的理解卡工具。请检查工具模式或权限，不会自动改用代码执行。');
      return {
        ...assembled,
        tools,
        sections: [...(assembled.sections || []).filter(section => section.name !== 'REPLICATE_RESEARCH_SCOPE'), {
          name: 'REPLICATE_RESEARCH_SCOPE',
          text: `${reason}\n新版主流程是用户在工作台选择范围、粘贴账号、点击开始研究，一次处理4～6条，不要求先聊天。用户已经在使用对话时，你仍只保存理解卡：单账号4～6条用account-study，选片balanced、top-in-page或latest；UI点击授权才执行，不提供自动start工具。旧案例不自动继承。只围绕本次链接、原意和明确选择的专题或风格理解，不展开代码、课程或工作区背景。先简短复述，再保存理解卡；已说明的链接、数量、重点或暂无素材不要重复询问。产品／受众可记未指定，只有必要条件缺失或矛盾才合并澄清。\n来源用 account 或 videos；Instagram、抖音及其他安全 HTTPS 来源都可保存规划卡，是否可执行以 sourceCapability 为准。抖音 secUid 保留大小写。v.douyin.com 分享短链用 source.kind='douyin-share'，只从分享文案提取 URL，准备卡时零网络，不猜账号、视频或 secUid；UI 确认后才免费解析 HTTPS 响应头，不新增付费解析服务。候选模式解析为单条视频时应停止并请用户改单片研究。\n要先看八条候选、暂不下载或深拆时设 executionMode='candidate-selection'、candidateLimit=8、selectionPolicy.count<=2；排序用 latest 或 top-in-window。首次 UI 确认只取一页元数据候选，状态 waiting_selection 时等用户选择最多两条并再次确认，Agent 不能代选或触发深拆。标题、热度和元数据不足以声称识别了画面、调性或节奏。明确仅规划／合成验收／完全不请求供应商才设 executionMode='planning-only'，此模式确认也零供应商调用。直接深拆最多两条设 executionMode='research'（默认），UI 确认后会调用供应商；“先理解后确认”“暂不生成视频”本身不等于仅规划。不能凭测试样式链接承诺不会抓取，以卡片模式、调用范围和状态为准。聊天里的“确认”不能替代工作台中绑定任务版本的确认。\n现有 TikHub 凭据可供接通的适配器复用。平台适配未接通或尚未真实验证，不等于用户无平台权限或密钥失效；分别说明供应商授权、业务适配、真实验证。sourceCapability.available=false 时可保存计划，research 或 candidate-selection 确认会被服务端拦截；planning-only 可完成。不能为未知平台静默调用或换服务。\n仅当用户已选择并提供真实 topicId 时调用 read_topic_context；没有就省略，不从账号或占位符编造 ID。不要生成视频或代选旧样本。模思负责后续画面与音频，不处理纯文本理解。`,
        }],
      };
    }));
  } catch (error) {
    for (const off of offs.reverse()) off?.();
    throw error;
  }
  return () => { for (const off of offs.splice(0).reverse()) off?.(); };
}

/**
 * Register on the real DSH ToolRuntime: parameters + output.schema/render +
 * execute(args, execution). No submit, confirm, start, retry or generation tool.
 */
export function applyResearchAgent(ctx, { service, workbenchId = RESEARCH_WORKBENCH_ID } = {}) {
  if (typeof ctx?.tools?.register !== 'function') throw new Error('DSH Host tools 服务不可用。');
  if (!service) throw new Error('本机研究服务不可用。');
  const definitions = [
    {
      name: RESEARCH_TOOL_NAMES.prepare,
      method: 'preparePlan',
      parameters: planSchema,
      description: '把用户账号／视频链接和原意保存为中文理解卡，此工具零网络、零分析。新版单账号4～6条用executionMode=account-study，selectionPolicy.mode=balanced/top-in-page/latest；常规用户直接使用账号研究的一键入口，无需先聊天。安全 HTTPS 来源均可规划，适配状态看 sourceCapability，未接通不代表 TikHub 无权限。抖音 secUid 保留大小写；分享短链只提取 URL 并设 source.kind=douyin-share，不解析或编造 ID。先看八条元数据候选用 executionMode=candidate-selection、candidateLimit=8、selectionPolicy.count<=2，首次 UI 确认后取列表，再由用户选择并再次确认深拆；Agent 不能代选，元数据不证明风格。明确仅规划／合成验收且零供应商调用用 planning-only；直接研究用 research（默认），research 在 UI 确认后会调用供应商；暂不生成视频不等于仅规划。未知适配不静默调用。已明确条件不重复询问。更新带 planId+expectedRevision；无真实 topicId 则省略。聊天不能代替 UI 确认，不用旧视频替代新样本，不生成视频。',
    },
    {
      name: RESEARCH_TOOL_NAMES.job,
      method: 'getJob',
      parameters: object({ jobId: identifier() }, ['jobId']),
      description: '读取当前复刻研究室会话自己的研究任务阶段、部分结果及失败原因。只读，不触发采集、收费、重试或新任务。',
    },
    {
      name: RESEARCH_TOOL_NAMES.result,
      method: 'readResult',
      parameters: object({ jobId: identifier() }, ['jobId']),
      description: '读取当前会话已保存的中文视频笔记、适合复刻的形式、具体修改建议和素材缺口。隐藏/回收站内容不可读；必须区分可观察证据、机器测量、模型推断与用户已确认风格，不把建议说成成效已验证。只读，不重新分析。',
    },
    {
      name: RESEARCH_TOOL_NAMES.topic,
      method: 'topicContext',
      parameters: object({ topicId: identifier() }, ['topicId']),
      description: '仅在用户本次已经选择并提供真实 topicId 时，读取该品牌/专题内可见资料及已确认风格。没有真实 ID 就跳过，不从账号、品牌名或占位符编造 topicId，也不为了生成新理解卡先读无关专题。隐藏/回收站内容不可读。候选风格不代表用户偏好；新任务复用时明确 styleVersionId。只读，不抓取或生成。',
    },
  ];
  const disposers = [];
  try {
    for (const definition of definitions) {
      if (typeof service[definition.method] !== 'function') throw new Error(`研究服务缺少 ${definition.method}。`);
      disposers.push(ctx.tools.register({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
        output: {
          schema: { type: 'object', additionalProperties: true },
          render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }]; },
        },
        timeoutMs: 15_000,
        async execute(args, execution) {
          assertArguments(args, definition.parameters);
          if (definition.method === 'preparePlan') {
            const n=args.selectionPolicy?.count;
            if (args.executionMode==='account-study' ? ![4,5,6].includes(n) : n>2) fail('INVALID_INPUT','研究参数的选片数量不符合要求。');
          }
          const owner = await researchToolOwner(ctx, execution, workbenchId);
          const result = await service[definition.method](args, owner);
          if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('本机研究服务返回了无效结果。');
          await researchToolOwner(ctx, execution, workbenchId);
          return researchHostValue(result);
        },
      }));
    }
    disposers.push(applyResearchSessionPolicy(ctx, { workbenchId }));
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose?.();
    throw error;
  }
  return () => { for (const dispose of disposers.splice(0).reverse()) dispose?.(); };
}
