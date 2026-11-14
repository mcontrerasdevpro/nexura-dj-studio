// Encargo RENDIMIENTO2 en la app de escritorio REAL (main.js) con datos en una carpeta temporal:
// - guardado diferido de la biblioteca: un cambio hecho justo antes de cerrar la ventana está en disco al salir
//   (la ventana pide a la interfaz que guarde y espera antes de cerrarse);
// - analizador en segundo plano (ventana oculta): mismo BPM, primer beat, tonalidad y forma de onda que
//   analizando en la interfaz como antes;
// - Ajustes → Audio → Rendimiento → «Aceleración por GPU»: Automática / Desactivada, se guarda en
//   arranque.json y avisa de que hay que reiniciar (con «Reiniciar ahora»); capturas a 1280 y 375 px;
// - el informe de errores lleva el diagnóstico de rendimiento, sin rutas ni nombres.
// Uso: npx electron tools/ui-check-guardado-escritorio.cjs  (capturas en .revision/rendimiento2/)
'use strict';
const electron = require('electron');
const { app, shell } = electron;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clickWav } = require('./click-wav.cjs');

const root = path.join(__dirname, '..');
const OUT = path.join(root, '.revision', 'rendimiento2');
const pkg = require(path.join(root, 'package.json'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-guardado-'));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
shell.openExternal = async () => {};
app.getVersion = () => pkg.version;
process.env.NEXURA_USER_DATA = tmp;
process.env.NEXURA_NO_UPDATES = '1';

const music = path.join(tmp, 'Pepe Música');
fs.mkdirSync(music, { recursive: true });
const pClick = path.join(music, 'Titanium - David Guetta.wav');
fs.writeFileSync(pClick, clickWav({ bpm: 124, seconds: 75, firstBeat: 0.3 }));
const track = (id, p, title, artist, extra) => ({ id, path: p, source: 'local', title, artist, album: '', genre: 'House', bpm: 124, firstBeat: 0.1, key: '', camelot: '8A', duration: 200, size: 1, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: 1, plays: 0, lastPlayed: 0, analyzed: true, energy: 5, sections: [], ...extra });
const lib = { version: 1, tracks: [track('a1', 'C:\\Users\\Pepe\\Music\\Levels.mp3', 'Levels', 'Avicii'), track('a2', 'C:\\Users\\Pepe\\Music\\Seek.mp3', 'Seek Bromance', 'Tim Berg'), track('clic', pClick, 'Titanium', 'David Guetta', { analyzed: false, bpm: null })], crates: [{ id: 'c1', name: 'Boda de Lucía', ids: ['a1'] }], smart: [], history: [], prepare: [], ytPlaylists: [] };
const data = path.join(tmp, 'data');
fs.mkdirSync(path.join(data, 'waveforms'), { recursive: true });
fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify(lib));
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ welcomeDone: true, statsEnabled: false, autoUpdate: false, lastVersion: pkg.version, autoAnalyze: false, waveLayout: 'serato' }));

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? '✓' : '✗'} ${name}${!ok && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : ''}`); };
const errors = [];
let mainWin = null, closing = false;

app.on('browser-window-created', (_e, win) => {
  if (mainWin) return; // ventana oculta del analizador
  mainWin = win;
  win.webContents.on('console-message', (_ev, level, message, line, src) => { if (level >= 3) errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  win.webContents.once('did-finish-load', () => run(win).catch(e => { console.log('✗ la prueba ha fallado:', e && e.stack || e); fail++; finish(); }));
});
const js = (win, code) => win.webContents.executeJavaScript(code, true);

async function run(win) {
  win.setContentSize(1280, 800);
  for (let i = 0; i < 300; i++) { if (await js(win, `!!(window.nexuraApp && nexuraApp.libraryUI && nexuraApp.updatesUI)`).catch(() => false)) break; await wait(50); }
  await wait(600);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); nexuraApp.engine.setMaster(0); true`);

  // --- analizador en segundo plano = análisis en la interfaz
  const ana = await js(win, `(async () => {
    const A = nexuraApp, t = A.library.get('clic'), opts = { minBpm: A.settings.minBpm, maxBpm: A.settings.maxBpm };
    const bg = await A.analyzer.analyzeFile(t, opts, A.engine.ctx.sampleRate);
    const wBg = A.analyzer.waves.get('clic').data;
    const bytes = await A.platform.readFile(t.path);
    const buf = await A.engine.ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const ui = await A.analyzer.analyzeTrack(t, buf, opts);
    const wUi = A.analyzer.waves.get('clic').data;
    let diff = 0; for (let i = 0; i < Math.max(wBg.length, wUi.length); i++) diff = Math.max(diff, Math.abs((wBg[i] || 0) - (wUi[i] || 0)));
    await A.analyzeMany([t]);
    return { bg: { bpm: bg.bpm, firstBeat: bg.firstBeat, key: bg.key, duration: bg.duration, rmsDb: bg.rmsDb }, ui: { bpm: ui.bpm, firstBeat: ui.firstBeat, key: ui.key, duration: ui.duration, rmsDb: ui.rmsDb }, waveLen: [wBg.length, wUi.length], diff, after: { analyzed: t.analyzed, bpm: t.bpm }, bgOff: !!A._bgAnalysisOff };
  })()`);
  const windows = electron.BrowserWindow.getAllWindows().length;
  check('Analizador en segundo plano: misma pista → mismo BPM, primer beat, tonalidad y duración que en la interfaz', Math.abs(ana.bg.bpm - ana.ui.bpm) < 1e-9 && Math.abs(ana.bg.firstBeat - ana.ui.firstBeat) < 1e-9 && ana.bg.key === ana.ui.key && Math.abs(ana.bg.duration - ana.ui.duration) < 1e-9 && Math.abs(ana.bg.rmsDb - ana.ui.rmsDb) < 1e-6, ana);
  check('…y la misma forma de onda (byte a byte)', ana.waveLen[0] === ana.waveLen[1] && ana.diff === 0, ana);
  check('«Analizar» usa el analizador en segundo plano (ventana oculta) y deja la pista analizada a 124 BPM', windows === 2 && !ana.bgOff && ana.after.analyzed && Math.abs(ana.after.bpm - 124) < 0.1, { windows, ...ana.after, bgOff: ana.bgOff });

  // --- vigilante de la onda (con una app simulada: un deck sonando, onda visible y la GPU activa)
  const vig = await js(win, `(async () => {
    const A = nexuraApp, logs = [];
    const fake = { decks: [{ playing: true, track: {} }], deckCount: 2, info: { gpu: { canvas2d: true }, gpuOff: false }, feedback: { log: (l, s, m) => logs.push(m) }, settingsUI: { open() {} }, settings: {}, library: A.library };
    const d = new A.perfDiag.constructor(fake);
    clearInterval(d.timer);
    const toasts = () => [...document.querySelectorAll('.toast')].map(t => t.textContent).filter(t => /congelado/.test(t)).length;
    d.beginFrame(); d.waveSeen(); d.endFrame();
    d.lastDraw = performance.now() - 1500; d.lastCheck = performance.now() - 500; d.check();
    const early = !!d.open;
    d.lastDraw = performance.now() - 2500; d.lastCheck = performance.now() - 500; d.check();
    const kind1 = d.open && d.open.kind, t1 = toasts();
    d.waveDrawn();
    // segunda congelación, con el hilo ocupado (el vigilante llega tarde): se anota, sin otro aviso
    d.lastDraw = performance.now() - 3000; d.lastCheck = performance.now() - 3000; d.check();
    const kind2 = d.open && d.open.kind;
    d.waveDrawn();
    const snap = d.snapshot();
    return { early, kind1, kind2, t1, t2: toasts(), logs, freezes: snap.freezes };
  })()`);
  check('Vigilante: con un deck sonando, más de 2 s sin redibujar la onda con el hilo libre → aviso de desactivar la GPU (una vez)', !vig.early && vig.kind1 === 'gpu' && vig.t1 === 1 && vig.t2 === 1, vig);
  check('…y cada congelación queda en el registro y en el diagnóstico (GPU o hilo ocupado)', vig.kind2 === 'hilo' && vig.freezes.length === 2 && vig.freezes[0].ms >= 2500 && vig.logs.filter(l => /congelada/.test(l)).length === 2, vig);

  // --- Ajustes → Audio → Rendimiento → Aceleración por GPU
  await js(win, `nexuraApp.settingsUI.open('audio'); true`);
  await wait(800);
  const g0 = await js(win, `(() => { const s = document.querySelector('#set-gpu-mode'); return s ? { value: s.value, opts: [...s.options].map(o => o.textContent), note: document.querySelector('#set-gpu-restart').hidden, state: document.querySelector('#set-gpu')?.textContent } : null; })()`);
  check('Ajustes → Audio: «Aceleración por GPU» con Automática / Desactivada (usar si la forma de onda se congela)', g0 && g0.value === 'auto' && g0.opts.join('|') === 'Automática|Desactivada (usar si la forma de onda se congela)' && g0.note === true && !!g0.state, g0);
  await js(win, `(() => { const s = document.querySelector('#set-gpu-mode'); s.value = 'off'; s.dispatchEvent(new Event('change')); return true; })()`);
  await wait(600);
  const g1 = await js(win, `({ note: document.querySelector('#set-gpu-restart').hidden, txt: document.querySelector('#set-gpu-restart').textContent })`);
  const boot = (() => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'arranque.json'), 'utf8')); } catch (_) { return null; } })();
  check('Desactivarla se guarda en arranque.json y avisa de reiniciar con «Reiniciar ahora»', boot && boot.gpu === 'off' && g1.note === false && /reiniciar/i.test(g1.txt) && /Reiniciar ahora/.test(g1.txt), { boot, g1 });
  fs.mkdirSync(OUT, { recursive: true });
  await js(win, `document.querySelector('#set-gpu-mode').scrollIntoView({ block: 'center' }); true`);
  await wait(300);
  fs.writeFileSync(path.join(OUT, 'ajustes-gpu-1280.png'), (await win.webContents.capturePage()).toPNG());
  win.setMinimumSize(300, 400); // la app pide 900 px como mínimo; para la captura de móvil se quita
  win.setContentSize(375, 760);
  await wait(700);
  await js(win, `document.querySelector('#set-gpu-mode').scrollIntoView({ block: 'center' }); true`);
  await wait(300);
  fs.writeFileSync(path.join(OUT, 'ajustes-gpu-375.png'), (await win.webContents.capturePage()).toPNG());
  const narrow = await js(win, `(() => { const r = document.querySelector('#set-gpu-mode').getBoundingClientRect(), b = document.querySelector('#set-gpu-restart button').getBoundingClientRect(); return { r: [r.left, r.right], b: [b.left, b.right], w: innerWidth }; })()`);
  check('A 375 px el selector y «Reiniciar ahora» caben en pantalla', narrow.r[0] >= 0 && narrow.r[1] <= narrow.w + 1 && narrow.b[0] >= 0 && narrow.b[1] <= narrow.w + 1, narrow);
  win.setContentSize(1280, 800);
  await js(win, `(() => { const s = document.querySelector('#set-gpu-mode'); s.value = 'auto'; s.dispatchEvent(new Event('change')); return true; })()`);
  await wait(500);
  const boot2 = JSON.parse(fs.readFileSync(path.join(tmp, 'arranque.json'), 'utf8'));
  check('Volver a «Automática» lo deja como estaba', boot2.gpu === 'auto');
  await js(win, `nexuraApp.closeModal(); true`);

  // --- diagnóstico de rendimiento en el informe
  const prev = await js(win, `(async () => { const f = nexuraApp.feedback; const t = await nexuraApp.platform.report.preview({ ...f.context(), known: f.knownNames() }); return f.techText(t); })()`);
  const leaks = ['Pepe', 'Titanium', 'Guetta', 'Avicii', 'Levels', 'Lucía', tmp, os.userInfo().username].filter(w => w && prev.includes(w));
  check('Informe: diagnóstico con procesador, RAM, tarjeta gráfica, aceleración, pistas, fps, tareas largas y congelaciones',
    /Diagnóstico de rendimiento/.test(prev) && /Procesador: .+ · \d+ hilos/.test(prev) && /RAM \d+ GB/.test(prev) && /Tarjeta gráfica:/.test(prev) && /Aceleración por GPU:/.test(prev) && /Biblioteca: 3 pistas/.test(prev) && /onda [\d.]+ fps/.test(prev) && /tareas largas \d+/.test(prev) && /Congelaciones de la onda:/.test(prev), prev.split('\n').slice(0, 14));
  check('…sin rutas, nombres de pistas ni el usuario del equipo', !leaks.length, leaks);

  // --- guardado diferido: cambio y cierre inmediato (antes de que llegue el guardado diferido)
  await js(win, `(() => { const L = nexuraApp.library; L.update('a1', { comment: 'cambio justo antes de cerrar', rating: 4 }); L.createCrate('Creada al cerrar'); nexuraApp.setSetting('jogSensitivity', 1.7); return L.savePending; })()`);
  const onDisk = JSON.parse(fs.readFileSync(path.join(data, 'library.json'), 'utf8'));
  check('El cambio todavía no está en disco (guardado diferido)', !onDisk.tracks.find(t => t.id === 'a1').comment);
  closing = true;
  win.close();
}

