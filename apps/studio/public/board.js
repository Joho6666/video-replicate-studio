// Storyboard board: one card per shot (picture, line, prompt, source, cost, approval) plus the free
// animatic. Used as a tab on replication jobs and as the whole page of script jobs.
// ctx = { api, toast, esc, file, tc, reload }

const QC_LABEL = { PASS: '通过', WARN: '有瑕疵', FAIL: '不合格' };
const ISSUE_LABEL = { deformed_face_or_hands: '脸/手变形', text_or_logo: '出现文字/商标', prompt_mismatch: '与提示词不符', identity_drift: '人物不一致', third_party_ip: '疑似第三方形象', body_merge: '肢体融合', unexpected_object: '多出不该有的物体' };
const KIND_LABEL = { still: '分镜图', generate: '付费生成', reuse: '复用素材', client: '客户提供' };
const EDITABLE_KINDS = ['still', 'generate', 'client']; // "reuse" needs a file path and is shown read-only
const yuan = n => `¥${(Number(n) || 0).toFixed(2)}`;

export async function mountBoard(root, job, ctx) {
  const { api, toast, esc, file, tc } = ctx;
  let board = null, dirty = false, busy = '', lastPlan = null, lastExport = null, lastHookReject = null;
  const isScript = job.source.platform === 'script';

  const load = async () => {
    try { board = await api(`/api/jobs/${job.id}/board`); } catch { board = null; }
    dirty = false;
    paint();
  };

  const run = async (label, fn) => {
    if (busy) return;
    busy = label; paint();
    try { await fn(); } catch (e) { toast(e.message, true); }
    busy = ''; await load();
  };

  const qcOf = () => { const c = { PASS: 0, WARN: 0, FAIL: 0 }; for (const s of board?.shots || []) if (s.qc) c[s.qc.verdict]++; return c; };
  const pendingStills = () => (board?.shots || []).filter(s => s.source.kind === 'still' && s.prompt && !s.source.image);

  function paint() {
    if (!board) { paintEmpty(); return; }
    const est = board.estimate || { total: 0, unknown: [], calls: [] };
    const approved = board.shots.filter(s => s.status === 'approved' || s.status === 'done').length;
    const pending = pendingStills().length;
    root.innerHTML = `
      <div class="bd-head">
        <div class="bd-stats">
          <div><b>${board.shots.length}</b><span>镜头</span></div>
          <div><b>${tc(board.total)}</b><span>总时长</span></div>
          <div class="${board.overBudget ? 'over' : ''}"><b>${yuan(est.total)}</b><span>付费预估${board.budget?.limit != null ? ` / 预算 ${yuan(board.budget.limit)}` : ''}</span></div>
          <div><b>${approved}/${board.shots.length}</b><span>已审批</span></div>
        </div>
        <div class="bd-actions">
          <label class="bd-budget">预算上限 ¥<input id="bdBudget" type="number" min="0" step="1" value="${board.budget?.limit ?? ''}" placeholder="不限"></label>
          <button class="btn sm" id="bdStills" ${busy || !pending ? 'disabled' : ''}>${busy === 'stills' ? '生成中…' : `生成缺失分镜图（${pending}）`}</button>
          <button class="btn sm" id="bdAnim" ${busy ? 'disabled' : ''}>${busy === 'anim' ? '渲染中…' : '出动态分镜（免费）'}</button>
          <button class="btn sm" id="bdAuto" ${busy ? 'disabled' : ''}>${busy === 'auto' ? '补救中…' : '自动补救分镜图'}</button>
          <button class="btn sm" id="bdVoice" ${busy ? 'disabled' : ''}>${busy === 'voice' ? '配音中…' : '整段配音'}</button>
          <button class="btn sm" id="bdGen" ${busy ? 'disabled' : ''}>${busy === 'gen' ? '提交中…' : '提交付费生成'}</button>
          <button class="btn sm" id="bdQc" ${busy ? 'disabled' : ''}>${busy === 'qc' ? '质检中…' : '镜头质检'}</button>
          <button class="btn sm" id="bdExport" ${busy ? 'disabled' : ''}>${busy === 'export' ? '导出中…' : '导出到批量剪辑'}</button>
          <button class="btn ink sm" id="bdSave" ${busy || !dirty ? 'disabled' : ''}>${dirty ? '保存修改' : '已保存'}</button>
        </div>
      </div>
      ${yieldLine()}
      ${qcBanner()}
      ${hooksPanel()}
      ${lastExport ? exportPanel() : ''}
      ${est.unknown?.length ? `<div class="bd-warn">有 ${est.unknown.length} 个镜头的单价未知（${est.unknown.join('、')}），不会计入预估，也不能提交。</div>` : ''}
      ${board.overBudget ? `<div class="bd-warn">付费预估 ${yuan(est.total)} 已超过预算上限，提交前请调整。</div>` : ''}
      ${board.render ? `<div class="bd-anim"><video controls playsinline preload="metadata" src="${file(job.id, board.render.file)}?v=${encodeURIComponent(board.render.at || '')}"></video>
        <p>动态分镜 · ${board.render.segments} 镜${board.render.placeholders ? ` · ${board.render.placeholders} 镜还是占位卡` : ''}${board.render.voice ? ' · 含配音' : ' · 无配音（还没有 voice/full.wav）'}</p></div>` : ''}
      <div class="bd-grid">${board.shots.map(card).join('')}</div>
      <p class="foot-note">付费视频生成仍在「H3 出片」页确认并提交；这里只负责镜头、分镜图和免费动态分镜。费用由服务端重新计算，页面上的数字只是展示。</p>`;
    bind();
  }

  const failedClips = () => (board?.shots || []).filter(s => s.source?.kind === 'generate' && s.qc?.verdict === 'FAIL').map(s => s.id);
  const pendingHooks = () => (board?.hooks || []).filter(h => !h.voice);
  const hookChars = list => list.reduce((n, h) => n + String(h.text || '').replace(/\s/g, '').length, 0);

  function hooksPanel() {
    const hooks = board.hooks || [];
    const pending = pendingHooks();
    const rejected = lastHookReject?.length ? `<p class="muted">被过滤 ${lastHookReject.length} 条：${lastHookReject.slice(0, 4).map(r => esc(r.reason)).join('；')}</p>` : '';
    return `<section class="bd-hooks">
      <div class="bd-hooks-head"><b>钩子变体</b><span class="muted">开头第一句换成不同说法，批量剪辑时每个变体用一句；口型绑定原台词的口播镜头不会被换。</span>
        <div class="bd-actions"><button class="btn sm" id="bdHookWrite" ${busy ? 'disabled' : ''}>${busy === 'hookw' ? '写作中…' : hooks.length ? '重写钩子' : '写备选钩子'}</button>
        <button class="btn sm" id="bdHookVoice" ${busy || !pending.length ? 'disabled' : ''}>${busy === 'hookv' ? '配音中…' : `生成钩子配音（${pending.length} 条 · 约 ${hookChars(pending)} 字）`}</button></div></div>
      <label class="bd-budget">钩子音色 ID <input id="bdHookVoiceId" value="${esc(board.voice?.id || '')}" placeholder="MOSI 音色 ID，需与正片配音一致" style="width:300px"></label>
      ${hooks.map((h, i) => `<div class="bd-hook" data-h="${i}"><span class="bd-hook-id">${esc(h.id)}</span><textarea rows="2" data-hf="text">${esc(h.text)}</textarea>
        <span class="bd-hook-meta">${esc(h.angle || '')} · ${h.voice ? `已配音 ${h.voice.seconds}s` : '未配音'}</span></div>`).join('')}
      ${rejected}</section>`;
  }

  function yieldLine() {
    const y = board.yield;
    if (!y || (!y.clip.checked && !y.image.checked)) return '';
    const f = t => (t.checked ? `${t.usable}/${t.checked}（${Math.round(t.rate * 100)}%）` : '—');
    return `<div class="bd-note">成片率：视频 ${f(y.clip)} · 分镜图 ${f(y.image)}${y.spent ? ` · 已花 ${yuan(y.spent)}` : ''}${y.costPerUsableSecond ? ` · 每个可用秒 ≈ ${yuan(y.costPerUsableSecond)}` : ''}</div>`;
  }

  function qcBanner() {
    const c = qcOf();
    if (!c.PASS && !c.WARN && !c.FAIL) return '';
    const p = lastPlan;
    const redo = p?.shots?.length ? `重跑这 ${p.shots.length} 镜预计 ${yuan(p.total)}${p.unknown?.length ? '（部分单价未知）' : ''}；提交仍在「H3 出片」页逐段确认，这里不会扣费。` : '';
    const clips = failedClips();
    return `<div class="${c.FAIL ? 'bd-warn' : 'bd-note'}">质检：${c.PASS} 通过 · ${c.WARN} 有瑕疵 · ${c.FAIL} 不合格。${c.FAIL ? redo || '不合格的镜头不会被导出。' : ''}${clips.length ? ` <button class="btn sm" id="bdRedo">重跑失败的视频镜头（${clips.length}）</button>` : ''}</div>`;
  }

  function exportPanel() {
    const r = lastExport;
    const hv = r.hookVariants?.length ? `<br>钩子变体：${r.hookVariants.map(h => `${esc(h.name)}「${esc(h.text.slice(0, 40))}」`).join('；')}` : '';
    const hs = r.hooksSkipped?.length ? `<br>没导出的钩子：${r.hooksSkipped.map(h => `${esc(h.id)}（${esc(h.reason)}）`).join('；')}` : '';
    return `<div class="bd-note"><b>已导出 ${r.clips} 个镜头 · ${r.variants.length} 个变体</b>${hv}${hs}${r.voiced ? '' : ' · 没有配音，剪辑端会用它自带的中文语音'}<br>目录：<code>${esc(r.outDir)}</code><br>说明与运行命令见 <code>${esc(r.report)}</code>
      ${r.skipped.length ? `<br>跳过 ${r.skipped.length} 镜：${r.skipped.slice(0, 6).map(x => `${esc(x.id)}（${esc(x.reason)}）`).join('；')}` : ''}</div>`;
  }

  const TASK_LABEL = { submitting: '正在提交', submitted: '生成中…', unknown: '提交结果不明，请到 MiniMax 控制台核对', succeeded: '已生成', failed: '生成失败', rejected: '被拒绝（没有扣费）' };
  function taskBadge(s) {
    const t = s.generate?.task;
    return t ? `<div class="bd-note">${esc(TASK_LABEL[t.state] || t.state)}${t.cost ? ` · ${yuan(t.cost)}` : ''}${t.error ? `<br>${esc(t.error)}` : ''}</div>` : '';
  }

  function qcBadge(s) {
    if (!s.qc) return '';
    const issues = (s.qc.issues || []).map(i => `<li class="${i.severity}">${esc(ISSUE_LABEL[i.code] || i.code)}（第 ${i.frame} 帧）：${esc(i.evidence)}</li>`);
    const failed = (s.qc.checks || []).filter(c => !c.ok).map(c => `<li class="${c.level === 'FAIL' ? 'high' : 'medium'}">${esc(c.detail)}</li>`);
    const note = s.qc.vision?.skipped ? `<li class="muted">${esc(s.qc.vision.skipped)}</li>` : '';
    return `<div class="bd-qc q-${s.qc.verdict}"><b>${QC_LABEL[s.qc.verdict]}</b>${failed.length + issues.length + (note ? 1 : 0) ? `<ul>${failed.join('')}${issues.join('')}${note}</ul>` : ''}</div>`;
  }

  function paintEmpty() {
    root.innerHTML = `<div class="waiting"><strong>还没有镜头表</strong>${isScript
      ? '把脚本拆成镜头：每句一个镜头，AI 决定画面，系统决定哪些镜头值得付费生成。<br><br><button class="btn ink" id="bdSplit">拆成镜头表</button>'
      : '从爆款拆解生成一张镜头表：每个镜头可以改成分镜图、复用素材或付费生成，并实时看到总费用。<br><br><button class="btn ink" id="bdFromDirector" ' + (job.director ? '' : 'disabled') + '>从拆解生成镜头表</button>'}</div>`;
    const split = root.querySelector('#bdSplit');
    if (split) split.onclick = () => run('split', async () => { const r = await api(`/api/jobs/${job.id}/board/split`, { method: 'POST', json: {} }); if (r.notes?.length) toast(r.notes[0]); });
    const fd = root.querySelector('#bdFromDirector');
    if (fd) fd.onclick = () => run('fd', () => api(`/api/jobs/${job.id}/board/from-director`, { method: 'POST', json: {} }));
    if (busy) root.querySelector('.waiting strong').textContent = busy === 'split' ? '正在拆镜头…通常 20–60 秒' : '正在生成镜头表…';
  }

  function card(s, i) {
    const k = s.source.kind;
    const img = s.source.image ? `<img src="${file(job.id, s.source.image)}" alt="" loading="lazy">` : `<div class="bd-ph">${esc(KIND_LABEL[k])}${k === 'still' ? '<small>还没出图</small>' : ''}</div>`;
    const sec = s.cost?.seconds ? `${s.cost.seconds}s · ${yuan(s.cost.estimate)}` : '';
    return `<article class="bd-card ${s.status === 'approved' || s.status === 'done' ? 'ok' : ''}" data-i="${i}">
      <div class="bd-thumb">${img}<span class="bd-id">${esc(s.id)}</span><span class="bd-tc">${tc(s.start)}–${tc(s.end)}</span>${sec ? `<span class="bd-cost">${esc(sec)}</span>` : ''}</div>
      <div class="bd-body">
        <div class="bd-row">
          <select data-f="kind" ${k === 'reuse' ? 'disabled' : ''}>${(k === 'reuse' ? ['reuse'] : EDITABLE_KINDS).map(x => `<option value="${x}" ${x === k ? 'selected' : ''}>${KIND_LABEL[x]}</option>`).join('')}</select>
          <label class="bd-ap"><input type="checkbox" data-f="approved" ${s.status === 'approved' || s.status === 'done' ? 'checked' : ''}> 通过</label>
        </div>
        <input data-f="text" value="${esc(s.text || '')}" placeholder="台词（可空）">
        <textarea data-f="prompt" rows="3" placeholder="${k === 'client' ? '客户提供真人素材，不写提示词' : '画面提示词'}" ${k === 'client' ? 'disabled' : ''}>${esc(s.prompt || '')}</textarea>
        ${s.lint && !s.lint.ok ? `<p class="bd-lint">⚠ ${esc(s.lint.warnings[0].advice)}</p>` : ''}
        ${s.visual ? `<p class="bd-visual">${esc(s.visual)}</p>` : ''}
        ${taskBadge(s)}${qcBadge(s)}
        ${k === 'still' ? `<button class="btn text sm" data-act="regen" ${busy ? 'disabled' : ''}>${s.source.image ? '重新生成这张图' : '生成这张图'}</button>` : ''}
      </div>
    </article>`;
  }

  function bind() {
    root.querySelectorAll('.bd-card').forEach(cardEl => {
      const s = board.shots[Number(cardEl.dataset.i)];
      cardEl.querySelectorAll('[data-f]').forEach(el => {
        el.oninput = el.onchange = () => {
          const f = el.dataset.f;
          if (f === 'text') s.text = el.value;
          if (f === 'prompt') s.prompt = el.value;
          if (f === 'approved') s.status = el.checked ? 'approved' : 'draft';
          if (f === 'kind') {
            s.source = { ...s.source, kind: el.value };
            if (el.value === 'generate') s.generate = s.generate || { provider: 'h3', resolution: '768P', group: s.id };
            else delete s.generate;
          }
          dirty = true;
          if (f === 'kind') paint(); else root.querySelector('#bdSave').disabled = false, root.querySelector('#bdSave').textContent = '保存修改';
        };
      });
      const regen = cardEl.querySelector('[data-act="regen"]');
      if (regen) regen.onclick = () => generate([s.id], true);
    });
    root.querySelector('#bdBudget').onchange = e => { board.budget = e.target.value === '' ? undefined : { limit: Number(e.target.value), currency: 'CNY' }; dirty = true; save(); };
    root.querySelector('#bdSave').onclick = save;
    root.querySelector('#bdStills').onclick = () => generate(null, false);
    root.querySelector('#bdAuto').onclick = () => autoRun();
    root.querySelector('#bdVoice').onclick = () => voiceRun();
    root.querySelector('#bdGen').onclick = () => genRun();
    const redo = root.querySelector('#bdRedo');
    if (redo) redo.onclick = () => genRun({ again: true, ids: failedClips() });
    root.querySelector('#bdQc').onclick = () => qcRun();
    root.querySelector('#bdHookWrite').onclick = () => hookWrite();
    root.querySelector('#bdHookVoice').onclick = () => hookVoice();
    root.querySelector('#bdHookVoiceId').onchange = e => { const id = e.target.value.trim(); board.voice = id ? { provider: 'moss', id } : undefined; dirty = true; save(); };
    root.querySelectorAll('.bd-hook').forEach(el => {
      el.querySelector('[data-hf="text"]').onchange = e => { board.hooks[Number(el.dataset.h)].text = e.target.value; dirty = true; save(); };
    });
    root.querySelector('#bdExport').onclick = () => exportRun();
    root.querySelector('#bdAnim').onclick = () => run('anim', async () => { if (dirty) await persist(); await api(`/api/jobs/${job.id}/board/animatic`, { method: 'POST', json: {} }); });
  }

  const persist = () => api(`/api/jobs/${job.id}/board`, { method: 'PUT', json: board });
  const save = () => run('save', async () => { await persist(); toast('镜头表已保存'); });

  function hookWrite() {
    const raw = prompt('写几条备选钩子？（1–10，只花 DeepSeek 的几分钱，不生成配音）', '5');
    if (raw === null) return;
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 1 || count > 10) return toast('条数需要是 1–10 的整数', true);
    const voiced = (board.hooks || []).some(h => h.voice);
    if (voiced && !confirm('已有配好音的钩子，重写会替换它们（已花的配音费不会退）。继续吗？')) return;
    run('hookw', async () => {
      if (dirty) await persist();
      const r = await api(`/api/jobs/${job.id}/board/hooks`, { method: 'POST', json: { action: 'write', count, replace: voiced } });
      lastHookReject = r.rejected;
      toast(`写好 ${r.hooks.length} 条钩子${r.rejected.length ? `，过滤掉 ${r.rejected.length} 条` : ''}`);
    });
  }

  function hookVoice() {
    const todo = pendingHooks();
    if (!todo.length) return;
    if (!board.voice?.id) return toast('先填钩子音色 ID（要和正片配音用同一个音色）', true);
    if (!confirm(`将用 MOSI 为 ${todo.length} 条钩子配音，共约 ${hookChars(todo)} 字，按字计费。继续吗？`)) return;
    run('hookv', async () => {
      if (dirty) await persist();
      const r = await api(`/api/jobs/${job.id}/board/hooks`, { method: 'POST', json: { action: 'voice', confirm: true, count: todo.length } });
      if (r.failed?.length) toast(`${r.generated.length} 条完成，${r.failed.length} 条失败：${r.failed[0].error}`, true);
      else toast(`已为 ${r.generated.length} 条钩子配音`);
    });
  }

  async function autoRun() {
    if (busy) return;
    try {
      if (dirty) await persist();
      const p = await api(`/api/jobs/${job.id}/board/autostills`, { method: 'POST', json: { action: 'plan' } });
      if (!p.shots) {
        if (p.productStills) { run('auto', () => api(`/api/jobs/${job.id}/board/autostills`, { method: 'POST', json: { action: 'run', confirm: true, expect: { shots: 0, max: 0 } } })); return; }
        return toast('没有需要生成或补救的分镜图');
      }
      if (!confirm(`将处理 ${p.shots} 张分镜图（缺图的生成，质检没过的重做），每张出图后自动质检，没过的最多再重做 ${p.maxRetries} 轮。
最多生成 ${p.max} 张，按张计费（每张几分钱）。继续吗？`)) return;
      run('auto', async () => {
        const r = await api(`/api/jobs/${job.id}/board/autostills`, { method: 'POST', json: { action: 'run', confirm: true, expect: { shots: p.shots, max: p.max } } });
        toast(`生成 ${r.images} 张，${r.passed.length} 张通过${r.stillFailing.length ? `，${r.stillFailing.length} 张仍不合格（${r.stillFailing.join('、')}），建议改画面描述` : ''}`, r.stillFailing.length > 0);
      });
    } catch (e) { toast(e.message, true); }
  }

  async function voiceRun() {
    if (busy) return;
    try {
      if (dirty) await persist();
      const p = await api(`/api/jobs/${job.id}/board/voiceover`, { method: 'POST', json: { action: 'plan' } });
      if (!p.voiceId) return toast('先在「钩子变体」面板填音色 ID（整段配音和钩子要用同一个音色）', true);
      if (!p.lines) { toast('所有台词都已配好音，重新混音（免费）'); }
      else if (!confirm(`将用 MOSI 为 ${p.lines} 句台词配音（共 ${p.total} 句，其余沿用已有配音），约 ${p.chars} 字，按字计费。继续吗？`)) return;
      run('voice', async () => {
        const r = await api(`/api/jobs/${job.id}/board/voiceover`, { method: 'POST', json: { action: 'generate', confirm: true, expect: { lines: p.lines, chars: p.chars } } });
        const bits = [`已配 ${r.generated.length} 句`, r.failed.length ? `${r.failed.length} 句失败：${r.failed[0].error}` : '', r.warnings?.length ? r.warnings[0] : ''].filter(Boolean);
        toast(bits.join('；'), r.failed.length > 0);
      });
    } catch (e) { toast(e.message, true); }
  }

  async function genRun(opts = {}) {
    if (busy) return;
    try {
      if (dirty) await persist();
      const p = await api(`/api/jobs/${job.id}/board/generate`, { method: 'POST', json: { action: 'plan', ...opts } });
      if (!p.calls) return toast(p.blocked?.length ? `没有可提交的：${p.blocked[0].shots.join('+')}（${p.blocked[0].blocked}）` : '没有付费生成的镜头', true);
      const lines = p.pending.map(c => `  ${c.shots.join('+')}：${c.provider} ${c.resolution} ${c.seconds}s ≈ ${yuan(c.cost)}`).join('\n');
      if (!confirm(`将向 MiniMax 提交 ${p.calls} 次视频生成，共 ${yuan(p.total)}（按量扣费，提交后不能撤销）：\n${lines}\n\n继续吗？`)) return;
      run('gen', async () => {
        const r = await api(`/api/jobs/${job.id}/board/generate`, { method: 'POST', json: { action: 'submit', confirm: true, expect: { calls: p.calls, total: p.total }, ...opts } });
        if (r.failed?.length) toast(`已提交 ${r.submitted.length} 次（${yuan(r.spent)}），${r.failed.length} 次失败：${r.failed[0].error}`, true);
        else toast(`已提交 ${r.submitted.length} 次（${yuan(r.spent)}），后台生成中，完成后自动出现`);
      });
    } catch (e) { toast(e.message, true); }
  }

  function qcRun() {
    run('qc', async () => {
      if (dirty) await persist();
      const r = await api(`/api/jobs/${job.id}/board/qc`, { method: 'POST', json: { again: true } });
      lastPlan = r.plan;
      const skipped = r.skipped.length ? `，${r.skipped.length} 镜没有可检查的视频片段` : '';
      toast(`已检查 ${r.checked.length} 镜${skipped}`);
    });
  }

  function exportRun() {
    const raw = prompt('导出成 N 个批量剪辑变体（1–20）。导出只写一个新目录，不会改动任何已有项目，也不产生生成费用。', '6');
    if (raw === null) return;
    const variants = Number(raw);
    if (!Number.isInteger(variants) || variants < 1 || variants > 20) return toast('变体数量需要是 1–20 的整数', true);
    run('export', async () => {
      if (dirty) await persist();
      lastExport = await api(`/api/jobs/${job.id}/board/export`, { method: 'POST', json: { variants } });
      toast(`已导出 ${lastExport.clips} 个镜头`);
    });
  }

  function generate(ids, again) {
    const n = ids ? ids.length : pendingStills().length;
    if (!n) return;
    if (!confirm(`将用 MiniMax image-01 生成 ${n} 张分镜图，逐张计费（每张约几分钱）。继续吗？`)) return;
    run('stills', async () => {
      if (dirty) await persist();
      const r = await api(`/api/jobs/${job.id}/board/stills`, { method: 'POST', json: { confirm: true, count: n, ids, again } });
      if (r.failed?.length) toast(`${r.generated.length} 张完成，${r.failed.length} 张失败：${r.failed[0].error}`, true);
      else toast(`已生成 ${r.generated.length} 张分镜图`);
    });
  }

  const inFlight = () => (board?.shots || []).some(s => ['submitting', 'submitted'].includes(s.generate?.task?.state));
  const timer = setInterval(() => {
    if (!root.isConnected) return clearInterval(timer);
    if (!busy && !dirty && inFlight()) load();
  }, 15_000);
  await load();
}
