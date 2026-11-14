// Medición en un «PC lento» (encargo RENDIMIENTO2, equipo de Fran: Xeon E5-2640 v4, núcleos de 2016 a 2,4 GHz):
// la app de escritorio REAL (main.js), con datos en una carpeta temporal, simulando un procesador más lento con
// Emulation.setCPUThrottlingRate (×4, ×6…; solo frena el hilo principal de la interfaz, que es donde se dibuja la
// onda: el audio va en el AudioWorklet y el análisis en su worker, que no se frenan).
// - Biblioteca grande: 3.000 pistas sintéticas ya analizadas (no existen en disco; solo llenan la biblioteca).
// - 10 pistas reales (WAV de 5 a 7 min con clics a 120-129 BPM) que se analizan con el Deck 1 sonando a la vez.
// Escenarios por cada velocidad: reproducción normal a 60 fps, en «Modo rendimiento» (30 fps) y análisis de las
// 10 pistas sonando (a 60 y a 30 fps). En cada uno mide en el hilo principal:
// - tareas largas (PerformanceObserver «longtask»): número de más de 50, 100 y 200 ms y la máxima;
// - fps reales de la onda SUPERIOR del Deck 1 (redibujados de verdad de WaveDetail.draw) y el mayor tiempo sin
//   redibujarse; en el análisis, el tiempo total y el mayor hueco entre dos pistas terminadas;
// - de qué es cada tarea larga: marcas de tiempo alrededor de las funciones sospechosas (leer el archivo,
//   decodificar, mezcla a mono, guardar la biblioteca, refrescar la tabla…) y, con --profile, las funciones que
//   más CPU gastan durante el análisis (Profiler de las DevTools, tiempo propio).
// Uso: npx electron tools/perf-lento.cjs [--label antes] [--rates 4,6] [--secs 15] [--scenarios play60,play30,analyze60,analyze30]
//      [--profile] [--timeline] [--mp3]   (--mp3: las 10 pistas en MP3 con ffmpeg en lugar de WAV)
// Resultado: .revision/rendimiento2/perf-lento-<label>.json y una tabla en la consola.
'use strict';
const electron = require('electron');
const { app } = electron;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clickSamples } = require('./click-wav.cjs');

