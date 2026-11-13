// Unidades de efectos: 2 unidades × 3 ranuras, sincronizadas al BPM
// Cada efecto expone: input, output, setParam(0..1), setTiming(segundosPorBeat, beats), on(bool)
import { clamp } from '../util.js';

export const BEAT_VALUES = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 3 / 4, 1, 2, 4, 8, 16];
export const beatLabel = (b) => b >= 1 ? String(b) : (b === 0.75 ? '3/4' : '1/' + Math.round(1 / b));

function noiseIR(ctx, seconds, decay, preDelay = 0.01) {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const pd = Math.floor(preDelay * sr);
    for (let i = pd; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - (i - pd) / (len - pd), decay);
  }
  return buf;
}

class Base {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.p = 0.5; this.beatSec = 0.5; this.beats = 1;
  }
  t() { return this.ctx.currentTime; }
  set(param, v, tc = 0.02) { param.setTargetAtTime(v, this.t(), tc); }
  setParam(v) { this.p = v; this.update(); }
  setTiming(beatSec, beats) { this.beatSec = beatSec; this.beats = beats; this.update(); }
  period() { return clamp(this.beatSec * this.beats, 0.01, 30); }
  on() {}
  update() {}
}

// Señal seca + rama húmeda
class WetDry extends Base {
  constructor(ctx) {
    super(ctx);
    this.dry = ctx.createGain(); this.wet = ctx.createGain();
    this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
  }
}

class Echo extends WetDry {
  constructor(ctx, pingpong = false) {
    super(ctx);
    if (!pingpong) {
      this.delay = ctx.createDelay(20);
      this.fb = ctx.createGain();
      this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 6000;
      this.input.connect(this.delay); this.delay.connect(this.tone).connect(this.fb).connect(this.delay);
      this.tone.connect(this.wet);
    } else {
      this.dl = ctx.createDelay(20); this.dr = ctx.createDelay(20);
      this.fb = ctx.createGain();
      const merge = ctx.createChannelMerger(2);
      const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit';
      this.input.connect(mono).connect(this.dl);
      this.dl.connect(this.dr); this.dr.connect(this.fb).connect(this.dl);
      this.dl.connect(merge, 0, 0); this.dr.connect(merge, 0, 1);
      merge.connect(this.wet);
    }
    this.pingpong = pingpong;
    this.update();
  }
  update() {
    const per = this.period();
    if (this.pingpong) { this.set(this.dl.delayTime, per, 0.05); this.set(this.dr.delayTime, per, 0.05); }
    else this.set(this.delay.delayTime, per, 0.05);
    this.set(this.fb.gain, 0.25 + this.p * 0.55);
    this.set(this.wet.gain, 0.15 + this.p * 0.85);
  }
}

class Reverb extends WetDry {
  constructor(ctx, epic = false) {
    super(ctx);
    this.conv = ctx.createConvolver();
    this.conv.buffer = noiseIR(ctx, epic ? 6 : 2.6, epic ? 2.2 : 3.2, epic ? 0.04 : 0.012);
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = epic ? 350 : 150;
    this.input.connect(this.hp).connect(this.conv).connect(this.wet);
    this.epic = epic;
    this.update();
  }
  update() {
    this.set(this.wet.gain, this.p * (this.epic ? 1.4 : 1.1));
    if (this.epic) this.set(this.dry.gain, 1 - this.p * 0.35);
  }
}

class LfoEffect extends WetDry {
  makeLfo(type = 'sine') {
    this.lfo = this.ctx.createOscillator(); this.lfo.type = type;
    this.lfoAmt = this.ctx.createGain();
    this.lfo.connect(this.lfoAmt);
    this.lfo.start();
  }
  lfoRate() { return 1 / this.period(); }
}

class Flanger extends LfoEffect {
  constructor(ctx, chorus = false) {
    super(ctx);
    this.chorus = chorus;
    this.delay = ctx.createDelay(0.1);
    this.delay.delayTime.value = chorus ? 0.018 : 0.004;
    this.fb = ctx.createGain(); this.fb.gain.value = chorus ? 0 : 0.6;
    this.input.connect(this.delay); this.delay.connect(this.fb).connect(this.delay);
    this.delay.connect(this.wet);
    this.makeLfo();
    this.lfoAmt.connect(this.delay.delayTime);
    this.update();
  }
  update() {
    this.set(this.lfo.frequency, this.chorus ? 0.8 + this.p * 2 : this.lfoRate());
    this.set(this.lfoAmt.gain, this.chorus ? 0.004 * (0.3 + this.p) : 0.0035 * (0.3 + this.p));
    this.set(this.wet.gain, this.chorus ? 0.5 + this.p * 0.4 : 0.9);
    this.set(this.dry.gain, this.chorus ? 1 : 0.8);
  }
}

class Phaser extends LfoEffect {
  constructor(ctx) {
    super(ctx);
    this.stages = [];
    let node = this.input;
    for (let i = 0; i < 6; i++) {
      const ap = ctx.createBiquadFilter(); ap.type = 'allpass'; ap.frequency.value = 800; ap.Q.value = 0.6;
      node.connect(ap); node = ap; this.stages.push(ap);
    }
    this.fb = ctx.createGain(); this.fb.gain.value = 0.4;
    node.connect(this.fb).connect(this.stages[0]);
    node.connect(this.wet);
    this.makeLfo();
    for (const s of this.stages) this.lfoAmt.connect(s.frequency);
    this.update();
  }
  update() {
    this.set(this.lfo.frequency, this.lfoRate());
    this.set(this.lfoAmt.gain, 300 + this.p * 1400);
    this.set(this.wet.gain, 0.5 + this.p * 0.5);
  }
}

