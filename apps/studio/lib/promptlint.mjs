// Prompt hygiene for image / video models. Measured in this project: naming something you do NOT want makes
// the model draw it ("no phone" → a phone in the frame, "no spider" → a spider emblem). So prompts should
// only describe what is wanted. Pure functions, no I/O.

// Things that are safe (and useful) to negate: they are overlays or artefacts, not scene content.
const ALLOWED = /^(?:text|texts|words?|watermarks?|logos?|subtitles?|captions?|letters?|writing|brand names?|signature|blur|blurry|noise|artifacts?)$/i;
const ALLOWED_ZH = /^(?:文字|文本|字幕|水印|logo|商标|标志)/i;
const NEG_EN = /\b(?:no|not|without|never|don'?t|doesn'?t|avoid|avoiding|nothing)\b\s+(?:any\s+|a\s+|an\s+|the\s+|visible\s+|other\s+)*([a-z][\w'-]*(?:\s+[a-z][\w'-]*)?)/gi;
const NEG_ZH = /(?:不要|别|无|没有|不带|不出现|避免|禁止)\s*([^，。,.；;、\s]{1,8})/g;

/** Negated objects found in a prompt that are NOT on the safe list. */
export function negations(prompt) {
  const text = String(prompt || '');
  const found = [];
  for (const m of text.matchAll(NEG_EN)) {
    const first = m[1].trim().split(/\s+/)[0];
    if (!ALLOWED.test(m[1].trim()) && !ALLOWED.test(first)) found.push({ phrase: m[0].trim(), object: m[1].trim() });
  }
  for (const m of text.matchAll(NEG_ZH)) if (!ALLOWED_ZH.test(m[1])) found.push({ phrase: m[0].trim(), object: m[1] });
  return found;
}

/** Warnings for the page. `ok` = nothing to fix. */
export function lintPrompt(prompt) {
  const warnings = negations(prompt).map(n => ({ code: 'negation', phrase: n.phrase, advice: `去掉「${n.phrase}」：点名不想要的东西，模型反而更容易画出 ${n.object}。只写想要的画面。` }));
  return { ok: warnings.length === 0, warnings };
}

/**
 * Removes the clauses that name unwanted things (clauses are comma-separated), keeping safe negations such as
 * "no text". If everything would be removed the original is returned.
 */
export function stripNegations(prompt) {
  const text = String(prompt || '');
  const clauses = text.split(/([,，;；])/);
  const kept = [];
  for (let i = 0; i < clauses.length; i += 2) {
    const clause = clauses[i];
    if (negations(clause).length) continue;
    kept.push(clause.trim());
  }
  const out = kept.filter(Boolean).join(', ').replace(/\s+/g, ' ').trim();
  return out || text;
}

/** Positive framing added on a retry after a failed picture (never a negation). */
export const POSITIVE_FALLBACK = 'still life composition focused on the object, clean tidy scene';

/** Prompt for retry number `attempt` (1-based): first just remove negations, later also simplify the composition. */
export function retryPrompt(prompt, attempt) {
  const base = stripNegations(prompt);
  return attempt >= 2 && !base.includes(POSITIVE_FALLBACK) ? `${base}, ${POSITIVE_FALLBACK}` : base;
}
