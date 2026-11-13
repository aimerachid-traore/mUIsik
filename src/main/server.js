// Petit serveur HTTP local (127.0.0.1 uniquement).
// - sert l'interface (YouTube refuse les embeds depuis file://)
// - reçoit le callback OAuth de Spotify
// - proxy d'images (pour lire les couleurs des pochettes sans souci de CORS)
// - sert les fichiers audio locaux enregistrés (avec Range pour le seek)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 43821;
const ORIGIN = `http://127.0.0.1:${PORT}`;
// Les pages sont servies via "localhost" : YouTube refuse les embeds dont le referrer est une IP.
const PAGE_ORIGIN = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..', 'renderer');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
};

const localFiles = new Map(); // id -> chemin absolu (seuls ces fichiers sont servis)
let nextId = 1;
function registerLocal(p) {
  for (const [id, fp] of localFiles) if (fp === p) return id;
  const id = String(nextId++);
  localFiles.set(id, p);
  return id;
}

function serveFile(req, res, fp) {
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
    const type = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? parseInt(range[1], 10) : 0;
      const end = range[2] ? Math.min(parseInt(range[2], 10), st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1,
      });
      fs.createReadStream(fp, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(fp).pipe(res);
    }
  });
}

function start({ onSpotifyCallback }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, ORIGIN);

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<body style="background:#0b0b10;color:#eee;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0">
        <div>${error ? 'Connexion Spotify annulée.' : 'Spotify est connecté à mUIsik. Vous pouvez fermer cet onglet.'}</div></body>`);
      onSpotifyCallback({ code, error, state: url.searchParams.get('state') });
      return;
    }

    if (url.pathname === '/proxy') {
      const target = url.searchParams.get('url') || '';
      if (!/^https:\/\//i.test(target)) { res.writeHead(400); return res.end(); }
      try {
        const r = await fetch(target);
        const type = r.headers.get('content-type') || '';
        if (!r.ok || !type.startsWith('image/')) { res.writeHead(502); return res.end(); }
        const buf = Buffer.from(await r.arrayBuffer());
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'max-age=86400' });
        return res.end(buf);
      } catch {
        res.writeHead(502); return res.end();
      }
    }

    if (url.pathname === '/local') {
      const fp = localFiles.get(url.searchParams.get('f') || '');
      if (!fp) { res.writeHead(404); return res.end(); }
      return serveFile(req, res, fp);
    }

    if (url.pathname.startsWith('/app/')) {
      const rel = decodeURIComponent(url.pathname.slice(5));
      const fp = path.normalize(path.join(ROOT, rel));
      if (!fp.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
      return serveFile(req, res, fp);
    }

    res.writeHead(404); res.end();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { start, registerLocal, PORT, ORIGIN, PAGE_ORIGIN };
