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

// Painterly cloud: a cluster of soft overlapping ellipses (brushstroke feel) rather than
// one blurred blob, each cluster warmed on its underside by the low sun.
function paintCloud(r, cx, cy, scale, delay) {
  const puffs = 5 + Math.floor(r() * 3);
  let out = `<g class="cloud" filter="url(#cloudSoft)" style="animation-delay:${delay}s">`;
  for (let i = 0; i < puffs; i++) {
    const px = cx + (r() - 0.5) * 130 * scale;
    const py = cy + (r() - 0.5) * 30 * scale - i * 1.5;
    const rx = (34 + r() * 30) * scale, ry = rx * (0.42 + r() * 0.12);
    out += `<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="url(#cloudLit)"/>`;
  }
  return out + `</g>`;
}

function clouds() {
  const r = rng(303);
  const spots = [[260, 145, 1, -4], [640, 95, .8, -22], [980, 150, 1.15, -46], [1330, 110, .75, -11], [1520, 175, .6, -33]];
  return spots.map(([x, y, s, d]) => paintCloud(r, x, y, s, d)).join('');
}

// Simple double-stroke chevrons — a classic landscape-painting device for scale and depth.
function birds() {
  const set = [[420, 210, 1, .55], [468, 195, .8, .5], [1180, 165, .7, .45]];
  return set.map(([x, y, s, o]) => `<path class="bird" d="M${x} ${y} q${9 * s} -7 ${18 * s} 0 q${9 * s} -7 ${18 * s} 0" stroke="#5a4a42" stroke-width="${1.6 * s}" fill="none" stroke-linecap="round" opacity="${o}"/>`).join('');
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
    if (depth > 0.6 && r() > 0.92) out += `<circle class="spark" cx="${(x + s * 1.6).toFixed(1)}" cy="${(y - s * 0.4).toFixed(1)}" r="${(0.8 + r()).toFixed(1)}" fill="#fff3df" opacity="${(0.5 + r() * 0.4).toFixed(2)}" style="animation-delay:${(-r() * 3).toFixed(2)}s"/>`;
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

export const lightScene = () => `
<svg class="light-scene" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5d6f95"/><stop offset=".28" stop-color="#8c8fa8"/><stop offset=".52" stop-color="#d6b6ac"/>
      <stop offset=".68" stop-color="#f0c19a"/><stop offset=".82" stop-color="#f6b378"/><stop offset="1" stop-color="#f8b06a"/>
    </linearGradient>
    <radialGradient id="sunGlow" cx=".685" cy=".565" r=".5">
      <stop offset="0" stop-color="#fffaf0"/><stop offset=".07" stop-color="#fff3d9" stop-opacity=".95"/>
      <stop offset=".22" stop-color="#ffdfa8" stop-opacity=".55"/><stop offset=".46" stop-color="#ffcf8e" stop-opacity=".22"/>
      <stop offset="1" stop-color="#ffcf8e" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="horizonGlow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd9a0" stop-opacity="0"/><stop offset=".5" stop-color="#ffd9a0" stop-opacity=".5"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="cloudLit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8ef"/><stop offset="1" stop-color="#f3c9a6"/></linearGradient>
    <linearGradient id="farRidge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c7c2d8"/><stop offset="1" stop-color="#a79fc0"/></linearGradient>
    <linearGradient id="rock" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2d8ae"/><stop offset=".45" stop-color="#c99772"/><stop offset="1" stop-color="#7c5b62"/></linearGradient>
    <linearGradient id="midHill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a7a5a"/><stop offset="1" stop-color="#5c5638"/></linearGradient>
    <linearGradient id="foothill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c7042"/><stop offset="1" stop-color="#4d5c2a"/></linearGradient>
    <linearGradient id="hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c2a94e"/><stop offset=".5" stop-color="#8f9a3e"/><stop offset="1" stop-color="#546b28"/></linearGradient>
    <linearGradient id="hill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#93a55c"/><stop offset="1" stop-color="#4c6626"/></linearGradient>
    <linearGradient id="meadow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#74902f"/><stop offset="1" stop-color="#2e4416"/></linearGradient>
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
      <stop offset=".4" stop-color="#f8dcc0" stop-opacity="0"/><stop offset=".66" stop-color="#f8dcc0" stop-opacity=".58"/><stop offset=".8" stop-color="#f8dcc0" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="vignetteL" cx=".5" cy=".42" r=".78"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#160f08" stop-opacity=".32"/></radialGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="1.4"/></filter>
    <filter id="blurfar"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="cloudSoft" x="-60%" y="-200%" width="220%" height="500%"><feGaussianBlur stdDeviation="8"/></filter>
    <filter id="rayBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="16"/></filter>
  </defs>

  <rect width="1600" height="1000" fill="url(#sky)"/>

  <!-- god rays, behind everything so the skyline naturally occludes their base -->
  <g class="px ray-sweep" data-depth="2" filter="url(#rayBlur)" opacity=".35" style="mix-blend-mode:screen">
    ${[-8, 4, 16, 28, 40].map((a, i) => `<polygon points="1096,565 ${1096 + Math.cos((200 + a) * Math.PI / 180) * 900},${565 + Math.sin((200 + a) * Math.PI / 180) * 900} ${1096 + Math.cos((214 + a) * Math.PI / 180) * 900},${565 + Math.sin((214 + a) * Math.PI / 180) * 900}" fill="#fff3d6" opacity="${(0.5 - i * 0.07).toFixed(2)}"/>`).join('')}
  </g>

  <rect width="1600" height="1000" fill="url(#sunGlow)"/>
  <rect y="560" width="1600" height="220" fill="url(#horizonGlow)"/>

  <g class="px" data-depth="4">${clouds()}</g>
  <g class="px" data-depth="3">${birds()}</g>

  <!-- far ridge: cool, hazy, low-contrast — atmospheric perspective anchor -->
  <g class="px" data-depth="7">
    <path d="M0 610 L150 520 L270 560 L420 450 L530 505 L660 470 L790 540 L920 480 L1060 560 L1190 485 L1330 545 L1470 470 L1600 520 L1600 720 L0 720Z" fill="url(#farRidge)" opacity=".55" filter="url(#blurfar)"/>
    <g opacity=".55" filter="url(#blurfar)">${farTreeline()}</g>
  </g>

  <!-- near rock: warm, sharp, with a sunlit rim edge along its right (sun-facing) silhouette -->
  <g class="px" data-depth="13">
    <path d="M0 640 L40 470 L110 330 L150 350 L205 215 L240 190 L285 250 L330 300 L390 420 L470 560 L560 690 L0 720Z" fill="url(#rock)"/>
    <path d="M205 215 L240 190 L262 300 L230 420 L200 560 L160 690 L120 600 L150 420Z" fill="#fff" opacity=".16"/>
    <path d="M240 190 L285 250 L330 300 L390 420 L470 560 L560 690" fill="none" stroke="#ffe3bc" stroke-width="3" opacity=".55" stroke-linecap="round"/>
    <path d="M95 470 L130 440 M60 540 L100 505 M340 340 L370 385" stroke="#5f4d58" stroke-width="2" opacity=".25" fill="none"/>
  </g>
  <g class="px" data-depth="13"><path d="M1020 700 L1170 540 L1240 575 L1350 470 L1440 520 L1540 460 L1600 480 L1600 780 Z" fill="url(#midHill)" opacity=".9"/>
    <path d="M1170 540 L1240 575 L1350 470 L1440 520 L1540 460" fill="none" stroke="#ffdca8" stroke-width="2.5" opacity=".4" stroke-linecap="round"/></g>

  <!-- foothill: bridges the rock silhouette and the meadow so the mid-ground carries texture
       instead of empty haze — this is the "tighten the composition" layer. -->
  <g class="px" data-depth="17">${foothillBand()}</g>

  <g class="px" data-depth="20">
    <path d="M0 720 C160 640 330 650 520 700 C700 748 880 668 1060 676 C1250 684 1430 626 1600 650 L1600 1000 L0 1000Z" fill="url(#hill)"/>
    <path d="M760 760 C900 700 1060 720 1200 700 C1350 680 1480 700 1600 690 L1600 1000 L700 1000Z" fill="url(#hill2)"/>
    ${tree(365, 690, 1)}${tree(392, 700, .78)}
    ${tree(1265, 682, 1.15)}${tree(1298, 668, .85)}${tree(1328, 694, .7)}
    <g transform="translate(60 690)">
      <path d="M0 40 L70 10 L140 40 L140 90 L0 90Z" fill="#efe7db"/>
      <path d="M-8 44 L70 4 L150 44 L140 48 L70 14 L0 48Z" fill="#463a2e"/>
      <rect x="95" y="58" width="22" height="32" fill="#7d6a58"/>
      <rect x="20" y="52" width="20" height="22" fill="#d9a94e"/><rect x="20" y="52" width="20" height="22" fill="#fff2c4" opacity=".55" filter="url(#soft)"/>
      <rect x="63" y="4" width="7" height="18" fill="#3a2f24"/>
    </g>
  </g>

  <rect width="1600" height="1000" fill="url(#haze)"/>

  <g class="px" data-depth="34">
    <path d="M0 830 C300 770 620 800 900 790 C1180 780 1400 752 1600 770 L1600 1000 L0 1000Z" fill="url(#meadow)"/>
    ${meadowClumps()}
    <g class="sway">${grassField()}</g>
    <g class="sway" filter="url(#soft)">${flowerField()}</g>
    ${stones()}
  </g>

  <rect width="1600" height="1000" fill="url(#haze)" opacity=".35"/>
  <rect width="1600" height="1000" fill="url(#vignetteL)"/>
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
    out += `<path class="tent" d="${d}" stroke="url(#tentg)" stroke-width="${w.toFixed(1)}" fill="none" stroke-linecap="round" opacity="${op}"/>`;
    // bioluminescent nodes along ~1/3 of tentacles
    if (r() > 0.62) {
      const [nx, ny] = pts[3 + Math.floor(r() * 3)];
      out += `<circle class="node-pulse" cx="${nx.toFixed(0)}" cy="${ny.toFixed(0)}" r="${(1.6 + r() * 1.6).toFixed(1)}" fill="#ffcdb8" filter="url(#glow2)" style="animation-delay:${(-r() * 3).toFixed(2)}s"/>`;
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
    out += `<circle class="mote${hero ? ' hero' : ''}" cx="${(r() * 1600).toFixed(0)}" cy="${(r() * 1000).toFixed(0)}" r="${rad.toFixed(1)}" fill="${hues[Math.floor(r() * hues.length)]}" opacity="${(0.15 + r() * 0.5).toFixed(2)}" ${hero ? 'filter="url(#glow2)" style="mix-blend-mode:screen"' : ''} style="animation-delay:${(-r() * 12).toFixed(2)}s"/>`;
  }
  return out;
}

export const darkScene = () => `
<svg class="dark-scene" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
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
  <g class="px" data-depth="9">${motes()}</g>

  <g class="px" data-depth="34">
    <ellipse class="glow-pulse" cx="1140" cy="760" rx="260" ry="70" fill="url(#underglow)" style="mix-blend-mode:screen"/>

    <g class="ray-sweep" filter="url(#rayBlurD)" opacity=".3" style="mix-blend-mode:screen">
      ${[-16, -4, 8, 20].map((a, i) => `<polygon points="1130,430 ${1130 + Math.cos((70 + a) * Math.PI / 180) * 760},${430 + Math.sin((70 + a) * Math.PI / 180) * 760} ${1130 + Math.cos((84 + a) * Math.PI / 180) * 760},${430 + Math.sin((84 + a) * Math.PI / 180) * 760}" fill="#ff8f6b" opacity="${(0.4 - i * 0.06).toFixed(2)}"/>`).join('')}
    </g>

    <g class="jelly">
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
