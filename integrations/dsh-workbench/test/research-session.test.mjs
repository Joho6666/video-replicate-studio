import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNativeResearchDraft, createResearchSession, buildResearchOpeningDraft } from '../src/research-session.mjs';

function fixture(initial = '我已有的草稿') {
  let draft = initial, revision = 1, selected = { start: 2, end: 4 }, current = 'owned-session';
  let active = true;
  const calls = [];
  const shell = { state: { getSnapshot: () => ({ draft, phase: 'plain', draftRev: revision }) }, actions: {
    captureInsertion: () => ({ ...selected, draftRev: revision }),
    insertText(text, span) { calls.push(['insert', text, span]); if (span.draftRev !== revision) return false; draft = draft.slice(0, span.start) + text + draft.slice(span.end); revision++; return true; },
    submit() { throw new Error('MUST NEVER SEND'); },
  } };
  const service = {
    isActive: () => active,
    currentSession: () => current,
    ownsSession: id => id === 'owned-session',
    async ensureSession(args) { calls.push(['ensure', args]); current = 'owned-session'; return current; },
  };
  const ctx = { sessions: { scope: id => ({ id }) }, conversation: { input: { for: () => shell } }, uiWorkspace: { async pickDirectory() { calls.push(['picker']); return null; } } };
  return { service, ctx, calls, shell, getDraft: () => draft, getActive: () => active, setActive: value => { active = value; }, setCurrent: value => { current = value; }, setSelection: value => { selected = value; } };
}

test('native draft insertion preserves selected text and existing content and does not submit', async () => {
  const f = fixture();
  const result = await prepareNativeResearchDraft({ ...f, draft: '新研究需求' });
  assert.equal(result.sent, false);
  assert.equal(result.status, 'draft-ready');
  assert.equal(f.getDraft().replace('\n\n新研究需求', ''), '我已有的草稿');
  const insertion = f.calls.find(call => call[0] === 'insert');
  assert.deepEqual(insertion[2], { start: 4, end: 4, draftRev: 1 });
});

test('repeated draft action does not insert duplicate input', async () => {
  const f = fixture(''); f.setSelection({ start: 0, end: 0 });
  await prepareNativeResearchDraft({ ...f, draft: '新研究需求' });
  const result = await prepareNativeResearchDraft({ ...f, draft: '新研究需求' });
  assert.equal(result.reused, true);
  assert.equal(f.calls.filter(call => call[0] === 'insert').length, 1);
});

test('cancelled native folder picker creates no session and writes no draft', async () => {
  const f = fixture(); f.setCurrent(undefined);
  const result = await prepareNativeResearchDraft({ ...f, draft: '需求' });
  assert.deepEqual(result, { status: 'cancelled', draftPreserved: true });
  assert.deepEqual(f.calls, [['picker']]);
});

test('foreign saved session and hidden workbench cannot create or modify sessions', async () => {
  const f = fixture();
  await assert.rejects(prepareNativeResearchDraft({ ...f, sessionId: 'other-session', draft: '需求' }), /不属于/);
  f.setActive(false);
  await assert.rejects(prepareNativeResearchDraft({ ...f, draft: '需求' }), /先打开/);
  assert.equal(f.calls.length, 0);
});

test('navigation change during ensureSession preserves input and prevents insertion', async () => {
  const f = fixture();
  f.service.ensureSession = async () => { f.setActive(false); return 'owned-session'; };
  await assert.rejects(prepareNativeResearchDraft({ ...f, draft: '需求' }), /位置已改变/);
  assert.equal(f.getDraft(), '我已有的草稿');
  assert.equal(f.calls.length, 0);
});

test('native busy and revision-race conditions preserve current user draft', async () => {
  const f = fixture();
  f.shell.state.getSnapshot = () => ({ draft: '正在发送', phase: 'submitting' });
  await assert.rejects(prepareNativeResearchDraft({ ...f, draft: '需求' }), /正在发送/);
  f.shell.state.getSnapshot = () => ({ draft: '草稿', phase: 'plain' });
  f.shell.actions.insertText = () => false;
  await assert.rejects(prepareNativeResearchDraft({ ...f, draft: '需求' }), /刚刚改变/);
  assert.equal(f.getDraft(), '我已有的草稿');
});

test('stateful facade deduplicates an in-flight begin, opens native conversation and reports session', async () => {
  const f = fixture(''); f.setSelection({ start: 0, end: 0 });
  const events = [];
  const bridge = createResearchSession({ ...f, folder: '/synthetic/confirmed-folder', onOpen: () => events.push('open'), onSession: id => events.push(id) });
  const first = bridge.beginUnderstanding('需求');
  assert.equal(first, bridge.beginUnderstanding('需求'));
  await first;
  assert.deepEqual(events, ['open', 'owned-session']);
  assert.equal(bridge.getSessionId(), 'owned-session');
  const result = await bridge.openConversation();
  assert.equal(result.sent, false);
  assert.equal(f.calls.filter(call => call[0] === 'insert').length, 1);
});

test('opening conversation with cancelled selection has no side effects', async () => {
  const f = fixture(); f.setCurrent(undefined);
  const bridge = createResearchSession({ ...f, onOpen: () => { throw new Error('must not open'); } });
  assert.deepEqual(await bridge.openConversation(), { status: 'cancelled' });
  assert.deepEqual(f.calls, [['picker']]);
});

test('opening request expresses original intent and explicit no-execution boundary', () => {
  const result = buildResearchOpeningDraft({ link: 'https://www.instagram.com/dsh_synthetic_example/', idea: '只验证理解卡，不请求视频', topicId: 'topic_synthetic', styleVersionId: 'style_synthetic', planId: 'plan_synthetic', expectedRevision: 1 });
  assert.match(result, /只验证理解卡，不请求视频/);
  assert.match(result, /replicate_research__prepare_research_plan/);
  assert.match(result, /planId=plan_synthetic；expectedRevision=1/);
  assert.match(result, /模思 VL 不能处理纯文本/);
  assert.match(result, /最多两条/);
});

test('opening draft preserves candidate-first intent and directs native Agent to wait for two UI decisions', () => {
  const link = 'https://v.douyin.com/SYNTHETIC_aB12/';
  const idea = '先看八条候选，不下载，我选两条再拆。';
  const result = buildResearchOpeningDraft({ link, idea });
  assert.ok(result.includes(link));
  assert.ok(result.includes(idea));
  assert.match(result, /source.kind=douyin-share/);
  assert.match(result, /executionMode=candidate-selection、candidateLimit=8、selectionPolicy.count<=2/);
  assert.match(result, /首次 UI 确认只取元数据.*再次确认，Agent 不能代选/);
  assert.match(result, /元数据不能证明画面、调性或节奏/);
  assert.match(result, /适配状态.*不把未接通说成我的 TikHub 没权限/);
  assert.doesNotMatch(result, /短链请先让我补完整链接/);
});
