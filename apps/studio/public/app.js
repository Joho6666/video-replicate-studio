// 复刻 Studio — zero-dependency client
import { darkScene, lightScene } from './scenes.js';
import { countUp, mount, moveIndicator, refresh, splitChars, transition } from './fx.js';
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

const state = {
  health: null, jobs: [], job: null, tab: 'overview', poll: null, sig: {}, exportPath: null,
  pending: { model: [], product: [], style: [] }, filter: 'all', refStyle: localStorage.getItem('studio-ref') || 'en', copyTone: 'seed', copyTarget: 'douyin', copyBusy: false,
};

/* ───────── utils ───────── */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tc = s => { s = Number(s) || 0; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const big = n => n == null ? '—' : n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : n >= 1e4 ? `${(n / 1e4).toFixed(1)}w` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
const file = (id, rel) => rel ? `/files/${encodeURIComponent(id)}/${rel.split('/').map(encodeURIComponent).join('/')}` : '';
const icon = d => `<svg viewBox="0 0 24 24" class="ic"><path d="${d}"/></svg>`;
const I = {
  arrow: 'M5 12h14M13 6l6 6-6 6', copy: 'M9 9h10v10H9z M5 15V5h10', heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  film: 'M4 5h16v14H4z M8 5v14 M16 5v14 M4 9h4 M4 15h4 M16 9h4 M16 15h4', play: 'M8 5l11 7-11 7z', down: 'M12 4v12M6 11l6 6 6-6M5 20h14',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', upload: 'M12 16V4M6 9l6-6 6 6M5 20h14', spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
};
const PLATFORMS = { douyin: ['抖音', '#ff3d7f'], bilibili: ['B站', '#27a7e7'], tiktok: ['TikTok', '#1db954'], instagram: ['Instagram', '#f08c1a'], local: ['本地', '#7a5cff'] };
const STAGES = [['fetch', '抓取原片'], ['probe', '解析媒体'], ['shots', '镜头切分'], ['director', '导演拆解']];
const REF_FMT = {
  en: (k, n) => `@${k}${n}`,
  zh: (k, n) => `@${k === 'Video' ? '视频' : '图片'}${n}`,
  plain: (k, n) => `${k} ${n}`,
};
const REF_LABEL = { en: '@Image1', zh: '@图片1', plain: 'Image 1' };
const REF_HL = { en: /@(?:Video|Image)\d+/g, zh: /@(?:视频|图片)\d+/g, plain: /\b(?:Video|Image) \d+/g };
const R = token => { const m = String(token).match(/^@(Video|Image)(\d+)$/); return m ? REF_FMT[state.refStyle](m[1], m[2]) : token; };
const refText = t => String(t || '').replace(/@(?:Video|Image)\d+/g, R);

/* image roles — mirrors lib/refs.mjs */
const ROLES = {
  model: { label: '模特', max: 1, hint: '1 张 · 正脸清晰、全身更好' },
  product: { label: '衣服 / 商品', max: 3, hint: '最多 3 张 · 正面、背面、细节' },
  style: { label: '效果参考', max: 3, hint: '最多 3 张 · 想要的色调、场景、氛围' },
};
function refMap(assets = []) {
  const of = r => assets.filter(a => a.role === r);
  const [model] = of('model'); const [main, ...angles] = of('product');
  const refs = [{ token: '@Image1', role: 'model', file: model?.file || null, label: '替换模特' }, { token: '@Image2', role: 'product', file: main?.file || null, label: '替换衣服 / 商品' }];
  let n = 3;
  for (const a of angles) refs.push({ token: `@Image${n++}`, role: 'product', file: a.file, label: '衣服 / 商品补充角度' });
  for (const a of of('style')) refs.push({ token: `@Image${n++}`, role: 'style', file: a.file, label: '效果参考' });
  return refs;
}

/** Escaped, ref-styled prompt with each "0.0-2.0s:" beat on its own hanging-indent line. */
function promptHtml(text) {
  const hl = s => s.replace(REF_HL[state.refStyle], m => `<span class="hl">${m}</span>`);
  return refText(text).split(/\r?\n/).filter(l => l.trim()).map(line => {
    const m = line.match(/^\s*(\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*s)\s*:\s*(.*)$/);
    return m ? `<span class="beat"><i>${esc(m[1].replace(/\s/g, ''))}</i>${hl(esc(m[2]))}</span>` : `<span>${hl(esc(line))}</span>`;
  }).join('\n');
}

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
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast('已复制到剪贴板');
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
  if (!h) return;
  const list = Object.values(h.engines);
  const el = $('#engines');
  el.innerHTML = list.map(e => `<i class="${e.ok ? 'ok' : ''}"></i>`).join('');
  el.title = list.map(e => `${e.ok ? '●' : '○'} ${e.label}：${e.note}`).join('\n');
  const k = $('#kpiEngines');
  if (k) k.textContent = `${list.filter(e => e.ok).length}/${list.length}`;
}
function renderRecent() {}
function crumbs(parts) {
  $('#crumbs').innerHTML = parts.map((p, i) => i < parts.length - 1 ? `<a href="${p[1]}">${esc(p[0])}</a><em style="color:var(--faint)">/</em>` : `<span>${esc(p[0])}</span>`).join('');
}
function setNav(id) { document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === id)); requestAnimationFrame(moveIndicator); }
$('#theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('studio-theme', next);
};

/* ───────── home ───────── */
const marquee = () => ['抖音', 'Bilibili', 'TikTok', 'Instagram', '镜头切分', 'Seedance 2.0', 'LibTV', '英文提示词', '参考片段', '替换模特', '替换商品']
  .map((w, i) => `<span class="${i % 3 === 1 ? 'dim' : ''}">${w}</span>`).join('');

