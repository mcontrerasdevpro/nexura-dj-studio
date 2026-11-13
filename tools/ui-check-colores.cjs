// Temas de color (rc.4, «hay mucho color azul»), con Electron contra `npm run web`.
// Pantalla principal con pistas cargadas en los dos decks (EN DECK y SUPERIOR) en los tres temas a 1496×885;
// con Grafito además 1280×720, FX abiertos, sampler, biblioteca con crates, menú contextual, aviso, modo laptop
// y los diálogos (Ajustes, asistente MIDI, Spotify, informe, bienvenida, novedades, aviso de actualización).
// En cada pantalla: busca colores azulados en los estilos calculados (fuera del Deck 1 y de las tonalidades)
// y mide el contraste WCAG de los textos sobre su fondo real. Capturas e informe en .revision/colores-neutros/.
// Uso: npx electron tools/ui-check-colores.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = path.join(__dirname, '..', '.revision', 'colores-neutros');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function seed(theme) {
  const now = Date.now(), tracks = [];
  const names = [['Fisher', 'Losing It', 'Tech House', 125, '1A'], ['Chris Lake', 'Turn Off The Lights', 'Tech House', 126, '8A'], ['John Summit', 'Where You Are', 'House', 126, '5A'],
    ['Dom Dolla', 'Saving Up', 'Tech House', 126, '6A'], ['Mau P', 'Drugs From Amsterdam', 'Tech House', 128, '10A'], ['Peggy Gou', 'Starry Night', 'House', 120, '10B'],
    ['Solomun', 'Customer Is King', 'Deep House', 121, '6A'], ['Charlotte de Witte', 'Selected', 'Techno', 134, '4A'], ['Amelie Lens', 'Feel It', 'Techno', 132, '9A'],
    ['Bicep', 'Glue', 'Electronica', 130, '3B'], ['Kerri Chandler', 'Rain', 'Deep House', 122, '11A'], ['Tale Of Us', 'Nova', 'Melodic Techno', 123, '2A']];
  names.forEach(([artist, title, genre, bpm, camelot], i) => tracks.push({
    id: 't' + i, path: `web:${artist} - ${title}.mp3:${1000 + i}`, source: 'local', title, artist, album: 'Álbum ' + (i + 1), genre, year: String(2015 + i),
    comment: '', rating: i % 6, bpm, firstBeat: 0.1, key: '', camelot, duration: 180 + i * 23, size: 1000 + i, rmsDb: -10,
    cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: now - i * 86400000, plays: i % 3, lastPlayed: i === 4 ? now - 3600000 : 0,
    analyzed: true, energy: 4 + (i % 6), sections: []
  }));
  return {
    library: { version: 1, tracks, crates: [
      { id: 'dance', name: 'Dance', ids: ['t5', 't6'], created: now - 9000, color: '#ff3b47' },
      { id: 'y80', name: 'Años 80', ids: ['t0', 't1', 't2', 't3', 't4', 't9', 't10', 't11'], parent: 'dance', created: now - 8000 },
      { id: 'y90', name: 'Años 90', ids: ['t2', 't3', 't0'], parent: 'dance', created: now - 7000 },
      { id: 'pop', name: 'Pop', ids: ['t8'], created: now - 6000, color: '#2fd8c8' },
      { id: 'p90', name: 'Pop 1990', ids: ['t8', 't9'], parent: 'pop', created: now - 5000 },
      { id: 'techno', name: 'Techno', ids: ['t7', 't8'], created: now - 4000 }],
      smart: [{ id: 's1', name: 'Más de 125 BPM', rules: [{ field: 'bpm', op: 'gt', value: 125 }], match: 'all' }], history: [], prepare: ['t1', 't2'], ytPlaylists: [] },
    settings: { welcomeDone: true, lastVersion: '9.9.9', theme, libView: 'crate:y80', crateSort: 'custom', waveLayout: 'deck', libSideW: 240, libSort: { field: null, dir: 1 },
      panels: { sampler: true }, libCols: ['title', 'artist', 'bpm', 'camelot', 'duration', 'rating', 'genre', 'energy', 'added'] }
  };
}

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));

