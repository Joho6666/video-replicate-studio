// 复刻 Studio — zero-dependency client
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

const state = { health: null, jobs: [], job: null, tab: 'overview', poll: null, sig: {}, exportPath: null };

/* ───────── utils ───────── */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tc = s => { s = Number(s) || 0; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const big = n => n == null ? '—' : n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : n >= 1e4 ? `${(n / 1e4).toFixed(1)}w` : String(n);
const file = (id, rel) => rel ? `/files/${encodeURIComponent(id)}/${rel.split('/').map(encodeURIComponent).join('/')}` : '';
const refs = html => html.replace(/@(视频|图片|音频)(\d)/g, '<span class="hl">@$1$2</span>');
const STAGES = [['fetch', '抓取原片'], ['probe', '解析媒体'], ['shots', '镜头切分'], ['director', '导演拆解']];
const PLATFORMS = [['douyin', '抖音', 'MediaCrawler'], ['bilibili', 'B站', 'MediaCrawler'], ['tiktok', 'TikTok', 'TikHub'], ['instagram', 'Instagram', 'TikHub']];

async function api(path, opts = {}) {
  const init = { ...opts, headers: { ...(opts.headers || {}) } };
  if (init.method && init.method !== 'GET') init.headers['X-Studio'] = '1';
  if (init.json !== undefined) { init.body = JSON.stringify(init.json); init.headers['Content-Type'] = 'application/json'; delete init.json; }
  const res = await fetch(path, init);
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

let toastTimer;
function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg; el.className = `toast show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = 'toast'; }, 2400);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('已复制到剪贴板'); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); toast('已复制到剪贴板'); }
}

function detect(text) {
  const m = String(text).match(/https?:\/\/[^\s<>"'，。！]+/i);
  if (!m) return null;
  try {
    const h = new URL(m[0]).hostname;
    const is = d => h === d || h.endsWith(`.${d}`);
    if (is('douyin.com') || is('iesdouyin.com')) return 'douyin';
    if (is('bilibili.com') || is('b23.tv')) return 'bilibili';
    if (is('tiktok.com')) return 'tiktok';
    if (is('instagram.com')) return 'instagram';
  } catch { /* ignore */ }
  return null;
}

/* ───────── chrome ───────── */
function renderEngines() {
  const h = state.health;
  $('#engines').innerHTML = h ? Object.values(h.engines).map(e => `<span class="engine ${e.ok ? 'ok' : ''}" title="${esc(e.note)}"><b></b>${esc(e.label)}</span>`).join('') : '';
}
function crumbs(parts) {
  $('#crumbs').innerHTML = parts.map((p, i) => i < parts.length - 1 ? `<a href="${p[1]}">${esc(p[0])}</a><em>／</em>` : `<span>${esc(p[0])}</span>`).join('');
}

/* ───────── home ───────── */
function renderHome() {
  crumbs([['片库', '#/']]);
  app.innerHTML = `
  <section class="hero">
    <div>
      <div class="eyebrow rise" style="--i:0">Viral Replication Studio</div>
      <h1 class="rise" style="--i:1">把一条爆款，<br>拆成可复刻的<span class="accent">每一帧</span>。</h1>
      <p class="lede rise" style="--i:2">粘贴抖音、B站、TikTok 或 Instagram 链接。自动抓取原片、切分镜头、由 AI 导演拆解爆点，产出可以直接贴进 LibTV 的分段提示词与素材包。</p>
      <form class="slate rise" style="--i:3" id="slate">
        <div class="platforms" id="pfs">${PLATFORMS.map(([id, label, engine]) => `<span class="pf" data-pf="${id}">${label}<small>${engine}</small></span>`).join('')}</div>
        <div class="slate-row">
          <textarea id="link" rows="2" placeholder="粘贴分享链接或整段分享文案，例如：https://v.douyin.com/xxxx/"></textarea>
          <button class="btn primary big" type="submit" id="go">开始拆解 <span class="arrow">→</span></button>
        </div>
        <div class="brief" id="brief">
          <div class="field"><label>替换商品</label><input name="product" placeholder="例：米色轻暖连帽羽绒服"></div>
          <div class="field"><label>模特要求</label><input name="model" placeholder="例：25 岁亚洲女生，短发"></div>
          <div class="field wide"><label>商品卖点（唯一可信来源）</label><textarea name="notes" rows="2" placeholder="例：90% 白鸭绒、可机洗、三色可选"></textarea></div>
        </div>
        <div class="slate-foot">
          <span><button type="button" class="linkish" id="toggleBrief">＋ 填写替换商品与模特</button>　·　<button type="button" class="linkish" id="upload">上传本地视频</button></span>
          <span>长视频只拆前 ${state.health?.analyzeMaxSec ?? 60} 秒 · 每段 ≤15 秒</span>
        </div>
        <input type="file" id="uploadInput" accept="video/*" hidden>
      </form>
    </div>
    <aside class="process">
      ${[['01', '抓取原片', '无水印原片与点赞、评论、文案等数据'], ['02', '镜头切分', 'FFmpeg 识别硬切，长镜头按节拍细分'], ['03', '导演拆解', 'AI 看每个镜头的关键帧，拆出钩子与节奏'], ['04', 'LibTV 出片', '按 15 秒分段的提示词 + 参考片段素材包']]
        .map(([n, t, d], i) => `<div class="step rise" style="--i:${i + 3}"><span class="n">${n}</span><div><h4>${t}</h4><p>${d}</p></div></div>`).join('')}
    </aside>
  </section>
  <div class="section-head rise" style="--i:6"><h2>片库<small id="count"></small></h2></div>
  <div class="library" id="library"></div>`;

  const link = $('#link');
  const sync = () => { const p = detect(link.value); document.querySelectorAll('.pf').forEach(el => el.classList.toggle('on', el.dataset.pf === p)); };
  link.addEventListener('input', sync);
  link.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#slate').requestSubmit(); } });
  $('#toggleBrief').onclick = () => $('#brief').classList.toggle('open');
  $('#upload').onclick = () => $('#uploadInput').click();
  $('#uploadInput').onchange = e => e.target.files[0] && uploadVideo(e.target.files[0]);
  $('#slate').onsubmit = async e => {
    e.preventDefault();
    if (!link.value.trim()) return toast('先粘贴一条视频链接', true);
    const brief = Object.fromEntries([...$('#brief').querySelectorAll('input,textarea')].map(el => [el.name, el.value.trim()]));
    $('#go').disabled = true;
    try { const job = await api('/api/jobs', { method: 'POST', json: { text: link.value, brief } }); location.hash = `#/job/${job.id}`; }
    catch (err) { toast(err.message, true); $('#go').disabled = false; }
  };
  renderLibrary();
}

