// Formas de onda: vista de detalle con desplazamiento (beatgrid, cues, loops)
// y vista general de la pista completa.
import { clamp, DECK_COLORS, DECK_LIGHT, CUE_COLORS } from '../util.js';
import { tempoChanges } from '../audio/grid.js';
import { TC } from './theme.js';

const SEC_COLORS = { intro: CUE_COLORS[4], drop: '#ff3b47', break: '#a35bff', outro: '#ffa31a' };
// Colores de frecuencias (graves rojo, medios verde, agudos azul): se conservan en todos los temas
// colores-ok: C_HIGH es el color de los agudos de la forma de onda
const C_LOW = [235, 45, 40], C_MID = [60, 205, 70], C_HIGH = [45, 110, 255];

// Precalcula un color por bloque de la forma de onda
export function colorize(wave) {
  if (wave.colors) return wave.colors;
  const d = wave.data, n = d.length / 4;
  const colors = new Array(n);
  for (let i = 0; i < n; i++) {
    const l = d[i * 4 + 1] + 1, m = d[i * 4 + 2] * 0.9 + 1, h = d[i * 4 + 3] * 0.8 + 1;
    const s = l + m + h;
    const r = (l * C_LOW[0] + m * C_MID[0] + h * C_HIGH[0]) / s;
    const g = (l * C_LOW[1] + m * C_MID[1] + h * C_HIGH[1]) / s;
    const b = (l * C_LOW[2] + m * C_MID[2] + h * C_HIGH[2]) / s;
    colors[i] = `rgb(${r | 0},${g | 0},${b | 0})`;
  }
  wave.colors = colors;
  return colors;
}

