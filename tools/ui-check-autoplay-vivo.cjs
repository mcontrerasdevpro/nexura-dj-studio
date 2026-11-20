// Autoplay activado con una pista YA sonando: la pista sigue en play en su deck (sin saltos de tiempo,
// sin tocar fader, pitch ni key lock), la siguiente de la lista se carga en el otro deck y la transición
// llega al final de la actual. También: pista que no es de la lista, «Saltar las ya tocadas», Siguiente ⏭,
// Parar y 4 decks (deck 4 sonando). Electron contra `npm run web` con búferes simulados de 30 s.
// Capturas e informe en .revision/autoplay-vivo/. Uso: npx electron tools/ui-check-autoplay-vivo.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = path.join(__dirname, '..', '.revision', 'autoplay-vivo');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const DUR = 30;   // segundos de cada pista simulada

function seed() {
  const now = Date.now(), tracks = [];
  const names = [['Uno', 'Alfa'], ['Dos', 'Beta'], ['Tres', 'Gamma'], ['Cuatro', 'Delta'], ['Cinco', 'Épsilon']];
  names.forEach(([title, artist], i) => tracks.push({
    id: 't' + i, path: `web:${title}.mp3:${1000 + i}`, source: 'local', title, artist, album: '', genre: 'House', year: '2024',
    comment: '', rating: 3, bpm: 120, firstBeat: 0, key: '', camelot: '8A', duration: DUR, size: 1000 + i, rmsDb: -14,
    cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: now - i * 86400000, plays: 0, lastPlayed: 0,
    analyzed: true, energy: 5, sections: []
  }));
  return {
    library: { version: 1, tracks, crates: [
      { id: 'dance', name: 'Dance', ids: [], created: now - 9000 },
      { id: 'y80', name: 'Años 80', ids: ['t0', 't1', 't2', 't3'], parent: 'dance', created: now - 8000 }],
      smart: [], history: [], prepare: [], ytPlaylists: [] },
    settings: { libView: 'crate:y80', crateSort: 'custom', waveLayout: 'serato', libSideW: 230, libSort: { field: null, dir: 1 }, autoAnalyze: false,
      autoplay: { order: 'list', transition: 'fade', fadeSecs: 2, repeat: true, skipPlayed: false } }
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
async function key(win, keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await wait(250);
}

// Búferes simulados + registro cada 50 ms (tiempo y estado de los 4 decks, pista del Autoplay, nivel del master)
const SETUP = `(() => {
  const A = nexuraApp, ctx = A.engine.ctx;
  A.decode = async (t) => {
    const sr = ctx.sampleRate, b = ctx.createBuffer(2, Math.round(sr * ${DUR}), sr);
    const f = 220 * Math.pow(2, (+t.id.slice(1)) / 4);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = 0.35 * Math.sin(2 * Math.PI * f * i / sr); }
    return b;
  };
  A.analyzer.getWave = async () => null;
  A.analyzer.analyzeTrack = async () => ({});
  window.__log = []; window.__toasts = [];
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.classList && n.classList.contains('toast') && window.__toasts.push(n.firstChild.textContent)))).observe(document.getElementById('toasts'), { childList: true });
  setInterval(() => {
    const ap = A.autoplay, m = A.engine.meters();
    window.__log.push({ at: performance.now(), on: ap.enabled, id: ap.playing ? ap.playing.id : null, mix: !!ap.mix, peak: Math.max(m.L, m.R),
      decks: A.decks.map(d => ({ id: d.track ? d.track.id : null, p: d.playing, t: d.time, kl: d.keylock, tempo: d.tempo, fader: A.engine.channels[d.idx].values.fader })) });
  }, 50);
  return true;
})()`;
const reset = `(() => { window.__log = []; window.__toasts = []; return true; })()`;
// saltos de tiempo del deck i: diferencia entre lo que avanza la pista y lo que avanza el reloj (en s)
const jumps = (i) => `(() => {
  const L = window.__log.filter(x => x.decks[${i}].p); let max = 0, back = 0, stopped = 0;
  for (let k = 1; k < L.length; k++) { const dt = (L[k].at - L[k - 1].at) / 1000, dp = L[k].decks[${i}].t - L[k - 1].decks[${i}].t;
    max = Math.max(max, Math.abs(dp - dt)); if (dp < -0.01) back++; }
  return { samples: L.length, maxJump: +max.toFixed(3), back, allPlaying: window.__log.every(x => x.decks[${i}].p),
    keylock: [...new Set(window.__log.map(x => x.decks[${i}].kl))], tempo: [...new Set(window.__log.map(x => x.decks[${i}].tempo))], fader: [...new Set(window.__log.map(x => x.decks[${i}].fader))] };
})()`;
const state = `(() => { const A = nexuraApp, ap = A.autoplay; return { on: ap.enabled, playing: ap.playing, ready: ap.ready ? { id: ap.ready.id, deck: ap.ready.deck.idx } : null,
  pair: ap.pair ? ap.pair.map(d => d.idx) : null, label: ap.status(), ind: document.querySelector('.autoplay-ind')?.textContent || '',
  decks: A.decks.map(d => ({ id: d.track ? d.track.id : null, playing: d.playing, t: +d.time.toFixed(2), keylock: d.keylock })), mix: !!ap.mix }; })()`;
const stopAll = `(() => { const A = nexuraApp; A.autoplay.stop(true); A.decks.forEach(d => d.pause()); A.engine.channels.forEach(c => c.set('fader', 1)); return true; })()`;
const view = (win, id, sel) => js(win, `(() => { const ui = nexuraApp.libraryUI; ui.setView(${JSON.stringify(id)}); ui.refresh();
  ui.sel = new Set(${sel ? JSON.stringify([sel]) : '[]'}); ui.cursor = ui.anchor = ${sel ? `ui.rows.findIndex(t => t.id === ${JSON.stringify(sel)})` : -1}; ui.renderRows(); return ui.rows.map(t => t.id); })()`);
const opts = (win, o) => js(win, `(() => { nexuraApp.setSetting('autoplay', { ...nexuraApp.settings.autoplay, ...${JSON.stringify(o)} }); return nexuraApp.autoplay.opts; })()`);
// carga una pista en un deck, la lleva a «at» segundos y la pone en play (como haría el usuario)
const playOn = (win, id, idx, at) => js(win, `(async () => { const A = nexuraApp; await A.loadToDeck(${JSON.stringify(id)}, ${idx}); const d = A.decks[${idx}];
  A.engine.channels[${idx}].set('fader', 1); d.seek(${at}); d.play(); return { id: d.track && d.track.id, playing: d.playing }; })()`);
// espera hasta que se cumpla la condición (o el tiempo máximo)
async function until(win, cond, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(win, cond) === true) return true; await wait(150); } return false; }

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {}, ok: true };
  const check = (name, cond, data) => { report.checks[name] = { ok: !!cond, ...data }; if (!cond) { report.ok = false; console.log('✗', name, JSON.stringify(data)); } else console.log('✓', name); };

  const win = new BrowserWindow({ width: 1280, height: 800, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${message} (${path.basename(src || '')}:${line})`); });
  await load(win);
  const data = seed();
  await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify({ welcomeDone: true, screenView: 'mix', viewDefaultV2: true, ...data.settings }))}); true`);
  await load(win);
  await wait(2500);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); nexuraApp.engine.resume(); true`);
  await js(win, SETUP);
  win.focus(); win.webContents.focus();

  // 1) «Dos» (de la lista) suena en el deck 2 a mitad; se activa el Autoplay desde el panel
  await view(win, 'crate:y80', 't0');   // seleccionada «Uno»: no debe mandar, manda la que suena
  await playOn(win, 't1', 1, 12);
  await wait(800);
  await js(win, reset);
  await js(win, `nexuraApp.autoplayUI.open(nexuraApp.autoplayUI.topBtn); document.querySelector('.ap-actions .btn.primary').click(); true`);
  await wait(400);
  await js(win, `nexuraApp.autoplayUI.close(); true`);
  await until(win, `!!nexuraApp.autoplay.ready`, 4000);
  await wait(2500);
  let j = await js(win, jumps(1));
  let s = await js(win, state);
  await shot(win, '1280x800-01-sigue-sonando');
  check('El deck 2 sigue en play sin saltos de tiempo al activar el Autoplay', j.allPlaying && j.maxJump < 0.25 && j.back === 0 && s.decks[1].t > 14, { j, t: s.decks[1].t });
  check('El deck 2 no cambia de fader, tempo ni key lock', j.fader.length === 1 && j.tempo.length === 1 && j.keylock.length === 1 && j.keylock[0] === false, j);
  check('El deck 1 recibe la siguiente de la lista («Tres»), en pausa', s.decks[0].id === 't2' && !s.decks[0].playing && s.ready && s.ready.id === 't2' && s.ready.deck === 0, s);
  check('Indicador: «2/4 · siguiente: Gamma – Tres»', /Años 80 · 2\/4 · siguiente: Gamma – Tres/.test(s.ind), { ind: s.ind });

  // 2) cerca del final: la transición llega al final de la actual (fundido 2 s) y no antes
  await js(win, reset);
  await js(win, `nexuraApp.decks[1].seek(${DUR - 5}); true`);
  await wait(1500);
  const early = await js(win, state);
  const done = await until(win, `nexuraApp.autoplay.playing && nexuraApp.autoplay.playing.id === 't2' && !nexuraApp.autoplay.mix && !nexuraApp.decks[1].playing`, 8000);
  s = await js(win, state);
  const fadeAt = await js(win, `(() => { const x = window.__log.find(x => x.mix); return x ? +x.decks[1].t.toFixed(2) : null; })()`);
  const sil = await js(win, `(() => { let run = 0, max = 0, last = null; for (const x of window.__log) { if (x.peak < 0.01) { run = last == null ? 0 : run + (x.at - last); max = Math.max(max, run); } else run = 0; last = x.at; } return Math.round(max); })()`);
  check('La transición empieza al final (≈ 2 s antes) y no antes', !early.mix && early.decks[1].playing && fadeAt != null && fadeAt >= DUR - 2.4 && fadeAt <= DUR - 1.5, { fadeAt, early: early.decks[1] });
  check('Tras la transición suena «Tres» en el deck 1 y el deck 2 se para', done && s.decks[0].playing && s.decks[0].id === 't2' && !s.decks[1].playing, s);
  check('Sin silencios en la transición (< 400 ms)', sil < 400, { silenceMs: sil });
  await until(win, `!!nexuraApp.autoplay.ready`, 4000);
  s = await js(win, state);
  check('Después sigue la lista: «Cuatro» precargada en el deck 2 e indicador 3/4', s.ready && s.ready.id === 't3' && s.ready.deck === 1 && /3\/4 · siguiente: Delta – Cuatro/.test(s.ind), s);

  // 3) Siguiente ⏭ (Ctrl+→) pasa ya a «Cuatro»
  await key(win, 'Right', ['control']);
  const skipped = await until(win, `nexuraApp.autoplay.playing.id === 't3' && nexuraApp.decks[1].playing`, 5000);
  check('Siguiente ⏭ pasa a «Cuatro»', skipped, await js(win, state));

  // 4) Parar: la canción sigue sonando
  await wait(2600);
  await js(win, `nexuraApp.autoplay.stop(); true`);
  await wait(600);
  s = await js(win, state);
  check('Parar: el Autoplay se apaga y «Cuatro» sigue sonando', !s.on && s.decks[1].playing && s.decks[1].id === 't3', s);
  await js(win, stopAll); await wait(500);

  // 5) La que suena NO es de la lista («Cinco» en el deck 1): sigue y al acabar empieza la lista por la seleccionada
  await view(win, 'crate:y80', 't2');
  await playOn(win, 't4', 0, 10);
  await wait(600);
  await js(win, reset);
  await js(win, `nexuraApp.autoplay.start(); true`);
  await until(win, `!!nexuraApp.autoplay.ready`, 4000);
  await wait(1500);
  j = await js(win, jumps(0));
  s = await js(win, state);
  check('Pista fuera de la lista: sigue sonando sin saltos', j.allPlaying && j.maxJump < 0.25 && j.back === 0, j);
  check('Pista fuera de la lista: indicador «–/4 · siguiente: Gamma – Tres» y «Tres» en el deck 2', /–\/4 · siguiente: Gamma – Tres/.test(s.ind) && s.ready && s.ready.id === 't2' && s.ready.deck === 1, s);
  await js(win, `nexuraApp.decks[0].seek(${DUR - 4}); true`);
  const done5 = await until(win, `nexuraApp.autoplay.playing.id === 't2' && !nexuraApp.autoplay.mix && !nexuraApp.decks[0].playing`, 8000);
  s = await js(win, state);
  check('Pista fuera de la lista: al acabar entra la lista por la seleccionada («Tres», 1… → 3/4)', done5 && s.decks[1].playing && /3\/4/.test(s.ind), s);
  await js(win, stopAll); await wait(500);

  // 6) «Saltar las ya tocadas»: la que suena (ya tocada) no se quita; las otras tocadas se saltan
  await opts(win, { skipPlayed: true });
  await view(win, 'crate:y80');
  await js(win, `(() => { const L = nexuraApp.library; L.resetPlayed(); L.logPlay(L.get('t2'), 0); return true; })()`);
  await playOn(win, 't1', 1, 8);
  await wait(1200);
  await js(win, `(() => { const L = nexuraApp.library; if (!L.playedIds().has('t1')) L.logPlay(L.get('t1'), 1); return true; })()`);   // «Dos» = tocada
  const played = await js(win, `[...nexuraApp.library.playedIds()]`);
  await js(win, reset);
  await js(win, `nexuraApp.autoplay.start(); true`);
  await until(win, `!!nexuraApp.autoplay.ready`, 4000);
  s = await js(win, state);
  check('Saltar tocadas: la actual sigue (2/4) y la siguiente salta «Tres» (tocada) → «Cuatro»', s.on && s.decks[1].playing && /2\/4 · siguiente: Delta – Cuatro/.test(s.ind) && s.ready && s.ready.id === 't3' && played.includes('t1') && played.includes('t2'), { played, ...s });
  await js(win, stopAll); await opts(win, { skipPlayed: false }); await wait(500);

  // 7) 4 decks: suena el deck 4 (capa derecha) → la pareja es [deck 1, deck 4] y la siguiente va al deck 1
  await js(win, `nexuraApp.setSetting('deckLayout', '4'); true`);
  await wait(500);
  await js(win, `nexuraApp.focusDeck(3); true`);
  await view(win, 'crate:y80');
  await playOn(win, 't0', 3, 9);
  await wait(600);
  await js(win, `nexuraApp.focusDeck(1); true`);   // el deck 4 ya no es el visible: aun así se incluye
  await js(win, reset);
  await js(win, `nexuraApp.autoplay.start(); true`);
  await until(win, `!!nexuraApp.autoplay.ready`, 4000);
  await wait(1000);
  j = await js(win, jumps(3));
  s = await js(win, state);
  await shot(win, '1280x800-02-cuatro-decks');
  check('4 decks: pareja [1, 4], el deck 4 sigue sin saltos y «Dos» va al deck 1', JSON.stringify(s.pair) === '[0,3]' && j.allPlaying && j.maxJump < 0.25 && s.ready && s.ready.id === 't1' && s.ready.deck === 0 && /1\/4/.test(s.ind), { j, s });
  await js(win, `nexuraApp.decks[3].seek(${DUR - 4}); true`);
  const done7 = await until(win, `nexuraApp.autoplay.playing.id === 't1' && !nexuraApp.autoplay.mix && !nexuraApp.decks[3].playing`, 8000);
  check('4 decks: la transición pasa del deck 4 al deck 1', done7 && (await js(win, `nexuraApp.decks[0].playing`)) === true, await js(win, state));
  await js(win, stopAll);
  await js(win, `nexuraApp.setSetting('deckLayout', 'auto'); true`);

  report.errors = report.errors.filter(e => !/favicon|youtube|ERR_/i.test(e));
  if (report.errors.length) { report.ok = false; console.log('✗ errores en consola: ' + report.errors.join(' | ')); }
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  console.log(report.ok ? '\nTODO OK' : '\nHAY FALLOS', '· informe en .revision/autoplay-vivo/informe.json');
  app.exit(report.ok ? 0 : 1);
});
