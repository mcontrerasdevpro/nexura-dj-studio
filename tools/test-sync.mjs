// SYNC simulado en Node con el código real: `Deck` (deck.js) y el reproductor del AudioWorklet
// (worklets/deck-processor.js, ejecutado en un contexto vm con sus globales). Reloj de audio por quanta de 128
// muestras a 48 kHz; los mensajes del worklet llegan a la interfaz con 1-6 ms de retraso aleatorio y el bucle
// de la interfaz corre como en la app (temporizador de sync + frames de 60 Hz con algo de variación).
// Mide en cada quantum la deriva de fase REAL (posiciones del worklet, no las estimadas) en ms y el error de
// tempo entre el maestro y el deck sincronizado, durante 5 minutos de audio, con grids constantes y variables.
// Escenarios: tempo y fase al pulsar SYNC, grid variable en los dos decks, cambios de tempo del maestro, ×2 / ½,
// key lock, pitch del deck sincronizado, nudge con el jog, pitch bend, deck parado, cambio de pista con SYNC,
// elección del maestro (el primero que suena / el elegido / los dos con SYNC) y deck de YouTube.
// Uso: node tools/test-sync.mjs [--verbose]  (--verbose: los números de cada escenario)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000, Q = 128;
const VERBOSE = process.env.NEXURA_SYNC_VERBOSE === '1' || process.argv.includes('--verbose');

// ---------------------------------------------------------------- reloj y tareas de la «interfaz»
let nowMs = 0;
globalThis.performance = { now: () => nowMs };
globalThis.window = {};
globalThis.document = { getElementById: () => null };
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const tasks = []; // { at, fn }
const later = (ms, fn) => tasks.push({ at: nowMs + ms, fn });

// ---------------------------------------------------------------- worklet real en un contexto vm
const workletSrc = fs.readFileSync(path.join(root, 'src/js/audio/worklets/deck-processor.js'), 'utf8');
function makeProcessor() {
  let Cls = null;
  const port = { onmessage: null, postMessage: null };
  const ctx = {
    sampleRate: SR, currentFrame: 0, Math, Float32Array, Int8Array, Int16Array,
    AudioWorkletProcessor: class { constructor() { this.port = port; } },
    registerProcessor: (_n, C) => { Cls = C; }
  };
  vm.createContext(ctx);
  vm.runInContext(workletSrc, ctx);
  const proc = new Cls();
  return { proc, port, ctx };
}

// AudioWorkletNode simulado: lo que manda el Deck llega al procesador al empezar el siguiente quantum;
// lo que manda el procesador llega a la interfaz con 1-6 ms de retraso
const procs = [];
globalThis.AudioWorkletNode = class {
  constructor() {
    const p = makeProcessor();
    this.sim = p;
    const inbox = [];
    p.inbox = inbox;
    this.port = { onmessage: null, postMessage: (m) => inbox.push(m) };
    p.port.postMessage = (m) => later(1 + rnd() * 5, () => this.port.onmessage && this.port.onmessage({ data: m }));
    procs.push(p);
  }
  connect() { return this; }
};
const outs = () => [[new Float32Array(Q), new Float32Array(Q)], [new Float32Array(Q), new Float32Array(Q)]];

const { Deck } = await import(pathToFileURL(path.join(root, 'src/js/audio/deck.js')));
const Grid = await import(pathToFileURL(path.join(root, 'src/js/audio/grid.js')));
let SyncMod = null;
try { SyncMod = await import(pathToFileURL(path.join(root, 'src/js/audio/sync.js'))); } catch (_) { /* versión anterior */ }

