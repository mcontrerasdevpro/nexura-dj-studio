// Medición del beatgrid contra los golpes de bombo REALES del audio (la usan test-beatgrid-real.mjs y
// test-sync.mjs). Independiente del análisis de la app: paso bajo de fase cero (400 Hz, ida y vuelta) a la
// frecuencia original, envolvente de amplitud a 1 kHz y, como instante del golpe, el punto de subida más rápida
// (máximo de la derivada, con ajuste parabólico). Así se mide con ~0,2 ms de resolución lo que oye un DJ: el
// ataque del bombo. (Con solo los graves, < 120 Hz, se mide el cuerpo del bombo, que llega 20-60 ms después, o
// el bajo que vuelve tras el sidechain: no sirve como referencia.)
import { spawnSync } from 'node:child_process';

export const hasFfmpeg = () => { try { return spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0; } catch (_) { return false; } };

// Audio mono (media de los canales, como el worker de análisis) a `sr` Hz con ffmpeg
export function decodeMono(file, sr = 48000) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('ffmpeg no ha podido decodificar el archivo');
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

// Biquad paso bajo (RBJ) aplicado hacia delante y hacia atrás: sin retardo de grupo
function lowpassZero(x, sr, fc) {
  const w = 2 * Math.PI * fc / sr, cw = Math.cos(w), a = Math.sin(w) / (2 * Math.SQRT1_2);
  const b0 = (1 - cw) / 2 / (1 + a), b1 = (1 - cw) / (1 + a), b2 = b0, a1 = -2 * cw / (1 + a), a2 = (1 - a) / (1 + a);
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  x1 = x2 = y1 = y2 = 0;
  for (let i = x.length - 1; i >= 0; i--) { const xi = y[i]; const v = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = v; y[i] = v; }
  return y;
}

// Envolvente de la banda del bombo (< 400 Hz) a 1 kHz: amplitud (a), subida en dB por ms (ds) y el nivel de
// los golpes fuertes del tema (loud). En dB el ataque es lo que más sube (de casi nada a fuerte en 2-4 ms); el
// cuerpo grave del bombo, aunque suba mucho en amplitud, apenas sube ya en dB.
export function bassEnvelope(x, sr, fc = 400) {
  const y = lowpassZero(lowpassZero(x, sr, fc), sr, fc);
  const hop = Math.round(sr / 1000), n = Math.floor(y.length / hop);
  const a = new Float32Array(n);
  for (let k = 0; k < n; k++) { let s = 0; for (let i = k * hop; i < (k + 1) * hop; i++) s += y[i] * y[i]; a[k] = Math.sqrt(s / hop); }
  // suavizado de fase cero (~2 ms) y subida centrada en dB
  const sm = new Float32Array(n);
  for (let k = 0; k < n; k++) sm[k] = (a[Math.max(0, k - 1)] + 2 * a[k] + a[Math.min(n - 1, k + 1)]) / 4;
  const ds = new Float32Array(n);
  for (let k = 1; k < n - 1; k++) ds[k] = Math.max(0, 10 * Math.log10((sm[k + 1] + 1e-5) / (sm[k - 1] + 1e-5)));
  // nivel de los golpes fuertes: percentil 95 de la amplitud
  const st = [];
  for (let k = 0; k < n; k += 7) st.push(sm[k]);
  st.sort((p, q) => p - q);
  return { fps: 1000, a: sm, ds, loud: st.length ? st[Math.floor(st.length * 0.95)] : 1 };
}

const refine = (v, k) => { const p = v[k - 1], c = v[k], q = v[k + 1], den = p - 2 * c + q; return k + (den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (p - q) / den)) : 0); };
const AHEAD = 30;     // ms tras el ataque en los que se mira lo fuerte que llega a ser el golpe
const MIN_RISE = 1.2; // dB por ms
// candidatos a golpe en [k0, k1]: máximos de la subida en dB con el golpe que llega a ≥ 25 % de los fuertes
function candidates(env, k0, k1) {
  const { ds, a, loud } = env, out = [];
  for (let k = Math.max(1, k0); k <= Math.min(ds.length - 2, k1); k++) {
    if (ds[k] < MIN_RISE || ds[k] < ds[k - 1] || ds[k] < ds[k + 1]) continue;
    let pk = 0; for (let j = k; j < Math.min(a.length, k + AHEAD); j++) if (a[j] > pk) pk = a[j];
    if (pk >= 0.25 * loud) out.push({ k, rise: ds[k], peak: pk });
  }
  return out;
}
// el golpe de un grupo: entre los que llegan a ≥ 70 % del más fuerte, el ataque más brusco
function pick(c) {
  if (!c.length) return null;
  const top = Math.max(...c.map(x => x.peak));
  return c.filter(x => x.peak >= 0.7 * top).reduce((p, q) => (q.rise > p.rise ? q : p));
}

