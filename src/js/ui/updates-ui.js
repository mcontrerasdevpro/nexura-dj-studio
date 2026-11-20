// Aviso de actualizaciones: ventana de alerta ámbar abajo a la izquierda (encima de la barra lateral de la
// biblioteca) «Hay una versión nueva de Nexura · actual → nueva · novedades · Descargar ahora / Más tarde» →
// «Descargando… 45 %» → «Lista para instalar · Reiniciar para actualizar» (verde) → «Se instalará al cerrar», y
// botón «⬆ Actualizar» en la barra superior junto a «?» mientras haya una versión disponible o descargada (sigue
// aunque se cierre la ventana con «Más tarde», que no vuelve a salir hasta el siguiente arranque).
// Late suavemente los primeros 30 s de cada estado (sin animación con prefers-reduced-motion). Nunca reinicia
// con un deck sonando: en ese caso se instala al cerrar la app. Sin red o sin versiones nuevas no muestra nada
// (main/updater.js).
import { el, toast, $ } from '../util.js';
import { btn } from './controls.js';
import { platform } from '../platform.js';

const PULSE_MS = 30000;

export class UpdatesUI {
  constructor(app) {
    this.app = app;
    this.state = { state: 'idle' };
    this.closed = false;     // la tarjeta se ha cerrado con × (el botón de la barra superior sigue)
    this.deferred = false;   // se pidió reiniciar con música sonando → se instala al cerrar
    this.ind = el('div', { class: 'upd-ind', id: 'upd-ind', role: 'status', 'aria-live': 'polite', hidden: true });
    const bar = $('#statusbar');
    if (bar) bar.insertBefore(this.ind, bar.querySelector('.brand'));
    // en la barra superior, justo antes de «?»
    this.topBtn = btn('⬆ Actualizar', { cls: 'small upd-top', onClick: () => this.topAction() });
    this.topBtn.id = 'upd-top';
    this.topBtn.hidden = true;
    const help = app.helpBtn || $('#top-right .help-btn');
    if (help) help.before(this.topBtn); else $('#top-right')?.append(this.topBtn);
    this.off = platform.updates.onEvent((ev) => this.onEvent(ev));
    this.configure();
    // reajustar la ventana al cambiar el alto de la biblioteca (tamaño de ventana, modo laptop, sampler…)
    const lib = $('#library');
    if (lib && typeof ResizeObserver === 'function') new ResizeObserver(() => this.fit()).observe(lib);
    addEventListener('resize', () => this.fit());
    app.on('settings', (k) => { if (k === 'autoUpdate' || k === 'prereleaseUpdates') this.configure(); });
    // rc.10: durante la sesión en directo no se ve nada de esto (se sigue comprobando en silencio); al terminar, sí
    app.on('live', (on) => { this.render(); if (!on && this.liveHeld) { this.liveHeld = false; this.app.feedback?.log('INFO', 'actualizaciones', 'Fin de la sesión: se muestra el aviso de actualización'); } });
  }
  get live() { return !!this.app.live?.active; }

  get available() { return platform.updates.available && this.app.info?.updates !== false; }

  configure() {
    const s = this.app.settings;
    return platform.updates.configure({ auto: s.autoUpdate !== false, prerelease: !!s.prereleaseUpdates }).catch(() => {});
  }

  // «Buscar ahora» (Ajustes → General): el resultado se muestra en el propio ajuste (cb) y con un aviso
  async checkNow(cb) {
    this.manualCb = cb;
    if (!this.available) { cb && cb('Las actualizaciones automáticas solo funcionan en la app instalada con el instalador.'); return; }
    cb && cb('Buscando…');
    await platform.updates.check().catch(() => {});
  }

