// Cues automáticos (sin DOM: lo usan el asistente, tools/test-autocues.mjs y tools/cues-medir.mjs).
// Como mucho 5 por tema, siempre en el mismo pad: 1 Inicio, 2 Entrada, 3 Drop, 4 Break, 5 Outro.
// rc.9 (versión 3): las partes salen de lo que suena en cada compás, medido en la forma de onda ya analizada y con
// el grid: si hay bombo (golpe grave en cada beat), cuántos bajos hay entre bombo y bombo y la energía. Cada compás
// queda LLENO (bombo y bajos), BAJO (sin bajos, o sin bombo y con menos energía) o a medias. Con eso:
// - Inicio: primer downbeat en el que suena la música.
// - Entrada: primer bombo de verdad (3 de 4 compases seguidos con bombo). Si suena desde el principio, no hay.
// - Break: tramo de 4+ compases que no está lleno y cae (2+ compases bajos) entre dos partes llenas; si hay varios,
//   el más largo y profundo (el principal).
// - Drop: donde vuelven el bombo y los bajos tras ese break. Sin break no se pone (no se inventa).
// - Outro: tras la última parte llena, si la mezcla se vacía y no vuelve (8+ compases hasta el final).
// - Cuadrados a frase: el compás del Drop (o de la Entrada) marca las frases; un cambio a ±1 compás de una frase de
//   8 compases va a ella; si no, de 4; si no, de 2 (8 beats). Entre dos cues hay al menos 8 compases.
// - Si una parte no se distingue con claridad, ese cue no se pone: mejor 3 buenos que 5 malos.
// Sin forma de onda (pistas antiguas) se usa la curva de energía por frases, como antes (autoCuePointsEnergy).
import * as Grid from '../audio/grid.js';

export const AUTO_CUE_VERSION = 3;
export const AUTO_CUE_SLOTS = ['start', 'entry', 'drop', 'break', 'outro'];
export const AUTO_CUE_NAMES = { start: 'Inicio', entry: 'Entrada', drop: 'Drop', break: 'Break', outro: 'Outro' };
const MIN_GAP_BARS = 8;

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
const dB = (v, ref) => 20 * Math.log10(Math.max(v, 1e-4) / Math.max(ref, 1e-4));

// Primer downbeat del grid (beat múltiplo de 4) en el que ya suena la música
function startBeat(track, onset) {
  const beatSec = 60 / track.bpm;
  let b0 = Math.ceil(Grid.beatAt(track, Math.max(0, onset - beatSec / 2)) - 1e-6);
  b0 = Math.ceil(b0 / 4) * 4;
  while (Grid.beatTime(track, b0) < 0) b0 += 4;
  return b0;
}

