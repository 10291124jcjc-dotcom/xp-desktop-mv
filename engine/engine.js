/* Pinkdows XP desktop engine.
 *
 * drawFrame(t) is a pure function of t: everything on screen is derived from the loaded shot scripts
 * (shots/*.json), analysis/beats.json, analysis/shots.json and analysis/rms.json.
 * The UI is laid out on a 960x540 logical desktop and drawn at S = 2 (1920x1080).
 * Times in scripts may be seconds or beat references: "b:N" (beat index) / "bar:K" (fractional bars).
 */
(() => {
'use strict';

const params = new URLSearchParams(location.search);
const OUT = parseFloat(params.get('scale') || '1');
const LW = 960, LH = 540, FPS = 30;
const S = 2 * OUT;
const W = Math.round(LW * S), H = Math.round(LH * S);
const TASKBAR_H = 30;

const canvas = document.getElementById('c');
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d');

const FONT = {
  ui: 'Tahoma, "Microsoft YaHei", SimHei, sans-serif',
  title: '"Trebuchet MS", "Microsoft YaHei", SimHei, sans-serif',
  mono: 'Consolas, "Microsoft YaHei", monospace',
  cjk: '"Microsoft YaHei", SimHei, sans-serif',
  boot: '"Franklin Gothic Medium", "Arial Black", "Microsoft YaHei", sans-serif',
};
const font = (size, fam = 'ui', weight = '', style = '') => `${style} ${weight} ${size}px ${FONT[fam]}`.replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ theme (pink Luna)
const C = {
  titleStops: [[0, '#ffa6d1'], [0.07, '#ff62ad'], [0.18, '#ff4fa0'], [0.55, '#ec348a'], [0.88, '#dd2479'], [1, '#c4136a']],
  titleStopsInactive: [[0, '#f3e4eb'], [0.1, '#e9cfdb'], [0.6, '#dfbfce'], [1, '#d4afc1']],
  frame: '#dd2479', frameInactive: '#eeaacb', frameEdge: '#7d0d48', frameEdgeInactive: '#c886a7',
  body: '#fff0f6', face: '#fde4ef', faceDark: '#e9bfd2', ink: '#2a0718',
  btnBorder: '#7a1048', select: '#d81b72',
  taskStops: [[0, '#ffb1d6'], [0.06, '#ff7fbe'], [0.16, '#ff59a9'], [0.6, '#ea3a8f'], [1, '#d01c6f']],
  trayStops: [[0, '#ffc2df'], [0.08, '#ff9fcd'], [0.5, '#fb83bf'], [1, '#e8569f']],
};

// ------------------------------------------------------------------ data
let BEATS = null, SHOTS = null, RMS = null, SCRIPT = null;
let SRC_MAX = 1221;  // last 30fps source frame index; recomputed from beats.json duration at init

async function loadJSON(u) {
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) throw new Error('fetch ' + u);
  return r.json();
}

// "b:N" -> time of beat N (fractional ok), "bar:K" -> start of bar K (fractional = beats/4)
function resolveTime(v) {
  const m = /^(b|bar):(-?[\d.]+)([+-][\d.]+)?$/.exec(v);
  if (!m) return v;
  const n = parseFloat(m[2]), off = m[3] ? parseFloat(m[3]) : 0;
  const P = BEATS.period;
  const t = m[1] === 'b' ? BEATS.beats[0].t + n * P : BEATS.bar_starts[0] + n * 4 * P;
  // snap to the 30fps frame grid so a cut on a beat lands on the nearest frame, never one late
  return Math.round((t + off) * FPS) / FPS - 1e-4;
}
function compile(o) {
  if (Array.isArray(o)) return o.map(compile);
  if (o && typeof o === 'object') { const r = {}; for (const k in o) r[k] = compile(o[k]); return r; }
  if (typeof o === 'string' && /^(b|bar):/.test(o)) return resolveTime(o);
  return o;
}

function mergeScripts(list) {
  const out = { base: [], windows: [], balloons: [], mattes: [], icons: [], stickers: [], cursor: { keys: [], clicks: [], hide: [] },
                startmenu: [], overlays: [], clock: [], ground: [], taskExtras: [] };
  for (const s of list) {
  for (const k of ['base', 'windows', 'balloons', 'mattes', 'icons', 'stickers', 'startmenu', 'overlays', 'clock', 'ground', 'taskExtras'])
      if (s[k]) out[k].push(...s[k]);
    if (s.cursor) for (const k of ['keys', 'clicks', 'hide']) if (s.cursor[k]) out.cursor[k].push(...s.cursor[k]);
  }
  out.cursor.keys.sort((a, b) => a.t - b.t);
  return out;
}

// ------------------------------------------------------------------ helpers
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, x) => a + (b - a) * x;
const EASE = {
  linear: x => x,
  in: x => x * x * x,
  out: x => 1 - Math.pow(1 - x, 3),
  inOut: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  back: x => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  step: x => (x < 1 ? 0 : 1),
};
// keyframe track: [{t, ...numbers, ease}] -> interpolated numeric props at t
function track(keys, t) {
  if (!keys || !keys.length) return null;
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t < b.t) {
      const e = EASE[b.ease || 'inOut'](clamp((t - a.t) / (b.t - a.t), 0, 1));
      const r = { ...a };
      for (const k in b) if (typeof b[k] === 'number' && typeof a[k] === 'number' && k !== 't') r[k] = a[k] + (b[k] - a[k]) * e;
      return r;
    }
  }
  return keys[keys.length - 1];
}
const active = (o, t) => t >= o.t0 && t < o.t1;
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pad5 = n => String(n).padStart(5, '0');
const beatPhase = t => { const P = BEATS.period; return ((t - BEATS.beats[0].t) / P) % 1; };
// 1 on the beat, decays to 0 over the beat
const beatPulse = (t, sharp = 6) => { const p = beatPhase(t); return Math.exp(-sharp * (p < 0 ? p + 1 : p)); };
const rmsAt = t => RMS ? RMS.rms[clamp(Math.round(t * FPS), 0, RMS.rms.length - 1)] : 0.5;

