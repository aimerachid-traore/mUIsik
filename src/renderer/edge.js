// Lumière autour de l'écran : couleurs de la pochette, mouvement au rythme du son de l'ordinateur.
//
// Performance : la lumière est dessinée dans 4 bandes fines (haut, bas, gauche, droite) au lieu d'une
// fenêtre plein écran. Cette page vit dans la bande du haut et ouvre les 3 autres (même processus).
// On calcule la scène une fois par image dans un repère "écran entier", puis on la rejoue dans chaque
// bande. Le canvas est en demi-résolution (le halo est flou de toute façon), limité à 30 images/s
// (60 en mode « Fluide »), et tout s'arrête quand la musique est en pause.
import { api, store, connect, hexToRgb } from './shared.js';

const SCALE = 0.5;
const SIDES = ['top', 'bottom', 'left', 'right'];

let L = null;            // disposition envoyée par le main : { W, H, depth, strips, visible }
const surfaces = {};     // side -> { canvas, ctx, rect }

function surfaceFor(side) {
  if (side === 'top') {
    const canvas = document.getElementById('c');
    return { canvas, ctx: canvas.getContext('2d') };
  }
  // window.open avec un nom fixe : rouvre la même fenêtre si elle existe déjà.
  const w = window.open('', `edge-${side}`);
  if (!w) return null;
  const doc = w.document;
  doc.documentElement.style.cssText = 'margin:0;height:100%;background:transparent;overflow:hidden';
  doc.body.style.cssText = 'margin:0;height:100%;background:transparent;overflow:hidden;pointer-events:none';
  let canvas = doc.querySelector('canvas');
  if (!canvas) {
    canvas = doc.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
    doc.body.append(canvas);
  }
  return { canvas, ctx: canvas.getContext('2d') };
}

function applyLayout(layout) {
  L = layout;
  for (const side of SIDES) {
    const r = L.strips[side];
    if (!L.visible[side] || r.width < 2 || r.height < 2) { if (surfaces[side]) surfaces[side].rect = null; continue; }
    if (!surfaces[side]) surfaces[side] = surfaceFor(side);
    const s = surfaces[side];
    if (!s) continue;
    s.rect = r;
    s.canvas.width = Math.max(1, Math.ceil(r.width * SCALE));
    s.canvas.height = Math.max(1, Math.ceil(r.height * SCALE));
  }
  wake();
}
api.on('edge:layout', applyLayout);

// ============================================================ audio (loopback)
let analyser = null;
let freq = null;
const audio = { level: 0, bass: 0, beat: 0, maxBass: 0.3, avgBass: 0, lastBeat: 0 };

async function startCapture() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } });
    stream.getVideoTracks().forEach((t) => t.stop());
    if (!stream.getAudioTracks().length) throw new Error('pas de piste audio');
    const ac = new AudioContext({ latencyHint: 'playback' });
    analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
    ac.createMediaStreamSource(stream).connect(analyser); // on écoute seulement, rien n'est rejoué
    freq = new Uint8Array(analyser.frequencyBinCount);
    // Sortie audio changée (casque, Sonar…) : on relance la capture.
    stream.getAudioTracks()[0].addEventListener('ended', () => { analyser = null; ac.close(); setTimeout(startCapture, 1500); });
  } catch (e) {
    console.warn('[edge] capture audio indisponible, animation simulée', e);
    setTimeout(startCapture, 15000);
  }
}
startCapture();

function analyse(t, dt) {
  const playing = store.pos.isPlaying;
  if (analyser) {
    analyser.getByteFrequencyData(freq);
    let b = 0, l = 0;
    for (let i = 1; i <= 6; i++) b += freq[i];
    for (let i = 1; i <= 160; i++) l += freq[i];
    b /= 6 * 255; l /= 160 * 255;
    // Normalisation adaptative : fonctionne quel que soit le volume.
    audio.maxBass = Math.max(0.12, Math.max(b, audio.maxBass - dt * 0.05));
    const nb = Math.min(1, b / audio.maxBass);
    audio.avgBass += (nb - audio.avgBass) * Math.min(1, dt * 3);
    if (nb > audio.avgBass * 1.3 && nb > 0.45 && t - audio.lastBeat > 0.26) { audio.lastBeat = t; audio.beat = 1; }
    audio.bass += (nb - audio.bass) * Math.min(1, dt * 18);
    audio.level += (Math.min(1, l * 3) - audio.level) * Math.min(1, dt * 10);
  } else if (playing) {
    const ph = (t * 2) % 1; // battement simulé ~120 BPM
    audio.bass = 0.35 + 0.5 * Math.exp(-ph * 6);
    audio.level = 0.5;
    if (ph < dt * 2) audio.beat = 1;
  } else {
    audio.bass *= 0.9; audio.level *= 0.9;
  }
  audio.beat = Math.max(0, audio.beat - dt * 3.2);
}

