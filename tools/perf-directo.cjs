// Encargo DIRECTO (1.0.0-rc.10): ¿corta el audio en un equipo lento? App de escritorio REAL (main.js) con datos en
// una carpeta temporal, como tools/perf-lento.cjs:
// - procesador lento simulado: Emulation.setCPUThrottlingRate ×6 en la interfaz (hilo principal) y, en el hilo de
//   audio, cada deck tarda el doble (mensaje «burn» del worklet: ocupa lo mismo que ya tarda el deck en cada bloque;
//   el equipo del beta tester tiene núcleos de 2016 a 2,4 GHz);
// - dos decks sonando (uno con key lock) y el análisis de 6 pistas de 5 min a la vez (pedido por el usuario: no se
//   pausa por la sesión, solo si el audio va al límite);
// - durante `secs` s: cortes detectados por el medidor (reloj del audio frente al del sistema), carga media y máxima.
// Uso: npx electron tools/perf-directo.cjs [--latency safe|normal|low] [--secs 40] [--rate 6] [--burn 1]
// Resultado: <repo>/.revision/directo-medir/perf-directo-<latencia>.json (o NEXURA_OUT) y una línea en la consola.
'use strict';
const electron = require('electron');
const { app } = electron;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clickSamples, wavBytes } = require('./click-wav.cjs');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const LAT = arg('latency', 'safe'), SECS = +arg('secs', 40), RATE = +arg('rate', 6), BURN = +arg('burn', 1);
const OUT = process.env.NEXURA_OUT || path.join(root, '..', 'nexura-dj-studio', '.revision', 'directo-medir');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-directo-'));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const music = path.join(tmp, 'music');
fs.mkdirSync(music, { recursive: true });
const base = (id, p, title) => ({ id, path: p, source: 'local', title, artist: 'Prueba', album: '', genre: '', year: '', comment: '', rating: 0, bpm: null, firstBeat: 0, key: '', camelot: '',
  keyTonic: null, keyMinor: null, duration: 0, size: 1, rmsDb: null, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: Date.now(), plays: 0, lastPlayed: 0, analyzed: false, bpmLocked: false, keyLocked: false });
const tracks = [];
for (let i = 0; i < 8; i++) {
  const bpm = 120 + i, p = path.join(music, `Pista ${i + 1} - ${bpm}.wav`);
  fs.writeFileSync(p, wavBytes(clickSamples({ bpm, seconds: i < 2 ? 240 : 300, firstBeat: 0.1 + i * 0.02 })));
  tracks.push(base('t' + i, p, `Pista ${i + 1}`));
}
const data = path.join(tmp, 'data');
fs.mkdirSync(path.join(data, 'waveforms'), { recursive: true });
fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify({ version: 1, tracks, crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] }));
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ welcomeDone: true, screenView: 'lib', viewDefaultV2: true, statsEnabled: false, autoUpdate: false, lastVersion: pkg.version, autoAnalyze: false, stemsBackground: false, aiAutoCues: true, latency: LAT }));
process.env.NEXURA_USER_DATA = tmp;
process.env.NEXURA_NO_UPDATES = '1';
app.getVersion = () => pkg.version;

const js = (win, code) => win.webContents.executeJavaScript(code, true);
let mainWin = null;
app.on('browser-window-created', (_e, win) => {
  if (mainWin) return;
  mainWin = win;
  win.webContents.once('did-finish-load', () => run(win).catch(e => { console.log('✗ la medición ha fallado:', e && e.stack || e); finish(1); }));
});
function finish(code) { setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* en uso */ } app.exit(code); }, 300); }

async function run(win) {
  for (let i = 0; i < 120; i++) { if (await js(win, `!!(window.nexuraApp && nexuraApp.sessionReady)`)) break; await wait(250); }
  await js(win, `nexuraApp.sessionReady`);
  await wait(1000);
  await js(win, `(async () => { const A = nexuraApp; A.engine.resume(); A.engine.setMaster(0.03); await A.loadToDeck('t0', 0); await A.loadToDeck('t1', 1);
    if (!A.decks[1].keylock) A.decks[1].toggleKeylock(); A.decks[1].setPitchFader(0.5); A.decks[0].play(); A.decks[1].play(); return true; })()`);
  await wait(6000); // que termine el análisis de las dos cargadas
  const own = await js(win, `[0, 1].map(i => { const r = nexuraApp.loadMeter.decks.get(i); return r ? r.busy / r.audio : 0; })`);
  const blockMs = await js(win, `128 / nexuraApp.engine.ctx.sampleRate * 1000`);
  // equipo lento: cada deck tarda (1 + BURN) veces lo que tarda aquí
  await js(win, `nexuraApp.decks.slice(0, 2).forEach((d, i) => d.send({ t: 'burn', v: ${JSON.stringify(own)}[i] * ${blockMs} * ${BURN} })); true`);
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setCPUThrottlingRate', { rate: RATE });
  await js(win, `(() => { const A = nexuraApp; A.loadMeter.glitches.length = 0; A.loadMeter.peak = 0; A.analyzeMany(A.library.all ? A.library.all().slice(2) : [...A.library.tracks.values()].slice(2)); window.__dir = { loads: [], t0: Date.now() };
    window.__dirT = setInterval(() => window.__dir.loads.push(A.loadMeter.load), 1000); return true; })()`);
  await wait(SECS * 1000);
  const r = await js(win, `(() => { const A = nexuraApp, m = A.loadMeter; clearInterval(window.__dirT); const l = window.__dir.loads;
    return { latency: A.settings.latency, engineLatency: A.engine.latency, realMs: Math.round(((A.engine.ctx.baseLatency || 0) + (A.engine.ctx.outputLatency || 0)) * 10000) / 10, baseMs: Math.round((A.engine.ctx.baseLatency || 0) * 10000) / 10,
      sampleRate: A.engine.ctx.sampleRate, glitches: m.glitches.length, glitchMs: m.glitches.map(g => g.ms), loadAvg: Math.round(l.reduce((s, v) => s + v, 0) / Math.max(1, l.length) * 100), loadMax: Math.round(m.peak * 100),
      overloadedEvents: m.events.length, analyzed: [...A.library.tracks.values()].filter(t => t.analyzed).length, playing: A.decks.slice(0, 2).map(d => d.playing), fps: A.perfDiag.fpsNow() }; })()`);
  await dbg.sendCommand('Emulation.setCPUThrottlingRate', { rate: 1 });
  dbg.detach();
  Object.assign(r, { rate: RATE, burn: BURN, secs: SECS, ownLoad: own.map(v => Math.round(v * 1000) / 10) });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `perf-directo-${LAT}${BURN !== 1 ? "-x" + (1 + BURN) : ""}.json`), JSON.stringify(r, null, 1));
  console.log(`Latencia ${LAT} (real ${r.realMs} ms, búfer ${r.baseMs} ms, ${r.sampleRate} Hz) · CPU ×${RATE}, decks ×${1 + BURN}: cortes ${r.glitches} · carga media ${r.loadAvg} %, máx. ${r.loadMax} % (decks aquí: ${r.ownLoad.join(' + ')} %) · analizadas ${r.analyzed}/8 · ${r.fps} fps · sonando ${r.playing}`);
  const pass = LAT !== 'safe' || (r.glitches === 0 && r.loadMax > 0);
  console.log(pass ? '✓ ' + (LAT === 'safe' ? 'Segura: sin cortes y el medidor refleja la carga' : 'medido') : '✗ Segura: hay cortes o el medidor no refleja la carga');
  finish(pass ? 0 : 1);
}
require(path.join(root, 'main.js'));
