// Vista Biblioteca (▤ BIBLIOTECA / F10) y densidad Compacta, con Electron contra `node tools/serve.js` (5180):
// - cambio de vista con el botón y con F10, recordado al recargar, sin cortar los decks que suenan;
// - pistas visibles a 1920×1080, 1366×768 y 1280×800 en Mezcla y en Biblioteca, en Normal y en Compacta
//   (Biblioteca + Compacta a 1920×1080: 30 o más; la biblioteca, siempre al menos la mitad de la altura);
// - con las franjas de efectos y sampler abiertas a 1920×1080, 20 pistas o más; franja de grabación con REC;
// - play, cue, sync, pads y loops rápidos con clic en la vista Biblioteca; panel MIXER; Explorar;
// - sin errores en la consola. Capturas en .revision/capturas-biblioteca/ (mezcla-* = vista Mezcla,
//   despues-biblioteca-* = vista Biblioteca; las antes-mezcla-* son del código anterior a este cambio).
// Uso: npx electron tools/ui-check-vista-biblioteca.cjs
'use strict';
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = process.env.NEXURA_CAPTURAS || path.join(__dirname, '..', '.revision', 'capturas-biblioteca');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const SIZES = [[1920, 1080], [1366, 768], [1280, 800]];

const GENRES = ['House', 'Tech House', 'Techno', 'Pop', 'Reggaeton'];
const track = (i) => ({
  id: 't' + i, path: `web:pista${i}.mp3:1`, source: 'local', title: `Pista de prueba ${i + 1}`, artist: `Artista ${i % 23}`, album: `Álbum ${i % 11}`,
  genre: GENRES[i % GENRES.length], year: '2025', comment: i % 7 ? '' : 'Buen cierre', rating: i % 6, bpm: 118 + (i % 14), firstBeat: 0, key: '', camelot: ((i % 12) + 1) + (i % 2 ? 'A' : 'B'),
  duration: 180 + (i % 120), size: 1, cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null),
  added: Date.now() - i * 3600e3, plays: i % 9, lastPlayed: 0, analyzed: true, energy: 1 + (i % 9), sections: []
});
const click = (id, title, bpm, firstBeat) => ({ ...track(0), id, path: `web:${title}.wav:${bpm}`, title, artist: 'Prueba', genre: 'House', bpm, firstBeat, bpmLocked: true, camelot: '8A', duration: 90, plays: 0 });
const seed = () => {
  const tracks = [click('c124', 'Clic 124', 124, 0.1), click('c128', 'Clic 128', 128, 0.23), ...Array.from({ length: 400 }, (_, i) => track(i))];
  const crates = [
    { id: 'k1', name: 'Dance', ids: tracks.slice(2, 60).map(t => t.id), parent: null },
    { id: 'k2', name: '2024', ids: tracks.slice(10, 30).map(t => t.id), parent: 'k1' },
    { id: 'k3', name: 'Tech House', ids: tracks.slice(30, 50).map(t => t.id), parent: 'k1' },
    { id: 'k4', name: 'Bodas', ids: tracks.slice(60, 120).map(t => t.id), parent: null },
    { id: 'k5', name: 'Warm-up', ids: tracks.slice(120, 140).map(t => t.id), parent: null }
  ];
  return {
    library: { version: 1, tracks, crates, smart: [], history: [{ id: 'h1', date: Date.now() - 86400e3, entries: tracks.slice(2, 12).map((t, i) => ({ id: t.id, at: Date.now() - 86400e3 + i * 240e3 })) }], prepare: tracks.slice(5, 9).map(t => t.id), ytPlaylists: [] },
    settings: { welcomeDone: true, libView: 'all', waveLayout: 'serato', autoAnalyze: false, autoGain: false, lastVersion: '9.9.9', libCols: ['artist', 'bpm', 'camelot', 'duration', 'rating', 'genre', 'album', 'plays', 'comment', 'added'] }
  };
};

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(600);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura', name);
}
async function point(win, sel) {
  const r = await js(win, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); if (!b.width || !b.height) return null; return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  if (!r || r.error) throw new Error('no encuentro (o no se ve) ' + sel);
  return { x: Math.round(r.x), y: Math.round(r.y) };
}
async function clickAt(win, sel, hold = 50) {
  const { x, y } = await point(win, sel);
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await wait(hold);
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await wait(300);
}
async function key(win, keyCode) {
  await js(win, `document.activeElement && document.activeElement.blur && document.activeElement.blur(); true`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  await wait(400);
}
// espera a que termine el arranque (el teclado se enlaza al final, después de MIDI y de las salidas de audio)
const ready = async (win) => {
  await wait(2500);
  for (let i = 0; i < 40 && (await js(win, `typeof nexuraApp.flushAll`)) !== 'function'; i++) await wait(500);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); document.querySelectorAll('.toast').forEach(t => t.remove()); nexuraApp.engine.resume(); true`);
  await wait(300);
};

// pistas de clics (bombo en cada beat) con su forma de onda, en los decks 1 y 2
const PREPARE = `(async () => {
  const A = nexuraApp, ctx = A.engine.ctx, sr = ctx.sampleRate;
  const { computeWaveform } = await import('/js/analysis/analysis-core.js');
  for (const [i, id] of [[0, 'c124'], [1, 'c128']]) {
    const t = A.library.get(id), N = sr * 90, buf = ctx.createBuffer(2, N, sr), L = buf.getChannelData(0);
    for (let b = 0, x = t.firstBeat; x < 89.5; b++, x = t.firstBeat + b * 60 / t.bpm) {
      const i0 = Math.round(x * sr), acc = b % 4 ? 0.6 : 1;
      for (let k = 0; k < sr * 0.12 && i0 + k < N; k++) { const tt = k / sr; L[i0 + k] += acc * 0.55 * Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-tt * 40)) * tt) * Math.exp(-tt * 18); }
    }
    buf.getChannelData(1).set(L);
    const w = computeWaveform(L, sr);
    A.analyzer.waves.set(id, { data: w.data, rate: w.rate });
    await A.decks[i].load(t, buf);
    A.waves[i].setWave(A.analyzer.waves.get(id)); A.deckUIs[i].overview.setWave(A.analyzer.waves.get(id)); A.deckUIs[i].waveDetail.setWave(A.analyzer.waves.get(id));
  }
  A.engine.setMaster(0.15);
  return A.decks.slice(0, 2).map(d => d.track && d.track.id);
})()`;
// pistas que caben enteras en la tabla y alto de la biblioteca respecto a la ventana
const ROWS = `(() => { const u = nexuraApp.libraryUI, s = u.scroller, lib = document.querySelector('#library');
  return { filas: Math.floor(s.clientHeight / u.rowH), rowH: u.rowH, dense: u.root.classList.contains('dense'), view: nexuraApp.screenView,
    libH: Math.round(lib.getBoundingClientRect().height), winH: innerHeight, mitad: lib.getBoundingClientRect().height >= innerHeight / 2 - 1,
    scrollApp: document.querySelector('#app').scrollHeight > document.querySelector('#app').clientHeight + 1,
    font: getComputedStyle(document.querySelector('.row-t > span:nth-child(2)') || document.body).fontSize,
    crateRow: Math.round(document.querySelector('.side-item')?.getBoundingClientRect().height || 0) }; })()`;
const DECKS = `(() => nexuraApp.decks.slice(0, 2).map(d => ({ playing: d.playing, time: +d.time.toFixed(3), sync: d.sync, loop: d.loop.on, beats: d.loopBeats, cue0: !!(d.track && d.track.cues[0]) })))()`;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // sin MIDI: una controladora conectada al equipo (o abierta en otro programa) no debe influir en la prueba
  // ni dejar el arranque esperando a requestMIDIAccess
  const noMidi = (perm) => perm !== 'midi' && perm !== 'midiSysex';
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(noMidi(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => noMidi(perm));
  const report = { errors: [], checks: {}, medidas: {}, ok: true };
  const check = (name, cond, data) => { report.checks[name] = { ok: !!cond, ...data }; if (!cond) { report.ok = false; console.log('✗', name, JSON.stringify(data)); } else console.log('✓', name); };

  const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  await load(win);
  const data = seed();
  await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(data.settings))}); true`);

  // ---------------------------------------------------------------- medidas en las 3 resoluciones
  // (sin pistas en los decks; se recarga en cada tamaño para partir del arranque)
  const setView = (v, density) => js(win, `nexuraApp.setSetting('libDensity', '${density}'); nexuraApp.setScreenView('${v}'); true`);
  for (const [w, h] of SIZES) {
    win.setContentSize(w, h);
    await load(win); await ready(win);
    const m = {};
    for (const [v, dens] of [['mix', 'normal'], ['mix', 'compact'], ['lib', 'normal'], ['lib', 'compact']]) {
      await setView(v, dens); await wait(500);
      m[`${v === 'lib' ? 'Biblioteca' : 'Mezcla'} · ${dens === 'compact' ? 'Compacta' : 'Normal'}`] = await js(win, ROWS);
    }
    report.medidas[`${w}x${h}`] = m;
    console.log(`  ${w}×${h}: ` + Object.entries(m).map(([k, r]) => `${k} = ${r.filas}`).join(' · '));
    for (const [k, r] of Object.entries(m)) if (k.startsWith('Biblioteca')) check(`${w}×${h} · ${k}: la biblioteca ocupa al menos la mitad de la altura`, r.mitad && !r.scrollApp, r);
    if (w === 1920) check('1920×1080 · Biblioteca · Compacta: 30 pistas o más (filas de 23 px y letra de 13 px)', m['Biblioteca · Compacta'].filas >= 30 && m['Biblioteca · Compacta'].rowH === 23 && m['Biblioteca · Compacta'].font === '13px', m['Biblioteca · Compacta']);
    check(`${w}×${h} · Mezcla · Normal sin cambios (filas de 28 px)`, m['Mezcla · Normal'].rowH === 28 && !m['Mezcla · Normal'].dense, m['Mezcla · Normal']);
    check(`${w}×${h} · árbol de crates compacto (filas de 21 px) con la densidad Compacta`, m['Biblioteca · Compacta'].crateRow === 21, { crateRow: m['Biblioteca · Compacta'].crateRow });
    // capturas antes (Mezcla) y después (Biblioteca)
    if (w !== 1280) {
      await setView('mix', 'auto'); await wait(400); await shot(win, `mezcla-${w}x${h}`);
      await setView('lib', 'auto'); await wait(400); await shot(win, `despues-biblioteca-${w}x${h}`);
    }
  }

  // ---------------------------------------------------------------- cambio de vista sin cortar el audio
  win.setContentSize(1920, 1080);
  await load(win); await ready(win);
  await js(win, `nexuraApp.setSetting('libDensity', 'auto'); nexuraApp.setScreenView('mix'); true`);
  const boot = await js(win, `({ started: typeof nexuraApp.flushAll === 'function', midi: nexuraApp.midi && nexuraApp.midi.status, ctx: nexuraApp.engine.ctx.state })`);
  check('Arranque completo (teclado y bucle de dibujo en marcha)', boot.started, boot);
  const prep = await js(win, PREPARE);
  check('Pistas de clics cargadas en los decks 1 y 2', JSON.stringify(prep) === '["c124","c128"]', { prep });
  await js(win, `nexuraApp.decks[0].play(); true`);
  await wait(600);
  let a = await js(win, DECKS);
  await clickAt(win, '#topbar .view-toggle');
  await wait(600);
  let b = await js(win, DECKS);
  let st = await js(win, `({ lib: document.body.classList.contains('view-lib'), saved: nexuraApp.settings.screenView, on: document.querySelector('.view-toggle').classList.contains('on'), pressed: document.querySelector('.view-toggle').getAttribute('aria-pressed'), dense: nexuraApp.libraryUI.root.classList.contains('dense') })`);
  check('Botón ▤ BIBLIOTECA: cambia a la vista Biblioteca (botón activo, densidad Compacta automática)', st.lib && st.saved === 'lib' && st.on && st.pressed === 'true' && st.dense, st);
  check('…y el Deck 1 sigue sonando sin cortes (el tiempo avanza)', b[0].playing && b[0].time > a[0].time + 0.4, { a: a[0], b: b[0] });
  await key(win, 'F10');
  let c = await js(win, DECKS);
  st = await js(win, `({ lib: document.body.classList.contains('view-lib'), saved: nexuraApp.settings.screenView, dense: nexuraApp.libraryUI.root.classList.contains('dense') })`);
  check('F10: vuelve a la vista Mezcla (densidad Normal) y el Deck 1 sigue sonando', !st.lib && st.saved === 'mix' && !st.dense && c[0].playing && c[0].time > b[0].time, { st, c: c[0] });
  await key(win, 'F10');
  st = await js(win, `({ lib: document.body.classList.contains('view-lib') })`);
  check('F10 otra vez: vista Biblioteca', st.lib, st);
  await wait(900); // guardado de ajustes (diferido)
  await load(win); await ready(win);
  st = await js(win, `({ lib: document.body.classList.contains('view-lib'), saved: nexuraApp.settings.screenView, on: document.querySelector('.view-toggle').classList.contains('on') })`);
  check('Al recargar se recuerda la vista Biblioteca', st.lib && st.saved === 'lib' && st.on, st);

  // ---------------------------------------------------------------- controles con el ratón en la vista Biblioteca
  await js(win, PREPARE);
  await wait(300);
  let r = await js(win, `(() => { const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.bottom <= innerHeight; };
    return { play: vis('#deck0 .transport .play'), cue: vis('#deck0 .transport .cue'), sync: vis('#deck1 .transport .sync'), pads: document.querySelectorAll('#deck0 .pad').length === 8 && vis('#deck0 .pad'),
      platter: vis('#deck0 .platter'), loops: [...document.querySelectorAll('#deck0 .qloop')].map(b => b.textContent).join(' '), meter: vis('#deck0 .deck-meter'), wave: vis('#wave0') && vis('#wave1'), mixer: vis('#mixer'),
      clock: document.querySelector('#deck0 .elapsed').textContent, stripH: Math.round(document.querySelector('#deck0').getBoundingClientRect().height) }; })()`);
  check('Deck compacto: CUE, PLAY, SYNC, 8 pads, plato, loops rápidos 1/8…16 y vúmetro a la vista; ondas en el centro; mezclador oculto', r.play && r.cue && r.sync && r.pads && r.platter && r.loops === '1/8 1/4 1/2 1 2 4 8 16' && r.meter && r.wave && !r.mixer, r);
  await clickAt(win, '#deck0 .transport .play');
  await wait(700);
  a = await js(win, DECKS);
  check('Clic en PLAY (Deck 1): suena', a[0].playing, a[0]);
  await clickAt(win, '#deck1 .transport .play');
  await wait(400);
  await clickAt(win, '#deck1 .transport .sync');
  await wait(900);
  a = await js(win, DECKS);
  const bpms = await js(win, `nexuraApp.decks.slice(0, 2).map(d => +d.currentBpm.toFixed(2))`);
  check('Clic en SYNC (Deck 2): sincroniza con el Deck 1 (mismo BPM)', a[1].sync && Math.abs(bpms[0] - bpms[1]) < 0.02, { a, bpms });
  await clickAt(win, '#deck0 .qloops .qloop:nth-of-type(5)'); // «1»
  a = await js(win, DECKS);
  const qOn = await js(win, `[...document.querySelectorAll('#deck0 .qloop.on')].map(b => b.textContent)`);
  check('Loop rápido «1» (Deck 1): loop de 1 beat activo y botón encendido', a[0].loop && Math.abs(a[0].beats - 1) < 1e-3 && JSON.stringify(qOn) === '["1"]', { a: a[0], qOn });
  await clickAt(win, '#deck0 .qloops .qloop:nth-of-type(5)');
  a = await js(win, DECKS);
  check('…otra vez: sale del loop', !a[0].loop, a[0]);
  await clickAt(win, '#deck0 .pad:nth-child(1)');
  a = await js(win, DECKS);
  check('Clic en el pad 1 (Hot Cue): guarda el hot cue 1', a[0].cue0, a[0]);
  await clickAt(win, '#deck0 .transport .play');
  await wait(300);
  a = await js(win, DECKS);
  check('Clic en PLAY otra vez: pausa', !a[0].playing, a[0]);
  await clickAt(win, '#deck0 .transport .cue', 300);
  a = await js(win, DECKS);
  const cueBtn = await js(win, `document.querySelector('#deck0 .transport .cue').classList.contains('on')`);
  check('Clic en CUE (en pausa): fija el punto cue y se queda en él', !a[0].playing && cueBtn, { a: a[0], cueBtn });
  // vúmetro del deck que suena
  // (la pista de clics es casi silencio entre golpe y golpe: se mira el nivel más alto en 1,5 s)
  const met = await js(win, `new Promise(r => { let min = 100; const t = setInterval(() => { const m = /inset\\((\\d+)/.exec(getComputedStyle(document.querySelector('#deck1 .deck-meter .meter-fill')).clipPath); if (m) min = Math.min(min, +m[1]); }, 30); setTimeout(() => { clearInterval(t); r({ min, playing: nexuraApp.decks[1].playing }); }, 1500); })`);
  check('Vúmetro vertical del Deck 2 (sonando) con nivel', met.playing && met.min < 100, met);

  // ---------------------------------------------------------------- MIXER desplegable
  await clickAt(win, '#topbar .mixer-toggle');
  r = await js(win, `(() => { const m = document.querySelector('#mixer').getBoundingClientRect(), b = document.querySelector('#topbar .mixer-toggle'); return { open: document.body.classList.contains('mixer-open'), w: Math.round(m.width), h: Math.round(m.height), top: Math.round(m.top), bottom: Math.round(m.bottom), label: b.textContent, on: b.classList.contains('on') }; })()`);
  check('Botón MIXER: despliega el mezclador (dentro de la ventana) y queda activo', r.open && r.label === 'MIXER' && r.on && r.w > 200 && r.h > 200 && r.bottom <= 1080, r);
  await shot(win, 'despues-biblioteca-mixer-1920x1080');
  await clickAt(win, '#topbar .mixer-toggle');
  r = await js(win, `({ open: document.body.classList.contains('mixer-open'), vis: document.querySelector('#mixer').getBoundingClientRect().width > 0, playing: nexuraApp.decks[1].playing })`);
  check('…otra vez: lo oculta (el Deck 2 sigue sonando)', !r.open && !r.vis && r.playing, r);

  // ---------------------------------------------------------------- franjas plegables
  await clickAt(win, '#topbar .btn.rec');
  r = await js(win, `(() => { const b = document.querySelector('#recbar'); return { vis: !b.hidden && b.getBoundingClientRect().height > 0, rec: nexuraApp.engine.recording, saved: nexuraApp.settings.panels.rec, txt: b.textContent }; })()`);
  check('REC (vista Biblioteca): abre la franja de grabación sin empezar a grabar', r.vis && !r.rec && r.saved === true && /GRABACIÓN/.test(r.txt) && /SE GUARDA EN/.test(r.txt), r);
  await js(win, `const i = document.querySelector('.rec-name'); i.value = 'Prueba vista'; i.dispatchEvent(new Event('change')); true`);
  await clickAt(win, '#recbar .rec-go');
  await wait(1300);
  r = await js(win, `({ rec: nexuraApp.engine.recording, btn: document.querySelector('#recbar .rec-go').textContent, time: document.querySelector('#recbar .rec-clock').textContent, cls: document.querySelector('#recbar').classList.contains('recording'), name: nexuraApp.recStrip.mixName() })`);
  check('Franja de grabación: ● GRABAR graba (■ PARAR, tiempo en marcha, nombre de la mezcla)', r.rec && r.btn === '■ PARAR' && r.cls && r.time !== '00:00' && r.name === 'Prueba vista', r);
  await shot(win, 'despues-biblioteca-grabando-1920x1080');
  await js(win, `nexuraApp.engine.stopRecording(); nexuraApp.engine.emit('rec'); true`);
  await wait(300);
  await clickAt(win, '#topbar .fx-toggle');
  await clickAt(win, '#topbar .sampler-toggle');
  await wait(500);
  r = await js(win, `({ fx: document.querySelector('#fxbar').getBoundingClientRect().height, smp: document.querySelector('#sampler').getBoundingClientRect().height, fxOn: document.querySelector('#topbar .fx-toggle').classList.contains('on'), slots: document.querySelectorAll('#fxbar .fxslot').length, targets: [...document.querySelector('#fxbar .fxunit select').options].filter(o => !o.hidden).map(o => o.textContent), cells: document.querySelectorAll('#sampler .smp-cell').length })`);
  check('Franjas de efectos (2 unidades × 3 efectos, destino 1/2/master) y sampler (8 ranuras) abiertas', r.fx > 30 && r.smp > 40 && r.fxOn && r.slots === 6 && r.targets.includes('Master') && r.cells === 8, r);
  let rows = await js(win, ROWS);
  report.medidas['1920x1080 · Biblioteca · Compacta · grabación + FX + sampler abiertos'] = rows;
  check('1920×1080 con grabación, FX y sampler abiertos: 20 pistas o más', rows.filas >= 20 && rows.mitad, rows);
  await shot(win, 'despues-biblioteca-franjas-1920x1080');
  // ▲ cierra cada franja y se recuerda
  await clickAt(win, '#fxbar .strip-fold');
  await clickAt(win, '#sampler .strip-fold');
  await clickAt(win, '#recbar .strip-fold');
  r = await js(win, `({ fx: document.querySelector('#fxbar').hidden, smp: document.querySelector('#sampler').hidden, rec: document.querySelector('#recbar').hidden, p: nexuraApp.settings.panels })`);
  check('Botones ▲: cierran las tres franjas y se guarda su estado', r.fx && r.smp && r.rec && !r.p.fx && !r.p.sampler && !r.p.rec, r);
  await js(win, `nexuraApp.togglePanel('fx'); true`);
  await wait(900);
  await load(win); await ready(win);
  r = await js(win, `({ fx: !document.querySelector('#fxbar').hidden, smp: document.querySelector('#sampler').hidden, rec: document.querySelector('#recbar').hidden })`);
  check('Al recargar se recuerda qué franjas están abiertas (FX sí, sampler y grabación no)', r.fx && r.smp && r.rec, r);
  await js(win, `nexuraApp.togglePanel('fx'); true`);

  // ---------------------------------------------------------------- accesos rápidos y Explorar
  await clickAt(win, '.lib-quick .lib-qbtn:nth-child(2)'); // Prepare
  r = await js(win, `({ view: nexuraApp.libraryUI.viewId, n: nexuraApp.libraryUI.rows.length, label: document.querySelector('.lib-quick .lib-qbtn:nth-child(2)').textContent })`);
  check('Acceso rápido «Prepare»: abre Prepare (con su número de pistas)', r.view === 'prepare' && r.n === 4 && r.label === 'Prepare4', r);
  await clickAt(win, '.lib-quick .lib-qbtn:nth-child(3)'); // Historial
  r = await js(win, `({ view: nexuraApp.libraryUI.viewId, n: nexuraApp.libraryUI.rows.length })`);
  check('Acceso rápido «Historial»: abre la última sesión', r.view === 'history:h1' && r.n === 10, r);
  await clickAt(win, '.lib-quick .lib-qbtn:nth-child(1)'); // Todas
  await clickAt(win, '.lib-quick .lib-qbtn:nth-child(4)'); // Explorar
  const total = await js(win, `nexuraApp.libraryUI.rows.length`);
  await clickAt(win, '.lib-explore .ex-col:nth-child(1) .ex-item:nth-child(4)'); // un género
  const g = await js(win, `({ genre: nexuraApp.libraryUI.explore.genre, n: nexuraApp.libraryUI.rows.length, ok: nexuraApp.libraryUI.rows.every(t => t.genre === nexuraApp.libraryUI.explore.genre) })`);
  await clickAt(win, '.lib-explore .ex-col:nth-child(2) .ex-item:nth-child(2)'); // primer tramo de BPM
  const gb = await js(win, `({ bpm: nexuraApp.libraryUI.explore.bpm, n: nexuraApp.libraryUI.rows.length })`);
  check('Explorar: género → BPM filtran la vista en cascada', total === 402 && g.genre && g.ok && g.n > 0 && g.n < total && gb.bpm && gb.n > 0 && gb.n <= g.n, { total, g, gb });
  await shot(win, 'despues-biblioteca-explorar-1920x1080');
  await clickAt(win, '.lib-explore .ex-close');
  r = await js(win, `({ hidden: document.querySelector('.lib-explore').hidden, n: nexuraApp.libraryUI.rows.length })`);
  check('Cerrar Explorar: quita sus filtros', r.hidden && r.n === 402, r);

  // ---------------------------------------------------------------- columnas y ajuste de densidad
  r = await js(win, `[...document.querySelectorAll('#library .lib-head .th')].map(t => t.dataset.key)`);
  check('Columnas en la vista Biblioteca a 1920: título, reproducciones, artista, BPM, tonalidad, álbum, duración, comentario y fecha de añadido', ['title', 'plays', 'artist', 'bpm', 'camelot', 'album', 'duration', 'comment', 'added'].every(k => r.includes(k)), { cols: r });
  await js(win, `nexuraApp.settingsUI.open('library'); true`);
  await wait(500);
  r = await js(win, `[...document.querySelectorAll('.set-row')].filter(x => /Densidad de la biblioteca|Vista de la pantalla/.test(x.textContent)).map(x => [...x.querySelectorAll('option')].map(o => o.textContent))`);
  check('Ajustes → Biblioteca: «Vista de la pantalla» y «Densidad de la biblioteca» (Automática / Normal / Compacta)', r.length === 2 && r[1].join('|') === 'Automática (Compacta en la vista Biblioteca)|Normal|Compacta', { r });
  await js(win, `nexuraApp.closeModal(); true`);

  // ---------------------------------------------------------------- 1366×768, 1280×800 y 1920×1080 con las pistas cargadas
  await js(win, PREPARE);
  await js(win, `(() => { const [a, b] = nexuraApp.decks; a.seek(8); a.padDown(0); a.padUp(0); a.seek(24); a.padDown(1); a.padUp(1); a.seek(40); a.padDown(2); a.padUp(2); a.seek(2); b.seek(16); a.play(); b.play(); b.setSync(true); return true; })()`);
  await wait(600);
  for (const [w, h] of [[1366, 768], [1280, 800], [1920, 1080]]) {
    win.setContentSize(w, h);
    await wait(900);
    r = await js(win, `(() => { const box = (s) => document.querySelector(s).getBoundingClientRect(); const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.bottom <= innerHeight && b.right <= innerWidth; };
      return { play: vis('#deck1 .transport .play'), sync: vis('#deck1 .transport .sync'), pad8: vis('#deck1 .pad:nth-child(8)'), loop16: vis('#deck1 .qloop:nth-of-type(8)'), platter: vis('#deck1 .platter'),
        sinSolapes: box('#deck1 .pad:nth-child(8)').bottom <= box('#deck1 .qloops').top + 0.5 && box('#deck1 .qloops').bottom <= box('#deck1 .transport').top + 0.5 && box('#deck1 .transport').bottom <= box('#deck1').bottom,
        padH: Math.round(box('#deck1 .pad').height), topbar: document.querySelector('#top-right').scrollWidth <= document.querySelector('#top-right').clientWidth + 1,
        titulo: Math.round(document.querySelector('#library .view-title').getBoundingClientRect().width), buscador: Math.round(box('#library .lib-toolbar .search').width) }; })()`);
    rows = await js(win, ROWS);
    check(`${w}×${h} · deck compacto completo a la vista, sin solapes (pads ≥ 18 px) y barras sin desbordar`, r.play && r.sync && r.pad8 && r.loop16 && r.platter && r.sinSolapes && r.padH >= 18 && r.topbar && r.titulo >= 60 && r.buscador >= 140, r);
    check(`${w}×${h} · con los decks cargados la biblioteca sigue ocupando al menos la mitad`, rows.mitad && !rows.scrollApp, rows);
    await shot(win, `despues-biblioteca-cargada-${w}x${h}`);
  }
  await js(win, `nexuraApp.decks.forEach(d => d.pause()); true`);

  report.errors = report.errors.filter(e => !/favicon|ERR_/i.test(e));
  if (report.errors.length) { report.ok = false; console.log('✗ errores en consola: ' + report.errors.join(' | ')); } else console.log('✓ sin errores en la consola');
  fs.writeFileSync(path.join(OUT, 'informe-ui-vista-biblioteca.json'), JSON.stringify(report, null, 2));
  console.log(report.ok ? '\nTODO OK' : '\nHAY FALLOS', '· informe en .revision/capturas-biblioteca/informe-ui-vista-biblioteca.json');
  app.exit(report.ok ? 0 : 1);
});
