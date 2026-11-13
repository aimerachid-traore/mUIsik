// Fenêtre fond d'écran : visuels (pochette, clip, vidéo perso, paroles, verre du lecteur)
// + moteur audio (YouTube, SoundCloud, fichiers locaux).
import { api, store, connect, now, proxied, extractColors } from './shared.js';
import { LyricsView } from './lyrics.js';
import { setGlass } from './glass.js';

const $ = (id) => document.getElementById(id);
const body = document.body;
const lyricsView = new LyricsView($('lyrics'));

// ============================================================ moteur
let active = null;      // 'youtube' | 'soundcloud' | 'local' | null (source qui joue le son)
let volume = 80;

// ---------- YouTube (IFrame API) ----------
let yt = null;
let ytReady = false;
let ytMode = null;      // 'main' (son) | 'bg' (clip muet en fond) | null
let ytPending = null;
let bgVideoId = null;

window.onYouTubeIframeAPIReady = () => {
  yt = new YT.Player('yt', {
    width: '100%', height: '100%', host: 'https://www.youtube-nocookie.com',
    playerVars: {
      autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0,
      playsinline: 1, modestbranding: 1, origin: location.origin,
    },
    events: {
      onReady: () => { ytReady = true; if (ytPending) { const p = ytPending; ytPending = null; p(); } },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED) {
          if (ytMode === 'main') api.send('engine:ended');
          else if (ytMode === 'bg') yt.seekTo(0, true);
        }
        if (ytMode === 'main') { reportStatus(); sendYtMeta(); }
      },
      onError: (e) => {
        if (ytMode !== 'main') { stopBg(); return; }
        const msg = { 2: 'Lien YouTube invalide.', 5: 'Lecture YouTube impossible.', 100: 'Vidéo introuvable ou privée.', 101: "L'artiste n'autorise pas cette vidéo hors de YouTube.", 150: "L'artiste n'autorise pas cette vidéo hors de YouTube." }[e.data];
        api.send('engine:error', { message: msg || `Erreur YouTube (${e.data}).`, code: e.data });
      },
    },
  });
};
const ytScript = document.createElement('script');
ytScript.src = 'https://www.youtube.com/iframe_api';
document.head.append(ytScript);

function whenYt(fn) { if (ytReady) fn(); else ytPending = fn; }

let lastYtMetaId = null;
function sendYtMeta() {
  const d = yt?.getVideoData?.();
  if (!d?.video_id || d.video_id === lastYtMetaId || !d.title) return;
  lastYtMetaId = d.video_id;
  const t = store.state?.track;
  // Lien collé : on ne connaissait ni le titre ni l'artiste.
  if (t && (t.title === 'Vidéo YouTube' || !t.artist)) {
    const m = d.title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    api.send('engine:meta', m ? { artist: m[1], title: m[2].replace(/\s*[([].*?[)\]]/g, '').trim() } : { title: d.title, artist: (d.author || '').replace(/\s*-\s*Topic$/, '') });
  }
}

function stopBg() {
  if (ytMode === 'bg' && ytReady) yt.stopVideo();
  if (ytMode === 'bg') ytMode = null;
  bgVideoId = null;
  updateVisuals();
}