let lastSend = 0;
function shareAudio(t) {
  if (t - lastSend < 0.05) return; // 20 messages/s suffisent pour la pulsation de la pochette
  lastSend = t;
  api.send('audio', { bass: +audio.bass.toFixed(2), beat: +audio.beat.toFixed(2) });
}

// ============================================================ géométrie (repère écran entier)
const W = () => L.W, H = () => L.H;
const P = () => 2 * (W() + H());
function edgeOf(s) {
  if (s < W()) return 'top';
  if (s < W() + H()) return 'right';
  if (s < 2 * W() + H()) return 'bottom';
  return 'left';
}
function pointAt(s) {
  const p = P();
  s = ((s % p) + p) % p;
  if (s < W()) return [s, 0];
  if (s < W() + H()) return [W(), s - W()];
  if (s < 2 * W() + H()) return [W() - (s - W() - H()), H()];
  return [0, H() - (s - 2 * W() - H())];
}
function weight(s, placement) {
  const p = P();
  s = ((s % p) + p) % p;
  const e = edgeOf(s);
  if (placement === 'bottom') return e === 'bottom' ? 1 : 0;
  if (placement === 'top') return e === 'top' ? 1 : 0;
  if (placement === 'corners') {
    const corners = [0, W(), W() + H(), 2 * W() + H(), p];
    const d = Math.min(...corners.map((c) => Math.abs(s - c)));
    const x = Math.max(0, 1 - d / (Math.min(W(), H()) * 0.28));
    return x * x * (3 - 2 * x);
  }
  return 1;
}

// ============================================================ couleurs
let palette = [[255, 62, 165], [139, 92, 246], [34, 211, 238]];
function colorAt(u) {
  u = ((u % 1) + 1) % 1;
  const n = palette.length;
  const x = u * n, i = Math.floor(x), f = x - i;
  const a = palette[i % n], b = palette[(i + 1) % n];
  const k = f * f * (3 - 2 * f);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;

// ============================================================ rendu
// Chaque bord est rendu dans un petit canvas à part : un dégradé de couleurs LE LONG du bord, puis un
// fondu VERS L'INTÉRIEUR appliqué en masque. Deux dégradés par bord et par image (au lieu d'un par
// segment) : c'est ce qui rend la lumière quasi gratuite pour le GPU.
const EDGES = ['top', 'right', 'bottom', 'left'];
const layers = {};           // bord -> { canvas, ctx, len, thick, drawn }
const STOPS = 28;            // échantillons de couleur le long d'un bord
const edgeLen = (e) => (e === 'top' || e === 'bottom' ? W() : H());

function layer(e, thick) {
  const len = edgeLen(e);
  let l = layers[e];
  const cw = Math.max(1, Math.ceil(len * SCALE)), ch = Math.max(1, Math.ceil(thick * SCALE));
  if (!l) l = layers[e] = { canvas: new OffscreenCanvas(cw, Math.ceil(ch * 1.25)), ctx: null };
  if (l.canvas.width !== cw || l.canvas.height < ch) { l.canvas.width = cw; l.canvas.height = Math.ceil(ch * 1.25); l.ctx = null; }
  if (!l.ctx) l.ctx = l.canvas.getContext('2d');
  l.len = len; l.thick = thick; l.drawn = false;
  return l;
}

// Abscisse curviligne d'un point d'un bord (u ∈ [0,1] de gauche à droite / de haut en bas).
function sAt(e, u) {
  if (e === 'top') return u * W();
  if (e === 'right') return W() + u * H();
  if (e === 'bottom') return W() + H() + (1 - u) * W();
  return 2 * W() + H() + (1 - u) * H();
}

/**
 * Remplit le calque d'un bord. colorFn(s) -> [rgb, alpha]. heights (facultatif) : hauteurs relatives
 * (0..1) de barres (spectre) ; sinon bande pleine. Le calque est dessiné "bord en haut".
 */
function fillEdge(e, thick, colorFn, heights) {
  if (thick < 1) return;
  const l = layer(e, thick);
  const c = l.ctx;
  const w = l.canvas.width, h = Math.ceil(thick * SCALE);
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, l.canvas.width, l.canvas.height);
  const g = c.createLinearGradient(0, 0, w, 0);
  let any = false;
  for (let i = 0; i <= STOPS; i++) {
    const u = i / STOPS;
    const [rgb, a] = colorFn(sAt(e, u));
    if (a > 0.01) any = true;
    g.addColorStop(u, rgba(rgb, Math.max(0, Math.min(1, a))));
  }
  if (!any) return;
  c.fillStyle = g;
  if (heights) {
    const n = heights.length, bw = w / n;
    c.beginPath();
    for (let i = 0; i < n; i++) c.rect(Math.floor(i * bw), 0, Math.max(1, Math.ceil(bw) - 1), Math.max(1, heights[i] * h));
    c.fill();
  } else {
    c.fillRect(0, 0, w, h);
  }
  // Fondu vers l'intérieur de l'écran.
  c.globalCompositeOperation = 'destination-in';
  const f = c.createLinearGradient(0, 0, 0, h);
  f.addColorStop(0, 'rgba(0,0,0,1)');
  f.addColorStop(0.3, 'rgba(0,0,0,0.5)');
  f.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = f;
  c.fillRect(0, 0, w, h);
  l.drawn = true;
}