// Rasgos por compás desde el beat b0 con la forma de onda: { kick (0..1, fracción de beats con bombo), bass (dB
// respecto a lo normal del tema), en (dB), state: 'F' lleno · 'L' bajo · 'p' a medias }
export function barFeatures(track, wave, b0, nBars) {
  const d = wave.data, rate = wave.rate, nb = d.length / 4;
  const at = (t, ch) => { const i = Math.floor(t * rate); return i >= 0 && i < nb ? d[i * 4 + ch] / 255 : 0; };
  const win = (t0, t1, ch, f) => { let v = f === 'max' ? 0 : 0, n = 0; for (let t = t0; t < t1; t += 1 / rate) { const x = at(t, ch); if (f === 'max') v = Math.max(v, x); else v += x; n++; } return f === 'max' ? v : (n ? v / n : 0); };
  const beats = [];
  for (let k = 0; k < nBars; k++) for (let j = 0; j < 4; j++) {
    const b = b0 + 4 * k + j, tb = Grid.beatTime(track, b), bl = Grid.beatTime(track, b + 1) - tb;
    // golpe: el grave más alto junto al beat; lo que hay entre bombos (bajo) y justo antes del beat
    const on = win(tb - 0.015, tb + 0.07, 1, 'max');
    const off = win(tb + 0.45 * bl, tb + 0.85 * bl, 1, 'mean');
    const pre = win(tb - 0.2 * bl, tb - 0.03, 1, 'mean');
    beats.push({ on, off, pre, amp: win(tb, tb + bl, 0, 'mean') });
  }
  // bombo: el golpe grave sobresale de lo que sonaba justo antes del beat (en valor, según el tema, o en proporción;
  // con el bajo sonando entre bombos el golpe se suma a él)
  const pk = beats.map(x => x.on - x.pre);
  const kRef = Math.max(0.05, quantile(pk.filter((_, i) => beats[i].amp > 0.05), 0.85));
  const isKick = (x, i) => x.on >= 0.3 && (pk[i] >= 0.25 * kRef || x.on >= 1.25 * Math.max(x.pre, 0.02));
  const F = [];
  for (let k = 0; k < nBars; k++) {
    const bs = beats.slice(4 * k, 4 * k + 4);
    F.push({ k, kick: bs.filter((x, j) => isKick(x, 4 * k + j)).length / 4, bassV: mean(bs.map(x => x.off), 0, 4), enV: mean(bs.map(x => x.amp), 0, 4) });
  }
  const bRef = quantile(F.map(f => f.bassV), 0.9), eRef = quantile(F.map(f => f.enV), 0.9);
  for (const f of F) { f.bass = dB(f.bassV, bRef); f.en = dB(f.enV, eRef); }
  // estado con la media de 3 compases (el compás y sus vecinos): un compás suelto (un redoble, un golpe en un
  // break largo) no cambia la parte
  const sm = (k, key) => mean(F.slice(Math.max(0, k - 1), Math.min(nBars, k + 2)).map(f => f[key]), 0, 3);
  for (const f of F) {
    const kick = sm(f.k, 'kick'), bass = sm(f.k, 'bass'), en = sm(f.k, 'en');
    f.state = kick >= 0.5 && f.kick >= 0.5 && bass >= -4 && en >= -4 ? 'F' : (bass <= -7 || (kick < 0.5 && en <= -5)) ? 'L' : 'p';
  }
  return F;
}

