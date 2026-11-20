// Tonalidad (rc.10, implementación propia). Funciones puras: las usa el análisis (analysis-core.js → analyze)
// en el worker y en el analizador en segundo plano, y las pruebas de Node.
//
// Antes (rc.9): un cromagrama sumando la FFT de 55 Hz a 2 kHz y los perfiles de Krumhansl-Kessler (de estudios
// de música clásica). Medido con 80 temas de la biblioteca de prueba (tools/key-medir.mjs) acertaba el 45 %, con
// sesgos claros: la quinta de arriba y la mayor paralela en temas menores (los armónicos de cada nota).
//
// Ahora:
//  1. Espectro con FFT de 8192 a ~11-12 kHz (1,4 Hz por banda) en tramos repartidos por todo el tema.
//  2. Afinación: desviación media de los picos del espectro respecto a la rejilla de La = 440 Hz (en cents); las
//     bandas de semitono se colocan con esa afinación (temas a 432 Hz, vinilos acelerados…).
//  3. Bandas de semitono (de La1 = 55 Hz a ~3,5 kHz) en dB y «blanqueadas»: se quita el nivel medio de ±6
//     semitonos. La percusión (golpes que suenan en todas las bandas a la vez) y el fondo apenas cuentan; las notas
//     sí. Las bandas agudas (platos, voces) pesan menos.
//  4. Tramos con nivel: los silencios y las partes muy flojas no cuentan; cada tramo pesa según su contenido
//     armónico (las intros/outros de solo percusión pesan poco).
//  5. Perfiles de tonalidad aprendidos de la propia música (no los de la música clásica): el cromagrama medio de
//     159 temas de la biblioteca de prueba con la tonalidad en la etiqueta, por separado mayores y menores, con la
//     tónica girada a Do. Recogen cómo suena de verdad la música actual (los armónicos incluidos: por eso ya no
//     se tuercen hacia la quinta ni hacia la mayor). Medido con validación cruzada (perfiles de una mitad,
//     probados en la otra) y con un tercer grupo de temas que no se usó para nada (informe-directo.md).
//  6. Votación por tramos de ~20 s: si una mayoría clara de tramos dice otra tonalidad, gana (temas con cambio de
//     tono o intros en otra tonalidad).
// Devuelve { tonic 0-11 (0 = Do), minor, score, conf 0-1, tuning (cents), chroma }.
import { fft, decimate } from './analysis-core.js';

// v2 = este análisis (rc.10). Las tonalidades analizadas con la versión anterior se recalculan al cargar la pista
// o con «Analizar» (nunca las fijadas por el usuario ni las importadas de otro programa: keyLocked)
export const KEY_VERSION = 2;

const N = 8192;
const MIDI_LO = 33;   // La1 = 55 Hz
const MIDI_HI = 105;  // La7 ≈ 3,5 kHz
const NB = MIDI_HI - MIDI_LO + 1;
const MAX_FRAMES = 480;
const SEG_SEC = 20;

// Perfiles (Do = 0; mayor: Do Do# Re Mib Mi Fa Fa# Sol Lab La Sib Si). Aprendidos (punto 5)
export const PROFILES = {
  major: [1.000, 0.305, 0.567, 0.252, 0.660, 0.509, 0.344, 0.874, 0.276, 0.515, 0.236, 0.541],
  minor: [1.000, 0.404, 0.619, 0.665, 0.411, 0.623, 0.382, 0.940, 0.512, 0.410, 0.658, 0.476]
};

let WIN = null;
const hann = () => { if (!WIN) { WIN = new Float32Array(N); for (let i = 0; i < N; i++) WIN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); } return WIN; };

// Espectros de magnitud de los tramos elegidos (de 50 Hz a ~3,8 kHz) + RMS y tiempo de cada tramo
export function keyFrames(d, sr, maxFrames = MAX_FRAMES) {
  if (!d || d.length < N * 2) return null;
  const hop = N / 2, total = Math.floor((d.length - N) / hop);
  const stride = Math.max(1, Math.ceil(total / maxFrames));
  const binHz = sr / N;
  const k0 = Math.max(1, Math.floor(50 / binHz)), k1 = Math.min(N / 2 - 2, Math.ceil(3800 / binHz));
  const nk = k1 - k0 + 1;
  const frames = [], times = [], rms = [];
  const re = new Float64Array(N), im = new Float64Array(N), w = hann();
  for (let f = 0; f < total; f += stride) {
    const off = f * hop;
    let s2 = 0;
    for (let i = 0; i < N; i++) { const v = d[off + i]; s2 += v * v; re[i] = v * w[i]; im[i] = 0; }
    fft(re, im);
    const mag = new Float32Array(nk);
    for (let k = 0; k < nk; k++) mag[k] = Math.hypot(re[k0 + k], im[k0 + k]);
    frames.push(mag); times.push((off + N / 2) / sr); rms.push(Math.sqrt(s2 / N));
  }
  return { frames, times, rms, k0, binHz, sr };
}

