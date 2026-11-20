// Motor de audio: mezclador de 4 canales (2 visibles salvo controladora de 4 decks), bus de cue, master, enrutado a la
// interfaz de 4 canales de la Denon MC4000 (master 1/2, auriculares 3/4) o a
// dos dispositivos distintos, medidores y grabación.
import { Emitter, clamp, dbToGain } from '../util.js';
import { latencyHintFor } from '../live/load-core.js';

// Lo que se espera a que el dispositivo master quede elegido antes de montar la salida con el actual (setOutputs)
export const SINK_WAIT_MS = 1500;
// ¿Es el mismo dispositivo de salida? ('' y 'default' son el predeterminado del sistema)
export const sameDevice = (a, b) => (a && a !== 'default' ? a : '') === (b && b !== 'default' ? b : '');
// Modo de salida efectivo: «Automático» usa 4 canales solo con una interfaz de 4 (o con nombre de controladora DJ);
// con más canales (tarjeta 5.1/7.1, auriculares envolventes) sale solo el master en estéreo. «Separados» necesita
// unos auriculares en otro dispositivo (cueOk)
export function pickOutputMode(mode, max, { cueOk = false, label = '', controller = '' } = {}) {
  let eff = mode;
  if (mode === 'auto') eff = max >= 4 && (max === 4 || looksLikeDjDevice(label, controller)) ? '4ch' : (cueOk ? 'separate' : 'stereo');
  if (eff === '4ch' && max < 4) eff = cueOk ? 'separate' : 'stereo';
  if (eff === 'separate' && !cueOk) eff = 'stereo';
  return eff;
}
// ¿Parece la interfaz de audio de una controladora o tarjeta DJ? (para usar sus 4 canales en «Automático»)
export function looksLikeDjDevice(label, controller) {
  const l = String(label || '').toLowerCase();
  if (!l) return false;
  if (/\bdj\b|controller|controladora/.test(l)) return true;
  // el nombre de la controladora MIDI conectada (o alguna palabra suya de más de 3 letras) en el del dispositivo
  const c = String(controller || '').toLowerCase().trim();
  return !!c && (l.includes(c) || c.split(/[^a-z0-9]+/).some(w => w.length > 3 && l.includes(w)));
}
export const XF_CURVES ={ smooth: 'Suave', long: 'Larga', blend: 'Rápida', sharp: 'Corte' };

// Knob de EQ 0..1 → dB (0.5 = 0 dB, 0 = kill, 1 = +6 dB)
export function eqKnobToDb(v) {
  if (v >= 0.5) return (v - 0.5) / 0.5 * 6;
  if (v <= 0.005) return -80;
  return Math.max(-80, 40 * Math.log10(v / 0.5));
}

function meterPeak(an, buf) {
  an.getFloatTimeDomainData(buf);
  let p = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
  return p;
}
export const peakToMeter = (p) => clamp((20 * Math.log10(Math.max(p, 1e-6)) + 48) / 51, 0, 1); // -48..+3 dB

