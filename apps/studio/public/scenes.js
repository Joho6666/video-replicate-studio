// Hero scenes — hand-built SVG illustration (no image assets): a golden-hour valley for
// light mode, a bioluminescent jellyfish for dark mode. Built for print-poster-grade detail:
// atmospheric perspective (far = cooler/hazier, near = warmer/sharper), layered bloom via
// stacked blur+screen passes rather than a single glow, rim/backlight on silhouette edges,
// curated (not random-hue) palettes, and painterly cloud/canopy clusters instead of flat
// primitives. All motion stays on the existing .px[data-depth] parallax rig (fx.js) and the
// .sway/.drift/.jelly/.tent keyframes (styles.css), plus a few new ones added alongside them.

function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
const lerp = (a, b, t) => a + (b - a) * t;

/* ───────────────────────── light scene: golden-hour valley ───────────────────────── */

// Birds stay as silhouettes — at this distance a real bird is only a dark chevron, so vector
// reads as photographic. A small flock crosses the valley now and then; each bird flaps on
// its own rhythm so the group never moves like one stamped shape.
const BIRD = 'M-10 0 Q-5 -5.5 0 0 Q5 -5.5 10 0';
function flock() {
  const r = rng(577);
  const slots = [[0, 0], [-26, -9], [-24, 11], [-52, -17], [-50, 19], [-80, -25], [-74, 4]];
  const birds = slots.map(([dx, dy], i) => {
    const s = (0.9 + r() * 0.5).toFixed(2);
    return `<g transform="translate(${dx + (r() - 0.5) * 8} ${dy + (r() - 0.5) * 6}) scale(${s})"><g class="bird-bob" style="--motion-delay:${(-r() * 3).toFixed(2)}s"><path class="bird-flap" d="${BIRD}" style="--flap:${(0.52 + r() * 0.2).toFixed(2)}s;--motion-delay:${(-r()).toFixed(2)}s"/></g></g>`;
  }).join('');
  return `<g class="flock scene-micro" fill="none" stroke="#3b2c28" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity=".62">${birds}</g>`;
}
function gliders() {
  return [[330, 250, .55, -3], [1180, 230, .42, -11]].map(([x, y, s, d]) =>
    `<g transform="translate(${x} ${y}) scale(${s})"><g class="glider" style="--motion-delay:${d}s"><path d="${BIRD}" fill="none" stroke="#4a3a34" stroke-width="2" stroke-linecap="round" opacity=".5"/></g></g>`).join('');
}

// Lens flare: ghosts sit on the line from the sun through frame centre, like a real lens.
// Each carries a different parallax depth (some negative), so they slide along that line
// against the pointer exactly the way optical ghosts do.
function lensFlare() {
  const sun = [1450, 344], c = [800, 500];
  const at = t => [sun[0] + (c[0] - sun[0]) * t, sun[1] + (c[1] - sun[1]) * t];
  const hex = (x, y, rad) => Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 6 + i * Math.PI / 3;
    return `${(x + Math.cos(a) * rad).toFixed(1)},${(y + Math.sin(a) * rad).toFixed(1)}`;
  }).join(' ');
  const ghosts = [
    [0.42, 14, 'hex', '#ffd79a', .22, 5],
    [0.78, 34, 'disc', '#ffc6a0', .1, -4],
    [1.12, 22, 'hex', '#b9e0d6', .13, -12],
    [1.55, 58, 'ring', '#ffd9b0', .12, -20],
    [1.9, 16, 'disc', '#f4b3c2', .14, -28],
  ];
  const g = ghosts.map(([t, rad, kind, col, op, depth]) => {
    const [x, y] = at(t);
    const shape = kind === 'hex' ? `<polygon points="${hex(x, y, rad)}" fill="${col}"/>`
      : kind === 'ring' ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad}" fill="none" stroke="${col}" stroke-width="3"/>`
      : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad}" fill="${col}" fill-opacity=".4" stroke="${col}" stroke-opacity=".8" stroke-width="1.5"/>`;
    return `<g class="px" data-depth="${depth}" opacity="${op}">${shape}</g>`;
  }).join('');
  return `<g class="lens-flare scene-macro" style="mix-blend-mode:screen">
    <ellipse class="flare-streak" cx="${sun[0]}" cy="${sun[1]}" rx="560" ry="2.6" fill="url(#flareStreak)"/>
    <circle cx="${sun[0]}" cy="${sun[1]}" r="46" fill="url(#flareCore)"/>
    ${g}
  </g>`;
}