// Place un calque dans le repère écran (rotation selon le bord).
function blitEdge(ctx, e) {
  const l = layers[e];
  const src = l.canvas, sw = src.width, sh = Math.ceil(l.thick * SCALE);
  const T = l.thick;
  ctx.save();
  if (e === 'top') ctx.drawImage(src, 0, 0, sw, sh, 0, 0, W(), T);
  else if (e === 'bottom') { ctx.translate(0, H()); ctx.scale(1, -1); ctx.drawImage(src, 0, 0, sw, sh, 0, 0, W(), T); }
  // gauche : le long du calque → y écran (haut→bas), profondeur → x écran
  else if (e === 'left') { ctx.transform(0, 1, 1, 0, 0, 0); ctx.drawImage(src, 0, 0, sw, sh, 0, 0, H(), T); }
  // droite : le long du calque → y écran, profondeur → x = W - profondeur
  else { ctx.transform(0, 1, -1, 0, W(), 0); ctx.drawImage(src, 0, 0, sw, sh, 0, 0, H(), T); }
  ctx.restore();
}

// Lueur ronde (comètes) : sprite pré-rendu par couleur, mis en cache.
const sprites = new Map();
function sprite(rgb) {
  const key = rgb.map((v) => v >> 4).join(',');
  let sp = sprites.get(key);
  if (!sp) {
    if (sprites.size > 256) sprites.clear();
    sp = new OffscreenCanvas(64, 64);
    const c = sp.getContext('2d');
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.25, rgba(rgb, 1));
    g.addColorStop(1, rgba(rgb, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    sprites.set(key, sp);
  }
  return sp;
}
let dots = [];

function drawGlow(cfg, t, fade) {
  const T = cfg.thickness * (0.55 + audio.bass * 0.9 + audio.beat * 0.35);
  const a0 = cfg.intensity * fade * (0.55 + audio.level * 0.45);
  for (const e of EDGES) fillEdge(e, T, (s) => [colorAt(s / P() + t * 0.04), a0 * weight(s, cfg.placement)]);
}
function drawPulse(cfg, t, fade) {
  const T = cfg.thickness * (0.35 + audio.beat * 1.7 + audio.bass * 0.4);
  const a0 = cfg.intensity * fade * (0.35 + audio.beat * 0.65);
  const c = colorAt(t * 0.08 + Math.floor(t * 0.5) * 0.33);
  for (const e of EDGES) fillEdge(e, T, (s) => [c, a0 * weight(s, cfg.placement)]);
}
function drawSpectrum(cfg, t, fade) {
  const bins = freq ? freq.length : 0;
  const Tmax = cfg.thickness * 2.65;
  for (const e of EDGES) {
    const n = Math.round(edgeLen(e) / 10);
    const heights = new Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.abs(((i + 0.5) / n) * 2 - 1); // spectre en miroir autour du milieu du bord
      const v = bins ? freq[Math.min(bins - 1, Math.floor(2 + Math.pow(1 - u, 2.2) * 180))] / 255 : (0.3 + 0.3 * Math.sin(i * 0.7 + t * 6)) * audio.level;
      heights[i] = 0.1 + v * 0.9;
    }
    fillEdge(e, Tmax, (s) => [colorAt((s / P()) * 2 + t * 0.03), cfg.intensity * fade * weight(s, cfg.placement)], heights);
  }
}
const comets = Array.from({ length: 4 }, (_, i) => ({ p: i / 4, hue: i / 4 }));
function drawComets(cfg, t, dt, fade) {
  for (const e of EDGES) fillEdge(e, cfg.thickness * 0.5, (s) => [colorAt(s / P()), cfg.intensity * fade * 0.35 * weight(s, cfg.placement)]);
  const speed = 0.03 + audio.level * 0.12 + audio.beat * 0.08;
  const per = P();
  for (const c of comets) {
    c.p = (c.p + speed * dt) % 1;
    const tail = 14;
    for (let k = tail; k >= 0; k--) {
      const s = (c.p - k * 0.005) * per;
      const w = weight(s, cfg.placement);
      if (!w) continue;
      const [x, y] = pointAt(s);
      const a = cfg.intensity * fade * w * (1 - k / tail) * 0.9;
      if (a > 0.01) dots.push({ x, y, r: cfg.thickness * (1.6 + audio.bass * 1.4) * (1 - (k / tail) * 0.8), rgb: colorAt(c.hue + t * 0.05), a });
    }
  }
}

