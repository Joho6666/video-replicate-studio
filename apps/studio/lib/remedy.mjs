// Fixing the stretches of a person-swap that came out wrong: re-run only those windows (professional mode),
// after the exact price has been shown and confirmed. Same money rules as generate.mjs: the ledger is written
// BEFORE the paid request, a window whose last attempt is unresolved is never re-submitted automatically,
// every window has an attempt limit, and a hard cap bounds the total.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export const RATES = { 'wan-std': 0.6, 'wan-pro': 0.9 };   // CNY per output second, wan2.2-animate-mix
export const MIN_SECONDS = 2;                              // the model rejects shorter clips
export const MAX_ATTEMPTS = 2;
export const round2 = x => Math.round(x * 100) / 100;

/** Expands each known-bad window by `pad` seconds, lifts it to the model's minimum length, clamps to the video and merges overlaps. */
export function patchWindows(bad, { duration, pad = 0.3, minSeconds = MIN_SECONDS }) {
  if (duration < minSeconds) throw new Error(`视频只有 ${duration} 秒，短于模型的最短 ${minSeconds} 秒`);
  const wins = bad.map(w => {
    let start = Math.max(0, w.start - pad), end = Math.min(duration, w.end + pad);
    if (end - start < minSeconds) {
      const mid = (w.start + w.end) / 2;
      start = mid - minSeconds / 2; end = mid + minSeconds / 2;
      if (start < 0) { end -= start; start = 0; }
      if (end > duration) { start -= end - duration; end = duration; }
    }
    return { start: round2(Math.max(0, start)), end: round2(Math.min(duration, end)) };
  }).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const w of wins) {
    const last = merged.at(-1);
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end); else merged.push({ ...w });
  }
  return merged;
}

const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const key = w => `${w.start.toFixed(2)}-${w.end.toFixed(2)}`;

export function loadLedger(file) {
  if (!file || !existsSync(file)) return { version: 1, attempts: [] };
  const l = JSON.parse(readFileSync(file, 'utf8'));
  return { version: 1, attempts: Array.isArray(l.attempts) ? l.attempts : [] };
}
function saveLedger(file, ledger) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger, null, 1));
  renameSync(tmp, file);
}

/** Attempts that overlap at least half of `w`. */
const attemptsFor = (ledger, w) => ledger.attempts.filter(a => overlap(a.window, w) >= 0.5 * (w.end - w.start));

/**
 * What would be redone and what would it cost? Each window is marked `blocked` (with the reason) when its attempts
 * are used up, when a previous attempt is still unresolved, or when the hard cap would be exceeded.
 */
export function planRemedy({ bad, duration, mode = 'wan-pro', pad, ledger = { attempts: [] }, maxAttempts = MAX_ATTEMPTS, cap = 10, spent = 0 }) {
  if (!RATES[mode]) throw new Error(`未知模式 ${mode}`);
  const windows = patchWindows(bad, { duration, pad }).map(w => {
    const seconds = round2(w.end - w.start);
    const prev = attemptsFor(ledger, w);
    const out = { ...w, seconds, cost: round2(seconds * RATES[mode]), attempt: prev.length + 1 };
    if (prev.some(a => ['submitting', 'submitted', 'unknown'].includes(a.state))) out.blocked = '上一次提交还没有结果，先查清楚再决定，不会自动重提';
    else if (prev.filter(a => a.state === 'succeeded' || a.state === 'failed').length >= maxAttempts) out.blocked = `已重试 ${maxAttempts} 次，不再自动重做，需要你决定`;
    return out;
  });
  let total = 0;
  for (const w of windows) {
    if (w.blocked) continue;
    if (round2(spent + total + w.cost) > cap) { w.blocked = `超过费用上限 ¥${cap}`; continue; }
    total = round2(total + w.cost);
  }
  return { mode, rate: RATES[mode], windows, total, pending: windows.filter(w => !w.blocked), blocked: windows.filter(w => w.blocked) };
}

/**
 * Redoes the planned windows. Needs `confirm` and the exact { windows, total } the quote showed. `redo(window, { mode, onSubmitted })`
 * does the paid work and resolves { file, usage }; it must call `onSubmitted(taskId)` as soon as the task exists.
 */
export async function runRemedy({ plan, confirm, expect, redo, ledgerFile }) {
  if (!confirm) throw new Error('需要确认：先看报价，再带 confirm 提交');
  if (!expect || expect.windows !== plan.pending.length || round2(expect.total) !== plan.total) {
    throw new Error(`报价已变化：现在是 ${plan.pending.length} 段 ¥${plan.total}，你确认的是 ${expect?.windows ?? '?'} 段 ¥${expect?.total ?? '?'}，请重新看报价`);
  }
  const ledger = loadLedger(ledgerFile);
  const done = [], failed = [];
  for (const w of plan.pending) {
    const entry = { window: { start: w.start, end: w.end }, mode: plan.mode, cost: w.cost, state: 'submitting', at: new Date().toISOString() };
    ledger.attempts.push(entry);
    saveLedger(ledgerFile, ledger);                                   // before the request: a crash leaves a trace and blocks a blind resubmit
    try {
      const r = await redo({ start: w.start, end: w.end }, { mode: plan.mode, onSubmitted: id => { entry.state = 'submitted'; entry.taskId = id; saveLedger(ledgerFile, ledger); } });
      entry.state = 'succeeded'; entry.usage = r.usage; entry.file = r.file;
      done.push({ window: key(w), file: r.file });
    } catch (e) {
      entry.state = e.final || !entry.taskId ? 'failed' : 'unknown';   // submitted but no answer: unknown, never retried blindly
      entry.error = String(e.message).slice(0, 300);
      failed.push({ window: key(w), error: entry.error, state: entry.state });
    }
    saveLedger(ledgerFile, ledger);
  }
  return { done, failed, spent: round2(done.reduce((s, d) => s + (plan.pending.find(p => key(p) === d.window)?.cost || 0), 0)) };
}