class FilterFx extends Base {
  constructor(ctx, type) {
    super(ctx);
    this.type = type;
    this.f = ctx.createBiquadFilter(); this.f.type = type; this.f.Q.value = 4;
    this.input.connect(this.f).connect(this.output);
    this.update();
  }
  update() {
    const v = this.p;
    const freq = this.type === 'highpass' ? 20 * Math.pow(10000 / 20, v) : 22000 * Math.pow(80 / 22000, v);
    this.set(this.f.frequency, freq, 0.03);
  }
}

class Crusher extends Base {
  constructor(ctx) {
    super(ctx);
    this.node = new AudioWorkletNode(ctx, 'nexura-crusher', { outputChannelCount: [2] });
    this.input.connect(this.node).connect(this.output);
    this.update();
  }
  update() {
    this.node.parameters.get('bits').setValueAtTime(16 - this.p * 13, this.t());
    this.node.parameters.get('reduce').setValueAtTime(1 + Math.round(this.p * 15), this.t());
  }
}

class Distortion extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.shaper = ctx.createWaveShaper(); this.shaper.oversample = '4x';
    this.post = ctx.createGain();
    this.input.connect(this.shaper).connect(this.post).connect(this.wet);
    this.update();
  }
  update() {
    const k = 2 + this.p * 80, n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    this.shaper.curve = curve;
    this.set(this.post.gain, 0.6 / Math.sqrt(1 + this.p * 4));
    this.set(this.wet.gain, 1); this.set(this.dry.gain, 0);
  }
}

class Gate extends LfoEffect {
  // Trans (square) o Tremolo (sine)
  constructor(ctx, square) {
    super(ctx);
    this.square = square;
    this.vca = ctx.createGain();
    this.input.connect(this.vca).connect(this.output);
    this.dry.disconnect();
    this.makeLfo(square ? 'square' : 'sine');
    this.lfoAmt.connect(this.vca.gain);
    this.update();
  }
  update() {
    this.set(this.lfo.frequency, this.lfoRate() * (this.square ? 1 : 1));
    const depth = 0.15 + this.p * 0.85;
    this.set(this.vca.gain, 1 - depth / 2);
    this.set(this.lfoAmt.gain, depth / 2);
  }
}

class AutoPan extends LfoEffect {
  constructor(ctx) {
    super(ctx);
    this.pan = ctx.createStereoPanner();
    this.input.connect(this.pan).connect(this.output);
    this.dry.disconnect();
    this.makeLfo();
    this.lfoAmt.connect(this.pan.pan);
    this.update();
  }
  update() { this.set(this.lfo.frequency, this.lfoRate()); this.set(this.lfoAmt.gain, 0.2 + this.p * 0.8); }
}

class RingMod extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.vca = ctx.createGain(); this.vca.gain.value = 0;
    this.osc = ctx.createOscillator(); this.osc.connect(this.vca.gain); this.osc.start();
    this.input.connect(this.vca).connect(this.wet);
    this.update();
  }
  update() {
    this.set(this.osc.frequency, 40 * Math.pow(50, this.p));
    this.set(this.wet.gain, 0.4 + this.p * 0.6);
    this.set(this.dry.gain, 1 - this.p * 0.8);
  }
}

class Noise extends WetDry {
  constructor(ctx) {
    super(ctx);
    const len = ctx.sampleRate * 2;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; }
    this.src = ctx.createBufferSource(); this.src.buffer = b; this.src.loop = true; this.src.start();
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'bandpass'; this.hp.Q.value = 1.4;
    this.src.connect(this.hp).connect(this.wet);
    this.update();
  }
  update() {
    this.set(this.hp.frequency, 200 * Math.pow(60, this.p), 0.05);
    this.set(this.wet.gain, 0.04 + this.p * 0.22);
  }
}

class Comb extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.delay = ctx.createDelay(0.05);
    this.fb = ctx.createGain(); this.fb.gain.value = 0.85;
    this.input.connect(this.delay); this.delay.connect(this.fb).connect(this.delay);
    this.delay.connect(this.wet);
    this.update();
  }
  update() { this.set(this.delay.delayTime, 1 / (60 * Math.pow(20, this.p))); this.set(this.wet.gain, 0.5); this.set(this.dry.gain, 0.6); }
}

class Repeat extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.node = new AudioWorkletNode(ctx, 'nexura-repeat', { outputChannelCount: [2] });
    this.input.connect(this.node).connect(this.wet);
    this.dry.gain.value = 0;
    this.update();
  }
  on(v) { this.node.parameters.get('active').setValueAtTime(v ? 1 : 0, this.t()); }
  update() {
    this.node.parameters.get('length').setValueAtTime(clamp(this.period(), 0.02, 4), this.t());
    this.set(this.wet.gain, 1);
  }
}

