// Worker de análisis (módulo). Recibe los canales de la pista y los mezcla a mono aquí (no en la interfaz):
//   { t: 'full', id, chs, n, sr, opts }                     → todos los canales de una vez (transferidos)
//   { t: 'begin', id, n, nch, sr, opts } + { t: 'chunk', id, off, chs } … + { t: 'run', id } → a trozos
import { analyze } from './analysis-core.js';

const jobs = new Map();

function addChannels(mono, off, chs) {
  const nch = chs.length;
  for (const ch of chs) for (let i = 0; i < ch.length; i++) mono[off + i] += ch[i] / nch;
}

function finish(id, mono, sr, opts) {
  try {
    const r = analyze(mono, sr, opts || {});
    self.postMessage({ id, ok: true, result: r }, [r.wave.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.t === 'full') {
      let mono = m.chs[0];
      if (m.chs.length > 1) { mono = new Float32Array(m.n); addChannels(mono, 0, m.chs); }
      return finish(m.id, mono, m.sr, m.opts);
    }
    if (m.t === 'begin') { jobs.set(m.id, { mono: new Float32Array(m.n), sr: m.sr, opts: m.opts }); return; }
    const j = jobs.get(m.id);
    if (!j) return;
    if (m.t === 'chunk') addChannels(j.mono, m.off, m.chs);
    else if (m.t === 'run') { jobs.delete(m.id); finish(m.id, j.mono, j.sr, j.opts); }
  } catch (err) {
    jobs.delete(m.id);
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};