function renderLibrary() {
  const el = $('#library');
  if (!el) return;
  $('#count').textContent = state.jobs.length ? `${state.jobs.length} 条` : '';
  if (!state.jobs.length) { el.innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>片库还是空的</strong>粘贴第一条爆款链接，拆解结果会保存在这里。</div>`; return; }
  el.innerHTML = state.jobs.map((j, i) => `
    <a class="card rise" style="--i:${Math.min(i, 8) + 6}" href="#/job/${j.id}">
      <div class="thumb">
        <div class="sprockets top"></div>
        ${j.cover ? `<img src="${file(j.id, j.cover)}" alt="" loading="lazy">` : '<div class="skeleton" style="position:absolute;inset:0;border-radius:0"></div>'}
        <span class="badge">${esc(j.platformLabel || '')}</span>
        <span class="badge st ${j.running ? 'running' : j.status}">${j.running ? '拆解中' : j.status === 'done' ? '已完成' : j.status === 'failed' ? '未完成' : '排队'}</span>
        <div class="over">
          <h3>${esc((j.title || '未命名视频').split('\n')[0])}</h3>
          <div class="meta-line"><span>${j.duration ? tc(j.duration) : '--:--'}</span><span>${j.shots || 0} 镜</span>${j.hasPrompts ? '<span style="color:var(--amber-2)">提示词 ✓</span>' : ''}</div>
        </div>
        <div class="sprockets bottom"></div>
      </div>
    </a>`).join('');
}

function uploadVideo(f) {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/upload?name=${encodeURIComponent(f.name)}`);
  xhr.setRequestHeader('X-Studio', '1');
  xhr.upload.onprogress = e => e.lengthComputable && toast(`上传中 ${Math.round((e.loaded / e.total) * 100)}%`);
  xhr.onload = () => {
    if (xhr.status >= 300) return toast(JSON.parse(xhr.responseText || '{}').error || '上传失败', true);
    location.hash = `#/job/${JSON.parse(xhr.responseText).id}`;
  };
  xhr.onerror = () => toast('上传失败', true);
  xhr.send(f);
}

