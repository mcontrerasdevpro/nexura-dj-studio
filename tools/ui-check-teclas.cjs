// Quitar pistas con el teclado (Supr / Ctrl+Supr) en la biblioteca, con Electron contra `npm run web`.
// Teclas reales con webContents.sendInputEvent. Capturas e informe en .revision/teclas/.
// Uso: npx electron tools/ui-check-teclas.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = path.join(__dirname, '..', '.revision', 'teclas');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1280, 800], [375, 812]];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function seed() {
  const now = Date.now(), tracks = [];
  const names = [['Fisher', 'Losing It', 'Tech House', 125, '1A'], ['Chris Lake', 'Turn Off The Lights', 'Tech House', 126, '8A'], ['John Summit', 'Where You Are', 'House', 126, '5A'],
    ['Dom Dolla', 'Saving Up', 'Tech House', 126, '6A'], ['Mau P', 'Drugs From Amsterdam', 'Tech House', 128, '10A'], ['Peggy Gou', 'Starry Night', 'House', 120, '10B'],
    ['Solomun', 'Customer Is King', 'Deep House', 121, '6A'], ['Charlotte de Witte', 'Selected', 'Techno', 134, '4A'], ['Amelie Lens', 'Feel It', 'Techno', 132, '9A']];
  names.forEach(([artist, title, genre, bpm, camelot], i) => tracks.push({
    id: 't' + i, path: `web:${artist} - ${title}.mp3:${1000 + i}`, source: 'local', title, artist, album: '', genre, year: '2024',
    comment: '', rating: 3, bpm, firstBeat: 0.1, key: '', camelot, duration: 180 + i * 23, size: 1000 + i, rmsDb: -10,
    cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: now - i * 86400000, plays: 0, lastPlayed: 0,
    analyzed: true, energy: 5 + (i % 4), sections: []
  }));
  tracks.push({ ...tracks[0], id: 'yt_abc', path: 'youtube:abc', source: 'youtube', ytId: 'abc', title: 'Vídeo de prueba', artist: 'Canal', analyzed: false });
  return {
    library: { version: 1, tracks, crates: [
      { id: 'dance', name: 'Dance', ids: ['t5', 't6'], created: now - 9000 },
      { id: 'y2024', name: '2024', ids: ['t0', 't1', 't4'], parent: 'dance', created: now - 8000 },
      { id: 'y2025', name: '2025', ids: ['t2', 't3', 't0'], parent: 'dance', created: now - 7000 },
      { id: 'techno', name: 'Techno', ids: ['t7', 't8'], created: now - 4000 }],
      smart: [{ id: 'sm', name: 'Más de 127 BPM', match: 'all', rules: [{ field: 'bpm', op: 'gt', value: '127' }] }],
      history: [{ id: 'h1', date: now - 3600000, entries: [{ id: 't2', title: 'Where You Are', time: now - 3600000 }] }],
      prepare: ['t1', 't2', 't3'], ytPlaylists: [{ id: 'pl', playlistId: 'PLx', title: 'Lista de prueba', ids: ['yt_abc'] }] },
    settings: { libView: 'all', crateSort: 'custom', waveLayout: 'serato', libSideW: 250, libSort: { field: null, dir: 1 } }
  };
}

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(500);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura', name);
}
// tecla real (pasa por el gestor de atajos de app.js igual que una pulsación del usuario)
async function key(win, keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await wait(250);
}
// abre una vista, selecciona las filas (por id) y deja el foco en la tabla
const pick = (win, view, ids) => js(win, `(() => { const ui = nexuraApp.libraryUI; ui.setView(${JSON.stringify(view)}); ui.refresh();
  ui.sel = new Set(${JSON.stringify(ids)}); ui.cursor = ui.anchor = ui.rows.findIndex(t => ui.sel.has(t.id)); ui.renderRows(); ui.toggleFocus('table'); return ui.tableFocused(); })()`);