// ---------------------------------------------------------------- app mínima
function makeApp(settings = {}) {
  const toasts = [];
  const app = {
    settings: { pitchRange: 0.08, quantize: true, syncPhase: true, motorStart: 4, motorStop: 4, ...settings },
    engine: { ctx: { sampleRate: SR, currentTime: 0 }, channels: [0, 1, 2, 3].map(() => ({ input: {}, stemIn: {}, set() {} })), resume() {}, effectiveGain: () => 1 },
    library: { update(id, u) { const t = app.tracks[id]; if (t) Object.assign(t, u); }, guard: () => true, logPlay() {} },
    tracks: {},
    toast: (m) => toasts.push(String(m)),
    toasts, deckCount: 2, emit() {}, on() {},
    expansions: null
  };
  app.decks = [0, 1, 2, 3].map(i => new Deck(app, i));
  Object.defineProperty(app, 'activeDecks', { get: () => app.decks.slice(0, app.deckCount) });
  if (SyncMod) app.syncMgr = new SyncMod.SyncManager(app);
  return app;
}
const track = (app, id, bpm, firstBeat, grid, secs = 330) => {
  const t = { id, path: id, source: 'local', title: id, bpm, firstBeat, grid: grid || null, duration: secs, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), analyzed: true };
  app.tracks[id] = t;
  return t;
};
// audio de la pista: bombo en cada beat del grid + bajo de 55 Hz y nota de 220 Hz (el key lock empalma por
// correlación: con silencio elegiría el peor punto)
const buffer = (secs, t) => {
  const n = Math.round(secs * SR), d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = 0.25 * Math.sin(2 * Math.PI * 55 * i / SR) + 0.12 * Math.sin(2 * Math.PI * 220 * i / SR);
  if (t) for (let b = 0; ; b++) {
    const bt = Grid.beatTime(t, b); if (bt >= secs) break;
    const i0 = Math.round(bt * SR);
    for (let i = 0; i < SR * 0.1 && i0 + i < n; i++) { const tt = i / SR; d[i0 + i] += 0.6 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 14); }
  }
  return { sampleRate: SR, duration: secs, numberOfChannels: 1, getChannelData: () => d };
};

// ---------------------------------------------------------------- simulación
const TICK_MS = SyncMod ? SyncMod.SYNC_TICK_MS : 250;
function simulate(app, seconds, events, sample) {
  const nQ = Math.round(seconds * SR / Q);
  let nextTick = nowMs + TICK_MS, nextFrame = nowMs + 16.7;
  const ev = events.slice().sort((a, b) => a.t - b.t);
  const start = nowMs;
  for (let q = 0; q < nQ; q++) {
    const tNow = start + q * Q / SR * 1000;
    // tareas de la interfaz hasta este instante (mensajes del worklet, temporizadores, eventos de la prueba)
    for (;;) {
      let best = -1, at = Infinity;
      for (let i = 0; i < tasks.length; i++) if (tasks[i].at < at) { at = tasks[i].at; best = i; }
      const evAt = ev.length ? start + ev[0].t * 1000 : Infinity;
      const m = Math.min(at, nextTick, nextFrame, evAt);
      if (m > tNow) break;
      nowMs = m;
      if (m === evAt) ev.shift().fn();
      else if (m === at) tasks.splice(best, 1)[0].fn();
      else if (m === nextTick) { app.syncMgr ? app.syncMgr.tick() : app.decks.forEach(d => d.syncTick()); nextTick += TICK_MS; }
      else { app.decks.forEach(d => d.frame && d.frame()); nextFrame += 16.7 + (rnd() - 0.5) * 3; }
    }
    nowMs = tNow;
    for (const p of procs.slice(0, 2)) {
      p.ctx.currentFrame = q * Q;
      while (p.inbox.length) p.proc.onMsg(p.inbox.shift());
      p.proc.process([], outs());
    }
    if (sample) sample((q + 1) * Q / SR);
  }
}