class Braker extends WetDry {
  // Bajada de tono continua estilo "freno": repetición con transposición descendente
  constructor(ctx) {
    super(ctx);
    this.delay = ctx.createDelay(4);
    this.input.connect(this.delay).connect(this.wet);
    this.dry.gain.value = 0;
    this.update();
  }
  on(v) {
    const t = this.t();
    const p = this.delay.delayTime;
    p.cancelScheduledValues(t);
    this.wet.gain.cancelScheduledValues(t);
    if (v) {
      // retardo d(t) = t²/2T → la velocidad baja linealmente de 1 a 0 en T segundos
      const T = clamp(this.period() * (0.5 + this.p), 0.1, 7.8);
      const curve = new Float32Array(64);
      for (let i = 0; i < 64; i++) { const x = (i / 63) * T; curve[i] = (x * x) / (2 * T); }
      p.setValueCurveAtTime(curve, t, T);
      this.wet.gain.setValueAtTime(1, t);
      this.wet.gain.setValueAtTime(1, t + T * 0.9);
      this.wet.gain.linearRampToValueAtTime(0, t + T);
    } else { p.setValueAtTime(0, t); this.wet.gain.setValueAtTime(1, t); }
  }
}

// ---------------------------------------------------------------- efectos de la fase 2

// Curva de un WaveShaper a partir de una función (cacheada por clave)
const CURVES = new Map();
function curve(key, fn, n = 2048) {
  if (CURVES.has(key)) return CURVES.get(key);
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = fn(i * 2 / (n - 1) - 1);
  CURVES.set(key, c);
  return c;
}
function noiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; }
  return b;
}
// mantiene el valor actual de un parámetro automatizado y cancela lo programado
function hold(param, t) { if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t); else { param.cancelScheduledValues(t); } }

// Reverb Drop: al activarlo corta el seco y la reverb recoge el audio durante `beats`; después deja de
// entrar señal y la cola larga queda sonando (efecto «congelado» antes de un drop)
class ReverbDrop extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.conv = ctx.createConvolver();
    this.conv.buffer = noiseIR(ctx, 6, 1.3, 0.02);
    this.send = ctx.createGain();
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 220;
    this.input.connect(this.send).connect(this.hp).connect(this.conv).connect(this.wet);
    this.update();
  }
  on(v) {
    const t = this.t();
    for (const p of [this.dry.gain, this.send.gain]) hold(p, t);
    if (v) {
      this.dry.gain.setTargetAtTime(0, t, 0.015);
      this.send.gain.setValueAtTime(1, t);
      this.send.gain.setValueAtTime(1, t + this.period());
      this.send.gain.linearRampToValueAtTime(0, t + this.period() + 0.08);
    } else { this.dry.gain.setTargetAtTime(1, t, 0.01); this.send.gain.setTargetAtTime(1, t, 0.01); }
  }
  update() { this.set(this.wet.gain, 1.6 + this.p * 1.4); } // la reverb normalizada suena ~−16 dB: se compensa
}

// Echo Out: corta el seco y deja que el eco se apague solo (salida de una pista)
class EchoOut extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.send = ctx.createGain();
    this.delay = ctx.createDelay(20); this.fb = ctx.createGain();
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 5000;
    this.input.connect(this.send).connect(this.delay);
    this.delay.connect(this.tone).connect(this.fb).connect(this.delay);
    this.tone.connect(this.wet);
    this.update();
  }
  on(v) {
    const t = this.t();
    for (const p of [this.dry.gain, this.send.gain]) hold(p, t);
    if (v) {
      this.dry.gain.setTargetAtTime(0, t, 0.03);
      this.send.gain.setValueAtTime(1, t);
      this.send.gain.setValueAtTime(1, t + this.period());
      this.send.gain.linearRampToValueAtTime(0, t + this.period() + 0.03);
    } else { this.dry.gain.setTargetAtTime(1, t, 0.01); this.send.gain.setTargetAtTime(1, t, 0.01); }
  }
  update() {
    this.set(this.delay.delayTime, this.period(), 0.05);
    this.set(this.fb.gain, 0.5 + this.p * 0.3);
    this.set(this.wet.gain, 0.8);
  }
}

// Tape Echo: eco con lloro y trémolo de cinta (retardo modulado), saturación suave y tono oscuro en la realimentación
class TapeEcho extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.delay = ctx.createDelay(20); this.fb = ctx.createGain();
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 3200;
    this.hpf = ctx.createBiquadFilter(); this.hpf.type = 'highpass'; this.hpf.frequency.value = 120;
    this.sat = ctx.createWaveShaper(); this.sat.curve = curve('tape', x => Math.tanh(1.6 * x) / Math.tanh(1.6));
    this.input.connect(this.delay);
    this.delay.connect(this.lp).connect(this.hpf).connect(this.sat).connect(this.fb).connect(this.delay);
    this.sat.connect(this.wet);
    this.wow = ctx.createOscillator(); this.wow.frequency.value = 0.6;
    this.wowAmt = ctx.createGain(); this.wowAmt.gain.value = 0.0012;
    this.wow.connect(this.wowAmt).connect(this.delay.delayTime); this.wow.start();
    this.update();
  }
  update() {
    this.set(this.delay.delayTime, this.period(), 0.08);
    this.set(this.fb.gain, 0.3 + this.p * 0.45);
    this.set(this.wet.gain, 0.35 + this.p * 0.45);
  }
}

