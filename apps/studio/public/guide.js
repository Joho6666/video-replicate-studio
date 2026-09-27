// 使用教程：图文分步。截图由 scripts/capture_tutorial.py 生成到 /tutorial/*.png。

const img = (name, caption) => `<figure class="shot-fig"><img src="/tutorial/${name}.png" alt="${caption}" loading="lazy" data-zoom onerror="this.closest('figure').classList.add('missing')"><figcaption>${caption}</figcaption></figure>`;
const tip = (text, kind = 'tip') => `<div class="callout ${kind}"><b>${{ tip: '小贴士', warn: '注意', good: '推荐写法' }[kind]}</b><p>${text}</p></div>`;

export const STEPS = [
  {
    id: 'prep', title: '开始前：确认引擎就绪', time: '10 秒',
    body: `
      <p>导航栏右侧的 4 个小圆点是 4 个引擎，<b>绿色 = 就绪，灰色 = 没配置好</b>。鼠标移上去能看到每个引擎的名字。</p>
      ${img('01b-nav', '导航栏：右侧 4 个绿点表示全部就绪')}
      <table class="tbl"><thead><tr><th>引擎</th><th>负责</th><th>灰色时怎么办</th></tr></thead><tbody>
        <tr><td>MediaCrawler</td><td>抓抖音 / B站</td><td>双击 <code>启动复刻Studio.bat</code> 会自动安装；需要先装 uv</td></tr>
        <tr><td>TikHub</td><td>抓 TikTok / Instagram，抖音备用</td><td>在 <code>apps/studio/.env.local</code> 填 <code>TIKHUB_API_KEY</code>，并打开代理（Clash）</td></tr>
        <tr><td>DeepSeek</td><td>看画面、拆解、写提示词和文案</td><td>填 <code>DEEPSEEK_API_KEY</code></td></tr>
        <tr><td>FFmpeg</td><td>切镜头、截关键帧、导出片段</td><td>打包版已内置，正常不会灰</td></tr>
      </tbody></table>
      ${tip('只抓抖音 / B站时，TikHub 灰着也能用；只用本地视频时，前两个灰着都能用。')}`,
  },
  {
    id: 'link', title: '粘贴爆款视频链接', time: '10 秒',
    body: `
      <p>在首页大输入框里粘贴链接。<b>直接复制 App 里的整段分享文案也可以</b>，系统会自动从文字里找出链接，并在右侧显示识别到的平台。</p>
      ${img('01-home', '首页：顶部是 4 步流程，中间是链接输入框和复刻设置')}
      <ul class="checks">
        <li>支持：抖音、B站、TikTok、Instagram（Reels / 帖子视频）</li>
        <li>没有链接？点输入框下方的「用本地视频」直接上传 mp4</li>
        <li>长视频只分析前 60 秒，爆款的钩子和节奏基本都在这里</li>
      </ul>
      ${tip('第一次抓抖音 / B站 会弹出一个 Chrome 窗口，用手机 App 扫码登录一次（建议小号），之后不用再扫。', 'warn')}`,
  },
  {
    id: 'goal', title: '选场景，写「想要的效果」', time: '30 秒',
    body: `
      <p>不知道怎么填，就先点一个<b>场景卡</b>。它会自动填好一段示例，并把这个场景需要的上传框标亮。</p>
      ${img('02-link-template', '选了「剧情短片」：示例文字已填好，需要的素材框被标亮')}
      <table class="tbl"><thead><tr><th>场景</th><th>适合的爆款</th><th>要准备</th></tr></thead><tbody>
        <tr><td>服装上身</td><td>穿搭、试衣、换装</td><td>模特 + 衣服</td></tr>
        <tr><td>商品展示</td><td>开箱、桌面特写、测评</td><td>商品（可以没有模特）</td></tr>
        <tr><td>口播种草</td><td>真人对镜讲解</td><td>模特 + 商品</td></tr>
        <tr><td>剧情短片</td><td>剧情、反转、氛围感</td><td>模特 + 效果参考图</td></tr>
      </tbody></table>
      ${tip('公式：<b>保留</b>原片的什么（节奏 / 运镜 / 走位）+ <b>换成</b>什么（我的模特 / 我的衣服）+ 想要什么<b>感觉</b>（更明亮 / 冬季氛围）。<br>例：「保留原片的转身和运镜节奏，换成我的模特穿米色羽绒服，画面更明亮，适合冬季上新。」', 'good')}`,
  },
  {
    id: 'assets', title: '拖入模特、衣服和参考图', time: '30 秒',
    body: `
      <p>把图片从桌面<b>直接拖进对应的框</b>，也可以点击选择，或者截图后按 <kbd>Ctrl</kbd>+<kbd>V</kbd> 粘贴（先进模特，模特有了再进衣服 / 商品）。每张图会自动编号，提示词里就用这个编号指代它。</p>
      ${img('03-pickers', '上传后：每张图左下角显示它在提示词里的编号')}
      <table class="tbl"><thead><tr><th>框</th><th>数量</th><th>编号</th><th>AI 怎么用</th></tr></thead><tbody>
        <tr><td>你的模特</td><td>1 张</td><td><code>@Image1</code></td><td>替换原片人物的脸、发型、身材</td></tr>
        <tr><td>衣服 / 商品</td><td>最多 3 张</td><td><code>@Image2</code> 起</td><td>第一张是主图，其余当补充角度；衣服全程穿在模特身上</td></tr>
        <tr><td>效果参考（可选）</td><td>最多 3 张</td><td>顺延</td><td>只借用光线、色调、氛围，不照搬里面的人和物</td></tr>
      </tbody></table>
      ${tip('模特图：正脸清晰、光线均匀、最好全身。衣服图：平铺或模特穿着的正面图，背面和细节放第 2、3 张。')}
      ${tip('商品卖点框里写的内容是 AI <b>唯一</b>会用的卖点来源。没写的功效、材质、价格，AI 不会编。', 'warn')}
      <p>全部可以留空，点「开始分析」后也能在结果页的「素材与导出」里补传，补完点「保存并重新编译提示词」即可。</p>`,
  },
  {
    id: 'run', title: '开始分析，等待约 1 分钟', time: '约 1 分钟',
    body: `
      <p>点「开始分析」后会进入结果页，顶部 4 个步骤依次变绿：</p>
      ${img('04b-rail', '4 个步骤全部完成')}
      <ol class="steps-ol">
        <li><b>抓取原片</b>：下载无水印原视频和点赞、评论等数据</li>
        <li><b>解析媒体</b>：读取分辨率、时长、帧率</li>
        <li><b>镜头切分</b>：自动识别剪辑点，每个镜头截一张关键帧，按 15 秒分段</li>
        <li><b>导演拆解</b>：AI 逐帧看片，写中文拆解和英文提示词</li>
      </ol>
      ${img('05-film', '镜头胶片：点任意一帧，左侧播放器跳到那个镜头；上方橙色括号是生成分段')}
      ${tip('某一步变红时，上面会写原因，修好后点「重试这一步」，不用从头再来。', 'warn')}`,
  },
  {
    id: 'read', title: '读懂拆解结果', time: '2 分钟',
    body: `
      <p>「爆款拆解」页先回答两件事：<b>你想要的效果怎么实现</b>，以及<b>你上传的每张图 AI 看到了什么、打算怎么用</b>。</p>
      ${img('06-overview-goal', '想要的效果 → 实现方案：具体到哪几段是重点')}
      ${img('06b-asset-notes', '素材解读：逐张说明，效果参考图会注明「只取光感」')}
      <p>下面是原片为什么会火：前三秒钩子、叙事结构、剪辑节奏、画面风格和 3 个爆点。</p>
      ${img('06c-hook', '前三秒钩子')}
      <p>「分镜」页列出每个镜头的景别、运镜、画面描述、单镜头英文提示词，以及复刻时要替换什么。</p>
      ${img('07-shot', '单个镜头：点缩略图可以预览原片')}`,
  },
  {
    id: 'prompt', title: '复制 LibTV 提示词', time: '1 分钟',
    body: `
      <p>「LibTV 提示词」页按 15 秒一段给出英文提示词（Seedance 单次最多生成 15 秒）。每段上方列出这一段要上传的素材和编号。</p>
      ${img('08-libtv-toolbar', '顶部工具栏：引用格式切换、复制全部、下载 .md、素材包')}
      ${img('08b-segment', '一段提示词：先是全局约束，再按秒写每个节拍，编号高亮')}
      <ul class="checks">
        <li><b>引用格式</b>：LibTV 中文界面用 <code>@图片1</code>，英文界面用 <code>@Image1</code>，Wan 用 <code>Image 1</code>，切换后复制的内容会跟着变</li>
        <li>每个节拍都点名了模特和衣服，确保换装从第一帧到最后一帧都生效</li>
        <li>页面顶部如果出现黄色提醒（比如某张图没被用到），可以补充说明后重新编译</li>
      </ul>`,
  },
  {
    id: 'copy', title: '生成带货文案（可选）', time: '10 秒',
    body: `
      <p>「带货文案」页选好风格（种草 / 测评 / 促销 / 剧情）和平台，点「生成文案」，大约 5 秒出一整套：</p>
      ${img('09-copy-titles', '5 条标题 + 3 句开头钩子，每条都能单独复制')}
      ${img('09b-voiceover', '口播脚本按段计时：绿条表示念得完，变红就是太长')}
      ${tip('会自动检查「最、第一、100%」这类广告法敏感词，并指出是哪一句。字幕可以一键复制成 SRT，直接导入剪映。')}`,
  },
  {
    id: 'export', title: '导出素材包，去 LibTV 出片', time: '每段约 3 分钟',
    body: `
      <p>在「素材与导出」页点「生成素材包」，再点「打开文件夹」：</p>
      ${img('10b-export', '生成素材包 / 打开文件夹')}
      <pre class="tree">export/
├─ 参考片段/        段1_14.1s.mp4  段2_14.1s.mp4 …   ← 每段的 @视频1
├─ 替换素材/        图片1_模特.jpg  图片2_衣服商品.jpg  图片3_效果参考.jpg
├─ LibTV提示词.md   每段提示词 + 上传对照表
├─ 分镜拆解.md
└─ 带货文案.md</pre>
      <p><b>在 LibTV 里逐段生成：</b></p>
      <ol class="steps-ol">
        <li>新建视频生成，模型选 Seedance 2.0，时长选这一段的秒数（≤15 秒），画幅和原片一致</li>
        <li>上传这一段的参考片段作为 <code>@视频1</code></li>
        <li>按编号依次上传 <code>替换素材/</code> 里的图片（图片1 = 模特，图片2 = 衣服 / 商品 …）</li>
        <li>粘贴这一段的提示词（引用格式选 <code>@图片1</code>），生成</li>
        <li>满意就下载，不满意改一两句再生成；所有段都做完后，在剪映里按段序拼接，导入 SRT 字幕和口播</li>
      </ol>
      ${tip('先只生成第 1 段确认人物和衣服对不对，再做后面几段，最省额度。', 'good')}`,
  },
  {
    id: 'faq', title: '常见问题', time: '',
    body: `
      <details><summary>抓取失败 / 超时怎么办？</summary><p>抖音、B站：多半是登录过期，删掉 <code>apps/media-crawler/browser_data/</code> 重新扫码。TikTok、Instagram：检查代理是否开着，端口是否是 7890。实在抓不到，可以先用别的工具下载视频，再「用本地视频」上传。</p></details>
      <details><summary>换了模特图，提示词没变？</summary><p>上传或删除素材后，需要在「素材与导出」点「保存并重新编译提示词」，大约 30 秒。</p></details>
      <details><summary>生成的人还是原片那个人？</summary><p>换一张更清晰的正脸模特图；在想要的效果里强调「全程换成我的模特」；并确认 LibTV 里上传的图片编号和提示词里的一致。</p></details>
      <details><summary>要花多少钱？</summary><p>抓取、切镜免费；每次 AI 拆解约 1–3 万 token，文案约 2 千 token，合计几分钱。真正花钱的是在 LibTV 里生成视频，按 LibTV 的计费。</p></details>
      <details><summary>能分析多长的视频？</summary><p>默认只分析前 60 秒（可在 <code>.env.local</code> 的 <code>ANALYZE_MAX_SEC</code> 调到最多 180 秒）。超过 15 秒的会自动分成多段。</p></details>`,
  },
];