class ChannelStrip {
  constructor(ctx, engine, idx) {
    this.ctx = ctx; this.engine = engine; this.idx = idx;
    this.input = ctx.createGain();            // entrada del deck
    // Stems FX: los stems enviados salen por la 2.ª salida del deck → [unidad FX] → entrada del canal
    this.stemIn = ctx.createGain();
    this.stemIn.connect(this.input);
    this.stemInserts = [];
    this.trim = ctx.createGain();
    this.low = ctx.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 200;
    this.mid = ctx.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1000; this.mid.Q.value = 0.7;
    this.high = ctx.createBiquadFilter(); this.high.type = 'highshelf'; this.high.frequency.value = 3200;
    // Aislador real para "kill": filtros adicionales activados al llevar el knob a 0
    this.lowKill = ctx.createBiquadFilter(); this.lowKill.type = 'highpass'; this.lowKill.frequency.value = 10; this.lowKill.Q.value = 0.707;
    this.highKill = ctx.createBiquadFilter(); this.highKill.type = 'lowpass'; this.highKill.frequency.value = 22000; this.highKill.Q.value = 0.707;
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 10; this.hp.Q.value = 1.1;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 22000; this.lp.Q.value = 1.1;
    this.preFx = ctx.createGain();
    this.postFx = ctx.createGain();
    this.pfl = ctx.createGain(); this.pfl.gain.value = 0;
    this.fader = ctx.createGain();
    this.xf = ctx.createGain();
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 512;
    this.meterBuf = new Float32Array(512);

    this.input.connect(this.trim).connect(this.low).connect(this.mid).connect(this.high)
      .connect(this.lowKill).connect(this.highKill).connect(this.hp).connect(this.lp).connect(this.preFx);
    this.preFx.connect(this.postFx);
    this.postFx.connect(this.analyser);
    this.postFx.connect(this.pfl).connect(engine.cueBus);
    this.postFx.connect(this.fader).connect(this.xf).connect(engine.masterBus);

    this.values = { trim: 0.5, high: 0.5, mid: 0.5, low: 0.5, filter: 0.5, fader: 1, pfl: false, xfAssign: idx % 2 === 0 ? 'A' : 'B' };
    this.inserts = [];
    this.applyAll();
  }
  ramp(param, v) { param.setTargetAtTime(v, this.ctx.currentTime, 0.008); }
  set(name, v) {
    this.values[name] = v;
    // Mesa de mezclas externa: EQ y filtro internos en neutro (el valor se conserva)
    if (this.engine.external && (name === 'high' || name === 'mid' || name === 'low' || name === 'filter')) v = 0.5;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'trim': this.ramp(this.trim.gain, dbToGain((v - 0.5) * 2 * 12)); break; // ±12 dB
      case 'low': this.ramp(this.low.gain, Math.max(-40, eqKnobToDb(v))); this.ramp(this.lowKill.frequency, v <= 0.02 ? 300 : 10); break;
      case 'mid': this.ramp(this.mid.gain, Math.max(-40, eqKnobToDb(v))); break;
      case 'high': this.ramp(this.high.gain, Math.max(-40, eqKnobToDb(v))); this.ramp(this.highKill.frequency, v <= 0.02 ? 2500 : 22000); break;
      case 'filter': {
        const dz = 0.03;
        if (v < 0.5 - dz) { // paso bajo
          const x = v / (0.5 - dz);
          this.lp.frequency.setTargetAtTime(60 * Math.pow(22000 / 60, x), t, 0.01);
          this.hp.frequency.setTargetAtTime(10, t, 0.01);
        } else if (v > 0.5 + dz) { // paso alto
          const x = (v - 0.5 - dz) / (0.5 - dz);
          this.hp.frequency.setTargetAtTime(15 * Math.pow(9000 / 15, x), t, 0.01);
          this.lp.frequency.setTargetAtTime(22000, t, 0.01);
        } else {
          this.hp.frequency.setTargetAtTime(10, t, 0.01);
          this.lp.frequency.setTargetAtTime(22000, t, 0.01);
        }
        break;
      }
      case 'fader': this.ramp(this.fader.gain, faderCurve(v)); break;
      case 'pfl': this.pfl.gain.setTargetAtTime(v ? 1 : 0, t, 0.005); break;
      case 'xfAssign': this.engine.applyCrossfader(); break;
    }
    this.engine.emit('mixer', this.idx, name, v);
  }
  applyAll() { for (const k of ['trim', 'high', 'mid', 'low', 'filter', 'fader', 'pfl']) this.set(k, this.values[k]); }
  setInserts(units) {
    // Reconecta preFx → [unidades FX] → postFx
    try { this.preFx.disconnect(); } catch (_) {}
    for (const u of this.inserts) { try { u.output.disconnect(); } catch (_) {} }
    this.inserts = units;
    let node = this.preFx;
    for (const u of units) { node.connect(u.input); node = u.output; }
    node.connect(this.postFx);
  }
  // Unidades FX solo para los stems enviados (Stems FX): stemIn → [unidades] → input
  setStemInserts(units) {
    try { this.stemIn.disconnect(); } catch (_) {}
    for (const u of this.stemInserts) { try { u.output.disconnect(); } catch (_) {} }
    this.stemInserts = units;
    let node = this.stemIn;
    for (const u of units) { node.connect(u.input); node = u.output; }
    node.connect(this.input);
  }
  meter() { return meterPeak(this.analyser, this.meterBuf); }
}

// Curva de fader de canal: logarítmica suave
const faderCurve = (v) => v <= 0 ? 0 : Math.pow(v, 2.2);

export class AudioEngine extends Emitter {
  constructor() {
    super();
    this.ctx = null;
    this.xfValue = 0.5;
    this.xfCurve = 'smooth';
    this.masterVol = 0.8;
    this.cueMix = 0.0; this.phonesVol = 0.8; this.split = false;
    this.outputMode = 'stereo';
    this.cueAudioEl = null;
    this.sideSinks = new Set(); // <audio> abiertos en dispositivos secundarios (auriculares, deck 2 de la mesa externa)
  }

