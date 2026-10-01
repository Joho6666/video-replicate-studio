// Storyboard board: one card per shot (picture, line, prompt, source, cost, approval) plus the free
// animatic. Used as a tab on replication jobs and as the whole page of script jobs.
// ctx = { api, toast, esc, file, tc, reload }

const KIND_LABEL = { still: '分镜图', generate: '付费生成', reuse: '复用素材', client: '客户提供' };
const EDITABLE_KINDS = ['still', 'generate', 'client']; // "reuse" needs a file path and is shown read-only
const yuan = n => `¥${(Number(n) || 0).toFixed(2)}`;

export async function mountBoard(root, job, ctx) {
  const { api, toast, esc, file, tc } = ctx;
  let board = null, dirty = false, busy = '';
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
          <button class="btn ink sm" id="bdSave" ${busy || !dirty ? 'disabled' : ''}>${dirty ? '保存修改' : '已保存'}</button>
        </div>
      </div>
      ${est.unknown?.length ? `<div class="bd-warn">有 ${est.unknown.length} 个镜头的单价未知（${est.unknown.join('、')}），不会计入预估，也不能提交。</div>` : ''}
      ${board.overBudget ? `<div class="bd-warn">付费预估 ${yuan(est.total)} 已超过预算上限，提交前请调整。</div>` : ''}
      ${board.render ? `<div class="bd-anim"><video controls playsinline preload="metadata" src="${file(job.id, board.render.file)}?v=${encodeURIComponent(board.render.at || '')}"></video>
        <p>动态分镜 · ${board.render.segments} 镜${board.render.placeholders ? ` · ${board.render.placeholders} 镜还是占位卡` : ''}${board.render.voice ? ' · 含配音' : ' · 无配音（还没有 voice/full.wav）'}</p></div>` : ''}
      <div class="bd-grid">${board.shots.map(card).join('')}</div>
      <p class="foot-note">付费视频生成仍在「H3 出片」页确认并提交；这里只负责镜头、分镜图和免费动态分镜。费用由服务端重新计算，页面上的数字只是展示。</p>`;
    bind();
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
        ${s.visual ? `<p class="bd-visual">${esc(s.visual)}</p>` : ''}
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
    root.querySelector('#bdAnim').onclick = () => run('anim', async () => { if (dirty) await persist(); await api(`/api/jobs/${job.id}/board/animatic`, { method: 'POST', json: {} }); });
  }

  const persist = () => api(`/api/jobs/${job.id}/board`, { method: 'PUT', json: board });
  const save = () => run('save', async () => { await persist(); toast('镜头表已保存'); });

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

  await load();
}
