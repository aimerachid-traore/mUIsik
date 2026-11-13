// Lecteur "liquid glass" : barre de lecture + panneau (recherche, playlists, file d'attente, réglages).
// La fenêtre a une taille fixe : le panneau s'ouvre en CSS (animation ressort, sans redimensionner la
// fenêtre), et les zones vides laissent passer les clics vers le bureau.
import { api, store, connect, now, fmtTime, proxied, el } from './shared.js';

const $ = (id) => document.getElementById(id);

// ============================================================ icônes
const I = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M19 5 9 12l10 7V5zM5 5v14"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="m5 5 10 7-10 7V5zM19 5v14"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5C19 15.6 12 20 12 20z"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M4 6h11M4 12h11M4 18h7M18 15v6M15 18h6"/></svg>',
  lyrics: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 11h10M4 16h13"/><circle cx="19" cy="17" r="2.2"/><path d="M21.2 17V9"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  queueNext: '<svg viewBox="0 0 24 24"><path d="M4 7h10M4 12h10M4 17h6M17 12l4 3-4 3z"/></svg>',
  // pictogrammes génériques colorés des sources
  youtube: '<svg viewBox="0 0 24 24" style="stroke:none"><rect x="2" y="5" width="20" height="14" rx="4.5" fill="#ff0033"/><path d="M10 9v6l5-3z" fill="#fff"/></svg>',
  spotify: '<svg viewBox="0 0 24 24" style="stroke:none"><circle cx="12" cy="12" r="10" fill="#1ed760"/><path d="M7 9.5c3.5-1 7.3-.7 10.2.9M7.6 12.6c2.9-.8 6-.5 8.4.8M8.2 15.5c2.3-.6 4.6-.4 6.6.6" stroke="#0a1f12" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>',
  soundcloud: '<svg viewBox="0 0 24 24" style="stroke:none"><path d="M10 9.5c.9-1.6 2.6-2.5 4.4-2.5 2.8 0 5 2.1 5.2 4.8 1.4.2 2.4 1.4 2.4 2.8 0 1.6-1.3 2.9-2.9 2.9H10z" fill="#ff5500"/><path d="M2.5 13v4M4.5 11.5v5.5M6.5 10.5V17M8.4 10v7" stroke="#ff5500" stroke-width="1.5" stroke-linecap="round"/></svg>',
  local: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="rgba(139,92,246,.35)" stroke="#b9a2ff"/><circle cx="11" cy="14.5" r="1.8" stroke="#fff"/><path d="M12.8 14.5V10l2.7-.6" stroke="#fff"/></svg>',
};
const SOURCES = [
  { id: 'spotify', name: 'Spotify', sub: 'Appli Spotify' },
  { id: 'youtube', name: 'YouTube', sub: 'Dans mUIsik' },
  { id: 'soundcloud', name: 'SoundCloud', sub: 'Dans mUIsik' },
  { id: 'local', name: 'Mes fichiers', sub: 'Dossiers locaux' },
];
const srcName = (id) => SOURCES.find((s) => s.id === id)?.name || id;

const setIcon = (node, svg) => { node.innerHTML = svg; };
setIcon($('prev'), I.prev); setIcon($('next'), I.next); setIcon($('like'), I.heart);
setIcon($('t-search'), I.search); setIcon($('t-list'), I.list); setIcon($('t-lyrics'), I.lyrics);
setIcon($('t-settings'), I.gear); setIcon($('t-hide'), I.down); setIcon($('panel-close'), I.close);
document.querySelector('.search-ico').innerHTML = I.search;
document.querySelector('.vol-ico').innerHTML = I.vol;
$('cover-ph').innerHTML = I.note;

const S = () => store.state;
const cmd = (c) => api.send('cmd', c);

// ============================================================ clics : verre ou bureau ?
// La fenêtre laisse passer les clics vers le bureau, sauf sur le verre. On envoie au processus
// principal les rectangles cliquables ; c'est lui qui suit le curseur et active la fenêtre au survol.
let lastHit = '';
function sendHitRects() {
  const rects = [];
  const add = (node) => { const r = node.getBoundingClientRect(); if (r.width && r.height) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height }); };
  add($('bar'));
  if (document.body.classList.contains('expanded')) {
    const p = $('panel');
    rects.push({ x: p.offsetLeft, y: p.offsetTop, w: p.offsetWidth, h: p.offsetHeight }); // position finale (hors animation)
  }
  if (!$('menu').hidden) add($('menu'));
  const key = JSON.stringify(rects);
  if (key !== lastHit) { lastHit = key; api.send('player:hitRects', rects); }
}

