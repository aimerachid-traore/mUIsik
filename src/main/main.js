// mUIsik — processus principal.
// Fenêtres :
//   - wallpaper : derrière les icônes du bureau. Contient aussi le "moteur" audio (YouTube, SoundCloud,
//                 fichiers locaux) et le verre du lecteur (flou + réfraction de ce qui est derrière).
//   - edge      : 4 bandes transparentes au bord de l'écran, au-dessus de tout, qui ne captent pas la
//                 souris. La lumière d'ambiance.
//   - player    : le lecteur "liquid glass" (recherche, playlists, file d'attente, réglages).
// Le main garde l'état unique (morceau, position, couleurs, paroles…) et le diffuse à toutes les fenêtres.
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, session, desktopCapturer, shell,
} = require('electron');

const settingsStore = require('./settings');
const server = require('./server');
const { Spotify } = require('./spotify');
const sources = require('./sources');
const { fetchLyrics, parseLrc } = require('./lyrics');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
if (!app.requestSingleInstanceLock()) app.quit();

const DEV = process.argv.includes('--dev');
const PERF = process.argv.includes('--perf');
const HITTEST = process.argv.includes('--hittest');
const DEFAULT_COLORS = ['#ff3ea5', '#8b5cf6', '#22d3ee'];
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus']);

let settings;
let spotify;
let tray;
const wins = { wallpaper: null, edge: null, player: null };
let wallpaperAttached = false;

const state = {
  source: 'youtube',
  isPlaying: false,
  position: 0,
  positionAt: Date.now(),
  duration: 0,
  track: null,
  lyrics: null,
  colors: DEFAULT_COLORS,
  liked: false,
  queue: [],
  queueIndex: -1,
  bgVideoId: null,
  spotifyConnected: false,
  repeat: 'off',
  volume: 80,
  toast: null,
};

// ---------------------------------------------------------------- diffusion
function publicSettings() {
  const { spotifyToken, ...rest } = settings;
  return rest;
}
function snapshot() {
  return { ...state, settings: publicSettings(), displays: listDisplays() };
}
function sendAll(channel, payload) {
  for (const w of Object.values(wins)) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}
let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => { broadcastQueued = false; sendAll('state', snapshot()); });
}
function sendPos() {
  sendAll('pos', { position: state.position, positionAt: state.positionAt, isPlaying: state.isPlaying, duration: state.duration });
}
function toast(message) {
  state.toast = { message, at: Date.now() };
  broadcast();
}
function sendEngine(cmd) {
  if (wins.wallpaper && !wins.wallpaper.isDestroyed()) wins.wallpaper.webContents.send('engine:cmd', cmd);
}
function setPosition(sec, isPlaying = state.isPlaying) {
  state.position = Math.max(0, sec || 0);
  state.positionAt = Date.now();
  state.isPlaying = isPlaying;
}

// ---------------------------------------------------------------- écrans
function listDisplays() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: `Écran ${i + 1}${d.id === primary ? ' (principal)' : ''}`,
    // Résolution réelle (ex. 3840 × 2160 pour un écran 4K), pas la taille "mise à l'échelle".
    resolution: `${Math.round(d.size.width * d.scaleFactor)} × ${Math.round(d.size.height * d.scaleFactor)}`,
  }));
}
function targetDisplay() {
  return screen.getAllDisplays().find((d) => d.id === settings.displayId) || screen.getPrimaryDisplay();
}

// ---------------------------------------------------------------- fenêtres
const prefs = (extra = {}) => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: false,          // pas de dictionnaires chargés en mémoire
  backgroundThrottling: true, // une fenêtre cachée ne consomme rien
  ...extra,
});
const pageUrl = (name) => `${server.PAGE_ORIGIN}/app/${name}.html${PERF ? '?perf=1' : ''}`;
// Dans l'exe, les scripts PowerShell sont "dépaquetés" à côté de app.asar.
const nativeDir = path.join(__dirname, 'native').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function createWallpaper() {
  const b = targetDisplay().bounds;
  const w = new BrowserWindow({
    ...b, show: false, frame: false, skipTaskbar: true, focusable: false, resizable: false,
    movable: false, hasShadow: false, backgroundColor: '#000000', title: 'mUIsik wallpaper',
    // Le moteur audio vit ici : il ne doit jamais être mis en veille.
    webPreferences: prefs({ backgroundThrottling: false }),
  });
  w.setMenu(null);
  w.loadURL(pageUrl('wallpaper'));
  w.once('ready-to-show', () => applyWallpaperVisibility());
  w.webContents.on('did-finish-load', () => sendGlass());
  w.on('closed', () => { wins.wallpaper = null; wallpaperAttached = false; });
  wins.wallpaper = w;
}

function runDesktopHelper(args) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(nativeDir, 'desktop.ps1'), ...args.map(String)],
    { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
      if (err) console.error('[desktop]', err.message, stderr);
      resolve((stdout || '').trim());
    });
  });
}

async function attachWallpaper() {
  const w = wins.wallpaper;
  if (!w || process.platform !== 'win32') return;
  const d = targetDisplay();
  w.setBounds(d.bounds);
  const phys = screen.dipToScreenRect(null, d.bounds);
  const handle = w.getNativeWindowHandle();
  const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  const out = await runDesktopHelper(['attach', hwnd.toString(), phys.x, phys.y, phys.width, phys.height]);
  wallpaperAttached = out.startsWith('ok');
  console.log('[desktop] attach:', out);
  if (!wallpaperAttached) {
    // Repli : fenêtre tout en bas de la pile, sans recouvrir les autres.
    w.setAlwaysOnTop(false);
    w.blur();
  }
}

