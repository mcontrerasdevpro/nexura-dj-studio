// Encargo BIBLIOTECA2 en la app de escritorio REAL (main.js) con datos y carpetas en una carpeta temporal:
// - panel «Archivos»: unidades (con su letra) y carpetas Música y Documentos; contenido de una carpeta sin las
//   ocultas ni las del sistema, solo con archivos de audio; carpeta que no existe o sin permiso;
// - navegar por las columnas, archivos de la carpeta en la tabla (los de la biblioteca con sus datos; los demás,
//   más apagados y con las etiquetas del archivo), última carpeta recordada al volver a abrir;
// - arrastrar un archivo a un deck (se carga sin añadirlo a la biblioteca) y a una crate (se añade a las dos);
// - «Añadir esta carpeta a la biblioteca» (la importación de carpetas de siempre, con crates por carpeta);
// - buscador con selector de campos (recordado, icono marcado si hay campos desmarcados);
// - carpeta de grabación: «Cambiar…» en la franja y en Ajustes; si deja de existir, se graba en la de siempre y
//   se avisa;
// - sin rutas en el informe de errores ni en el diagnóstico; sin errores en la consola.
// Uso: npx electron tools/ui-check-archivos.cjs  (captura en .revision/capturas-biblioteca/)
'use strict';
const electron = require('electron');
const { app, shell, dialog } = electron;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clickWav } = require('./click-wav.cjs');

const root = path.join(__dirname, '..');
const OUT = path.join(root, '.revision', 'capturas-biblioteca');
const pkg = require(path.join(root, 'package.json'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-archivos-'));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
shell.openExternal = async () => {};
shell.showItemInFolder = () => {};
app.getVersion = () => pkg.version;
process.env.NEXURA_USER_DATA = path.join(tmp, 'datos');
process.env.NEXURA_NO_UPDATES = '1';

// carpetas de prueba: Música (con subcarpetas, una oculta, una «del sistema» y un archivo que no es audio) y
// Documentos; la carpeta de usuario Música de la app apunta aquí (también la de grabación de siempre)
const music = path.join(tmp, 'Música'), docs = path.join(tmp, 'Documentos'), setA = path.join(music, 'Set A'), sub = path.join(setA, 'Sub');
for (const d of [sub, path.join(music, '.oculta'), path.join(music, 'AppData'), docs]) fs.mkdirSync(d, { recursive: true });
const wav = (p, s) => fs.writeFileSync(p, clickWav({ bpm: 124, seconds: s, firstBeat: 0.2 }));
const pIn = path.join(setA, 'Ya en biblioteca.wav'), pOut = path.join(setA, 'DJ Prueba - Tema B.wav'), pSub = path.join(sub, 'Tema C.wav');
wav(pIn, 6); wav(pOut, 12); wav(pSub, 6); wav(path.join(music, '.oculta', 'oculto.wav'), 2);
fs.writeFileSync(path.join(setA, 'notas.txt'), 'no es audio');
const recA = path.join(tmp, 'Mis grabaciones');
fs.mkdirSync(recA);
const getPath = app.getPath.bind(app);
app.getPath = (k) => (k === 'music' ? music : k === 'documents' ? docs : getPath(k));
// diálogo de carpeta («Cambiar…»): elige recA
let dialogCalls = 0;
dialog.showOpenDialog = async () => { dialogCalls++; return { canceled: false, filePaths: [recA] }; };

const track = (id, p, title, artist, extra) => ({ id, path: p, source: 'local', title, artist, album: 'Álbum de prueba', genre: 'House', bpm: 124, firstBeat: 0.2, key: '', camelot: '8A', duration: 6, size: 1, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: 1, plays: 0, lastPlayed: 0, analyzed: true, energy: 5, sections: [], ...extra });
const lib = { version: 1, tracks: [track('yaesta', pIn, 'Ya en la biblioteca', 'Artista Conocido')], crates: [{ id: 'k1', name: 'Mi crate', ids: [] }], smart: [], history: [], prepare: [], ytPlaylists: [] };
const data = path.join(process.env.NEXURA_USER_DATA, 'data');
fs.mkdirSync(path.join(data, 'waveforms'), { recursive: true });
fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify(lib));
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ welcomeDone: true, statsEnabled: false, autoUpdate: false, lastVersion: pkg.version, autoAnalyze: false, autoGain: false, waveLayout: 'serato', screenView: 'lib', libView: 'all' }));

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) pass++; else fail++; console.log(`${ok ? '✓' : '✗'} ${name}${!ok && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 500) : ''}`); };
const errors = [];
let mainWin = null;