// ============================================================ déplacer le lecteur
// Clic maintenu sur une zone vide du verre (barre ou en-tête du panneau), puis glisser.
// (Pas de -webkit-app-region : sur cette fenêtre transparente, Windows avalait alors tous les clics.)
const INTERACTIVE = 'button, input, select, a, .track, .tabs, .list, .settings, .views, .menu, .cover-box';
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const t = e.target;
  if (!t.closest('#bar, .panel-head') || t.closest(INTERACTIVE)) return;
  e.preventDefault();
  document.body.classList.add('moving');
  api.send('player:move', 'start');
  const end = () => {
    document.body.classList.remove('moving');
    api.send('player:move', 'end');
    window.removeEventListener('pointerup', end, true);
    window.removeEventListener('blur', end);
  };
  window.addEventListener('pointerup', end, true);
  window.addEventListener('blur', end);
});

// ============================================================ formes du verre → fond d'écran
function shape(id, node, r, visible = true) {
  // offsetLeft/Top ignorent les transformations : on envoie la position finale, l'animation est
  // rejouée à l'identique par le fond d'écran.
  return { id, x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight, r, visible, blur: 14 };
}
function sendShapes(animate = false) {
  sendHitRects();
  api.send('glass:shapes', {
    animate,
    shapes: [shape('panel', $('panel'), 32, document.body.classList.contains('expanded')), shape('bar', $('bar'), 34)],
  });
}
new ResizeObserver(() => sendShapes()).observe($('stage'));

// ============================================================ barre
$('play').onclick = () => cmd({ type: 'toggle' });
$('prev').onclick = () => cmd({ type: 'prev' });
$('next').onclick = () => cmd({ type: 'next' });
$('like').onclick = () => cmd({ type: 'like' });
$('repeat').onclick = () => cmd({ type: 'repeat' });
$('t-search').onclick = () => toggleView('search');
$('t-list').onclick = () => toggleView('playlists');
$('t-settings').onclick = () => toggleView('settings');
$('t-lyrics').onclick = () => setSettings({ features: { lyrics: !S().settings.features.lyrics } });
$('t-hide').onclick = () => { closePanel(); api.send('player:hide'); };
$('panel-close').onclick = () => closePanel();
$('src-btn').onclick = (e) => openSourceMenu(e.currentTarget);

const vol = $('volume');
vol.oninput = () => { vol.style.setProperty('--v', `${vol.value}%`); cmd({ type: 'volume', value: +vol.value }); };

// Barre de progression (clic + glisser pour avancer).
const track = $('track');
let dragging = null;
const seekRatio = (e) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
track.addEventListener('pointerdown', (e) => { dragging = seekRatio(e); track.classList.add('dragging'); track.setPointerCapture(e.pointerId); wakeTick(); });
track.addEventListener('pointermove', (e) => { if (dragging != null) dragging = seekRatio(e); });
track.addEventListener('pointerup', () => {
  if (dragging == null) return;
  const d = store.pos.duration || S()?.duration || 0;
  if (d) cmd({ type: 'seek', position: dragging * d });
  dragging = null; track.classList.remove('dragging');
});

let lastArt = null;
let lastTrackId = null;
function renderBar(s) {
  const t = s.track;
  $('title').textContent = t?.title || 'mUIsik';
  $('artist').textContent = t ? [t.artist, t.album].filter(Boolean).join(' · ') : `${srcName(s.source)} · cherchez un morceau pour commencer`;
  const box = $('cover-box');
  const art = t?.artwork || null;
  if (art !== lastArt) {
    lastArt = art;
    const img = $('cover');
    box.classList.remove('has-art');
    if (art) {
      img.onload = () => box.classList.add('has-art');
      img.onerror = () => box.classList.remove('has-art');
      img.src = proxied(art);
    } else img.removeAttribute('src');
  }
  const id = t ? `${t.source}:${t.id}` : null;
  if (id !== lastTrackId) {
    lastTrackId = id;
    box.classList.add('bump');
    setTimeout(() => box.classList.remove('bump'), 260);
  }
  setIcon($('play'), s.isPlaying ? I.pause : I.play);
  $('play').title = s.isPlaying ? 'Pause' : 'Lecture';
  setIcon($('src-btn'), I[s.source]);
  $('like').hidden = !(t && t.source === 'spotify');
  $('like').querySelector('svg').classList.toggle('filled', !!s.liked);
  $('repeat').innerHTML = I.repeat + (s.repeat === 'one' ? '<span class="one">1</span>' : '');
  $('repeat').classList.toggle('on', s.repeat !== 'off');
  $('repeat').title = { off: 'Répéter : non', all: 'Répéter : tout', one: 'Répéter : ce titre' }[s.repeat];
  $('t-lyrics').classList.toggle('on', s.settings.features.lyrics);
  if (document.activeElement !== vol) { vol.value = s.volume; vol.style.setProperty('--v', `${s.volume}%`); }
  $('search-src').textContent = srcName(s.source);
  $('q').placeholder = s.source === 'local' ? 'Rechercher dans mes fichiers…' : `Rechercher sur ${srcName(s.source)}… ou coller un lien`;
  renderLyricsMiss(s);
  // Apparence : police du lecteur, densité du verre, verre réfractif disponible ou non.
  const root = document.documentElement.style;
  root.setProperty('--ui-font', s.settings.ui.font ? `"${s.settings.ui.font.replace(/"/g, '')}", "Segoe UI", sans-serif` : '');
  root.setProperty('--glass-alpha', (0.1 + s.settings.ui.glass * 0.6).toFixed(2));
  document.body.classList.toggle('no-lens', !s.settings.features.wallpaper);
}

