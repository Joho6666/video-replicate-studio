// The factory's compliance gate (extreme claims, numbers that are not on the brief's whitelist), shared by
// the exporter and the hook writer so both judge copy the same way. Pure.
export const DEFAULT_BANNED = ['最', '第一', '唯一', '顶级', '全网', '绝对', '史上'];
export const BANNED_EXCEPTIONS = ['最会'];

export const plain = t => String(t || '').replace(/[{}]/g, '');

/** Same compliance gate as the factory: no extreme claims, every number must be on the whitelist. Pure. */
export function checkLine(text, { whitelist = [], banned = DEFAULT_BANNED, exceptions = BANNED_EXCEPTIONS } = {}) {
  const errors = [];
  const t = plain(text);
  for (const w of banned) if (t.includes(w) && !exceptions.some(x => t.includes(x))) errors.push(`极限词「${w}」`);
  for (const n of t.match(/\d+/g) || []) if (!whitelist.some(w => w.includes(n))) errors.push(`数字 ${n} 不在白名单`);
  return errors;
}

/** Numbers the brief itself states (product name / notes) are the only ones the script may use, plus explicit extras. */
export function whitelistFrom(job, extra = []) {
  const b = job.brief || {};
  const found = `${b.product || ''} ${b.notes || ''}`.match(/\d+/g) || [];
  return [...new Set([...found, ...extra.map(String)])];
}

