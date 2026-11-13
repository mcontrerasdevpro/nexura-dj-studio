// 1.0.0-rc.2 en la app de escritorio real (main.js), datos en una carpeta temporal y red simulada:
// A) aviso «Nexura se ha actualizado a la X · Ver novedades» al arrancar tras actualizar (lastVersion = rc.1)
//    y ventana de novedades; al volver a arrancar ya no sale (lastVersion guardada);
// B) búsqueda de YouTube SIN clave por el servicio de NexuraIA (servidor HTTP local que simula el webhook
//    de n8n): resultado (se envía solo { id, q, max } con el id de data/instalacion.id aunque las
//    estadísticas estén desactivadas), límite diario (429) con su mensaje, servicio caído;
// C) con clave propia se usa la clave (Google simulado) y el servicio no recibe nada;
// D) Ajustes → YouTube: clave oculta «AIza••••••••», 👁 la enseña 5 s, al entrar se pega una nueva (tipo
//    contraseña), Client secret igual; «Comprobar clave» (correcta, no válida, cuota, API sin habilitar);
// E) sin servicio ni clave: aviso con «Ver la guía».
// Uso: npx electron tools/ui-check-rc2-escritorio.cjs  (capturas e informe en .revision/rc2/)
'use strict';
const electron = require('electron');
const { app, shell, dialog } = electron;
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');
const OUT = path.join(root, '.revision', 'rc2');
const pkg = require(path.join(root, 'package.json'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-rc2-'));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const report = { errors: [], checks: {}, ok: true };
const check = (name, cond, extra) => { report.checks[name] = { ok: !!cond, ...extra }; if (!cond) { report.ok = false; console.log('✗', name, JSON.stringify(extra || {}).slice(0, 600)); } else console.log('✓', name); };

// --- servicio de búsqueda simulado (lo que hará el flujo de n8n)
const PORT = 47391;
const got = [];
let mode = 'ok';
const sockets = new Set();
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let j = {};
    try { j = JSON.parse(body); } catch (_) { /* nada */ }
    got.push(j);
    if (mode === 'limit') { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end('{"error":"limit"}'); }
    if (mode === 'down') { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"youtube"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items: [
      { videoId: 'aaaaaaaaaa1', title: 'Daft Punk - One More Time (Official Video)', channel: 'Daft Punk', thumb: 'https://i.ytimg.com/vi/aaaaaaaaaa1/mqdefault.jpg', duration: 321 },
      { videoId: 'aaaaaaaaaa2', title: 'Daft Punk - Around The World', channel: 'Daft Punk', thumb: 'https://i.ytimg.com/vi/aaaaaaaaaa2/mqdefault.jpg', duration: 240 }
    ] }));
  });
});
server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
server.listen(PORT, '127.0.0.1');
process.env.NEXURA_SEARCH_URL = `http://127.0.0.1:${PORT}/webhook/nexura-dj-buscar`;