function renderHome({ focus = false, toLibrary = false } = {}) {
  $('#crumbs').innerHTML = '';
  setNav(toLibrary ? 'library' : 'home');
  app.classList.add('full');
  app.innerHTML = `
  <section class="hero">
    <div class="scene">${lightScene()}${darkScene()}</div>
    <div class="hero-inner">
      <span class="meta-line rise"><i></i><span>v0.3</span><span>抖音 · B站 · TikTok · Instagram</span><span>约 60 秒出结果</span></span>
      <h1><span class="ln"><span style="--l:0">复刻爆款，</span></span><span class="ln"><span style="--l:1">从一条<em>链接</em>开始。</span></span></h1>
      <p class="sub rise" style="--i:4">贴一条链接，大约一分钟后拿到分镜、钩子拆解，<br>和能直接贴进 LibTV 的英文提示词。</p>
      <form class="composer rise" style="--i:5" id="slate">
        <div class="search">
          <input id="link" autocomplete="off" placeholder="粘贴抖音 / B站 / TikTok / Instagram 爆款链接…">
          <span class="detected" id="detected"></span>
          <button class="btn ink magnetic" data-strength=".18" id="go" type="submit">开始分析 ${icon(I.arrow)}</button>
        </div>
        <div class="brief open" id="brief">
          <div class="brief-head"><span class="idx">复刻设置</span><small>都可以留空，之后在「素材与导出」里再补</small></div>
          <div class="field wide"><label>想要的效果</label><textarea name="goal" rows="2" placeholder="例：保留原片的节奏和运镜，换成我的模特穿米色羽绒服，画面更明亮干净，适合冬季上新"></textarea></div>
          <div class="pickers wide" id="pickers"></div>
          <div class="field"><label>商品名称</label><input name="product" placeholder="例：米色轻暖连帽羽绒服"></div>
          <div class="field"><label>商品卖点（AI 只会使用这里写的）</label><input name="notes" placeholder="例：90% 白鸭绒、可机洗、三色可选"></div>
        </div>
      </form>
      <div class="hero-actions rise" style="--i:6">
        <button class="btn text" id="toggleBrief" type="button">收起复刻设置</button>
        <button class="btn text" id="upload" type="button">${icon(I.upload)}用本地视频</button>
        <a class="btn text" href="#/guide">使用流程 →</a>
      </div>
      <input type="file" id="uploadInput" accept="video/*" hidden>
    </div>
    <button class="scroll" id="scrollBtn" type="button">SCROLL ${icon(I.down)}</button>
  </section>

  <section class="marquee" aria-hidden="true"><div class="track">${marquee()}${marquee()}</div></section>

  <section class="section" id="about">
    <div class="statement">
      <div class="reveal"><span class="idx">(01)</span><br><span class="tag" style="margin-top:12px">关于复刻 Studio</span></div>
      <h2 class="lit">${splitChars('我们把<em>爆款视频</em>拆成一个个镜头，再编译成<em>可复刻</em>的英文提示词，让每一条都能<em>稳定出片</em>。')}</h2>
    </div>
    <div class="stats-row">
      <div class="kpi reveal" style="--i:0"><span class="idx">01</span><span>片库</span><b data-count="0" id="kpiJobs">0</b><small>条已拆解视频</small></div>
      <div class="kpi reveal" style="--i:1"><span class="idx">02</span><span>镜头</span><b data-count="0" id="kpiShots">0</b><small>个带关键帧的分镜</small></div>
      <div class="kpi reveal" style="--i:2"><span class="idx">03</span><span>每段时长</span><b>≤<span data-count="15" data-suffix="s">0s</span></b><small>对齐 Seedance 单次生成上限</small></div>
      <div class="kpi reveal" style="--i:3"><span class="idx">04</span><span>引擎在线</span><b id="kpiEngines">–</b><small>MediaCrawler · TikHub · DeepSeek · FFmpeg</small></div>
    </div>
  </section>

  <section class="section" id="lib">
    <div class="lib-head reveal"><div><span class="idx">(02)</span><h2>最近拆解</h2></div><div class="cats" id="cats"></div></div>
    <div class="masonry" id="library"></div>
  </section>`;

  const link = $('#link');
  const sync = () => {
    const p = detect(link.value);
    $('#detected').className = `detected${p ? ' on' : ''}`;
    $('#detected').innerHTML = p ? `<i style="width:8px;height:8px;border-radius:50%;background:${PLATFORMS[p][1]}"></i>${PLATFORMS[p][0]}` : (link.value.trim() ? '未识别' : '');
  };
  link.addEventListener('input', sync);
  if (focus) setTimeout(() => link.focus(), 400);
  $('#scrollBtn').onclick = () => $('#about').scrollIntoView({ behavior: 'smooth' });
  $('#toggleBrief').onclick = () => { const open = $('#brief').classList.toggle('open'); $('#toggleBrief').textContent = open ? '收起复刻设置' : '＋ 复刻设置（效果 / 模特 / 衣服 / 参考图）'; };
  renderPickers();
  $('#upload').onclick = () => $('#uploadInput').click();
  $('#uploadInput').onchange = e => e.target.files[0] && uploadVideo(e.target.files[0]);
  $('#slate').onsubmit = async e => {
    e.preventDefault();
    if (!link.value.trim()) return toast('先粘贴一条视频链接', true);
    $('#go').disabled = true;
    try {
      const job = await api('/api/jobs', { method: 'POST', json: { text: link.value, brief: readBrief(), defer: pendingCount() > 0 } });
      await sendPending(job.id);
      location.hash = `#/job/${job.id}`;
    } catch (err) { toast(err.message, true); $('#go').disabled = false; }
  };
  renderEngines();
  renderLibrary();
  if (toLibrary) setTimeout(() => $('#lib').scrollIntoView({ behavior: 'smooth' }), 200);
}

