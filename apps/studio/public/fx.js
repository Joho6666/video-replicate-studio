// Interaction layer: parallax, spotlight, magnetic buttons, tilt, scroll reveal, count-up, scroll-lit text.
// Everything is rAF-throttled and disabled under prefers-reduced-motion.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(pointer: fine)').matches;
const lerp = (a, b, t) => a + (b - a) * t;
let cleanups = [];

function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  cleanups.push(() => target.removeEventListener(type, fn, opts));
}

/* hero: pointer parallax + scroll fade/scale */
function hero(root) {
  const heroEl = root.querySelector('.hero');
  if (!heroEl) return;
  const layers = [...heroEl.querySelectorAll('.px')];
  const inner = heroEl.querySelector('.hero-inner');
  const scene = heroEl.querySelector('.scene');
  let tx = 0, ty = 0, x = 0, y = 0, raf = 0, alive = true;
  let inView = true;
  let pageVisible = document.visibilityState !== 'hidden';
  const active = () => alive && inView && pageVisible;
  const pauseScene = paused => scene?.classList.toggle('motion-paused', paused);
  const tick = () => {
    raf = 0;
    if (!active()) { pauseScene(true); return; }
    pauseScene(false);
    x = lerp(x, tx, 0.06); y = lerp(y, ty, 0.06);
    for (const l of layers) {
      const d = Number(l.dataset.depth || 0);
      l.style.transform = `translate(${(-x * d).toFixed(2)}px, ${(-y * d * 0.6).toFixed(2)}px)`;
    }
    const scrollY = window.scrollY;
    const sp = Math.min(scrollY / window.innerHeight, 1);
    // Keep the composer fully usable while it is on screen; fade only once most of the hero is gone.
    const fade = Math.min(Math.max((sp - 0.55) / 0.4, 0), 1);
    if (inner) { inner.style.transform = `translateY(${sp * 36}px) scale(${1 - fade * 0.04})`; inner.style.opacity = String(1 - fade); }
    if (scene) scene.style.transform = `scale(${1.08 + sp * 0.08})`;
    heroEl.style.setProperty('--dim', String(fade * 0.5));
    if (Math.abs(x - tx) > 0.002 || Math.abs(y - ty) > 0.002) raf = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (!active()) {
      pauseScene(true);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      return;
    }
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const visibility = () => { pageVisible = document.visibilityState !== 'hidden'; wake(); };
  on(document, 'visibilitychange', visibility);
  on(window, 'scroll', wake, { passive: true });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0);
      wake();
    }, { threshold: [0, 0.01] });
    io.observe(heroEl);
    cleanups.push(() => io.disconnect());
  }
  on(heroEl, 'pointermove', e => {
    const r = heroEl.getBoundingClientRect();
    tx = (e.clientX - r.left) / r.width - 0.5;
    ty = (e.clientY - r.top) / r.height - 0.5;
    wake();
  });
  on(heroEl, 'pointerleave', () => { tx = 0; ty = 0; wake(); });
  wake();
  cleanups.push(() => { alive = false; pauseScene(true); if (raf) cancelAnimationFrame(raf); });
}

