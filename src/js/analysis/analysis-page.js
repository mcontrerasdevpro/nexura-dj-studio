// Analizador en segundo plano (ventana oculta src/analysis.html, su propio proceso). En un PC lento, analizar
// en la interfaz la paraba: leer el archivo, decodificarlo (Chromium crea el AudioBuffer copiando la pista
// decodificada entera, ~150 MB, en el hilo de quien decodifica) y mezclarlo a mono. Aquí se hace todo en otro
// proceso (otro núcleo) con el mismo decodificador y a la misma frecuencia que la interfaz, así que el resultado
// es idéntico; a la interfaz solo vuelven la forma de onda (unos 200 KB) y los datos del análisis.
// Trabajo: { id, path, url (/__audio/<token>), sr, opts } → { id, ok, result, duration } | { id, ok: false, error }
import { analyze } from './analysis-core.js';

const api = window.nexuraAnalysis;
let queue = Promise.resolve();

async function run(job) {
  try {
    const r = await fetch(job.url + '?p=' + encodeURIComponent(job.path), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 404 ? 'No se encuentra el archivo' : 'No se pudo leer el archivo (HTTP ' + r.status + ')');
    const ctx = new OfflineAudioContext(1, 1, job.sr || 48000);
    const buf = await ctx.decodeAudioData(await r.arrayBuffer());
    const n = buf.length, nch = buf.numberOfChannels;
    let mono = buf.getChannelData(0);
    if (nch > 1) {
      mono = new Float32Array(n);
      for (let c = 0; c < nch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / nch; }
    }
    const result = analyze(mono, buf.sampleRate, job.opts || {});
    api.done({ id: job.id, ok: true, result, duration: buf.duration });
  } catch (e) {
    api.done({ id: job.id, ok: false, error: String((e && e.message) || e) });
  }
}

if (api) api.onJob((job) => { queue = queue.then(() => run(job)); });
