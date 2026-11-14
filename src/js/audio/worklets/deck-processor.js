// Nexura DJ Studio — reproductor de deck en AudioWorklet
// Lectura con interpolación Hermite, velocidad variable (incl. negativa para
// scratch/censor), loops sin cortes, modo slip, freno/arranque de motor y
// keylock / transposición mediante un pitch-shifter con empalmes por correlación.
// Salida 0 = deck; salida 1 = stems enviados a FX (Stems FX, `stemSend`). Stem Slip en loop: `stemHold`.

// Pitch-shifter por segmentos con empalme por correlación (estilo WSOLA/SoundTouch).
// Un cabezal lee la línea de retardo con un retardo d que deriva (1 - factor) por muestra; cuando
// sale del rango [dMin, dMax] se busca, por correlación, el retardo nuevo cuya forma de onda encaja
// mejor con la que estaba sonando y se funde en ~10 ms. Así hay pocos empalmes (cada 0,25-4 s
// según el tempo) y todos en fase: sin el «flanger» ni el trémolo de los granulados de 2 cabezales.
// Entre empalmes lo que suena avanza a velocidad 1 (por eso conserva el tono): el ritmo que se oye se separa
// del de la pista tanto como d se separa de su media. Con un margen de 20 ms (antes 45) esa separación queda
// en ±10 ms como mucho (antes ±22; con SYNC + key lock los golpes se oían hasta 55 ms desfasados), con la
// misma variación de nivel medida; la latencia media (`lat`, ~20 ms en vez de ~35) la descuenta el sync.
class PitchShifter {
  constructor() {
    this.N = 32768; this.mask = this.N - 1;
    this.L = new Float32Array(this.N); this.R = new Float32Array(this.N);
    this.w = 0;
    this.X = Math.round(sampleRate * 0.010);     // fundido del empalme (10 ms)
    this.S = Math.round(sampleRate * 0.0125);    // ventana de búsqueda (±12,5 ms ≥ un periodo de 80 Hz)
    this.RANGE = Math.round(sampleRate * 0.020); // margen de deriva entre empalmes
    this.d = 0; this.d2 = 0; this.x = -1;         // x ≥ 0: empalme en curso (muestras hechas)
    this.reset();
  }
  reset() { this.L.fill(0); this.R.fill(0); this.x = -1; this.d = this.center(1); this.avg = this.d; }
  bounds(f) { const dMin = Math.ceil(this.X * Math.max(1, Math.min(f, 6))) + 64; return [dMin, dMin + this.RANGE]; }
  center(f) { const [a, b] = this.bounds(f); return (a + b) / 2; }
  read(buf, delay) {
    let p = this.w - delay;
    if (p < 0) p += this.N;
    const i = p | 0, f = p - i, m = this.mask;
    const xm1 = buf[(i - 1) & m], x0 = buf[i & m], x1 = buf[(i + 1) & m], x2 = buf[(i + 2) & m];
    const c1 = 0.5 * (x1 - xm1), c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
  }
  mono(delay) { let p = (this.w - delay) | 0; return this.L[p & this.mask] + this.R[p & this.mask]; }
  // Mejor retardo en [lo, hi] para continuar lo que suena con retardo d (los dos cabezales avanzan a «factor»)
  seek(d, lo, hi, f) {
    const X = this.X, st = 4;
    const ref = new Float32Array(Math.ceil(X / st)); let k = 0, er = 0;
    for (let j = 0; j < X; j += st, k++) { const v = this.mono(d - j * f); ref[k] = v; er += v * v; }
    let best = (lo + hi) / 2, bestV = -Infinity;
    const score = (D) => { let c = 0, e = 1e-9, kk = 0; for (let j = 0; j < X; j += st, kk++) { const v = this.mono(D - j * f); c += ref[kk] * v; e += v * v; } return c / Math.sqrt(e * (er + 1e-9)); };
    for (let D = lo; D <= hi; D += 3) { const v = score(D); if (v > bestV) { bestV = v; best = D; } }
    for (let D = best - 2; D <= best + 2; D++) { if (D < lo || D > hi) continue; const v = score(D); if (v > bestV) { bestV = v; best = D; } }
    return best;
  }
  // Procesa una muestra; factor = ratio de transposición (2 = una octava arriba)
  process(l, r, factor, out) {
    this.L[this.w] = l; this.R[this.w] = r;
    const [dMin, dMax] = this.bounds(factor);
    const unity = Math.abs(1 - factor) < 0.0015;
    if (this.x < 0) {
      if (unity) { const t = (dMin + dMax) / 2 - this.d; this.d += Math.max(-0.004, Math.min(0.004, t)); }
      else if (this.d < dMin || this.d > dMax) {
        // empalme: tono arriba (d baja) → saltar hacia dMax; tono abajo (d sube) → hacia dMin
        const S2 = 2 * this.S;
        const up = this.d < dMin;
        const lo = up ? Math.max(dMin, dMax - S2) : dMin, hi = up ? dMax : Math.min(dMax, dMin + S2);
        this.d2 = this.seek(Math.max(this.d, 1), lo, hi, factor);
        this.x = 0;
      }
    }
    const drift = unity ? 0 : 1 - factor;
    if (this.x >= 0) {
      const t = this.x / this.X, g = 0.5 - 0.5 * Math.cos(Math.PI * t); // 0 → 1
      const dA = Math.max(this.d, 1);
      out[0] = this.read(this.L, dA) * (1 - g) + this.read(this.L, this.d2) * g;
      out[1] = this.read(this.R, dA) * (1 - g) + this.read(this.R, this.d2) * g;
      this.d += drift; this.d2 += drift;
      if (++this.x >= this.X) { this.d = this.d2; this.x = -1; }
    } else {
      const dA = Math.max(this.d, 1);
      out[0] = this.read(this.L, dA); out[1] = this.read(this.R, dA);
      this.d += drift;
    }
    if (this.d > this.N - 8) this.d = this.N - 8;
    this.w = (this.w + 1) & this.mask;
  }
}