app.on('browser-window-created', (_e, win) => {
  if (mainWin) return; // ventana oculta del analizador
  mainWin = win;
  win.webContents.on('console-message', (_ev, level, message, line, src) => { if (level >= 3) errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  win.webContents.once('did-finish-load', () => run(win).catch(e => { check('la prueba ha fallado', false, String(e && e.stack || e)); }).finally(finish));
});
const js = (win, code) => win.webContents.executeJavaScript(code, true);
const ready = async (win) => {
  for (let i = 0; i < 300; i++) { if (await js(win, `!!(window.nexuraApp && typeof nexuraApp.flushAll === 'function' && nexuraApp.updatesUI)`).catch(() => false)) break; await wait(50); }
  await wait(500);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); document.querySelectorAll('.toast').forEach(t => t.remove()); nexuraApp.engine.setMaster(0); true`);
};
// espera a que se cumpla una condición en la página
const until = async (win, cond, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(win, cond).catch(() => false)) return true; await wait(100); } return false; };
const J = JSON.stringify;
// arrastrar de verdad: dragstart en la fila (rellena el DataTransfer como siempre) y drop sobre el destino
const DRAG = (rowTitle, target) => `(() => {
  const ui = nexuraApp.libraryUI, i = ui.rows.findIndex(t => t.title === ${J(rowTitle)});
  if (i < 0) return 'sin fila';
  ui.selectOnly(i);
  const row = document.querySelector('.lib-rows .row-t[data-i="' + i + '"]'), dst = document.querySelector(${J(target)});
  if (!row || !dst) return 'sin fila o destino';
  const dt = new DataTransfer();
  row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return dt.types.join(',');
})()`;

async function run(win) {
  win.setContentSize(1920, 1080);
  await ready(win);

  // ---------------------------------------------------------------- IPC: unidades, carpetas de usuario y carpetas
  const roots = await js(win, `nexura.files.roots()`);
  const music0 = roots.places.find(p => p.name === 'Música'), docs0 = roots.places.find(p => p.name === 'Documentos');
  const winDrives = process.platform !== 'win32' || roots.drives.some(d => /^[A-Z]:$/.test(d.letter) && d.path === d.letter + '\\');
  check(`Unidades y carpetas de usuario: Música y Documentos (${roots.drives.map(d => d.letter + (d.name ? ' «' + d.name + '»' : '')).join(', ')})`, music0 && music0.path === music && docs0 && docs0.path === docs && roots.drives.length > 0 && winDrives, roots);
  check('…con el nombre del volumen de las unidades (si Windows lo da)', process.platform !== 'win32' || roots.drives.some(d => d.name), roots.drives);
  let ls = await js(win, `nexura.files.list(${J(music)})`);
  check('Listar Música: subcarpetas sin las ocultas ni las del sistema', J(ls.dirs.map(d => d.name)) === J(['Set A']) && !ls.files.length && !ls.error, ls);
  ls = await js(win, `nexura.files.list(${J(setA)})`);
  check('Listar «Set A»: su subcarpeta y solo los archivos de audio (sin leer subcarpetas)', J(ls.dirs.map(d => d.name)) === J(['Sub']) && J(ls.files.map(f => f.name)) === J(['DJ Prueba - Tema B.wav', 'Ya en biblioteca.wav']) && ls.files.every(f => f.size > 0), ls);
  const gone = await js(win, `nexura.files.list(${J(path.join(music, 'no existe'))})`);
  check('Carpeta que no existe: error «missing», sin excepción', gone.error === 'missing' && !gone.files.length, gone);
  if (process.platform === 'win32') {
    const sys = await js(win, `nexura.files.list('C:\\\\System Volume Information')`);
    check('Carpeta sin permiso (C:\\System Volume Information): error «denied», sin excepción', sys.error === 'denied' || sys.error === 'missing', sys);
    const c = await js(win, `nexura.files.list('C:\\\\')`);
    check('Raíz de C:: sin Windows, Program Files, $Recycle.Bin ni System Volume Information', !c.error && !c.dirs.some(d => /^(windows|program files|programdata|\$recycle\.bin|system volume information)$/i.test(d.name)), c.dirs.map(d => d.name));
  }

  // ---------------------------------------------------------------- navegar por las columnas
  await js(win, `document.querySelector('.lib-quick .lib-qbtn[aria-label="Archivos"]').click(); true`);
  await until(win, `!!document.querySelector('.fb-roots .fb-item')`);
  let r = await js(win, `({ view: nexuraApp.libraryUI.viewId, panel: !document.querySelector('.lib-files').hidden, on: document.querySelector('.lib-qbtn[aria-label="Archivos"]').classList.contains('on'), side: !!document.querySelector('.side-item[data-view="files"]'), roots: [...document.querySelectorAll('.fb-roots .fb-item span')].map(s => s.textContent) })`);
  check('Acceso rápido «Archivos» (y en el árbol): abre el panel con Música, Documentos y las unidades', r.view === 'files' && r.panel && r.on && r.side && r.roots.includes('Música') && r.roots.includes('Documentos') && r.roots.some(x => /\([A-Z]:\)$/.test(x)), r);
  await js(win, `document.querySelector(${J(`.fb-roots .fb-item[data-path="${music.replace(/\\/g, '\\\\')}"]`)}).click(); true`);
  await until(win, `document.querySelectorAll('.fb-col').length === 2`);
  await js(win, `[...document.querySelectorAll('.fb-col')][1].querySelector('.fb-item').click(); true`);
  await until(win, `nexuraApp.libraryUI.rows.length === 2`);
  r = await js(win, `(() => { const ui = nexuraApp.libraryUI; return { cols: [...document.querySelectorAll('.fb-col .fb-head')].map(h => h.firstChild.textContent), rows: ui.rows.map(t => ({ t: t.title, a: t.artist, ext: !!t.external })), extRows: [...document.querySelectorAll('.lib-rows .row-t.ext')].length, title: ui.viewTitle.textContent, path: document.querySelector('.fb-path').textContent, status: document.querySelector('.fb-status').textContent }; })()`);
  check('Pulsar Música → Set A: columnas siguientes y sus 2 archivos de audio en la tabla', J(r.cols) === J(['EQUIPO', 'Música', 'Set A']) && r.rows.length === 2 && r.path === setA && r.title === 'Archivos › Set A' && /2 archivos de audio · 1 en la biblioteca/.test(r.status), r);
  check('…el que ya está en la biblioteca, con sus datos; el otro, más apagado (◌) y con «Artista - Título» del nombre', r.rows.some(x => x.t === 'Ya en la biblioteca' && x.a === 'Artista Conocido' && !x.ext) && r.rows.some(x => x.t === 'Tema B' && x.a === 'DJ Prueba' && x.ext) && r.extRows === 1, r);
  const meta = await until(win, `(() => { const t = nexuraApp.libraryUI.rows.find(x => x.title === 'Tema B'); return t && Math.abs(t.duration - 12) < 0.2; })()`);
  check('…las etiquetas y la duración del archivo llegan en segundo plano (12 s)', meta, await js(win, `nexuraApp.libraryUI.rows.map(t => [t.title, t.duration])`));
  await wait(200);
  fs.mkdirSync(OUT, { recursive: true });
  win.webContents.invalidate(); await wait(500);
  fs.writeFileSync(path.join(OUT, 'despues-archivos-1920x1080.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura despues-archivos-1920x1080');
  check('Se recuerda la última carpeta abierta', (await js(win, `nexuraApp.settings.filesDir`)) === setA);

  // ---------------------------------------------------------------- buscador con selector de campos
  await js(win, `document.querySelector('.search-fields').click(); true`);
  r = await js(win, `[...document.querySelectorAll('.sf-menu .sf-opt')].map(o => [o.textContent, o.querySelector('input').checked])`);
  check('Selector de campos junto al buscador: título, artista, álbum, género, comentario, BPM, tonalidad (y año), todos marcados', J(r.map(x => x[0])) === J(['Título', 'Artista', 'Álbum', 'Género', 'Comentario', 'BPM', 'Tonalidad', 'Año']) && r.every(x => x[1]), r);
  const search = async (q) => { await js(win, `(() => { const s = nexuraApp.libraryUI.searchIn; s.value = ${J(q)}; s.dispatchEvent(new Event('input')); return true; })()`); await wait(400); return js(win, `nexuraApp.libraryUI.rows.map(t => t.title)`); };
  let hits = await search('dj prueba');
  check('Con todos los campos, «dj prueba» encuentra la pista por el artista', J(hits) === J(['Tema B']), hits);
  await js(win, `document.querySelector('.sf-menu input[data-field="artist"]').click(); true`);
  await wait(300);
  hits = await search('dj prueba');
  r = await js(win, `({ on: document.querySelector('.search-fields').classList.contains('on'), dot: getComputedStyle(document.querySelector('.search-fields .sf-dot')).display, saved: nexuraApp.settings.searchFields, ph: nexuraApp.libraryUI.searchIn.placeholder })`);
  check('Desmarcar «Artista»: ya no la encuentra, el icono se marca y la elección se guarda', !hits.length && r.on && r.dot === 'block' && Array.isArray(r.saved) && !r.saved.includes('artist') && /album|álbum/.test(r.ph), { hits, r });
  hits = await search('álbum de prueba');
  check('…y el álbum sigue buscándose', J(hits) === J(['Ya en la biblioteca']), hits);
  await js(win, `document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  await search('');
  check('El desplegable se cierra con un clic fuera', !(await js(win, `!!document.querySelector('.sf-menu')`)));

  // ---------------------------------------------------------------- arrastrar a un deck y a una crate
  let types = await js(win, DRAG('Tema B', '#deck0'));
  await until(win, `nexuraApp.decks[0].track && nexuraApp.decks[0].track.title === 'Tema B'`, 10000);
  r = await js(win, `(() => { const d = nexuraApp.decks[0], L = nexuraApp.library; return { types: ${J(types)}, track: d.track && d.track.path, external: !!(d.track && d.track.external), inLib: !!L.byPath(${J(pOut)}), n: L.tracks.size, dur: Math.round(d.duration) }; })()`);
  check('Arrastrar «Tema B» (no está en la biblioteca) al Deck 1: se carga sin añadirlo a la biblioteca', r.track === pOut && r.external && !r.inLib && r.n === 1 && r.dur === 12, r);
  types = await js(win, DRAG('Tema B', '.side-item[data-view="crate:k1"]'));
  await wait(500);
  r = await js(win, `(() => { const L = nexuraApp.library, t = L.byPath(${J(pOut)}); return { inLib: !!t, crate: L.crate('k1').ids, id: t && t.id, ext: t && !!t.external, rowExt: nexuraApp.libraryUI.rows.find(x => x.title === 'Tema B')?.external, deckSame: nexuraApp.decks[0].track === t }; })()`);
  check('Arrastrarlo a la crate «Mi crate»: se añade a la biblioteca y a la crate (y deja de verse apagado)', r.inLib && r.crate.includes(r.id) && !r.ext && !r.rowExt && r.deckSame, r);

  // ---------------------------------------------------------------- añadir la carpeta
  await js(win, `document.querySelector('.fb-add').click(); true`);
  await until(win, `!!nexuraApp.library.byPath(${J(pSub)})`, 8000);
  r = await js(win, `(() => { const L = nexuraApp.library; const c = L.crates.find(x => x.name === 'Set A'), s = c && L.crates.find(x => x.name === 'Sub' && x.parent === c.id); return { n: L.tracks.size, sub: !!L.byPath(${J(pSub)}), crate: !!c, subcrate: !!s, status: document.querySelector('.fb-status').textContent }; })()`);
  check('«Añadir esta carpeta a la biblioteca»: importa Set A y sus subcarpetas (crates «Set A» › «Sub»)', r.n === 3 && r.sub && r.crate && r.subcrate && /2 en la biblioteca/.test(r.status), r);

  // ---------------------------------------------------------------- volver a abrir: vista y carpeta recordadas
  await js(win, `nexuraApp.flushAll()`);
  win.webContents.reload();
  await new Promise(res => win.webContents.once('did-finish-load', res));
  await ready(win);
  await until(win, `nexuraApp.libraryUI.files.dir && nexuraApp.libraryUI.rows.length === 2`, 8000);
  r = await js(win, `({ view: nexuraApp.libraryUI.viewId, dir: nexuraApp.libraryUI.files.dir && nexuraApp.libraryUI.files.dir.path, cols: document.querySelectorAll('.fb-col').length, on: [...document.querySelectorAll('.fb-item.on span')].map(s => s.textContent), fields: document.querySelector('.search-fields').classList.contains('on') })`);
  check('Al volver a abrir: panel Archivos en la última carpeta (Música › Set A) y campos del buscador recordados', r.view === 'files' && r.dir === setA && r.cols === 3 && J(r.on) === J(['Música', 'Set A']) && r.fields, r);
  await js(win, `nexuraApp.libraryUI.setFields(Object.keys(nexuraApp.libraryUI.chosenFields().length ? { title: 1, artist: 1, album: 1, genre: 1, comment: 1, bpm: 1, key: 1, year: 1 } : {})); true`);
  check('Marcar todos: el icono vuelve a la normalidad (se guarda «todos»)', !(await js(win, `document.querySelector('.search-fields').classList.contains('on')`)) && (await js(win, `nexuraApp.settings.searchFields`)) === null);

  // ---------------------------------------------------------------- carpeta de grabación
  const defRec = path.join(music, 'Nexura DJ Studio', 'Grabaciones');
  await js(win, `nexuraApp.settings.panels.rec = false; nexuraApp.togglePanel('rec'); true`);
  r = await js(win, `({ where: document.querySelector('#recbar .rec-where').textContent, change: !!document.querySelector('#recbar .rec-change:not([hidden])') })`);
  check('Franja de grabación: carpeta de siempre y botón «Cambiar…»', r.where === defRec && r.change, r);
  await js(win, `document.querySelector('#recbar .rec-change').click(); true`);
  await until(win, `nexuraApp.settings.recDir === ${J(recA)}`);
  r = await js(win, `({ recDir: nexuraApp.settings.recDir, where: document.querySelector('#recbar .rec-where').textContent })`);
  check('«Cambiar…» (diálogo de carpeta): se guarda la carpeta elegida y la franja la muestra', dialogCalls === 1 && r.recDir === recA && r.where === recA, r);
  const record = async () => { await js(win, `nexuraApp.engine.resume(); nexuraApp.toggleRecord(); true`); await wait(700); await js(win, `nexuraApp.toggleRecord()`); await wait(800); return js(win, `({ last: nexuraApp.lastRecording, toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent), warn: document.querySelector('#recbar .rec-where').classList.contains('warn') })`); };
  r = await record();
  check('Grabar: el WAV se guarda en la carpeta elegida', r.last && path.dirname(r.last) === recA && fs.existsSync(r.last) && fs.statSync(r.last).size > 1000, r);
  fs.rmSync(recA, { recursive: true, force: true });
  await js(win, `document.querySelectorAll('.toast').forEach(t => t.remove()); true`);
  r = await record();
  check('Si la carpeta elegida deja de existir: se graba en la de siempre y se avisa (aviso y carpeta en ámbar)', r.last && path.dirname(r.last) === defRec && fs.existsSync(r.last) && r.toasts.some(t => /ya no existe/.test(t) && /la de siempre/.test(t)) && r.warn, r);
  await js(win, `nexuraApp.settingsUI.open('audio'); true`);
  await wait(600);
  r = await js(win, `(() => { const row = [...document.querySelectorAll('.set-row')].find(x => /Carpeta de las grabaciones/.test(x.textContent)); return row ? { text: row.textContent, change: !!row.querySelector('.rec-dir-change'), warn: !!row.querySelector('.set-path.warn') } : null; })()`);
  check('Ajustes → Audio → Grabación: carpeta, «Cambiar…», «Usar la de siempre» y el aviso', r && r.change && /Usar la de siempre/.test(r.text) && /ya no existe/.test(r.text) && r.warn, r);
  await js(win, `nexuraApp.closeModal(); true`);

  // ---------------------------------------------------------------- privacidad: sin rutas en el informe
  const rep = await js(win, `nexura.report.preview({ ...nexuraApp.feedback.context(), known: nexuraApp.feedback.knownNames() })`);
  const txt = J(rep);
  const leaks = [tmp, music, setA, 'Set A', 'Tema B', 'Mis grabaciones', os.userInfo().username].filter(s => s && s.length > 2 && txt.toLowerCase().includes(s.toLowerCase()));
  check('Informe de errores y diagnóstico sin rutas ni nombres de carpetas o archivos', !leaks.length && rep.perfLines.some(l => /^Arranque: MIDI/.test(l)), { leaks, perf: rep.perfLines });

  const errs = errors.filter(e => !/favicon|requestMIDIAccess/.test(e));
  check('Sin errores en la consola', !errs.length, errs);
}

let done = false;
function finish() {
  if (done) return; done = true;
  console.log(`\n${pass}/${pass + fail} comprobaciones del panel Archivos, el buscador y la carpeta de grabación correctas`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* en uso */ }
  app.exit(fail ? 1 : 0);
}
setTimeout(() => { check('tiempo agotado', false); finish(); }, 180000).unref();

require(path.join(root, 'main.js'));