// Spiral: eco cuyo tono sube en cada repetición (transpositor dentro de la realimentación)
class Spiral extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.delay = ctx.createDelay(20); this.fb = ctx.createGain();
    this.pitch = new AudioWorkletNode(ctx, 'nexura-pitch', { outputChannelCount: [2] });
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 7000;
    this.input.connect(this.delay);
    this.delay.connect(this.pitch).connect(this.lp).connect(this.fb).connect(this.delay);
    this.lp.connect(this.wet);
    this.update();
  }
  update() {
    this.set(this.delay.delayTime, Math.max(0.03, this.period() - 0.033), 0.05); // el transpositor retrasa ~30 ms (+ 3 ms del ciclo)
    this.pitch.parameters.get('semis').setValueAtTime(1 + Math.round(this.p * 6), this.t());
    this.set(this.fb.gain, 0.55 + this.p * 0.2);
    this.set(this.wet.gain, 0.7);
  }
}

// Pitch: transposición de efecto ±12 semitonos (centro = sin cambio)
class PitchFx extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.node = new AudioWorkletNode(ctx, 'nexura-pitch', { outputChannelCount: [2] });
    this.input.connect(this.node).connect(this.wet);
    this.dry.gain.value = 0;
    this.update();
  }
  update() {
    const s = Math.round((this.p - 0.5) * 24);
    this.node.parameters.get('semis').setValueAtTime(s, this.t());
    this.set(this.wet.gain, 1);
  }
}

// Shredder: tartamudeo de granos cortos con cambios de tono (la cantidad = cuánto cambia el tono)
class Shredder extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.node = new AudioWorkletNode(ctx, 'nexura-shredder', { outputChannelCount: [2] });
    this.input.connect(this.node).connect(this.wet);
    this.update();
  }
  update() {
    this.node.parameters.get('grain').setValueAtTime(clamp(this.period() / 8, 0.015, 0.5), this.t());
    this.node.parameters.get('depth').setValueAtTime(this.p, this.t());
    this.set(this.wet.gain, 0.9);
    this.set(this.dry.gain, 0.35 * (1 - this.p));
  }
}

// Tape Stop: la «cinta» se para (velocidad cuadrática hasta 0) con el tono y los agudos cayendo
class TapeStop extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.delay = ctx.createDelay(8);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000;
    this.input.connect(this.delay).connect(this.lp).connect(this.wet);
    this.dry.gain.value = 0;
  }
  on(v) {
    const t = this.t(), d = this.delay.delayTime;
    hold(d, t); hold(this.wet.gain, t); hold(this.lp.frequency, t);
    if (v) {
      // velocidad s(x) = (1 − x/T)² → retardo d(x) = x − T/3·(1 − (1 − x/T)³)
      const T = clamp(this.period() * (0.5 + this.p * 1.5), 0.15, 7.5), N = 128, c = new Float32Array(N);
      for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * T; c[i] = x - (T / 3) * (1 - Math.pow(1 - x / T, 3)); }
      d.setValueAtTime(0, t); d.setValueCurveAtTime(c, t, T);
      this.lp.frequency.setValueAtTime(20000, t); this.lp.frequency.exponentialRampToValueAtTime(400, t + T);
      this.wet.gain.setValueAtTime(1, t); this.wet.gain.setValueAtTime(1, t + T * 0.85); this.wet.gain.linearRampToValueAtTime(0, t + T);
    } else { // la ranura ya ha fundido a la señal original: se rearma sin que se oiga
      const t2 = t + 0.08;
      d.setValueAtTime(0, t2); this.wet.gain.setValueAtTime(1, t2); this.lp.frequency.setValueAtTime(20000, t2);
    }
  }
}

// Gater: puerta rítmica de 16 pasos (4 patrones según la cantidad), sincronizada al BPM
class Gater extends Base {
  constructor(ctx) {
    super(ctx);
    this.node = new AudioWorkletNode(ctx, 'nexura-gater', { outputChannelCount: [2] });
    this.input.connect(this.node).connect(this.output);
    this.update();
  }
  update() {
    const P = this.node.parameters, t = this.t();
    P.get('step').setValueAtTime(clamp(this.period() / 4, 0.01, 4), t);
    P.get('pattern').setValueAtTime(Math.min(3, Math.floor(this.p * 4)), t);
    P.get('depth').setValueAtTime(0.85 + 0.15 * ((this.p * 4) % 1), t);
  }
}

