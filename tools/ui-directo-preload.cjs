// Preload de prueba (tools/ui-check-directo.cjs): archivos de audio simulados que siguen «en el disco» al recargar
// la página. Ruta «web:<título>.wav:<bpm>» → WAV de 40 s con un bombo en cada beat. Solo para pruebas.
'use strict';
function clickWav(bpm, seconds = 40, sr = 44100) {
  const n = sr * seconds, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 2, true);
  const s = new Int16Array(buf, 44, n), beat = 60 / bpm;
  for (let b = 0, t = 0.1; t < seconds - 0.2; b++, t = 0.1 + b * beat) {
    const i0 = Math.round(t * sr);
    for (let k = 0; k < sr * 0.1 && i0 + k < n; k++) { const tt = k / sr; s[i0 + k] = Math.round(12000 * Math.sin(2 * Math.PI * (60 + 80 * Math.exp(-tt * 40)) * tt) * Math.exp(-tt * 20)); }
  }
  return new Uint8Array(buf);
}
const cache = new Map();
window.__nexuraFileMock = async (p) => {
  const m = /^web:(.+)\.wav:(\d+)$/.exec(String(p));
  if (!m) return null;
  if (!cache.has(p)) cache.set(p, clickWav(+m[2]));
  return cache.get(p).slice();
};
