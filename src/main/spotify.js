// Spotify : OAuth PKCE (pas de secret) + Web API pour piloter l'appli Spotify (Spotify Connect).
// La lecture se fait dans l'appli Spotify officielle ; mUIsik lit l'état et envoie les commandes.
const crypto = require('crypto');
const { shell, safeStorage } = require('electron');
const { ORIGIN } = require('./server');

const REDIRECT = `${ORIGIN}/callback`;
const SCOPES = [
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
  'playlist-read-private', 'playlist-read-collaborative', 'user-library-read', 'user-library-modify',
].join(' ');
const API = 'https://api.spotify.com/v1';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Spotify {
  constructor(settings, persist) {
    this.settings = settings;
    this.persist = persist;
    this.token = this.#readToken();
    this.pending = null; // { verifier, state, resolve, reject }
  }

  get clientId() { return (this.settings.keys.spotifyClientId || '').trim(); }
  get connected() { return !!(this.token && this.token.refresh_token); }

  #readToken() {
    const raw = this.settings.spotifyToken;
    if (!raw) return null;
    try {
      const json = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(raw, 'base64'))
        : Buffer.from(raw, 'base64').toString('utf8');
      return JSON.parse(json);
    } catch { return null; }
  }

  #writeToken(tok) {
    this.token = tok;
    if (!tok) { this.settings.spotifyToken = null; return this.persist(); }
    const json = JSON.stringify(tok);
    this.settings.spotifyToken = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json).toString('base64')
      : Buffer.from(json, 'utf8').toString('base64');
    this.persist();
  }

  connect() {
    if (!this.clientId) return Promise.reject(new Error('Ajoutez votre Client ID Spotify dans les réglages.'));
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(12));
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({
      client_id: this.clientId, response_type: 'code', redirect_uri: REDIRECT,
      code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state,
    }).toString();
    shell.openExternal(url.toString());
    return new Promise((resolve, reject) => {
      this.pending = { verifier, state, resolve, reject };
      setTimeout(() => { if (this.pending?.state === state) { this.pending = null; reject(new Error('Délai de connexion dépassé.')); } }, 5 * 60 * 1000);
    });
  }

  async handleCallback({ code, error, state }) {
    const p = this.pending;
    if (!p || p.state !== state) return;
    this.pending = null;
    if (error || !code) return p.reject(new Error(error || 'Connexion refusée'));
    try {
      const tok = await this.#tokenRequest({
        grant_type: 'authorization_code', code, redirect_uri: REDIRECT,
        client_id: this.clientId, code_verifier: p.verifier,
      });
      this.#writeToken(tok);
      p.resolve();
    } catch (e) { p.reject(e); }
  }

  disconnect() { this.#writeToken(null); }

  async #tokenRequest(params) {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.error || 'Erreur token Spotify');
    return { ...j, refresh_token: j.refresh_token || this.token?.refresh_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 };
  }

  async #accessToken() {
    if (!this.connected) throw new Error('Spotify non connecté');
    if (Date.now() >= (this.token.expires_at || 0)) {
      try {
        this.#writeToken(await this.#tokenRequest({ grant_type: 'refresh_token', refresh_token: this.token.refresh_token, client_id: this.clientId }));
      } catch (e) {
        this.#writeToken(null);
        throw e;
      }
    }
    return this.token.access_token;
  }

  async api(method, p, body, retry = true) {
    const r = await fetch(p.startsWith('http') ? p : API + p, {
      method,
      headers: { Authorization: `Bearer ${await this.#accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && retry) { this.token.expires_at = 0; return this.api(method, p, body, false); }
    if (r.status === 204 || r.status === 202) return null;
    const text = await r.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch { /* réponses vides / texte */ }
    if (!r.ok) {
      const err = new Error(j?.error?.message || `Spotify ${r.status}`);
      err.status = r.status; err.reason = j?.error?.reason;
      throw err;
    }
    return j;
  }

  // ---------- lecture ----------
  async state() {
    const s = await this.api('GET', '/me/player?additional_types=track,episode');
    if (!s || !s.item) return s ? { isPlaying: false, device: s.device } : null;
    return {
      isPlaying: s.is_playing,
      position: (s.progress_ms || 0) / 1000,
      repeat: s.repeat_state,
      device: s.device,
      track: mapTrack(s.item),
    };
  }

  async ensureDevice() {
    let { devices } = await this.api('GET', '/me/player/devices');
    if (!devices.length) {
      // Aucun appareil : on lance l'appli Spotify en arrière-plan et on attend qu'elle se déclare.
      shell.openExternal('spotify:');
      for (let i = 0; i < 10 && !devices.length; i++) {
        await sleep(1000);
        ({ devices } = await this.api('GET', '/me/player/devices'));
      }
      if (!devices.length) throw new Error("Ouvrez l'appli Spotify (ou le lecteur web) puis réessayez.");
    }
    const active = devices.find((d) => d.is_active);
    if (active) return active.id;
    const computer = devices.find((d) => d.type === 'Computer') || devices[0];
    return computer.id;
  }

  async play({ uris, contextUri, offsetUri, offsetIndex } = {}) {
    const deviceId = await this.ensureDevice();
    const body = {};
    if (contextUri) {
      body.context_uri = contextUri;
      if (offsetUri) body.offset = { uri: offsetUri };
      else if (Number.isInteger(offsetIndex)) body.offset = { position: offsetIndex };
    } else if (uris) body.uris = uris;
    await this.api('PUT', `/me/player/play?device_id=${deviceId}`, Object.keys(body).length ? body : undefined);
  }
  pause() { return this.api('PUT', '/me/player/pause'); }
  next() { return this.api('POST', '/me/player/next'); }
  prev() { return this.api('POST', '/me/player/previous'); }
  seek(sec) { return this.api('PUT', `/me/player/seek?position_ms=${Math.round(sec * 1000)}`); }
  volume(v) { return this.api('PUT', `/me/player/volume?volume_percent=${Math.round(v)}`); }
  repeat(mode) { return this.api('PUT', `/me/player/repeat?state=${mode === 'one' ? 'track' : mode === 'all' ? 'context' : 'off'}`); }
  addToQueue(uri) { return this.api('POST', `/me/player/queue?uri=${encodeURIComponent(uri)}`); }

  async queue() {
    const q = await this.api('GET', '/me/player/queue');
    return (q?.queue || []).filter((t) => t && t.type === 'track').map(mapTrack);
  }

  // ---------- catalogue ----------
  async search(q) {
    const j = await this.api('GET', `/search?type=track&limit=25&q=${encodeURIComponent(q)}`);
    return (j?.tracks?.items || []).map(mapTrack);
  }

  async playlists() {
    const j = await this.api('GET', '/me/playlists?limit=50');
    const lists = (j?.items || []).filter(Boolean).map((p) => ({
      id: p.id, uri: p.uri, name: p.name, artwork: p.images?.[0]?.url || null,
      count: p.tracks?.total ?? p.items?.total ?? null, source: 'spotify',
    }));
    return [{ id: 'liked', uri: null, name: 'Titres likés', artwork: null, source: 'spotify' }, ...lists];
  }

  async playlistTracks(id) {
    if (id === 'liked') {
      const j = await this.api('GET', '/me/tracks?limit=50');
      return (j?.items || []).map((i) => mapTrack(i.track));
    }
    let j;
    try { j = await this.api('GET', `/playlists/${id}/items?limit=100`); }
    catch { j = await this.api('GET', `/playlists/${id}/tracks?limit=100`); }
    return (j?.items || []).map((i) => i.track || i.item).filter((t) => t && t.type === 'track').map(mapTrack);
  }

  async isLiked(id) {
    const j = await this.api('GET', `/me/tracks/contains?ids=${id}`);
    return !!j?.[0];
  }
  like(id, on) { return this.api(on ? 'PUT' : 'DELETE', `/me/tracks?ids=${id}`); }
}

function mapTrack(t) {
  return {
    source: 'spotify',
    id: t.id,
    uri: t.uri,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', ') || t.show?.name || '',
    album: t.album?.name || '',
    artwork: t.album?.images?.[0]?.url || t.images?.[0]?.url || null,
    duration: (t.duration_ms || 0) / 1000,
  };
}

module.exports = { Spotify, REDIRECT };