// Vídeos de YouTube: el audio no pasa por el motor (condiciones de uso), así que en lugar de la forma de
// onda se dibuja una barra de progreso con el cursor, los hot cues y el cue; clic = saltar a ese punto
const YT_PAD = 10;
function ytBar(w, detail) { const pad = detail ? YT_PAD : 2; return { x0: pad, len: Math.max(1, w - pad * 2) }; }
export function ytTimeAt(x, w, d, detail) {
  const b = ytBar(w, detail);
  return clamp((x - b.x0) / b.len, 0, 1) * d.duration;
}
function drawYouTube(ctx, w, h, d, detail) {
  const col = DECK_COLORS[d.idx], b = ytBar(w, detail);
  const label = detail && h >= 34;
  const bh = detail ? Math.min(24, Math.max(10, h * 0.32)) : Math.max(6, h - 12);
  const y = label ? Math.max(17, (h - bh) / 2 + 4) : (h - bh) / 2;
  const xOf = (t) => b.x0 + clamp(t / d.duration, 0, 1) * b.len;
  ctx.fillStyle = TC['wave-track'];
  ctx.fillRect(b.x0, y, b.len, bh);
  if (label) {
    ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = TC['wave-label'];
    ctx.fillText('▶ Vídeo de YouTube · sin forma de onda', b.x0 + 4, 12);
  }
  if (!d.duration) {
    if (detail) {
      ctx.fillStyle = TC['wave-text']; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Esperando la duración del vídeo…', w / 2, y + bh / 2 + 4);
    }
    return;
  }
  const t = d.time, px = xOf(t);
  // parte reproducida en el color del deck; lo que queda, el mismo color muy tenue
  ctx.fillStyle = col; ctx.globalAlpha = 0.22; ctx.fillRect(b.x0, y, b.len, bh);
  ctx.globalAlpha = 0.85; ctx.fillRect(b.x0, y, px - b.x0, bh);
  ctx.globalAlpha = 1;
  if (label) {
    // tiempo / duración a la derecha, solo si cabe junto al texto (en pantallas estrechas ya lo dan ELAPSED/REMAIN)
    const s = `${fmtShort(t)} / ${fmtShort(d.duration)}`;
    ctx.font = '600 10px Inter, sans-serif';
    const lw = ctx.measureText('▶ Vídeo de YouTube · sin forma de onda').width;
    ctx.font = '600 10px "Cascadia Mono", Consolas, monospace';
    if (lw + ctx.measureText(s).width + 24 < b.len) {
      ctx.textAlign = 'right'; ctx.fillStyle = TC['wave-label'];
      ctx.fillText(s, w - b.x0 - 4, 12);
    }
  }
  // hot cues: línea a lo alto de la barra y, en la vista grande, su número debajo
  d.track.cues.forEach((c, i) => {
    if (!c) return;
    const x = Math.round(xOf(c.t));
    ctx.fillStyle = c.color;
    ctx.fillRect(x - 1, y - 3, 2, bh + 6);
    if (detail && y + bh + 15 <= h) {
      ctx.fillRect(x - 1, y + bh + 2, 14, 13);
      ctx.fillStyle = '#000'; ctx.font = '700 10px Inter, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(String(i + 1), x + 3, y + bh + 12);
    }
  });
  // cue principal: triángulo blanco encima de la barra
  const cx = xOf(d.cuePoint);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(cx - 5, y - 8); ctx.lineTo(cx + 5, y - 8); ctx.lineTo(cx, y - 1); ctx.fill();
  // cursor; en los últimos 30 s parpadea en rojo como en las pistas locales
  const warn = d.duration - t < 30 && d.playing && Math.floor(performance.now() / 400) % 2;
  ctx.fillStyle = warn ? '#f04848' : '#ffffff';
  ctx.fillRect(Math.round(px) - 1, detail ? Math.max(0, y - 10) : 0, 3, detail ? bh + 20 : h);
  if (detail) { ctx.fillStyle = col; ctx.fillRect(4, 4, 3, h - 8); }
}
function fmtShort(s) { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

function fitCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export class WaveDetail {
  constructor(canvas, deck, app) {
    this.c = canvas; this.deck = deck; this.app = app;
    this.isGlobal = canvas.classList.contains('wave');
    this.zoom = app.settings.waveZoom || 6; // segundos visibles
    this.wave = null;
    this.bind();
  }
  setWave(w) { this.wave = w; if (w) colorize(w); }
  bind() {
    // Arrastrar la forma de onda = scratch / búsqueda
    let lastX = 0, dragging = false;
    // YouTube: clic o arrastre sobre la barra de progreso = saltar a ese punto (seek del reproductor,
    // como mucho cada 120 ms mientras se arrastra)
    let ytAt = 0;
    const ytSeek = (e, force) => {
      const d = this.deck;
      if (!d.duration || (!force && performance.now() - ytAt < 120)) return;
      ytAt = performance.now();
      d.seek(ytTimeAt(e.clientX - this.c.getBoundingClientRect().left, this.c.clientWidth, d, true));
    };
    this.c.addEventListener('pointerdown', (e) => {
      if (!this.deck.track) return;
      dragging = true; lastX = e.clientX;
      this.c.setPointerCapture(e.pointerId);
      if (this.deck.isYT) return ytSeek(e, true);
      if (this.deck.playing) { this.deck.vinylTemp = this.deck.vinyl; this.deck.vinyl = true; this.deck.jogTouch(true); }
    });
    this.c.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (this.deck.isYT) return ytSeek(e, false);
      const dx = e.clientX - lastX; lastX = e.clientX;
      const secPerPx = this.zoom / this.c.clientWidth;
      if (this.deck.scratching) this.deck.scratchBySeconds(-dx * secPerPx);
      else this.deck.seek(this.deck.time - dx * secPerPx);
    });
    const up = (e) => {
      if (!dragging) return;
      dragging = false;
      if (this.deck.isYT) { if (e.type === 'pointerup' && e.clientX !== lastX) ytSeek(e, true); return; }
      if (this.deck.scratching) { this.deck.jogTouch(false); if (this.deck.vinylTemp != null) { this.deck.vinyl = this.deck.vinylTemp; this.deck.vinylTemp = null; } }
    };
    this.c.addEventListener('pointerup', up);
    this.c.addEventListener('pointercancel', up);
    this.c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = clamp(this.zoom * (e.deltaY > 0 ? 1.15 : 1 / 1.15), 1.5, 40);
      this.app.settings.waveZoom = this.zoom;
    }, { passive: false });
  }
  draw() {
    if (!this.c.isConnected || !this.c.clientWidth || !this.c.clientHeight) return;
    const { ctx, w, h } = fitCanvas(this.c);
    const d = this.deck;
    ctx.fillStyle = TC['wave-bg'];
    ctx.fillRect(0, 0, w, h);
    const mid = h / 2;
    if (!d.track) {
      ctx.fillStyle = TC['wave-empty']; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`DECK ${d.idx + 1} — arrastra una pista aquí`, w / 2, mid + 4);
      return;
    }
    if (d.isYT) return drawYouTube(ctx, w, h, d, true);
    const t = d.time;
    const pxPerSec = w / this.zoom;
    const t0 = t - (w / 2) / pxPerSec;
    const xOf = (tt) => (tt - t0) * pxPerSec;

    // región de loop
    if (d.loop.e > d.loop.s) {
      ctx.fillStyle = d.loop.on ? 'rgba(76,195,107,0.15)' : 'rgba(140,140,150,0.08)';
      ctx.fillRect(xOf(d.loop.s), 0, (d.loop.e - d.loop.s) * pxPerSec, h);
    }

    // forma de onda
    const wave = this.wave;
    if (wave) {
      const data = wave.data, colors = wave.colors, rate = wave.rate, nb = data.length / 4;
      const binsPerPx = rate / pxPerSec;
      for (let x = 0; x < w; x++) {
        const tb = (t0 + x / pxPerSec) * rate;
        if (tb < 0 || tb >= nb) continue;
        let bi = Math.floor(tb), best = bi, bv = data[bi * 4];
        const end = Math.min(nb, Math.floor(tb + binsPerPx));
        for (let k = bi + 1; k < end; k++) { const v = data[k * 4]; if (v > bv) { bv = v; best = k; } }
        const amp = (bv / 255) * (mid - 2);
        // En la vista superior cada deck conserva su color identificativo;
        // la vista «en deck» mantiene la coloración espectral real (low/mid/high).
        const seratoColor = this.isGlobal && this.app.waveLayout === 'serato'
          ? DECK_COLORS[d.idx]
          : null;
        ctx.fillStyle = seratoColor || colors[best];
        if (x < w / 2) ctx.globalAlpha = 0.55;
        ctx.fillRect(x, mid - amp, 1, amp * 2);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.fillStyle = TC['wave-text']; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Analizando…', w / 2, mid + 4);
    }

    // beatgrid
    if (d.bpm) {
      const bl = d.beatLen;
      const b0 = Math.floor(d.beatAt(t0)), b1 = Math.ceil(d.beatAt(t0 + w / pxPerSec));
      const step = pxPerSec * bl < 6 ? 4 : 1;
      for (let b = b0; b <= b1; b++) {
        if (b % step) continue;
        const x = Math.round(xOf(d.beatTime(b))) + 0.5;
        const bar = ((b % 4) + 4) % 4 === 0;
        ctx.strokeStyle = bar ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.13)';
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, bar ? h : 8); ctx.moveTo(x, h - (bar ? 0 : 8)); ctx.lineTo(x, h); ctx.stroke();
      }
    }

    // marcas del beatgrid (BPM variable): línea naranja con rombo abajo y, donde cambia el tempo,
    // una etiqueta con el BPM nuevo (y la flecha de subida/bajada)
    if (d.hasGridMarkers) {
      const g = d.track.grid;
      g.forEach((m, i) => {
        const x = Math.round(xOf(m.t)) + 0.5;
        if (x < -90 || x > w + 10) return;
        ctx.strokeStyle = '#ff9a1f'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); ctx.lineWidth = 1;
        ctx.fillStyle = '#ff9a1f';
        ctx.beginPath(); ctx.moveTo(x, h - 12); ctx.lineTo(x + 5, h - 6); ctx.lineTo(x, h); ctx.lineTo(x - 5, h - 6); ctx.fill();
        const prev = g[i - 1], changed = !prev || Math.abs(m.bpm - prev.bpm) > 0.005;
        if (!changed) return;
        const label = (prev ? (m.bpm > prev.bpm ? '▲ ' : '▼ ') : '') + m.bpm.toFixed(2) + ' BPM';
        ctx.font = '700 10px Inter, sans-serif'; ctx.textAlign = 'left';
        const tw = ctx.measureText(label).width + 10, y = Math.min(h - 30, 15);
        ctx.fillStyle = TC['wave-chip']; ctx.fillRect(x + 3, y, tw, 14);
        ctx.strokeStyle = '#ff9a1f'; ctx.strokeRect(x + 3.5, y + 0.5, tw - 1, 13);
        ctx.fillStyle = '#ffb35a'; ctx.fillText(label, x + 8, y + 11);
      });
    }

    // secciones detectadas por la IA (etiqueta arriba)
    for (const sct of d.track.sections || []) {
      const x = xOf(sct.t);
      if (x < -80 || x > w + 10) continue;
      const col = SEC_COLORS[sct.type] || TC.muted;
      ctx.font = '700 9px Inter, sans-serif'; ctx.textAlign = 'left';
      const tw = ctx.measureText(sct.label).width + 8;
      ctx.globalAlpha = 0.85; ctx.fillStyle = col; ctx.fillRect(Math.round(x), 0, tw, 12); ctx.globalAlpha = 1;
      ctx.fillStyle = '#000'; ctx.fillText(sct.label, Math.round(x) + 4, 9);
    }
    // BPM, tonalidad y energía
    if (d.bpm) {
      const info = `${d.currentBpm.toFixed(1)} BPM${d.displayKey ? ' · ' + d.displayKey : ''}${d.track.energy ? ' · ⚡' + d.track.energy : ''}`;
      ctx.font = '700 10px Inter, sans-serif'; ctx.textAlign = 'right';
      const tw = ctx.measureText(info).width + 10;
      ctx.fillStyle = TC['wave-chip']; ctx.fillRect(w - tw - 4, 2, tw, 14);
      ctx.fillStyle = DECK_LIGHT[d.idx]; ctx.fillText(info, w - 9, 12);
    }

    // cue principal y hot cues
    const cx = xOf(d.cuePoint);
    if (cx > -5 && cx < w + 5) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(cx - 5, 0); ctx.lineTo(cx + 5, 0); ctx.lineTo(cx, 7); ctx.fill();
    }
    d.track.cues.forEach((c, i) => {
      if (!c) return;
      const x = xOf(c.t);
      if (c.le) { // Cue Loop: franja del loop guardado
        const xe = xOf(c.le);
        if (xe > -5 && x < w + 5) {
          ctx.fillStyle = c.color; ctx.globalAlpha = d.isCueLoopActive(c) ? 0.28 : 0.14;
          ctx.fillRect(Math.round(x), 0, Math.max(2, Math.round(xe - x)), h);
          ctx.globalAlpha = 1;
          ctx.fillRect(Math.round(xe) - 1, 0, 2, 10);
        }
      }
      if (x < -20 || x > w + 20) return;
      ctx.fillStyle = c.color;
      ctx.fillRect(Math.round(x), 0, 2, h);
      ctx.fillRect(Math.round(x), h - 14, 16, 14);
      ctx.fillStyle = '#000'; ctx.font = '700 10px Inter, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(String(i + 1), Math.round(x) + 5, h - 3);
    });
    // Cue Loops del modo de pads Cue Loop: franja y marca superior «L1…L8»
    (d.track.cueLoops || []).forEach((c, i) => {
      if (!c) return;
      const x = xOf(c.t), xe = xOf(c.le);
      if (xe < -5 || x > w + 5) return;
      ctx.fillStyle = c.color; ctx.globalAlpha = d.isCueLoopActive(c) ? 0.28 : 0.12;
      ctx.fillRect(Math.round(x), 0, Math.max(2, Math.round(xe - x)), h);
      ctx.globalAlpha = 1;
      ctx.fillRect(Math.round(x), 0, 2, h);
      ctx.fillRect(Math.round(x), 0, 20, 13);
      ctx.fillStyle = '#000'; ctx.font = '700 9px Inter, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('L' + (i + 1), Math.round(x) + 4, 10);
    });

    // cabezal
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(w / 2) - 1, 0, 2, h);
    ctx.fillStyle = DECK_COLORS[d.idx];
    ctx.fillRect(4, 4, 3, h - 8);
  }
}

