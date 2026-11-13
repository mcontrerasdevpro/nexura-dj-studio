// Tiempo y barra de progreso de los vídeos de YouTube, con Electron contra `npm run web` y un reproductor
// simulado (tools/fixtures/yt-player-mock.js: duración 0 hasta que «carga», getCurrentTime cada 250 ms…).
// Comprueba: duración tomada del reproductor (y guardada en la biblioteca), ELAPSED/REMAIN correctos y fluidos
// (también con tempo ≠ 1), barra de progreso en la vista de arriba, en el deck y en la vista general (color
// del deck, cursor, hot cues, texto «sin forma de onda», nunca «Analizando…»), clic para saltar, aviso de los
// últimos 30 s y Autoplay con fundido al final de un vídeo. Capturas e informe en .revision/yt-tiempo/.
// Uso: npx electron tools/ui-check-yt-tiempo.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const OUT = path.join(__dirname, '..', '.revision', 'yt-tiempo');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const MOCK = fs.readFileSync(path.join(__dirname, 'fixtures', 'yt-player-mock.js'), 'utf8');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const track = (id, extra) => ({
  id, path: `web:${id}.mp3:1`, source: 'local', title: id, artist: 'Artista', album: '', genre: 'House', year: '2024', comment: '', rating: 0,
  bpm: 124, firstBeat: 0.1, key: '', camelot: '8A', duration: 200, size: 1, rmsDb: -10, cues: Array(8).fill(null), loops: Array(8).fill(null),
  cueLoops: Array(8).fill(null), added: Date.now(), plays: 0, lastPlayed: 0, analyzed: true, energy: 5, sections: [], ...extra
});
const video = (v, extra) => track('yt_' + v, { path: 'youtube:' + v, source: 'youtube', ytId: v, title: 'Vídeo ' + v, artist: 'Canal', analyzed: false, bpm: 0, camelot: '', duration: 0, ...extra });
const cues = () => { const c = Array(8).fill(null); c[0] = { t: 10, color: '#ff3b47' }; c[2] = { t: 30, color: '#3fd6a4' }; return c; };

