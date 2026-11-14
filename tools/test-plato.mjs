// Cuánto se mueve la reproducción con el plato, la onda, la rueda y el jog MIDI. Código real: `Deck`
// (deck.js), los gestos del ratón (ui/jog-gesture.js) y el reproductor del AudioWorklet (deck-processor.js,
// en un contexto vm), a 48 kHz por quanta de 128 muestras. Cada prueba usa dos decks con la misma pista de
// 125 BPM: uno recibe el gesto y el otro no; el desplazamiento es la diferencia de posición al final.
// Uso: node tools/test-plato.mjs [--tabla]  (--tabla: solo imprime las mediciones, sin comprobar)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000, Q = 128, BPM = 125, BEAT_MS = 60000 / BPM;
const TABLE_ONLY = process.argv.includes('--tabla');

let nowMs = 0;
globalThis.performance = { now: () => nowMs };
globalThis.window = {};
globalThis.document = { getElementById: () => null };
const tasks = [];
const later = (ms, fn) => tasks.push({ at: nowMs + ms, fn });

const workletSrc = fs.readFileSync(path.join(root, 'src/js/audio/worklets/deck-processor.js'), 'utf8');
const procs = [];
globalThis.AudioWorkletNode = class {
  constructor() {
    let Cls = null;
    const port = { onmessage: null, postMessage: null };
    const ctx = {
      sampleRate: SR, currentFrame: 0, Math, Float32Array, Int8Array, Int16Array,
      AudioWorkletProcessor: class { constructor() { this.port = port; } },
      registerProcessor: (_n, C) => { Cls = C; }
    };
    vm.createContext(ctx);
    vm.runInContext(workletSrc, ctx);
    const p = { proc: new Cls(), ctx, inbox: [] };
    this.port = { onmessage: null, postMessage: (m) => p.inbox.push(m) };
    port.postMessage = (m) => later(2, () => this.port.onmessage && this.port.onmessage({ data: m }));
    procs.push(p);
  }
  connect() { return this; }
};
const outs = () => [[new Float32Array(Q), new Float32Array(Q)], [new Float32Array(Q), new Float32Array(Q)]];

const { Deck } = await import(pathToFileURL(path.join(root, 'src/js/audio/deck.js')));
const G = await import(pathToFileURL(path.join(root, 'src/js/ui/jog-gesture.js')));

function makeApp(settings = {}) {
  const app = {
    settings: { pitchRange: 0.08, quantize: true, syncPhase: true, motorStart: 4, motorStop: 4, jogSensitivity: 1, ...settings },
    engine: { ctx: { sampleRate: SR, currentTime: 0 }, channels: [0, 1].map(() => ({ input: {}, stemIn: {}, set() {} })), resume() {}, effectiveGain: () => 1 },
    library: { update() {}, guard: () => true, logPlay() {} },
    toast() {}, deckCount: 2, emit() {}, on() {}, expansions: null
  };
  app.decks = [0, 1].map(i => new Deck(app, i));
  Object.defineProperty(app, 'activeDecks', { get: () => app.decks });
  return app;
}
const SECS = 30;
const buffer = () => {
  const n = SECS * SR, d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = 0.25 * Math.sin(2 * Math.PI * 55 * i / SR);
  return { sampleRate: SR, duration: SECS, numberOfChannels: 1, getChannelData: () => d };
};
const mkTrack = (id) => ({ id, path: id, source: 'local', title: id, bpm: BPM, firstBeat: 0.1, grid: null, duration: SECS, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), analyzed: true });

function simulate(app, seconds, events, probe) {
  const nQ = Math.round(seconds * SR / Q), start = nowMs;
  const ev = events.slice().sort((a, b) => a.t - b.t);
  let nextFrame = nowMs + 16.7;
  for (let q = 0; q < nQ; q++) {
    const tNow = start + q * Q / SR * 1000;
    for (;;) {
      let best = -1, at = Infinity;
      for (let i = 0; i < tasks.length; i++) if (tasks[i].at < at) { at = tasks[i].at; best = i; }
      const evAt = ev.length ? start + ev[0].t * 1000 : Infinity;
      const m = Math.min(at, evAt, nextFrame);
      if (m > tNow) break;
      nowMs = m;
      if (m === evAt) ev.shift().fn();
      else if (m === at) tasks.splice(best, 1)[0].fn();
      else { app.decks.forEach(d => d.frame && d.frame()); nextFrame += 16.7; }
    }
    nowMs = tNow;
    for (const p of procs) {
      p.ctx.currentFrame = q * Q;
      while (p.inbox.length) p.proc.onMsg(p.inbox.shift());
      p.proc.process([], outs());
    }
    if (probe) probe(procs[0].proc, procs[1].proc);
  }
}

