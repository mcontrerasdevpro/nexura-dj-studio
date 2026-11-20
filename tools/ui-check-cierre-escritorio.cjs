// Encargo DIRECTO (1.0.0-rc.10) con la app de escritorio REAL (main.js), datos en una carpeta temporal:
// - Cerrar la ventana con música sonando pregunta «Hay música sonando. ¿Cerrar Nexura DJ Studio?»; «Seguir
//   pinchando» no cierra.
// - La interfaz se cae (forcefullyCrashRenderer): el proceso principal la recarga sola y ofrece recuperar la sesión;
//   «Recuperar» deja el tema en su deck, en su posición y en pausa. El registro técnico anota el cierre inesperado
//   sin rutas.
// - «Cerrar» con música cierra la app y deja la marca de cierre limpio (sesion.json → clean).
// No necesita el servidor de 5180. Uso: npx electron tools/ui-check-cierre-escritorio.cjs
'use strict';
const electron = require('electron');
const { app, dialog } = electron;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clickSamples, wavBytes } = require('./click-wav.cjs');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-cierre-'));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const music = path.join(tmp, 'music');
fs.mkdirSync(music, { recursive: true });
const wavPath = path.join(music, 'Prueba directo 126.wav');
fs.writeFileSync(wavPath, wavBytes(clickSamples({ bpm: 126, seconds: 90 })));
const data = path.join(tmp, 'data');
fs.mkdirSync(path.join(data, 'waveforms'), { recursive: true });
const track = { id: 'dir1', path: wavPath, source: 'local', title: 'Prueba directo', artist: 'Prueba', album: '', genre: '', year: '', comment: '', rating: 0, bpm: null, firstBeat: 0, key: '', camelot: '',
  keyTonic: null, keyMinor: null, duration: 0, size: 1, rmsDb: null, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: Date.now(), plays: 0, lastPlayed: 0, analyzed: false, bpmLocked: false, keyLocked: false };
fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify({ version: 1, tracks: [track], crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] }));
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ welcomeDone: true, screenView: 'mix', viewDefaultV2: true, statsEnabled: false, autoUpdate: false, lastVersion: pkg.version, autoAnalyze: false, stemsBackground: false, aiAutoCues: false }));
process.env.NEXURA_USER_DATA = tmp;
process.env.NEXURA_NO_UPDATES = '1';

// diálogo de confirmación simulado: se anota lo que pregunta y se contesta lo que diga `answer`
const asked = [];
let answer = 0;
dialog.showMessageBox = async (_w, o) => { asked.push(o); return { response: answer }; };

let ok = true;
const check = (name, cond, extra) => { if (!cond) ok = false; console.log(`${cond ? '✓' : '✗'} ${name}${!cond && extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 500) : ''}`); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
const waitFor = async (win, code, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await js(win, code); if (v && !v.error) return v; await wait(250); } return null; };

let mainWin = null, loads = 0, started = false, closed = false;
app.on('browser-window-created', (_e, win) => {
  if (mainWin) return;
  mainWin = win;
  win.webContents.on('did-finish-load', () => { loads++; if (!started) { started = true; run(win).catch(e => { check('la prueba termina sin excepciones', false, String(e && e.stack || e)); finish(); }); } });
  win.on('closed', () => { closed = true; });
});
let finished = false;
function finish() {
  if (finished) return; finished = true;
  let s = null;
  try { s = JSON.parse(fs.readFileSync(path.join(data, 'sesion.json'), 'utf8')); } catch (_) { /* sin instantánea */ }
  check('Con música, «Cerrar»: pregunta otra vez, cierra la ventana y la sesión queda con la marca de cierre limpio', asked.length === 2 && asked[1].message === asked[0].message && closed && s && s.clean === true, { asked: asked.length, closed, clean: s && s.clean });
  console.log(ok ? '\nTODO OK' : '\nHAY FALLOS');
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* en uso */ } app.exit(ok ? 0 : 1); }, 300);
}
app.on('will-quit', (e) => { if (!finished) { e.preventDefault(); finish(); } });

