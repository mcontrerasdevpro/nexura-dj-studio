// 1.0-rc1 en la app de escritorio real (main.js) con la RED CORTADA y datos en una carpeta temporal:
// - al arrancar, la biblioteca está dañada y hay una copia buena → se ofrece restaurarla y la app abre con ella;
// - ningún error en pantalla ni en la consola sin red: actualizaciones (electron-updater contra GitHub,
//   comprobación automática a los 15 s y «Buscar ahora»), estadísticas e informe;
// - informe sin servicio: guarda el .txt (sin rutas ni canciones) y abre el correo (simulado);
// - copias desde Ajustes → Biblioteca (lista, «Hacer copia ahora») y registro en <datos>\logs.
// Simula la red cortada con un proxy inexistente (Chromium y electron-updater) y fetch que falla (Node).
// Uso: npx electron tools/ui-check-rc1-escritorio.cjs  (capturas e informe en .revision/rc1-escritorio/)
'use strict';
const electron = require('electron');
const { app, BrowserWindow, dialog, shell } = electron;
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const OUT = path.join(root, '.revision', 'rc1-escritorio');
const pkg = require(path.join(root, 'package.json'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-rc1-'));
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// --- red cortada
// NEXURA_TEST_ONLINE=1: Chromium/electron-updater con red (comprueba GitHub de verdad: caso «sin releases»);
// las peticiones de Node (informe, estadísticas) siguen bloqueadas para no enviar nada a ningún servicio
const ONLINE = process.env.NEXURA_TEST_ONLINE === '1' || process.argv.includes('--online');
if (!ONLINE) app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:9');
const realFetch = globalThis.fetch;
const netCalls = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url && url.url ? url.url : url);
  if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) return realFetch(url, opts);
  netCalls.push(u.replace(/\?.*$/, ''));
  throw new TypeError('fetch failed (sin red)');
};
// --- sin abrir nada de verdad en el equipo
const opened = [], shown = [], boxes = [];
shell.openExternal = async (u) => { opened.push(u); };
shell.showItemInFolder = (p) => { shown.push(p); };
shell.openPath = async (p) => { shown.push(p); return ''; };
dialog.showMessageBox = async (opts) => { boxes.push(opts); return { response: 0 }; };
// --- la app se ejecuta como si fuera ella (versión y actualizador de prueba)
app.getVersion = () => pkg.version;
process.env.NEXURA_USER_DATA = tmp;
process.env.NEXURA_UPDATER_TEST = '1';

// --- datos: biblioteca dañada + una copia buena de ayer
const track = (id, title, artist) => ({ id, path: `C:\\Users\\Pepe\\Music\\${artist} - ${title}.mp3`, source: 'local', title, artist, album: '', genre: 'House', bpm: 124, firstBeat: 0.1, key: '', camelot: '8A', duration: 200, size: 1, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: 1, plays: 0, lastPlayed: 0, analyzed: true, energy: 5, sections: [] });
const good = { tracks: [track('a1', 'Titanium', 'David Guetta'), track('a2', 'Seek Bromance', 'Tim Berg'), track('a3', 'Levels', 'Avicii')], crates: [{ id: 'c1', name: 'Boda de Lucía', ids: ['a1', 'a3'] }], smart: [], history: [], prepare: ['a2'], ytPlaylists: [] };
const settings = { welcomeDone: true, screenView: 'mix', viewDefaultV2: true, statsEnabled: true, autoUpdate: true, waveLayout: 'serato', lastVersion: pkg.version }; // sin aviso de novedades (lo prueba ui-check-rc2-escritorio.cjs)
const data = path.join(tmp, 'data');
fs.mkdirSync(path.join(data, 'waveforms'), { recursive: true });
fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify(good).slice(0, 180)); // cortado: corte de luz
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify(settings));
const bk = path.join(tmp, 'copias', '2026-11-09_2130');
fs.mkdirSync(bk, { recursive: true });
fs.writeFileSync(path.join(bk, 'library.json'), JSON.stringify(good));
fs.writeFileSync(path.join(bk, 'settings.json'), JSON.stringify(settings));
fs.writeFileSync(path.join(bk, 'copia.json'), JSON.stringify({ date: '2026-11-09T20:30:00.000Z', reason: 'auto', version: '0.9.0-beta.8', ok: true, tracks: 3 }));
// configuración del actualizador de prueba (la que electron-builder mete en el instalador)
const devYml = path.join(app.getAppPath(), 'dev-app-update.yml');
fs.writeFileSync(devYml, 'provider: github\nowner: mcontrerasdevpro\nrepo: nexura-dj-studio\nupdaterCacheDirName: nexura-dj-studio-updater-test\n');