  onEvent(ev) {
    if (!ev) return;
    const cb = this.manualCb;
    if (ev.state === 'checking') return;
    if (ev.state === 'none') { cb && cb(`Tienes la última versión (${this.app.info?.version || ''}).`); this.manualCb = null; return; }
    if (ev.state === 'unsupported') { cb && cb('Las actualizaciones automáticas solo funcionan en la app instalada con el instalador.'); this.manualCb = null; return; }
    if (ev.state === 'error') {
      cb && cb(ev.message || 'No se pudo comprobar ahora.');
      this.manualCb = null;
      if (this.state.state === 'downloading') toast(ev.message || 'No se pudo descargar la actualización.', 'warn', 6000);
      this.state = { state: ev.version ? 'available' : 'idle', version: ev.version, notes: this.state.notes };
      return this.render();
    }
    if (ev.state === 'available' && cb) { cb(`Hay una versión nueva: ${ev.version}.`); this.manualCb = null; }
    this.state = { ...ev, notes: ev.notes || (ev.version === this.state.version ? this.state.notes : []) };
    this.render();
  }

  // Pulso solo los primeros 30 s de «disponible» y de «lista»; después queda fija
  pulse(key) {
    if (this.pulseKey === key) return;
    this.pulseKey = key;
    clearTimeout(this.pulseTimer);
    this.pulseUntil = Date.now() + PULSE_MS;
    this.pulseTimer = setTimeout(() => { this.pulseUntil = 0; this.render(); }, PULSE_MS);
  }

  // «Más tarde» / × cierran la ventana hasta el siguiente arranque (las comprobaciones de cada 6 h no la reabren);
  // el botón de la barra superior sigue visible y la vuelve a abrir
  later() { this.closed = true; this.render(); }

