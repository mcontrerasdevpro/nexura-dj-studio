// Autoplay sobre un crate (como el botón «Autoplay» de otros programas DJ): pincha solas las canciones
// de la vista abierta en la biblioteca (crate, subcrate, Prepare, smart crate, «Todas las pistas», listas
// de YouTube o de Spotify), en el orden de la tabla o al azar. A diferencia del Automix (ai/automix.js)
// no elige pistas con la IA: sigue la lista. La cola es pura (autoplay-core.js); aquí se cargan las
// pistas en los decks 1/2 (o la pareja visible con 4 decks), alternando, y se hace la transición:
// seguida, fundido de N s o mezcla con sync (las mismas curvas e intercambio de graves del Automix).
import { Emitter, clamp } from '../util.js';
import { AutoplayQueue, autoplayOptions, transitionStart, fadeLevels, autoplayLabel } from './autoplay-core.js';

const IDLE_STOP_MS = 5000;   // los dos decks en pausa más de este tiempo → el Autoplay se detiene
const STALL_MS = 8000;       // un vídeo de YouTube que no avanza (bloqueado, error) → se salta

const trackTitle = (t) => t ? (t.artist ? `${t.artist} – ${t.title || '—'}` : t.title || '—') : '';

export class Autoplay extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    this.on_ = false;
    this.gen = 0;           // cambia al parar/empezar: invalida las cargas asíncronas en curso
    this.reset();
  }
  reset() {
    this.queue = null; this.source = null; this.pair = null;
    this.mix = null;        // transición en curso { kind, from, to, start, len, saved, swapped }
    this.ready = null;      // siguiente pista ya cargada { deck, id, index, title }
    this.playing = null;    // pista que suena { id, index, title }
    this.busy = false; this.force = false; this.ending = false;
    this.idleSince = 0; this.lastCur = null; this.stall = null;
  }
  get enabled() { return this.on_; }
  get opts() { return autoplayOptions(this.app.settings.autoplay); }
  setOption(k, v) {
    this.app.setSetting('autoplay', autoplayOptions({ ...this.opts, [k]: v }));
    if (k === 'repeat' && this.queue) { this.queue.repeat = !!v; this.queue.nextSeq = null; if (v) this.ending = false; }
    this.emit('change');
  }

  // Vista abierta en la biblioteca, tal cual se ve (orden de columna y búsqueda incluidos)
  sourceFromView() {
    const ui = this.app.libraryUI;
    const sel = ui.cursor >= 0 || ui.sel.size ? ui.current() : null;
    return { viewId: ui.viewId, name: ui.viewName() || 'Biblioteca', ids: ui.rows.map(t => t.id), startId: sel ? sel.id : null };
  }

  toggle() { return this.on_ ? this.stop() : this.start(); }

  async start() {
    const app = this.app, src = this.sourceFromView();
    if (!src.ids.length) { app.toast(`Autoplay: «${src.name}» no tiene pistas. Abre un crate con canciones.`, 'warn'); return false; }
    const o = this.opts;
    // ¿ya suena algo? (cualquier deck, también el 3 o el 4): esa pista sigue y el Autoplay continúa desde su deck
    const E0 = app.engine;
    const live = app.decks.filter(d => d.playing && d.track).sort((a, b) => E0.effectiveGain(b.idx) - E0.effectiveGain(a.idx))[0] || null;
    const liveId = live && src.ids.includes(live.track.id) ? live.track.id : null;
    const queue = new AutoplayQueue(src.ids, { order: o.order, repeat: o.repeat, startId: o.order === 'list' ? src.startId : null, currentId: liveId, skip: o.skipPlayed ? [...app.library.playedIds()].filter(id => id !== liveId) : [] });
    if (!queue.available) { app.toast(`Autoplay: ya se han tocado todas las pistas de «${src.name}» en esta sesión`, 'warn'); return false; }
    if (this.on_) this.stop(true);
    if (app.automix.enabled) { app.automix.toggle(false); app.toast('Automix desactivado: ahora pincha el Autoplay', 'info'); }
    this.reset();
    this.gen++;
    this.queue = queue; this.source = src;
    const L = app.layers || [0, 1];
    // la pareja de decks incluye siempre el que está sonando (y el visible del otro lado)
    this.pair = live ? (live.idx % 2 === 0 ? [live, app.decks[L[1]]] : [app.decks[L[0]], live]) : [app.decks[L[0]], app.decks[L[1]]];
    // key lock en los dos decks, como el Automix (al sincronizar no cambian las tonalidades). En el deck
    // que ya suena no se toca (cambiaría el tono de lo que se oye): se pone cuando vuelva a entrar (begin)
    this.savedKeylock = this.pair.map(d => d.keylock);
    this.pair.forEach(d => { if (d !== live) this.lockKey(d); });
    this.on_ = true;
    const tr = { gapless: 'seguidas', fade: `fundido de ${o.fadeSecs} s`, sync: 'mezcla con sync' }[o.transition];
    app.toast(`Autoplay: «${src.name}» · ${queue.available} pistas · ${o.order === 'shuffle' ? 'aleatorio' : 'en orden'} · ${tr}`, 'ok', 4500);
    this.emit('change');
    if (live) {
      // ya suena algo: esa pista SIGUE sonando en su deck (sin tocar fader, tempo ni key lock); la siguiente
      // de la lista se prepara en el otro deck y entra con la transición elegida al final de la actual.
      // Si la que suena no es de la lista, al acabar empieza la lista (por la seleccionada o la primera)
      const other = this.other(live);
      // el otro deck se para solo si no se oye (fader bajado, crossfader al otro lado); si se oye, el
      // Autoplay espera a que acabe una de las dos, como cuando el usuario arranca los dos decks
      if (other.playing && E0.effectiveGain(other.idx) < 0.02) other.pause();
      this.lastCur = live;
      this.playing = { id: live.track.id, index: liveId ? queue.index : 0, title: trackTitle(live.track) };
      this.emit('change');
    } else await this.startFirst();
    return true;
  }
  lockKey(d) { if (d && !d.keylock) d.toggleKeylock(); }

  // Nada suena: carga la primera pista en un deck y la pone en marcha
  async startFirst() {
    const g = this.gen, E = this.app.engine;
    const deck = this.pair.find(d => !d.track) || this.pair[0];
    this.busy = true;
    try {
      const r = await this.loadNext(deck);
      if (g !== this.gen) return;
      if (!r) { if (this.ending) this.stop(false, 'Autoplay: no se pudo cargar ninguna pista de la lista', 'warn'); return; }
      E.channels[deck.idx].set('fader', 1);
      this.ensureAudible(deck);
      if (deck.sync) deck.setSync(false);
      if (!deck.isYT) deck.resetTempo();
      deck.seek(0);
      deck.play();
      this.playing = r; this.lastCur = deck;
      this.emit('change');
    } finally { if (g === this.gen) this.busy = false; }
  }

  // Avanza en la cola y carga en «deck» la siguiente pista que se pueda cargar (las que fallan se saltan)
  async loadNext(deck) {
    const app = this.app, g = this.gen;
    for (let n = 0; n < 8; n++) {
      const id = this.queue.next();
      if (!id) { this.ending = true; return null; }
      const t = app.library.get(id);
      const entry = { id, index: this.queue.index, title: trackTitle(t) };
      if (!t) { this.queue.fail(id); continue; }
      if (!(deck.track === t && !deck.playing)) await app.loadToDeck(id, deck.idx);
      if (g !== this.gen) return null;
      if (deck.track && deck.track.id === id) return entry;
      this.queue.fail(id);
      app.toast(`Autoplay: no se pudo cargar «${entry.title}»; paso a la siguiente`, 'warn', 5000);
    }
    return null;
  }

  preload(deck) {
    const g = this.gen;
    this.busy = true;
    this.loadNext(deck).then((r) => {
      if (g !== this.gen) return;
      if (r) {
        this.ready = { ...r, deck };
        // en la mezcla con sync la entrada es la intro (o el primer beat), como en el Automix
        deck.seek(this.kindFor(this.lastCur, deck) === 'sync' ? this.app.automix.mixIn(deck.track) : 0);
      }
      this.emit('change');
    }).catch(e => console.error('autoplay', e)).finally(() => { if (g === this.gen) this.busy = false; });
  }

  // Deck que suena y manda (el de más volumen efectivo de la pareja; a igualdad, el último que entró:
  // en la transición seguida la anterior suena aún unas décimas)
  current() {
    const E = this.app.engine;
    const playing = (this.pair || []).filter(d => d.playing && d.track);
    const score = (d) => E.effectiveGain(d.idx) + (d === this.lastCur ? 1e-3 : 0);
    return playing.sort((a, b) => score(b) - score(a))[0] || null;
  }
  other(d) { return this.pair.find(x => x !== d) || this.pair[0]; }
  isReady(d) { return !!(this.ready && this.ready.deck === d && d.track && d.track.id === this.ready.id); }
  // con el crossfader del todo hacia el otro lado la pista entrante no se oiría: se centra
  ensureAudible(d) {
    const E = this.app.engine;
    if ((E.xfGains()[E.channels[d.idx].values.xfAssign] ?? 1) < 0.5) E.setCrossfader(0.5);
  }
  // YouTube no tiene audio procesable: sin sync, solo fundido de volumen
  kindFor(from, to) {
    const k = this.opts.transition;
    if (k !== 'sync') return k;
    const ok = (d) => d && d.track && !d.isYT && d.track.bpm;
    return ok(from) && ok(to) ? 'sync' : 'fade';
  }
  startAt(cur, kind) {
    if (kind === 'sync') return this.app.automix.mixOutTime(cur);
    return transitionStart(kind, cur.duration, { fadeSecs: this.opts.fadeSecs, tempo: cur.tempo || 1 });
  }

  // Llamado cada 100 ms desde la app
  tick() {
    if (!this.on_) return;
    if (this.mix) return this.stepMix();
    if (this.busy) return;
    const now = performance.now();
    const cur = this.current();
    if (!cur) {
      const last = this.lastCur;
      const ended = last && last.track && last.duration > 0 && last.time >= last.duration - 0.6;
      if (ended || this.force) {
        const nxt = last ? this.other(last) : this.pair[0];
        if (this.isReady(nxt)) return this.begin(last, nxt, 'cut');
        if (this.ending) return this.stop(false, `Autoplay terminado: se acabó «${this.source.name}»`, 'ok');
        return this.preload(nxt);
      }
      // el usuario ha pausado: si sigue todo parado unos segundos, el Autoplay se detiene
      if (!this.idleSince) this.idleSince = now;
      else if (now - this.idleSince > IDLE_STOP_MS) this.stop(false, 'Autoplay detenido: los dos decks están en pausa', 'info');
      return;
    }
    this.idleSince = 0;
    // el usuario ha cargado otra pista en el deck que suena: se sigue con la lista al terminar
    if (this.playing && cur === this.lastCur && cur.track.id !== this.playing.id) this.playing = { ...this.playing, id: cur.track.id, title: trackTitle(cur.track) };
    this.lastCur = cur;
    if (cur.isYT && this.stalled(cur, now)) return;
    const nxt = this.other(cur);
    if (nxt.playing) return;   // los dos suenan (lo ha decidido el usuario): se espera a que pare uno
    if (!this.isReady(nxt)) { if (!this.ending) this.preload(nxt); return; }
    const kind = this.kindFor(cur, nxt);
    if (this.force) return this.begin(cur, nxt, kind === 'gapless' ? 'cut' : kind);
    if (cur.time >= this.startAt(cur, kind)) this.begin(cur, nxt, kind);
  }

  // vídeo de YouTube que no avanza (error de reproducción, bloqueado): se pasa a la siguiente
  stalled(d, now) {
    const t = d.time;
    if (!this.stall || this.stall.deck !== d || Math.abs(t - this.stall.t) > 0.05) { this.stall = { deck: d, t, at: now }; return false; }
    if (now - this.stall.at < STALL_MS) return false;
    this.stall = null;
    this.app.toast(`Autoplay: «${trackTitle(d.track)}» no avanza; paso a la siguiente`, 'warn', 5000);
    d.pause();
    this.lastCur = d; this.force = true;
    return true;
  }

  begin(from, to, kind) {
    const E = this.app.engine, o = this.opts;
    this.force = false;
    this.playing = this.ready ? { id: this.ready.id, index: this.ready.index, title: this.ready.title } : { id: to.track.id, index: 0, title: trackTitle(to.track) };
    this.ready = null;
    this.ensureAudible(to);
    if (!to.playing) this.lockKey(to);
    if (to.sync && kind !== 'sync') to.setSync(false);
    if (kind !== 'sync' && !to.isYT) to.resetTempo();
    if (kind === 'cut' || kind === 'gapless') {
      // seguida: la nueva entra justo al acabar la anterior (cut = la anterior ya ha terminado o se salta)
      E.channels[to.idx].set('fader', 1);
      to.play();
      if (from && from !== to && kind === 'cut' && from.playing) from.pause();
      if (from && from !== to) E.channels[from.idx].set('fader', 1);
      this.lastCur = to;
      this.emit('change');
      return;
    }
    if (kind === 'sync') {
      const len = from.beatsSec(this.app.automix.bars * 4) / (from.tempo || 1);
      const saved = { fromLow: E.channels[from.idx].values.low, toLow: E.channels[to.idx].values.low };
      to.seek(this.app.automix.mixIn(to.track));
      to.setSync(true);
      E.channels[to.idx].set('fader', 0);
      E.channels[to.idx].set('low', 0);   // entra sin graves
      to.play();
      this.mix = { kind, from, to, start: performance.now(), len, saved, swapped: false };
    } else {
      E.channels[to.idx].set('fader', 0);
      to.play();
      this.mix = { kind: 'fade', from, to, start: performance.now(), len: o.fadeSecs, saved: null };
    }
    this.lastCur = to;
    this.emit('change');
  }

  stepMix() {
    const m = this.mix, E = this.app.engine;
    if (!m.to.playing) { this.abortMix(); return; }   // el usuario ha parado la entrante
    const p = clamp((performance.now() - m.start) / 1000 / Math.max(0.1, m.len), 0, 1);
    if (m.kind === 'sync') {
      // las curvas del Automix: la nueva sube en la primera mitad, la anterior baja en la segunda
      E.channels[m.to.idx].set('fader', clamp(p * 2, 0, 1));
      E.channels[m.from.idx].set('fader', clamp(2 - p * 2, 0, 1));
      if (!m.swapped && p >= 0.5) {
        E.channels[m.from.idx].set('low', 0);
        E.channels[m.to.idx].set('low', m.saved.toLow ?? 0.5);
        m.swapped = true;
      }
    } else {
      const lv = fadeLevels(p);
      E.channels[m.to.idx].set('fader', lv.to);
      E.channels[m.from.idx].set('fader', lv.from);
    }
    if (p >= 1) this.finishMix();
  }
  finishMix() {
    const m = this.mix, E = this.app.engine;
    if (!m) return;
    if (m.from.playing) m.from.pause();
    E.channels[m.from.idx].set('fader', 1);
    E.channels[m.to.idx].set('fader', 1);
    if (m.saved) {
      E.channels[m.from.idx].set('low', m.saved.fromLow ?? 0.5);
      E.channels[m.to.idx].set('low', m.saved.toLow ?? 0.5);
    }
    if (m.kind === 'sync' && m.to.sync) m.to.setSync(false);
    this.mix = null;
    this.emit('change');
  }
  abortMix() {
    const m = this.mix, E = this.app.engine;
    if (!m) return;
    E.channels[m.from.idx].set('fader', 1);
    E.channels[m.to.idx].set('fader', 1);
    if (m.saved) {
      E.channels[m.from.idx].set('low', m.saved.fromLow ?? 0.5);
      E.channels[m.to.idx].set('low', m.saved.toLow ?? 0.5);
    }
    if (m.to.sync) m.to.setSync(false);
    this.lastCur = m.from.playing ? m.from : m.to;
    this.mix = null;
    this.emit('change');
  }

  // Siguiente ⏭: pasa ya a la siguiente pista con la transición elegida
  skip() {
    if (!this.on_) { this.app.toast('El Autoplay no está activo (▶ AUTOPLAY o Mayús+F7)', 'info'); return false; }
    if (this.mix) this.finishMix();
    if (this.ending && !this.ready) { this.app.toast('Autoplay: no quedan más pistas en la lista', 'info'); return false; }
    this.force = true;
    this.app.toast('Autoplay: siguiente »');
    return true;
  }

  // Parar: la canción que suena sigue sonando; si había una transición, se completa en el acto
  stop(silent = false, msg = 'Autoplay parado (la canción actual sigue sonando)', type = 'info') {
    if (!this.on_) return;
    if (this.mix) this.finishMix();
    if (this.savedKeylock && this.pair) this.pair.forEach((d, i) => { if (d.keylock !== this.savedKeylock[i]) d.toggleKeylock(); });
    this.savedKeylock = null;
    this.on_ = false;
    this.gen++;
    this.reset();
    if (!silent) this.app.toast(msg, type, 4500);
    this.emit('change');
  }

  nextTitle() {
    if (!this.queue) return '';
    if (this.ready) return this.ready.title;
    if (this.ending) return 'fin de la lista';
    const id = this.queue.peek();
    return id ? trackTitle(this.app.library.get(id)) : 'fin de la lista';
  }
  // «AUTOPLAY · Dance › Años 80 · 3/120 · siguiente: …»
  status() {
    if (!this.on_) return '';
    let s = autoplayLabel({ source: this.source.name, index: this.playing ? this.playing.index : 0, total: this.queue.total, next: this.nextTitle() });
    if (this.mix) s += ` · ${this.mix.kind === 'sync' ? 'mezclando' : 'fundido'} ${Math.round(clamp((performance.now() - this.mix.start) / 1000 / this.mix.len, 0, 1) * 100)} %`;
    return s;
  }
}
