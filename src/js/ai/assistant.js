// Asistente IA de Nexura DJ Studio (100 % local, sin servicios externos):
// - sugerencia de la siguiente pista (ai/suggest-core.js: BPM en rango de mezcla, género, tonalidad Camelot y energía)
// - constructor de sets por curva de energía
// - cues automáticos a partir de la energía analizada (Inicio, Entrada, Drop, Break y Outro)
import { CUE_COLORS } from '../util.js';
import { autoCuePoints, mergeAutoCues, waveEnergy, waveOnset, curveEnergy } from './autocues-core.js';
import { transitionScore, rankSuggestions, ENERGY_MODES } from './suggest-core.js';

export { keyRelation, bpmRelation, genreRelation, transitionScore, ENERGY_MODES } from './suggest-core.js';

export class Assistant {
  constructor(app) {
    this.app = app;
    this.mode = app.settings.aiEnergyMode || 'keep';
    this.scores = new Map(); // id → { score, reasons }
  }

  // Deck de referencia: el último que suena, o el último cargado
  refDeck() {
    const decks = this.app.decks.filter(d => d.track);
    const playing = decks.filter(d => d.playing);
    return playing.length ? playing[playing.length - 1] : decks[decks.length - 1] || null;
  }

  candidates(exclude = new Set()) {
    return [...this.app.library.tracks.values()].filter(t => !exclude.has(t.id) && (t.bpm || t.camelot));
  }

  // Lista ordenada de sugerencias para la siguiente pista
  suggest(limit = 60) {
    const d = this.refDeck();
    this.scores.clear();
    if (!d) return [];
    const L = this.app.library;
    const exclude = new Set(this.app.decks.filter(x => x.track).map(x => x.track.id));
    for (const id of L.playedIds()) exclude.add(id);
    const from = d.track;
    // primero se filtra por BPM y solo se puntúa lo que se puede mezclar (rápido con decenas de miles de pistas)
    const list = rankSuggestions(from, L.tracks.values(), { refBpm: d.currentBpm || from.bpm, refKey: d.displayKey || from.camelot, mode: this.mode, exclude, limit });
    for (const s of list) this.scores.set(s.track.id, { score: s.score, reasons: s.reasons, why: s.why });
    return list.map(s => s.track);
  }
  setMode(m) { if (ENERGY_MODES[m]) { this.mode = m; this.app.setSetting('aiEnergyMode', m); } }

  // Constructor de sets: encadena pistas maximizando transiciones y siguiendo una curva de energía
  buildSet(start, count = 15, curve = 'up', pool = null) {
    const list = [start];
    const used = new Set([start.id]);
    const cands = (pool || this.candidates()).filter(t => t.id !== start.id);
    for (let i = 1; i < count; i++) {
      const prev = list[list.length - 1];
      const pos = i / Math.max(1, count - 1);
      const mode = curve === 'up' ? 'up' : curve === 'down' ? 'down' : curve === 'wave' ? (pos < 0.7 ? 'up' : 'down') : 'keep';
      let best = null, bestS = -1;
      for (const t of cands) {
        if (used.has(t.id)) continue;
        let { score } = transitionScore(prev, t, { mode: i % 3 === 0 || curve !== 'up' ? mode : 'keep' });
        if (t.artist && t.artist === prev.artist) score -= 0.08; // variedad
        // respetar la curva: no bajar energía al subir ni subirla al bajar
        if (prev.energy && t.energy) {
          if (mode === 'up' && t.energy < prev.energy) score -= 0.12 * (prev.energy - t.energy);
          if (mode === 'down' && t.energy > prev.energy) score -= 0.12 * (t.energy - prev.energy);
        }
        if (score > bestS) { bestS = score; best = t; }
      }
      if (!best || bestS < 0.5) break;
      list.push(best); used.add(best.id);
    }
    return list;
  }

  // Cues automáticos (ai/autocues-core.js): como mucho 5 (Inicio, Entrada, Drop, Break, Outro), cuadrados a
  // frase. Reemplaza los automáticos que hubiera y nunca toca los del usuario. `wave` = forma de onda analizada
  // (sin ella, la curva de energía por frases). Devuelve cuántos cues automáticos quedan.
  static AUTO_COLORS = { intro: CUE_COLORS[4], drop: CUE_COLORS[0], break: CUE_COLORS[6], outro: CUE_COLORS[1] };
  static AUTO_COLOR_OF = { start: 'intro', entry: 'intro', drop: 'drop', break: 'break', outro: 'outro' };
  autoCues(track, { wave = null } = {}) {
    const energy = wave && wave.data ? waveEnergy(wave) : curveEnergy(track);
    const points = autoCuePoints(track, { energy, onset: wave && wave.data ? waveOnset(wave) : 0, wave: wave && wave.data ? wave : null });
    const colors = Object.fromEntries(Object.entries(Assistant.AUTO_COLOR_OF).map(([k, v]) => [k, Assistant.AUTO_COLORS[v]]));
    const before = track.cues || Array(8).fill(null);
    const { cues, n } = mergeAutoCues(before, points, colors);
    const same = (a, b) => (!a && !b) || (a && b && a.t === b.t && a.name === b.name && a.auto === b.auto);
    if (cues.some((c, i) => !same(c, before[i]))) this.app.library.update(track.id, { cues });
    return n;
  }
}
