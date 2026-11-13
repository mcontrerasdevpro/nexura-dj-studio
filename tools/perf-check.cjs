// Medición de rendimiento reproducible en la app de escritorio REAL (main.js) con datos en una carpeta temporal:
// biblioteca de 4.000 pistas, dos pistas WAV de clics (124 y 128 BPM, 3 min) cargadas y sonando a la vez
// (Deck 2 con SYNC) y el volumen master a 0 para no hacer ruido. Mide, con la onda SUPERIOR y EN DECK:
// - CPU del proceso de la interfaz (renderer), del principal, de la GPU y del servicio de audio
//   (app.getAppMetrics da «percentCPUUsage» en % del equipo entero —16 hilos = 100 %—; se muestra también
//   en % de un núcleo, que es lo que se ve en un equipo con menos núcleos);
// - FPS y tiempo de frame (p50/p95/máx.: desde el inicio del frame hasta después de pintar) y tiempo del
//   bucle de la app (`app.frame`) por frame;
// - memoria (conjunto de trabajo de cada proceso y montón de JS de la interfaz);
// - arranque (hasta que la interfaz está lista), carga de pista (leer + decodificar + enviar al deck) y
//   análisis; latencia de audio (base + salida) y estado de la aceleración por GPU.
// Uso: npx electron tools/perf-check.cjs [--label antes] [--secs 10] [--perf-mode]
// Resultado: .revision/fix-feedback/perf-<label>.json y una tabla en la consola.
'use strict';
const T_START = Date.now();
const electron = require('electron');
const { app } = electron;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clickWav } = require('./click-wav.cjs');

const root = path.join(__dirname, '..');
const OUT = path.join(root, '.revision', 'fix-feedback');
const pkg = require(path.join(root, 'package.json'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const LABEL = arg('label', 'medicion');
const SECS = Number(arg('secs', 10));
const PERF_MODE = process.argv.includes('--perf-mode');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-perf-'));
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// --- datos: 2 pistas reales + 3.998 de relleno (no existen en disco: no se cargan, solo llenan la tabla)
const music = path.join(tmp, 'music');
fs.mkdirSync(music, { recursive: true });
const pA = path.join(music, 'Clic 124.wav'), pB = path.join(music, 'Clic 128.wav');
fs.writeFileSync(pA, clickWav({ bpm: 124, seconds: 180, firstBeat: 0.1 }));
fs.writeFileSync(pB, clickWav({ bpm: 128, seconds: 180, firstBeat: 0.25 }));
const base = (id, p, title, artist, extra) => ({
  id, path: p, source: 'local', title, artist, album: 'Álbum', genre: ['House', 'Techno', 'Pop', 'Disco'][id.length % 4], year: '2024', comment: '',
  rating: 0, bpm: 0, firstBeat: 0, key: '', camelot: '', duration: 180, size: 1000, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null),
  added: 1700000000000, plays: 0, lastPlayed: 0, analyzed: false, ...extra
});
const tracks = [base('clic124', pA, 'Clic 124', 'Prueba'), base('clic128', pB, 'Clic 128', 'Prueba')];
const KEYS = ['1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A', '1B', '5B', '8B'];
for (let i = 0; i < 3998; i++) {
  tracks.push(base('f' + i, path.join(music, `relleno-${i}.mp3`), `Canción de relleno ${i}`, `Artista ${i % 300}`,
    { bpm: 110 + (i % 30), firstBeat: 0.1, camelot: KEYS[i % KEYS.length], key: '', analyzed: true, energy: 1 + (i % 10), rmsDb: -10, sections: [] }));
}
const data = path.join(tmp, 'data');
fs.mkdirSync(path.join(data, 'waveforms'), { recursive: true });
fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify({ version: 1, tracks, crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] }));
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({
  welcomeDone: true, statsEnabled: false, autoUpdate: false, lastVersion: pkg.version, waveLayout: 'serato', libView: 'all',
  autoAnalyze: false, stemsBackground: false, stemsAuto: false, ...(PERF_MODE ? { perfMode: true } : {})
}));
process.env.NEXURA_USER_DATA = tmp;
process.env.NEXURA_NO_UPDATES = '1';
app.getVersion = () => pkg.version;

const errors = [];
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message, line, src) => { if (level >= 3) errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  win.webContents.once('did-finish-load', () => run(win).catch(e => { console.log('✗ la medición ha fallado:', e && e.stack || e); finish(1); }));
});
const js = (win, code) => win.webContents.executeJavaScript(code, true);

const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const r1 = (v) => Math.round(v * 10) / 10;

