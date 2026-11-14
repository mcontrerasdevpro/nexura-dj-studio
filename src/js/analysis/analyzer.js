// Cliente del worker de análisis + caché de formas de onda
import { gridUpdate } from '../audio/grid.js';
import { platform } from '../platform.js';
import { keyToCamelot, keyLabel, KEY_NAMES, yieldToUI } from '../util.js';

const CHUNK = 1 << 19; // muestras por canal en cada trozo enviado al worker (2 MB por canal)

export class Analyzer {
  constructor() {
    this.worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.seq = 0;
    this.queue = Promise.resolve();
    this.waves = new Map(); // id → { data, rate }
    this.worker.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
    };
  }

  // Envía el audio al worker, que lo mezcla a mono y lo analiza. Antes la mezcla a mono (un bucle por cada
  // muestra de la pista) se hacía aquí, en el hilo de la interfaz: medio segundo parado en un PC lento.
  // owned: el AudioBuffer solo sirve para el análisis (análisis por lotes) → sus canales se transfieren sin
  // copiarlos. Si no (pista cargada en un deck), se copian a trozos cediendo el hilo entre trozo y trozo.
  async run(buffer, opts, owned = false) {
    const id = ++this.seq, sr = buffer.sampleRate, n = buffer.length, nch = buffer.numberOfChannels;
    const done = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    let sent = false;
    if (owned) {
      try {
        const chs = [...Array(nch).keys()].map(c => buffer.getChannelData(c));
        this.worker.postMessage({ id, t: 'full', chs, n, sr, opts }, chs.map(c => c.buffer));
        sent = true;
      } catch (_) { /* no se puede transferir: a trozos */ }
    }
    if (!sent) {
      this.worker.postMessage({ id, t: 'begin', n, nch, sr, opts });
      for (let off = 0; off < n; off += CHUNK) {
        const chs = [...Array(nch).keys()].map(c => buffer.getChannelData(c).slice(off, off + CHUNK));
        this.worker.postMessage({ id, t: 'chunk', off, chs }, chs.map(c => c.buffer));
        await yieldToUI();
      }
      this.worker.postMessage({ id, t: 'run' });
    }
    return done;
  }

  // Analiza en cola (uno detrás de otro) y rellena los metadatos de la pista
  analyzeTrack(track, buffer, opts = {}, owned = false) {
    return this.enqueue(async () => this.meta(track, await this.run(buffer, lockOpts(track, opts), owned), buffer.duration));
  }
  // Igual, pero leyendo, decodificando y analizando el archivo en el analizador en segundo plano (otro proceso):
  // el audio no pasa por la interfaz. sr = frecuencia del motor de audio (la misma con la que se decodifica aquí)
  analyzeFile(track, opts = {}, sr = 48000) {
    return this.enqueue(async () => {
      const { result, duration } = await platform.analysis.run(track.path, sr, lockOpts(track, opts));
      return this.meta(track, result, duration);
    });
  }
  enqueue(fn) {
    const job = this.queue.then(fn);
    this.queue = job.catch(() => {});
    return job;
  }

  // Forma de onda a la caché (memoria y disco) y metadatos para la biblioteca
  meta(track, r, duration) {
    const wave = { data: r.wave instanceof Uint8Array ? r.wave : new Uint8Array(r.wave), rate: r.waveRate };
    this.waves.set(track.id, wave);
    platform.waveSet(track.id, packWave(wave)).catch(() => {});
    const meta = {
      duration,
      analyzed: true,
      rmsDb: r.rmsDb,
      waveRate: r.waveRate,
      energy: r.energy, sections: r.sections || [], energyCurve: r.energyCurve || null, energyV: r.energyV || null
    };
    if (!track.bpmLocked) {
      meta.bpm = r.bpm; meta.firstBeat = r.firstBeat; meta.grid = null;
      // tempo variable detectado: beatgrid con marcas (BPM dominante para la biblioteca)
      if (r.grid && r.grid.length > 1) Object.assign(meta, gridUpdate(r.grid, duration), { bpmLocked: false });
    }
    if (r.keyTonic != null && !track.keyLocked) {
      meta.keyTonic = r.keyTonic; meta.keyMinor = r.keyMinor;
      meta.key = keyLabel(r.keyTonic, r.keyMinor);
      meta.camelot = keyToCamelot(KEY_NAMES[r.keyTonic], r.keyMinor);
    }
    return meta;
  }

  async getWave(id) {
    if (this.waves.has(id)) return this.waves.get(id);
    const raw = await platform.waveGet(id);
    if (!raw) return null;
    const w = unpackWave(raw);
    if (w) this.waves.set(id, w);
    return w;
  }
}

// BPM fijado por el usuario: el análisis lo respeta (solo calcula lo demás con esa rejilla)
const lockOpts = (track, opts) => (track.bpmLocked && track.bpm ? { ...opts, lockedBpm: track.bpm, lockedFirstBeat: track.firstBeat || 0 } : opts);

// Formato binario: "NXW1" + float32 rate + datos
function packWave(w) {
  const out = new Uint8Array(8 + w.data.length);
  out.set([78, 88, 87, 49]);
  new DataView(out.buffer).setFloat32(4, w.rate, true);
  out.set(w.data, 8);
  return out;
}
function unpackWave(raw) {
  const u = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  if (u.length < 8 || u[0] !== 78 || u[1] !== 88 || u[2] !== 87 || u[3] !== 49) return null;
  const rate = new DataView(u.buffer, u.byteOffset, 8).getFloat32(4, true);
  return { data: u.slice(8), rate };
}
