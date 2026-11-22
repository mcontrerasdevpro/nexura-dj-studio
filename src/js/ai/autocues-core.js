// Cues automáticos (sin DOM: lo usan el asistente, tools/test-autocues.mjs y tools/cues-medir.mjs).
// rc.11 (versión 4, fran6): los 4 cues que pone un DJ, siempre en el mismo pad:
//   1 Beat · 2 Subidón · 3 Principal · 4 Salida
// Las partes salen de lo que suena en cada compás, medido en la forma de onda ya analizada y con el grid: si hay
// bombo (golpe grave en cada beat), cuántos bajos hay entre bombo y bombo y la energía. Cada compás queda LLENO
// (bombo y bajos), BAJO (sin bajos, o sin bombo y con menos energía) o a medias. Con eso:
// - 1 Beat: donde entra el bombo de verdad (3 de 4 compases seguidos); si suena desde el principio, el primer
//   downbeat con música. (El «Inicio» de antes ya no es un cue aparte: es el principio de la pista.)
// - Subidones: la entrada a una parte llena (6+ compases) tras una parte que no lo es (4+ compases) y que cae de
//   verdad (2+ compases bajos o 6+ dB menos de bajos o energía).
// - 3 Principal: el subidón de más peso (largo × contraste × intensidad), mejor tras un break de verdad y hacia la
//   mitad del tema. 2 Subidón: el primero antes del principal. 4 Salida: el último después del principal o, si no
//   hay, donde la mezcla empieza a vaciarse tras la última parte llena.
// - Siempre en el primer beat del compás y cuadrados a frase: el Principal marca las frases; un cambio a ±1 compás
//   de una frase de 8 compases va a ella; si no, de 4; si no, de 2 (8 beats). Entre dos cues, 8+ compases.
// - Nunca en los últimos 25 s. Si una parte no se distingue con claridad, ese cue no se pone.
// Sin forma de onda (pistas antiguas) se usa la curva de energía por frases, como antes (autoCuePointsEnergy).
import * as Grid from '../audio/grid.js';

export const AUTO_CUE_VERSION = 4;
export const AUTO_CUE_SLOTS = ['beat', 'rise', 'main', 'exit'];
export const AUTO_CUE_NAMES = { beat: '1 Beat', rise: '2 Subidón', main: '3 Principal', exit: '4 Salida' };
// Equivalencias con los nombres de antes (v1-v3) para quien todavía los busque (sugerencias, informes…)
export const AUTO_CUE_LEGACY = { start: 'beat', entry: 'beat', drop: 'main', break: null, outro: 'exit' };
const MIN_GAP_BARS = 8;
const TAIL_SEC = 25; // ningún cue automático en los últimos 25 s del tema

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
export function startBeat(track, onset) {
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
  if (nBars < 24) return finish(start.t <= dur - TAIL_SEC ? [{ type: 'beat', bar: 0, t: start.t }] : []);
  const F = barFeatures(track, wave, b0, nBars);
  const full = (k) => k >= 0 && k < nBars && F[k].state === 'F';
  const kickOn = (k) => k >= 0 && k < nBars && F[k].kick >= 0.75;
  const count = (a, b, fn) => { let c = 0; for (let k = Math.max(0, a); k < Math.min(nBars, b); k++) if (fn(k)) c++; return c; };
  // Entrada: primer bombo de verdad (si no suena desde el principio)
  let entry = -1;
  for (let k = 0; k + 4 <= nBars; k++) if (kickOn(k) && count(k, k + 4, kickOn) >= 3) { entry = k; break; }
  // v4: cue 1 · Beat = donde entra el bombo de verdad; si suena desde el principio, el primer compás
  const beatBar = entry > 2 ? entry : 0;
  const lastOk = (k) => barT(k) <= dur - TAIL_SEC; // nunca en los últimos ~25 s
  // tema sin partes (siempre igual o sin bombo): solo el Beat
  const nFull = count(0, nBars, full);
  if (nFull < 8) return finish(lastOk(beatBar) ? [{ type: 'beat', bar: beatBar, t: barT(beatBar) }] : []);
  return djCues({ F, nBars, full, kickOn, count, beatBar, barT, lastOk });
}

