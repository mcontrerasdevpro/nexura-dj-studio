// Capturas de los subcrates (árbol Dance › 2024 / 2025 / Tech House › Peak time) con Electron contra `npm run web`.
// Guarda PNG e informe en .revision/subcrates/. Uso: npx electron tools/ui-check-subcrates.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = path.join(__dirname, '..', '.revision', 'subcrates');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1496, 885]];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function seed() {
  const now = Date.now(), tracks = [];
  const names = [['Fisher', 'Losing It', 'Tech House', 125, '1A', '2024'], ['Chris Lake', 'Turn Off The Lights', 'Tech House', 126, '8A', '2024'], ['John Summit', 'Where You Are', 'House', 126, '5A', '2025'],
    ['Dom Dolla', 'Saving Up', 'Tech House', 126, '6A', '2025'], ['Mau P', 'Drugs From Amsterdam', 'Tech House', 128, '10A', '2024'], ['Peggy Gou', 'Starry Night', 'House', 120, '10B', '2019'],
    ['Solomun', 'Customer Is King', 'Deep House', 121, '6A', '2018'], ['Charlotte de Witte', 'Selected', 'Techno', 134, '4A', '2023'], ['Amelie Lens', 'Feel It', 'Techno', 132, '9A', '2022']];
  names.forEach(([artist, title, genre, bpm, camelot, year], i) => tracks.push({
    id: 't' + i, path: `web:${artist} - ${title}.mp3:${1000 + i}`, source: 'local', title, artist, album: '', genre, year,
    comment: '', rating: 3, bpm, firstBeat: 0.1, key: '', camelot, duration: 180 + i * 23, size: 1000 + i, rmsDb: -10,
    cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: now - i * 86400000, plays: 0, lastPlayed: 0,
    analyzed: true, energy: 5 + (i % 4), sections: []
  }));
  return {
    library: { version: 1, tracks, crates: [
      { id: 'dance', name: 'Dance', ids: ['t5', 't6'], color: '#ff3b47', created: now - 9000 },
      { id: 'y2024', name: '2024', ids: ['t0', 't1', 't4'], parent: 'dance', created: now - 8000 },
      { id: 'y2025', name: '2025', ids: ['t2', 't3', 't0'], parent: 'dance', created: now - 7000 },
      { id: 'th', name: 'Tech House', ids: ['t0', 't3'], parent: 'dance', created: now - 6000, color: '#3b82ff' },
      { id: 'peak', name: 'Peak time', ids: ['t4', 't1'], parent: 'th', created: now - 5000 },
      { id: 'techno', name: 'Techno', ids: ['t7', 't8'], created: now - 4000 },
      { id: 'vieja', name: 'Bodas', ids: ['t5'], created: now - 3000 }],
      smart: [], history: [], prepare: [], ytPlaylists: [] },
    settings: { libView: 'crate:dance', crateSort: 'custom', waveLayout: 'serato', libSideW: 250 }
  };
}

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  await js(win, "document.querySelector('#library').scrollIntoView({ block: 'end' }); { const s = document.querySelector('.lib-tree'), h = document.querySelector('.side-sec[title*=\"raíz\"]'); s.scrollTop = h.parentElement.offsetTop - 4; } true");
  win.webContents.invalidate();
  await wait(600);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  console.log('captura', name);
}