// Sidechain: «bombeo» por beat (el volumen cae y se recupera), forma calculada como onda periódica
class Sidechain extends Base {
  constructor(ctx) {
    super(ctx);
    this.vca = ctx.createGain();
    this.input.connect(this.vca).connect(this.output);
    this.osc = ctx.createOscillator();
    this.amt = ctx.createGain();
    // forma del bombeo: ataque de 2 % del periodo y recuperación cuadrática hasta el 45 %
    const N = 256, shape = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = i / N; shape[i] = x < 0.02 ? x / 0.02 : x < 0.45 ? Math.pow(1 - (x - 0.02) / 0.43, 2) : 0; }
    this.mean = shape.reduce((a, b) => a + b, 0) / N;
    const H = 40, re = new Float32Array(H), im = new Float32Array(H);
    for (let k = 1; k < H; k++) { let a = 0, b = 0; for (let i = 0; i < N; i++) { const w = 2 * Math.PI * k * i / N; a += shape[i] * Math.cos(w); b += shape[i] * Math.sin(w); } re[k] = 2 * a / N; im[k] = 2 * b / N; }
    this.osc.setPeriodicWave(ctx.createPeriodicWave(re, im, { disableNormalization: true }));
    this.osc.connect(this.amt).connect(this.vca.gain); this.osc.start();
    this.update();
  }
  update() {
    const depth = 0.35 + this.p * 0.55; // ganancia = 1 − depth·forma
    this.set(this.osc.frequency, 1 / this.period());
    this.set(this.amt.gain, -depth);
    this.set(this.vca.gain, 1 - depth * this.mean);
  }
}

// Flanger estéreo: un retardo por canal con LFO en oposición de fase
class StereoFlanger extends LfoEffect {
  constructor(ctx) {
    super(ctx);
    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
    this.dl = ctx.createDelay(0.05); this.dr = ctx.createDelay(0.05);
    this.fl = ctx.createGain(); this.fr = ctx.createGain();
    this.dl.delayTime.value = this.dr.delayTime.value = 0.004;
    this.input.connect(split);
    split.connect(this.dl, 0); split.connect(this.dr, 1);
    this.dl.connect(this.fl).connect(this.dl); this.dr.connect(this.fr).connect(this.dr);
    this.dl.connect(merge, 0, 0); this.dr.connect(merge, 0, 1);
    merge.connect(this.wet);
    this.makeLfo();
    this.inv = ctx.createGain(); this.inv.gain.value = -1;
    this.lfoAmt.connect(this.dl.delayTime); this.lfoAmt.connect(this.inv).connect(this.dr.delayTime);
    this.update();
  }
  update() {
    this.set(this.lfo.frequency, this.lfoRate());
    this.set(this.lfoAmt.gain, 0.0012 + 0.0024 * this.p);
    for (const g of [this.fl.gain, this.fr.gain]) this.set(g, 0.35 + this.p * 0.35);
    this.set(this.wet.gain, 0.6); this.set(this.dry.gain, 0.6);
  }
}

// Auto Wah: paso bajo resonante barrido por un LFO sincronizado
class AutoWah extends LfoEffect {
  constructor(ctx) {
    super(ctx);
    this.f = ctx.createBiquadFilter(); this.f.type = 'lowpass'; this.f.Q.value = 7;
    this.trim = ctx.createGain(); this.trim.gain.value = 0.55; // compensa la resonancia
    this.input.connect(this.f).connect(this.trim).connect(this.wet);
    this.makeLfo('triangle');
    this.lfoAmt.connect(this.f.frequency);
    this.update();
  }
  update() {
    const center = 900 + this.p * 900;
    this.set(this.lfo.frequency, this.lfoRate());
    this.set(this.f.frequency, center);
    this.set(this.lfoAmt.gain, center * 0.8);
    this.set(this.wet.gain, 1); this.set(this.dry.gain, 0.15);
  }
}

// Filtro combo: a la izquierda paso bajo, a la derecha paso alto, resonante; en el centro no filtra
class ComboFilter extends Base {
  constructor(ctx) {
    super(ctx);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 22000;
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 10;
    this.trim = ctx.createGain();
    this.input.connect(this.lp).connect(this.hp).connect(this.trim).connect(this.output);
    this.update();
  }
  update() {
    const v = this.p, dz = 0.04;
    let lp = 22000, hp = 10, q = 0.7;
    if (v < 0.5 - dz) { const x = (0.5 - dz - v) / (0.5 - dz); lp = 22000 * Math.pow(70 / 22000, x); q = 0.7 + 7 * x; }
    else if (v > 0.5 + dz) { const x = (v - 0.5 - dz) / (0.5 - dz); hp = 15 * Math.pow(8000 / 15, x); q = 0.7 + 7 * x; }
    this.set(this.lp.frequency, lp, 0.03); this.set(this.hp.frequency, hp, 0.03);
    this.set(this.lp.Q, q); this.set(this.hp.Q, q);
    this.set(this.trim.gain, 1 / (1 + (q - 0.7) * 0.18)); // la resonancia no debe subir el volumen
  }
}

// Riser HPF: al activarlo, paso alto resonante que sube durante `beats` (subida antes de un drop)
class HpfRiser extends Base {
  constructor(ctx) {
    super(ctx);
    this.f = ctx.createBiquadFilter(); this.f.type = 'highpass'; this.f.frequency.value = 20; this.f.Q.value = 5;
    this.trim = ctx.createGain(); this.trim.gain.value = 0.7;
    this.input.connect(this.f).connect(this.trim).connect(this.output);
  }
  on(v) {
    const t = this.t(), f = this.f.frequency;
    hold(f, t);
    if (v) { f.setValueAtTime(30, t); f.exponentialRampToValueAtTime(1500 + this.p * 6500, t + clamp(this.period() * 4, 0.5, 30)); }
    else f.setTargetAtTime(20, t + 0.02, 0.01);
  }
}

