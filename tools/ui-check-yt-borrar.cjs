// Borrar listas y vídeos de YouTube desde la barra lateral, con Electron contra `npm run web`:
// A) 148 vídeos sueltos (sin lista): menú de «YouTube · todos los vídeos» → confirmación → se quitan de la
//    biblioteca, crates y Prepare, la entrada desaparece y la vista pasa a «Todas las pistas»; «Deshacer»
//    los devuelve; Supr con el foco en esa fila pide confirmación (Cancelar no borra).
// B) lista importada: «Eliminar lista y sus vídeos» (los que están en otra lista o en una crate se quedan),
//    Ctrl+Z; Supr / Ctrl+Supr con el foco en la fila de la lista → confirmación → solo la lista; Deshacer.
// Capturas e informe en .revision/yt-borrar/. Uso: npx electron tools/ui-check-yt-borrar.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.revision', 'yt-borrar');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1280, 800], [375, 812]];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const track = (id, extra) => ({
  id, path: `web:${id}.mp3:1`, source: 'local', title: id, artist: 'Artista', album: '', genre: 'House', year: '2024', comment: '', rating: 0,
  bpm: 124, firstBeat: 0.1, key: '', camelot: '8A', duration: 200, size: 1, rmsDb: -10, cues: Array(8).fill(null), loops: Array(8).fill(null),
  cueLoops: Array(8).fill(null), added: Date.now(), plays: 0, lastPlayed: 0, analyzed: true, energy: 5, sections: [], ...extra
});
const video = (v) => track('yt_' + v, { path: 'youtube:' + v, source: 'youtube', ytId: v, title: 'Vídeo ' + v, analyzed: false, bpm: 0, camelot: '' });