async function applyWallpaperVisibility() {
  const w = wins.wallpaper;
  if (!w) return;
  if (settings.features.wallpaper) {
    w.showInactive();
    if (!wallpaperAttached) await attachWallpaper();
  } else if (w.isVisible()) {
    w.hide(); // le moteur audio continue de tourner dans la fenêtre cachée
    runDesktopHelper(['restore']);
  }
}

// ---------- lumière : 4 bandes fines au bord de l'écran ----------
// Une fenêtre transparente plein écran redessinée en continu sature le GPU (et fait saccader la vidéo).
// Quatre bandes de quelques dizaines de pixels coûtent une fraction de ça. La bande du haut charge
// edge.html et ouvre les trois autres avec window.open : elles partagent son processus (pas de RAM en plus)
// et elle dessine directement dans leurs canvas.
const EDGE_SIDES = ['top', 'bottom', 'left', 'right'];
const edgeWins = {};

function edgeLayout() {
  const b = targetDisplay().bounds;
  const e = settings.edge;
  const depth = Math.min(Math.round(Math.min(b.width, b.height) / 3), Math.round(e.thickness * 3 + 24));
  const p = e.placement;
  return {
    W: b.width, H: b.height, depth,
    strips: {
      top: { x: 0, y: 0, width: b.width, height: depth },
      bottom: { x: 0, y: b.height - depth, width: b.width, height: depth },
      left: { x: 0, y: depth, width: depth, height: b.height - 2 * depth },
      right: { x: b.width - depth, y: depth, width: depth, height: b.height - 2 * depth },
    },
    visible: {
      top: p === 'all' || p === 'top' || p === 'corners',
      bottom: p === 'all' || p === 'bottom' || p === 'corners',
      left: p === 'all' || p === 'corners',
      right: p === 'all' || p === 'corners',
    },
  };
}

const edgeWindowOptions = {
  show: false, frame: false, transparent: true, backgroundColor: '#00000000',
  skipTaskbar: true, focusable: false, resizable: false, movable: false, minimizable: false,
  maximizable: false, hasShadow: false, alwaysOnTop: true, thickFrame: false,
};

function setupEdgeWindow(w, side) {
  w.setMenu(null);
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setIgnoreMouseEvents(true);
  w.setVisibleOnAllWorkspaces(true);
  edgeWins[side] = w;
  w.on('closed', () => { delete edgeWins[side]; });
  applyEdgeLayout();
}

function applyEdgeLayout() {
  const L = edgeLayout();
  const o = targetDisplay().bounds;
  for (const side of EDGE_SIDES) {
    const w = edgeWins[side];
    if (!w || w.isDestroyed()) continue;
    const r = L.strips[side];
    // La bande du haut reste affichée (au pire 1 px) : c'est elle qui fait tourner l'animation.
    if (side === 'top' && !L.visible.top) w.setBounds({ x: o.x, y: o.y, width: 1, height: 1 });
    else w.setBounds({ x: o.x + r.x, y: o.y + r.y, width: Math.max(1, r.width), height: Math.max(1, r.height) });
    const show = settings.features.edge && (L.visible[side] || side === 'top');
    if (show && !w.isVisible()) w.showInactive();
    if (!show && w.isVisible()) w.hide();
  }
  if (wins.edge && !wins.edge.isDestroyed()) wins.edge.webContents.send('edge:layout', L);
}

function createEdge() {
  const w = new BrowserWindow({ ...edgeWindowOptions, title: 'mUIsik light', webPreferences: prefs({ backgroundThrottling: false }) });
  w.webContents.setWindowOpenHandler(({ frameName }) => {
    const side = frameName.replace('edge-', '');
    if (!EDGE_SIDES.includes(side)) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: { ...edgeWindowOptions, title: `mUIsik light ${side}`, webPreferences: { backgroundThrottling: false, spellcheck: false } },
    };
  });
  w.webContents.on('did-create-window', (child, { frameName }) => setupEdgeWindow(child, frameName.replace('edge-', '')));
  wins.edge = w;
  w.on('closed', () => { wins.edge = null; });
  setupEdgeWindow(w, 'top');
  w.loadURL(pageUrl('edge'));
}

// ---------- lecteur ----------
// Fenêtre de taille fixe : le panneau s'ouvre en CSS (animation fluide, pas de redimensionnement).
// Les zones vides laissent passer les clics vers le bureau (voir updatePlayerHit).
const PLAYER_W = 820;
const PLAYER_H = 680;

function playerStartBounds() {
  const saved = settings.playerPos;
  const cx = saved && saved.x + PLAYER_W / 2;
  const by = saved && saved.y + PLAYER_H - 60;
  if (saved && screen.getAllDisplays().some(({ workArea: a }) => cx > a.x && cx < a.x + a.width && by > a.y && by < a.y + a.height)) {
    return { x: saved.x, y: saved.y, width: PLAYER_W, height: PLAYER_H };
  }
  const wa = targetDisplay().workArea;
  return { x: Math.round(wa.x + (wa.width - PLAYER_W) / 2), y: wa.y + wa.height - PLAYER_H - 8, width: PLAYER_W, height: PLAYER_H };
}