// Puntos de cue de una pista con BPM: [{ type, name, t, bar }] en el orden de los pads (bar = compás desde el
// Inicio). Con `wave` (la forma de onda analizada): por compases (ver arriba). Sin ella: `energy(t0, t1)` → 0..1
// (curva por frases) con el método de antes. `onset` = segundos en que empieza a sonar la música.
export function autoCuePoints(track, { energy, onset = 0, wave = null } = {}) {
  if (!track || !track.bpm) return [];
  if (!wave || !wave.data || !wave.rate) return energy ? autoCuePointsEnergy(track, { energy, onset }) : [];
  const dur = track.duration || (wave.data.length / 4) / wave.rate;
  const b0 = startBeat(track, onset);
  const barT = (k) => Grid.beatTime(track, b0 + 4 * k);
  const start = { type: 'start', bar: 0, t: barT(0) };
  if (!dur || start.t >= dur - 8) return [];
  let nBars = 0;
  while (barT(nBars + 1) <= dur) nBars++;
  if (nBars < 24) return finish([start]);
  const F = barFeatures(track, wave, b0, nBars);
  const full = (k) => k >= 0 && k < nBars && F[k].state === 'F';
  const kickOn = (k) => k >= 0 && k < nBars && F[k].kick >= 0.75;
  const count = (a, b, fn) => { let c = 0; for (let k = Math.max(0, a); k < Math.min(nBars, b); k++) if (fn(k)) c++; return c; };
  // tema sin partes (siempre igual o sin bombo): solo el Inicio
  const nFull = count(0, nBars, full);
  if (nFull < 8) return finish([start]);
  const pts = [start];

  // Entrada: primer bombo de verdad (si no suena desde el principio)
  let entry = -1;
  for (let k = 0; k + 4 <= nBars; k++) if (kickOn(k) && count(k, k + 4, kickOn) >= 3) { entry = k; break; }
  // Breaks: tramos no llenos de 4+ compases con 2+ compases bajos, entre partes llenas (un compás lleno suelto en
  // medio, un redoble o un golpe, no corta el break)
  const brks = [];
  for (let k = Math.max(0, entry); entry >= 0 && k < nBars;) {
    if (full(k)) { k++; continue; }
    let e = k; while (e < nBars && (!full(e) || (!full(e + 1) && e + 1 < nBars && e > k))) e++;
    const lows = count(k, e, (j) => F[j].state === 'L');
    if (e - k >= 4 && lows >= 2 && count(k - 6, k, full) >= 4 && e + 4 <= nBars && count(e, e + 6, full) >= 4) {
      const depth = -mean(F.slice(k, e).map(f => Math.min(f.bass, f.en + 4)), 0, e - k);
      // vuelta: el primer compás (a ±2 del final del tramo) desde el que vuelven el bombo (3-4 golpes) y los bajos
      // dos compases seguidos (la media de 3 compases puede correr el borde uno o dos compases)
      const back = (j) => kickOn(j) && F[j].bass >= -5 && kickOn(j + 1) && F[j + 1].bass >= -5;
      let d = Math.max(k + 4, e - 2); while (d <= Math.min(nBars - 2, e + 2) && !back(d)) d++;
      if (!(d <= e + 2 && back(d))) d = e;
      // empieza donde la caída ya es clara: 6+ dB menos de bajos o de energía que en la parte llena de antes
      const pre = F.slice(Math.max(0, k - 4), k), pb = mean(pre.map(f => f.bass), 0, 4), pe = mean(pre.map(f => f.en), 0, 4);
      let s = k; while (s < d - 4 && !(pb - F[s].bass >= 6 || pe - F[s].en >= 6)) s++;
      if (s >= d - 4) s = k;
      brks.push({ s, e: d, score: (e - k) * Math.max(1, depth) });
    }
    k = e;
  }
  // el principal: el de más peso (largo × profundo); a igualdad, el último
  const brk = brks.reduce((a, b) => (!a || b.score >= a.score * 0.95 ? b : a), null);
  // Outro: tras la última parte llena (4+ compases) la mezcla se vacía y no vuelve
  let outro = -1, lastFull = -1;
  for (let k = nBars - 1; k >= 3; k--) if (full(k) && full(k - 1) && full(k - 2) && full(k - 3)) { lastFull = k; break; }
  if (lastFull >= 0 && nBars - (lastFull + 1) >= 8 && count(lastFull + 1, nBars, (j) => F[j].state === 'L' || F[j].bass <= -6) >= 3) outro = lastFull + 1;

  // frases: el Drop (el cambio más claro) o, sin él, el Inicio marcan dónde empiezan; se cuadra a 8, 4 o 2 compases
  const anchor = brk ? brk.e : 0;
  const square = (k) => {
    for (const p of [8, 4, 2]) { const q = anchor + Math.round((k - anchor) / p) * p; if (Math.abs(q - k) <= 1) return q; }
    return k;
  };
  if (entry > 1) pts.push({ type: 'entry', bar: square(entry) });
  if (brk) { pts.push({ type: 'break', bar: square(brk.s) }); pts.push({ type: 'drop', bar: brk.e }); }
  if (outro > 0) pts.push({ type: 'outro', bar: square(outro) });

  // separación mínima: se queda el más importante (Drop > Inicio > Break > Outro > Entrada)
  const prio = ['drop', 'start', 'break', 'outro', 'entry'];
  const kept = [];
  for (const type of prio) {
    const p = pts.find(x => x.type === type);
    if (p && p.bar >= 0 && p.bar < nBars && kept.every(k => Math.abs(k.bar - p.bar) >= MIN_GAP_BARS)) kept.push(p);
  }
  return finish(kept.map(p => ({ ...p, t: barT(p.bar) })));
}