// Noise Riser: ruido filtrado que sube de tono y de volumen durante `beats` (×4) sobre la señal
class NoiseRiser extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.src = ctx.createBufferSource(); this.src.buffer = noiseBuffer(ctx); this.src.loop = true; this.src.start();
    this.bp = ctx.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.Q.value = 2.2; this.bp.frequency.value = 300;
    this.lvl = ctx.createGain(); this.lvl.gain.value = 0;
    this.src.connect(this.bp).connect(this.lvl).connect(this.wet);
    this.wet.gain.value = 1;
  }
  on(v) {
    const t = this.t(), T = clamp(this.period() * 4, 0.5, 30), top = 0.05 + this.p * 0.2;
    hold(this.bp.frequency, t); hold(this.lvl.gain, t);
    if (v) {
      this.bp.frequency.setValueAtTime(300, t); this.bp.frequency.exponentialRampToValueAtTime(11000, t + T);
      this.lvl.gain.setValueAtTime(0.0001, t); this.lvl.gain.exponentialRampToValueAtTime(top, t + T);
    } else this.lvl.gain.setTargetAtTime(0, t, 0.02);
  }
}

// Overdrive: saturación asimétrica tipo válvula con tono (paso bajo) y compensación de nivel
class Overdrive extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.pre = ctx.createGain();
    this.sh = ctx.createWaveShaper(); this.sh.oversample = '2x';
    this.sh.curve = curve('od', x => { const y = x >= 0 ? Math.tanh(2.2 * x) : Math.tanh(1.4 * x) * 0.85; return y; });
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass';
    this.dc = ctx.createBiquadFilter(); this.dc.type = 'highpass'; this.dc.frequency.value = 25; // la asimetría genera continua
    this.post = ctx.createGain();
    this.input.connect(this.pre).connect(this.sh).connect(this.dc).connect(this.tone).connect(this.post).connect(this.wet);
    this.update();
  }
  update() {
    this.set(this.pre.gain, 1 + this.p * 6);
    this.set(this.tone.frequency, 9000 - this.p * 5000);
    this.set(this.post.gain, 0.75 / (1 + this.p * 0.9));
    this.set(this.wet.gain, 1); this.set(this.dry.gain, 0);
  }
}

// Lo-Fi: banda telefónica/vinilo con saturación ligera, crujidos de vinilo y algo de lloro
class LoFi extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 250;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass';
    this.sat = ctx.createWaveShaper(); this.sat.curve = curve('lofi', x => Math.tanh(1.8 * x) / Math.tanh(1.8));
    this.wow = ctx.createDelay(0.05); this.wow.delayTime.value = 0.01;
    this.mod = ctx.createOscillator(); this.mod.frequency.value = 0.55;
    this.modAmt = ctx.createGain(); this.modAmt.gain.value = 0.0008;
    this.mod.connect(this.modAmt).connect(this.wow.delayTime); this.mod.start();
    this.input.connect(this.hp).connect(this.lp).connect(this.sat).connect(this.wow).connect(this.wet);
    // crujidos: impulsos dispersos en un búfer en bucle
    const len = ctx.sampleRate * 3, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = Math.random() < 0.0004 ? (Math.random() * 2 - 1) : (Math.random() * 2 - 1) * 0.01; }
    this.crk = ctx.createBufferSource(); this.crk.buffer = b; this.crk.loop = true; this.crk.start();
    this.crkLvl = ctx.createGain();
    this.crk.connect(this.crkLvl).connect(this.wet);
    this.update();
  }
  update() {
    this.set(this.lp.frequency, 6000 - this.p * 3200);
    this.set(this.crkLvl.gain, 0.04 + this.p * 0.14);
    this.set(this.wet.gain, 0.9); this.set(this.dry.gain, 0);
  }
}

// Reverse Echo: el audio del último fragmento (beats) suena al revés, mezclado con el original
class ReverseEcho extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.node = new AudioWorkletNode(ctx, 'nexura-reverse', { outputChannelCount: [2] });
    this.input.connect(this.node).connect(this.wet);
    this.update();
  }
  update() {
    this.node.parameters.get('length').setValueAtTime(clamp(this.period(), 0.05, 4), this.t());
    this.set(this.wet.gain, 0.3 + this.p * 0.7);
    this.set(this.dry.gain, 1 - this.p * 0.6);
  }
}