/* ───────── job ───────── */
function renderJobShell(id) {
  app.innerHTML = `
    <div id="jobHead" class="job-head"><div class="skeleton" style="height:90px;width:60%"></div></div>
    <div id="rail" class="rail"></div>
    <details class="console" id="console"><summary><span>运行日志</span><span id="logCount"></span></summary><div class="lines" id="lines"></div></details>
    <section class="strip-wrap" id="stripWrap"></section>
    <section class="workspace">
      <div class="player" id="player"><div class="skeleton" style="aspect-ratio:9/14"></div></div>
      <div>
        <div class="tabs" id="tabs"></div>
        <div id="tabBody"></div>
      </div>
    </section>`;
  state.sig = {};
  state.exportPath = null;
}

function renderJobHead(job) {
  const m = job.meta || {};
  const metrics = [['播放', m.metrics?.views], ['点赞', m.metrics?.likes], ['评论', m.metrics?.comments], ['分享', m.metrics?.shares]].filter(x => x[1] != null);
  crumbs([['片库', '#/'], [(m.title || '拆解中…').split('\n')[0].slice(0, 40), '']]);
  $('#jobHead').innerHTML = `
    <div>
      <div class="job-sub"><span class="chip amber">${esc(m.platformLabel || '')}</span>${m.author ? `<span>@${esc(m.author)}</span>` : ''}${m.engine ? `<span class="chip">${esc(m.engine)}</span>` : ''}${job.source.url ? `<a class="linkish" href="${esc(job.source.url)}" target="_blank" rel="noreferrer">原链接 ↗</a>` : ''}</div>
      <h1>${esc((m.title || (job.status === 'failed' ? '抓取未完成' : '正在抓取原片…')).split('\n')[0])}</h1>
    </div>
    <div class="metrics">${metrics.map(([k, v]) => `<div class="metric"><b>${big(v)}</b><span>${k}</span></div>`).join('')}
      <button class="btn ghost sm" id="del" title="删除这条拆解" style="align-self:center">删除</button></div>`;
  $('#del').onclick = async () => {
    if (!confirm('删除这条拆解？原片、关键帧和提示词都会删除。')) return;
    try { await api(`/api/jobs/${job.id}`, { method: 'DELETE' }); location.hash = '#/'; } catch (e) { toast(e.message, true); }
  };
}

function renderRail(job) {
  $('#rail').innerHTML = STAGES.map(([id, label], i) => {
    const s = job.stages[id] || {};
    const note = s.status === 'failed' ? s.error : s.status === 'running' ? '进行中…' : s.status === 'done' ? '完成' : '等待';
    return `<div class="stage ${s.status || 'pending'}"><span class="dot">${s.status === 'done' ? '✓' : s.status === 'failed' ? '!' : i + 1}</span>
      <div style="min-width:0"><h5>${label}</h5><p title="${esc(note)}">${esc(note)}</p>
      ${s.status === 'failed' && !job.running ? `<button class="btn sm" data-rerun="${id}" style="margin-top:8px">重试这一步</button>` : ''}</div></div>`;
  }).join('');
  $('#rail').querySelectorAll('[data-rerun]').forEach(b => { b.onclick = () => rerun(b.dataset.rerun); });
  const lines = $('#lines');
  const stick = lines.scrollTop + lines.clientHeight >= lines.scrollHeight - 8;
  lines.innerHTML = job.logs.map(l => `<div class="${l.level}"><span>${new Date(l.at).toLocaleTimeString('zh-CN', { hour12: false })}</span>${esc(l.message)}</div>`).join('');
  $('#logCount').textContent = `${job.logs.length} 条`;
  if (stick) lines.scrollTop = lines.scrollHeight;
  if (job.running && !state.sig.consoleOpened) { $('#console').open = true; state.sig.consoleOpened = true; }
  if (!job.running && state.sig.consoleOpened && !state.sig.consoleClosed) { $('#console').open = false; state.sig.consoleClosed = true; }
}