// Pistas sintéticas (bombo + bajo + charles) con forma de onda real, hot cues y los dos decks cargados; el 1 suena
const PREPARE = `(async () => {
  const app = nexuraApp, { computeWaveform } = await import('/js/analysis/analysis-core.js'), { CUE_COLORS } = await import('/js/util.js');
  const ctx = app.engine.ctx, sr = ctx.sampleRate, D = 90;
  const make = (bpm, seed) => {
    const N = sr * D, buf = ctx.createBuffer(2, N, sr), L = buf.getChannelData(0), bl = 60 / bpm;
    for (let b = 0.1; b < D - 0.5; b += bl) { const i0 = Math.round(b * sr); const brk = b > 40 && b < 52;
      for (let i = 0; i < sr * 0.18 && i0 + i < N; i++) { const t = i / sr; if (!brk) L[i0 + i] += 0.75 * Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-t * 30)) * t) * Math.exp(-t * 11); }
      const h0 = Math.round((b + bl / 2) * sr); for (let i = 0; i < sr * 0.04 && h0 + i < N; i++) L[h0 + i] += 0.25 * (Math.random() * 2 - 1) * Math.exp(-i / sr * 90); }
    for (let i = 0; i < N; i++) L[i] += 0.12 * Math.sin(2 * Math.PI * (220 + seed * 40) * i / sr) * (0.5 + 0.5 * Math.sin(i / sr * 0.7));
    buf.getChannelData(1).set(L);
    return { buf, w: computeWaveform(L, sr) };
  };
  for (const [i, id, bpm] of [[0, 't2', 126], [1, 't7', 128]]) {
    const t = app.library.get(id), { buf, w } = make(bpm, i);
    app.analyzer.waves.set(t.id, { data: w.data, rate: w.rate });
    const cues = Array(8).fill(null); [8, 20, 34, 52, 66].forEach((s, k) => { cues[k] = { t: s, color: CUE_COLORS[k], name: '' }; });
    app.library.update(t.id, { bpm, firstBeat: 0.1, duration: D, cues, sections: [{ t: 0.1, type: 'intro', label: 'INTRO' }, { t: 16, type: 'drop', label: 'DROP' }, { t: 40, type: 'break', label: 'BREAK' }, { t: 52, type: 'drop', label: 'DROP 2' }] });
    await app.decks[i].load(t, buf);
  }
  app.decks[0].seek(27); app.decks[1].seek(12);
  app.decks[0].play();
  app.libraryUI.setView('crate:y80'); app.libraryUI.refresh();
  const ui = app.libraryUI; ui.sel = new Set(['t3', 't4']); ui.cursor = ui.anchor = ui.rows.findIndex(t => t.id === 't3'); ui.renderRows();
  return { decks: app.decks.slice(0, 2).map(d => d.track && d.track.title), suena: app.decks[0].playing };
})()`;