/* cursor spotlight on glass surfaces (sets --mx/--my, CSS paints the glow) */
function spotlight() {
  on(document, 'pointermove', e => {
    const el = e.target.closest?.('.stage, .panel, .why, .shot, .segment, .stat, .gstep, .kpi, .player');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

/* magnetic buttons */
function magnetic(root) {
  for (const el of root.querySelectorAll('.magnetic')) {
    const strength = Number(el.dataset.strength || 0.28);
    on(el, 'pointermove', e => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
    });
    on(el, 'pointerleave', () => { el.style.transform = ''; });
  }
}

/* 3D tilt for library cards */
function tilt(root) {
  for (const el of root.querySelectorAll('.tilt')) {
    const inner = el.querySelector('.thumb') || el;
    on(el, 'pointermove', e => {
      const r = inner.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      inner.style.transform = `perspective(900px) rotateY(${px * 7}deg) rotateX(${-py * 7}deg) translateY(-4px)`;
      inner.style.setProperty('--gx', `${(px + 0.5) * 100}%`);
      inner.style.setProperty('--gy', `${(py + 0.5) * 100}%`);
    });
    on(el, 'pointerleave', () => { inner.style.transform = ''; });
  }
}

/* reveal on scroll + count-up + scroll-lit statement */
function reveal(root) {
  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      en.target.classList.add('in');
      if (en.target.dataset.count !== undefined) countUp(en.target);
      io.unobserve(en.target);
    }
  }, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
  const els = [...root.querySelectorAll('.reveal, [data-count]')];
  els.forEach(el => io.observe(el));
  // Safety net: if the observer never fires (background tab, odd layout), show everything in view anyway.
  const t = setTimeout(() => els.forEach(el => {
    if (el.classList.contains('in')) return;
    const r = el.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0) { el.classList.add('in'); if (el.dataset.count !== undefined) countUp(el); }
  }), 1200);
  cleanups.push(() => clearTimeout(t));
  cleanups.push(() => io.disconnect());
}

export function countUp(el) {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target)) return;
  const suffix = el.dataset.suffix || '';
  if (reduce) { el.textContent = `${target}${suffix}`; return; }
  const start = performance.now(), dur = 1400;
  const step = now => {
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 4);
    el.textContent = `${Math.round(target * eased)}${suffix}`;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function litText(root) {
  const el = root.querySelector('.lit');
  if (!el) return;
  const chars = [...el.querySelectorAll('.ch')];
  let raf = 0;
  const update = () => {
    raf = 0;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = Math.min(Math.max((vh * 0.85 - r.top) / (r.height + vh * 0.35), 0), 1);
    const n = Math.round(p * chars.length);
    chars.forEach((c, i) => c.classList.toggle('on', i < n));
  };
  on(window, 'scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  update();
}

/* nav: condensed state on scroll + sliding active indicator */
function nav() {
  const bar = document.querySelector('.topnav');
  const onScroll = () => bar.classList.toggle('scrolled', window.scrollY > 24);
  on(window, 'scroll', onScroll, { passive: true });
  onScroll();
}
export function moveIndicator() {
  const links = document.querySelector('.links');
  const ind = links?.querySelector('.ind');
  const active = links?.querySelector('a.on');
  if (!ind) return;
  if (!active) { ind.style.opacity = '0'; return; }
  ind.style.opacity = '1';
  ind.style.width = `${active.offsetWidth}px`;
  ind.style.transform = `translateX(${active.offsetLeft}px)`;
}

/** Wraps each character of an element for the scroll-lit effect (keeps <em> accents). */
export function splitChars(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const walk = node => [...node.childNodes].map(n => {
    if (n.nodeType === 3) return [...n.textContent].map(ch => `<span class="ch">${ch}</span>`).join('');
    return `<${n.tagName.toLowerCase()}>${walk(n)}</${n.tagName.toLowerCase()}>`;
  }).join('');
  return walk(tmp);
}

let globalsBound = false;
export function mount(root) {
  for (const c of cleanups) c();
  cleanups = [];
  if (!globalsBound) { globalsBound = true; }
  nav();
  reveal(root);
  litText(root);
  moveIndicator();
  if (reduce) return;
  spotlight();
  hero(root);
  if (fine) { magnetic(document); tilt(root); }
}

/** Re-bind effects for content rendered after mount (library cards, KPIs). */
export function refresh(root) {
  reveal(root);
  if (!reduce && fine) tilt(root);
}

/** Route changes cross-fade when the browser supports View Transitions. */
export async function transition(fn) {
  if (reduce || !document.startViewTransition || document.visibilityState !== 'visible') { fn(); return; }
  const vt = document.startViewTransition(fn);
  vt.ready.catch(() => {}); vt.finished.catch(() => {});
  try { await vt.updateCallbackDone; } catch { /* skipped transition still ran fn */ }
}