// cat = categoría para la lista de la interfaz
export const FX_CATEGORIES = { delay: 'Eco y delay', reverb: 'Reverb', mod: 'Modulación', filter: 'Filtros', drive: 'Distorsión', rhythm: 'Ritmo y corte', tempo: 'Tono y velocidad', riser: 'Ruido y subidas' };
export const EFFECTS = [
  { id: 'echo', name: 'Echo', cat: 'delay', make: (c) => new Echo(c) },
  { id: 'pingpong', name: 'Ping Pong', cat: 'delay', make: (c) => new Echo(c, true) },
  { id: 'reverb', name: 'Reverb', cat: 'reverb', make: (c) => new Reverb(c) },
  { id: 'epicreverb', name: 'Epic Reverb', cat: 'reverb', make: (c) => new Reverb(c, true) },
  { id: 'flanger', name: 'Flanger', cat: 'mod', make: (c) => new Flanger(c) },
  { id: 'phaser', name: 'Phaser', cat: 'mod', make: (c) => new Phaser(c) },
  { id: 'chorus', name: 'Chorus', cat: 'mod', make: (c) => new Flanger(c, true) },
  { id: 'hpf', name: 'HPF', cat: 'filter', make: (c) => new FilterFx(c, 'highpass') },
  { id: 'lpf', name: 'LPF', cat: 'filter', make: (c) => new FilterFx(c, 'lowpass') },
  { id: 'bitcrush', name: 'Bitcrush', cat: 'drive', make: (c) => new Crusher(c) },
  { id: 'distortion', name: 'Distortion', cat: 'drive', make: (c) => new Distortion(c) },
  { id: 'trans', name: 'Trans', cat: 'rhythm', make: (c) => new Gate(c, true) },
  { id: 'tremolo', name: 'Tremolo', cat: 'mod', make: (c) => new Gate(c, false) },
  { id: 'autopan', name: 'Auto Pan', cat: 'mod', make: (c) => new AutoPan(c) },
  { id: 'ringmod', name: 'Ring Mod', cat: 'mod', make: (c) => new RingMod(c) },
  { id: 'noise', name: 'Noise', cat: 'riser', make: (c) => new Noise(c) },
  { id: 'comb', name: 'Comb', cat: 'filter', make: (c) => new Comb(c) },
  { id: 'repeat', name: 'Repeat', cat: 'rhythm', make: (c) => new Repeat(c) },
  { id: 'braker', name: 'Braker', cat: 'tempo', make: (c) => new Braker(c) },
  // fase 2
  { id: 'reverbdrop', name: 'Reverb Drop', cat: 'reverb', make: (c) => new ReverbDrop(c) },
  { id: 'echoout', name: 'Echo Out', cat: 'delay', make: (c) => new EchoOut(c) },
  { id: 'tapeecho', name: 'Tape Echo', cat: 'delay', make: (c) => new TapeEcho(c) },
  { id: 'spiral', name: 'Spiral', cat: 'delay', make: (c) => new Spiral(c) },
  { id: 'reverse', name: 'Reverse Echo', cat: 'delay', make: (c) => new ReverseEcho(c) },
  { id: 'stereoflanger', name: 'Flanger estéreo', cat: 'mod', make: (c) => new StereoFlanger(c) },
  { id: 'autowah', name: 'Auto Wah', cat: 'filter', make: (c) => new AutoWah(c) },
  { id: 'combofilter', name: 'Filtro combo', cat: 'filter', make: (c) => new ComboFilter(c) },
  { id: 'overdrive', name: 'Overdrive', cat: 'drive', make: (c) => new Overdrive(c) },
  { id: 'lofi', name: 'Lo-Fi', cat: 'drive', make: (c) => new LoFi(c) },
  { id: 'gater', name: 'Gater', cat: 'rhythm', make: (c) => new Gater(c) },
  { id: 'sidechain', name: 'Sidechain', cat: 'rhythm', make: (c) => new Sidechain(c) },
  { id: 'shredder', name: 'Shredder', cat: 'rhythm', make: (c) => new Shredder(c) },
  { id: 'pitch', name: 'Pitch', cat: 'tempo', make: (c) => new PitchFx(c) },
  { id: 'tapestop', name: 'Tape Stop', cat: 'tempo', make: (c) => new TapeStop(c) },
  { id: 'hpfriser', name: 'Riser HPF', cat: 'riser', make: (c) => new HpfRiser(c) },
  { id: 'noiseriser', name: 'Noise Riser', cat: 'riser', make: (c) => new NoiseRiser(c) }
];

// Presets de fábrica (siempre disponibles en la lista de presets de cada unidad)
export const FACTORY_PRESETS = {
  'f-build': { name: 'Subida al drop', unit: { beats: 4, mix: 1, slots: [{ fx: 'hpfriser', p: 0.6 }, { fx: 'noiseriser', p: 0.5 }, { fx: 'reverb', p: 0.35 }] }, enabled: [true, true, false] },
  'f-drop': { name: 'Corte con reverb', unit: { beats: 1, mix: 1, slots: [{ fx: 'reverbdrop', p: 0.7 }, { fx: 'lpf', p: 0.2 }, { fx: 'echo', p: 0.4 }] }, enabled: [true, false, false] },
  'f-exit': { name: 'Salida en eco', unit: { beats: 0.75, mix: 1, slots: [{ fx: 'echoout', p: 0.6 }, { fx: 'hpf', p: 0.3 }, { fx: 'reverb', p: 0.3 }] }, enabled: [true, false, false] },
  'f-tape': { name: 'Cinta', unit: { beats: 0.5, mix: 1, slots: [{ fx: 'tapeecho', p: 0.5 }, { fx: 'lofi', p: 0.4 }, { fx: 'tapestop', p: 0.4 }] }, enabled: [true, false, false] },
  'f-pump': { name: 'Bombeo', unit: { beats: 1, mix: 1, slots: [{ fx: 'sidechain', p: 0.6 }, { fx: 'combofilter', p: 0.5 }, { fx: 'gater', p: 0.1 }] }, enabled: [true, false, false] },
  'f-vocal': { name: 'Voz espacial', unit: { beats: 0.5, mix: 0.8, slots: [{ fx: 'spiral', p: 0.4 }, { fx: 'stereoflanger', p: 0.4 }, { fx: 'reverb', p: 0.5 }] }, enabled: [true, false, true] }
};