// --- Google (Data API) simulado en el proceso principal; el resto de Internet, bloqueado
const realFetch = globalThis.fetch;
const google = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url && url.url ? url.url : url);
  if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) return realFetch(url, opts);
  if (u.startsWith('https://www.googleapis.com/youtube/v3/')) {
    const p = new URL(u);
    const key = p.searchParams.get('key') || '';
    google.push({ path: p.pathname, key, q: p.searchParams.get('q') });
    const resp = (status, body) => ({ ok: status === 200, status, json: async () => body });
    if (key === 'AIzaMAL') return resp(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }], details: [{ reason: 'API_KEY_INVALID' }] } });
    if (key === 'AIzaCUOTA') return resp(403, { error: { code: 403, message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded' }] } });
    if (key === 'AIzaSINAPI') return resp(403, { error: { code: 403, message: 'YouTube Data API v3 has not been used in project 123 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } });
    if (p.pathname.endsWith('/search')) return resp(200, { items: [{ id: { videoId: 'bbbbbbbbbb1' } }] });
    if (p.pathname.endsWith('/videos')) return resp(200, { items: [{ id: 'bbbbbbbbbb1', snippet: { title: 'Con mi clave - Vídeo', channelTitle: 'Canal', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/bbbbbbbbbb1/mqdefault.jpg' } } }, contentDetails: { duration: 'PT3M30S' } }] });
    return resp(404, {});
  }
  throw new TypeError('fetch failed (sin red)');
};
app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:9');
const opened = [];
shell.openExternal = async (u) => { opened.push(u); };
dialog.showMessageBox = async () => ({ response: 0 });
app.getVersion = () => pkg.version;
process.env.NEXURA_USER_DATA = tmp;
process.env.NEXURA_NO_UPDATES = '1';

// --- datos: venía de la rc1 (bienvenida vista, estadísticas DESACTIVADAS)
const data = path.join(tmp, 'data');
fs.mkdirSync(path.join(data, 'waveforms'), { recursive: true });
fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify({ tracks: [], crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] }));
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ welcomeDone: true, statsEnabled: false, autoUpdate: true, lastVersion: '1.0.0-rc.1', ytApiKey: '', ytClientSecret: '' }));

const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  fs.mkdirSync(OUT, { recursive: true });
  win.webContents.invalidate();
  await wait(350);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
}
const toasts = (win) => js(win, `[...document.querySelectorAll('.toast')].map(t => ({ cls: t.className, text: t.firstChild ? t.firstChild.textContent : t.textContent, act: t.querySelector('.toast-act')?.textContent || '' }))`);
const clearToasts = (win) => js(win, `document.querySelectorAll('.toast').forEach(t => t.remove()); true`);
// «Buscar en YouTube» como lo hace el usuario (el diálogo de texto devuelve q)
const searchUI = (win, q) => js(win, `(async () => { const a = nexuraApp; const p = a.prompt; a.prompt = async () => ${JSON.stringify(q)}; try { await a.ytSearchDialog(); } finally { a.prompt = p; } return true; })()`);
const ytPage = async (win) => { await js(win, `nexuraApp.closeModal(); nexuraApp.settingsUI.open('youtube'); true`); await wait(500); };

let runs = 0;
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message, line, src) => { if (level >= 3) report.errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  win.webContents.on('did-finish-load', () => { if (runs++ === 0) run(win).catch(e => { check('la prueba termina sin excepciones', false, { e: String(e && e.stack || e) }); finish(); }); });
});

async function run(win) {
  win.setContentSize(1280, 800);
  await wait(3000);
  await js(win, `document.querySelector('.start-overlay')?.remove(); true`);

  // A) novedades tras actualizar
  let t = await toasts(win);
  const upd = t.find(x => /upd-notes/.test(x.cls));
  check('Al arrancar tras actualizar: «Nexura se ha actualizado a la ' + pkg.version + '» con «Ver novedades»', upd && upd.text === `Nexura se ha actualizado a la ${pkg.version}` && upd.act === 'Ver novedades', { t });
  await shot(win, '01-aviso-actualizado-1280');
  await js(win, `document.querySelector('.toast.upd-notes .toast-act').click(); true`);
  await wait(600);
  let s = await js(win, `(() => { const m = [...document.querySelectorAll('.modal')].pop(); return m ? { title: m.querySelector('.modal-title, h2, header')?.textContent || '', text: m.textContent, h3: m.querySelectorAll('.notes h3').length, li: m.querySelectorAll('.notes li').length } : null; })()`);
  check('«Ver novedades» abre las notas de la versión actual (' + pkg.version + ')', s && s.text.includes(pkg.version) && s.h3 >= 1 && s.li >= 1, s && { title: s.title, h3: s.h3, li: s.li });
  await shot(win, '02-novedades-1280');
  // el contenido de la rc.2 se comprueba en su propia sección, buscada por su versión (no la primera del archivo)
  await js(win, `nexuraApp.closeModal(); nexuraApp.notes.show('1.0.0-rc.2'); true`);
  await wait(600);
  s = await js(win, `(() => { const m = [...document.querySelectorAll('.modal')].pop(); return m ? { title: m.querySelector('.modal-title, h2, header')?.textContent || '', text: m.textContent, h3: m.querySelectorAll('.notes h3').length, li: m.querySelectorAll('.notes li').length } : null; })()`);
  check('Las notas de la 1.0.0-rc.2 (por su versión) en lenguaje sencillo', s && s.text.includes('1.0.0-rc.2') && s.h3 >= 3 && s.li >= 8 && /Comprobar clave/.test(s.text) && /30 búsquedas/.test(s.text), s && { title: s.title, h3: s.h3, li: s.li });
  await js(win, `nexuraApp.closeModal(); nexuraApp.notes.show(); true`);
  await wait(600);
  win.setContentSize(900, 640); // ancho mínimo de la ventana (375 px: tools/ui-check-rc2.cjs en modo navegador)
  await wait(500);
  s = await js(win, `(() => { const m = [...document.querySelectorAll('.modal')].pop(); const r = m.getBoundingClientRect(); return { left: r.left, right: r.right, vw: innerWidth, sw: document.documentElement.scrollWidth }; })()`);
  check('Novedades a 900 px (ancho mínimo de la ventana): cabe en la pantalla', s.left >= 0 && s.right <= s.vw && s.sw <= s.vw, s);
  await shot(win, '03-novedades-900');
  win.setContentSize(1280, 800);
  await js(win, `nexuraApp.closeModal(); true`);
  const saved = JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'));
  s = await js(win, `nexuraApp.settings.lastVersion`);
  check('Se guarda lastVersion = ' + pkg.version + ' (al volver a abrir ya no avisa)', s === pkg.version, { s, savedOnDisk: saved.lastVersion });
  s = await js(win, `nexuraApp.notes.check()`);
  check('Segunda comprobación con la misma versión: sin aviso', s === false, { s });

  // B) búsqueda por el servicio (sin clave)
  await clearToasts(win);
  s = await js(win, `nexuraApp.platform.info().then(i => i.services)`);
  check('La app ve el servicio de búsqueda (searchUrl)', s && s.search === true, s);
  await searchUI(win, 'daft punk');
  await wait(400);
  t = await toasts(win);
  s = await js(win, `[...nexuraApp.library.tracks.values()].filter(x => x.source === 'youtube').map(x => ({ id: x.id, title: x.title, d: x.duration }))`);
  const idFile = JSON.parse(fs.readFileSync(path.join(data, 'instalacion.id'), 'utf8'));
  check('Sin clave: la búsqueda va al servicio y los resultados se añaden a YouTube (con duración)', s.length === 2 && s[0].id === 'yt_aaaaaaaaaa1' && s[0].d === 321 && t.some(x => /2 resultados añadidos/.test(x.text)), { s, t });
  check('Al servicio solo le llega { id, q, max } con el id anónimo de la instalación (estadísticas desactivadas)', got.length === 1 && Object.keys(got[0]).sort().join() === 'id,max,q' && got[0].id === idFile.id && got[0].q === 'daft punk' && got[0].max === 25 && !google.length, { got, idFile: idFile.id, google });
  await shot(win, '04-busqueda-servicio');

  await clearToasts(win);
  mode = 'limit';
  await searchUI(win, 'otra');
  await wait(300);
  t = await toasts(win);
  check('Límite diario (429): «Has llegado al límite diario…» con «Poner mi clave»', t.some(x => x.text === 'Has llegado al límite diario de búsquedas gratuitas. Mañana se renueva, o pon tu propia clave en Ajustes → YouTube.' && /warn/.test(x.cls) && x.act === 'Poner mi clave'), { t });
  await shot(win, '05-limite-diario');
  await js(win, `[...document.querySelectorAll('.toast-act')].find(b => b.textContent === 'Poner mi clave').click(); true`);
  await wait(500);
  s = await js(win, `!!document.querySelector('.set-tab.on') && document.querySelector('.set-tab.on').textContent`);
  check('«Poner mi clave» abre Ajustes → YouTube', s === 'YouTube', { s });
  await js(win, `nexuraApp.closeModal(); true`);

  await clearToasts(win);
  mode = 'down';
  await searchUI(win, 'caido');
  await wait(300);
  t = await toasts(win);
  check('Servicio con fallo (503): «no responde ahora mismo»', t.some(x => /El servicio de búsqueda de NexuraIA no responde ahora mismo/.test(x.text) && /error/.test(x.cls)), { t });
  await clearToasts(win);
  server.close(); for (const so of sockets) so.destroy();
  await wait(200);
  await searchUI(win, 'apagado');
  await wait(500);
  t = await toasts(win);
  check('Servicio caído (puerto cerrado): mismo mensaje, sin colgarse', t.some(x => /no responde ahora mismo/.test(x.text)), { t });

  // C) prioridad de la clave propia
  await clearToasts(win);
  const before = got.length;
  await js(win, `nexuraApp.setSetting('ytApiKey', 'AIzaPROPIA123'); true`);
  await searchUI(win, 'con clave');
  await wait(300);
  s = await js(win, `!!nexuraApp.library.get('yt_bbbbbbbbbb1')`);
  check('Con clave propia se usa la clave (Google) y el servicio no recibe nada', s && google.some(g => g.path.endsWith('/search') && g.key === 'AIzaPROPIA123' && g.q === 'con clave') && got.length === before, { s, google, got: got.length - before });

  // D) Ajustes → YouTube: clave oculta y «Comprobar clave»
  win.show(); win.focus(); win.webContents.focus();
  await js(win, `nexuraApp.setSetting('ytClientSecret', 'GOCSPX-secreto-de-prueba'); true`);
  await ytPage(win);
  const field = `[...document.querySelectorAll('.secret-box input.secret')]`;
  s = await js(win, `(() => { const [k, c] = ${field}; return { k: k.value, kt: k.type, c: c.value, ct: c.type, html: document.querySelector('.set-page').outerHTML.includes('AIzaPROPIA123') || document.querySelector('.set-page').outerHTML.includes('GOCSPX-secreto') }; })()`);
  check('La clave se muestra como «AIza••••••••» y el Client secret también oculto', s.k === 'AIza••••••••' && s.c === 'GOCS••••••••' && !s.html, s);
  await shot(win, '06-ajustes-youtube-1280');
  await js(win, `document.querySelector('.secret-box .eye').click(); true`);
  await wait(200);
  s = await js(win, `(() => { const k = ${field}[0]; return { v: k.value, ro: k.readOnly }; })()`);
  check('👁 enseña la clave', s.v === 'AIzaPROPIA123' && s.ro, s);
  await shot(win, '07-clave-visible');
  await wait(5200);
  s = await js(win, `${field}[0].value`);
  check('…y a los 5 s vuelve a ocultarse', s === 'AIza••••••••', { s });
  s = await js(win, `(() => { const k = ${field}[0]; k.focus(); k.dispatchEvent(new Event('focus')); return { v: k.value, t: k.type, ph: k.placeholder }; })()`);
  check('Al entrar en el campo: tipo contraseña y vacío para pegar una nueva', s.v === '' && s.t === 'password' && /Pega una nueva/.test(s.ph), s);
  await js(win, `(() => { const k = ${field}[0]; k.blur(); k.dispatchEvent(new Event('blur')); return true; })()`);
  s = await js(win, `[${field}[0].value, nexuraApp.settings.ytApiKey]`);
  check('Salir sin escribir nada conserva la clave', s[0] === 'AIza••••••••' && s[1] === 'AIzaPROPIA123', { s });

  const checkKey = async (key) => {
    await js(win, `(() => { const k = ${field}[0]; k.focus(); k.dispatchEvent(new Event('focus')); k.value = ${JSON.stringify(key)}; k.dispatchEvent(new Event('input')); k.blur(); k.dispatchEvent(new Event('blur')); return true; })()`);
    await js(win, `[...document.querySelectorAll('.set-page button')].find(b => b.textContent === 'Comprobar clave').click(); true`);
    await wait(500);
    return js(win, `({ msg: document.querySelector('.key-check').textContent, cls: document.querySelector('.key-check').className, saved: nexuraApp.settings.ytApiKey, shown: ${field}[0].value })`);
  };
  s = await checkKey('AIzaOK999');
  check('Comprobar clave correcta: «✓ Clave correcta» (y la nueva queda guardada y oculta)', s.msg === '✓ Clave correcta' && /ok/.test(s.cls) && s.saved === 'AIzaOK999' && s.shown === 'AIza••••••••', s);
  await shot(win, '08-clave-correcta');
  s = await checkKey('AIzaMAL');
  check('Comprobar clave no válida: error en claro', /✗ La clave no es válida/.test(s.msg) && /error/.test(s.cls), s);
  s = await checkKey('AIzaCUOTA');
  check('Comprobar clave con la cuota agotada: lo dice en claro', /gastado toda su cuota/.test(s.msg), s);
  await shot(win, '09-clave-cuota');
  s = await checkKey('AIzaSINAPI');
  check('Comprobar clave con la API sin habilitar: lo dice en claro', /no está habilitada/.test(s.msg), s);
  const gk = google.filter(g => g.path.endsWith('/search')).slice(-4).map(g => g.key);
  check('«Comprobar clave» prueba la clave escrita (búsqueda mínima a Google)', gk.join() === 'AIzaOK999,AIzaMAL,AIzaCUOTA,AIzaSINAPI', { gk });
  win.setContentSize(900, 640); // ancho mínimo de la ventana (375 px: tools/ui-check-rc2.cjs en modo navegador)
  await wait(500);
  s = await js(win, `(() => { const b = document.querySelector('.secret-box').getBoundingClientRect(); return { right: b.right, vw: innerWidth, sw: document.documentElement.scrollWidth }; })()`);
  await shot(win, '10-ajustes-youtube-900');
  check('Ajustes → YouTube a 900 px: el campo de la clave cabe', s.right <= s.vw && s.sw <= s.vw, s);
  win.setContentSize(1280, 800);
  await js(win, `nexuraApp.closeModal(); true`);

  // E) sin servicio ni clave
  await clearToasts(win);
  await js(win, `nexuraApp.setSetting('ytApiKey', ''); nexuraApp.youtube.canSearch = async () => false; true`);
  await searchUI(win, 'nada');
  await wait(500);
  t = await toasts(win);
  s = await js(win, `document.querySelector('.set-tab.on')?.textContent`);
  check('Sin servicio ni clave: aviso con «Ver la guía» y se abre Ajustes → YouTube', t.some(x => /guía del README/.test(x.text) && x.act === 'Ver la guía') && s === 'YouTube', { t, s });
  await js(win, `[...document.querySelectorAll('.toast-act')].find(b => b.textContent === 'Ver la guía').click(); true`);
  await wait(300);
  check('«Ver la guía» abre la guía del README en el navegador', opened.some(u => u.startsWith('https://github.com/mcontrerasdevpro/nexura-dj-studio')), { opened });
  finish();
}

function finish() {
  report.errors = report.errors.filter(e => !/favicon|ERR_PROXY|iframe_api|youtube\.com/i.test(e));
  if (report.errors.length) { report.ok = false; console.log('✗ errores en consola: ' + report.errors.join(' | ')); }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  const n = Object.values(report.checks);
  console.log(`\n${n.filter(c => c.ok).length}/${n.length} comprobaciones · ${report.ok ? 'TODO OK' : 'HAY FALLOS'} · informe en .revision/rc2/informe.json`);
  try { server.close(); } catch (_) { /* cerrado */ }
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* en uso */ } app.exit(report.ok ? 0 : 1); }, 300);
}

require(path.join(root, 'main.js'));
