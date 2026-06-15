/* ============================================================
   The Tavern — Inked Battlemap art (ported from the design handoff
   inkmap-scenes.js). Pure SVG-string generators for the built-in
   terrain/prop library: bright daylight palette, bold ink outlines,
   scribble shading, soft cast shadows. Scale: 1 cell = 64px = 5 ft.
   ============================================================ */

const CELL = 64;

// ponytail: ported verbatim from the design's tested SVG art; only typed +
// converted from an IIFE to ES exports. Do not "tidy" the geometry.

function rng(seed: number): () => number {
  let s = (seed | 0) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const f = (n: number): string => (+n).toFixed(1);

function smoothClosed(p: number[][]): string {
  const n = p.length;
  let d = `M${f(p[0]![0]!)},${f(p[0]![1]!)}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n]!, p1 = p[i]!, p2 = p[(i + 1) % n]!, p3 = p[(i + 2) % n]!;
    const c1x = p1[0]! + (p2[0]! - p0[0]!) / 6, c1y = p1[1]! + (p2[1]! - p0[1]!) / 6;
    const c2x = p2[0]! - (p3[0]! - p1[0]!) / 6, c2y = p2[1]! - (p3[1]! - p1[1]!) / 6;
    d += `C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0]!)},${f(p2[1]!)}`;
  }
  return d + 'Z';
}
function blobPts(cx: number, cy: number, r: number, bumps: number, rnd: () => number, jit?: number, squash?: number): number[][] {
  const pts: number[][] = [];
  jit = jit == null ? 0.22 : jit;
  squash = squash || 1;
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * Math.PI * 2;
    const rr = r * (1 - jit + rnd() * jit * 2);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * squash]);
  }
  return pts;
}

function defs(): string {
  return `<defs>
    <filter id="ink" x="-12%" y="-12%" width="124%" height="124%">
      <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="4.2" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="inkSoft" x="-12%" y="-12%" width="124%" height="124%">
      <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="3" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="soft"><feGaussianBlur stdDeviation="3.2"/></filter>
    <filter id="soft2"><feGaussianBlur stdDeviation="7"/></filter>
    <radialGradient id="leafShade" cx="34%" cy="30%" r="78%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="62%" stop-color="#1d3315" stop-opacity="0"/>
      <stop offset="100%" stop-color="#13260f" stop-opacity="0.5"/>
    </radialGradient>
    <radialGradient id="leafShadeD" cx="34%" cy="30%" r="78%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="60%" stop-color="#0f2410" stop-opacity="0"/>
      <stop offset="100%" stop-color="#0a1a0b" stop-opacity="0.55"/>
    </radialGradient>
    <linearGradient id="grassGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#9cc15f"/>
      <stop offset="55%" stop-color="#8bb551"/>
      <stop offset="100%" stop-color="#79a242"/>
    </linearGradient>
    <radialGradient id="dirtGrad" cx="50%" cy="46%" r="60%">
      <stop offset="0%" stop-color="#c2a878"/>
      <stop offset="62%" stop-color="#b09665"/>
      <stop offset="100%" stop-color="#977e52"/>
    </radialGradient>
    <radialGradient id="waterGrad" cx="42%" cy="36%" r="72%">
      <stop offset="0%" stop-color="#7ec6d0"/>
      <stop offset="70%" stop-color="#4f9fb0"/>
      <stop offset="100%" stop-color="#357d8e"/>
    </radialGradient>
  </defs>`;
}

function grassRect(V: number): string {
  const c = V / 2;
  return `<rect x="0" y="0" width="${V}" height="${V}" fill="url(#grassGrad)"/><g stroke="#2f4a1e" stroke-width="1" opacity=".18"><line x1="0" y1="${c}" x2="${V}" y2="${c}"/><line x1="${c}" y1="0" x2="${c}" y2="${V}"/></g>`;
}

interface PropOpt { seed?: number; dark?: boolean; bumps?: number; w?: number }

function tree(x: number, y: number, r: number, opt: PropOpt = {}): string {
  const seed = opt.seed || ((x * 131 + y * 17) | 1);
  const rnd = rng(seed);
  const bumps = opt.bumps || 15;
  const pts = blobPts(x, y, r, bumps, rnd, 0.26, 0.95);
  const d = smoothClosed(pts);
  const fill = opt.dark ? '#5a8a37' : '#73a23e';
  const out = opt.dark ? '#1d3417' : '#26431a';
  const hi = opt.dark ? '#7aa84a' : '#9ac75a';
  const shade = opt.dark ? 'leafShadeD' : 'leafShade';
  let scr = '';
  for (let i = 0; i < 6; i++) {
    const a = rnd() * 6.28, rr = r * (0.15 + rnd() * 0.55);
    const sx = x + Math.cos(a) * rr, sy = y + Math.sin(a) * rr, w = r * (0.22 + rnd() * 0.2);
    scr += `<path d="M${f(sx - w)},${f(sy)} q${f(w)},${f(-w * 0.8)} ${f(w * 2)},0" fill="none" stroke="${out}" stroke-width="1.4" stroke-linecap="round" opacity=".45"/>`;
  }
  let dots = '';
  for (let i = 0; i < 9; i++) {
    const a = rnd() * 6.28, rr = r * (0.2 + rnd() * 0.62);
    dots += `<circle cx="${f(x + Math.cos(a) * rr - r * .12)}" cy="${f(y + Math.sin(a) * rr - r * .12)}" r="${f(1 + rnd() * 1.6)}" fill="${hi}" opacity=".6"/>`;
  }
  return `<g><path d="${smoothClosed(pts.map(([px, py]) => [px! + r * 0.14, py! + r * 0.2]))}" fill="#173011" opacity=".26" filter="url(#soft)"/><g filter="url(#ink)"><path d="${d}" fill="${fill}" stroke="${out}" stroke-width="2.6" stroke-linejoin="round"/><path d="${d}" fill="url(#${shade})"/>${scr}${dots}</g></g>`;
}

function bush(x: number, y: number, r: number, opt: PropOpt = {}): string {
  const rnd = rng(opt.seed || ((x * 71 + y * 29) | 1));
  const pts = blobPts(x, y, r, 11, rnd, 0.3, 0.72);
  const d = smoothClosed(pts);
  let dots = '';
  for (let i = 0; i < 5; i++) { const a = rnd() * 6.28, rr = r * (0.2 + rnd() * 0.5); dots += `<circle cx="${f(x + Math.cos(a) * rr)}" cy="${f(y + Math.sin(a) * rr)}" r="${f(0.8 + rnd() * 1.2)}" fill="#9ac75a" opacity=".6"/>`; }
  return `<g><ellipse cx="${f(x + r * .1)}" cy="${f(y + r * .55)}" rx="${f(r * .9)}" ry="${f(r * .4)}" fill="#1d3315" opacity=".22" filter="url(#soft)"/><g filter="url(#ink)"><path d="${d}" fill="#6c9b3a" stroke="#274319" stroke-width="2.1" stroke-linejoin="round"/><path d="${d}" fill="url(#leafShade)"/>${dots}</g></g>`;
}

function rock(x: number, y: number, r: number, opt: PropOpt = {}): string {
  const rnd = rng(opt.seed || ((x * 53 + y * 41) | 1));
  const n = 6, pts: number[][] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * 6.28 + rnd() * 0.3; const rr = r * (0.72 + rnd() * 0.4); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.82]); }
  let d = `M${f(pts[0]![0]!)},${f(pts[0]![1]!)}`; for (let i = 1; i < n; i++) d += `L${f(pts[i]![0]!)},${f(pts[i]![1]!)}`; d += 'Z';
  const facet = `M${f(x - r * .1)},${f(y - r * .3)} L${f(x + r * .15)},${f(y + r * .1)} L${f(x - r * .25)},${f(y + r * .35)}`;
  return `<g><ellipse cx="${f(x + r * .12)}" cy="${f(y + r * .5)}" rx="${f(r * .95)}" ry="${f(r * .38)}" fill="#1d2515" opacity=".24" filter="url(#soft)"/><g filter="url(#inkSoft)"><path d="${d}" fill="#a59b8c" stroke="#3a3833" stroke-width="2.2" stroke-linejoin="round"/><path d="M${f(pts[0]![0]!)},${f(pts[0]![1]!)} L${f(pts[1]![0]!)},${f(pts[1]![1]!)} L${f(pts[2]![0]!)},${f(pts[2]![1]!)}" fill="none" stroke="#cfc7b8" stroke-width="1.6" stroke-linecap="round" opacity=".7"/><path d="${facet}" fill="none" stroke="#3a3833" stroke-width="1.3" opacity=".5"/></g></g>`;
}

function logProp(x: number, y: number, len: number, ang: number, opt: PropOpt = {}): string {
  const w = (opt.w || 13);
  const t = `translate(${f(x)},${f(y)}) rotate(${ang || 0})`;
  let bark = '';
  for (let i = 1; i < 4; i++) bark += `<path d="M${f(-len / 2 + 6)},${f(-w / 2 + i * w / 4)} q${f(len / 4)},${f((i % 2 ? -2 : 2))} ${f(len - 12)},0" fill="none" stroke="#3a2716" stroke-width="1" opacity=".5"/>`;
  return `<g transform="${t}"><ellipse cx="2" cy="${f(w * .7)}" rx="${f(len / 2)}" ry="${f(w * .5)}" fill="#1d2515" opacity=".26" filter="url(#soft)"/><g filter="url(#inkSoft)"><rect x="${f(-len / 2)}" y="${f(-w / 2)}" width="${f(len)}" height="${f(w)}" rx="${f(w / 2)}" fill="#7a5532" stroke="#3a2716" stroke-width="2.2"/><ellipse cx="${f(len / 2 - w * .4)}" cy="0" rx="${f(w * .34)}" ry="${f(w * .42)}" fill="#a07a4a" stroke="#3a2716" stroke-width="1.6"/><ellipse cx="${f(len / 2 - w * .4)}" cy="0" rx="${f(w * .16)}" ry="${f(w * .2)}" fill="none" stroke="#5c3f24" stroke-width="1"/>${bark}</g></g>`;
}

function tent(x: number, y: number, s: number, ang: number): string {
  const t = `translate(${f(x)},${f(y)}) rotate(${ang || 0})`;
  const w = s, h = s * 1.18;
  const left = `M${f(-w / 2)},${f(-h / 2)} L0,${f(-h / 2 + 5)} L0,${f(h / 2 - 5)} L${f(-w / 2)},${f(h / 2)} Z`;
  const right = `M${f(w / 2)},${f(-h / 2)} L0,${f(-h / 2 + 5)} L0,${f(h / 2 - 5)} L${f(w / 2)},${f(h / 2)} Z`;
  const flap = `M0,${f(h / 2 - 5)} L${f(-w * .26)},${f(h / 2 + s * .26)} L${f(w * .26)},${f(h / 2 + s * .26)} Z`;
  return `<g transform="${t}"><ellipse cx="${f(s * .16)}" cy="${f(s * .24)}" rx="${f(w * .68)}" ry="${f(h * .56)}" fill="#1d2515" opacity=".28" filter="url(#soft)"/><g filter="url(#inkSoft)"><path d="${left}" fill="#e2d3ad" stroke="#3a3020" stroke-width="2.4" stroke-linejoin="round"/><path d="${right}" fill="#c7ad7e" stroke="#3a3020" stroke-width="2.4" stroke-linejoin="round"/><line x1="0" y1="${f(-h / 2 + 5)}" x2="0" y2="${f(h / 2 - 5)}" stroke="#3a3020" stroke-width="2.4"/><path d="${flap}" fill="#a98e60" stroke="#3a3020" stroke-width="2.2" stroke-linejoin="round"/></g></g>`;
}

function campfire(x: number, y: number): string {
  let stones = '';
  const n = 8, rr = 17;
  const rnd = rng(99);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28; const sx = x + Math.cos(a) * rr, sy = y + Math.sin(a) * rr * 0.82;
    stones += `<ellipse cx="${f(sx)}" cy="${f(sy)}" rx="${f(5 + rnd() * 2)}" ry="${f(4 + rnd() * 1.5)}" fill="#a59b8c" stroke="#3a3833" stroke-width="1.8"/>`;
  }
  const flames = `<path d="M${f(x - 7)},${f(y + 4)} q${f(-2)},${f(-10)} 4,${f(-15)} q2,8 4,4 q3,7 -1,11 Z" fill="#e0742c" opacity=".95"/><path d="M${f(x - 2)},${f(y + 5)} q${f(-1)},${f(-12)} 5,${f(-18)} q1,9 4,5 q3,9 -2,13 Z" fill="#f2a83a"/><path d="M${f(x + 1)},${f(y + 4)} q1,${f(-8)} 4,${f(-11)} q1,6 2,3 q2,5 -1,8 Z" fill="#ffd56a"/>`;
  return `<g><ellipse cx="${f(x)}" cy="${f(y + 2)}" rx="26" ry="20" fill="#5a4326" opacity=".5" filter="url(#soft)"/><g filter="url(#inkSoft)">${stones}<ellipse cx="${f(x)}" cy="${f(y)}" rx="9" ry="7" fill="#2a2018"/>${flames}</g><ellipse cx="${f(x)}" cy="${f(y)}" rx="34" ry="28" fill="#ffb04a" opacity=".16" filter="url(#soft2)"/></g>`;
}

function deadTree(x: number, y: number, s: number, opt: PropOpt = {}): string {
  const rnd = rng(opt.seed || ((x * 17 + y * 7) | 3));
  let br = '';
  const branches = 7;
  for (let i = 0; i < branches; i++) {
    const a = -Math.PI / 2 + (i - branches / 2) * 0.42 + (rnd() - .5) * .2;
    const len = s * (0.7 + rnd() * 0.5);
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    const mx = x + Math.cos(a) * len * 0.5 + (rnd() - .5) * 6, my = y + Math.sin(a) * len * 0.5;
    br += `<path d="M${f(x)},${f(y)} Q${f(mx)},${f(my)} ${f(ex)},${f(ey)}" fill="none" stroke="#46372a" stroke-width="${f(2.6 - i * 0.12)}" stroke-linecap="round"/>`;
    const tx = ex + Math.cos(a - .5) * len * .3, ty = ey + Math.sin(a - .5) * len * .3;
    br += `<path d="M${f(ex)},${f(ey)} L${f(tx)},${f(ty)}" stroke="#46372a" stroke-width="1.4" stroke-linecap="round"/>`;
  }
  return `<g><ellipse cx="${f(x + 4)}" cy="${f(y + 4)}" rx="${f(s * .5)}" ry="${f(s * .2)}" fill="#1d2515" opacity=".2" filter="url(#soft)"/><g filter="url(#inkSoft)"><circle cx="${f(x)}" cy="${f(y)}" r="4.5" fill="#46372a"/>${br}</g></g>`;
}

function pond(x: number, y: number, r: number, opt: PropOpt = {}): string {
  const rnd = rng(opt.seed || ((x * 13 + y * 23) | 1));
  const d = smoothClosed(blobPts(x, y, r, 12, rnd, 0.18, 0.74));
  return `<g><g filter="url(#inkSoft)"><path d="${d}" fill="url(#waterGrad)" stroke="#2a5a66" stroke-width="2.4" stroke-linejoin="round"/><path d="M${f(x - r * .4)},${f(y - r * .1)} q${f(r * .3)},${f(-4)} ${f(r * .6)},0" fill="none" stroke="#bfe9ef" stroke-width="1.6" stroke-linecap="round" opacity=".7"/><path d="M${f(x - r * .2)},${f(y + r * .2)} q${f(r * .25)},${f(-3)} ${f(r * .5)},0" fill="none" stroke="#bfe9ef" stroke-width="1.4" stroke-linecap="round" opacity=".5"/></g></g>`;
}

function wall(x: number, y: number, len: number, vert: boolean): string {
  const w = 16;
  const W = vert ? w : len, H = vert ? len : w;
  let bricks = '';
  const along = vert ? H : W;
  for (let p = 0; p < along; p += 22) {
    bricks += vert
      ? `<line x1="${f(x)}" y1="${f(y + p)}" x2="${f(x + w)}" y2="${f(y + p)}" stroke="#2a2520" stroke-width="1.4" opacity=".6"/>`
      : `<line x1="${f(x + p)}" y1="${f(y)}" x2="${f(x + p)}" y2="${f(y + w)}" stroke="#2a2520" stroke-width="1.4" opacity=".6"/>`;
  }
  return `<g filter="url(#inkSoft)"><rect x="${f(x)}" y="${f(y)}" width="${f(W)}" height="${f(H)}" rx="3" fill="#8a8077" stroke="#33302b" stroke-width="2.4"/><rect x="${f(x)}" y="${f(y)}" width="${f(W)}" height="${f(vert ? len : w * .4)}" rx="3" fill="#a39888" opacity=".5"/>${bricks}</g>`;
}

function door(x: number, y: number): string {
  return `<g filter="url(#inkSoft)"><rect x="${f(x)}" y="${f(y)}" width="${f(CELL)}" height="16" rx="3" fill="#6b4a2c" stroke="#33261a" stroke-width="2.4"/><line x1="${f(x + CELL * .5)}" y1="${f(y)}" x2="${f(x + CELL * .5)}" y2="${f(y + 16)}" stroke="#33261a" stroke-width="1.6"/><circle cx="${f(x + CELL * .5)}" cy="${f(y + 8)}" r="2.4" fill="#e8b765"/></g>`;
}

function crate(x: number, y: number, r: number): string {
  return `<g filter="url(#inkSoft)"><ellipse cx="${f(x + r * .12)}" cy="${f(y + r * .7)}" rx="${f(r * .95)}" ry="${f(r * .34)}" fill="#1d2515" opacity=".24" filter="url(#soft)"/><rect x="${f(x - r)}" y="${f(y - r)}" width="${f(2 * r)}" height="${f(2 * r)}" rx="3" fill="#8a6233" stroke="#3a2716" stroke-width="2.4"/><rect x="${f(x - r)}" y="${f(y - r)}" width="${f(2 * r)}" height="${f(r * .7)}" rx="3" fill="#a07a4a" opacity=".5"/><path d="M${f(x - r)},${f(y - r)} L${f(x + r)},${f(y + r)} M${f(x + r)},${f(y - r)} L${f(x - r)},${f(y + r)}" stroke="#3a2716" stroke-width="1.6"/></g>`;
}

/** Render a scalable piece centred at (x,y), radius r. */
function prop(type: string, x: number, y: number, r: number, ang?: number, seed?: number): string {
  const o: PropOpt = seed != null ? { seed } : {};
  switch (type) {
    case 'oak': return tree(x, y, r, o);
    case 'pine': return tree(x, y, r, { dark: true, seed });
    case 'bush': return bush(x, y, r, o);
    case 'boulder': return rock(x, y, r, o);
    case 'rocks': return rock(x - r * .5, y + r * .2, r * .55, { seed: (seed || 2) }) + rock(x + r * .45, y - r * .15, r * .45, { seed: (seed || 0) + 8 }) + rock(x + r * .15, y + r * .55, r * .38, { seed: (seed || 0) + 5 });
    case 'pond': return pond(x, y, r, o);
    case 'tent': return tent(x, y, r * 1.5, ang == null ? -6 : ang);
    case 'log': return logProp(x, y, r * 2.2, ang == null ? 16 : ang);
    case 'fire': return campfire(x, y);
    case 'dead': return deadTree(x, y + r * .5, r * 1.5, o);
    case 'crate': return crate(x, y, r);
    case 'wall': return wall(x - r, y - 8, 2 * r, false);
    case 'door': return door(x - CELL / 2, y - 8);
    default: return tree(x, y, r, o);
  }
}

function svgScene(W: number, H: number, inner: string, cls?: string): string {
  return `<svg class="inksvg ${cls || ''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${defs()}${inner}</svg>`;
}