// lineal hasta ±0,9 y después tanh hacia ±0,99 (la curva de un WaveShaper satura fuera de [−1, 1])
const SAFETY_CURVE = (() => {
  const n = 4097, c = new Float32Array(n), K = 0.9, R = 0.09;
  for (let i = 0; i < n; i++) { const x = i * 2 / (n - 1) - 1, a = Math.abs(x); c[i] = Math.sign(x) * (a <= K ? a : K + R * Math.tanh((a - K) / R)); }
  return c;
})();

class Slot {
  constructor(ctx, unit, idx) {
    this.ctx = ctx; this.unit = unit; this.idx = idx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.bypass = ctx.createGain();
    this.wet = ctx.createGain(); this.wet.gain.value = 0;
    // seguridad: por encima de 0,9 el efecto se redondea suavemente hacia 1 (nunca lo supera)
    this.safety = ctx.createWaveShaper(); this.safety.curve = SAFETY_CURVE;
    this.input.connect(this.bypass).connect(this.output);
    this.wet.connect(this.safety).connect(this.output);
    this.enabled = false;
    this.param = 0.5;
    this.fx = null; this.fxId = null;
    this.attached = false;
  }
  // El efecto solo está conectado mientras está encendido (y 0,6 s después, cuando ya no se oye): antes las
  // 6 ranuras (reverb de convolución, ecos, flanger, bitcrusher…) procesaban el audio de los decks siempre,
  // también apagadas, y eso era buena parte de la CPU del motor de audio
  attach() {
    clearTimeout(this._off);
    if (this.attached || !this.fx) return;
    this.input.connect(this.fx.input);
    this.fx.output.connect(this.wet);
    this.attached = true;
  }
  detach() {
    clearTimeout(this._off);
    if (!this.attached || !this.fx) { this.attached = false; return; }
    try { this.input.disconnect(this.fx.input); } catch (_) { /* ya desconectado */ }
    try { this.fx.output.disconnect(this.wet); } catch (_) { /* ya desconectado */ }
    this.attached = false;
  }
  setEffect(id) {
    this.detach();
    const def = EFFECTS.find(e => e.id === id) || EFFECTS[0];
    this.fxId = def.id; this.name = def.name;
    this.fx = def.make(this.ctx);
    this.fx.setParam(this.param);
    this.fx.setTiming(this.unit.beatSec, this.unit.beats);
    if (this.enabled) { this.attach(); this.fx.on(true); }
  }
  setEnabled(v) {
    this.enabled = !!v;
    const t = this.ctx.currentTime;
    if (this.enabled) this.attach();
    this.bypass.gain.setTargetAtTime(v ? 0 : 1, t, 0.01);
    this.wet.gain.setTargetAtTime(v ? 1 : 0, t, 0.01);
    if (this.fx) this.fx.on(this.enabled);
    if (!this.enabled) { clearTimeout(this._off); this._off = setTimeout(() => { if (!this.enabled) this.detach(); }, 600); }
  }
  setParam(v) { this.param = clamp(v, 0, 1); if (this.fx) this.fx.setParam(this.param); }
}

export class FxUnit {
  constructor(ctx, idx) {
    this.ctx = ctx; this.idx = idx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.beats = 1; this.beatSec = 0.5; this.mix = 1;
    this.slots = [0, 1, 2].map(i => new Slot(ctx, this, i));
    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.slots[0].input);
    this.slots[0].output.connect(this.slots[1].input);
    this.slots[1].output.connect(this.slots[2].input);
    this.slots[2].output.connect(this.wet).connect(this.output);
    const defaults = idx === 0 ? ['echo', 'reverb', 'hpf'] : ['flanger', 'bitcrush', 'lpf'];
    this.slots.forEach((s, i) => s.setEffect(defaults[i]));
    this.target = idx === 0 ? 'deck0' : 'deck1';
    this.setMix(1);
  }
  setMix(v) {
    this.mix = clamp(v, 0, 1);
    const t = this.ctx.currentTime;
    // con mezcla al 100 % la cadena de ranuras ya incluye la señal seca de las ranuras apagadas
    this.dry.gain.setTargetAtTime(1 - this.mix, t, 0.01);
    this.wet.gain.setTargetAtTime(this.mix, t, 0.01);
  }
  setBeats(b) { this.beats = b; this.applyTiming(); }
  setBpm(bpm) {
    const bs = 60 / (bpm || 120);
    if (Math.abs(bs - this.beatSec) > 1e-4) { this.beatSec = bs; this.applyTiming(); }
  }
  applyTiming() { for (const s of this.slots) if (s.fx) s.fx.setTiming(this.beatSec, this.beats); }
  anyOn() { return this.slots.some(s => s.enabled); }
  toJSON() {
    return { target: this.target, beats: this.beats, mix: this.mix, slots: this.slots.map(s => ({ fx: s.fxId, p: s.param })) };
  }
  fromJSON(j) {
    if (!j) return;
    if (j.target) this.target = j.target;
    if (j.beats) this.beats = j.beats;
    if (j.mix != null) this.setMix(j.mix);
    (j.slots || []).forEach((s, i) => { if (this.slots[i]) { this.slots[i].param = s.p ?? 0.5; this.slots[i].setEffect(s.fx); } });
  }
}