// Posición que SE OYE (s): con key lock o transposición la salida sale del pitch-shifter con su retardo d
// (muestras de salida), así que lo que suena es la pista de hace d muestras
function audible(p) {
  const ps = p.ps, m = p.psMix;
  const d = ps.x >= 0 ? ps.d + (ps.d2 - ps.d) * (0.5 - 0.5 * Math.cos(Math.PI * ps.x / ps.X)) : ps.d;
  return (p.pos - m * d * p.cur * p.ratio) / SR;
}
// deriva de fase REAL (lo que se oye de cada deck) entre el deck f y el maestro m, en ms de tiempo real
function realPhaseMs(f, m) {
  const pf = procs[f.idx].proc, pm = procs[m.idx].proc;
  if (!f.track || !m.track) return NaN;
  const tf = audible(pf), tm = audible(pm);
  const bf = f.beatAt(tf), bm = m.beatAt(tm);
  const k = f.syncMult || ratioMult(f, m, tf, tm);
  let d = (((bm * k) % 1) + 1) % 1 - (((bf % 1) + 1) % 1);
  if (d > 0.5) d -= 1; if (d < -0.5) d += 1;
  return d * (60 / Grid_bpmAt(f, tf)) / f.tempo * 1000;
}
const Grid_bpmAt = (d, t) => (d.track.grid && d.track.grid.length > 1 ? d.track.grid[(() => { let i = 0; while (i + 1 < d.track.grid.length && d.track.grid[i + 1].t <= t) i++; return i; })()].bpm : d.track.bpm);
function ratioMult(f, m, tf, tm) {
  const r = (Grid_bpmAt(m, tm) * m.tempo) / (Grid_bpmAt(f, tf) * f.tempo);
  return r > 1.4 ? 0.5 : r < 0.7 ? 2 : 1;
}
const tempoErr = (f, m) => {
  const pf = procs[f.idx].proc, pm = procs[m.idx].proc;
  const bf = Grid_bpmAt(f, pf.pos / SR) * f.tempo, bm = Grid_bpmAt(m, pm.pos / SR) * m.tempo;
  const k = f.syncMult || ratioMult(f, m, pf.pos / SR, pm.pos / SR);
  return bf - bm * k;
};

function stats(xs) {
  const v = xs.filter(Number.isFinite), a = v.map(Math.abs).sort((x, y) => x - y);
  if (!a.length) return { n: 0, p50: NaN, p95: NaN, max: NaN };
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
  return { n: a.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +a[a.length - 1].toFixed(2), media: +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(2) };
}