/** A single piece on a grass swatch — for the palette. */
export function inkTile(name: string): string {
  const V = 80, c = V / 2;
  let inner = grassRect(V);
  switch (name) {
    case 'oak': inner += tree(c, c + 2, 28, { seed: 4 }); break;
    case 'pine': inner += tree(c, c + 2, 27, { dark: true, seed: 9 }); break;
    case 'bush': inner += bush(c, c + 6, 21, { seed: 3 }); break;
    case 'boulder': inner += rock(c, c + 2, 20, { seed: 6 }); break;
    case 'rocks': inner += rock(c - 9, c + 4, 12, { seed: 2 }) + rock(c + 9, c - 2, 10, { seed: 8 }) + rock(c + 4, c + 12, 8, { seed: 5 }); break;
    case 'pond': inner += pond(c, c + 2, 26, { seed: 7 }); break;
    case 'log': inner += logProp(c, c, 52, 18); break;
    case 'wall': inner += wall(c - 28, c - 8, 56, false); break;
    case 'door': inner = `<rect x="0" y="0" width="${V}" height="${V}" fill="url(#dirtGrad)"/>` + door(8, c - 8); break;
    case 'tent': inner += tent(c, c, 44, -6); break;
    case 'fire': inner += campfire(c, c + 2); break;
    case 'dead': inner += deadTree(c, c + 22, 40, { seed: 1 }); break;
    case 'crate': inner += crate(c, c, 17); break;
    default: inner += tree(c, c, 26, {});
  }
  return svgScene(V, V, inner, 'tile-svg');
}

