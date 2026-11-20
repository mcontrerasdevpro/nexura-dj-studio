// Modo «sesión en directo», recuperación tras un cierre inesperado y medidor de carga (rc.10).
// La lógica está en live/live-core.js, live/session-core.js y live/load-core.js (probadas en Node); aquí solo se
// conecta con la app: barra superior, avisos, guardado de la instantánea y efectos de la carga.
import { el, toast, setToastGate, debounce } from '../util.js';
import { btn } from './controls.js';
import { platform } from '../platform.js';
import { LiveState, NoticeQueue, noticePolicy } from '../live/live-core.js';
import { buildSnapshot, snapshotKey, shouldOffer, planRestore, describePlan, SNAPSHOT_EVERY_MS } from '../live/session-core.js';
import { LoadMeter, LATENCY, realLatencyMs } from '../live/load-core.js';

// ---------------------------------------------------------------------------------------------- sesión en directo
export class LiveSession {
  constructor(app) {
    this.app = app;
    this.state = new LiveState(app.settings.liveMode || 'auto');
    this.queue = new NoticeQueue();
    this.btn = btn('', { cls: 'small live-btn', onClick: () => this.toggle() });
    this.btn.id = 'live-btn';
    this.btn.setAttribute('aria-pressed', 'false');
    this.dot = el('span', { class: 'live-dot', 'aria-hidden': 'true' });
    this.qEl = el('span', { class: 'live-q' });
    this.btn.append(this.dot, el('span', { class: 'live-lbl' }, el('span', { class: 'live-en' }, 'EN '), 'DIRECTO'), this.qEl);
    setToastGate((t) => this.gate(t));
    app.on('settings', (k, v) => { if (k === 'liveMode') { this.state.setMode(v); this.tick(); } });
    this.playing = null;
    this.timer = setInterval(() => this.tick(), 500);
    // La confirmación al cerrar con música la pide el proceso principal con su propio diálogo (main.js → live:state).
    // (En el modo navegador de pruebas no se usa beforeunload: bloquearía las recargas de las pruebas de interfaz)
    this.tick();
  }
  get active() { return this.state.active; }
  // ¿algo al aire? (rc.9: deckOnAir) o Automix, Autoplay, grabación o micrófono
  busy() {
    const a = this.app;
    return !!(a.decks?.some((_d, i) => i < a.deckCount && a.deckOnAir(i)) || a.automix?.enabled || a.autoplay?.enabled || a.engine?.recording || a.engine?.micActive);
  }
  musicPlaying() { return !!this.app.decks?.some(d => d.playing && d.track); }
  tick(now = Date.now()) {
    const r = this.state.update({ busy: this.busy() }, now);
    if (r.changed) this.changed(r);
    this.render(now);
    // al proceso principal: si suena algo (confirmación al cerrar) y si hay sesión (el actualizador no descarga ni instala)
    const playing = this.musicPlaying();
    if (playing !== this.playing || r.changed) { this.playing = playing; platform.live.setState({ playing, live: this.active }); }
  }
  toggle() {
    const r = this.state.toggle(Date.now());
    this.app.feedback?.log('INFO', 'directo', `Modo sesión en directo ${r.active ? 'activado' : 'desactivado'} a mano`);
    if (r.changed) this.changed(r);
    this.render();
  }
  changed(r) {
    const a = this.app;
    document.body.classList.toggle('live-on', r.active);
    a.feedback?.log('INFO', 'directo', r.active ? `Sesión en directo: empieza (${r.reason})` : `Sesión en directo: termina${this.queue.size ? ` · ${this.queue.size} aviso(s) pendientes` : ''}`);
    a.emit('live', r.active);
    if (r.ended) setTimeout(() => this.flush(), 400);
  }
  render(now = Date.now()) {
    const on = this.active, b = this.btn, left = this.state.endsIn(now);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    const q = this.queue.size;
    const txt = on && q ? ` · ${q}` : '';
    if (this.qEl.textContent !== txt) this.qEl.textContent = txt;
    const mode = this.state.mode;
    b.title = on
      ? `Sesión en directo: sin avisos de actualización, ventanas ni análisis pesados mientras pinchas.${q ? ` ${q} aviso(s) esperan al final de la sesión.` : ''}${left ? ` Termina sola en ${Math.ceil(left / 1000)} s si no vuelve a sonar nada.` : ''} Pulsa para terminarla ahora`
      : mode === 'off' ? 'Modo sesión en directo desactivado en Ajustes → Reproducción. Pulsa para activarlo ahora'
        : 'Modo sesión en directo: se activa solo cuando suena un deck al aire (o con Automix, Autoplay o REC). Pulsa para activarlo ya';
  }
  // util.toast pasa por aquí: false = se guarda para el final de la sesión
  gate(t) {
    if (noticePolicy(this.active, t) !== 'queue') return true;
    this.queue.push({ type: 'toast', key: 'toast:' + t.msg, t });
    this.render();
    return false;
  }
  // Algo que no es urgente (aviso de actualización, novedades, bienvenida…): ahora o al terminar la sesión
  defer(key, fn) {
    if (!this.active) { fn(); return false; }
    this.queue.push({ type: 'fn', key, fn });
    this.render();
    return true;
  }
  // Lo que no es urgente se pausa mientras hay sesión (o con el audio al límite)
  holdBackground() { return this.active || !!this.app.loadMeter?.overloaded; }
  flush() {
    const items = this.queue.drain();
    this.render();
    if (!items.length) return;
    this.app.feedback?.log('INFO', 'directo', `Fin de la sesión: se muestran ${items.length} aviso(s) aplazados`);
    items.forEach((it, i) => setTimeout(() => {
      if (it.type === 'fn') { try { it.fn(); } catch (e) { console.error(e); } }
      else toast(it.t.msg, it.t.type, Math.max(it.t.ms || 3500, 6000), it.t.action, { force: true });
    }, i * 350));
  }
}

