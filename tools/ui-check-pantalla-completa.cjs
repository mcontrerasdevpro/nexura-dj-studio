// Botón de pantalla completa (encargo FRAN4) en la app de escritorio REAL (main.js), con datos en una carpeta
// temporal: el botón ⛶ está en la barra superior junto a los ajustes, con el texto «Pantalla completa (F11)»; al
// pulsarlo la ventana pasa a pantalla completa (win.setFullScreen por IPC) y el icono y el texto cambian a «Salir
// de pantalla completa (F11 o Esc)»; F11 (en el proceso principal) y Esc también salen, y el botón se entera.
// Captura en .revision/capturas-fran4/. Uso: npx electron tools/ui-check-pantalla-completa.cjs
'use strict';
const { app, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const OUT = path.join(root, '..', 'nexura-dj-studio', '.revision', 'capturas-fran4');
const pkg = require(path.join(root, 'package.json'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-fs-'));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
shell.openExternal = async () => {};
app.getVersion = () => pkg.version;
process.env.NEXURA_USER_DATA = path.join(tmp, 'datos');
process.env.NEXURA_NO_UPDATES = '1';
const data = path.join(process.env.NEXURA_USER_DATA, 'data');
fs.mkdirSync(path.join(data, 'waveforms'), { recursive: true });
fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify({ version: 1, tracks: [], crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] }));
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ welcomeDone: true, statsEnabled: false, autoUpdate: false, lastVersion: pkg.version, autoAnalyze: false, screenView: 'mix', libView: 'all' }));

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? '✓' : '✗'} ${name}${!ok && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 500) : ''}`); };
const errors = [];
let mainWin = null;
app.on('browser-window-created', (_e, win) => {
  if (mainWin) return; // ventana oculta del analizador
  mainWin = win;
  win.webContents.on('console-message', (_ev, level, message, line, src) => { if (level >= 3) errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  win.webContents.once('did-finish-load', () => run(win).catch(e => check('la prueba ha fallado', false, String(e && e.stack || e))).finally(finish));
});
const js = (win, code) => win.webContents.executeJavaScript(code, true);
const until = async (cond, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await wait(100); } return false; };
const STATE = `(() => { const b = document.querySelector('#top-right .fs-btn'); return b && { title: b.title, aria: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), icon: b.querySelector('svg path').getAttribute('d'), next: b.nextElementSibling && b.nextElementSibling.title, body: document.body.classList.contains('is-fullscreen'), app: nexuraApp.fullscreenOn }; })()`;
const key = (win, k) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); };

async function run(win) {
  for (let i = 0; i < 300; i++) { if (await js(win, `!!(window.nexuraApp && nexuraApp.updatesUI)`).catch(() => false)) break; await wait(50); }
  await wait(600);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); document.querySelectorAll('.toast').forEach(t => t.remove()); true`);
  win.setContentSize(1280, 800); await wait(400);
  const s0 = await js(win, STATE);
  check('Botón ⛶ en la barra superior, justo antes de los ajustes, con «Pantalla completa (F11)»', s0 && s0.title === 'Pantalla completa (F11)' && s0.aria === s0.title && s0.pressed === 'false' && s0.next === 'Ajustes' && !win.isFullScreen(), s0);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'pantalla-completa-boton-1280x800.png'), (await win.webContents.capturePage()).toPNG());

  await js(win, `document.querySelector('#top-right .fs-btn').click(); true`);
  await until(() => win.isFullScreen());
  await wait(400);
  const s1 = await js(win, STATE);
  check('Pulsarlo: la ventana pasa a pantalla completa; icono y texto «Salir de pantalla completa (F11 o Esc)»', win.isFullScreen() && s1.title === 'Salir de pantalla completa (F11 o Esc)' && s1.pressed === 'true' && s1.icon !== s0.icon && s1.body && s1.app, s1);
  fs.writeFileSync(path.join(OUT, 'pantalla-completa-dentro.png'), (await win.webContents.capturePage()).toPNG());

  key(win, 'F11');
  await until(() => !win.isFullScreen());
  await wait(400);
  const s2 = await js(win, STATE);
  check('F11: sale de pantalla completa y el botón se entera (vuelve a «Pantalla completa (F11)»)', !win.isFullScreen() && s2.title === 'Pantalla completa (F11)' && s2.pressed === 'false' && !s2.body, s2);

  key(win, 'F11');
  await until(() => win.isFullScreen());
  await wait(400);
  const s3 = await js(win, STATE);
  check('F11 otra vez: entra y el botón lo indica', win.isFullScreen() && s3.pressed === 'true', s3);
  key(win, 'Escape');
  await until(() => !win.isFullScreen());
  await wait(400);
  const s4 = await js(win, STATE);
  check('Esc: sale de pantalla completa', !win.isFullScreen() && s4.pressed === 'false', s4);
  key(win, 'Escape');
  await wait(300);
  check('Esc fuera de pantalla completa no hace nada raro (sigue en ventana)', !win.isFullScreen());
  const errs = errors.filter(e => !/favicon|requestMIDIAccess/.test(e));
  check('Sin errores en la consola', !errs.length, errs);
}

let done = false;
function finish() {
  if (done) return; done = true;
  console.log(`\n${pass}/${pass + fail} comprobaciones del botón de pantalla completa correctas`);
  try { if (mainWin && !mainWin.isDestroyed() && mainWin.isFullScreen()) mainWin.setFullScreen(false); } catch (_) { /* cerrando */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* en uso */ }
  app.exit(fail ? 1 : 0);
}
setTimeout(() => { check('tiempo agotado', false); finish(); }, 90000).unref();

require(path.join(root, 'main.js'));