// Paroles introuvables : liens vers Genius et Google (ouverts dans le navigateur).
function renderLyricsMiss(s) {
  const box = $('lyrics-miss');
  const l = s.lyrics;
  const show = !!(s.track && s.settings.features.lyrics && l && (l.none || l.approx));
  box.hidden = !show;
  if (!show) return;
  const q = `${s.track.artist} ${s.track.title}`.trim();
  const links = [];
  links.push(['Genius', l.geniusUrl || `https://genius.com/search?q=${encodeURIComponent(q)}`]);
  links.push(['Google', `https://www.google.com/search?q=${encodeURIComponent(`${q} paroles`)}`]);
  box.replaceChildren(l.approx ? 'Paroles non synchronisées (calées approximativement)' : 'Paroles introuvables', ...links.map(([n, u]) => {
    const a = el('a', { role: 'link', tabindex: 0 }, `${n} ↗`);
    a.onclick = () => api.send('open:external', u);
    return a;
  }));
}

// Progression : 30 images/s max, et seulement pendant la lecture ou un glisser.
let lastSec = -1;
let ticking = false;
let lastTickAt = 0;
function paintProgress() {
  const d = store.pos.duration || S()?.duration || 0;
  const p = dragging != null ? dragging * d : now();
  const r = d ? Math.min(1, p / d) : 0;
  $('fill').style.transform = `scaleX(${r})`;
  $('knob').style.transform = `translateX(${r * track.clientWidth}px)`;
  const sec = Math.floor(p);
  if (sec !== lastSec) { lastSec = sec; $('cur').textContent = fmtTime(p); $('dur').textContent = fmtTime(d); }
}
function tick(t) {
  if (!store.pos.isPlaying && dragging == null) { ticking = false; paintProgress(); return; }
  if (t - lastTickAt > 33) { lastTickAt = t; paintProgress(); }
  requestAnimationFrame(tick);
}
function wakeTick() { if (!ticking) { ticking = true; requestAnimationFrame(tick); } paintProgress(); }

// ============================================================ panneau
let currentView = null;
function placePill(view) {
  const tab = document.querySelector(`.tab[data-view="${view}"]`);
  const pill = document.querySelector('.tab-pill');
  if (!tab) return;
  pill.style.width = `${tab.offsetWidth}px`;
  pill.style.transform = `translateX(${tab.offsetLeft}px)`;
}
function openView(view) {
  hideMenu();
  const opening = !document.body.classList.contains('expanded');
  document.body.classList.add('expanded');
  $('panel').setAttribute('aria-hidden', 'false');
  currentView = view;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  placePill(view);
  if (opening) sendShapes(true);
  if (view === 'search') setTimeout(() => $('q').focus(), 60);
  if (view === 'playlists') loadPlaylists();
  if (view === 'queue') loadQueue();
  if (view === 'settings') renderSettings();
}
function toggleView(view) { if (currentView === view) closePanel(); else openView(view); }
function closePanel() {
  hideMenu();
  if (!document.body.classList.contains('expanded')) return;
  document.body.classList.remove('expanded');
  $('panel').setAttribute('aria-hidden', 'true');
  currentView = null;
  sendShapes(true);
}
document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => openView(b.dataset.view); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (!$('menu').hidden) hideMenu(); else closePanel(); }
  if (e.key === ' ' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) { e.preventDefault(); cmd({ type: 'toggle' }); }
});