function grad(x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function text(str, x, y, fnt, color, align = 'left', shadow = null) {
  ctx.font = fnt; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  if (shadow) { ctx.fillStyle = shadow; ctx.fillText(str, x + 1, y + 1); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}
const measure = (str, fnt) => { ctx.font = fnt; return ctx.measureText(str).width; };
function ellipsize(str, fnt, maxW) {
  if (measure(str, fnt) <= maxW) return str;
  while (str.length > 1 && measure(str + '...', fnt) > maxW) str = str.slice(0, -1);
  return str + '...';
}

// ------------------------------------------------------------------ images (collect-then-load; drawing is pure)
const cache = new Map();
let NEED = new Set();
function img(url) {
  NEED.add(url);
  const c = cache.get(url);
  return c && c.img ? c.img : null;
}
function load(url) {
  if (cache.has(url)) return cache.get(url).p;
  const entry = { img: null, p: null };
  entry.p = new Promise(res => {
    const im = new Image();
    im.onload = () => { entry.img = im; res(im); };
    im.onerror = () => { console.warn('missing ' + url); entry.img = null; res(null); };
    im.src = url;
  });
  cache.set(url, entry);
  return entry.p;
}
function evict(keep) {
  if (cache.size < 700) return;
  for (const k of cache.keys()) { if (!keep.has(k)) cache.delete(k); if (cache.size < 500) break; }
}
const srcUrl = i => `../clips/src/f${pad5(clamp(i, 0, SRC_MAX))}.jpg`;
const matteUrl = (clip, i) => `../mattes/${clip}/f${pad5(i)}.png`;
function cropAt(ts) {
  for (const s of SHOTS) if (ts >= s.start && ts < s.end) return s.crop;
  return SHOTS[SHOTS.length - 1].crop;
}
// draw source video at source time ts into logical rect; mode 'contain' | 'cover'
function drawSource(ts, x, y, w, h, mode = 'contain', bg = '#000', aspect = null) {
  const idx = clamp(Math.round(ts * FPS), 0, SRC_MAX);
  const im = img(srcUrl(idx));
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(x, y, w, h); }
  if (!im) return;
  let [sw, sh, sx, sy] = cropAt(idx / FPS);
  { const ix = sw * 0.015, iy = sh * 0.015; sx += ix; sy += iy; sw -= 2 * ix; sh -= 2 * iy; }
  if (aspect) { // force a fixed aspect by center-cropping (never stretching)
    if (sw / sh > aspect) { const nw = sh * aspect; sx += (sw - nw) / 2; sw = nw; }
    else { const nh = sw / aspect; sy += (sh - nh) / 2; sh = nh; }
  }
  const ar = w / h, sar = sw / sh;
  if (mode === 'cover') {
    if (sar > ar) { const nw = sh * ar; sx += (sw - nw) / 2; sw = nw; } else { const nh = sw / ar; sy += (sh - nh) / 2; sh = nh; }
    ctx.drawImage(im, sx, sy, sw, sh, x, y, w, h);
  } else {
    let dw = w, dh = w / sar;
    if (dh > h) { dh = h; dw = h * sar; }
    ctx.drawImage(im, sx, sy, sw, sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
}

// ------------------------------------------------------------------ wallpaper: procedural pink Bliss (cached, real resolution)
let WALL = null;
function wallpaper() {
  if (WALL) return WALL;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.scale(S, S);
  // sky: light pink -> white at the horizon, a warm glow upper-left
  let gr = g.createLinearGradient(0, 0, 0, 330);
  gr.addColorStop(0, '#f493c4'); gr.addColorStop(0.45, '#fbc3df'); gr.addColorStop(1, '#fff3f9');
  g.fillStyle = gr; g.fillRect(0, 0, LW, LH);
  const glow = g.createRadialGradient(230, 150, 10, 230, 150, 420);
  glow.addColorStop(0, 'rgba(255,255,255,0.55)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow; g.fillRect(0, 0, LW, LH);

  // clouds: clusters of soft puffs, blurred
  const cl = document.createElement('canvas'); cl.width = W; cl.height = H;
  const cg = cl.getContext('2d'); cg.scale(S, S);
  const rnd = mulberry32(20241018);
  // wispy streaks first (very soft), then a few cumulus heaps built from many small puffs with flattish bases
  for (let i = 0; i < 9; i++) {
    const wx = rnd() * LW, wy = 30 + rnd() * 170, ww = 120 + rnd() * 220, wh = 6 + rnd() * 10;
    const wg = cg.createRadialGradient(wx, wy, 1, wx, wy, ww / 2);
    wg.addColorStop(0, 'rgba(255,255,255,0.45)'); wg.addColorStop(1, 'rgba(255,255,255,0)');
    cg.save(); cg.translate(wx, wy); cg.scale(1, wh / (ww / 2)); cg.translate(-wx, -wy);
    cg.fillStyle = wg; cg.beginPath(); cg.arc(wx, wy, ww / 2, 0, Math.PI * 2); cg.fill(); cg.restore();
  }
  const heaps = [[150, 92, 1.1], [420, 58, 0.75], [640, 118, 1.25], [880, 76, 0.85], [300, 178, 0.5], [800, 196, 0.45]];
  for (const [cx, cy, sc] of heaps) {
    const n = Math.round(60 * sc);
    for (let i = 0; i < n; i++) {
      // gaussian-ish spread, more puffs on top, base clipped flat
      const u = (rnd() + rnd() + rnd()) / 3 - 0.5, v = -Math.abs((rnd() + rnd()) / 2 - 0.5);
      const px = cx + u * 230 * sc, py = cy + v * 70 * sc * (1 - Math.abs(u) * 1.2);
      const r = (6 + rnd() * 16) * sc * (1 - Math.abs(u));
      if (r < 2) continue;
      const pg = cg.createRadialGradient(px - r * 0.2, py - r * 0.35, r * 0.1, px, py, r);
      pg.addColorStop(0, 'rgba(255,255,255,0.9)'); pg.addColorStop(0.7, 'rgba(255,246,251,0.55)'); pg.addColorStop(1, 'rgba(255,236,246,0)');
      cg.fillStyle = pg; cg.beginPath(); cg.arc(px, py, r, 0, Math.PI * 2); cg.fill();
    }
    // soft pink shadow under the heap
    const sg = cg.createRadialGradient(cx, cy + 6 * sc, 2, cx, cy + 6 * sc, 110 * sc);
    sg.addColorStop(0, 'rgba(240,150,195,0.22)'); sg.addColorStop(1, 'rgba(240,150,195,0)');
    cg.save(); cg.translate(cx, cy + 6 * sc); cg.scale(1, 0.18); cg.translate(-cx, -(cy + 6 * sc));
    cg.fillStyle = sg; cg.beginPath(); cg.arc(cx, cy + 6 * sc, 110 * sc, 0, Math.PI * 2); cg.fill(); cg.restore();
  }
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.filter = `blur(${3.5 * S}px)`; g.drawImage(cl, 0, 0); g.restore();

  // far hill on the right (paler, hazy)
  g.beginPath(); g.moveTo(380, LH); g.bezierCurveTo(500, 330, 690, 262, 960, 282); g.lineTo(960, LH); g.closePath();
  gr = g.createLinearGradient(0, 262, 0, LH); gr.addColorStop(0, '#f7b4d3'); gr.addColorStop(1, '#ec82b6');
  g.fillStyle = gr; g.fill();
  // main hill
  const hill = new Path2D();
  hill.moveTo(0, 318); hill.bezierCurveTo(140, 250, 320, 214, 470, 240);
  hill.bezierCurveTo(620, 266, 790, 338, 960, 352); hill.lineTo(960, LH); hill.lineTo(0, LH); hill.closePath();
  gr = g.createLinearGradient(0, 214, 0, LH);
  gr.addColorStop(0, '#ff9acb'); gr.addColorStop(0.18, '#fb74b6'); gr.addColorStop(0.55, '#ec4f9c'); gr.addColorStop(1, '#cf2f80');
  g.fillStyle = gr; g.fill(hill);
  g.save(); g.clip(hill);
  // sunlit crest and a soft shade on the right slope
  let rg = g.createRadialGradient(300, 230, 10, 300, 260, 330);
  rg.addColorStop(0, 'rgba(255,225,240,0.55)'); rg.addColorStop(1, 'rgba(255,225,240,0)');
  g.fillStyle = rg; g.fillRect(0, 0, LW, LH);
  rg = g.createRadialGradient(860, 520, 20, 860, 520, 360);
  rg.addColorStop(0, 'rgba(150,20,80,0.28)'); rg.addColorStop(1, 'rgba(150,20,80,0)');
  g.fillStyle = rg; g.fillRect(0, 0, LW, LH);
  // grass grain: short soft strokes, denser toward the bottom
  g.setTransform(1, 0, 0, 1, 0, 0);
  const rn = mulberry32(99);
  for (let i = 0; i < 26000 * OUT * OUT; i++) {
    const x = rn() * W, y = (214 + Math.pow(rn(), 0.7) * (LH - 214)) * S;
    const lighter = rn() < 0.5;
    g.fillStyle = lighter ? `rgba(255,220,238,${0.05 + rn() * 0.08})` : `rgba(120,10,60,${0.04 + rn() * 0.07})`;
    g.fillRect(x, y, 1.2 * S * 0.5, (1 + rn() * 2.5) * S * 0.5);
  }
  g.restore();
  // crest rim light
  g.save(); g.lineWidth = 2; g.strokeStyle = 'rgba(255,235,245,0.55)'; g.filter = `blur(${1 * S}px)`;
  g.beginPath(); g.moveTo(0, 319); g.bezierCurveTo(140, 251, 320, 215, 470, 241); g.bezierCurveTo(620, 267, 790, 339, 960, 353); g.stroke(); g.restore();
  WALL = c;
  return c;
}

// ------------------------------------------------------------------ vector icons (32x32 logical unless size given)
function icon(kind, x, y, s = 32) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s / 32, s / 32);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const D = ICONS[kind] || ICONS.file;
  D();
  ctx.restore();
}
const ICONS = {
  pc() {
    // tower behind
    rr(19, 6, 10, 22, 1.5); ctx.fillStyle = grad(19, 0, 29, 0, [[0, '#f4f1ea'], [1, '#c9c3b5']]); ctx.fill();
    ctx.strokeStyle = '#6f6a5f'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#7b766a'; ctx.fillRect(21, 10, 6, 1.2); ctx.fillRect(21, 13, 6, 1.2);
    ctx.fillStyle = '#4cd964'; ctx.fillRect(22, 24, 2, 1.5);
    // monitor
    rr(2, 4, 21, 17, 2); ctx.fillStyle = grad(0, 4, 0, 21, [[0, '#fbf9f4'], [1, '#d6d0c2']]); ctx.fill();
    ctx.strokeStyle = '#6f6a5f'; ctx.stroke();
    ctx.fillStyle = grad(0, 6, 0, 18, [[0, '#ff9fcd'], [0.5, '#f05aa5'], [1, '#b8135f']]); ctx.fillRect(4.5, 6.5, 16, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(4.5, 6.5); ctx.lineTo(14, 6.5); ctx.lineTo(4.5, 13); ctx.fill();
    ctx.fillStyle = '#bdb6a6'; ctx.fillRect(9, 21, 7, 3); rr(5, 24, 15, 3, 1); ctx.fillStyle = '#d6d0c2'; ctx.fill(); ctx.strokeStyle = '#6f6a5f'; ctx.stroke();
  },
  bin() {
    ctx.beginPath(); ctx.moveTo(6, 9); ctx.lineTo(26, 9); ctx.lineTo(23.5, 29); ctx.lineTo(8.5, 29); ctx.closePath();
    ctx.fillStyle = grad(6, 0, 26, 0, [[0, 'rgba(225,240,250,0.95)'], [0.5, 'rgba(250,252,255,0.95)'], [1, 'rgba(190,210,225,0.95)']]); ctx.fill();
    ctx.strokeStyle = '#5d7385'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(93,115,133,0.55)';
    for (let i = 0; i < 6; i++) { const xx = 9 + i * 2.8; ctx.beginPath(); ctx.moveTo(xx, 11); ctx.lineTo(xx + (16 - xx) * 0.06, 27); ctx.stroke(); }
    for (let j = 0; j < 4; j++) { const yy = 13 + j * 4; ctx.beginPath(); ctx.moveTo(7.5 + j * 0.35, yy); ctx.lineTo(24.5 - j * 0.35, yy); ctx.stroke(); }
    ctx.beginPath(); ctx.ellipse(16, 9, 10.5, 2.6, 0, 0, Math.PI * 2); ctx.fillStyle = '#e9f2f8'; ctx.fill(); ctx.strokeStyle = '#5d7385'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(16, 9, 8, 1.6, 0, 0, Math.PI * 2); ctx.fillStyle = '#9fb3c2'; ctx.fill();
  },
  file(accent = '#f05aa5', glyph = null) {
    ctx.beginPath(); ctx.moveTo(6, 2); ctx.lineTo(20, 2); ctx.lineTo(27, 9); ctx.lineTo(27, 30); ctx.lineTo(6, 30); ctx.closePath();
    ctx.fillStyle = grad(6, 0, 27, 0, [[0, '#ffffff'], [1, '#ececec']]); ctx.fill(); ctx.strokeStyle = '#7d7d7d'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(20, 2); ctx.lineTo(20, 9); ctx.lineTo(27, 9); ctx.fillStyle = '#d9d9d9'; ctx.fill(); ctx.stroke();
    if (glyph) glyph();
  },
  mp3() {
    ICONS.file('#f05aa5', () => {
      ctx.beginPath(); ctx.arc(16, 18, 8.5, 0, Math.PI * 2);
      ctx.fillStyle = grad(0, 10, 0, 27, [[0, '#ff8cc4'], [1, '#c8166a']]); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(13.4, 21.2, 2.3, 1.7, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(15, 13, 1.4, 8.5);
      ctx.beginPath(); ctx.moveTo(16.4, 13); ctx.quadraticCurveTo(20, 14.5, 19.5, 17.5); ctx.quadraticCurveTo(18.6, 15.6, 16.4, 15.5); ctx.fill();
    });
  },
  drum() {
    // shell
    ctx.beginPath(); ctx.ellipse(16, 22, 12, 5, 0, 0, Math.PI); ctx.lineTo(4, 13); ctx.ellipse(16, 13, 12, 5, 0, Math.PI, 0, true); ctx.closePath();
    ctx.fillStyle = grad(4, 0, 28, 0, [[0, '#8e0d2c'], [0.35, '#e0304f'], [0.6, '#ff6a7f'], [1, '#7a0a24']]); ctx.fill();
    ctx.strokeStyle = '#4a0614'; ctx.lineWidth = 1; ctx.stroke();
    // hoops
    ctx.strokeStyle = '#d9d9d9'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(16, 22, 12, 5, 0, 0, Math.PI); ctx.stroke();
    // head with bolt
    ctx.beginPath(); ctx.ellipse(16, 13, 12, 5, 0, 0, Math.PI * 2); ctx.fillStyle = '#fff6fa'; ctx.fill(); ctx.strokeStyle = '#9a9a9a'; ctx.stroke();
    ctx.fillStyle = '#f0408f'; ctx.beginPath(); ctx.moveTo(17.5, 9.3); ctx.lineTo(13, 13.6); ctx.lineTo(16, 13.4); ctx.lineTo(14.2, 16.8); ctx.lineTo(19, 12.2); ctx.lineTo(16, 12.4); ctx.closePath(); ctx.fill();
    // sticks
    ctx.strokeStyle = '#b07a3e'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(6, 2); ctx.lineTo(15, 10); ctx.moveTo(27, 3); ctx.lineTo(19, 10); ctx.stroke();
    ctx.fillStyle = '#e8c79a'; ctx.beginPath(); ctx.arc(15, 10, 1.3, 0, 7); ctx.arc(19, 10, 1.3, 0, 7); ctx.fill();
  },
  apt() {
    // cardboard package box with pink tape
    ctx.beginPath(); ctx.moveTo(4, 11); ctx.lineTo(16, 6); ctx.lineTo(28, 11); ctx.lineTo(28, 25); ctx.lineTo(16, 30); ctx.lineTo(4, 25); ctx.closePath();
    ctx.fillStyle = '#c8955a'; ctx.fill(); ctx.strokeStyle = '#6b4520'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 11); ctx.lineTo(16, 16); ctx.lineTo(28, 11); ctx.lineTo(16, 6); ctx.closePath(); ctx.fillStyle = '#e2b47a'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16, 16); ctx.lineTo(16, 30); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 11); ctx.lineTo(16, 16); ctx.lineTo(16, 30); ctx.lineTo(4, 25); ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fill();
    ctx.strokeStyle = '#ff4fa0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(10, 8.5); ctx.lineTo(22, 13.5); ctx.stroke();
    text('apt', 22.2, 24.5, font(6.5, 'mono', 'bold'), '#5a3410', 'center');
  },
  terminal() {
    rr(2, 4, 28, 24, 2); ctx.fillStyle = '#1b1b1b'; ctx.fill(); ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = grad(0, 4, 0, 9, [[0, '#ff7fbe'], [1, '#d81b72']]); rr(2, 4, 28, 5, [2, 2, 0, 0]); ctx.fill();
    text('>_', 6, 21, font(10, 'mono', 'bold'), '#7CFC00');
  },
  notepad() {
    rr(6, 3, 21, 27, 1); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#6b8cb5'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#87a8d6'; ctx.fillRect(6.5, 3.5, 20, 4);
    ctx.strokeStyle = '#9db4d8'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(9, 12 + i * 3) ; ctx.lineTo(24, 12 + i * 3); ctx.stroke(); }
    ctx.strokeStyle = '#555'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(9 + i * 4, 3.5, 1.3, Math.PI, 0); ctx.stroke(); }
  },
  media() {
    ctx.beginPath(); ctx.arc(16, 16, 13, 0, Math.PI * 2);
    ctx.fillStyle = grad(0, 3, 0, 29, [[0, '#ffa6d1'], [0.5, '#f0408f'], [1, '#a50f55']]); ctx.fill();
    ctx.strokeStyle = '#6e0a39'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(16, 10, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(12.5, 9.5); ctx.lineTo(23, 16); ctx.lineTo(12.5, 22.5); ctx.closePath(); ctx.fill();
  },
  camera() {
    rr(3, 10, 19, 14, 3); ctx.fillStyle = grad(0, 10, 0, 24, [[0, '#ff8cc4'], [1, '#c8166a']]); ctx.fill(); ctx.strokeStyle = '#6e0a39'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(22, 14); ctx.lineTo(29, 10); ctx.lineTo(29, 24); ctx.lineTo(22, 20); ctx.closePath(); ctx.fillStyle = '#a50f55'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(8, 14, 2, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
  },
  taskmgr() {
    rr(3, 4, 26, 19, 2); ctx.fillStyle = '#e9e4da'; ctx.fill(); ctx.strokeStyle = '#6f6a5f'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#000'; ctx.fillRect(5.5, 6.5, 21, 14);
    ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(6, 17); ctx.lineTo(10, 12); ctx.lineTo(13, 15); ctx.lineTo(17, 8); ctx.lineTo(21, 13); ctx.lineTo(26, 9); ctx.stroke();
    ctx.fillStyle = '#bdb6a6'; ctx.fillRect(12, 23, 8, 3); ctx.fillRect(8, 26, 16, 2);
  },
  error() {
    ctx.beginPath(); ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fillStyle = grad(0, 2, 0, 30, [[0, '#ff7b7b'], [0.5, '#e01f1f'], [1, '#9c0000']]); ctx.fill();
    ctx.strokeStyle = '#6d0000'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.beginPath(); ctx.ellipse(16, 9.5, 9.5, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(10.5, 10.5); ctx.lineTo(21.5, 21.5); ctx.moveTo(21.5, 10.5); ctx.lineTo(10.5, 21.5); ctx.stroke();
  },
  warn() {
    ctx.beginPath(); ctx.moveTo(16, 3); ctx.lineTo(30, 28); ctx.lineTo(2, 28); ctx.closePath();
    ctx.fillStyle = grad(0, 3, 0, 28, [[0, '#ffe66b'], [1, '#f2b300']]); ctx.fill(); ctx.strokeStyle = '#7a5a00'; ctx.lineWidth = 1; ctx.stroke();
    text('!', 16, 25, font(17, 'ui', 'bold'), '#000', 'center');
  },
  question() {
    ctx.beginPath(); ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fillStyle = grad(0, 2, 0, 30, [[0, '#ffffff'], [1, '#d8e6f5']]); ctx.fill(); ctx.strokeStyle = '#2a5ea8'; ctx.lineWidth = 1.2; ctx.stroke();
    text('?', 16, 23.5, font(20, 'ui', 'bold'), '#1e4fa0', 'center');
  },
  info() {
    ctx.beginPath(); ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fillStyle = grad(0, 2, 0, 30, [[0, '#ffffff'], [1, '#dbe7f6']]); ctx.fill(); ctx.strokeStyle = '#2a5ea8'; ctx.lineWidth = 1.2; ctx.stroke();
    text('i', 16, 24, font(19, 'title', 'bold'), '#1e4fa0', 'center');
  },
  hardware() {
    rr(4, 9, 24, 15, 2); ctx.fillStyle = grad(0, 9, 0, 24, [[0, '#4caf50'], [1, '#1b5e20']]); ctx.fill(); ctx.strokeStyle = '#0d3a12'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#111'; ctx.fillRect(9, 12, 9, 7); ctx.fillStyle = '#e0c060';
    for (let i = 0; i < 6; i++) ctx.fillRect(6 + i * 3.6, 24, 1.6, 4);
    text('APT', 22, 19.5, font(5.5, 'ui', 'bold'), '#fff', 'center');
  },
  bolt() {
    ctx.fillStyle = '#ff4fa0'; ctx.strokeStyle = '#ffd1e6'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(20, 1); ctx.lineTo(6, 18); ctx.lineTo(15, 17); ctx.lineTo(11, 31); ctx.lineTo(26, 12); ctx.lineTo(17, 13); ctx.closePath(); ctx.fill(); ctx.stroke();
  },
  folder() {
    ctx.beginPath(); ctx.moveTo(3, 8); ctx.lineTo(12, 8); ctx.lineTo(14, 10); ctx.lineTo(29, 10); ctx.lineTo(29, 27); ctx.lineTo(3, 27); ctx.closePath();
    ctx.fillStyle = grad(0, 8, 0, 27, [[0, '#ffe39a'], [1, '#e6b43c']]); ctx.fill(); ctx.strokeStyle = '#a07b1c'; ctx.lineWidth = 1; ctx.stroke();
  },
  power() {
    rr(2, 2, 28, 28, 5); ctx.fillStyle = grad(0, 2, 0, 30, [[0, '#ff9b6a'], [1, '#d9431e']]); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(16, 17, 7, -Math.PI * 0.32, Math.PI * 1.32); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16, 7); ctx.lineTo(16, 16); ctx.stroke();
  },
  logoff() {
    rr(2, 2, 28, 28, 5); ctx.fillStyle = grad(0, 2, 0, 30, [[0, '#ffd36a'], [1, '#e09a10']]); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillRect(9, 8, 9, 16); ctx.fillStyle = '#e09a10'; ctx.fillRect(11, 10, 5, 12);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(15, 16); ctx.lineTo(26, 16); ctx.moveTo(22, 12); ctx.lineTo(26, 16); ctx.lineTo(22, 20); ctx.stroke();
  },
};

// ------------------------------------------------------------------ cursor
function drawCursor(x, y) {
  ctx.save(); ctx.translate(x, y);
  const p = new Path2D('M0 0 L0 16.5 L3.9 12.7 L6.6 18.8 L8.9 17.8 L6.3 11.8 L11.6 11.8 Z');
  ctx.save(); ctx.translate(1.2, 1.2); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill(p); ctx.restore();
  ctx.fillStyle = '#fff'; ctx.fill(p);
  ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.lineJoin = 'miter'; ctx.stroke(p);
  ctx.restore();
}

// ------------------------------------------------------------------ XP push button
function button(label, x, y, w, h, st = {}) {
  ctx.save();
  rr(x + 0.5, y + 0.5, w - 1, h - 1, 3);
  ctx.fillStyle = st.pressed ? grad(0, y, 0, y + h, [[0, '#ebc6d7'], [1, '#f8e4ee']])
                             : grad(0, y, 0, y + h, [[0, '#ffffff'], [0.85, '#f7e6ee'], [1, '#e9c9d8']]);
  ctx.fill();
  ctx.strokeStyle = C.btnBorder; ctx.lineWidth = 1; ctx.stroke();
  if (st.focus && !st.pressed) { rr(x + 2, y + 2, w - 4, h - 4, 2); ctx.strokeStyle = '#ff8cc4'; ctx.lineWidth = 1.6; ctx.stroke(); }
  if (st.hover && !st.pressed) { rr(x + 1.5, y + 1.5, w - 3, h - 3, 2); ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 1.6; ctx.stroke(); }
  const off = st.pressed ? 1 : 0;
  text(label, x + w / 2 + off, y + h / 2 + 5 + off, font(st.size || 13, 'ui', st.bold ? 'bold' : ''), C.ink, 'center');
  ctx.restore();
}

// ------------------------------------------------------------------ window chrome
const TB = 26;
function titleButtons(x, y, w, kinds, actv) {
  let bx = x + w - 6 - 21;
  for (let i = kinds.length - 1; i >= 0; i--) {
    const k = kinds[i];
    rr(bx + 0.5, y + 3.5, 21, 21, 3);
    const close = k === 'close';
    ctx.fillStyle = close ? grad(0, y + 3, 0, y + 24, actv ? [[0, '#ff9a8a'], [0.5, '#f0503f'], [1, '#c8261c']] : [[0, '#f8c9c2'], [1, '#eba59c']])
                          : grad(0, y + 3, 0, y + 24, actv ? [[0, '#ffb3d8'], [0.5, '#f45ea8'], [1, '#d42a7e']] : [[0, '#fbdcea'], [1, '#f0b7d1']]);
    ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2.2; ctx.lineCap = 'square';
    const cx = bx + 10.5, cy = y + 14;
    if (close) { ctx.beginPath(); ctx.moveTo(cx - 4.5, cy - 4.5); ctx.lineTo(cx + 4.5, cy + 4.5); ctx.moveTo(cx + 4.5, cy - 4.5); ctx.lineTo(cx - 4.5, cy + 4.5); ctx.stroke(); }
    if (k === 'min') ctx.fillRect(cx - 4.5, cy + 3, 7, 2.6);
    if (k === 'max') { ctx.lineWidth = 1.2; ctx.strokeRect(cx - 5, cy - 5, 10, 10); ctx.fillRect(cx - 5, cy - 5, 10, 2.6); }
    bx -= 23;
  }
}
// returns client rect
function windowChrome(win, actv) {
  const { x, y, w, h } = win;
  ctx.save();
  // soft shadow so stacked windows separate
  ctx.shadowColor = 'rgba(60,0,30,0.35)'; ctx.shadowBlur = 10 * S; ctx.shadowOffsetX = 2 * S; ctx.shadowOffsetY = 3 * S;
  rr(x, y, w, h, [8, 8, 0, 0]); ctx.fillStyle = actv ? C.frame : C.frameInactive; ctx.fill();
  ctx.restore();
  rr(x + 0.5, y + 0.5, w - 1, h - 1, [8, 8, 0, 0]); ctx.strokeStyle = actv ? C.frameEdge : C.frameEdgeInactive; ctx.lineWidth = 1; ctx.stroke();
  // title bar
  rr(x + 1, y + 1, w - 2, TB, [7, 7, 0, 0]);
  ctx.fillStyle = grad(0, y + 1, 0, y + TB + 1, actv ? C.titleStops : C.titleStopsInactive); ctx.fill();
  ctx.strokeStyle = actv ? 'rgba(255,215,235,0.9)' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 6, y + 1.8); ctx.lineTo(x + w - 6, y + 1.8); ctx.stroke();
  // side frame shading
  ctx.fillStyle = actv ? grad(x, 0, x + 4, 0, [[0, '#c4136a'], [1, '#ef4f9e']]) : '#efb5cf';
  ctx.fillRect(x + 1, y + TB, 3, h - TB - 1);
  ctx.fillStyle = actv ? grad(x + w - 4, 0, x + w, 0, [[0, '#ef4f9e'], [1, '#b80f60']]) : '#efb5cf';
  ctx.fillRect(x + w - 4, y + TB, 3, h - TB - 1);
  ctx.fillStyle = actv ? grad(0, y + h - 4, 0, y + h, [[0, '#ef4f9e'], [1, '#b80f60']]) : '#efb5cf';
  ctx.fillRect(x + 1, y + h - 4, w - 2, 3);
  // icon + title
  let tx = x + 8;
  if (win.icon) { icon(win.icon, x + 6, y + 5, 16); tx = x + 27; }
  const kinds = win.buttons_tb || (win.type === 'error' ? ['close'] : ['min', 'max', 'close']);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w - 8 - kinds.length * 23, TB + 2); ctx.clip();
  text(win.title || '', tx, y + 18.5, font(13, 'title', 'bold'), actv ? '#fff' : '#fff7fb', 'left', actv ? 'rgba(90,0,40,0.75)' : null);
  ctx.restore();
  titleButtons(x, y, w, kinds, actv);
  const c = { x: x + 4, y: y + TB + 1, w: w - 8, h: h - TB - 5 };
  ctx.fillStyle = win.bodyColor || C.body; ctx.fillRect(c.x, c.y, c.w, c.h);
  return c;
}