const state = `(() => { const L = nexuraApp.library, ui = nexuraApp.libraryUI; const t = [...document.querySelectorAll('.toast')].pop();
  return { crates: Object.fromEntries(L.crates.map(c => [c.name, c.ids.join(',')])), prepare: L.prepare.join(','), pistas: L.tracks.size,
    seleccion: [...ui.sel].join(','), aviso: t ? t.firstChild.textContent : '', deshacer: !!(t && t.querySelector('.toast-act')), dialogo: document.querySelector('.modal-body')?.textContent || null }; })()`;
const undo = (win) => js(win, `(() => { const b = [...document.querySelectorAll('.toast-act')].pop(); if (b) b.click(); return !!b; })()`);

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {} };
  for (const [w, h] of SIZES) {
    const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${w}×${h} ${message} (${path.basename(src || '')}:${line})`); });
    const tag = `${w}x${h}`;
    await load(win);
    const data = seed();
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify({ welcomeDone: true, screenView: 'mix', viewDefaultV2: true, ...data.settings }))}); true`);
    await load(win);
    await wait(2500);
    await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); document.querySelector('#library').scrollIntoView({ block: 'end' }); true`);
    win.focus(); win.webContents.focus();
    const c = report.checks[tag] = {};

    // 1) menú contextual de la fila con los atajos (crate y «Todas las pistas»)
    await pick(win, 'crate:y2024', ['t1']);
    c.menuCrate = await js(win, `(() => { const r = document.querySelector('.lib-rows .row-t'); const b = r.getBoundingClientRect();
      nexuraApp.libraryUI.rowMenu({ clientX: b.left + 80, clientY: b.top + 10 });
      return [...document.querySelectorAll('.ctx.root > .ctx-item')].filter(x => x.querySelector('.ctx-key')).map(x => x.textContent); })()`);
    await shot(win, `${tag}-01-menu-crate`);
    await js(win, 'nexuraApp.closeMenus(); true');
    await pick(win, 'all', ['t1']);
    c.menuTodas = await js(win, `(() => { nexuraApp.libraryUI.rowMenu({ clientX: 300, clientY: 300 }); const r = [...document.querySelectorAll('.ctx.root > .ctx-item')].filter(x => x.querySelector('.ctx-key')).map(x => x.textContent); nexuraApp.closeMenus(); return r; })()`);

    // 2) crate sin subcrates: Supr quita, aviso con Deshacer, selección pasa a la siguiente; Deshacer devuelve el orden
    c.crateFoco = await pick(win, 'crate:y2024', ['t0']);
    await key(win, 'Delete');
    c.crateSupr = await js(win, state);
    await shot(win, `${tag}-02-aviso-deshacer`);
    c.crateDeshacer = { boton: await undo(win) }; await wait(250);
    Object.assign(c.crateDeshacer, await js(win, state));

    // 3) crate padre que muestra las pistas de sus subcrates: quita de la crate y de sus subcrates
    await pick(win, 'crate:dance', ['t0', 't5']);
    await key(win, 'Delete');
    c.padreSupr = await js(win, state);
    await undo(win); await wait(250);
    c.padreDeshacer = await js(win, state);

    // 4) Prepare
    await pick(win, 'prepare', ['t2']);
    await key(win, 'Delete');
    c.prepareSupr = await js(win, state);
    await undo(win); await wait(250);
    c.prepareDeshacer = await js(win, state);

    // 5) Todas las pistas: confirmación; Escape cancela, Intro elimina; el foco vuelve a la tabla
    await pick(win, 'all', ['t8']);
    await key(win, 'Delete');
    c.todasDialogo = await js(win, state);
    await shot(win, `${tag}-03-confirmar-eliminar`);
    await key(win, 'Escape');
    c.todasCancelar = await js(win, state);
    await key(win, 'Delete');
    await key(win, 'Return');
    c.todasAceptar = Object.assign(await js(win, state), { focoTabla: await js(win, 'nexuraApp.libraryUI.tableFocused()') });

    // 6) Ctrl+Supr desde una crate = eliminar de la biblioteca al instante (sin diálogo, aviso con Deshacer)
    await pick(win, 'crate:techno', ['t7']);
    await key(win, 'Delete', ['control']);
    c.ctrlSuprAceptar = await js(win, state);

    // 7) vistas que no se editan: aviso y nada cambia
    c.otras = {};
    // (Siguiente pista (IA) sin deck cargado no tiene filas: se simula una sugerencia)
    await js(win, `nexuraApp.ai.suggest = () => [nexuraApp.library.get('t2')]; true`);
    for (const v of ['smart:sm', 'history:h1', 'ai:next', 'yt:pl']) {
      await pick(win, v, v === 'smart:sm' ? ['t4'] : v === 'yt:pl' ? ['yt_abc'] : ['t2']);
      await js(win, `document.querySelectorAll('.toast').forEach(t => t.remove()); true`);
      const antes = await js(win, state);
      await key(win, 'Delete');
      const d = await js(win, state);
      c.otras[v] = { filas: await js(win, 'nexuraApp.libraryUI.rows.length'), aviso: d.aviso, sinCambios: d.pistas === antes.pistas && d.prepare === antes.prepare && JSON.stringify(d.crates) === JSON.stringify(antes.crates), dialogo: d.dialogo };
    }

    // 8) foco en el buscador: Supr borra texto y no toca la biblioteca
    await pick(win, 'crate:y2024', ['t1']);
    c.buscador = await js(win, `(() => { const s = nexuraApp.libraryUI.searchIn; s.value = 'abc'; s.focus(); s.setSelectionRange(0, 0); return document.activeElement === s; })()`);
    await key(win, 'Delete');
    c.buscador = { foco: c.buscador, texto: await js(win, 'nexuraApp.libraryUI.searchIn.value'), ...(await js(win, state)) };
    await js(win, `(() => { const ui = nexuraApp.libraryUI; ui.searchIn.value = ''; ui.search = ''; ui.searchIn.blur(); ui.refresh(); return true; })()`);

    // 9) foco fuera de la tabla (barra lateral / documento): Supr no hace nada
    await pick(win, 'crate:y2024', ['t1']);
    await js(win, `nexuraApp.libraryUI.toggleFocus('side'); true`);
    await key(win, 'Delete');
    c.barraLateral = await js(win, state);
    await js(win, `document.activeElement.blur(); true`);
    await key(win, 'Delete');
    c.sinFoco = await js(win, state);

    // 10) biblioteca protegida: crate y «Todas» no cambian (aviso); Prepare sí se puede
    await js(win, `nexuraApp.setSetting('protectLibrary', true); true`);
    await pick(win, 'crate:y2024', ['t1']);
    await key(win, 'Delete');
    c.protegidaCrate = await js(win, state);
    await pick(win, 'all', ['t1']);
    await key(win, 'Delete');
    c.protegidaTodas = await js(win, state);
    await key(win, 'Delete', ['control']);
    c.protegidaCtrl = await js(win, state);
    await pick(win, 'prepare', ['t3']);
    await key(win, 'Delete');
    c.protegidaPrepare = await js(win, state);
    await js(win, `nexuraApp.setSetting('protectLibrary', false); true`);

    // 11) los atajos de deck siguen funcionando (X = play/pausa deck 1 no lanza errores) y Ajustes → Atajos
    await key(win, 'X');
    await js(win, `nexuraApp.settingsUI.open('keys'); true`);
    await wait(300);
    c.ajustes = await js(win, `[...document.querySelectorAll('table.keys tr')].map(r => r.textContent).filter(t => t.includes('Supr'))`);
    await shot(win, `${tag}-04-ajustes-atajos`);
    win.destroy();
  }
  fs.writeFileSync(path.join(OUT, 'ui-check-teclas.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.quit();
});
