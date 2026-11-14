// Cues automáticos (sin DOM: lo usan el asistente y tools/test-autocues.mjs).
// Como mucho 5 por tema, siempre en el mismo pad: 1 Inicio, 2 Entrada, 3 Drop, 4 Break, 5 Outro.
// - La energía se mide por compás desde el primer downbeat en el que suena la música (no desde 0 s), con la
//   forma de onda ya analizada (graves, nivel y agudos), y se clasifica en bloques de 4 compases.
// - Cada cue cae en un cambio claro de energía, cuadrado a frase: múltiplo de 8 compases desde el Inicio o,
//   si el cambio no encaja ahí, de 4. Entre dos cues hay al menos 16 compases.
// - Si una parte no se distingue con claridad, ese cue no se pone: mejor 3 buenos que 5 sin sentido.
import * as Grid from '../audio/grid.js';

export const AUTO_CUE_VERSION = 2;
export const AUTO_CUE_SLOTS = ['start', 'entry', 'drop', 'break', 'outro'];
export const AUTO_CUE_NAMES = { start: 'Inicio', entry: 'Entrada', drop: 'Drop', break: 'Break', outro: 'Outro' };
const MIN_GAP_BARS = 16;

// Energía media (0..1) de [t0, t1) con la forma de onda de 4 bytes por bloque [nivel, graves, medios, agudos]
export function waveEnergy(wave) {
  const d = wave.data, rate = wave.rate, nb = d.length / 4;
  return (t0, t1) => {
    const i0 = Math.max(0, Math.floor(t0 * rate)), i1 = Math.min(nb, Math.ceil(t1 * rate));
    if (i1 <= i0) return 0;
    let s = 0;
    for (let i = i0; i < i1; i++) s += 0.55 * d[i * 4 + 1] + 0.3 * d[i * 4] + 0.15 * d[i * 4 + 3];
    return s / ((i1 - i0) * 255);
  };
}
// Primer instante en que empieza la música: nivel por encima del 8 % del máximo durante al menos 0,3 s
export function waveOnset(wave) {
  const d = wave.data, rate = wave.rate, nb = d.length / 4, win = Math.max(1, Math.round(rate * 0.3));
  for (let i = 0; i < nb; i++) {
    if (d[i * 4] < 20) continue;
    let s = 0;
    for (let k = i; k < Math.min(nb, i + win); k++) s += d[k * 4];
    if (s / win >= 10) return i / rate;
  }
  return 0;
}
// Sin forma de onda: la curva de energía por frases del análisis de estructura (8 compases por valor)
export function curveEnergy(track) {
  const c = track.energyCurve, bpm = track.bpm;
  if (!c || !c.length || !bpm) return null;
  const bar = 240 / bpm, phrase = bar * 8, start0 = (((track.firstBeat || 0) % bar) + bar) % bar;
  return (t0, t1) => {
    const k = Math.floor(((t0 + t1) / 2 - start0) / phrase);
    return k >= 0 && k < c.length ? c[k] : 0;
  };
}

const mean = (a, i0, i1) => { let s = 0, n = 0; for (let i = Math.max(0, i0); i < Math.min(a.length, i1); i++) { s += a[i]; n++; } return n ? s / n : 0; };
const quantile = (a, q) => { const v = [...a].sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.max(0, Math.floor(q * (v.length - 1))))]; };
// tramos seguidos de bloques que cumplen `ok` (se admite un bloque suelto en medio que no cumple)
function runs(n, ok, minLen) {
  const out = [];
  for (let j = 0; j < n;) {
    if (!ok(j)) { j++; continue; }
    let e = j + 1;
    while (e < n && (ok(e) || (e + 1 < n && ok(e + 1) && e > j))) e++;
    if (e - j >= minLen) out.push({ s: j, e });
    j = e;
  }
  return out;
}

