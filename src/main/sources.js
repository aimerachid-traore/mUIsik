// Recherche YouTube et SoundCloud.
// YouTube : API Data v3 (clé gratuite sur console.cloud.google.com).
// SoundCloud : API avec votre client_id (soundcloud.com/you/apps).
// Sans clé, on peut toujours coller un lien YouTube / SoundCloud : la lecture passe par les lecteurs officiels.

// ---------- utilitaires titre ----------
const NOISE = /\s*[([](official\s*(music\s*)?(video|audio|visualizer|lyric(s)?\s*video)|lyrics?|clip\s*officiel|audio(\s*officiel)?|hd|4k|visuali[sz]er|paroles?|music\s*video|mv)[)\]]/gi;

function cleanTitle(t) {
  return (t || '').replace(NOISE, '').replace(/\s*\|.*$/, '').replace(/\s+/g, ' ').trim();
}

function splitArtistTitle(rawTitle, channel) {
  const t = cleanTitle(rawTitle);
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  const artist = (channel || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  return { artist, title: t };
}

function iso8601(d) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || '');
  return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0;
}

function ytItem(videoId, rawTitle, channel, duration) {
  const { artist, title } = splitArtistTitle(rawTitle, channel);
  return {
    source: 'youtube', id: videoId, videoId, title, artist, album: '',
    artwork: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, duration: duration || 0,
  };
}

// ---------- YouTube ----------
async function youtubeSearch(q, apiKey, { limit = 20 } = {}) {
  if (!apiKey) throw new Error('Ajoutez une clé API YouTube (Réglages) pour chercher, ou collez un lien YouTube.');
  return youtubeApiSearch(q, apiKey, limit);
}

async function youtubeApiSearch(q, key, limit) {
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  u.search = new URLSearchParams({ part: 'snippet', type: 'video', videoCategoryId: '10', maxResults: String(limit), q, key }).toString();
  const r = await fetch(u);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'YouTube API');
  const ids = j.items.map((i) => i.id.videoId).join(',');
  const durations = {};
  if (ids) {
    const d = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${key}`)).json();
    for (const v of d.items || []) durations[v.id] = iso8601(v.contentDetails.duration);
  }
  return j.items.map((i) => ytItem(i.id.videoId, decodeEntities(i.snippet.title), i.snippet.channelTitle, durations[i.id.videoId]));
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function youtubePlaylist(listId, apiKey) {
  if (!apiKey) throw new Error('Une clé API YouTube est nécessaire pour ouvrir une playlist.');
  const items = [];
  let pageToken = '';
  do {
    const u = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${listId}&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const j = await (await fetch(u)).json();
    if (j.error) throw new Error(j.error.message);
    for (const it of j.items || []) {
      const s = it.snippet;
      if (s.resourceId?.videoId && s.title !== 'Private video' && s.title !== 'Deleted video') {
        items.push(ytItem(s.resourceId.videoId, s.title, s.videoOwnerChannelTitle));
      }
    }
    pageToken = j.nextPageToken;
  } while (pageToken && items.length < 300);
  return items;
}

/** Cherche le clip d'un morceau joué ailleurs (Spotify, SoundCloud…) pour le mettre en fond d'écran. */
async function findMusicVideo(artist, title, apiKey) {
  if (!title) return null;
  if (!apiKey) return null;
  try {
    const res = await youtubeSearch(`${artist} ${cleanTitle(title)} official video`, apiKey, { limit: 5 });
    return res[0]?.videoId || null;
  } catch { return null; }
}

function parseYouTubeUrl(s) {
  try {
    const u = new URL(s.trim());
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return null;
    const list = u.searchParams.get('list');
    let v = u.searchParams.get('v');
    if (u.hostname.endsWith('youtu.be')) v = u.pathname.slice(1);
    if (!v && u.pathname.startsWith('/shorts/')) v = u.pathname.split('/')[2];
    return { videoId: v || null, listId: list || null };
  } catch { return null; }
}

// ---------- SoundCloud ----------
function scItem(t) {
  const art = (t.artwork_url || t.user?.avatar_url || '').replace('-large', '-t500x500');
  return {
    source: 'soundcloud', id: String(t.id), url: t.permalink_url, title: t.title,
    artist: t.publisher_metadata?.artist || t.user?.username || '', album: t.publisher_metadata?.album_title || '',
    artwork: art || null, duration: (t.full_duration || t.duration || 0) / 1000,
  };
}

async function soundcloudSearch(q, cid) {
  if (!cid) throw new Error('Ajoutez un client_id SoundCloud (Réglages) pour chercher, ou collez un lien SoundCloud.');
  const r = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&limit=25&client_id=${cid}`);
  if (r.status === 401 || r.status === 403) throw new Error('client_id SoundCloud refusé.');
  const j = await r.json();
  return (j.collection || []).filter((t) => t.kind === 'track').map(scItem);
}

function isSoundCloudUrl(s) {
  return /^https?:\/\/(www\.|m\.|on\.)?soundcloud\.com\//i.test(s.trim()) || /^https?:\/\/snd\.sc\//i.test(s.trim());
}

module.exports = {
  youtubeSearch, youtubePlaylist, findMusicVideo, parseYouTubeUrl,
  soundcloudSearch, isSoundCloudUrl, cleanTitle, splitArtistTitle,
};