/** A single piece on a TRANSPARENT square canvas (2r+pad), centred — for placement. */
export function inkSprite(type: string, r: number, ang?: number, seed?: number): string {
  const pad = 16, D = 2 * r + pad * 2, c = D / 2;
  return svgScene(D, D, prop(type, c, c, r, ang, seed), 'sprite-svg');
}
export const INK_SPRITE_PAD = 16;

/** The built-in library, grouped for the palette. */
export interface InkPiece {
  name: string;
  label: string;
  layer: 'terrain' | 'props';
  /** terrain/walls lock to the grid; props are free. */
  lockedToGrid: boolean;
}

export const INK_LIBRARY: { section: string; pieces: InkPiece[] }[] = [
  { section: 'Nature', pieces: [
    { name: 'oak', label: 'Oak', layer: 'props', lockedToGrid: false },
    { name: 'pine', label: 'Pine', layer: 'props', lockedToGrid: false },
    { name: 'bush', label: 'Bush', layer: 'props', lockedToGrid: false },
    { name: 'dead', label: 'Dead tree', layer: 'props', lockedToGrid: false },
  ]},
  { section: 'Stone & ground', pieces: [
    // Rocks read as fixed obstacles → terrain (grid-locked), like walls/doors.
    { name: 'boulder', label: 'Boulder', layer: 'terrain', lockedToGrid: true },
    { name: 'rocks', label: 'Rubble', layer: 'terrain', lockedToGrid: true },
    { name: 'wall', label: 'Stone wall', layer: 'terrain', lockedToGrid: true },
    { name: 'door', label: 'Door', layer: 'terrain', lockedToGrid: true },
  ]},
  { section: 'Water & camp', pieces: [
    // Water is a map feature → terrain; camp items are placed objects → props.
    { name: 'pond', label: 'Pond', layer: 'terrain', lockedToGrid: true },
    { name: 'fire', label: 'Campfire', layer: 'props', lockedToGrid: false },
    { name: 'log', label: 'Log', layer: 'props', lockedToGrid: false },
    { name: 'tent', label: 'Tent', layer: 'props', lockedToGrid: false },
    { name: 'crate', label: 'Crate', layer: 'props', lockedToGrid: false },
  ]},
];

export const INK_PIECE_BY_NAME: Record<string, InkPiece> = Object.fromEntries(
  INK_LIBRARY.flatMap((g) => g.pieces).map((p) => [p.name, p]),
);
