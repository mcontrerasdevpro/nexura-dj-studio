// Tonalidad con tonos sintéticos (sin archivos): progresiones de acordes de tonalidad conocida, con armónicos,
// bajo, bombo y charles de ruido, también desafinadas (432 Hz) → analyzeKey (src/js/analysis/key-core.js).
// Uso: node tools/test-key-synth.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KC = await import(pathToFileURL(path.join(root, 'src/js/analysis/key-core.js')));
const AC = await import(pathToFileURL(path.join(root, 'src/js/analysis/analysis-core.js')));
const { camelotOf } = await import(pathToFileURL(path.join(root, 'tools/key-tags.mjs')));
const { relation } = await import(pathToFileURL(path.join(root, 'tools/key-medir.mjs')));

let failed = 0, total = 0;
const check = (name, ok, data) => { total++; if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}${!ok && data !== undefined ? ' ' + JSON.stringify(data) : ''}`); };

const SR = 22050;
// ruido reproducible
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296 - 0.5; };

// Nota MIDI → Hz con la afinación (cents)
const hz = (m, cents = 0) => 440 * Math.pow(2, (m - 69 + cents / 100) / 12);
// Tono con 6 armónicos (caen 1/h): como un sintetizador o un piano brillante
function addTone(x, t0, dur, midi, amp, cents) {
  const f = hz(midi, cents), i0 = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  for (let h = 1; h <= 6; h++) {
    const fh = f * h; if (fh > SR / 2 - 200) break;
    const w = 2 * Math.PI * fh / SR, a = amp / h;
    for (let i = 0; i < n && i0 + i < x.length; i++) {
      const env = Math.min(1, i / (0.01 * SR)) * Math.min(1, (n - i) / (0.05 * SR));
      x[i0 + i] += a * env * Math.sin(w * i);
    }
  }
}
function addKick(x, t0) {
  const i0 = Math.floor(t0 * SR), n = Math.floor(0.25 * SR);
  for (let i = 0; i < n && i0 + i < x.length; i++) { const t = i / SR; x[i0 + i] += 0.8 * Math.exp(-t * 18) * Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-t * 30)) * t); }
}
function addHat(x, t0) {
  const i0 = Math.floor(t0 * SR), n = Math.floor(0.05 * SR);
  for (let i = 0; i < n && i0 + i < x.length; i++) x[i0 + i] += 0.25 * Math.exp(-i / (0.01 * SR)) * rnd();
}

// Progresión de 4 acordes (grados de la escala) en la tonalidad tonic/minor, 2 compases por acorde a 124 BPM
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11], MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
function song(tonic, minor, { cents = 0, seconds = 64, drums = true } = {}) {
  const x = new Float32Array(Math.floor(seconds * SR));
  const sc = minor ? MINOR_SCALE : MAJOR_SCALE;
  // mayor: I – V – vi – IV · menor: i – VI – VII – i (habituales en pop y música de baile). (La menor i – VI – III –
  // VII es literalmente vi – IV – I – V de su relativa mayor: sin otra pista no se puede saber cuál es)
  const prog = minor ? [0, 5, 6, 0] : [0, 4, 5, 3];
  const beat = 60 / 124, bar = beat * 4;
  const triad = (deg) => [0, 2, 4].map(k => { const d = deg + k; return sc[d % 7] + 12 * Math.floor(d / 7); });
  for (let b = 0, t = 0; t < seconds; b++, t += bar) {
    const deg = prog[Math.floor(b / 2) % 4];
    const notes = triad(deg);
    for (const n of notes) addTone(x, t, bar, 60 + tonic + n, 0.10, cents);           // acorde en la 4.ª octava
    addTone(x, t, bar, 36 + tonic + sc[deg], 0.22, cents);                             // bajo: la raíz del acorde
    // melodía: notas de la escala
    for (let k = 0; k < 4; k++) addTone(x, t + k * beat, beat * 0.9, 72 + tonic + sc[(deg + [0, 2, 4, 2][k]) % 7], 0.05, cents);
    if (drums) for (let k = 0; k < 4; k++) { addKick(x, t + k * beat); addHat(x, t + k * beat + beat / 2); }
  }
  return x;
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const runAll = (opts) => {
  const rows = [];
  for (let t = 0; t < 12; t++) for (const minor of [false, true]) {
    const k = KC.analyzeKey(song(t, minor, opts), SR);
    rows.push({ want: camelotOf({ tonic: t, minor }), got: k ? camelotOf(k) : '', tuning: k ? k.tuning : null, name: NAMES[t] + (minor ? 'm' : '') });
  }
  return rows;
};

// 1) las 24 tonalidades, afinadas a 440 Hz, con batería
const a = runAll({});
const exA = a.filter(r => r.want === r.got).length;
check(`24 tonalidades con acordes, bajo y batería: ${exA}/24 exactas (≥ 22)`, exA >= 22, a.filter(r => r.want !== r.got));
check('Ninguna tonalidad sintética con error grave (todas exactas o compatibles)', a.every(r => relation(r.want, r.got) !== 'grave'), a.filter(r => relation(r.want, r.got) === 'grave'));

// 2) afinación a 432 Hz (−31,8 cents): se detecta la desviación y la tonalidad sigue siendo la misma
const b = runAll({ cents: -31.77 });
const exB = b.filter(r => r.want === r.got).length;
check(`Afinadas a 432 Hz: ${exB}/24 exactas (≥ 22)`, exB >= 22, b.filter(r => r.want !== r.got));
const tun = b.map(r => r.tuning);
check(`Afinación estimada ≈ −32 cents (media ${(tun.reduce((s, v) => s + v, 0) / tun.length).toFixed(1)})`, tun.every(v => Math.abs(v + 31.77) < 6), tun.map(v => +v.toFixed(1)));
const tun0 = a.map(r => r.tuning);
check('Afinación estimada ≈ 0 cents a 440 Hz', tun0.every(v => Math.abs(v) < 5), tun0.map(v => +v.toFixed(1)));

// 3) sin batería y solo 30 s
const c = runAll({ drums: false, seconds: 30 });
const exC = c.filter(r => r.want === r.got).length;
check(`Sin batería, 30 s: ${exC}/24 exactas (≥ 22)`, exC >= 22, c.filter(r => r.want !== r.got));

// 4) intro de 32 s en otra tonalidad (La menor) y el tema de 96 s en Mi bemol mayor: gana la del tema
{
  const intro = song(9, true, { seconds: 24 }), body = song(3, false, { seconds: 96 });
  const x = new Float32Array(intro.length + body.length); x.set(intro); x.set(body, intro.length);
  const k = KC.analyzeKey(x, SR);
  check(`Intro en otra tonalidad: gana la del tema (5B), sale ${k && camelotOf(k)}`, k && camelotOf(k) === '5B', k);
}

// 5) silencio, ruido y audio demasiado corto: sin tonalidad o sin errores
check('Silencio → sin tonalidad', KC.analyzeKey(new Float32Array(SR * 20), SR) === null);
check('Audio de menos de 1 s → sin tonalidad', KC.analyzeKey(new Float32Array(SR / 2), SR) === null);
{ const x = new Float32Array(SR * 20); for (let i = 0; i < x.length; i++) x[i] = rnd() * 0.3; const k = KC.analyzeKey(x, SR); check(`Ruido blanco → baja confianza (${k ? k.conf.toFixed(2) : 'nula'})`, !k || k.conf < 0.5, k); }

// 6) el análisis completo (analyze) devuelve la tonalidad nueva y su versión
{
  const x = song(9, true, { seconds: 40 });
  const r = AC.analyze(x, SR, {});
  check(`analyze(): tonalidad 8A y keyV ${KC.KEY_VERSION}`, camelotOf({ tonic: r.keyTonic, minor: r.keyMinor }) === '8A' && r.keyV === KC.KEY_VERSION, { t: r.keyTonic, m: r.keyMinor, v: r.keyV });
}

console.log(`\n${total - failed}/${total} comprobaciones de tonalidad con tonos sintéticos correctas`);
process.exit(failed ? 1 : 0);
