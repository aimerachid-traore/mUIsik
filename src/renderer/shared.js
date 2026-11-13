// Code partagé par les trois fenêtres.
export const api = window.muisik;

export const store = {
  state: null,
  pos: { position: 0, positionAt: Date.now(), isPlaying: false, duration: 0 },
};

/** Abonne la page à l'état global. `onState(state, prev)` est appelé à chaque changement. */
export async function connect(onState, onPos) {
  api.on('state', (s) => {
    const prev = store.state;
    store.state = s;
    applyColors(s.colors);
    onState?.(s, prev);
  });
  api.on('pos', (p) => { store.pos = p; onPos?.(p); });
  const s = await api.invoke('state:get');
  store.state = s;
  store.pos = { position: s.position, positionAt: s.positionAt, isPlaying: s.isPlaying, duration: s.duration };
  applyColors(s.colors);
  onState?.(s, null);
  return s;
}

/** Position actuelle du morceau, interpolée entre deux mises à jour. */
export function now() {
  const p = store.pos;
  const t = p.isPlaying ? p.position + (Date.now() - p.positionAt) / 1000 : p.position;
  return p.duration ? Math.min(t, p.duration) : t;
}

export function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export const proxied = (url) => (url ? `/proxy?url=${encodeURIComponent(url)}` : '');

export function applyColors(colors) {
  const c = colors?.length ? colors : ['#ff3ea5', '#8b5cf6', '#22d3ee'];
  const root = document.documentElement.style;
  root.setProperty('--c1', c[0]);
  root.setProperty('--c2', c[1] || c[0]);
  root.setProperty('--c3', c[2] || c[1] || c[0]);
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** Extrait 3 couleurs vives d'une pochette (pour la lumière et le fond). */
export async function extractColors(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = proxied(url);
  await img.decode();
  const size = 48;
  const cv = new OffscreenCanvas(size, size);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;

  const buckets = Array.from({ length: 18 }, () => ({ w: 0, h: 0, s: 0, v: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    if (v < 0.18 || s < 0.15) continue; // on ignore les gris, noirs et blancs
    const b = buckets[Math.floor(h / 20) % 18];
    const w = s * v * s;
    b.w += w; b.h += h * w; b.s += s * w; b.v += v * w;
  }
  const ranked = buckets.filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  const picked = [];
  for (const b of ranked) {
    const h = b.h / b.w;
    if (picked.every((p) => Math.min(Math.abs(p[0] - h), 360 - Math.abs(p[0] - h)) > 28)) picked.push([h, b.s / b.w, b.v / b.w]);
    if (picked.length === 3) break;
  }
  if (!picked.length) return null; // pochette en noir et blanc : couleurs par défaut
  while (picked.length < 3) {
    const [h, s, v] = picked[0];
    picked.push([(h + 25 * picked.length) % 360, s, Math.min(1, v * 0.85)]);
  }
  // Couleurs saturées et lumineuses : une lumière doit briller.
  return picked.map(([h, s, v]) => hsvToHex(h, Math.min(1, Math.max(0.55, s * 1.15)), Math.max(0.8, v)));
}

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