// ---------------------------------------------------------------------------------------------- recuperación
export class SessionGuard {
  constructor(app) {
    this.app = app;
    this.key = '';
    this.saveSoon = debounce(() => this.save(), 150);
  }
  snapshot() {
    const a = this.app;
    return buildSnapshot({ decks: a.decks, deckCount: a.deckCount, engine: a.engine, settings: a.settings, screenView: a.screenView, syncMaster: a.syncMgr?.current || null });
  }
  async startup(query = '') {
    const a = this.app, now = Date.now();
    let prev = null;
    try { prev = await platform.storeGet('sesion'); } catch (_) { prev = null; }
    // la vigilancia empieza ya: cada 2 s y en cuanto cambia algo importante (carga, play/pausa, cue, loop, sync…)
    a.decks.forEach(d => ['track', 'state', 'loop', 'cues', 'tempo'].forEach(ev => d.on(ev, () => this.changed())));
    a.on('settings', (k) => { if (k === 'quantize' || k === 'screenView') this.changed(); });
    // reinicio de la interfaz para aplicar la latencia (sin música sonando): se recupera sin preguntar
    if (prev && prev.restoreNow && now - (prev.at || 0) < 120000) {
      a.feedback?.log('INFO', 'sesion', 'Interfaz reiniciada para aplicar la latencia: se recupera la sesión');
      await this.restore(prev, { silent: true });
      const lat = LATENCY[a.settings.latency] || LATENCY.normal;
      toast(`Latencia ${lat.label} aplicada: ${realLatencyMs(a.engine.ctx)} ms reales. Los temas siguen en su sitio, en pausa`, 'ok', 5000, null, { kind: 'critical' });
    } else {
      const o = shouldOffer(prev, now);
      if (o.offer) {
        // registro técnico: solo cuándo y cuántos decks (sin rutas ni nombres de temas)
        a.feedback?.log('WARN', 'sesion', `La sesión anterior se cerró de forma inesperada (hace ${o.ageMin} min, ${o.loaded} deck(s) con tema${/tras=cierre/.test(query) ? '; la interfaz se ha recargado tras cerrarse o colgarse' : ''})`);
        this.offer(prev, o);
      } else if (/tras=cierre/.test(query)) a.feedback?.log('WARN', 'sesion', 'La interfaz se ha recargado tras cerrarse o colgarse');
    }
    // hasta decidir, no se pisa la instantánea anterior (por si se vuelve a cerrar antes de contestar)
    this.timer = setInterval(() => { if (!this.card) this.save(); }, SNAPSHOT_EVERY_MS);
  }
  changed() { if (this.card) return; const k = snapshotKey(this.snapshot()); if (k !== this.key) this.saveSoon(); }
  // Escritura atómica en el proceso principal (temporal + renombrar, en cola): no bloquea la interfaz
  save(extra = null) {
    const s = { ...this.snapshot(), ...(extra || {}) };
    this.key = snapshotKey(s);
    this.last = s;
    return platform.storeSet('sesion', s).catch(() => false);
  }
  // Cierre limpio (al salir bien): ya no se ofrecerá recuperar
  markClean() { if (this.card) return platform.storeSet('sesion', { ...(this.prevPending || {}), clean: true }).catch(() => false); return this.save({ clean: true }); }