// ---------- lignes de liste ----------
function row(item, { onClick, sub, current, menu = true, end } = {}) {
  const art = item.artwork ? el('img', { src: proxied(item.artwork), alt: '', loading: 'lazy', decoding: 'async' }) : el('div', { class: 'ph' });
  if (!item.artwork) art.innerHTML = item.source === 'local' && !item.title ? I.folder : I.note;
  const endNode = el('div', { class: 'r-end' });
  if (end) endNode.append(end);
  else if (item.duration) endNode.append(fmtTime(item.duration));
  const r = el('div', { class: `row${current ? ' current' : ''}`, tabindex: 0 },
    art,
    el('div', { style: 'min-width:0' },
      el('div', { class: 'r-title' }, item.title || item.name || 'Sans titre'),
      el('div', { class: 'r-sub' }, sub ?? [item.artist, item.album].filter(Boolean).join(' · ')),
    ),
    endNode);
  r.onclick = onClick;
  r.onkeydown = (e) => { if (e.key === 'Enter') onClick?.(); };
  if (menu && item.title) {
    r.oncontextmenu = (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        { label: 'Lire ensuite', icon: I.queueNext, run: () => cmd({ type: 'queueAdd', item, next: true }) },
        { label: "Ajouter à la file d'attente", icon: I.plus, run: () => cmd({ type: 'queueAdd', item, next: false }) },
      ]);
    };
  }
  return r;
}
const empty = (title, text) => el('div', { class: 'empty' }, el('strong', {}, title), text);
const spinner = () => el('div', { class: 'spinner' });
const cleanErr = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const isCurrent = (it) => !!S().track && String(S().track.id) === String(it.id);

// ---------- recherche ----------
let searchTimer = null;
let searchSeq = 0;
$('q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 380); });
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(); } });

async function runSearch() {
  const q = $('q').value.trim();
  const box = $('results');
  if (!q) { box.replaceChildren(searchHint()); return; }
  const seq = ++searchSeq;
  box.replaceChildren(spinner());
  try {
    const items = await api.invoke('search', { query: q, source: S().source });
    if (seq !== searchSeq) return;
    if (!items.length) return box.replaceChildren(empty('Aucun résultat', 'Essayez un autre titre ou une autre source.'));
    box.replaceChildren(...items.map((it) => row(it, { current: isCurrent(it), onClick: () => cmd({ type: 'playItem', item: it, list: items }) })));
  } catch (e) {
    if (seq === searchSeq) box.replaceChildren(empty('Recherche impossible', cleanErr(e)));
  }
}
function searchHint() {
  const s = S();
  const tips = {
    youtube: s?.settings.keys.youtubeApiKey ? 'Cherchez n\'importe quel titre. Le clip devient votre fond d\'écran pendant qu\'il joue.' : 'Collez un lien YouTube, ou ajoutez une clé API YouTube dans Réglages pour chercher.',
    spotify: s?.spotifyConnected ? 'Ce que vous choisissez joue directement dans l\'appli Spotify.' : 'Connectez Spotify dans les Réglages pour chercher dans tout le catalogue.',
    soundcloud: s?.settings.keys.soundcloudClientId ? 'Cherchez un son, ou collez un lien SoundCloud.' : 'Collez un lien SoundCloud, ou ajoutez votre client_id dans Réglages pour chercher.',
    local: 'Déposez un dossier de musique sur le lecteur, ou ajoutez-en un dans Réglages.',
  };
  return empty(`Écouter sur ${srcName(s?.source)}`, tips[s?.source] || '');
}

// ---------- playlists ----------
async function loadPlaylists() {
  const box = $('playlists');
  const s = S();
  if (s.source === 'youtube') {
    const input = el('input', { type: 'text', placeholder: 'Coller le lien d\'une playlist YouTube', style: 'flex:1;background:rgba(0,0,0,.22);border:0;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.16);color:var(--text);border-radius:14px;padding:10px 12px;font:inherit;outline:none' });
    const go = el('button', { class: 'btn', onclick: () => {
      const m = /[?&]list=([\w-]+)/.exec(input.value);
      if (m) openPlaylist({ id: m[1], name: 'Playlist YouTube', source: 'youtube' });
      else toast('Lien de playlist YouTube invalide');
    } }, 'Ouvrir');
    return box.replaceChildren(el('div', { class: 'list-head' }, input, go),
      empty('Playlists YouTube', 'Collez un lien de playlist (une clé API YouTube est nécessaire, voir Réglages).'));
  }
  if (s.source === 'soundcloud') return box.replaceChildren(empty('SoundCloud', 'Cherchez un son dans l\'onglet Recherche, ou collez un lien de morceau.'));
  if (s.source === 'spotify' && !s.spotifyConnected) return box.replaceChildren(empty('Spotify non connecté', 'Connectez votre compte dans les Réglages pour voir vos playlists.'));
  box.replaceChildren(spinner());
  try {
    const lists = await api.invoke('playlists', s.source);
    const nodes = lists.map((p) => row({ ...p, title: p.name }, {
      sub: p.count != null ? `${p.count} titres` : (s.source === 'local' ? p.id : ''), menu: false, end: '', onClick: () => openPlaylist(p),
    }));
    if (s.source === 'local') {
      nodes.push(el('div', { style: 'padding:10px 8px' }, el('button', { class: 'btn', onclick: pickFolder }, '+ Ajouter un dossier')));
      if (!lists.length) nodes.unshift(empty('Aucun dossier', 'Déposez un dossier de musique sur le lecteur, ou ajoutez-en un.'));
    }
    box.replaceChildren(...nodes);
  } catch (e) {
    box.replaceChildren(empty('Impossible de charger les playlists', cleanErr(e)));
  }
}