let savePosTimer = null;
function createPlayer() {
  const w = new BrowserWindow({
    ...playerStartBounds(), show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, maximizable: false, fullscreenable: false, hasShadow: false, thickFrame: false,
    title: 'mUIsik', icon: appIcon(256), webPreferences: prefs(),
  });
  w.setMenu(null);
  w.setIgnoreMouseEvents(true, { forward: true });
  w.loadURL(pageUrl('player'));
  w.once('ready-to-show', () => { if (settings.features.player && !process.argv.includes('--hidden')) w.show(); sendGlass(); });
  w.on('move', () => {
    sendGlass();
    clearTimeout(savePosTimer);
    savePosTimer = setTimeout(() => {
      const b = w.getBounds();
      settings.playerPos = { x: b.x, y: b.y };
      settingsStore.save(settings);
    }, 400);
  });
  w.on('show', () => sendGlass());
  w.on('hide', () => sendGlass());
  w.on('minimize', () => sendGlass());
  w.on('restore', () => sendGlass());
  w.on('closed', () => { wins.player = null; });
  if (DEV) w.webContents.openDevTools({ mode: 'detach' });
  wins.player = w;
}

// Formes du verre du lecteur (barre, panneau…), recopiées dans le fond d'écran qui dessine
// le flou et la réfraction de ce qu'il y a derrière : c'est l'effet "liquid glass".
let glassShapes = [];
function sendGlass(animate = false) {
  const wp = wins.wallpaper;
  if (!wp || wp.isDestroyed()) return;
  const p = wins.player;
  const visible = !!p && !p.isDestroyed() && p.isVisible() && !p.isMinimized();
  const b = visible ? p.getBounds() : { x: 0, y: 0 };
  const o = targetDisplay().bounds;
  wp.webContents.send('glass', { x: b.x - o.x, y: b.y - o.y, shapes: visible ? glassShapes : [], animate });
}

// Clics : la fenêtre du lecteur est grande et transparente. On suit le curseur et on ne la rend
// cliquable que lorsqu'il survole le verre ; ailleurs, les clics traversent vers le bureau.
// (Les mouvements de souris de la page ne suffisent pas : Windows ne les envoie pas quand la
// fenêtre ignore la souris.)
let playerHitRects = [];
let playerClickable = null;
function updatePlayerHit() {
  const w = wins.player;
  if (!w || w.isDestroyed() || !w.isVisible()) return;
  const c = screen.getCursorScreenPoint();
  const b = w.getBounds();
  const x = c.x - b.x, y = c.y - b.y;
  const inside = playerHitRects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  if (inside !== playerClickable) {
    playerClickable = inside;
    if (HITTEST) console.log('[hit] clickable', inside, x, y);
    w.setIgnoreMouseEvents(!inside, { forward: true });
  }
}
setInterval(updatePlayerHit, 33);

function repositionAll() {
  if (wins.player) {
    const wa = targetDisplay().workArea;
    wins.player.setBounds({ x: Math.round(wa.x + (wa.width - PLAYER_W) / 2), y: wa.y + wa.height - PLAYER_H - 8, width: PLAYER_W, height: PLAYER_H });
  }
  applyEdgeLayout();
  wallpaperAttached = false;
  applyWallpaperVisibility();
}

// ---------------------------------------------------------------- icône / tray
function makeIcon(size = 32) {
  // Repli si icon.png manque : petit disque dégradé rose → violet, généré en mémoire (BGRA).
  const buf = Buffer.alloc(size * size * 4);
  const r0 = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - r0, dy = y + 0.5 - r0;
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = Math.max(0, Math.min(1, r0 - 1 - d + 0.5));
      const t = (x + y) / (2 * size);
      const ring = d < r0 * 0.38 ? 0.15 : 1;
      const i = (y * size + x) * 4;
      buf[i] = Math.round((165 + (246 - 165) * t) * ring);   // B
      buf[i + 1] = Math.round((62 + (92 - 62) * t) * ring);  // G
      buf[i + 2] = Math.round((255 + (139 - 255) * t) * ring); // R
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

const appIconPath = path.join(__dirname, 'icon.png');
function appIcon(size) {
  const img = nativeImage.createFromPath(appIconPath);
  return img.isEmpty() ? makeIcon(size) : img.resize({ width: size, height: size, quality: 'best' });
}

function buildTrayMenu() {
  const f = settings.features;
  const toggle = (key) => () => setSettings({ features: { [key]: !settings.features[key] } });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: state.track ? `${state.track.title} — ${state.track.artist}`.slice(0, 60) : 'mUIsik', enabled: false },
    { type: 'separator' },
    { label: state.isPlaying ? 'Pause' : 'Lecture', click: () => command({ type: 'toggle' }) },
    { label: 'Suivant', click: () => command({ type: 'next' }) },
    { type: 'separator' },
    { label: 'Lecteur', type: 'checkbox', checked: f.player, click: toggle('player') },
    { label: 'Lumière', type: 'checkbox', checked: f.edge, click: toggle('edge') },
    { label: "Fond d'écran", type: 'checkbox', checked: f.wallpaper, click: toggle('wallpaper') },
    { label: 'Paroles', type: 'checkbox', checked: f.lyrics, click: toggle('lyrics') },
    { type: 'separator' },
    { label: 'Quitter mUIsik', click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(appIcon(32));
  tray.setToolTip('mUIsik');
  tray.on('click', () => setSettings({ features: { player: true } }, () => { wins.player?.show(); wins.player?.focus(); }));
  buildTrayMenu();
}

// ---------------------------------------------------------------- réglages
function setSettings(patch, after) {
  const before = settings;
  settings = settingsStore.deepMerge(settings, patch);
  settingsStore.save(settings);
  const f = settings.features;

  if (before.features.edge !== f.edge || before.edge.thickness !== settings.edge.thickness || before.edge.placement !== settings.edge.placement) applyEdgeLayout();
  if (before.launchAtStartup !== settings.launchAtStartup) applyLoginItem();
  if (before.features.player !== f.player && wins.player) (f.player ? wins.player.show() : wins.player.hide());
  if (before.features.wallpaper !== f.wallpaper) applyWallpaperVisibility();
  if (before.displayId !== settings.displayId) repositionAll();
  if (before.wallpaper.mode !== settings.wallpaper.mode) refreshBackgroundVideo();

  state.repeat = settings.repeat;
  state.volume = settings.volume;
  if (tray) buildTrayMenu();
  broadcast();
  after?.();
}

// ---------------------------------------------------------------- morceaux
const sameTrack = (a, b) => !!a && !!b && a.source === b.source && String(a.id) === String(b.id);
let trackToken = 0;

function setTrack(track) {
  if (sameTrack(track, state.track)) {
    // Mise à jour des infos (ex. SoundCloud ou lien collé : titre et pochette connus après coup).
    const before = `${state.track.artist}|${state.track.title}`;
    state.track = { ...state.track, ...Object.fromEntries(Object.entries(track).filter(([, v]) => v)) };
    if (track.duration) state.duration = track.duration;
    broadcast();
    if (`${state.track.artist}|${state.track.title}` !== before) refreshTrackExtras(trackToken);
    return;
  }
  const token = ++trackToken;
  state.track = track;
  if (track) console.log('[track]', track.source, track.artist, '-', track.title);
  state.duration = track?.duration || 0;
  state.lyrics = null;
  state.liked = false;
  state.bgVideoId = null;
  broadcast();
  if (tray) buildTrayMenu();
  if (!track) return;
  if (track.source === 'spotify' && spotify.connected) {
    spotify.isLiked(track.id).then((liked) => { if (token === trackToken) { state.liked = liked; broadcast(); } }).catch(() => {});
  }
  refreshTrackExtras(token);
}

/** Lien vers la page Genius du morceau (API officielle Genius ; on n'affiche que le lien). */
async function geniusUrl(track) {
  const q = `${track.artist} ${sources.cleanTitle(track.title)}`.trim();
  const r = await fetch(`https://api.genius.com/search?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${settings.keys.geniusToken}` } });
  if (!r.ok) return null;
  const j = await r.json();
  return j.response?.hits?.find((h) => h.type === 'song')?.result?.url || null;
}