// Hermite sobre stems en Int16 (para ahorrar memoria: 4 stems estéreo por deck)
function hermite16(buf, pos, len) {
  const i = Math.floor(pos);
  if (i < 0 || i >= len) return 0;
  const f = pos - i;
  const xm1 = i > 0 ? buf[i - 1] : buf[i];
  const x0 = buf[i];
  const x1 = i + 1 < len ? buf[i + 1] : x0;
  const x2 = i + 2 < len ? buf[i + 2] : x1;
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return (((c3 * f + c2) * f + c1) * f + x0) * (1 / 32768);
}

function hermite(buf, pos, len) {
  const i = Math.floor(pos);
  if (i < 0 || i >= len) return 0;
  const f = pos - i;
  const xm1 = i > 0 ? buf[i - 1] : buf[i];
  const x0 = buf[i];
  const x1 = i + 1 < len ? buf[i + 1] : x0;
  const x2 = i + 2 < len ? buf[i + 2] : x1;
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

class DeckProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = null; this.R = null; this.len = 0; this.ratio = 1;
    this.pos = 0;            // posición en muestras del buffer
    this.playing = false;
    this.rate = 1;           // multiplicador de tempo (1 = 100 %)
    this.bend = 0;           // pitch bend temporal
    this.nudge = 0;          // empujón del jog (decae)
    this.nudgeRem = 0;       // muestras que quedan por adelantar (+) o atrasar (−) con `nudgeBy`
    this.cur = 0;            // velocidad actual suavizada
    this.reverse = false;
    this.scratch = false;
    this.scratchTarget = 0;
    this.lastN = 128;        // muestras del último bloque procesado
    this.loopOn = false; this.loopS = 0; this.loopE = 0;
    this.slipping = false; this.shadow = 0;
    // retorno del slip: al soltar se funde (potencia constante) desde la cabeza «vieja» a la sombra
    this.slipRelease = 0;    // segundos (0 = salto inmediato)
    this.xfPos = 0; this.xfN = 0; this.xfLen = 0;
    this.keylock = false; this.semis = 0;
    this.ps = new PitchShifter();
    this.psMix = 0;          // fundido seco/transpuesto
    this.startT = 0.004; this.stopT = 0.004; // tiempos de motor (s)
    this.ended = false;
    this.tick = 0;
    this.tmp = new Float32Array(2);
    // stems: [{L, R}] Int16 en el mismo orden que stemGains; con stems cargados se reproduce su suma
    this.stems = null; this.stemLen = 0;
    this.sgTarget = new Float32Array([1, 1, 1, 1]);
    this.sg = new Float32Array([1, 1, 1, 1]);
    // Stems FX: cada stem puede ir (con fundido) a la salida 2, que pasa por una unidad de FX
    this.sendT = new Float32Array(4); this.sendG = new Float32Array(4);
    this.ps2 = null;                   // pitch-shifter de la salida 2 (solo si se usa)
    // Stem Slip en modo loop: el stem repite [s, s+len) mientras se mantiene; al cambiar se funde (3 ms)
    this.hold = [null, null, null, null]; this.holdNext = [null, null, null, null];
    this.hEnv = new Float32Array([1, 1, 1, 1]); this.hDir = new Int8Array(4);
    this.HF = Math.round(sampleRate * 0.003);
    this.mix4 = new Float32Array(4); this.tmpS = new Float32Array(2);
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  onMsg(m) {
    switch (m.t) {
      case 'load':
        this.L = m.L; this.R = m.R || m.L; this.len = this.L.length; this.stems = null;
        this.ratio = (m.sr || sampleRate) / sampleRate;
        this.pos = m.pos || 0; this.cur = 0; this.playing = false; this.loopOn = false; this.nudgeRem = 0;
        this.slipping = false; this.ended = false; this.scratch = false; this.reverse = false; this.xfN = 0;
        this.hold.fill(null); this.holdNext.fill(null); this.hEnv.fill(1); this.hDir.fill(0);
        this.ps.reset();
        break;
      case 'unload': this.L = this.R = null; this.len = 0; this.playing = false; this.stems = null; this.xfN = 0; break;
      case 'stems':
        if (m.stems && m.stems.length) {
          this.stems = m.stems; this.stemLen = Math.min(...m.stems.map(x => x.L.length));
          if (m.gains) for (let k = 0; k < 4; k++) { this.sgTarget[k] = m.gains[k]; this.sg[k] = m.gains[k]; }
        } else this.stems = null;
        break;
      case 'stemGains': for (let k = 0; k < 4; k++) if (m.v[k] != null) this.sgTarget[k] = m.v[k]; break;
      case 'stemSend': for (let k = 0; k < 4; k++) if (m.v[k] != null) this.sendT[k] = m.v[k] ? 1 : 0; break;
      case 'stemHold': {
        const k = m.k | 0; if (k < 0 || k > 3) break;
        this.holdNext[k] = m.on && m.len > 64 ? { s: m.s, len: m.len } : null;
        this.hDir[k] = -1; // fundido de salida → cambio → fundido de entrada
        break;
      }
      case 'play':
        this.playing = !!m.v;
        if (this.playing && this.ended) this.ended = false;
        break;
      case 'rate': this.rate = m.v; break;
      case 'bend': this.bend = m.v; break;
      case 'nudge': this.nudge += m.v; break;
      // nudgeBy: adelantar / atrasar exactamente m.v muestras con un cambio de velocidad pequeño (rueda del ratón)
      case 'nudgeBy': if (this.playing) this.nudgeRem += m.v; break;
      case 'seek': case 'seekBy': {
        // seekBy: salto relativo (fase del sync), exacto aunque llegue unos milisegundos después de pedirlo
        const to = Math.max(0, Math.min(this.len - 1, m.t === 'seekBy' ? this.pos + m.v : m.v));
        // xf: salto corto sonando (realinear la fase del sync) → fundido de 6 ms desde lo que sonaba, sin clic
        if (m.xf && this.playing && !this.scratch && Math.abs(to - this.pos) > 64) { this.xfPos = this.pos; this.xfN = this.xfLen = Math.round(0.006 * sampleRate); }
        else this.xfN = 0;
        this.pos = to;
        if (m.t === 'seek') this.nudgeRem = 0;
        if (!this.slipping) this.shadow = this.pos;
        this.ended = false;
        if (this.scratch) this.scratchTarget = this.pos;
        break;
      }
      case 'loop':
        this.loopOn = !!m.on;
        if (m.s != null) { this.loopS = m.s; this.loopE = m.e; }
        if (this.loopOn && m.jump && (this.pos >= this.loopE || this.pos < this.loopS)) this.pos = this.loopS;
        break;
      case 'scratch':
        // al tocar el plato sonando, la pista frena en la distancia que recorre en 2 bloques (≈ 5 ms): con
        // el objetivo justo en `pos` frenaba de golpe, se pasaba y volvía hacia atrás (un pequeño salto)
        if (m.v && !this.scratch) this.scratchTarget = this.pos + this.cur * this.lastN * this.ratio * 2;
        else this.scratchTarget = this.pos;
        this.scratch = !!m.v;
        break;
      case 'scratchDelta': this.scratchTarget += m.v; break;
      case 'reverse': this.reverse = !!m.v; break;
      case 'slipBegin':
        if (!this.slipping) { this.slipping = true; this.shadow = this.pos; }
        break;
      case 'slipEnd':
        if (this.slipping) {
          this.slipping = false;
          if (m.jump !== false) {
            const to = Math.min(this.shadow, this.len - 1);
            const n = Math.round(this.slipRelease * sampleRate);
            if (n > 0 && this.playing && !this.scratch && Math.abs(to - this.pos) > 64) { this.xfPos = this.pos; this.xfN = this.xfLen = n; }
            this.pos = to;
            if (this.scratch) this.scratchTarget = this.pos;
          }
        }
        break;
      case 'slipRelease': this.slipRelease = Math.max(0, Math.min(1, +m.v || 0)); break;
      case 'keylock': this.keylock = !!m.v; break;
      case 'semis': this.semis = m.v; break;
      case 'motor': this.startT = Math.max(0.002, m.start); this.stopT = Math.max(0.002, m.stop); break;
    }
  }

  // Suma de stems en una posición con las ganancias actuales: o[0..1] = principal, o[2..3] = envío a FX
  mixStems(pos, o) {
    let l = 0, r = 0, a = 0, b = 0;
    const stems = this.stems, len = this.stemLen;
    for (let k = 0; k < stems.length; k++) {
      const g = this.sg[k] * this.hEnv[k];
      if (g < 1e-4) continue;
      const h = this.hold[k];
      let p = pos;
      if (h) { p = h.s + (((pos - h.s) % h.len) + h.len) % h.len; }
      const st = stems[k];
      const vl = g * hermite16(st.L, p, len), vr = g * hermite16(st.R, p, len);
      const s = this.sendG[k];
      l += vl * (1 - s); r += vr * (1 - s); a += vl * s; b += vr * s;
    }
    o[0] = l; o[1] = r; o[2] = a; o[3] = b;
  }
  // Muestra en una posición (o[2..3] = envío a FX; sin stems, 0)
  readAt(pos, o) {
    if (this.stems) this.mixStems(pos, o);
    else { o[0] = hermite(this.L, pos, this.len); o[1] = hermite(this.R, pos, this.len); o[2] = 0; o[3] = 0; }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const oL = out[0], oR = out[1] || out[0];
    const n = oL.length;
    // salida 2: envío de stems a FX (Stems FX)
    const o2 = outputs[1], sL = o2 && o2[0], sR = o2 && (o2[1] || o2[0]);
    if (sL) { sL.fill(0); if (sR !== sL) sR.fill(0); }
    if (!this.L) { oL.fill(0); if (oR !== oL) oR.fill(0); return true; }

    // ---- velocidad objetivo
    const prev = this.cur;
    this.lastN = n;
    if (this.scratch) {
      // la velocidad sigue al plato con amortiguamiento crítico (5 bloques × 0,8): sin rebotes y sin los
      // tirones de los movimientos del ratón, que llegan a saltos cada 8-16 ms
      const diff = this.scratchTarget - this.pos;
      let want = diff / (n * this.ratio * 5);
      want = Math.max(-24, Math.min(24, want));
      this.cur += (want - this.cur) * 0.8;
      this.nudgeRem = 0; // la mano manda: un nudge pendiente no se aplica al soltar
    } else {
      // nudgeBy: como mucho un 6 % más rápido o más lento hasta recorrer lo pedido (sin cambio de tono brusco)
      let extra = 0;
      if (this.nudgeRem && this.playing && !this.ended) {
        const blk = n * this.ratio;
        extra = Math.max(-0.06, Math.min(0.06, this.nudgeRem / (blk * 12)));
        this.nudgeRem -= extra * blk;
        if (Math.abs(this.nudgeRem) < 0.5) this.nudgeRem = 0;
      } else this.nudgeRem = 0;
      let target = this.playing && !this.ended ? (this.rate + this.bend + this.nudge + extra) : 0;
      if (this.reverse && this.playing) target = -Math.abs(target || this.rate);
      const T = Math.abs(target) > Math.abs(this.cur) ? this.startT : this.stopT;
      const step = (n / sampleRate) / T;
      const d = target - this.cur;
      this.cur = Math.abs(d) <= step ? target : this.cur + Math.sign(d) * step;
    }
    this.nudge *= 0.86;
    if (Math.abs(this.nudge) < 1e-4) this.nudge = 0;

    // ---- keylock / transposición
    const semiF = Math.pow(2, this.semis / 12);
    const speedAbs = Math.abs(this.cur);
    const lockActive = this.keylock && !this.scratch && speedAbs > 0.3 && speedAbs < 3;
    const wantPS = lockActive || this.semis !== 0;
    const psFactor = (lockActive ? 1 / speedAbs : 1) * semiF;

    const L = this.L, R = this.R, len = this.len, ratio = this.ratio;
    const stems = this.stems, sg = this.sg, sgT = this.sgTarget;
    const tmp = this.tmp;
    const shadowStep = this.playing ? this.rate * ratio : 0;

    const m4 = this.mix4, tmpS = this.tmpS;
    const sendG = this.sendG, sendT = this.sendT, hEnv = this.hEnv, hDir = this.hDir, HF = this.HF;
    // ¿hay envío a FX? (stems cargados, salida 2 conectada y algún stem enviado o fundiéndose)
    let useSend = false;
    if (stems && sL) for (let k = 0; k < 4; k++) if (sendT[k] > 0 || sendG[k] > 1e-4) useSend = true;
    if (!useSend) sendG.fill(0);
    if (useSend && !this.ps2) this.ps2 = new PitchShifter();
    for (let i = 0; i < n; i++) {
      const s = prev + (this.cur - prev) * (i / n);
      let l, r, xl = 0, xr = 0;
      if (stems) {
        // ganancias y envíos suavizados (~10 ms) y fundidos de Stem Slip (3 ms) para evitar clics
        for (let k = 0; k < 4; k++) {
          sg[k] += (sgT[k] - sg[k]) * 0.0025;
          if (useSend) sendG[k] += (sendT[k] - sendG[k]) * 0.0025;
          if (hDir[k] < 0) {
            hEnv[k] -= 1 / HF;
            if (hEnv[k] <= 0) { hEnv[k] = 0; this.hold[k] = this.holdNext[k]; hDir[k] = 1; }
          } else if (hDir[k] > 0) {
            hEnv[k] += 1 / HF;
            if (hEnv[k] >= 1) { hEnv[k] = 1; hDir[k] = 0; }
          }
        }
        this.mixStems(this.pos, m4);
        l = m4[0]; r = m4[1]; xl = m4[2]; xr = m4[3];
      } else {
        l = hermite(L, this.pos, len);
        r = hermite(R, this.pos, len);
      }
      // retorno del slip: la cabeza vieja sigue sonando y se funde con la nueva (potencia constante)
      if (this.xfN > 0) {
        this.readAt(this.xfPos, m4);
        const g = 1 - this.xfN / this.xfLen, a = Math.sin(g * Math.PI / 2), b = Math.cos(g * Math.PI / 2);
        l = l * a + m4[0] * b; r = r * a + m4[1] * b;
        xl = xl * a + m4[2] * b; xr = xr * a + m4[3] * b;
        this.xfPos = Math.max(0, Math.min(len - 1, this.xfPos + s * ratio));
        this.xfN--;
      }
      // pitch-shifter (siempre alimentado para tener la línea de retardo lista)
      if (wantPS || this.psMix > 0) {
        const f = wantPS ? psFactor : 1;
        this.ps.process(l, r, f, tmp);
        if (useSend) this.ps2.process(xl, xr, f, tmpS);
        if (wantPS && this.psMix < 1) this.psMix = Math.min(1, this.psMix + 1 / 512);
        else if (!wantPS && this.psMix > 0) this.psMix = Math.max(0, this.psMix - 1 / 512);
        const m = this.psMix;
        l = l * (1 - m) + tmp[0] * m;
        r = r * (1 - m) + tmp[1] * m;
        if (useSend) { xl = xl * (1 - m) + tmpS[0] * m; xr = xr * (1 - m) + tmpS[1] * m; }
      }
      oL[i] = l; oR[i] = r;
      if (useSend) { sL[i] = xl; sR[i] = xr; }

      this.pos += s * ratio;
      if (this.slipping) this.shadow += shadowStep;
      if (this.loopOn && this.loopE > this.loopS) {
        const ll = this.loopE - this.loopS;
        if (s >= 0 && this.pos >= this.loopE) this.pos -= ll;
        else if (s < 0 && this.pos < this.loopS) this.pos += ll;
      }
      if (this.pos >= len - 1) {
        this.pos = len - 1;
        if (this.playing && !this.scratch && !this.ended) { this.ended = true; this.port.postMessage({ t: 'ended' }); }
      } else if (this.pos < 0) this.pos = 0;
    }
    if (!this.slipping) this.shadow = this.pos;
    // latencia media del pitch-shifter (≈ 2 s): lo que se oye va `lat` muestras de salida por detrás de `pos`
    if (wantPS || this.psMix > 0) this.ps.avg += (this.ps.d - this.ps.avg) * 0.0013;

    if (++this.tick >= 3) {
      this.tick = 0;
      // f = muestra de audio de este instante: la interfaz compara los decks en el mismo instante exacto
      const f = typeof currentFrame === 'number' ? currentFrame + n : undefined; // (sin él en pruebas de Node antiguas)
      this.port.postMessage({ t: 's', pos: this.pos, sp: this.cur, sh: this.shadow, sl: this.slipping, f, lat: this.psMix * this.ps.avg });
    }
    return true;
  }
}

registerProcessor('nexura-deck', DeckProcessor);
