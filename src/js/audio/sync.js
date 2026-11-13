// Maestro del SYNC (como en las cabinas profesionales): hay un solo deck maestro y los decks con SYNC siguen
// su tempo y su fase. El maestro es el primero que suena (automático) o el que se elige con su botón MASTER
// (elegido: se queda aunque pare, hasta expulsar la pista). Automático: si el maestro para y otro deck suena
// (primero los que tienen SYNC), pasa a ese; al cargar otra pista en el maestro con otro deck sonando,
// también (así los demás no saltan al BPM de la pista nueva). Los vídeos de YouTube nunca son maestro.
// `tick()` (cada SYNC_TICK_MS) mantiene el maestro y llama a `Deck.syncTick()` en cada deck (corrección
// continua de tempo y fase).
import { clamp } from '../util.js';

export const SYNC_TICK_MS = 20;

export class SyncManager {
  constructor(app) {
    this.app = app;
    this.idx = null;       // índice del deck maestro
    this.explicit = false; // elegido con el botón MASTER
  }
  decks() { return this.app.activeDecks || this.app.decks; }
  eligible(d) { return !!(d && d.track && d.bpm > 0 && !d.isYT); }
  get current() { const d = this.idx != null ? this.app.decks[this.idx] : null; return this.eligible(d) ? d : null; }
  // maestro al que sigue el deck d (null si d es el maestro o no hay)
  master(d) { const m = this.current; return m && m !== d ? m : null; }
  isMaster(d) { return this.current === d; }

  set(d, explicit = false) {
    const prev = this.current;
    this.idx = d ? d.idx : null;
    this.explicit = !!(d && explicit);
    if (d && d !== prev) {
      // el fader de pitch del maestro nuevo pasa a mostrar su tempo actual (no salta)
      d.pitch = clamp((d.tempo - 1) / d.range, -1, 1);
      d.emit('tempo');
    }
    if (d !== prev) { this.decks().forEach(o => o.emit('state')); if (this.app.emit) this.app.emit('syncMaster', d); }
  }
  // Botón MASTER: este deck pasa a ser el maestro; los que tienen SYNC se ajustan a él
  setMaster(d) {
    if (!this.eligible(d)) { if (d && d.isYT) this.app.toast('Un vídeo de YouTube no puede ser el maestro del sync', 'warn'); return false; }
    this.set(d, true);
    for (const o of this.decks()) if (o !== d && o.sync) o.syncNow(true);
    return true;
  }
  // primero que suena entre `list` (los que sonaban antes, primero)
  firstPlaying(list) { return list.filter(o => o.playing).sort((a, b) => a.playStartedAt - b.playStartedAt)[0] || null; }
  // Al activar SYNC en d: si no hay maestro, el que suena (o el otro deck cargado; si no hay otro, d)
  ensure(d) {
    if (this.current) return;
    const others = this.decks().filter(o => o !== d && this.eligible(o));
    const pick = this.firstPlaying(others) || others.find(o => o.sync) || others[0] || (this.eligible(d) ? d : null);
    if (pick) this.set(pick, false);
  }
  // Al cargar una pista en el maestro con otro deck sonando, el maestro pasa al que suena
  beforeLoad(d) {
    if (this.current !== d) return;
    const others = this.decks().filter(o => o !== d && this.eligible(o));
    const pick = this.firstPlaying(others.filter(o => o.sync)) || this.firstPlaying(others);
    if (pick) this.set(pick, false);
  }
  onPlay(d) { if (!this.current && this.eligible(d)) this.set(d, false); }

  tick() {
    const m = this.current;
    const live = this.decks().filter(o => this.eligible(o));
    if (!m) {
      if (this.idx != null) this.set(null);
      // automático: el primero que suena (con SYNC, si alguno lo tiene)
      const pick = this.firstPlaying(live.filter(o => o.sync)) || this.firstPlaying(live);
      if (pick) this.set(pick, false);
    } else if (!this.explicit && !m.playing) {
      const pick = this.firstPlaying(live.filter(o => o !== m && o.sync)) || this.firstPlaying(live.filter(o => o !== m));
      if (pick) this.set(pick, false);
    }
    for (const d of this.decks()) d.syncTick();
  }
}
