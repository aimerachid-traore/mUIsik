// "Liquid glass" : le fond d'écran dessine, juste sous le lecteur, un verre qui floute et réfracte
// ce qu'il y a derrière (clip, pochette, vidéo). Le lecteur, au-dessus, n'ajoute que les reflets et le
// contenu. C'est la seule façon d'avoir une vraie réfraction sous Windows : une fenêtre transparente ne
// "voit" pas ce qu'il y a sous elle, mais le fond d'écran, lui, sait exactement ce qu'il affiche.
const SVG_NS = 'http://www.w3.org/2000/svg';
const root = document.getElementById('glass');
const defs = document.getElementById('glass-defs');
const shapes = new Map(); // id -> { el, key }

/**
 * Carte de déplacement d'un rectangle arrondi : au bord (sur `bezel` px), l'image est tirée vers
 * l'intérieur, comme à travers la tranche d'une lentille. R = déplacement x, G = déplacement y.
 */
function displacementMap(w, h, r, bezel) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const hw = w / 2, hh = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw, py = y + 0.5 - hh;
      const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
      // Distance signée au bord du rectangle arrondi (négative à l'intérieur).
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const sdf = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
      const inside = -sdf;
      let nx = 0, ny = 0, mag = 0;
      if (inside >= 0 && inside < bezel) {
        const t = 1 - inside / bezel;
        mag = t * t * (3 - 2 * t); // courbe douce : forte au bord, nulle au centre
        if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = (qx / l) * Math.sign(px); ny = (qy / l) * Math.sign(py); }
        else if (qx > qy) nx = Math.sign(px);
        else ny = Math.sign(py);
      }
      const i = (y * w + x) * 4;
      d[i] = 128 - nx * mag * 127;
      d[i + 1] = 128 - ny * mag * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

function ensureFilter(id, w, h, r) {
  const fid = `lg-${id}`;
  let f = document.getElementById(fid);
  if (!f) {
    f = document.createElementNS(SVG_NS, 'filter');
    f.id = fid;
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.setAttribute('filterUnits', 'userSpaceOnUse');
    f.setAttribute('primitiveUnits', 'userSpaceOnUse');
    const im = document.createElementNS(SVG_NS, 'feImage');
    im.setAttribute('result', 'map');
    im.setAttribute('preserveAspectRatio', 'none');
    const dm = document.createElementNS(SVG_NS, 'feDisplacementMap');
    dm.setAttribute('in', 'SourceGraphic');
    dm.setAttribute('in2', 'map');
    dm.setAttribute('xChannelSelector', 'R');
    dm.setAttribute('yChannelSelector', 'G');
    f.append(im, dm);
    defs.append(f);
  }
  const bezel = Math.min(28, Math.min(w, h) / 2.5);
  for (const n of [f, f.firstChild]) { n.setAttribute('x', 0); n.setAttribute('y', 0); n.setAttribute('width', w); n.setAttribute('height', h); }
  f.firstChild.setAttribute('href', displacementMap(Math.round(w), Math.round(h), Math.min(r, w / 2, h / 2), bezel));
  f.lastChild.setAttribute('scale', String(Math.round(bezel * 1.6)));
  return fid;
}

/** Applique les formes envoyées par le lecteur : { x, y, shapes: [{ id, x, y, w, h, r, visible }], animate }. */
export function setGlass({ x, y, shapes: list, animate }) {
  root.style.transform = `translate(${x}px, ${y}px)`;
  root.classList.toggle('animate', !!animate);
  const seen = new Set();
  for (const s of list || []) {
    seen.add(s.id);
    let entry = shapes.get(s.id);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'glass-shape';
      root.append(el);
      entry = { el, key: '' };
      shapes.set(s.id, entry);
    }
    const { el } = entry;
    el.style.left = `${s.x}px`;
    el.style.top = `${s.y}px`;
    el.style.width = `${s.w}px`;
    el.style.height = `${s.h}px`;
    el.style.borderRadius = `${s.r}px`;
    el.classList.toggle('hidden', s.visible === false);
    // La carte de réfraction ne dépend que de la taille : on ne la recalcule que si elle change.
    const key = `${Math.round(s.w)}x${Math.round(s.h)}r${s.r}`;
    if (key !== entry.key && s.w > 4 && s.h > 4) {
      entry.key = key;
      const fid = ensureFilter(s.id, s.w, s.h, s.r);
      el.style.backdropFilter = `url(#${fid}) blur(${s.blur ?? 12}px) saturate(1.6) brightness(1.06)`;
    }
  }
  for (const [id, entry] of shapes) {
    if (!seen.has(id)) { entry.el.remove(); shapes.delete(id); document.getElementById(`lg-${id}`)?.remove(); }
  }
}
