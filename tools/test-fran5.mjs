// FRAN5 (1.0.0-rc.9) sin interfaz: lo que se puede probar con el código real y sin AudioContext.
// - Salida de audio: dispositivo igual ('' = 'default'), «Automático» (4 canales solo con interfaz de 4 o de
//   controladora; 6-8 canales → estéreo), auriculares en el mismo dispositivo → sin segunda salida.
// - Ataque del golpe (audio/attack.js) con bombos sintéticos: grid 20 ms desplazado → el ataque (±1 ms); a 45 ms
//   → nada (el cue va a la línea); pad sostenido o silencio → nada.
// - Deck: editar grid (◂ ▸ 1 ms / 10 ms / ½ beat, arrastrar con un solo paso de deshacer, «1 aquí», queda manual
//   y guarda el grid del análisis) y la posición de los cues con Q / Mayús / modificador MIDI.
// Uso: node tools/test-fran5.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let nowMs = 0;
globalThis.performance = { now: () => nowMs };
globalThis.window = {};
globalThis.document = { getElementById: () => null };
globalThis.AudioWorkletNode = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } connect() { return this; } disconnect() {} };

const E = await import(pathToFileURL(path.join(root, 'src/js/audio/engine.js')));
const { findAttack } = await import(pathToFileURL(path.join(root, 'src/js/audio/attack.js')));
const { Deck, ATTACK_WIN } = await import(pathToFileURL(path.join(root, 'src/js/audio/deck.js')));
const { needsGrid } = await import(pathToFileURL(path.join(root, 'src/js/analysis/analyzer.js'))).catch(() => ({ needsGrid: null }));

