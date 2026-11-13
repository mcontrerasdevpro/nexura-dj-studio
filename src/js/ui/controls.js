// Controles de interfaz: potenciómetro (knob), fader y botón
import { el, clamp } from '../util.js';

const SVGNS = 'http://www.w3.org/2000/svg';
function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`;
}

export class Knob {
  constructor({ label = '', value = 0.5, def = value, bipolar = false, size = 38, color = 'var(--knob-arc)', onChange = () => {}, fmt = null, cls = '' }) {
    this.value = value; this.def = def; this.bipolar = bipolar; this.onChange = onChange; this.fmt = fmt;
    this.size = size; this.color = color;
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('width', size); this.svg.setAttribute('height', size);
    this.svg.setAttribute('viewBox', '0 0 40 40');
    this.track = document.createElementNS(SVGNS, 'path');
    this.track.setAttribute('class', 'knob-track');
    this.arc = document.createElementNS(SVGNS, 'path');
    this.arc.setAttribute('class', 'knob-arc');
    this.arc.style.stroke = color;
    this.cap = document.createElementNS(SVGNS, 'circle');
    this.cap.setAttribute('cx', 20); this.cap.setAttribute('cy', 20); this.cap.setAttribute('r', 12.5);
    this.cap.setAttribute('class', 'knob-cap');
    this.ind = document.createElementNS(SVGNS, 'line');
    this.ind.setAttribute('class', 'knob-ind');
    this.svg.append(this.track, this.arc, this.cap, this.ind);
    this.labelEl = el('div', { class: 'knob-label' }, label);
    this.valEl = el('div', { class: 'knob-val' });
    this.el = el('div', { class: 'knob ' + cls, title: label + ' — doble clic para centrar' }, this.svg, this.labelEl, this.valEl);
    this.track.setAttribute('d', arcPath(20, 20, 16, Math.PI * 0.75, Math.PI * 2.25));
    this.bind();
    this.set(value, true);
  }
  bind() {
    let startY = 0, startV = 0;
    const move = (e) => {
      const fine = e.shiftKey ? 0.2 : 1;
      this.set(startV + (startY - e.clientY) / 180 * fine);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.el.classList.remove('drag'); };
    this.svg.addEventListener('pointerdown', (e) => {
      e.preventDefault(); startY = e.clientY; startV = this.value;
      this.el.classList.add('drag');
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    this.svg.addEventListener('dblclick', () => this.set(this.def));
    this.svg.addEventListener('wheel', (e) => { e.preventDefault(); this.set(this.value - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.02)); }, { passive: false });
  }
  set(v, silent = false) {
    v = clamp(v, 0, 1);
    if (Math.abs(v - this.def) < 0.012 && this.bipolar) v = this.def;
    this.value = v;
    const a0 = Math.PI * 0.75, a = a0 + v * Math.PI * 1.5;
    const from = this.bipolar ? Math.PI * 1.5 : a0;
    this.arc.setAttribute('d', Math.abs(a - from) < 0.01 ? '' : arcPath(20, 20, 16, Math.min(from, a), Math.max(from, a)));
    this.ind.setAttribute('x1', 20 + 5 * Math.cos(a)); this.ind.setAttribute('y1', 20 + 5 * Math.sin(a));
    this.ind.setAttribute('x2', 20 + 11 * Math.cos(a)); this.ind.setAttribute('y2', 20 + 11 * Math.sin(a));
    if (this.fmt) this.valEl.textContent = this.fmt(v);
    if (!silent) this.onChange(v);
  }
}

// Fader (vertical u horizontal) con tirador personalizado
export class Fader {
  constructor({ vertical = true, value = 0, def = value, length = 140, onChange = () => {}, cls = '', notch = null, reversed = false }) {
    this.vertical = vertical; this.value = value; this.def = def; this.onChange = onChange; this.reversed = reversed;
    this.length = length;
    this.thumb = el('div', { class: 'fader-thumb' });
    this.fill = el('div', { class: 'fader-slot' });
    // la longitud va en --len (el CSS la usa como alto/ancho y puede acortarla en pantallas bajas)
    this.el = el('div', { class: `fader ${vertical ? 'vertical' : 'horizontal'} ${cls}` }, this.fill, this.thumb);
    this.el.style.setProperty('--len', length + 'px');
    if (notch != null) this.el.appendChild(el('div', { class: 'fader-notch', style: vertical ? { top: ((reversed ? notch : 1 - notch) * 100) + '%' } : { left: (notch * 100) + '%' } }));
    this.bind();
    this.set(value, true);
  }
  posFromEvent(e) {
    const r = this.el.getBoundingClientRect();
    let x = this.vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    if (this.vertical && this.reversed) x = 1 - x;
    return clamp(x, 0, 1);
  }
  bind() {
    let start = 0, startV = 0, rel = false;
    const move = (e) => {
      const r = this.el.getBoundingClientRect();
      const len = this.vertical ? r.height : r.width;
      let d = this.vertical ? (start - e.clientY) / len : (e.clientX - start) / len;
      if (this.vertical && this.reversed) d = -d;
      this.set(rel ? startV + d * (e.shiftKey ? 0.2 : 1) : this.posFromEvent(e));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      rel = e.target === this.thumb;
      start = this.vertical ? e.clientY : e.clientX; startV = this.value;
      if (!rel) this.set(this.posFromEvent(e));
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    this.el.addEventListener('dblclick', () => this.set(this.def));
    this.el.addEventListener('wheel', (e) => { e.preventDefault(); this.set(this.value - Math.sign(e.deltaY) * (this.vertical && this.reversed ? -1 : 1) * (e.shiftKey ? 0.002 : 0.02)); }, { passive: false });
  }
  set(v, silent = false) {
    this.value = clamp(v, 0, 1);
    const p = this.vertical ? (this.reversed ? this.value : 1 - this.value) : this.value;
    if (this.vertical) this.thumb.style.top = `calc(${p * 100}% - 9px)`;
    else this.thumb.style.left = `calc(${p * 100}% - 12px)`;
    if (!silent) this.onChange(this.value);
  }
}

export function btn(label, opts = {}) {
  const b = el('button', { class: 'btn ' + (opts.cls || ''), title: opts.title || '' }, label);
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  if (opts.onDown || opts.onUp) {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('pressed'); opts.onDown && opts.onDown(e); });
    const up = (e) => { if (!b.classList.contains('pressed')) return; b.classList.remove('pressed'); opts.onUp && opts.onUp(e); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }
  return b;
}

export function select(options, value, onChange, cls = '') {
  const s = el('select', { class: 'sel ' + cls });
  for (const [v, l] of Object.entries(options)) s.appendChild(el('option', { value: v }, l));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