  render() {
    const s = this.state, v = s.version || '', cur = this.app.info?.version || '';
    const ind = this.ind, top = this.topBtn;
    const show = ['available', 'downloading', 'downloaded'].includes(s.state) && !this.live;
    if (this.live && ['available', 'downloaded'].includes(s.state)) this.liveHeld = true;
    const kind = s.state === 'downloaded' && this.deferred ? 'deferred' : s.state;
    if (s.state === 'available' || s.state === 'downloaded') this.pulse(s.state + v);
    const pulsing = (kind === 'available' || kind === 'downloaded') && Date.now() < (this.pulseUntil || 0);
    const pct = Math.max(0, Math.min(100, Math.round(s.percent || 0)));
    const hadFocus = ind.contains(document.activeElement) ? document.activeElement.id : '';
    ind.innerHTML = '';
    ind.hidden = !show || this.closed;
    ind.className = 'upd-ind ' + kind + (pulsing ? ' pulse' : '');
    const ico = (c) => el('span', { class: 'upd-ico', 'aria-hidden': 'true' }, c);
    const head = (c, title) => el('div', { class: 'upd-head' }, ico(c), el('div', { class: 'upd-title', id: 'upd-title' }, title));
    const ver = el('div', { class: 'upd-ver' }, /^\d/.test(cur) && v ? [el('span', {}, cur), el('span', { class: 'upd-arrow' }, ' → '), el('b', {}, v)] : `Versión ${v}`);
    const notes = (s.notes || []).length ? el('ul', { class: 'upd-notes', 'aria-label': 'Novedades' }, s.notes.map(n => el('li', {}, n))) : null;
    const close = el('button', { class: 'upd-close', id: 'upd-close', title: 'Cerrar (sigue en la barra superior)', 'aria-label': 'Cerrar el aviso', onclick: () => this.later() }, '×');
    const later = el('button', { class: 'upd-later', id: 'upd-later', title: 'Cerrar hasta el próximo arranque (sigue en la barra superior)', onclick: () => this.later() }, 'Más tarde');
    const btns = (...b) => el('div', { class: 'upd-btns' }, ...b);
    ind.setAttribute('aria-labelledby', 'upd-title');
    if (kind === 'available') {
      ind.append(head('⬆', 'Hay una versión nueva de Nexura'), ver, notes || '',
        btns(el('button', { class: 'upd-act', id: 'upd-download', onclick: () => this.download() }, 'Descargar ahora'), later));
    } else if (kind === 'downloading') {
      ind.append(head('⬇', `Descargando la versión nueva… ${pct} %`), close, ver,
        el('span', { class: 'upd-bar', role: 'progressbar', 'aria-label': 'Descarga', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, el('i', { style: { width: pct + '%' } })),
        el('div', { class: 'upd-sub' }, 'Puedes seguir pinchando mientras tanto.'));
    } else if (kind === 'downloaded') {
      ind.append(head('✓', `Nexura ${v} lista para instalar`), ver,
        el('div', { class: 'upd-sub' }, 'Se reinicia en unos segundos; tu biblioteca queda guardada.'),
        btns(el('button', { class: 'upd-act', id: 'upd-install', onclick: () => this.install() }, 'Reiniciar para actualizar'), later));
    } else if (kind === 'deferred') {
      ind.append(head('✓', 'Se instalará al cerrar Nexura'), close, ver,
        el('div', { class: 'upd-sub' }, 'Hay música sonando: no se reinicia ahora.'),
        btns(el('button', { class: 'upd-act', id: 'upd-install', title: 'Reiniciar ahora si ya no suena nada', onclick: () => this.install() }, 'Reiniciar ahora')));
    }
    if (hadFocus && !ind.hidden) document.getElementById(hadFocus)?.focus();
    this.fit();
    top.hidden = !show;
    top.className = 'btn small upd-top ' + kind + (pulsing ? ' pulse' : '');
    top.textContent = kind === 'downloading' ? `⬇ ${pct} %` : '⬆ Actualizar';
    top.title = kind === 'available' ? `Nexura ${v} disponible: descargar`
      : kind === 'downloading' ? `Descargando Nexura ${v}… ${pct} %`
        : kind === 'deferred' ? `Nexura ${v} se instalará al cerrar la app`
          : `Nexura ${v} lista: reiniciar para actualizar`;
  }

  // La ventana no sube por encima de la biblioteca (ahí están sampler, FX, crossfader y decks): si no cabe, quita
  // líneas de novedades desde la última y, si aun así no cabe, pasa a la versión compacta (.tight)
  fit() {
    const ind = this.ind, lib = $('#library')?.getBoundingClientRect();
    if (ind.hidden) return;
    const items = [...ind.querySelectorAll('.upd-notes li')], ul = ind.querySelector('.upd-notes');
    items.forEach(li => { li.hidden = false; });
    if (ul) ul.hidden = false;
    ind.classList.remove('tight');
    if (!lib || !lib.height || innerWidth <= 760) return;
    const over = () => ind.getBoundingClientRect().top < lib.top + 4;
    for (let i = items.length - 1; i >= 0 && over(); i--) items[i].hidden = true;
    if (ul && items.every(li => li.hidden)) ul.hidden = true;
    if (over()) ind.classList.add('tight');
  }

  // El botón de la barra superior hace lo mismo que el aviso (y vuelve a enseñarlo si se había cerrado)
  topAction() {
    this.closed = false;
    this.render();
    const st = this.state.state;
    if (st === 'available') return this.download();
    if (st === 'downloaded') return this.install();
  }

  async download() {
    if (this.live) return false; // nunca durante la sesión (el proceso principal también lo impide)
    this.state = { ...this.state, state: 'downloading', percent: 0 };
    this.render();
    const ok = await platform.updates.download().catch(() => false);
    if (!ok && this.state.state === 'downloading') { this.state.state = 'available'; this.render(); }
  }

  // Nunca en mitad de una sesión: con algún deck sonando se instala al cerrar
  async install() {
    const a = this.app;
    if (this.live || a.decks.some(d => d.playing) || a.autoplay?.enabled || a.automix?.enabled) {
      toast('Hay música sonando: la actualización se instalará cuando cierres Nexura DJ Studio.', 'info', 7000);
      this.deferred = true; this.render();
      return false;
    }
    if (a.engine?.recording) { toast('Estás grabando: la actualización se instalará al cerrar la app.', 'info', 7000); this.deferred = true; this.render(); return false; }
    this.deferred = false;
    toast('Guardando y reiniciando…', 'info', 3000);
    try { await a.library.save(); await platform.storeSet('settings', a.settings); } catch (_) { /* se instala igualmente */ }
    return platform.updates.install();
  }
}