// arrastrar una crate (o la cabecera CRATES) con eventos DnD sintéticos; y: 0.5 = centro (subcrate), 0.1 = delante
const DRAG = `window.__drag = (fromId, toSel, y = 0.5) => {
  const from = document.querySelector('.side-item[data-view="crate:' + fromId + '"]'), to = document.querySelector(toSel);
  const dt = new DataTransfer();
  from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  const r = to.getBoundingClientRect(), o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.top + r.height * y };
  to.dispatchEvent(new DragEvent('dragover', o));
  to.dispatchEvent(new DragEvent('drop', o));
}; true`;
const tree = `nexuraApp.library.crateTree('custom', null, true).map(x => '  '.repeat(x.depth) + x.c.name)`;

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
    await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); ${DRAG}`);
    const c = report.checks[tag] = {};

    // 1) árbol y vista de «Dance» con las pistas de sus subcrates
    c.arbol = await js(win, `(() => {
      const ui = nexuraApp.libraryUI;
      const items = [...document.querySelectorAll('.side-item.crate')].map(it => ({ nombre: it.querySelector('.si-label').textContent, nivel: +(it.style.getPropertyValue('--depth') || 0), pistas: it.querySelector('.si-count').textContent, triangulo: it.querySelector('.si-tw').textContent, heredado: it.classList.contains('inherit'), sangria: getComputedStyle(it).paddingLeft }));
      return { items, titulo: ui.viewTitle.textContent, contador: ui.countEl.textContent, filas: ui.rows.map(t => t.title), buscar: ui.searchIn.placeholder };
    })()`);
    await shot(win, `${tag}-01-arbol-dance`);

    // 2) subcrate abierto (ruta en el título) y búsqueda en el padre que encuentra pistas de los hijos
    c.busqueda = await js(win, `(() => {
      const ui = nexuraApp.libraryUI;
      ui.setView('crate:peak'); const titulo = ui.viewTitle.textContent;
      ui.setView('crate:dance'); ui.search = 'drugs'; ui.searchIn.value = 'drugs'; ui.refresh();
      const r = { tituloPeak: titulo, encontradas: ui.rows.map(t => t.title), contador: ui.countEl.textContent };
      ui.search = ''; ui.searchIn.value = ''; ui.refresh();
      return r;
    })()`);

    // 3) plegar «Tech House» con el triángulo y con ← en la barra lateral
    c.plegar = await js(win, `(async () => {
      const ui = nexuraApp.libraryUI;
      document.querySelector('.side-item[data-view="crate:th"] .si-tw').click();
      const trasClic = { peakVisible: !!document.querySelector('[data-view="crate:peak"]'), guardado: nexuraApp.settings.crateCollapsed };
      ui.setView('crate:dance'); ui.toggleFocus('side');
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft', bubbles: true })); document.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft', key: 'ArrowLeft', bubbles: true }));
      const flechaIzq = { visibles: [...document.querySelectorAll('.side-item.crate .si-label')].map(x => x.textContent), foco: ui.focus };
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true })); document.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true }));
      const flechaDer = { visibles: [...document.querySelectorAll('.side-item.crate .si-label')].map(x => x.textContent), foco: ui.focus };
      // MIDI: botón «→» sobre Tech House (plegado) lo despliega
      ui.setView('crate:th'); nexuraApp.actions.browseright.fn(true);
      const midi = { peakVisible: !!document.querySelector('[data-view="crate:peak"]') };
      document.querySelector('.side-item[data-view="crate:th"] .si-tw').click();
      ui.setView('crate:dance');
      return { trasClic, flechaIzq, flechaDer, midi };
    })()`);
    await shot(win, `${tag}-02-tech-house-plegado`);
    await js(win, `document.querySelector('.side-item[data-view="crate:th"] .si-tw').click(); true`);

    // 4) menú contextual con «Mover a…» desplegado
    c.menu = await js(win, `(() => {
      const it = document.querySelector('.side-item[data-view="crate:y2025"]'), r = it.getBoundingClientRect();
      it.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 60, clientY: r.top + 8 }));
      const m = document.querySelector('.ctx.root');
      const mover = [...m.children].find(x => x.textContent.startsWith('Mover a'));
      const sub = mover.querySelector('.ctx'); sub.style.display = 'block';
      return { opciones: [...m.children].map(x => x.firstChild ? (x.childNodes[0].textContent || x.childNodes[1]?.textContent) : ''), moverA: [...sub.children].map(x => x.textContent) };
    })()`);
    await shot(win, `${tag}-03-menu-mover-a`);
    await js(win, `nexuraApp.closeMenus(); true`);

    // 5) arrastrar: «Bodas» dentro de «2024», «Techno» delante de «2025» (mismo nivel), ciclo rechazado y vuelta a la raíz
    c.arrastrar = await js(win, `(() => {
      const L = nexuraApp.library;
      __drag('vieja', '.side-item[data-view="crate:y2024"]', 0.5);
      const dentro = L.crate('vieja').parent;
      __drag('techno', '.side-item[data-view="crate:y2025"]', 0.1);
      const delante = { parent: L.crate('techno').parent, arbol: ${tree} };
      __drag('dance', '.side-item[data-view="crate:peak"]', 0.5);
      const ciclo = { parentDance: L.crate('dance').parent, aviso: [...document.querySelectorAll('.toast')].map(t => t.textContent).pop() || '' };
      __drag('techno', '.side-sec[title*="raíz"]', 0.5);
      const raiz = L.crate('techno').parent;
      // pistas arrastradas a un subcrate
      const it = document.querySelector('.side-item[data-view="crate:peak"]'), dt = new DataTransfer(); dt.setData('text/nexura-track', 't7');
      const r = it.getBoundingClientRect(), o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.top + 8 };
      it.dispatchEvent(new DragEvent('dragover', o)); it.dispatchEvent(new DragEvent('drop', o));
      return { bodasEn2024: dentro === 'y2024', delante, ciclo, technoEnRaiz: raiz === null, pistaEnPeak: L.crate('peak').ids.includes('t7'), arbolFinal: ${tree} };
    })()`);
    await shot(win, `${tag}-04-tras-arrastrar`);

    // 6) «Mostrar en qué crates está» con la ruta completa
    c.cratesDe = await js(win, `(() => { nexuraApp.libraryUI.showCratesOf(nexuraApp.library.get('t0')); return [...document.querySelectorAll('.crates-of-list li')].map(li => li.childNodes[1].textContent); })()`);
    await shot(win, `${tag}-05-en-que-crates-esta`);
    await js(win, `nexuraApp.closeModal(); true`);

    // 7) borrar una crate con subcrates: diálogo con las dos opciones
    c.borrar = await js(win, `(async () => {
      const ui = nexuraApp.libraryUI;
      const p = ui.deleteCrateAsk(nexuraApp.library.crate('th'));
      await new Promise(r => setTimeout(r, 100));
      return { botones: [...document.querySelectorAll('.modal-foot .btn')].map(b => b.textContent), texto: document.querySelector('.modal-body').textContent };
    })()`);
    await shot(win, `${tag}-06-borrar-con-subcrates`);
    c.borrarSubir = await js(win, `(async () => {
      [...document.querySelectorAll('.modal-foot .btn')].find(b => b.textContent.startsWith('Subir')).click();
      await new Promise(r => setTimeout(r, 100));
      return { arbol: ${tree}, peakPadre: nexuraApp.library.crate('peak').parent };
    })()`);

    // 8) ajuste «Mostrar pistas de los subcrates» desactivado
    c.ajuste = await js(win, `(() => {
      const ui = nexuraApp.libraryUI; ui.setView('crate:dance');
      const con = ui.countEl.textContent;
      nexuraApp.setSetting('crateSubTracks', false);
      const sin = ui.countEl.textContent, lateral = document.querySelector('[data-view="crate:dance"] .si-count').textContent;
      nexuraApp.setSetting('crateSubTracks', true);
      return { con, sin, contadorLateralSin: lateral };
    })()`);
    await js(win, `nexuraApp.settingsUI.open('library'); true`);
    await wait(300);
    win.webContents.invalidate(); await wait(500);
    fs.writeFileSync(path.join(OUT, `${tag}-07-ajustes-biblioteca.png`), (await win.webContents.capturePage()).toPNG());
    console.log('captura', `${tag}-07-ajustes-biblioteca`);

    // 9) protegida: no se mueve
    c.protegida = await js(win, `(() => { const L = nexuraApp.library; nexuraApp.setSetting('protectLibrary', true); __drag('y2025', '.side-item[data-view="crate:techno"]', 0.5); const r = { parent2025: L.crate('y2025').parent, aviso: [...document.querySelectorAll('.toast')].map(t => t.textContent).pop() || '' }; nexuraApp.setSetting('protectLibrary', false); return r; })()`);
    win.destroy();
  }
  fs.writeFileSync(path.join(OUT, 'ui-check-subcrates.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.quit();
});
