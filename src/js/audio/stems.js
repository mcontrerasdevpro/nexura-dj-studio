// Stems: separación con Demucs (proceso de escritorio) y carga en el deck.
// Los 4 stems se guardan en FLAC (16 bits) por pista; al cargarlos se alinean con el audio
// original (correlación) y se pasan al worklet en Int16 para ahorrar memoria.
import { platform } from '../platform.js';
import { Emitter, $, toast } from '../util.js';

// Orden en la interfaz y en el worklet
export const STEMS = [
  { key: 'vocals', name: 'Voz', short: 'VOZ', color: '#ff4fa8' },
  { key: 'drums', name: 'Batería', short: 'BAT', color: '#ffa31a' },
  { key: 'bass', name: 'Bajo', short: 'BAJO', color: '#2ee06a' },
  { key: 'other', name: 'Melodía', short: 'MEL', color: '#1ee0ff' }
];
export const STEM_PRESETS = {
  acapella: { name: 'Acapella', gains: [1, 0, 0, 0] },
  instrumental: { name: 'Instrumental', gains: [0, 1, 1, 1] },
  drums: { name: 'Solo batería', gains: [0, 1, 0, 0] },
  all: { name: 'Todos', gains: [1, 1, 1, 1] }
};

// Desfase entre el original y la suma de stems: devuelve lag tal que b[i + P + lag] ≈ a[i],
// donde b es la suma de stems tomada desde P muestras antes que a (b.length ≥ a.length + 2P).
export function findLag(a, b, P = 4096) {
  // primera diferencia (realza transitorios): evita falsos picos con notas sostenidas y graves periódicos
  const diff = (x) => { const y = new Float32Array(x.length); for (let i = 1; i < x.length; i++) y[i] = x[i] - x[i - 1]; return y; };
  const n = a.length, D = 4, m = Math.floor(n / D), mb = Math.floor(b.length / D);
  let da = new Float32Array(m), db = new Float32Array(mb);
  for (let i = 0; i < m; i++) { let x = 0; for (let k = 0; k < D; k++) x += a[i * D + k]; da[i] = x; }
  for (let i = 0; i < mb; i++) { let y = 0; for (let k = 0; k < D; k++) y += b[i * D + k]; db[i] = y; }
  da = diff(da); db = diff(db);
  const pp = Math.floor(P / D);
  let best = 0, bestV = -Infinity;
  for (let lag = -pp; lag <= pp; lag++) {
    let s = 0; const o = pp + lag;
    for (let i = 0; i < m; i += 2) s += da[i] * db[i + o];
    if (s > bestV) { bestV = s; best = lag * D; }
  }
  const fa = diff(a), fb = diff(b);
  let fine = best, fineV = -Infinity;
  for (let lag = Math.max(-P, best - D); lag <= Math.min(P, best + D); lag++) {
    let s = 0; const o = P + lag;
    for (let i = 0; i < n; i++) s += fa[i] * fb[i + o];
    if (s > fineV) { fineV = s; fine = lag; }
  }
  return fine;
}

const toInt16 = (f, lag, len) => {
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const v = f[i + lag];
    out[i] = v === undefined ? 0 : (v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767));
  }
  return out;
};