function edgeRect(e) {
  const T = layers[e]?.thick || 0;
  if (e === 'top') return [0, 0, W(), T];
  if (e === 'bottom') return [0, H() - T, W(), T];
  if (e === 'left') return [0, 0, T, H()];
  return [W() - T, 0, T, H()];
}
const hit = (r, rect) => !(r[0] > rect.x + rect.width || r[1] > rect.y + rect.height || r[0] + r[2] < rect.x || r[1] + r[3] < rect.y);

// Assemble les calques dans une bande (seulement ce qui la touche).
function paint(s) {
  const { ctx, rect } = s;
  ctx.setTransform(SCALE, 0, 0, SCALE, -rect.x * SCALE, -rect.y * SCALE);
  ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
  ctx.globalCompositeOperation = 'lighter';
  for (const e of EDGES) if (layers[e]?.drawn && hit(edgeRect(e), rect)) blitEdge(ctx, e);
  for (const d of dots) {
    if (!hit([d.x - d.r, d.y - d.r, d.r * 2, d.r * 2], rect)) continue;
    ctx.globalAlpha = d.a;
    ctx.drawImage(sprite(d.rgb), d.x - d.r, d.y - d.r, d.r * 2, d.r * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ============================================================ boucle
let fade = 0;
let running = false;
let last = 0;
let lastDraw = 0;

function frame(nowMs) {
  // 30 images/s par défaut (60 en mode « Fluide »), même sur un écran 144 Hz : chaque image en
  // moins soulage le GPU et Windows, donc la vidéo du fond d'écran.
  const frameMs = 1000 / (store.state?.settings?.edge?.fps || 30);
  if (nowMs - lastDraw < frameMs - 2) { requestAnimationFrame(frame); return; }
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  lastDraw = nowMs;
  last = nowMs;
  const t = nowMs / 1000;
  analyse(t, dt);
  shareAudio(t);

  // La lumière s'éteint en douceur quand la musique s'arrête et revient avec le morceau suivant.
  const target = store.pos.isPlaying && store.state?.settings?.features?.edge ? 1 : 0;
  fade += (target - fade) * Math.min(1, dt * (target ? 2.5 : 0.8));

  const cfg = store.state?.settings?.edge;
  for (const e of EDGES) if (layers[e]) layers[e].drawn = false;
  dots = [];
  if (cfg && L && fade > 0.004) {
    if (cfg.style === 'pulse') drawPulse(cfg, t, fade);
    else if (cfg.style === 'spectrum') drawSpectrum(cfg, t, fade);
    else if (cfg.style === 'comet') drawComets(cfg, t, dt, fade);
    else drawGlow(cfg, t, fade);
  }
  for (const s of Object.values(surfaces)) if (s?.rect) paint(s);

  if (target === 0 && fade <= 0.004) {
    // Plus rien à afficher : on arrête complètement (0 % CPU / GPU) jusqu'au prochain morceau.
    running = false;
    api.send('audio', { bass: 0, beat: 0 });
    return;
  }
  requestAnimationFrame(frame);
}

function wake() {
  if (running || !L) return;
  running = true;
  last = lastDraw = performance.now();
  requestAnimationFrame(frame);
}

connect((s) => {
  if (s.colors?.length) palette = s.colors.map(hexToRgb);
  if (s.isPlaying) wake();
}, (p) => { if (p.isPlaying) wake(); }).then(async () => {
  applyLayout(await api.invoke('edge:layout'));
});