function seed() {
  // v1: importado sin clave (duración 0 en la biblioteca, el reproductor dice 40 s) con hot cues en 10 s y 30 s
  // v2-v4: vídeos cortos para el Autoplay (v2 sin duración en la lista)
  const tracks = [track('t0'), video('vidUno0001', { cues: cues() }), video('vidDos00002'), video('vidTres0003', { duration: 8 }), video('vidCuatro04', { duration: 8 })];
  return {
    library: { version: 1, tracks, crates: [{ id: 'ytc', name: 'Vídeos', ids: ['yt_vidDos00002', 'yt_vidTres0003', 'yt_vidCuatro04'], created: Date.now() }],
      smart: [], history: [], prepare: [], ytPlaylists: [] },
    settings: { libView: 'crate:ytc', crateSort: 'custom', waveLayout: 'serato', libSideW: 230, autoAnalyze: false,
      autoplay: { order: 'list', transition: 'fade', fadeSecs: 2, repeat: false, skipPlayed: false } }
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
async function click(win, x, y) {
  x = Math.round(x); y = Math.round(y);
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await wait(60);
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await wait(400);
}

// textos dibujados en cada lienzo (para saber si sale «Analizando…» o el aviso de YouTube)
const SPY = `(() => {
  const f = CanvasRenderingContext2D.prototype.fillText;
  window.__texts = new Map();
  CanvasRenderingContext2D.prototype.fillText = function (s, ...r) {
    const c = this.canvas, k = c.id || c.className;
    if (!window.__texts.has(k)) window.__texts.set(k, new Set());
    window.__texts.get(k).add(String(s));
    return f.call(this, s, ...r);
  };
  return true;
})()`;
// (las ondas solo se redibujan si algo cambia: se marcan para que se vuelvan a pintar y se lean los textos)
const texts = (sel) => `(() => { window.__texts = new Map();
  nexuraApp.waves.forEach(w => { w.dirty = true; }); nexuraApp.deckUIs.forEach(u => { u.waveDetail.dirty = true; u.overview.dirty = true; });
  return new Promise(r => setTimeout(() => {
  const o = {}; for (const [k, v] of window.__texts) o[k] = [...v]; r(o); }, 400)); })()`;
const clocks = `(() => { const u = nexuraApp.deckUIs[0], d = nexuraApp.decks[0];
  return { elapsed: u.elapsed.textContent, remain: u.remain.textContent, warn: u.remain.classList.contains('warn'), time: d.time, duration: d.duration, playing: d.playing }; })()`;
const secs = (s) => { const m = /^-?(\d+):(\d+)\.(\d)$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] + +m[3] / 10 : NaN; };

// Análisis de un lienzo: columnas con el color del deck, el cursor blanco y los hot cues
const PIXELS = (sel) => `(async () => {
  const { DECK_COLORS } = await import('/js/util.js');
  const c = document.querySelector(${JSON.stringify(sel)}), d = nexuraApp.decks[0];
  const W = c.width, H = c.height, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, W, H).data, k = W / c.clientWidth;
  const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const near = (p, q, tol) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) < tol;
  const col = (cx) => { const x = Math.round(cx * k), out = []; for (let y = 0; y < H; y++) { const i = (y * W + x) * 4; out.push([img[i], img[i + 1], img[i + 2]]); } return out; };
  const has = (cx, rgb, tol) => col(cx).some(p => near(p, rgb, tol));
  const pad = c.classList.contains('overview') ? 2 : 10, len = c.clientWidth - pad * 2;
  const xOf = (t) => pad + Math.min(1, t / d.duration) * len;
  const deck = hex(DECK_COLORS[0]), px = xOf(d.time);
  return {
    w: c.clientWidth, px,
    played: has(pad + (px - pad) / 3, deck, 70),   // (a la mitad estaría el hot cue de 10 s)
    unplayedDim: !has(Math.min(pad + len - 3, px + (pad + len - px) / 2 + 6), deck, 70),
    cursor: has(px, [255, 255, 255], 30) || has(px + 1, [255, 255, 255], 30),
    cue1: has(xOf(10), hex('#ff3b47'), 40) || has(xOf(10) + 0.6, hex('#ff3b47'), 40),
    cue3: has(xOf(30), hex('#3fd6a4'), 40) || has(xOf(30) + 0.6, hex('#3fd6a4'), 40),
    rect: (() => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()
  };
})()`;

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
  await js(win, `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(data.library))}); localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify({ welcomeDone: true, ...data.settings }))}); true`);
  await load(win);
  await wait(2500);
  await js(win, `document.querySelector('.start-overlay')?.remove(); document.querySelectorAll('.modal-ov').forEach(m => m.remove()); nexuraApp.engine.resume(); true`);
  await js(win, `window.__ytMockVideos = { vidUno0001: 40, vidDos00002: 8, vidTres0003: 8, vidCuatro04: 8 }; true`);
  const mock = await js(win, MOCK);
  check('Simulador del reproductor de YouTube instalado', mock === true, { mock });
  await js(win, SPY);

  // 1) Cargar un vídeo importado sin duración: al principio «--:--», en cuanto el reproductor la da, 40 s
  await js(win, `nexuraApp.loadToDeck('yt_vidUno0001', 0); true`);
  await wait(250);
  const c0 = await js(win, clocks);
  await wait(900);
  const c1 = await js(win, clocks);
  const libDur = await js(win, `nexuraApp.library.get('yt_vidUno0001').duration`);
  check('Antes de conocer la duración REMAIN muestra «--:--.-» (no un 0 engañoso)', c0.remain === '--:--.-' || c0.duration === 40, c0);
  check('Duración del reproductor: REMAIN -00:40.0 y guardada en la biblioteca', c1.duration === 40 && c1.remain === '-00:40.0' && c1.elapsed === '00:00.0' && libDur === 40, { c1, libDur });
  let tx = await js(win, texts());
  const allTexts = Object.values(tx).flat();
  check('Texto «▶ Vídeo de YouTube · sin forma de onda» y nunca «Analizando…»', allTexts.includes('▶ Vídeo de YouTube · sin forma de onda') && !allTexts.some(s => /Analizando/.test(s)), { tx });

  // 2) Reproducir: ELAPSED avanza de forma fluida (más valores distintos que las 4 actualizaciones por segundo del reproductor)
  await js(win, `nexuraApp.decks[0].play(); true`);
  const samples = await js(win, `new Promise(r => { const out = [], t0 = performance.now();
    const f = () => { const u = nexuraApp.deckUIs[0]; out.push([performance.now() - t0, u.elapsed.textContent, u.remain.textContent]); if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(out); };
    requestAnimationFrame(f); })`);
  const el = samples.map(s => secs(s[1])), distinct = new Set(samples.filter(s => s[0] > 1000).map(s => s[1])).size;
  const mono = el.every((v, i) => i === 0 || v >= el[i - 1]);
  const last = samples[samples.length - 1], sum = secs(last[1]) + Math.abs(secs(last[2]));
  check('ELAPSED avanza ~2 s en 2 s, sin retroceder y con décimas fluidas', mono && Math.abs(secs(last[1]) - 2) < 0.45 && distinct >= 7, { first: samples[0], last, distinct, mono });
  check('ELAPSED + REMAIN = duración (40 s)', Math.abs(sum - 40) < 0.25, { last, sum });

  // 3) Con tempo distinto de 1 (×1,5) el tiempo del vídeo avanza 1,5 s por segundo
  const tA = await js(win, `(() => { nexuraApp.decks[0].setTempo(1.5); return nexuraApp.decks[0].time; })()`);
  await wait(2000);
  const tB = await js(win, `nexuraApp.decks[0].time`);
  const rate = await js(win, `window.__ytPlayers[0].rate`);
  check('Tempo ×1,5: el reproductor va a 1,5 y el contador avanza ~3 s en 2 s', rate === 1.5 && Math.abs((tB - tA) - 3) < 0.5, { tA, tB, rate });
  await js(win, `nexuraApp.decks[0].setTempo(1); nexuraApp.decks[0].pause(); nexuraApp.decks[0].seek(20); true`);
  await wait(500);

  // 4) Barra de progreso en la vista de arriba (#wave0) y en la vista general del deck: color, cursor, hot cues
  const top = await js(win, PIXELS('#wave0'));
  check('Vista de arriba: barra de progreso del color del deck con cursor y hot cues', top.played && top.unplayedDim && top.cursor && top.cue1 && top.cue3, top);
  const ov = await js(win, PIXELS('#deck0 .overview'));
  check('Vista general del deck: barra de progreso con cursor y hot cues', ov.played && ov.unplayedDim && ov.cursor && ov.cue1 && ov.cue3, ov);
  await shot(win, '1280x800-01-superior');

  // 5) Clic para saltar: al 75 % de la barra de arriba → 30 s; al 25 % de la vista general → 10 s
  await click(win, top.rect.left + 10 + (top.rect.width - 20) * 0.75, top.rect.top + top.rect.height / 2);
  await wait(400);
  const s1 = await js(win, `({ time: nexuraApp.decks[0].time, seeks: window.__ytPlayers[0].seeks.slice(-2) })`);
  check('Clic en la barra de arriba salta a ese punto (≈ 30 s) en el reproductor', Math.abs(s1.time - 30) < 0.6, s1);
  await click(win, ov.rect.left + 2 + (ov.rect.width - 4) * 0.25, ov.rect.top + ov.rect.height / 2);
  await wait(400);
  const s2 = await js(win, `({ time: nexuraApp.decks[0].time, remain: nexuraApp.deckUIs[0].remain.textContent })`);
  check('Clic en la vista general salta (≈ 10 s) y REMAIN se actualiza (≈ -00:30)', Math.abs(s2.time - 10) < 0.6 && Math.abs(Math.abs(secs(s2.remain)) - 30) < 0.6, s2);

  // 6) Aviso de los últimos 30 s (REMAIN en rojo y cursor que parpadea), como en las pistas locales
  await js(win, `nexuraApp.decks[0].seek(25); nexuraApp.decks[0].play(); true`);
  await wait(700);
  const w1 = await js(win, clocks);
  check('Últimos 30 s: REMAIN en aviso (rojo)', w1.warn && w1.playing && w1.time > 25, w1);
  await js(win, `nexuraApp.decks[0].pause(); true`);

  // 7) Modo «EN DECK»: la barra sustituye a la forma de onda dentro del deck, entre ELAPSED y REMAIN
  await js(win, `nexuraApp.setWaveLayout('deck'); true`);
  await wait(500);
  const inDeck = await js(win, PIXELS('#deck0 .deck-detail-wave'));
  tx = await js(win, texts());
  const det = (tx['wave deck-detail-wave'] || []);
  check('EN DECK: barra con cursor y hot cues, y el texto «sin forma de onda»', inDeck.played && inDeck.cursor && inDeck.cue1 && inDeck.cue3 && det.includes('▶ Vídeo de YouTube · sin forma de onda') && !det.some(s => /Analizando/.test(s)), { inDeck, det });
  await click(win, inDeck.rect.left + 10 + (inDeck.rect.width - 20) * 0.5, inDeck.rect.top + inDeck.rect.height / 2);
  const s3 = await js(win, `nexuraApp.decks[0].time`);
  check('EN DECK: clic en la barra salta (≈ 20 s)', Math.abs(s3 - 20) < 0.6, { s3 });
  await shot(win, '1280x800-02-en-deck');
  win.setContentSize(375, 812);
  await wait(900);
  await shot(win, '375x812-01-en-deck');
  win.setContentSize(1280, 800);
  await js(win, `nexuraApp.setWaveLayout('serato'); true`);
  await wait(600);

  // 8) Autoplay sobre una lista de vídeos (8 s, fundido de 2 s): el fundido empieza ~2 s antes del final
  await js(win, `nexuraApp.decks.forEach(d => d.pause()); nexuraApp.decks[0].eject(); true`);
  await js(win, `(() => { const ui = nexuraApp.libraryUI; ui.setView('crate:ytc'); ui.refresh(); ui.sel = new Set(['yt_vidDos00002']); ui.cursor = ui.anchor = 0; ui.renderRows(); return true; })()`);
  await js(win, `window.__aplog = []; window.__aptimer = setInterval(() => { const A = nexuraApp, ap = A.autoplay, m = ap.mix;
    window.__aplog.push({ at: performance.now(), on: ap.enabled, id: ap.playing && ap.playing.id, mix: !!m, fromT: m ? m.from.time : null, fromDur: m ? m.from.duration : null,
      faders: A.decks.slice(0, 2).map(d => A.engine.channels[d.idx].values.fader), playing: A.decks.slice(0, 2).map(d => d.playing), tracks: A.decks.slice(0, 2).map(d => d.track && d.track.id) }); }, 50); true`);
  await js(win, `nexuraApp.autoplay.start(); true`);
  await wait(1200);
  await shot(win, '1280x800-03-autoplay');
  await wait(16000);
  const log = await js(win, `(() => { clearInterval(window.__aptimer); return window.__aplog; })()`);
  const order = []; for (const x of log) if (x.id && order[order.length - 1] !== x.id) order.push(x.id);
  const mixes = []; log.forEach((x, i) => { if (x.mix && !(log[i - 1] && log[i - 1].mix)) mixes.push(x); });
  const both = log.filter(x => x.mix && x.playing[0] && x.playing[1]).length;
  check('Autoplay con vídeos: Dos → Tres → Cuatro', JSON.stringify(order.slice(0, 3)) === JSON.stringify(['yt_vidDos00002', 'yt_vidTres0003', 'yt_vidCuatro04']), { order });
  check('Autoplay: el fundido empieza ~2 s antes del final del vídeo (con la duración del reproductor)', mixes.length >= 2 && mixes.every(m => m.fromDur === 8 && m.fromT >= 5.6 && m.fromT < 7.4), { mixes });
  check('Autoplay: durante el fundido suenan los dos vídeos y los faders se cruzan', both > 10 && log.some(x => x.mix && x.faders[0] > 0.2 && x.faders[0] < 0.95 && x.faders[1] > 0.2 && x.faders[1] < 0.95), { both });
  const end = await js(win, `({ on: nexuraApp.autoplay.enabled, toasts: [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent) })`);
  check('Autoplay: sin «no avanza» ni parada por pausa antes de acabar la lista', !end.toasts.some(t => /no avanza|en pausa/.test(t)), end);
  await js(win, `nexuraApp.autoplay.stop(true); nexuraApp.decks.forEach(d => d.pause()); true`);

  report.errors = report.errors.filter(e => !/favicon|ERR_/i.test(e));
  if (report.errors.length) fail('errores en consola: ' + report.errors.join(' | '));
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  console.log(report.ok ? '\nTODO OK' : '\nHAY FALLOS', '· informe en .revision/yt-tiempo/informe.json');
  app.exit(report.ok ? 0 : 1);
});
