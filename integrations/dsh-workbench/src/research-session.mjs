// Browser-safe adapter over DSH's native Session input. It never submits a
// message and never starts a model turn; the user sends the preserved draft.
export function buildResearchOpeningDraft({ link = '', idea = '', topicId = '', styleVersionId = '', planId = '', expectedRevision = '' } = {}) {
  return [
    '请先理解我的复刻前期研究需求，用中文复述，再用 replicate_research__prepare_research_plan 保存一张待我确认的理解卡。关键条件不明确时先合并提问，不自行猜测。',
    `参考链接：${String(link).trim()}`,
    `我的想法：${String(idea).trim()}`,
    '账号／视频可用安全 HTTPS 链接。抖音 secUid 保留大小写；抖音分享短链只提取 v.douyin.com URL 并用 source.kind=douyin-share，准备理解卡时不联网、不猜账号或视频。其他平台也先保存计划，用返回的 sourceCapability 说明适配状态，不把未接通说成我的 TikHub 没权限。',
    ...(topicId ? [`本次品牌／专题 ID：${topicId}`] : []),
    ...(styleVersionId ? [`我本次明确选择复用的风格版本：${styleVersionId}`] : []),
    ...(planId && expectedRevision ? [`修改现有理解卡：planId=${planId}；expectedRevision=${expectedRevision}。`] : []),
    '理解卡包含产品／受众、参考重点、选片方式（深拆最多两条）、素材状态和调用范围；没有素材可直接记录。“表现较好”只针对本次样本和明确指标，不声称全账号最佳。',
    '若先列八条候选、暂不下载或深拆，用 executionMode=candidate-selection、candidateLimit=8、selectionPolicy.count<=2：首次 UI 确认只取元数据，之后等我选片并再次确认，Agent 不能代选。元数据不能证明画面、调性或节奏。若明确只做规划／合成验收且完全不请求供应商，用 planning-only；直接深拆用 research，确认后会调用供应商。先理解后确认、暂不生成视频不等于仅规划。',
    '已说明的信息不要重复询问；没有真实专题 ID 就跳过读取，不编造 ID。区分供应商授权、平台适配和真实验证，未接通平台只保存计划或仅规划，不静默换服务。',
    '现在只理解并保存卡片，等我在工作台点“确认并处理”后才研究。不要自行调用采集或分析服务，不用旧视频替代新链接，不生成视频。模思 VL 不能处理纯文本需求理解；继续沿用当前已获准的 DSH 原生文本模型，不静默换服务。',
  ].join('\n\n');
}

function sessionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Call only from an explicit UI action. `folder` must be a previously confirmed
 * existing business location; omit it to invoke the native directory picker.
 * getActive must read current props/state, not a stale render's boolean.
 */