// Afinación (cents respecto a La = 440 Hz, −50..50): media circular de la desviación de los picos del espectro
export function estimateTuning(kf) {
  let cx = 0, cy = 0;
  const { frames, k0, binHz } = kf;
  for (const mag of frames) {
    let mx = 0; for (let k = 0; k < mag.length; k++) if (mag[k] > mx) mx = mag[k];
    const th = mx * 0.1;
    for (let k = 2; k < mag.length - 2; k++) {
      const a = mag[k - 1], b = mag[k], c = mag[k + 1];
      if (b < th || b <= a || b < c || b < mag[k - 2] || b < mag[k + 2]) continue;
      const den = a - 2 * b + c, p = den ? 0.5 * (a - c) / den : 0;
      const hz = (k0 + k + p) * binHz;
      if (hz < 80 || hz > 2500) continue;
      const midi = 69 + 12 * Math.log2(hz / 440);
      const dev = midi - Math.round(midi); // −0,5..0,5 semitonos
      cx += b * Math.cos(2 * Math.PI * dev); cy += b * Math.sin(2 * Math.PI * dev);
    }
  }
  if (!cx && !cy) return 0;
  return Math.atan2(cy, cx) / (2 * Math.PI) * 100;
}

// Tabla bin → bandas de semitono (con la afinación): cada bin reparte su energía entre la banda más cercana y la
// vecina con un peso coseno (como un filtro triangular de un semitono)
function bandMap(kf, tuning) {
  const { frames, k0, binHz } = kf, nk = frames[0].length;
  const lo = new Int16Array(nk), wl = new Float32Array(nk);
  for (let k = 0; k < nk; k++) {
    const hz = (k0 + k) * binHz;
    const m = 69 + 12 * Math.log2(hz / 440) - tuning / 100 - MIDI_LO;
    const b = Math.floor(m), fr = m - b;
    lo[k] = b; wl[k] = Math.cos(fr * Math.PI / 2) ** 2; // a la banda b: cos², a la b+1: sin²
  }
  return { lo, wl };
}

// Bandas de semitono de un tramo: energía en dB (suelo −60 dB) y blanqueada → Float32Array(NB) o null
export function frameBands(mag, map, opts = {}) {
  const e = new Float32Array(NB);
  const { lo, wl } = map;
  for (let k = 0; k < mag.length; k++) {
    const b = lo[k], v = mag[k] * mag[k];
    if (b >= 0 && b < NB) e[b] += v * wl[k];
    if (b + 1 >= 0 && b + 1 < NB) e[b + 1] += v * (1 - wl[k]);
  }
  let mx = 0; for (let b = 0; b < NB; b++) if (e[b] > mx) mx = e[b];
  if (mx <= 1e-12) return null;
  for (let b = 0; b < NB; b++) e[b] = Math.max(0, 60 + 10 * Math.log10(e[b] / mx + 1e-12)) / 60;
  // blanqueado: quitar la media de ±6 semitonos (fondo, percusión de banda ancha)
  const wh = opts.whiten ?? 6, out = new Float32Array(NB);
  for (let b = 0; b < NB; b++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, b - wh); j <= Math.min(NB - 1, b + wh); j++) { s += e[j]; n++; }
    out[b] = Math.max(0, e[b] - s / n);
  }
  return out;
}

// Cromagrama (12) de unas bandas; lo agudo (> Do6, ~1 kHz: platos, sibilantes) pesa menos
export function chromaOf(bands) {
  const c = new Float64Array(12);
  for (let b = 0; b < NB; b++) {
    const midi = b + MIDI_LO;
    c[midi % 12] += bands[b] * (midi <= 84 ? 1 : 0.6);
  }
  return c;
}

const cosSim = (a, b) => {
  let ma = 0, mb = 0; for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
  ma /= 12; mb /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db || 1);
};