async function openPlaylist(p) {
  const box = $('playlists');
  const back = el('button', { class: 'icon-btn small', title: 'Retour', 'aria-label': 'Retour', onclick: () => loadPlaylists() });
  back.innerHTML = I.back;
  const slot = el('span', { style: 'margin-left:auto' });
  const head = el('div', { class: 'list-head' }, back, el('strong', {}, p.name), slot);
  box.replaceChildren(head, spinner());
  try {
    const tracks = await api.invoke('playlist:tracks', { source: p.source, id: p.id, uri: p.uri });
    slot.append(el('button', { class: 'btn', onclick: () => tracks[0] && cmd({ type: 'playItem', item: tracks[0], list: tracks }) }, '▶ Tout lire'));
    box.replaceChildren(head, ...(tracks.length
      ? tracks.map((t) => row(t, { current: isCurrent(t), onClick: () => cmd({ type: 'playItem', item: t, list: tracks }) }))
      : [empty('Playlist vide', '')]));
  } catch (e) {
    box.replaceChildren(head, empty('Impossible d\'ouvrir la playlist', cleanErr(e)));
  }
}

async function pickFolder() {
  try {
    const r = await api.invoke('local:pickFolder');
    if (r) { cmd({ type: 'source', source: 'local' }); openView('playlists'); openPlaylist({ id: r.folder, name: r.folder.split(/[\\/]/).pop(), source: 'local' }); }
  } catch (e) { toast(cleanErr(e)); }
}

// ---------- file d'attente ----------
async function loadQueue() {
  const box = $('queue');
  const s = S();
  box.replaceChildren(spinner());
  const q = await api.invoke('queue:get');
  const nodes = [];
  if (s.track) {
    nodes.push(el('div', { class: 'list-head' }, el('strong', {}, 'En cours')));
    nodes.push(row(s.track, { current: true, menu: false }));
  }
  const upcoming = q.readonly ? q.items.map((it) => ({ it, i: -1 })) : q.items.map((it, i) => ({ it, i })).filter(({ i }) => i > q.index);
  nodes.push(el('div', { class: 'list-head' }, el('strong', {}, 'À suivre')));
  if (!upcoming.length) nodes.push(empty('Rien après ce titre', 'Clic droit sur un résultat de recherche pour l\'ajouter ici.'));
  for (const { it, i } of upcoming) {
    let end = null;
    if (!q.readonly) {
      end = el('button', { class: 'icon-btn small', title: 'Retirer', 'aria-label': 'Retirer', onclick: (e) => { e.stopPropagation(); cmd({ type: 'queueRemove', index: i }); } });
      end.innerHTML = I.close;
    }
    nodes.push(row(it, { menu: false, end, onClick: () => (q.readonly ? cmd({ type: 'playItem', item: it }) : cmd({ type: 'playIndex', index: i })) }));
  }
  box.replaceChildren(...nodes);
}

// ============================================================ menus
function showMenu(x, y, items) {
  const m = $('menu');
  m.replaceChildren(...items.map((it) => {
    const b = el('button', { class: it.on ? 'on' : '' });
    b.innerHTML = it.icon || '';
    b.append(el('span', {}, it.label));
    if (it.sub) b.append(el('span', { class: 'm-sub' }, it.sub));
    b.onclick = () => { hideMenu(); it.run(); };
    return b;
  }));
  m.hidden = false;
  requestAnimationFrame(sendHitRects);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  m.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
}
function hideMenu() { if (!$('menu').hidden) { $('menu').hidden = true; sendHitRects(); } }
document.addEventListener('pointerdown', (e) => { if (!$('menu').hidden && !$('menu').contains(e.target)) hideMenu(); });

function openSourceMenu(btn) {
  const s = S();
  const r = btn.getBoundingClientRect();
  showMenu(r.left, r.top - 8 - SOURCES.length * 42, SOURCES.map((src) => ({
    label: src.name, icon: I[src.id], on: s.source === src.id,
    sub: src.id === 'spotify' && !s.spotifyConnected ? 'non connecté' : src.sub,
    run: () => {
      if (src.id === 'spotify' && !s.spotifyConnected) { openView('settings'); return; }
      cmd({ type: 'source', source: src.id });
    },
  })));
}

// ============================================================ toasts
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ============================================================ glisser-déposer un dossier
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0; document.body.classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  try {
    const r = await api.invoke('local:addFolder', api.pathForFile(file));
    cmd({ type: 'source', source: 'local' });
    openView('playlists');
    setTimeout(() => openPlaylist({ id: r.folder, name: r.folder.split(/[\\/]/).pop(), source: 'local' }), 80);
    if (r.tracks[0]) setTimeout(() => cmd({ type: 'playItem', item: r.tracks[0], list: r.tracks }), 120);
  } catch (err) { toast(cleanErr(err)); }
});

