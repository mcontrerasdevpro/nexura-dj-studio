// Ataque real de un golpe cerca de un instante (sin DOM: lo usan app.attackNear y tools/test-cue-q.mjs).
// Se usa al poner un cue con Q: si hay un golpe claro a menos de `win` segundos de la línea del grid, el cue va
// a su ataque (donde la envolvente sube más deprisa, en dB) y no a la línea.
// - Envolvente RMS de 1 ms (los dos canales sumados) suavizada a ~3 ms.
// - Subida en dB entre el ms anterior y el siguiente; candidato = máximo local de la subida ≥ MIN_RISE dB.
// - Golpe claro: en los 25 ms siguientes llega a ≥ MIN_JUMP dB por encima de lo que sonaba en los 15 ms de antes.
// - Entre varios golpes claros, el que más salta (a igualdad, el más cercano a la línea).
const MIN_RISE = 1.5;   // dB entre el ms anterior y el siguiente
const MIN_JUMP = 6;     // dB del golpe sobre lo que sonaba justo antes

// chs: canales (Float32Array) · sr: Hz · t: segundos (línea del grid) · win: segundos a cada lado
export function findAttack(chs, sr, t, win = 0.03) {
  if (!chs || !chs.length || !(sr > 0)) return null;
  const hop = Math.max(1, Math.round(sr / 1000)), n = chs[0].length;
  const pre = 20, post = 30;                     // ms de margen para medir antes y después
  const k0 = Math.floor((t - win) * 1000) - pre, k1 = Math.ceil((t + win) * 1000) + post;
  if (k1 <= 0 || k0 * hop >= n) return null;
  const len = k1 - k0 + 1, env = new Float64Array(len);
  for (let j = 0; j < len; j++) {
    const i0 = (k0 + j) * hop;
    if (i0 < 0 || i0 + hop > n) { env[j] = 0; continue; }
    let s = 0;
    for (const c of chs) for (let i = i0; i < i0 + hop; i++) s += c[i] * c[i];
    env[j] = Math.sqrt(s / (hop * chs.length));
  }
  const sm = new Float64Array(len);
  for (let j = 0; j < len; j++) sm[j] = (env[Math.max(0, j - 1)] + 2 * env[j] + env[Math.min(len - 1, j + 1)]) / 4;
  const db = (v) => 20 * Math.log10(v + 1e-6);
  const r = new Float64Array(len);
  for (let j = 1; j < len - 1; j++) r[j] = db(sm[j + 1]) - db(sm[j - 1]);
  let best = null;
  for (let j = Math.max(2, pre); j < Math.min(len - 2, len - post); j++) {
    const tj = (k0 + j) / 1000;
    if (Math.abs(tj - t) > win) continue;
    const rise = r[j];
    // punto de subida más rápida de este golpe (máximo local de la subida)
    if (rise < MIN_RISE || rise < r[j - 1] || rise < r[j + 1]) continue;
    let before = 0, peak = 0;
    for (let k = Math.max(0, j - 15); k < j - 1; k++) before = Math.max(before, sm[k]);
    for (let k = j; k < Math.min(len, j + 25); k++) peak = Math.max(peak, sm[k]);
    const jump = db(peak) - db(before);
    if (jump < MIN_JUMP) continue;
    const dt = Math.abs(tj - t);
    if (!best || jump > best.jump + 1 || (Math.abs(jump - best.jump) <= 1 && dt < best.dt)) best = { t: tj, jump, dt };
  }
  return best ? Math.max(0, best.t) : null;
}