// Curated sunset-adjacent palette (terracotta / dusty rose / plum / cream / sage) instead of
// arbitrary saturated hues — this is what keeps a scatter of 300 shapes reading as "designed."
function flowerField() {
  const r = rng(42);
  const palette = ['#c96a3e', '#d98a5e', '#8b5a6b', '#e7b9a8', '#f4ece0', '#6f7a4a', '#b3487a'];
  let out = '';
  for (let i = 0; i < 420; i++) {
    const t = Math.pow(r(), 0.72);
    const y = 800 + t * 210;
    const x = r() * 1600;
    const depth = (y - 800) / 210;
    const s = 1.4 + depth * 7.2 * (0.55 + r() * 0.5);
    const c = palette[Math.floor(r() * palette.length)];
    const op = (0.5 + depth * 0.4 + r() * 0.1).toFixed(2);
    out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${s.toFixed(1)}" ry="${(s * 0.7).toFixed(1)}" fill="${c}" opacity="${op}"/>`;
    if (s > 5 && r() > 0.55) out += `<path d="M${x.toFixed(1)} ${(y + s * 0.6).toFixed(1)} q2 ${(s * 2).toFixed(1)} -1 ${(s * 3.2).toFixed(1)}" stroke="#3d4a26" stroke-width="1.1" fill="none" opacity=".55"/>`;
    // Rare catchlight — a tiny bright dot beside a nearby bloom, like dew catching the sun.
    if (depth > 0.6 && r() > 0.92) out += `<circle class="spark scene-micro" cx="${(x + s * 1.6).toFixed(1)}" cy="${(y - s * 0.4).toFixed(1)}" r="${(0.8 + r()).toFixed(1)}" fill="#fff3df" opacity="${(0.5 + r() * 0.4).toFixed(2)}" style="--motion-delay:${(-r() * 3).toFixed(2)}s"/>`;
  }
  return out;
}

function grassField() {
  const r = rng(7);
  let out = '';
  for (let i = 0; i < 300; i++) {
    const x = r() * 1600, y = 840 + r() * 170, h = 18 + r() * 46;
    const bend = r() * 14 - 7;
    out += `<path d="M${x.toFixed(0)} ${y.toFixed(0)} q${(bend * 0.7).toFixed(1)} ${(-h / 2).toFixed(0)} ${bend.toFixed(1)} ${(-h).toFixed(0)}" stroke="${r() > 0.5 ? '#4a5c2a' : '#6d7f3c'}" stroke-width="${(1 + r() * 1.6).toFixed(1)}" fill="none" opacity=".8"/>`;
  }
  return out;
}

// Overlapping-circle canopy reads as foliage far better than one flat circle.
function tree(cx, cy, scale) {
  const puffs = [[-14, -6, 20], [12, -10, 22], [0, -20, 19], [-6, 2, 16], [16, 4, 15]];
  const canopy = puffs.map(([dx, dy, r]) => `<circle cx="${(cx + dx * scale).toFixed(1)}" cy="${(cy + dy * scale).toFixed(1)}" r="${(r * scale).toFixed(1)}"/>`).join('');
  return `<g fill="#3f3021">${canopy}</g><g fill="#5a4228" opacity=".85"><circle cx="${(cx - 2).toFixed(1)}" cy="${(cy + 6 * scale).toFixed(1)}" r="${(13 * scale).toFixed(1)}"/></g>
  <rect x="${(cx - 3).toFixed(1)}" y="${(cy + 10 * scale).toFixed(1)}" width="${(6 * scale).toFixed(1)}" height="${(28 * scale).toFixed(1)}" fill="#2c2015"/>`;
}

// Low rounded bush — same overlapping-circle logic as tree() but wide/short, no trunk. Used
// to close the flat gap between the rock silhouette and the meadow so the mid-ground doesn't
// read as empty haze.
function shrub(r, cx, cy, scale, fill) {
  const n = 4 + Math.floor(r() * 2);
  let out = `<g fill="${fill}">`;
  for (let i = 0; i < n; i++) {
    const dx = (r() - 0.5) * 24 * scale, dy = (r() - 0.5) * 8 * scale - 3;
    out += `<circle cx="${(cx + dx).toFixed(1)}" cy="${(cy + dy).toFixed(1)}" r="${((9 + r() * 6) * scale).toFixed(1)}"/>`;
  }
  return out + `</g>`;
}