// ------------------------------------------------------------------ window contents
const CONTENT = {};

CONTENT.media = (win, c, t) => {
  const ctrlH = 46;
  const ts = srcTime(win, t);
  drawSource(ts, c.x, c.y, c.w, c.h - ctrlH, 'contain', '#000');
  const y = c.y + c.h - ctrlH;
  ctx.fillStyle = grad(0, y, 0, y + ctrlH, [[0, '#4a1030'], [0.5, '#2a0719'], [1, '#14030b']]); ctx.fillRect(c.x, y, c.w, ctrlH);
  // seek bar
  const p = clamp(ts / 40.77, 0, 1), sx = c.x + 10, sw = c.w - 20;
  rr(sx, y + 6, sw, 5, 2.5); ctx.fillStyle = '#5d1a3d'; ctx.fill();
  rr(sx, y + 6, Math.max(5, sw * p), 5, 2.5); ctx.fillStyle = grad(0, y + 6, 0, y + 11, [[0, '#ffa6d1'], [1, '#e8338a']]); ctx.fill();
  ctx.beginPath(); ctx.arc(sx + sw * p, y + 8.5, 5, 0, 7); ctx.fillStyle = grad(0, y + 3, 0, y + 14, [[0, '#fff'], [1, '#f6c1db']]); ctx.fill();
  // transport
  const by = y + 29;
  ctx.beginPath(); ctx.arc(c.x + 30, by, 13, 0, 7);
  ctx.fillStyle = grad(0, by - 13, 0, by + 13, [[0, '#ffb3d8'], [0.5, '#f0408f'], [1, '#a50f55']]); ctx.fill();
  ctx.strokeStyle = '#ffd1e6'; ctx.lineWidth = 1; ctx.stroke();
  const playing = win.playing !== false;
  ctx.fillStyle = '#fff';
  if (playing) { ctx.fillRect(c.x + 25, by - 6, 3.5, 12); ctx.fillRect(c.x + 31.5, by - 6, 3.5, 12); }
  else { ctx.beginPath(); ctx.moveTo(c.x + 26, by - 7); ctx.lineTo(c.x + 37, by); ctx.lineTo(c.x + 26, by + 7); ctx.fill(); }
  for (let i = 0; i < 3; i++) {
    const bx = c.x + 58 + i * 24;
    ctx.beginPath(); ctx.arc(bx, by, 8.5, 0, 7); ctx.fillStyle = '#5d1a3d'; ctx.fill(); ctx.strokeStyle = '#a3456f'; ctx.stroke();
    ctx.fillStyle = '#ffd1e6';
    if (i === 0) ctx.fillRect(bx - 3.5, by - 3.5, 7, 7);
    if (i === 1) { ctx.beginPath(); ctx.moveTo(bx + 3, by - 4); ctx.lineTo(bx - 3, by); ctx.lineTo(bx + 3, by + 4); ctx.fill(); ctx.fillRect(bx - 4.5, by - 4, 1.6, 8); }
    if (i === 2) { ctx.beginPath(); ctx.moveTo(bx - 3, by - 4); ctx.lineTo(bx + 3, by); ctx.lineTo(bx - 3, by + 4); ctx.fill(); ctx.fillRect(bx + 3, by - 4, 1.6, 8); }
  }
  const mm = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  text(`${mm(ts)} / 00:40`, c.x + c.w - 10, by + 4, font(11, 'ui'), '#ffd1e6', 'right');
  text(win.status || '正在播放: APT.mp3', c.x + 136, by + 4, font(11, 'ui'), '#ff9fcd', 'left');
};

