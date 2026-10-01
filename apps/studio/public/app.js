// 复刻 Studio — zero-dependency client
import { darkScene, lightScene } from './scenes.js';
import { bindGuide, guideHtml } from './guide.js';
import { countUp, mount, moveIndicator, refresh, splitChars, transition } from './fx.js';
import { mountBoard } from './board.js';
import { renderScriptNew } from './script.js';
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

const state = {
  health: null, jobs: [], job: null, tab: 'overview', poll: null, sig: {}, exportPath: null,
  pending: { model: [], product: [], style: [] }, showStyle: false, template: null, filter: 'all', refStyle: localStorage.getItem('studio-ref') || 'en', copyTone: 'seed', copyTarget: 'douyin', copyBusy: false,
  h3Res: '768P', h3Refs: false, h3Busy: null,
  voices: null, voiceId: localStorage.getItem('studio-voice') || '', voiceBusy: false, finalBusy: false, finalVoice: true,
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
const PLATFORMS = { douyin: ['抖音', '#ff3d7f'], bilibili: ['B站', '#27a7e7'], tiktok: ['TikTok', '#1db954'], instagram: ['Instagram', '#f08c1a'], local: ['本地', '#7a5cff'], script: ['脚本', '#c08a3e'] };
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

/* scenario templates: pick one to see what to prepare */
const TEMPLATES = [
  { id: 'wear', title: '服装上身', line: '穿搭类爆款 → 你的模特穿你的衣服', needs: ['model', 'product'], icon: 'M8 4l4 2 4-2 4 3-3 3v10H7V10L4 7z',
    goal: '保留原片的走位、转身和运镜节奏，换成我的模特穿我的衣服，重点展示正面、背面和面料细节。' },
  { id: 'show', title: '商品展示', line: '开箱 / 特写类爆款 → 换成你的商品', needs: ['product'], icon: 'M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8',
    goal: '保留原片的开箱节奏和特写镜头，把商品换成我的，按顺序突出外观、细节和使用场景。' },
  { id: 'talk', title: '口播种草', line: '真人口播爆款 → 你的模特讲你的商品', needs: ['model', 'product'], icon: 'M5 5h14v10H9l-4 4z M9 10h6',
    goal: '保留原片口播的机位、节奏和表情变化，换成我的模特手拿我的商品介绍，开头 3 秒直接抛出痛点。' },
  { id: 'story', title: '剧情短片', line: '剧情 / 反转类爆款 → 你的角色', needs: ['model', 'style'], icon: 'M4 5h16v14H4z M4 9h16 M8 5l-2 4 M13 5l-2 4 M18 5l-2 4',
    goal: '保留原片的剧情分镜和转场，换成我的模特做主角，画面走我参考图的色调和氛围。' },
];

/* image roles — mirrors lib/refs.mjs */
const ROLES = {
  model: { label: '你的模特', max: 1, hint: '主角 · 1 张，正脸清晰，全身更好' },
  product: { label: '衣服 / 商品', max: 3, hint: '最多 3 张 · 正面、背面、细节' },
  style: { label: '效果参考', max: 3, hint: '可选 · 最多 3 张，想要的色调、场景、氛围' },
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
      <ol class="flow rise"><li><b>01</b>抓取爆款</li><li><b>02</b>拆解分析</li><li><b>03</b>换上你的模特</li><li><b>04</b>出成片</li></ol>
      <h1><span class="ln"><span style="--l:0">抓一条爆款，</span></span><span class="ln"><span style="--l:1">换上<em>你的模特</em>。</span></span></h1>
      <p class="sub rise" style="--i:4">粘贴链接自动抓取，AI 拆解镜头与爆点，<br>再套上你的模特和商品，生成能直接出片的提示词。</p>
      <form class="composer rise" style="--i:5" id="slate">
        <div class="search">
          <input id="link" autocomplete="off" placeholder="粘贴抖音 / B站 / TikTok / Instagram 爆款链接…">
          <span class="detected" id="detected"></span>
          <button class="btn ink magnetic" data-strength=".18" id="go" type="submit">开始分析 ${icon(I.arrow)}</button>
        </div>
        <div class="brief open" id="brief">
          <div class="brief-head"><span class="idx">复刻设置</span><small>不知道怎么填？先选一个场景 · 都可以留空，之后再补</small></div>
          <div class="templates wide" id="tpls">${TEMPLATES.map(t => `<button type="button" class="tpl" data-tpl="${t.id}"><svg viewBox="0 0 24 24" class="ic"><path d="${t.icon}"/></svg><span><b>${t.title}</b><small>${t.line}</small><i>${['链接', ...t.needs.map(r => ({ model: '模特', product: '衣服/商品', style: '效果参考' })[r])].join(' + ')}</i></span></button>`).join('')}</div>
          <div class="field wide"><label>想要的效果</label><textarea name="goal" rows="2" placeholder="例：保留原片的节奏和运镜，换成我的模特穿米色羽绒服，画面更明亮干净，适合冬季上新"></textarea></div>
          <div class="pickers wide" id="pickers"></div>
          <div class="field"><label>商品名称</label><input name="product" placeholder="例：米色轻暖连帽羽绒服"></div>
          <div class="field"><label>商品卖点（AI 只会使用这里写的）</label><input name="notes" placeholder="例：90% 白鸭绒、可机洗、三色可选"></div>
        </div>
      </form>
      <div class="hero-actions rise" style="--i:6">
        <button class="btn text" id="toggleBrief" type="button">收起复刻设置</button>
        <button class="btn text" id="upload" type="button">${icon(I.upload)}用本地视频</button>
        <a class="btn text" href="#/script">用脚本出片 →</a>
        <a class="btn text" id="demoLink" href="#/guide">看一个真实案例 →</a>
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
  $('#tpls').querySelectorAll('.tpl').forEach(b => { b.onclick = () => applyTemplate(b.dataset.tpl); });
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

function updateDemoLink() {
  const a = $('#demoLink');
  if (!a) return;
  const done = state.jobs.filter(j => j.status === 'done' && j.hasPrompts);
  const demo = done.find(j => /^教程示例/.test(j.title || '')) || done[0];
  if (demo) { a.href = `#/job/${demo.id}`; a.title = (demo.title || '').split('\n')[0]; }
}

function renderLibrary() {
  updateDemoLink();
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

let unbindGuide = null;
function renderGuide() {
  crumbs([['首页', '#/'], ['使用教程', '']]);
  setNav('guide');
  app.innerHTML = guideHtml();
  unbindGuide = bindGuide(app);
}

const readBrief = () => Object.fromEntries([...document.querySelectorAll('#brief input, #brief textarea')].map(el => [el.name, el.value.trim()]));
const pendingCount = () => Object.values(state.pending).reduce((n, l) => n + l.length, 0);

/** One upload group. items: [{ src, token, rm }] where rm is the value for data-rm. */
function pickerBlock(role, items) {
  const cfg = ROLES[role];
  if (role === 'style' && !items.length && !state.showStyle) {
    return `<button type="button" class="picker-more" data-show-style>＋ 效果参考图<em>可选</em><small>想要的色调、场景、氛围，可以不放</small></button>`;
  }
  const input = `<input type="file" accept="image/jpeg,image/png,image/webp" ${cfg.max > 1 ? 'multiple' : ''} hidden>`;
  const body = !items.length
    ? `<label class="dropzone">${icon(I.upload)}<span>拖拽图片到这里</span><small>或点击选择 · 支持 Ctrl+V 粘贴</small>${input}</label>`
    : `<div class="thumbs">${items.map(it => `<figure><img src="${it.src}" alt=""><figcaption>${R(it.token)}</figcaption><button type="button" data-rm="${esc(it.rm)}" aria-label="移除">×</button></figure>`).join('')}
        ${cfg.max === 1 || items.length < cfg.max ? `<label class="add">${icon(I.upload)}<span>${cfg.max === 1 ? '替换' : '再加'}</span>${input}</label>` : ''}</div>`;
  const want = TEMPLATES.find(t => t.id === state.template)?.needs.includes(role) && !items.length;
  return `<div class="picker ${role === 'model' ? 'lead' : ''} ${role === 'style' ? 'optional' : ''} ${want ? 'want' : ''}" data-role="${role}">
    <div class="picker-head"><b>${cfg.label}${role === 'style' ? '<em>可选</em>' : ''}</b><small>${cfg.hint}</small></div>${body}</div>`;
}

function bindPickers(root, add, remove) {
  root.querySelectorAll('.picker').forEach(el => {
    const role = el.dataset.role;
    el.querySelector('input')?.addEventListener('change', e => add(role, e.target.files));
    el.ondragover = e => { e.preventDefault(); el.classList.add('drag'); };
    el.ondragleave = e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drag'); };
    el.ondrop = e => { e.preventDefault(); e.stopPropagation(); el.classList.remove('drag'); document.body.classList.remove('dragging-files'); add(role, e.dataTransfer.files); };
  });
  root.querySelectorAll('[data-rm]').forEach(b => { b.onclick = e => { e.preventDefault(); e.stopPropagation(); remove(b.dataset.rm); }; });
  root.querySelector('[data-show-style]')?.addEventListener('click', () => { state.showStyle = true; root === $('#pickers') ? renderPickers() : (state.sig.tab = null, renderTabBody(state.job)); });
}

/** Where a pasted / loosely dropped image goes: model first, then product, then style. */
function autoRole(counts) {
  if (!counts.model) return 'model';
  if ((counts.product || 0) < ROLES.product.max) return 'product';
  return 'style';
}

function addPending(role, files) {
  const ok = [...files].filter(f => /^image\/(jpeg|png|webp)$/.test(f.type));
  if (ok.length < [...files].length) toast('只支持 JPG / PNG / WebP 图片', true);
  for (const f of ok) {
    if (ROLES[role].max === 1) { state.pending[role].forEach(x => URL.revokeObjectURL(x.url)); state.pending[role] = []; }
    if (state.pending[role].length >= ROLES[role].max) { toast(`${ROLES[role].label}最多 ${ROLES[role].max} 张`, true); break; }
    f.url = URL.createObjectURL(f);
    state.pending[role].push(f);
  }
  if (role === 'style' && ok.length) state.showStyle = true;
  renderPickers();
}

function applyTemplate(id) {
  const t = TEMPLATES.find(x => x.id === id);
  if (!t) return;
  state.template = id;
  const goal = document.querySelector('#brief textarea[name=goal]');
  if (goal && (!goal.value.trim() || TEMPLATES.some(x => x.goal === goal.value.trim()))) goal.value = t.goal;
  if (t.needs.includes('style')) state.showStyle = true;
  document.querySelectorAll('.tpl').forEach(b => b.classList.toggle('on', b.dataset.tpl === id));
  renderPickers();
  const missing = t.needs.filter(r => !state.pending[r].length).map(r => ROLES[r].label);
  toast(missing.length ? `「${t.title}」还需要上传：${missing.join('、')}` : `「${t.title}」素材已齐`);
}

function renderPickers() {
  const box = $('#pickers');
  if (!box) return;
  const refs = refMap(Object.entries(state.pending).flatMap(([role, list]) => list.map((f, i) => ({ role, file: `${role}:${i}` }))));
  box.innerHTML = Object.keys(ROLES).map(role => pickerBlock(role, state.pending[role].map((f, i) => ({ src: f.url, token: refs.find(r => r.file === `${role}:${i}`)?.token, rm: `${role}:${i}` })))).join('');
  bindPickers(box, addPending, key => { const [role, i] = key.split(':'); URL.revokeObjectURL(state.pending[role][i].url); state.pending[role].splice(Number(i), 1); renderPickers(); });
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
    state.template = null;
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
const TABS = [['overview', '爆款拆解'], ['shots', '分镜'], ['board', '分镜板'], ['libtv', 'LibTV 提示词'], ['h3', 'H3 出片'], ['copy', '带货文案'], ['assets', '素材与导出']];
const END_LABEL = { settled: '动作完成', ongoing: '仍在动', cutoff: '中途被切断', unknown: '看不清' };
const H3_PENDING = ['submitting', 'submitted'];
const h3Pending = job => Object.values(job.h3 || {}).some(e => H3_PENDING.includes(e.state));

function renderTabs(job) {
  const done = Object.values(job.h3 || {}).filter(e => e.state === 'succeeded').length;
  const counts = { shots: job.shots.length || '', libtv: job.director?.segments.length ? `${job.director.segments.length}段` : '', h3: done ? `${done}片` : h3Pending(job) ? '生成中' : '' };
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
  const sig = `${state.tab}|${job.director?.generatedAt || ''}|${job.shots.length}|${job.running}|${job.assets.map(a => a.file).join()}|${state.exportPath || ''}|${state.refStyle}|${state.copyTone}|${state.copyTarget}|${state.copyBusy}|${job.copy?.generatedAt || ''}|${job.brief?.notes ? 1 : 0}|${JSON.stringify(Object.entries(job.h3 || {}).map(([k, e]) => [k, e.state, e.updatedAt]))}|${state.h3Res}|${state.h3Refs}|${state.h3Busy}|${state.health?.engines?.minimax?.ok}|${job.voice?.generatedAt || ''}|${job.final?.builtAt || ''}|${job.transcript?.transcribedAt || ''}|${state.voices?.length ?? -1}|${state.voiceId}|${state.voiceBusy}|${state.finalBusy}|${state.finalVoice}`;
  if (state.sig.tab === sig) return;
  state.sig.tab = sig;
  const body = $('#tabBody');
  const d = job.director;
  if (state.tab === 'board') return void mountBoard(body, job, boardCtx());

  if (state.tab === 'overview') {
    if (!d) return void (body.innerHTML = waiting(job, '正在拆解爆点'));
    const a = d.analysis;
    const refs = d.refs || refMap(job.assets);
    const notes = (a.asset_notes || []).map(n => ({ ...n, ref: refs.find(r => r.token === n.token) })).filter(n => n.ref?.file);
    const hasModel = job.assets.some(x => x.role === 'model');
    body.innerHTML = `${!hasModel ? `<div class="next-step rise"><b>03</b><div><strong>下一步：换上你的模特</strong><p>拆解已完成。上传模特和衣服 / 商品图片，AI 会重新编译成用你的模特出镜的提示词。</p></div><button class="btn ink" data-goto="assets">去上传 ${icon(I.arrow)}</button></div>` : ''}
    <div class="grid2">
      ${d.goal || a.goal_plan ? `<div class="panel goal rise"><h4>想要的效果 → 实现方案</h4>${d.goal ? `<blockquote>${esc(d.goal)}</blockquote>` : ''}<p>${esc(a.goal_plan || '')}</p></div>` : ''}
      ${notes.length ? `<div class="panel wide rise"><h4>素材解读 · AI 看到的与怎么用</h4><div class="asset-notes">${notes.map(n => `<div class="an"><img src="${file(job.id, n.ref.file)}" alt=""><div><b>${R(n.token)} · ${esc(n.ref.label)}</b><p>${esc(n.seen)}</p><p class="use">${esc(n.usage)}</p></div></div>`).join('')}</div></div>` : ''}
      <div class="panel hook rise"><h4>前三秒钩子</h4><p>${esc(a.hook)}</p></div>
      <div class="panel rise" style="--i:1"><h4>叙事结构</h4><p>${esc(a.structure)}</p></div>
      <div class="panel rise" style="--i:2"><h4>剪辑节奏</h4><p>${esc(a.rhythm)}</p></div>
      <div class="panel rise" style="--i:3"><h4>画面风格</h4><p>${esc(a.visual_style)}</p></div>
      <div class="panel rise" style="--i:4"><h4>声音 / 口播</h4><p>${esc(a.audio_guess || '不确定')}</p></div>
      ${job.transcript ? `<div class="panel wide rise" style="--i:5"><h4>原片口播 / 对白 · MOSI 转写</h4>${job.transcript.segments.length ? `<div class="lines">${job.transcript.segments.map(x => `<div class="line" data-t="${x.start}"><span class="tcode">${tc(x.start)}</span><b>${esc(x.speaker || '')}</b><p>${esc(x.text)}</p></div>`).join('')}</div>` : '<p>原片没有可识别的人声（可能只有音乐或环境声）。</p>'}</div>` : ''}
      <div class="whys">${(a.why_it_works || []).map((w, i) => `<div class="why rise" style="--i:${i + 5}">${esc(w)}</div>`).join('')}</div>
    </div>
    <p class="foot-note">${job.transcript ? '口播已转写 · ' : ''}${esc(d.version || '')} · ${esc(d.model)} · ${new Date(d.generatedAt).toLocaleString('zh-CN', { hour12: false })}${d.usage ? ` · ${d.usage.prompt_tokens}+${d.usage.completion_tokens} tokens` : ''}${d.repaired ? ' · 已自动修正一次格式' : ''}</p>`;
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
          ${Array.isArray(x.action_phases) ? `<p class="phases">${x.action_phases.map(esc).join('<i>→</i>')}${x.end_state ? `<span class="end ${esc(x.end_state)}">${END_LABEL[x.end_state] || esc(x.end_state)}</span>` : ''}${x.hidden_cut_at != null ? `<span class="end cutoff">${x.hidden_cut_at}s 处有漏检切点</span>` : ''}</p>` : ''}
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
      <div class="next-step out"><b>04</b><div><strong>出成片：${d.segments.length} 段，逐段在 LibTV 生成后拼接</strong><p>① 生成素材包 → ② 每段上传对应参考片段（${R('@Video1')}）和 ${refs.filter(r => r.file).map(r => R(r.token)).join(' / ') || '模特与商品图'} → ③ 粘贴该段提示词生成 → ④ 按段序拼接成片</p></div><button class="btn ink" data-goto="assets">${icon(I.folder)}素材包</button></div>
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

  if (state.tab === 'h3') {
    if (!d) return void (body.innerHTML = waiting(job, '正在编译提示词'));
    const list = job.h3Prompts || [];
    if (!list.length || !d.shots?.some(s => s.h3_en)) return void (body.innerHTML = `<div class="waiting"><strong>这条拆解是旧版导演生成的，没有 H3 描述</strong>到「素材与导出」点「保存并重新编译提示词」即可生成（只花 DeepSeek token）。镜头切分也是旧的，要用新的切点就在上方把「镜头切分」重跑一次。</div>`);
    const keyOk = state.health?.engines?.minimax?.ok;
    const canRefs = job.assets.some(a => a.role === 'model' || a.role === 'product');
    const all = list.map(s => `[Segment ${s.index} · ${s.target}s]\n${s.text}`).join('\n\n');
    const STATE = { submitting: '正在提交…', submitted: '已提交，MiniMax 生成中（通常 3–6 分钟，可以离开页面）', succeeded: '已出片', failed: '生成失败', rejected: '提交被拒绝（没有创建任务，可以改好后再提交）', unknown: '提交结果不明：可能已创建任务并扣费，已停止，不会自动重试。请到 MiniMax 控制台核对。' };
    const card = s => {
      const e = job.h3?.[s.index];
      const busy = state.h3Busy === s.index || H3_PENDING.includes(e?.state);
      const again = Boolean(e && ['succeeded', 'failed'].includes(e.state));
      const blocked = Boolean(e && ['unknown', 'submitting', 'submitted'].includes(e.state));
      return `<article class="segment rise" style="--i:${s.index}">
        <div class="segment-head"><h3>第 ${s.index} 段<span>原片 ${tc(s.start)} – ${tc(s.end)} · ${s.duration}s → 生成 ${s.target}s · ${s.shots} 个镜头</span></h3><button class="btn sm" data-seek="${s.start}">${icon(I.play)}预览原片</button></div>
        ${e ? `<div class="h3-state ${esc(e.state)}">${busy ? '<div class="spinner sm"></div>' : ''}<b>${STATE[e.state] || esc(e.state)}</b>${e.taskId ? `<span class="tcode">任务号 ${esc(e.taskId)}</span>` : ''}${e.error ? `<p>${esc(e.error)}</p>` : ''}</div>` : ''}
        ${e?.state === 'succeeded' ? `<div class="h3-videos">
          ${e.compare ? `<figure><video src="${file(job.id, e.compare)}" controls playsinline preload="metadata"></video><figcaption>左：原片　右：H3 生成</figcaption></figure>` : ''}
          <figure><video src="${file(job.id, e.video)}" controls playsinline preload="metadata"></video><figcaption>H3 成片 · <a href="${file(job.id, e.video)}" download>下载 mp4</a></figcaption></figure>
        </div>` : ''}
        <div class="body">
          <div class="prompt"><span class="en-label">H3 · T2VA</span>\n${esc(s.text)}<button class="btn sm copy" data-copy="${esc(s.text)}">${icon(I.copy)}复制</button></div>
          <div class="actions" style="margin-top:12px"><button class="btn ${again ? '' : 'primary'}" data-h3="${s.index}" data-sec="${s.target}" data-again="${again ? 1 : ''}" ${!keyOk || busy || blocked ? 'disabled' : ''}>${icon(I.spark)}${again ? '再生成一次（付费）' : '用 MiniMax H3 生成（付费）'}</button></div>
        </div>
      </article>`;
    };
    body.innerHTML = `
      <div class="toolbar">
        <span class="lbl">分辨率</span>
        <div class="seg-ctl" id="h3Res">${['768P', '2K'].map(r => `<button data-v="${r}" class="${state.h3Res === r ? 'on' : ''}">${r}</button>`).join('')}</div>
        <label class="check ${canRefs ? '' : 'off'}" title="${canRefs ? '把 @Image1 模特图和 @Image2 商品图作为参考图一起提交' : '先在「素材与导出」上传模特或商品图'}"><input type="checkbox" id="h3Refs" ${state.h3Refs && canRefs ? 'checked' : ''} ${canRefs ? '' : 'disabled'}>附带模特 / 商品图（实验）</label>
        <span style="flex:1"></span>
        <button class="btn primary" id="copyAllH3">${icon(I.copy)}复制全部</button>
        <a class="btn" href="/api/jobs/${job.id}/h3.md">${icon(I.down)}下载 .md</a>
      </div>
      ${keyOk ? '' : `<div class="warnbox">没有配置 MiniMax Key，生成按钮不可用。可以复制提示词到 MiniMax 网页端手动生成；或在 apps/studio/.env.local 写 MINIMAX_API_KEY=（必须是按量付费的 Key，套餐类 sk-cp Key 会报余额不足），重启工作台后生效。</div>`}
      <div class="next-step out"><b>04</b><div><strong>MiniMax H3：每段一次生成，直接出片</strong><p>提示词由导演逐镜看首 / 中 / 尾三帧取证后编译，镜头和切点时间都写在里面，不需要上传参考片段。每次生成都是真实扣费；同一段在生成中或结果不明时不会重复提交。<br>声音字段写 N/A 表示没有核听、不是静音；H3 会自己配一条音轨，商用请换成有授权的配乐。${state.h3Refs && canRefs ? '<br><b>附带参考图是实验功能</b>：人物和商品能不能换成你的，要看这次生成的效果。' : ''}</p></div></div>
      ${finalBlock(job, list)}
      ${list.map(card).join('')}`;
    bindFinal(job, body);
    body.querySelectorAll('#h3Res button').forEach(b => { b.onclick = () => { state.h3Res = b.dataset.v; state.sig.tab = null; renderTabBody(job); }; });
    const refsBox = $('#h3Refs');
    if (refsBox) refsBox.onchange = () => { state.h3Refs = refsBox.checked; state.sig.tab = null; renderTabBody(job); };
    $('#copyAllH3').onclick = () => copy(all);
    body.querySelectorAll('[data-seek]').forEach(b => { b.onclick = () => seek(Number(b.dataset.seek)); });
    body.querySelectorAll('[data-h3]').forEach(b => {
      b.onclick = async () => {
        const segment = Number(b.dataset.h3), seconds = Number(b.dataset.sec), again = Boolean(b.dataset.again);
        const refs = state.h3Refs && canRefs;
        const ok = window.confirm(`确认提交 1 次 MiniMax H3 付费生成？\n\n第 ${segment} 段 · ${seconds} 秒 · ${state.h3Res}${refs ? ' · 附带模特 / 商品图' : ''}${again ? '\n（这一段已有结果，这次会再生成一条新的）' : ''}\n\n会产生真实费用，按你的 MiniMax 账户计费；提交后不能取消。`);
        if (!ok) return;
        state.h3Busy = segment; state.sig.tab = null; renderTabBody(job);
        try {
          await api(`/api/jobs/${job.id}/h3`, { method: 'POST', json: { segment, seconds, confirm: true, resolution: state.h3Res, withRefs: refs, again } });
          toast(`第 ${segment} 段已提交，后台生成中`);
        } catch (err) { toast(err.message, true); }
        state.h3Busy = null; state.sig.tab = null;
        await refreshJob(job.id).catch(() => {});
      };
    });
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
      ${voiceBlock(job)}
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
    bindVoice(job, body);
    if (c) $('#copyCaps').onclick = () => {
      const srt = t => { const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`; };
      copy(c.captions.map((x, i) => `${i + 1}\n${srt(x.start)} --> ${srt(x.end)}\n${x.text}\n`).join('\n'));
    };
    refresh(body);
  }

  if (state.tab === 'assets') {
    const b = job.brief || {};
    const refs = refMap(job.assets);
    const group = role => pickerBlock(role, refs.filter(r => r.role === role && r.file).map(r => ({ src: file(job.id, r.file), token: r.token, rm: r.file })));
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
    bindPickers(body.querySelector('.pickers.big'),
      async (role, files) => { for (const f of [...files].slice(0, ROLES[role].max)) await uploadAsset(job, role, f); },
      async rm => { job.assets = await api(`/api/jobs/${job.id}/assets/x?file=${encodeURIComponent(rm)}`, { method: 'DELETE' }); state.sig.tab = null; renderTabBody(job); });
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
  body.querySelectorAll('[data-goto]').forEach(b => { b.onclick = () => switchTab(job, b.dataset.goto); });
  body.querySelectorAll('.line[data-t]').forEach(el => { el.onclick = () => seek(Number(el.dataset.t)); });
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

/* voice-over (MOSI) and the final cut */
async function loadVoices() {
  try { state.voices = await api('/api/moss/voices'); }
  catch (err) { state.voices = []; toast(err.message, true); }
  if (state.job) { state.sig.tab = null; renderTabBody(state.job); }
}

function voiceBlock(job) {
  const c = job.copy;
  if (!c) return '';
  if (!state.health?.engines?.moss?.ok) return `<div class="panel rise" style="margin-top:14px"><h4>配音 · MOSI</h4><p class="muted">没有配置 MOSI Key。在 apps/studio/.env.local 写 MOSS_API_KEY=，重启工作台后可以一键把口播脚本配成语音。</p></div>`;
  if (state.voices === null) { state.voices = undefined; loadVoices(); }
  const voices = state.voices || [];
  const v = job.voice;
  if (!state.voiceId && v?.voiceId) state.voiceId = v.voiceId; // default to the voice this job already used
  const stale = v && v.copyAt !== c.generatedAt;
  const cost = ((job.voiceChars || 0) / 10000 * 2).toFixed(3);
  return `<div class="panel rise" style="margin-top:14px"><h4>配音 · MOSI（按每段时长生成）</h4>
    <div class="voice-bar">
      <select id="voicePick" ${voices.length ? '' : 'disabled'}>${voices.length ? voices.map(x => `<option value="${esc(x.id)}" ${x.id === state.voiceId ? 'selected' : ''}>${esc(x.name)}</option>`).join('') : `<option>${state.voices === undefined ? '正在读取音色…' : '账号里还没有音色，先到 MOSI 平台设计或克隆一个'}</option>`}</select>
      <button class="btn primary" id="genVoice" ${voices.length && !state.voiceBusy ? '' : 'disabled'}>${icon(I.spark)}${state.voiceBusy ? '正在配音…' : v ? '重新配音' : '生成配音'}</button>
      <span class="path">${job.voiceChars || 0} 字 · 约 ¥${cost}（MOSI ¥2 / 万字）</span>
    </div>
    ${stale ? '<div class="warnbox" style="margin-top:10px">文案已经重新生成，下面的配音还是旧稿，重新配音后再合成。</div>' : ''}
    ${v ? `<div class="vo-clips">${v.items.map(x => `<div class="vo-clip"><b>段 ${x.segment}</b><audio src="${file(job.id, x.file)}" controls preload="none"></audio><span class="cnt ${x.actual > x.duration ? 'over' : ''}">${x.actual}s / ${x.duration}s</span></div>`).join('')}</div><p class="foot-note">音色 ${esc(v.voiceName || v.voiceId)} · ${esc(v.language)} · ${new Date(v.generatedAt).toLocaleString('zh-CN', { hour12: false })}</p>` : ''}
  </div>`;
}

function bindVoice(job, body) {
  const pick = body.querySelector('#voicePick');
  if (pick) {
    if (!state.voiceId && pick.value) state.voiceId = pick.value;
    pick.onchange = () => { state.voiceId = pick.value; localStorage.setItem('studio-voice', pick.value); };
  }
  const btn = body.querySelector('#genVoice');
  if (btn) btn.onclick = async () => {
    const voice = (state.voices || []).find(x => x.id === (pick?.value || state.voiceId));
    if (!voice) return toast('先选一个音色', true);
    state.voiceBusy = true; state.sig.tab = null; renderTabBody(job);
    try { job.voice = await api(`/api/jobs/${job.id}/voice`, { method: 'POST', json: { voiceId: voice.id, voiceName: voice.name } }); toast('配音完成'); }
    catch (err) { toast(err.message, true); }
    state.voiceBusy = false; state.sig.tab = null;
    await refreshJob(job.id).catch(() => {});
  };
}

function finalBlock(job, list) {
  const ready = list.length && list.every(s => job.h3?.[s.index]?.state === 'succeeded');
  if (!ready) return '';
  const f = job.final;
  const canVoice = Boolean(job.voice?.items?.length);
  return `<div class="panel final-cut rise"><h4>完整成片 · ${list.length} 段拼接${canVoice ? ' + 配音' : ''}</h4>
    <div class="toolbar" style="margin:8px 0 0">
      <label class="check ${canVoice ? '' : 'off'}" title="${canVoice ? '配音在上，H3 自带声音压低作底' : '先在「带货文案」生成配音'}"><input type="checkbox" id="finalVoice" ${state.finalVoice && canVoice ? 'checked' : ''} ${canVoice ? '' : 'disabled'}>叠加配音</label>
      <span style="flex:1"></span>
      <button class="btn primary" id="buildFinal" ${state.finalBusy ? 'disabled' : ''}>${icon(I.film)}${state.finalBusy ? '正在合成…' : f ? '重新合成' : '合成完整成片'}</button>
    </div>
    ${f ? `<div class="h3-videos" style="margin:12px 0 0">
      <figure><video src="${file(job.id, f.compare)}" controls playsinline preload="metadata"></video><figcaption>左：原片　右：成片</figcaption></figure>
      <figure><video src="${file(job.id, f.video)}" controls playsinline preload="metadata"></video><figcaption>${f.duration}s${f.voiced ? ` · 配音 ${esc(f.voiceName || '')}` : ''} · <a href="${file(job.id, f.video)}" download>下载 mp4</a>${f.srt ? ` · <a href="${file(job.id, f.srt)}" download>字幕 .srt</a>` : ''}</figcaption></figure>
    </div>` : '<p class="path" style="margin-top:8px">只在本机剪辑拼接，不产生费用。</p>'}
  </div>`;
}

function bindFinal(job, body) {
  const box = body.querySelector('#finalVoice');
  if (box) box.onchange = () => { state.finalVoice = box.checked; };
  const btn = body.querySelector('#buildFinal');
  if (btn) btn.onclick = async () => {
    state.finalBusy = true; state.sig.tab = null; renderTabBody(job);
    try { job.final = await api(`/api/jobs/${job.id}/final`, { method: 'POST', json: { withVoice: state.finalVoice && Boolean(job.voice?.items?.length) } }); toast('完整成片已合成'); }
    catch (err) { toast(err.message, true); }
    state.finalBusy = false; state.sig.tab = null;
    await refreshJob(job.id).catch(() => {});
  };
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

const boardCtx = () => ({ api, toast, esc, file, tc });

// Script jobs have no source video: the whole job page is the storyboard board.
function renderScriptJob(job) {
  renderJobHead(job);
  if (state.sig.scriptJob !== job.id) {
    ['#rail', '#console', '#film'].forEach(sel => $(sel)?.remove());
    const ws = $('.workspace');
    ws.className = 'workspace script';
    ws.innerHTML = '<div id="boardRoot" class="board-root"></div>';
    state.sig.scriptJob = job.id;
    mountBoard($('#boardRoot'), job, boardCtx());
  }
}

async function refreshJob(id) {
  const job = await api(`/api/jobs/${id}`);
  if (!location.hash.includes(id)) return;
  const prev = state.job;
  state.job = job;
  if (job.source.platform === 'script') { renderScriptJob(job); return; }
  renderJobHead(job);
  renderRail(job);
  if (!prev || prev.shots.length !== job.shots.length || prev.director?.generatedAt !== job.director?.generatedAt) renderFilm(job);
  renderPlayer(job);
  renderTabs(job);
  renderTabBody(job);
  clearTimeout(state.poll);
  if (job.running) state.poll = setTimeout(() => refreshJob(id).catch(() => {}), 1500);
  else if (h3Pending(job)) state.poll = setTimeout(() => refreshJob(id).catch(() => {}), 5000);
  else if (prev?.running) loadJobs();
}

/* ───────── router ───────── */
async function route() {
  clearTimeout(state.poll);
  if (unbindGuide) { unbindGuide(); unbindGuide = null; }
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
    if (location.hash.startsWith('#/script')) renderScriptNew(app, boardCtx());
    else if (location.hash.startsWith('#/guide')) renderGuide();
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
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging-files'); } });
window.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging-files'); } });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  dragDepth = 0; document.body.classList.remove('dragging-files');
  if (!hasFiles(e)) return;
  e.preventDefault(); // dropped outside a picker: never let the browser navigate to the file
  if (e.target.closest?.('.picker')) return;
  const imgs = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  if (imgs.length && $('#pickers')) { for (const f of imgs) addPending(autoRole(Object.fromEntries(Object.entries(state.pending).map(([k, v]) => [k, v.length]))), [f]); toast('已放入素材，可拖到别的框里调整'); }
});
document.addEventListener('paste', async e => {
  const imgs = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return;
  if ($('#pickers')) {
    e.preventDefault();
    for (const f of imgs) addPending(autoRole(Object.fromEntries(Object.entries(state.pending).map(([k, v]) => [k, v.length]))), [f]);
    toast('已粘贴到素材');
  } else if (state.job && state.tab === 'assets') {
    e.preventDefault();
    const counts = state.job.assets.reduce((m, a) => ({ ...m, [a.role]: (m[a.role] || 0) + 1 }), {});
    await uploadAsset(state.job, autoRole(counts), imgs[0]);
  }
});
window.addEventListener('resize', () => requestAnimationFrame(moveIndicator));
document.fonts?.ready.then(moveIndicator);
api('/api/health').then(h => { state.health = h; renderEngines(); }).catch(() => {});
route();