// Bridges the rock -> meadow transition: a soft rolling foothill line, warm-to-olive, dotted
// with shrub clusters and a few grounding pebbles so that band carries real texture instead
// of plain haze.
function foothillBand() {
  const r = rng(58);
  const fills = ['#6d6a3f', '#7c7645', '#5c6a3a'];
  let shrubs = '';
  for (let i = 0; i < 22; i++) {
    const x = 40 + r() * 1520;
    const y = 700 + r() * 70 - Math.abs(x - 800) * 0.02;
    shrubs += shrub(r, x, y, 0.6 + r() * 0.7, fills[Math.floor(r() * fills.length)]);
  }
  let pebbles = '';
  for (let i = 0; i < 14; i++) {
    const x = r() * 1600, y = 745 + r() * 40, rx = 4 + r() * 7;
    pebbles += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${(rx * 0.6).toFixed(1)}" fill="#5a5240" opacity="${(0.35 + r() * 0.3).toFixed(2)}"/>`;
  }
  return `<path d="M0 760 C220 710 460 745 700 715 C940 688 1180 730 1420 705 C1500 697 1560 706 1600 712 L1600 830 L0 830Z" fill="url(#foothill)"/>${pebbles}${shrubs}`;
}

// Soft tonal clumps to break up the meadow's flat 2-stop fill — irregular, low-opacity,
// slightly varied greens rather than a distinct new shape vocabulary.
function meadowClumps() {
  const r = rng(71);
  const tones = ['#88a23c', '#5f7a2c', '#3f5a20'];
  let out = '';
  for (let i = 0; i < 46; i++) {
    const x = r() * 1600, y = 840 + r() * 150;
    const rx = 40 + r() * 90, ry = rx * (0.22 + r() * 0.1);
    out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${tones[Math.floor(r() * tones.length)]}" opacity="${(0.1 + r() * 0.14).toFixed(2)}"/>`;
  }
  return out;
}