// A: 10 pistas locales + 148 vídeos sueltos (algunos en una crate y en Prepare)
function seedLoose() {
  const tracks = [];
  for (let i = 0; i < 10; i++) tracks.push(track('t' + i));
  for (let i = 0; i < 148; i++) tracks.push(video('s' + i));
  return {
    library: { version: 1, tracks, crates: [{ id: 'mix', name: 'Mezcla', ids: ['t1', 'yt_s0', 't2', 'yt_s5'], created: Date.now() }], smart: [], history: [], prepare: ['yt_s1', 't3'], ytPlaylists: [] },
    settings: { libView: 'yt-all', crateSort: 'custom', waveLayout: 'serato', libSideW: 230 }
  };
}
// B: lista importada de 5 vídeos; v2 también en otra lista, v3 en una crate
function seedList() {
  const tracks = [track('t0')];
  for (let i = 1; i <= 6; i++) tracks.push(video('v' + i));
  return {
    library: { version: 1, tracks, crates: [{ id: 'mix', name: 'Mezcla', ids: ['t0', 'yt_v3'], created: Date.now() }], smart: [], history: [], prepare: ['yt_v4'],
      ytPlaylists: [{ id: 'pla', playlistId: 'PLA', title: 'Lista A', ids: ['yt_v1', 'yt_v2', 'yt_v3', 'yt_v4', 'yt_v5'] }, { id: 'plb', playlistId: 'PLB', title: 'Lista B', ids: ['yt_v2', 'yt_v6'] }] },
    settings: { libView: 'yt:pla', crateSort: 'custom', waveLayout: 'serato', libSideW: 230 }
  };
}

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(400);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura', name);
}
async function key(win, keyCode, modifiers = [], ms = 250) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await wait(ms);
}
async function open(win, data) {
  // la app guarda biblioteca y ajustes al salir (beforeunload): se desactiva para que no pise los datos de prueba
  const put = `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify({ welcomeDone: true, screenView: 'mix', viewDefaultV2: true, ...data.settings }))});`;
  await js(win, `${put} if (window.nexuraApp && nexuraApp.library) { nexuraApp.library.save = () => {}; nexuraApp.library.saveSoon = () => {}; window.addEventListener('beforeunload', () => { ${put} }); } true`);
  await load(win);
  await wait(2500);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); document.querySelector('#library').scrollIntoView({ block: 'end' });
    const lib = document.querySelector('#library'); if (!document.querySelector('.lib-side').offsetWidth) nexuraApp.libraryUI.sideToggle.click(); true`);
  win.focus(); win.webContents.focus();
}
const state = `(() => { const L = nexuraApp.library, ui = nexuraApp.libraryUI; const t = [...document.querySelectorAll('.toast')].pop();
  const item = (v) => { const it = document.querySelector('.side-item[data-view="' + v + '"]'); return it ? (it.querySelector('.si-count') || {}).textContent || '' : null; };
  return { n: L.tracks.size, yt: L.ytTrackIds().length, view: ui.viewId, ytAll: item('yt-all'), lists: L.ytPlaylists.map(p => p.title + ':' + p.ids.join(',')).join(' | '),
    crate: L.crate('mix').ids.join(','), prepare: L.prepare.join(','), aviso: t ? t.firstChild.textContent : '', deshacer: !!(t && t.querySelector('.toast-act')),
    dialogo: (document.querySelector('.modal-ov p') || {}).textContent || '' }; })()`;
// abre el menú contextual de una fila de la barra lateral y devuelve los textos de sus elementos
const menu = (win, view) => js(win, `(() => { const it = document.querySelector('.side-item[data-view="${view}"]'); const r = it.getBoundingClientRect();
  it.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 10 }));
  return [...document.querySelectorAll('.ctx.root > .ctx-item, .ctx > .ctx-item')].map(x => x.textContent); })()`);
const pickMenu = (win, re) => js(win, `(() => { const it = [...document.querySelectorAll('.ctx-item')].find(x => ${re}.test(x.textContent)); if (!it) return false; it.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true; })()`);
const answer = (win, i) => js(win, `(() => { const b = document.querySelectorAll('.modal-ov .modal-foot button')[${i}]; if (!b) return false; b.click(); return true; })()`);
const focusSide = (win, view) => js(win, `(() => { const ui = nexuraApp.libraryUI; ui.toggleFocus('side'); const it = document.querySelector('.side-item[data-view="${view}"]'); ui.setSideCur(it); it.focus(); return document.activeElement === it; })()`);
const clearToasts = (win) => js(win, `document.querySelectorAll('.toast').forEach(t => t.remove()); true`);
const undoBtn = (win) => js(win, `(() => { const b = [...document.querySelectorAll('.toast-act')].pop(); if (!b) return false; b.click(); return true; })()`);

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {}, ok: true };
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    const check = (name, cond, data) => { report.checks[`${tag} · ${name}`] = { ok: !!cond, ...data }; if (!cond) { report.ok = false; console.log('✗', tag, name, JSON.stringify(data)); } else console.log('✓', tag, name); };
    const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${tag} ${message} (${path.basename(src || '')}:${line})`); });
    await load(win);

    // ---------------- A) vídeos sueltos
    await open(win, seedLoose());
    let s = await js(win, state);
    check('«YouTube · todos los vídeos» con 148 y sin listas', s.ytAll === '148' && s.yt === 148 && s.view === 'yt-all' && !s.lists, { s });
    const items = await menu(win, 'yt-all');
    await shot(win, `${tag}-01-menu-todos`);
    check('Menú: «Quitar todos los vídeos de YouTube de la biblioteca (148)»', items.some(t => /Quitar todos los vídeos de YouTube de la biblioteca \(148\)/.test(t)), { items });
    await pickMenu(win, '/Quitar todos los vídeos/');
    await wait(250);
    s = await js(win, state);
    await shot(win, `${tag}-02-confirmar-todos`);
    check('Pide confirmación (148 vídeos)', /148 vídeos/.test(s.dialogo) && s.yt === 148, { dialogo: s.dialogo });
    await answer(win, 1);
    await wait(400);
    s = await js(win, state);
    await shot(win, `${tag}-03-quitados`);
    check('Se quitan los 148 (las locales siguen) y también de la crate y de Prepare', s.yt === 0 && s.n === 10 && s.crate === 't1,t2' && s.prepare === 't3', { s });
    check('La entrada «YouTube · todos los vídeos» desaparece y la vista pasa a «Todas las pistas»', s.ytAll === null && s.view === 'all', { ytAll: s.ytAll, view: s.view });
    check('Aviso con «Deshacer»', s.deshacer && /148 vídeos de YouTube quitados/.test(s.aviso), { aviso: s.aviso });
    await undoBtn(win);
    await wait(400);
    s = await js(win, state);
    check('«Deshacer» devuelve los 148 en su sitio (crate, Prepare) y vuelve la entrada', s.yt === 148 && s.n === 158 && s.ytAll === '148' && s.crate === 't1,yt_s0,t2,yt_s5' && s.prepare === 'yt_s1,t3', { s });
    // Supr con el foco en la fila: confirmación; Cancelar no borra
    const f = await focusSide(win, 'yt-all');
    await key(win, 'Delete');
    s = await js(win, state);
    check('Supr con el foco en «YouTube · todos los vídeos»: pide confirmación', f && /148 vídeos/.test(s.dialogo), { f, dialogo: s.dialogo });
    await answer(win, 0);
    await wait(250);
    s = await js(win, state);
    check('Cancelar no quita nada', s.yt === 148 && !s.dialogo, { yt: s.yt });

    // ---------------- B) lista importada
    await open(win, seedList());
    await clearToasts(win);
    const lst = await menu(win, 'yt:pla');
    if (!Array.isArray(lst)) { console.log('menú de la lista:', JSON.stringify(lst), JSON.stringify(await js(win, state)), await js(win, `[...document.querySelectorAll('.side-item')].map(x => x.dataset.view).join(' ')`)); app.exit(1); return; }
    await shot(win, `${tag}-04-menu-lista`);
    check('Menú de la lista: «Eliminar lista» y «Eliminar lista y sus vídeos de la biblioteca (3)»', lst.some(t => /^Eliminar lista(Supr)?$/.test(t)) && lst.some(t => /Eliminar lista y sus vídeos de la biblioteca \(3\)/.test(t)), { lst });
    await pickMenu(win, '/Eliminar lista y sus vídeos/');
    await wait(250);
    s = await js(win, state);
    check('Confirmación: quita 3 y explica que 2 se quedan', /quitar 3 vídeos/.test(s.dialogo) && /2 vídeos se quedan/.test(s.dialogo), { dialogo: s.dialogo });
    await answer(win, 1);
    await wait(400);
    s = await js(win, state);
    await shot(win, `${tag}-05-lista-y-videos`);
    // v1 y v5 solo en la Lista A y v4 solo en Prepare (salen); v2 en la Lista B y v3 en una crate (se quedan)
    check('Lista y vídeos sin otro uso eliminados (v1, v4, v5; también de Prepare); v2 y v3 se quedan', s.lists === 'Lista B:yt_v2,yt_v6' && s.yt === 3 && s.prepare === '' && s.crate === 't0,yt_v3', { s });
    check('La vista pasa a «YouTube · todos los vídeos» (quedan vídeos)', s.view === 'yt-all' && s.ytAll === '3', { view: s.view, ytAll: s.ytAll });
    await key(win, 'Z', ['control']);
    await wait(300);
    s = await js(win, state);
    check('Ctrl+Z devuelve la lista y sus vídeos (y Prepare)', s.lists === 'Lista A:yt_v1,yt_v2,yt_v3,yt_v4,yt_v5 | Lista B:yt_v2,yt_v6' && s.yt === 6 && s.prepare === 'yt_v4', { s });
    // Supr con el foco en la fila de la lista
    await clearToasts(win);
    const f2 = await focusSide(win, 'yt:pla');
    await key(win, 'Delete');
    s = await js(win, state);
    await shot(win, `${tag}-06-supr-lista`);
    check('Supr con el foco en la lista: pide confirmación', f2 && /Eliminar la lista «Lista A»/.test(s.dialogo), { f2, dialogo: s.dialogo });
    await answer(win, 1);
    await wait(400);
    s = await js(win, state);
    check('Aceptar: solo la lista (los vídeos siguen) y aviso con Deshacer', s.lists === 'Lista B:yt_v2,yt_v6' && s.yt === 6 && s.deshacer, { s });
    await undoBtn(win);
    await wait(300);
    s = await js(win, state);
    check('«Deshacer» devuelve la lista en su sitio', s.lists.startsWith('Lista A:yt_v1,yt_v2,yt_v3,yt_v4,yt_v5 | Lista B'), { lists: s.lists });
    // Ctrl+Supr con el foco en la lista (y una pista seleccionada en la tabla): actúa sobre la lista
    await js(win, `(() => { const ui = nexuraApp.libraryUI; ui.setView('all'); ui.refresh(); ui.selectOnly(0); return true; })()`);
    await focusSide(win, 'yt:plb');
    await key(win, 'Delete', ['control']);
    s = await js(win, state);
    check('Ctrl+Supr con el foco en una lista: confirmación de la lista, no elimina la pista seleccionada', /Lista B/.test(s.dialogo) && s.n === 7, { dialogo: s.dialogo, n: s.n });
    await key(win, 'Escape');
    s = await js(win, state);
    check('Escape cancela', s.lists.includes('Lista B') && !s.dialogo, { lists: s.lists });
    // protegida: no borra y avisa
    await js(win, `nexuraApp.setSetting('protectLibrary', true); true`);
    await clearToasts(win);
    await menu(win, 'yt:pla');
    await pickMenu(win, '/Eliminar lista y sus vídeos/');
    await wait(300);
    s = await js(win, state);
    check('Biblioteca protegida: ni lista ni vídeos, y avisa', s.lists.includes('Lista A') && s.yt === 6 && !s.dialogo && /protegida/.test(s.aviso), { aviso: s.aviso });
    await js(win, `nexuraApp.setSetting('protectLibrary', false); true`);
    win.destroy();
  }
  report.errors = report.errors.filter(e => !/favicon|youtube|ERR_/i.test(e));
  if (report.errors.length) { report.ok = false; console.log('✗ errores en consola: ' + report.errors.join(' | ')); }
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  console.log(report.ok ? '\nTODO OK' : '\nHAY FALLOS', '· informe en .revision/yt-borrar/informe.json');
  app.exit(report.ok ? 0 : 1);
});