// Ejecuta `gesture(deck, app)` (lista de { t, fn }) en el deck 0 y devuelve el desplazamiento (ms de pista)
// respecto al deck 1, más el salto más grande de posición entre dos quanta
async function measure({ playing, settings, gesture, vinyl = true, probe }) {
  procs.length = 0; tasks.length = 0; nowMs = 0;
  const app = makeApp(settings);
  const [A, B] = app.decks;
  await A.load(mkTrack('A'), buffer()); await B.load(mkTrack('B'), buffer());
  A.vinyl = vinyl; B.vinyl = vinyl;
  const evs = [];
  evs.push({ t: 0.1, fn: () => { A.seek(10); B.seek(10); } }); // a mitad de pista: se puede ir hacia atrás
  if (playing) evs.push({ t: 0.2, fn: () => { A.play(); B.play(); } });
  for (const e of gesture(A, app)) evs.push({ t: 1 + e.t, fn: e.fn });
  simulate(app, 3, evs, probe);
  return (procs[0].proc.pos - procs[1].proc.pos) / SR * 1000;
}

// geometría como en la app: plato de 190 px (radio 95), onda de 1200 px con zoom de 6 s
const R = 95, WAVE_W = 1200, ZOOM = 6, SEC_PER_PX = ZOOM / WAVE_W;
const at = (r, ang) => ({ x: R + r * Math.cos(ang), y: R + r * Math.sin(ang), cx: R, cy: R, R });
const CLICK = 0.12; // un clic normal: 120 ms pulsado
// clic sin mover en el plato
const platterClick = (r = 70) => (deck, app) => {
  const g = new G.PlatterGesture(deck, app);
  return [{ t: 0, fn: () => g.press(at(r, 0)) }, { t: CLICK, fn: () => g.release() }];
};
// arrastre de 5 px (1 px cada 8 ms) en tangente al plato, a radio r
const platterDrag = (r, px = 5) => (deck, app) => {
  const g = new G.PlatterGesture(deck, app), p0 = at(r, 0);
  const ev = [{ t: 0, fn: () => g.press(p0) }];
  for (let k = 1; k <= px; k++) ev.push({ t: k * 0.008, fn: () => g.move({ ...p0, y: p0.y + k }) });
  ev.push({ t: px * 0.008 + 0.05, fn: () => g.release() });
  return ev;
};
// arrastre de 4 px en horizontal que pasa por el centro del plato (empieza 2 px a su izquierda)
const platterAcrossCenter = () => (deck, app) => {
  const g = new G.PlatterGesture(deck, app), p0 = at(2, Math.PI);
  const ev = [{ t: 0, fn: () => g.press(p0) }];
  for (let k = 1; k <= 4; k++) ev.push({ t: k * 0.008, fn: () => g.move({ ...p0, x: p0.x + k }) });
  ev.push({ t: 0.09, fn: () => g.release() });
  return ev;
};
const waveClick = () => (deck, app) => {
  const g = new G.WaveGesture(deck, app);
  return [{ t: 0, fn: () => g.press(600) }, { t: CLICK, fn: () => g.release() }];
};
const waveDrag = (px = 5) => (deck, app) => {
  const g = new G.WaveGesture(deck, app);
  const ev = [{ t: 0, fn: () => g.press(600) }];
  for (let k = 1; k <= px; k++) ev.push({ t: k * 0.008, fn: () => g.move(600 - k, SEC_PER_PX) });
  ev.push({ t: px * 0.008 + 0.05, fn: () => g.release() });
  return ev;
};
// un paso de rueda hacia arriba (deltaY = −100, como en Chrome); WheelSteps solo existe en la versión nueva
const wheelStep = () => (deck, app) => {
  const g = new G.PlatterGesture(deck, app), steps = G.WheelSteps ? new G.WheelSteps() : null;
  return [{ t: 0, fn: () => (steps ? g.wheel(steps.push({ deltaY: -100, deltaMode: 0 })) : g.wheel(-100)) }];
};
const midiTick = () => (deck) => [{ t: 0, fn: () => deck.jogTurn(1, 605) }];

