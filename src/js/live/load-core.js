// Medidor de carga y cortes de audio (rc.10): lógica pura (sin interfaz).
//
// - Carga del hilo de audio: tiempo que pasan los decks (AudioWorklet) procesando frente al tiempo real que dura el
//   audio que generan («tiempo de proceso frente al tiempo de bloque»). Cada deck lo mide en su worklet y lo manda
//   cada ~0,5 s (busy ms, ms de audio); aquí se suman.
// - Cortes: si el audio llega tarde a la tarjeta, el reloj del AudioContext (lo que de verdad ha sonado) se queda
//   atrás respecto al reloj del sistema. Se compara el par (contextTime, performanceTime) de getOutputTimestamp()
//   (o currentTime frente a performance.now()): un salto del retraso de más de ~15 ms (o de 1,5 veces el tamaño del
//   búfer) es un corte. Si el navegador da estadísticas de reproducción (playbackStats), también se usan.
// - Nivel: verde < 50 %, ámbar 50-70 %, rojo > 70 % o con cortes recientes.
// - «Al límite» (overloaded): carga > 70 % durante 2 s o algún corte → se pausa el análisis en segundo plano, se
//   bajan los fps de las ondas y se avisa con «Subir latencia a Segura». Vuelve a la normalidad tras 15 s por
//   debajo del 55 % y sin cortes.
export const HIGH = 0.70, AMBER = 0.50, CALM = 0.55;
export const ENTER_MS = 2000, EXIT_MS = 15000;
export const GLITCH_MS = 15;

export class LoadMeter {
  constructor() {
    this.decks = new Map();      // idx → { busy, audio, at } del último informe
    this.load = 0;               // 0..1 (suavizada)
    this.peak = 0; this.peakAt = 0;
    this.glitches = [];          // [{ at, ms }] (Date.now())
    this.overloaded = false; this.highSince = null; this.calmSince = null; this.overSince = null;
    this.base = null;            // retraso base (ms) del reloj de audio respecto al del sistema
    this.lastPair = null;
    this.events = [];            // cambios de «al límite» (para el informe)
  }

  // Informe de un deck: busy = ms procesando, audio = ms de audio generado, en el último intervalo
  deckReport(idx, busy, audio, now = Date.now()) {
    if (!(audio > 0)) return;
    this.decks.set(idx, { busy: Math.max(0, busy), audio, at: now });
  }
  // Carga total ahora: suma de lo que cuesta cada deck (cada uno sobre su propio tiempo de audio), informes de < 2 s
  instant(now = Date.now()) {
    let s = 0;
    for (const r of this.decks.values()) if (now - r.at < 2000) s += r.busy / r.audio;
    return Math.max(0, s);
  }

  // Par de relojes: ctxMs = tiempo de audio sonado (ms), perfMs = el del sistema en ese instante (ms).
  // bufferMs = tamaño aproximado del búfer de salida (para no confundir el vaivén normal con un corte)
  clockPair(ctxMs, perfMs, now = Date.now(), bufferMs = 10) {
    const lag = perfMs - ctxMs;
    const lim = Math.max(GLITCH_MS, bufferMs * 1.5);
    let glitch = null;
    // primera vez, tras una pausa larga o al arrancar el audio (los primeros ~3 s el reloj aún se asienta)
    if (this.base == null || (this.lastPair && perfMs - this.lastPair.perf > 5000)) { this.base = lag; this.warmUntil = perfMs + 3000; this.pending = null; }
    else if (perfMs < (this.warmUntil || 0)) { if (lag > this.base) this.base = lag; }
    else if (lag - this.base > lim) {
      // un corte deja el audio atrasado para siempre; una marca de tiempo suelta que llega tarde, no: se confirma
      // con la muestra siguiente
      if (this.pending != null && lag - this.base > lim * 0.8) { glitch = Math.round(Math.min(this.pending, lag) - this.base); this.addGlitch(glitch, now); this.base = Math.min(this.pending, lag); this.pending = null; }
      else this.pending = lag;
    }
    else {
      this.pending = null;
      if (lag < this.base) this.base = lag;               // el retraso base es el mínimo visto
      else this.base += (lag - this.base) * 0.002;        // deriva lenta entre relojes (ppm)
    }
    this.lastPair = { ctx: ctxMs, perf: perfMs };
    return glitch;
  }
  // Estadísticas del navegador (si existen): eventos de corte acumulados
  underruns(count, now = Date.now()) {
    if (this.lastUnderruns != null && count > this.lastUnderruns) for (let i = this.lastUnderruns; i < count; i++) this.addGlitch(null, now);
    this.lastUnderruns = count;
  }
  addGlitch(ms, now = Date.now()) {
    this.glitches.push({ at: now, ms });
    if (this.glitches.length > 200) this.glitches.shift();
  }
  recentGlitches(now = Date.now(), win = 60000) { return this.glitches.filter(g => now - g.at < win).length; }