const root = path.join(__dirname, '..');
const OUT = path.join(root, '.revision', 'rendimiento2');
const pkg = require(path.join(root, 'package.json'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const LABEL = arg('label', 'medicion');
const RATES = String(arg('rates', '4,6')).split(',').map(Number).filter(x => x >= 1);
const SECS = Number(arg('secs', 15));
const SCENARIOS = String(arg('scenarios', 'play60,play30,analyze60,analyze30')).split(',');
const PROFILE = process.argv.includes('--profile');
const MP3 = process.argv.includes('--mp3');
const N_LIB = 3000, N_REAL = 10;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-lento-'));
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// --- audio: WAV PCM 16 bits estéreo (rápido: Int16Array en vez de writeInt16LE)
function wav(L, sr = 44100) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  const s = new Int16Array(buf.buffer, buf.byteOffset + 44, n * 2);
  for (let i = 0; i < n; i++) { const v = (Math.max(-1, Math.min(1, L[i])) * 32767) | 0; s[2 * i] = v; s[2 * i + 1] = v; }
  return buf;
}
const music = path.join(tmp, 'music');
fs.mkdirSync(music, { recursive: true });
const t0 = Date.now();
const real = [];
for (let i = 0; i < N_REAL; i++) {
  const secs = 300 + Math.round((i / (N_REAL - 1)) * 120), bpm = 120 + (i % 10);
  let p = path.join(music, `Real ${String(i + 1).padStart(2, '0')} - ${bpm} BPM.wav`);
  fs.writeFileSync(p, wav(clickSamples({ bpm, seconds: secs, firstBeat: 0.1 + i * 0.03 })));
  // --mp3: como la música de verdad (MP3 a 320 kbps con ffmpeg, que tiene que estar en el PATH)
  if (MP3) {
    const mp3 = p.replace(/\.wav$/, '.mp3');
    const r = require('child_process').spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', p, '-b:a', '320k', mp3]);
    if (r.status !== 0) throw new Error('ffmpeg no ha podido crear el MP3: ' + String(r.stderr || r.error));
    fs.unlinkSync(p); p = mp3;
  }
  real.push({ id: 'real' + i, path: p, secs, bpm });
}
const pPlay = path.join(music, 'Sonando 126.wav');
fs.writeFileSync(pPlay, wav(clickSamples({ bpm: 126, seconds: 480, firstBeat: 0.2 })));
console.log(`audio de prueba: ${N_REAL} pistas de 5-7 min + 1 de 8 min en ${Math.round((Date.now() - t0) / 1000)} s`);

// --- biblioteca: como la de un DJ con 3.000 pistas analizadas (secciones, curva de energía y cues automáticos)
const KEYS = ['1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A', '1B', '5B', '8B'];
const COLORS = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];
const base = (id, p, title, artist, extra) => ({
  id, path: p, source: 'local', title, artist, album: 'Álbum ' + (id.length * 7 % 200), genre: ['House', 'Techno', 'Pop', 'Disco'][id.length % 4], year: '2024', comment: '', rating: 0, isrc: '',
  bpm: null, firstBeat: 0, key: '', camelot: '', keyTonic: null, keyMinor: null, duration: 0, size: 9000000, rmsDb: null,
  cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null),
  added: 1700000000000, plays: 0, lastPlayed: 0, analyzed: false, bpmLocked: false, keyLocked: false, ...extra
});
const tracks = [base('play', pPlay, 'Sonando 126', 'Prueba'), ...real.map((r, i) => base(r.id, r.path, `Real ${i + 1}`, 'Prueba'))];
for (let i = 0; i < N_LIB; i++) {
  const bpm = 110 + (i % 30) + (i % 7) / 10, dur = 240 + (i % 180);
  const sec = [{ t: 0.1, type: 'intro', label: 'Intro' }, { t: 30.5, type: 'drop', label: 'Drop 1' }, { t: 95.2, type: 'break', label: 'Break 1' }, { t: 125.9, type: 'drop', label: 'Drop 2' }, { t: dur - 40, type: 'outro', label: 'Outro' }];
  const cues = Array(8).fill(null);
  sec.forEach((s, k) => { cues[k] = { t: s.t, color: COLORS[k], name: s.label, auto: true, autoV: 2 }; });
  tracks.push(base('f' + i, path.join(music, `relleno-${i}.mp3`), `Canción de relleno ${i}`, `Artista ${i % 300}`, {
    bpm, firstBeat: 0.12, camelot: KEYS[i % KEYS.length], key: 'Am', keyTonic: i % 12, keyMinor: true, duration: dur, analyzed: true, energy: 1 + (i % 10), rmsDb: -9.5,
    sections: sec, energyCurve: Array.from({ length: Math.round(dur / 15) }, (_, k) => Math.round(Math.abs(Math.sin(k + i)) * 100) / 100), energyV: 3, waveRate: 150, cues
  }));
}
const data = path.join(tmp, 'data');
fs.mkdirSync(path.join(data, 'waveforms'), { recursive: true });
const libJson = JSON.stringify({ version: 1, tracks, crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] });
fs.writeFileSync(path.join(data, 'library.json'), libJson);
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({
  welcomeDone: true, statsEnabled: false, autoUpdate: false, lastVersion: pkg.version, waveLayout: 'serato', libView: 'all',
  autoAnalyze: false, stemsBackground: false, stemsAuto: false, aiAutoCues: true
}));
process.env.NEXURA_USER_DATA = tmp;
process.env.NEXURA_NO_UPDATES = '1';
app.getVersion = () => pkg.version;

