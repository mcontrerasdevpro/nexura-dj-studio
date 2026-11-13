// Panel del Autoplay: botón «▶ AUTOPLAY» en la barra superior (y en la barra de la biblioteca), panel
// pequeño con origen, orden, transición, repetir, saltar tocadas y Empezar / Siguiente / Parar, e
// indicador «AUTOPLAY · crate · 3/120 · siguiente: …» mientras está activo.
import { el, $ } from '../util.js';
import { btn, select } from './controls.js';
import { AUTOPLAY_ORDERS, AUTOPLAY_TRANSITIONS, FADE_MIN, FADE_MAX } from '../ai/autoplay-core.js';

export class AutoplayUI {
  constructor(app) {
    this.app = app;
    this.ap = app.autoplay;
    this.panel = null;
    this.lastLabel = 0;
    this.topBtn = btn('▶ AUTOPLAY', { cls: 'small autoplay-btn', title: 'Pincha solas las canciones del crate abierto, en orden o al azar (Mayús+F7)', onClick: (e) => this.toggleOpen(e.currentTarget) });
    this.ind = el('span', { class: 'autoplay-ind', hidden: true, title: 'Autoplay activo · clic para ver las opciones' });
    this.ind.addEventListener('click', () => this.toggleOpen(this.topBtn));
    this.libBtn = btn('▶ Autoplay', { cls: 'small autoplay-lib', title: 'Autoplay: pincha solas las canciones de esta vista', onClick: (e) => this.toggleOpen(e.currentTarget) });
    const anchor = $('#library .lib-toolbar .ai-btn');
    if (anchor) anchor.after(this.libBtn);
    this.ap.on('change', () => { this.refreshButtons(); if (this.panel) this.render(); });
    // al cambiar de vista con el panel abierto se actualiza el origen que se usará al pulsar Empezar
    app.on('settings', (k) => { if (k === 'libView' && this.panel) setTimeout(() => this.panel && this.render(), 0); });
    this._outside = (e) => { if (this.panel && !this.panel.contains(e.target) && !this.anchor?.contains(e.target) && !this.ind.contains(e.target)) this.close(); };
    this._key = (e) => { if (e.key === 'Escape' && this.panel) { e.stopPropagation(); this.close(); } };
    this.refreshButtons();
  }

  refreshButtons() {
    const on = this.ap.enabled;
    this.topBtn.classList.toggle('on', on);
    this.libBtn.classList.toggle('on', on);
    this.ind.hidden = !on;
    document.body.classList.toggle('autoplay-on', on);
    this.lastLabel = 0;
    this.frame();
  }
  // indicador de la barra superior (desde el bucle principal, 4 veces por segundo)
  frame() {
    const now = performance.now();
    if (now - this.lastLabel < 250) return;
    this.lastLabel = now;
    const s = this.ap.enabled ? this.ap.status() : '';
    if (this.ind.textContent !== s) { this.ind.textContent = s; this.ind.title = s ? s + ' · clic para ver las opciones' : ''; }
    if (this.panel && this.statusEl && this.statusEl.textContent !== (s || 'Parado')) this.statusEl.textContent = s || 'Parado';
  }