export async function prepareNativeResearchDraft({ ctx, service, folder, sessionId, draft, getActive = () => true } = {}) {
  const active = () => getActive() && service?.isActive?.() === true;
  if (!active()) throw sessionError('INACTIVE_WORKBENCH', '请先打开复刻研究室，再发起理解需求。');
  if (typeof draft !== 'string' || !draft.trim()) throw sessionError('EMPTY_DRAFT', '请先填写链接和这次的想法。');
  if (typeof service?.ensureSession !== 'function' || typeof service?.ownsSession !== 'function') throw sessionError('SESSION_UNAVAILABLE', 'DSH 原生会话接口不可用，输入已保留。');

  const current = service.currentSession?.();
  let target = sessionId || (current && service.ownsSession(current) ? current : undefined);
  if (target && !service.ownsSession(target)) throw sessionError('WRONG_WORKBENCH', '保存的会话不属于复刻研究室，输入已保留。');
  let selectedFolder = folder;
  if (!target && !selectedFolder) {
    if (typeof ctx?.uiWorkspace?.pickDirectory !== 'function') throw sessionError('PICKER_UNAVAILABLE', '请先通过 DSH 选择资料文件夹，输入已保留。');
    selectedFolder = await ctx.uiWorkspace.pickDirectory();
    if (!selectedFolder) return { status: 'cancelled', draftPreserved: true };
    if (!active()) throw sessionError('NAVIGATION_CHANGED', '已切换工作台，未创建会话；输入已保留。');
  }
  target = await service.ensureSession({ ...(selectedFolder ? { folder: selectedFolder } : {}), ...(target ? { sessionId: target } : {}) });
  if (!active() || !service.ownsSession(target) || service.currentSession?.() !== target) throw sessionError('NAVIGATION_CHANGED', '会话创建期间位置已改变，未插入或发送内容；输入已保留。');
  const scope = ctx?.sessions?.scope?.(target);
  const shell = scope && ctx?.conversation?.input?.for?.(scope);
  if (!shell?.actions?.captureInsertion || !shell?.actions?.insertText || !shell?.state?.getSnapshot) throw sessionError('INPUT_UNAVAILABLE', '会话已打开，但原生输入接口暂不可用；输入已保留。');
  const snapshot = shell.state.getSnapshot();
  if (snapshot.phase === 'adjudicating' || snapshot.phase === 'submitting') throw sessionError('INPUT_BUSY', '当前会话正在发送，请稍后重试；输入已保留。');
  const existing = typeof snapshot.draft === 'string' ? snapshot.draft : '';
  // Repeated clicks on an already inserted request preserve the same draft.
  if (existing.includes(draft)) return { status: 'draft-ready', sessionId: target, reused: true, sent: false };
  const insertion = shell.actions.captureInsertion();
  // Host insertion coordinates are not clipboard offsets when the draft has
  // reference chips. Collapse the captured selection at its end to preserve
  // both selected text and chips, rather than overwriting a selected range.
  const span = { start: insertion.end, end: insertion.end, draftRev: insertion.draftRev };
  if (!active() || service.currentSession?.() !== target || !service.ownsSession(target)) throw sessionError('NAVIGATION_CHANGED', '已切换会话，未插入或发送内容；输入已保留。');
  if (!shell.actions.insertText(`${existing ? '\n\n' : ''}${draft}`, span)) throw sessionError('DRAFT_CHANGED', '原生会话草稿刚刚改变，未覆盖你的输入；请再点一次。');
  return { status: 'draft-ready', sessionId: target, ...(selectedFolder ? { folder: selectedFolder } : {}), reused: false, sent: false };
}

/** Stateful facade used by the React BusinessPanel without remounting it. */
export function createResearchSession({ ctx, service, folder, onSession = () => {}, onOpen = () => {}, getActive = () => true } = {}) {
  let rememberedSession;
  let knownFolder = folder;
  let pending;
  const currentOwned = () => {
    const id = service?.currentSession?.();
    return id && service?.ownsSession?.(id) ? id : undefined;
  };
  const active = () => getActive() && service?.isActive?.() === true;
  return {
    getSessionId() { return currentOwned() || (rememberedSession && service?.ownsSession?.(rememberedSession) ? rememberedSession : undefined); },
    beginUnderstanding(text) {
      if (pending) return pending;
      if (!active()) return Promise.reject(sessionError('INACTIVE_WORKBENCH', '请先打开复刻研究室。'));
      onOpen();
      pending = prepareNativeResearchDraft({ ctx, service, folder: knownFolder, sessionId: currentOwned() || rememberedSession, draft: text, getActive })
        .then(result => {
          if (result.sessionId) { rememberedSession = result.sessionId; knownFolder = result.folder || knownFolder; onSession(result.sessionId); }
          return result;
        }).finally(() => { pending = undefined; });
      return pending;
    },
    async openConversation() {
      if (!active()) throw sessionError('INACTIVE_WORKBENCH', '请先打开复刻研究室。');
      let id = currentOwned() || rememberedSession;
      if (id && !service.ownsSession(id)) throw sessionError('WRONG_WORKBENCH', '保存的会话不属于复刻研究室。');
      if (!id && !knownFolder) {
        if (typeof ctx?.uiWorkspace?.pickDirectory !== 'function') throw sessionError('PICKER_UNAVAILABLE', '请通过 DSH 选择资料文件夹。');
        const selected = await ctx.uiWorkspace.pickDirectory();
        if (!selected) return { status: 'cancelled' };
        if (!active()) throw sessionError('NAVIGATION_CHANGED', '已切换工作台，未创建会话。');
        knownFolder = selected;
      }
      id = await service.ensureSession({ ...(id ? { sessionId: id } : {}), ...(knownFolder ? { folder: knownFolder } : {}) });
      if (!active() || !service.ownsSession(id) || service.currentSession?.() !== id) throw sessionError('NAVIGATION_CHANGED', '已切换会话，没有插入或发送内容。');
      rememberedSession = id;
      onSession(id);
      onOpen();
      return { status: 'conversation-open', sessionId: id, sent: false };
    },
  };
}