const errors = [];
let mainWin = null;
app.on('browser-window-created', (_e, win) => {
  if (mainWin) return; // la ventana oculta del analizador en segundo plano no se mide
  mainWin = win;
  win.webContents.on('console-message', (_ev, level, message, line, src) => { if (level >= 3) errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  win.webContents.once('did-finish-load', () => run(win).catch(e => { console.log('✗ la medición ha fallado:', e && e.stack || e); finish(1); }));
});
const js = (win, code) => win.webContents.executeJavaScript(code, true);
const r1 = (v) => Math.round(v * 10) / 10;

// Instrumentación en la interfaz (una vez): tareas largas, redibujados reales de la onda del Deck 1 y marcas de
// tiempo (parte síncrona) de las funciones sospechosas. __perf.reset() empieza un escenario y __perf.take() lo cierra.
const INSTRUMENT = `(() => {
  const A = nexuraApp, P = window.__perf = { longs: [], draws: [], marks: [], done: [], saves: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longs.push({ s: e.startTime, d: e.duration }); }).observe({ entryTypes: ['longtask'] });
  // el observador «longtask» no ve todo (respuestas de IPC grandes, callbacks del audio…): también se miden los
  // huecos entre frames del navegador (requestAnimationFrame), que es lo que se nota como «onda parada»
  P.raf = []; let lastRaf = 0;
  const rafLoop = (ts) => { if (lastRaf && ts - lastRaf > 50) P.raf.push({ s: lastRaf, d: ts - lastRaf }); lastRaf = ts; requestAnimationFrame(rafLoop); };
  requestAnimationFrame(rafLoop);
  const mark = (name, s) => { const d = performance.now() - s; if (d > 8) P.marks.push({ name, s, d }); };
  const wrap = (obj, key, name) => {
    if (!obj || typeof obj[key] !== 'function' || obj[key].__w) return;
    const orig = obj[key];
    const f = function (...a) {
      const s = performance.now();
      let r;
      try { r = orig.apply(this, a); } finally { mark(name, s); }
      if (r && typeof r.then === 'function') r.then(() => mark(name + ' (hasta terminar)', s), () => {});
      return r;
    };
    f.__w = true; obj[key] = f;
  };
  const w = A.waves[0], draw = w.draw;
  w.draw = function (...a) { const k = this.lastKey; const r = draw.apply(this, a); if (this.lastKey !== k) P.draws.push(performance.now()); return r; };
  wrap(A.platform, 'readFile', 'platform.readFile');
  wrap(A.platform, 'storeSet', 'platform.storeSet');
  wrap(A.platform, 'waveSet', 'platform.waveSet');
  wrap(A.engine.ctx, 'decodeAudioData', 'decodeAudioData');
  if (A.analyzer.constructor.mono) wrap(A.analyzer.constructor, 'mono', 'Analyzer.mono');
  wrap(A.analyzer, 'run', 'Analyzer.run');
  wrap(A.library, 'save', 'library.save');
  if (A.library.flush) wrap(A.library, 'flush', 'library.flush');
  wrap(A.libraryUI, 'refresh', 'libraryUI.refresh');
  wrap(A.libraryUI, 'renderRows', 'libraryUI.renderRows');
  wrap(A.libraryUI, 'renderSide', 'libraryUI.renderSide');
  wrap(A, 'applyAutoCues', 'app.applyAutoCues');
  wrap(A.ai, 'autoCues', 'ai.autoCues');
  wrap(A, 'render', 'app.render');
  const wm = A.analyzer.worker.onmessage;
  if (wm) A.analyzer.worker.onmessage = function (e) { const s = performance.now(); try { return wm.call(this, e); } finally { mark('worker.onmessage', s); } };
  const upd = A.library.update;
  A.library.update = function (id, patch) { if (patch && patch.analyzed) P.done.push(performance.now()); return upd.call(this, id, patch); };
  const ss = A.platform.storeSet;
  A.platform.storeSet = function (name, d) { if (name === 'library') P.saves++; return ss.call(this, name, d); };
  P.reset = () => { P.longs = []; P.raf = []; P.draws = []; P.marks = []; P.done = []; P.saves = 0; P.t0 = performance.now(); };
  P.take = () => {
    const t1 = performance.now(), L = P.longs.filter(x => x.s >= P.t0), R = P.raf.filter(x => x.s >= P.t0);
    const gaps = []; let prev = P.t0;
    for (const d of P.draws) { gaps.push(d - prev); prev = d; }
    gaps.push(t1 - prev);
    // causa de cada tarea larga: marcas que se solapan con ella (la que más tiempo cubre)
    const causes = {};
    for (const l of L) {
      const over = P.marks.filter(m => !/hasta terminar/.test(m.name) && m.s < l.s + l.d && m.s + m.d > l.s && m.name !== 'app.render')
        .map(m => ({ name: m.name, d: Math.min(m.s + m.d, l.s + l.d) - Math.max(m.s, l.s) }));
      const rnd = P.marks.find(m => m.name === 'app.render' && m.s < l.s + l.d && m.s + m.d > l.s);
      const top = over.sort((a, b) => b.d - a.d)[0];
      const k = top ? top.name : rnd ? 'app.render (dibujo)' : '(otra cosa: GC, IPC, maquetación…)';
      (causes[k] = causes[k] || { n: 0, max: 0, total: 0 });
      causes[k].n++; causes[k].max = Math.max(causes[k].max, l.d); causes[k].total += l.d;
    }
    const marks = {};
    for (const m of P.marks) { const x = marks[m.name] = marks[m.name] || { n: 0, max: 0, total: 0 }; x.n++; x.max = Math.max(x.max, m.d); x.total += m.d; }
    const doneGaps = []; prev = P.t0; for (const d of P.done) { doneGaps.push(d - prev); prev = d; }
    return {
      timeline: ${process.argv.includes('--timeline')} ? [...L.map(x => ({ k: 'LONG', s: Math.round(x.s - P.t0), d: Math.round(x.d) })), ...P.marks.filter(m => m.d > 40).map(m => ({ k: m.name, s: Math.round(m.s - P.t0), d: Math.round(m.d) })), ...gaps.map((g, i) => ({ g, i })).filter(x => x.g > 150).map(x => ({ k: 'HUECO', s: Math.round((P.draws[x.i - 1] || P.t0) - P.t0), d: Math.round(x.g) }))].sort((a, b) => a.s - b.s) : null,
      ms: t1 - P.t0, long: L.map(x => x.d), raf: R.map(x => x.d), draws: P.draws.length, gaps, causes, marks, done: P.done.length, doneGaps, saves: P.saves,
      playing: A.decks[0].playing, perfMode: !!A.settings.perfMode, diag: A.perfDiag ? A.perfDiag.snapshot() : null
    };
  };
  return true;
})()`;

function summarize(r) {
  const L = r.long, gaps = r.gaps;
  const sec = r.ms / 1000;
  return {
    segundos: r1(sec),
    tareasLargas: { n50: L.length, n100: L.filter(x => x > 100).length, n200: L.filter(x => x > 200).length, maxMs: Math.round(Math.max(0, ...L)), totalMs: Math.round(L.reduce((s, x) => s + x, 0)) },
    bloqueos: { n50: r.raf.length, n100: r.raf.filter(x => x > 100).length, n200: r.raf.filter(x => x > 200).length, maxMs: Math.round(Math.max(0, ...r.raf)) },
    onda: { fps: r1(r.draws / sec), maxSinDibujarMs: Math.round(Math.max(0, ...gaps)), huecosMas100: gaps.filter(g => g > 100).length, msEnHuecosMas100: Math.round(gaps.filter(g => g > 100).reduce((s, g) => s + g, 0)) },
    analisis: r.done ? { pistas: r.done, maxEntrePistasMs: Math.round(Math.max(0, ...r.doneGaps)), mediaPorPistaMs: Math.round(r.ms / r.done), guardadosBiblioteca: r.saves } : null,
    causas: Object.fromEntries(Object.entries(r.causes).sort((a, b) => b[1].total - a[1].total).map(([k, v]) => [k, { n: v.n, maxMs: Math.round(v.max), totalMs: Math.round(v.total) }])),
    marcas: Object.fromEntries(Object.entries(r.marks).sort((a, b) => b[1].max - a[1].max).slice(0, 14).map(([k, v]) => [k, { n: v.n, maxMs: Math.round(v.max), totalMs: Math.round(v.total) }])),
    sonando: r.playing, perfMode: r.perfMode, diag: r.diag, ...(r.timeline ? { timeline: r.timeline } : {})
  };
}

// Funciones con más tiempo propio en un perfil de CPU de las DevTools
function topSelf(profile, n = 25) {
  const byId = new Map(profile.nodes.map(x => [x.id, x]));
  const self = new Map();
  const dt = profile.timeDeltas || [];
  (profile.samples || []).forEach((id, i) => { self.set(id, (self.get(id) || 0) + (dt[i] || 0)); });
  const agg = {};
  for (const [id, us] of self) {
    const cf = byId.get(id).callFrame;
    const k = `${cf.functionName || '(anónima)'} ${cf.url ? path.basename(cf.url) + ':' + (cf.lineNumber + 1) : ''}`.trim();
    agg[k] = (agg[k] || 0) + us;
  }
  const tot = Object.values(agg).reduce((s, x) => s + x, 0) || 1;
  return Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => ({ fn: k, ms: Math.round(us / 1000), pct: r1((us / tot) * 100) }));
}

async function run(win) {
  win.setContentSize(1600, 900);
  let ready = false;
  for (let i = 0; i < 600 && !ready; i++) { ready = await js(win, `!!(window.nexuraApp && nexuraApp.libraryUI && nexuraApp.libraryUI.rows && nexuraApp.libraryUI.rows.length > 1000 && nexuraApp.updatesUI)`).catch(() => false); if (!ready) await wait(50); }
  if (!ready) throw new Error('la app no ha arrancado');
  await wait(800);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); nexuraApp.engine.resume(); nexuraApp.engine.setMaster(0); true`);
  // Deck 1: pista de 8 min cargada (y analizada) y sonando en todos los escenarios
  await js(win, `nexuraApp.loadToDeck('play', 0)`);
  await js(win, `(async () => { const d = nexuraApp.decks[0]; for (let i = 0; i < 400 && !(d.track && d.track.analyzed); i++) await new Promise(r => setTimeout(r, 50)); d.play(); return d.playing; })()`);
  await js(win, INSTRUMENT);
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  const gpu = app.getGPUFeatureStatus();
  const res = {
    label: LABEL, version: pkg.version, date: new Date().toISOString(), machine: `${os.cpus()[0].model.trim()} · ${os.cpus().length} hilos · ${Math.round(os.totalmem() / 1e9)} GB`,
    gpu: { compositing: gpu.gpu_compositing, canvas2d: gpu['2d_canvas'] }, library: { tracks: N_LIB + N_REAL + 1, jsonMB: r1(libJson.length / 1048576) }, rates: {}
  };
  for (const rate of RATES) {
    await dbg.sendCommand('Emulation.setCPUThrottlingRate', { rate });
    res.rates['x' + rate] = {};
    for (const sc of SCENARIOS) {
      const perf = /30$/.test(sc);
      await js(win, `(() => { const A = nexuraApp; A.setSetting('perfMode', ${perf}); A.decks[0].seek(5); if (!A.decks[0].playing) A.decks[0].play(); return true; })()`);
      await wait(1500);
      let prof = null;
      if (/^analyze/.test(sc)) {
        // las 10 pistas vuelven a estar sin analizar (y sin forma de onda en memoria)
        await js(win, `(() => { const A = nexuraApp; for (let i = 0; i < ${N_REAL}; i++) { A.library.update('real' + i, { analyzed: false }); A.analyzer.waves.delete('real' + i); } return true; })()`);
        await wait(1200);
        if (PROFILE && rate === RATES[0] && sc === 'analyze60') { await dbg.sendCommand('Profiler.enable'); await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 500 }); await dbg.sendCommand('Profiler.start'); prof = true; }
        await js(win, `__perf.reset(); true`);
        const tA = Date.now();
        await js(win, `(async () => { const A = nexuraApp; await A.analyzeMany([...Array(${N_REAL}).keys()].map(i => A.library.get('real' + i))); return true; })()`);
        if (Date.now() - tA < 2000) await wait(2000);
      } else {
        await js(win, `__perf.reset(); true`);
        await wait(SECS * 1000);
      }
      const r = await js(win, `__perf.take()`);
      const s = summarize(r);
      if (prof) { const { profile } = await dbg.sendCommand('Profiler.stop'); s.perfilCPU = topSelf(profile); await dbg.sendCommand('Profiler.disable'); }
      res.rates['x' + rate][sc] = s;
      const t = s.tareasLargas, o = s.onda, b = s.bloqueos;
      console.log(`×${rate} ${sc.padEnd(10)} tareas largas ${t.n50} (>100: ${t.n100}, >200: ${t.n200}, máx ${t.maxMs} ms) · frames del navegador >100 ms: ${b.n100} (máx ${b.maxMs} ms) · onda ${o.fps} fps, máx ${o.maxSinDibujarMs} ms sin dibujar (${o.huecosMas100} huecos >100 ms)` +
        (s.analisis ? ` · análisis ${s.analisis.pistas} pistas en ${s.segundos} s (máx ${s.analisis.maxEntrePistasMs} ms entre pistas, ${s.analisis.guardadosBiblioteca} guardados)` : ''));
      const top = Object.entries(s.causas).slice(0, 5).map(([k, v]) => `${k} ${v.n}× máx ${v.maxMs}`).join(' · ');
      if (top) console.log(`     causas: ${top}`);
    }
  }
  await dbg.sendCommand('Emulation.setCPUThrottlingRate', { rate: 1 });
  dbg.detach();
  res.errors = errors.filter(e => !/favicon|relleno-/.test(e));
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `perf-lento-${LABEL}.json`);
  fs.writeFileSync(file, JSON.stringify(res, null, 2));
  if (res.errors.length) console.log('errores en consola:', res.errors.slice(0, 6).join(' | '));
  console.log(`informe en ${path.relative(root, file)}`);
  finish(0);
}

function finish(code) {
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* en uso */ } app.exit(code); }, 300);
}

require(path.join(root, 'main.js'));
