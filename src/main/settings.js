// Réglages persistants (userData/settings.json), fusionnés avec les valeurs par défaut.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  displayId: null,
  features: { edge: true, wallpaper: true, lyrics: true, player: true },
  edge: {
    style: 'glow',        // glow | pulse | comet | spectrum
    placement: 'all',     // all | bottom | top | corners
    thickness: 28,
    intensity: 0.9,
    fps: 30,              // 30 (économe) | 60 (fluide)
  },
  lyrics: {
    style: 'fade',        // fade | karaoke | neon | typewriter
    size: 56,
    font: '',             // '' = police propre au style
    weight: 800,
    italic: false,
    case: 'none',         // none | upper | lower
    spacing: 0,           // espacement des lettres (em/100)
    align: 'auto',        // auto | left | center
  },
  ui: { font: '', glass: 0.5 },          // police du lecteur, opacité du verre (0 = très transparent)
  wallpaper: {
    mode: 'auto',         // auto (clip si dispo sinon pochette) | artwork | custom
    dim: 0.25,
    customVideos: [],     // chemins de vidéos locales
    activeCustom: null,
  },
  keys: { spotifyClientId: '', youtubeApiKey: '', soundcloudClientId: '', geniusToken: '' },
  spotifyToken: null,     // chiffré via safeStorage
  volume: 80,
  source: 'youtube',      // youtube | soundcloud | spotify | local
  repeat: 'off',          // off | all | one
  localFolders: [],
  launchAtStartup: false,
  playerPos: null,
};

function deepMerge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) {
    return extra === undefined ? base : extra;
  }
  const out = { ...base };
  for (const k of Object.keys(extra || {})) {
    out[k] = k in base ? deepMerge(base[k], extra[k]) : extra[k];
  }
  return out;
}

const file = () => path.join(app.getPath('userData'), 'settings.json');

function load() {
  try {
    return deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(file(), 'utf8')));
  } catch {
    // Fichier absent ou corrompu (édité à la main) : on repart des valeurs par défaut.
    return structuredClone(DEFAULTS);
  }
}

let timer = null;
function save(settings) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(file()), { recursive: true });
      fs.writeFileSync(file(), JSON.stringify(settings, null, 2));
    } catch (e) {
      console.error('[settings] save failed', e);
    }
  }, 300);
}

module.exports = { load, save, deepMerge, DEFAULTS };