function renderLibrary() {
  const cats = $('#cats'), el = $('#library');
  if (!el) return;
  for (const [id, v] of [['#kpiJobs', state.jobs.length], ['#kpiShots', state.jobs.reduce((n, j) => n + (j.shots || 0), 0)]]) {
    const k = $(id);
    if (!k) continue;
    k.dataset.count = v;
    if (k.classList.contains('in')) countUp(k);
  }
  const counts = state.jobs.reduce((m, j) => ({ ...m, [j.platform]: (m[j.platform] || 0) + 1 }), {});
  cats.innerHTML = [['all', '全部', state.jobs.length], ...Object.entries(PLATFORMS).map(([id, [label]]) => [id, label, counts[id] || 0])]
    .filter(([id, , n]) => id === 'all' || n)
    .map(([id, label, n]) => `<button class="cat ${state.filter === id ? 'on' : ''}" data-p="${id}">${label}<small>${n}</small></button>`).join('');
  cats.querySelectorAll('.cat').forEach(b => { b.onclick = () => { state.filter = b.dataset.p; renderLibrary(); }; });
  const jobs = state.jobs.filter(j => state.filter === 'all' || j.platform === state.filter);
  if (!jobs.length) { el.style.columns = 'auto'; el.innerHTML = `<div class="empty"><strong>片库还是空的</strong>粘贴第一条爆款链接，拆解结果会保存在这里。</div>`; return; }
  el.style.columns = '';
  el.innerHTML = jobs.map((j, i) => {
    const [pl, color] = PLATFORMS[j.platform] || ['', '#999'];
    const st = j.running ? ['running', '拆解中'] : j.status === 'done' ? ['done', '已完成'] : ['failed', '未完成'];
    return `<a class="card tilt reveal" style="--i:${Math.min(i, 6)}" href="#/job/${j.id}">
      <div class="thumb">
        ${j.cover ? `<img src="${file(j.id, j.cover)}" alt="" loading="lazy">` : '<div class="ph skeleton" style="border-radius:0"></div>'}
        ${j.duration ? `<span class="pill">${icon(I.play)}${tc(j.duration).replace(/\.\d$/, '')}</span>` : ''}
        <span class="state ${st[0]}">${st[1]}</span>
        <div class="hover"><span>${j.shots || 0} 个镜头</span>${j.hasPrompts ? '<span>提示词 ✓</span>' : ''}</div>
      </div>
      <div class="card-body">
        <h3>${esc((j.title || '未命名视频').split('\n')[0])}</h3>
        <div class="card-meta"><span class="av" style="background:${color}22;color:${color}">${esc(pl.slice(0, 1))}</span><span class="who">${esc(j.author || pl)}</span>
          <span class="num">${j.likes != null ? `<span>${icon(I.heart)}${big(j.likes)}</span>` : ''}<span>${icon(I.film)}${j.shots || 0}</span></span></div>
      </div></a>`;
  }).join('');
  refresh(el);
}

function renderGuide() {
  crumbs([['首页', '#/'], ['使用流程', '']]);
  setNav('guide');
  app.innerHTML = `<section class="guide-hero"><span class="tag rise">从链接到成片</span><h1 class="rise" style="--i:1">四步走完<em>一条复刻</em></h1></section>
    <div class="guide">${[
      ['01', '粘贴链接', '抖音 / B站 由 MediaCrawler 抓取（首次扫码登录），TikTok / Instagram 走 TikHub。也可以直接上传本地视频。'],
      ['02', '自动切镜', 'FFmpeg 识别硬切，长镜头按 5 秒节拍细分，每个镜头取一张关键帧，按 15 秒切成生成段。'],
      ['03', 'AI 导演', '依据 AI Director Skill：中文讲清爆点，英文编译 Seedance 分段提示词，全程绑定 @Image1 模特与 @Image2 商品。'],
      ['04', 'LibTV 出片', '导出素材包：每段参考片段（@Video1）、替换素材、提示词与分镜表。逐段上传生成，再拼接成片。'],
    ].map(([n, t, d], i) => `<div class="gstep rise" style="--i:${i + 2}"><b>${n}</b><h4>${t}</h4><p>${d}</p></div>`).join('')}</div>
    <div class="actions" style="justify-content:center;margin-top:34px"><a class="btn ink" href="#/new">开始第一条 ${icon(I.arrow)}</a></div>`;
}

const readBrief = () => Object.fromEntries([...document.querySelectorAll('#brief input, #brief textarea')].map(el => [el.name, el.value.trim()]));
const pendingCount = () => Object.values(state.pending).reduce((n, l) => n + l.length, 0);

function renderPickers() {
  const box = $('#pickers');
  if (!box) return;
  const refs = refMap(Object.entries(state.pending).flatMap(([role, list]) => list.map((f, i) => ({ role, file: `${role}:${i}` }))));
  const tokenOf = key => refs.find(r => r.file === key)?.token;
  box.innerHTML = Object.entries(ROLES).map(([role, cfg]) => {
    const list = state.pending[role];
    return `<div class="picker" data-role="${role}">
      <div class="picker-head"><b>${cfg.label}</b><small>${cfg.hint}</small></div>
      <div class="thumbs">${list.map((f, i) => `<figure><img src="${f.url}" alt=""><figcaption>${R(tokenOf(`${role}:${i}`))}</figcaption><button type="button" data-rm="${role}:${i}" aria-label="移除">×</button></figure>`).join('')}
        ${list.length < cfg.max ? `<label class="add">${icon(I.upload)}<span>${list.length ? '再加' : '上传'}</span><input type="file" accept="image/jpeg,image/png,image/webp" ${cfg.max > 1 ? 'multiple' : ''} hidden></label>` : ''}</div>
    </div>`;
  }).join('');
  box.querySelectorAll('.picker').forEach(el => {
    const role = el.dataset.role;
    const add = files => {
      const ok = [...files].filter(f => /^image\/(jpeg|png|webp)$/.test(f.type));
      if (ok.length < files.length) toast('只支持 JPG / PNG / WebP', true);
      for (const f of ok) {
        if (ROLES[role].max === 1) { state.pending[role].forEach(x => URL.revokeObjectURL(x.url)); state.pending[role] = []; }
        if (state.pending[role].length >= ROLES[role].max) { toast(`${ROLES[role].label}最多 ${ROLES[role].max} 张`, true); break; }
        f.url = URL.createObjectURL(f);
        state.pending[role].push(f);
      }
      renderPickers();
    };
    el.querySelector('input')?.addEventListener('change', e => add(e.target.files));
    el.ondragover = e => { e.preventDefault(); el.classList.add('drag'); };
    el.ondragleave = () => el.classList.remove('drag');
    el.ondrop = e => { e.preventDefault(); el.classList.remove('drag'); add(e.dataTransfer.files); };
  });
  box.querySelectorAll('[data-rm]').forEach(b => { b.onclick = () => { const [role, i] = b.dataset.rm.split(':'); URL.revokeObjectURL(state.pending[role][i].url); state.pending[role].splice(Number(i), 1); renderPickers(); }; });
}

