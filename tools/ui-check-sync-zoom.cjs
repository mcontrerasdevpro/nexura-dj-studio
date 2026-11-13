// SYNC, zoom de la forma de onda enlazado y «Modo rendimiento», con Electron contra `npm run web`.
// Dos pistas de clics generadas en la página a 124 y 128 BPM (forma de onda real) en los decks 1 y 2:
// - SYNC (clic de verdad en el botón): mismo BPM, fase alineada (medidor de fase en verde) y maestro = el
//   primero que suena; cambiar el tempo del maestro arrastra al otro; botón MASTER para elegir el maestro;
//   el pitch del deck sincronizado cambia el tempo de los dos sin desfasarlos.
// - Zoom: botones +/−, rueda y teclado cambian a la vez todos los decks en SUPERIOR y EN DECK; Ajustes →
//   Reproducción «Independiente por deck» (recordado al recargar).
// - Modo rendimiento (Ajustes → Audio): la app dibuja a ~30 fps (a ~60 sin él), sin animaciones; fila de la GPU.
// - Temas Grafito, Carbón y Azul noche: MASTER y medidor de fase con las variables del tema, ondas y plato
//   redibujados con sus colores y Modo rendimiento funcionando en los tres.
// Capturas e informe en .revision/fix-feedback/. Uso: npx electron tools/ui-check-sync-zoom.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = path.join(__dirname, '..', '.revision', 'fix-feedback');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const track = (id, title, bpm, firstBeat) => ({
  id, path: `web:${title}.wav:${bpm}`, source: 'local', title, artist: 'Prueba', album: '', genre: 'House', year: '2026', comment: '', rating: 0,
  bpm, firstBeat, bpmLocked: true, key: '', camelot: '8A', duration: 90, size: 1, rmsDb: -10, cues: Array(8).fill(null), loops: Array(8).fill(null),
  cueLoops: Array(8).fill(null), added: Date.now(), plays: 0, lastPlayed: 0, analyzed: true, energy: 6, sections: []
});
const seed = () => ({
  library: { version: 1, tracks: [track('c124', 'Clic 124', 124, 0.1), track('c128', 'Clic 128', 128, 0.23)], crates: [], smart: [], history: [], prepare: [], ytPlaylists: [] },
  settings: { welcomeDone: true, libView: 'all', waveLayout: 'serato', autoAnalyze: false, autoGain: false, lastVersion: '9.9.9' }
});

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(500);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura', name);
}
async function click(win, sel) {
  const r = await js(win, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  if (!r || r.error) throw new Error('no encuentro ' + sel);
  const x = Math.round(r.x), y = Math.round(r.y);
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await wait(50);
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await wait(300);
}
async function wheel(win, sel, dy) {
  const r = await js(win, `(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.left + b.width * 0.7, y: b.top + b.height / 2 }; })()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(r.x), y: Math.round(r.y) });
  win.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(r.x), y: Math.round(r.y), deltaX: 0, deltaY: -dy, canScroll: true });
  await wait(250);
}
async function key(win, keyCode) {
  await js(win, `document.activeElement && document.activeElement.blur && document.activeElement.blur(); true`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  await wait(250);
}

// pistas de clics (bombo + clic en cada beat del grid) y su forma de onda; se cargan en los decks 1 y 2
const PREPARE = `(async () => {
  const A = nexuraApp, ctx = A.engine.ctx, sr = ctx.sampleRate;
  const { computeWaveform } = await import('/js/analysis/analysis-core.js');
  for (const [i, id] of [[0, 'c124'], [1, 'c128']]) {
    const t = A.library.get(id), N = sr * 90, buf = ctx.createBuffer(2, N, sr), L = buf.getChannelData(0);
    for (let b = 0, x = t.firstBeat; x < 89.5; b++, x = t.firstBeat + b * 60 / t.bpm) {
      const i0 = Math.round(x * sr), acc = b % 4 ? 0.6 : 1;
      for (let k = 0; k < sr * 0.12 && i0 + k < N; k++) { const tt = k / sr; L[i0 + k] += acc * (0.55 * Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-tt * 40)) * tt) * Math.exp(-tt * 18) + (tt < 0.003 ? 0.5 * Math.sin(2 * Math.PI * 2000 * tt) : 0)); }
    }
    buf.getChannelData(1).set(L);
    const w = computeWaveform(L, sr);
    A.analyzer.waves.set(id, { data: w.data, rate: w.rate });
    await A.decks[i].load(t, buf);
    A.waves[i].setWave(A.analyzer.waves.get(id)); A.deckUIs[i].overview.setWave(A.analyzer.waves.get(id)); A.deckUIs[i].waveDetail.setWave(A.analyzer.waves.get(id));
  }
  A.engine.setMaster(0.2);
  return A.decks.slice(0, 2).map(d => d.track && d.track.id);
})()`;
const STATE = `(() => { const A = nexuraApp, [a, b] = A.decks;
  const pi = (d) => { const p = d.phaseInfo(); return p ? +p.ms.toFixed(2) : null; };
  return { bpm: [+a.currentBpm.toFixed(3), +b.currentBpm.toFixed(3)], sync: [a.sync, b.sync], playing: [a.playing, b.playing],
    master: A.syncMgr.current ? A.syncMgr.current.idx : null, masterOn: A.deckUIs.slice(0, 2).map(u => u.masterEl.classList.contains('on')),
    phase: [pi(a), pi(b)], meter: A.deckUIs.slice(0, 2).map(u => u.phaseMeter.classList.contains('off') ? 'off' : u.phaseMeter.dataset.state),
    syncOn: A.deckUIs.slice(0, 2).map(u => u.syncBtn.classList.contains('on')) }; })()`;
const ZOOMS = `(() => { const A = nexuraApp; return { top: A.waves.slice(0, 2).map(w => +w.zoom.toFixed(3)), deck: A.deckUIs.slice(0, 2).map(u => +u.waveDetail.zoom.toFixed(3)), link: A.settings.waveZoomLink, saved: A.settings.waveZoom, decks: A.settings.waveZoomDecks }; })()`;
// frames que dibuja la app en `ms`
const FPS = (ms) => `new Promise(r => { const A = nexuraApp, o = A.render; let n = 0; A.render = function () { n++; return o.apply(this, arguments); }; setTimeout(() => { A.render = o; r(n * 1000 / ${ms}); }, ${ms}); })`;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {}, ok: true };
  const check = (name, cond, data) => { report.checks[name] = { ok: !!cond, ...data }; if (!cond) { report.ok = false; console.log('✗', name, JSON.stringify(data)); } else console.log('✓', name); };

  const win = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  await load(win);
  const data = seed();
  await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(data.settings))}); true`);
  await load(win);
  await wait(2500);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); nexuraApp.engine.resume(); true`);
  const prep = await js(win, PREPARE);
  check('Pistas de clics de 124 y 128 BPM cargadas en los decks 1 y 2', JSON.stringify(prep) === '["c124","c128"]', { prep });

  // ---------------------------------------------------------------- SYNC
  await js(win, `nexuraApp.decks[0].play(); true`);
  await wait(400);
  await js(win, `nexuraApp.decks[1].play(); true`);
  await wait(800);
  let s = await js(win, STATE);
  check('Maestro = el primero que suena (Deck 1), con su indicador MASTER encendido', s.master === 0 && s.masterOn[0] && !s.masterOn[1], s);
  check('Sin SYNC, el Deck 2 sigue a 128 BPM y el medidor de fase lo muestra (no está en verde)', Math.abs(s.bpm[1] - 128) < 0.01 && s.meter[1] !== 'off' && s.meter[1] !== 'ok', s);
  await shot(win, '1280x800-01-antes-del-sync');
  await click(win, '#deck1 .transport .btn.sync');
  await wait(1500);
  s = await js(win, STATE);
  check('Clic en SYNC del Deck 2: mismo BPM que el maestro (124) y botón encendido', s.sync[1] && s.syncOn[1] && Math.abs(s.bpm[1] - 124) < 0.01, s);
  check('…fase alineada (|desfase| < 5 ms) y medidor de fase en verde', Math.abs(s.phase[1]) < 5 && s.meter[1] === 'ok', s);
  await shot(win, '1280x800-02-sync');
  // el maestro cambia de tempo (su fader de pitch a +4 %) y arrastra al sincronizado
  await js(win, `nexuraApp.deckUIs[0].pitchFader.set(0.75); true`);
  await wait(1500);
  s = await js(win, STATE);
  check('Cambiar el tempo del maestro (+4 %) arrastra al Deck 2 (128,96 BPM) y sigue en fase', Math.abs(s.bpm[0] - 128.96) < 0.01 && Math.abs(s.bpm[1] - 128.96) < 0.01 && Math.abs(s.phase[1]) < 5, s);
  // pitch del deck sincronizado: cambia el tempo de los dos, sin desfase
  await js(win, `nexuraApp.deckUIs[1].pitchFader.set(0.4); true`);
  await wait(1500);
  s = await js(win, STATE);
  check('Mover el pitch del Deck 2 (sincronizado) cambia el tempo de los dos y siguen en fase', Math.abs(s.bpm[0] - s.bpm[1]) < 0.01 && s.bpm[0] < 128.9 && Math.abs(s.phase[1]) < 5 && s.sync[1], s);
  // elegir maestro con el botón MASTER del Deck 2; SYNC en el Deck 1 → sigue al Deck 2
  await click(win, '#deck1 .master-ind');
  await click(win, '#deck0 .transport .btn.sync');
  await js(win, `nexuraApp.deckUIs[1].pitchFader.set(0.6); true`);
  await wait(1500);
  s = await js(win, STATE);
  check('Botón MASTER del Deck 2: pasa a ser el maestro y el Deck 1 (con SYNC) lo sigue en tempo y fase', s.master === 1 && s.masterOn[1] && !s.masterOn[0] && Math.abs(s.bpm[0] - s.bpm[1]) < 0.01 && Math.abs(s.phase[0]) < 5 && s.meter[0] === 'ok', s);
  await shot(win, '1280x800-03-maestro-deck2');
  win.setContentSize(375, 812);
  await wait(900);
  await shot(win, '375x812-01-sync');
  win.setContentSize(1280, 800);
  await wait(600);

  // ---------------------------------------------------------------- zoom
  await js(win, `nexuraApp.decks.forEach(d => d.setSync(false)); true`);
  let z0 = await js(win, ZOOMS);
  check('Zoom enlazado por defecto: los cuatro lienzos con el mismo zoom', z0.link === true && new Set([...z0.top, ...z0.deck]).size === 1, z0);
  await click(win, '#wave-zoom .btn:last-child'); // «+»
  let z1 = await js(win, ZOOMS);
  check('Botón «+»: acerca a la vez los dos decks (arriba y en el deck)', new Set([...z1.top, ...z1.deck]).size === 1 && z1.top[0] < z0.top[0] && Math.abs(z1.saved - z1.top[0]) < 1e-3, { z0, z1 });
  await wheel(win, '#wave0', 120);
  let z2 = await js(win, ZOOMS);
  check('Rueda sobre la onda del Deck 1: cambia también la del Deck 2', new Set([...z2.top, ...z2.deck]).size === 1 && z2.top[0] !== z1.top[0], { z1, z2 });
  await key(win, '-');
  let z3 = await js(win, ZOOMS);
  check('Tecla «−»: aleja los dos decks a la vez', new Set([...z3.top, ...z3.deck]).size === 1 && z3.top[0] > z2.top[0], { z2, z3 });
  await js(win, `nexuraApp.setWaveLayout('deck'); true`);
  await wait(500);
  await wheel(win, '#deck0 .deck-detail-wave', 120);
  let z4 = await js(win, ZOOMS);
  check('EN DECK: rueda sobre la onda del Deck 1 → mismo zoom en los dos decks', new Set([...z4.top, ...z4.deck]).size === 1 && z4.deck[0] !== z3.deck[0], { z3, z4 });
  await shot(win, '1280x800-04-zoom-en-deck');
  await js(win, `nexuraApp.setWaveLayout('serato'); true`);
  // Ajustes → Reproducción: independiente por deck
  await js(win, `nexuraApp.settingsUI.open('play'); true`);
  await wait(500);
  const opt = await js(win, `(() => { const s = document.querySelector('#set-wave-zoom'); return s ? [...s.options].map(o => o.textContent) : null; })()`);
  check('Ajustes → Reproducción: «Zoom de la forma de onda» con «Igual en todos los decks (recomendado)» / «Independiente por deck»', JSON.stringify(opt) === JSON.stringify(['Igual en todos los decks (recomendado)', 'Independiente por deck']), { opt });
  await shot(win, '1280x800-05-ajuste-zoom');
  await js(win, `(() => { const s = document.querySelector('#set-wave-zoom'); s.value = 'deck'; s.dispatchEvent(new Event('change')); nexuraApp.closeModal(); return true; })()`);
  await wait(400);
  const zb = await js(win, ZOOMS);
  await wheel(win, '#wave0', 120);
  await wheel(win, '#wave0', 120);
  let z5 = await js(win, ZOOMS);
  check('Independiente: la rueda sobre el Deck 1 solo cambia el Deck 1 (arriba y en el deck)', z5.link === false && z5.top[0] !== zb.top[0] && z5.top[1] === zb.top[1] && z5.deck[0] === z5.top[0] && z5.deck[1] === zb.deck[1], { zb, z5 });
  await wait(900); // guardado de ajustes (debounce)
  await load(win);
  await wait(2500);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); true`);
  let z6 = await js(win, ZOOMS);
  check('Al recargar se recuerda «Independiente por deck» y el zoom de cada deck', z6.link === false && z6.top[0] === z5.top[0] && z6.top[1] === z5.top[1], { z5, z6 });
  await js(win, `nexuraApp.setSetting('waveZoomLink', true); true`);
  let z7 = await js(win, ZOOMS);
  check('Volver a «Igual en todos los decks»: los dos decks vuelven al mismo zoom', z7.link === true && new Set([...z7.top, ...z7.deck]).size === 1, { z7 });

  // ---------------------------------------------------------------- modo rendimiento
  await js(win, (PREPARE));
  await js(win, `nexuraApp.decks[0].play(); nexuraApp.decks[1].play(); true`);
  await wait(500);
  const fpsNormal = await js(win, FPS(2000));
  await js(win, `nexuraApp.settingsUI.open('audio'); true`);
  await wait(700);
  const gpuRow = await js(win, `(() => { const g = document.querySelector('#set-gpu'); return g ? g.textContent : null; })()`);
  check('Ajustes → Audio: fila «Aceleración por GPU» con su estado', typeof gpuRow === 'string' && gpuRow.length > 3, { gpuRow });
  await click(win, '#set-perf-mode');
  await shot(win, '1280x800-06-modo-rendimiento');
  await js(win, `nexuraApp.closeModal(); true`);
  await wait(400);
  const pm = await js(win, `({ on: nexuraApp.settings.perfMode, cls: document.body.classList.contains('perf-mode'), anim: getComputedStyle(document.querySelector('#topbar .btn.rec') || document.body).animationName })`);
  const fpsPerf = await js(win, FPS(2000));
  check('Modo rendimiento: activado desde Ajustes, la app dibuja a ~30 fps (y a ~60 sin él)', pm.on && pm.cls && fpsPerf > 24 && fpsPerf < 34 && fpsNormal > 50 && fpsNormal < 66, { pm, fpsNormal, fpsPerf });
  await js(win, `nexuraApp.setSetting('perfMode', false); true`);

  // ---------------------------------------------------------------- temas (Grafito, Carbón, Azul noche)
  // MASTER y medidor de fase con las variables del tema (verde = en fase; deck con su color de identidad),
  // ondas y plato redibujados con los colores del tema nuevo y Modo rendimiento en los tres
  await js(win, `nexuraApp.decks[1].setSync(true); true`);
  await wait(1500);
  const THEME = `(() => { const A = nexuraApp, u = A.deckUIs, cs = (e, p) => getComputedStyle(e)[p];
    const v = (name) => { const e = document.createElement('i'); e.style.color = 'var(--' + name + ')'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; };
    const m = u.find(x => x.masterEl.classList.contains('on')), dot = u[1].phaseMeter.querySelector('.pm-dot');
    const deckVar = 'deck' + A.deckUIs.indexOf(m), root = getComputedStyle(document.documentElement), rv = (k) => root.getPropertyValue('--' + k).trim();
    return { theme: A.settings.theme, attr: document.documentElement.dataset.theme || 'grafito',
      masterBg: cs(m.masterEl, 'backgroundColor'), masterText: cs(m.masterEl, 'color'), deckColor: v(deckVar), badge: v('deck-badge-text'),
      meter: u[1].phaseMeter.dataset.state, dot: cs(dot, 'backgroundColor'), okColor: v('ok'),
      waveKey: A.waves.slice(0, 2).every(w => w.lastKey.includes('|' + rv('wave-bg') + '|')) && A.deckUIs[0].overview.lastKey.endsWith('|' + rv('overview-bg')),
      platter: A.deckUIs.filter(x => x._platBg).every(x => x._platBgTheme.startsWith(rv('platter-in') + '|')),
      perf: document.body.classList.contains('perf-mode'), glow: cs(u[1].syncBtn, 'boxShadow') }; })()`;
  for (const t of ['grafito', 'carbon', 'azul']) {
    await js(win, `nexuraApp.setSetting('theme', '${t}'); nexuraApp.setSetting('perfMode', false); true`);
    await wait(700);
    let th = await js(win, THEME);
    check(`Tema ${t}: MASTER en el color de su deck (texto del tema) y medidor de fase en verde del tema`, th.attr === t && th.masterBg === th.deckColor && th.masterText === th.badge && th.meter === 'ok' && th.dot === th.okColor, th);
    check(`Tema ${t}: ondas y plato redibujados con los colores del tema`, th.waveKey && th.platter, th);
    await shot(win, `1280x800-07-tema-${t}`);
    await js(win, `nexuraApp.setSetting('perfMode', true); true`);
    await wait(400);
    const f = await js(win, FPS(2000));
    th = await js(win, THEME);
    check(`Tema ${t}: Modo rendimiento a ~30 fps y sin brillos (SYNC encendido sin sombra)`, th.perf && f > 24 && f < 34 && th.glow === 'none' && th.meter === 'ok', { fps: f, glow: th.glow, meter: th.meter });
  }
  await js(win, `nexuraApp.setSetting('theme', 'grafito'); nexuraApp.setSetting('perfMode', false); nexuraApp.decks.forEach(d => d.pause()); true`);

  report.errors = report.errors.filter(e => !/favicon|ERR_/i.test(e));
  if (report.errors.length) { report.ok = false; console.log('✗ errores en consola: ' + report.errors.join(' | ')); }
  fs.writeFileSync(path.join(OUT, 'informe-ui-sync-zoom.json'), JSON.stringify(report, null, 2));
  console.log(report.ok ? '\nTODO OK' : '\nHAY FALLOS', '· informe en .revision/fix-feedback/informe-ui-sync-zoom.json');
  app.exit(report.ok ? 0 : 1);
});
