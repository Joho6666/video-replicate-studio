// "脚本出片" entry page: paste a script (timed or not), optionally add the presenter and product
// photos, and the studio creates a script job and splits it into a board.
export function renderScriptNew(app, ctx) {
  const { api, toast, esc } = ctx;
  app.classList.remove('full');
  app.innerHTML = `
    <section class="script-new">
      <p class="eyebrow">SCRIPT → STORYBOARD</p>
      <h1>用脚本出片</h1>
      <p class="lead">粘贴口播脚本（带时间码或不带都行）。AI 把每句话设计成一个镜头，系统决定哪些值得付费生成；你在分镜板上审完，再动手花钱。</p>
      <form id="scriptForm" class="sn-form">
        <div class="field wide"><label>标题（可空）</label><input name="title" placeholder="例：Selerb 口播广告 v1"></div>
        <div class="field wide"><label>脚本</label><textarea name="script" rows="12" placeholder="可带时间码，例如：&#10;[00:00-00:06.6] At 48, I sadly realized it isn't 2007 anymore…&#10;[00:06.6-00:14] When I saw the scale didn't move…&#10;&#10;没有时间码也可以，一行一句，按语速自动排时间。"></textarea></div>
        <div class="field"><label>商品名称</label><input name="product" placeholder="例：Selerb METABURN"></div>
        <div class="field"><label>商品说明（AI 只会使用这里写的）</label><input name="notes" placeholder="例：60 粒胶囊，膳食补充剂"></div>
        <div class="field"><label>主播照片（可选，用于保持同一个人）</label><input type="file" name="model" accept="image/jpeg,image/png,image/webp"></div>
        <div class="field"><label>商品图（可选，产品镜头会用真实商品图）</label><input type="file" name="productImg" accept="image/jpeg,image/png,image/webp"></div>
        <div class="sn-actions"><button class="btn ink" id="snGo" type="submit">创建并拆成镜头</button><span id="snStatus" class="muted"></span></div>
      </form>
    </section>`;
  const form = app.querySelector('#scriptForm'), status = app.querySelector('#snStatus'), go = app.querySelector('#snGo');
  const upload = (id, role, file) => api(`/api/jobs/${id}/assets?role=${role}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  form.onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(form);
    const script = String(f.get('script') || '').trim();
    if (!script) return toast('请先粘贴脚本', true);
    go.disabled = true;
    try {
      status.textContent = '创建任务…';
      const job = await api('/api/jobs', { method: 'POST', json: { script, title: String(f.get('title') || ''), brief: { product: String(f.get('product') || ''), notes: String(f.get('notes') || '') } } });
      for (const [name, role] of [['model', 'model'], ['productImg', 'product']]) {
        const file = f.get(name);
        if (file && file.size) { status.textContent = '上传图片…'; await upload(job.id, role, file); }
      }
      status.textContent = 'AI 正在拆镜头（20–60 秒）…';
      await api(`/api/jobs/${job.id}/board/split`, { method: 'POST', json: {} });
      location.hash = `#/job/${job.id}`;
    } catch (err) { toast(err.message, true); status.textContent = ''; go.disabled = false; }
  };
}