// ============================================================ réglages
const setSettings = (patch) => api.invoke('settings:set', patch);

function sw(checked, onChange, label) {
  const b = el('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label });
  b.onclick = () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); onChange(v); };
  return b;
}
function seg(options, value, onChange) {
  const box = el('div', { class: 'seg' });
  for (const [v, label] of options) {
    const b = el('button', { class: v === value ? 'on' : '' }, label);
    b.onclick = () => { box.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); onChange(v); };
    box.append(b);
  }
  return box;
}
// Curseur : met à jour en direct, mais n'enregistre qu'au plus 12 fois/s (évite de saturer l'appli).
function range(min, max, step, value, onChange, label) {
  const r = el('input', { type: 'range', min, max, step, value, 'aria-label': label });
  const upd = () => r.style.setProperty('--v', `${((r.value - min) / (max - min)) * 100}%`);
  upd();
  let t = null;
  r.oninput = () => { upd(); if (!t) t = setTimeout(() => { t = null; onChange(+r.value); }, 80); };
  r.onchange = () => { clearTimeout(t); t = null; onChange(+r.value); };
  return r;
}
function select(options, value, onChange, label) {
  const s = el('select', { 'aria-label': label }, options.map(([v, l]) => el('option', { value: v, selected: String(v) === String(value) }, l)));
  s.onchange = () => onChange(s.value);
  return s;
}
function text(value, placeholder, onChange, secret) {
  const i = el('input', { type: secret ? 'password' : 'text', value: value || '', placeholder, spellcheck: 'false' });
  i.onchange = () => onChange(i.value.trim());
  return i;
}
const field = (label, help, control) => el('div', { class: 'field' }, el('div', {}, el('div', { class: 'lbl' }, label), help ? el('small', {}, help) : null), control);
const group = (title, ...fields) => el('div', { class: 'group' }, el('h3', {}, title), el('div', { class: 'card' }, fields));

// ---------- sélecteur de police (toutes les polices installées) ----------
let fontsPromise = null;
const fontStack = (f) => (f ? `"${f.replace(/"/g, '')}", "Segoe UI", sans-serif` : '');

function fontPicker(label, help, value, defaultLabel, onPick, sample) {
  const wrap = el('div');
  const btnLabel = el('span', { style: `font-family:${fontStack(value)}` }, value || defaultLabel);
  const btn = el('button', { class: 'font-btn', 'aria-expanded': 'false' }, btnLabel, el('span', { style: 'opacity:.6' }, '▾'));
  wrap.append(field(label, help, btn));
  let pop = null;
  let preview = null;
  btn.onclick = async () => {
    if (pop) { pop.remove(); preview?.remove(); pop = null; btn.setAttribute('aria-expanded', 'false'); return; }
    btn.setAttribute('aria-expanded', 'true');
    const search = el('input', { type: 'text', placeholder: 'Rechercher une police…', spellcheck: 'false' });
    const list = el('div', { class: 'font-list' }, spinner());
    preview = el('div', { class: 'font-preview', style: `font-family:${fontStack(value)}` }, sample);
    pop = el('div', { class: 'font-pop' }, search, list);
    wrap.append(pop, preview);
    fontsPromise ||= api.invoke('fonts:list');
    const fonts = await fontsPromise;
    // Chaque police n'est appliquée à sa ligne qu'une fois visible (évite de charger 300 polices d'un coup).
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.style.fontFamily = fontStack(en.target.dataset.font); io.unobserve(en.target); }
    }, { root: list });
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const items = [['', defaultLabel], ...fonts.filter((f) => f.toLowerCase().includes(q)).map((f) => [f, f])].slice(0, 400);
      list.replaceChildren(...items.map(([f, name]) => {
        const it = el('button', { class: `font-item${f === value ? ' on' : ''}`, 'data-font': f }, name);
        if (!f) it.append(el('small', {}, 'par défaut'));
        else io.observe(it);
        it.onmouseenter = () => { preview.style.fontFamily = fontStack(f); };
        it.onclick = () => {
          value = f;
          btnLabel.textContent = f || defaultLabel;
          btnLabel.style.fontFamily = fontStack(f);
          onPick(f);
          list.querySelectorAll('.font-item.on').forEach((x) => x.classList.remove('on'));
          it.classList.add('on');
        };
        return it;
      }));
    };
    search.oninput = render;
    render();
    search.focus();
  };
  return wrap;
}

