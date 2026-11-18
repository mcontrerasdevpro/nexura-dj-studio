// Prueba visual de la interfaz con Electron (sin Playwright): carga `npm run web`, simula una biblioteca,
// ejercita las novedades y guarda capturas en .revision/. Uso: npx electron tools/ui-check.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = path.join(__dirname, '..', '.revision');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1496, 885], [1024, 700]];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// biblioteca de ejemplo (rutas «web:» como las del modo navegador)
function seed() {
  const now = Date.now(), tracks = [];
  const names = [['Daft Punk', 'One More Time', 'House', 122.9, '9A'], ['Nicky Romero', 'Toulouse', 'Progressive', 128, '8A'], ['Tim Berg', 'Seek Bromance', 'House', 126, '11B'],
    ['Dr. Kucho!', 'Belong', 'House', 124, '5A'], ['Avicii', 'Levels', 'Progressive', 126, '2A'], ['Fisher', 'Losing It', 'Tech House', 125, '1A'],
    ['Peggy Gou', 'Starry Night', 'House', 120, '10B'], ['Solomun', 'Customer Is King', 'Deep House', 121, '6A']];
  names.forEach(([artist, title, genre, bpm, camelot], i) => tracks.push({
    id: 't' + i, path: `web:${artist} - ${title}.mp3:${1000 + i}`, source: 'local', title, artist, album: i % 2 ? 'Singles' : 'Hits', genre, year: String(2010 + i),
    comment: '', rating: i % 6, explicit: i === 2, bpm, firstBeat: 0.1, key: '', camelot, duration: 200 + i * 17, size: 1000 + i, rmsDb: -10,
    cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: now - i * 86400000, plays: i, lastPlayed: 0,
    analyzed: true, energy: 4 + (i % 5), sections: []
  }));
  return {
    library: { version: 1, tracks, crates: [
      { id: 'c1', name: 'Viernes noche', ids: ['t0', 't1', 't2', 't3'], color: '#ff3b47', created: now - 3000 },
      { id: 'c2', name: 'Abrir sesión', ids: ['t4', 't5'], color: '#2ee06a', created: now - 1000 },
      { id: 'c3', name: 'Cierre', ids: ['t6'], created: now - 2000 }],
      smart: [], history: [{ id: 'h1', date: now - 7200000, entries: [{ id: 't0', time: now - 7000000 }, { id: 't1', time: now - 6800000 }] }], prepare: ['t2'], ytPlaylists: [] },
    settings: { libView: 'crate:c1', crateSort: 'alpha', libCols: ['art', 'artist', 'bpm', 'camelot', 'duration', 'rating', 'genre', 'explicit', 'plays', 'added'], waveLayout: 'serato' }
  };
}

async function shot(win, name, lib = true) {
  if (lib) await win.webContents.executeJavaScript("document.querySelector('#library').scrollIntoView({ block: 'end' }); true");
  win.webContents.invalidate();
  await wait(600);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  console.log('captura', name);
}
const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));