// Mejor tonalidad de un cromagrama → { tonic, minor, score, second } (score = correlación con el perfil; second =
// la siguiente mejor)
export function bestKey(chroma, profiles = PROFILES) {
  const all = [];
  const rot = new Float64Array(12);
  for (let t = 0; t < 12; t++) {
    for (let i = 0; i < 12; i++) rot[i] = chroma[(i + t) % 12];
    all.push({ tonic: t, minor: false, score: cosSim(rot, profiles.major) });
    all.push({ tonic: t, minor: true, score: cosSim(rot, profiles.minor) });
  }
  all.sort((a, b) => b.score - a.score);
  return { ...all[0], second: all[1] };
}

// Tonalidad de la señal ya diezmada (la que usa el análisis: ~11-12 kHz)
export function keyFromDecimated(d, sr, opts = {}) {
  const kf = keyFrames(d, sr, opts.maxFrames);
  if (!kf || !kf.frames.length) return null;
  return keyFromFrames(kf, opts);
}

// (por separado para las pruebas: los espectros se calculan una vez y se prueban variantes)
export function keyFromFrames(kf, opts = {}) {
  const P = opts.profiles || PROFILES;
  const tuning = opts.tuning ?? kf.tuning ?? estimateTuning(kf);
  const map = bandMap(kf, tuning);
  const maxRms = Math.max(...kf.rms) || 1;
  const segs = new Map();
  const global = new Float64Array(12);
  for (let i = 0; i < kf.frames.length; i++) {
    if (kf.rms[i] < maxRms * 0.08) continue; // silencio o casi
    const bands = frameBands(kf.frames[i], map, opts);
    if (!bands) continue;
    const c = chromaOf(bands);
    let tot = 0; for (let j = 0; j < 12; j++) tot += c[j];
    if (tot <= 1e-9) continue;
    // peso del tramo: cuánto contenido armónico tiene (picos sobre el fondo) y su nivel
    const w = Math.sqrt(tot) * Math.min(1, kf.rms[i] / (maxRms * 0.3));
    const s = Math.floor(kf.times[i] / SEG_SEC);
    let g = segs.get(s); if (!g) segs.set(s, g = { c: new Float64Array(12), w: 0 });
    for (let j = 0; j < 12; j++) { const v = c[j] / tot * w; global[j] += v; g.c[j] += v; }
    g.w += w;
  }
  let gsum = 0; for (let j = 0; j < 12; j++) gsum += global[j];
  if (gsum <= 1e-9) return null;
  const best = bestKey(global, P);
  // votación por tramos: cada tramo vota su tonalidad con su peso × su margen sobre la segunda
  const votes = new Map();
  let vtot = 0;
  for (const g of segs.values()) {
    if (g.w <= 0) continue;
    const k = bestKey(g.c, P);
    const id = k.tonic + (k.minor ? 12 : 0);
    const v = g.w * Math.max(0.05, k.score - k.second.score + 0.05);
    votes.set(id, (votes.get(id) || 0) + v); vtot += v;
  }
  let out = best;
  if (opts.vote !== false && vtot > 0) {
    const gid = best.tonic + (best.minor ? 12 : 0);
    let topId = gid, top = votes.get(gid) || 0;
    for (const [id, v] of votes) if (v > top) { top = v; topId = id; }
    // los tramos solo cambian el resultado global si la mayoría es clara (≥ 1,5 veces lo que tiene la global)
    if (topId !== gid && top >= 1.5 * (votes.get(gid) || 0) && top / vtot >= 0.4) {
      const rot = new Float64Array(12), t = topId % 12, minor = topId >= 12;
      for (let i = 0; i < 12; i++) rot[i] = global[(i + t) % 12];
      out = { tonic: t, minor, score: cosSim(rot, minor ? P.minor : P.major), second: best };
    }
  }
  const conf = Math.max(0, Math.min(1, (out.score - (out.second ? out.second.score : 0)) * 5));
  return { tonic: out.tonic, minor: out.minor, score: out.score, conf, tuning, chroma: Array.from(global, v => v / gsum) };
}

// Tonalidad de un tema (mono a cualquier frecuencia)
export function analyzeKey(mono, sr, opts = {}) {
  const { d, sr: s2 } = decimate(mono, sr, 11025);
  return keyFromDecimated(d, s2, opts);
}