// Colores azulados en los estilos calculados de todo lo visible. Se admiten el Deck 1 (su deck, su onda y su
// canal), las tonalidades (keyColor) y las marcas de deck de la tabla.
const SCAN = `(() => {
  const parse = (s) => [...String(s).matchAll(/rgba?\\(([^)]+)\\)/g)].map(m => { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1, s: m[0] }; });
  const blue = (c) => { const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b), ch = max - min; if (ch < 12 || c.a < 0.06) return false;
    let h = max === c.r ? ((c.g - c.b) / ch) % 6 : max === c.g ? (c.b - c.r) / ch + 2 : (c.r - c.g) / ch + 4; h *= 60; if (h < 0) h += 360; return h >= 190 && h <= 255; };
  const ALLOW = '#deck0, #wave0, .strip.s0, .st.deck0, .layer-tab[data-deck="0"], .key, .d-key, .row-t .num.key';
  const name = (e) => (e.id ? '#' + e.id : e.tagName.toLowerCase()) + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');
  const found = [], deck1 = new Set();
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('[hidden]') || e.tagName === 'OPTION' || e.tagName === 'CANVAS') continue;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const text = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const props = { backgroundColor: cs.backgroundColor, backgroundImage: cs.backgroundImage, borderTopColor: +cs.borderTopWidth ? cs.borderTopColor : '', borderLeftColor: +cs.borderLeftWidth ? cs.borderLeftColor : '',
      borderBottomColor: +cs.borderBottomWidth ? cs.borderBottomColor : '', boxShadow: cs.boxShadow, outlineColor: cs.outlineStyle !== 'none' ? cs.outlineColor : '' };
    if (text || e instanceof SVGElement) props.color = cs.color;
    if (e instanceof SVGElement) { props.stroke = cs.stroke; props.fill = cs.fill; }
    for (const [k, v] of Object.entries(props)) for (const c of parse(v)) if (blue(c)) {
      const n = name(e) + ' · ' + k + ' ' + c.s;
      if (e.closest(ALLOW)) deck1.add(name(e.closest(ALLOW)) + ' › ' + n); else found.push(n);
    }
  }
  return { azules: [...new Set(found)], deck1: [...deck1].slice(0, 60), deck1Total: deck1.size };
})()`;

