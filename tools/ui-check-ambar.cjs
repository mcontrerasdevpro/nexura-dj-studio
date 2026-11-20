// Selección ámbar de la biblioteca, con Electron contra `npm run web`.
// Capturas: una fila, varias, seleccionada + cargada en el deck 1, barra lateral con crate activo.
// Mide los colores calculados y el contraste WCAG. Capturas e informe en .revision/ambar/.
// Uso: npx electron tools/ui-check-ambar.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.revision', 'ambar');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1496, 885], [1024, 700]];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function seed() {
  const now = Date.now(), tracks = [];
  const names = [['Fisher', 'Losing It', 'Tech House', 125, '1A'], ['Chris Lake', 'Turn Off The Lights', 'Tech House', 126, '8A'], ['John Summit', 'Where You Are', 'House', 126, '5A'],
    ['Dom Dolla', 'Saving Up', 'Tech House', 126, '6A'], ['Mau P', 'Drugs From Amsterdam', 'Tech House', 128, '10A'], ['Peggy Gou', 'Starry Night', 'House', 120, '10B'],
    ['Solomun', 'Customer Is King', 'Deep House', 121, '6A'], ['Charlotte de Witte', 'Selected', 'Techno', 134, '4A'], ['Amelie Lens', 'Feel It', 'Techno', 132, '9A'],
    ['Bicep', 'Glue', 'Electronica', 130, '3B'], ['Kerri Chandler', 'Rain', 'Deep House', 122, '11A'], ['Tale Of Us', 'Nova', 'Melodic Techno', 123, '2A']];
  names.forEach(([artist, title, genre, bpm, camelot], i) => tracks.push({
    id: 't' + i, path: `web:${artist} - ${title}.mp3:${1000 + i}`, source: 'local', title, artist, album: 'Álbum ' + (i + 1), genre, year: String(2015 + i),
    comment: 'Comentario ' + i, rating: i % 6, bpm, firstBeat: 0.1, key: '', camelot, duration: 180 + i * 23, size: 1000 + i, rmsDb: -10,
    cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: now - i * 86400000, plays: i % 3, lastPlayed: 0,
    analyzed: true, energy: 4 + (i % 6), sections: []
  }));
  return {
    library: { version: 1, tracks, crates: [
      { id: 'dance', name: 'Dance', ids: ['t5', 't6'], created: now - 9000, color: '#ff3b47' },
      { id: 'y2024', name: '2024', ids: ['t0', 't1', 't2', 't3', 't4', 't9', 't10', 't11'], parent: 'dance', created: now - 8000 },
      { id: 'y2025', name: '2025', ids: ['t2', 't3', 't0'], parent: 'dance', created: now - 7000 },
      { id: 'techno', name: 'Techno', ids: ['t7', 't8'], created: now - 4000 }],
      smart: [], history: [], prepare: ['t1', 't2'], ytPlaylists: [] },
    settings: { libView: 'crate:y2024', crateSort: 'custom', waveLayout: 'serato', libSideW: 230, libSort: { field: null, dir: 1 },
      libCols: ['title', 'artist', 'bpm', 'camelot', 'duration', 'rating', 'genre', 'energy', 'added'] }
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
// selecciona las filas (por id), cursor en la primera y foco en la tabla
const pick = (win, ids) => js(win, `(() => { const ui = nexuraApp.libraryUI; ui.setView('crate:y2024'); ui.refresh();
  ui.sel = new Set(${JSON.stringify(ids)}); ui.cursor = ui.anchor = ui.rows.findIndex(t => ui.sel.has(t.id)); ui.renderRows(); ui.toggleFocus('table');
  document.querySelector('#library').scrollIntoView({ block: 'end' }); return ui.sel.size; })()`);
// colores calculados de la primera fila seleccionada y de la barra lateral activa
const probe = `(() => {
  const r = document.querySelector('.row-t.sel'), s = document.querySelector('.side-item.on'), cs = (e) => e ? getComputedStyle(e) : null;
  const col = (sel) => { const e = r && r.querySelector(sel); return e ? cs(e).color : null; };
  return { filas: document.querySelectorAll('.row-t.sel').length, fondo: cs(r)?.backgroundColor, sombra: cs(r)?.boxShadow, alto: r?.offsetHeight,
    plantilla: cs(r)?.gridTemplateColumns, titulo: col('.c-title'), artista: col('.c-artist'), bpm: col('.c-bpm'), key: col('.key'), estado: col('.st'),
    estrellaOn: col('.rating i.on'), estrellaOff: col('.rating i:not(.on)'), energia: col('.c-title .nrg'),
    fondoBiblio: cs(document.querySelector('.lib-main'))?.backgroundColor, fondoLateral: cs(document.querySelector('.lib-side'))?.backgroundColor,
    lateral: s ? { fondo: cs(s).backgroundColor, barra: cs(s).boxShadow, texto: cs(s).color, cuenta: cs(s.querySelector('.si-count'))?.color } : null,
    estadoClase: r?.querySelector('.st')?.className };
})()`;

// contraste WCAG 2.x
const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round((x + 0.05) / (y + 0.05) * 100) / 100; };
const hex = (c) => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {}, contraste: {} };
  for (const [w, h] of SIZES) {
    const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${w}×${h} ${message} (${path.basename(src || '')}:${line})`); });
    const tag = `${w}x${h}`;
    await load(win);
    const data = seed();
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify({ welcomeDone: true, screenView: 'mix', viewDefaultV2: true, ...data.settings }))}); true`);
    await load(win);
    await wait(2500);
    await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); true`);
    win.focus(); win.webContents.focus();
    const c = report.checks[tag] = {};
    // sin selección: altura y plantilla de referencia
    await pick(win, []);
    c.sinSeleccion = await js(win, `(() => { const r = document.querySelector('.row-t'); return { alto: r.offsetHeight, plantilla: getComputedStyle(r).gridTemplateColumns }; })()`);

    await pick(win, ['t1']);
    c.una = await js(win, probe);
    await shot(win, `${tag}-1-una-fila`);

    await pick(win, ['t1', 't2', 't3', 't9']);
    c.varias = await js(win, probe);
    await shot(win, `${tag}-2-varias-filas`);

    // fila seleccionada y cargada en el deck 1 (solo se marca deck.track para la tabla; se restaura después)
    await js(win, `(() => { const d = nexuraApp.decks[0]; window.__prevTrack = d.track; d.track = nexuraApp.library.tracks.get('t2'); return true; })()`);
    await pick(win, ['t2']);
    c.cargada = await js(win, probe);
    await shot(win, `${tag}-3-seleccionada-cargada-deck1`);
    await js(win, `(() => { nexuraApp.decks[0].track = window.__prevTrack; nexuraApp.libraryUI.renderRows(); return true; })()`);

    // barra lateral: crate activo (2024) con foco en la barra lateral
    await js(win, `(() => { nexuraApp.libraryUI.toggleFocus('side'); document.querySelector('.side-item.on')?.scrollIntoView({ block: 'center' }); return true; })()`);
    c.lateral = (await js(win, probe)).lateral;
    await shot(win, `${tag}-4-barra-lateral-crate-activo`);

    // contraste: texto de la selección sobre el ámbar compuesto sobre el fondo de la biblioteca
    const p = c.una, bgLib = parse(p.fondoBiblio), sel = over(parse(p.fondo), bgLib);
    const k = report.contraste[tag] = { fondoBiblioteca: hex(bgLib), fondoSeleccion: hex(sel) };
    for (const [n, v] of Object.entries({ titulo: p.titulo, artista: p.artista, bpm: p.bpm, tonalidad: p.key, estrellaOn: p.estrellaOn, estrellaOff: p.estrellaOff, energia: p.energia })) {
      const f = parse(v); if (f) k[n] = { color: v, ratio: ratio(over(f, sel), sel) };
    }
    const L = c.lateral, side = over(parse(L.fondo), parse(p.fondoLateral));
    k.lateral = { fondo: hex(side), texto: ratio(parse(L.texto), side), cuenta: L.cuenta ? ratio(parse(L.cuenta), side) : null };
    // misma plantilla de columnas con y sin selección (medidas en el mismo estado de la tabla)
    await pick(win, []);
    const base = await js(win, `getComputedStyle(document.querySelector('.row-t')).gridTemplateColumns`);
    await pick(win, ['t1']);
    const conSel = await js(win, `getComputedStyle(document.querySelector('.row-t.sel')).gridTemplateColumns`);
    // en el mismo instante: fila seleccionada frente a una sin seleccionar, y anchos de las filas
    c.mismoInstante = await js(win, `(() => { const s = document.querySelector('.row-t.sel'), n = document.querySelector('.row-t:not(.sel)');
      return { sel: getComputedStyle(s).gridTemplateColumns, otra: getComputedStyle(n).gridTemplateColumns, anchoSel: s.getBoundingClientRect().width, anchoOtra: n.getBoundingClientRect().width,
        scroll: document.querySelector('.lib-scroll').clientWidth,
        // padding y borde (la clase .sel de los selectores no debe añadir borde a la fila)
        caja: [s, n].map(r => { const z = getComputedStyle(r); return [z.paddingLeft, z.paddingRight, z.borderLeftWidth, z.borderRightWidth].join(' '); }) }; })()`);
    c.mismaAltura = c.una.alto === c.sinSeleccion.alto && c.varias.alto === c.sinSeleccion.alto;
    c.mismaPlantilla = c.mismoInstante.sel === c.mismoInstante.otra;
    c.plantillas = { sinSeleccion: base, conSeleccion: conSel };
    win.destroy();
  }
  // tonalidades (keyColor) sobre el fondo de la selección, todas las claves
  const sel = { r: 0, g: 0, b: 0, a: 1 }, any = Object.values(report.contraste)[0];
  Object.assign(sel, parse('rgb(' + [1, 3, 5].map(i => parseInt(any.fondoSeleccion.slice(i, i + 2), 16)).join(',') + ')'));
  const hsl = (hh, s, l) => { s /= 100; l /= 100; const a = s * Math.min(l, 1 - l), f = (n) => { const kk = (n + hh / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(kk - 3, 9 - kk, 1))); }; return { r: f(0), g: f(8), b: f(4), a: 1 }; };
  // comparación: selección azul anterior (#0f4f8f, inicio del degradado) y fila sin seleccionar (#0a111e)
  const azul = { r: 15, g: 79, b: 143, a: 1 }, lib = { r: 10, g: 17, b: 30, a: 1 };
  report.tonalidades = {};
  for (let n = 1; n <= 12; n++) for (const m of ['A', 'B']) {
    const kc = hsl(((n - 1) * 30 + 150) % 360, 90, m === 'B' ? 68 : 60);
    report.tonalidades[n + m] = { ambar: ratio(kc, sel), azulAnterior: ratio(kc, azul), sinSeleccion: ratio(kc, lib) };
  }
  report.textoAnterior = { blancoSobreAzul: ratio({ r: 255, g: 255, b: 255 }, azul), artistaSobreAzul: ratio({ r: 127, g: 196, b: 255 }, azul) };
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.quit();
});