export class StemsManager extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    this.busy = false;
    this.info = null;
    this.bgQueue = [];      // ids pendientes de separar en segundo plano (por orden)
    this.bgRunning = false;
    platform.stems.onEvent((ev) => this.onEvent(ev));
  }

  // ---------------------------------------------------------------- segundo plano
  // Con el motor instalado separa sin preguntar las pistas de Prepare y las cargadas en los decks,
  // de tres en tres, para que estén listas antes de pincharlas. Nunca instala el motor por su cuenta.
  get bgEnabled() { return this.available && this.app.settings.stemsBackground !== false; }
  enqueue(tracks, front = false) {
    const ids = tracks.filter(t => t && t.source === 'local' && !t.stems).map(t => t.id).filter(id => !this.bgQueue.includes(id));
    if (!ids.length) return 0;
    this.bgQueue = front ? [...ids, ...this.bgQueue] : [...this.bgQueue, ...ids];
    this.pumpSoon();
    return ids.length;
  }
  syncBackground() {
    if (!this.bgEnabled) return;
    const L = this.app.library;
    const decks = this.app.decks.filter(d => d.track && !d.isYT).map(d => d.track);
    this.enqueue(decks, true);
    this.enqueue(L.prepare.map(id => L.get(id)));
  }
  pumpSoon() { clearTimeout(this._pumpT); this._pumpT = setTimeout(() => this.pump(), 1500); }
  async pump() {
    if (!this.bgEnabled || this.busy || !this.bgQueue.length) return;
    // rc.10: separar stems es lo más pesado de la app; en plena sesión en directo (o con el audio al límite) espera
    if (this.app.live?.holdBackground()) { clearTimeout(this._pumpT); this._pumpT = setTimeout(() => this.pump(), 10000); return; }
    if (!this.info) await this.getInfo().catch(() => null);
    if (!this.info || !this.info.installed) return;
    const L = this.app.library;
    this.bgQueue = this.bgQueue.filter(id => { const t = L.get(id); return t && !t.stems && t.source === 'local'; });
    const batch = this.bgQueue.slice(0, 3).map(id => L.get(id));
    if (!batch.length) return;
    this.bgRunning = true;
    try { await this.separate(batch, false, { quiet: true }); }
    finally {
      this.bgRunning = false;
      const done = new Set(batch.map(t => t.id));
      this.bgQueue = this.bgQueue.filter(id => !done.has(id));
      this.emit('busy', false);
      if (this.bgQueue.length) this.pumpSoon();
    }
  }
  get dir() { return this.app.settings.stemsDir || ''; }
  get available() { return platform.stems.available; }

  async getInfo() { this.info = await platform.stems.info(this.dir); return this.info; }

  // Marca en la biblioteca qué pistas tienen stems ya separados
  async refreshStatus(tracks = [...this.app.library.tracks.values()]) {
    if (!this.available) return;
    const ids = tracks.filter(t => t.source === 'local').map(t => t.id);
    if (!ids.length) return;
    const st = await platform.stems.status(ids, this.dir);
    for (const [id, has] of Object.entries(st)) {
      const t = this.app.library.get(id);
      if (t && !!t.stems !== has) this.app.library.update(id, { stems: has });
    }
  }

  onEvent(ev) {
    const st = $('#lib-status');
    if (ev.ev === 'log' && this.installing) { if (st) st.textContent = 'Instalando motor de stems: ' + ev.text.slice(0, 120); }
    else if (ev.ev === 'start') { this.device = ev.device; if (st) st.textContent = `Stems: cargando modelo en ${ev.device === 'cuda' ? 'GPU (' + ev.gpu + ')' : 'CPU'}…`; }
    else if (ev.ev === 'model') { if (st) st.textContent = 'Stems: modelo listo, separando…'; }
    else if (ev.ev === 'done') {
      this.app.library.update(ev.id, { stems: true });
      const t = this.app.library.get(ev.id);
      if (st) st.textContent = `${this.quiet ? 'Stems en segundo plano' : 'Stems'} ${ev.i + 1}/${this.total}: «${t ? t.title : ev.id}» en ${ev.secs} s`;
      // si la pista está cargada en un deck, activar sus stems al momento
      this.app.decks.forEach(d => { if (d.track && d.track.id === ev.id) this.loadForDeck(d).catch(() => {}); });
    } else if (ev.ev === 'error') {
      const t = this.app.library.get(ev.id);
      toast(`No se pudieron separar los stems de «${t ? t.title : ev.id}»: ${ev.error}`, 'error', 8000);
    }
    this.emit('event', ev);
  }

  async install() {
    if (!this.available) return toast('Los stems solo funcionan en la app de escritorio', 'warn');
    const ok = await this.app.confirm('Instalar el motor de stems (Demucs de Meta, licencia MIT). Descarga Python 3.11, PyTorch con CUDA y Demucs (unos 3 GB) y tarda varios minutos la primera vez. ¿Continuar?');
    if (!ok) return false;
    this.installing = true;
    const st = $('#lib-status');
    toast('Instalando el motor de stems… puedes seguir usando la app', 'info', 5000);
    try {
      const r = await platform.stems.install();
      if (r.ok) toast('Motor de stems instalado. Ya puedes separar pistas.', 'ok', 6000);
      else toast('La instalación del motor de stems falló' + (r.error ? ': ' + r.error : ` (código ${r.code})`) + '. Revisa que uv esté instalado.', 'error', 10000);
      return r.ok;
    } finally { this.installing = false; if (st) st.textContent = ''; }
  }

  // Separa las pistas indicadas (solo locales y sin stems, salvo force)
  async separate(tracks, force = false, { quiet = false } = {}) {
    if (!this.available) return toast('Los stems solo funcionan en la app de escritorio', 'warn');
    if (this.busy) {
      // si lo que está en marcha es la cola de segundo plano, la petición pasa la primera
      if (this.bgRunning && !force) { const n = this.enqueue(tracks, true); return toast(n ? 'En cola: se separará en cuanto termine la pista actual' : 'Esas pistas ya tienen stems o están en cola', 'info'); }
      return toast('Ya hay una separación de stems en marcha', 'warn');
    }
    const list = tracks.filter(t => t.source === 'local' && (force || !t.stems));
    if (!list.length) return toast(tracks.some(t => t.source === 'youtube') ? 'Los stems no están disponibles para vídeos de YouTube' : 'Esas pistas ya tienen stems', 'info');
    const info = await this.getInfo();
    if (!info.installed) {
      const done = await this.install();
      if (!done) return;
    }
    this.busy = true; this.total = list.length; this.quiet = quiet;
    this.emit('busy', true);
    const st = $('#lib-status');
    if (st) st.textContent = quiet ? `Stems en segundo plano: ${list.length} pista(s) (quedan ${this.bgQueue.length})…` : `Stems: preparando ${list.length} pista(s)…`;
    const t0 = performance.now();
    try {
      const r = await platform.stems.separate(list.map(t => ({ id: t.id, path: t.path })), this.dir, this.app.settings.stemsModel || 'htdemucs');
      const secs = Math.round((performance.now() - t0) / 1000);
      if (r.done.length && !quiet) toast(`Stems listos: ${r.done.length} pista(s) en ${secs} s${this.device === 'cpu' ? ' (CPU: sin GPU es mucho más lento)' : ''}`, 'ok', 6000);
      if (!r.done.length && r.error) toast('Error al separar stems: ' + r.error, 'error', 10000);
      return r;
    } catch (e) {
      toast('Error al separar stems: ' + e.message, 'error', 8000);
    } finally {
      this.busy = false; this.quiet = false; this.emit('busy', false);
      if (st) st.textContent = '';
      if (!this.bgRunning && this.bgQueue.length) this.pumpSoon();
    }
  }

  async remove(tracks) {
    for (const t of tracks) { await platform.stems.remove(t.id, this.dir); this.app.library.update(t.id, { stems: false }); }
    this.app.decks.forEach(d => { if (d.track && tracks.includes(d.track)) d.clearStems(); });
  }

  // Lee, decodifica, alinea y envía los stems al deck
  async loadForDeck(deck) {
    const t = deck.track;
    if (!t || deck.isYT || !this.available) return false;
    const orig = this.app.bufferCache.get(t.id);
    const files = await platform.stems.read(t.id, this.dir);
    if (deck.track !== t) return false;
    const ctx = this.app.engine.ctx;
    const len = orig ? orig.length : 0;
    const decoded = [];
    for (const s of STEMS) {
      const u8 = files[s.key];
      decoded.push(await ctx.decodeAudioData(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)));
    }
    if (deck.track !== t) return false;
    const L = len || decoded[0].length;
    // alineación con el original: 3 s desde el 30 % de la pista
    let lag = 0;
    if (orig) {
      const P = 4096, seg = Math.min(ctx.sampleRate * 3, Math.floor(L * 0.4));
      const off = Math.max(P, Math.floor(L * 0.3));
      const a = orig.getChannelData(0).subarray(off, off + seg);
      const b = new Float32Array(seg + 2 * P);
      for (const d of decoded) { const c = d.getChannelData(0); for (let i = 0; i < b.length; i++) { const v = c[off - P + i]; if (v !== undefined) b[i] += v; } }
      lag = findLag(a, b, P);
      if (Math.abs(lag) >= P) lag = 0;
    }
    const stems = decoded.map(b => ({
      L: toInt16(b.getChannelData(0), lag, L),
      R: toInt16(b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0), lag, L)
    }));
    if (deck.track !== t) return false;
    deck.setStems(stems, lag);
    return true;
  }
}