function renderStrip(job) {
  const wrap = $('#stripWrap');
  if (!job.shots.length) { wrap.innerHTML = ''; return; }
  const total = job.media.analyzedSec || job.shots[job.shots.length - 1].end;
  const segs = job.director?.segments || [];
  wrap.innerHTML = `
    <div class="strip-head"><h3>镜头胶片</h3><span>${job.shots.length} 镜 · 分析 ${tc(total)}${job.media.duration > total ? ` / 全片 ${tc(job.media.duration)}` : ''}</span></div>
    ${segs.length ? `<div class="segbar">${segs.map(s => `<div class="seg" style="left:${(s.start / total) * 100}%;width:calc(${(s.duration / total) * 100}% - 2px)">第${s.index}段 · ${s.duration}s</div>`).join('')}</div>` : ''}
    <div class="strip" id="strip">
      ${job.shots.map(s => `<div class="frame rise" style="--w:${Math.max(s.duration, 0.3)};--i:${s.index}" data-t="${s.start}" data-i="${s.index}">
        <img src="${file(job.id, s.keyframe)}" alt="" loading="lazy"><span class="tag">${String(s.index).padStart(2, '0')}</span><span class="tc">${tc(s.start)}</span></div>`).join('')}
      <div class="playhead" id="playhead" style="left:0"></div>
    </div>`;
  wrap.querySelectorAll('.frame').forEach(f => { f.onclick = () => seek(Number(f.dataset.t)); });
}

function renderPlayer(job) {
  const el = $('#player');
  if (!job.media.video || job.stages.fetch?.status !== 'done') {
    el.innerHTML = `<div class="waiting" style="border:0"><div class="reel"></div><strong>正在取片</strong>首次抓取抖音 / B站 会弹出浏览器，请扫码登录</div>`;
    state.sig.video = null;
    return;
  }
  const src = file(job.id, job.media.video);
  if (state.sig.video !== src) {
    el.innerHTML = `<video id="video" src="${src}" controls playsinline preload="metadata" ${job.media.cover ? `poster="${file(job.id, job.media.cover)}"` : ''}></video>
      <div class="player-meta"><span id="now">0:00.0</span><span>当前镜头 <b id="curShot">—</b></span></div>
      <div class="tech" id="tech"></div>`;
    state.sig.video = src;
    $('#video').addEventListener('timeupdate', onTime);
  }
  const m = job.media;
  $('#tech').innerHTML = m.width ? [['分辨率', `${m.width}×${m.height}`], ['帧率', `${m.fps}`], ['时长', tc(m.duration)], ['视频', m.videoCodec], ['音频', m.audioCodec || '无'], ['体积', `${(m.size / 1048576).toFixed(1)}MB`]]
    .map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('') : '';
}

function seek(t) {
  const v = $('#video');
  if (!v) return;
  v.currentTime = t + 0.02;
  v.play().catch(() => {});
}

function onTime() {
  const job = state.job, v = $('#video');
  if (!job || !v) return;
  const t = v.currentTime;
  $('#now').textContent = tc(t);
  const total = job.media.analyzedSec || 1;
  const ph = $('#playhead');
  if (ph) ph.style.left = `${Math.min(t / total, 1) * 100}%`;
  const shot = job.shots.find(s => t >= s.start && t < s.end);
  const idx = shot?.index;
  $('#curShot').textContent = idx ? `#${String(idx).padStart(2, '0')}` : '—';
  if (state.sig.active === idx) return;
  state.sig.active = idx;
  document.querySelectorAll('.frame').forEach(f => f.classList.toggle('active', Number(f.dataset.i) === idx));
  document.querySelectorAll('.shot').forEach(s => s.classList.toggle('active', Number(s.dataset.i) === idx));
}

/* tabs */
const TABS = [['overview', '爆款拆解'], ['shots', '分镜提示词'], ['libtv', 'LibTV 出片'], ['assets', '素材与导出']];

function renderTabs(job) {
  const counts = { shots: job.shots.length || '', libtv: job.director?.segments.length ? `${job.director.segments.length} 段` : '' };
  $('#tabs').innerHTML = TABS.map(([id, label]) => `<button class="tab ${state.tab === id ? 'on' : ''}" data-tab="${id}">${label}${counts[id] ? `<small>${counts[id]}</small>` : ''}</button>`).join('');
  $('#tabs').querySelectorAll('.tab').forEach(b => { b.onclick = () => { state.tab = b.dataset.tab; state.sig.tab = null; renderTabs(job); renderTabBody(job); }; });
}

function waiting(job, what) {
  const failed = Object.values(job.stages).some(s => s.status === 'failed');
  if (failed && !job.running) return `<div class="waiting"><strong>流程在中途停下了</strong>看上方红色步骤的原因，修好后点「重试这一步」。</div>`;
  return `<div class="waiting"><div class="reel"></div><strong>${what}</strong>AI 导演正在逐帧看片，通常需要 30–90 秒</div>`;
}