  offer(prev, o) {
    const a = this.app;
    const plan = planRestore(prev, (id) => a.library.getAny(id));
    this.prevPending = prev;
    const detail = describePlan(plan);
    const close = () => { if (this.card) { this.card.remove(); this.card = null; } };
    const yes = btn('Recuperar', { cls: 'small primary rec-yes', onClick: async () => { yes.disabled = true; close(); a.feedback?.log('INFO', 'sesion', 'Recuperar la sesión: sí'); await this.restore(prev); this.save(); } });
    const no = btn('Descartar', { cls: 'small rec-no', onClick: () => { close(); a.feedback?.log('INFO', 'sesion', 'Recuperar la sesión: descartada'); this.save(); } });
    this.card = el('div', { class: 'recover-card', id: 'recover-card', role: 'dialog', 'aria-labelledby': 'recover-title' },
      el('div', { class: 'rc-text' },
        el('b', { id: 'recover-title' }, 'La última sesión se cerró de forma inesperada. ¿Recuperarla?'),
        el('span', {}, `${detail}. Se cargan en su sitio y en pausa: nada empieza a sonar solo.${o.ageMin >= 1 ? ` (Hace ${o.ageMin < 120 ? o.ageMin + ' min' : Math.round(o.ageMin / 60) + ' h'}.)` : ''}`)),
      el('div', { class: 'rc-actions' }, yes, no));
    document.body.appendChild(this.card);
  }

  // Los mismos temas en sus decks, en su posición y EN PAUSA. Lo que no se pueda (pista borrada, archivo perdido)
  // se indica y el resto se recupera igual
  async restore(prev, { silent = false } = {}) {
    const a = this.app, L = a.library;
    const plan = planRestore(prev, (id) => L.getAny(id));
    // archivos locales que ya no están en el disco
    const locals = plan.filter(p => p.status === 'ok' && p.track.source === 'local');
    const ex = locals.length ? await platform.existsMany(locals.map(p => p.track.path)).catch(() => null) : null;
    if (ex) locals.forEach((p, i) => { if (ex[i] === false) { p.status = 'missing'; p.why = 'archivo'; } });
    if (prev.deckCount === 4 && a.deckCount !== 4 && plan.some(p => p.idx > 1 && p.status !== 'missing')) { a.settings.deckLayout = a.settings.deckLayout === '2' ? '4' : a.settings.deckLayout; }
    if (prev.view && prev.view !== a.screenView) a.setScreenView(prev.view);
    if (prev.decks.some(d => d) && typeof prev.decks.find(d => d)?.quantize === 'boolean') a.settings.quantize = prev.decks.find(d => d).quantize;
    // mezcla: faders, crossfader, EQ y filtro
    const m = prev.mixer;
    if (m) {
      (m.ch || []).forEach((v, i) => { const ch = a.engine.channels[i]; if (!ch || !v) return; for (const k of ['trim', 'high', 'mid', 'low', 'filter', 'fader']) if (typeof v[k] === 'number') ch.set(k, v[k]); });
      if (typeof m.xf === 'number') a.engine.setCrossfader(m.xf);
      a.mixerUI?.refresh?.();
    }
    const done = [], lost = [];
    for (const p of plan) {
      if (p.status === 'missing') { lost.push(p); continue; }
      const d = a.decks[p.idx], st = p.state;
      try {
        await a.loadToDeck(p.id, p.idx, { auto: true, restore: true });
        if (d.track !== p.track) { lost.push({ ...p, why: 'carga' }); continue; }
        if (d.playing) d.pause();
        if (st.range && st.range !== d.range) d.setRange(st.range);
        if (typeof st.pitch === 'number' && !st.sync) d.setPitchFader(st.pitch);
        if (!!st.keylock !== !!d.keylock) d.toggleKeylock();
        d.cuePoint = Math.max(0, st.cue || 0);
        d.seek(Math.max(0, st.pos || 0));
        if (st.loop && st.loop.e > st.loop.s) d.setLoop(st.loop.s, st.loop.e, true);
        if (st.sync) d.setSync(true);
        d.emit('state');
        done.push(p);
      } catch (e) { lost.push({ ...p, why: 'carga' }); console.warn('recuperar', e); }
    }
    const master = plan.find(p => p.state.master && done.includes(p));
    if (master && a.syncMgr?.setMaster) a.syncMgr.setMaster(a.decks[master.idx]);
    // nunca suena solo
    a.decks.forEach(d => { if (d.playing) d.pause(); });
    a.feedback?.log('INFO', 'sesion', `Sesión recuperada: ${done.length} deck(s)${lost.length ? `, ${lost.length} sin recuperar` : ''}${done.some(p => p.status === 'youtube') ? ' (con YouTube)' : ''}`);
    if (!silent || lost.length) {
      const yt = done.filter(p => p.status === 'youtube');
      toast(`Sesión recuperada: ${done.length === 1 ? '1 tema' : done.length + ' temas'} en pausa, en su sitio${yt.length ? ` (YouTube en el deck ${yt.map(p => p.idx + 1).join(', ')}: vuelve a cargarse de internet)` : ''}`, 'ok', 6000, null, { kind: 'critical' });
      if (lost.length) toast(`No se ha podido recuperar el deck ${lost.map(p => p.idx + 1).join(', ')}: ${lost.some(p => p.why === 'archivo') ? 'el archivo ya no está en el disco' : 'el tema ya no está en la biblioteca'}`, 'warn', 8000, null, { kind: 'critical' });
    }
    return { done: done.length, lost: lost.length };
  }
}