const PLACEHOLDER_TITLES = new Set(['Vidéo YouTube', 'Lien SoundCloud']);

/** Paroles + clip de fond, (re)cherchés quand on connaît le vrai titre du morceau. */
function refreshTrackExtras(token) {
  const track = state.track;
  if (!track || PLACEHOLDER_TITLES.has(track.title)) return; // titre pas encore connu
  state.lyrics = null;
  loadLyrics(track).then(async (lyrics) => {
    if (token !== trackToken) return;
    let l = lyrics || { synced: [], plain: '' };
    if (!l.synced?.length && l.plain?.trim()) {
      // Texte sans horodatage : on répartit les lignes sur la durée du morceau (approximatif).
      const lines = l.plain.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      const d = state.duration || track.duration || 180;
      const start = d * 0.06, span = d * 0.88;
      l = { ...l, approx: true, synced: lines.map((text, i) => ({ t: start + (span * i) / lines.length, text })) };
    }
    if (!l.synced?.length) l = { ...l, none: true };
    state.lyrics = l;
    console.log('[lyrics]', l.synced.length, 'lignes', l.approx ? '(approx.)' : '');
    broadcast();
    if ((l.none || l.approx) && settings.keys.geniusToken) {
      const url = await geniusUrl(track).catch(() => null);
      if (url && token === trackToken) { state.lyrics = { ...state.lyrics, geniusUrl: url }; broadcast(); }
    }
  });
  refreshBackgroundVideo();
}

async function loadLyrics(track) {
  if (track.source === 'local' && track.path) {
    // Paroles .lrc à côté du fichier audio.
    const lrc = track.path.replace(/\.[^.]+$/, '.lrc');
    try {
      const text = fs.readFileSync(lrc, 'utf8');
      return { synced: parseLrc(text), plain: text.replace(/\[[^\]]*\]/g, '') };
    } catch { /* pas de .lrc */ }
  }
  try { return await fetchLyrics(track); } catch { return null; }
}

/** Morceau joué hors YouTube : on cherche son clip pour l'afficher (muet) en fond d'écran. */
async function refreshBackgroundVideo() {
  const t = state.track;
  state.bgVideoId = null;
  if (!t || t.source === 'youtube' || settings.wallpaper.mode !== 'auto') return broadcast();
  const token = trackToken;
  const id = await sources.findMusicVideo(t.artist, t.title, settings.keys.youtubeApiKey);
  if (token !== trackToken) return;
  state.bgVideoId = id;
  broadcast();
}

// ---------------------------------------------------------------- lecture
async function setSource(src) {
  if (src === state.source) return;
  // Changer de source arrête la musique de celle qu'on quitte.
  if (state.source === 'spotify') {
    if (spotify.connected && state.isPlaying) spotify.pause().catch(() => {});
  } else {
    sendEngine({ type: 'stop' });
  }
  state.source = src;
  settings.source = src;
  settingsStore.save(settings);
  state.isPlaying = false;
  state.queue = [];
  state.queueIndex = -1;
  setTrack(null);
  setPosition(0, false);
  sendPos();
  broadcast();
  if (src === 'spotify') pollSpotify();
}