const report = { errors: [], checks: {}, ok: true };
const check = (name, cond, extra) => { report.checks[name] = { ok: !!cond, ...extra }; if (!cond) { report.ok = false; console.log('✗', name, JSON.stringify(extra || {})); } else console.log('✓', name); };
const updEvents = [];

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message, line, src) => { if (level >= 3) report.errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  win.webContents.on('ipc-message', (_ev, ch) => ch); // nada
  const send = win.webContents.send.bind(win.webContents);
  win.webContents.send = (ch, ...a) => { if (ch === 'update:event') updEvents.push(a[0]); return send(ch, ...a); };
  win.webContents.once('did-finish-load', () => run(win).catch(e => { check('la prueba termina sin excepciones', false, { e: String(e && e.stack || e) }); finish(); }));
});

async function shot(win, name) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
}
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));

async function run(win) {
  win.setSize(1280, 800);
  await wait(3500);
  await js(win, `document.querySelector('.start-overlay')?.remove(); true`);
  check('Biblioteca dañada al arrancar: se ofrece restaurar la última copia buena', boxes.length === 1 && /No se ha podido leer tu biblioteca/.test(boxes[0].message) && /Restaurar la copia del/.test(boxes[0].buttons[0]) && /3 pistas/.test(boxes[0].detail), { box: boxes[0] && { message: boxes[0].message, buttons: boxes[0].buttons } });
  let s = await js(win, `({ n: nexuraApp.library.tracks.size, crate: nexuraApp.library.crates[0]?.name, prep: nexuraApp.library.prepare.join(), welcome: !!document.querySelector('#welcome'), version: nexuraApp.info.version })`);
  check('La app abre con la copia restaurada (3 pistas, crate y Prepare)', s.n === 3 && s.crate === 'Boda de Lucía' && s.prep === 'a2', s);
  const pre = fs.readdirSync(path.join(tmp, 'copias')).filter(n => n !== '2026-11-09_2130');
  const preMan = pre[0] ? JSON.parse(fs.readFileSync(path.join(tmp, 'copias', pre[0], 'copia.json'), 'utf8')) : {};
  check('Antes de restaurar se guardó el estado dañado (marcado como no bueno)', pre.length === 1 && preMan.reason === 'antes-de-restaurar' && preMan.ok === false, { pre, preMan });
  await shot(win, '01-arranque-restaurado');

  // estadísticas: activadas por el usuario pero sin statsUrl → nada
  s = await js(win, `nexuraApp.platform.stats.send({ enabled: true, decks: 2, controller: false })`);
  check('Estadísticas sin statsUrl: no se envía nada', s.sent === false && s.reason === 'sin-url', s);

  // comprobación automática de actualizaciones (a los 15 s) sin red: silencio
  await wait(14000);
  s = await js(win, `({ ind: !document.querySelector('#upd-ind').hidden, toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent) })`);
  check('Actualización automática ' + (ONLINE ? 'sin releases' : 'sin red') + ': ni aviso ni error', !s.ind && !s.toasts.some(t => /actualiz|error/i.test(t)) && !updEvents.some(e => e.state === 'error'), { s, updEvents });
  // «Buscar ahora» sin red: mensaje amable solo en el ajuste
  await js(win, `nexuraApp.settingsUI.open('general'); true`);
  await wait(400);
  await js(win, `document.querySelector('#set-upd-check').click(); true`);
  await wait(6000);
  s = await js(win, `({ st: document.querySelector('#set-upd-state')?.textContent, toasts: [...document.querySelectorAll('.toast.error')].length })`);
  await shot(win, '02-buscar-ahora-sin-red');
  check('«Buscar ahora» ' + (ONLINE ? 'sin releases' : 'sin red') + ': mensaje en el ajuste, sin avisos de error', (ONLINE ? /No se pudo comprobar|última versión/ : /No se pudo comprobar/).test(s.st || '') && !s.toasts, s);

  // copias desde Ajustes → Biblioteca
  await js(win, `[...document.querySelectorAll('.set-tab')].find(t => t.textContent === 'Biblioteca').click(); true`);
  await wait(600);
  await js(win, `[...document.querySelectorAll('.set-page .btn')].find(b => /Hacer copia ahora/.test(b.textContent)).click(); true`);
  await wait(800);
  s = await js(win, `({ rows: [...document.querySelectorAll('.bk-row')].map(r => r.textContent), toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') })`);
  await shot(win, '03-copias');
  check('«Hacer copia ahora» y lista con fecha, tipo, pistas y tamaño', s.rows.length === 3 && /Manual · 3 pistas · \d/.test(s.rows[0]) && /Copia hecha/.test(s.toast) && s.rows.some(r => /dañada/.test(r)), s);
  await js(win, `nexuraApp.closeModal(); true`);

  // informe sin red: .txt anonimizado + correo
  await js(win, `console.error('No se pudo abrir el archivo: C:\\\\Users\\\\Pepe\\\\Music\\\\Avicii - Levels.mp3'); true`);
  await wait(800);
  await js(win, `nexuraApp.feedback.open('error'); true`);
  await wait(1200);
  s = await js(win, `document.querySelector('#fb-preview').textContent`);
  check('Vista previa del registro real sin rutas ni canciones', String(s).includes('Versión: ' + pkg.version) && /<ruta>/.test(s) && !/Pepe|Levels|Avicii|Music/.test(s), { tail: String(s).slice(-300) });
  await js(win, `document.querySelector('#fb-text').value = 'Se corta el audio al cargar'; document.querySelector('#fb-email').value = 'dj@example.com'; [...document.querySelectorAll('.modal-foot .btn')].find(b => b.textContent === 'Enviar').click(); true`);
  await wait(2500);
  s = await js(win, `({ title: document.querySelector('.modal-head h2')?.textContent, body: document.querySelector('.modal-body')?.textContent, errs: [...document.querySelectorAll('.toast.error')].length })`);
  await shot(win, '04-informe-sin-red');
  const files = fs.existsSync(path.join(tmp, 'informes')) ? fs.readdirSync(path.join(tmp, 'informes')) : [];
  const txt = files[0] ? fs.readFileSync(path.join(tmp, 'informes', files[0]), 'utf8') : '';
  check('Informe sin red: abre el correo a contacto@nexuraia.com y muestra dónde está el .txt', /correo/i.test(s.title || '') && opened.some(u => u.startsWith('mailto:contacto@nexuraia.com?')) && /informe-.*\.txt/.test(s.body || '') && !s.errs, { title: s.title, opened });
  check('El .txt guardado tiene el mensaje y el registro, sin rutas ni canciones', /Se corta el audio/.test(txt) && /Registro técnico/.test(txt) && /dj@example\.com/.test(txt) && !/Pepe|Levels|Avicii|Titanium|\\Music\\/.test(txt), { file: files[0] });
  await js(win, `nexuraApp.closeModal(); true`);

  // registro local
  const logs = fs.existsSync(path.join(tmp, 'logs')) ? fs.readdirSync(path.join(tmp, 'logs')) : [];
  const log = logs.includes('nexura.log') ? fs.readFileSync(path.join(tmp, 'logs', 'nexura.log'), 'utf8') : '';
  check('Registro local en <datos>\\logs con arranque, restauración, audio y actualizaciones', log.includes('Inicio Nexura DJ Studio ' + pkg.version) && /Restaurada la copia 2026-11-09_2130/.test(log) && /\[ui:audio\] AudioContext/.test(log) && /\[actualizaciones\]/.test(log), { logs, tail: log.split('\n').slice(-8) });
  s = await js(win, `[...document.querySelectorAll('.toast.error')].map(t => t.textContent)`);
  check('Ningún aviso de error en pantalla en toda la sesión' + (ONLINE ? ' (con red, sin releases)' : ' sin red'), !s.length, { s });
  report.updaterLog = log.split('\n').filter(l => /actualizaciones/.test(l));
  console.log('registro del actualizador:', report.updaterLog.join(' || '));
  finish();
}

function finish() {
  report.errors = report.errors.filter(e => !/No se pudo abrir el archivo|favicon/.test(e));
  if (report.errors.length) { report.ok = false; console.log('✗ errores en consola: ' + report.errors.join(' | ')); }
  report.netCalls = [...new Set(netCalls)];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  console.log(report.ok ? '\nTODO OK' : '\nHAY FALLOS', '· informe en .revision/rc1-escritorio/informe.json · peticiones de red (bloqueadas):', report.netCalls.join(', ') || 'ninguna');
  try { fs.rmSync(devYml, { force: true }); } catch (_) { /* nada */ }
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* en uso */ } app.exit(report.ok ? 0 : 1); }, 300);
}

require(path.join(root, 'main.js'));