// ---------- SoundCloud (Widget API, chargée seulement à la première utilisation) ----------
let sc = null;
const scState = { playing: false, pos: 0, dur: 0 };
let scScript = null;
function loadScApi() {
  if (window.SC) return Promise.resolve();
  if (!scScript) {
    scScript = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://w.soundcloud.com/player/api.js';
      el.onload = resolve;
      el.onerror = reject;
      document.head.append(el);
    });
  }
  return scScript;
}
async function scLoad(url) {
  try { await loadScApi(); } catch { api.send('engine:error', { message: 'SoundCloud est injoignable.' }); return; }
  const iframe = $('sc');
  const done = () => {
    sc.setVolume(volume);
    sc.getCurrentSound((s) => {
      if (!s) return;
      scState.dur = (s.full_duration || s.duration || 0) / 1000;
      api.send('engine:meta', {
        title: s.title, artist: s.publisher_metadata?.artist || s.user?.username || '',
        artwork: (s.artwork_url || s.user?.avatar_url || '').replace('-large', '-t500x500') || null,
        duration: scState.dur,
      });
    });
    sc.play();
  };
  if (!sc) {
    iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true&visual=false`;
    sc = SC.Widget(iframe);
    const E = SC.Widget.Events;
    sc.bind(E.READY, done);
    sc.bind(E.PLAY, () => { scState.playing = true; reportStatus(); });
    sc.bind(E.PAUSE, () => { scState.playing = false; reportStatus(); });
    sc.bind(E.PLAY_PROGRESS, (e) => { scState.pos = e.currentPosition / 1000; });
    sc.bind(E.FINISH, () => { if (active === 'soundcloud') { scState.playing = false; api.send('engine:ended'); } });
    sc.bind(E.ERROR, () => api.send('engine:error', { message: 'Ce son SoundCloud ne peut pas être lu.' }));
  } else {
    sc.load(url, { auto_play: true, visual: false, callback: done });
  }
}

// ---------- fichiers locaux ----------
const audio = $('local');
audio.addEventListener('ended', () => { if (active === 'local') api.send('engine:ended'); });
audio.addEventListener('error', () => { if (active === 'local' && audio.src) api.send('engine:error', { message: 'Fichier illisible.' }); });
audio.addEventListener('loadedmetadata', () => reportStatus());
audio.addEventListener('play', () => reportStatus());
audio.addEventListener('pause', () => reportStatus());

// ---------- commandes ----------
function stopAll() {
  if (ytReady && ytMode === 'main') { yt.stopVideo(); ytMode = null; }
  if (sc) sc.pause();
  scState.playing = false;
  audio.pause();
  active = null;
}

api.on('engine:cmd', (cmd) => {
  switch (cmd.type) {
    case 'load': {
      stopAll();
      if (cmd.volume != null) volume = cmd.volume;
      const it = cmd.item;
      active = it.source;
      if (it.source === 'youtube') {
        whenYt(() => {
          ytMode = 'main'; bgVideoId = null; lastYtMetaId = null;
          yt.unMute(); yt.setVolume(volume);
          yt.loadVideoById({ videoId: it.videoId, startSeconds: 0 });
          updateVisuals();
        });
      } else if (it.source === 'soundcloud') {
        scState.pos = 0; scState.dur = it.duration || 0;
        scLoad(it.url);
      } else if (it.source === 'local') {
        audio.src = it.src;
        audio.volume = volume / 100;
        audio.play().catch((e) => api.send('engine:error', { message: e.message }));
      }
      updateVisuals();
      break;
    }
    case 'play':
      if (active === 'youtube' && ytReady) yt.playVideo();
      else if (active === 'soundcloud') sc?.play();
      else if (active === 'local') audio.play().catch(() => {});
      break;
    case 'pause':
      if (active === 'youtube' && ytReady) yt.pauseVideo();
      else if (active === 'soundcloud') sc?.pause();
      else if (active === 'local') audio.pause();
      break;
    case 'seek':
      if (active === 'youtube' && ytReady) yt.seekTo(cmd.position, true);
      else if (active === 'soundcloud') { sc?.seekTo(cmd.position * 1000); scState.pos = cmd.position; }
      else if (active === 'local') audio.currentTime = cmd.position;
      break;
    case 'volume':
      volume = cmd.value;
      if (ytReady && ytMode === 'main') yt.setVolume(volume);
      sc?.setVolume(volume);
      audio.volume = volume / 100;
      break;
    case 'stop':
      stopAll();
      updateVisuals();
      break;
    default:
  }
});

function status() {
  if (active === 'youtube' && ytReady && ytMode === 'main') {
    const st = yt.getPlayerState();
    return { isPlaying: st === 1 || st === 3, position: yt.getCurrentTime() || 0, duration: yt.getDuration() || 0 };
  }
  if (active === 'soundcloud') return { isPlaying: scState.playing, position: scState.pos, duration: scState.dur };
  if (active === 'local') return { isPlaying: !audio.paused, position: audio.currentTime || 0, duration: Number.isFinite(audio.duration) ? audio.duration : 0 };
  return null;
}
function reportStatus() {
  const s = status();
  if (s) api.send('engine:status', s);
}
setInterval(reportStatus, 500);

// ============================================================ visuels
let lastArtwork = null;
let customPath = null;
let lyricsKey = '';

async function updateCustomVideo(s) {
  const v = $('custom');
  const want = s.settings.wallpaper.mode === 'custom' ? s.settings.wallpaper.activeCustom : null;
  if (want === customPath) return;
  customPath = want;
  if (!want) { v.pause(); v.removeAttribute('src'); v.load(); return; }
  v.src = await api.invoke('wallpaper:videoUrl', want);
  v.play().catch(() => {});
}

function syncBackgroundVideo(s) {
  // Clip muet en fond quand le son vient d'ailleurs (Spotify, SoundCloud, local).
  const want = s.source !== 'youtube' && s.settings.wallpaper.mode === 'auto' ? s.bgVideoId : null;
  if (want === bgVideoId) return;
  if (!want) { stopBg(); return; }
  bgVideoId = want;
  whenYt(() => {
    if (ytMode === 'main') return;
    ytMode = 'bg';
    yt.mute();
    yt.loadVideoById({ videoId: want, startSeconds: Math.max(0, now()) });
    updateVisuals();
  });
}

// Garde le clip de fond calé sur la musique.
let lastBgSeek = 0;
setInterval(() => {
  if (ytMode !== 'bg' || !ytReady) return;
  const playing = store.pos.isPlaying;
  const st = yt.getPlayerState();
  if (playing && st !== 1 && st !== 3) yt.playVideo();
  if (!playing && st === 1) yt.pauseVideo();
  const drift = Math.abs(yt.getCurrentTime() - now());
  const dur = yt.getDuration() || 0;
  // Un clip muet n'a pas besoin d'être calé à la milliseconde, et chaque saut fait recharger la vidéo :
  // on ne recale que si l'écart devient visible, et jamais plus d'une fois toutes les 20 s.
  if (playing && drift > 4 && now() < dur - 4 && performance.now() - lastBgSeek > 20000) {
    lastBgSeek = performance.now();
    yt.seekTo(now(), true);
  }
}, 2000);

function updateVisuals() {
  const s = store.state;
  if (!s) return;
  const mode = s.settings.wallpaper.mode;
  const ytVisible = ytMode && ((ytMode === 'main' && mode === 'auto') || ytMode === 'bg');
  const custom = mode === 'custom' && !!s.settings.wallpaper.activeCustom;
  body.classList.toggle('show-custom', custom);
  body.classList.toggle('show-video', !custom && !!ytVisible);
  body.classList.toggle('show-art', !custom && !ytVisible && !!s.track?.artwork);
  body.classList.toggle('lyrics-on', !!s.settings.features.lyrics && !!s.lyrics?.synced?.length);
  document.documentElement.style.setProperty('--dim', s.settings.wallpaper.dim);
}

async function onState(s) {
  const art = s.track?.artwork || null;
  if (art !== lastArtwork) {
    lastArtwork = art;
    if (art) {
      $('art').style.backgroundImage = `url("${proxied(art)}")`;
      $('cover').src = proxied(art);
      extractColors(art).then((c) => { if (c && lastArtwork === art) api.send('colors', c); }).catch(() => {});
    }
  }
  const lk = `${s.track?.source}|${s.track?.id}|${s.lyrics?.synced?.length || 0}|${s.lyrics?.synced?.[0]?.text || ''}`;
  if (lk !== lyricsKey) { lyricsKey = lk; lyricsView.setLyrics(s.lyrics); }
  lyricsView.setStyle(s.settings.lyrics.style, s.settings.lyrics.size);
  applyLyricsFont(s.settings.lyrics);
  syncBackgroundVideo(s);
  updateCustomVideo(s);
  updateVisuals();
}

function applyLyricsFont(l) {
  const el = $('lyrics');
  el.style.setProperty('--lyr-font', l.font ? `"${l.font.replace(/"/g, '')}"` : '');
  el.style.setProperty('--lyr-weight', l.weight || 800);
  el.style.setProperty('--lyr-italic', l.italic ? 'italic' : 'normal');
  el.style.setProperty('--lyr-case', { upper: 'uppercase', lower: 'lowercase' }[l.case] || 'none');
  el.style.setProperty('--lyr-spacing', `${(l.spacing || 0) / 100}em`);
  el.classList.toggle('custom-font', !!l.font);
  el.dataset.align = l.align || 'auto';
}