async function playItem(item, list) {
  if (!item) return;
  await setSource(item.source); // (vide la file si on change de source)
  if (list) {
    state.queue = list.slice(0, 500);
    state.queueIndex = state.queue.findIndex((x) => sameTrack(x, item));
    if (state.queueIndex < 0) { state.queue.unshift(item); state.queueIndex = 0; }
  }

  if (item.source === 'spotify') {
    try {
      if (item.contextUri) {
        await spotify.play({ contextUri: item.contextUri, offsetUri: item.uri });
      } else {
        const uris = state.queue.filter((x) => x.uri).map((x) => x.uri);
        const i = Math.max(0, uris.indexOf(item.uri));
        await spotify.play({ uris: uris.length ? uris.slice(i, i + 100) : [item.uri] });
      }
      setTrack(item);
      setPosition(0, true);
      sendPos();
      setTimeout(pollSpotify, 800);
    } catch (e) {
      toast(e.status === 403 ? 'Spotify Premium est nécessaire pour piloter la lecture.' : e.message);
    }
    return;
  }

  const payload = { ...item };
  if (item.source === 'local') payload.src = `${server.PAGE_ORIGIN}/local?f=${server.registerLocal(item.path)}`;
  sendEngine({ type: 'load', item: payload, volume: settings.volume });
  setTrack(item);
  setPosition(0, true);
  sendPos();
  broadcast();
}

function playIndex(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.queueIndex = i;
  playItem(state.queue[i]);
}

function next(auto = false) {
  if (state.source === 'spotify') return spotify.next().then(() => setTimeout(pollSpotify, 500)).catch((e) => toast(e.message));
  if (auto && settings.repeat === 'one') { sendEngine({ type: 'seek', position: 0 }); sendEngine({ type: 'play' }); return; }
  let i = state.queueIndex + 1;
  if (i >= state.queue.length) {
    if (settings.repeat === 'all' && state.queue.length) i = 0;
    else { setPosition(state.position, false); sendPos(); broadcast(); return; }
  }
  playIndex(i);
}

function prev() {
  if (state.source === 'spotify') return spotify.prev().then(() => setTimeout(pollSpotify, 500)).catch((e) => toast(e.message));
  const pos = currentPosition();
  if (pos > 3 || state.queueIndex <= 0) { sendEngine({ type: 'seek', position: 0 }); setPosition(0); sendPos(); return; }
  playIndex(state.queueIndex - 1);
}

const currentPosition = () => (state.isPlaying ? state.position + (Date.now() - state.positionAt) / 1000 : state.position);

let volumeTimer = null;
async function command(cmd) {
  try {
    switch (cmd.type) {
      case 'toggle':
        return command({ type: state.isPlaying ? 'pause' : 'play' });
      case 'play':
        if (state.source === 'spotify') {
          await spotify.play();
        } else if (!state.track) {
          if (state.queue.length) return playIndex(Math.max(0, state.queueIndex));
          return toast('Cherchez un morceau pour commencer.');
        } else sendEngine({ type: 'play' });
        setPosition(currentPosition(), true); sendPos(); broadcast();
        return;
      case 'pause':
        if (state.source === 'spotify') await spotify.pause(); else sendEngine({ type: 'pause' });
        setPosition(currentPosition(), false); sendPos(); broadcast();
        return;
      case 'next': return next();
      case 'prev': return prev();
      case 'seek':
        if (state.source === 'spotify') await spotify.seek(cmd.position); else sendEngine({ type: 'seek', position: cmd.position });
        setPosition(cmd.position); sendPos();
        return;
      case 'volume':
        settings.volume = cmd.value; state.volume = cmd.value; settingsStore.save(settings);
        if (state.source === 'spotify') {
          clearTimeout(volumeTimer);
          volumeTimer = setTimeout(() => spotify.volume(cmd.value).catch(() => {}), 250);
        } else sendEngine({ type: 'volume', value: cmd.value });
        return;
      case 'repeat': {
        const order = ['off', 'all', 'one'];
        const mode = order[(order.indexOf(settings.repeat) + 1) % 3];
        if (state.source === 'spotify') spotify.repeat(mode).catch(() => {});
        return setSettings({ repeat: mode });
      }
      case 'like':
        if (state.track?.source !== 'spotify') return;
        await spotify.like(state.track.id, !state.liked);
        state.liked = !state.liked; broadcast();
        return;
      case 'source': return setSource(cmd.source);
      case 'playItem': return playItem(cmd.item, cmd.list);
      case 'playIndex': return playIndex(cmd.index);
      case 'queueAdd':
        if (cmd.item.source === 'spotify') { await spotify.addToQueue(cmd.item.uri); return toast("Ajouté à la file d'attente Spotify"); }
        if (cmd.item.source !== state.source || !state.track) return playItem(cmd.item, [cmd.item]);
        state.queue.splice(cmd.next ? state.queueIndex + 1 : state.queue.length, 0, cmd.item);
        broadcast();
        return toast(cmd.next ? 'Joué ensuite' : "Ajouté à la file d'attente");
      case 'queueRemove':
        if (cmd.index === state.queueIndex) return;
        state.queue.splice(cmd.index, 1);
        if (cmd.index < state.queueIndex) state.queueIndex--;
        return broadcast();
      default:
    }
  } catch (e) {
    console.error('[command]', cmd.type, e);
    toast(e.status === 403 ? 'Spotify Premium est nécessaire pour piloter la lecture.' : e.message);
  }
}

// ---------------------------------------------------------------- Spotify (suivi)
let spotifyTimer = null;
let spotifyBackoff = 0;
async function pollSpotify() {
  clearTimeout(spotifyTimer);
  state.spotifyConnected = spotify.connected;
  if (!spotify.connected) return;
  try {
    const s = await spotify.state();
    spotifyBackoff = 0;
    if (state.source !== 'spotify' && s?.isPlaying && !state.isPlaying) {
      // Musique lancée directement dans Spotify : mUIsik suit.
      await setSource('spotify');
    }
    if (state.source === 'spotify') {
      if (s?.track) setTrack(s.track);
      const wasPlaying = state.isPlaying;
      setPosition(s?.position ?? state.position, !!s?.isPlaying);
      sendPos();
      if (wasPlaying !== state.isPlaying) { broadcast(); buildTrayMenu(); }
    }
  } catch (e) {
    if (e.status === 429) spotifyBackoff = 10000;
    if (!spotify.connected) { state.spotifyConnected = false; broadcast(); }
  }
  const delay = spotifyBackoff || (state.source === 'spotify' ? 1000 : 4000);
  spotifyTimer = setTimeout(pollSpotify, delay);
}