/** Uploads the composer's images to a deferred job, then starts it (always starts, even if an upload fails). */
async function sendPending(jobId) {
  const files = Object.entries(state.pending).flatMap(([role, list]) => list.map(f => [role, f]));
  if (!files.length) return;
  try {
    for (const [i, [role, f]] of files.entries()) {
      toast(`上传素材 ${i + 1}/${files.length}`);
      await api(`/api/jobs/${jobId}/assets?role=${role}`, { method: 'POST', body: f, headers: { 'Content-Type': f.type } });
    }
  } catch (err) { toast(`素材上传失败：${err.message}（可稍后在「素材与导出」补传）`, true); }
  finally {
    await api(`/api/jobs/${jobId}/start`, { method: 'POST' });
    Object.values(state.pending).flat().forEach(f => URL.revokeObjectURL(f.url));
    state.pending = { model: [], product: [], style: [] };
  }
}

function uploadVideo(f) {
  const xhr = new XMLHttpRequest();
  const defer = pendingCount() > 0;
  xhr.open('POST', `/api/upload?name=${encodeURIComponent(f.name)}&brief=${encodeURIComponent(JSON.stringify(readBrief()))}${defer ? '&defer=1' : ''}`);
  xhr.setRequestHeader('X-Studio', '1');
  xhr.upload.onprogress = e => e.lengthComputable && toast(`上传中 ${Math.round((e.loaded / e.total) * 100)}%`);
  xhr.onload = () => {
    if (xhr.status >= 300) return toast(JSON.parse(xhr.responseText || '{}').error || '上传失败', true);
    const id = JSON.parse(xhr.responseText).id;
    (defer ? sendPending(id) : Promise.resolve()).finally(() => { location.hash = `#/job/${id}`; });
  };
  xhr.onerror = () => toast('上传失败', true);
  xhr.send(f);
}

/* ───────── job ───────── */
function renderJobShell() {
  setNav('');
  app.classList.remove('full');
  app.innerHTML = `
    <div id="jobHead" class="job-head"><div class="skeleton" style="height:84px;width:60%"></div></div>
    <div id="rail" class="rail"></div>
    <details class="console" id="console"><summary><span>运行日志</span><span id="logCount"></span></summary><div class="lines" id="lines"></div></details>
    <section id="film"></section>
    <section class="workspace">
      <div class="player" id="player"><div class="skeleton" style="aspect-ratio:9/14"></div></div>
      <div><div class="tabs" id="tabs"></div><div id="tabBody"></div></div>
    </section>`;
  state.sig = {};
  state.exportPath = null;
}

