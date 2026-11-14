// Utilidades comunes
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-9));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function hashId(str) {
  // FNV-1a 53 bits → id estable a partir de la ruta del archivo
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36));
}

export function fmtTime(sec, tenths = true) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const t = Math.floor((sec * 10) % 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${tenths ? '.' + t : ''}`;
}

export const fmtBpm = (b) => (b ? b.toFixed(2) : '—');

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return e;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter(f => f !== fn); }
  emit(ev, ...a) { for (const f of (this._h[ev] || []).slice()) { try { f(...a); } catch (e) { console.error(e); } } }
}

// Cede el hilo de la interfaz entre trozos de un trabajo largo (deja dibujar la onda y atender eventos).
// scheduler.yield() continúa enseguida; setTimeout(0) se frena a 4 ms tras varios seguidos
export function yieldToUI() {
  const s = globalThis.scheduler;
  return s && typeof s.yield === 'function' ? s.yield() : new Promise(r => setTimeout(r, 0));
}

// Copia un canal de audio a trozos (con yieldToUI entre trozo y trozo): copiar de golpe una pista de 7 min
// paraba la interfaz unos 300 ms en un PC lento
export async function copyChannel(src, chunk = 1 << 20) {
  const out = new Float32Array(src.length);
  for (let o = 0; o < src.length; o += chunk) {
    out.set(src.subarray(o, o + chunk), o);
    if (o + chunk < src.length) await yieldToUI();
  }
  return out;
}

export function debounce(fn, ms) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// --- Tonalidad / rueda Camelot --------------------------------------------
export const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Camelot: mayores = B, menores = A
const CAMELOT_MAJOR = { C: '8B', 'C#': '3B', D: '10B', Eb: '5B', E: '12B', F: '7B', 'F#': '2B', G: '9B', Ab: '4B', A: '11B', Bb: '6B', B: '1B' };
const CAMELOT_MINOR = { C: '5A', 'C#': '12A', D: '7A', Eb: '2A', E: '9A', F: '4A', 'F#': '11A', G: '6A', Ab: '1A', A: '8A', Bb: '3A', B: '10A' };

export function keyToCamelot(tonic, minor) {
  return (minor ? CAMELOT_MINOR : CAMELOT_MAJOR)[tonic] || '';
}
export function keyLabel(tonicIdx, minor) { return KEY_NAMES[tonicIdx] + (minor ? 'm' : ''); }

export function camelotShift(code, semis) {
  // Cada semitono = +7 posiciones en la rueda Camelot
  const m = /^(\d+)([AB])$/.exec(code || '');
  if (!m) return code || '';
  let n = ((parseInt(m[1], 10) - 1 + semis * 7) % 12 + 12) % 12 + 1;
  return n + m[2];
}

export function camelotCompatible(a, b) {
  const ma = /^(\d+)([AB])$/.exec(a || ''), mb = /^(\d+)([AB])$/.exec(b || '');
  if (!ma || !mb) return false;
  const na = +ma[1], nb = +mb[1];
  if (ma[2] === mb[2]) { const d = Math.abs(na - nb); return d === 0 || d === 1 || d === 11; }
  return na === nb;
}

// Colores de deck: 1 azul, 2 rojo, 3 verde, 4 naranja (los del tema Grafito; theme.js pone los del tema activo)
export const DECK_COLORS = ['#2f9bff', '#ff4d5e', '#2ee06a', '#ffa31a'];
export const DECK_LIGHT = ['#8cc8ff', '#ff9aa4', '#8ff0b0', '#ffc878'];

// Colores de hot cues, crates y sampler: sin azul, que es la identidad del Deck 1 (antes las posiciones 5 y 6 eran cian y azul)
export const CUE_COLORS = ['#ff3b47', '#ffa31a', '#ffd21a', '#2ee06a', '#2fd8c8', '#9ad62a', '#a35bff', '#ff4fa8'];

export function parseBpm(v) {
  const n = parseFloat(String(v || '').replace(',', '.'));
  return isFinite(n) && n > 20 && n < 400 ? n : null;
}

// action (opcional): { label, fn } → botón dentro del aviso (p. ej. «Deshacer»); se usa una sola vez
export function toast(msg, type = 'info', ms = 3500, action = null) {
  const host = document.getElementById('toasts');
  if (!host) return console.log(msg);
  const t = el('div', { class: 'toast ' + type }, msg);
  const hide = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
  if (action) t.append(el('button', { class: 'toast-act', onclick: () => { hide(); action.fn(); } }, action.label));
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(hide, ms);
}

// Color de una tonalidad según su posición en la rueda Camelot (A = menor más oscuro, B = mayor más claro)
export function keyColor(code) {
  const m = /^(\d+)([AB])$/.exec(code || '');
  if (!m) return '';
  const hue = ((parseInt(m[1], 10) - 1) * 30 + 150) % 360;
  return `hsl(${hue}, 90%, ${m[2] === 'B' ? 68 : 60}%)`;
}