// En la interfaz, por cada frame que dibuja la app (`app.render` si existe; si no, `app.frame`, que antes dibujaba
// en cada refresco de la pantalla): FPS de dibujo, intervalo entre frames, tiempo de frame (desde que empieza
// a dibujar hasta después de pintar: un mensaje que el navegador atiende cuando ha terminado el frame) y
// tiempo del bucle de la app
const MEASURE = (ms) => `(async () => {
  const A = nexuraApp, iv = [], cost = [], work = [];
  let last = 0, longTasks = 0;
  const ch = new MessageChannel();
  ch.port1.onmessage = (e) => { cost.push(performance.now() - e.data); };
  const po = new PerformanceObserver((l) => { longTasks += l.getEntries().length; });
  try { po.observe({ entryTypes: ['longtask'] }); } catch (_) {}
  const key = typeof A.render === 'function' ? 'render' : 'frame', orig = A[key];
  A[key] = function (...a) {
    const s = performance.now(); orig.apply(this, a); work.push(performance.now() - s);
    if (last) iv.push(s - last); last = s; ch.port2.postMessage(s);
  };
  await new Promise(r => setTimeout(r, ${ms}));
  A[key] = orig; po.disconnect();
  const heap = performance.memory ? performance.memory.usedJSHeapSize : 0;
  return { iv, cost, work, longTasks, heap, playing: A.decks.slice(0, 2).map(d => d.playing), layout: A.waveLayout };
})()`;

function metrics(win) {
  const rpid = win.webContents.getOSProcessId();
  const m = app.getAppMetrics();
  const by = (f) => m.filter(f);
  const sum = (list, k) => list.reduce((s, x) => s + (k === 'cpu' ? x.cpu.percentCPUUsage : x.memory.workingSetSize / 1024), 0);
  const ren = by(x => x.pid === rpid), main = by(x => x.type === 'Browser'), gpu = by(x => x.type === 'GPU');
  const audio = by(x => x.type === 'Utility' && /audio/i.test(x.name || x.serviceName || ''));
  return {
    cpu: { renderer: sum(ren, 'cpu'), main: sum(main, 'cpu'), gpu: sum(gpu, 'cpu'), audio: sum(audio, 'cpu') },
    memMB: { renderer: sum(ren, 'mem'), main: sum(main, 'mem'), gpu: sum(gpu, 'mem'), audio: sum(audio, 'mem'), total: sum(m, 'mem') }
  };
}