export class WaveOverview {
  constructor(canvas, deck) {
    this.c = canvas; this.deck = deck; this.wave = null; this.cache = null;
    canvas.addEventListener('pointerdown', (e) => this.seekFrom(e));
    canvas.addEventListener('pointermove', (e) => { if (e.buttons & 1) this.seekFrom(e); });
  }
  seekFrom(e) {
    const d = this.deck;
    if (!d.track || !d.duration) return;
    const r = this.c.getBoundingClientRect();
    if (d.isYT) {
      // el reproductor de YouTube no admite un seek por cada movimiento del ratón
      if (e.type === 'pointermove' && performance.now() - (this.ytAt || 0) < 120) return;
      this.ytAt = performance.now();
      return d.seek(ytTimeAt(e.clientX - r.left, r.width, d, false));
    }
    d.seek(clamp((e.clientX - r.left) / r.width, 0, 1) * d.duration);
  }
  setWave(w) { this.wave = w; this.cache = null; if (w) colorize(w); }
  render(w, h) {
    const off = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    off.width = w * dpr; off.height = h * dpr;
    const ctx = off.getContext('2d');
    ctx.scale(dpr, dpr);
    const wave = this.wave, data = wave.data, nb = data.length / 4;
    const dur = this.deck.duration || nb / wave.rate;
    const binsPerPx = (dur * wave.rate) / w;
    const mid = h / 2;
    for (let x = 0; x < w; x++) {
      const b0 = Math.floor(x * binsPerPx), b1 = Math.min(nb, Math.floor((x + 1) * binsPerPx));
      let bv = 0, best = b0;
      for (let k = b0; k < b1; k++) { const v = data[k * 4]; if (v > bv) { bv = v; best = k; } }
      const amp = (bv / 255) * (mid - 1);
      ctx.fillStyle = wave.colors[Math.min(best, nb - 1)] || '#555';
      ctx.fillRect(x, mid - amp, 1, amp * 2);
    }
    this.cache = { canvas: off, w, h };
  }
  draw() {
    if (!this.c.isConnected || !this.c.clientWidth || !this.c.clientHeight) return;
    const { ctx, w, h } = fitCanvas(this.c);
    const d = this.deck;
    ctx.fillStyle = TC['overview-bg'];
    ctx.fillRect(0, 0, w, h);
    if (d.track && d.isYT) return drawYouTube(ctx, w, h, d, false);
    if (!d.track || !d.duration) return;
    if (this.wave) {
      if (!this.cache || this.cache.w !== w || this.cache.h !== h) this.render(w, h);
      ctx.drawImage(this.cache.canvas, 0, 0, w, h);
    } else {
      ctx.fillStyle = TC['overview-empty'];
      ctx.fillRect(0, h / 2 - 3, w, 6);
    }
    const px = (d.time / d.duration) * w;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, px, h);
    // marcadores
    if (d.loop.e > d.loop.s) {
      ctx.fillStyle = d.loop.on ? 'rgba(76,195,107,0.45)' : 'rgba(150,150,160,0.3)';
      ctx.fillRect((d.loop.s / d.duration) * w, 0, Math.max(2, ((d.loop.e - d.loop.s) / d.duration) * w), h);
    }
    d.track.cues.forEach((c) => { if (c) { ctx.fillStyle = c.color; ctx.fillRect((c.t / d.duration) * w, 0, 2, h); } });
    (d.track.cueLoops || []).forEach((c) => { if (c) { ctx.fillStyle = c.color; ctx.fillRect((c.t / d.duration) * w, h - 5, Math.max(3, ((c.le - c.t) / d.duration) * w), 5); } });
    // cambios de tempo del beatgrid: marca naranja abajo
    if (d.hasGridMarkers) {
      ctx.fillStyle = '#ff9a1f';
      for (const m of tempoChanges(d.track)) { const x = (m.t / d.duration) * w; ctx.beginPath(); ctx.moveTo(x - 4, h); ctx.lineTo(x + 4, h); ctx.lineTo(x, h - 6); ctx.fill(); }
    }
    // secciones de la IA: triángulos de color en la parte superior
    for (const sct of d.track.sections || []) {
      const x = (sct.t / d.duration) * w;
      ctx.fillStyle = SEC_COLORS[sct.type] || TC.muted;
      ctx.beginPath(); ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 6); ctx.fill();
    }
    // aviso de final de pista (últimos 30 s)
    const remain = d.duration - d.time;
    ctx.fillStyle = remain < 30 && d.playing && Math.floor(performance.now() / 400) % 2 ? '#f04848' : '#ffffff';
    ctx.fillRect(px - 1, 0, 2, h);
  }
}