async function run(win) {
  await waitFor(win, `window.nexuraApp && nexuraApp.sessionReady ? nexuraApp.sessionReady.then(() => true) : null`, 30000);
  await js(win, `(async () => { const A = nexuraApp; A.engine.resume(); A.engine.setMaster(0.05); await A.loadToDeck('dir1', 0); A.decks[0].seek(30); A.decks[0].play(); return true; })()`);
  const playing = await waitFor(win, `nexuraApp.decks[0].playing && nexuraApp.live.active ? true : null`, 20000);
  check('App de escritorio: tema sonando al aire y sesión en directo activa', playing === true);
  await wait(2600);
  // 1) cerrar con música → pregunta; «Seguir pinchando» no cierra
  answer = 0;
  win.close();
  await wait(1500);
  check(`Cerrar con música: pregunta «${asked[0] && asked[0].message}» con «${asked[0] && asked[0].buttons.join(' / ')}»`, asked.length === 1 && asked[0].message === 'Hay música sonando. ¿Cerrar Nexura DJ Studio?' && asked[0].buttons[0] === 'Seguir pinchando', asked);
  check('«Seguir pinchando»: la ventana sigue abierta y la música sigue', !win.isDestroyed() && (await js(win, `nexuraApp.decks[0].playing`)) === true);
  // 2) la interfaz se cae → el proceso principal la recarga y ofrece recuperar la sesión
  const before = await js(win, `+nexuraApp.decks[0].time.toFixed(2)`);
  await wait(2200); // la instantánea de cada 2 s
  const loads0 = loads;
  win.webContents.forcefullyCrashRenderer();
  const t0 = Date.now();
  while (loads === loads0 && Date.now() - t0 < 15000) await wait(200);
  check('Interfaz caída: el proceso principal la recarga sola', loads > loads0, { loads, loads0 });
  const card = await waitFor(win, `document.querySelector('#recover-card') ? document.querySelector('#recover-card').textContent : null`, 30000);
  check('Tras recargarla: «La última sesión se cerró de forma inesperada. ¿Recuperarla?»', card && /se cerró de forma inesperada/.test(card) && /1 tema en el deck 1/.test(card), card);
  const q = await js(win, 'location.search');
  check('La interfaz recargada sabe que viene de un cierre (?tras=cierre)', /tras=cierre/.test(q), q);
  await js(win, `document.querySelector('#recover-card .rec-yes').click(); true`);
  const st = await waitFor(win, `nexuraApp.decks[0].track ? new Promise(r => setTimeout(() => r({ id: nexuraApp.decks[0].track.id, t: +nexuraApp.decks[0].time.toFixed(2), playing: nexuraApp.decks[0].playing }), 1500)) : null`, 30000);
  check(`«Recuperar»: el tema vuelve al deck 1, cerca de donde iba (${before} s → ${st && st.t} s) y EN PAUSA`, st && st.id === 'dir1' && !st.playing && st.t > 30 && Math.abs(st.t - before) < 4, { before, st });
  await wait(1500);
  const logDir = path.join(tmp, 'logs');
  const log = fs.existsSync(logDir) ? fs.readdirSync(logDir).map(f => fs.readFileSync(path.join(logDir, f), 'utf8')).join('\n') : '';
  check('Registro técnico: cierre inesperado de la interfaz, recarga y sesión anterior (sin rutas ni nombres de temas)', /Cierre inesperado de la interfaz/.test(log) && /se cerró de forma inesperada/.test(log) && /Sesión recuperada/.test(log) && !log.split('\n').filter(l => /sesion|Cierre inesperado/.test(l)).some(l => l.includes(tmp) || /Prueba directo/.test(l)), log.split('\n').filter(l => /sesion|Cierre|interfaz/i.test(l)).slice(-8));
  // 3) con música, «Cerrar» cierra
  await js(win, `nexuraApp.decks[0].play(); true`);
  await wait(1200);
  answer = 1;
  win.close();
  await wait(8000);
  finish();
}

app.getVersion = () => pkg.version;
require(path.join(root, 'main.js'));