app.on('will-quit', () => {
  if (!closing) return;
  try {
    const l = JSON.parse(fs.readFileSync(path.join(data, 'library.json'), 'utf8'));
    const s = JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'));
    const a1 = l.tracks.find(t => t.id === 'a1');
    check('Al cerrar la ventana justo después del cambio, la biblioteca está guardada con él', a1 && a1.comment === 'cambio justo antes de cerrar' && a1.rating === 4 && l.crates.some(c => c.name === 'Creada al cerrar') && l.tracks.length === 3, { a1 });
    check('…y los ajustes también', s.jogSensitivity === 1.7);
    check('La ventana oculta del analizador no deja la app abierta', true);
  } catch (e) { check('Leer lo guardado al salir', false, e.message); }
  const errs = errors.filter(e => !/favicon|Levels|Seek/.test(e));
  check('Sin errores en la consola', !errs.length, errs);
  console.log(`\n${pass}/${pass + fail} comprobaciones del guardado, el analizador y la GPU correctas`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* en uso */ }
  process.exitCode = fail ? 1 : 0;
});
setTimeout(() => { console.log('✗ tiempo agotado (la app no se ha cerrado)'); fail++; finish(); }, 120000).unref();
function finish() { console.log(`\n${pass}/${pass + fail} comprobaciones correctas`); app.exit(fail ? 1 : 0); }

require(path.join(root, 'main.js'));
