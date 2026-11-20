// Autoplay sobre un crate, con Electron contra `npm run web` y búferes de audio simulados (tonos de 5 s,
// una frecuencia por pista). Comprueba el orden en que suenan (en orden y aleatorio), que no hay silencios
// largos, Siguiente (Ctrl+→), pistas que fallan, Parar, la parada por pausa, Mayús+F7, la mezcla con sync
// y que Automix y Autoplay se excluyen. Capturas e informe en .revision/autoplay/.
// Uso: npx electron tools/ui-check-autoplay.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = path.join(__dirname, '..', '.revision', 'autoplay');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const DUR = 5;   // segundos de cada pista simulada

function seed() {
  const now = Date.now(), tracks = [];
  const names = [['Uno', 'Alfa'], ['Dos', 'Beta'], ['Tres', 'Gamma'], ['Cuatro', 'Delta'], ['Cinco', 'Épsilon'], ['Roto', 'Archivo perdido']];
  names.forEach(([title, artist], i) => tracks.push({
    id: 't' + i, path: `web:${title}.mp3:${1000 + i}`, source: 'local', title, artist, album: '', genre: 'House', year: '2024',
    comment: '', rating: 3, bpm: 240, firstBeat: 0, key: '', camelot: '8A', duration: DUR, size: 1000 + i, rmsDb: -14,
    cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null), added: now - i * 86400000, plays: 0, lastPlayed: 0,
    analyzed: true, energy: 5, sections: []
  }));
  return {
    library: { version: 1, tracks, crates: [
      { id: 'dance', name: 'Dance', ids: [], created: now - 9000 },
      { id: 'y80', name: 'Años 80', ids: ['t0', 't1', 't2', 't3'], parent: 'dance', created: now - 8000 },
      { id: 'fallo', name: 'Con fallo', ids: ['t0', 't5', 't1'], created: now - 7000 }],
      smart: [], history: [], prepare: [], ytPlaylists: [] },
    settings: { libView: 'crate:y80', crateSort: 'custom', waveLayout: 'serato', libSideW: 230, libSort: { field: null, dir: 1 }, autoAnalyze: false, automixBars: 4,
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

// Búferes simulados + registro cada 50 ms de lo que suena (pista del Autoplay, decks y nivel del master)
const SETUP = `(() => {
  const A = nexuraApp, ctx = A.engine.ctx;
  A.decode = async (t) => {
    if (t.id === 't5') throw new Error('archivo perdido (simulado)');
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
      decks: A.decks.slice(0, 2).map(d => (d.playing ? (d.track && d.track.id) : '-')).join(' ') });
  }, 50);
  return true;
})()`;
const reset = `(() => { window.__log = []; window.__toasts = []; return true; })()`;
// orden de las pistas del Autoplay y silencio más largo mientras está activo
const summary = `(() => {
  const L = window.__log.filter(x => x.on);
  const order = []; for (const x of L) if (x.id && order[order.length - 1] !== x.id) order.push(x.id);
  let run = 0, maxRun = 0, last = null;
  for (const x of L) { if (x.peak < 0.01) { run = last == null ? 0 : run + (x.at - last); maxRun = Math.max(maxRun, run); } else run = 0; last = x.at; }
  return { order, silenceMs: Math.round(maxRun), samples: L.length, mixes: L.filter(x => x.mix).length, toasts: window.__toasts.slice() };
})()`;
const view = (win, id, sel) => js(win, `(() => { const ui = nexuraApp.libraryUI; ui.setView(${JSON.stringify(id)}); ui.refresh();
  ${sel ? `ui.sel = new Set([${JSON.stringify(sel)}]); ui.cursor = ui.anchor = ui.rows.findIndex(t => t.id === ${JSON.stringify(sel)}); ui.renderRows();` : ''} return ui.rows.map(t => t.id); })()`);
const opts = (win, o) => js(win, `(() => { nexuraApp.setSetting('autoplay', { ...nexuraApp.settings.autoplay, ...${JSON.stringify(o)} }); return nexuraApp.autoplay.opts; })()`);
const state = `(() => { const A = nexuraApp; return { autoplay: A.autoplay.enabled, automix: A.automix.enabled, label: A.autoplay.status(),
  ind: document.querySelector('.autoplay-ind')?.textContent || '', indHidden: document.querySelector('.autoplay-ind')?.hidden,
  playing: A.decks.slice(0, 2).map(d => d.playing), keylock: A.decks.slice(0, 2).map(d => d.keylock) }; })()`;
const stopAll = `(() => { const A = nexuraApp; A.autoplay.stop(true); if (A.automix.enabled) A.automix.toggle(false); A.decks.forEach(d => d.pause()); A.engine.channels.forEach(c => c.set('fader', 1)); return true; })()`;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {}, ok: true };
  const fail = (msg) => { report.ok = false; console.log('✗', msg); };
  const check = (name, cond, data) => { report.checks[name] = { ok: !!cond, ...data }; if (!cond) fail(name + ' ' + JSON.stringify(data)); else console.log('✓', name); };

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

  // 1) En orden, fundido de 2 s, empezando por la seleccionada (Dos): Dos → Tres → Cuatro → Uno → Dos
  const rows = await view(win, 'crate:y80', 't1');
  await js(win, `nexuraApp.autoplayUI.open(nexuraApp.autoplayUI.topBtn); true`);
  await shot(win, '1280x800-01-panel');
  await js(win, reset);
  await js(win, `document.querySelector('.ap-actions .btn.primary').click(); true`);
  await wait(1500);
  await shot(win, '1280x800-02-sonando-panel');
  await js(win, `nexuraApp.autoplayUI.close(); true`);
  await wait(1200);
  const s1 = await js(win, state);
  await shot(win, '1280x800-03-indicador');
  await wait(13500);
  let sum = await js(win, summary);
  check('En orden: Dos → Tres → Cuatro → Uno → Dos (fundido 2 s)', JSON.stringify(sum.order.slice(0, 5)) === JSON.stringify(['t1', 't2', 't3', 't0', 't1']), { rows, order: sum.order, silenceMs: sum.silenceMs });
  check('En orden: sin silencios largos (< 400 ms)', sum.silenceMs < 400, { silenceMs: sum.silenceMs, mixes: sum.mixes });
  check('Indicador «AUTOPLAY · Dance › Años 80 · n/4 · siguiente: …» y key lock', /^AUTOPLAY · Dance › Años 80 · \d\/4 · siguiente: /.test(s1.ind) && !s1.indHidden && s1.keylock.every(Boolean), s1);

  // 2) Siguiente con Ctrl+→
  let before = await js(win, `nexuraApp.autoplay.playing.id`);
  await key(win, 'Right', ['control']);
  await wait(2600);
  let after = await js(win, `nexuraApp.autoplay.playing.id`);
  const expectNext = { t0: 't1', t1: 't2', t2: 't3', t3: 't0' }[before];
  check('Siguiente (Ctrl+→) pasa a la siguiente de la lista', after === expectNext || after === { t0: 't2', t1: 't3', t2: 't0', t3: 't1' }[before], { before, after });

  // 3) Parar desde el panel: el Autoplay se apaga y la canción sigue; se restaura el key lock
  await js(win, `nexuraApp.autoplayUI.open(nexuraApp.autoplayUI.topBtn); [...document.querySelectorAll('.ap-actions .btn')].find(b => b.textContent.includes('Parar')).click(); true`);
  await wait(300);
  let s3 = await js(win, state);
  await shot(win, '1280x800-04-parado');
  check('Parar: Autoplay apagado, la canción sigue sonando, key lock restaurado', !s3.autoplay && s3.playing.some(Boolean) && s3.indHidden && !s3.keylock.some(Boolean), s3);
  await js(win, `nexuraApp.autoplayUI.close(); true`);
  await js(win, stopAll); await wait(600);

  // 4) Aleatorio con transición seguida: 4 pistas distintas en la primera vuelta, sin repetir la última al volver a empezar
  await opts(win, { order: 'shuffle', transition: 'gapless' });
  await view(win, 'crate:y80');
  await js(win, reset);
  await js(win, `nexuraApp.autoplay.start(); true`);
  await wait(DUR * 5 * 1000 + 1500);
  sum = await js(win, summary);
  const first4 = sum.order.slice(0, 4);
  check('Aleatorio: la primera vuelta tiene las 4 pistas sin repetir', first4.length === 4 && new Set(first4).size === 4, { order: sum.order });
  check('Aleatorio: nunca la misma dos veces seguidas', sum.order.every((x, i) => i === 0 || x !== sum.order[i - 1]) && sum.order.length >= 5, { order: sum.order });
  check('Seguida: sin silencios largos (< 400 ms)', sum.silenceMs < 400, { silenceMs: sum.silenceMs });
  await js(win, stopAll); await wait(600);

  // 5) Pista que falla al cargar: se avisa y se salta (Uno → [Roto] → Dos)
  await opts(win, { order: 'list', transition: 'fade', fadeSecs: 2, repeat: false });
  await view(win, 'crate:fallo');
  await js(win, reset);
  await js(win, `nexuraApp.autoplay.start(); true`);
  await wait(DUR * 2 * 1000 + 2500);
  sum = await js(win, summary);
  let s5 = await js(win, state);
  check('Pista que falla: aviso y salta a la siguiente (Uno → Dos)', JSON.stringify(sum.order.slice(0, 2)) === JSON.stringify(['t0', 't1']) && sum.toasts.some(t => /no se pudo cargar «Archivo perdido – Roto»/.test(t)), { order: sum.order, toasts: sum.toasts });
  check('Sin «Repetir»: al acabar la lista se detiene y avisa', !s5.autoplay && sum.toasts.some(t => /Autoplay terminado/.test(t)), { s5, toasts: sum.toasts });
  await js(win, stopAll); await wait(600);

  // 6) Automix y Autoplay se excluyen
  await opts(win, { repeat: true });
  await view(win, 'crate:y80');
  await js(win, reset);
  await js(win, `nexuraApp.autoplay.start(); true`);
  await wait(1500);
  await js(win, `nexuraApp.automix.toggle(true); true`);
  await wait(300);
  let s6a = await js(win, state);
  await js(win, `nexuraApp.autoplay.start(); true`);
  await wait(800);
  let s6b = await js(win, state);
  sum = await js(win, summary);
  check('Activar Automix apaga el Autoplay (con aviso) y viceversa', s6a.automix && !s6a.autoplay && s6b.autoplay && !s6b.automix
    && sum.toasts.some(t => /Autoplay desactivado/.test(t)) && sum.toasts.some(t => /Automix desactivado/.test(t)), { s6a, s6b, toasts: sum.toasts });

  // 7) Los dos decks en pausa más de unos segundos → se detiene
  await js(win, `nexuraApp.decks.forEach(d => d.pause()); true`);
  await wait(3000);
  const s7a = await js(win, state);
  await wait(3200);
  const s7b = await js(win, state);
  check('Pausa en los dos decks > 5 s: el Autoplay se detiene (antes sigue activo)', s7a.autoplay && !s7b.autoplay, { s7a, s7b });
  await js(win, stopAll); await wait(400);

  // 8) Mayús+F7 empieza y para
  await key(win, 'F7', ['shift']);
  await wait(1200);
  const s8a = await js(win, state);
  await key(win, 'F7', ['shift']);
  await wait(300);
  const s8b = await js(win, state);
  check('Mayús+F7 empieza y para el Autoplay', s8a.autoplay && !s8b.autoplay && !s8a.automix, { s8a, s8b });
  await js(win, stopAll); await wait(400);

  // 9) Mezcla con sync (4 compases a 240 BPM = 4 s): transición con los dos decks sonando y sin silencios
  await opts(win, { order: 'list', transition: 'sync' });
  await view(win, 'crate:y80', 't0');
  await js(win, reset);
  await js(win, `nexuraApp.autoplay.start(); true`);
  await wait(9000);
  sum = await js(win, summary);
  check('Mezcla con sync: Uno → Dos con transición y sin silencios largos', JSON.stringify(sum.order.slice(0, 2)) === JSON.stringify(['t0', 't1']) && sum.mixes > 10 && sum.silenceMs < 400, { order: sum.order, mixes: sum.mixes, silenceMs: sum.silenceMs });
  await js(win, stopAll); await wait(400);

  // 10) Acciones MIDI y ayuda de atajos
  const midi = await js(win, `(() => { const a = nexuraApp.actions; return { autoplay: !!a.autoplay, next: !!a.autoplaynext }; })()`);
  await js(win, `nexuraApp.actions.autoplay.fn(true); true`);
  await wait(800);
  const s10 = await js(win, state);
  check('Acciones MIDI autoplay / autoplaynext', midi.autoplay && midi.next && s10.autoplay, { midi, s10 });
  await js(win, `nexuraApp.autoplayUI.open(nexuraApp.autoplayUI.libBtn); true`);
  await shot(win, '1280x800-05-panel-biblioteca');
  await js(win, `nexuraApp.autoplayUI.close(); nexuraApp.settingsUI.open('keys'); true`);
  await wait(500);
  const keys = await js(win, `document.querySelector('.keys')?.textContent || ''`);
  await shot(win, '1280x800-06-atajos');
  check('Ayuda de atajos con Mayús+F7 y Ctrl+→', /Mayús \+ F7/.test(keys) && /Ctrl \+ →/.test(keys), {});
  await js(win, `nexuraApp.closeModal(); true`);

  // 11) Móvil (375 px): panel e indicador
  win.setContentSize(375, 812);
  await wait(900);
  await js(win, `nexuraApp.autoplayUI.open(nexuraApp.autoplayUI.topBtn); true`);
  await wait(400);
  const fit = await js(win, `(() => { const r = document.querySelector('.ap-panel').getBoundingClientRect(); return { left: r.left, right: r.right, w: innerWidth, top: r.top, bottom: r.bottom, h: innerHeight }; })()`);
  await shot(win, '375x812-01-panel');
  check('375 px: el panel cabe en la pantalla', fit.left >= 0 && fit.right <= fit.w && fit.bottom <= fit.h, fit);
  await js(win, `nexuraApp.autoplayUI.close(); true`);
  await shot(win, '375x812-02-indicador');
  win.setContentSize(1496, 885);
  await wait(900);
  await shot(win, '1496x885-01-indicador');
  await js(win, stopAll);

  report.errors = report.errors.filter(e => !/favicon|youtube|ERR_/i.test(e));
  if (report.errors.length) fail('errores en consola: ' + report.errors.join(' | '));
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  console.log(report.ok ? '\nTODO OK' : '\nHAY FALLOS', '· informe en .revision/autoplay/informe.json');
  app.exit(report.ok ? 0 : 1);
});