function renderSettings() {
  const s = S();
  const st = s.settings;
  const box = $('settings');
  const scroll = box.scrollTop;

  const spotifyBtn = s.spotifyConnected
    ? el('button', { class: 'btn danger', onclick: async () => { await api.invoke('spotify:disconnect'); renderSettings(); } }, 'Déconnecter')
    : el('button', { class: 'btn primary', onclick: async (e) => {
      e.currentTarget.textContent = 'Connexion…';
      try { await api.invoke('spotify:connect'); toast('Spotify connecté'); } catch (err) { toast(cleanErr(err)); }
      renderSettings();
    } }, 'Connecter Spotify');

  const removeBtn = (onclick) => { const b = el('button', { class: 'icon-btn small', title: 'Retirer', 'aria-label': 'Retirer', onclick }); b.innerHTML = I.close; return b; };
  const videos = el('div', { class: 'pill-list' },
    ...st.wallpaper.customVideos.map((v) => el('div', {
      class: `pill${st.wallpaper.activeCustom === v ? ' on' : ''}`, style: 'cursor:pointer',
      onclick: (e) => { if (!e.target.closest('button')) setSettings({ wallpaper: { activeCustom: v, mode: 'custom' } }).then(renderSettings); },
    }, el('span', { title: v }, v.split(/[\\/]/).pop()), removeBtn(async () => { await api.invoke('wallpaper:removeVideo', v); renderSettings(); }))),
    el('button', { class: 'btn', style: 'align-self:flex-start', onclick: async () => { await api.invoke('wallpaper:addVideo'); renderSettings(); } }, '+ Ajouter une vidéo'));

  const folders = el('div', { class: 'pill-list' },
    ...st.localFolders.map((f) => el('div', { class: 'pill' }, el('span', { title: f }, f), removeBtn(async () => { await api.invoke('local:removeFolder', f); renderSettings(); }))),
    el('button', { class: 'btn', style: 'align-self:flex-start', onclick: async () => { await pickFolder(); renderSettings(); } }, '+ Ajouter un dossier'));

  const lyr = st.lyrics;
  box.replaceChildren(
    group('Affichage',
      field('Lumière autour de l\'écran', 'Aux couleurs de la pochette, au rythme de la musique', sw(st.features.edge, (v) => setSettings({ features: { edge: v } }), 'Lumière')),
      field('Fond d\'écran animé', 'Clip, pochette animée ou votre vidéo, derrière les icônes', sw(st.features.wallpaper, (v) => setSettings({ features: { wallpaper: v } }), 'Fond d\'écran')),
      field('Paroles sur le bureau', 'Synchronisées ligne par ligne', sw(st.features.lyrics, (v) => setSettings({ features: { lyrics: v } }), 'Paroles')),
      field('Écran', null, select([['', 'Écran principal'], ...s.displays.map((d) => [d.id, `${d.label} — ${d.resolution}`])], st.displayId ?? '', (v) => setSettings({ displayId: v ? +v : null }), 'Écran')),
    ),
    group('Paroles',
      fontPicker('Police', 'Toutes les polices installées sur votre PC', lyr.font, 'Celle du style', (f) => setSettings({ lyrics: { font: f } }), 'Never gonna give you up'),
      field('Animation', null, select([['fade', 'Fondu'], ['karaoke', 'Karaoké'], ['neon', 'Néon'], ['typewriter', 'Machine à écrire']], lyr.style, (v) => setSettings({ lyrics: { style: v } }), 'Animation des paroles')),
      field('Taille', null, range(28, 140, 2, lyr.size, (v) => setSettings({ lyrics: { size: v } }), 'Taille des paroles')),
      field('Graisse', 'De fin à très gras', range(200, 900, 100, lyr.weight, (v) => setSettings({ lyrics: { weight: v } }), 'Graisse')),
      field('Italique', null, sw(lyr.italic, (v) => setSettings({ lyrics: { italic: v } }), 'Italique')),
      field('Casse', null, seg([['none', 'Normal'], ['upper', 'MAJUSCULES'], ['lower', 'minuscules']], lyr.case, (v) => setSettings({ lyrics: { case: v } }))),
      field('Espacement des lettres', null, range(-8, 40, 1, lyr.spacing, (v) => setSettings({ lyrics: { spacing: v } }), 'Espacement')),
      field('Alignement', null, seg([['auto', 'Auto'], ['left', 'Gauche'], ['center', 'Centre']], lyr.align, (v) => setSettings({ lyrics: { align: v } }))),
    ),
    group('Apparence du lecteur',
      fontPicker('Police du lecteur', null, st.ui.font, 'Segoe UI (par défaut)', (f) => setSettings({ ui: { font: f } }), 'Never Gonna Give You Up'),
      field('Verre', 'Plus transparent ← → plus teinté', range(0, 1, 0.05, st.ui.glass, (v) => setSettings({ ui: { glass: v } }), 'Opacité du verre')),
    ),
    group('Lumière',
      field('Style', null, select([['glow', 'Halo qui coule'], ['pulse', 'Pulsation sur le beat'], ['comet', 'Comètes'], ['spectrum', 'Spectre']], st.edge.style, (v) => setSettings({ edge: { style: v } }), 'Style de lumière')),
      field('Position', null, seg([['all', 'Tout'], ['bottom', 'Bas'], ['top', 'Haut'], ['corners', 'Coins']], st.edge.placement, (v) => setSettings({ edge: { placement: v } }))),
      field('Épaisseur', null, range(8, 90, 1, st.edge.thickness, (v) => setSettings({ edge: { thickness: v } }), 'Épaisseur')),
      field('Intensité', null, range(0.1, 1, 0.05, st.edge.intensity, (v) => setSettings({ edge: { intensity: v } }), 'Intensité')),
      field('Fluidité', 'Économe ménage la carte graphique (et la vidéo du fond)', seg([[30, 'Économe'], [60, 'Fluide']], st.edge.fps, (v) => setSettings({ edge: { fps: v } }))),
    ),
    group('Fond d\'écran',
      field('Afficher', null, seg([['auto', 'Clip / pochette'], ['artwork', 'Pochette'], ['custom', 'Ma vidéo']], st.wallpaper.mode, (v) => setSettings({ wallpaper: { mode: v } }))),
      field('Assombrir', 'Pour garder les icônes et les paroles lisibles', range(0, 0.8, 0.05, st.wallpaper.dim, (v) => setSettings({ wallpaper: { dim: v } }), 'Assombrir')),
      el('div', { class: 'field', style: 'display:block' }, el('div', { class: 'lbl' }, 'Mes vidéos'), videos),
    ),
    group('Spotify',
      field(s.spotifyConnected ? 'Compte connecté' : 'Compte Spotify', 'La musique joue dans l\'appli Spotify ; mUIsik la pilote et la suit.', spotifyBtn),
      field('Client ID', 'Créez une appli sur developer.spotify.com', text(st.keys.spotifyClientId, 'ex. 1a2b3c…', (v) => setSettings({ keys: { spotifyClientId: v } }).then(renderSettings))),
      el('div', { class: 'field', style: 'display:block;color:var(--muted);font-size:12px' },
        'Dans votre appli Spotify, ajoutez cette Redirect URI : ', el('span', { class: 'code' }, 'http://127.0.0.1:43821/callback'), ' et cochez « Web API ».'),
    ),
    group('Clés facultatives',
      field('Clé API YouTube', 'Pour chercher, ouvrir des playlists et trouver le clip des titres Spotify.', text(st.keys.youtubeApiKey, 'AIza…', (v) => setSettings({ keys: { youtubeApiKey: v } }), true)),
      field('client_id SoundCloud', 'Pour chercher sur SoundCloud.', text(st.keys.soundcloudClientId, 'votre client_id', (v) => setSettings({ keys: { soundcloudClientId: v } }), true)),
      field('Jeton Genius', 'Quand des paroles manquent : lien direct vers la bonne page Genius.', text(st.keys.geniusToken, 'facultatif', (v) => setSettings({ keys: { geniusToken: v } }), true)),
    ),
    group('Mes fichiers', el('div', { class: 'field', style: 'display:block' }, el('div', { class: 'lbl' }, 'Dossiers de musique'), el('small', {}, 'Un fichier .lrc à côté d\'un morceau donne ses paroles.'), folders)),
    group('Système',
      field('Lancer mUIsik au démarrage de Windows', 'Démarre discrètement dans la zone de notification', sw(st.launchAtStartup, (v) => setSettings({ launchAtStartup: v }), 'Lancer au démarrage')),
    ),
    el('div', { style: 'display:flex;justify-content:flex-end;padding:4px 0 10px' }, el('button', { class: 'btn danger', onclick: () => api.send('app:quit') }, 'Quitter mUIsik')),
  );
  box.scrollTop = scroll;
}

// ============================================================ état
let lastToast = 0;
let queueKey = '';
connect((s, prev) => {
  renderBar(s);
  if (s.isPlaying) wakeTick(); else paintProgress();
  if (s.toast && s.toast.at !== lastToast) { lastToast = s.toast.at; toast(s.toast.message); }
  if (prev && s.source !== prev.source) {
    if (currentView === 'search') { if ($('q').value.trim()) runSearch(); else $('results').replaceChildren(searchHint()); }
    if (currentView === 'playlists') loadPlaylists();
  }
  if (prev && s.spotifyConnected !== prev.spotifyConnected && currentView === 'settings') renderSettings();
  const qk = `${s.track?.id}|${s.queue.length}|${s.queueIndex}`;
  if (currentView === 'queue' && qk !== queueKey) loadQueue();
  queueKey = qk;
}, (p) => { if (p.isPlaying) wakeTick(); else paintProgress(); }).then(() => {
  $('results').replaceChildren(searchHint());
  placePill('search');
  sendShapes();
});