// v4 (fran6): los 4 cues de un DJ a partir de las partes LLENO / BAJO / a medias de cada compás.
function djCues({ F, nBars, full, kickOn, count, beatBar, barT, lastOk }) {
  const avg = (a, b, key) => mean(F.slice(Math.max(0, a), Math.min(nBars, b)).map(f => f[key]), 0, Math.max(1, Math.min(nBars, b) - Math.max(0, a)));
  // partes llenas: tramos de 6+ compases llenos (un compás suelto a medias, un redoble, no los corta)
  const runs = [];
  for (let k = 0; k < nBars;) {
    if (!full(k)) { k++; continue; }
    let e = k + 1; while (e < nBars && (full(e) || (e + 1 < nBars && full(e + 1)))) e++;
    if (e - k >= 6) runs.push({ s: k, e });
    k = e;
  }
  // subidones: la entrada a una parte llena tras una parte que no lo es (4+ compases) y que cae de verdad
  // (2+ compases bajos, o 6+ dB menos de bajos o de energía que la parte llena)
  const rises = [];
  for (const r of runs) {
    let p = r.s; while (p > 0 && !full(p - 1)) p--;
    const gap = r.s - p;
    if (gap < 4) continue;
    const lows = count(p, r.s, (j) => F[j].state === 'L');
    const drop = Math.max(avg(r.s, r.s + 8, 'bass') - avg(p, r.s, 'bass'), avg(r.s, r.s + 8, 'en') - avg(p, r.s, 'en'));
    if (lows < 2 && drop < 6) continue;
    // la vuelta exacta: el primer compás (a ±2) con bombo (3-4 golpes) y bajos dos compases seguidos
    const back = (j) => kickOn(j) && F[j].bass >= -5 && kickOn(j + 1) && F[j + 1].bass >= -5;
    let d = Math.max(p + 2, r.s - 2); while (d <= Math.min(nBars - 2, r.s + 2) && !back(d)) d++;
    if (!(d <= r.s + 2 && back(d))) d = r.s;
    // ¿break de verdad? (había una parte llena antes: no es la intro)
    const afterFull = count(p - 8, p, full) >= 4;
    const len = r.e - d, inten = avg(d, r.e, 'en') + avg(d, r.e, 'bass') / 2; // dB respecto a lo normal (≤ 0)
    rises.push({ bar: d, len, inten, depth: Math.min(24, Math.max(lows * 2, drop)), afterFull });
  }
  // 1 Beat: si el bombo entra solo y a los pocos compases (≤ 16) entra la línea de bajo (bombo y bajos a ≤ 7 dB de
  // lo normal, 3 de 4 compases), el Beat va a esa entrada («el beat fuerte con el bajo»). Con una intro de bombo
  // solo más larga (la de mezclar), el Beat se queda en el primer bombo y la entrada del bajo es el 2 · Subidón
  const bassOn = (k) => kickOn(k) && F[k].bass >= -7;
  let bassBar = -1;
  for (let k = beatBar; k + 4 <= nBars; k++) if (bassOn(k) && count(k, k + 4, bassOn) >= 3) { bassBar = k; break; }
  if (bassBar > beatBar && bassBar - beatBar <= 16 && bassBar / nBars <= 0.3 && lastOk(bassBar)) beatBar = bassBar;
  // el principal: el subidón con más peso (largo × contraste × intensidad), mejor tras un break de verdad y hacia
  // la mitad del tema
  const pos = (k) => k / nBars;
  const weight = (x) => Math.min(32, x.len) * (6 + x.depth) * Math.pow(10, x.inten / 20) * (x.afterFull ? 1.25 : 1) * (pos(x.bar) >= 0.25 && pos(x.bar) <= 0.72 ? 1.2 : 0.85);
  // (un subidón pegado al Beat es la propia entrada del beat: no cuenta)
  const cands = rises.filter(x => lastOk(x.bar) && x.bar >= beatBar + MIN_GAP_BARS);
  // el principal sale de los subidones tras un break de verdad; la entrada desde la intro solo puede ser el 2
  const afterBreak = cands.filter(x => x.afterFull);
  const main = (afterBreak.length ? afterBreak : cands).reduce((a, x) => (!a || weight(x) > weight(a) * 1.02 ? x : a), null);
  // frases: el principal (el cambio más claro) marca dónde empiezan; se cuadra a 8, 4 o 2 compases (±1)
  const anchor = main ? main.bar : beatBar;
  const square = (k) => {
    for (const p of [8, 4, 2]) { const q = anchor + Math.round((k - anchor) / p) * p; if (Math.abs(q - k) <= 1) return q; }
    return k;
  };
  const pts = [];
  const add = (type, bar) => { if (bar != null && bar >= 0 && bar < nBars && lastOk(bar)) pts.push({ type, bar }); };
  add('beat', beatBar > 0 ? square(beatBar) : 0);
  if (main) {
    add('main', main.bar);
    // 2 · Subidón: el primero antes del principal (que no sea el propio Beat)
    const r1 = cands.find(x => x.bar < main.bar - MIN_GAP_BARS + 1 && x.bar >= beatBar + MIN_GAP_BARS);
    if (r1) add('rise', square(r1.bar));
    // 4 · Salida: el último subidón después del principal; si no hay, donde la mezcla empieza a vaciarse tras la
    // última parte llena (si queda tiempo para mezclar y no está pegado al final)
    const r4 = cands.filter(x => x.bar >= main.bar + MIN_GAP_BARS).pop();
    if (r4) add('exit', square(r4.bar));
    else {
      const last = runs[runs.length - 1];
      if (last && last.e < nBars - 4 && last.e >= main.bar + 16 && count(last.e, nBars, (j) => F[j].state === 'L' || F[j].bass <= -6) >= 3) add('exit', square(last.e));
    }
  } else if (runs.length) {
    // sin subidones claros: la primera parte llena (si no es el Beat) como Subidón; nada más (no se inventa)
    const r = runs.find(x => x.s >= beatBar + MIN_GAP_BARS);
    if (r && r.s / nBars < 0.4) add('rise', square(r.s));
  }
  // separación mínima: se queda el más importante (Principal > Beat > Salida > Subidón)
  const kept = [];
  for (const type of ['main', 'beat', 'exit', 'rise']) {
    const p = pts.find(x => x.type === type);
    if (p && kept.every(k => Math.abs(k.bar - p.bar) >= MIN_GAP_BARS)) kept.push(p);
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
  // v4: Entrada (o Inicio) → 1 Beat · Drop → 3 Principal · Outro → 4 Salida (el Break no es un cue de DJ)
  const v4 = [];
  const entry = kept.find(p => p.type === 'entry') || kept.find(p => p.type === 'start');
  if (entry) v4.push({ type: 'beat', bar: entry.bar });
  for (const p of kept) if (p.type === 'drop' || p.type === 'outro') v4.push({ type: AUTO_CUE_LEGACY[p.type], bar: p.bar });
  return finish(v4.map(p => ({ ...p, t: barT(p.bar) })).filter(p => p.t <= dur - TAIL_SEC));
}

function finish(pts) {
  return pts
    .map(p => ({ ...p, name: AUTO_CUE_NAMES[p.type] }))
    .sort((a, b) => AUTO_CUE_SLOTS.indexOf(a.type) - AUTO_CUE_SLOTS.indexOf(b.type));
}
// ¿es un cue automático (de esta versión o de una anterior) de este tipo? Acepta los nombres de antes
// («Drop» → Principal, «Outro» → Salida, «Entrada»/«Inicio» → Beat) para sugerencias e informes
export function autoCueType(c) {
  if (!c || !c.name) return null;
  const n = String(c.name).toLowerCase();
  for (const [k, v] of Object.entries(AUTO_CUE_NAMES)) if (n === v.toLowerCase()) return k;
  const old = { inicio: 'start', entrada: 'entry', drop: 'drop', break: 'break', outro: 'outro' }[n];
  return old ? AUTO_CUE_LEGACY[old] : null;
}

// Hot cues con los automáticos recalculados: los del usuario (sin `auto`) no se tocan nunca; cada automático
// va a su pad (1-4) o, si el usuario lo tiene ocupado, al primer pad libre. Un punto con un cue del usuario a
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