function renderJobHead(job) {
  const m = job.meta || {};
  const [pl, color] = PLATFORMS[job.source.platform] || ['', '#999'];
  const metrics = [['播放', m.metrics?.views], ['点赞', m.metrics?.likes], ['评论', m.metrics?.comments], ['分享', m.metrics?.shares]].filter(x => x[1] != null);
  crumbs([['片库', '#/library'], [(m.title || '拆解中…').split('\n')[0].slice(0, 48), '']]);
  $('#jobHead').innerHTML = `
    <div style="min-width:0">
      <div class="job-sub"><span class="chip" style="background:${color}1f;color:${color};font-weight:600">${esc(pl)}</span>${m.author ? `<span class="chip">@${esc(m.author)}</span>` : ''}${m.engine ? `<span class="chip">${esc(m.engine)}</span>` : ''}${job.source.url ? `<a class="linkish" href="${esc(job.source.url)}" target="_blank" rel="noreferrer">原链接 ↗</a>` : ''}<button class="linkish" id="del" style="color:var(--muted)">删除</button></div>
      <h1>${esc((m.title || (job.status === 'failed' ? '抓取未完成' : '正在抓取原片…')).split('\n')[0])}</h1>
    </div>
    <div class="stats">${metrics.map(([k, v]) => `<div class="stat"><b>${big(v)}</b><span>${k}</span></div>`).join('')}</div>`;
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

function renderFilm(job) {
  const wrap = $('#film');
  if (!job.shots.length) { wrap.innerHTML = ''; return; }
  const total = job.media.analyzedSec || job.shots[job.shots.length - 1].end;
  const segs = job.director?.segments || [];
  wrap.innerHTML = `<div class="film">
    <div class="film-head"><h3>镜头胶片</h3><span>${job.shots.length} 镜 · 分析 ${tc(total)}${job.media.duration > total ? ` / 全片 ${tc(job.media.duration)}` : ''}</span></div>
    ${segs.length ? `<div class="segbar">${segs.map(s => `<div class="seg" style="left:${(s.start / total) * 100}%;width:calc(${(s.duration / total) * 100}% - 2px)">第${s.index}段 · ${s.duration}s</div>`).join('')}</div>` : ''}
    <div class="strip">
      ${job.shots.map(s => `<div class="frame rise" style="--w:${Math.max(s.duration, 0.3)};--i:${s.index}" data-t="${s.start}" data-i="${s.index}">
        <img src="${file(job.id, s.keyframe)}" alt="" loading="lazy"><span class="tag">${String(s.index).padStart(2, '0')}</span><span class="tc">${tc(s.start)}</span></div>`).join('')}
      <div class="playhead" id="playhead" style="left:0"></div>
    </div></div>`;
  wrap.querySelectorAll('.frame').forEach(f => { f.onclick = () => seek(Number(f.dataset.t)); });
}

function renderPlayer(job) {
  const el = $('#player');
  if (!job.media.video || job.stages.fetch?.status !== 'done') {
    el.innerHTML = `<div class="waiting" style="border:0;box-shadow:none"><div class="spinner"></div><strong>正在取片</strong>首次抓取抖音 / B站 会弹出浏览器，请扫码登录</div>`;
    state.sig.video = null;
    return;
  }
  const src = file(job.id, job.media.video);
  if (state.sig.video !== src) {
    el.innerHTML = `<video id="video" src="${src}" controls playsinline preload="metadata" ${job.media.cover ? `poster="${file(job.id, job.media.cover)}"` : ''}></video>
      <div class="player-meta"><span id="now">0:00.0</span><span>当前镜头 <b id="curShot">—</b></span></div><div class="tech" id="tech"></div>`;
    state.sig.video = src;
    $('#video').addEventListener('timeupdate', onTime);
  }
  const m = job.media;
  $('#tech').innerHTML = m.width ? [['分辨率', `${m.width}×${m.height}`], ['帧率', `${m.fps}`], ['时长', tc(m.duration)], ['视频', m.videoCodec], ['音频', m.audioCodec || '无'], ['体积', `${(m.size / 1048576).toFixed(1)}MB`]]
    .map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('') : '';
}

function seek(t) { const v = $('#video'); if (!v) return; v.currentTime = t + 0.02; v.play().catch(() => {}); }

function onTime() {
  const job = state.job, v = $('#video');
  if (!job || !v) return;
  const t = v.currentTime;
  $('#now').textContent = tc(t);
  const ph = $('#playhead');
  if (ph) ph.style.left = `${Math.min(t / (job.media.analyzedSec || 1), 1) * 100}%`;
  const idx = job.shots.find(s => t >= s.start && t < s.end)?.index;
  $('#curShot').textContent = idx ? `#${String(idx).padStart(2, '0')}` : '—';
  if (state.sig.active === idx) return;
  state.sig.active = idx;
  document.querySelectorAll('.frame').forEach(f => f.classList.toggle('active', Number(f.dataset.i) === idx));
  document.querySelectorAll('.shot').forEach(s => s.classList.toggle('active', Number(s.dataset.i) === idx));
}

/* tabs */
const TABS = [['overview', '爆款拆解'], ['shots', '分镜'], ['libtv', 'LibTV 提示词'], ['copy', '带货文案'], ['assets', '素材与导出']];

function renderTabs(job) {
  const counts = { shots: job.shots.length || '', libtv: job.director?.segments.length ? `${job.director.segments.length}段` : '' };
  $('#tabs').innerHTML = TABS.map(([id, label]) => `<button class="tab ${state.tab === id ? 'on' : ''}" data-tab="${id}">${label}${counts[id] ? `<small>${counts[id]}</small>` : ''}</button>`).join('');
  $('#tabs').querySelectorAll('.tab').forEach(b => { b.onclick = () => switchTab(job, b.dataset.tab); });
}
function switchTab(job, tab) { state.tab = tab; state.sig.tab = null; renderTabs(job); renderTabBody(job); }

function waiting(job, what) {
  const failed = Object.values(job.stages).some(s => s.status === 'failed');
  if (failed && !job.running) return `<div class="waiting"><strong>流程在中途停下了</strong>看上方红色步骤的原因，修好后点「重试这一步」。</div>`;
  return `<div class="waiting"><div class="spinner"></div><strong>${what}</strong>AI 导演正在逐帧看片，通常需要 20–90 秒</div>`;
}

function renderTabBody(job) {
  const sig = `${state.tab}|${job.director?.generatedAt || ''}|${job.shots.length}|${job.running}|${job.assets.map(a => a.file).join()}|${state.exportPath || ''}|${state.refStyle}|${state.copyTone}|${state.copyTarget}|${state.copyBusy}|${job.copy?.generatedAt || ''}|${job.brief?.notes ? 1 : 0}`;
  if (state.sig.tab === sig) return;
  state.sig.tab = sig;
  const body = $('#tabBody');
  const d = job.director;

  if (state.tab === 'overview') {
    if (!d) return void (body.innerHTML = waiting(job, '正在拆解爆点'));
    const a = d.analysis;
    const refs = d.refs || refMap(job.assets);
    const notes = (a.asset_notes || []).map(n => ({ ...n, ref: refs.find(r => r.token === n.token) })).filter(n => n.ref?.file);
    body.innerHTML = `<div class="grid2">
      ${d.goal || a.goal_plan ? `<div class="panel goal rise"><h4>想要的效果 → 实现方案</h4>${d.goal ? `<blockquote>${esc(d.goal)}</blockquote>` : ''}<p>${esc(a.goal_plan || '')}</p></div>` : ''}
      ${notes.length ? `<div class="panel wide rise"><h4>素材解读 · AI 看到的与怎么用</h4><div class="asset-notes">${notes.map(n => `<div class="an"><img src="${file(job.id, n.ref.file)}" alt=""><div><b>${R(n.token)} · ${esc(n.ref.label)}</b><p>${esc(n.seen)}</p><p class="use">${esc(n.usage)}</p></div></div>`).join('')}</div></div>` : ''}
      <div class="panel hook rise"><h4>前三秒钩子</h4><p>${esc(a.hook)}</p></div>
      <div class="panel rise" style="--i:1"><h4>叙事结构</h4><p>${esc(a.structure)}</p></div>
      <div class="panel rise" style="--i:2"><h4>剪辑节奏</h4><p>${esc(a.rhythm)}</p></div>
      <div class="panel rise" style="--i:3"><h4>画面风格</h4><p>${esc(a.visual_style)}</p></div>
      <div class="panel rise" style="--i:4"><h4>声音 / 口播</h4><p>${esc(a.audio_guess || '不确定')}</p></div>
      <div class="whys">${(a.why_it_works || []).map((w, i) => `<div class="why rise" style="--i:${i + 5}">${esc(w)}</div>`).join('')}</div>
    </div>
    <p class="foot-note">${esc(d.version || '')} · ${esc(d.model)} · ${new Date(d.generatedAt).toLocaleString('zh-CN', { hour12: false })}${d.usage ? ` · ${d.usage.prompt_tokens}+${d.usage.completion_tokens} tokens` : ''}${d.repaired ? ' · 已自动修正一次格式' : ''}</p>`;
  }

  if (state.tab === 'shots') {
    if (!job.shots.length) return void (body.innerHTML = waiting(job, '正在切分镜头'));
    body.innerHTML = `<div class="shotlist">${job.shots.map((s, i) => {
      const x = d?.shots?.[i];
      const p = x?.prompt_en ?? x?.prompt;
      return `<article class="shot rise" style="--i:${Math.min(i, 10)}" data-i="${s.index}">
        <div class="kf" data-t="${s.start}"><img src="${file(job.id, s.keyframe)}" alt="" loading="lazy"><span class="num">${String(s.index).padStart(2, '0')}</span><span class="play">${icon(I.play)}</span></div>
        <div style="min-width:0">
          <div class="shot-top"><span class="tcode">${tc(s.start)} → ${tc(s.end)} · ${s.duration}s</span>
            <div class="chips">${x ? [x.shot_size, x.camera, x.transition].filter(Boolean).map(c => `<span class="chip">${esc(c)}</span>`).join('') : `<span class="chip">${s.cut === 'hard' ? '硬切' : '连续镜头'}</span>`}</div></div>
          ${x ? `<p class="desc"><b>${esc(x.subject)}</b> · ${esc(x.action)}　<span style="color:var(--muted)">${esc(x.scene)} · ${esc(x.lighting)}</span>${x.on_screen_text && x.on_screen_text !== '无' ? `<br>画面字：「${esc(x.on_screen_text)}」` : ''}</p>
          <div class="prompt">${promptHtml(p)}<button class="btn sm copy" data-copy="${esc(refText(p))}">${icon(I.copy)}复制</button></div>
          ${x.replace_note ? `<div class="note">${esc(x.replace_note)}</div>` : ''}` : '<p class="desc" style="color:var(--muted)">等待导演拆解…</p>'}
        </div></article>`;
    }).join('')}</div>`;
    body.querySelectorAll('.kf').forEach(k => { k.onclick = () => seek(Number(k.dataset.t)); });
  }

  if (state.tab === 'libtv') {
    if (!d) return void (body.innerHTML = waiting(job, '正在编译 LibTV 提示词'));
    const refs = d.refs || refMap(job.assets);
    const slot = r => `<div class="slot">${r.file ? `<img src="${file(job.id, r.file)}" alt="">` : '<span class="missing"></span>'}<span class="what"><b>${R(r.token)}</b>${r.label} · ${r.file ? '已上传' : '待上传'}</span></div>`;
    const all = () => d.segments.map(s => `[Segment ${s.index} · ${tc(s.start)}-${tc(s.end)} · ${s.duration}s]\n${refText(s.prompt_en ?? s.prompt)}${s.negative_en ? `\n\nNegative: ${refText(s.negative_en)}` : ''}`).join('\n\n');
    body.innerHTML = `
      <div class="toolbar">
        <span class="lbl">引用格式</span>
        <div class="seg-ctl" id="refCtl">${Object.keys(REF_LABEL).map(k => `<button data-ref="${k}" class="${state.refStyle === k ? 'on' : ''}">${REF_LABEL[k]}</button>`).join('')}</div>
        <span style="flex:1"></span>
        <button class="btn primary" id="copyAll">${icon(I.copy)}复制全部</button>
        <a class="btn" href="/api/jobs/${job.id}/libtv.md?style=${state.refStyle}">${icon(I.down)}下载 .md</a>
        <button class="btn" id="goExport">${icon(I.folder)}素材包</button>
      </div>
      ${d.warnings?.length ? `<div class="warnbox">⚠ ${d.warnings.map(esc).join('；')}</div>` : ''}
      ${d.segments.map(s => `<article class="segment rise" style="--i:${s.index}">
        <div class="segment-head"><h3>第 ${s.index} 段<span>${tc(s.start)} – ${tc(s.end)} · ${s.duration}s · 镜头 ${s.shots.join('、')}</span></h3><button class="btn sm" data-seek="${s.start}">${icon(I.play)}预览原片</button></div>
        ${s.note_zh ? `<div class="zh">${esc(s.note_zh)}</div>` : ''}
        <div class="mapping">
          <div class="slot"><img src="${file(job.id, job.shots.find(x => x.index === s.shots[0])?.keyframe)}" alt=""><span class="what"><b>${R('@Video1')}</b>参考片段 段${s.index}_${s.duration}s.mp4</span></div>
          ${refs.map(slot).join('')}
        </div>
        <div class="body">
          <div class="prompt"><span class="en-label">PROMPT · EN</span>\n${promptHtml(s.prompt_en ?? s.prompt)}<button class="btn sm primary copy" data-copy="${esc(refText(s.prompt_en ?? s.prompt))}">${icon(I.copy)}复制</button></div>
          ${s.negative_en ? `<details><summary>负面约束 · Negative</summary><div class="prompt">${esc(refText(s.negative_en))}<button class="btn sm copy" data-copy="${esc(refText(s.negative_en))}">复制</button></div></details>` : ''}
        </div>
      </article>`).join('')}`;
    body.querySelectorAll('[data-seek]').forEach(b => { b.onclick = () => seek(Number(b.dataset.seek)); });
    body.querySelectorAll('[data-ref]').forEach(b => { b.onclick = () => { state.refStyle = b.dataset.ref; localStorage.setItem('studio-ref', state.refStyle); renderTabBody(job); }; });
    $('#copyAll').onclick = () => copy(all());
    $('#goExport').onclick = () => switchTab(job, 'assets');
  }

  if (state.tab === 'copy') {
    if (!d) return void (body.innerHTML = waiting(job, '拆解完成后才能写文案'));
    const c = job.copy;
    const TONE = { seed: '种草', review: '测评', promo: '促销', story: '剧情' };
    const TARGET = { douyin: '抖音', xhs: '小红书', channels: '视频号', tiktok: 'TikTok' };
    const ctl = (key, map) => `<div class="seg-ctl" data-ctl="${key}">${Object.entries(map).map(([k, v]) => `<button data-v="${k}" class="${state[key] === k ? 'on' : ''}">${v}</button>`).join('')}</div>`;
    const copyBtn = t => `<button class="btn sm copy" data-copy="${esc(t)}">${icon(I.copy)}复制</button>`;
    const vLimit = s => Math.floor(s * 4.5);
    body.innerHTML = `
      <div class="toolbar">
        <span class="lbl">风格</span>${ctl('copyTone', TONE)}
        <span class="lbl">平台</span>${ctl('copyTarget', TARGET)}
        <span style="flex:1"></span>
        <button class="btn primary magnetic" id="genCopy" ${state.copyBusy ? 'disabled' : ''}>${icon(I.spark)}${state.copyBusy ? '正在写…' : c ? '重新生成' : '生成文案'}</button>
        ${c ? `<a class="btn" href="/api/jobs/${job.id}/copy.md">${icon(I.down)}下载 .md</a>` : ''}
      </div>
      ${!job.brief?.notes ? `<div class="warnbox">还没有填写商品卖点：文案只会写体验和场景，不会出现具体功效。到「素材与导出」补充后效果更好。</div>` : ''}
      ${state.copyBusy ? `<div class="waiting"><div class="spinner"></div><strong>DeepSeek 正在写文案</strong>按每段时长控制口播字数，通常 10–30 秒</div>` : !c ? `<div class="waiting"><strong>选好风格和平台，生成一套文案</strong>标题、开头钩子、分段口播、逐镜字幕、发布文案与置顶评论</div>` : `
      ${c.warnings?.length ? `<div class="warnbox">⚠ ${c.warnings.map(esc).join('；')}</div>` : ''}
      <div class="grid2">
        <div class="panel rise"><h4>标题候选 · ${esc(TARGET[c.target])}</h4>${c.titles.map((t, i) => `<div class="copy-row"><span class="idx">${String(i + 1).padStart(2, '0')}</span><p>${esc(t)}</p>${copyBtn(t)}</div>`).join('')}</div>
        <div class="panel rise" style="--i:1"><h4>开头 3 秒钩子</h4>${c.hooks.map((t, i) => `<div class="copy-row"><span class="idx">${String(i + 1).padStart(2, '0')}</span><p>${esc(t)}</p>${copyBtn(t)}</div>`).join('')}</div>
      </div>
      <div class="panel rise" style="margin-top:14px"><h4>口播脚本 · 按段计时</h4>
        ${c.voiceover.map(v => { const n = v.text.replace(/\s/g, '').length, lim = vLimit(v.duration); return `<div class="vo">
          <div class="vo-head"><b>段 ${v.segment}</b><span class="tcode">${tc(v.start)} – ${tc(v.end)}</span><span class="meter"><i style="width:${Math.min(n / lim, 1) * 100}%" class="${n > lim ? 'over' : ''}"></i></span><span class="cnt ${n > lim ? 'over' : ''}">${n}/${lim} 字</span>${copyBtn(v.text)}</div>
          <p>${esc(v.text)}</p></div>`; }).join('')}
      </div>
      <div class="panel rise" style="margin-top:14px"><h4>画面字幕 · 逐镜头 <button class="btn sm" id="copyCaps" style="margin-left:8px">${icon(I.copy)}复制全部 SRT</button></h4>
        <div class="caps">${c.captions.map(x => { const s = job.shots.find(y => y.index === x.shot); return `<div class="cap" data-t="${x.start}"><img src="${file(job.id, s?.keyframe)}" alt=""><div><span class="tcode">${tc(x.start)}</span><p>${esc(x.text)}</p></div></div>`; }).join('')}</div>
      </div>
      <div class="grid2" style="margin-top:14px">
        <div class="panel rise"><h4>发布文案</h4><p class="pub">${esc(c.description)}</p><p class="tags">${c.hashtags.map(h => `<span>#${esc(h)}</span>`).join('')}</p>
          <div class="actions" style="margin-top:12px">${copyBtn(`${c.description}\n\n${c.hashtags.map(h => `#${h}`).join(' ')}`)}</div></div>
        <div class="panel rise" style="--i:1"><h4>置顶评论</h4><p class="pub">${esc(c.pinned_comment)}</p><div class="actions" style="margin-top:12px">${copyBtn(c.pinned_comment)}</div>
          ${c.notes?.length ? `<h4 style="margin-top:18px">给剪辑 / 运营</h4>${c.notes.map(n => `<p class="note-line">${esc(n)}</p>`).join('')}` : ''}</div>
      </div>
      <p class="foot-note">${esc(c.model)} · ${new Date(c.generatedAt).toLocaleString('zh-CN', { hour12: false })}${c.usage ? ` · ${c.usage.prompt_tokens}+${c.usage.completion_tokens} tokens` : ''}${c.repaired ? ' · 已自动修正一次' : ''}</p>`}`;
    body.querySelectorAll('[data-ctl]').forEach(g => g.querySelectorAll('button').forEach(b => { b.onclick = () => { state[g.dataset.ctl] = b.dataset.v; state.sig.tab = null; renderTabBody(job); }; }));
    body.querySelectorAll('.cap').forEach(el => { el.onclick = () => seek(Number(el.dataset.t)); });
    $('#genCopy').onclick = async () => {
      state.copyBusy = true; state.sig.tab = null; renderTabBody(job);
      try { job.copy = await api(`/api/jobs/${job.id}/copy`, { method: 'POST', json: { tone: state.copyTone, target: state.copyTarget } }); toast('文案已生成'); }
      catch (err) { toast(err.message, true); }
      state.copyBusy = false; state.sig.tab = null; renderTabBody(job);
    };
    if (c) $('#copyCaps').onclick = () => {
      const srt = t => { const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`; };
      copy(c.captions.map((x, i) => `${i + 1}\n${srt(x.start)} --> ${srt(x.end)}\n${x.text}\n`).join('\n'));
    };
    refresh(body);
  }

  if (state.tab === 'assets') {
    const b = job.brief || {};
    const refs = refMap(job.assets);
    const group = role => {
      const cfg = ROLES[role];
      const list = refs.filter(r => r.role === role && r.file);
      return `<div class="picker" data-role="${role}">
        <div class="picker-head"><b>${cfg.label}</b><small>${cfg.hint}</small></div>
        <div class="thumbs">${list.map(r => `<figure><img src="${file(job.id, r.file)}" alt=""><figcaption>${R(r.token)}</figcaption><button type="button" data-rmfile="${esc(r.file)}" aria-label="移除">×</button></figure>`).join('')}
          ${list.length < cfg.max || cfg.max === 1 ? `<label class="add">${icon(I.upload)}<span>${list.length && cfg.max === 1 ? '替换' : list.length ? '再加' : '上传'}</span><input type="file" accept="image/jpeg,image/png,image/webp" ${cfg.max > 1 ? 'multiple' : ''} hidden></label>` : ''}</div>
      </div>`;
    };
    body.innerHTML = `
      <div class="pickers big">${Object.keys(ROLES).map(group).join('')}</div>
      <form class="panel" id="briefForm">
        <h4>复刻设置</h4>
        <div class="grid2" style="margin-top:10px">
          <div class="field wide"><label>想要的效果</label><textarea name="goal" rows="2" placeholder="例：保留原片节奏，换成我的模特和羽绒服，画面更明亮">${esc(b.goal)}</textarea></div>
          <div class="field"><label>替换商品</label><input name="product" value="${esc(b.product)}" placeholder="例：米色轻暖连帽羽绒服"></div>
          <div class="field"><label>模特要求</label><input name="model" value="${esc(b.model)}" placeholder="例：25 岁亚洲女生"></div>
          <div class="field wide"><label>商品卖点（AI 只会使用这里写的卖点）</label><textarea name="notes" rows="3" placeholder="写清真实卖点，AI 不会编造没写的功效">${esc(b.notes)}</textarea></div>
          <div class="field wide"><label>风格补充</label><input name="style" value="${esc(b.style)}" placeholder="例：更明亮的室内自然光、节奏更快"></div>
        </div>
        <div class="actions"><button class="btn primary" ${job.running || !job.shots.length ? 'disabled' : ''}>${icon(I.spark)}保存并重新编译提示词</button><span class="path">只花 DeepSeek token，不产生视频费用</span></div>
      </form>
      <div class="panel" style="margin-top:14px">
        <h4>导出素材包</h4>
        <p>按段切好的参考片段（${R('@Video1')}）、替换素材、英文提示词与分镜表，放进一个文件夹，逐段上传到 LibTV。</p>
        <div class="actions"><button class="btn primary" id="export" ${d ? '' : 'disabled'}>${icon(I.down)}生成素材包</button><button class="btn" id="open">${icon(I.folder)}打开文件夹</button></div>
        ${state.exportPath ? `<p class="path" style="margin-top:10px">已导出：${esc(state.exportPath)}</p>` : ''}
      </div>`;
    body.querySelectorAll('.pickers.big .picker').forEach(el => {
      const role = el.dataset.role;
      const add = async files => { for (const f of [...files].slice(0, ROLES[role].max)) await uploadAsset(job, role, f); };
      el.querySelector('input')?.addEventListener('change', e => add(e.target.files));
      el.ondragover = e => { e.preventDefault(); el.classList.add('drag'); };
      el.ondragleave = () => el.classList.remove('drag');
      el.ondrop = e => { e.preventDefault(); el.classList.remove('drag'); add(e.dataTransfer.files); };
    });
    body.querySelectorAll('[data-rmfile]').forEach(btn => { btn.onclick = async e => { e.preventDefault(); e.stopPropagation(); job.assets = await api(`/api/jobs/${job.id}/assets/x?file=${encodeURIComponent(btn.dataset.rmfile)}`, { method: 'DELETE' }); state.sig.tab = null; renderTabBody(job); }; });
    $('#briefForm').onsubmit = async e => {
      e.preventDefault();
      try { await api(`/api/jobs/${job.id}/brief`, { method: 'POST', json: Object.fromEntries(new FormData(e.target)) }); state.tab = 'libtv'; await rerun('director'); toast('已提交，AI 导演重新编译中'); }
      catch (err) { toast(err.message, true); }
    };
    $('#export').onclick = async ev => {
      const btn = ev.currentTarget;
      btn.disabled = true; btn.textContent = '切片打包中…';
      try { const r = await api(`/api/jobs/${job.id}/export`, { method: 'POST', json: { style: state.refStyle } }); state.exportPath = r.path; toast('素材包已生成'); state.sig.tab = null; renderTabBody(job); }
      catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = '生成素材包'; }
    };
    $('#open').onclick = () => api(`/api/jobs/${job.id}/open`, { method: 'POST' }).catch(err => toast(err.message, true));
  }
  body.querySelectorAll('[data-copy]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      copy(btn.dataset.copy);
      const html = btn.innerHTML;
      btn.classList.add('copied'); btn.innerHTML = '已复制';
      setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = html; }, 1400);
    };
  });
}

async function uploadAsset(job, role, f) {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast('只支持 JPG / PNG / WebP', true);
  try {
    job.assets = await api(`/api/jobs/${job.id}/assets?role=${role}`, { method: 'POST', body: f, headers: { 'Content-Type': f.type } });
    const r = refMap(job.assets).filter(x => x.role === role && x.file).pop();
    toast(`${ROLES[role].label}已上传（${R(r?.token || '')}），保存并重新编译后生效`);
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
  if (!prev || prev.shots.length !== job.shots.length || prev.director?.generatedAt !== job.director?.generatedAt) renderFilm(job);
  renderPlayer(job);
  renderTabs(job);
  renderTabBody(job);
  clearTimeout(state.poll);
  if (job.running) state.poll = setTimeout(() => refreshJob(id).catch(() => {}), 1500);
  else if (prev?.running) loadJobs();
}

/* ───────── router ───────── */
async function route() {
  clearTimeout(state.poll);
  const m = location.hash.match(/^#\/job\/([\w-]+)/);
  if (!location.hash.startsWith('#/library')) window.scrollTo({ top: 0 });
  if (m) {
    state.job = null; state.tab = 'overview';
    await transition(() => renderJobShell());
    mount(app);
    try { await refreshJob(m[1]); } catch (err) { app.innerHTML = `<div class="empty" style="margin-top:60px"><strong>找不到这条拆解</strong>${esc(err.message)}<br><br><a class="btn" href="#/">回到片库</a></div>`; }
    return;
  }
  state.job = null;
  await transition(() => {
    app.classList.remove('full');
    if (location.hash.startsWith('#/guide')) renderGuide();
    else renderHome({ focus: location.hash.startsWith('#/new'), toLibrary: location.hash.startsWith('#/library') });
  });
  mount(app);
  loadJobs();
}

async function loadJobs() {
  try { state.jobs = await api('/api/jobs'); } catch { state.jobs = []; }
  renderRecent();
  renderLibrary();
  if (state.jobs.some(j => j.running) && !location.hash.startsWith('#/job')) { clearTimeout(state.poll); state.poll = setTimeout(loadJobs, 2500); }
}

window.addEventListener('hashchange', route);
window.addEventListener('resize', () => requestAnimationFrame(moveIndicator));
document.fonts?.ready.then(moveIndicator);
api('/api/health').then(h => { state.health = h; renderEngines(); }).catch(() => {});
route();