// ---------------------------------------------------------------- sin forma de onda (método de la versión 2)
// La energía se mide por compás desde el primer downbeat en el que suena la música y se clasifica en bloques de 4
// compases; cada cue cae en un cambio claro de energía, cuadrado a frase
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
export function autoCuePointsEnergy(track, { energy, onset = 0 } = {}) {
  if (!track || !track.bpm || !energy) return [];
  const dur = track.duration || 0;
  const b0 = startBeat(track, onset);
  const barT = (k) => Grid.beatTime(track, b0 + 4 * k);
  const start = { type: 'start', bar: 0, t: barT(0) };
  if (!dur || start.t >= dur - 8) return [];
  const E = [];
  while (barT(E.length + 1) <= dur) E.push(energy(barT(E.length), barT(E.length + 1)));
  const nBlk = Math.floor(E.length / 4);
  if (nBlk < 8) return finish([start]);
  const B = Array.from({ length: nBlk }, (_, j) => mean(E, 4 * j, 4 * j + 4));
  const lo = quantile(B, 0.1), hi = quantile(B, 0.9), span = hi - lo;
  if (span < 0.05 || hi < lo * 1.2) return finish([start]);
  const lv = B.map(v => (v - lo) / span);
  const highs = runs(nBlk, j => lv[j] >= 0.65, 2);
  const lows = runs(nBlk, j => lv[j] <= 0.35, 2);
  const step = (k) => (mean(E, k, k + 4) - mean(E, k - 4, k)) / span;
  const refine = (blk, dir) => {
    let best = 4 * blk, bv = -Infinity;
    for (let k = 4 * blk - 3; k <= 4 * blk + 3; k++) { if (k < 1 || k >= E.length) continue; const v = dir * step(k); if (v > bv) { bv = v; best = k; } }
    const k8 = Math.round(best / 8) * 8, k4 = Math.round(best / 4) * 4;
    if (Math.abs(k8 - best) <= 2 && dir * step(k8) >= 0.75 * bv) return k8;
    return k4;
  };
  const pts = [start];
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
  const breaks = lows.filter(l => highs.some(h => h.e <= l.s + 1) && highs.some(h => h.s >= l.e - 1));
  let brk = drop ? breaks.find(l => Math.abs(l.e - drop.r.s) <= 1) : null;
  if (!brk && breaks.length) brk = breaks.reduce((a, l) => ((l.e - l.s) * (1 - mean(lv, l.s, l.e)) > (a.e - a.s) * (1 - mean(lv, a.s, a.e)) ? l : a));
  if (brk) {
    const prevHigh = mean(B, brk.s - 2, brk.s), depth = (prevHigh - mean(B, brk.s, brk.e)) / span;
    if (depth >= 0.35) pts.push({ type: 'break', bar: refine(brk.s, -1) });
  }
  const last = highs[highs.length - 1];
  if (last && last.e <= nBlk - 2 && last.e * 4 >= E.length * 0.5) {
    const after = mean(lv, last.e, nBlk), fall = mean(lv, Math.max(last.s, last.e - 2), last.e) - mean(lv, last.e, last.e + 2);
    if (after <= 0.6 && fall >= 0.25) pts.push({ type: 'outro', bar: refine(last.e, -1) });
  }
  for (let j = 2; j < nBlk - 1; j++) {
    const before = mean(lv, 0, j), now = mean(lv, j, j + 2);
    if (before > 0.5) break;
    if (lv[j] >= 0.5 && now - before >= 0.35) { pts.push({ type: 'entry', bar: refine(j, 1) }); break; }
  }
  const prio = ['drop', 'start', 'break', 'outro', 'entry'];
  const kept = [];
  for (const type of prio) {
    const p = pts.find(x => x.type === type);
    if (p && p.bar >= 0 && p.bar < E.length && kept.every(k => Math.abs(k.bar - p.bar) >= 16)) kept.push(p);
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
