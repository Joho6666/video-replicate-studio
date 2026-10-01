// Portfolio site behaviour: nav, reveal-on-scroll, count-up, card glow, synchronized compare players,
// booking form (client-side only, nothing is sent anywhere). No dependencies.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // nav turns solid after the hero
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('solid', scrollY > 40);
  onScroll(); addEventListener('scroll', onScroll, { passive: true });

  // reveal on scroll
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  $$('.reveal').forEach(el => io.observe(el));

  // count-up numbers
  const countIO = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    countIO.unobserve(e.target);
    const to = Number(e.target.dataset.count), t0 = performance.now(), dur = 1400;
    if (reduce) { e.target.textContent = to; return; }
    const tick = now => { const p = Math.min(1, (now - t0) / dur); e.target.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), { threshold: 0.6 });
  $$('[data-count]').forEach(el => countIO.observe(el));

  // soft glow that follows the pointer on the service cards
  $$('.card').forEach(c => c.addEventListener('pointermove', e => {
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', `${e.clientX - r.left}px`); c.style.setProperty('--my', `${e.clientY - r.top}px`);
  }));

  // hero video: stop when off screen or when the user prefers reduced motion
  const hero = $('.hero-video');
  if (hero) {
    // keep the desired state and re-apply it whenever the video becomes playable (a play() issued
    // before the media is ready, or while the tab was restoring scroll, can otherwise be dropped)
    let heroVisible = true;
    const heroSync = () => { if (reduce || !heroVisible) hero.pause(); else hero.play().catch(() => {}); };
    new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; heroSync(); }).observe(hero);
    ['loadeddata', 'canplay'].forEach(ev => hero.addEventListener(ev, heroSync));
    document.addEventListener('visibilitychange', () => (document.hidden ? hero.pause() : heroSync()));
    heroSync();
  }

  // ---------- synchronized compare players ----------
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const ICON = { play: '<svg viewBox="0 0 14 14"><path d="M3 1.5v11l9-5.5z"/></svg>', pause: '<svg viewBox="0 0 14 14"><path d="M3 1.5h3v11H3zM8 1.5h3v11H8z"/></svg>' };

  $$('[data-compare]').forEach(box => {
    const d = box.dataset;
    box.innerHTML = `
      <div class="pane a"><video muted playsinline preload="metadata" poster="${d.posterA}" src="${d.a}"></video></div>
      <div class="pane b"><video muted playsinline preload="metadata" poster="${d.posterB}" src="${d.b}"></video></div>
      <span class="lab a">${d.la}</span><span class="lab b">${d.lb}</span>
      <div class="handle" role="slider" tabindex="0" aria-label="拖动对比" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></div>
      <div class="bar">
        <button class="play" type="button" aria-label="播放/暂停">${ICON.play}</button>
        <input class="seek" type="range" min="0" max="1000" value="0" aria-label="播放进度">
        <span class="time">0:00 / 0:00</span>
        <button class="mode" type="button">并排</button>
      </div>`;
    const [va, vb] = $$('video', box);
    if (d.pos) [va, vb].forEach(v => (v.style.objectPosition = d.pos));
    const play = $('.play', box), seek = $('.seek', box), time = $('.time', box), handle = $('.handle', box), mode = $('.mode', box);
    let userPaused = false, split = 50;
    const dur = () => Math.min(va.duration || 0, vb.duration || 0) || va.duration || 0;
    const setSplit = p => { split = Math.max(4, Math.min(96, p)); box.style.setProperty('--split', `${split}%`); handle.setAttribute('aria-valuenow', Math.round(split)); };
    setSplit(50);

    const sync = () => { if (Math.abs(vb.currentTime - va.currentTime) > 0.18) vb.currentTime = va.currentTime; };
    const paint = () => { const t = va.currentTime, D = dur(); seek.value = D ? (t / D) * 1000 : 0; time.textContent = `${fmt(t)} / ${fmt(D)}`; };
    const playAll = () => { Promise.all([va.play(), vb.play()]).catch(() => {}); play.innerHTML = ICON.pause; };
    const pauseAll = () => { va.pause(); vb.pause(); play.innerHTML = ICON.play; };
    va.addEventListener('timeupdate', () => { sync(); paint(); if (dur() && va.currentTime >= dur() - 0.05) { va.currentTime = 0; vb.currentTime = 0; } });
    va.addEventListener('loadedmetadata', paint); vb.addEventListener('loadedmetadata', paint);

    play.addEventListener('click', () => { userPaused = !va.paused; va.paused ? playAll() : pauseAll(); });
    seek.addEventListener('input', () => { const t = (seek.value / 1000) * dur(); va.currentTime = t; vb.currentTime = t; paint(); });
    mode.addEventListener('click', () => { const side = box.classList.toggle('side'); mode.textContent = side ? '擦除' : '并排'; });

    // drag the divider (pointer events cover mouse, touch and pen)
    const move = e => { const r = box.getBoundingClientRect(); setSplit(((e.clientX - r.left) / r.width) * 100); };
    handle.addEventListener('pointerdown', e => { handle.setPointerCapture(e.pointerId); handle.addEventListener('pointermove', move); });
    handle.addEventListener('pointerup', () => handle.removeEventListener('pointermove', move));
    handle.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') setSplit(split - 4); if (e.key === 'ArrowRight') setSplit(split + 4); });

    // play while visible (muted), pause when scrolled away or when motion is reduced
    if (!reduce) new IntersectionObserver(([e]) => { if (e.isIntersecting) { if (!userPaused) playAll(); } else pauseAll(); }, { threshold: 0.45 }).observe(box);
  });

  // ---------- showreel: play muted while visible, tap the note to unmute one at a time ----------
  const reels = $$('.reel video');
  reels.forEach(v => {
    const btn = v.parentElement.querySelector('.snd');
    if (!reduce) new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }, { threshold: 0.4 }).observe(v);
    btn.addEventListener('click', () => {
      const on = v.muted; reels.forEach(o => { o.muted = true; o.parentElement.querySelector('.snd').classList.remove('on'); });
      if (on) { v.muted = false; btn.classList.add('on'); v.play().catch(() => {}); }
    });
  });

  // ---------- booking form (demo only) ----------
  const form = $('#bookForm'), hint = $('#formHint');
  form.addEventListener('submit', e => {
    e.preventDefault();
    let ok = true;
    for (const el of $$('[required]', form)) { const bad = !el.value.trim(); el.classList.toggle('invalid', bad); if (bad) ok = false; }
    const link = form.link.value.trim();
    if (link && !/^https?:\/\//i.test(link) && !/douyin|tiktok|bilibili|instagram|xiaohongshu/i.test(link)) { form.link.classList.add('invalid'); ok = false; } else form.link.classList.remove('invalid');
    hint.className = `hint ${ok ? 'ok' : 'err'}`;
    hint.textContent = ok ? '已收到（演示）：本页只在浏览器内校验，没有发送任何数据。正式上线后这里会接入真实的预约渠道。' : '请检查标红的内容：称呼和需求类型必填，链接需是有效的视频网址。';
    if (ok) form.reset();
  });
  form.addEventListener('input', e => e.target.classList.remove('invalid'));
})();
