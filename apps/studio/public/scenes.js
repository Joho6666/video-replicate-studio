// Hero scenes drawn in SVG (no image assets): a sunset valley for light, a red glowing jellyfish for dark.

function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

function flowers() {
  const r = rng(42);
  const colors = ['#8b6cc8', '#a58ae0', '#f07a2a', '#f59a3c', '#f4eee4', '#e8603a', '#7f5bbd'];
  let out = '';
  for (let i = 0; i < 420; i++) {
    const y = 800 + Math.pow(r(), 0.7) * 210;
    const x = r() * 1600;
    const s = 1.5 + ((y - 800) / 210) * 7 * (0.5 + r());
    const c = colors[Math.floor(r() * colors.length)];
    out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${s.toFixed(1)}" ry="${(s * 0.72).toFixed(1)}" fill="${c}" opacity="${(0.55 + r() * 0.45).toFixed(2)}"/>`;
    if (s > 5 && r() > 0.5) out += `<path d="M${x.toFixed(1)} ${(y + s * 0.6).toFixed(1)} q2 ${(s * 2).toFixed(1)} -1 ${(s * 3.2).toFixed(1)}" stroke="#3d5a22" stroke-width="1.2" fill="none" opacity=".7"/>`;
  }
  return out;
}

function grass() {
  const r = rng(7);
  let out = '';
  for (let i = 0; i < 260; i++) {
    const x = r() * 1600, y = 840 + r() * 170, h = 18 + r() * 46;
    out += `<path d="M${x.toFixed(0)} ${y.toFixed(0)} q${(r() * 10 - 5).toFixed(1)} ${(-h / 2).toFixed(0)} ${(r() * 14 - 7).toFixed(1)} ${(-h).toFixed(0)}" stroke="${r() > 0.5 ? '#4d6b28' : '#6d8a35'}" stroke-width="${(1 + r() * 1.6).toFixed(1)}" fill="none" opacity=".8"/>`;
  }
  return out;
}

export const lightScene = () => `
<svg class="light-scene" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b8c2d6"/><stop offset=".42" stop-color="#e3d2cf"/><stop offset=".62" stop-color="#f4cdb0"/><stop offset=".75" stop-color="#f7c49c"/>
    </linearGradient>
    <radialGradient id="sun" cx=".68" cy=".6" r=".45"><stop offset="0" stop-color="#fff4e0" stop-opacity=".95"/><stop offset="1" stop-color="#fff4e0" stop-opacity="0"/></radialGradient>
    <linearGradient id="rock" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e6dadd"/><stop offset=".5" stop-color="#b3a3b2"/><stop offset="1" stop-color="#7f6f80"/></linearGradient>
    <linearGradient id="hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9a54a"/><stop offset=".5" stop-color="#8c9a3e"/><stop offset="1" stop-color="#5e7a2e"/></linearGradient>
    <linearGradient id="hill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fa05a"/><stop offset="1" stop-color="#55702c"/></linearGradient>
    <linearGradient id="meadow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f8a35"/><stop offset="1" stop-color="#34491a"/></linearGradient>
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#f6d9c2" stop-opacity="0"/><stop offset=".68" stop-color="#f6d9c2" stop-opacity=".55"/><stop offset=".78" stop-color="#f6d9c2" stop-opacity="0"/></linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="1.4"/></filter>
    <filter id="blurfar"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="cloud" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>
  <rect width="1600" height="1000" fill="url(#sky)"/>
  <rect width="1600" height="1000" fill="url(#sun)"/>
  <g class="drift" opacity=".32">
    <ellipse cx="300" cy="150" rx="190" ry="26" fill="#fff" filter="url(#cloud)"/><ellipse cx="900" cy="110" rx="240" ry="22" fill="#fff" filter="url(#cloud)"/><ellipse cx="1500" cy="190" rx="200" ry="24" fill="#fff" filter="url(#cloud)"/><ellipse cx="1900" cy="130" rx="220" ry="20" fill="#fff" filter="url(#cloud)"/>
  </g>
  <path d="M0 610 L150 520 L270 560 L420 450 L530 505 L660 470 L790 540 L920 480 L1060 560 L1190 485 L1330 545 L1470 470 L1600 520 L1600 720 L0 720Z" fill="#a898b6" opacity=".45" filter="url(#blurfar)"/>
  <path d="M0 640 L40 470 L110 330 L150 350 L205 215 L240 190 L285 250 L330 300 L390 420 L470 560 L560 690 L0 720Z" fill="url(#rock)"/>
  <path d="M205 215 L240 190 L262 300 L230 420 L200 560 L160 690 L120 600 L150 420Z" fill="#fff" opacity=".18"/>
  <path d="M1020 700 L1170 540 L1240 575 L1350 470 L1440 520 L1540 460 L1600 480 L1600 780 Z" fill="#7d8b6a" opacity=".85"/>
  <path d="M0 720 C160 640 330 650 520 700 C700 748 880 668 1060 676 C1250 684 1430 626 1600 650 L1600 1000 L0 1000Z" fill="url(#hill)"/>
  <path d="M760 760 C900 700 1060 720 1200 700 C1350 680 1480 700 1600 690 L1600 1000 L700 1000Z" fill="url(#hill2)"/>
  <g fill="#4a3a24"><circle cx="355" cy="700" r="30"/><circle cx="380" cy="690" r="26"/><circle cx="1260" cy="690" r="42"/><circle cx="1290" cy="672" r="36"/><circle cx="1320" cy="696" r="30"/></g>
  <g fill="#6a4a2a" opacity=".9"><circle cx="370" cy="712" r="20"/><circle cx="1284" cy="712" r="26"/></g>
  <rect x="352" y="712" width="6" height="30" fill="#3a2a18"/><rect x="1284" y="716" width="8" height="40" fill="#3a2a18"/>
  <g transform="translate(60 690)"><path d="M0 40 L70 10 L140 40 L140 90 L0 90Z" fill="#ece6de"/><path d="M-8 44 L70 4 L150 44 L140 48 L70 14 L0 48Z" fill="#4b4540"/><rect x="95" y="58" width="22" height="32" fill="#8c7f72"/></g>
  <rect width="1600" height="1000" fill="url(#haze)"/>
  <path d="M0 830 C300 770 620 800 900 790 C1180 780 1400 752 1600 770 L1600 1000 L0 1000Z" fill="url(#meadow)"/>
  <g class="sway">${grass()}</g>
  <g class="sway" filter="url(#soft)">${flowers()}</g>
  <rect width="1600" height="1000" fill="url(#haze)" opacity=".4"/>
</svg>`;