CONTENT.error = (win, c, t) => {
  ctx.fillStyle = C.body; ctx.fillRect(c.x, c.y, c.w, c.h);
  icon(win.glyph || 'error', c.x + 14, c.y + 16, 32);
  const lines = Array.isArray(win.text) ? win.text : [win.text || ''];
  lines.forEach((ln, i) => text(ln, c.x + 60, c.y + 30 + i * 22, font(win.textSize || 15, 'cjk'), C.ink));
  const btns = win.buttonsList || ['确定'];
  const bf = font(13, 'ui');
  const widths = btns.map(b => Math.max(78, measure(b, bf) + 26));
  const total = widths.reduce((a, b) => a + b, 0) + (btns.length - 1) * 8;
  let bx = c.x + (c.w - total) / 2;
  const by = c.y + c.h - 12 - 25;
  btns.forEach((b, i) => {
    const pressed = (win.press || []).some(p => p.btn === i && t >= p.t - 0.03 && t < p.t + 0.12);
    const hover = (win.hover || []).some(hv => hv.btn === i && t >= hv.t0 && t < hv.t1);
    const dodge = (win.dodge || []).find(d => d.btn === i);
    if (dodge) {
      // drawn after the client clip so it can escape the dialog; leaves a 3-frame ghost trail when it jumps
      const at = tt => { const k = track(dodge.keys, tt); return k ? [k.dx, k.dy] : [0, 0]; };
      win._late = win._late || [];
      win._late.push(() => {
        const [ox, oy] = at(t);
        button(b, bx0 + ox, by + oy, w0, 25, { pressed, hover });
      });
      const bx0 = bx, w0 = widths[i];
    } else {
      button(b, bx, by, widths[i], 25, { pressed, hover, focus: i === (win.default || 0) });
    }
    bx += widths[i] + 8;
  });
};

CONTENT.terminal = (win, c, t) => {
  ctx.fillStyle = '#0c0c0c'; ctx.fillRect(c.x, c.y, c.w, c.h);
  const fs = win.fontSize || 14, lh = fs + 5;
  const fnt = font(fs, 'mono');
  let y = c.y + lh, lastX = c.x + 8, lastY = y;
  const shown = [];
  for (const ln of win.lines || []) {
    // a line is a list of chunks that pop in on beats: {t, s}; or a plain {t, s} output line
    const chunks = ln.chunks || [{ t: ln.t, s: ln.s }];
    if (t < chunks[0].t) continue;
    const str = chunks.filter(ch => t >= ch.t).map(ch => ch.s).join('');
    const dim = ln.dimAt !== undefined && t >= ln.dimAt;
    const flash = t - chunks[chunks.length - 1].t < 2.5 / FPS && ln.flash;
    shown.push({ str, color: dim ? '#6e6e6e' : (ln.color || '#d6d6d6'), prompt: dim ? null : ln.prompt, dimPrompt: dim ? ln.prompt : null, flash });
  }
  const maxLines = Math.floor((c.h - 8) / lh);
  for (const ln of shown.slice(-maxLines)) {
    let x = c.x + 8;
    if (ln.flash) { ctx.fillStyle = 'rgba(124,252,0,0.25)'; ctx.fillRect(c.x + 2, y - fs - 1, c.w - 4, lh); }
    if (ln.prompt) { text(ln.prompt, x, y, fnt, '#ff6fb5'); x += measure(ln.prompt, fnt); }
    if (ln.dimPrompt) { text(ln.dimPrompt, x, y, fnt, '#6e6e6e'); x += measure(ln.dimPrompt, fnt); }
    text(ln.str, x, y, fnt, ln.color);
    lastX = x + measure(ln.str, fnt); lastY = y; y += lh;
  }
  // caret blinks on half beats
  const halfBeats = Math.floor((t - BEATS.beats[0].t) / (BEATS.period / 2));
  if (((halfBeats % 2) + 2) % 2 === 0) { ctx.fillStyle = '#d6d6d6'; ctx.fillRect(lastX + 2, lastY - fs + 3, fs * 0.55, fs - 1); }
};

CONTENT.notepad = (win, c, t) => {
  // menu bar
  ctx.fillStyle = C.face; ctx.fillRect(c.x, c.y, c.w, 20);
  ['文件(F)', '编辑(E)', '格式(O)', '查看(V)', '帮助(H)'].reduce((x, m) => { text(m, x, c.y + 14.5, font(12, 'ui'), C.ink); return x + measure(m, font(12, 'ui')) + 12; }, c.x + 8);
  ctx.fillStyle = '#fff'; ctx.fillRect(c.x, c.y + 20, c.w, c.h - 20);
  // sunken edit-area border
  ctx.fillStyle = '#9a8090'; ctx.fillRect(c.x, c.y + 20, c.w, 1); ctx.fillRect(c.x, c.y + 20, 1, c.h - 20);
  ctx.fillStyle = '#fff'; ctx.fillRect(c.x, c.y + c.h - 1, c.w, 1); ctx.fillRect(c.x + c.w - 1, c.y + 20, 1, c.h - 20);
  const sbw = 16, vx = c.x + 2, vy = c.y + 22, vw = c.w - 4 - sbw, vh = c.h - 24;
  drawSource(srcTime(win, t), vx, vy, vw, vh, 'cover', '#fff');
  // XP vertical scrollbar, thumb follows playback
  const sx = c.x + c.w - 2 - sbw;
  ctx.fillStyle = '#fbeaf2'; ctx.fillRect(sx, vy, sbw, vh);
  const arrowBtn = (y, up) => {
    rr(sx + 0.5, y + 0.5, sbw - 1, sbw - 1, 2); ctx.fillStyle = grad(sx, 0, sx + sbw, 0, [[0, '#ffe1ef'], [1, '#f7bcd8']]); ctx.fill();
    ctx.strokeStyle = '#d58fb2'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#7a1048'; ctx.beginPath();
    if (up) { ctx.moveTo(sx + 4, y + 10); ctx.lineTo(sx + 8, y + 5.5); ctx.lineTo(sx + 12, y + 10); }
    else { ctx.moveTo(sx + 4, y + 6); ctx.lineTo(sx + 8, y + 10.5); ctx.lineTo(sx + 12, y + 6); }
    ctx.fill();
  };
  arrowBtn(vy, true); arrowBtn(vy + vh - sbw, false);
  const trackY = vy + sbw, trackH = vh - 2 * sbw, thumbH = 46;
  const prog = clamp((t - win.t0) / (win.t1 - win.t0), 0, 1);
  rr(sx + 1, trackY + prog * (trackH - thumbH), sbw - 2, thumbH, 3);
  ctx.fillStyle = grad(sx, 0, sx + sbw, 0, [[0, '#ffd1e6'], [1, '#f29cc6']]); ctx.fill(); ctx.strokeStyle = '#c86d9b'; ctx.stroke();
};

CONTENT.videocall = (win, c, t) => {
  ctx.fillStyle = '#2a0719'; ctx.fillRect(c.x, c.y, c.w, c.h);
  // picture punches in 3.5% on listed strong beats (works even when the window is maximized)
  let z = 0;
  for (const pt of win.pulse || []) { const d = t - pt; if (d >= 0 && d < 0.3) z = Math.max(z, 0.035 * Math.exp(-d * 14)); }
  const vx = c.x + 6, vy = c.y + 6, vw = c.w - 12, vh = c.h - 44;
  ctx.save(); ctx.beginPath(); ctx.rect(vx, vy, vw, vh); ctx.clip();
  drawSource(srcTime(win, t), vx - vw * z / 2, vy - vh * z / 2, vw * (1 + z), vh * (1 + z), win.fit || 'contain', '#000');
  ctx.restore();
  const y = c.y + c.h - 34;
  const names = win.names || ['APT 1号', 'APT 2号'];
  names.forEach((n, i) => {
    const x = c.x + 10 + i * 150;
    ctx.beginPath(); ctx.arc(x + 6, y + 14, 4, 0, 7); ctx.fillStyle = '#4cd964'; ctx.fill();
    text(n, x + 15, y + 18.5, font(13, 'ui', 'bold'), '#ffe1ef');
    // little voice meter dancing with the track
    const lv = clamp(rmsAt(t - i * 0.07) * (0.8 + 0.4 * beatPulse(t, 6)), 0, 1);
    for (let k = 0; k < 8; k++) { ctx.fillStyle = k < Math.round(lv * 8) ? (k > 5 ? '#ffd23f' : '#4cd964') : '#4a1a32'; ctx.fillRect(x + 78 + k * 6, y + 8, 4, 12); }
  });
  const note = (win.notes || []).filter(m => t >= m.t && t < m.t1).pop();
  if (note) text(note.s, c.x + c.w / 2 + 70, y + 19.5, font(14, 'cjk', 'bold'), '#ffb3d8', 'center');
  button('挂断(H)', c.x + c.w - 92, y + 3, 82, 24, { size: 12 });
  const el = win.timerFrom !== undefined ? Math.max(0, t - win.timerFrom) : null;
  const tm = el === null ? '' : `00:${String(Math.floor(el)).padStart(2, '0')}`;
  text(tm, c.x + c.w - 104, y + 19.5, font(12, 'ui'), '#ff9fcd', 'right');
};

