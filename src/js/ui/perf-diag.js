// Diagnóstico de rendimiento y vigilante de la forma de onda (encargo RENDIMIENTO2).
// - Mide, en bloques de 10 s de los últimos 5 min: fps reales de la onda (frames en los que se ha redibujado
//   alguna forma de onda de detalle), tareas largas del hilo principal (PerformanceObserver «longtask») y
//   bloqueos (huecos de más de 100 ms entre frames del navegador, que también ven lo que «longtask» no ve).
// - Vigilante: si la onda lleva más de 2 s sin redibujarse con un deck sonando y la ventana visible, lo anota en
//   el registro y en el diagnóstico. Si el hilo estaba libre (el navegador no entregaba frames: típico de un
//   cuelgue de la GPU) y la aceleración por GPU está activa, avisa una vez por sesión de que se puede desactivar.
// - snapshot(): lo que va en el informe de errores (ui/feedback.js → main/report.js), sin datos personales.
import { toast } from '../util.js';

const BUCKET_MS = 10000, BUCKETS = 30, STALL_MS = 100, FREEZE_MS = 2000;

export class PerfDiag {
  constructor(app) {
    this.app = app;
    this.buckets = [];
    this.cur = this.newBucket(performance.now());
    this.freezes = [];
    this.lastTick = 0; this.frameNo = 0; this.countedFrame = -1;
    this.lastDraw = performance.now(); this.waveShown = false; this.seenThisFrame = false;
    this.open = null; this.warned = false; this.lastCheck = performance.now(); this.lastStallLog = 0;
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) { this.cur.longN++; this.cur.longMax = Math.max(this.cur.longMax, e.duration); } })
        .observe({ entryTypes: ['longtask'] });
    } catch (_) { /* navegador sin longtask */ }
    this.timer = setInterval(() => this.check(), 500);
  }
  newBucket(t) { return { t, ms: 0, draws: 0, playMs: 0, playDraws: 0, longN: 0, longMax: 0, stallN: 0, stallMax: 0 }; }
  get playing() { return this.app.decks?.some((d, i) => i < this.app.deckCount && d.playing && d.track); }

  // Cada callback de requestAnimationFrame del bucle principal (app.frame)
  tick(ts) {
    const dt = this.lastTick ? ts - this.lastTick : 0;
    this.lastTick = ts; this.frameNo++;
    if (dt > STALL_MS && document.visibilityState === 'visible') {
      this.cur.stallN++; this.cur.stallMax = Math.max(this.cur.stallMax, dt);
      if (dt > 1000 && ts - this.lastStallLog > 60000) { this.lastStallLog = ts; this.app.feedback?.log('WARN', 'rendimiento', `La interfaz ha estado ${Math.round(dt)} ms sin dibujar`); }
    }
    if (dt > 0 && dt < 1000) { this.cur.ms += dt; if (this.playing) this.cur.playMs += dt; }
    if (ts - this.cur.t >= BUCKET_MS) { this.buckets.push(this.cur); if (this.buckets.length > BUCKETS) this.buckets.shift(); this.cur = this.newBucket(ts); }
  }
  // Antes y después de dibujar un frame (app.render)
  beginFrame() { this.seenThisFrame = false; }
  endFrame() { this.waveShown = this.seenThisFrame; }
  // Desde WaveDetail.draw: la onda se ve (aunque no cambie) y se ha redibujado de verdad
  waveSeen() { this.seenThisFrame = true; }
  waveDrawn() {
    const now = performance.now();
    this.lastDraw = now;
    if (this.countedFrame !== this.frameNo) { this.countedFrame = this.frameNo; this.cur.draws++; if (this.playing) this.cur.playDraws++; }
    if (this.open) this.closeFreeze(now);
  }

  get gpuActive() { const g = this.app.info?.gpu; return !!(g && g.canvas2d && !this.app.info.gpuOff); }
  check() {
    const now = performance.now(), late = now - this.lastCheck - 500;
    this.lastCheck = now;
    if (this.open || !this.waveShown || !this.playing || document.visibilityState !== 'visible') return;
    const gap = now - this.lastDraw;
    if (gap < FREEZE_MS) return;
    // el propio vigilante llegaba tarde → el hilo principal estaba ocupado; si no, el navegador no entregaba frames
    this.open = { start: this.lastDraw, kind: late > 1000 ? 'hilo' : 'gpu', gpu: this.gpuActive };
    if (this.open.kind === 'gpu' && this.open.gpu && !this.warned) {
      this.warned = true;
      toast('La forma de onda se ha congelado. Si te pasa a menudo, prueba a desactivar la aceleración por GPU en Ajustes → Audio → Rendimiento.', 'warn', 15000,
        { label: 'Abrir Ajustes', fn: () => this.app.settingsUI?.open('audio') });
    }
  }
  closeFreeze(now) {
    const f = { at: Date.now(), ms: Math.round(now - this.open.start), kind: this.open.kind, gpu: this.open.gpu };
    this.open = null;
    this.freezes.push(f);
    if (this.freezes.length > 20) this.freezes.shift();
    this.app.feedback?.log('WARN', 'rendimiento', `Forma de onda congelada ${f.ms} ms con un deck sonando (${f.kind === 'gpu' ? 'el hilo estaba libre: frames sin entregar' : 'hilo principal ocupado'}; GPU ${f.gpu ? 'activa' : 'desactivada'})`);
  }

  snapshot() {
    const all = [...this.buckets, this.cur];
    const sum = (k) => all.reduce((s, b) => s + b[k], 0), max = (k) => all.reduce((m, b) => Math.max(m, b[k]), 0);
    const ms = sum('ms'), playMs = sum('playMs');
    const open = this.open ? [{ at: Date.now(), ms: Math.round(performance.now() - this.open.start), kind: this.open.kind, gpu: this.open.gpu }] : [];
    const s = this.app.settings || {};
    return {
      tracks: this.app.library ? this.app.library.tracks.size : 0, perfMode: !!s.perfMode, fpsTarget: s.perfMode ? 30 : 60, layout: this.app.waveLayout || '',
      windowMin: Math.round(ms / 6000) / 10, fps: ms ? Math.round(sum('draws') / (ms / 1000) * 10) / 10 : 0, fpsPlaying: playMs ? Math.round(sum('playDraws') / (playMs / 1000) * 10) / 10 : 0,
      longTasks: sum('longN'), longMaxMs: Math.round(max('longMax')), stalls: sum('stallN'), stallMaxMs: Math.round(max('stallMax')),
      freezes: [...this.freezes, ...open].map(f => ({ minAgo: Math.round((Date.now() - f.at) / 6000) / 10, ms: f.ms, kind: f.kind, gpu: f.gpu }))
    };
  }
}