  // Latencia (rc.10, live/load-core.js → LATENCY): Baja = 'interactive' (lo mínimo del sistema), Equilibrada = 20 ms
  // (por defecto), Segura = 45 ms. La frecuencia es la del dispositivo (sin sampleRate: así no hay remuestreo) y el
  // bloque del worklet de los decks es el de Web Audio (128 muestras: no se puede cambiar en esta versión de
  // Chromium). latencyHint no se puede cambiar con el AudioContext creado: para aplicar otra latencia hay que crear
  // uno nuevo (app.setLatency vuelve a montar la interfaz y recupera la sesión, sin perder la posición).
  async init(opts = {}) {
    const latencyHint = latencyHintFor(opts.latency);
    this.latency = opts.latency || 'normal';
    this.ctx = new AudioContext({ latencyHint });
    const ctx = this.ctx;
    // ¿ha llegado a sonar? (antes del primer clic el navegador lo tiene parado: no es un fallo de la salida)
    this.everRan = ctx.state === 'running';
    ctx.addEventListener('statechange', () => { if (ctx.state === 'running') this.everRan = true; });
    await ctx.audioWorklet.addModule('js/audio/worklets/deck-processor.js');
    await ctx.audioWorklet.addModule('js/audio/worklets/fx-processors.js');

    this.masterBus = ctx.createGain();
    this.cueBus = ctx.createGain();
    this.samplerBus = ctx.createGain();
    this.samplerPfl = ctx.createGain(); this.samplerPfl.gain.value = 0;
    this.samplerBus.connect(this.masterBus);
    this.samplerBus.connect(this.samplerPfl).connect(this.cueBus);

    // Cadena master: inserto FX master → volumen → limitador → salida
    this.masterPre = ctx.createGain();
    this.masterPost = ctx.createGain();
    this.masterBus.connect(this.masterPre);
    this.masterPre.connect(this.masterPost);
    this.masterInserts = [];
    this.masterGain = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.08;
    this.masterOut = ctx.createGain();
    this.masterPost.connect(this.masterGain).connect(this.limiter).connect(this.masterOut);

    // Medidores master L/R
    const spl = ctx.createChannelSplitter(2);
    this.masterOut.connect(spl);
    this.mL = ctx.createAnalyser(); this.mL.fftSize = 512;
    this.mR = ctx.createAnalyser(); this.mR.fftSize = 512;
    spl.connect(this.mL, 0); spl.connect(this.mR, 1);
    this.mBuf = new Float32Array(512);

    // Grabador
    this.recNode = new AudioWorkletNode(ctx, 'nexura-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    this.masterOut.connect(this.recNode);
    const silent = ctx.createGain(); silent.gain.value = 0;
    this.recNode.connect(silent).connect(ctx.destination);

    // Auriculares: mezcla cue/master + modo split
    this.phCue = ctx.createGain();
    this.phMaster = ctx.createGain();
    this.phSum = ctx.createGain();
    this.cueBus.connect(this.phCue).connect(this.phSum);
    this.masterOut.connect(this.phMaster).connect(this.phSum);
    // split: cue mono a la izquierda, master mono a la derecha
    this.splitCue = ctx.createGain(); this.splitCue.channelCount = 1; this.splitCue.channelCountMode = 'explicit';
    this.splitMaster = ctx.createGain(); this.splitMaster.channelCount = 1; this.splitMaster.channelCountMode = 'explicit';
    this.splitMerge = ctx.createChannelMerger(2);
    this.cueBus.connect(this.splitCue).connect(this.splitMerge, 0, 0);
    this.masterOut.connect(this.splitMaster).connect(this.splitMerge, 0, 1);
    this.phNormal = ctx.createGain();
    this.phSplit = ctx.createGain();
    this.phOut = ctx.createGain();
    this.phSum.connect(this.phNormal).connect(this.phOut);
    this.splitMerge.connect(this.phSplit).connect(this.phOut);

    // 4 canales: 3 y 4 solo se ven con una controladora de 4 decks (3 → lado A, 4 → lado B)
    this.channels = [0, 1, 2, 3].map(i => new ChannelStrip(ctx, this, i));
    this.setMaster(this.masterVol);
    this.setCueMix(this.cueMix);
    this.setPhonesVol(this.phonesVol);
    this.setSplit(false);
    this.applyCrossfader();
    return this;
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') return this.ctx.resume(); }

  setMaster(v) { this.masterVol = v; this.masterGain.gain.setTargetAtTime(Math.pow(v, 2) * 1.25, this.ctx.currentTime, 0.01); this.emit('master', v); }
  setCueMix(v) { // 0 = solo cue, 1 = solo master
    this.cueMix = v;
    const t = this.ctx.currentTime;
    this.phCue.gain.setTargetAtTime(Math.cos(v * Math.PI / 2), t, 0.01);
    this.phMaster.gain.setTargetAtTime(Math.sin(v * Math.PI / 2), t, 0.01);
    this.emit('cuemix', v);
  }
  setPhonesVol(v) { this.phonesVol = v; this.phOut.gain.setTargetAtTime(Math.pow(v, 2) * 1.4, this.ctx.currentTime, 0.01); this.emit('phones', v); }
  setSplit(on) {
    this.split = !!on;
    const t = this.ctx.currentTime;
    this.phNormal.gain.setTargetAtTime(on ? 0 : 1, t, 0.005);
    this.phSplit.gain.setTargetAtTime(on ? 1 : 0, t, 0.005);
    // En salida estéreo única, Split Cue ocupa L/R del jack de auriculares.
    // En salidas 4ch/separadas, phOut ya tiene su propia ruta de cue.
    if (this.outputMode === 'stereo') this.routeStereoOutput();
    this.emit('split', this.split);
  }
  routeStereoOutput() {
    if (!this.ctx || this.outputMode !== 'stereo') return;
    try { this.masterOut.disconnect(this.ctx.destination); } catch (_) {}
    try { this.phOut.disconnect(this.ctx.destination); } catch (_) {}
    (this.split ? this.phOut : this.masterOut).connect(this.ctx.destination);
  }
  setSamplerVol(v) { this.samplerVol = v; this.samplerBus.gain.setTargetAtTime(Math.pow(v, 2) * 1.2, this.ctx.currentTime, 0.01); this.emit('samplervol', v); }
  setSamplerPfl(on) { this.samplerPflOn = !!on; this.samplerPfl.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.005); }

  setCrossfader(v) { this.xfValue = clamp(v, 0, 1); this.applyCrossfader(); this.emit('xf', this.xfValue); }
  setXfCurve(c) { this.xfCurve = c; this.applyCrossfader(); }
  xfGains(x = this.xfValue) {
    let a, b;
    switch (this.xfCurve) {
      case 'long': // lineal: los dos canales se cruzan a −6 dB en el centro
        a = 1 - x; b = x; break;
      case 'blend': // rápida: ambos a tope en el centro
        a = Math.min(1, 2 * (1 - x)); b = Math.min(1, 2 * x); break;
      case 'sharp': // corte para scratch
        a = x > 0.985 ? 0 : 1; b = x < 0.015 ? 0 : 1; break;
      case 'linear': // compatibilidad con ajustes antiguos
        a = Math.min(1, 2 * (1 - x)); b = Math.min(1, 2 * x); break;
      default: // potencia constante: volumen percibido estable en todo el recorrido (−3 dB en el centro)
        a = Math.cos(x * Math.PI / 2); b = Math.sin(x * Math.PI / 2);
    }
    // pequeños residuos al final del recorrido = silencio total
    if (a < 0.002) a = 0;
    if (b < 0.002) b = 0;
    return { A: a, B: b, T: 1 };
  }
  applyCrossfader() {
    if (!this.channels) return;
    const g = this.xfGains();
    // suavizado de ~12 ms: elimina los saltos de los 128 pasos MIDI sin notarse retardo
    const tc = this.xfCurve === 'sharp' ? 0.0015 : 0.012;
    for (const ch of this.channels) ch.xf.gain.setTargetAtTime(g[ch.values.xfAssign] ?? 1, this.ctx.currentTime, tc);
  }
  // Ganancia efectiva (0..1) de un canal hacia el master — se usa para decks de YouTube
  effectiveGain(i) {
    const ch = this.channels[i];
    const g = this.xfGains()[ch.values.xfAssign] ?? 1;
    const trim = dbToGain((ch.values.trim - 0.5) * 24);
    return clamp(faderCurve(ch.values.fader) * g * Math.pow(this.masterVol, 2) * 1.25 * trim, 0, 1);
  }

  // ¿Llega el canal a la salida principal? Fader de canal arriba y crossfader no cerrado en su lado (más de
  // −30 dB entre los dos). El volumen master no cuenta: bajarlo no saca el deck del aire. Con la mesa externa
  // los faders son los de la mesa (aquí no se saben): siempre al aire
  onAir(i) {
    const ch = this.channels[i];
    if (!ch) return false;
    if (this.external) return true;
    const g = this.xfGains()[ch.values.xfAssign] ?? 1;
    return faderCurve(ch.values.fader) * g > 0.0316;
  }

  setMasterInserts(units) {
    try { this.masterPre.disconnect(); } catch (_) {}
    for (const u of this.masterInserts) { try { u.output.disconnect(); } catch (_) {} }
    this.masterInserts = units;
    let node = this.masterPre;
    for (const u of units) { node.connect(u.input); node = u.output; }
    node.connect(this.masterPost);
  }
  setSamplerInserts(units, sampler) { sampler.setInserts(units); }

  meters() {
    return {
      ch: this.channels.map(c => c.meter()),
      L: meterPeak(this.mL, this.mBuf),
      R: meterPeak(this.mR, this.mBuf)
    };
  }

  // ask = false: sin pedir permiso para leer los nombres (al conectar o desconectar dispositivos)
  async listOutputs(ask = true) {
    try {
      let devs = await navigator.mediaDevices.enumerateDevices();
      if (ask && devs.some(d => d.kind === 'audiooutput' && !d.label)) {
        try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); } catch (_) {}
        devs = await navigator.mediaDevices.enumerateDevices();
      }
      return devs.filter(d => d.kind === 'audiooutput').map(d => ({ id: d.deviceId, label: d.label || 'Salida ' + d.deviceId.slice(0, 6) }));
    } catch (_) { return []; }
  }

  // Nombre de un dispositivo de salida ('' = el predeterminado), sin pedir permisos (si no lo da, '')
  async outputLabel(id) {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
      return (devs.find(d => d.deviceId === (id || 'default')) || devs.find(d => d.deviceId === 'default') || {}).label || '';
    } catch (_) { return ''; }
  }

  // mode: 'auto' | '4ch' | 'separate' | 'stereo' | 'external'
  // external = mesa de mezclas externa: cada deck sale por su propio par de canales
  // (deck 1 → 1/2, deck 2 → 3/4) o por dos dispositivos; el mezclador interno queda en neutro.
  // Elegir el dispositivo del AudioContext (setSinkId) puede tardar varios segundos con algunos controladores
  // (un tester: ~7 s al arrancar). Si ya es el pedido no se toca; si tarda más de SINK_WAIT_MS se monta la salida
  // con el dispositivo actual y, cuando termina, se avisa con «sinkchange» para volver a montarla (sink: false =
  // no volver a pedir el dispositivo). Los <audio> del cue y del deck 2 cambian de dispositivo sin esperar: suenan
  // en cuanto está elegido (así nunca sale el cue por el master).
  // rc.9:
  // - Los cambios van en cola (uno detrás de otro): dos montajes a la vez (el del arranque y el del dispositivo
  //   que tarda, o dos cambios seguidos en Ajustes) podían dejar un <audio> de auriculares huérfano sonando
  //   además del nuevo: la misma señal dos veces con retardo, como un eco o una reverb.
  // - Nunca se abre un segundo <audio> en el mismo dispositivo que el master ('' y 'default' son el mismo), ni
  //   se deja sonar por el predeterminado si no se puede elegir su dispositivo: también sonaría duplicado.
  // - «Automático» solo usa 4 canales con una interfaz de 4 (las controladoras DJ) o si su nombre es el de la
  //   controladora: una tarjeta de sonido 5.1/7.1 o unos auriculares con sonido envolvente virtual dicen tener 6-8
  //   canales y el cue/master de los canales 3/4 salía por el centro/surround, procesado como «sala» (reverb).
  // - Cambiar de dispositivo con la música sonando: antes se ponen los canales en estéreo (el nuevo puede tener
  //   menos), después se reanuda el AudioContext si se ha parado y se comprueba que el audio avanza; si no, se
  //   vuelve a pedir el dispositivo. Los decks no se tocan (siguen en su posición y estado).
  setOutputs(opts = {}) {
    const run = () => this._setOutputs(opts);
    this._outQ = (this._outQ || Promise.resolve()).then(run, run);
    return this._outQ;
  }
  async _setOutputs({ mode = 'auto', masterDevice = '', cueDevice = '', sink = true, masterLabel = '', controller = '' } = {}) {
    const ctx = this.ctx;
    const gen = this.outGen = (this.outGen || 0) + 1;
    let checking = false;
    this.wantMaster = masterDevice || '';
    if (ctx.setSinkId && sink && !sameDevice(this.currentSink(), this.wantMaster)) {
      this.disconnectOutputs(); // canales en estéreo antes de cambiar (el dispositivo nuevo puede tener menos)
      const t0 = performance.now(), want = this.wantMaster;
      const done = ctx.setSinkId(want).then(() => true, (e) => { console.warn('setSinkId', e); this.emit('log', 'WARN', `No se pudo elegir el dispositivo de salida: ${(e && e.message) || e}`); return true; });
      const inTime = await Promise.race([done, new Promise(r => setTimeout(() => r(false), SINK_WAIT_MS))]);
      if (!inTime) {
        console.warn(`setSinkId: el dispositivo de salida tarda más de ${SINK_WAIT_MS / 1000} s; se sigue con el actual`);
        done.then(() => { if (this.outGen === gen) this.emit('sinkchange', Math.round(performance.now() - t0)); });
      } else if (this.everRan) { checking = true; this.checkRunning(want, gen); } // (antes de iniciar el audio, no)
    }
    this.disconnectOutputs();
    // <audio> por un segundo dispositivo: suena cuando su dispositivo está elegido; si no se puede elegir, se
    // queda callado (por el predeterminado sonaría junto al master, con retardo)
    const sideOut = (stream, device, what) => {
      const a = new Audio();
      a.srcObject = stream;
      const rec = { el: a, device, what, state: 'abriendo' };
      this.sideSinks.add(rec);
      const play = () => { if (a.srcObject) { rec.state = 'abierto'; a.play().catch(() => {}); } };
      (a.setSinkId ? a.setSinkId(device) : Promise.reject(new Error('setSinkId no disponible'))).then(play, (e) => {
        console.warn(what, e);
        rec.state = 'error';
        this.emit('log', 'WARN', `Salida de ${what}: no se pudo abrir el dispositivo (${(e && e.message) || e}); se queda en silencio para no sonar duplicado por el predeterminado`);
        this.emit('sinkerror', what);
      });
      return a;
    };

    const max = ctx.destination.maxChannelCount;
    // auriculares en el mismo dispositivo que el master: no hay segunda salida
    const cueOk = !!cueDevice && !sameDevice(cueDevice, masterDevice);
    if (cueDevice && !cueOk && (mode === 'separate' || mode === 'auto' || mode === 'external')) this.emit('log', 'WARN', 'El dispositivo de auriculares es el mismo que el master: no se abre una segunda salida (sonaría duplicado con retardo)');
    let eff = pickOutputMode(mode, max, { cueOk, label: masterLabel, controller });
    cueDevice = cueOk ? cueDevice : '';
    // ¿admite el dispositivo esos canales? (si no, al ponerlos fallaba a medio montar y se quedaba en silencio)
    const fits = (n) => { try { ctx.destination.channelCount = n; return true; } catch (_) { return false; } };
    if (eff === '4ch' && !fits(4)) { this.emit('log', 'WARN', `El dispositivo dice tener ${max} canales pero no admite 4: salida en estéreo`); eff = cueOk ? 'separate' : 'stereo'; }
    let maxOk = max;
    if (eff === 'external') { if (maxOk >= 8 && !fits(8)) maxOk = 4; if (maxOk >= 4 && !fits(4)) maxOk = 2; }
    fits(2);
    this.setExternal(eff === 'external');
    const link = (src, dst, o, i) => { src.connect(dst, o, i); this.extLinks.push([src, dst]); };

    if (eff === 'external') {
      // decks por lado: A = 1 (+3), B = 2 (+4); con 4 decks y 8 canales, cada deck en su par
      const four = this.extDecks === 4;
      const [c1, c2, c3, c4] = this.channels;
      const sideA = four ? [c1, c3] : [c1], sideB = four ? [c2, c4] : [c2];
      if (four && maxOk >= 8) {
        this.extVariant = '8ch';
        ctx.destination.channelCount = 8;
        ctx.destination.channelCountMode = 'explicit';
        ctx.destination.channelInterpretation = 'discrete';
        this.outMerger = ctx.createChannelMerger(8);
        [c1, c2, c3, c4].forEach((c, k) => {
          const sp = ctx.createChannelSplitter(2);
          link(c.postFx, sp); if (k === 0) link(this.samplerBus, sp);
          link(sp, this.outMerger, 0, k * 2); link(sp, this.outMerger, 1, k * 2 + 1);
        });
        this.outMerger.connect(ctx.destination);
      } else if (maxOk >= 4) {
        this.extVariant = four ? '4ch-pares' : '4ch';
        ctx.destination.channelCount = 4;
        ctx.destination.channelCountMode = 'explicit';
        ctx.destination.channelInterpretation = 'discrete';
        this.outMerger = ctx.createChannelMerger(4);
        const s1 = ctx.createChannelSplitter(2), s2 = ctx.createChannelSplitter(2);
        sideA.forEach(c => link(c.postFx, s1)); link(this.samplerBus, s1); sideB.forEach(c => link(c.postFx, s2));
        link(s1, this.outMerger, 0, 0); link(s1, this.outMerger, 1, 1);
        link(s2, this.outMerger, 0, 2); link(s2, this.outMerger, 1, 3);
        this.outMerger.connect(ctx.destination);
      } else {
        ctx.destination.channelCount = 2;
        ctx.destination.channelCountMode = 'explicit';
        ctx.destination.channelInterpretation = 'speakers';
        if (cueDevice) {
          this.extVariant = 'devices';
          sideA.forEach(c => link(c.postFx, ctx.destination)); link(this.samplerBus, ctx.destination);
          const msd = ctx.createMediaStreamDestination();
          sideB.forEach(c => link(c.postFx, msd));
          this.deck2AudioEl = sideOut(msd.stream, cueDevice, 'deck 2');
        } else {
          // Sin 4 canales ni segundo dispositivo: lado A mono por la izquierda y lado B mono por la derecha
          this.extVariant = 'mono';
          const m = ctx.createChannelMerger(2);
          const g1 = ctx.createGain(), g2 = ctx.createGain();
          for (const g of [g1, g2]) { g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; }
          sideA.forEach(c => link(c.postFx, g1)); link(this.samplerBus, g1); sideB.forEach(c => link(c.postFx, g2));
          link(g1, m, 0, 0); link(g2, m, 0, 1);
          link(m, ctx.destination);
        }
      }
    } else if (eff === '4ch') {
      ctx.destination.channelCount = 4;
      ctx.destination.channelCountMode = 'explicit';
      ctx.destination.channelInterpretation = 'discrete';
      this.outMerger = ctx.createChannelMerger(4);
      this.mSplit = ctx.createChannelSplitter(2);
      this.pSplit = ctx.createChannelSplitter(2);
      this.masterOut.connect(this.mSplit);
      this.phOut.connect(this.pSplit);
      this.mSplit.connect(this.outMerger, 0, 0); this.mSplit.connect(this.outMerger, 1, 1);
      this.pSplit.connect(this.outMerger, 0, 2); this.pSplit.connect(this.outMerger, 1, 3);
      this.outMerger.connect(ctx.destination);
    } else {
      ctx.destination.channelCount = 2;
      ctx.destination.channelCountMode = 'explicit';
      ctx.destination.channelInterpretation = 'speakers';
      if (eff === 'stereo' && this.split) this.phOut.connect(ctx.destination);
      else this.masterOut.connect(ctx.destination);
      if (eff === 'separate' && cueDevice) {
        const msd = ctx.createMediaStreamDestination();
        this.phOut.connect(msd);
        this.cueAudioEl = sideOut(msd.stream, cueDevice, 'auriculares');
      }
    }
    this.outputMode = eff;
    this.emit('outputs', { mode: eff, maxChannels: max, variant: this.extVariant });
    // audio parado por un cambio anterior cuya comprobación se ha abandonado: se comprueba con este montaje
    if (!checking && this.everRan && ctx.state !== 'running') this.checkRunning(this.wantMaster, gen);
    return eff;
  }

  // Dispositivo actual del AudioContext ('' = el predeterminado del sistema)
  currentSink() { const s = this.ctx && this.ctx.sinkId; return typeof s === 'string' ? s : ''; }
  // Quita todas las conexiones a las salidas y cierra los <audio> de los dispositivos secundarios (todos los que se
  // hayan abierto, no solo los últimos: así no queda ninguno huérfano sonando). Canales del destino en estéreo
  disconnectOutputs() {
    const ctx = this.ctx;
    try { this.masterOut.disconnect(ctx.destination); } catch (_) {}
    if (this.mSplit) { try { this.masterOut.disconnect(this.mSplit); } catch (_) {} }
    if (this.outMerger) { try { this.outMerger.disconnect(); } catch (_) {} try { this.mSplit.disconnect(); this.pSplit.disconnect(); } catch (_) {} this.outMerger = null; }
    this.mSplit = this.pSplit = null;
    try { this.phOut.disconnect(); } catch (_) {}
    for (const [src, dst] of this.extLinks || []) { try { src.disconnect(dst); } catch (_) {} }
    this.extLinks = [];
    if (!this.sideSinks) this.sideSinks = new Set();
    for (const s of this.sideSinks) { try { s.el.pause(); s.el.srcObject = null; } catch (_) {} }
    this.sideSinks.clear();
    this.cueAudioEl = this.deck2AudioEl = null;
    try { ctx.destination.channelCount = 2; ctx.destination.channelCountMode = 'explicit'; ctx.destination.channelInterpretation = 'speakers'; } catch (_) {}
  }
  // Tras cambiar de dispositivo: el AudioContext tiene que seguir en marcha y su reloj avanzar. Si se ha parado se
  // reanuda; si a los 400 ms el audio sigue sin avanzar, se pide otra vez el dispositivo (una vez)
  // gen: montaje de salidas que la pidió; si mientras tanto se ha pedido otro, esta comprobación se abandona (no
  // vuelve a pedir un dispositivo que ya no es el elegido)
  async checkRunning(want, gen = this.outGen, retry = true) {
    const ctx = this.ctx, stale = () => this.outGen !== gen;
    if (ctx.state !== 'running') { try { await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 800))]); } catch (_) {} }
    if (stale()) return null;
    const t0 = ctx.currentTime;
    await new Promise(r => setTimeout(r, 400));
    if (stale()) return null;
    const ok = ctx.state === 'running' && ctx.currentTime > t0 + 0.05;
    this.emit('log', ok ? 'INFO' : 'WARN', `Dispositivo de salida ${want ? 'elegido' : 'predeterminado'}: audio ${ok ? 'en marcha' : `parado (estado ${ctx.state})`}`);
    if (!ok && retry && ctx.setSinkId) {
      try { await ctx.setSinkId(want); await ctx.resume(); } catch (e) { this.emit('log', 'WARN', 'Reintento del dispositivo de salida: ' + ((e && e.message) || e)); }
      return this.checkRunning(want, gen, false);
    }
    if (!ok) this.emit('stalled');
    return ok;
  }
  // Dispositivos conectados o desconectados (devicechange): si se ha ido el dispositivo master elegido, se sigue
  // por el predeterminado; si vuelve, se vuelve a él. outs = [{ id, label }] (listOutputs)
  async onDevicesChanged(outs) {
    const want = this.wantMaster || '';
    if (!want || !this.ctx.setSinkId) return null;
    const there = outs.some(o => o.id === want);
    const cur = this.currentSink();
    if (!there && sameDevice(cur, want)) { this.lostMaster = true; this.emit('device', 'lost'); return 'lost'; }
    if (there && this.lostMaster) { this.lostMaster = false; this.emit('device', 'back'); return 'back'; }
    return null;
  }
  // Para el registro técnico: qué salidas hay abiertas ahora
  sinkReport() {
    const dev = (id) => (!id || id === 'default' ? 'predeterminado' : 'dispositivo ' + String(id).slice(0, 8));
    const parts = [`AudioContext → ${dev(this.currentSink())} (${this.ctx.destination.channelCount} de ${this.ctx.destination.maxChannelCount} canales, modo ${this.outputMode}${this.extVariant && this.outputMode === 'external' ? ' · ' + this.extVariant : ''}, ${this.ctx.state})`];
    for (const s of this.sideSinks || []) parts.push(`<audio> ${s.what} → ${dev(s.device)} (${s.state})`);
    return parts.join(' · ');
  }

  setExternal(on) {
    on = !!on;
    if (this.external === on) return;
    this.external = on;
    for (const c of this.channels) for (const k of ['high', 'mid', 'low', 'filter']) c.set(k, c.values[k]);
    this.emit('external', on);
  }

  // --- Grabación del master en WAV 16 bits
  startRecording() {
    if (this.recording) return;
    this.recChunks = [];
    this.recording = true;
    this.recStart = performance.now();
    this.recNode.port.onmessage = (e) => {
      if (e.data.t === 'data') this.recChunks.push([e.data.l, e.data.r]);
      if (e.data.t === 'done' && this._recDone) this._recDone();
    };
    this.recNode.port.postMessage('start');
    this.emit('rec', true);
  }
  stopRecording() {
    if (!this.recording) return Promise.resolve(null);
    this.recording = false;
    this.emit('rec', false);
    return new Promise((resolve) => {
      this._recDone = () => { this._recDone = null; resolve(encodeWav(this.recChunks, this.ctx.sampleRate)); this.recChunks = []; };
      this.recNode.port.postMessage('stop');
    });
  }
}

export function encodeWav(chunks, sr) {
  let frames = 0;
  for (const [l] of chunks) frames += l.length;
  const buf = new ArrayBuffer(44 + frames * 4);
  const dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + frames * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, frames * 4, true);
  let o = 44;
  for (const [l, r] of chunks) {
    for (let i = 0; i < l.length; i++) {
      dv.setInt16(o, Math.max(-1, Math.min(1, l[i])) * 32767, true);
      dv.setInt16(o + 2, Math.max(-1, Math.min(1, r[i])) * 32767, true);
      o += 4;
    }
  }
  return new Uint8Array(buf);
}
