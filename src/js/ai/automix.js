// Automix IA (se excluye con el Autoplay sobre un crate, ai/autoplay.js): la app pincha sola. Elige la siguiente pista (Prepare primero, si no la sugerencia
// de la IA), la carga en el otro deck, la sincroniza y hace la transición en el outro con
// fundido de faders e intercambio de graves (la técnica clásica de «bass swap»).
import { Emitter, clamp } from '../util.js';

export class Automix extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    this.on_ = false;
    this.mix = null;        // transición en curso { from, to, start, len, saved }
    this.preparing = false;
    this.lastError = '';
  }
  get enabled() { return this.on_; }
  get bars() { return clamp(this.app.settings.automixBars || 16, 4, 64); }

  toggle(v = !this.on_) {
    this.on_ = !!v;
    if (this.on_) {
      // Automix y Autoplay se excluyen
      if (this.app.autoplay && this.app.autoplay.enabled) { this.app.autoplay.stop(true); this.app.toast('Autoplay desactivado: ahora pincha el Automix', 'info'); }
      const L = this.app.layers || [0, 1];
      this.pair = [this.app.decks[L[0]], this.app.decks[L[1]]];
      // Key lock en ambos decks: al sincronizar tempos no cambian las tonalidades que eligió la IA
      this.savedKeylock = this.pair.map(d => d.keylock);
      this.pair.forEach(d => { if (!d.keylock) d.toggleKeylock(); });
      const cur = this.current();
      if (!cur) {
        // Sin nada sonando: arranca con la primera de Prepare o la seleccionada en la biblioteca
        const first = this.pickFirst();
        if (!first) {
          this.pair.forEach((d, i) => { if (d.keylock !== this.savedKeylock[i]) d.toggleKeylock(); });
          this.on_ = false; this.pair = null; this.app.toast('Automix: carga o selecciona una pista para empezar', 'warn'); this.emit('change'); return;
        }
        this.startWith(first);
      }
      this.app.toast(`Automix activado en los decks ${this.pair[0].idx + 1} y ${this.pair[1].idx + 1} · transiciones de ${this.bars} compases`, 'ok');
    } else {
      this.abort();
      if (this.savedKeylock && this.pair) this.pair.forEach((d, i) => { if (d.keylock !== this.savedKeylock[i]) d.toggleKeylock(); });
      this.pair = null;
      this.savedKeylock = null;
      this.app.toast('Automix desactivado');
    }
    this.emit('change');
  }

  pickFirst() {
    const L = this.app.library;
    const sel = this.app.libraryUI.current();
    if (sel && sel.source === 'local') return sel;
    return L.prepare.map(id => L.get(id)).find(t => t && t.source === 'local') || null;
  }
  async startWith(track) {
    const idx = (this.decks.find(d => !d.track) || this.decks.find(d => !d.playing) || this.decks[0]).idx;
    await this.app.loadToDeck(track.id, idx, { auto: true });
    const d = this.app.decks[idx];
    if (d.track !== track) return;
    this.app.engine.channels[idx].set('fader', 1);
    this.app.engine.setCrossfader(0.5);
    if (d.sync) d.setSync(false);
    d.resetTempo(); // el set se planificó con los tempos originales
    d.play();
  }

  // Deck que suena y manda (el de fader más alto)
  current() {
    const playing = this.decks.filter(d => d.playing && d.track && !d.isYT);
    if (!playing.length) return null;
    return playing.sort((a, b) => this.app.engine.effectiveGain(b.idx) - this.app.engine.effectiveGain(a.idx))[0];
  }
  other(d) { return this.decks.find(x => x !== d); }
  // el Automix trabaja con la pareja de decks visible (1/2, o 3/4 con 4 decks) y la fija al activarse
  get decks() {
    if (this.on_ && this.pair) return this.pair;
    const L = this.app.layers || [0, 1];
    return [this.app.decks[L[0]], this.app.decks[L[1]]];
  }

  // Punto de entrada de la siguiente pista: inicio de la intro (o primer beat)
  mixIn(t) {
    const intro = (t.sections || []).find(s => s.type === 'intro');
    return intro ? intro.t : (t.firstBeat || 0);
  }
  // Momento de empezar la transición en la pista que suena
  mixOutTime(d) {
    const t = d.track;
    const outro = (t.sections || []).find(s => s.type === 'outro');
    // duración de la transición según el grid (con BPM variable, la del tramo donde se mezcla)
    const len = d.beatsSec(this.bars * 4, outro ? outro.t : Math.max(0, d.duration - 30));
    let at = outro ? outro.t : d.duration - len - 4;
    if (at + len > d.duration - 1) at = d.duration - len - 1; // que la transición quepa
    return Math.max(d.duration * 0.4, at);
  }

  async nextTrack(cur) {
    const L = this.app.library;
    const loaded = new Set(this.app.decks.filter(d => d.track).map(d => d.track.id));
    const played = new Set((L.session ? L.session.entries : []).map(e => e.id));
    // 1) Prepare en orden (lo que el DJ ha preparado manda)
    for (const id of L.prepare) {
      const t = L.get(id);
      if (t && t.source === 'local' && !loaded.has(id) && !played.has(id)) return { track: t, from: 'Prepare' };
    }
    // 2) Sugerencia de la IA
    const s = this.app.ai.suggest(30).find(t => t.source === 'local' && !loaded.has(t.id));
    return s ? { track: s, from: 'IA' } : null;
  }

  // Llamado periódicamente desde la app
  async tick() {
    if (!this.on_) return;
    if (this.mix) return this.stepMix();
    const cur = this.current();
    if (!cur) return;
    const nxt = this.other(cur);
    if (nxt.playing || this.preparing) return;
    // Preparar la siguiente pista si el otro deck está vacío o tiene una ya pinchada
    const played = new Set((this.app.library.session ? this.app.library.session.entries : []).map(e => e.id));
    if (!nxt.track || nxt.isYT || played.has(nxt.track.id) || nxt.track === cur.track) {
      this.preparing = true;
      try {
        const pick = await this.nextTrack(cur);
        if (!pick) { this.lastError = 'sin pistas'; this.app.toast('Automix: no quedan pistas compatibles. Añade pistas a Prepare.', 'warn'); this.toggle(false); return; }
        await this.app.loadToDeck(pick.track.id, nxt.idx, { auto: true });
        if (nxt.track === pick.track) {
          nxt.seek(this.mixIn(pick.track));
          this.app.engine.channels[nxt.idx].set('fader', 0);
          this.app.toast(`Automix: siguiente → «${pick.track.title}» (${pick.from})`);
          this.emit('change');
        }
      } finally { this.preparing = false; }
      return;
    }
    if (cur.time >= this.mixOutTime(cur)) this.beginMix(cur, nxt);
  }

  beginMix(from, to) {
    const E = this.app.engine;
    const len = from.beatsSec(this.bars * 4) / (from.tempo || 1);
    const saved = { fromLow: E.channels[from.idx].values.low, toLow: E.channels[to.idx].values.low };
    to.seek(this.mixIn(to.track));
    if (to.bpm && from.bpm) to.setSync(true);
    E.channels[to.idx].set('fader', 0);
    E.channels[to.idx].set('low', 0);        // entra sin graves
    to.play();
    this.mix = { from, to, start: performance.now(), len, saved, swapped: false };
    this.emit('change');
  }

  stepMix() {
    const m = this.mix, E = this.app.engine;
    if (!m.from.playing && !m.to.playing) return this.abort();
    const p = clamp((performance.now() - m.start) / 1000 / m.len, 0, 1);
    // Curvas: la nueva sube en la primera mitad, la anterior baja en la segunda
    E.channels[m.to.idx].set('fader', clamp(p * 2, 0, 1));
    E.channels[m.from.idx].set('fader', clamp(2 - p * 2, 0, 1));
    if (!m.swapped && p >= 0.5) { // intercambio de graves a mitad de la transición
      E.channels[m.from.idx].set('low', 0);
      E.channels[m.to.idx].set('low', m.saved.toLow ?? 0.5);
      m.swapped = true;
    }
    if (p >= 1) this.finishMix();
  }

  finishMix() {
    const m = this.mix, E = this.app.engine;
    if (!m) return;
    m.from.pause();
    E.channels[m.from.idx].set('low', m.saved.fromLow ?? 0.5);
    E.channels[m.from.idx].set('fader', 1);
    E.channels[m.to.idx].set('fader', 1);
    if (m.to.sync) m.to.setSync(false);
    this.mix = null;
    this.emit('change');
  }

  abort() {
    const m = this.mix;
    if (!m) return;
    const E = this.app.engine;
    E.channels[m.from.idx].set('low', m.saved.fromLow ?? 0.5);
    E.channels[m.to.idx].set('low', m.saved.toLow ?? 0.5);
    E.channels[m.to.idx].set('fader', 1);
    this.mix = null;
    this.emit('change');
  }

  status() {
    if (!this.on_) return '';
    if (this.mix) return `AUTOMIX · mezclando ${Math.round(clamp((performance.now() - this.mix.start) / 1000 / this.mix.len, 0, 1) * 100)} %`;
    const cur = this.current();
    if (!cur) return 'AUTOMIX';
    const left = this.mixOutTime(cur) - cur.time;
    return left > 0 ? `AUTOMIX · transición en ${Math.ceil(left)} s` : 'AUTOMIX';
  }
}