async function run(win) {
  const tLoaded = Date.now();
  win.setContentSize(1600, 900);
  // arranque: hasta que la app está lista (biblioteca cargada y tabla dibujada)
  let ready = false;
  for (let i = 0; i < 600 && !ready; i++) { ready = await js(win, `!!(window.nexuraApp && nexuraApp.libraryUI && nexuraApp.libraryUI.rows && nexuraApp.libraryUI.rows.length > 1000 && nexuraApp.updatesUI)`).catch(() => false); if (!ready) await wait(50); }
  const tReady = Date.now();
  await wait(800);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); nexuraApp.engine.resume(); nexuraApp.engine.setMaster(0); true`);
  // carga de pista: leer + decodificar + enviar al worklet (sin el análisis, que va aparte en un worker)
  const loads = await js(win, `(async () => {
    const A = nexuraApp, out = {};
    for (const [id, i] of [['clic124', 0], ['clic128', 1]]) {
      const t0 = performance.now();
      const p = A.loadToDeck(id, i);
      while (A.decks[i].track?.id !== id) await new Promise(r => setTimeout(r, 5));
      out['carga_' + i] = performance.now() - t0;
      await p;
      out['carga_y_analisis_' + i] = performance.now() - t0;
    }
    return out;
  })()`);
  await js(win, `(() => { const A = nexuraApp; A.decks[0].play(); A.decks[1].setSync(true); A.decks[1].play(); return true; })()`);
  await wait(1500);
  const info = await js(win, `({ started: !!nexuraApp.updatesUI, midi: nexuraApp.midi && nexuraApp.midi.status, base: nexuraApp.engine.ctx.baseLatency, out: nexuraApp.engine.ctx.outputLatency, sr: nexuraApp.engine.ctx.sampleRate, latency: nexuraApp.settings.latency, dpr: devicePixelRatio, size: [innerWidth, innerHeight],
    canvases: [...document.querySelectorAll('canvas')].filter(c => c.offsetParent).map(c => [c.className || c.id, c.width, c.height]) })`);
  const res = { label: LABEL, version: pkg.version, date: new Date().toISOString(), perfMode: PERF_MODE, machine: `${os.cpus()[0].model.trim()} · ${os.cpus().length} hilos · ${Math.round(os.totalmem() / 1e9)} GB`,
    gpu: app.getGPUFeatureStatus(), audio: { latencyMs: r1(((info.base || 0) + (info.out || 0)) * 1000), baseMs: r1((info.base || 0) * 1000), outputMs: r1((info.out || 0) * 1000), sampleRate: info.sr, setting: info.latency },
    appStarted: info.started, midi: info.midi, startup: { ventanaMs: tLoaded - T_START, listaMs: tReady - T_START }, loads: Object.fromEntries(Object.entries(loads).map(([k, v]) => [k, Math.round(v)])), screen: { size: info.size, dpr: info.dpr }, layouts: {} };
  const cores = os.cpus().length;
  for (const layout of ['serato', 'deck']) {
    await js(win, `nexuraApp.setWaveLayout(${JSON.stringify(layout)}, false); true`);
    await wait(1500);
    metrics(win); // reinicia los contadores de CPU
    const r = await js(win, MEASURE(SECS * 1000));
    const m = metrics(win);
    const canv = await js(win, `[...document.querySelectorAll('canvas')].filter(c => c.offsetParent).map(c => [c.className || c.id, c.width, c.height])`);
    res.layouts[layout === 'serato' ? 'SUPERIOR' : 'EN DECK'] = {
      sonando: r.playing,
      fps: r1(r.iv.length / (r.iv.reduce((s, x) => s + x, 0) / 1000)),
      intervaloMs: { p50: r1(pct(r.iv, 0.5)), p95: r1(pct(r.iv, 0.95)), max: r1(Math.max(...r.iv)) },
      frameMs: { p50: r1(pct(r.cost, 0.5)), p95: r1(pct(r.cost, 0.95)), max: r1(Math.max(...r.cost)) },
      bucleAppMs: { p50: r1(pct(r.work, 0.5)), p95: r1(pct(r.work, 0.95)) },
      tareasLargas: r.longTasks,
      cpuNucleo: Object.fromEntries(Object.entries(m.cpu).map(([k, v]) => [k, r1(v * cores)])),
      cpuEquipo: Object.fromEntries(Object.entries(m.cpu).map(([k, v]) => [k, r1(v)])),
      memMB: Object.fromEntries(Object.entries(m.memMB).map(([k, v]) => [k, Math.round(v)])),
      heapMB: Math.round(r.heap / 1048576),
      lienzos: canv
    };
  }
  // solo el audio (y los temporizadores): la app deja de dibujar durante la medición
  const canPause = await js(win, `typeof nexuraApp.render === 'function'`);
  if (canPause) {
    await js(win, `(() => { const A = nexuraApp; A.__render = A.render; A.render = () => {}; return true; })()`);
    await wait(1000);
    metrics(win);
    await wait(SECS * 1000);
    const m = metrics(win);
    await js(win, `(() => { const A = nexuraApp; A.render = A.__render; delete A.__render; return true; })()`);
    res.soloAudio = { cpuNucleo: Object.fromEntries(Object.entries(m.cpu).map(([k, v]) => [k, r1(v * cores)])), cpuEquipo: Object.fromEntries(Object.entries(m.cpu).map(([k, v]) => [k, r1(v)])) };
  }
  res.errors = errors.filter(e => !/favicon|relleno-/.test(e));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `perf-${LABEL}.json`), JSON.stringify(res, null, 2));
  console.log(`\nRendimiento «${LABEL}» · ${res.machine} · ventana ${info.size.join('×')} @${info.dpr}`);
  console.log(`GPU: compositing ${res.gpu.gpu_compositing} · canvas 2D ${res.gpu['2d_canvas']} · rasterización ${res.gpu.rasterization}`);
  console.log(`Arranque: ${res.startup.listaMs} ms · carga de pista: ${res.loads.carga_0} / ${res.loads.carga_1} ms (con análisis ${res.loads.carga_y_analisis_0} / ${res.loads.carga_y_analisis_1} ms) · latencia de audio ${res.audio.latencyMs} ms`);
  for (const [k, v] of Object.entries(res.layouts)) {
    console.log(`${k.padEnd(9)} FPS ${v.fps} · frame p50 ${v.frameMs.p50} / p95 ${v.frameMs.p95} ms · bucle app p95 ${v.bucleAppMs.p95} ms · CPU (1 núcleo) render ${v.cpuNucleo.renderer} % · principal ${v.cpuNucleo.main} % · GPU ${v.cpuNucleo.gpu} % · audio ${v.cpuNucleo.audio} % · (equipo: render ${v.cpuEquipo.renderer} %) · mem render ${v.memMB.renderer} MB · heap ${v.heapMB} MB`);
  }
  if (res.soloAudio) console.log(`Solo audio (sin dibujar): CPU (1 núcleo) render ${res.soloAudio.cpuNucleo.renderer} % · principal ${res.soloAudio.cpuNucleo.main} % · GPU ${res.soloAudio.cpuNucleo.gpu} % · audio ${res.soloAudio.cpuNucleo.audio} %`);
  if (res.errors.length) console.log('errores en consola:', res.errors.join(' | '));
  console.log(`informe en .revision/fix-feedback/perf-${LABEL}.json`);
  finish(0);
}

function finish(code) {
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* en uso */ } app.exit(code); }, 300);
}

require(path.join(root, 'main.js'));