// Contraste de cada texto visible sobre su fondo real (fondos de los antepasados compuestos; los degradados de
// los botones cuentan con su color medio). Excluye controles desactivados y marcadores de posición.
const CONTRAST = `(() => {
  const P = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s || ''); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (e) => { const stack = []; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); let c = P(cs.backgroundColor);
      const g = /gradient/.test(cs.backgroundImage) ? [...cs.backgroundImage.matchAll(/rgba?\\([^)]+\\)/g)].map(m => P(m[0])) : [];
      if (g.length) c = { r: g.reduce((s, x) => s + x.r, 0) / g.length, g: g.reduce((s, x) => s + x.g, 0) / g.length, b: g.reduce((s, x) => s + x.b, 0) / g.length, a: 1 };
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
    let b = { r: 0, g: 0, b: 0, a: 1 }; for (const c of stack.reverse()) b = over(c, b); return b; };
  const name = (e) => (e.id ? '#' + e.id : e.tagName.toLowerCase()) + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');
  let n = 0; const low = [];
  for (const e of document.querySelectorAll('body *')) {
    // .logo b: texto con degradado (background-clip: text), su «fondo» es el propio degradado
    if (e.closest('[hidden], [disabled], .btn:disabled, canvas, .ext-off, .platter-col .yt-box, .logo b') || e.tagName === 'OPTION') continue;
    const txt = [...e.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent.trim()).join(' ').trim(); if (!txt) continue;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || +cs.opacity < 0.95) continue;
    let op = 1; for (let a = e; a; a = a.parentElement) op *= +getComputedStyle(a).opacity; if (op < 0.95) continue;
    const fg = P(cs.color); if (!fg || fg.a === 0) continue;
    const bg = bgOf(e), k = ratio(over(fg, bg), bg); n++;
    if (k < 4.5) low.push({ el: name(e), texto: txt.slice(0, 40), ratio: Math.round(k * 100) / 100, px: parseFloat(cs.fontSize), color: cs.color });
  }
  low.sort((a, b) => a.ratio - b.ratio);
  return { textos: n, bajos: low.length, lista: low.slice(0, 40) };
})()`;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], pantallas: {} };
  let win = null, cur = '';
  const open = async (theme, w, h) => {
    if (win) win.destroy();
    win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3 && !/favicon|ERR_FILE_NOT_FOUND|web:/.test(message)) report.errors.push(`${cur} ${message} (${path.basename(src || '')}:${line})`); });
    await load(win);
    const data = seed(theme);
    await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(data.settings))}); true`);
    await load(win);
    await wait(2500);
    await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); document.querySelectorAll('.toast').forEach(t => t.remove()); nexuraApp.engine.resume(); true`);
    const prep = await js(win, PREPARE);
    await wait(600);
    return prep;
  };
  const shot = async (name, opts = {}) => {
    cur = name;
    win.webContents.invalidate();
    await wait(opts.wait || 600);
    fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
    const scan = await js(win, SCAN), contrast = await js(win, CONTRAST);
    const theme = await js(win, `document.documentElement.dataset.theme || 'grafito'`);
    report.pantallas[name] = { tema: theme, azules: scan.azules, deck1: scan.deck1Total, ejemplosDeck1: scan.deck1, contraste: contrast };
    console.log(`captura ${name} · tema ${theme} · azules fuera del Deck 1: ${scan.azules?.length} · textos < 4,5:1: ${contrast.bajos}/${contrast.textos}`);
  };
  const closeAll = () => js(win, `document.querySelectorAll('.modal-ov, .ctx, .ap-panel').forEach(m => m.remove()); document.querySelectorAll('.toast').forEach(t => t.remove()); nexuraApp.closeMenus?.(); true`);

  // 1) pantalla principal en los tres temas a 1496×885, EN DECK y SUPERIOR
  for (const theme of ['grafito', 'carbon', 'azul']) {
    report.preparar = await open(theme, 1496, 885);
    await shot(`1496x885-${theme}-1-en-deck`);
    await js(win, `nexuraApp.setWaveLayout('serato'); true`);
    await shot(`1496x885-${theme}-2-superior`);
    if (theme !== 'grafito') continue;
    // FX abiertos (☰) con un efecto encendido
    await js(win, `document.body.classList.add('topbar-expanded'); document.querySelector('#fx1 .btn.fxon')?.click(); true`);
    await shot(`1496x885-grafito-3-fx-abiertos`);
    await js(win, `document.body.classList.remove('topbar-expanded'); nexuraApp.setWaveLayout('deck'); true`);
    // biblioteca: árbol desplegado, crate activa y barra de iconos
    await js(win, `nexuraApp.setSetting('libRail', 'on'); nexuraApp.libraryUI.updateRail?.(); nexuraApp.libraryUI.renderSide(); nexuraApp.libraryUI.toggleFocus('side'); document.querySelector('#library').scrollIntoView({ block: 'end' }); true`);
    await shot(`1496x885-grafito-4-biblioteca-crates`);
    // menú contextual de una pista y aviso
    await js(win, `(() => { const r = document.querySelector('.row-t.sel') || document.querySelector('.row-t'); const b = r.getBoundingClientRect();
      r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 200, clientY: b.top + 10, button: 2 }));
      nexuraApp.toast('2 pistas quitadas de «Dance › Años 80»', 'info', 60000, { label: 'Deshacer', fn: () => {} }); nexuraApp.toast('Análisis terminado', 'ok', 60000); return true; })()`);
    await shot(`1496x885-grafito-5-menu-y-avisos`);
    await closeAll();
    // modo laptop
    await js(win, `nexuraApp.setSetting('libRail', 'auto'); nexuraApp.toggleLaptopMode(); nexuraApp.libraryUI.updateRail?.(); true`);
    await shot(`1496x885-grafito-6-modo-laptop`);
    await js(win, `nexuraApp.toggleLaptopMode(); nexuraApp.libraryUI.updateRail?.(); true`);
    // diálogos
    const dialogs = [
      ['7-ajustes-general', `nexuraApp.settingsUI.open('general')`],
      ['8-ajustes-biblioteca', `nexuraApp.settingsUI.open('library')`],
      ['9-ajustes-midi', `nexuraApp.settingsUI.open('midi')`],
      // sin controladora real: se simula una conectada solo para abrir el asistente
      ['10-asistente-midi', `Object.defineProperty(nexuraApp.midi, 'connectedNames', { get: () => ['Controladora de prueba'], configurable: true });
        import('/js/ui/midi-wizard.js').then(m => { const w = new m.MidiWizard(nexuraApp); w.open('Controladora de prueba'); setTimeout(() => document.querySelector('.wizard .btn.primary')?.click(), 150); })`],
      ['11-spotify', `nexuraApp.spotifyImportDialog('')`],
      ['12-informe', `nexuraApp.feedback.open()`],
      ['13-bienvenida', `nexuraApp.welcome.open()`],
      ['14-novedades', `nexuraApp.notes.show()`],
      ['16-autoplay', `document.querySelector('.btn.autoplay-btn')?.click()`],
    ];
    for (const [n, code] of dialogs) {
      await js(win, `(() => { ${code}; return true; })()`);
      await shot(`1496x885-grafito-${n}`);
      await closeAll();
    }
    await js(win, `nexuraApp.updatesUI.onEvent({ state: 'available', version: '1.0.0-rc.4', percent: 0, notes: ['Tema de color Grafito: menos azul', 'Selector de tema en Ajustes'] }); true`);
    await shot(`1496x885-grafito-15-aviso-actualizacion`);
    // el selector de tema cambia al momento y se guarda
    report.selector = await js(win, `(async () => { const s = nexuraApp.settingsUI; s.open('general'); await new Promise(r => setTimeout(r, 200));
      const sel = document.querySelector('#set-theme'), opciones = [...sel.options].map(o => o.textContent);
      sel.value = 'azul'; sel.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 100));
      const azul = { tema: document.documentElement.dataset.theme, fondo: getComputedStyle(document.body).backgroundColor, ajuste: nexuraApp.settings.theme };
      sel.value = 'grafito'; sel.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 100));
      const grafito = { tema: document.documentElement.dataset.theme || 'grafito', fondo: getComputedStyle(document.body).backgroundColor, ajuste: nexuraApp.settings.theme };
      await new Promise(r => setTimeout(r, 600)); const guardado = JSON.parse(localStorage.getItem('nexura_settings') || '{}').theme;
      return { opciones, azul, grafito, guardado }; })()`);
    await closeAll();
  }
  // 2) 1280×720 con Grafito
  await open('grafito', 1280, 720);
  await shot('1280x720-grafito-1-en-deck');
  await js(win, `nexuraApp.setWaveLayout('serato'); true`);
  await shot('1280x720-grafito-2-superior');
  win.destroy(); win = null;
  // quien actualiza: settings guardados sin la clave theme → arranca en Grafito
  {
    const w2 = new BrowserWindow({ width: 1280, height: 720, show: false, webPreferences: { offscreen: true } });
    await load(w2);
    const s = seed('grafito').settings; delete s.theme;
    await w2.webContents.executeJavaScript(`localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(s))}); true`);
    await load(w2); await wait(2000);
    report.actualizaSinTema = await w2.webContents.executeJavaScript(`({ tema: document.documentElement.dataset.theme || 'grafito', ajuste: nexuraApp.settings.theme, fondo: getComputedStyle(document.body).backgroundColor })`);
    w2.destroy();
  }
  const totalAzules = Object.values(report.pantallas).filter(p => p.tema !== 'azul').reduce((s, p) => s + (p.azules?.length || 0), 0);
  report.resumen = { pantallas: Object.keys(report.pantallas).length, azulesFueraDelDeck1EnGrafitoYCarbon: totalAzules,
    textosBajos: Object.fromEntries(Object.entries(report.pantallas).map(([k, p]) => [k, p.contraste?.bajos])), errores: report.errors.length };
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ resumen: report.resumen, selector: report.selector, actualizaSinTema: report.actualizaSinTema, errores: report.errors.slice(0, 10) }, null, 2));
  const sel = report.selector || {};
  const ok = !totalAzules && !report.errors.length && sel.opciones?.length === 3 && sel.azul?.tema === 'azul' && sel.grafito?.tema === 'grafito' && sel.guardado === 'grafito' && report.actualizaSinTema?.ajuste === 'grafito';
  console.log(ok ? 'TODO OK · capturas e informe en .revision/colores-neutros/' : '✗ fallos: revisa .revision/colores-neutros/informe.json');
  app.exit(ok ? 0 : 1);
});
