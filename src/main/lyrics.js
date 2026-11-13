// Paroles synchronisées via LRCLIB (gratuit, sans clé) : https://lrclib.net
const { cleanTitle } = require('./sources');

const HEADERS = { 'User-Agent': 'mUIsik/0.1 (desktop music player)' };
const cache = new Map();

function parseLrc(lrc) {
  const lines = [];
  for (const raw of (lrc || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    // (on retire aussi les horodatages mot à mot <mm:ss.xx> du format LRC "enhanced")
    const text = raw.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').replace(/\s+/g, ' ').trim();
    for (const s of stamps) lines.push({ t: +s[1] * 60 + parseFloat(s[2]), text });
  }
  return lines.sort((a, b) => a.t - b.t);
}

function primaryArtist(a) {
  return (a || '').split(/,|&| feat\.?| ft\.?| x /i)[0].trim();
}

async function fetchLyrics({ artist, title, album, duration }) {
  const t = cleanTitle(title).replace(/\s*[([](feat|ft)\.?[^)\]]*[)\]]/i, '').trim();
  const a = primaryArtist(artist);
  if (!t) return null;
  const key = `${a}|${t}`.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  let hit = null;
  try {
    const p = new URLSearchParams({ artist_name: a, track_name: t });
    if (album) p.set('album_name', album);
    if (duration) p.set('duration', String(Math.round(duration)));
    const r = await fetch(`https://lrclib.net/api/get?${p}`, { headers: HEADERS });
    if (r.ok) hit = await r.json();
  } catch { /* on tente la recherche */ }

  if (!hit || (!hit.syncedLyrics && !hit.plainLyrics)) {
    try {
      const r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${a} ${t}`)}`, { headers: HEADERS });
      const list = r.ok ? await r.json() : [];
      // On préfère une version synchronisée dont la durée colle au morceau.
      list.sort((x, y) => score(y, duration) - score(x, duration));
      hit = list[0] || null;
    } catch { hit = null; }
  }

  const result = hit ? {
    synced: parseLrc(hit.syncedLyrics),
    plain: hit.plainLyrics || '',
    instrumental: !!hit.instrumental,
  } : null;
  cache.set(key, result);
  return result;
}

function score(h, duration) {
  let s = h.syncedLyrics ? 10 : h.plainLyrics ? 2 : 0;
  if (duration && h.duration) s -= Math.min(8, Math.abs(h.duration - duration) / 2);
  return s;
}

module.exports = { fetchLyrics, parseLrc };
