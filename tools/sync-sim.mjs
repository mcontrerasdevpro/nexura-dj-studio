// Simulador del SYNC en Node con el código real (lo usan test-sync.mjs y test-beatgrid-real.mjs): `Deck`
// (deck.js), `SyncManager` (sync.js) y el reproductor del AudioWorklet (worklets/deck-processor.js, ejecutado en
// un contexto vm con sus globales). Reloj de audio por quanta de 128 muestras a 48 kHz; los mensajes del worklet
// llegan a la interfaz con 1-6 ms de retraso aleatorio y el bucle de la interfaz corre como en la app
// (temporizador de sync + frames de 60 Hz con algo de variación). `simulate(..., { capture })` guarda además el
// audio que sale de cada deck (canal izquierdo de la salida principal, con key lock incluido) para medir los
// bombos en la salida.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SR = 48000, Q = 128;

// ---------------------------------------------------------------- reloj y tareas de la «interfaz»
let nowMs = 0;
globalThis.performance = { now: () => nowMs };
globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || { getElementById: () => null };
let seed = 7;
export const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
export const tasks = []; // { at, fn }
export const later = (ms, fn) => tasks.push({ at: nowMs + ms, fn });
export const now = () => nowMs;

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
export const procs = [];
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

export const { Deck } = await import(pathToFileURL(path.join(root, 'src/js/audio/deck.js')));
export const Grid = await import(pathToFileURL(path.join(root, 'src/js/audio/grid.js')));
let SyncMod = null;
try { SyncMod = await import(pathToFileURL(path.join(root, 'src/js/audio/sync.js'))); } catch (_) { /* versión anterior */ }
export { SyncMod };

export function reset() { procs.length = 0; tasks.length = 0; }

// ---------------------------------------------------------------- app mínima
export function makeApp(settings = {}) {
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
export const track = (app, id, bpm, firstBeat, grid, secs = 330) => {
  const t = { id, path: id, source: 'local', title: id, bpm, firstBeat, grid: grid || null, duration: secs, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), analyzed: true };
  app.tracks[id] = t;
  return t;
};
// AudioBuffer mínimo a partir de una señal mono
export const monoBuffer = (d) => ({ sampleRate: SR, duration: d.length / SR, numberOfChannels: 1, getChannelData: () => d });

// Dos pistas (audio mono + su grid {bpm, firstBeat, grid}) en los decks 1 (maestro, suena desde 0) y 2 (suena
// desde bPlayAt y activa SYNC en bSyncAt) durante `seconds`; devuelve el audio de salida de cada deck
// (aStart / bStart: posición de la pista, s, desde la que empieza a sonar cada deck)
export async function syncRun({ a, b, seconds = 200, keylockA = false, keylockB = false, bPlayAt = 1, bSyncAt = 4, aStart = 0, bStart = 0, settings = {}, events = [] }) {
  reset();
  const app = makeApp(settings);
  const [A, B] = app.decks;
  const tA = track(app, 'A', a.track.bpm, a.track.firstBeat, a.track.grid, a.x.length / SR);
  const tB = track(app, 'B', b.track.bpm, b.track.firstBeat, b.track.grid, b.x.length / SR);
  await A.load(tA, monoBuffer(a.x));
  await B.load(tB, monoBuffer(b.x));
  if (keylockA) A.toggleKeylock();
  if (keylockB) B.toggleKeylock();
  if (aStart) A.seek(aStart);
  if (bStart) B.seek(bStart);
  const out = simulate(app, seconds, [
    { t: 0, fn: () => A.play() }, { t: bPlayAt, fn: () => B.play() }, { t: bSyncAt, fn: () => B.setSync(true) },
    ...events.map(e => ({ t: e.t, fn: () => e.fn(app, A, B) }))
  ], null, {});
  return { app, A, B, tA, tB, out };
}

// ---------------------------------------------------------------- simulación
const TICK_MS = SyncMod ? SyncMod.SYNC_TICK_MS : 250;
// capture: { seconds } → devuelve [Float32Array por deck] con el audio de salida de los decks 1 y 2
export function simulate(app, seconds, events, sample, capture = null) {
  const nQ = Math.round(seconds * SR / Q);
  let nextTick = nowMs + TICK_MS, nextFrame = nowMs + 16.7;
  const ev = events.slice().sort((a, b) => a.t - b.t);
  const start = nowMs;
  const cap = capture ? procs.slice(0, 2).map(() => new Float32Array(nQ * Q)) : null;
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
    procs.slice(0, 2).forEach((p, k) => {
      p.ctx.currentFrame = q * Q;
      while (p.inbox.length) p.proc.onMsg(p.inbox.shift());
      const o = outs();
      p.proc.process([], o);
      if (cap) cap[k].set(o[0][0], q * Q);
    });
    if (sample) sample((q + 1) * Q / SR);
  }
  return cap;
}