  // Cada ~0,5 s: carga suavizada, pico y estado «al límite» → { load, level, overloaded, changed }
  tick(now = Date.now()) {
    const inst = this.instant(now);
    this.load = this.load ? this.load * 0.6 + inst * 0.4 : inst;
    if (inst > this.peak) { this.peak = inst; this.peakAt = now; }
    const glitchNow = this.glitches.some(g => now - g.at < 3000);
    if (this.load > HIGH) { if (this.highSince == null) this.highSince = now; } else this.highSince = null;
    if (this.load < CALM && !glitchNow) { if (this.calmSince == null) this.calmSince = now; } else this.calmSince = null;
    const prev = this.overloaded;
    if (!this.overloaded && (glitchNow || (this.highSince != null && now - this.highSince >= ENTER_MS))) { this.overloaded = true; this.overSince = now; }
    else if (this.overloaded && this.calmSince != null && now - this.calmSince >= EXIT_MS) this.overloaded = false;
    const changed = prev !== this.overloaded;
    if (changed) { this.events.push({ at: now, on: this.overloaded, load: Math.round(this.load * 100), cause: glitchNow ? 'cortes' : 'carga' }); if (this.events.length > 20) this.events.shift(); }
    return { load: this.load, level: this.level(now), overloaded: this.overloaded, changed };
  }
  level(now = Date.now()) {
    if (this.load > HIGH || this.recentGlitches(now, 30000)) return 'red';
    if (this.load > AMBER) return 'amber';
    return 'green';
  }

  // Para el informe de sugerencias (sin datos personales)
  snapshot(now = Date.now()) {
    return {
      loadPct: Math.round(this.load * 100), peakPct: Math.round(this.peak * 100), peakMinAgo: this.peakAt ? Math.round((now - this.peakAt) / 6000) / 10 : null,
      glitches: this.glitches.length, glitchesLastMin: this.recentGlitches(now),
      glitchTimes: this.glitches.slice(-10).map(g => ({ minAgo: Math.round((now - g.at) / 6000) / 10, ms: g.ms })),
      overloaded: this.overloaded, events: this.events.slice(-8).map(e => ({ minAgo: Math.round((now - e.at) / 6000) / 10, on: e.on, load: e.load, cause: e.cause }))
    };
  }
}

// Latencia (Ajustes → Audio): latencyHint del AudioContext para cada opción.
//  low (Baja): 'interactive' (lo mínimo que da el sistema: ~10 ms en Windows) — para scratch y controladora.
//  normal (Equilibrada, por defecto): 0,02 s (~20 ms: un poco de margen sin que se note al pinchar).
//  safe (Segura): 0,045 s (~45 ms) — equipos lentos o portátiles: el audio aguanta picos de carga sin cortes.
// (Chromium redondea al tamaño de búfer que admite el dispositivo: la latencia real se mide y se enseña.)
export const LATENCY = {
  low: { hint: 'interactive', label: 'Baja', ms: 10 },
  normal: { hint: 0.02, label: 'Equilibrada', ms: 20 },
  safe: { hint: 0.045, label: 'Segura', ms: 45 }
};
export const latencyHintFor = (v) => (LATENCY[v] || LATENCY.normal).hint;
// Latencia real (ms) de un AudioContext: baseLatency + outputLatency
export const realLatencyMs = (ctx) => (ctx ? Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 10000) / 10 : 0);