let failed = 0, total = 0;
const results = [];
function check(name, ok, data) {
  total++;
  if (!ok) failed++;
  results.push({ name, ok, data });
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok || VERBOSE ? ' ' + JSON.stringify(data) : ''}`);
}

// Escenario genérico: decks A (maestro) y B (sincronizado), 5 min de audio; mide desde `from` s
async function scenario(name, { a, b, settings, events = [], seconds = 300, from = 8, keylockA = false, keylockB = false, aPlayAt = 0, bSyncAt = 4 }) {
  procs.length = 0; tasks.length = 0;
  const app = makeApp(settings);
  const [A, B] = app.decks;
  const tA = track(app, 'A', a.bpm, a.fb ?? 0.1, a.grid), tB = track(app, 'B', b.bpm, b.fb ?? 0.37, b.grid);
  await A.load(tA, buffer(seconds + 30, tA));
  await B.load(tB, buffer(seconds + 30, tB));
  if (keylockA && !A.keylock) A.toggleKeylock();
  if (keylockB && !B.keylock) B.toggleKeylock();
  const ph = [], te = [], marks = [];
  const evs = [
    { t: aPlayAt, fn: () => A.play() },
    { t: 1, fn: () => B.play() },
    { t: bSyncAt, fn: () => B.setSync(true) },
    ...events.map(e => ({ t: e.t, fn: () => e.fn(app, A, B) }))
  ];
  const quiet = events.filter(e => e.quiet).map(e => [e.t, e.t + e.quiet]);
  simulate(app, seconds, evs, (t) => {
    if (t < from || quiet.some(([s, e]) => t >= s && t < e)) return;
    const m = app.syncMgr ? app.syncMgr.master(B) : B.syncMaster;
    if (m !== A || !B.sync || !A.playing || !B.playing) return;
    if ((Math.round(t * SR / Q)) % 4) return; // 1 de cada 4 quanta basta
    ph.push(realPhaseMs(B, A)); te.push(tempoErr(B, A));
    if (B.keylock) { const p = procs[1].proc; marks.push((p.ps.d - p.ps.avg) / SR * 1000); }
  });
  const r = { name, fase: stats(ph), tempoBpm: stats(te), app, A, B, marks };
  if (VERBOSE) console.log('   ', name, 'fase ms', JSON.stringify(r.fase), '· error de tempo BPM', JSON.stringify(r.tempoBpm), marks.length ? '· retardo del key lock respecto a su media (ms) ' + JSON.stringify(stats(marks)) : '');
  return r;
}

const OK_MS = 5;
// 1) grids constantes 128 / 124
let r = await scenario('constante 128 ← 124', { a: { bpm: 128 }, b: { bpm: 124 } });
check('Grid constante (128 maestro, 124 sincronizado), 5 min: |deriva| p95 < 5 ms y máx. < 8 ms', r.fase.p95 < OK_MS && r.fase.max < 8, r.fase);
check('Grid constante: mismo BPM (error < 0,01 BPM)', r.tempoBpm.max < 0.01, r.tempoBpm);
check('Tras SYNC el deck queda a 128 BPM', Math.abs(r.B.currentBpm - 128) < 0.01, { bpm: r.B.currentBpm });

// 2) grids variables en los dos decks
r = await scenario('variable', {
  // marcas en beats enteros: A 124 (206 beats) → 126 (210 beats) → 123; B 120 (300 beats) → 121,5
  a: { bpm: 124, grid: [{ t: 0.1, bpm: 124 }, { t: 0.1 + 206 * 60 / 124, bpm: 126 }, { t: 0.1 + 206 * 60 / 124 + 210 * 60 / 126, bpm: 123 }] },
  b: { bpm: 120, grid: [{ t: 0.37, bpm: 120 }, { t: 0.37 + 300 * 60 / 120, bpm: 121.5 }] }
});
check('Grid variable en los dos decks (124→126→123 / 120→121,5), 5 min: |deriva| p95 < 5 ms y máx. < 10 ms', r.fase.p95 < OK_MS && r.fase.max < 10, r.fase);
check('Grid variable: el BPM sigue al del maestro en cada tramo (p95 < 0,02 BPM)', r.tempoBpm.p95 < 0.02, r.tempoBpm);

// 3) el maestro cambia de tempo (pitch +4 % a los 60 s, −3 % a los 180 s) y el sincronizado lo sigue
r = await scenario('maestro cambia de tempo', {
  a: { bpm: 128 }, b: { bpm: 124 },
  events: [{ t: 60, quiet: 1, fn: (app, A) => A.setPitchFader(0.5) }, { t: 180, quiet: 1, fn: (app, A) => A.setPitchFader(-0.375) }]
});
check('El deck sincronizado sigue los cambios de tempo del maestro (fase p95 < 5 ms)', r.fase.p95 < OK_MS, r.fase);
check('…y su BPM es el del maestro tras cada cambio (133,12 → 124,16)', Math.abs(r.B.currentBpm - r.A.currentBpm) < 0.01 && Math.abs(r.A.currentBpm - 128 * 0.97) < 0.01, { a: r.A.currentBpm, b: r.B.currentBpm });

// 4) ×2 / ½
r = await scenario('×2', { a: { bpm: 128 }, b: { bpm: 65 } });
check('BPM muy distinto (128 maestro, 65 sincronizado → ×2): en fase (p95 < 5 ms)', r.fase.p95 < OK_MS, r.fase);
check('…a 64 BPM (la mitad), no a 128', Math.abs(r.B.currentBpm - 64) < 0.01, { bpm: r.B.currentBpm });
r = await scenario('½', { a: { bpm: 86 }, b: { bpm: 170 } });
check('BPM muy distinto (86 maestro, 170 sincronizado → ½): en fase (p95 < 5 ms) a 172 BPM', r.fase.p95 < OK_MS && Math.abs(r.B.currentBpm - 172) < 0.01, { fase: r.fase, bpm: r.B.currentBpm });

// 5) key lock en el deck sincronizado y en los dos (como ponen Automix y Autoplay)
r = await scenario('key lock', { a: { bpm: 128 }, b: { bpm: 122 }, keylockB: true, seconds: 120 });
// (el key lock por segmentos deja que lo que se oye se separe hasta ±10 ms de la pista entre empalmes: el sync
// descuenta su latencia media, así que la deriva media es ~0 y el resto es esa oscilación; antes, hasta 55 ms)
check('Con key lock en el sincronizado (122 → 128, +4,9 %): lo que se oye, en fase (media < 1 ms, p95 < 10 ms, máx. < 12 ms)', Math.abs(r.fase.media) < 1 && r.fase.p95 < 10 && r.fase.max < 12, r.fase);
r = await scenario('key lock en los dos', { a: { bpm: 126 }, b: { bpm: 124 }, keylockA: true, keylockB: true, seconds: 120, events: [{ t: 30, quiet: 1, fn: (app, A) => A.setPitchFader(0.25) }] });
check('Con key lock en los dos decks y el maestro a +2 %: lo que se oye, en fase (media < 1 ms, p95 < 14 ms)', Math.abs(r.fase.media) < 1 && r.fase.p95 < 14, r.fase);

// 6) pitch del deck sincronizado: no rompe nada (cambia el tempo de los dos y siguen en fase)
r = await scenario('pitch del sincronizado', {
  a: { bpm: 128 }, b: { bpm: 124 }, seconds: 120,
  events: [{ t: 40, quiet: 1.5, fn: (app, A, B) => { B.setPitchFader(B.pitch + 0.25); } }]
});
check('Mover el pitch del deck sincronizado cambia el tempo del grupo (los dos a ~130,6 BPM) y siguen en fase', Math.abs(r.A.currentBpm - r.B.currentBpm) < 0.01 && Math.abs(r.A.currentBpm - 128 * 1.02) < 0.05 && r.fase.p95 < OK_MS && r.B.sync, { a: r.A.currentBpm, b: r.B.currentBpm, fase: r.fase, sync: r.B.sync });

// 7) nudge con el jog y pitch bend: la fase vuelve sola
let back = null;
r = await scenario('nudge', {
  a: { bpm: 128 }, b: { bpm: 124 }, seconds: 60,
  events: [
    { t: 20, quiet: 0.6, fn: (app, A, B) => { for (let i = 0; i < 6; i++) later(i * 30, () => B.jogTurn(60)); } },
    { t: 20.5, fn: (app, A, B) => { back = { at: 20.5, err: Math.abs(realPhaseMs(B, A)) }; } },
    { t: 30, quiet: 1.5, fn: (app, A, B) => { B.bendDown(1); later(400, () => B.bendUp()); } }
  ]
});
check('Nudge con el jog o pitch bend en un deck sincronizado: la fase vuelve (p95 < 5 ms fuera de esos momentos)', r.fase.p95 < OK_MS && back && back.err > 5, { fase: r.fase, nudge: back });

// 8) decks parados. a) A suena (maestro) y SYNC en B parado: B toma el BPM y, al darle a play, entra en fase.
r = await scenario('sincronizado parado', {
  a: { bpm: 128 }, b: { bpm: 124 }, seconds: 40, bSyncAt: 0.5, from: 10.5,
  events: [{ t: 0.9, fn: (app, A, B) => { procs[1].inbox.push({ t: 'play', v: false }); B.playing = false; later(9000, () => B.play()); } }]
});
check('SYNC en un deck parado: toma el BPM del maestro y al darle a play entra en fase (p95 < 5 ms)', Math.abs(r.B.currentBpm - 128) < 0.01 && r.fase.p95 < OK_MS && r.fase.n > 100, { bpm: r.B.currentBpm, fase: r.fase });
// b) maestro elegido (A) parado mientras B suena con SYNC: B toma el BPM de A; cuando A arranca, B se pone en fase
r = await scenario('maestro elegido parado', {
  a: { bpm: 128 }, b: { bpm: 124 }, seconds: 40, aPlayAt: 12, bSyncAt: 4, from: 14,
  events: [{ t: 3, fn: (app, A) => app.syncMgr && app.syncMgr.setMaster(A) }]
});
check('Maestro elegido parado: el sincronizado toma su BPM y, cuando el maestro arranca, en fase (p95 < 5 ms)', Math.abs(r.B.currentBpm - 128) < 0.01 && r.fase.p95 < OK_MS && r.fase.n > 100, { bpm: r.B.currentBpm, fase: r.fase });

// 9) cambio de pista con SYNC activo
r = await scenario('cambio de pista', {
  a: { bpm: 128 }, b: { bpm: 124 }, seconds: 60,
  events: [{ t: 25, quiet: 2, fn: async (app, A, B) => { await B.load(track(app, 'B2', 131, 0.2), buffer(200)); B.play(); } }]
});
check('Cargar otra pista (131 BPM) en el deck sincronizado: sigue con SYNC, a 128 BPM y en fase', r.B.sync && Math.abs(r.B.currentBpm - 128) < 0.01 && r.fase.p95 < OK_MS && r.B.track.id === 'B2', { sync: r.B.sync, bpm: r.B.currentBpm, fase: r.fase });

// 10) quién es el maestro
{
  procs.length = 0; tasks.length = 0;
  const app = makeApp();
  const [A, B] = app.decks;
  await A.load(track(app, 'A', 128, 0.1), buffer(60));
  await B.load(track(app, 'B', 124, 0.2), buffer(60));
  simulate(app, 1, [{ t: 0, fn: () => B.play() }, { t: 0.5, fn: () => A.play() }]);
  // B suena primero: al pulsar SYNC en A, el maestro es B
  simulate(app, 1, [{ t: 0, fn: () => A.setSync(true) }]);
  const m1 = app.syncMgr ? app.syncMgr.master(A) : A.syncMaster;
  check('El maestro es el primero que suena (B) al pulsar SYNC en A', m1 === B && Math.abs(A.currentBpm - 124) < 0.01, { master: m1 && m1.idx, bpmA: A.currentBpm });
  // SYNC también en B: B sigue siendo el maestro y A no se convierte en su maestro (sin bucles)
  simulate(app, 2, [{ t: 0, fn: () => B.setSync(true) }]);
  const mA = app.syncMgr ? app.syncMgr.master(A) : A.syncMaster, mB = app.syncMgr ? app.syncMgr.master(B) : B.syncMaster;
  check('Con SYNC en los dos decks hay un solo maestro (B) y nadie se sigue a sí mismo en bucle', mA === B && (mB === null || mB === B || mB === undefined) && Math.abs(A.currentBpm - B.currentBpm) < 0.01, { mA: mA && mA.idx, mB: mB && mB.idx });
  // elegir maestro a mano
  if (app.syncMgr) {
    simulate(app, 2, [{ t: 0, fn: () => app.syncMgr.setMaster(A) }, { t: 0.5, fn: () => A.setPitchFader(0.25) }]);
    check('Botón «maestro»: elegir A como maestro; al mover su pitch, B lo sigue', app.syncMgr.master(B) === A && Math.abs(B.currentBpm - A.currentBpm) < 0.01 && Math.abs(A.currentBpm - 128 * 1.02) < 0.01, { mB: app.syncMgr.master(B) && app.syncMgr.master(B).idx, a: A.currentBpm, b: B.currentBpm });
  } else check('Botón «maestro» para elegir el maestro', false, { motivo: 'no existe' });
}

// 11) deck de YouTube: SYNC no se activa (el reproductor oficial no permite ajustar tempo/fase con precisión) y se avisa
{
  procs.length = 0; tasks.length = 0;
  const app = makeApp();
  const [A, B] = app.decks;
  await A.load(track(app, 'A', 128, 0.1), buffer(60));
  B.track = track(app, 'Y', 120, 0.1); B.isYT = true; B.duration = 200;
  B.setSync(true);
  check('Deck de YouTube: SYNC no se activa y se explica por qué', !B.sync && app.toasts.some(t => /YouTube/.test(t)), { sync: B.sync, toasts: app.toasts });
  const before = A.tempo;
  A.setSync(true);
  check('…ni se usa como maestro de otro deck (el tempo de A no cambia)', A.tempo === before, { tempo: A.tempo });
}

console.log(`\n${total - failed}/${total} comprobaciones de sync correctas`);
process.exit(failed ? 1 : 0);
