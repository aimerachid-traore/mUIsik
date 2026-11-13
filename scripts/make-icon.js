// Génère build/icon.png (512×512) : carré arrondi dégradé rose → violet avec une note de musique.
// Aucune dépendance : petit encodeur PNG avec zlib. Lancé automatiquement avant `npm run dist`.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 512;
const px = Buffer.alloc(S * S * 4);

const clamp = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a + (b - a) * t;
// Couverture anti-crénelée d'une forme définie par une distance signée (négative = dedans).
const cover = (d) => clamp(0.5 - d);

function roundRectSdf(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r), qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const circleSdf = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
const boxSdf = (x, y, x0, y0, x1, y1) => roundRectSdf(x, y, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0);

// Note de musique (double croche) : deux têtes, deux hampes, une barre inclinée.
function noteSdf(x, y) {
  const heads = Math.min(circleSdf(x, y, 196, 356, 46), circleSdf(x, y, 334, 326, 46));
  const stems = Math.min(boxSdf(x, y, 222, 168, 246, 356), boxSdf(x, y, 360, 138, 384, 326));
  const t = (x - 222) / (384 - 222);
  const topY = mix(168, 138, t);
  const beam = x >= 222 && x <= 384 ? Math.max(topY - y, y - (topY + 44)) : 99;
  return Math.min(heads, stems, beam);
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const fx = x + 0.5, fy = y + 0.5;
    const a = cover(roundRectSdf(fx, fy, 256, 256, 240, 240, 112));
    const t = clamp((fx + fy) / (2 * S));
    // dégradé rose (#ff3ea5) → violet (#8b5cf6) avec une lueur en haut à gauche
    let r = mix(255, 139, t), g = mix(62, 92, t), b = mix(165, 246, t);
    const glow = clamp(1 - Math.hypot(fx - 150, fy - 110) / 300) * 0.35;
    r = mix(r, 255, glow); g = mix(g, 255, glow); b = mix(b, 255, glow);
    const n = cover(noteSdf(fx, fy));
    r = mix(r, 255, n); g = mix(g, 255, n); b = mix(b, 255, n);
    const i = (y * S + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = Math.round(a * 255);
  }
}

// --- encodage PNG
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
// Copie embarquée dans l'appli (zone de notification, barre des tâches).
fs.writeFileSync(path.join(__dirname, '..', 'src', 'main', 'icon.png'), png);
console.log('icône écrite :', out);
