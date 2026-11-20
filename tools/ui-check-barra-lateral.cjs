// Barra lateral de la biblioteca (árbol + barra de iconos) con Electron contra `npm run web`: capturas en varios
// tamaños y modos, buscador del árbol, salto desde la barra de iconos, teclado (teclas reales), tamaños y contraste.
// Guarda PNG e informe en .revision/barra-lateral/. Uso: npx electron tools/ui-check-barra-lateral.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.revision', 'barra-lateral');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
// [ancho, alto, modo]: auto = ajuste por defecto; on = «Siempre»; laptop = modo laptop; plegado = laptop con ☰
const RUNS = [[1870, 1100, 'auto'], [1496, 885, 'auto'], [1496, 885, 'on'], [1280, 720, 'auto'], [1024, 700, 'auto'], [1496, 885, 'laptop'], [1496, 885, 'plegado'], [700, 900, 'auto']];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function seed() {
  const now = Date.now(), tracks = [];
  const genres = ['Dance', 'Pop', 'House', 'Trance', 'Disco'];
  for (let i = 0; i < 60; i++) tracks.push({
    id: 't' + i, path: `web:Artista ${i} - Tema ${i}.mp3:${1000 + i}`, source: 'local', title: 'Tema de prueba ' + i, artist: 'Artista ' + i, album: '', genre: genres[i % 5],
    year: String(1980 + (i % 45)), comment: '', rating: i % 6, explicit: false, bpm: 118 + (i % 16), firstBeat: 0.1, key: '', camelot: ((i % 12) + 1) + 'A', duration: 190 + i * 3, size: 1000 + i,
    rmsDb: -10, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: now - i * 86400000, plays: 0, lastPlayed: 0, analyzed: true, energy: 5, sections: []
  });
  for (let i = 0; i < 3; i++) tracks.push({ id: 'yt_v' + i, source: 'youtube', ytId: 'v' + i, title: 'Vídeo ' + i, artist: 'Canal', duration: 200, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: now });
  const ids = (a, b) => tracks.slice(a, b).map(t => t.id);
  let n = 0;
  const C = (id, name, from, to, parent = null, extra = {}) => ({ id, name, ids: ids(from, to), parent, created: now - 100000 + (n++) * 1000, ...extra });
  return {
    library: {
      version: 1, tracks,
      crates: [
        C('dance', 'Dance', 0, 4), C('cld', 'Lista reproducción Dance', 4, 10, 'dance'), C('c80', 'Años 80', 10, 18, 'dance'), C('c90', 'Años 90', 18, 24, 'dance'),
        C('c00', 'Años 2000', 24, 28, 'dance'), C('c10', 'Años 2010', 28, 31, 'dance'), C('c20', 'Años 2020', 31, 33, 'dance'),
        C('pop', 'Pop', 33, 35), C('p90', 'Pop 1990', 35, 38, 'pop'), C('p00', 'Pop 2000', 38, 40, 'pop'), C('p10', 'Pop 2010', 40, 42, 'pop'), C('p20', 'Pop 2020', 42, 44, 'pop'),
        C('a6080', 'Años 60-70-80', 44, 48), C('bodas', 'Cumpleaños y bodas', 48, 52, null, { color: '#ff4fa8' }),
        C('fx', 'Fx', 52, 53), C('fx1', 'Efectos FX', 53, 55, 'fx'), C('fx2', 'Efectos FX 2', 55, 56, 'fx'),
        C('house', 'House', 56, 58), C('trance', 'Trance', 58, 60),
        C('sp1', 'Today’s Top Hits', 0, 12, null, { spotify: { key: 'spotify:playlist:x', url: 'https://open.spotify.com/playlist/x', items: [] } })
      ],
      smart: [{ id: 's1', name: 'House 120–130 BPM', match: 'all', rules: [{ field: 'genre', op: 'contains', value: 'House' }, { field: 'bpm', op: 'between', value: '120', value2: '130' }] }],
      history: [{ id: 'h1', date: now - 86400000, entries: [{ id: 't1', at: now }, { id: 't2', at: now }, { id: 't3', at: now }] }],
      prepare: ['t3', 't4'],
      ytPlaylists: [{ id: 'pl1', playlistId: 'PLx', title: 'Clásicos en vídeo', ids: ['yt_v0', 'yt_v1'] }]
    },
    settings: { libView: 'crate:c80', crateSort: 'custom', waveLayout: 'serato', crateCollapsed: ['pop', 'fx'], libHistOpen: false }
  };
}

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  await js(win, `document.querySelector('#library').scrollIntoView({ block: 'end' }); true`);
  win.webContents.invalidate();
  await wait(500);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura', name);
}
async function key(win, keyCode) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  await wait(200);
}

