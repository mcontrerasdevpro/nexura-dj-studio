// Pistas de prueba con clics a un BPM conocido (WAV PCM 16 bits estéreo), para las pruebas de sync y de
// rendimiento. Cada beat: clic corto (3 ms, 2 kHz) + bombo (60 Hz, 120 ms); el primer tiempo de cada
// compás, más fuerte. El primer beat cae en `firstBeat` segundos.
'use strict';

function clickSamples({ bpm, seconds, sr = 44100, firstBeat = 0.1 }) {
  const n = Math.round(seconds * sr), L = new Float32Array(n);
  const beat = 60 / bpm;
  for (let b = 0, t = firstBeat; t < seconds; b++, t = firstBeat + b * beat) {
    const i0 = Math.round(t * sr), acc = b % 4 === 0 ? 1 : 0.6;
    for (let i = 0; i < sr * 0.12 && i0 + i < n; i++) {
      const tt = i / sr;
      let v = 0.55 * acc * Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-tt * 40)) * tt) * Math.exp(-tt * 18);
      if (tt < 0.003) v += 0.5 * acc * Math.sin(2 * Math.PI * 2000 * tt) * (1 - tt / 0.003);
      L[i0 + i] += v;
    }
  }
  // fondo suave para que la forma de onda tenga algo entre golpes
  for (let i = 0; i < n; i++) L[i] += 0.05 * Math.sin(2 * Math.PI * 330 * i / sr) * (0.6 + 0.4 * Math.sin(2 * Math.PI * i / sr / 8));
  return L;
}

function wavBytes(L, sr = 44100) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, L[i])) * 32767 | 0;
    buf.writeInt16LE(v, 44 + i * 4); buf.writeInt16LE(v, 46 + i * 4);
  }
  return buf;
}

const clickWav = (opts) => wavBytes(clickSamples(opts), opts.sr || 44100);

module.exports = { clickSamples, wavBytes, clickWav };