app.on('window-all-closed', () => { /* se cierra al terminar */ });
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {} };
  for (const [w, h] of SIZES) {
    const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${w}×${h} ${message} (${path.basename(src || '')}:${line})`); });
    const tag = `${w}x${h}`;
    await load(win);
    const data = seed();
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify({ welcomeDone: true, ...data.settings }))}); true`);
    await load(win);
    await wait(2500);
    await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); true`);
    await shot(win, `${tag}-01-biblioteca-crate`);

    report.checks[tag] = await js(win, `(() => {
      const ui = nexuraApp.libraryUI, head = [...document.querySelectorAll('.lib-head .th')].map(t => t.dataset.key);
      return { columnas: head, libMax: ui._max, plantilla: getComputedStyle(document.querySelector('#library')).getPropertyValue('--lib-cols').trim(),
        contador: ui.countEl.textContent, placeholder: ui.searchIn.placeholder, crates: [...document.querySelectorAll('.side-item[data-view^="crate:"] .si-label')].map(e => e.textContent),
        estrellas: document.querySelectorAll('.row-t .rating i.on').length, explicit: document.querySelectorAll('.c-explicit b').length,
        altoBiblioteca: Math.round(document.querySelector('#library').getBoundingClientRect().height), altoApp: document.querySelector('#app').scrollHeight, desbordeCabecera: document.querySelector('.lib-head').scrollWidth - document.querySelector('.lib-head').clientWidth };
    })()`);

    // menú de columnas (clic derecho en la cabecera)
    await js(win, `(() => { const h = document.querySelector('.lib-head'), r = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 260, clientY: r.top + 10 })); return true; })()`);
    await shot(win, `${tag}-02-menu-columnas`);
    await js(win, `nexuraApp.closeMenus(); true`);

    // valoración con clic en la 5.ª estrella de la primera fila
    report.checks[tag].valoracion = await js(win, `(() => { const star = document.querySelector('.row-t .rating i[data-n="5"]'); if (!star) return 'columna no visible en este tamaño'; star.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); return new Promise(r => setTimeout(() => r(nexuraApp.libraryUI.rows[0].rating), 200)); })()`);

    // menú contextual de la pista
    await js(win, `(() => { const r = document.querySelector('.row-t'); const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 300, clientY: b.top + 10 })); return true; })()`);
    await shot(win, `${tag}-03-menu-pista`);
    await js(win, `nexuraApp.closeMenus(); true`);

    // proteger biblioteca: candado y aviso al intentar borrar
    report.checks[tag].proteger = await js(win, `(() => { nexuraApp.setSetting('protectLibrary', true); const ok = nexuraApp.library.remove(['t0']); const c = nexuraApp.library.createCrate('x'); return { borrado: ok, crate: c, candado: nexuraApp.libraryUI.lockBtn.textContent, sigue: !!nexuraApp.library.get('t0') }; })()`);
    await shot(win, `${tag}-04-protegida`);
    await js(win, `nexuraApp.setSetting('protectLibrary', false); true`);

    // Cue Loop: cargar un búfer sintético en el deck 1 y pulsar el pad 1 en modo Cue Loop
    report.checks[tag].cueLoop = await js(win, `(async () => {
      const app = nexuraApp, d = app.decks[0], t = app.library.get('t0');
      const ctx = app.engine.ctx, buf = ctx.createBuffer(2, ctx.sampleRate * 60, ctx.sampleRate);
      await d.load(t, buf);
      d.setPadMode('cueloop');
      d.seek(10); await new Promise(r => setTimeout(r, 100));
      d.padDown(0); d.padUp(0);
      const c = t.cueLoops[0];
      d.padDown(0); d.padUp(0); // activa: salta y hace loop
      const act = d.loop.on && Math.abs(d.loop.s - c.t) < 1e-3;
      const st = d.padState(0);
      const midi = !!app.actions['deck1.cueloop1'] && app.actions['deck1.cueloop1'].led();
      d.padDown(1, true); // borrar pad vacío: sin efecto
      return { guardado: !!c, inicio: c && +c.t.toFixed(3), fin: c && +c.le.toFixed(3), beats: d.loopBeats, activo: act, pad: st.label, midiLed: midi, pestañas: document.querySelectorAll('#deck0 .pad-tab').length };
    })()`);
    await win.webContents.executeJavaScript("document.querySelector('#deck0').scrollIntoView({ block: 'start' }); true"); await shot(win, `${tag}-05-cue-loop`, false);
    report.checks[tag].borrarCueLoop = await js(win, `(() => { const d = nexuraApp.decks[0]; d.loopOff(); d.padDown(0, true); return d.track.cueLoops[0] === null; })()`);

    // Ajustes → Biblioteca
    await js(win, `nexuraApp.settingsUI.open('library'); true`);
    await shot(win, `${tag}-06-ajustes-biblioteca`, false);
    await js(win, `nexuraApp.closeModal(); nexuraApp.settingsUI.open('play'); true`);
    await shot(win, `${tag}-07-ajustes-reproduccion`, false);
    await js(win, `nexuraApp.closeModal(); true`);

    // columnas por crate
    report.checks[tag].porCrate = await js(win, `(() => { const ui = nexuraApp.libraryUI; nexuraApp.setSetting('libColsSame', false); ui.setChosenCols(['artist', 'bpm']); const a = [...document.querySelectorAll('.lib-head .th')].map(t => t.dataset.key); ui.setView('all'); const b = [...document.querySelectorAll('.lib-head .th')].map(t => t.dataset.key); return { crate: a, todas: b }; })()`);
    await shot(win, `${tag}-08-todas-columnas-globales`);
    // historial: reiniciar pistas tocadas
    report.checks[tag].historial = await js(win, `(() => { const ui = nexuraApp.libraryUI; ui.setView('history:h1'); const antes = document.querySelectorAll('.row-t.played').length; nexuraApp.library.resetPlayed('h1'); ui.refresh(); const despues = document.querySelectorAll('.row-t.played').length; return { antes, despues }; })()`);
    // importar M3U en el navegador (por nombre de archivo entre las pistas añadidas)
    report.checks[tag].m3u = await js(win, `(async () => { const txt = '#EXTM3U\\n#EXTINF:200,Fisher - Losing It\\nMusica\\\\Fisher - Losing It.mp3\\nno-existe.mp3\\n'; const r = await nexuraApp.importPlaylists([{ path: 'Mi lista.m3u', name: 'Mi lista.m3u', data: new TextEncoder().encode(txt) }]); return { encontradas: r.found, faltan: r.missing, crate: r.crate && r.crate.name, vista: nexuraApp.libraryUI.viewId === 'crate:' + r.crate.id }; })()`);
    await shot(win, `${tag}-09-m3u-importada`);
    // botón de pantalla completa (⛶) junto a los ajustes: en el navegador, requestFullscreen; el icono y el texto
    // cambian al entrar y al salir (también si se sale con Esc o F11: evento fullscreenchange)
    const fsState = `(() => { const b = document.querySelector('#top-right .fs-btn'); return b && { title: b.title, pressed: b.getAttribute('aria-pressed'), doc: !!document.fullscreenElement, next: b.nextElementSibling && b.nextElementSibling.title }; })()`;
    const fs0 = await js(win, fsState);
    await win.webContents.executeJavaScript(`document.querySelector('#top-right .fs-btn').click(); true`, true);
    await wait(700);
    const fs1 = await js(win, fsState);
    await win.webContents.executeJavaScript(`document.exitFullscreen ? document.exitFullscreen().catch(() => {}) : 0; true`, true);
    await wait(700);
    const fs2 = await js(win, fsState);
    const fsOk = !!fs0 && fs0.title === 'Pantalla completa (F11)' && fs0.pressed === 'false' && fs0.next === 'Ajustes' &&
      fs1.doc && fs1.title === 'Salir de pantalla completa (F11 o Esc)' && fs1.pressed === 'true' && !fs2.doc && fs2.title === 'Pantalla completa (F11)';
    report.checks[tag].pantallaCompleta = { ok: fsOk, antes: fs0, dentro: fs1, fuera: fs2 };
    if (!fsOk) report.errors.push(`${tag} botón de pantalla completa: ${JSON.stringify({ fs0, fs1, fs2 })}`);
    win.destroy();
  }
  fs.writeFileSync(path.join(OUT, 'ui-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  const fsBad = Object.values(report.checks).filter(c => !(c.pantallaCompleta && c.pantallaCompleta.ok)).length;
  console.log(fsBad ? `✗ Botón de pantalla completa (modo navegador): falla en ${fsBad} tamaño(s)` : '✓ Botón de pantalla completa (modo navegador): entra, cambia icono y texto, y sale');
  app.exit(fsBad ? 1 : 0);
});