  toggleOpen(anchor) { if (this.panel) this.close(); else this.open(anchor); }
  open(anchor = this.topBtn) {
    this.close();
    this.anchor = anchor;
    this.panel = el('div', { class: 'ap-panel', role: 'dialog', 'aria-label': 'Autoplay' });
    document.body.appendChild(this.panel);
    this.render();
    document.addEventListener('pointerdown', this._outside, true);
    document.addEventListener('keydown', this._key, true);
  }
  close() {
    if (!this.panel) return;
    this.panel.remove(); this.panel = null; this.statusEl = null;
    document.removeEventListener('pointerdown', this._outside, true);
    document.removeEventListener('keydown', this._key, true);
  }
  place() {
    const p = this.panel, a = (this.anchor && this.anchor.isConnected ? this.anchor : this.topBtn).getBoundingClientRect();
    const r = p.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.right - r.width, innerWidth - r.width - 8));
    let top = a.bottom + 6;
    if (top + r.height > innerHeight - 8) top = Math.max(8, a.top - r.height - 6);   // botón de la biblioteca, abajo
    p.style.left = left + 'px'; p.style.top = top + 'px';
  }

  render() {
    const ap = this.ap, o = ap.opts, ui = this.app.libraryUI, p = this.panel;
    const viewName = ui.viewName() || 'Biblioteca', n = ui.rows.length;
    const seg = (key, opts) => el('div', { class: 'ap-seg' }, ...Object.entries(opts).map(([k, v]) =>
      btn(v, { cls: 'small' + (o[key] === k ? ' on' : ''), onClick: () => ap.setOption(key, k) })));
    const check = (key, label) => {
      const c = el('input', { type: 'checkbox', class: 'switch' }); c.checked = !!o[key];
      c.addEventListener('change', () => ap.setOption(key, c.checked));
      return el('label', { class: 'ap-row ap-check' }, c, el('span', {}, label));
    };
    const trans = select(AUTOPLAY_TRANSITIONS, o.transition, (v) => ap.setOption('transition', v), 'ap-trans');
    const secs = el('input', { type: 'number', class: 'num-in ap-secs', min: FADE_MIN, max: FADE_MAX, step: 1, value: o.fadeSecs, title: `Duración del fundido (${FADE_MIN}-${FADE_MAX} s)` });
    secs.addEventListener('change', () => ap.setOption('fadeSecs', secs.value));
    const fadeBox = el('span', { class: 'ap-fade', hidden: o.transition !== 'fade' }, secs, el('span', {}, 's'));
    const src = ap.enabled
      ? el('div', { class: 'ap-src' }, el('span', {}, 'Sonando: '), el('b', {}, ap.source.name), ` · ${ap.queue.total} pistas`,
        ap.source.viewId !== ui.viewId ? el('small', {}, `Abierta ahora: «${viewName}» (${n}). Pulsa «Empezar» para cambiar a ella.`) : null)
      : el('div', { class: 'ap-src' }, el('span', {}, 'Origen: '), el('b', {}, viewName), ` · ${n} pistas`,
        el('small', {}, o.order === 'list' && ui.current() && (ui.cursor >= 0 || ui.sel.size) ? `Empieza por «${ui.current().title || '—'}» (la seleccionada)` : 'El orden es el de la tabla (columna y dirección incluidas)'));
    this.statusEl = el('div', { class: 'ap-status' }, ap.enabled ? ap.status() : 'Parado');
    const start = btn(ap.enabled ? '▶ Empezar de nuevo' : '▶ Empezar', { cls: 'small primary', title: 'Empieza con la vista abierta en la biblioteca', onClick: () => ap.start() });
    const next = btn('Siguiente »', { cls: 'small', title: 'Pasar ya a la siguiente (Ctrl+→)', onClick: () => ap.skip() });
    const stop = btn('■ Parar', { cls: 'small', title: 'Parar el Autoplay (la canción actual sigue sonando) · Mayús+F7', onClick: () => ap.stop() });
    next.disabled = stop.disabled = !ap.enabled;
    if (!n && !ap.enabled) start.disabled = true;
    p.replaceChildren(
      el('div', { class: 'ap-head' }, el('b', {}, '▶ Autoplay'), btn('✕', { cls: 'micro', title: 'Cerrar', onClick: () => this.close() })),
      src,
      el('div', { class: 'ap-row' }, el('span', { class: 'ap-lbl' }, 'Orden'), seg('order', AUTOPLAY_ORDERS)),
      el('div', { class: 'ap-row' }, el('span', { class: 'ap-lbl' }, 'Transición'), trans, fadeBox),
      check('repeat', 'Repetir al terminar'),
      check('skipPlayed', 'Saltar las ya tocadas en esta sesión'),
      this.statusEl,
      el('div', { class: 'ap-actions' }, start, next, stop),
      el('small', { class: 'ap-hint' }, 'Mayús+F7: empezar/parar · Ctrl+→: siguiente. El orden y «saltar tocadas» se aplican al pulsar Empezar.'));
    this.place();
  }
}