// Golpe de bombo junto a t (s), dentro de ±win s (el más fuerte de esa zona): { t, s } o null
export function onsetNear(env, t, win) {
  const c = Math.round(t * env.fps), w = Math.max(2, Math.round(win * env.fps));
  const b = pick(candidates(env, c - w, c + w));
  return b ? { t: refine(env.ds, b.k) / env.fps, s: b.peak } : null;
}

// Todos los golpes de bombo: el más fuerte de cada grupo de candidatos separados < minGap s
export function kickOnsets(env, minGap = 0.2) {
  const c = candidates(env, 1, env.ds.length - 2), out = [], g = minGap * env.fps;
  // el más fuerte de su entorno (±minGap)
  for (let i = 0; i < c.length; i++) {
    let best = true;
    for (let j = i - 1; j >= 0 && c[i].k - c[j].k < g; j--) if (c[j].peak >= c[i].peak) { best = false; break; }
    for (let j = i + 1; best && j < c.length && c[j].k - c[i].k < g; j++) if (c[j].peak > c[i].peak) best = false;
    if (best) out.push(refine(env.ds, c[i].k) / env.fps);
  }
  return out;
}

const median = (v) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const pct = (v, p) => { if (!v.length) return NaN; const s = v.map(Math.abs).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// Ataque del bombo en una zona de `nb` beats: promedio de la envolvente alineada a un reloj de beats
// (clock(b) en s); promediar 16 beats deja el bombo (lo único periódico y fuerte bajo 400 Hz) y borra el bajo y
// los demás sonidos. Se suaviza con una media móvil centrada de 12 ms (quita el rizado de la onda grave sin
// desplazar nada), el golpe es el pico más alto a ±½ beat y su ataque, el primer cruce del 50 % entre el suelo
// de los 150 ms anteriores y ese pico. → { off: ms del ataque respecto al reloj (> 0 = después), prom } o null.
export function zoneAttack(env, clock, b0, nb, beat) {
  const half = Math.round(beat * 500), pre = half + 160, n = pre + half + 20;
  const avg = new Float64Array(n);
  let cnt = 0;
  for (let b = b0; b < b0 + nb; b++) {
    const k0 = Math.round(clock(b) * 1000) - pre;
    if (k0 < 0 || k0 + n >= env.a.length) continue;
    for (let i = 0; i < n; i++) avg[i] += env.a[k0 + i];
    cnt++;
  }
  if (cnt < nb * 0.75) return null;
  const S = new Float64Array(n);
  for (let i = 6; i < n - 6; i++) { let s = 0; for (let j = -6; j < 6; j++) s += (avg[i + j] + avg[i + j + 1]) / 2; S[i] = s / 12; }
  let mx = 0, mean = 0;
  for (let i = pre - half; i < pre + half; i++) { mx = Math.max(mx, S[i]); mean += S[i] / (2 * half); }
  if (!(mx > 0)) return null;
  let p = -1;
  for (let i = pre - half + 1; i < pre + half - 1; i++) if (S[i] >= 0.92 * mx && S[i] >= S[i - 1] && S[i] >= S[i + 1] && (p < 0 || Math.abs(i - pre) < Math.abs(p - pre))) p = i;
  if (p < 0) return null;
  let f = p;
  for (let i = Math.max(6, p - 150); i < p; i++) if (S[i] < S[f]) f = i;
  const mid = S[f] + 0.5 * (S[p] - S[f]);
  let k = f;
  while (k < p && S[k] < mid) k++;
  const on = k > f ? k - 1 + (mid - S[k - 1]) / ((S[k] - S[k - 1]) || 1e-12) : k;
  return { off: on - pre, prom: mx / (mean || 1e-9) };
}

const wrap = (ms, beatMs) => { let v = ms % beatMs; if (v > beatMs / 2) v -= beatMs; if (v < -beatMs / 2) v += beatMs; return v; };

// Recta robusta dev(t) (ms frente a s): las desviaciones se acercan (±½ beat) a la mediana y se descartan las
// zonas que se alejan más de max(4 ms, 3·MAD) (un break o una zona donde manda otro sonido). → { a, b, resid, inl }
function robustLine(pts, beatMs) {
  if (pts.length < 4) return null;
  const m0 = median(pts.map(p => p.d));
  let P = pts.map(p => ({ t: p.t, d: m0 + wrap(p.d - m0, beatMs) }));
  let f = null;
  for (let it = 0; it < 4; it++) {
    const n = P.length; let mt = 0, md = 0; for (const p of P) { mt += p.t; md += p.d; } mt /= n; md /= n;
    let sxy = 0, sxx = 0; for (const p of P) { sxy += (p.t - mt) * (p.d - md); sxx += (p.t - mt) ** 2; }
    const b = sxx ? sxy / sxx : 0; f = { a: md - b * mt, b };
    const r = pts.map(p => { const fit = f.a + f.b * p.t; return Math.abs(wrap(p.d - fit, beatMs)); });
    const lim = Math.max(4, 3 * median(r));
    const keep = pts.filter((p, i) => r[i] <= lim).map(p => { const fit = f.a + f.b * p.t; return { t: p.t, d: fit + wrap(p.d - fit, beatMs) }; });
    if (keep.length < 4) break;
    P = keep;
  }
  const res = P.map(p => Math.abs(p.d - (f.a + f.b * p.t)));
  return { ...f, resid: pct(res, 0.9), inl: P.length / pts.length };
}

// Compara una rejilla (beatTime(b) en s) con los golpes: desviación = rejilla − golpe (ms; > 0 = la rejilla va
// tarde), en zonas de 16 beats. Principio, mitad y final = mediana de 3 zonas con bombo (48 beats) al
// principio, en la mitad y al final; una rejilla en el contratiempo sale como ±½ beat.
// Aparte, con un reloj CONSTANTE al BPM de la pista (independiente de las marcas del grid): el BPM «real» de
// los golpes y su residuo p90; si es pequeño, el tema es de tempo constante (`stable`).
export const ZONE = 16;
export function measureGrid(env, beatTime, nBeats, bpm, duration, firstBeat = null) {
  const beat = 60 / bpm, bm = beat * 1000, zs = [];
  for (let b0 = 0; b0 + ZONE <= nBeats; b0 += ZONE) {
    const r = zoneAttack(env, beatTime, b0, ZONE, beat);
    if (r && r.prom >= 1.6) zs.push({ t: beatTime(b0 + ZONE / 2), d: -r.off });
  }
  const total = Math.max(1, Math.floor(nBeats / ZONE));
  const fix = (v) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(1));
  const med3 = (z) => (z.length ? median(z.map(x => x.d)) : null);
  const iMid = zs.length ? zs.reduce((bi, z, i) => (Math.abs(z.t - duration / 2) < Math.abs(zs[bi].t - duration / 2) ? i : bi), 0) : 0;
  const start = med3(zs.slice(0, 3)), mid = med3(zs.slice(Math.max(0, iMid - 1), iMid + 2)), end = med3(zs.slice(-3));
  // reloj constante: primer beat del grid y BPM de la pista
  const fb = firstBeat != null ? firstBeat : beatTime(0);
  const cz = [];
  for (let b0 = 0; fb + (b0 + ZONE) * beat < duration; b0 += ZONE) {
    const r = zoneAttack(env, (b) => fb + b * beat, b0, ZONE, beat);
    if (r && r.prom >= 1.6) cz.push({ t: fb + (b0 + ZONE / 2) * beat, d: -r.off });
  }
  const L = robustLine(cz, bm);
  const realBpm = L ? bpm * (1 + L.b / 1000) : null;
  const devs = [start, mid, end].filter(v => v != null);
  return {
    start: fix(start), mid: fix(mid), end: fix(end),
    max: devs.length ? fix(Math.max(...devs.map(Math.abs))) : null,
    coverage: +(zs.length / total).toFixed(2),
    realBpm: realBpm != null ? +realBpm.toFixed(3) : null,
    realResidP90: L ? fix(L.resid) : null,
    stable: !!(L && L.resid <= 6 && L.inl >= 0.7 && cz.length >= 0.6 * total)
  };
}

// Desviación entre los bombos de dos salidas de audio (ms; > 0 = b suena después que a), por zonas de 16
// beats de un reloj común (clock(b) en s de salida, p. ej. el tempo nominal del maestro): el reloj se anula
export function outputDeviation(envA, envB, clock, b0, b1, beat) {
  const d = [];
  for (let b = b0; b + ZONE <= b1; b += ZONE) {
    const a = zoneAttack(envA, clock, b, ZONE, beat), c = zoneAttack(envB, clock, b, ZONE, beat);
    if (a && c && a.prom >= 1.6 && c.prom >= 1.6) d.push({ t: clock(b + ZONE / 2), ms: wrap(c.off - a.off, beat * 1000) });
  }
  const v = d.map(x => x.ms);
  return { zones: d, n: v.length, median: v.length ? +median(v).toFixed(1) : null, max: v.length ? +Math.max(...v.map(Math.abs)).toFixed(1) : null };
}