function tentacles() {
  const r = rng(11);
  let out = '';
  for (let i = 0; i < 16; i++) {
    const x0 = 1010 + i * 16 + r() * 8;
    const len = 380 + r() * 360;
    let d = `M${x0} 470`;
    let x = x0, y = 470;
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      const dy = len / steps;
      const dx = (r() - 0.5) * 70;
      d += ` q${(dx * 1.6).toFixed(0)} ${(dy / 2).toFixed(0)} ${dx.toFixed(0)} ${dy.toFixed(0)}`;
      x += dx; y += dy;
    }
    const w = i % 4 === 0 ? 5 : 1 + r() * 2.2;
    out += `<path class="tent" d="${d}" stroke="url(#tentg)" stroke-width="${w.toFixed(1)}" fill="none" stroke-linecap="round" opacity="${(0.45 + r() * 0.5).toFixed(2)}"/>`;
  }
  return out;
}

function motes() {
  const r = rng(99);
  let out = '';
  for (let i = 0; i < 70; i++) out += `<circle cx="${(r() * 1600).toFixed(0)}" cy="${(r() * 1000).toFixed(0)}" r="${(0.6 + r() * 1.8).toFixed(1)}" fill="#ff5a3c" opacity="${(0.15 + r() * 0.5).toFixed(2)}"/>`;
  return out;
}

export const darkScene = () => `
<svg class="dark-scene" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <radialGradient id="aura" cx=".68" cy=".38" r=".5"><stop offset="0" stop-color="#ff2d1f" stop-opacity=".42"/><stop offset=".45" stop-color="#8a0d06" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <radialGradient id="bell" cx=".5" cy=".3" r=".75"><stop offset="0" stop-color="#ffb199"/><stop offset=".25" stop-color="#ff4a2f"/><stop offset=".7" stop-color="#d0170c"/><stop offset="1" stop-color="#5e0703" stop-opacity=".6"/></radialGradient>
    <linearGradient id="tentg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5a3c"/><stop offset=".6" stop-color="#e0200f" stop-opacity=".6"/><stop offset="1" stop-color="#8a0d06" stop-opacity="0"/></linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="glow2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="1600" height="1000" fill="#040404"/>
  <rect width="1600" height="1000" fill="url(#aura)"/>
  <g>${motes()}</g>
  <g class="jelly">
    <g filter="url(#glow2)">${tentacles()}</g>
    <path d="M900 470 C880 250 1010 170 1130 180 C1260 190 1330 300 1300 470 C1270 450 1245 490 1215 468 C1185 492 1155 452 1125 476 C1095 496 1065 455 1035 478 C1005 496 975 455 945 480 C925 490 912 470 900 470Z" fill="url(#bell)" filter="url(#glow)" opacity=".78"/>
    <path d="M960 420 C960 300 1040 235 1110 232 M1030 440 C1040 330 1090 270 1150 262 M1110 450 C1130 350 1180 300 1235 300" stroke="#ffd2c4" stroke-opacity=".35" stroke-width="3" fill="none"/>
    <ellipse cx="1090" cy="260" rx="70" ry="30" fill="#fff" opacity=".12"/>
  </g>
  <linearGradient id="fadeL" x1="0" x2="1"><stop offset="0" stop-color="#040404" stop-opacity=".85"/><stop offset=".55" stop-color="#040404" stop-opacity="0"/></linearGradient>
  <rect width="1600" height="1000" fill="url(#fadeL)"/>
</svg>`;