// Foreground stones anchor the very front edge with tactile, close-up detail.
function stones() {
  const r = rng(84);
  let out = '';
  for (let i = 0; i < 10; i++) {
    const x = r() * 1600, y = 945 + r() * 45, s = 8 + r() * 14;
    out += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
      <ellipse rx="${s.toFixed(1)}" ry="${(s * 0.62).toFixed(1)}" fill="#5a5240"/>
      <path d="M${(-s * 0.5).toFixed(1)} ${(-s * 0.2).toFixed(1)} Q0 ${(-s * 0.5).toFixed(1)} ${(s * 0.5).toFixed(1)} ${(-s * 0.1).toFixed(1)}" stroke="#8a8064" stroke-width="${(s * 0.18).toFixed(1)}" fill="none" opacity=".6" stroke-linecap="round"/>
    </g>`;
  }
  return out;
}

// Faint serrated tree-line along part of the far ridge so the horizon doesn't read as a bare
// smooth silhouette — stays under the far-ridge blur, so it settles in as texture, not detail.
function farTreeline() {
  const r = rng(19);
  let d = 'M40 592';
  for (let x = 40; x < 480; x += 10) d += ` L${x} ${592 - r() * 16}`;
  let d2 = 'M1040 560';
  for (let x = 1040; x < 1560; x += 10) d2 += ` L${x} ${560 - r() * 18}`;
  return `<path d="${d}" stroke="#8f8aa8" stroke-width="3" fill="none" opacity=".5"/><path d="${d2}" stroke="#8f8aa8" stroke-width="3" fill="none" opacity=".5"/>`;
}


// Backlit pollen: tiny warm specks drifting up through the sun side of the valley. Radial
// fills (not blur filters) keep this cheap enough to run on every frame.
function pollen() {
  const r = rng(733);
  let out = '';
  for (let i = 0; i < 46; i++) {
    const nearSun = r() > 0.35;
    const x = nearSun ? 780 + r() * 820 : r() * 1600;
    const y = 420 + r() * 520;
    const rad = 0.9 + Math.pow(r(), 2.4) * 3.6;
    const dur = (14 + r() * 16).toFixed(1);
    const dx = ((r() - 0.3) * 90).toFixed(0);
    const dy = (-(60 + r() * 140)).toFixed(0);
    out += `<circle class="pollen scene-micro" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${rad.toFixed(1)}" fill="url(#pollenDot)" style="--motion-delay:${(-r() * 30).toFixed(1)}s;--d:${dur}s;--dx:${dx}px;--dy:${dy}px;--o:${(0.45 + r() * 0.5).toFixed(2)}"/>`;
  }
  return out;
}

export const lightScene = () => `
<svg class="light-scene scene-svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <radialGradient id="valleySunGlow" cx=".86" cy=".39" r=".56">
      <stop offset="0" stop-color="#fff8dd" stop-opacity=".82"/><stop offset=".12" stop-color="#ffe4a8" stop-opacity=".46"/>
      <stop offset=".42" stop-color="#ffc982" stop-opacity=".16"/><stop offset="1" stop-color="#ffc982" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="valleyHorizonHaze" x1="0" y1="0" x2="0" y2="1">
      <stop offset=".34" stop-color="#fff1d1" stop-opacity="0"/><stop offset=".58" stop-color="#ffe2b7" stop-opacity=".3"/>
      <stop offset=".78" stop-color="#eabf9d" stop-opacity=".08"/><stop offset="1" stop-color="#1b2415" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="valleyTextLift" cx=".5" cy=".43" r=".5"><stop offset="0" stop-color="#fff4df" stop-opacity=".22"/><stop offset=".6" stop-color="#fff4df" stop-opacity=".06"/><stop offset="1" stop-color="#fff4df" stop-opacity="0"/></radialGradient>
    <radialGradient id="valleyVignette" cx=".5" cy=".42" r=".78"><stop offset=".58" stop-color="#0d120b" stop-opacity="0"/><stop offset="1" stop-color="#10150c" stop-opacity=".38"/></radialGradient>
    <radialGradient id="flareCore"><stop offset="0" stop-color="#fffdf3"/><stop offset=".25" stop-color="#fff1c8" stop-opacity=".7"/><stop offset="1" stop-color="#ffd48a" stop-opacity="0"/></radialGradient>
    <linearGradient id="flareStreak" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffe7b8" stop-opacity="0"/><stop offset=".5" stop-color="#fff6de" stop-opacity=".85"/><stop offset="1" stop-color="#ffe7b8" stop-opacity="0"/></linearGradient>
    <filter id="valleyRayBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
    <filter id="valleyHazeBlur" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
    <filter id="meadowWind" x="-4%" y="-10%" width="108%" height="120%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency=".006 .022" numOctaves="2" seed="7" result="noise"/>
      <feOffset in="noise" dx="0" dy="0" result="wind">
        <animate attributeName="dx" values="0;-140;-40;-180;0" keyTimes="0;.3;.5;.8;1" dur="26s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/>
      </feOffset>
      <feDisplacementMap in="SourceGraphic" in2="wind" scale="10" xChannelSelector="R" yChannelSelector="G">
        <animate attributeName="scale" values="6;15;8;13;6" dur="11s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/>
      </feDisplacementMap>
    </filter>
    <linearGradient id="meadowFadeG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".22" stop-color="#fff"/><stop offset="1" stop-color="#fff"/></linearGradient>
    <mask id="meadowMask" maskUnits="userSpaceOnUse" x="-40" y="700" width="1680" height="340"><rect x="-40" y="700" width="1680" height="340" fill="url(#meadowFadeG)"/></mask>
    <radialGradient id="pollenDot"><stop offset="0" stop-color="#fffbe8"/><stop offset=".35" stop-color="#ffe2a0" stop-opacity=".75"/><stop offset="1" stop-color="#ffc774" stop-opacity="0"/></radialGradient>
    <linearGradient id="gustG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff2cf" stop-opacity="0"/><stop offset=".5" stop-color="#fff2cf" stop-opacity=".9"/><stop offset="1" stop-color="#fff2cf" stop-opacity="0"/></linearGradient>
    <!-- Sky-only mask: traces the cloud band with a wide margin off the rock face and ridges,
         so the drifting copies never drag solid terrain along with them. -->
    <!-- Feathered by stacking translucent strokes instead of a blur filter: same soft edge,
         but nothing to re-filter every frame while the copies move underneath. -->
    <mask id="skyMask" maskUnits="userSpaceOnUse" x="-80" y="-80" width="1760" height="480">
      <polygon points="-60,-60 1660,-60 1660,245 1500,265 1300,285 900,295 610,285 520,245 450,165 360,88 270,34 -60,18" fill="#fff" fill-opacity="1" stroke="#fff" stroke-opacity=".3" stroke-width="4" stroke-linejoin="round"/><polygon points="-60,-60 1660,-60 1660,245 1500,265 1300,285 900,295 610,285 520,245 450,165 360,88 270,34 -60,18" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="16" stroke-linejoin="round"/><polygon points="-60,-60 1660,-60 1660,245 1500,265 1300,285 900,295 610,285 520,245 450,165 360,88 270,34 -60,18" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="28" stroke-linejoin="round"/><polygon points="-60,-60 1660,-60 1660,245 1500,265 1300,285 900,295 610,285 520,245 450,165 360,88 270,34 -60,18" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="40" stroke-linejoin="round"/><polygon points="-60,-60 1660,-60 1660,245 1500,265 1300,285 900,295 610,285 520,245 450,165 360,88 270,34 -60,18" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="52" stroke-linejoin="round"/>
    </mask>
  </defs>

  <!-- The photographic base carries the mountain and meadow detail. SVG remains responsible
       for motion, lighting and the subtle atmospheric treatment. -->
  <g class="px scene-macro valley-base" data-depth="2">
    <g class="valley-base-drift">
      <image href="/assets/hero-valley-golden.webp" x="-18" y="-12" width="1636" height="1024" preserveAspectRatio="xMidYMid slice"/>
      <!-- Cinemagraph clouds: two copies of the sky slide left and cross-fade half a cycle
           apart, so the photo's own clouds drift continuously without a visible loop point. -->
      <g class="sky-flow-wrap" mask="url(#skyMask)">
        <g class="sky-flow sky-flow-a"><image href="/assets/hero-valley-golden.webp" x="-18" y="-12" width="1636" height="1024" preserveAspectRatio="xMidYMid slice"/></g>
        <g class="sky-flow sky-flow-b"><image href="/assets/hero-valley-golden.webp" x="-18" y="-12" width="1636" height="1024" preserveAspectRatio="xMidYMid slice"/></g>
      </g>
      <!-- Same photo, masked to the flower field and pushed through animated noise, so the
           real flowers ripple in the wind instead of vector stand-ins doing the work. -->
      <g class="meadow-wind fx-heavy" mask="url(#meadowMask)">
        <image href="/assets/hero-valley-golden.webp" x="-18" y="-12" width="1636" height="1024" preserveAspectRatio="xMidYMid slice" filter="url(#meadowWind)"/>
      </g>
    </g>
  </g>

  <!-- A low-alpha grade unifies the generated base with the rest of the interface. -->
  <rect width="1600" height="1000" fill="#f5c892" opacity=".08" style="mix-blend-mode:soft-light"/>

  <!-- Slow rays are deliberately soft so they read as atmosphere rather than vector shapes. -->
  <g class="px scene-macro ray-sweep fx-heavy" data-depth="3" filter="url(#valleyRayBlur)" opacity=".24" style="mix-blend-mode:screen">
    <g class="ray-drift">
      ${[-12, 0, 12, 24].map((a, i) => `<polygon points="1380,380 ${1380 + Math.cos((155 + a) * Math.PI / 180) * 900},${380 + Math.sin((155 + a) * Math.PI / 180) * 900} ${1380 + Math.cos((169 + a) * Math.PI / 180) * 900},${380 + Math.sin((169 + a) * Math.PI / 180) * 900}" fill="#fff3d6" opacity="${(0.36 - i * 0.06).toFixed(2)}"/>`).join('')}
    </g>
  </g>

  <rect class="sun-breath" width="1600" height="1000" fill="url(#valleySunGlow)"/>
  ${lensFlare()}
  <rect y="390" width="1600" height="470" fill="url(#valleyHorizonHaze)"/>

  <g class="px scene-micro" data-depth="4">${gliders()}</g>
  <g class="px scene-micro" data-depth="6"><g class="flock-path">${flock()}</g></g>

  <!-- Haze layer follows the far valley and moves less than the foreground. -->
  <g class="px scene-macro valley-mist valley-mist-a fx-heavy" data-depth="7" opacity=".36" filter="url(#valleyHazeBlur)">
    <g class="mist-drift mist-drift-a">
      <ellipse cx="790" cy="600" rx="500" ry="86" fill="#f9dfc4"/>
      <ellipse cx="1090" cy="660" rx="320" ry="54" fill="#f4cda9" opacity=".45"/>
    </g>
  </g>
  <g class="px scene-macro valley-mist valley-mist-b fx-heavy" data-depth="9" opacity=".22" filter="url(#valleyHazeBlur)">
    <g class="mist-drift mist-drift-b">
      <path d="M-80 694 C220 624 450 680 710 646 C940 614 1160 660 1710 600 L1710 742 C1320 710 1010 736 730 716 C420 694 200 758 -80 730Z" fill="#fff0d0"/>
    </g>
  </g>

  <!-- A band of warm light rolls across the meadow, reading as a gust bending the grass. -->
  <g class="px scene-macro" data-depth="18" style="mix-blend-mode:soft-light">
    <rect class="meadow-gust" x="-700" y="760" width="620" height="260" fill="url(#gustG)"/>
  </g>
  <g class="px scene-micro" data-depth="12">${pollen()}</g>

  <!-- Center lift keeps black headline text readable while leaving the landscape visible. -->
  <rect class="valley-text-lift" width="1600" height="1000" fill="url(#valleyTextLift)"/>

  <rect width="1600" height="1000" fill="url(#valleyVignette)"/>
</svg>`;

/* ───────────────────────── dark scene: bioluminescent jellyfish ───────────────────────── */

function tentacles() {
  const r = rng(11);
  let out = '';
  for (let i = 0; i < 16; i++) {
    const x0 = 1010 + i * 16 + r() * 8;
    const len = 380 + r() * 360;
    let d = `M${x0} 470`;
    const pts = [[x0, 470]];
    let x = x0, y = 470;
    const steps = 7;
    for (let s = 0; s < steps; s++) {
      const dy = len / steps;
      const dx = (r() - 0.5) * 52;
      d += ` q${(dx * 1.5).toFixed(0)} ${(dy / 2).toFixed(0)} ${dx.toFixed(0)} ${dy.toFixed(0)}`;
      x += dx; y += dy; pts.push([x, y]);
    }
    const w = i % 4 === 0 ? 5 : 1 + r() * 2.2;
    const op = (0.4 + r() * 0.5).toFixed(2);
    out += `<path class="tent scene-micro" d="${d}" stroke="url(#tentg)" stroke-width="${w.toFixed(1)}" fill="none" stroke-linecap="round" opacity="${op}"/>`;
    // bioluminescent nodes along ~1/3 of tentacles
    if (r() > 0.62) {
      const [nx, ny] = pts[3 + Math.floor(r() * 3)];
      out += `<circle class="node-pulse scene-micro" cx="${nx.toFixed(0)}" cy="${ny.toFixed(0)}" r="${(1.6 + r() * 1.6).toFixed(1)}" fill="#ffcdb8" filter="url(#glow2)" style="--motion-delay:${(-r() * 3).toFixed(2)}s"/>`;
    }
  }
  return out;
}

function motes() {
  const r = rng(99);
  const hues = ['#ff5a3c', '#ffb066', '#ff8aa8', '#ff5a3c'];
  let out = '';
  for (let i = 0; i < 60; i++) {
    const hero = r() > 0.88;
    const rad = hero ? 3 + r() * 3.5 : 0.6 + r() * 1.6;
    const delay = (-r() * 12).toFixed(2);
    const style = hero ? `--motion-delay:${delay}s;mix-blend-mode:screen` : `--motion-delay:${delay}s`;
    out += `<circle class="mote scene-micro${hero ? ' focal-mote' : ''}" cx="${(r() * 1600).toFixed(0)}" cy="${(r() * 1000).toFixed(0)}" r="${rad.toFixed(1)}" fill="${hues[Math.floor(r() * hues.length)]}" opacity="${(0.15 + r() * 0.5).toFixed(2)}" ${hero ? 'filter="url(#glow2)"' : ''} style="${style}"/>`;
  }
  return out;
}

export const darkScene = () => `
<svg class="dark-scene scene-svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <radialGradient id="deepBg" cx=".5" cy=".55" r=".75"><stop offset="0" stop-color="#120404"/><stop offset=".55" stop-color="#060202"/><stop offset="1" stop-color="#000"/></radialGradient>
    <radialGradient id="aura" cx=".68" cy=".38" r=".55"><stop offset="0" stop-color="#ff2d1f" stop-opacity=".46"/><stop offset=".4" stop-color="#c4180d" stop-opacity=".24"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <radialGradient id="bell" cx=".46" cy=".26" r=".8">
      <stop offset="0" stop-color="#ffe4d6"/><stop offset=".18" stop-color="#ffb199"/><stop offset=".42" stop-color="#ff4a2f"/><stop offset=".72" stop-color="#c21309"/><stop offset="1" stop-color="#4a0502" stop-opacity=".55"/>
    </radialGradient>
    <radialGradient id="organ1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe9de" stop-opacity=".8"/><stop offset="1" stop-color="#ffe9de" stop-opacity="0"/></radialGradient>
    <linearGradient id="tentg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6a4a"/><stop offset=".55" stop-color="#e0200f" stop-opacity=".55"/><stop offset="1" stop-color="#8a0d06" stop-opacity="0"/></linearGradient>
    <radialGradient id="underglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff2d1f" stop-opacity=".5"/><stop offset="1" stop-color="#ff2d1f" stop-opacity="0"/></radialGradient>
    <radialGradient id="vignetteD" cx=".5" cy=".42" r=".8"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".8"/></radialGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="16" result="w"/><feGaussianBlur in="SourceGraphic" stdDeviation="6" result="m"/><feMerge><feMergeNode in="w"/><feMergeNode in="m"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="glow2" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="rayBlurD" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
  </defs>

  <rect width="1600" height="1000" fill="url(#deepBg)"/>
  <rect width="1600" height="1000" fill="url(#aura)"/>
  <g class="px scene-micro" data-depth="9">${motes()}</g>

  <g class="px scene-macro" data-depth="34">
    <ellipse class="glow-pulse scene-macro" cx="1140" cy="760" rx="260" ry="70" fill="url(#underglow)" style="mix-blend-mode:screen"/>

    <g class="ray-sweep scene-macro fx-heavy" filter="url(#rayBlurD)" opacity=".3" style="mix-blend-mode:screen">
      ${[-16, -4, 8, 20].map((a, i) => `<polygon points="1130,430 ${1130 + Math.cos((70 + a) * Math.PI / 180) * 760},${430 + Math.sin((70 + a) * Math.PI / 180) * 760} ${1130 + Math.cos((84 + a) * Math.PI / 180) * 760},${430 + Math.sin((84 + a) * Math.PI / 180) * 760}" fill="#ff8f6b" opacity="${(0.4 - i * 0.06).toFixed(2)}"/>`).join('')}
    </g>

    <g class="jelly scene-macro">
      <g filter="url(#glow2)">${tentacles()}</g>
      <g style="mix-blend-mode:screen">
        <path d="M900 470 C878 242 1012 164 1132 176 C1264 188 1332 302 1300 470 C1272 452 1248 490 1218 470 C1190 492 1158 454 1128 476 C1098 496 1066 456 1036 478 C1006 496 976 456 946 480 C926 490 912 470 900 470Z" fill="url(#bell)" filter="url(#glow)" opacity=".9"/>
      </g>
      <path d="M900 470 C878 242 1012 164 1132 176 C1264 188 1332 302 1300 470" fill="none" stroke="#ffddce" stroke-width="2.5" opacity=".5" style="mix-blend-mode:screen"/>
      <ellipse cx="1075" cy="270" rx="60" ry="46" fill="url(#organ1)" style="mix-blend-mode:screen"/>
      <ellipse cx="1165" cy="330" rx="34" ry="50" fill="url(#organ1)" opacity=".7" style="mix-blend-mode:screen"/>
      <path d="M960 420 C960 300 1040 235 1110 232 M1030 440 C1040 330 1090 270 1150 262 M1110 450 C1130 350 1180 300 1235 300" stroke="#ffd2c4" stroke-opacity=".3" stroke-width="3" fill="none"/>
      <ellipse cx="1090" cy="258" rx="72" ry="30" fill="#fff" opacity=".14"/>
    </g>
  </g>

  <linearGradient id="fadeL" x1="0" x2="1"><stop offset="0" stop-color="#040404" stop-opacity=".85"/><stop offset=".55" stop-color="#040404" stop-opacity="0"/></linearGradient>
  <rect width="1600" height="1000" fill="url(#fadeL)"/>
  <rect width="1600" height="1000" fill="url(#vignetteD)"/>
</svg>`;