export function guideHtml() {
  return `
  <section class="guide-hero"><span class="tag rise">使用教程</span>
    <h1 class="rise" style="--i:1">10 分钟上手：<br>从一条爆款到<em>能出片的提示词</em></h1>
    <p class="guide-sub rise" style="--i:2">跟着下面 ${STEPS.length - 1} 步做一遍。截图来自一次真实操作：参考视频是抖音夜景清唱，换成童话风模特和粉色连衣裙。</p>
  </section>
  <div class="guide-layout">
    <nav class="toc" id="toc">${STEPS.map((s, i) => `<a href="#g-${s.id}" data-step="${s.id}"><b>${s.id === 'faq' ? '?' : String(i).padStart(2, '0')}</b><span>${s.title}</span></a>`).join('')}
      <a class="btn ink toc-cta" href="#/new">开始第一条 →</a></nav>
    <article class="guide-body">${STEPS.map((s, i) => `
      <section class="gsec" id="g-${s.id}">
        <header><span class="num">${s.id === 'faq' ? '?' : String(i).padStart(2, '0')}</span><h2>${s.title}</h2>${s.time ? `<span class="time">${s.time}</span>` : ''}</header>
        ${s.body}
      </section>`).join('')}
      <div class="guide-end"><h3>准备好了？</h3><p>粘一条你最想复刻的爆款，按上面的步骤走一遍。</p><a class="btn ink magnetic" href="#/new">开始第一条 →</a></div>
    </article>
  </div>
  <div class="lightbox" id="lightbox" hidden><img alt=""></div>`;
}

/** TOC highlight while scrolling, in-page anchors, click-to-zoom screenshots. */
export function bindGuide(root) {
  const links = [...root.querySelectorAll('.toc a[data-step]')];
  links.forEach(a => { a.onclick = e => { e.preventDefault(); root.querySelector(a.getAttribute('href')).scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
  const io = new IntersectionObserver(entries => {
    for (const en of entries) if (en.isIntersecting) links.forEach(a => a.classList.toggle('on', a.dataset.step === en.target.id.slice(2)));
  }, { rootMargin: '-35% 0px -60% 0px' });
  root.querySelectorAll('.gsec').forEach(s => io.observe(s));
  const box = root.querySelector('#lightbox');
  root.querySelectorAll('[data-zoom]').forEach(im => { im.onclick = () => { box.querySelector('img').src = im.src; box.hidden = false; }; });
  box.onclick = () => { box.hidden = true; };
  const esc = e => { if (e.key === 'Escape') box.hidden = true; };
  document.addEventListener('keydown', esc);
  return () => { io.disconnect(); document.removeEventListener('keydown', esc); };
}