const CASES = [
  ['Clic sin mover en el plato (VINYL), sonando', { playing: true, gesture: platterClick() }, 0.5],
  ['Clic sin mover en el plato (VINYL), parado', { playing: false, gesture: platterClick() }, 0.5],
  ['Clic sin mover en el plato (sin VINYL), sonando', { playing: true, vinyl: false, gesture: platterClick() }, 0.5],
  ['Clic sin mover en la onda, sonando', { playing: true, gesture: waveClick() }, 0.5],
  ['Clic sin mover en la onda, parado', { playing: false, gesture: waveClick() }, 0.5],
  ['Arrastre de 5 px en el borde del plato (VINYL), sonando', { playing: true, gesture: platterDrag(70) }, null],
  ['Arrastre de 5 px en el borde del plato, parado', { playing: false, gesture: platterDrag(70) }, 40],
  ['Arrastre de 5 px cerca del centro del plato (VINYL), parado', { playing: false, gesture: platterDrag(4) }, 40],
  ['Arrastre de 4 px que cruza el centro del plato (VINYL), parado', { playing: false, gesture: platterAcrossCenter() }, 40],
  ['Arrastre de 5 px en la onda, sonando', { playing: true, gesture: waveDrag() }, null],
  ['Arrastre de 5 px en la onda, parado', { playing: false, gesture: waveDrag() }, 40],
  ['Arrastre de 2 px en la onda (zona muerta), parado', { playing: false, gesture: waveDrag(2) }, 0.5],
  ['Arrastre de 2 px en el plato (zona muerta), parado', { playing: false, gesture: platterDrag(70, 2) }, 0.5],
  ['Un paso de rueda en el plato, parado', { playing: false, gesture: wheelStep() }, BEAT_MS / 16 + 0.5],
  ['Un paso de rueda en el plato, sonando', { playing: true, gesture: wheelStep() }, 20.5],
  ['Un tick del jog MIDI, parado', { playing: false, gesture: midiTick() }, 5],
  ['Un tick del jog MIDI, sonando', { playing: true, gesture: midiTick() }, 5]
];

let failed = 0;
const rows = [];
for (const [name, opts, max] of CASES) {
  const ms = await measure(opts);
  const ok = max == null || Math.abs(ms) <= max;
  rows.push({ name, ms, beats: ms / BEAT_MS });
  if (!ok) failed++;
  const txt = `${Math.abs(ms) < 0.05 ? '0' : ms.toFixed(1)} ms (${(ms / BEAT_MS).toFixed(3)} beats)`;
  console.log(TABLE_ONLY ? `| ${name} | ${txt} |` : `${ok ? '✓' : '✗'} ${name}: ${txt}${max != null ? ` (máx. ${max.toFixed(1)} ms)` : ''}`);
}
if (!TABLE_ONLY) {
  const check = (name, ok, txt) => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}: ${txt}`); };
  // tocar el plato sonando: frena sin volver hacia atrás (antes retrocedía unos ms: un pequeño salto)
  let minSp = 0;
  await measure({ playing: true, gesture: (deck) => [{ t: 0, fn: () => deck.jogTouch(true) }, { t: 0.2, fn: () => deck.jogTouch(false) }], probe: (a) => { minSp = Math.min(minSp, a.cur); } });
  check('Tocar el plato sonando no hace retroceder la pista', minSp > -0.01, `velocidad mínima ${minSp.toFixed(3)}`);
  // scratch con intención en VINYL: ida y vuelta de 40 px en 160 ms → la pista va hacia atrás deprisa
  minSp = 0; let maxSp = 0;
  await measure({
    playing: true,
    gesture: (deck, app) => {
      const g = new G.PlatterGesture(deck, app), p0 = at(80, 0), ev = [{ t: 0, fn: () => g.press(p0) }];
      for (let k = 1; k <= 20; k++) ev.push({ t: k * 0.004, fn: () => g.move({ ...p0, y: p0.y + k * 2 }) });
      for (let k = 1; k <= 20; k++) ev.push({ t: 0.08 + k * 0.004, fn: () => g.move({ ...p0, y: p0.y + 40 - k * 2 }) });
      ev.push({ t: 0.2, fn: () => g.release() });
      return ev;
    },
    probe: (a) => { minSp = Math.min(minSp, a.cur); maxSp = Math.max(maxSp, a.cur); }
  });
  check('Scratch con intención en VINYL: sigue sonando a scratch (adelante y atrás deprisa)', minSp < -1 && maxSp > 1, `velocidad de ${minSp.toFixed(2)} a ${maxSp.toFixed(2)}`);
  // sensibilidad baja / alta: el mismo arrastre mueve la mitad / 1,6 veces
  const lo = await measure({ playing: false, settings: { platterSensitivity: 'low' }, gesture: waveDrag(20) });
  const hi = await measure({ playing: false, settings: { platterSensitivity: 'high' }, gesture: waveDrag(20) });
  const no = await measure({ playing: false, gesture: waveDrag(20) });
  check('Sensibilidad del plato y de la onda (baja / normal / alta)', lo < no && no < hi && Math.abs(lo / no - 0.5) < 0.05, `${lo.toFixed(1)} / ${no.toFixed(1)} / ${hi.toFixed(1)} ms con 20 px`);
  // panel táctil: muchos eventos pequeños = pocos pasos
  const ws = new G.WheelSteps(); let n = 0;
  for (let k = 0; k < 10; k++) if (ws.push({ deltaY: -10, deltaMode: 0 })) n++;
  check('Rueda con panel táctil: 10 eventos de 10 px = 2 pasos', n === 2, `${n} pasos`);
  console.log(failed ? `\n${failed} prueba(s) fallida(s)` : '\nTodo bien');
  process.exitCode = failed ? 1 : 0;
}