function renderTabBody(job) {
  const sig = `${state.tab}|${job.director?.generatedAt || ''}|${job.shots.length}|${job.running}|${job.assets.map(a => a.file).join()}|${state.exportPath || ''}`;
  if (state.sig.tab === sig) return;
  state.sig.tab = sig;
  const body = $('#tabBody');
  const d = job.director;
  if (state.tab === 'overview') {
    if (!d) return void (body.innerHTML = waiting(job, '正在拆解爆点'));
    const a = d.analysis;
    body.innerHTML = `<div class="grid2">
      <div class="panel hookpanel rise"><h4>前三秒钩子</h4><p>${esc(a.hook)}</p></div>
      <div class="panel rise" style="--i:1"><h4>叙事结构</h4><p>${esc(a.structure)}</p></div>
      <div class="panel rise" style="--i:2"><h4>剪辑节奏</h4><p>${esc(a.rhythm)}</p></div>
      <div class="panel rise" style="--i:3"><h4>画面风格</h4><p>${esc(a.visual_style)}</p></div>
      <div class="panel rise" style="--i:4"><h4>声音 / 口播</h4><p>${esc(a.audio_guess || '不确定')}</p></div>
      <div class="whys">${(a.why_it_works || []).map((w, i) => `<div class="why rise" style="--i:${i + 5}">${esc(w)}</div>`).join('')}</div>
    </div>
    <p class="path" style="margin-top:18px">由 ${esc(d.model)} 生成 · ${new Date(d.generatedAt).toLocaleString('zh-CN', { hour12: false })}${d.usage ? ` · ${d.usage.prompt_tokens}+${d.usage.completion_tokens} tokens` : ''}</p>`;
  }
  if (state.tab === 'shots') {
    if (!job.shots.length) return void (body.innerHTML = waiting(job, '正在切分镜头'));
    body.innerHTML = `<div class="shotlist">${job.shots.map((s, i) => {
      const x = d?.shots?.[i];
      return `<article class="shot rise" style="--i:${Math.min(i, 10)}" data-i="${s.index}">
        <div class="kf" data-t="${s.start}"><img src="${file(job.id, s.keyframe)}" alt="" loading="lazy"><span class="num">${String(s.index).padStart(2, '0')}</span><span class="play">▶</span></div>
        <div style="min-width:0">
          <div class="shot-top"><span class="tcode">${tc(s.start)} → ${tc(s.end)} · ${s.duration}s</span>
            <div class="chips">${x ? [x.shot_size, x.camera, x.transition].filter(Boolean).map(c => `<span class="chip">${esc(c)}</span>`).join('') : `<span class="chip">${s.cut === 'hard' ? '硬切' : '节拍'}</span>`}</div></div>
          ${x ? `<p class="desc"><b>${esc(x.subject)}</b> · ${esc(x.action)}　<span style="color:var(--muted)">${esc(x.scene)} · ${esc(x.lighting)}</span>${x.on_screen_text && x.on_screen_text !== '无' ? `<br>画面字：「${esc(x.on_screen_text)}」` : ''}</p>
          <div class="prompt">${refs(esc(x.prompt))}<button class="btn sm copy" data-copy="${esc(x.prompt)}">复制</button></div>
          ${x.replace_note ? `<div class="note">${esc(x.replace_note)}</div>` : ''}` : '<p class="desc" style="color:var(--muted)">等待导演拆解…</p>'}
        </div></article>`;
    }).join('')}</div>`;
    body.querySelectorAll('.kf').forEach(k => { k.onclick = () => seek(Number(k.dataset.t)); });
  }
  if (state.tab === 'libtv') {
    if (!d) return void (body.innerHTML = waiting(job, '正在写 LibTV 提示词'));
    const model = job.assets.find(a => a.role === 'model'), product = job.assets.find(a => a.role === 'product');
    const slot = (ref, label, asset) => `<div class="slot"><span class="ref">${ref}</span>${asset ? `<img src="${file(job.id, asset.file)}" alt="">` : '<span class="missing"></span>'}<span class="what"><b>${label}</b><br>${asset ? '已上传' : '在「素材与导出」上传'}</span></div>`;
    body.innerHTML = `
      <div class="actions" style="margin:0 0 16px"><button class="btn primary" id="copyAll">复制全部提示词</button><a class="btn" href="/api/jobs/${job.id}/libtv.md">下载 .md</a><button class="btn" id="goExport">导出素材包 →</button></div>
      ${d.segments.map(s => `<article class="segment rise" style="--i:${s.index}">
        <div class="segment-head"><h3>第 ${s.index} 段<span>${tc(s.start)} – ${tc(s.end)} · ${s.duration}s · 镜头 ${s.shots.join('、')}</span></h3><button class="btn sm" data-seek="${s.start}">预览原片 ▶</button></div>
        <div class="mapping">
          <div class="slot"><span class="ref">@视频1</span><img src="${file(job.id, job.shots.find(x => x.index === s.shots[0])?.keyframe)}" alt=""><span class="what"><b>参考片段</b><br>段${s.index}_${s.duration}s.mp4</span></div>
          ${slot('@图片1', '替换模特', model)}${slot('@图片2', '替换商品', product)}
        </div>
        <div class="body"><div class="prompt">${refs(esc(s.prompt))}<button class="btn sm primary copy" data-copy="${esc(s.prompt)}">复制</button></div></div>
      </article>`).join('')}
      ${d.negative ? `<div class="panel"><h4>负面约束</h4><div class="prompt" style="margin-top:8px">${esc(d.negative)}<button class="btn sm copy" data-copy="${esc(d.negative)}">复制</button></div></div>` : ''}`;
    body.querySelectorAll('[data-seek]').forEach(b => { b.onclick = () => seek(Number(b.dataset.seek)); });
    $('#copyAll').onclick = () => copy(d.segments.map(s => `【第${s.index}段 ${tc(s.start)}-${tc(s.end)}】\n${s.prompt}`).join('\n\n') + (d.negative ? `\n\n【负面约束】\n${d.negative}` : ''));
    $('#goExport').onclick = () => { state.tab = 'assets'; state.sig.tab = null; renderTabs(job); renderTabBody(job); };
  }
  if (state.tab === 'assets') {
    const b = job.brief || {};
    const drop = (role, ref, label) => {
      const a = job.assets.find(x => x.role === role);
      return `<label class="drop ${a ? 'has' : ''}" data-role="${role}">
        ${a ? `<img src="${file(job.id, a.file)}" alt=""><button type="button" class="btn sm x" data-remove="${role}">移除</button>` : ''}
        <span class="lbl"><b>${ref}</b>${label}${a ? '' : '<br>拖入或点击上传 JPG / PNG / WebP'}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" hidden></label>`;
    };
    body.innerHTML = `
      <div class="assets">${drop('model', '@图片1', '替换模特')}${drop('product', '@图片2', '替换商品')}</div>
      <form class="panel" id="briefForm">
        <h4>替换说明</h4>
        <div class="grid2" style="margin-top:10px">
          <div class="field"><label>替换商品</label><input name="product" value="${esc(b.product)}" placeholder="例：米色轻暖连帽羽绒服"></div>
          <div class="field"><label>模特要求</label><input name="model" value="${esc(b.model)}" placeholder="例：25 岁亚洲女生"></div>
          <div class="field wide"><label>商品卖点（唯一可信来源）</label><textarea name="notes" rows="3" placeholder="写清真实卖点，AI 不会编造没写的功效">${esc(b.notes)}</textarea></div>
          <div class="field wide"><label>风格补充</label><input name="style" value="${esc(b.style)}" placeholder="例：更明亮的室内自然光、节奏更快"></div>
        </div>
        <div class="actions"><button class="btn primary" ${job.running || !job.shots.length ? 'disabled' : ''}>保存并重新生成提示词</button><span class="path">只花 DeepSeek token，不产生视频费用</span></div>
      </form>
      <div class="panel" style="margin-top:14px">
        <h4>导出素材包</h4>
        <p>按段切好的参考片段（@视频1）、替换素材、LibTV 提示词和分镜表，打包到一个文件夹，直接拖进 LibTV。</p>
        <div class="actions"><button class="btn primary" id="export" ${d ? '' : 'disabled'}>生成素材包</button><button class="btn" id="open">打开文件夹</button></div>
        ${state.exportPath ? `<p class="path" style="margin-top:10px">已导出：${esc(state.exportPath)}</p>` : ''}
      </div>`;
    body.querySelectorAll('.drop').forEach(zone => {
      const input = zone.querySelector('input');
      const role = zone.dataset.role;
      input.onchange = () => input.files[0] && uploadAsset(job, role, input.files[0]);
      zone.ondragover = e => { e.preventDefault(); zone.classList.add('drag'); };
      zone.ondragleave = () => zone.classList.remove('drag');
      zone.ondrop = e => { e.preventDefault(); zone.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) uploadAsset(job, role, f); };
    });
    body.querySelectorAll('[data-remove]').forEach(btn => { btn.onclick = async e => { e.preventDefault(); e.stopPropagation(); job.assets = await api(`/api/jobs/${job.id}/assets/${btn.dataset.remove}`, { method: 'DELETE' }); state.sig.tab = null; renderTabBody(job); }; });
    $('#briefForm').onsubmit = async e => {
      e.preventDefault();
      const brief = Object.fromEntries(new FormData(e.target));
      try { await api(`/api/jobs/${job.id}/brief`, { method: 'POST', json: brief }); await rerun('director'); state.tab = 'overview'; toast('已提交，AI 导演重新拆解中'); }
      catch (err) { toast(err.message, true); }
    };
    $('#export').onclick = async ev => {
      ev.target.disabled = true; ev.target.textContent = '切片打包中…';
      try { const r = await api(`/api/jobs/${job.id}/export`, { method: 'POST' }); state.exportPath = r.path; toast('素材包已生成'); state.sig.tab = null; renderTabBody(job); }
      catch (err) { toast(err.message, true); ev.target.disabled = false; ev.target.textContent = '生成素材包'; }
    };
    $('#open').onclick = () => api(`/api/jobs/${job.id}/open`, { method: 'POST' }).catch(err => toast(err.message, true));
  }
  body.querySelectorAll('[data-copy]').forEach(btn => { btn.onclick = e => { e.stopPropagation(); copy(btn.dataset.copy); }; });
}