let failed = 0, total = 0;
const check = (name, ok, data) => { total++; if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ' ' + JSON.stringify(data)}`); };

// ---------------------------------------------------------------- salida de audio
check('Mismo dispositivo: "" y "default" son el predeterminado', E.sameDevice('', 'default') && E.sameDevice('default', '') && !E.sameDevice('abc', '') && E.sameDevice('abc', 'abc'));
const pm = (mode, max, o) => E.pickOutputMode(mode, max, o);
check('Automático + interfaz de 4 canales (controladora) → 4 canales', pm('auto', 4, {}) === '4ch');
check('Automático + tarjeta 7.1 / auriculares envolventes (8 canales) → solo master en estéreo', pm('auto', 8, { label: 'Altavoces (Realtek High Definition Audio)' }) === 'stereo' && pm('auto', 6, {}) === 'stereo');
check('Automático + 8 canales con nombre de controladora (la MIDI conectada) → 4 canales', pm('auto', 8, { label: 'Altavoces (MC4000)', controller: 'DENON DJ MC4000' }) === '4ch' && E.looksLikeDjDevice('DDJ-400 Audio', 'DDJ-400'));
check('Automático + estéreo y auriculares en otro dispositivo → separados; en el mismo → estéreo', pm('auto', 2, { cueOk: true }) === 'separate' && pm('auto', 2, { cueOk: false }) === 'stereo');
check('«Separados» sin unos auriculares en otro dispositivo → estéreo (nunca una segunda salida al mismo)', pm('separate', 2, { cueOk: false }) === 'stereo');
check('«4 canales» con un dispositivo de 2 → estéreo', pm('4ch', 2, {}) === 'stereo');

// ---------------------------------------------------------------- ataque del golpe
const SR = 48000;
function kicks(fb, bpm, secs, opts = {}) {
  const n = secs * SR, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = (opts.pad || 0) * Math.sin(2 * Math.PI * 220 * i / SR) + (opts.noise || 0) * (Math.random() - 0.5);
  if (!opts.noKick) for (let b = 0, x = fb; x < secs - 0.3; b++, x = fb + b * 60 / bpm) {
    const i0 = Math.round(x * SR);
    for (let k = 0; k < SR * 0.12 && i0 + k < n; k++) { const tt = k / SR; L[i0 + k] += 0.6 * Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-tt * 40)) * tt) * Math.exp(-tt * 18) + (tt < 0.003 ? 0.4 * Math.sin(2 * Math.PI * 2000 * tt) : 0); }
  }
  return L;
}
const fb = 0.5, bpm = 125, beat = 60 / bpm, kickAt = (b) => fb + b * beat;
const L = kicks(fb, bpm, 20, { pad: 0.05, noise: 0.01 });
const a20 = findAttack([L], SR, kickAt(16) - 0.02, ATTACK_WIN), a20b = findAttack([L], SR, kickAt(17) + 0.025, ATTACK_WIN);
check('Línea del grid 20 ms antes del bombo: el ataque real (±1 ms)', a20 != null && Math.abs(a20 - kickAt(16)) < 0.0015, { a20, kick: kickAt(16) });
check('Línea del grid 25 ms después del bombo: el ataque real (±1 ms)', a20b != null && Math.abs(a20b - kickAt(17)) < 0.0015, { a20b, kick: kickAt(17) });
check('Línea a 45 ms del bombo (fuera de los 30 ms): ningún golpe → el cue va a la línea', findAttack([L], SR, kickAt(16) - 0.045, ATTACK_WIN) == null);
check('Sin golpes (pad sostenido): ningún ataque', findAttack([kicks(fb, bpm, 10, { pad: 0.3, noKick: true })], SR, 4, ATTACK_WIN) == null);
check('Silencio o fuera de la pista: ningún ataque (sin errores)', findAttack([new Float32Array(SR * 2)], SR, 1, 0.03) == null && findAttack([L], SR, 999, 0.03) == null && findAttack([L], SR, -1, 0.03) == null);

// ---------------------------------------------------------------- Deck: editar grid y cues
function makeApp(attack = null) {
  const toasts = [];
  const app = {
    settings: { pitchRange: 0.08, quantize: true, motorStart: 4, motorStop: 4 },
    engine: { ctx: { sampleRate: SR, currentTime: 0 }, channels: [0, 1].map(() => ({ input: {}, stemIn: {}, set() {} })), resume() {}, effectiveGain: () => 1 },
    library: { update: (id, p) => Object.assign(app.decks[0].track, p), guard: () => true, logPlay() {} },
    toast: (m) => toasts.push(m), toasts, emit() {}, on() {}, attackNear: attack
  };
  app.decks = [new Deck(app, 0)];
  return app;
}
const track = () => ({ id: 'x', source: 'local', bpm: 125, firstBeat: 0.48, grid: null, gridV: 2, bpmLocked: false, analyzed: true, duration: 90, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: [] });
const setup = (attack) => { const app = makeApp(attack), d = app.decks[0]; d.track = track(); d.duration = 90; d.sr = SR; d.st = { pos: 20, sp: 0, at: nowMs }; return { app, d }; };
const bar = 4 * beat, wrapd = (x) => { let v = x % bar; if (v > bar / 2) v -= bar; if (v < -bar / 2) v += bar; return v; };

{
  const { app, d } = setup();
  d.toggleGridEdit(true);
  check('«Editar grid» se activa con una pista con BPM', d.gridEditing === true);
  const f0 = d.track.firstBeat;
  d.gridNudge(1, 1); const f1 = d.track.firstBeat;
  d.gridNudge(1, 10); const f2 = d.track.firstBeat;
  d.gridNudge(-1, 'half'); const f3 = d.track.firstBeat;
  check('◂ ▸: +1 ms, +10 ms y −½ beat exactos', Math.abs(wrapd(f1 - f0) - 0.001) < 1e-9 && Math.abs(wrapd(f2 - f1) - 0.010) < 1e-9 && Math.abs(wrapd(f3 - f2) + beat / 2) < 1e-9, { a: wrapd(f1 - f0), b: wrapd(f2 - f1), c: wrapd(f3 - f2) });
  check('Lo editado queda manual (bpmLocked) y se guarda el grid del análisis (0,48 s)', d.track.bpmLocked === true && d.track.gridAuto && d.track.gridAuto.firstBeat === 0.48);
  if (needsGrid) check('Un grid manual no se vuelve a calcular solo (ni con análisis de versión antigua)', needsGrid({ ...d.track, gridV: 1 }) === false);
  const n0 = d.gridUndo.stack.length;
  check('Arrastrar la rejilla: empieza solo en modo edición', d.gridDragStart() === true);
  d.gridDragMove(0.004); d.gridDragMove(0.003); d.gridDragMove(-0.002);
  const live = d.track.firstBeat;
  d.gridDragEnd();
  check('Arrastrar: se mueve en vivo lo arrastrado (+5 ms) y queda un solo paso de deshacer', Math.abs(wrapd(live - f3) - 0.005) < 1e-9 && d.gridUndo.stack.length === n0 + 1 && Math.abs(wrapd(d.track.firstBeat - f3) - 0.005) < 1e-9);
  d.undoGrid();
  check('Deshacer el arrastre vuelve al grid de antes', Math.abs(wrapd(d.track.firstBeat - f3)) < 1e-9);
  d.st = { pos: 30.5, sp: 0, at: nowMs };
  d.downbeatHere();
  const b = d.beatAt(30.5);
  check('«1 aquí»: el beat 1 del compás cae en el cabezal', Math.abs(b - Math.round(b)) < 1e-9 && ((Math.round(b) % 4) + 4) % 4 === 0, { b });
  d.toggleGridEdit(false);
  check('Fuera del modo edición, arrastrar la onda no mueve el grid', d.gridDragStart() === false);
}
{
  // cues: el ataque que da app.attackNear (simulado a 12 ms de la línea) o la línea
  const near = (d, line) => line + 0.012;
  const { app, d } = setup(near);
  d.st = { pos: kickAt(16) + 0.1, sp: 0, at: nowMs };
  const line = d.nearestBeat(d.time);
  d.hotcue(0); check('Con Q: el cue va al golpe que hay junto a la línea', Math.abs(d.track.cues[0].t - (line + 0.012)) < 1e-9);
  d.padDown(1, true); check('Mayús + pad vacío: justo donde está, sin cuantizar', Math.abs(d.track.cues[1].t - d.time) < 1e-9);
  d.setFreeCue(true); d.hotcue(2); d.setFreeCue(false); check('Modificador MIDI «Cues sin cuantizar»: justo donde está', Math.abs(d.track.cues[2].t - d.time) < 1e-9);
  d.padDown(1, true); check('Mayús + pad con cue: lo borra', d.track.cues[1] === null);
  app.attackNear = () => null; d.hotcue(3); check('Sin golpe cerca: a la línea del grid', Math.abs(d.track.cues[3].t - line) < 1e-9);
  app.settings.quantize = false; d.hotcue(4); check('Sin Q: justo donde está', Math.abs(d.track.cues[4].t - d.time) < 1e-9);
  app.settings.quantize = true; d.cueDown(true); check('CUE con Mayús/Alt (en pausa fuera del cue): sin cuantizar', Math.abs(d.cuePoint - d.time) < 1e-9);
}

console.log(failed ? `\n${failed}/${total} comprobaciones fallidas` : `\n${total}/${total} comprobaciones de FRAN5 correctas`);
process.exitCode = failed ? 1 : 0;