// estado de la barra lateral y medidas
const STATE = `(() => {
  const ui = nexuraApp.libraryUI, lib = document.querySelector('#library'), side = document.querySelector('.lib-side'), rail = document.querySelector('.lib-rail');
  const vis = (e) => !!e && e.offsetWidth > 0 && e.offsetHeight > 0;
  const row = document.querySelector('.side-item[data-view="crate:c80"]'), dance = document.querySelector('.side-item[data-view="crate:dance"]');
  return {
    barraIconos: vis(rail), anchoIconos: vis(rail) ? rail.offsetWidth : 0, arbol: vis(side), anchoArbol: vis(side) ? side.offsetWidth : 0,
    botonIconos: [...document.querySelectorAll('.rail-btn')].map(b => b.textContent + (b.classList.contains('on') ? ' ✓' : '')).join(' · '),
    altoBotonIcono: vis(rail) ? document.querySelector('.rail-btn').offsetHeight : null,
    secciones: [...document.querySelectorAll('.side-group .sec-title')].map(s => s.textContent + (s.parentElement.querySelector('.sec-btn') ? ' [' + s.parentElement.querySelector('.sec-btn').textContent + ']' : '')),
    fila: row ? { alto: row.offsetHeight, letra: getComputedStyle(row).fontSize, sangriaNivel1: getComputedStyle(row).paddingLeft, sangriaNivel0: getComputedStyle(dance).paddingLeft, contador: getComputedStyle(row.querySelector('.si-count')).fontFamily.split(',')[0] } : null,
    iconos: Object.fromEntries([['all', '[data-view="all"]'], ['ia', '[data-view="ai:next"]'], ['prepare', '[data-view="prepare"]'], ['historial', '[data-node="history"]'], ['crate', '[data-view="crate:dance"]'], ['crateConColor', '[data-view="crate:bodas"]'], ['smart', '[data-view="smart:s1"]'], ['youtube', '[data-view="yt-all"]'], ['spotify', '[data-view="crate:sp1"]']]
      .map(([k, s]) => [k, document.querySelector('.side-item' + s + ' .si-ico')?.getAttribute('stroke') || null])),
    cabeceraTabla: { icono: document.querySelector('.view-ico svg')?.getAttribute('stroke'), ruta: ui.viewTitle.textContent, info: ui.countEl.textContent },
    vista: ui.viewId, toggleVisible: vis(document.querySelector('.lib-side-toggle'))
  };
})()`;

