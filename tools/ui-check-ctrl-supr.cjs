// Ctrl+Supr = eliminar de la biblioteca al instante (sin diálogo), con «Deshacer» y Ctrl+Z, con Electron
// contra `npm run web` y teclas reales (sendInputEvent). Comprueba: sin confirmación, selección de la
// siguiente y scroll conservado (varias pulsaciones seguidas), Ctrl+Z en orden inverso, que vuelven cues,
// beatgrid, crates (posición), Prepare y listas, foco en la barra lateral / sin foco, que no actúa en
// campos de texto ni diálogos, Supr sin Ctrl como antes, el menú (confirmación solo con > 20), protección
// y la ayuda de atajos. Capturas e informe en .revision/ctrl-supr/. Uso: npx electron tools/ui-check-ctrl-supr.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.revision', 'ctrl-supr');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1280, 800], [375, 812]];
const N = 60;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function seed() {
  const now = Date.now(), tracks = [];
  for (let i = 0; i < N; i++) tracks.push({
    id: 't' + i, path: `web:Pista ${i}.mp3:${1000 + i}`, source: 'local', title: 'Pista ' + String(i).padStart(2, '0'), artist: 'Artista ' + i, album: '', genre: 'House', year: '2024',
    comment: '', rating: 3, bpm: 120 + (i % 10), firstBeat: 0.1, key: '', camelot: '8A', duration: 200, size: 1000 + i, rmsDb: -10,
    cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: now - i * 1000, plays: 0, lastPlayed: 0,
    analyzed: true, energy: 5, sections: []
  });
  tracks[5].cues[0] = { t: 33.3, color: '#ff0000', name: 'Drop' };
  tracks[5].grid = [{ t: 0.1, bpm: 125 }, { t: 100.1, bpm: 127 }];
  tracks[5].rating = 5;
  return {
    library: { version: 1, tracks, crates: [
      { id: 'dance', name: 'Dance', ids: ['t3', 't5', 't7'], created: now - 9000 },
      { id: 'sub', name: '2024', ids: ['t5', 't1'], parent: 'dance', created: now - 8000 }],
      smart: [], history: [{ id: 'h1', date: now - 3600000, entries: [{ id: 't5', title: 'Pista 05', time: now - 3600000 }] }],
      prepare: ['t9', 't5', 't2'], ytPlaylists: [] },
    settings: { libView: 'all', crateSort: 'custom', waveLayout: 'serato', libSideW: 230, libSort: { field: 'title', dir: 1 } }
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
async function key(win, keyCode, modifiers = [], ms = 200) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await wait(ms);
}
// abre una vista, selecciona una fila (por id), la deja a la vista y el foco en la tabla
const pick = (win, view, id, scroll = null) => js(win, `(() => { const ui = nexuraApp.libraryUI; if (ui.viewId !== ${JSON.stringify(view)}) ui.setView(${JSON.stringify(view)}); ui.refresh();
  const i = ui.rows.findIndex(t => t.id === ${JSON.stringify(id)}); ui.toggleFocus('table');
  ${scroll != null ? `ui.scroller.scrollTop = ${scroll};` : ''} ui.selectOnly(i); return i; })()`);
const state = `(() => { const L = nexuraApp.library, ui = nexuraApp.libraryUI; const t = [...document.querySelectorAll('.toast')].pop();
  return { n: L.tracks.size, order: [...L.tracks.keys()].join(','), sel: [...ui.sel].join(','), cursor: ui.cursor, row: ui.rows[ui.cursor] ? ui.rows[ui.cursor].id : null,
    scroll: Math.round(ui.scroller.scrollTop), crates: Object.fromEntries(L.crates.map(c => [c.name, c.ids.join(',')])), prepare: L.prepare.join(','),
    aviso: t ? t.firstChild.textContent : '', deshacer: !!(t && t.querySelector('.toast-act')), dialogo: !!document.querySelector('.modal-ov') }; })()`;
const clearToasts = (win) => js(win, `document.querySelectorAll('.toast').forEach(t => t.remove()); true`);

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
    const data = seed();
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify({ welcomeDone: true, screenView: 'mix', viewDefaultV2: true, ...data.settings }))}); true`);
    await load(win);
    await wait(2500);
    await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); document.querySelector('#library').scrollIntoView({ block: 'end' }); true`);
    win.focus(); win.webContents.focus();
    const orig = await js(win, state);

    // 1) «Todas las pistas» con scroll: Ctrl+Supr elimina al instante, sin diálogo; queda seleccionada la siguiente
    const rowH = await js(win, 'nexuraApp.libraryUI.rowH');
    const i0 = await pick(win, 'all', 't30', rowH * 26);
    const before = await js(win, state);
    await key(win, 'Delete', ['control']);
    let s = await js(win, state);
    await shot(win, `${tag}-01-eliminada-aviso`);
    check('Ctrl+Supr elimina al instante, sin diálogo', s.n === N - 1 && !s.dialogo && !s.order.split(',').includes('t30'), { s });
    check('Aviso con «Deshacer» y «los archivos siguen en el disco»', s.deshacer && /eliminada de la biblioteca/.test(s.aviso) && /disco/.test(s.aviso), { aviso: s.aviso });
    check('Queda seleccionada la siguiente (t31) en el mismo sitio y sin perder el scroll', s.sel === 't31' && s.cursor === i0 && s.scroll === before.scroll && before.scroll > 0, { before: { scroll: before.scroll, i0 }, after: { sel: s.sel, cursor: s.cursor, scroll: s.scroll } });

    // 2) varias pulsaciones seguidas (rápidas): t31, t32, t33
    for (let k = 0; k < 3; k++) await key(win, 'Delete', ['control'], 60);
    await wait(250);
    s = await js(win, state);
    check('Ctrl+Supr ×3 seguidas: elimina t31, t32, t33 y selecciona t34', s.n === N - 4 && s.sel === 't34' && ['t31', 't32', 't33'].every(id => !s.order.split(',').includes(id)) && s.scroll === before.scroll, { n: s.n, sel: s.sel, scroll: s.scroll });

    // 3) Ctrl+Z deshace en orden inverso; todo vuelve a su sitio
    await key(win, 'Z', ['control']);
    s = await js(win, state);
    check('Ctrl+Z devuelve la última (t33)', s.n === N - 3 && s.order.split(',').includes('t33') && !s.order.split(',').includes('t32'), { n: s.n });
    for (let k = 0; k < 3; k++) await key(win, 'Z', ['control'], 120);
    s = await js(win, state);
    check('Ctrl+Z ×3 más: la biblioteca queda como estaba (mismo orden)', s.n === N && s.order === orig.order, { n: s.n });
    await key(win, 'Z', ['control']);
    s = await js(win, state);
    check('Sin nada que deshacer, Ctrl+Z no hace nada', s.n === N && s.order === orig.order, { n: s.n });

    // 4) pista con cues, beatgrid, crates, subcrate, Prepare e historial, desde la vista de su crate; Deshacer con el botón
    await clearToasts(win);
    await pick(win, 'crate:dance', 't5');
    await key(win, 'Delete', ['control']);
    s = await js(win, state);
    const gone = s.n === N - 1 && s.crates.Dance === 't3,t7' && s.crates['2024'] === 't1' && s.prepare === 't9,t2';
    await js(win, `(() => { const b = [...document.querySelectorAll('.toast-act')].pop(); b.click(); return true; })()`);
    await wait(250);
    s = await js(win, state);
    const t5 = await js(win, `(() => { const t = nexuraApp.library.get('t5'); return t && { cue: t.cues[0], grid: t.grid, rating: t.rating, hist: nexuraApp.library.history[0].entries[0].id }; })()`);
    check('Desde una crate: se quita de crates, subcrate y Prepare', gone, {});
    check('«Deshacer» (botón) devuelve cues, beatgrid, valoración y posición en crates y Prepare', s.n === N && s.crates.Dance === 't3,t5,t7' && s.crates['2024'] === 't5,t1' && s.prepare === 't9,t5,t2'
      && t5 && t5.cue && t5.cue.t === 33.3 && t5.grid.length === 2 && t5.rating === 5 && t5.hist === 't5', { s: { crates: s.crates, prepare: s.prepare }, t5 });
    await key(win, 'Z', ['control']);
    check('El mismo deshacer no se aplica dos veces (botón y luego Ctrl+Z)', (await js(win, state)).n === N, {});

    // 5) foco en la barra lateral o sin foco: Ctrl+Supr actúa sobre la selección de la tabla; Supr sin Ctrl no
    await pick(win, 'all', 't10');
    await js(win, `nexuraApp.libraryUI.toggleFocus('side'); true`);
    await key(win, 'Delete');
    const sideSupr = await js(win, state);
    await key(win, 'Delete', ['control']);
    const side = await js(win, state);
    check('Barra lateral con foco: Supr no hace nada, Ctrl+Supr elimina la seleccionada', sideSupr.n === N && side.n === N - 1 && !side.order.split(',').includes('t10'), { sideSupr: sideSupr.n, side: side.n });
    await key(win, 'Z', ['control']);
    await pick(win, 'all', 't11');
    await js(win, `document.activeElement.blur(); true`);
    await key(win, 'Delete', ['control']);
    s = await js(win, state);
    check('Sin foco (documento): Ctrl+Supr elimina la seleccionada', s.n === N - 1 && !s.order.split(',').includes('t11'), { n: s.n });
    await key(win, 'Z', ['control']);

    // 6) campo de texto o diálogo abierto: no actúa
    await pick(win, 'all', 't12');
    await js(win, `(() => { const s = nexuraApp.libraryUI.searchIn; s.value = 'pista'; s.focus(); s.setSelectionRange(0, 0); return true; })()`);
    await key(win, 'Delete', ['control']);
    const txt = await js(win, `nexuraApp.libraryUI.searchIn.value`);
    s = await js(win, state);
    check('En el buscador: Ctrl+Supr borra texto y no elimina pistas', s.n === N && txt !== 'pista', { n: s.n, txt });
    await js(win, `(() => { const ui = nexuraApp.libraryUI; ui.searchIn.value = ''; ui.search = ''; ui.searchIn.blur(); ui.refresh(); return true; })()`);
    await pick(win, 'all', 't12');
    await js(win, `nexuraApp.settingsUI.open('keys'); true`);
    await wait(300);
    const keys = await js(win, `[...document.querySelectorAll('table.keys tr')].map(r => r.textContent).filter(t => /Supr|Ctrl \\+ Z/.test(t))`);
    await shot(win, `${tag}-02-ajustes-atajos`);
    await key(win, 'Delete', ['control']);
    s = await js(win, state);
    check('Con un diálogo abierto (Ajustes): Ctrl+Supr no elimina', s.n === N, { n: s.n });
    check('Ajustes → Atajos: Ctrl + Supr «al instante, sin preguntar» y Ctrl + Z', keys.some(k => /al instante/.test(k) && /Ctrl \+ Supr/.test(k)) && keys.some(k => /Ctrl \+ Z/.test(k)), { keys });
    await js(win, `nexuraApp.closeModal(); true`);
    await wait(200);

    // 7) Supr sin Ctrl en «Todas las pistas» sigue pidiendo confirmación (Escape cancela)
    await pick(win, 'all', 't13');
    await key(win, 'Delete');
    const dlg = await js(win, state);
    await key(win, 'Escape');
    s = await js(win, state);
    check('Supr en «Todas las pistas» sigue como antes (confirmación; Escape cancela)', dlg.dialogo && s.n === N && !s.dialogo, { dlg: dlg.dialogo, n: s.n });

    // 8) menú de la pista: 1 pista sin confirmar; más de 20, con confirmación
    await clearToasts(win);
    await pick(win, 'all', 't14');
    await js(win, `(() => { nexuraApp.libraryUI.rowMenu({ clientX: 300, clientY: 300 }); const it = [...document.querySelectorAll('.ctx.root > .ctx-item')].find(x => /Eliminar de la biblioteca/.test(x.textContent)); it.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true; })()`);
    await wait(250);
    s = await js(win, state);
    check('Menú «Eliminar de la biblioteca (1)»: sin confirmación y con Deshacer', s.n === N - 1 && !s.dialogo && s.deshacer, { n: s.n, dialogo: s.dialogo });
    await key(win, 'Z', ['control']);
    await js(win, `(() => { const ui = nexuraApp.libraryUI; ui.setView('all'); ui.refresh(); ui.sel = new Set(ui.rows.slice(0, 25).map(t => t.id)); ui.cursor = 0; ui.renderRows();
      nexuraApp.libraryUI.rowMenu({ clientX: 300, clientY: 300 }); const it = [...document.querySelectorAll('.ctx.root > .ctx-item')].find(x => /Eliminar de la biblioteca/.test(x.textContent)); it.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true; })()`);
    await wait(300);
    const many = await js(win, state);
    await shot(win, `${tag}-03-menu-25-confirmar`);
    await key(win, 'Escape');
    s = await js(win, state);
    check('Menú con 25 pistas: pide confirmación (y Escape no borra nada)', many.dialogo && many.n === N && s.n === N, { dialogo: many.dialogo, n: s.n });
    // con la tecla, 25 pistas a la vez: sin confirmación, y Ctrl+Z las devuelve
    await js(win, `(() => { const ui = nexuraApp.libraryUI; ui.toggleFocus('table'); ui.sel = new Set(ui.rows.slice(0, 25).map(t => t.id)); ui.cursor = 0; ui.renderRows(); return true; })()`);
    await key(win, 'Delete', ['control']);
    const k25 = await js(win, state);
    await key(win, 'Z', ['control']);
    s = await js(win, state);
    check('Ctrl+Supr con 25 seleccionadas: sin confirmación; Ctrl+Z las devuelve en su orden', k25.n === N - 25 && !k25.dialogo && s.n === N && s.order === orig.order, { k25: k25.n, n: s.n });

    // 9) biblioteca protegida: nada se elimina y se avisa
    await js(win, `nexuraApp.setSetting('protectLibrary', true); true`);
    await clearToasts(win);
    await pick(win, 'all', 't15');
    await key(win, 'Delete', ['control']);
    s = await js(win, state);
    check('Biblioteca protegida: Ctrl+Supr no elimina y avisa', s.n === N && /protegida/.test(s.aviso), { n: s.n, aviso: s.aviso });
    await js(win, `nexuraApp.setSetting('protectLibrary', false); true`);

    // 10) el aviso cabe en la pantalla (móvil incluido)
    await clearToasts(win);
    await pick(win, 'all', 't16');
    await key(win, 'Delete', ['control']);
    await wait(400);
    const fit = await js(win, `(() => { const t = [...document.querySelectorAll('.toast')].pop(), b = t && t.querySelector('.toast-act'); if (!b) return null; const r = t.getBoundingClientRect(), q = b.getBoundingClientRect();
      return { left: r.left, right: r.right, bottom: r.bottom, btnRight: q.right, btnBottom: q.bottom, w: innerWidth, h: innerHeight }; })()`);
    await shot(win, `${tag}-04-aviso`);
    check('El aviso y su botón «Deshacer» caben en la pantalla', fit && fit.left >= 0 && fit.right <= fit.w && fit.btnRight <= fit.w && fit.btnBottom <= fit.h, fit || {});
    await key(win, 'Z', ['control']);
    win.destroy();
  }
  report.errors = report.errors.filter(e => !/favicon|youtube|ERR_/i.test(e));
  if (report.errors.length) { report.ok = false; console.log('✗ errores en consola: ' + report.errors.join(' | ')); }
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  console.log(report.ok ? '\nTODO OK' : '\nHAY FALLOS', '· informe en .revision/ctrl-supr/informe.json');
  app.exit(report.ok ? 0 : 1);
});