CONTENT.taskmgr = (win, c, t) => {
  ctx.fillStyle = C.face; ctx.fillRect(c.x, c.y, c.w, c.h);
  // menu + tabs
  ['文件(F)', '选项(O)', '查看(V)', '帮助(H)'].reduce((x, m) => { text(m, x, c.y + 14, font(12, 'ui'), C.ink); return x + measure(m, font(12, 'ui')) + 12; }, c.x + 8);
  const tabs = ['应用程序', '进程', '性能', '联网'];
  let tx = c.x + 8;
  tabs.forEach((tb, i) => {
    const w = measure(tb, font(12, 'ui')) + 16, sel = i === 1;
    rr(tx, c.y + (sel ? 20 : 22), w, sel ? 21 : 19, [3, 3, 0, 0]);
    ctx.fillStyle = sel ? '#fff' : '#f6dbe7'; ctx.fill(); ctx.strokeStyle = '#b07b95'; ctx.stroke();
    if (sel) { ctx.fillStyle = '#ff9a3c'; ctx.fillRect(tx + 1, c.y + 20, w - 2, 2); }
    text(tb, tx + 8, c.y + 36, font(12, 'ui'), C.ink); tx += w + 1;
  });
  const lx = c.x + 8, ly = c.y + 42, lw = c.w - 16, graphH = 64, lh = c.h - 42 - graphH - 30;
  ctx.fillStyle = '#fff'; ctx.fillRect(lx, ly, lw, lh); ctx.strokeStyle = '#a07890'; ctx.strokeRect(lx + 0.5, ly + 0.5, lw - 1, lh - 1);
  const cols = [['映像名称', 0], ['用户名', 0.42], ['CPU', 0.66], ['内存使用', 0.78]];
  ctx.fillStyle = grad(0, ly, 0, ly + 18, [[0, '#fff'], [1, '#f1dbe6']]); ctx.fillRect(lx + 1, ly + 1, lw - 2, 17);
  cols.forEach(([n, f]) => text(n, lx + 6 + f * lw, ly + 13.5, font(11.5, 'ui'), C.ink));
  const level = tt => {
    if (win.cpuFull && tt >= win.cpuFull) return 1;
    const r = win.cpuRamp ? clamp((tt - win.cpuRamp[0]) / (win.cpuRamp[1] - win.cpuRamp[0]), 0, 1) : 0.5;
    return clamp(0.06 + 0.88 * r + (rmsAt(tt) - 0.5) * 0.12, 0.03, 0.99);
  };
  const rows = (win.procs || []).filter(p => t >= p.t && (p.until === undefined || t < p.until));
  const maxRows = Math.floor((lh - 22) / 16);
  const vis = rows.slice(-maxRows);
  vis.forEach((p, i) => {
    const yy = ly + 20 + i * 16;
    const fresh = t - p.t < (p.hl || 0.12) || (p.selFrom !== undefined && t >= p.selFrom && t < (p.selTo ?? 1e9));
    const killing = p.killFrom !== undefined && t >= p.killFrom;
    if (fresh || killing) { ctx.fillStyle = killing ? '#e0303a' : C.select; ctx.fillRect(lx + 1, yy, lw - 2, 16); }
    const col = fresh || killing ? '#fff' : C.ink;
    text(p.name, lx + 6, yy + 12, font(11.5, 'ui'), col);
    text(p.user || 'APT', lx + 6 + 0.42 * lw, yy + 12, font(11.5, 'ui'), col);
    const pc = p.cpu === 'ramp' ? Math.round(level(t) * 99) : (p.cpu ?? 99);
    text(String(pc).padStart(2, '0'), lx + 6 + 0.66 * lw, yy + 12, font(11.5, 'ui'), col);
    text(p.mem || '149 K', lx + 6 + 0.78 * lw, yy + 12, font(11.5, 'ui'), col);
  });
  // CPU graph that jumps with loudness
  const gy = ly + lh + 6, gx = lx + 70, gw = lw - 70;
  ctx.fillStyle = '#000'; ctx.fillRect(gx, gy, gw, graphH);
  ctx.strokeStyle = '#0b5d0b'; ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(gx, gy + i * graphH / 6); ctx.lineTo(gx + gw, gy + i * graphH / 6); ctx.stroke(); }
  const scroll = (t * 12) % 12;
  for (let x = gx + gw - scroll; x > gx; x -= 12) { ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + graphH); ctx.stroke(); }
  ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 1.4; ctx.beginPath();
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const tt = t - (N - i) / FPS * 1.5;
    const v = tt < win.t0 ? 0.04 : level(tt);
    const x = gx + (i / N) * gw, y = gy + graphH - v * (graphH - 4) - 2;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  const cpu = Math.round(level(t) * 100);
  rr(lx, gy, 62, graphH, 2); ctx.fillStyle = '#000'; ctx.fill();
  const bars = Math.round(cpu / 100 * 14);
  for (let i = 0; i < 14; i++) { ctx.fillStyle = i < bars ? '#39ff14' : '#0b3d0b'; ctx.fillRect(lx + 16, gy + graphH - 16 - i * 3.3, 30, 2.3); }
  text(`${cpu}%`, lx + 31, gy + graphH - 4, font(10, 'ui'), '#39ff14', 'center');
  const msg = (win.status || []).filter(m => t >= m.t && t < m.t1).pop();
  if (msg) text(msg.s, c.x + 8, c.y + c.h - 7, font(13, 'ui', 'bold'), '#c8166a');
  else text(`进程数: ${rows.length}    CPU 使用: ${cpu}%`, c.x + 8, c.y + c.h - 6, font(11.5, 'ui'), C.ink);
  const pressed = (win.press || []).some(p => t >= p.t - 0.03 && t < p.t + 0.12);
  button('结束进程(E)', c.x + c.w - 98, c.y + c.h - 23, 90, 21, { pressed, size: 12 });
};

function srcTime(win, t) {
  if (win.srcKeys) { const k = track(win.srcKeys, t); return k.ts; }
  return t + (win.srcOffset || 0);
}

// ------------------------------------------------------------------ windows
const OPEN_DUR = 4 / FPS, CLOSE_DUR = 3 / FPS;
function windowState(win, t) {
  let st = { x: win.x, y: win.y, w: win.w, h: win.h };
  if (win.moves) { const k = track(win.moves, t); if (k) st = { ...st, x: k.x ?? st.x, y: k.y ?? st.y, w: k.w ?? st.w, h: k.h ?? st.h }; }
  // shake on listed beats: quick decaying jolt
  if (win.shake) {
    for (const ts of win.shake) {
      const d = t - ts;
      if (d >= 0 && d < 0.25) { const a = 7 * Math.exp(-d * 18); st.x += Math.sin(d * 95) * a; st.y += Math.cos(d * 80) * a * 0.6; }
    }
  }
  // XP-style: opaque zoom-in over <= 4 frames, closing is a hard cut, minimizing shrinks toward the taskbar
  let s = (win.scale || 1), alpha = 1, dx = 0, dy = 0;
  if (!win.noAnim && t - win.t0 < OPEN_DUR) s *= lerp(0.88, 1, EASE.out(clamp((t - win.t0) / OPEN_DUR, 0, 1)));
  for (const [a] of win.minimized || []) {
    const p = (t - a) / OPEN_DUR;
    if (p >= 0 && p < 1) { s *= lerp(1, 0.15, p); dx = lerp(0, 160 - (st.x + st.w / 2), p); dy = lerp(0, 525 - (st.y + st.h / 2), p); }
  }
  return { ...st, x: st.x + dx, y: st.y + dy, s, alpha };
}
function drawWindow(win, t, actv) {
  const st = windowState(win, t);
  ctx.save();
  ctx.globalAlpha = st.alpha;
  const cx = st.x + st.w / 2, cy = st.y + st.h / 2;
  ctx.translate(cx, cy); ctx.scale(st.s, st.s); ctx.translate(-cx, -cy);
  const w = { ...win, ...st };
  const c = windowChrome(w, actv);
  ctx.save(); ctx.beginPath(); ctx.rect(c.x, c.y, c.w, c.h); ctx.clip();
  (CONTENT[win.type] || (() => {}))(w, c, t);
  ctx.restore();
  for (const f of w._late || []) f();
  ctx.restore();
}
const zAt = (w, t) => { let z = w.z || 0; for (const k of w.zKeys || []) if (t >= k.t) z = k.z; return z; };
const isMin = (w, t) => (w.minimized || []).some(([a, b]) => t >= a + OPEN_DUR && t < b);
function windowsAt(t) { return SCRIPT.windows.filter(w => active(w, t)).sort((a, b) => zAt(a, t) - zAt(b, t) || a.t0 - b.t0); }

// ------------------------------------------------------------------ desktop, icons, taskbar, tray, balloons
const DEFAULT_ICONS = [
  { id: 'pc', label: '我的电脑', icon: 'pc', x: 878, y: 12 },
  { id: 'bin', label: '回收站', icon: 'bin', x: 878, y: 82 },
  { id: 'drum', label: '鼓.exe', icon: 'drum', x: 878, y: 152 },
  { id: 'mp3', label: 'APT.mp3', icon: 'mp3', x: 878, y: 222 },
];
function drawDesktopIcon(ic, t, selected) {
  const cx = ic.x + 34;
  let s = 1;
  if (ic.t0 !== undefined && t - ic.t0 < 0.2) s = ic.morph ? 1 + 0.3 * Math.sin(clamp((t - ic.t0) / 0.2, 0, 1) * Math.PI) : EASE.back(clamp((t - ic.t0) / 0.2, 0, 1));
  if (ic.bounce) s *= 1 + 0.12 * beatPulse(t, 7);
  ctx.save(); ctx.translate(cx, ic.y + 16); ctx.scale(s, s); ctx.translate(-cx, -(ic.y + 16));
  if (selected) { rr(cx - 19, ic.y - 3, 38, 38, 3); ctx.fillStyle = 'rgba(216,27,114,0.45)'; ctx.fill(); }
  icon(ic.icon, cx - 16, ic.y, 32);
  ctx.restore();
  const fnt = font(12, 'ui');
  const tw = measure(ic.label, fnt);
  if (selected) { ctx.fillStyle = C.select; ctx.fillRect(cx - tw / 2 - 2, ic.y + 35, tw + 4, 15); ctx.setLineDash([1, 1]); ctx.strokeStyle = '#ffe36b'; ctx.strokeRect(cx - tw / 2 - 2.5, ic.y + 34.5, tw + 5, 16); ctx.setLineDash([]); }
  if (selected) text(ic.label, cx, ic.y + 47, fnt, '#fff', 'center');
  else { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 1.6 * S; ctx.shadowOffsetX = 1 * S; ctx.shadowOffsetY = 1 * S;
    text(ic.label, cx, ic.y + 47, fnt, '#fff', 'center'); ctx.restore(); }
}
function iconsAt(t) {
  const list = [...DEFAULT_ICONS, ...SCRIPT.icons.filter(i => (i.t0 === undefined || t >= i.t0) && (i.t1 === undefined || t < i.t1))];
  // later definitions with the same id replace earlier ones (e.g. an icon turning into apt.exe)
  const byId = new Map();
  for (const i of list) byId.set(i.id, i);
  return [...byId.values()].filter(i => !i.hidden);
}

