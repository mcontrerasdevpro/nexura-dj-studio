// Mide el reparto vertical de la interfaz (altura de la tabla de la biblioteca, hueco bajo los decks, controles cortados
// y scroll horizontal) en varios tamaños y modos, y guarda capturas. Uso, con `npm run web` en marcha:
//   npx electron tools/layout-check.cjs [carpeta de salida dentro de .revision]   (por defecto «fase1b»)
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.revision', process.argv.slice(2).find(a => /^[\w/-]+$/.test(a) && a !== '.') || 'fase1b');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1870, 1100], [1496, 885], [1280, 720], [1024, 700], [700, 900]];
const MODES = [
  { id: 'superior', wave: 'serato' },
  { id: 'endeck', wave: 'deck' },
  { id: '4decks', wave: 'serato', decks: '4' },
  { id: '4decks-endeck', wave: 'deck', decks: '4' },
  { id: 'laptop', wave: 'serato', laptop: true },
  { id: 'laptop-endeck', wave: 'deck', laptop: true },
  { id: 'fx-abierto', wave: 'serato', fx: true },     // fila de efectos desplegada con ☰
  { id: 'youtube', wave: 'serato', yt: true }         // decks con la columna de 200 px del reproductor
];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function seed() {
  const now = Date.now(), tracks = [];
  for (let i = 0; i < 40; i++) tracks.push({
    id: 't' + i, path: `web:Artista ${i} - Tema ${i}.mp3:${1000 + i}`, source: 'local', title: 'Tema de prueba ' + i, artist: 'Artista ' + i, album: 'Álbum', genre: 'House',
    year: '2020', comment: '', rating: i % 6, explicit: false, bpm: 120 + (i % 10), firstBeat: 0.1, key: '', camelot: ((i % 12) + 1) + 'A', duration: 200 + i, size: 1000 + i,
    rmsDb: -10, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: now - i * 86400000, plays: 0, lastPlayed: 0, analyzed: true, energy: 5, sections: []
  });
  return { library: { version: 1, tracks, crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] }, settings: { libView: 'all', waveLayout: 'serato' } };
}

// medición dentro de la página
const MEASURE = `(() => {
  const r = (el) => el.getBoundingClientRect();
  const appEl = document.querySelector('#app'), scroll = document.querySelector('.lib-scroll'), lib = document.querySelector('#library');
  const vis = (el) => { const b = r(el); return el.offsetParent !== null && b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const cut = [], gaps = {};
  const boxes = [...document.querySelectorAll('#dj-layout > .deck'), document.querySelector('#mixer')].filter(el => el && vis(el));
  for (const box of boxes) {
    const b = r(box);
    for (const el of box.querySelectorAll('button, select, input, .knob, .fader, .pad, canvas')) {
      if (!vis(el) || el.closest('[hidden]')) continue;
      const e = r(el);
      if (e.left < b.left - 1 || e.right > b.right + 1 || e.top < b.top - 1 || e.bottom > b.bottom + 1) cut.push((box.id || box.className.split(' ').slice(0, 3).join('.')) + ' → ' + (el.className || el.tagName).toString().slice(0, 40));
    }
    // hueco vacío entre el último contenido y el borde inferior
    if (box.classList.contains('deck')) {
      const pb = parseFloat(getComputedStyle(box).paddingBottom);
      let bottom = b.top;
      for (const el of box.querySelectorAll('*')) { if (!vis(el)) continue; bottom = Math.max(bottom, r(el).bottom); }
      gaps[box.id] = Math.round(b.bottom - pb - bottom);
    }
  }
  const dj = document.querySelector('#dj-layout');
  return {
    libScroll: Math.round(r(scroll).height), library: Math.round(r(lib).height),
    libTopEnVista: Math.round(r(lib).top), libFinEnVista: Math.round(r(scroll).bottom) <= innerHeight + 1,
    scrollVertical: appEl.scrollHeight - appEl.clientHeight, scrollHorizontal: Math.max(appEl.scrollWidth - appEl.clientWidth, document.documentElement.scrollWidth - innerWidth),
    djLayout: Math.round(r(dj).height), decks: Object.fromEntries([...document.querySelectorAll('#dj-layout > .deck')].filter(vis).map(d => [d.id, Math.round(r(d).height)])),
    mixer: Math.round(r(document.querySelector('#mixer')).height), huecoDecks: gaps, cortados: cut
  };
})()`;

const load = async (win) => { for (let i = 0; i < 5; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(500);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
}

app.on('window-all-closed', () => { /* se cierra al terminar */ });
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], results: {} };
  for (const [w, h] of SIZES) {
    const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${w}×${h} ${message} (${path.basename(src || '')}:${line})`); });
    await load(win);
    const data = seed();
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify({ welcomeDone: true, screenView: 'mix', viewDefaultV2: true, ...data.settings }))}); true`);
    await load(win);
    await wait(2500);
    await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); true`);
    for (const m of MODES) {
      await js(win, `(() => { const a = nexuraApp; a.setWaveLayout(${JSON.stringify(m.wave)}); a.setSetting('deckLayout', ${JSON.stringify(m.decks || '2')});
        a.expansions.setEnabled('laptop', ${!!m.laptop}); a.applyPanels(); document.body.classList.toggle('topbar-expanded', ${!!m.fx});
        document.querySelectorAll('#deck0, #deck1').forEach(d => d.classList.toggle('yt', ${!!m.yt})); document.querySelector('#app').scrollTop = 0; return true; })()`);
      await wait(400);
      await js(win, `document.querySelectorAll('.toast').forEach(t => t.remove()); nexuraApp.libraryUI.relayout?.(); true`);
      const tag = `${w}x${h}-${m.id}`;
      report.results[tag] = await js(win, MEASURE);
      await shot(win, tag);
      if (report.results[tag].scrollVertical > 0) {
        await js(win, `document.querySelector('#app').scrollTop = 1e6; true`);
        await shot(win, tag + '-abajo');
      }
      console.log(tag, JSON.stringify(report.results[tag]));
    }
    win.destroy();
  }
  fs.writeFileSync(path.join(OUT, 'layout-check.json'), JSON.stringify(report, null, 2));
  console.log('errores:', report.errors.length ? report.errors : 'ninguno');
  app.quit();
});