// ---------------------------------------------------------------- fichiers locaux
function scanFolder(dir, out = [], depth = 0) {
  if (depth > 6 || out.length > 3000) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) scanFolder(fp, out, depth + 1);
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) {
      const base = path.basename(e.name, path.extname(e.name)).replace(/^\d+[\s.\-_]+/, '');
      const { artist, title } = sources.splitArtistTitle(base, path.basename(path.dirname(fp)));
      out.push({ source: 'local', id: fp, path: fp, title, artist, album: path.basename(path.dirname(fp)), artwork: null, duration: 0 });
    }
  }
  return out;
}

function addLocalFolder(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('Déposez un dossier.');
  if (!settings.localFolders.includes(dir)) setSettings({ localFolders: [...settings.localFolders, dir] });
  return scanFolder(dir);
}

// ---------------------------------------------------------------- polices / démarrage
let fontsCache = null;
/** Polices installées sur l'ordinateur (pour personnaliser les paroles et le lecteur). */
function listFonts() {
  if (fontsCache) return fontsCache;
  fontsCache = new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }'],
    { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      const list = err ? [] : stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      resolve([...new Set(list)].sort((a, b) => a.localeCompare(b, 'fr')));
    });
  });
  return fontsCache;
}

function applyLoginItem() {
  if (!app.isPackaged) return; // en développement, on ne touche pas au démarrage de Windows
  app.setLoginItemSettings({ openAtLogin: !!settings.launchAtStartup, path: process.execPath, args: ['--hidden'] });
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  ipcMain.handle('state:get', () => snapshot());
  ipcMain.handle('edge:layout', () => edgeLayout());
  ipcMain.on('cmd', (_e, cmd) => command(cmd));
  ipcMain.handle('settings:set', (_e, patch) => {
    const { spotifyToken, ...safe } = patch || {};
    setSettings(safe);
    if (safe.keys) state.spotifyConnected = spotify.connected;
    return publicSettings();
  });

  ipcMain.handle('search', async (_e, { query, source }) => {
    const q = (query || '').trim();
    if (!q) return [];
    const yt = sources.parseYouTubeUrl(q);
    if (yt?.listId && !yt.videoId) return sources.youtubePlaylist(yt.listId, settings.keys.youtubeApiKey);
    if (yt?.videoId) {
      return [{ source: 'youtube', id: yt.videoId, videoId: yt.videoId, title: 'Vidéo YouTube', artist: '', artwork: `https://i.ytimg.com/vi/${yt.videoId}/hqdefault.jpg`, duration: 0 }];
    }
    if (sources.isSoundCloudUrl(q)) {
      return [{ source: 'soundcloud', id: q, url: q, title: 'Lien SoundCloud', artist: '', artwork: null, duration: 0 }];
    }
    switch (source) {
      case 'spotify':
        if (!spotify.connected) throw new Error('Connectez Spotify dans les réglages.');
        return spotify.search(q);
      case 'soundcloud': return sources.soundcloudSearch(q, settings.keys.soundcloudClientId);
      case 'local': {
        const all = settings.localFolders.flatMap((d) => scanFolder(d));
        const needle = q.toLowerCase();
        return all.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(needle)).slice(0, 100);
      }
      default: return sources.youtubeSearch(q, settings.keys.youtubeApiKey);
    }
  });

  ipcMain.handle('playlists', async (_e, source) => {
    if (source === 'spotify') {
      if (!spotify.connected) throw new Error('Connectez Spotify dans les réglages.');
      return spotify.playlists();
    }
    if (source === 'local') {
      return settings.localFolders.map((d) => ({ id: d, name: path.basename(d) || d, artwork: null, source: 'local' }));
    }
    return [];
  });

  ipcMain.handle('playlist:tracks', async (_e, { source, id, uri }) => {
    if (source === 'spotify') {
      const tracks = await spotify.playlistTracks(id);
      return uri ? tracks.map((t) => ({ ...t, contextUri: uri })) : tracks;
    }
    if (source === 'local') return scanFolder(id);
    if (source === 'youtube') return sources.youtubePlaylist(id, settings.keys.youtubeApiKey);
    return [];
  });

  ipcMain.handle('queue:get', async () => {
    if (state.source === 'spotify' && spotify.connected) {
      return { items: await spotify.queue().catch(() => []), index: -1, readonly: true };
    }
    return { items: state.queue, index: state.queueIndex, readonly: false };
  });

  ipcMain.handle('spotify:connect', async () => {
    await spotify.connect();
    state.spotifyConnected = true;
    broadcast();
    pollSpotify();
    return true;
  });
  ipcMain.handle('spotify:disconnect', () => {
    spotify.disconnect();
    state.spotifyConnected = false;
    broadcast();
  });

  ipcMain.handle('local:pickFolder', async () => {
    const r = await dialog.showOpenDialog(wins.player, { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { folder: r.filePaths[0], tracks: addLocalFolder(r.filePaths[0]) };
  });
  ipcMain.handle('local:addFolder', (_e, dir) => ({ folder: dir, tracks: addLocalFolder(dir) }));
  ipcMain.handle('local:removeFolder', (_e, dir) => {
    setSettings({ localFolders: settings.localFolders.filter((d) => d !== dir) });
  });

  ipcMain.handle('wallpaper:addVideo', async () => {
    const r = await dialog.showOpenDialog(wins.player, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Vidéos', extensions: ['mp4', 'webm', 'mov', 'mkv'] }],
    });
    if (r.canceled) return;
    const list = [...new Set([...settings.wallpaper.customVideos, ...r.filePaths])];
    setSettings({ wallpaper: { customVideos: list, activeCustom: r.filePaths[0], mode: 'custom' } });
  });
  ipcMain.handle('wallpaper:removeVideo', (_e, p) => {
    const list = settings.wallpaper.customVideos.filter((v) => v !== p);
    setSettings({ wallpaper: { customVideos: list, activeCustom: settings.wallpaper.activeCustom === p ? list[0] || null : settings.wallpaper.activeCustom } });
  });
  ipcMain.handle('wallpaper:videoUrl', (_e, p) => (p && settings.wallpaper.customVideos.includes(p) ? `${server.PAGE_ORIGIN}/local?f=${server.registerLocal(p)}` : null));

  // Déplacement du lecteur : on suit le curseur jusqu'au relâchement (≈ 120 fois/s).
  // (Pas de -webkit-app-region : sur cette fenêtre transparente, Windows avalait alors tous les clics.)
  let moveTimer = null;
  ipcMain.on('player:move', (_e, phase) => {
    const w = wins.player;
    clearInterval(moveTimer);
    moveTimer = null;
    if (phase !== 'start' || !w || w.isDestroyed()) return;
    const c0 = screen.getCursorScreenPoint();
    const b0 = w.getBounds();
    moveTimer = setInterval(() => {
      if (w.isDestroyed()) { clearInterval(moveTimer); return; }
      const c = screen.getCursorScreenPoint();
      w.setPosition(b0.x + c.x - c0.x, b0.y + c.y - c0.y);
    }, 8);
    // Sécurité : jamais plus de 60 s (si le relâchement n'est pas reçu).
    setTimeout(() => { clearInterval(moveTimer); moveTimer = null; }, 60000);
  });

  // Zones cliquables du lecteur (verre). Ailleurs, les clics passent au bureau.
  ipcMain.on('player:hitRects', (_e, rects) => {
    playerHitRects = Array.isArray(rects) ? rects.slice(0, 8) : [];
    if (HITTEST) console.log('[hit] rects', JSON.stringify(playerHitRects));
    updatePlayerHit();
  });
  ipcMain.on('glass:shapes', (_e, { shapes, animate }) => {
    glassShapes = Array.isArray(shapes) ? shapes.slice(0, 8) : [];
    sendGlass(!!animate);
  });
  ipcMain.handle('fonts:list', () => listFonts());

  ipcMain.on('player:hide', () => setSettings({ features: { player: false } }));
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.on('perf', (_e, d) => console.log('[perf]', JSON.stringify(d)));
  ipcMain.on('open:external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

  // --- moteur (fenêtre wallpaper)
  ipcMain.on('engine:status', (_e, s) => {
    if (state.source === 'spotify') return;
    const changed = s.isPlaying !== state.isPlaying;
    setPosition(s.position, s.isPlaying);
    if (s.duration) state.duration = s.duration;
    sendPos();
    if (changed) { broadcast(); if (tray) buildTrayMenu(); }
  });
  ipcMain.on('engine:meta', (_e, meta) => {
    if (state.track && state.source !== 'spotify') setTrack({ ...state.track, ...meta, source: state.track.source, id: state.track.id });
  });
  ipcMain.on('engine:ended', () => { if (state.source !== 'spotify') next(true); });
  ipcMain.on('engine:error', (_e, err) => {
    console.warn('[engine] error:', err?.code, err?.message);
    toast(err?.message || 'Ce morceau ne peut pas être lu ici.');
    if (state.source !== 'spotify' && state.queue.length > 1) setTimeout(() => next(true), 1200);
  });
  ipcMain.on('colors', (_e, colors) => {
    if (Array.isArray(colors) && colors.length) { state.colors = colors.slice(0, 4); broadcast(); }
  });
  // Niveau audio (calculé par la fenêtre "edge") relayé au fond d'écran (pulsation de la pochette).
  ipcMain.on('audio', (_e, a) => {
    if (wins.wallpaper && !wins.wallpaper.isDestroyed()) wins.wallpaper.webContents.send('audio', a);
  });
}

// ---------------------------------------------------------------- options de développement
function devHooks() {
  const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);

  // --play=<id vidéo YouTube> : lance un morceau au démarrage.
  const testId = arg('play');
  if (testId) {
    setTimeout(() => playItem({ source: 'youtube', id: testId, videoId: testId, title: 'Vidéo YouTube', artist: '', artwork: `https://i.ytimg.com/vi/${testId}/hqdefault.jpg`, duration: 0 }, []), 4000);
  }

  // --occlude : fenêtre plein écran 10 s par-dessus le fond (test des saccades).
  if (process.argv.includes('--occlude')) {
    setTimeout(() => {
      console.log('[perf] occlude start');
      const o = new BrowserWindow({ ...targetDisplay().bounds, frame: false, backgroundColor: '#202020', show: true });
      setTimeout(() => { o.destroy(); console.log('[perf] occlude end'); }, 10000);
    }, 15000);
  }

  // --demo=<dossier> : joue le premier morceau du dossier (sans l'ajouter aux dossiers de l'utilisateur).
  const demoDir = arg('demo');
  if (demoDir) {
    // Démo : rien n'est enregistré (les réglages de l'utilisateur restent intacts) et tout est affiché.
    settingsStore.save = () => {};
    settings.features = { edge: true, wallpaper: true, lyrics: true, player: true };
    broadcast();
    setTimeout(() => { const tracks = scanFolder(demoDir); if (tracks[0]) playItem(tracks[0], tracks); }, 4000);
  }

  // --snap=<dossier> : capture la scène (fond d'écran, lumière, lecteur) par les fenêtres de l'appli
  // elles-mêmes, sans capturer l'écran. Chaque calque est enregistré avec sa position (scene.json).
  const snapDir = arg('snap');
  if (snapDir) {
    const snap = async (name) => {
      if (!wins.player || !wins.wallpaper) return;
      const o = targetDisplay().bounds;
      const rel = (b) => ({ x: b.x - o.x, y: b.y - o.y, width: b.width, height: b.height });
      const layers = [];
      const save = async (id, win) => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(snapDir, `${name}-${id}.png`), img.toPNG());
        layers.push({ id, file: `${name}-${id}.png`, ...rel(win.getBounds()) });
      };
      await save('wallpaper', wins.wallpaper);
      for (const side of EDGE_SIDES) if (edgeWins[side]?.isVisible() && edgeWins[side].getBounds().width > 1) await save(`edge-${side}`, edgeWins[side]);
      await save('player', wins.player);
      fs.writeFileSync(path.join(snapDir, `${name}.json`), JSON.stringify({ width: o.width, height: o.height, layers }, null, 2));
      console.log('[snap]', name);
    };
    const tab = (v) => wins.player?.webContents.executeJavaScript(`document.querySelector('.tab[data-view=${v}]').click()`);
    setTimeout(() => snap('scene'), 13000);
    setTimeout(() => tab('settings'), 14000);
    setTimeout(() => snap('settings'), 15500);
    setTimeout(() => tab('queue'), 16500);
    setTimeout(() => snap('queue'), 18000);
    setTimeout(() => wins.player?.webContents.executeJavaScript("document.getElementById('panel-close').click()"), 19000);
  }

  // --hittest : position écran du bouton Réglages (pour un test de clic réel), puis état du panneau.
  if (HITTEST) {
    setTimeout(async () => {
      wins.player.setAlwaysOnTop(true); wins.player.show(); wins.player.moveTop();
      wins.player.webContents.executeJavaScript("['pointerdown','click'].forEach(t=>document.addEventListener(t,e=>console.log('EV',t,e.target.closest('button')?.id||e.target.tagName),true))");
      const r = JSON.parse(await wins.player.webContents.executeJavaScript("JSON.stringify(document.getElementById('t-settings').getBoundingClientRect())"));
      const b = wins.player.getBounds();
      const p = screen.dipToScreenPoint({ x: Math.round(b.x + r.x + r.width / 2), y: Math.round(b.y + r.y + r.height / 2) });
      console.log(`[hittest] target ${p.x} ${p.y}`);
    }, 8000);
    setTimeout(async () => {
      const open = await wins.player.webContents.executeJavaScript("document.body.classList.contains('expanded')");
      console.log(`[hittest] panel open = ${open} bounds ${JSON.stringify(wins.player.getBounds())}`);
    }, 16000);
  }

  // --panel=<search|playlists|queue|settings> : ouvre un onglet du lecteur.
  const panel = arg('panel');
  if (panel && wins.player) {
    wins.player.webContents.once('did-finish-load', () => setTimeout(() => wins.player.webContents.executeJavaScript(`document.querySelector('.tab[data-view="${panel.replace(/\W/g, '')}"]').click()`), 1500));
  }
}