function taskbar(t, opts = {}) {
  const y = LH - TASKBAR_H;
  ctx.fillStyle = grad(0, y, 0, LH, C.taskStops); ctx.fillRect(0, y, LW, TASKBAR_H);
  ctx.fillStyle = 'rgba(120,0,55,0.55)'; ctx.fillRect(0, y, LW, 1);
  // start button: black with pink outline
  const pressed = opts.startPressed;
  rr(0, y, 100, TASKBAR_H, [0, 13, 13, 0]);
  ctx.fillStyle = pressed ? grad(0, y, 0, LH, [[0, '#6a0c3c'], [0.25, '#b0125e'], [1, '#e8338a']]) : grad(0, y, 0, LH, [[0, '#5a5a5a'], [0.12, '#2c2c2c'], [0.6, '#151515'], [1, '#050505']]);
  ctx.fill();
  ctx.strokeStyle = '#ff4fa0'; ctx.lineWidth = 2; rr(1, y + 1, 98, TASKBAR_H - 2, [0, 12, 12, 0]); ctx.stroke();
  ctx.save(); ctx.translate(pressed ? 1 : 0, pressed ? 1 : 0);
  icon('bolt', 10, y + 5, 20);
  text('开始', 36, y + 21.5, font(17, 'cjk', 'bold', 'italic'), '#fff', 'left', 'rgba(255,79,160,0.85)');
  ctx.restore();
  // window buttons
  const wins = windowsAt(t).filter(w => w.taskbar !== false && w.type !== 'error');
  const shown = wins.filter(w => !isMin(w, t));
  const top = shown.length ? shown[shown.length - 1] : null;
  let bx = 108;
  const bw = Math.min(160, (LW - 108 - 124) / Math.max(1, wins.length) - 3);
  for (const w of [...wins].sort((a, b) => a.t0 - b.t0)) {  // XP keeps buttons in opening order
    const on = w === top;
    rr(bx, y + 3, bw, 24, 3);
    ctx.fillStyle = on ? grad(0, y + 3, 0, y + 27, [[0, '#b0125e'], [1, '#d43588']]) : grad(0, y + 3, 0, y + 27, [[0, '#ff9fcd'], [0.5, '#ff6fb5'], [1, '#f2559f']]);
    ctx.fill(); ctx.strokeStyle = on ? '#7a0c44' : 'rgba(255,220,238,0.9)'; ctx.lineWidth = 1; ctx.stroke();
    if (w.icon) icon(w.icon, bx + 5, y + 7, 16);
    const tf = font(11.5, 'ui', on ? 'bold' : '');
    text(ellipsize(w.taskTitle || w.title, tf, bw - 32), bx + 25, y + 19.5, tf, '#fff', 'left', 'rgba(90,0,40,0.5)');
    bx += bw + 3;
  }
  // XP groups many windows of one program into a single "N <name>" button
  const grouped = windowsAt(t).filter(w => w.group);
  if (grouped.length) {
    const gw = 150, name = grouped[0].group;
    rr(bx, y + 3, gw, 24, 3);
    ctx.fillStyle = grad(0, y + 3, 0, y + 27, [[0, '#b0125e'], [1, '#d43588']]); ctx.fill(); ctx.strokeStyle = '#7a0c44'; ctx.lineWidth = 1; ctx.stroke();
    icon('error', bx + 5, y + 7, 16);
    text(`${grouped.length} ${name}`, bx + 25, y + 19.5, font(12, 'ui', 'bold'), '#fff', 'left', 'rgba(90,0,40,0.5)');
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(bx + gw - 14, y + 13); ctx.lineTo(bx + gw - 6, y + 13); ctx.lineTo(bx + gw - 10, y + 18); ctx.fill();
    bx += gw + 3;
  }
  // stray things that ended up living in the taskbar (the runaway 拒绝 button)
  for (const e of (SCRIPT.taskExtras || []).filter(e => active(e, t))) button(e.label, e.x, y + 3, e.w || 78, 24, { size: 12 });
  // tray
  const trayW = 118, tx = LW - trayW;
  ctx.fillStyle = grad(0, y, 0, LH, C.trayStops); ctx.fillRect(tx, y + 1, trayW, TASKBAR_H - 1);
  ctx.fillStyle = '#b0125e'; ctx.fillRect(tx, y + 1, 1, TASKBAR_H - 1);
  ctx.fillStyle = 'rgba(255,230,242,0.8)'; ctx.fillRect(tx + 1, y + 1, 1, TASKBAR_H - 1);
  icon('hardware', tx + 8, y + 7, 16);
  icon('media', tx + 28, y + 7, 16);
  const clk = SCRIPT.clock.find(c => active(c, t));
  const blink = clk && clk.blink ? beatPulse(t, 5) : 0;
  const colon = !(clk && clk.blink) || Math.floor((t - BEATS.beats[0].t) / BEATS.period) % 2 === 0;
  ctx.save();
  if (blink > 0.05) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 8 * S * blink; }
  const inv = clk && clk.blink && blink > 0.8;
  if (inv) { rr(LW - 52, y + 6, 44, 18, 2); ctx.fillStyle = '#fff'; ctx.fill(); }
  text(colon ? '16:38' : '16 38', LW - 30, y + 19.5, font(12, 'ui', blink > 0.4 ? 'bold' : ''), inv ? '#c8166a' : '#fff', 'center', inv ? null : 'rgba(90,0,40,0.5)');
  ctx.restore();
  return { trayIcon: { x: tx + 16, y: y + 8 } };
}

function balloon(b, t) {
  const p = clamp((t - b.t0) / 0.12, 0, 1), q = clamp((b.t1 - t) / 0.1, 0, 1);
  const a = Math.min(p, q);
  const ax = b.ax ?? LW - 102, ay = LH - TASKBAR_H + 4;
  const titleF = font(13, 'cjk', 'bold'), bodyF = font(b.textSize || 14, 'cjk', b.bold ? 'bold' : '');
  const hasImg = !!b.matte;
  const imgW = hasImg ? 64 : 0;
  const tw = Math.max(measure(b.title || '', titleF) + 30, measure(b.text || '', bodyF)) + 34 + imgW;
  const bw = Math.max(200, tw), bh = hasImg ? 84 : (b.title ? 62 : 44);
  const x = clamp(ax - bw + 34, 6, LW - bw - 6), y = ay - 14 - bh;
  ctx.save(); ctx.globalAlpha = a;
  ctx.translate(0, (1 - p) * 6);
  if (b.scale) { ctx.translate(ax, ay); ctx.scale(b.scale, b.scale); ctx.translate(-ax, -ay); }
  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, 7);
  ctx.moveTo(ax - 20, y + bh); ctx.lineTo(ax - 2, ay - 2); ctx.lineTo(ax - 6, y + bh);
  ctx.fillStyle = '#ffffe1'; ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 6 * S; ctx.shadowOffsetY = 2 * S; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
  // cover the seam between bubble and tail
  ctx.fillStyle = '#ffffe1'; ctx.fillRect(ax - 19.5, y + bh - 1.5, 13, 2.5);
  let tx = x + 12;
  if (hasImg) {
    const fr = b.matte.frame ?? clamp(Math.round(t * FPS), b.matte.first || 0, b.matte.last || 99999);
    const url = matteUrl(b.matte.clip, fr), im = img(url);
    if (im) {
      const [bx, by, bw, bh] = alphaBBox(url, im);
      const s = Math.min(60 / bw, 64 / bh), iw = bw * s, ih = bh * s;
      ctx.drawImage(im, bx, by, bw, bh, x + 8 + 30 - iw / 2, y + 42 - ih / 2, iw, ih);
    }
    tx = x + 76;
  } else if (b.icon) { icon(b.icon, tx, y + 10, 18); }
  if (b.title) text(b.title, tx + (hasImg || !b.icon ? 0 : 24), y + 24, titleF, '#000');
  text(b.text || '', tx, y + (b.title ? 48 : 28) + (hasImg ? 8 : 0), bodyF, '#000');
  // close box
  rr(x + bw - 22, y + 8, 14, 14, 2); ctx.strokeStyle = '#9a9a9a'; ctx.stroke();
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x + bw - 18.5, y + 11.5); ctx.lineTo(x + bw - 11.5, y + 18.5); ctx.moveTo(x + bw - 11.5, y + 11.5); ctx.lineTo(x + bw - 18.5, y + 18.5); ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------ cut-out layers (mattes)
const BBOX = new Map();
function alphaBBox(url, im) {
  if (BBOX.has(url)) return BBOX.get(url);
  const k = 4, cw = Math.ceil(im.width / k), ch = Math.ceil(im.height / k);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, cw, ch);
  const d = g.getImageData(0, 0, cw, ch).data;
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++)
    if (d[(y * cw + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  let bb = [0, 0, im.width, im.height];
  if (x1 >= 0) {
    const L = Math.max(0, (x0 - 1) * k), T = Math.max(0, (y0 - 1) * k);
    bb = [L, T, Math.min(im.width, (x1 + 2) * k) - L, Math.min(im.height, (y1 + 2) * k) - T];
  }
  BBOX.set(url, bb);
  return bb;
}
// cut-out with a solid white die-cut border of constant on-screen width (logical px), cached per size
const STICKERS = new Map();
function sticker(url, im, h, stroke) {
  const key = `${url}|${Math.round(h)}|${stroke}`;
  if (STICKERS.has(key)) return STICKERS.get(key);
  const [bx, by, bw, bh] = alphaBBox(url, im);
  const s = (h * S) / bh, W0 = Math.ceil(bw * s), H0 = Math.ceil(bh * s), r = stroke * S, pad = Math.ceil(r + 2);
  const mk = () => { const c = document.createElement('canvas'); c.width = W0 + 2 * pad; c.height = H0 + 2 * pad; return c; };
  const base = mk(), bg = base.getContext('2d'); bg.drawImage(im, bx, by, bw, bh, pad, pad, W0, H0);
  const sil = mk(), sg = sil.getContext('2d'); sg.drawImage(base, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#fff'; sg.fillRect(0, 0, sil.width, sil.height);
  const out = mk(), og = out.getContext('2d');
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; og.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r); }
  og.drawImage(sil, 0, 0);
  og.drawImage(base, 0, 0);
  const res = { c: out, w: out.width / S, h: out.height / S };
  if (STICKERS.size > 200) STICKERS.clear();
  STICKERS.set(key, res);
  return res;
}
function drawMatte(m, t) {
  // freeze: a sticker keeps the frame from the moment it was slapped on
  const ft = m.freeze ? m.t0 : t;
  let fr = m.frame ?? clamp(Math.round((ft + (m.srcOffset || 0)) * FPS), m.first ?? 0, m.last ?? 99999);
  while (m.skip && m.skip.includes(fr)) fr += 1;  // frames whose matte is unusable borrow their neighbour
  const url = matteUrl(m.clip, fr);
  const im = img(url);
  if (!im) return;
  let pos = { x: m.x, y: m.y, h: m.h };
  if (m.keys) { const k = track(m.keys, t); pos = { x: k.x ?? m.x, y: k.y ?? m.y, h: k.h ?? m.h }; }
  if (m.bbox) {
    // x,y = centre of the subject, h = subject height
    const [bx, by, bw, bh] = alphaBBox(url, im);
    const s2 = pos.h / bh, w2 = bw * s2, h2 = bh * s2;
    let sc = 1;
    if (m.pop !== false && t - m.t0 < 0.18) sc *= EASE.back(clamp((t - m.t0) / 0.18, 0, 1));
    if (m.bounce) sc *= 1 + m.bounce * beatPulse(t, 7);
    if (m.pulseAt !== undefined && t >= m.pulseAt) sc *= 1 + (m.pulseAmp ?? 0.07) * Math.exp(-(t - m.pulseAt) * 9);
    const lifted = m.lift && t >= m.lift[0] && t < m.lift[1];
    if (lifted) sc *= 1.08;
    ctx.save();
    ctx.translate(pos.x, pos.y); ctx.scale(sc, sc); if (m.rot) ctx.rotate(m.rot * Math.PI / 180);
    if (m.shadow) { ctx.shadowColor = 'rgba(40,0,20,0.35)'; ctx.shadowBlur = 3 * S; ctx.shadowOffsetX = 2 * S; ctx.shadowOffsetY = 2 * S; }
    if (lifted) { ctx.shadowColor = 'rgba(40,0,20,0.5)'; ctx.shadowBlur = 12 * S; ctx.shadowOffsetX = 8 * S; ctx.shadowOffsetY = 10 * S; }
    if (m.stroke) {
      const st = sticker(url, im, pos.h, m.stroke);
      ctx.drawImage(st.c, -st.w / 2, -st.h / 2, st.w, st.h);
    } else ctx.drawImage(im, bx, by, bw, bh, -w2 / 2, -h2 / 2, w2, h2);
    ctx.restore();
    return;
  }
  const s = pos.h / im.height;
  let w = im.width * s, h = im.height * s;
  if (m.groundY !== undefined) {
    // keep the lowest opaque pixel (knees / soles) exactly on the given line, every frame
    const [, bby, , bbh] = alphaBBox(url, im);
    pos.y = m.groundY - (bby + bbh) * s + (m.sink || 0);
  }
  let sc = 1;
  if (m.pop !== false && t - m.t0 < 0.18) sc *= EASE.back(clamp((t - m.t0) / 0.18, 0, 1));
  if (m.bounce) sc *= 1 + m.bounce * beatPulse(t, 7);
  const ax = pos.x + w * (m.ax ?? 0.5), ay = pos.y + h * (m.ay ?? 1);
  ctx.save();
  if (m.alpha !== undefined) ctx.globalAlpha = m.alpha;
  ctx.translate(ax, ay); ctx.scale(sc, sc); if (m.rot) ctx.rotate(m.rot * Math.PI / 180); ctx.translate(-ax, -ay);
  if (m.shadow) { ctx.shadowColor = 'rgba(70,0,35,0.45)'; ctx.shadowBlur = 8 * S; ctx.shadowOffsetX = 3 * S; ctx.shadowOffsetY = 4 * S; }
  if (m.clipRect) { ctx.beginPath(); ctx.rect(...m.clipRect); ctx.clip(); }
  if (m.parts) {
    // vertical strips of the source frame drawn with their own offsets (e.g. drop the drum onto the taskbar)
    for (const p of m.parts) {
      const pb = p.bounce ? 1 + p.bounce * beatPulse(t, 7) : 1;
      const pw = (p.x1 - p.x0) * s, ph = h;
      const px = pos.x + p.x0 * s + (p.dx || 0), py = pos.y + (p.dy || 0);
      ctx.save(); ctx.translate(px + pw / 2, py + ph); ctx.scale(pb, pb); ctx.translate(-(px + pw / 2), -(py + ph));
      ctx.drawImage(im, p.x0, 0, p.x1 - p.x0, im.height, px, py, pw, ph);
      ctx.restore();
    }
  } else ctx.drawImage(im, pos.x, pos.y, w, h);
  ctx.restore();
}

// ------------------------------------------------------------------ full screens
function drawBoot(b, t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, LW, LH);
  const cx = LW / 2;
  // neon APT., flaring on every beat
  const pulse = beatPulse(t, 5);
  ctx.save();
  ctx.shadowColor = '#ff4fa0'; ctx.shadowBlur = (20 + 34 * pulse) * S;
  if (pulse > 0.3) { text(b.title || 'APT.', cx, 236, font(84, 'title', 'bold', 'italic'), '#ff4fa0', 'center'); }
  text(b.title || 'APT.', cx, 236, font(84, 'title', 'bold', 'italic'), '#ff4fa0', 'center');
  ctx.shadowBlur = 6 * S;
  text(b.title || 'APT.', cx, 236, font(84, 'title', 'bold', 'italic'), pulse > 0.5 ? '#ffb3d8' : '#ff7fbe', 'center');
  ctx.restore();
  const pw = measure('Pinkdows', font(34, 'boot')), xw = measure('XP', font(20, 'title', 'bold', 'italic'));
  const lx = cx - (pw + 6 + xw) / 2;
  text('Macrosoft', lx + 2, 268, font(11, 'ui', 'bold'), '#d9d9d9', 'left');
  text('Pinkdows', lx, 300, font(34, 'boot'), '#fff', 'left');
  text('XP', lx + pw + 6, 288, font(20, 'title', 'bold', 'italic'), '#ff8a3d', 'left');
  // progress blocks: one lap every two beats, restarting on the beat
  const bw = 118, bx = cx - bw / 2, by = 352;
  rr(bx, by, bw, 16, 4); ctx.strokeStyle = '#b5b5b5'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.save(); rr(bx + 2, by + 2, bw - 4, 12, 2.5); ctx.clip();
  const lap = 2 * BEATS.period, track_ = bw - 4;
  const ph = (((t - BEATS.beats[0].t) / lap) % 1 + 1) % 1;
  for (let i = 0; i < 3; i++) {
    const p0 = (ph * track_ + i * 10) % track_;
    for (const xx of [p0, p0 - track_]) {
      rr(bx + 2 + xx, by + 3, 8, 10, 1.5);
      ctx.fillStyle = grad(0, by + 3, 0, by + 13, [[0, '#ffc2df'], [0.45, '#ff4fa0'], [1, '#b0125e']]); ctx.fill();
    }
  }
  ctx.restore();
  text('Copyright © Macrosoft Corporation', 22, LH - 22, font(10, 'ui'), '#9a9a9a');
  text('Macrosoft', LW - 22, LH - 20, font(15, 'title', 'bold', 'italic'), '#fff', 'right');
}