// Puntos de cue de una pista con BPM: [{ type, name, t, bar }] en el orden de los pads (bar = compás desde el
// Inicio). `energy(t0, t1)` → 0..1; `onset` = segundos en que empieza a sonar la música.
export function autoCuePoints(track, { energy, onset = 0 } = {}) {
  if (!track || !track.bpm || !energy) return [];
  const dur = track.duration || 0;
  const beatSec = 60 / track.bpm;
  // Inicio: primer downbeat del beatgrid (beat múltiplo de 4) en el que ya suena la música
  let b0 = Math.ceil(Grid.beatAt(track, Math.max(0, onset - beatSec / 2)) - 1e-6);
  b0 = Math.ceil(b0 / 4) * 4;
  while (Grid.beatTime(track, b0) < 0) b0 += 4;
  const barT = (k) => Grid.beatTime(track, b0 + 4 * k);
  const start = { type: 'start', bar: 0, t: barT(0) };
  if (!dur || start.t >= dur - 8) return [];
  const E = [];
  while (barT(E.length + 1) <= dur) E.push(energy(barT(E.length), barT(E.length + 1)));
  const nBlk = Math.floor(E.length / 4);
  if (nBlk < 8) return finish([start]);
  // nivel por bloque de 4 compases, normalizado entre los percentiles 10 y 90
  const B = Array.from({ length: nBlk }, (_, j) => mean(E, 4 * j, 4 * j + 4));
  const lo = quantile(B, 0.1), hi = quantile(B, 0.9), span = hi - lo;
  // pista plana (sin partes que se distingan): solo el Inicio
  if (span < 0.05 || hi < lo * 1.2) return finish([start]);
  const lv = B.map(v => (v - lo) / span);
  const highs = runs(nBlk, j => lv[j] >= 0.65, 2);
  const lows = runs(nBlk, j => lv[j] <= 0.35, 2);

  // cambio de energía en el compás k (media de 4 compases después − 4 antes), en unidades del rango
  const step = (k) => (mean(E, k, k + 4) - mean(E, k - 4, k)) / span;
  // borde de un bloque afinado al compás y cuadrado a frase: 8 compases si encaja (casi el mismo cambio), si no 4
  const refine = (blk, dir) => {
    let best = 4 * blk, bv = -Infinity;
    for (let k = 4 * blk - 3; k <= 4 * blk + 3; k++) { if (k < 1 || k >= E.length) continue; const v = dir * step(k); if (v > bv) { bv = v; best = k; } }
    const k8 = Math.round(best / 8) * 8, k4 = Math.round(best / 4) * 4;
    if (Math.abs(k8 - best) <= 2 && dir * step(k8) >= 0.75 * bv) return k8;
    return k4;
  };
  const pts = [start];

  // Drop: el tramo alto con más energía que llega tras una subida clara; a igualdad, el que viene después de
  // un break (el «segundo drop», el principal en casi toda la música de baile)
  let drop = null;
  for (const r of highs) {
    if (r.s < 1) continue;
    const level = mean(B, r.s, Math.min(r.e, r.s + 8));
    const rise = (level - mean(B, r.s - 2, r.s)) / span;
    if (rise < 0.35) continue;
    const afterBreak = lows.some(l => l.e >= r.s - 1 && l.e <= r.s + 1 && highs.some(h => h.e <= l.s + 1 && h !== r));
    const score = level + (afterBreak ? 0.1 * span : 0);
    if (!drop || score > drop.score) drop = { r, score };
  }
  if (drop) pts.push({ type: 'drop', bar: refine(drop.r.s, 1) });

  // Break: bajada clara entre dos tramos altos; mejor la que acaba justo antes del Drop
  const breaks = lows.filter(l => highs.some(h => h.e <= l.s + 1) && highs.some(h => h.s >= l.e - 1));
  let brk = drop ? breaks.find(l => Math.abs(l.e - drop.r.s) <= 1) : null;
  if (!brk && breaks.length) brk = breaks.reduce((a, l) => ((l.e - l.s) * (1 - mean(lv, l.s, l.e)) > (a.e - a.s) * (1 - mean(lv, a.s, a.e)) ? l : a));
  if (brk) {
    const prevHigh = mean(B, brk.s - 2, brk.s), depth = (prevHigh - mean(B, brk.s, brk.e)) / span;
    if (depth >= 0.35) pts.push({ type: 'break', bar: refine(brk.s, -1) });
  }

  // Outro: tras el último tramo alto, si la energía baja y ya no vuelve a subir (y queda al menos 8 compases)
  const last = highs[highs.length - 1];
  if (last && last.e <= nBlk - 2 && last.e * 4 >= E.length * 0.5) {
    const after = mean(lv, last.e, nBlk), fall = mean(lv, Math.max(last.s, last.e - 2), last.e) - mean(lv, last.e, last.e + 2);
    if (after <= 0.6 && fall >= 0.25) pts.push({ type: 'outro', bar: refine(last.e, -1) });
  }

  // Entrada: fin de la intro = primera subida clara de energía (antes de esa subida, la intro va baja)
  for (let j = 2; j < nBlk - 1; j++) {
    const before = mean(lv, 0, j), now = mean(lv, j, j + 2);
    if (before > 0.5) break;
    if (lv[j] >= 0.5 && now - before >= 0.35) { pts.push({ type: 'entry', bar: refine(j, 1) }); break; }
  }

  // separación mínima: se queda el más importante (Drop > Inicio > Break > Outro > Entrada)
  const prio = ['drop', 'start', 'break', 'outro', 'entry'];
  const kept = [];
  for (const type of prio) {
    const p = pts.find(x => x.type === type);
    if (p && p.bar >= 0 && p.bar < E.length && kept.every(k => Math.abs(k.bar - p.bar) >= MIN_GAP_BARS)) kept.push(p);
  }
  return finish(kept.map(p => ({ ...p, t: barT(p.bar) })));
}

function finish(pts) {
  return pts
    .map(p => ({ ...p, name: AUTO_CUE_NAMES[p.type] }))
    .sort((a, b) => AUTO_CUE_SLOTS.indexOf(a.type) - AUTO_CUE_SLOTS.indexOf(b.type));
}

// Hot cues con los automáticos recalculados: los del usuario (sin `auto`) no se tocan nunca; cada automático
// va a su pad (1-5) o, si el usuario lo tiene ocupado, al primer pad libre. Un punto con un cue del usuario a
// menos de 2 s no se duplica.
export function mergeAutoCues(cues, points, colors) {
  const out = (cues || Array(8).fill(null)).map(c => (c && c.auto ? null : c));
  while (out.length < 8) out.push(null);
  const user = out.filter(Boolean).map(c => c.t);
  let n = 0;
  for (const p of points) {
    if (user.some(t => Math.abs(t - p.t) < 2)) continue;
    let slot = AUTO_CUE_SLOTS.indexOf(p.type);
    if (out[slot]) slot = out.findIndex(c => !c);
    if (slot < 0) break;
    out[slot] = { t: p.t, color: colors[p.type], name: p.name, auto: true, autoV: AUTO_CUE_VERSION };
    n++;
  }
  return { cues: out, n };
}