// ---------------------------------------------------------------- démarrage
app.on('second-instance', () => { setSettings({ features: { player: true } }); wins.player?.show(); wins.player?.focus(); });

app.whenReady().then(async () => {
  // Les lecteurs intégrés (YouTube…) refusent parfois un navigateur qui s'annonce "Electron" :
  // on présente le User-Agent Chrome standard.
  app.userAgentFallback = app.userAgentFallback.replace(/\s?(Electron|muisik|mUIsik)\/\S+/gi, '');

  settings = settingsStore.load();
  state.source = settings.source;
  state.repeat = settings.repeat;
  state.volume = settings.volume;

  spotify = new Spotify(settings, () => settingsStore.save(settings));
  state.spotifyConnected = spotify.connected;

  try {
    await server.start({ onSpotifyCallback: (p) => spotify.handleCallback(p) });
  } catch (e) {
    dialog.showErrorBox('mUIsik', `Le port ${server.PORT} est déjà utilisé. mUIsik est peut-être déjà ouvert.\n\n${e.message}`);
    return app.quit();
  }

  // Capture du son de l'ordinateur (loopback) pour faire bouger la lumière au rythme de la musique.
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((srcs) => callback({ video: srcs[0], audio: 'loopback' }))
      .catch(() => callback({}));
  });
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'display-capture', 'fullscreen'].includes(perm)));

  registerIpc();
  createWallpaper();
  createEdge();
  createPlayer();
  createTray();
  applyLoginItem();
  pollSpotify();
  devHooks();

  screen.on('display-metrics-changed', repositionAll);
  screen.on('display-added', () => broadcast());
  screen.on('display-removed', repositionAll);
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('render-process-gone', (_e, wc, d) => console.error('[crash]', wc.getURL(), d.reason, d.exitCode));

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  if (state.source === 'spotify' && state.isPlaying && spotify?.connected) spotify.pause().catch(() => {});
  if (wallpaperAttached) {
    // On rend le bureau propre (sinon la dernière image du fond animé reste affichée).
    e.preventDefault();
    wins.wallpaper?.destroy();
    runDesktopHelper(['restore']).finally(() => app.quit());
  }
});