async function uploadAsset(job, role, f) {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast('只支持 JPG / PNG / WebP', true);
  try {
    job.assets = await api(`/api/jobs/${job.id}/assets?role=${role}`, { method: 'POST', body: f, headers: { 'Content-Type': f.type } });
    toast(role === 'model' ? '模特图已上传（@图片1）' : '商品图已上传（@图片2）');
    state.sig.tab = null; renderTabBody(job);
  } catch (err) { toast(err.message, true); }
}

async function rerun(from) {
  try { await api(`/api/jobs/${state.job.id}/rerun`, { method: 'POST', json: { from } }); await refreshJob(state.job.id); }
  catch (err) { toast(err.message, true); }
}

async function refreshJob(id) {
  const job = await api(`/api/jobs/${id}`);
  if (!location.hash.includes(id)) return;
  const prev = state.job;
  state.job = job;
  renderJobHead(job);
  renderRail(job);
  if (!prev || prev.shots.length !== job.shots.length || prev.director?.generatedAt !== job.director?.generatedAt) renderStrip(job);
  renderPlayer(job);
  renderTabs(job);
  renderTabBody(job);
  clearTimeout(state.poll);
  if (job.running) state.poll = setTimeout(() => refreshJob(id).catch(() => {}), 1500);
}

/* ───────── router ───────── */
async function route() {
  clearTimeout(state.poll);
  const m = location.hash.match(/^#\/job\/([\w-]+)/);
  window.scrollTo({ top: 0 });
  if (m) {
    state.job = null; state.tab = 'overview';
    renderJobShell(m[1]);
    try { await refreshJob(m[1]); } catch (err) { app.innerHTML = `<div class="empty" style="margin-top:60px"><strong>找不到这条拆解</strong>${esc(err.message)}<br><br><a class="btn" href="#/">回到片库</a></div>`; }
  } else {
    state.job = null;
    renderHome();
    loadJobs();
  }
}

async function loadJobs() {
  try { state.jobs = await api('/api/jobs'); } catch { state.jobs = []; }
  renderLibrary();
  clearTimeout(state.poll);
  if (state.jobs.some(j => j.running) && !location.hash.startsWith('#/job')) state.poll = setTimeout(loadJobs, 2500);
}

window.addEventListener('hashchange', route);
api('/api/health').then(h => { state.health = h; renderEngines(); if (!location.hash.startsWith('#/job')) { const n = document.querySelector('.slate-foot span:last-child'); if (n) n.textContent = `长视频只拆前 ${h.analyzeMaxSec} 秒 · 每段 ≤15 秒`; } }).catch(() => {});
route();