// Verre du lecteur (flou + réfraction de ce qui est derrière).
api.on('glass', setGlass);

// Pulsation de la pochette au rythme des basses : on ne touche qu'à cet élément (pas à toute la page).
let bass = 0;
api.on('audio', (a) => { bass = a.bass; });
const coverWrap = $('cover-wrap');

// Boucle limitée à 60 images/s (l'écran peut être à 144 Hz) ; elle ne fait rien d'inutile.
let lastFrame = 0;
let lastBass = -1;
function frame(t) {
  requestAnimationFrame(frame);
  if (t - lastFrame < 1000 / 60 - 2) return;
  lastFrame = t;
  if (body.classList.contains('lyrics-on')) lyricsView.frame(now() + 0.15);
  if (body.classList.contains('show-art')) {
    const b = Math.round(bass * 100) / 100;
    if (b !== lastBass) { lastBass = b; coverWrap.style.setProperty('--bass', b); }
  }
}

connect(onState).then(() => requestAnimationFrame(frame));

// ---------- mesures (lancer avec --perf) ----------
if (new URLSearchParams(location.search).has('perf')) {
  let frames = 0, long = 0, last = performance.now(), buffering = 0;
  const loop = (t) => { frames++; if (t - last > 50) long++; last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => api.send('perf', { win: 'wallpaper', visibility: document.visibilityState }));
  const waitYt = setInterval(() => {
    if (!ytReady) return;
    clearInterval(waitYt);
    yt.addEventListener('onStateChange', (e) => { if (e.data === 3) buffering++; });
  }, 500);
  setInterval(() => {
    api.send('perf', { win: 'wallpaper', fps: frames / 5, longFrames: long, ytBuffering: buffering, visibility: document.visibilityState, quality: ytReady ? yt.getPlaybackQuality?.() : null, ytState: ytReady ? yt.getPlayerState() : null });
    frames = 0; long = 0; buffering = 0;
  }, 5000);
}