// contraste WCAG de los textos de la barra lateral (color de texto sobre el fondo opaco más cercano)
const CONTRAST = `(() => {
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const bgOf = (e) => { let x = e; const layers = []; while (x) { const c = rgb(getComputedStyle(x).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0) { layers.push(c); if ((c[3] ?? 1) >= 1) break; } x = x.parentElement; } let base = layers.pop() || [0, 0, 0]; while (layers.length) { const c = layers.pop(), a = c[3]; base = base.map((v, i) => v * (1 - a) + c[i] * a); } return base; };
  const ratio = (e) => { if (!e) return null; const a = lum(rgb(getComputedStyle(e).color)), b = lum(bgOf(e)); return +((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2); };
  return {
    etiquetaSeccion: ratio(document.querySelector('.sec-title')), contador: ratio(document.querySelector('.side-item:not(.on) .si-count')),
    filaSubcrate: ratio(document.querySelector('.side-item.sub:not(.on) .si-label')), filaSeleccionada: ratio(document.querySelector('.side-item.on .si-label')),
    botonSeccion: ratio(document.querySelector('.sec-btn')), botonPie: ratio(document.querySelector('.side-btn')), buscador: ratio(document.querySelector('.side-search')),
    nombreIcono: ratio(document.querySelector('.rail-btn:not(.on) span')), nombreIconoSel: ratio(document.querySelector('.rail-btn.on span')),
    infoTabla: ratio(document.querySelector('.lib-toolbar .count'))
  };
})()`;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {} };
  for (const [w, h, mode] of RUNS) {
    const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${w}×${h} ${message} (${path.basename(src || '')}:${line})`); });
    const tag = `${w}x${h}-${mode}`;
    await load(win);
    const data = seed();
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify({ welcomeDone: true, screenView: 'mix', viewDefaultV2: true, ...data.settings }))}); true`);
    await load(win);
    await wait(2500);
    await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); document.querySelectorAll('.toast').forEach(t => t.remove()); true`);
    win.focus(); win.webContents.focus();
    await js(win, `(() => { const a = nexuraApp;
      if (${JSON.stringify(mode)} === 'on') a.setSetting('libRail', 'on');
      if (${JSON.stringify(mode)} === 'laptop' || ${JSON.stringify(mode)} === 'plegado') { a.expansions.setEnabled('laptop', true); a.applyPanels(); }
      return true; })()`);
    await wait(300);
    if (mode === 'plegado') await js(win, `document.querySelector('.lib-side-toggle').click(); true`);
    if (w <= 760) await js(win, `document.querySelector('.lib-side-toggle').click(); true`);   // en ≤ 760 px ☰ muestra el árbol
    await wait(200);
    const c = report.checks[tag] = {};
    c.estado = await js(win, STATE);
    if (c.estado.arbol) c.contraste = await js(win, CONTRAST);
    await shot(win, `${tag}-01-arbol`);

    if (mode === 'auto' && w === 1496) {
      // botón rápido de la cabecera: muestra la barra de iconos y se recuerda en los ajustes
      c.botonRapido = await js(win, `(() => { document.querySelector('.side-rail-btn').click(); const r = { ajuste: nexuraApp.settings.libRail, visible: document.querySelector('.lib-rail').offsetWidth > 0 }; return r; })()`);
      await shot(win, `${tag}-02-boton-barra-iconos`);
      await js(win, `document.querySelector('.side-rail-btn').click(); true`);
      c.botonRapido.otraVez = await js(win, `({ ajuste: nexuraApp.settings.libRail, visible: document.querySelector('.lib-rail').offsetWidth > 0 })`);
      // menús: «+ Importar» de LISTAS ONLINE, cabecera CRATES (clic derecho) y «+ Añadir música»
      c.menus = await js(win, `(() => {
        const items = () => [...document.querySelectorAll('.ctx.root > .ctx-item')].map(x => x.childNodes[0]?.textContent || x.textContent);
        document.querySelector('[data-sec="online"] .sec-btn').click(); const importar = items(); nexuraApp.closeMenus();
        const h = document.querySelector('[data-sec="crates"] .side-sec'), r = h.getBoundingClientRect();
        h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 10 })); const crates = items(); nexuraApp.closeMenus();
        document.querySelector('.side-foot .side-btn').click(); const anadir = items();
        return { importar, crates, anadir };
      })()`);
      await shot(win, `${tag}-03-menu-anadir`);
      await js(win, `nexuraApp.closeMenus(); true`);
    }

    if (mode === 'auto' && (w === 1870 || w === 1496)) {
      // buscador del árbol: «80» → Dance (padre) › Años 80 y Años 60-70-80
      c.buscador = await js(win, `(async () => { const ui = nexuraApp.libraryUI; ui.treeIn.value = '80'; ui.treeIn.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 250));
        return { visibles: [...document.querySelectorAll('.lib-tree .side-item .si-label')].map(x => x.textContent), secciones: [...document.querySelectorAll('.lib-tree .sec-title')].map(x => x.textContent) }; })()`);
      await shot(win, `${tag}-04-buscador`);
      c.buscadorPop = await js(win, `(async () => { const ui = nexuraApp.libraryUI; ui.treeIn.value = 'pop 20'; ui.treeIn.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 250));
        const r = [...document.querySelectorAll('.lib-tree .side-item .si-label')].map(x => x.textContent);
        ui.treeIn.value = 'xyz'; ui.treeIn.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 250)); const nada = document.querySelector('.side-none')?.textContent;
        ui.treeIn.value = ''; ui.treeIn.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 250)); return { visibles: r, sinResultados: nada, plegadasSiguen: nexuraApp.settings.crateCollapsed }; })()`);
    }

    if (c.estado.barraIconos) {
      // salto desde la barra de iconos: Smart y Spotify desplazan el árbol; Prepare además abre la vista
      c.salto = await js(win, `(async () => {
        const t = document.querySelector('.lib-tree'), b = (k) => document.querySelector('.rail-btn[data-k="' + k + '"]'), sel = () => document.querySelector('.rail-btn.on')?.dataset.k;
        t.scrollTop = 0; b('smart').click(); await new Promise(r => setTimeout(r, 60));
        const smart = { scroll: t.scrollTop, resaltada: document.querySelector('.side-group.flash')?.dataset.sec, boton: sel(), vista: nexuraApp.libraryUI.viewId };
        b('sp').click(); await new Promise(r => setTimeout(r, 60));
        const sp = { scroll: t.scrollTop, resaltada: document.querySelector('.side-group.flash')?.dataset.sec, boton: sel(), filaVisible: (() => { const it = document.querySelector('.side-item.spotify'), a = it.getBoundingClientRect(), r = t.getBoundingClientRect(); return a.top >= r.top - 1 && a.bottom <= r.bottom + 1; })() };
        return { smart, sp };
      })()`);
      await shot(win, `${tag}-05-salto-spotify`);
      c.salto.prepare = await js(win, `(() => { document.querySelector('.rail-btn[data-k="prep"]').click(); return { vista: nexuraApp.libraryUI.viewId, boton: document.querySelector('.rail-btn.on')?.dataset.k, cabecera: nexuraApp.libraryUI.viewTitle.textContent }; })()`);
      c.salto.historial = await js(win, `(() => { document.querySelector('.rail-btn[data-k="hist"]').click(); return { abierto: nexuraApp.settings.libHistOpen, sesiones: document.querySelectorAll('.side-item[data-view^="history:"]').length }; })()`);
      await shot(win, `${tag}-06-salto-historial`);
      await js(win, `nexuraApp.libraryUI.setView('crate:c80'); nexuraApp.setSetting('libHistOpen', false); nexuraApp.libraryUI.renderSide(); true`);
    }

    if (mode === 'auto' && w === 1496) {
      // teclado real: foco en la barra lateral, ↑/↓ recorren sin abrir, Intro abre, ← / → pliegan y despliegan
      await js(win, `nexuraApp.libraryUI.setView('crate:dance'); nexuraApp.libraryUI.toggleFocus('side'); true`);
      const st = `(() => { const a = document.activeElement, cs = getComputedStyle(a); return { foco: a.classList.contains('side-item') ? (a.dataset.view || a.dataset.node) : a.className, vista: nexuraApp.libraryUI.viewId, contorno: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, visibles: document.querySelectorAll('.lib-tree .side-item').length }; })()`;
      c.teclado = { inicio: await js(win, st) };
      await key(win, 'Down'); c.teclado.abajo = await js(win, st);
      await key(win, 'Down'); c.teclado.abajo2 = await js(win, st);
      await shot(win, `${tag}-07-foco-teclado`);
      await key(win, 'Enter'); c.teclado.intro = await js(win, st);
      await key(win, 'Up'); await key(win, 'Up'); c.teclado.arribaDance = await js(win, st);
      await key(win, 'Left'); c.teclado.izquierdaPliega = await js(win, st);
      await key(win, 'Right'); c.teclado.derechaDespliega = await js(win, st);
      await key(win, 'Down'); await key(win, 'Left'); c.teclado.izquierdaSubeAlPadre = await js(win, st);
      // Historial con el teclado
      await js(win, `nexuraApp.libraryUI.focusSideKey('node:history'); true`);
      await key(win, 'Right'); c.teclado.historialDespliega = await js(win, `({ abierto: nexuraApp.settings.libHistOpen, sesiones: document.querySelectorAll('.side-item[data-view^="history:"]').length })`);
      await key(win, 'Enter'); c.teclado.historialIntroPliega = await js(win, `({ abierto: nexuraApp.settings.libHistOpen })`);
      // arrastrar una pista a un crate y una crate dentro de otra siguen funcionando
      c.arrastrar = await js(win, `(() => {
        const L = nexuraApp.library, it = document.querySelector('.side-item[data-view="crate:house"]'), dt = new DataTransfer(); dt.setData('text/nexura-track', 't0');
        const r = it.getBoundingClientRect(), o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 30, clientY: r.top + r.height / 2 };
        it.dispatchEvent(new DragEvent('dragover', o)); it.dispatchEvent(new DragEvent('drop', o));
        const pista = L.crate('house').ids.includes('t0');
        const from = document.querySelector('.side-item[data-view="crate:trance"]'), d2 = new DataTransfer();
        from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: d2 }));
        const to = document.querySelector('.side-item[data-view="crate:house"]'), r2 = to.getBoundingClientRect(), o2 = { bubbles: true, cancelable: true, dataTransfer: d2, clientX: r2.left + 30, clientY: r2.top + r2.height / 2 };
        to.dispatchEvent(new DragEvent('dragover', o2)); to.dispatchEvent(new DragEvent('drop', o2));
        return { pistaEnHouse: pista, tranceDentroDeHouse: L.crate('trance').parent === 'house' };
      })()`);
      // protección: «+ Nuevo» con la biblioteca protegida avisa y no crea nada
      c.protegida = await js(win, `(async () => { const a = nexuraApp, n = a.library.crates.length; a.setSetting('protectLibrary', true); document.querySelector('[data-sec="crates"] .sec-btn').click(); await new Promise(r => setTimeout(r, 150)); const r = { crates: a.library.crates.length === n, modal: !!document.querySelector('.modal-ov'), aviso: [...document.querySelectorAll('.toast')].map(t => t.textContent).pop() || '' }; a.setSetting('protectLibrary', false); return r; })()`);
    }
    console.log(tag, JSON.stringify(c.estado));
    win.destroy();
  }
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  console.log('errores:', report.errors.length ? report.errors : 'ninguno');
  app.quit();
});