// ---------------------------------------------------------------------------------------------- carga y cortes
export class LoadUI {
  constructor(app) {
    this.app = app;
    this.meter = app.loadMeter = new LoadMeter();
    this.pill = el('button', { class: 'status-pill load-pill green', id: 'load-pill', type: 'button', 'aria-describedby': 'load-pop' }, 'CPU —');
    this.pop = el('div', { class: 'load-pop', id: 'load-pop', role: 'tooltip', hidden: true });
    const show = () => { this.renderPop(); this.pop.hidden = false; this.place(); };
    const hide = () => { this.pop.hidden = true; };
    this.pill.addEventListener('mouseenter', show); this.pill.addEventListener('focus', show);
    this.pill.addEventListener('mouseleave', hide); this.pill.addEventListener('blur', hide);
    this.pill.addEventListener('click', () => app.settingsUI.open('audio'));
    document.body.appendChild(this.pop);
    this.timer = setInterval(() => this.tick(), 500);
  }
  place() {
    const r = this.pill.getBoundingClientRect(), w = this.pop.offsetWidth || 300;
    this.pop.style.top = Math.round(r.bottom + 6) + 'px';
    this.pop.style.left = Math.round(Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))) + 'px';
  }
  // Reloj del audio frente al del sistema (cortes) y estadísticas del navegador si las hay
  sample() {
    const ctx = this.app.engine?.ctx;
    if (!ctx || ctx.state !== 'running') { this.meter.lastPair = null; this.meter.base = null; return; }
    let ctxMs, perfMs;
    try {
      const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) { ctxMs = ts.contextTime * 1000; perfMs = ts.performanceTime; }
    } catch (_) { /* sin marca de tiempo */ }
    if (ctxMs == null) { ctxMs = ctx.currentTime * 1000; perfMs = performance.now(); }
    // vaivén normal = el búfer del AudioContext (baseLatency); la latencia de salida del dispositivo es fija y no cuenta
    const buf = (ctx.baseLatency || 0.01) * 1000;
    const g = this.meter.clockPair(ctxMs + (this.simLag || 0), perfMs, Date.now(), buf);
    if (g) this.app.feedback?.log('WARN', 'rendimiento', `Corte de audio detectado (${g} ms de retraso del audio)`);
    const ps = ctx.playbackStats;
    if (ps && typeof ps.underrunEvents === 'number') this.meter.underruns(ps.underrunEvents);
  }
  // (pruebas) simular un corte: el reloj del audio «se queda atrás» ms milisegundos
  simulateGlitch(ms = 40) { this.simLag = (this.simLag || 0) - ms; this.sample(); this.sample(); }
  tick() {
    this.sample();
    const r = this.meter.tick();
    const pct = Math.round(r.load * 100);
    const txt = `CPU ${!pct && r.load > 0 ? '<1' : pct} %`;
    if (this.pill.textContent !== txt) this.pill.textContent = txt;
    this.pill.className = 'status-pill load-pill ' + r.level;
    if (r.changed) this.overload(r.overloaded);
    if (!this.pop.hidden) this.renderPop();
  }
  // Audio al límite: análisis en segundo plano en pausa, ondas a menos fps y aviso con «Subir latencia a Segura»
  overload(on) {
    const a = this.app;
    a.loadReduced = on;
    document.body.classList.toggle('load-high', on);
    a.feedback?.log(on ? 'WARN' : 'INFO', 'rendimiento', on ? `Audio al límite (carga ${Math.round(this.meter.load * 100)} %, cortes en el último minuto: ${this.meter.recentGlitches()}): se pausan los análisis en segundo plano y se bajan los fps de las ondas` : 'Carga de audio normal otra vez');
    if (on) this.notice(); else this.hideNotice(4000);
  }
  notice() {
    const a = this.app;
    this.hideNotice(0);
    const safe = a.settings.latency === 'safe';
    const close = btn('✕', { cls: 'micro', title: 'Cerrar el aviso', onClick: () => this.hideNotice(0) });
    close.setAttribute('aria-label', 'Cerrar el aviso');
    const glitches = this.meter.recentGlitches();
    this.box = el('div', { class: 'load-notice', id: 'load-notice', role: 'status' },
      el('span', {}, glitches ? `Cortes de audio (${glitches} en el último minuto): el equipo va justo.` : 'El audio va al límite del equipo.', el('small', {}, ' Análisis en pausa y ondas más ligeras.')),
      safe ? null : btn('Subir latencia a Segura', { cls: 'micro primary load-safe', onClick: () => { this.hideNotice(0); a.setLatency('safe'); } }),
      close);
    document.body.appendChild(this.box);
  }
  hideNotice(ms) {
    clearTimeout(this.noticeT);
    const b = this.box; if (!b) return;
    const go = () => { if (this.box === b) { b.remove(); this.box = null; } };
    if (ms) this.noticeT = setTimeout(go, ms); else go();
  }
  renderPop() {
    const a = this.app, m = this.meter, ctx = a.engine?.ctx;
    const fps = a.perfDiag ? a.perfDiag.fpsNow() : 0;
    const lat = a.settings.latency || 'normal';
    const g = m.recentGlitches(), gAll = m.glitches.length;
    const last = m.glitches.length ? m.glitches[m.glitches.length - 1] : null;
    const ago = last ? Math.round((Date.now() - last.at) / 1000) : null;
    const line = (k, v, cls = '') => el('div', { class: 'lp-row ' + cls }, el('span', {}, k), el('b', {}, v));
    this.pop.innerHTML = '';
    this.pop.append(
      el('div', { class: 'lp-title' }, 'Rendimiento del audio'),
      line('Carga del audio (decks)', `${Math.round(m.load * 100)} % · máx. ${Math.round(m.peak * 100)} %`, m.load > 0.7 ? 'bad' : m.load > 0.5 ? 'warn' : ''),
      line('Cortes de audio', gAll ? `${g} en el último minuto · ${gAll} en total${ago != null ? ` (último hace ${ago < 120 ? ago + ' s' : Math.round(ago / 60) + ' min'})` : ''}` : 'ninguno', g ? 'bad' : ''),
      line('Fluidez de la interfaz', fps ? `${fps} fps${a.loadReduced ? ' (reducida)' : ''}` : '—'),
      line('Latencia', `${(LATENCY[lat] || LATENCY.normal).label} · real ${realLatencyMs(ctx)} ms`),
      el('p', { class: 'lp-hint' }, m.overloaded ? 'Al límite: análisis en segundo plano en pausa y ondas a menos fps hasta que pase el pico.' : 'Carga = tiempo que tardan los decks en preparar el audio frente a lo que dura. Por encima del 70 % o con cortes, sube la latencia a «Segura» (Ajustes → Audio).'));
    this.place();
  }
}