function drawWelcome(b, t) {
  ctx.fillStyle = '#5a0a33'; ctx.fillRect(0, 0, LW, LH);
  const top = 64, bot = LH - 64;
  const mid = ctx.createRadialGradient(170, 130, 20, 300, 260, 620);
  mid.addColorStop(0, '#ff8cc4'); mid.addColorStop(0.45, '#ec4f9c'); mid.addColorStop(1, '#b8135f');
  ctx.fillStyle = mid; ctx.fillRect(0, top, LW, bot - top);
  ctx.fillStyle = grad(0, 0, LW, 0, [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(0, top - 1.5, LW, 1.5);
  ctx.fillStyle = grad(0, 0, LW, 0, [[0, 'rgba(255,160,60,0)'], [0.4, 'rgba(255,170,70,0.95)'], [1, 'rgba(255,160,60,0)']]); ctx.fillRect(0, bot, LW, 2);
  ctx.fillStyle = grad(0, top, 0, bot, [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(470, top + 40, 1.2, bot - top - 80);
  // left: just the greeting (the logo was already on the boot screen)
  text('欢迎', 440, 286, font(46, 'cjk', 'bold'), '#fff', 'right', 'rgba(90,0,40,0.8)');
  text('要开始，请单击您的用户名', 440, 318, font(14, 'ui'), '#ffe1ef', 'right');
  const US = b.userScale || 1.25;
  ctx.save(); ctx.translate(500, 196); ctx.scale(US, US); ctx.translate(-500, -196);
  (b.users || []).forEach((u, i) => {
    const ux = 500, uy = 196 + i * 96;
    const sel = u.selectAt !== undefined && t >= u.selectAt;
    const hov = (u.hover || []).some(([a, z]) => t >= a && t < z) || sel;
    if (hov) { rr(ux - 8, uy - 8, 300, 80, [10, 0, 0, 10]); ctx.fillStyle = grad(ux, 0, ux + 300, 0, [[0, 'rgba(120,0,55,0.6)'], [1, 'rgba(120,0,55,0)']]); ctx.fill(); }
    // press: tile squeezes to 0.94 for two frames
    const pr = u.selectAt !== undefined && t >= u.selectAt - 1 / FPS && t < u.selectAt + 2 / FPS ? 0.94 : 1;
    ctx.save(); ctx.translate(ux + 32, uy + 32); ctx.scale(pr, pr); ctx.translate(-(ux + 32), -(uy + 32));
    rr(ux, uy, 64, 64, 6); ctx.fillStyle = '#fff0f6'; ctx.fill(); ctx.strokeStyle = sel ? '#ffcc33' : '#fff'; ctx.lineWidth = sel ? 3 : 2; ctx.stroke();
    ctx.save(); rr(ux + 2, uy + 2, 60, 60, 5); ctx.clip();
    const url = matteUrl(u.clip, u.frame), im = img(url);
    if (im) { const st = sticker(url, im, 50, 2); ctx.drawImage(st.c, ux + 32 - st.w / 2, uy + 32 - st.h / 2 + 1, st.w, st.h); }
    ctx.restore(); ctx.restore();
    text(u.name, ux + 80, uy + 30, font(19, 'cjk', 'bold'), '#fff', 'left', 'rgba(90,0,40,0.6)');
    if (sel) {
      const dots = Math.min(3, Math.floor((t - u.selectAt) / (BEATS.period / 2)) + 1);
      text((u.loading || '正在加载蹦迪设置') + '.'.repeat(dots), ux + 80, uy + 54, font(14, 'cjk', 'bold'), '#fff');
    }
  });
  ctx.restore();
  icon('power', 26, LH - 46, 26);
  text('关闭计算机', 60, LH - 27, font(13, 'ui'), '#fff');
  { const a1 = '添加帐户请使用 ', f1 = font(15, 'cjk', 'bold'), f2 = font(16, 'mono', 'bold');
    const w2 = measure('apt', f2), x2 = LW - 26 - w2;
    rr(x2 - 4, LH - 44, w2 + 8, 24, 3); ctx.fillStyle = '#ff4fa0'; ctx.fill();
    text('apt', x2, LH - 26, f2, '#fff');
    text(a1, x2 - 6, LH - 26, f1, '#fff', 'right'); }
}

function drawShutdown(b, t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, LW, LH);
  const ub = b.ubuntu !== undefined && t >= b.ubuntu;
  ctx.save(); if (ub) ctx.globalAlpha = 0.6;
  text('现在可以安全地关闭计算机了', LW / 2, LH / 2 - 4, font(36, 'cjk', 'bold'), '#ff8c1a', 'center');
  ctx.restore();
  if (ub) {
    const s = '正在安装 Ubuntu', fnt = font(26, 'mono', 'bold');
    const w = measure(s + '…_', fnt);
    const on = Math.floor((t - b.ubuntu) / (BEATS.period / 2)) % 2 === 0;
    text(s + '…' + (on ? '_' : ''), LW / 2 - w / 2, LH / 2 + 52, fnt, '#ffffff', 'left');
  }
}

function drawLogoff(b, t) {
  // XP log-off screen: dark bands top and bottom, the live (dimmed) video in the middle band
  const top = 64, bot = LH - 64;
  ctx.fillStyle = '#5a0a33'; ctx.fillRect(0, 0, LW, LH);
  ctx.save(); ctx.beginPath(); ctx.rect(0, top, LW, bot - top); ctx.clip();
  if (b.video) drawSource(baseSrcTime(b, t), 0, 0, LW, LH, 'cover', '#000');
  ctx.fillStyle = `rgba(150,20,80,${b.dim ?? 0.45})`; ctx.fillRect(0, top, LW, bot - top);
  ctx.restore();
  ctx.fillStyle = grad(0, 0, LW, 0, [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,190,225,0.95)'], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(0, top - 2, LW, 2);
  ctx.fillStyle = grad(0, 0, LW, 0, [[0, 'rgba(255,160,60,0)'], [0.4, 'rgba(255,170,70,0.95)'], [1, 'rgba(255,160,60,0)']]); ctx.fillRect(0, bot, LW, 2);
  const msg = b.msgKeys ? (b.msgKeys.filter(m => t >= m.t).pop() || {}).s : (b.msg || '正在注销...');
  if (msg) {
    const fm = font(b.size || 34, 'cjk', 'bold'), fl = font(30, 'title', 'bold', 'italic');
    const wm = measure(msg, fm), wl = measure('APT.', fl), gap = 22;
    const x0 = LW / 2 - (wl + 2 * gap + wm) / 2;
    ctx.save(); ctx.shadowColor = '#ff2d8f'; ctx.shadowBlur = 8 * S;
    text('APT.', x0, LH / 2 + 12, fl, '#fff', 'left'); ctx.restore();
    ctx.fillStyle = grad(0, LH / 2 - 30, 0, LH / 2 + 30, [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]);
    ctx.fillRect(x0 + wl + gap, LH / 2 - 30, 1.2, 60);
    ctx.save(); ctx.shadowColor = 'rgba(60,0,30,0.8)'; ctx.shadowBlur = 6 * S;
    text(msg, x0 + wl + 2 * gap, LH / 2 + 12, fm, '#fff', 'left'); ctx.restore();
  }
  text('Pinkdows XP', 24, LH - 26, font(14, 'boot'), '#ffd1e6', 'left');
}

// source time for full-screen video bases; srcKeys lets a screensaver stretch its own shot instead of leaking the next one
function baseSrcTime(b, t) {
  if (b.srcKeys) return track(b.srcKeys, t).ts;
  return t + (b.srcOffset || 0);
}

// ------------------------------------------------------------------ frame
function drawFrame(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.filter = 'none';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(S, 0, 0, S, 0, 0);
  const base = SCRIPT.base.find(b => active(b, t)) || { type: 'desktop' };

  if (base.type === 'boot') drawBoot(base, t);
  else if (base.type === 'welcome') drawWelcome(base, t);
  else if (base.type === 'shutdown') drawShutdown(base, t);
  else if (base.type === 'logoff') drawLogoff(base, t);
  else if (base.type === 'video' || base.type === 'screensaver') drawSource(baseSrcTime(base, t), 0, 0, LW, LH, 'cover', '#000');
  if (base.type !== 'desktop' && base.showWindows) {
    const wins = windowsAt(t).filter(w => !isMin(w, t));
    wins.forEach((w, i) => drawWindow(w, t, i === wins.length - 1));
  }
  if (base.type === 'desktop') {
    // desktop
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(wallpaper(), 0, 0); ctx.restore();
    const sel = new Set(SCRIPT.icons.filter(i => i.selectedFrom !== undefined && t >= i.selectedFrom && t < (i.selectedTo ?? 1e9)).map(i => i.id));
    for (const ic of iconsAt(t)) drawDesktopIcon(ic, t, sel.has(ic.id));
    const mattes = SCRIPT.mattes.filter(m => active(m, t));
    const stickers = SCRIPT.stickers.filter(m => active(m, t));
    for (const g of (SCRIPT.ground || []).filter(g => active(g, t))) {
      // soft contact shadow under cut-outs standing/sitting on the taskbar
      const gr2 = ctx.createRadialGradient(g.x, g.y, 1, g.x, g.y, g.w / 2);
      gr2.addColorStop(0, `rgba(60,0,30,${g.a ?? 0.35})`); gr2.addColorStop(1, 'rgba(60,0,30,0)');
      ctx.save(); ctx.translate(g.x, g.y); ctx.scale(1, g.h / g.w); ctx.translate(-g.x, -g.y);
      ctx.fillStyle = gr2; ctx.beginPath(); ctx.arc(g.x, g.y, g.w / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    for (const m of [...stickers, ...mattes].filter(m => (m.layer || 'back') === 'back')) drawMatte(m, t);
    const wins = windowsAt(t).filter(w => !isMin(w, t));
    wins.forEach((w, i) => drawWindow(w, t, i === wins.length - 1 && !w.inactive));
    for (const m of [...stickers, ...mattes].filter(m => m.layer === 'front')) drawMatte(m, t);
    const sm = SCRIPT.startmenu.find(s => active(s, t));
    taskbar(t, { startPressed: !!sm || (base.startPressed !== undefined && t >= base.startPressed) });
    for (const m of [...stickers, ...mattes].filter(m => m.layer === 'top')) drawMatte(m, t);
    if (sm) drawStartMenu(sm, t);
    for (const b of SCRIPT.balloons.filter(b => active(b, t))) balloon(b, t);
  }
  for (const o of SCRIPT.overlays.filter(o => active(o, t))) (OVERLAY[o.type] || (() => {}))(o, t);
  // cursor
  const hidden = SCRIPT.cursor.hide.some(([a, b]) => t >= a && t < b) || base.cursor === false ||
    ((base.type === 'boot' || base.type === 'shutdown') && base.cursor !== true);
  const k = track(SCRIPT.cursor.keys, t);
  if (k && !hidden) drawCursor(k.x, k.y);
}
// drumstick parody of an office helper, with a speech bubble
function drawAssistant(o, t) {
  const p = clamp((t - o.t0) / 0.15, 0, 1), q = clamp((o.t1 - t) / 0.1, 0, 1);
  const a = Math.min(p, q);
  const bob = Math.sin((t - o.t0) * 9) * 1.5 - 5 * beatPulse(t, 8);
  const x = o.x, y = o.y + bob;
  ctx.save(); ctx.globalAlpha = a;
  const k = o.scale || 1;
  ctx.translate(x, y); ctx.scale(k, k); ctx.translate(-x, -y);
  if (o.say && t >= (o.sayAt ?? o.t0)) {
    const fnt = font(15, 'ui');
    const lines = Array.isArray(o.say) ? o.say : [o.say];
    const bw = Math.max(...lines.map(l => measure(l, fnt))) + 28, bh = 20 + lines.length * 21 + 34;
    const bx = x - bw + 34, by = y - bh - 30;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8);
    ctx.moveTo(x + 2, by + bh - 1); ctx.lineTo(x + 12, y - 12); ctx.lineTo(x + 18, by + bh - 1);
    ctx.fillStyle = '#ffffcc'; ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 6 * S; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#ffffcc'; ctx.fillRect(x + 2.5, by + bh - 2, 15, 3);
    lines.forEach((l, i) => text(l, bx + 14, by + 28 + i * 21, fnt, '#000'));
    const pressed = o.press !== undefined && t >= o.press - 0.03 && t < o.press + 0.1;
    const hover = o.hoverAt !== undefined && t >= o.hoverAt;
    button(o.button || '好的', bx + bw - 86, by + bh - 31, 72, 22, { size: 12, pressed, hover });
  }
  // the stick "drums" on every beat
  ctx.translate(x + 14, y + 40); ctx.rotate(-0.18 - 0.35 * beatPulse(t, 10));
  rr(-7, -42, 14, 92, 7);
  ctx.fillStyle = grad(-7, 0, 7, 0, [[0, '#a8743a'], [0.4, '#e9c08a'], [1, '#9a6530']]); ctx.fill();
  ctx.strokeStyle = '#5d3a14'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0, -46, 8, 9, 0, 0, Math.PI * 2); ctx.fillStyle = '#f2d3a6'; ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ff4fa0'; ctx.fillRect(-7, 26, 14, 6);
  for (const ex of [-5.5, 5.5]) {
    ctx.beginPath(); ctx.arc(ex, -18, 6, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.beginPath(); ctx.arc(ex - 1.5, -17 + Math.sin(t * 6) * 0.8, 2.6, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
  }
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-11, -27); ctx.lineTo(-3, -25); ctx.moveTo(11, -27); ctx.lineTo(3, -25); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -6, 4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.restore();
}

function drawStartMenu(sm, t) {
  const w = 380, h = 420, x = 0, y = LH - TASKBAR_H - h;
  const p = clamp((t - sm.t0) / (3 / FPS), 0, 1);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y - 10, w + 20, h + 10); ctx.clip();
  ctx.translate(0, h * (1 - EASE.out(p)));
  ctx.save();
  ctx.shadowColor = 'rgba(60,0,30,0.4)'; ctx.shadowBlur = 8 * S; ctx.shadowOffsetX = 3 * S;
  rr(x, y, w, h, [8, 8, 0, 0]); ctx.fillStyle = C.frame; ctx.fill();
  ctx.restore();
  rr(x + 1, y + 1, w - 2, 62, [7, 7, 0, 0]); ctx.fillStyle = grad(0, y, 0, y + 62, C.titleStops); ctx.fill();
  rr(x + 9, y + 8, 48, 48, 4); ctx.fillStyle = '#ffd1e6'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  if (sm.avatar) {
    const im = img(matteUrl(sm.avatar.clip, sm.avatar.frame));
    if (im) {
      ctx.save(); rr(x + 10, y + 9, 46, 46, 3); ctx.clip(); ctx.fillStyle = '#ff4fa0'; ctx.fillRect(x + 10, y + 9, 46, 46);
      const [bx, by, bw, bh] = alphaBBox(matteUrl(sm.avatar.clip, sm.avatar.frame), im);
      const s = 44 / bh; ctx.drawImage(im, bx, by, bw, bh, x + 33 - bw * s / 2, y + 10, bw * s, bh * s); ctx.restore();
    }
  }
  text(sm.user || 'APT 2号', x + 68, y + 40, font(17, 'cjk', 'bold'), '#fff', 'left', 'rgba(90,0,40,0.6)');
  ctx.fillStyle = grad(0, 0, w, 0, [[0, 'rgba(255,170,70,0)'], [0.5, 'rgba(255,170,70,1)'], [1, 'rgba(255,170,70,0)']]); ctx.fillRect(x + 1, y + 63, w - 2, 2);
  const top = y + 65, bot = y + h - 44;
  ctx.fillStyle = '#fff'; ctx.fillRect(x + 2, top, 200, bot - top);
  ctx.fillStyle = '#fde0ee'; ctx.fillRect(x + 202, top, w - 204, bot - top);
  ctx.fillStyle = '#f2b6d2'; ctx.fillRect(x + 202, top, 1, bot - top);
  (sm.left || []).forEach((it, i) => {
    const iy = top + 8 + i * 38;
    const hv = sm.hover === i;
    if (hv) { ctx.fillStyle = C.select; ctx.fillRect(x + 4, iy - 2, 196, 36); }
    icon(it.icon, x + 10, iy, 32);
    text(it.label, x + 50, iy + (it.sub ? 15 : 22), font(13, 'ui', 'bold'), hv ? '#fff' : C.ink);
    if (it.sub) text(it.sub, x + 50, iy + 30, font(11, 'ui'), hv ? '#ffe1ef' : '#8a6a7a');
  });
  ctx.fillStyle = '#f0c6da'; ctx.fillRect(x + 10, bot - 36, 184, 1);
  text('所有程序', x + 70, bot - 13, font(13, 'ui', 'bold'), C.ink);
  ctx.fillStyle = '#2bb24c'; ctx.beginPath(); ctx.arc(x + 150, bot - 18, 7, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x + 148, bot - 22); ctx.lineTo(x + 153, bot - 18); ctx.lineTo(x + 148, bot - 14); ctx.fill();
  const right = sm.right || ['我的文档', '我的音乐', '我的电脑', '控制面板', '帮助和支持', '搜索', '运行...'];
  right.forEach((it, i) => {
    const iy = top + 10 + i * 30;
    icon(['folder', 'mp3', 'pc', 'taskmgr', 'info', 'question', 'terminal'][i % 7], x + 210, iy, 22);
    text(it, x + 240, iy + 16, font(12.5, 'ui', i < 3 ? 'bold' : ''), C.ink);
  });
  ctx.fillStyle = grad(0, bot, 0, y + h, C.titleStops); ctx.fillRect(x + 1, bot, w - 2, y + h - bot);
  icon('logoff', x + w - 214, bot + 9, 24); text('注销', x + w - 184, bot + 26, font(12.5, 'ui'), '#fff');
  if (sm.hoverOff !== undefined && t >= sm.hoverOff) {
    const down = sm.pressOff !== undefined && t >= sm.pressOff;
    rr(x + w - 112, bot + 6, 104, 30, 3); ctx.fillStyle = down ? 'rgba(90,0,40,0.75)' : 'rgba(255,220,238,0.35)'; ctx.fill();
    ctx.strokeStyle = down ? '#3a0018' : '#ffd1e6'; ctx.lineWidth = 1; ctx.stroke();
  }
  icon('power', x + w - 106, bot + 9, 24); text('关闭计算机', x + w - 76, bot + 26, font(12.5, 'ui'), '#fff');
  ctx.restore();
}

const OVERLAY = {
  assistant: drawAssistant,
  flash: (o, t) => { ctx.fillStyle = `rgba(255,255,255,${(1 - (t - o.t0) / (o.t1 - o.t0)) * (o.a ?? 0.6)})`; ctx.fillRect(0, 0, LW, LH); },
  text: (o, t) => text(o.s, o.x, o.y, font(o.size || 13, o.fam || 'ui', o.weight || ''), o.color || '#fff', o.align || 'left'),
};

async function render(t) {
  for (let pass = 0; pass < 4; pass++) {
    NEED = new Set();
    drawFrame(t);
    const missing = [...NEED].filter(u => !cache.has(u) || !cache.get(u).img);
    const unloaded = missing.filter(u => !cache.has(u));
    if (!unloaded.length) break;
    await Promise.all(unloaded.map(load));
  }
  evict(NEED);
  return true;
}
async function preload(urls) { await Promise.all(urls.map(load)); }

async function init() {
  [BEATS, SHOTS, RMS] = await Promise.all([loadJSON('../analysis/beats.json'), loadJSON('../analysis/shots.json'), loadJSON('../analysis/rms.json')]);
  SRC_MAX = Math.floor(BEATS.duration * FPS) - 2;
  const files = (params.get('script') || '').split(',').filter(Boolean);
  const scripts = await Promise.all(files.map(f => loadJSON('../' + f)));
  SCRIPT = compile(mergeScripts(scripts));
  await document.fonts.ready;
  wallpaper();
  window.Pinkdows.ready = true;
}

window.Pinkdows = { ready: false, render, drawFrame, preload, W, H, get script() { return SCRIPT; }, resolveTime: v => resolveTime(v) };
init().catch(e => { console.error(e); window.Pinkdows.error = String(e); });
})();
