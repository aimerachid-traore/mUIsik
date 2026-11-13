// Affichage des paroles synchronisées, 4 styles : fade, karaoke, neon, typewriter.
import { el } from './shared.js';

export class LyricsView {
  constructor(root) {
    this.root = root;
    this.lines = [];
    this.idx = -99;
    this.style = 'fade';
    this.cur = null;
  }

  setLyrics(lyrics) {
    this.lines = lyrics?.synced?.length ? lyrics.synced : [];
    this.idx = -99;
    this.root.replaceChildren();
  }

  setStyle(style, size) {
    if (style !== this.style) { this.style = style; this.idx = -99; }
    this.root.className = `lyrics style-${style}${this.root.classList.contains('custom-font') ? ' custom-font' : ''}`;
    this.root.style.setProperty('--size', `${size}px`);
  }

  #indexAt(t) {
    const L = this.lines;
    if (!L.length || t < L[0].t) return -1;
    let lo = 0, hi = L.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (L[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  #render(i, t) {
    const L = this.lines;
    const text = (j) => (j >= 0 && j < L.length ? L[j].text || '♪' : '');
    const nextT = L[i + 1]?.t;
    // Pause instrumentale : une note et le compte à rebours jusqu'à la ligne suivante.
    const instrumental = (i < 0 && L[0]?.t - t > 3) || (i >= 0 && !L[i].text && nextT - t > 3);

    const cur = el('div', { class: 'line current' });
    if (instrumental) {
      cur.classList.add('instrumental');
      cur.append(el('span', { class: 'note' }, '♪'), el('span', { class: 'countdown' }));
    } else if (this.style === 'karaoke') {
      cur.append(el('span', { class: 'fill', 'data-text': text(i) }, text(i)));
    } else if (this.style === 'typewriter') {
      cur.append(el('span', { class: 'typed' }), el('span', { class: 'caret' }));
      cur.dataset.full = text(i);
    } else {
      cur.textContent = text(i);
    }

    const nodes = [];
    if (this.style === 'fade' || this.style === 'karaoke') nodes.push(el('div', { class: 'line prev' }, text(i - 1)));
    nodes.push(cur);
    if (this.style !== 'typewriter') nodes.push(el('div', { class: 'line next' }, i < 0 ? text(0) : text(i + 1)));

    const block = el('div', { class: 'block enter' }, nodes);
    const old = this.root.querySelector('.block:not(.leave)');
    if (old) { old.classList.add('leave'); setTimeout(() => old.remove(), 450); }
    this.root.append(block);
    requestAnimationFrame(() => block.classList.remove('enter'));
    this.cur = cur;
  }

  /** À appeler à chaque image avec la position courante (secondes). */
  frame(t) {
    if (!this.lines.length) return;
    const i = this.#indexAt(t);
    if (i !== this.idx) { this.idx = i; this.#render(i, t); }
    const c = this.cur;
    if (!c) return;
    const L = this.lines;
    const start = i >= 0 ? L[i].t : 0;
    const end = L[i + 1]?.t ?? start + 5;
    const p = Math.max(0, Math.min(1, (t - start) / Math.max(0.5, end - start)));

    if (c.classList.contains('instrumental')) {
      const left = Math.ceil((L[i + 1]?.t ?? L[0].t) - t);
      const cd = c.querySelector('.countdown');
      if (cd) cd.textContent = left > 0 ? left : '';
    } else if (this.style === 'karaoke') {
      c.style.setProperty('--p', `${Math.min(1, p * 1.25) * 100}%`);
    } else if (this.style === 'typewriter') {
      const full = c.dataset.full || '';
      const n = Math.ceil(full.length * Math.min(1, p * 2.4));
      const typed = c.querySelector('.typed');
      if (typed && typed.textContent.length !== n) typed.textContent = full.slice(0, n);
    }
  }
}
